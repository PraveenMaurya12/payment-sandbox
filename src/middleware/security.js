"use strict";

const helmet = require("helmet");
const { config } = require("../config");

/**
 * Security headers. The Content-Security-Policy is deliberately strict on
 * script-src (no 'unsafe-inline' — our frontend JS is external and uses no
 * inline handlers), while allowing exactly what the Evervault SDK and the
 * 3-D Secure challenge iframe need to work.
 */
function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        // Evervault SDK is loaded from js.evervault.com. No inline scripts.
        "script-src": ["'self'", "https://js.evervault.com"],
        // Inline style attributes are used in the markup; allow them + Google Fonts.
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "data:", "https://*.evervault.com"],
        // The SDK talks to Evervault directly to encrypt the card and run 3DS.
        "connect-src": ["'self'", "https://api.evervault.com", "https://*.evervault.com"],
        // 3DS challenge renders inside Evervault's iframe, which nests the bank ACS page.
        "frame-src": ["'self'", "https://*.evervault.com", "https:"],
        "worker-src": ["'self'", "blob:"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'self'"],
        ...(config.isProd ? { "upgrade-insecure-requests": [] } : {}),
      },
    },
    // These would otherwise block the cross-origin Evervault SDK / iframe.
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    // HSTS only makes sense once served over HTTPS in production.
    hsts: config.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
  });
}

module.exports = { securityHeaders };
