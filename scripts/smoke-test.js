const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000";

async function request(path, options) {
  const response = await fetch(baseUrl + path, options);
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : await response.arrayBuffer();

  if (!response.ok) {
    throw new Error(
      "Request failed: " + path + " " + response.status + " " +
      (isJson ? JSON.stringify(payload) : contentType)
    );
  }

  return {
    response,
    payload
  };
}

async function main() {
  const health = await request("/api/v1/health");
  const sessionPage = await request("/");
  const devices = await request("/api/v1/devices");
  const profiles = await request("/api/v1/device-profiles");

  const device = devices.payload.devices.find(function (candidate) {
    return candidate.id === "device_dummy_x32";
  });
  const profile = profiles.payload.profiles.find(function (candidate) {
    return candidate.id === "x32-32";
  });

  if (!device || !profile) {
    throw new Error("Dummy device/profile missing.");
  }

  const prepare = await request("/api/v1/sessions/prepare", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      title: "Smoke Test Session",
      deviceId: device.id,
      profileId: profile.id,
      storageTarget: "client_download",
      sampleRate: 48000,
      tracks: [
        { usbChannel: 1, label: "Kick", armed: true },
        { usbChannel: 2, label: "Snare", armed: true }
      ]
    })
  });

  const sessionId = prepare.payload.session.id;

  const start = await request("/api/v1/recorder/start", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      sessionId
    })
  });

  await new Promise(function (resolve) {
    setTimeout(resolve, 350);
  });

  const stop = await request("/api/v1/recorder/stop", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      sessionId
    })
  });

  const session = await request("/api/v1/sessions/" + encodeURIComponent(sessionId));
  const segment = await request("/api/v1/sessions/" + encodeURIComponent(sessionId) + "/tracks/1/segments/1");
  const archive = await request("/api/v1/sessions/" + encodeURIComponent(sessionId) + "/archive");
  const waveformPeaks = session.payload.tracks?.[0]?.segments?.[0]?.waveformPeaks || [];

  if (!waveformPeaks.length) {
    throw new Error("Waveform summary missing from saved segment metadata.");
  }

  process.stdout.write(JSON.stringify({
    health: health.payload,
    rootIncludesSessionBundle: Buffer.from(sessionPage.payload).toString("utf8").includes("/session-detail.js"),
    deviceCount: devices.payload.devices.length,
    profileCount: profiles.payload.profiles.length,
    prepared: prepare.payload.session,
    recorderStart: start.payload.recorder,
    stoppedStatus: stop.payload.session.status,
    finalExportStatus: session.payload.export.status,
    waveformBins: waveformPeaks.length,
    waveformPeakSample: waveformPeaks.slice(0, 8),
    segmentBytes: segment.payload.byteLength,
    archiveBytes: archive.payload.byteLength,
    archiveContentType: archive.response.headers.get("content-type")
  }, null, 2) + "\n");
}

main().catch(function (error) {
  process.stderr.write((error.stack || String(error)) + "\n");
  process.exitCode = 1;
});
