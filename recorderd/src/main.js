import { loadConfig } from "./config.js";
import { DeviceManager } from "./audio/device-manager.js";
import { LocalFsStore } from "./storage/local-fs-store.js";
import { SessionManager } from "./session/manager.js";
import { createHttpServer } from "./http/server.js";

async function main() {
  const config = loadConfig();
  const deviceManager = new DeviceManager(config);
  const store = new LocalFsStore(config);

  await deviceManager.refresh();

  await store.init();

  const sessionManager = new SessionManager({
    config,
    store,
    deviceManager
  });

  await sessionManager.init();

  const server = createHttpServer({
    config,
    sessionManager,
    webDir: config.webDir
  });

  server.listen(config.bindPort, config.bindHost, function () {
    process.stdout.write("Recorder server listening on http://" + config.bindHost + ":" + config.bindPort + "\n");
  });
}

main().catch(function (error) {
  process.stderr.write((error.stack || String(error)) + "\n");
  process.exitCode = 1;
});
