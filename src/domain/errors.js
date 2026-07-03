"use strict";

/**
 * AppError carries an HTTP status and a client-safe message. Anything thrown
 * that is NOT an AppError is treated as an unexpected 500 and its details are
 * hidden from the client (unless DEBUG_ERRORS=true).
 */
class AppError extends Error {
  constructor(statusCode, message, options = {}) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.expose = true; // safe to show `message` to the client
    this.hint = options.hint; // optional actionable fix
    this.detail = options.detail; // upstream detail, shown only when DEBUG_ERRORS
  }
}

const badRequest = (msg, opts) => new AppError(400, msg, opts);
const upstream = (status, msg, opts) => new AppError(status || 502, msg, opts);
const serverError = (msg, opts) => new AppError(500, msg, opts);

module.exports = { AppError, badRequest, upstream, serverError };
