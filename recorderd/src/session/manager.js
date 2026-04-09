import { EventEmitter } from "node:events";
import path from "node:path";
import { createApiError } from "../http/errors.js";
import { buildTracksFromProfile, getDeviceProfile, listDeviceProfiles } from "../audio/device-profile.js";
import { durationFramesToSeconds, nowIso } from "../util/time.js";
import {
  buildWaveformBinsFromI32
} from "../util/waveform.js";

function createInputTracks(profileId) {
  return buildTracksFromProfile(profileId);
}

function normalizeUsbChannel(value, maxChannels) {
  const channel = Number.parseInt(value, 10);

  if (!Number.isFinite(channel) || channel < 1 || channel > maxChannels) {
    return null;
  }

  return channel;
}

function countRecordableArmedTracks(manifest) {
  const maxChannels = Number(manifest?.format?.channelCount) || Number.MAX_SAFE_INTEGER;

  return (Array.isArray(manifest?.tracks) ? manifest.tracks : []).filter(function (track) {
    return Boolean(track?.armed) && Number.isFinite(normalizeUsbChannel(track?.usbChannel, maxChannels));
  }).length;
}

function armedTrackChannels(manifest) {
  const maxChannels = Number(manifest?.format?.channelCount) || Number.MAX_SAFE_INTEGER;
  const seen = new Set();
  const channels = [];

  manifest.tracks
    .filter(function (track) {
      return track.armed;
    })
    .forEach(function (track) {
      const channel = normalizeUsbChannel(track.usbChannel, maxChannels);

      if (!Number.isFinite(channel) || seen.has(channel)) {
        return;
      }

      seen.add(channel);
      channels.push(channel);
    });

  return channels;
}

function normalizeTrackChannels(trackChannels, maxChannels) {
  const source = Array.isArray(trackChannels) ? trackChannels : [];
  const seen = new Set();
  const normalized = [];

  for (const value of source) {
    const channel = Number.parseInt(value, 10);

    if (!Number.isFinite(channel) || channel < 1 || channel > maxChannels || seen.has(channel)) {
      continue;
    }

    seen.add(channel);
    normalized.push(channel);
  }

  return normalized;
}

function monitorConfigKey(config) {
  if (!config) {
    return "";
  }

  return JSON.stringify({
    deviceId: config.deviceId,
    sampleRate: config.sampleRate,
    trackChannels: config.trackChannels
  });
}

function areMonitorConfigsEqual(left, right) {
  return monitorConfigKey(left) === monitorConfigKey(right);
}

function buildStatePayload(state) {
  return {
    state: state.state,
    sessionId: state.sessionId || null,
    durationSeconds: state.durationSeconds || 0,
    sampleRate: state.sampleRate || null,
    channelsArmed: state.channelsArmed || 0,
    dropCount: state.dropCount || 0,
    storageTarget: state.storageTarget || null
  };
}

export class SessionManager extends EventEmitter {
  constructor({ config, store, deviceManager }) {
    super();
    this.config = config;
    this.store = store;
    this.deviceManager = deviceManager;
    this.recorderState = {
      state: "idle",
      sessionId: null,
      durationSeconds: 0,
      sampleRate: null,
      channelsArmed: 0,
      dropCount: 0,
      storageTarget: null
    };
    this.runtime = null;
    this.monitorState = {
      config: null,
      runtime: null,
      suspendedByRecording: false
    };
  }

  async init() {
    const sessions = await this.store.listSessions();
    const activeCandidate = sessions.find(function (session) {
      return session.status === "prepared";
    });

    if (activeCandidate) {
      const manifest = await this.store.getSession(activeCandidate.id);

      this.setRecorderState({
        state: "prepared",
        sessionId: manifest.id,
        durationSeconds: durationFramesToSeconds(manifest.durationFrames, manifest.format.sampleRate),
        sampleRate: manifest.format.sampleRate,
        channelsArmed: countRecordableArmedTracks(manifest),
        dropCount: manifest.dropEvents.length,
        storageTarget: manifest.storageTarget
      });
    }

    setInterval(() => {
      this.store.cleanupExpiredArtifacts().catch(function () {
      });
    }, 60 * 60 * 1000).unref();
  }

  async listDevices() {
    await this.deviceManager.refresh();
    return this.deviceManager.listInputDevices();
  }

  async listProfiles() {
    await this.deviceManager.refresh();
    return listDeviceProfiles(this.deviceManager.listInputDevices());
  }

  getRecorderState() {
    if (this.runtime) {
      this.recorderState.durationSeconds = durationFramesToSeconds(
        this.runtime.manifest.durationFrames,
        this.runtime.manifest.format.sampleRate
      );
      this.recorderState.dropCount = this.runtime.manifest.dropEvents.length;
    }

    return buildStatePayload(this.recorderState);
  }

  getMonitorState() {
    return {
      enabled: Boolean(this.monitorState.config),
      active: Boolean(this.monitorState.runtime),
      suspended: Boolean(this.runtime) || this.monitorState.suspendedByRecording,
      deviceId: this.monitorState.config?.deviceId || null,
      sampleRate: this.monitorState.config?.sampleRate || null,
      trackChannels: this.monitorState.config?.trackChannels || []
    };
  }

  async configureMonitor(request) {
    await this.deviceManager.refresh();

    if (request?.enabled === false || !request?.deviceId) {
      await this.stopMonitorStream({
        clearConfig: true,
        clearSuspended: true
      });
      return this.getMonitorState();
    }

    const device = this.deviceManager.getDevice(request.deviceId);

    if (!device) {
      throw createApiError(404, "DEVICE_NOT_FOUND", "The selected input device could not be found.");
    }

    const sampleRate = Number.parseInt(request.sampleRate, 10);

    if (!Number.isFinite(sampleRate) || !device.sampleRates.includes(sampleRate)) {
      throw createApiError(400, "UNSUPPORTED_SAMPLE_RATE", "The selected monitor sample rate is not supported by the device.");
    }

    const trackChannels = normalizeTrackChannels(request.trackChannels, device.inputChannels);

    if (!trackChannels.length) {
      throw createApiError(400, "MONITOR_CHANNELS_INVALID", "At least one valid monitor channel is required.");
    }

    const nextConfig = {
      deviceId: device.id,
      backend: device.backend,
      expectedChannels: device.inputChannels,
      sampleRate,
      trackChannels
    };
    const configChanged = !areMonitorConfigsEqual(this.monitorState.config, nextConfig)
      || this.monitorState.config?.backend !== nextConfig.backend
      || this.monitorState.config?.expectedChannels !== nextConfig.expectedChannels;

    this.monitorState.config = nextConfig;

    if (this.runtime) {
      this.monitorState.suspendedByRecording = true;

      if (configChanged && this.monitorState.runtime) {
        await this.stopMonitorStream({
          clearConfig: false,
          clearSuspended: false
        });
      }

      return this.getMonitorState();
    }

    if (configChanged || !this.monitorState.runtime) {
      await this.ensureMonitorStream();
    }

    return this.getMonitorState();
  }

  async listSessions() {
    return this.store.listSessions();
  }

  async getSession(sessionId) {
    return this.store.getSession(sessionId);
  }

  async prepareSession(request) {
    if (this.runtime || this.recorderState.state === "prepared") {
      throw createApiError(409, "ACTIVE_SESSION_EXISTS", "A prepared or active session already exists.");
    }

    await this.deviceManager.refresh();

    const device = this.deviceManager.getDevice(request.deviceId);
    const profile = getDeviceProfile(request.profileId);

    if (!device) {
      throw createApiError(404, "DEVICE_NOT_FOUND", "The selected input device could not be found.");
    }

    if (!profile) {
      throw createApiError(400, "DEVICE_PROFILE_NOT_FOUND", "The selected device profile could not be found.");
    }

    if (!["server_local", "client_download"].includes(request.storageTarget)) {
      throw createApiError(400, "INVALID_STORAGE_TARGET", "The storage target must be server_local or client_download.");
    }

    if (device.inputChannels !== profile.expectedInputChannels) {
      throw createApiError(
        400,
        "DEVICE_CHANNEL_MISMATCH",
        "Selected profile expects " + profile.expectedInputChannels + " inputs but the device exposes " + device.inputChannels + "."
      );
    }

    if (!device.sampleRates.includes(request.sampleRate) || !profile.preferredSampleRates.includes(request.sampleRate)) {
      throw createApiError(
        400,
        "UNSUPPORTED_SAMPLE_RATE",
        "The selected sample rate is not supported by the device/profile combination."
      );
    }

    const tracks = (Array.isArray(request.tracks) && request.tracks.length ? request.tracks : createInputTracks(profile.id))
      .map(function (track, index) {
        const usbChannel = normalizeUsbChannel(track?.usbChannel, profile.expectedInputChannels);
        const fallbackLabel = usbChannel
          ? ("USB " + String(usbChannel).padStart(2, "0"))
          : ("Track " + String(index + 1).padStart(2, "0"));

        return {
          usbChannel,
          label: String(track?.label || "").trim() || fallbackLabel,
          armed: Boolean(track?.armed)
        };
      });

    const seenChannels = new Set();

    for (const track of tracks) {
      if (!track.armed) {
        continue;
      }

      const usbChannel = normalizeUsbChannel(track.usbChannel, profile.expectedInputChannels);

      if (!Number.isFinite(usbChannel)) {
        continue;
      }

      if (seenChannels.has(usbChannel)) {
        throw createApiError(400, "DUPLICATE_TRACK_CHANNEL", "Each track input must map to a unique device channel.");
      }

      seenChannels.add(usbChannel);
    }

    if (!tracks.some(function (track) {
      return track.armed && Number.isFinite(normalizeUsbChannel(track.usbChannel, profile.expectedInputChannels));
    })) {
      throw createApiError(
        400,
        "NO_RECORDABLE_TRACKS",
        "At least one armed track with an assigned input channel is required."
      );
    }

    const manifest = await this.store.prepareSession(
      {
        title: String(request.title || "").trim() || "New Recording",
        storageTarget: request.storageTarget,
        sampleRate: request.sampleRate,
        tracks
      },
      device,
      profile
    );

    this.setRecorderState({
      state: "prepared",
      sessionId: manifest.id,
      durationSeconds: 0,
      sampleRate: manifest.format.sampleRate,
      channelsArmed: countRecordableArmedTracks(manifest),
      dropCount: 0,
      storageTarget: manifest.storageTarget
    });

    return manifest;
  }

  async start(sessionId) {
    if (this.runtime) {
      throw createApiError(409, "RECORDER_ALREADY_RUNNING", "The recorder is already running.");
    }

    const manifest = await this.store.getSession(sessionId);

    if (!manifest || manifest.status !== "prepared") {
      throw createApiError(400, "RECORDER_NOT_PREPARED", "The requested session is not prepared.");
    }

    const runtime = {
      manifest,
      queue: [],
      processing: false,
      activeStream: null,
      trackStates: new Map(),
      sampleCursor: 0,
      segmentFrameLimit: manifest.format.sampleRate * this.config.segmentSeconds,
      currentSegmentIndex: 1,
      currentSegmentFrameCount: 0,
      currentSegmentStartFrame: 0,
      stopRequested: false,
      failing: false
    };
    const recordableTrackChannels = armedTrackChannels(manifest);

    if (!recordableTrackChannels.length) {
      throw createApiError(
        400,
        "NO_RECORDABLE_TRACKS",
        "At least one armed track with an assigned input channel is required."
      );
    }

    await this.stopMonitorStream({
      clearConfig: false,
      clearSuspended: false
    });
    this.monitorState.suspendedByRecording = true;

    await this.openSegmentWriters(runtime, 1);

    const backend = this.deviceManager.getBackend(manifest.device.backend);

    if (!backend) {
      await this.abortOpenTrackWriters(runtime);
      throw createApiError(500, "AUDIO_BACKEND_ERROR", "No audio backend is available for " + manifest.device.backend + ".");
    }

    this.runtime = runtime;

    try {
      runtime.activeStream = await backend.openInputStream({
        deviceId: manifest.device.id,
        sampleRate: manifest.format.sampleRate,
        expectedChannels: manifest.format.channelCount,
        framesPerBufferHint: this.config.framesPerBufferHint,
        trackChannels: recordableTrackChannels,
        onAudioBlock: (block) => {
          this.enqueueAudioBlock(runtime, block);
        },
        onError: (error) => {
          this.handleRuntimeError(runtime, error).catch(function () {
          });
        }
      });
    } catch (error) {
      this.runtime = null;
      await this.abortOpenTrackWriters(runtime);
      this.monitorState.suspendedByRecording = false;
      await this.ensureMonitorStream().catch(function () {
      });
      throw createApiError(500, "AUDIO_BACKEND_ERROR", error.message || "Unable to open the selected audio input stream.");
    }

    manifest.status = "recording";
    manifest.startedAt = manifest.startedAt || nowIso();
    await this.store.updateManifest(manifest.id, manifest);
    this.setRecorderState({
      state: "recording",
      sessionId: manifest.id,
      durationSeconds: 0,
      sampleRate: manifest.format.sampleRate,
      channelsArmed: countRecordableArmedTracks(manifest),
      dropCount: manifest.dropEvents.length,
      storageTarget: manifest.storageTarget
    });

    this.emit("recorder_state_changed", this.getRecorderState());

    return this.getRecorderState();
  }

  async stop(sessionId) {
    if (!this.runtime) {
      throw createApiError(400, "RECORDER_NOT_PREPARED", "No active recorder session matches the request.");
    }

    if (sessionId && this.runtime.manifest.id !== sessionId) {
      throw createApiError(400, "RECORDER_NOT_PREPARED", "No active recorder session matches the request.");
    }

    const runtime = this.runtime;

    runtime.manifest.status = "stopping";
    await this.store.updateManifest(runtime.manifest.id, runtime.manifest);
    this.setRecorderState({
      ...this.recorderState,
      state: "stopping"
    });
    this.emit("recorder_state_changed", this.getRecorderState());

    runtime.stopRequested = true;

    if (runtime.activeStream) {
      await runtime.activeStream.stop().catch((error) => {
        runtime.manifest.dropEvents.push({
          detectedAt: nowIso(),
          reason: "STREAM_STOP_FAILED",
          message: error?.message || "Unable to stop backend stream cleanly."
        });
      });
    }

    await this.drainQueue(runtime);

    if (runtime.currentSegmentFrameCount > 0) {
      try {
        await this.finalizeCurrentSegment(runtime);
      } catch (error) {
        runtime.manifest.dropEvents.push({
          detectedAt: nowIso(),
          reason: "SEGMENT_FINALIZE_FAILED",
          message: error?.message || "Unable to finalize one or more audio segment files."
        });
        await this.abortOpenTrackWriters(runtime).catch(function () {
        });
      }
    } else {
      await this.abortOpenTrackWriters(runtime);
    }

    runtime.manifest.status = "completed";
    runtime.manifest.stoppedAt = nowIso();
    runtime.manifest.durationFrames = runtime.sampleCursor;

    if (runtime.manifest.storageTarget === "client_download") {
      runtime.manifest.export.status = "pending";
      await this.store.updateManifest(runtime.manifest.id, runtime.manifest);

      try {
        const artifact = await this.store.createExportArchive(runtime.manifest.id);
        runtime.manifest.export.status = "ready";
        runtime.manifest.export.archiveFile = artifact.archiveFile;
        runtime.manifest.export.downloadUrl = artifact.downloadUrl;
      } catch (error) {
        runtime.manifest.export.status = "failed";
      }
    }

    await this.store.finalizeSession(runtime.manifest.id, runtime.manifest);

    this.runtime = null;
    this.setRecorderState({
      state: "idle",
      sessionId: null,
      durationSeconds: 0,
      sampleRate: null,
      channelsArmed: 0,
      dropCount: 0,
      storageTarget: null
    });
    this.emit("session_completed", {
      sessionId: runtime.manifest.id
    });
    this.emit("recorder_state_changed", this.getRecorderState());
    this.monitorState.suspendedByRecording = false;
    await this.ensureMonitorStream().catch(function () {
    });

    return runtime.manifest;
  }

  async createExportArchive(sessionId) {
    const manifest = await this.store.getSession(sessionId);

    if (!manifest) {
      throw createApiError(404, "SESSION_NOT_FOUND", "The session could not be found.");
    }

    if (manifest.storageTarget !== "client_download") {
      throw createApiError(400, "EXPORT_UNSUPPORTED_FOR_TARGET", "Export is only available for client_download sessions.");
    }

    try {
      const artifact = await this.store.createExportArchive(sessionId);
      manifest.export.status = "ready";
      manifest.export.archiveFile = artifact.archiveFile;
      manifest.export.downloadUrl = artifact.downloadUrl;
      await this.store.updateManifest(sessionId, manifest);

      return artifact;
    } catch (error) {
      throw createApiError(410, "MEDIA_EXPIRED", "Raw media artifacts are no longer available for export.");
    }
  }

  async markArchiveDownloaded(sessionId) {
    const manifest = await this.store.getSession(sessionId);

    if (!manifest) {
      return;
    }

    if (manifest.export?.status === "ready") {
      manifest.export.status = "downloaded";
      await this.store.updateManifest(sessionId, manifest);
    }
  }

  setRecorderState(nextState) {
    this.recorderState = {
      ...this.recorderState,
      ...nextState
    };
  }

  async stopMonitorStream(options = {}) {
    const clearConfig = options.clearConfig === true;
    const clearSuspended = options.clearSuspended !== false;
    const runtime = this.monitorState.runtime;

    this.monitorState.runtime = null;

    if (runtime?.activeStream) {
      await runtime.activeStream.stop().catch(function () {
      });
    }

    if (clearConfig) {
      this.monitorState.config = null;
    }

    if (clearSuspended) {
      this.monitorState.suspendedByRecording = false;
    }
  }

  emitMonitorMeterUpdate(runtime, block) {
    if (runtime !== this.monitorState.runtime || this.runtime) {
      return;
    }

    runtime.sampleCursor += block.frameCount;
    this.emit("meter_update", {
      sessionId: null,
      durationFrames: runtime.sampleCursor,
      sampleRate: runtime.config.sampleRate,
      channels: block.channels.map((channel) => {
        return {
          usbChannel: channel.usbChannel,
          peakDbfs: channel.peakDbfs,
          waveformPeaks: buildWaveformBinsFromI32(channel.samples, this.config.liveWaveformBins)
        };
      })
    });
  }

  async handleMonitorRuntimeError(runtime, error) {
    if (runtime !== this.monitorState.runtime) {
      return;
    }

    await this.stopMonitorStream({
      clearConfig: false,
      clearSuspended: false
    });

    if (!this.runtime) {
      this.monitorState.suspendedByRecording = false;
    }

    void error;
  }

  async ensureMonitorStream() {
    if (this.runtime || !this.monitorState.config) {
      return;
    }

    const existingRuntime = this.monitorState.runtime;

    if (existingRuntime && areMonitorConfigsEqual(existingRuntime.config, this.monitorState.config)) {
      return;
    }

    await this.stopMonitorStream({
      clearConfig: false,
      clearSuspended: false
    });

    const config = this.monitorState.config;
    const backend = this.deviceManager.getBackend(config.backend);

    if (!backend) {
      throw createApiError(500, "AUDIO_BACKEND_ERROR", "No audio backend is available for " + config.backend + ".");
    }

    const runtime = {
      config,
      activeStream: null,
      sampleCursor: 0
    };

    this.monitorState.runtime = runtime;
    this.monitorState.suspendedByRecording = false;

    try {
      runtime.activeStream = await backend.openInputStream({
        deviceId: config.deviceId,
        sampleRate: config.sampleRate,
        expectedChannels: config.expectedChannels,
        framesPerBufferHint: this.config.framesPerBufferHint,
        trackChannels: config.trackChannels,
        onAudioBlock: (block) => {
          this.emitMonitorMeterUpdate(runtime, block);
        },
        onError: (error) => {
          this.handleMonitorRuntimeError(runtime, error).catch(function () {
          });
        }
      });
    } catch (error) {
      await this.stopMonitorStream({
        clearConfig: false,
        clearSuspended: false
      });
      throw createApiError(500, "AUDIO_BACKEND_ERROR", error.message || "Unable to open monitor input stream.");
    }
  }

  enqueueAudioBlock(runtime, block) {
    if (runtime !== this.runtime || runtime.stopRequested || runtime.failing) {
      return;
    }

    if (runtime.queue.length >= this.config.queueBlockCapacity) {
      runtime.manifest.dropEvents.push({
        detectedAt: nowIso(),
        reason: "QUEUE_OVERFLOW"
      });
      this.emit("drop_event", {
        sessionId: runtime.manifest.id,
        dropCount: runtime.manifest.dropEvents.length
      });
      return;
    }

    runtime.queue.push(block);

    this.scheduleDrain(runtime);
  }

  scheduleDrain(runtime) {
    if (runtime.processing) {
      return;
    }

    runtime.processing = true;
    setImmediate(async () => {
      try {
        await this.drainQueue(runtime);
      } finally {
        runtime.processing = false;
      }
    });
  }

  async drainQueue(runtime) {
    while (runtime.queue.length) {
      const block = runtime.queue.shift();

      await this.writeBlock(runtime, block);
      this.emitMeterUpdate(runtime, block);

      if (runtime.sampleCursor % runtime.manifest.format.sampleRate === 0) {
        await this.store.updateManifest(runtime.manifest.id, runtime.manifest);
      }
    }
  }

  async writeBlock(runtime, block) {
    let offset = 0;
    let remaining = block.frameCount;

    while (remaining > 0) {
      const available = runtime.segmentFrameLimit - runtime.currentSegmentFrameCount;
      const writeFrames = Math.min(remaining, available);

      for (const channel of block.channels) {
        const trackState = runtime.trackStates.get(channel.usbChannel);

        if (!trackState) {
          continue;
        }

        const slice = channel.samples.subarray(offset, offset + writeFrames);

        await trackState.writer.writeFramesI32(slice);
      }

      runtime.sampleCursor += writeFrames;
      runtime.currentSegmentFrameCount += writeFrames;
      runtime.manifest.durationFrames = runtime.sampleCursor;
      offset += writeFrames;
      remaining -= writeFrames;

      if (runtime.currentSegmentFrameCount >= runtime.segmentFrameLimit) {
        await this.finalizeCurrentSegment(runtime);
        await this.openSegmentWriters(runtime, runtime.currentSegmentIndex + 1);
      }
    }
  }

  async openSegmentWriters(runtime, segmentIndex) {
    runtime.trackStates.clear();
    runtime.currentSegmentIndex = segmentIndex;
    runtime.currentSegmentStartFrame = runtime.sampleCursor;
    runtime.currentSegmentFrameCount = 0;
    const maxChannels = Number(runtime?.manifest?.format?.channelCount) || Number.MAX_SAFE_INTEGER;

    for (const track of runtime.manifest.tracks) {
      if (!track.armed) {
        continue;
      }

      const usbChannel = normalizeUsbChannel(track.usbChannel, maxChannels);

      if (!Number.isFinite(usbChannel)) {
        continue;
      }

      const writer = await this.store.openTrackSegment(
        runtime.manifest.id,
        usbChannel,
        segmentIndex,
        runtime.manifest.format
      );

      runtime.trackStates.set(usbChannel, {
        writer
      });
    }
  }

  async abortOpenTrackWriters(runtime) {
    for (const trackState of runtime.trackStates.values()) {
      await trackState.writer.abort();
    }

    runtime.trackStates.clear();
  }

  async finalizeCurrentSegment(runtime) {
    const maxChannels = Number(runtime?.manifest?.format?.channelCount) || Number.MAX_SAFE_INTEGER;

    for (const track of runtime.manifest.tracks) {
      if (!track.armed) {
        continue;
      }

      const usbChannel = normalizeUsbChannel(track.usbChannel, maxChannels);

      if (!Number.isFinite(usbChannel)) {
        continue;
      }

      const trackState = runtime.trackStates.get(usbChannel);

      if (!trackState) {
        continue;
      }

      const result = await trackState.writer.finalize();
      const relativeFile = path.relative(
        this.store.sessionDir(runtime.manifest.id),
        result.filePath
      ).replaceAll(path.sep, "/");

      track.segments.push({
        index: runtime.currentSegmentIndex,
        file: relativeFile,
        startFrame: runtime.currentSegmentStartFrame,
        endFrame: runtime.currentSegmentStartFrame + runtime.currentSegmentFrameCount - 1,
        sizeBytes: result.sizeBytes,
        peakDbfs: result.peakDbfs,
        waveformPeaks: result.waveformPeaks
      });
      track.lastPeakDbfs = result.peakDbfs;
    }

    runtime.trackStates.clear();
  }

  emitMeterUpdate(runtime, block) {
    for (const channel of block.channels) {
      const manifestTrack = runtime.manifest.tracks.find(function (track) {
        return track.usbChannel === channel.usbChannel;
      });

      if (manifestTrack) {
        manifestTrack.lastPeakDbfs = channel.peakDbfs;
      }
    }

    this.emit("meter_update", {
      sessionId: runtime.manifest.id,
      durationFrames: runtime.sampleCursor,
      sampleRate: runtime.manifest.format.sampleRate,
      channels: block.channels.map((channel) => {
        return {
          usbChannel: channel.usbChannel,
          peakDbfs: channel.peakDbfs,
          waveformPeaks: buildWaveformBinsFromI32(channel.samples, this.config.liveWaveformBins)
        };
      })
    });
  }

  async handleRuntimeError(runtime, error) {
    if (runtime !== this.runtime || runtime.stopRequested || runtime.failing) {
      return;
    }

    runtime.failing = true;
    runtime.stopRequested = true;

    runtime.manifest.dropEvents.push({
      detectedAt: nowIso(),
      reason: "BACKEND_ERROR",
      message: error.message || "Unexpected backend failure."
    });

    if (runtime.activeStream) {
      await runtime.activeStream.stop().catch(function () {
      });
    }

    await this.drainQueue(runtime).catch(function () {
    });

    if (runtime.currentSegmentFrameCount > 0) {
      await this.finalizeCurrentSegment(runtime).catch(function () {
      });
    } else {
      await this.abortOpenTrackWriters(runtime).catch(function () {
      });
    }

    runtime.manifest.status = "failed";
    runtime.manifest.stoppedAt = nowIso();
    runtime.manifest.durationFrames = runtime.sampleCursor;

    await this.store.failSession(runtime.manifest.id, runtime.manifest);

    this.runtime = null;
    this.setRecorderState({
      state: "idle",
      sessionId: null,
      durationSeconds: 0,
      sampleRate: null,
      channelsArmed: 0,
      dropCount: 0,
      storageTarget: null
    });

    this.emit("session_completed", {
      sessionId: runtime.manifest.id,
      status: "failed"
    });
    this.emit("recorder_state_changed", this.getRecorderState());
    this.monitorState.suspendedByRecording = false;
    await this.ensureMonitorStream().catch(function () {
    });
  }
}
