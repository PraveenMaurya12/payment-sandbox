"use strict";

require("dotenv").config();

/**
 * Centralised, validated configuration.
 *
 * The app is intentionally sandbox-only. We never read or store live keys, and
 * secret values never leave the server (see routes/config.routes.js for the
 * only values that are exposed to the browser).
 */

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true" || value === "1";
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function cleanBaseUrl(url) {
  return url ? String(url).trim().replace(/\/+$/, "") : url;
}

const config = {
  env: process.env.NODE_ENV || "development",
  port: int(process.env.PORT, 3000),
  trustProxy: bool(process.env.TRUST_PROXY, true),
  debugErrors: bool(process.env.DEBUG_ERRORS, false),
  paymentRateLimit: int(process.env.PAYMENT_RATE_LIMIT, 30),
  upstreamTimeoutMs: int(process.env.UPSTREAM_TIMEOUT_MS, 20000),

  allowedOrigins: (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  databaseUrl: process.env.DATABASE_URL || "",

  evervault: {
    baseUrl: "https://api.evervault.com",
    apiKey: process.env.EVERVAULT_API_KEY || "",
    appId: process.env.EVERVAULT_APP_ID || "",
    teamId: process.env.EVERVAULT_TEAM_ID || "",
  },

  checkout: {
    secretKey: process.env.CHECKOUT_SECRET_KEY || "",
    baseUrl: cleanBaseUrl(process.env.CHECKOUT_BASE_URL || ""),
    processingChannelId: process.env.CHECKOUT_PROCESSING_CHANNEL_ID || "",
  },
};

config.isProd = config.env === "production";
config.usePostgres = Boolean(config.databaseUrl);

/**
 * Returns a list of human-readable configuration problems. Empty = healthy.
 * The app still boots when misconfigured so /api/health can explain what's wrong.
 */
function getConfigIssues() {
  const issues = [];
  if (!config.evervault.apiKey) issues.push("EVERVAULT_API_KEY is missing");
  if (!config.evervault.appId) issues.push("EVERVAULT_APP_ID is missing");
  if (!config.evervault.teamId) issues.push("EVERVAULT_TEAM_ID is missing");
  if (!config.checkout.secretKey) issues.push("CHECKOUT_SECRET_KEY is missing");
  if (!config.checkout.baseUrl) {
    issues.push("CHECKOUT_BASE_URL is missing");
  } else if (!config.checkout.baseUrl.includes(".api.")) {
    issues.push(
      "CHECKOUT_BASE_URL looks wrong — it must be your unique prefixed URL, " +
        "e.g. https://xxxxxxxx.api.sandbox.checkout.com (Dashboard → Developers → Overview)"
    );
  }
  if (config.checkout.secretKey && config.checkout.secretKey.startsWith("sk_") &&
      !config.checkout.secretKey.includes("sbox")) {
    issues.push(
      "CHECKOUT_SECRET_KEY does not look like a sandbox key (expected sk_sbox_…). " +
        "This app is sandbox-only; refusing to treat it as configured."
    );
  }
  return issues;
}

module.exports = { config, getConfigIssues };
