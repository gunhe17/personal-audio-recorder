function buildSequentialTracks(count, prefix = "Input ") {
  return Array.from({ length: count }, function (_, index) {
    return {
      usbChannel: index + 1,
      defaultLabel: prefix + String(index + 1).padStart(2, "0")
    };
  });
}

const namedProfiles = [
  {
    id: "x32-32",
    family: "x32",
    displayName: "X32 32ch",
    expectedInputChannels: 32,
    preferredSampleRates: [48000, 44100],
    preferredBitDepth: 24,
    defaultTracks: buildSequentialTracks(32, "USB ")
  },
  {
    id: "tf-34",
    family: "tf",
    displayName: "TF 34ch",
    expectedInputChannels: 34,
    preferredSampleRates: [48000],
    preferredBitDepth: 24,
    defaultTracks: buildSequentialTracks(32, "CH ").concat([
      { usbChannel: 33, defaultLabel: "ST L" },
      { usbChannel: 34, defaultLabel: "ST R" }
    ])
  }
];

function createGenericProfile(channelCount) {
  return {
    id: "generic-" + String(channelCount),
    family: "generic",
    displayName: "Generic " + String(channelCount) + "ch",
    expectedInputChannels: channelCount,
    preferredSampleRates: [44100, 48000, 88200, 96000],
    preferredBitDepth: 24,
    defaultTracks: buildSequentialTracks(channelCount, "Input ")
  };
}

function parseGenericChannelCount(profileId) {
  const match = String(profileId || "").match(/^generic-(\d+)$/);

  if (!match) {
    return null;
  }

  const channelCount = Number.parseInt(match[1], 10);

  return Number.isFinite(channelCount) && channelCount > 0 ? channelCount : null;
}

export function listDeviceProfiles(devices) {
  const genericCounts = new Set(
    Array.isArray(devices)
      ? devices
        .map(function (device) {
          return Number(device.inputChannels);
        })
        .filter(function (channelCount) {
          return Number.isFinite(channelCount) && channelCount > 0;
        })
      : []
  );

  return namedProfiles
    .concat(Array.from(genericCounts).sort(function (left, right) {
      return left - right;
    }).map(function (channelCount) {
      return createGenericProfile(channelCount);
    }))
    .map(function (profile) {
      return structuredClone(profile);
    });
}

export function getDeviceProfile(profileId) {
  const namedProfile = namedProfiles.find(function (candidate) {
    return candidate.id === profileId;
  });

  if (namedProfile) {
    return structuredClone(namedProfile);
  }

  const genericChannelCount = parseGenericChannelCount(profileId);

  if (!genericChannelCount) {
    return null;
  }

  return createGenericProfile(genericChannelCount);
}

export function buildTracksFromProfile(profileId) {
  const profile = getDeviceProfile(profileId);

  if (!profile) {
    return [];
  }

  return profile.defaultTracks.map(function (track) {
    return {
      usbChannel: track.usbChannel,
      label: track.defaultLabel,
      armed: true
    };
  });
}
