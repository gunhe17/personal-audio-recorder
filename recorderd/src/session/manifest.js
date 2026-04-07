export function createSessionManifest(input) {
  return {
    id: input.id,
    title: input.title,
    status: "prepared",
    device: {
      id: input.device.id,
      backend: input.device.backend,
      name: input.device.name
    },
    profile: {
      id: input.profile.id,
      family: input.profile.family
    },
    storageTarget: input.storageTarget,
    export: {
      status: "not_requested",
      archiveFile: null,
      downloadUrl: null
    },
    format: {
      sampleRate: input.sampleRate,
      bitDepth: input.profile.preferredBitDepth,
      channelCount: input.profile.expectedInputChannels
    },
    startedAt: null,
    stoppedAt: null,
    durationFrames: 0,
    dropEvents: [],
    tracks: input.tracks.map(function (track) {
      return {
        usbChannel: track.usbChannel,
        label: track.label,
        armed: Boolean(track.armed),
        lastPeakDbfs: -60,
        segments: []
      };
    })
  };
}

export function buildSessionSummary(manifest) {
  return {
    id: manifest.id,
    title: manifest.title,
    status: manifest.status,
    storageTarget: manifest.storageTarget,
    exportStatus: manifest.export?.status || "not_requested",
    startedAt: manifest.startedAt,
    stoppedAt: manifest.stoppedAt,
    trackCount: manifest.tracks.length
  };
}
