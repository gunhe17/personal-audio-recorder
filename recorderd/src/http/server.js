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
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://" + req.headers.host);
      const pathname = url.pathname;

      if (pathname === "/api/v1/health" && req.method === "GET") {
        json(res, 200, { status: "ok" });
        return;
      }

      if (pathname === "/api/v1/devices" && req.method === "GET") {
        json(res, 200, { devices: await sessionManager.listDevices() });
        return;
      }

      if (pathname === "/api/v1/device-profiles" && req.method === "GET") {
        json(res, 200, { profiles: await sessionManager.listProfiles() });
        return;
      }

      if (pathname === "/api/v1/sessions/prepare" && req.method === "POST") {
        const body = await readJson(req);
        const manifest = await sessionManager.prepareSession(body);

        json(res, 200, {
          session: {
            id: manifest.id,
            status: manifest.status,
            storageTarget: manifest.storageTarget
          }
        });
        return;
      }

      if (pathname === "/api/v1/recorder/start" && req.method === "POST") {
        const body = await readJson(req);
        const recorder = await sessionManager.start(body.sessionId);

        json(res, 200, { recorder });
        return;
      }

      if (pathname === "/api/v1/recorder/stop" && req.method === "POST") {
        const body = await readJson(req);
        const session = await sessionManager.stop(body.sessionId);

        json(res, 200, { session });
        return;
      }

      if (pathname === "/api/v1/recorder/state" && req.method === "GET") {
        json(res, 200, sessionManager.getRecorderState());
        return;
      }

      if (pathname === "/api/v1/sessions" && req.method === "GET") {
        json(res, 200, { sessions: await sessionManager.listSessions() });
        return;
      }

      const sessionMatch = pathname.match(/^\/api\/v1\/sessions\/([^/]+)$/);

      if (sessionMatch && req.method === "GET") {
        const manifest = await sessionManager.getSession(decodeURIComponent(sessionMatch[1]));

        if (!manifest) {
          throw createApiError(404, "SESSION_NOT_FOUND", "The session could not be found.");
        }

        json(res, 200, manifest);
        return;
      }

      const segmentMatch = pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/tracks\/(\d+)\/segments\/(\d+)$/);

      if (segmentMatch && req.method === "GET") {
        const sessionId = decodeURIComponent(segmentMatch[1]);
        const manifest = await sessionManager.getSession(sessionId);

        if (!manifest) {
          throw createApiError(404, "SESSION_NOT_FOUND", "The session could not be found.");
        }

        const segmentPath = await sessionManager.store.getSegmentPath(
          sessionId,
          Number(segmentMatch[2]),
          Number(segmentMatch[3])
        );

        if (!segmentPath) {
          if (manifest.storageTarget === "client_download") {
            throw createApiError(410, "MEDIA_EXPIRED", "The track media is no longer available.");
          }

          throw createApiError(404, "SEGMENT_NOT_FOUND", "The track segment could not be found.");
        }

        await sendFile(res, segmentPath);
        return;
      }

      const exportMatch = pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/export$/);

      if (exportMatch && req.method === "POST") {
        const artifact = await sessionManager.createExportArchive(decodeURIComponent(exportMatch[1]));

        json(res, 200, {
          export: {
            status: "ready",
            archiveFile: artifact.archiveFile,
            downloadUrl: artifact.downloadUrl
          }
        });
        return;
      }

      const archiveMatch = pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/archive$/);

      if (archiveMatch && req.method === "GET") {
        const sessionId = decodeURIComponent(archiveMatch[1]);
        const archivePath = await sessionManager.store.getArchivePath(sessionId);

        if (!archivePath) {
          throw createApiError(410, "MEDIA_EXPIRED", "The archive is no longer available.");
        }

        await sessionManager.markArchiveDownloaded(sessionId);
        await sendFile(res, archivePath, {
          downloadName: path.basename(archivePath)
        });
        return;
      }

      if (pathname === "/playground" || pathname === "/playground.html") {
        await sendFile(res, path.join(webDir, "playground.html"));
        return;
      }

      if (pathname === "/" || pathname === "/session" || pathname.startsWith("/session/")) {
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
