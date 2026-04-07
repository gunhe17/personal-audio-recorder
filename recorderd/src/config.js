import path from "node:path";

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBindAddress(value) {
  const fallback = { host: "0.0.0.0", port: 3000 };

  if (!value || !value.includes(":")) {
    return fallback;
  }

  const index = value.lastIndexOf(":");
  const host = value.slice(0, index) || fallback.host;
  const port = parseInteger(value.slice(index + 1), fallback.port);

  return { host, port };
}

export function loadConfig() {
  const bind = parseBindAddress(process.env.RECORDER_BIND);
  const cwd = process.cwd();
  const dataDir = path.resolve(cwd, process.env.DATA_DIR || "./data");

  return {
    bindHost: bind.host,
    bindPort: bind.port,
    dataDir,
    webDir: path.resolve(cwd, "web"),
    segmentSeconds: parseInteger(process.env.SEGMENT_SECONDS, 900),
    meterIntervalMs: parseInteger(process.env.METER_INTERVAL_MS, 100),
    queueBlockCapacity: parseInteger(process.env.QUEUE_BLOCK_CAPACITY, 256),
    framesPerBufferHint: parseInteger(process.env.FRAMES_PER_BUFFER_HINT, 1024),
    liveWaveformBins: parseInteger(process.env.LIVE_WAVEFORM_BINS, 24),
    maxWaveformBins: parseInteger(process.env.MAX_WAVEFORM_BINS, 160),
    exportArchiveName: process.env.EXPORT_ARCHIVE_NAME || "session.zip",
    clientDownloadRetentionHours: parseInteger(process.env.CLIENT_DOWNLOAD_RETENTION_HOURS, 24)
  };
}
