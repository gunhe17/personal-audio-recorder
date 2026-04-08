import fs from "node:fs";
import path from "node:path";
import { createSessionId } from "../util/ids.js";
import { createZipArchive } from "./zip.js";
import { WavSegmentWriter } from "./wav-segment-writer.js";
import { buildSessionSummary, createSessionManifest } from "../session/manifest.js";
import { isPastRetention, nowIso } from "../util/time.js";

function manifestPathFor(sessionDir) {
  return path.join(sessionDir, "manifest.json");
}

export class LocalFsStore {
  constructor(config) {
    this.config = config;
    this.sessionsDir = path.join(config.dataDir, "sessions");
  }

  async init() {
    await fs.promises.mkdir(this.sessionsDir, { recursive: true });
    await this.recoverPendingSessions();
    await this.cleanupExpiredArtifacts();
  }

  sessionDir(sessionId) {
    return path.join(this.sessionsDir, sessionId);
  }

  async prepareSession(request, device, profile) {
    const id = createSessionId();
    const sessionDir = this.sessionDir(id);
    const manifest = createSessionManifest({
      id,
      title: request.title,
      device,
      profile,
      storageTarget: request.storageTarget,
      sampleRate: request.sampleRate,
      tracks: request.tracks
    });

    await fs.promises.mkdir(path.join(sessionDir, "tracks"), { recursive: true });
    await fs.promises.mkdir(path.join(sessionDir, "exports"), { recursive: true });
    await fs.promises.writeFile(path.join(sessionDir, "device-profile.json"), JSON.stringify(profile, null, 2));
    await this.updateManifest(id, manifest);

    return manifest;
  }

  async openTrackSegment(sessionId, usbChannel, segmentIndex, format) {
    const filePath = path.join(
      this.sessionDir(sessionId),
      "tracks",
      "ch" + String(usbChannel).padStart(2, "0"),
      String(segmentIndex).padStart(6, "0") + ".wav"
    );

    return new WavSegmentWriter(filePath, format, {
      maxWaveformBins: this.config.maxWaveformBins,
      waveformBinsPerWrite: this.config.liveWaveformBins
    }).init();
  }

  async updateManifest(sessionId, manifest) {
    const sessionDir = this.sessionDir(sessionId);
    const tmpPath = manifestPathFor(sessionDir) + ".tmp";

    await fs.promises.mkdir(sessionDir, { recursive: true });
    await fs.promises.writeFile(tmpPath, JSON.stringify(manifest, null, 2));
    await fs.promises.rename(tmpPath, manifestPathFor(sessionDir));
  }

  async finalizeSession(sessionId, manifest) {
    await this.updateManifest(sessionId, manifest);
  }

  async failSession(sessionId, manifest) {
    await this.updateManifest(sessionId, manifest);
  }

  async createExportArchive(sessionId) {
    const manifest = await this.getSession(sessionId);
    const sessionDir = this.sessionDir(sessionId);
    const archiveFile = this.config.exportArchiveName;
    const archivePath = path.join(sessionDir, "exports", archiveFile);
    const entries = [
      {
        name: "manifest.json",
        buffer: Buffer.from(JSON.stringify(manifest, null, 2))
      }
    ];

    for (const track of manifest.tracks) {
      for (const segment of track.segments) {
        const filePath = path.join(sessionDir, segment.file);
        await fs.promises.access(filePath);
        entries.push({
          name: segment.file.replaceAll(path.sep, "/"),
          filePath
        });
      }
    }

    const sizeBytes = await createZipArchive(archivePath, entries);

    return {
      archiveFile,
      downloadUrl: "/api/v1/sessions/" + encodeURIComponent(sessionId) + "/archive",
      sizeBytes
    };
  }

  async listSessions() {
    const directories = await fs.promises.readdir(this.sessionsDir, { withFileTypes: true });
    const manifests = [];

    for (const entry of directories) {
      if (!entry.isDirectory()) {
        continue;
      }

      const manifest = await this.tryReadManifest(entry.name);

      if (manifest) {
        manifests.push(buildSessionSummary(manifest));
      }
    }

    manifests.sort(function (left, right) {
      return String(right.startedAt || "").localeCompare(String(left.startedAt || ""));
    });

    return manifests;
  }

  async getSession(sessionId) {
    const manifest = await this.tryReadManifest(sessionId);

    if (!manifest) {
      return null;
    }

    return manifest;
  }

  async getSegmentPath(sessionId, usbChannel, index) {
    const relativePath = path.join(
      "tracks",
      "ch" + String(usbChannel).padStart(2, "0"),
      String(index).padStart(6, "0") + ".wav"
    );
    const absolutePath = path.join(this.sessionDir(sessionId), relativePath);

    try {
      await fs.promises.access(absolutePath);
      return absolutePath;
    } catch {
      return null;
    }
  }

  async getArchivePath(sessionId) {
    const manifest = await this.getSession(sessionId);

    if (!manifest?.export?.archiveFile) {
      return null;
    }

    const archivePath = path.join(this.sessionDir(sessionId), "exports", manifest.export.archiveFile);

    try {
      await fs.promises.access(archivePath);
      return archivePath;
    } catch {
      return null;
    }
  }

  async cleanupExpiredArtifacts() {
    const directories = await fs.promises.readdir(this.sessionsDir, { withFileTypes: true });
    const now = new Date();

    for (const entry of directories) {
      if (!entry.isDirectory()) {
        continue;
      }

      const manifest = await this.tryReadManifest(entry.name);

      if (!manifest) {
        continue;
      }

      if (manifest.storageTarget !== "client_download" || manifest.status !== "completed") {
        continue;
      }

      const referenceTime = manifest.stoppedAt || manifest.startedAt || nowIso();

      if (!isPastRetention(referenceTime, this.config.clientDownloadRetentionHours, now)) {
        continue;
      }

      await fs.promises.rm(path.join(this.sessionDir(entry.name), "tracks"), { recursive: true, force: true });
      await fs.promises.rm(path.join(this.sessionDir(entry.name), "exports"), { recursive: true, force: true });
    }
  }

  async recoverPendingSessions() {
    const directories = await fs.promises.readdir(this.sessionsDir, { withFileTypes: true }).catch(function () {
      return [];
    });

    for (const entry of directories) {
      if (!entry.isDirectory()) {
        continue;
      }

      const manifest = await this.tryReadManifest(entry.name);

      if (!manifest) {
        continue;
      }

      if (!["prepared", "recording", "stopping"].includes(manifest.status)) {
        continue;
      }

      manifest.status = "failed";
      manifest.recovery = {
        recoveredPartial: true,
        detectedAt: nowIso()
      };
      await this.updateManifest(entry.name, manifest);
    }
  }

  async tryReadManifest(sessionId) {
    try {
      const raw = await fs.promises.readFile(manifestPathFor(this.sessionDir(sessionId)), "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
