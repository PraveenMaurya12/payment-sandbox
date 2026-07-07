"use strict";

const crypto = require("crypto");
const { config } = require("../config");
const { serverError, upstream } = require("../domain/errors");
const { httpJson } = require("../lib/httpJson");

/**
 * Thin wrapper around the Checkout.com (sandbox) Payments API.
 * The secret key never reaches the client.
 */

function baseUrl() {
  const url = config.checkout.baseUrl;
  if (!url) {
    throw serverError("Checkout.com is not configured on the server.", {
      hint: "Set CHECKOUT_BASE_URL (your unique prefixed sandbox URL).",
    });
  }
  return url;
}

function authHeader() {
  const key = config.checkout.secretKey;
  if (!key) {
    throw serverError("Checkout.com is not configured on the server.", {
      hint: "Set CHECKOUT_SECRET_KEY (a sandbox sk_sbox_… key).",
    });
  }
  return "Bearer " + key;
}

function idempotencyKey(reference) {
  return `${reference}-${crypto.randomBytes(8).toString("hex")}`;
}

async function ckoFetch(pathname, { method = "GET", body, reference } = {}) {
  const headers = { Authorization: authHeader() };
  if (body) headers["Content-Type"] = "application/json";
  if (reference) headers["Cko-Idempotency-Key"] = idempotencyKey(reference);

  const { ok, status, data, isJson, text } = await httpJson(`${baseUrl()}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!isJson) {
    // A non-JSON body almost always means the wrong base URL was configured.
    throw upstream(502, "Checkout.com returned an unexpected (non-JSON) response.", {
      hint:
        "This usually means CHECKOUT_BASE_URL is the generic URL. Use your unique " +
        "prefixed URL from Dashboard → Developers → Overview.",
      detail: { status, raw: text.slice(0, 300) },
    });
  }
  return { ok, status, data };
}

function ckoError(data, fallback) {
  return (Array.isArray(data.error_codes) && data.error_codes.join(", ")) || data.message || fallback;
}

/**
 * Authorize a payment using the completed 3DS data (eci + cryptogram).
 * `capture: true` performs auth + capture in one step.
 */
async function authorize(params) {
  const {
    cardNumber, expMonth, expYear, cvv,
    amount, currency, capture = false, reference,
    eci, cryptogram, xid, version = "2.0.0",
  } = params;

  const expYearInt = parseInt(expYear, 10);
  const expYearFull = expYearInt < 100 ? 2000 + expYearInt : expYearInt;

  const source = {
    type: "card",
    number: String(cardNumber).replace(/\s/g, ""),
    expiry_month: parseInt(expMonth, 10),
    expiry_year: expYearFull,
  };
  if (cvv) source.cvv = String(cvv);

  const threeds = { enabled: true, eci, cryptogram, version };
  if (xid) threeds.xid = xid;

  const payload = {
    source,
    amount: parseInt(amount, 10),
    currency: String(currency).toUpperCase(),
    capture: Boolean(capture),
    payment_type: "Regular",
    reference,
    description: "Sandbox 3DS test payment",
    "3ds": threeds,
    processing_channel_id: config.checkout.processingChannelId || undefined,
  };

  const { ok, status, data } = await ckoFetch("/payments", {
    method: "POST",
    body: payload,
    reference,
  });

  if (!ok) {
    throw upstream(status, ckoError(data, "Authorization failed."), { detail: data });
  }

  const liabilityShift = eci === "05" || eci === "02";
  return {
    approved: data.approved ?? false,
    paymentId: data.id ?? null,
    status: data.status ?? "Unknown",
    authCode: data.auth_code ?? null,
    reference: data.reference ?? reference,
    amount: data.amount ?? payload.amount,
    currency: data.currency ?? payload.currency,
    responseCode: data.response_code ?? null,
    responseSummary: data.response_summary ?? null,
    eci: data["3ds"]?.eci ?? eci,
    liabilityShift,
    threeDs: {
      version: data["3ds"]?.version ?? version,
      challenged: data["3ds"]?.challenged ?? false,
      downgraded: data["3ds"]?.downgraded ?? false,
    },
  };
}

async function capture(paymentId, { amount, reference } = {}) {
  const ref = reference || `capture_${Date.now()}`;
  const body = { reference: ref };
  if (amount != null && amount !== "") body.amount = parseInt(amount, 10);

  const { ok, status, data } = await ckoFetch(`/payments/${encodeURIComponent(paymentId)}/captures`, {
    method: "POST",
    body,
    reference: ref,
  });
  if (!ok) throw upstream(status, ckoError(data, "Capture failed."), { detail: data });
  return { actionId: data.action_id ?? null, reference: data.reference ?? ref, amount: body.amount ?? null };
}

async function voidPayment(paymentId, { reference } = {}) {
  const ref = reference || `void_${Date.now()}`;
  const { ok, status, data } = await ckoFetch(`/payments/${encodeURIComponent(paymentId)}/voids`, {
    method: "POST",
    body: { reference: ref },
    reference: ref,
  });
  if (!ok) throw upstream(status, ckoError(data, "Void failed."), { detail: data });
  return { actionId: data.action_id ?? null, reference: data.reference ?? ref };
}

async function refund(paymentId, { amount, reference, reason } = {}) {
  const ref = reference || `refund_${Date.now()}`;
  const body = { reference: ref };
  if (amount != null && amount !== "") body.amount = parseInt(amount, 10);
  if (reason) body.metadata = { reason: String(reason).slice(0, 255) };

  const { ok, status, data } = await ckoFetch(`/payments/${encodeURIComponent(paymentId)}/refunds`, {
    method: "POST",
    body,
    reference: ref,
  });
  if (!ok) throw upstream(status, ckoError(data, "Refund failed."), { detail: data });
  return { actionId: data.action_id ?? null, reference: data.reference ?? ref, amount: body.amount ?? null };
}

/** Live payment detail + action history + balances from Checkout.com. */
async function getPayment(paymentId) {
  const [detail, actions] = await Promise.all([
    ckoFetch(`/payments/${encodeURIComponent(paymentId)}`),
    ckoFetch(`/payments/${encodeURIComponent(paymentId)}/actions`),
  ]);

  if (!detail.ok) {
    throw upstream(detail.status, ckoError(detail.data, "Could not fetch payment."), {
      detail: detail.data,
    });
  }

  const d = detail.data;
  const rawActions = actions.ok ? actions.data.items ?? actions.data ?? [] : [];
  return {
    paymentId: d.id,
    status: d.status,
    amount: d.amount,
    currency: d.currency,
    reference: d.reference,
    balances: {
      totalAuthorized: d.balances?.total_authorized ?? 0,
      totalCaptured: d.balances?.total_captured ?? 0,
      totalRefunded: d.balances?.total_refunded ?? 0,
      totalVoided: d.balances?.total_voided ?? 0,
    },
    actions: (Array.isArray(rawActions) ? rawActions : []).map((a) => ({
      type: a.type,
      id: a.id,
      amount: a.amount,
      approved: a.approved,
      reference: a.reference,
      timestamp: a.processed_on,
    })),
  };
}

module.exports = { authorize, capture, voidPayment, refund, getPayment };