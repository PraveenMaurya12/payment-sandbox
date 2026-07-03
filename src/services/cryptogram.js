"use strict";

const logger = require("../logger");

/**
 * Normalise a 3DS cryptogram (CAVV/AAV) so Checkout.com accepts it.
 *
 * Checkout.com requires standard Base64 (RFC 4648), 28 chars + padding.
 * Evervault (and some other 3DS providers) may return:
 *   - URL-safe Base64  (uses - and _ instead of + and /)
 *   - Hex-encoded value (40 hex chars = 20 bytes)
 *   - Correct standard Base64 already (no-op)
 */
function normalizeCryptogram(raw) {
  if (!raw) return raw;

  let value = String(raw).trim();
  const original = value;

  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
    // Looks like hex — decode to Base64.
    value = Buffer.from(value, "hex").toString("base64");
  } else {
    // Convert URL-safe Base64 to standard Base64 and restore stripped padding.
    value = value.replace(/-/g, "+").replace(/_/g, "/");
    const pad = value.length % 4;
    if (pad === 2) value += "==";
    else if (pad === 3) value += "=";
  }

  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== 20) {
      logger.warn("Cryptogram has unexpected byte length", { length: decoded.length });
    }
  } catch {
    /* ignore — the authorize call will surface any real problem */
  }

  if (value !== original) {
    logger.debug("Cryptogram normalised", { changed: true });
  }
  return value;
}

module.exports = { normalizeCryptogram };
