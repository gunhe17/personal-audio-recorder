import crypto from "node:crypto";

function pad(value) {
  return String(value).padStart(2, "0");
}

export function createSessionId(now = new Date()) {
  const stamp = [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate())
  ].join("") + "_" + [
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds())
  ].join("");
  const suffix = crypto.randomBytes(3).toString("hex");

  return "sess_" + stamp + "_" + suffix;
}

export function createRequestId() {
  return crypto.randomBytes(8).toString("hex");
}
