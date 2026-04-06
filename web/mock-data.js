(function () {
  const sessions = [
    {
      id: "sess_20260406_150501_ab12cd",
      title: "Sunday Service AM",
      status: "recording",
      storageTarget: "server_local",
      exportStatus: "not_requested",
      startedAt: "2026-04-06T06:05:01.000Z",
      stoppedAt: null,
      durationSeconds: 824,
      trackCount: 28,
      sampleRate: 48000,
      deviceName: "X-USB ASIO Driver",
      profileName: "x32-32",
      dropCount: 0,
      armedTracks: 28,
      freeDisk: "812 GB",
      notes: "Live capture in progress."
    },
    {
      id: "sess_20260405_191144_ef45gh",
      title: "Youth Rehearsal",
      status: "completed",
      storageTarget: "client_download",
      exportStatus: "ready",
      startedAt: "2026-04-05T10:11:44.000Z",
      stoppedAt: "2026-04-05T11:02:18.000Z",
      durationSeconds: 3034,
      trackCount: 32,
      sampleRate: 48000,
      deviceName: "X-USB ASIO Driver",
      profileName: "x32-32",
      dropCount: 0,
      armedTracks: 32,
      freeDisk: "794 GB",
      notes: "ZIP archive ready. Retention expires in 23 hours."
    },
    {
      id: "sess_20260404_204009_ij78kl",
      title: "Choir Night",
      status: "completed",
      storageTarget: "server_local",
      exportStatus: "not_requested",
      startedAt: "2026-04-04T11:40:09.000Z",
      stoppedAt: "2026-04-04T12:28:54.000Z",
      durationSeconds: 2925,
      trackCount: 24,
      sampleRate: 48000,
      deviceName: "TF Rack USB",
      profileName: "tf-34",
      dropCount: 1,
      armedTracks: 24,
      freeDisk: "775 GB",
      notes: "One minor drop event recorded near the end of set two."
    }
  ];

  const currentTracks = [
    { usbChannel: 1, label: "Kick", armed: true, peakDb: -12.4, status: "live", meterPercent: 58 },
    { usbChannel: 2, label: "Snare", armed: true, peakDb: -8.2, status: "live", meterPercent: 74 },
    { usbChannel: 3, label: "Bass DI", armed: true, peakDb: -15.0, status: "prepared", meterPercent: 52 },
    { usbChannel: 4, label: "Ac Gtr", armed: true, peakDb: -18.8, status: "prepared", meterPercent: 46 },
    { usbChannel: 5, label: "Piano", armed: true, peakDb: -11.9, status: "live", meterPercent: 62 },
    { usbChannel: 6, label: "Lead Vox", armed: true, peakDb: -6.4, status: "hot", meterPercent: 84 },
    { usbChannel: 7, label: "Choir", armed: true, peakDb: -13.3, status: "live", meterPercent: 56 },
    { usbChannel: 8, label: "Talkback", armed: false, peakDb: -24.0, status: "disabled", meterPercent: 18 }
  ];

  const sessionDetails = {
    "sess_20260406_150501_ab12cd": {
      summary: sessions[0],
      alerts: [
        { tone: "info", title: "Capture active", message: "Recorder is currently writing segments to the local server disk." },
        { tone: "success", title: "Disk healthy", message: "Estimated remaining capture time at current load is over 44 hours." }
      ],
      artifacts: {
        storageTarget: "server_local",
        exportStatus: "not_requested",
        exportArchive: null,
        manifestAvailable: true
      },
      tracks: [
        {
          usbChannel: 1,
          label: "Kick",
          status: "recording",
          peakDb: -12.4,
          segments: [
            { index: 1, file: "tracks/ch01/000001.wav", frames: "0 - 43199999", size: "129.6 MB" }
          ]
        },
        {
          usbChannel: 2,
          label: "Snare",
          status: "recording",
          peakDb: -8.2,
          segments: [
            { index: 1, file: "tracks/ch02/000001.wav", frames: "0 - 43199999", size: "129.6 MB" }
          ]
        },
        {
          usbChannel: 6,
          label: "Lead Vox",
          status: "hot",
          peakDb: -6.4,
          segments: [
            { index: 1, file: "tracks/ch06/000001.wav", frames: "0 - 43199999", size: "129.6 MB" }
          ]
        }
      ]
    },
    "sess_20260405_191144_ef45gh": {
      summary: sessions[1],
      alerts: [
        { tone: "success", title: "Export ready", message: "Archive is available for browser download." },
        { tone: "warning", title: "Retention window", message: "Raw track artifacts and archive expire in 23 hours." }
      ],
      artifacts: {
        storageTarget: "client_download",
        exportStatus: "ready",
        exportArchive: "/api/v1/sessions/sess_20260405_191144_ef45gh/archive",
        manifestAvailable: true
      },
      tracks: [
        {
          usbChannel: 1,
          label: "Kick",
          status: "completed",
          peakDb: -10.8,
          segments: [
            { index: 1, file: "tracks/ch01/000001.wav", frames: "0 - 43199999", size: "129.6 MB" },
            { index: 2, file: "tracks/ch01/000002.wav", frames: "43200000 - 86599999", size: "129.4 MB" }
          ]
        },
        {
          usbChannel: 2,
          label: "Snare",
          status: "completed",
          peakDb: -9.1,
          segments: [
            { index: 1, file: "tracks/ch02/000001.wav", frames: "0 - 43199999", size: "129.6 MB" },
            { index: 2, file: "tracks/ch02/000002.wav", frames: "43200000 - 86599999", size: "129.4 MB" }
          ]
        },
        {
          usbChannel: 6,
          label: "Lead Vox",
          status: "completed",
          peakDb: -7.4,
          segments: [
            { index: 1, file: "tracks/ch06/000001.wav", frames: "0 - 43199999", size: "129.6 MB" },
            { index: 2, file: "tracks/ch06/000002.wav", frames: "43200000 - 86599999", size: "129.4 MB" }
          ]
        }
      ]
    },
    "sess_20260404_204009_ij78kl": {
      summary: sessions[2],
      alerts: [
        { tone: "warning", title: "Drop event noted", message: "One write delay spike was recorded and reflected in the manifest." }
      ],
      artifacts: {
        storageTarget: "server_local",
        exportStatus: "not_requested",
        exportArchive: null,
        manifestAvailable: true
      },
      tracks: [
        {
          usbChannel: 3,
          label: "Choir L",
          status: "completed",
          peakDb: -11.8,
          segments: [
            { index: 1, file: "tracks/ch03/000001.wav", frames: "0 - 43199999", size: "129.6 MB" }
          ]
        },
        {
          usbChannel: 4,
          label: "Choir R",
          status: "completed",
          peakDb: -12.0,
          segments: [
            { index: 1, file: "tracks/ch04/000001.wav", frames: "0 - 43199999", size: "129.6 MB" }
          ]
        }
      ]
    }
  };

  function buildDraftSessionDetail(id) {
    return {
      summary: {
        id: id,
        title: "New Recording",
        status: "recording",
        storageTarget: "server_local",
        exportStatus: "not_requested",
        startedAt: new Date().toISOString(),
        stoppedAt: null,
        durationSeconds: 0,
        trackCount: 0,
        sampleRate: 48000,
        deviceName: "Not selected",
        profileName: "pending",
        dropCount: 0,
        armedTracks: 0,
        freeDisk: "--",
        notes: "Session created from landing page."
      },
      alerts: [
        {
          tone: "info",
          title: "Session created",
          message: "Recorder integration can attach live tracks after capture starts."
        }
      ],
      artifacts: {
        storageTarget: "server_local",
        exportStatus: "not_requested",
        exportArchive: null,
        manifestAvailable: false
      },
      tracks: []
    };
  }

  function getSessionById(id) {
    return sessionDetails[id] || buildDraftSessionDetail(id);
  }

  function resolveOwnerView(locationObject) {
    const searchParams = new URLSearchParams(locationObject.search);
    const raw = searchParams.get("owner");

    if (raw === "0" || raw === "false") {
      return false;
    }

    return true;
  }

  function isStaticPreview(locationObject) {
    const path = locationObject.pathname;

    return path.indexOf("/web/") !== -1 || locationObject.protocol === "file:";
  }

  function buildSessionHref(id) {
    if (isStaticPreview(window.location)) {
      return "./session.html?id=" + encodeURIComponent(id);
    }

    return "/session/" + encodeURIComponent(id);
  }

  function buildRootHref() {
    if (isStaticPreview(window.location)) {
      return "./index.html";
    }

    return "/";
  }

  function resolveSessionIdFromLocation(locationObject) {
    const searchParams = new URLSearchParams(locationObject.search);
    const fromQuery = searchParams.get("id");

    if (fromQuery) {
      return fromQuery;
    }

    const segments = locationObject.pathname.split("/").filter(Boolean);

    if (segments.length >= 2 && segments[0] === "session") {
      return decodeURIComponent(segments[1]);
    }

    return null;
  }

  window.RECORDER_MOCK = {
    ownerView: resolveOwnerView(window.location),
    currentSession: sessions[0],
    currentTracks: currentTracks,
    sessions: sessions,
    sessionDetails: sessionDetails,
    getSessionById: getSessionById,
    buildDraftSessionDetail: buildDraftSessionDetail,
    buildSessionHref: buildSessionHref,
    buildRootHref: buildRootHref,
    resolveSessionIdFromLocation: resolveSessionIdFromLocation,
    resolveOwnerView: resolveOwnerView
  };
})();
