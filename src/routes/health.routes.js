"use strict";

const express = require("express");
const { config, getConfigIssues } = require("../config");

/** Health + readiness. Reports config status without leaking secret values. */
module.exports = function healthRoutes() {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    const issues = getConfigIssues();
    const mask = (v) => (v ? "set" : "missing");
    res.status(issues.length ? 503 : 200).json({
      ok: issues.length === 0,
      env: config.env,
      store: config.usePostgres ? "postgres" : "memory",
      issues,
      config: {
        evervault_app_id: mask(config.evervault.appId),
        evervault_team_id: mask(config.evervault.teamId),
        evervault_api_key: mask(config.evervault.apiKey),
        checkout_secret_key: mask(config.checkout.secretKey),
        checkout_base_url: config.checkout.baseUrl || "missing",
      },
    });
  });

  router.get("/ready", (_req, res) => res.json({ ready: true }));

  return router;
};
