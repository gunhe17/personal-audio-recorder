import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { clamp24Bit, computePeakDbfsFromI32 } from "../util/waveform.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const helperSourcePath = path.resolve(moduleDir, "../../native/coreaudio-helper.swift");

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, function (error, stdout, stderr) {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function parseAudioFrames(buffer, channelCount, trackChannels) {
  const floatSamples = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    Math.floor(buffer.byteLength / Float32Array.BYTES_PER_ELEMENT)
  );
  const frameCount = Math.floor(floatSamples.length / channelCount);

  return {
    frameCount,
    channels: trackChannels.map(function (usbChannel) {
      const samples = new Int32Array(frameCount);
      const sourceChannelIndex = usbChannel - 1;

      for (let frame = 0; frame < frameCount; frame += 1) {
        const floatValue = sourceChannelIndex < channelCount
          ? floatSamples[(frame * channelCount) + sourceChannelIndex]
          : 0;

        samples[frame] = clamp24Bit(Math.round(Math.max(-1, Math.min(1, floatValue)) * 8388607));
      }

      return {
        usbChannel,
        samples,
        peakDbfs: computePeakDbfsFromI32(samples)
      };
    })
  };
}

export class CoreAudioBackend {
  constructor(config) {
    this.config = config;
    this.helperBinaryPath = path.join(config.dataDir, ".bin", "coreaudio-helper");
    this.helperBuildPromise = null;
  }

  kind() {
    return "coreaudio";
  }

  helperEnvironment() {
    return {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: process.env.CLANG_MODULE_CACHE_PATH || path.join(os.tmpdir(), "swift-module-cache")
    };
  }

  async ensureHelperBinary() {
    if (this.helperBuildPromise) {
      return this.helperBuildPromise;
    }

    this.helperBuildPromise = (async () => {
      await fs.promises.mkdir(path.dirname(this.helperBinaryPath), { recursive: true });

      const [sourceStat, binaryStat] = await Promise.all([
        fs.promises.stat(helperSourcePath),
        fs.promises.stat(this.helperBinaryPath).catch(function () {
          return null;
        })
      ]);

      if (binaryStat && binaryStat.mtimeMs >= sourceStat.mtimeMs) {
        return this.helperBinaryPath;
      }

      try {
        await execFileAsync(
          "/usr/bin/swiftc",
          [helperSourcePath, "-o", this.helperBinaryPath],
          {
            env: this.helperEnvironment(),
            maxBuffer: 8 * 1024 * 1024
          }
        );
      } catch (error) {
        const detail = [error.stderr, error.stdout].filter(Boolean).join("\n").trim();

        throw new Error(detail || "Failed to build CoreAudio helper.");
      }

      return this.helperBinaryPath;
    })();

    try {
      return await this.helperBuildPromise;
    } catch (error) {
      this.helperBuildPromise = null;
      throw error;
    }
  }

  async listInputDevices() {
    const helperPath = await this.ensureHelperBinary().catch(function () {
      return null;
    });

    if (!helperPath) {
      return [];
    }

    try {
      const result = await execFileAsync(helperPath, ["list-devices"], {
        env: this.helperEnvironment(),
        maxBuffer: 8 * 1024 * 1024
      });

      return JSON.parse(result.stdout || "[]");
    } catch {
      return [];
    }
  }

  async openInputStream(request) {
    const helperPath = await this.ensureHelperBinary();
    const child = spawn(helperPath, [
      "capture",
      "--device-id",
      request.deviceId,
      "--sample-rate",
      String(request.sampleRate),
      "--channels",
      String(request.expectedChannels),
      "--frames-per-buffer",
      String(request.framesPerBufferHint || 1024)
    ], {
      env: this.helperEnvironment(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    let buffer = Buffer.alloc(0);
    let isStopping = false;
    let exitResolver = null;
    let exitRejector = null;

    const exitPromise = new Promise((resolve, reject) => {
      exitResolver = resolve;
      exitRejector = reject;
    });

    child.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 4) {
        const payloadLength = buffer.readUInt32LE(0);

        if (buffer.length < 4 + payloadLength) {
          break;
        }

        const payload = buffer.subarray(4, 4 + payloadLength);
        const frameCount = payload.readUInt32LE(0);
        const channelCount = payload.readUInt16LE(4);
        const formatCode = payload.readUInt16LE(6);
        const audioBytes = payload.subarray(8);

        buffer = buffer.subarray(4 + payloadLength);

        if (formatCode !== 1 || frameCount <= 0 || channelCount <= 0) {
          continue;
        }

        try {
          request.onAudioBlock(parseAudioFrames(audioBytes, channelCount, request.trackChannels));
        } catch (error) {
          request.onError(error);
        }
      }
    });

    child.stderr.on("data", function (chunk) {
      stderr += chunk.toString("utf8");
    });

    child.once("error", function (error) {
      if (isStopping) {
        exitResolver();
        return;
      }

      const wrapped = new Error("CoreAudio helper failed to start: " + error.message);

      request.onError(wrapped);
      exitRejector(wrapped);
    });

    child.once("exit", function (code, signal) {
      if (isStopping || code === 0 || signal === "SIGINT" || signal === "SIGTERM") {
        exitResolver();
        return;
      }

      const message = stderr.trim() || ("CoreAudio helper exited unexpectedly with code " + String(code) + ".");
      const error = new Error(message);

      request.onError(error);
      exitRejector(error);
    });

    return {
      stop: async function () {
        if (isStopping) {
          return exitPromise.catch(function () {
          });
        }

        isStopping = true;
        child.kill("SIGINT");
        await exitPromise.catch(function () {
        });
      }
    };
  }
}
