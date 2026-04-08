import fs from "node:fs";
import path from "node:path";
import {
  buildWaveformBinsFromI32,
  clamp24Bit,
  computePeakLinearFromI32,
  downsampleWaveformBins,
  linearToDbfs
} from "../util/waveform.js";

function writeWavHeader(buffer, format, dataBytes) {
  const blockAlign = 3;
  const byteRate = format.sampleRate * blockAlign;

  buffer.write("RIFF", 0, 4, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, 4, "ascii");
  buffer.write("fmt ", 12, 4, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(format.sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(24, 34);
  buffer.write("data", 36, 4, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
}

export class WavSegmentWriter {
  constructor(filePath, format, options = {}) {
    this.filePath = filePath;
    this.format = format;
    this.maxWaveformBins = options.maxWaveformBins || 160;
    this.waveformBinsPerWrite = Math.max(1, Number(options.waveformBinsPerWrite) || 24);
    this.dataBytes = 0;
    this.writeStream = null;
    this.readyPromise = null;
    this.waveformPeaksRaw = [];
    this.peakLinear = 0;
  }

  async init() {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    this.writeStream = fs.createWriteStream(this.filePath);
    const header = Buffer.alloc(44);

    writeWavHeader(header, this.format, 0);
    this.readyPromise = new Promise((resolve, reject) => {
      this.writeStream.once("open", resolve);
      this.writeStream.once("error", reject);
    });
    await this.readyPromise;
    await new Promise((resolve, reject) => {
      this.writeStream.write(header, function (error) {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    return this;
  }

  async writeFramesI32(samples) {
    const buffer = Buffer.alloc(samples.length * 3);
    const blockPeakLinear = computePeakLinearFromI32(samples);
    const blockWaveformBins = buildWaveformBinsFromI32(samples, this.waveformBinsPerWrite);

    for (let index = 0; index < samples.length; index += 1) {
      const value = clamp24Bit(samples[index]);
      const offset = index * 3;

      buffer[offset] = value & 0xff;
      buffer[offset + 1] = (value >> 8) & 0xff;
      buffer[offset + 2] = (value >> 16) & 0xff;
    }

    this.dataBytes += buffer.length;
    this.peakLinear = Math.max(this.peakLinear, blockPeakLinear);
    this.waveformPeaksRaw.push(...blockWaveformBins);

    await new Promise((resolve, reject) => {
      this.writeStream.write(buffer, function (error) {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  async finalize() {
    if (!this.writeStream) {
      throw new Error("Writer not initialized.");
    }

    await new Promise((resolve, reject) => {
      this.writeStream.end(function (error) {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    const handle = await fs.promises.open(this.filePath, "r+");
    const header = Buffer.alloc(44);

    writeWavHeader(header, this.format, this.dataBytes);
    await handle.write(header, 0, header.length, 0);
    await handle.close();

    const stat = await fs.promises.stat(this.filePath);

    return {
      filePath: this.filePath,
      sizeBytes: stat.size,
      peakDbfs: linearToDbfs(this.peakLinear),
      waveformPeaks: downsampleWaveformBins(this.waveformPeaksRaw, this.maxWaveformBins)
    };
  }

  async abort() {
    if (this.writeStream) {
      await new Promise((resolve) => {
        this.writeStream.destroy();
        resolve();
      });
    }

    await fs.promises.rm(this.filePath, { force: true });
  }
}
