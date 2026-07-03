"use strict";

const { config } = require("../config");
const { serverError, upstream } = require("../domain/errors");
const { httpJson, basicAuth } = require("../lib/httpJson");

/**
 * Thin wrapper around the Evervault Payments API for 3-D Secure sessions.
 * The API key is sent only from here (server-side) and never reaches the client.
 */

function authHeader() {
  const { appId, apiKey } = config.evervault;
  if (!appId || !apiKey) {
    throw serverError("Evervault is not configured on the server.", {
      hint: "Set EVERVAULT_APP_ID and EVERVAULT_API_KEY in the environment.",
    });
  }
  return basicAuth(appId, apiKey);
}

/** Create a 3DS session. `body` is the client-supplied session payload. */
async function createSession(body) {
  const { ok, status, data } = await httpJson(`${config.evervault.baseUrl}/payments/3ds-sessions`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!ok) {
    throw upstream(status, data.message || data.detail || "Could not create a 3DS session.", {
      detail: data,
    });
  }
  return data;
}

/** Retrieve a 3DS session by id (used for polling + reading the auth result). */
async function getSession(id) {
  const { ok, status, data } = await httpJson(
    `${config.evervault.baseUrl}/payments/3ds-sessions/${encodeURIComponent(id)}`,
    { headers: { Authorization: authHeader() } }
  );
  if (!ok) {
    throw upstream(status, data.message || "Could not fetch the 3DS session.", { detail: data });
  }
  return data;
}

module.exports = { createSession, getSession };
