"use strict";

const rateLimit = require("express-rate-limit");
const { config } = require("../config");

const shared = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please slow down and try again shortly." },
};

/** Generous limit for reads (config, health, history). */
const generalLimiter = rateLimit({ windowMs: 60_000, max: 120, ...shared });

/**
 * Tighter limit for the endpoints that call Evervault / Checkout.com, to keep
 * a public demo from being abused (each hit costs an upstream sandbox call).
 */
const paymentLimiter = rateLimit({
  windowMs: 60_000,
  max: config.paymentRateLimit,
  ...shared,
});

module.exports = { generalLimiter, paymentLimiter };
