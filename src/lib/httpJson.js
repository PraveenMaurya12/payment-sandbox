"use strict";

const { config } = require("../config");
const { upstream } = require("../domain/errors");

/**
 * Single place for outbound HTTP to upstream sandboxes (Evervault, Checkout.com).
 *
 * Consolidates what used to be duplicated in every service wrapper:
 *   - a request timeout via AbortController (previously there was none — a hung
 *     upstream socket would tie up the request indefinitely),
 *   - fetch → text → JSON parsing, and
 *   - a uniform { ok, status, data, text, isJson } result shape.
 *
 * It does NOT throw on non-2xx responses — callers map upstream errors into
 * their own domain-specific messages. It DOES throw a typed AppError on
 * network failure or timeout so the error handler can respond cleanly.
 */
async function httpJson(url, { method = "GET", headers = {}, body, timeoutMs } = {}) {
  const controller = new AbortController();
  const limit = timeoutMs || config.upstreamTimeoutMs;
  const timer = setTimeout(() => controller.abort(), limit);

  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw upstream(504, "The upstream service did not respond in time. Please try again.");
    }
    throw upstream(502, "Could not reach the upstream service. Please try again.", {
      detail: { cause: err.message },
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data;
  let isJson = true;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    isJson = false;
    data = { raw: text.slice(0, 500) };
  }
  return { ok: res.ok, status: res.status, data, text, isJson };
}

/** Basic auth header from an id:key pair. */
function basicAuth(id, key) {
  return "Basic " + Buffer.from(`${id}:${key}`).toString("base64");
}

module.exports = { httpJson, basicAuth };
