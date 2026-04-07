import { CoreAudioBackend } from "./coreaudio-backend.js";
import { DummyBackend } from "./dummy-backend.js";

export class DeviceManager {
  constructor(config) {
    this.backends = [
      new CoreAudioBackend(config),
      new DummyBackend(config)
    ];
    this.devices = [];
  }

  async refresh() {
    const allDevices = [];

    for (const backend of this.backends) {
      try {
        const devices = await backend.listInputDevices();

        allDevices.push(...devices);
      } catch (error) {
        void error;
      }
    }

    this.devices = allDevices;
    return this.listInputDevices();
  }

  listInputDevices() {
    return this.devices.map(function (device) {
      return structuredClone(device);
    });
  }

  getDevice(deviceId) {
    const device = this.devices.find(function (candidate) {
      return candidate.id === deviceId;
    });

    return device ? structuredClone(device) : null;
  }

  getBackend(kind) {
    return this.backends.find(function (backend) {
      return backend.kind() === kind;
    }) || null;
  }
}
