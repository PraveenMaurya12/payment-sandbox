"use strict";

const express = require("express");
const { config } = require("../config");
const { badRequest } = require("../domain/errors");
const { asyncHandler } = require("../middleware/asyncHandler");

/** Exposes only the publishable Evervault ids; the secret key stays server-side. */
module.exports = function configRoutes() {
  const router = express.Router();

  router.get(
    "/config",
    asyncHandler(async (_req, res) => {
      const { appId, teamId } = config.evervault;
      if (!appId || !teamId) {
        throw badRequest("Server is not configured yet (Evervault app/team id missing).");
      }
      res.json({ appId, teamId });
    })
  );

  return router;
};
