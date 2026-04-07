import { clamp24Bit, linearToDbfs } from "../util/waveform.js";

const devices = [
  {
    id: "device_dummy_x32",
    backend: "dummy",
    name: "Dummy X-USB 32",
    inputChannels: 32,
    sampleRates: [44100, 48000],
    defaultSampleRate: 48000,
    isDefault: true
  },
  {
    id: "device_dummy_tf34",
    backend: "dummy",
    name: "Dummy TF USB 34",
    inputChannels: 34,
    sampleRates: [48000],
    defaultSampleRate: 48000,
    isDefault: false
  },
  {
    id: "device_dummy_stereo",
    backend: "dummy",
    name: "Dummy Stereo Device",
    inputChannels: 2,
    sampleRates: [44100, 48000],
    defaultSampleRate: 48000,
    isDefault: false
  }
];

export class DummyBackend {
  constructor(config) {
    this.config = config;
  }

  kind() {
    return "dummy";
  }

  async listInputDevices() {
    return devices.map(function (device) {
      return structuredClone(device);
    });
  }

  async openInputStream(request) {
    const frameCount = Math.max(1, Math.floor((request.sampleRate * this.config.meterIntervalMs) / 1000));
    let sampleCursor = 0;

    const intervalId = setInterval(() => {
      try {
        const block = {
          frameCount,
          channels: request.trackChannels.map(function (usbChannel) {
            const samples = new Int32Array(frameCount);
            const amplitude = 0.08 + ((usbChannel % 7) * 0.04);
            const frequency = 120 + (usbChannel * 12);
            let peak = 0;

            for (let frame = 0; frame < frameCount; frame += 1) {
              const sample = Math.sin(((sampleCursor + frame) * frequency * Math.PI * 2) / request.sampleRate) * amplitude;

              peak = Math.max(peak, Math.abs(sample));
              samples[frame] = clamp24Bit(Math.floor(sample * 8388607));
            }

            return {
              usbChannel,
              samples,
              peakDbfs: linearToDbfs(peak)
            };
          })
        };

        sampleCursor += frameCount;
        request.onAudioBlock(block);
      } catch (error) {
        request.onError(error);
      }
    }, this.config.meterIntervalMs);

    intervalId.unref?.();

    return {
      stop: async function () {
        clearInterval(intervalId);
      }
    };
  }
}
