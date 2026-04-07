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

function armedTrackChannels(manifest) {
  return manifest.tracks
    .filter(function (track) {
      return track.armed;
    })
    .map(function (track) {
      return track.usbChannel;
    });
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
        channelsArmed: manifest.tracks.filter(function (track) {
          return track.armed;
        }).length,
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
      .map(function (track) {
        return {
          usbChannel: Number(track.usbChannel),
          label: String(track.label || "").trim() || ("USB " + String(track.usbChannel).padStart(2, "0")),
          armed: Boolean(track.armed)
        };
      });

    if (!tracks.some(function (track) {
      return track.armed;
    })) {
      throw createApiError(400, "NO_ARMED_TRACKS", "At least one armed track is required.");
    }

    const seenChannels = new Set();

    for (const track of tracks) {
      if (track.usbChannel < 1 || track.usbChannel > profile.expectedInputChannels) {
        throw createApiError(400, "DEVICE_CHANNEL_MISMATCH", "Track channel " + track.usbChannel + " is outside the profile range.");
      }

      if (seenChannels.has(track.usbChannel)) {
        throw createApiError(400, "DUPLICATE_TRACK_CHANNEL", "Each track input must map to a unique device channel.");
      }

      seenChannels.add(track.usbChannel);
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
      channelsArmed: manifest.tracks.filter(function (track) {
        return track.armed;
      }).length,
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
        trackChannels: armedTrackChannels(manifest),
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
      channelsArmed: manifest.tracks.filter(function (track) {
        return track.armed;
      }).length,
      dropCount: manifest.dropEvents.length,
      storageTarget: manifest.storageTarget
    });

    this.emit("recorder_state_changed", this.getRecorderState());

    return this.getRecorderState();
  }

  async stop(sessionId) {
    if (!this.runtime || this.runtime.manifest.id !== sessionId) {
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
      await runtime.activeStream.stop();
    }

    await this.drainQueue(runtime);

    if (runtime.currentSegmentFrameCount > 0) {
      await this.finalizeCurrentSegment(runtime);
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

    for (const track of runtime.manifest.tracks) {
      if (!track.armed) {
        continue;
      }

      const writer = await this.store.openTrackSegment(
        runtime.manifest.id,
        track.usbChannel,
        segmentIndex,
        runtime.manifest.format
      );

      runtime.trackStates.set(track.usbChannel, {
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
    for (const track of runtime.manifest.tracks) {
      if (!track.armed) {
        continue;
      }

      const trackState = runtime.trackStates.get(track.usbChannel);
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
  }
}
