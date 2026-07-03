"use strict";

const express = require("express");
const { validateSessionBody } = require("../middleware/validate");
const { asyncHandler } = require("../middleware/asyncHandler");

/** Evervault 3-D Secure session create/retrieve (proxied server-side). */
module.exports = function threedsRoutes({ evervault }) {
  const router = express.Router();

  router.post(
    "/3ds/sessions",
    validateSessionBody,
    asyncHandler(async (req, res) => {
      const session = await evervault.createSession(req.body);
      res.status(201).json(session);
    })
  );

  router.get(
    "/3ds/sessions/:id",
    asyncHandler(async (req, res) => {
      const session = await evervault.getSession(req.params.id);
      res.json(session);
    })
  );

  return router;
};
