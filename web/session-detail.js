(function () {
  const MIN_SIDEBAR_WIDTH = 180;
  const MAX_SIDEBAR_WIDTH = 520;
  const SIDEBAR_STORAGE_KEY = "recorder.session.sidebarWidth";
  const DEFAULT_TITLE = "New Recording";
  const DEFAULT_STORAGE_TARGET = "server_local";
  const DEFAULT_TIMELINE_SECONDS = 5 * 60;
  const POLL_INTERVAL_MS = 1000;
  const MAX_RENDER_WAVEFORM_BINS = 96;
  const MAX_LIVE_WAVEFORM_BINS = 160;
  const CLIP_THRESHOLD_DBFS = -0.5;

  const state = {
    devices: [],
    profiles: [],
    settingsOpen: false,
    recorder: {
      state: "idle",
      sessionId: null,
      durationSeconds: 0,
      sampleRate: null,
      channelsArmed: 0,
      dropCount: 0,
      storageTarget: null
    },
    sessionId: null,
    manifest: null,
    draft: null,
    selectedTrackIndex: 0,
    pendingAction: null,
    livePeaks: new Map(),
    liveWaveforms: new Map(),
    liveDurationFrames: 0,
    waveformPlaylist: null,
    waveformDetail: null,
    previewToken: 0,
    previewKey: "",
    detailPreviewKey: "",
    pollingTimer: null,
    refreshTimer: null,
    websocket: null,
    reconnectTimer: null,
    disposed: false,
    autoDownloadedSessionId: null,
    autoDownloadRequestedSessionId: null
  };

  const elements = {
    root: document.querySelector(".logic-screen--session"),
    windowbar: document.getElementById("logic-windowbar"),
    modalRoot: document.getElementById("logic-modal-root"),
    arrangeCorner: document.getElementById("logic-arrange-corner"),
    ruler: document.getElementById("logic-ruler"),
    trackHeaders: document.getElementById("logic-track-headers"),
    trackLanes: document.getElementById("logic-track-lanes"),
    preview: document.getElementById("logic-preview")
  };

  function ensureDraftState() {
    if (!state.draft) {
      state.draft = createDraftFromDefaults();
    }

    return state.draft;
  }

  function getActiveSessionId() {
    return state.recorder.sessionId || state.manifest?.id || null;
  }

  function getTrackScrollTop() {
    return elements.trackLanes.scrollTop || elements.trackHeaders.scrollTop || 0;
  }

  function restoreTrackScroll(scrollTop) {
    elements.trackHeaders.scrollTop = scrollTop;
    elements.trackLanes.scrollTop = scrollTop;
  }

  function clone(value) {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function downsampleWaveformPeaks(peaks, targetBins) {
    if (!Array.isArray(peaks) || !peaks.length || !targetBins || targetBins < 1) {
      return [];
    }

    if (peaks.length <= targetBins) {
      return peaks.map(function (value) {
        return Number(clamp01(value).toFixed(4));
      });
    }

    const nextBins = [];

    for (let bucket = 0; bucket < targetBins; bucket += 1) {
      const start = Math.floor((bucket / targetBins) * peaks.length);
      const end = Math.max(start + 1, Math.floor(((bucket + 1) / targetBins) * peaks.length));
      let peak = 0;

      for (let index = start; index < end; index += 1) {
        peak = Math.max(peak, clamp01(peaks[index]));
      }

      nextBins.push(Number(peak.toFixed(4)));
    }

    return nextBins;
  }

  function appendWaveformPeaks(existingPeaks, nextPeaks, maxBins) {
    const merged = [
      ...(Array.isArray(existingPeaks) ? existingPeaks : []),
      ...(Array.isArray(nextPeaks) ? nextPeaks : [])
    ];

    if (!maxBins || merged.length <= maxBins) {
      return merged;
    }

    return merged.slice(merged.length - maxBins);
  }

  function getCurrentPathSessionId() {
    const match = window.location.pathname.match(/^\/session\/([^/]+)$/);

    return match ? decodeURIComponent(match[1]) : null;
  }

  function replaceRoute(sessionId) {
    const nextPath = sessionId ? "/session/" + encodeURIComponent(sessionId) : "/session";

    if (window.location.pathname !== nextPath) {
      window.history.replaceState({}, "", nextPath);
    }
  }

  function pushRoute(sessionId) {
    const nextPath = sessionId ? "/session/" + encodeURIComponent(sessionId) : "/session";

    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
  }

  function getQueryOverrides() {
    const params = new URLSearchParams(window.location.search);
    const sampleRate = Number.parseInt(params.get("rate") || params.get("sampleRate") || "", 10);

    return {
      title: params.get("title") || "",
      deviceId: params.get("device") || params.get("deviceId") || "",
      profileId: params.get("profile") || params.get("profileId") || "",
      storageTarget: params.get("target") || params.get("storageTarget") || "",
      sampleRate: Number.isFinite(sampleRate) ? sampleRate : null
    };
  }

  function readStoredDefaults() {
    try {
      const raw = window.localStorage.getItem("recorder.session.defaults");

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);

      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      void error;
      return null;
    }
  }

  function persistDraftDefaults(draft) {
    if (!draft) {
      return;
    }

    try {
      window.localStorage.setItem("recorder.session.defaults", JSON.stringify({
        title: draft.title,
        deviceId: draft.deviceId,
        profileId: draft.profileId,
        storageTarget: draft.storageTarget,
        sampleRate: draft.sampleRate,
        tracks: draft.tracks.map(function (track) {
          return {
            usbChannel: track.usbChannel,
            label: track.label,
            armed: Boolean(track.armed)
          };
        })
      }));
    } catch (error) {
      void error;
    }
  }

  function getDeviceById(deviceId) {
    return state.devices.find(function (device) {
      return device.id === deviceId;
    }) || null;
  }

  function getProfileById(profileId) {
    return state.profiles.find(function (profile) {
      return profile.id === profileId;
    }) || null;
  }

  function getProfilesForDevice(device) {
    return state.profiles.filter(function (profile) {
      return isCompatible(device, profile);
    });
  }

  function isCompatible(device, profile) {
    if (!device || !profile) {
      return false;
    }

    if (device.inputChannels !== profile.expectedInputChannels) {
      return false;
    }

    return profile.preferredSampleRates.some(function (sampleRate) {
      return device.sampleRates.includes(sampleRate);
    });
  }

  function profileMatchesDeviceHint(device, profile) {
    const name = String(device?.name || "").toLowerCase();

    if (profile.id === "x32-32") {
      return /(x32|x-usb|behringer)/.test(name);
    }

    if (profile.id === "tf-34") {
      return /(yamaha|\\btf\\b|steinberg)/.test(name);
    }

    return false;
  }

  function chooseProfileForDevice(device, preferredProfileId) {
    const candidates = getProfilesForDevice(device);

    if (!candidates.length) {
      return null;
    }

    return candidates
      .slice()
      .sort(function (left, right) {
        function score(profile) {
          let value = 0;

          if (profile.id === preferredProfileId) {
            value += 100;
          }

          if (profileMatchesDeviceHint(device, profile)) {
            value += 60;
          }

          if (profile.family === "generic" && profile.expectedInputChannels === device.inputChannels) {
            value += 40;
          }

          if (profile.expectedInputChannels === device.inputChannels) {
            value += 10;
          }

          return value;
        }

        return score(right) - score(left) || left.displayName.localeCompare(right.displayName);
      })[0];
  }

  function resolveDeviceAndProfile(preferredDeviceId, preferredProfileId) {
    let device = getDeviceById(preferredDeviceId);

    if (!device || !getProfilesForDevice(device).length) {
      device = state.devices.find(function (candidate) {
        return candidate.isDefault && getProfilesForDevice(candidate).length;
      }) || state.devices.find(function (candidate) {
        return getProfilesForDevice(candidate).length;
      }) || null;
    }

    return {
      device,
      profile: device ? chooseProfileForDevice(device, preferredProfileId) : null
    };
  }

  function getSupportedSampleRates(device, profile) {
    if (!device || !profile) {
      return [];
    }

    return profile.preferredSampleRates.filter(function (sampleRate) {
      return device.sampleRates.includes(sampleRate);
    });
  }

  function resolveSampleRate(device, profile, preferredRate) {
    if (!device || !profile) {
      return 48000;
    }

    const supportedRates = getSupportedSampleRates(device, profile);

    if (preferredRate && supportedRates.includes(preferredRate)) {
      return preferredRate;
    }

    if (device.defaultSampleRate && supportedRates.includes(device.defaultSampleRate)) {
      return device.defaultSampleRate;
    }

    return supportedRates[0] || device.sampleRates[0] || 48000;
  }

  function buildSequentialDefaults(channelCount) {
    return Array.from({ length: channelCount }, function (_, index) {
      return {
        usbChannel: index + 1,
        defaultLabel: "USB " + String(index + 1).padStart(2, "0")
      };
    });
  }

  function buildDraftTracks(profile, sourceTracks) {
    const defaults = Array.isArray(profile?.defaultTracks) && profile.defaultTracks.length
      ? profile.defaultTracks
      : buildSequentialDefaults(profile?.expectedInputChannels || 1);

    return defaults.map(function (defaultTrack) {
      const sourceTrack = Array.isArray(sourceTracks)
        ? sourceTracks.find(function (track) {
          return Number(track.usbChannel) === defaultTrack.usbChannel;
        })
        : null;

      return {
        usbChannel: defaultTrack.usbChannel,
        label: String(sourceTrack?.label || defaultTrack.defaultLabel || ("USB " + String(defaultTrack.usbChannel).padStart(2, "0"))).trim(),
        armed: sourceTrack?.armed !== false
      };
    });
  }

  function createDraftFromManifest(manifest) {
    return {
      title: String(manifest.title || DEFAULT_TITLE),
      deviceId: manifest.device.id,
      profileId: manifest.profile.id,
      storageTarget: manifest.storageTarget,
      sampleRate: manifest.format.sampleRate,
      tracks: manifest.tracks.map(function (track) {
        return {
          usbChannel: Number(track.usbChannel),
          label: String(track.label || "").trim() || ("USB " + String(track.usbChannel).padStart(2, "0")),
          armed: track.armed !== false
        };
      })
    };
  }

  function normalizeStorageTarget(value) {
    return ["server_local", "client_download"].includes(value) ? value : DEFAULT_STORAGE_TARGET;
  }

  function buildDraftForSelection(currentDraft, overrides) {
    const base = currentDraft || createDraftFromDefaults();
    const merged = {
      ...base,
      ...(overrides || {})
    };
    const resolution = resolveDeviceAndProfile(merged.deviceId, merged.profileId);
    const device = resolution.device;
    const profile = resolution.profile;

    if (!device || !profile) {
      return {
        title: String(merged.title || DEFAULT_TITLE).trim() || DEFAULT_TITLE,
        deviceId: "",
        profileId: "",
        storageTarget: normalizeStorageTarget(merged.storageTarget),
        sampleRate: Number.isFinite(merged.sampleRate) ? merged.sampleRate : 48000,
        tracks: [
          {
            usbChannel: 1,
            label: "Audio 01",
            armed: true
          }
        ]
      };
    }

    return {
      title: String(merged.title || DEFAULT_TITLE).trim() || DEFAULT_TITLE,
      deviceId: device.id,
      profileId: profile.id,
      storageTarget: normalizeStorageTarget(merged.storageTarget),
      sampleRate: resolveSampleRate(device, profile, merged.sampleRate),
      tracks: buildDraftTracks(profile, merged.tracks)
    };
  }

  function createDraftFromDefaults() {
    const query = getQueryOverrides();
    const stored = readStoredDefaults() || {};
    const draft = buildDraftForSelection({
      title: query.title || stored.title || DEFAULT_TITLE,
      deviceId: query.deviceId || stored.deviceId || "",
      profileId: query.profileId || stored.profileId || "",
      storageTarget: query.storageTarget || stored.storageTarget || DEFAULT_STORAGE_TARGET,
      sampleRate: query.sampleRate || stored.sampleRate || 48000,
      tracks: stored.tracks
    });

    persistDraftDefaults(draft);
    return draft;
  }

  function buildViewFromDraft(draft) {
    const device = getDeviceById(draft.deviceId);
    const profile = getProfileById(draft.profileId);

    return {
      id: null,
      title: draft.title,
      status: "draft",
      device: {
        id: device?.id || "",
        backend: device?.backend || "dummy",
        name: device?.name || "No device"
      },
      profile: {
        id: profile?.id || "",
        family: profile?.family || ""
      },
      storageTarget: draft.storageTarget,
      export: {
        status: "not_requested",
        archiveFile: null,
        downloadUrl: null
      },
      format: {
        sampleRate: draft.sampleRate,
        bitDepth: profile?.preferredBitDepth || 24,
        channelCount: profile?.expectedInputChannels || draft.tracks.length
      },
      durationFrames: 0,
      tracks: draft.tracks.map(function (track) {
        return {
          usbChannel: track.usbChannel,
          label: track.label,
          armed: track.armed !== false,
          lastPeakDbfs: -60,
          segments: []
        };
      })
    };
  }

  function getDisplayManifest() {
    if (state.manifest) {
      return state.manifest;
    }

    if (state.draft) {
      return buildViewFromDraft(state.draft);
    }

    return null;
  }

  function getSessionView() {
    return getDisplayManifest() || buildViewFromDraft(ensureDraftState());
  }

  function formatTimeLabel(totalSeconds) {
    const wholeSeconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const seconds = wholeSeconds % 60;

    if (hours > 0) {
      return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
    }

    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function formatElapsedClock(totalSeconds) {
    const wholeSeconds = Math.max(0, Math.floor(totalSeconds || 0));
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const seconds = wholeSeconds % 60;

    return [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      String(seconds).padStart(2, "0")
    ].join(":");
  }

  function formatRateLabel(sampleRate) {
    if (!Number.isFinite(sampleRate) || sampleRate < 1) {
      return "No rate";
    }

    if (sampleRate % 1000 === 0) {
      return String(sampleRate / 1000) + " kHz";
    }

    return String(sampleRate) + " Hz";
  }

  function formatChannelLabel(channelCount) {
    if (!Number.isFinite(channelCount) || channelCount < 1) {
      return "No channels";
    }

    return String(channelCount) + "ch";
  }

  function formatStorageTargetLabel(storageTarget) {
    return storageTarget === "client_download" ? "Client download" : "Server local";
  }

  function getProfileDisplayName(profileId) {
    return getProfileById(profileId)?.displayName || profileId || "No layout";
  }

  function getTrackPeakDbfs(track) {
    const livePeak = state.livePeaks.get(track?.usbChannel);

    if (Number.isFinite(livePeak)) {
      return livePeak;
    }

    if (Number.isFinite(track?.lastPeakDbfs)) {
      return track.lastPeakDbfs;
    }

    return -60;
  }

  function dbfsToMeterLevel(dbfs) {
    const normalized = clamp01(((Number.isFinite(dbfs) ? dbfs : -60) + 60) / 60);

    return Number(Math.pow(normalized, 1.45).toFixed(4));
  }

  function isClippedPeak(dbfs) {
    return Number.isFinite(dbfs) && dbfs >= CLIP_THRESHOLD_DBFS;
  }

  function getArmedTrackCount(view) {
    return (Array.isArray(view?.tracks) ? view.tracks : []).filter(function (track) {
      return track.armed !== false;
    }).length;
  }

  function getClippedTrackCount(view) {
    return (Array.isArray(view?.tracks) ? view.tracks : []).filter(function (track) {
      return track.armed !== false && isClippedPeak(getTrackPeakDbfs(track));
    }).length;
  }

  function getSessionElapsedSeconds(context) {
    const sampleRate = context.view?.format?.sampleRate || state.recorder.sampleRate || 48000;

    if (state.recorder.state === "recording" && state.recorder.sessionId && state.recorder.sessionId === context.view?.id) {
      return Math.max(
        state.recorder.durationSeconds || 0,
        Math.floor((state.liveDurationFrames || 0) / sampleRate)
      );
    }

    if (context.view?.durationFrames && sampleRate) {
      return Math.floor(context.view.durationFrames / sampleRate);
    }

    return 0;
  }

  function getSessionStatusDescriptor(context) {
    const status = context.view?.status || "draft";

    if (state.pendingAction === "stop" || state.recorder.state === "stopping") {
      return { label: "Stopping", tone: "stopping" };
    }

    if (state.recorder.state === "recording" && state.recorder.sessionId && state.recorder.sessionId === context.view?.id) {
      return { label: "Recording", tone: "recording" };
    }

    if (status === "failed") {
      return { label: "Failed", tone: "failed" };
    }

    if (status === "completed") {
      return { label: "Saved", tone: "saved" };
    }

    return { label: "Ready", tone: "ready" };
  }

  function getTrackStateDescriptor(track, context) {
    if (track.armed === false) {
      return { label: "Off", tone: "off" };
    }

    if (state.recorder.state === "recording" && state.recorder.sessionId && state.recorder.sessionId === context.view?.id) {
      return { label: "Rec", tone: "recording" };
    }

    if (context.view?.status === "completed") {
      return { label: "Saved", tone: "saved" };
    }

    if (context.view?.status === "failed") {
      return { label: "Warn", tone: "warn" };
    }

    return { label: "Ready", tone: "ready" };
  }

  function syncSelectedTrackIndex(trackCount) {
    if (!Number.isFinite(trackCount) || trackCount < 1) {
      state.selectedTrackIndex = 0;
      return;
    }

    state.selectedTrackIndex = Math.max(0, Math.min(trackCount - 1, state.selectedTrackIndex || 0));
  }

  function setSelectedTrackIndex(index, options) {
    const config = options || {};
    const trackCount = getSessionView()?.tracks?.length || state.draft?.tracks?.length || 0;
    const nextIndex = Math.max(0, Math.min(Math.max(trackCount - 1, 0), Number(index) || 0));

    if (nextIndex === state.selectedTrackIndex) {
      return;
    }

    state.selectedTrackIndex = nextIndex;

    if (config.render !== false) {
      renderApp();
    }
  }

  function buildTimeline(view) {
    const sampleRate = view?.format?.sampleRate || 48000;
    const activeDurationFrames = state.recorder.sessionId && view?.id === state.recorder.sessionId
      ? Math.max(
        state.liveDurationFrames || 0,
        Math.max(0, Math.floor((state.recorder.durationSeconds || 0) * sampleRate))
      )
      : 0;
    const manifestDurationFrames = view?.durationFrames || 0;
    const effectiveDurationFrames = Math.max(manifestDurationFrames, activeDurationFrames);
    const totalDurationSeconds = Math.max(
      DEFAULT_TIMELINE_SECONDS,
      Math.ceil(effectiveDurationFrames / sampleRate)
    );
    const majorStepSeconds = totalDurationSeconds > 30 * 60 ? 5 * 60 : 60;
    const majorLabels = [];

    for (let seconds = 0; seconds <= totalDurationSeconds; seconds += majorStepSeconds) {
      majorLabels.push(formatTimeLabel(seconds));
    }

    if (majorLabels[majorLabels.length - 1] !== formatTimeLabel(totalDurationSeconds)) {
      majorLabels.push(formatTimeLabel(totalDurationSeconds));
    }

    const columns = Math.max(12, majorLabels.length * 2);
    const totalFrames = Math.max(sampleRate, totalDurationSeconds * sampleRate);

    function frameToColumn(frame) {
      const normalized = Math.max(0, Math.min(totalFrames, frame));

      return Math.max(1, Math.min(columns, Math.floor((normalized / totalFrames) * columns) + 1));
    }

    const tracks = (Array.isArray(view?.tracks) ? view.tracks : []).map(function (track, index) {
      const color = index % 3 === 0 ? "indigo" : (index % 3 === 1 ? "blue" : "cyan");
      const peakDbfs = getTrackPeakDbfs(track);
      const liveWaveformPeaks = downsampleWaveformPeaks(
        state.liveWaveforms.get(track.usbChannel) || [],
        MAX_RENDER_WAVEFORM_BINS
      );
      const regions = (Array.isArray(track.segments) ? track.segments : []).map(function (segment) {
        const start = frameToColumn(segment.startFrame);
        const end = Math.max(start + 1, frameToColumn(segment.endFrame + 1));

        return {
          start,
          length: Math.max(1, Math.min(columns - start + 1, end - start)),
          live: false,
          waveformPeaks: downsampleWaveformPeaks(segment.waveformPeaks, MAX_RENDER_WAVEFORM_BINS)
        };
      });

      if (state.recorder.state === "recording" && state.recorder.sessionId === view?.id && track.armed) {
        const lastSegment = track.segments?.[track.segments.length - 1] || null;
        const liveStartFrame = lastSegment ? lastSegment.endFrame + 1 : 0;
        const liveEndFrame = Math.max(liveStartFrame + 1, effectiveDurationFrames);
        const liveStart = frameToColumn(liveStartFrame);
        const liveEnd = Math.max(liveStart + 1, frameToColumn(liveEndFrame));

        regions.push({
          start: liveStart,
          length: Math.max(1, Math.min(columns - liveStart + 1, liveEnd - liveStart)),
          live: true,
          waveformPeaks: liveWaveformPeaks
        });
      }

      return {
        usbChannel: track.usbChannel,
        label: track.label,
        armed: track.armed !== false,
        color,
        peakDbfs,
        meterLevel: dbfsToMeterLevel(peakDbfs),
        isClipped: isClippedPeak(peakDbfs),
        liveWaveformPeaks,
        regions
      };
    });

    return {
      columns,
      marks: majorLabels,
      playhead: Number(((effectiveDurationFrames / totalFrames) * columns).toFixed(3)),
      tracks
    };
  }

  function isDraftMode() {
    return !state.manifest;
  }

  function getWorkingDraft() {
    if (state.draft) {
      return clone(state.draft);
    }

    if (state.manifest) {
      return createDraftFromManifest(state.manifest);
    }

    return createDraftFromDefaults();
  }

  function getRenderContext() {
    const view = getSessionView();
    const editable = isDraftMode();
    const draft = editable ? getWorkingDraft() : null;
    const draftDevice = draft ? getDeviceById(draft.deviceId) : null;
    const draftProfile = draft ? getProfileById(draft.profileId) : null;

    return {
      view,
      editable,
      draft,
      draftDevice,
      draftProfile,
      draftRates: draft ? getSupportedSampleRates(draftDevice, draftProfile) : [],
      canRecord: !state.pendingAction && state.recorder.state !== "recording" && state.recorder.state !== "stopping",
      canStop: !state.pendingAction && state.recorder.state === "recording" && Boolean(state.recorder.sessionId)
    };
  }

  function resolveDraftState() {
    ensureDraftState();
    state.draft = buildDraftForSelection(state.draft);
    return state.draft;
  }

  function resetLiveAudioState() {
    state.livePeaks.clear();
    state.liveWaveforms.clear();
    state.liveDurationFrames = 0;
  }

  async function apiRequest(url, options) {
    const response = await fetch(url, {
      headers: {
        "content-type": "application/json"
      },
      ...options
    });
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const payload = isJson ? await response.json() : null;

    if (!response.ok) {
      const message = payload?.error?.message || ("Request failed with status " + response.status + ".");
      const error = new Error(message);

      error.code = payload?.error?.code || "REQUEST_FAILED";
      error.status = response.status;
      throw error;
    }

    return payload;
  }

  async function fetchBootstrapState() {
    const responses = await Promise.all([
      apiRequest("/api/v1/devices", { method: "GET" }),
      apiRequest("/api/v1/device-profiles", { method: "GET" }),
      apiRequest("/api/v1/recorder/state", { method: "GET" })
    ]);

    state.devices = responses[0].devices || [];
    state.profiles = responses[1].profiles || [];
    state.recorder = responses[2];
  }

  async function fetchSessionManifest(sessionId) {
    return apiRequest("/api/v1/sessions/" + encodeURIComponent(sessionId), {
      method: "GET"
    });
  }

  async function refreshSessionFromServer(sessionId, options) {
    const config = options || {};
    const previousSessionId = state.manifest?.id || null;

    try {
      state.manifest = await fetchSessionManifest(sessionId);
      state.sessionId = state.manifest.id;

      if (previousSessionId && previousSessionId !== state.manifest.id) {
        resetLiveAudioState();
      }

      if (config.route !== false) {
        replaceRoute(state.manifest.id);
      }
    } catch (error) {
      if (error.code !== "SESSION_NOT_FOUND") {
        throw error;
      }

      state.manifest = null;
      state.sessionId = null;
      resetLiveAudioState();

      if (config.route !== false) {
        replaceRoute(null);
      }
    }
  }

  async function syncServerState(sessionId) {
    await fetchBootstrapState();

    if (sessionId) {
      await refreshSessionFromServer(sessionId, { route: false });
    }
  }

  function triggerArchiveDownload(downloadUrl, fileName) {
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = fileName || "session.zip";
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function maybeAutoDownload(session) {
    if (!session || session.storageTarget !== "client_download") {
      return;
    }

    if (session.export?.status !== "ready" || !session.export.downloadUrl) {
      return;
    }

    if (state.autoDownloadRequestedSessionId !== session.id) {
      return;
    }

    if (state.autoDownloadedSessionId === session.id) {
      return;
    }

    state.autoDownloadedSessionId = session.id;
    state.autoDownloadRequestedSessionId = null;
    triggerArchiveDownload(session.export.downloadUrl, session.export.archiveFile);
  }

  function updateDocumentTitle(view) {
    const title = view?.title || DEFAULT_TITLE;

    document.title = title + " · Session";
  }

  function buildSettingsDropdown(config) {
    const menuId = "logic-settings-menu-" + config.kind;
    const optionsMarkup = config.options.length
      ? config.options.map(function (option) {
        const isSelected = option.value === config.currentValue;

        return [
          '      <button class="dropdown-select__option' + (isSelected ? " is-selected" : "") + '" type="button" role="option" aria-selected="' + String(isSelected) + '" data-setting-kind="' + escapeHtml(config.kind) + '" data-setting-value="' + escapeHtml(option.value) + '">',
          "        <span>" + escapeHtml(option.label) + "</span>",
          "      </button>"
        ].join("");
      }).join("")
      : '<div class="logic-settings-select__empty">No options available.</div>';

    return [
      '<label class="logic-settings-field">',
      '  <span class="logic-settings-field__label">' + escapeHtml(config.label) + "</span>",
      '  <div class="logic-settings-select dropdown-select" data-dropdown-select data-setting-kind="' + escapeHtml(config.kind) + '">',
      '    <button class="dropdown-select__trigger logic-settings-select__trigger" type="button" aria-expanded="false" aria-haspopup="listbox" aria-controls="' + escapeHtml(menuId) + '">',
      '      <span class="dropdown-select__value">' + escapeHtml(config.currentLabel) + "</span>",
      '      <span class="dropdown-select__chevron" aria-hidden="true"></span>',
      "    </button>",
      '    <div id="' + escapeHtml(menuId) + '" class="dropdown-select__menu logic-settings-select__menu" role="listbox">',
      optionsMarkup,
      "    </div>",
      "  </div>",
      "</label>"
    ].join("");
  }

  function buildSettingsStaticField(label, value) {
    return [
      '<div class="logic-settings-field">',
      '  <span class="logic-settings-field__label">' + escapeHtml(label) + "</span>",
      '  <div class="logic-settings-static">' + escapeHtml(value) + "</div>",
      "</div>"
    ].join("");
  }

  function renderWindowBar(context) {
    const status = getSessionStatusDescriptor(context);
    const elapsed = formatElapsedClock(getSessionElapsedSeconds(context));
    const recordClassName = [
      "logic-playground-minibar__action",
      "logic-playground-minibar__action--record",
      status.tone === "recording" ? "is-recording" : ""
    ].filter(Boolean).join(" ");

    elements.windowbar.innerHTML = [
      '<div class="logic-playground-minibar-stack logic-playground-minibar-stack--full">',
      '  <section class="logic-playground-minibar logic-playground-minibar--clock" aria-label="Session top app bar">',
      '    <div class="logic-playground-minibar__left">',
      '      <button class="logic-playground-minibar__action logic-playground-minibar__action--settings" type="button" data-open-settings title="Settings" aria-label="Settings">',
      '        <svg class="hero-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">',
      '          <path stroke-linecap="round" stroke-linejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 0 1 1.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 0 1-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.398.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 0 1-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 0 1 .12-1.45l.773-.773a1.125 1.125 0 0 1 1.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894Z" />',
      '          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />',
      "        </svg>",
      "      </button>",
      "    </div>",
      '    <div class="logic-playground-minibar__center">',
      '      <div class="logic-playground-minibar__display logic-playground-minibar__display--clock" aria-label="Time display">',
      '        <div class="logic-playground-minibar__display-top">',
      '          <span class="logic-playground-minibar__display-label">Time</span>',
      "        </div>",
      '        <strong class="logic-playground-minibar__time mono">' + escapeHtml(elapsed) + "</strong>",
      "      </div>",
      "    </div>",
      '    <div class="logic-playground-minibar__right">',
      '      <div class="logic-playground-minibar__transport">',
      '        <button class="' + recordClassName + '" type="button" data-transport-action="record" title="Record"' + (context.canRecord ? "" : " disabled") + '>',
      '          <svg class="hero-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">',
      '            <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />',
      "          </svg>",
      "        </button>",
      '        <button class="logic-playground-minibar__action logic-playground-minibar__action--stop" type="button" data-transport-action="stop" title="Stop"' + (context.canStop ? "" : " disabled") + '>',
      '          <svg class="hero-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">',
      '            <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" />',
      "          </svg>",
      "        </button>",
      "      </div>",
      "    </div>",
      "  </section>",
      "</div>"
    ].join("");
  }

  function renderSettingsModal(context) {
    if (!elements.modalRoot) {
      return;
    }

    if (!state.settingsOpen) {
      elements.modalRoot.innerHTML = "";
      return;
    }

    const bodyMarkup = context.editable
      ? [
        buildSettingsDropdown({
          kind: "device",
          label: "Device",
          currentValue: context.draft.deviceId,
          currentLabel: context.draftDevice?.name || "Select device",
          options: state.devices.map(function (device) {
            return {
              value: device.id,
              label: device.name + " · " + String(device.inputChannels) + "ch"
            };
          })
        }),
        buildSettingsDropdown({
          kind: "profile",
          label: "Layout",
          currentValue: context.draft.profileId,
          currentLabel: context.draftProfile?.displayName || "Select layout",
          options: getProfilesForDevice(context.draftDevice).map(function (profile) {
            return {
              value: profile.id,
              label: profile.displayName
            };
          })
        }),
        buildSettingsDropdown({
          kind: "sampleRate",
          label: "Rate",
          currentValue: String(context.draft.sampleRate),
          currentLabel: context.draft.sampleRate ? (String(context.draft.sampleRate) + " Hz") : "Select rate",
          options: context.draftRates.map(function (sampleRate) {
            return {
              value: String(sampleRate),
              label: String(sampleRate) + " Hz"
            };
          })
        })
      ].join("")
      : [
        '<div class="logic-settings-dialog__notice">Settings are locked after a session has been prepared or recorded.</div>',
        buildSettingsStaticField("Device", context.view?.device?.name || "Unknown"),
        buildSettingsStaticField("Layout", getProfileDisplayName(context.view?.profile?.id)),
        buildSettingsStaticField("Rate", formatRateLabel(context.view?.format?.sampleRate))
      ].join("");

    elements.modalRoot.innerHTML = [
      '<div class="logic-settings-modal" data-settings-overlay>',
      '  <section class="logic-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="logic-settings-title">',
      '    <header class="logic-settings-dialog__header">',
      '      <div class="logic-settings-dialog__copy">',
      '        <h2 id="logic-settings-title">Session Settings</h2>',
      '        <p>' + escapeHtml(context.editable ? "Select the input device, channel layout, and sample rate before recording." : "Current session configuration is shown below.") + '</p>',
      "      </div>",
      '      <button class="logic-settings-dialog__close" type="button" data-close-settings aria-label="Close settings">Close</button>',
      "    </header>",
      '    <div class="logic-settings-dialog__body">',
      bodyMarkup,
      "    </div>",
      '    <footer class="logic-settings-dialog__footer">',
      '      <button class="logic-settings-dialog__done" type="button" data-close-settings>Done</button>',
      "    </footer>",
      "  </section>",
      "</div>"
    ].join("");
  }

  function renderArrangeCorner() {
    elements.arrangeCorner.innerHTML = '<span class="logic-playground-corner-note">Timeline</span>';
  }

  function renderRuler(timeline) {
    elements.ruler.style.setProperty("--logic-columns", String(timeline.columns));
    elements.ruler.style.setProperty("--logic-playhead", String(timeline.playhead || 0));
    elements.ruler.innerHTML = '<div class="logic-ruler__grid">' + Array.from({ length: timeline.columns }, function (_, index) {
      const labelIndex = Math.floor(index / 2);
      const label = index % 2 === 0 && labelIndex < timeline.marks.length ? timeline.marks[labelIndex] : "";

      return [
        '<div class="logic-ruler__cell">',
        label ? '  <span class="logic-ruler__label">' + escapeHtml(label) + "</span>" : "",
        "</div>"
      ].join("");
    }).join("") + "</div>";
  }

  function renderTrackHeaders(timeline, context) {
    elements.trackHeaders.innerHTML = timeline.tracks.map(function (track, index) {
      const selectedClassName = index === state.selectedTrackIndex ? " is-selected" : "";
      const sliderValue = clamp01(track.meterLevel);

      return [
        '<article class="logic-track-header logic-track-header--session' + selectedClassName + '" data-track-row="' + String(index) + '">',
        '  <div class="logic-track-strip__index">' + escapeHtml(String(index + 1)) + "</div>",
        '  <div class="logic-track-strip__body logic-playground-track-strip__body--logic">',
        '    <div class="logic-playground-track-strip__name-area">',
        context.editable
          ? [
            '      <div class="logic-track-name logic-track-name--session" data-track-name-editor data-track-index="' + String(index) + '">',
            '        <button class="logic-track-name__display logic-track-name__display--session logic-playground-track-strip__name" type="button" data-track-name-display>' + escapeHtml(track.label) + "</button>",
            '        <input class="logic-track-name__input logic-track-name__input--session logic-playground-track-strip__name-input" type="text" value="' + escapeHtml(track.label) + '" data-track-name-input hidden>',
            "      </div>"
          ].join("")
          : '<div class="logic-track-name__display logic-track-name__display--session logic-playground-track-strip__name logic-track-field-static">' + escapeHtml(track.label) + "</div>",
        "    </div>",
        '    <div class="logic-playground-strip-slider logic-playground-strip-slider--wide logic-playground-strip-slider--readonly" style="--logic-slider-value:' + sliderValue.toFixed(3) + ';" aria-hidden="true">',
        '      <span class="logic-playground-strip-slider__track"></span>',
        "    </div>",
        "  </div>",
        "</article>"
      ].join("");
    }).join("");
  }

  function buildRegionMarkup(track, region) {
    const intensity = Math.max(0.16, Math.min(1, (60 + track.peakDbfs) / 60));

    return [
      '<article class="logic-region logic-region--display logic-region--' + escapeHtml(track.color) + (region.live ? " is-live" : "") + (track.isSelected ? " is-selected" : "") + '" style="grid-column:' + String(region.start) + " / span " + String(region.length) + ";--logic-live-intensity:" + intensity.toFixed(2) + ';">',
      buildWaveformMarkup(region.waveformPeaks, "logic-region__wave"),
      "</article>"
    ].join("");
  }

  function buildAudioDisplay(track) {
    const intensity = Math.max(0.14, Math.min(1, (60 + track.peakDbfs) / 60));
    const classNames = [
      "logic-audio-display",
      "logic-audio-display--empty",
      track.armed ? "is-armed" : "is-off",
      track.isSelected ? "is-selected" : ""
    ].join(" ");

    return [
      '<div class="' + classNames + '" style="grid-column:1 / -1;--logic-live-intensity:' + intensity.toFixed(2) + ';">',
      buildWaveformMarkup(track.liveWaveformPeaks, "logic-audio-display__wave"),
      "</div>"
    ].join("");
  }

  function buildWaveformMarkup(peaks, className) {
    const bins = downsampleWaveformPeaks(peaks, MAX_RENDER_WAVEFORM_BINS);
    const normalizedBins = bins.length ? bins : new Array(32).fill(0.05);

    return [
      '<div class="' + className + '" aria-hidden="true">',
      normalizedBins.map(function (peak) {
        return '<span class="logic-waveform__bar" style="--logic-wave-height:' + clamp01(peak).toFixed(4) + ';"></span>';
      }).join(""),
      "</div>"
    ].join("");
  }

  function getWaveformPlaylistFactory() {
    return window.WaveformPlaylist || null;
  }

  function getWaveSurferFactory() {
    return window.WaveSurfer || null;
  }

  function getSegmentUrl(sessionId, usbChannel, segmentIndex) {
    return "/api/v1/sessions/" + encodeURIComponent(sessionId) + "/tracks/" + String(usbChannel) + "/segments/" + String(segmentIndex);
  }

  function getPreviewTracks(view) {
    return (Array.isArray(view?.tracks) ? view.tracks : []).filter(function (track) {
      return track.armed !== false && Array.isArray(track.segments) && track.segments.length;
    });
  }

  function getPlaylistSources(view) {
    return getPreviewTracks(view).slice(0, 8).map(function (track) {
      const segment = track.segments[0];

      return {
        src: getSegmentUrl(view.id, track.usbChannel, segment.index),
        name: track.label,
        start: Math.max(0, Math.floor((segment.startFrame || 0) / (view.format?.sampleRate || 48000))),
        gain: 1
      };
    });
  }

  function getSelectedTrackWithAudio(view) {
    const tracks = getPreviewTracks(view);
    const selectedTrack = Array.isArray(view?.tracks) ? view.tracks[state.selectedTrackIndex] : null;

    if (selectedTrack && Array.isArray(selectedTrack.segments) && selectedTrack.segments.length) {
      return selectedTrack;
    }

    return tracks[0] || null;
  }

  function destroyWaveformPlaylist() {
    if (!state.waveformPlaylist) {
      state.previewKey = "";
      return;
    }

    try {
      state.waveformPlaylist.stop?.();
      state.waveformPlaylist.clear?.();
    } catch (error) {
      void error;
    }

    state.waveformPlaylist = null;
    state.previewKey = "";
  }

  function destroyWaveformDetail() {
    if (!state.waveformDetail) {
      state.detailPreviewKey = "";
      return;
    }

    try {
      state.waveformDetail.destroy?.();
    } catch (error) {
      void error;
    }

    state.waveformDetail = null;
    state.detailPreviewKey = "";
  }

  function destroyPreviewMedia() {
    destroyWaveformPlaylist();
    destroyWaveformDetail();
  }

  function renderPreviewPanel(context) {
    if (!elements.preview) {
      return;
    }

    const view = context.view;
    const availableTracks = getPreviewTracks(view);

    if (context.editable || !view?.id || !availableTracks.length) {
      destroyPreviewMedia();
      elements.preview.className = "logic-preview logic-preview--empty";
      elements.preview.innerHTML = [
        '<div class="logic-preview__empty">',
        "  <strong>Saved audio preview will appear here.</strong>",
        '  <p>' + escapeHtml(context.editable
          ? "Start and stop a recording to load multitrack overview and selected-track waveform previews."
          : "Preview becomes available after at least one track segment has been saved.") + "</p>",
        "</div>"
      ].join("");
      return;
    }

    const selectedTrack = getSelectedTrackWithAudio(view);
    const totalPreviewTracks = availableTracks.length;
    const displayedTracks = Math.min(totalPreviewTracks, 8);
    const latestSegment = selectedTrack?.segments?.[selectedTrack.segments.length - 1] || null;
    const latestSegmentSeconds = latestSegment
      ? Math.max(0, Math.floor(((latestSegment.endFrame || 0) - (latestSegment.startFrame || 0)) / (view.format?.sampleRate || 48000)))
      : 0;

    elements.preview.className = "logic-preview";
    elements.preview.innerHTML = [
      '<div class="logic-preview__column logic-preview__column--playlist">',
      '  <div class="logic-preview__head">',
      "    <div>",
      "      <h3>Multitrack Overview</h3>",
      '      <p>' + escapeHtml("waveform-playlist · showing " + String(displayedTracks) + " of " + String(totalPreviewTracks) + " armed tracks") + "</p>",
      "    </div>",
      "  </div>",
      '  <div id="logic-playlist-preview" class="logic-preview__playlist"></div>',
      "</div>",
      '<div class="logic-preview__column logic-preview__column--detail">',
      '  <div class="logic-preview__head">',
      "    <div>",
      "      <h3>Selected Track Detail</h3>",
      '      <p>' + escapeHtml((selectedTrack?.label || "No track") + (latestSegment ? " · latest segment " + String(latestSegment.index) + " · " + String(latestSegmentSeconds) + "s" : "")) + "</p>",
      "    </div>",
      "  </div>",
      '  <div id="logic-detail-wave" class="logic-preview__detail-wave"></div>',
      "</div>"
    ].join("");

    const token = ++state.previewToken;
    window.requestAnimationFrame(function () {
      syncPreviewMedia(context, token).catch(function () {
      });
    });
  }

  async function syncPreviewMedia(context, token) {
    const view = context.view;
    const playlistFactory = getWaveformPlaylistFactory();
    const waveSurferFactory = getWaveSurferFactory();
    const playlistContainer = document.getElementById("logic-playlist-preview");
    const detailContainer = document.getElementById("logic-detail-wave");

    if (token !== state.previewToken || !playlistContainer || !detailContainer) {
      return;
    }

    const playlistSources = getPlaylistSources(view);
    const playlistKey = JSON.stringify(playlistSources.map(function (item) {
      return [item.src, item.name, item.start];
    }));

    if (playlistFactory && playlistSources.length && state.previewKey !== playlistKey) {
      destroyWaveformPlaylist();
      const playlist = playlistFactory({
        samplesPerPixel: 2200,
        mono: true,
        waveHeight: 40,
        container: playlistContainer,
        state: "cursor",
        timescale: true,
        seekStyle: "line",
        controls: {
          show: false,
          width: 0
        },
        colors: {
          waveOutlineColor: "#9ecbff",
          timeColor: "#7f8a96",
          fadeColor: "#0e639c"
        },
        zoomLevels: [1024, 2048, 4096]
      });

      state.waveformPlaylist = playlist;
      state.previewKey = playlistKey;

      try {
        await playlist.load(playlistSources);
      } catch (error) {
        destroyWaveformPlaylist();
        playlistContainer.innerHTML = '<div class="logic-preview__message">Unable to decode multitrack preview.</div>';
      }
    }

    if (token !== state.previewToken) {
      return;
    }

    const selectedTrack = getSelectedTrackWithAudio(view);
    const selectedSegment = selectedTrack?.segments?.[selectedTrack.segments.length - 1] || null;
    const detailKey = selectedTrack && selectedSegment
      ? [view.id, selectedTrack.usbChannel, selectedSegment.index].join(":")
      : "";

    if (!waveSurferFactory || !selectedTrack || !selectedSegment) {
      destroyWaveformDetail();
      detailContainer.innerHTML = '<div class="logic-preview__message">No track segment is available for detailed preview.</div>';
      return;
    }

    if (state.detailPreviewKey === detailKey && state.waveformDetail) {
      return;
    }

    destroyWaveformDetail();
    detailContainer.innerHTML = "";

    const wavesurfer = waveSurferFactory.create({
      container: detailContainer,
      url: getSegmentUrl(view.id, selectedTrack.usbChannel, selectedSegment.index),
      waveColor: "#5ea6ff",
      progressColor: "#9cd4ff",
      cursorColor: "#f14c4c",
      height: 124,
      normalize: true,
      autoScroll: true,
      barWidth: 2,
      barGap: 1,
      dragToSeek: true
    });

    state.waveformDetail = wavesurfer;
    state.detailPreviewKey = detailKey;
    wavesurfer.on("error", function () {
      detailContainer.innerHTML = '<div class="logic-preview__message">Unable to decode selected track preview.</div>';
      destroyWaveformDetail();
    });
  }

  function renderTrackLanes(timeline) {
    elements.trackLanes.classList.toggle("is-empty", !timeline.tracks.length);
    elements.trackLanes.classList.add("logic-playground-track-lanes");
    elements.trackLanes.style.setProperty("--logic-columns", String(timeline.columns));
    elements.trackLanes.style.setProperty("--logic-playhead", String(timeline.playhead || 0));
    elements.trackLanes.innerHTML = timeline.tracks.map(function (track, index) {
      const content = track.regions.length
        ? track.regions.map(function (region) {
          return buildRegionMarkup(track, region);
        }).join("")
        : buildAudioDisplay(track);

      return [
        '<div class="logic-track-lane logic-track-lane--session' + (index === state.selectedTrackIndex ? " is-selected" : "") + '" data-track-row="' + String(index) + '">',
        '  <div class="logic-track-lane__grid">',
        content,
        "  </div>",
        "</div>"
      ].join("");
    }).join("");
  }

  function renderChrome(context) {
    renderWindowBar(context);
    renderSettingsModal(context);
  }

  function renderApp() {
    const previousScrollTop = getTrackScrollTop();
    const context = getRenderContext();
    const timeline = buildTimeline(context.view);
    syncSelectedTrackIndex(timeline.tracks.length);

    timeline.tracks = timeline.tracks.map(function (track, index) {
      return {
        ...track,
        isSelected: index === state.selectedTrackIndex
      };
    });

    updateDocumentTitle(context.view);
    renderChrome(context);
    renderArrangeCorner();
    renderRuler(timeline);
    renderTrackHeaders(timeline, context);
    renderTrackLanes(timeline);
    renderPreviewPanel(context);
    restoreTrackScroll(previousScrollTop);
  }

  function remapTrackInputs(tracks, targetIndex, nextUsbChannel) {
    const requestedChannel = Number.parseInt(nextUsbChannel, 10);

    if (!Number.isFinite(requestedChannel)) {
      return tracks;
    }

    const previousChannel = tracks[targetIndex]?.usbChannel;
    const duplicateIndex = tracks.findIndex(function (track, index) {
      return index !== targetIndex && track.usbChannel === requestedChannel;
    });

    return tracks.map(function (track, index) {
      if (index === targetIndex) {
        return {
          ...track,
          usbChannel: requestedChannel
        };
      }

      if (index === duplicateIndex && Number.isFinite(previousChannel)) {
        return {
          ...track,
          usbChannel: previousChannel
        };
      }

      return track;
    });
  }

  function updateDraftTrackInput(index, nextValue) {
    if (!state.draft || !state.draft.tracks[index]) {
      return;
    }

    setDraftState({
      ...state.draft,
      tracks: remapTrackInputs(state.draft.tracks, index, nextValue)
    });
  }

  function commitTrackName(index, input, cancel) {
    if (!state.draft || !state.draft.tracks[index]) {
      return;
    }

    const nextValue = cancel
      ? state.draft.tracks[index].label
      : String(input.value || "").trim() || ("USB " + String(state.draft.tracks[index].usbChannel).padStart(2, "0"));

    setDraftState({
      ...state.draft,
      tracks: state.draft.tracks.map(function (track, trackIndex) {
        if (trackIndex !== index) {
          return track;
        }

        return {
          ...track,
          label: nextValue
        };
      })
    });
  }

  function setDraftState(nextDraft, options) {
    const config = options || {};

    state.draft = buildDraftForSelection(state.draft, nextDraft);
    persistDraftDefaults(state.draft);

    if (config.render !== false) {
      renderApp();
    }
  }

  function setSettingsOpen(isOpen) {
    state.settingsOpen = Boolean(isOpen);

    if (!state.settingsOpen) {
      closeAllDropdowns();
    }

    renderSettingsModal(getRenderContext());
  }

  function applyWindowbarSetting(kind, value) {
    if (!state.draft || !isDraftMode()) {
      return;
    }

    if (kind === "device") {
      setDraftState({
        ...state.draft,
        deviceId: value,
        profileId: "",
        sampleRate: null
      });
      return;
    }

    if (kind === "profile") {
      setDraftState({
        ...state.draft,
        profileId: value,
        sampleRate: null
      });
      return;
    }

    if (kind === "sampleRate") {
      setDraftState({
        ...state.draft,
        sampleRate: Number.parseInt(value, 10) || state.draft.sampleRate
      });
    }
  }

  function closeAllDropdowns(except) {
    document.querySelectorAll("[data-dropdown-select]").forEach(function (dropdown) {
      if (dropdown === except) {
        return;
      }

      dropdown.classList.remove("is-open");
      dropdown.querySelector(".dropdown-select__trigger")?.setAttribute("aria-expanded", "false");
      });
  }

  function bindDropdownChrome() {
    document.addEventListener("click", function (event) {
      const target = event.target;

      if (!(target instanceof Element)) {
        closeAllDropdowns();
        return;
      }

      const trigger = target.closest(".dropdown-select__trigger");

      if (trigger) {
        const dropdown = trigger.closest("[data-dropdown-select]");
        const willOpen = !dropdown.classList.contains("is-open");

        closeAllDropdowns(dropdown);
        dropdown.classList.toggle("is-open", willOpen);
        trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
        return;
      }

      if (!target.closest("[data-dropdown-select]")) {
        closeAllDropdowns();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeAllDropdowns();
      }
    });
  }

  function bindTrackHeaderInteractions() {
    elements.trackHeaders.addEventListener("click", function (event) {
      const target = event.target;
      const row = target instanceof Element ? target.closest("[data-track-row]") : null;
      const rowIndex = Number.parseInt(row?.getAttribute("data-track-row") || "", 10);
      const requestsFocusedEdit = target instanceof Element && Boolean(target.closest(".dropdown-select__trigger, [data-track-name-display]"));

      if (Number.isFinite(rowIndex)) {
        const wasSelected = rowIndex === state.selectedTrackIndex;

        setSelectedTrackIndex(rowIndex, { render: false });

        if (!wasSelected) {
          renderApp();

          if (requestsFocusedEdit) {
            return;
          }
        }
      }

      if (!(target instanceof Element) || !state.draft) {
        return;
      }

      const option = target.closest("[data-input-option]");

      if (option) {
        updateDraftTrackInput(
          Number.parseInt(option.getAttribute("data-track-index") || "", 10),
          option.getAttribute("data-input-option") || ""
        );
        closeAllDropdowns();
        return;
      }

      const nameDisplay = target.closest("[data-track-name-display]");

      if (nameDisplay) {
        const container = nameDisplay.closest("[data-track-name-editor]");
        const input = container?.querySelector("[data-track-name-input]");

        if (!container || !input) {
          return;
        }

        container.classList.add("is-editing");
        nameDisplay.hidden = true;
        input.hidden = false;
        input.focus();
        input.select();
      }
    });

    elements.trackHeaders.addEventListener("keydown", function (event) {
      const target = event.target;

      if (!(target instanceof HTMLInputElement) || !target.matches("[data-track-name-input]")) {
        return;
      }

      const container = target.closest("[data-track-name-editor]");
      const index = Number.parseInt(container?.getAttribute("data-track-index") || "", 10);

      if (event.key === "Enter") {
        commitTrackName(index, target, false);
        event.preventDefault();
        return;
      }

      if (event.key === "Escape") {
        commitTrackName(index, target, true);
        event.preventDefault();
      }
    });

    elements.trackHeaders.addEventListener("blur", function (event) {
      const target = event.target;

      if (!(target instanceof HTMLInputElement) || !target.matches("[data-track-name-input]")) {
        return;
      }

      const container = target.closest("[data-track-name-editor]");
      const index = Number.parseInt(container?.getAttribute("data-track-index") || "", 10);

      commitTrackName(index, target, false);
    }, true);
  }

  function bindTrackLaneInteractions() {
    elements.trackLanes.addEventListener("click", function (event) {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const row = target.closest("[data-track-row]");

      if (!row) {
        return;
      }

      setSelectedTrackIndex(Number.parseInt(row.getAttribute("data-track-row") || "", 10));
    });
  }

  function bindSettingsInteractions() {
    elements.windowbar.addEventListener("click", function (event) {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest("[data-open-settings]")) {
        setSettingsOpen(true);
        return;
      }

      if (target.closest("[data-download-archive]") && state.manifest?.export?.downloadUrl) {
        triggerArchiveDownload(state.manifest.export.downloadUrl, state.manifest.export.archiveFile);
        return;
      }
    });

    elements.modalRoot?.addEventListener("click", function (event) {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest("[data-close-settings]")) {
        setSettingsOpen(false);
        return;
      }

      if (target.matches("[data-settings-overlay]")) {
        setSettingsOpen(false);
        return;
      }

      const option = target.closest("[data-setting-kind][data-setting-value]");

      if (!option) {
        return;
      }

      applyWindowbarSetting(
        option.getAttribute("data-setting-kind") || "",
        option.getAttribute("data-setting-value") || ""
      );
      closeAllDropdowns();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !state.settingsOpen) {
        return;
      }

      setSettingsOpen(false);
    });
  }

  function bindTrackResizer() {
    const handles = Array.from(document.querySelectorAll("[data-track-resizer]"));
    let dragState = null;

    if (!elements.root || !handles.length) {
      return;
    }

    function readWidth() {
      const cssWidth = Number.parseFloat(getComputedStyle(elements.root).getPropertyValue("--logic-sidebar-width"));

      if (Number.isFinite(cssWidth)) {
        return cssWidth;
      }

      return 320;
    }

    function updateAria(width) {
      handles.forEach(function (handle) {
        if (handle.getAttribute("role") === "separator") {
          handle.setAttribute("aria-valuenow", String(Math.round(width)));
        }
      });
    }

    function setWidth(width) {
      const nextWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, width));

      elements.root.style.setProperty("--logic-sidebar-width", String(nextWidth) + "px");
      updateAria(nextWidth);

      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(Math.round(nextWidth)));
      } catch (error) {
        void error;
      }
    }

    function stopDrag(event) {
      if (!dragState) {
        return;
      }

      if (dragState.handle?.hasPointerCapture?.(dragState.pointerId)) {
        dragState.handle.releasePointerCapture(dragState.pointerId);
      }

      dragState = null;
      elements.root.classList.remove("is-resizing");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);

      if (event) {
        event.preventDefault();
      }
    }

    function onPointerMove(event) {
      if (!dragState) {
        return;
      }

      setWidth(dragState.startWidth + (event.clientX - dragState.startX));
    }

    const savedWidth = Number.parseInt(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) || "", 10);

    if (Number.isFinite(savedWidth)) {
      setWidth(savedWidth);
    } else {
      updateAria(readWidth());
    }

    handles.forEach(function (handle) {
      handle.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) {
          return;
        }

        dragState = {
          handle: handle,
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: readWidth()
        };

        elements.root.classList.add("is-resizing");
        handle.setPointerCapture?.(event.pointerId);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", stopDrag);
        window.addEventListener("pointercancel", stopDrag);
        event.preventDefault();
      });

      handle.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
          return;
        }

        const step = event.shiftKey ? 24 : 12;
        const direction = event.key === "ArrowLeft" ? -1 : 1;

        setWidth(readWidth() + (step * direction));
        event.preventDefault();
      });
    });
  }

  function bindScrollSync() {
    let syncing = false;

    function sync(source, target) {
      if (syncing) {
        return;
      }

      syncing = true;
      target.scrollTop = source.scrollTop;
      window.requestAnimationFrame(function () {
        syncing = false;
      });
    }

    elements.trackLanes.addEventListener("scroll", function () {
      sync(elements.trackLanes, elements.trackHeaders);
    });

    elements.trackHeaders.addEventListener("scroll", function () {
      sync(elements.trackHeaders, elements.trackLanes);
    });

    elements.trackHeaders.addEventListener("wheel", function (event) {
      if (!elements.trackLanes) {
        return;
      }

      elements.trackLanes.scrollTop += event.deltaY;
      elements.trackLanes.scrollLeft += event.deltaX;
      event.preventDefault();
    }, { passive: false });
  }

  async function handleRecord() {
    if (state.pendingAction) {
      return;
    }

    setSettingsOpen(false);
    resetLiveAudioState();
    state.pendingAction = "record";
    renderChrome(getRenderContext());

    try {
      let sessionId = state.manifest?.status === "prepared" ? state.manifest.id : null;

      if (!sessionId) {
        await fetchBootstrapState();
        const draft = buildDraftForSelection(getWorkingDraft());

        state.draft = draft;
        persistDraftDefaults(draft);
        renderApp();

        if (!draft.deviceId || !draft.profileId) {
          throw new Error("No compatible recorder device/profile is available. Open Settings and choose a valid device/layout.");
        }

        const prepared = await apiRequest("/api/v1/sessions/prepare", {
          method: "POST",
          body: JSON.stringify({
            title: draft.title,
            deviceId: draft.deviceId,
            profileId: draft.profileId,
            storageTarget: draft.storageTarget,
            sampleRate: draft.sampleRate,
            tracks: draft.tracks
          })
        });

        sessionId = prepared.session.id;
        pushRoute(sessionId);
        await syncServerState(sessionId);
      }

      await apiRequest("/api/v1/recorder/start", {
        method: "POST",
        body: JSON.stringify({
          sessionId
        })
      });

      await syncServerState(sessionId);
      ensurePolling();
      renderApp();
    } catch (error) {
      window.alert(error.message || "Unable to start recording.");
    } finally {
      state.pendingAction = null;
      renderChrome(getRenderContext());
    }
  }

  async function handleStop() {
    if (state.pendingAction || !state.recorder.sessionId) {
      return;
    }

    state.pendingAction = "stop";
    state.autoDownloadRequestedSessionId = getActiveSessionId();
    renderChrome(getRenderContext());

    try {
      await apiRequest("/api/v1/recorder/stop", {
        method: "POST",
        body: JSON.stringify({
          sessionId: getActiveSessionId()
        })
      });

      await syncServerState(getActiveSessionId());
      maybeAutoDownload(state.manifest);
      ensurePolling();
      renderApp();
    } catch (error) {
      window.alert(error.message || "Unable to stop recording.");
    } finally {
      state.pendingAction = null;
      renderChrome(getRenderContext());
    }
  }

  function bindTransport() {
    elements.windowbar.addEventListener("click", function (event) {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const button = target.closest("[data-transport-action]");

      if (!button) {
        return;
      }

      if (button.getAttribute("data-transport-action") === "record") {
        handleRecord();
        return;
      }

      if (button.getAttribute("data-transport-action") === "stop") {
        handleStop();
      }
    });
  }

  async function refreshCurrentRouteSession(options) {
    const routeSessionId = getCurrentPathSessionId();

    if (routeSessionId) {
      await refreshSessionFromServer(routeSessionId, { route: false });

      if (!state.manifest) {
        replaceRoute(null);
      }

      return;
    }

    if (state.recorder.sessionId) {
      await refreshSessionFromServer(state.recorder.sessionId, { route: false });

      if (state.manifest) {
        replaceRoute(state.manifest.id);
        return;
      }
    }

    state.sessionId = null;
    state.manifest = null;
    resetLiveAudioState();
    resolveDraftState();
    replaceRoute(null);
  }

  function ensurePolling() {
    const shouldPoll = state.recorder.state === "recording" && state.recorder.sessionId && state.manifest && state.manifest.id === state.recorder.sessionId;

    if (shouldPoll && !state.pollingTimer) {
      state.pollingTimer = window.setInterval(function () {
        refreshSessionSnapshot().catch(function () {
        });
      }, POLL_INTERVAL_MS);
      return;
    }

    if (!shouldPoll && state.pollingTimer) {
      window.clearInterval(state.pollingTimer);
      state.pollingTimer = null;
    }
  }

  async function refreshSessionSnapshot() {
    const targetSessionId = getActiveSessionId();

    if (!targetSessionId) {
      return;
    }

    await syncServerState(targetSessionId);
    ensurePolling();
    renderApp();
  }

  function scheduleRefresh(delayMs) {
    if (state.refreshTimer) {
      return;
    }

    state.refreshTimer = window.setTimeout(function () {
      state.refreshTimer = null;
      refreshSessionSnapshot().catch(function () {
      });
    }, delayMs);
  }

  function handleWebSocketMessage(message) {
    if (message.type === "recorder_state_changed") {
      state.recorder = message.recorder || state.recorder;

      if (state.recorder.state !== "recording") {
        resetLiveAudioState();
      }

      ensurePolling();

      if (state.recorder.sessionId && state.recorder.sessionId !== state.manifest?.id) {
        scheduleRefresh(100);
      } else {
        renderChrome(getRenderContext());
      }

      return;
    }

      if (message.type === "meter_update") {
      if (!message.sessionId || message.sessionId !== getActiveSessionId()) {
        return;
      }

      if (Number.isFinite(message.durationFrames)) {
        state.liveDurationFrames = Math.max(state.liveDurationFrames, message.durationFrames);

        if (message.sampleRate) {
          state.recorder.sampleRate = message.sampleRate;
        }

        if (state.recorder.sampleRate) {
          state.recorder.durationSeconds = Math.max(
            state.recorder.durationSeconds || 0,
            Math.floor(state.liveDurationFrames / state.recorder.sampleRate)
          );
        }
      }

      (message.channels || []).forEach(function (channel) {
        state.livePeaks.set(channel.usbChannel, channel.peakDbfs);
        state.liveWaveforms.set(
          channel.usbChannel,
          appendWaveformPeaks(
            state.liveWaveforms.get(channel.usbChannel),
            downsampleWaveformPeaks(channel.waveformPeaks, 24),
            MAX_LIVE_WAVEFORM_BINS
          )
        );
      });

      const scrollTop = getTrackScrollTop();
      const timeline = buildTimeline(getSessionView());
      const context = getRenderContext();
      const currentColumns = Number.parseInt(elements.ruler.style.getPropertyValue("--logic-columns") || "", 10);

      syncSelectedTrackIndex(timeline.tracks.length);
      timeline.tracks = timeline.tracks.map(function (track, index) {
        return {
          ...track,
          isSelected: index === state.selectedTrackIndex
        };
      });

      if (currentColumns !== timeline.columns) {
        renderRuler(timeline);
      } else {
        elements.ruler.style.setProperty("--logic-playhead", String(timeline.playhead || 0));
      }

      renderWindowBar(context);
      renderTrackHeaders(timeline, context);
      renderTrackLanes(timeline);
      restoreTrackScroll(scrollTop);
      return;
    }

    if (message.type === "drop_event" || message.type === "session_completed") {
      scheduleRefresh(150);
    }
  }

  function connectWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(protocol + "//" + window.location.host + "/ws");

    state.websocket = socket;
    socket.addEventListener("message", function (event) {
      try {
        handleWebSocketMessage(JSON.parse(event.data));
      } catch (error) {
        void error;
      }
    });

    socket.addEventListener("close", function () {
      state.websocket = null;

      if (state.disposed) {
        return;
      }

      if (state.reconnectTimer) {
        window.clearTimeout(state.reconnectTimer);
      }

      state.reconnectTimer = window.setTimeout(function () {
        state.reconnectTimer = null;
        connectWebSocket();
      }, 1000);
    });
  }

  function cleanupRuntime() {
    state.disposed = true;
    destroyPreviewMedia();

    if (state.pollingTimer) {
      window.clearInterval(state.pollingTimer);
      state.pollingTimer = null;
    }

    if (state.refreshTimer) {
      window.clearTimeout(state.refreshTimer);
      state.refreshTimer = null;
    }

    if (state.reconnectTimer) {
      window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    if (state.websocket && state.websocket.readyState < WebSocket.CLOSING) {
      state.websocket.close();
    }
  }

  async function bootstrap() {
    bindTransport();
    bindDropdownChrome();
    bindTrackResizer();
    bindScrollSync();
    bindTrackHeaderInteractions();
    bindTrackLaneInteractions();
    bindSettingsInteractions();
    connectWebSocket();

    await fetchBootstrapState();
    await refreshCurrentRouteSession();

    if (!state.manifest) {
      resolveDraftState();
    }

    ensurePolling();
    renderApp();
  }

  window.addEventListener("popstate", function () {
    fetchBootstrapState()
      .then(refreshCurrentRouteSession)
      .then(function () {
        if (!state.manifest) {
          resolveDraftState();
        }

        ensurePolling();
        renderApp();
      })
      .catch(function () {
      });
  });

  window.addEventListener("beforeunload", cleanupRuntime);

  bootstrap().catch(function (error) {
    window.alert(error.message || "Unable to load the session page.");
  });
})();
