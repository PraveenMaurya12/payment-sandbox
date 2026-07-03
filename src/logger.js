"use strict";

/**
 * Minimal dependency-free logger. Emits single-line JSON in production
 * (friendly to log aggregators) and readable text in development.
 *
 * Never log full PANs, CVVs, or secret keys. `redact()` scrubs the obvious
 * cases defensively before anything is written.
 */

const { config } = require("./config");

const SECRET_KEYS = /(api[_-]?key|secret|authorization|password|cvv|pan|card[_-]?number)/i;

function redact(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    // Mask long digit runs that look like card numbers (12–19 digits).
    return value.replace(/\b\d{12,19}\b/g, (m) => `••••${m.slice(-4)}`);
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

function write(level, msg, meta) {
  const safeMeta = meta ? redact(meta) : undefined;
  if (config.isProd) {
    const line = { t: new Date().toISOString(), level, msg };
    if (safeMeta) line.meta = safeMeta;
    process.stdout.write(JSON.stringify(line) + "\n");
  } else {
    const tag = { info: "→", warn: "⚠", error: "✗", debug: "·" }[level] || "·";
    const extra = safeMeta ? " " + JSON.stringify(safeMeta) : "";
    process.stdout.write(`${tag} ${msg}${extra}\n`);
  }
}

module.exports = {
  info: (msg, meta) => write("info", msg, meta),
  warn: (msg, meta) => write("warn", msg, meta),
  error: (msg, meta) => write("error", msg, meta),
  debug: (msg, meta) => config.isProd ? undefined : write("debug", msg, meta),
  redact,
};
