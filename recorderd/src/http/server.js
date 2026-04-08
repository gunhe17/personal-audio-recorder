import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { createApiError, ApiError } from "./errors.js";

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wav", "audio/wav"],
  [".zip", "application/zip"]
]);

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function textFrame(payload) {
  const body = Buffer.from(payload);

  if (body.length < 126) {
    return Buffer.concat([Buffer.from([0x81, body.length]), body]);
  }

  const header = Buffer.alloc(4);

  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(body.length, 2);

  return Buffer.concat([header, body]);
}

async function readJson(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw createApiError(400, "INVALID_JSON", "The request body must be valid JSON.");
  }
}

async function sendFile(res, filePath, options) {
  const stat = await fs.promises.stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    "content-type": mimeTypes.get(ext) || "application/octet-stream",
    "content-length": stat.size
  };

  if (options?.downloadName) {
    headers["content-disposition"] = 'attachment; filename="' + path.basename(options.downloadName) + '"';
  }

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function createWebSocketAccept(key) {
  return crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
}

export function createHttpServer({ config, sessionManager, webDir }) {
  const sockets = new Set();
  const resolvedWebDir = path.resolve(webDir);
  const staticRoutes = new Map([
    ["/playground", "playground.html"],
    ["/playground.html", "playground.html"],
    ["/", "session.html"],
    ["/session", "session.html"]
  ]);

  function decodePathParam(raw, label) {
    try {
      return decodeURIComponent(raw);
    } catch {
      throw createApiError(400, "INVALID_PATH_PARAM", "Invalid " + label + " path parameter.");
    }
  }

  async function getSessionOrThrow(sessionId) {
    const manifest = await sessionManager.getSession(sessionId);

    if (!manifest) {
      throw createApiError(404, "SESSION_NOT_FOUND", "The session could not be found.");
    }

    return manifest;
  }

  const apiRoutes = [
    {
      method: "GET",
      pattern: /^\/api\/v1\/health$/,
      handler: async function (_, res) {
        json(res, 200, { status: "ok" });
      }
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/devices$/,
      handler: async function (_, res) {
        json(res, 200, { devices: await sessionManager.listDevices() });
      }
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/device-profiles$/,
      handler: async function (_, res) {
        json(res, 200, { profiles: await sessionManager.listProfiles() });
      }
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/sessions\/prepare$/,
      handler: async function (req, res) {
        const body = await readJson(req);
        const manifest = await sessionManager.prepareSession(body);

        json(res, 200, {
          session: {
            id: manifest.id,
            status: manifest.status,
            storageTarget: manifest.storageTarget
          }
        });
      }
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/recorder\/start$/,
      handler: async function (req, res) {
        const body = await readJson(req);
        const recorder = await sessionManager.start(body.sessionId);

        json(res, 200, { recorder });
      }
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/recorder\/stop$/,
      handler: async function (req, res) {
        const body = await readJson(req);
        const session = await sessionManager.stop(body.sessionId);

        json(res, 200, { session });
      }
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/recorder\/state$/,
      handler: async function (_, res) {
        json(res, 200, sessionManager.getRecorderState());
      }
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/monitor\/state$/,
      handler: async function (_, res) {
        json(res, 200, sessionManager.getMonitorState());
      }
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/monitor\/config$/,
      handler: async function (req, res) {
        const body = await readJson(req);
        const monitor = await sessionManager.configureMonitor(body);

        json(res, 200, { monitor });
      }
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/sessions$/,
      handler: async function (_, res) {
        json(res, 200, { sessions: await sessionManager.listSessions() });
      }
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/sessions\/([^/]+)$/,
      handler: async function (_, res, match) {
        const sessionId = decodePathParam(match[1], "sessionId");
        const manifest = await getSessionOrThrow(sessionId);

        json(res, 200, manifest);
      }
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/sessions\/([^/]+)\/tracks\/(\d+)\/segments\/(\d+)$/,
      handler: async function (_, res, match) {
        const sessionId = decodePathParam(match[1], "sessionId");
        const usbChannel = Number(match[2]);
        const segmentIndex = Number(match[3]);
        const manifest = await getSessionOrThrow(sessionId);
        const segmentPath = await sessionManager.store.getSegmentPath(sessionId, usbChannel, segmentIndex);

        if (!segmentPath) {
          if (manifest.storageTarget === "client_download") {
            throw createApiError(410, "MEDIA_EXPIRED", "The track media is no longer available.");
          }

          throw createApiError(404, "SEGMENT_NOT_FOUND", "The track segment could not be found.");
        }

        await sendFile(res, segmentPath);
      }
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/sessions\/([^/]+)\/export$/,
      handler: async function (_, res, match) {
        const sessionId = decodePathParam(match[1], "sessionId");
        const artifact = await sessionManager.createExportArchive(sessionId);

        json(res, 200, {
          export: {
            status: "ready",
            archiveFile: artifact.archiveFile,
            downloadUrl: artifact.downloadUrl
          }
        });
      }
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/sessions\/([^/]+)\/archive$/,
      handler: async function (_, res, match) {
        const sessionId = decodePathParam(match[1], "sessionId");
        const archivePath = await sessionManager.store.getArchivePath(sessionId);

        if (!archivePath) {
          throw createApiError(410, "MEDIA_EXPIRED", "The archive is no longer available.");
        }

        await sessionManager.markArchiveDownloaded(sessionId);
        await sendFile(res, archivePath, {
          downloadName: path.basename(archivePath)
        });
      }
    }
  ];

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://" + req.headers.host);
      const pathname = url.pathname;

      for (const route of apiRoutes) {
        if (req.method !== route.method) {
          continue;
        }

        const match = pathname.match(route.pattern);

        if (!match) {
          continue;
        }

        await route.handler(req, res, match);
        return;
      }

      if (staticRoutes.has(pathname)) {
        await sendFile(res, path.join(webDir, staticRoutes.get(pathname)));
        return;
      }

      if (pathname.startsWith("/session/")) {
        await sendFile(res, path.join(webDir, "session.html"));
        return;
      }

      const assetPath = path.resolve(webDir, "." + pathname);

      if (assetPath === resolvedWebDir || assetPath.startsWith(resolvedWebDir + path.sep)) {
        try {
          await sendFile(res, assetPath);
          return;
        } catch {
        }
      }

      throw createApiError(404, "NOT_FOUND", "The requested resource could not be found.");
    } catch (error) {
      const apiError = error instanceof ApiError
        ? error
        : createApiError(500, "INTERNAL_ERROR", error.message || "Unexpected server error.");

      json(res, apiError.status, {
        error: {
          code: apiError.code,
          message: apiError.message
        }
      });
    }
  });

  server.on("upgrade", function (req, socket) {
    const url = new URL(req.url, "http://" + req.headers.host);

    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const key = req.headers["sec-websocket-key"];

    if (!key) {
      socket.destroy();
      return;
    }

    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Accept: " + createWebSocketAccept(key),
      "",
      ""
    ].join("\r\n"));

    sockets.add(socket);
    socket.on("close", function () {
      sockets.delete(socket);
    });
    socket.on("end", function () {
      sockets.delete(socket);
    });
    socket.on("error", function () {
      sockets.delete(socket);
    });

    socket.write(textFrame(JSON.stringify({
      type: "recorder_state_changed",
      recorder: sessionManager.getRecorderState()
    })));
  });

  function broadcast(type, payload) {
    const frame = textFrame(JSON.stringify({ type, ...payload }));

    for (const socket of sockets) {
      socket.write(frame);
    }
  }

  sessionManager.on("recorder_state_changed", function (recorder) {
    broadcast("recorder_state_changed", { recorder });
  });
  sessionManager.on("meter_update", function (payload) {
    broadcast("meter_update", payload);
  });
  sessionManager.on("drop_event", function (payload) {
    broadcast("drop_event", payload);
  });
  sessionManager.on("session_completed", function (payload) {
    broadcast("session_completed", payload);
  });

  return server;
}
