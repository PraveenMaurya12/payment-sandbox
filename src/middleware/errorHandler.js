"use strict";

const { config } = require("../config");
const logger = require("../logger");
const { AppError } = require("../domain/errors");

/** 404 for unmatched API routes (static files are handled before this). */
function notFound(req, res) {
  res.status(404).json({ error: "Not found." });
}

/** Central error handler. Client-safe messages only, unless DEBUG_ERRORS=true. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isApp = err instanceof AppError;
  const status = isApp ? err.statusCode : 500;

  if (status >= 500) {
    logger.error("unhandled error", { id: req.id, message: err.message, stack: err.stack });
  } else {
    logger.warn("request rejected", { id: req.id, status, message: err.message });
  }

  const payload = {
    error: isApp && err.expose ? err.message : "Something went wrong on our end.",
  };
  if (isApp && err.hint) payload.hint = err.hint;
  if (config.debugErrors && isApp && err.detail) payload.detail = err.detail;

  res.status(status).json(payload);
}

module.exports = { notFound, errorHandler };
