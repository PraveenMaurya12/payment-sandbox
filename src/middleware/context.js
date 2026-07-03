"use strict";

const crypto = require("crypto");
const { config } = require("../config");
const logger = require("../logger");

// A visitor id is an opaque, browser-generated token (we recommend a UUID).
// It is NOT personal data — it exists only to scope a browser's own history.
const VISITOR_RE = /^[A-Za-z0-9._-]{8,128}$/;

/** Same-origin is always allowed; extra origins can be whitelisted via env. */
function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Visitor-Id");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}

/** Attaches a request id and the caller's visitor id (if valid). */
function requestContext(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  const v = req.get("X-Visitor-Id");
  req.visitorId = v && VISITOR_RE.test(v) ? v : null;
  next();
}

/** One structured log line per request, with duration and status. */
function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info("request", {
      id: req.id,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      ms: Math.round(ms),
    });
  });
  next();
}

module.exports = { cors, requestContext, requestLogger, VISITOR_RE };
