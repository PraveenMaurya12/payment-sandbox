"use strict";

const { badRequest } = require("../domain/errors");
const { luhnValid } = require("../domain/card");

const AMOUNT_MIN = 50; // 0.50 in minor units
const AMOUNT_MAX = 1_000_000; // 10,000.00 — plenty for a sandbox demo

function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === "");
  if (missing.length) throw badRequest(`Missing required field(s): ${missing.join(", ")}`);
}

function validAmount(amount) {
  const n = parseInt(amount, 10);
  if (!Number.isInteger(n) || n < AMOUNT_MIN || n > AMOUNT_MAX) {
    throw badRequest(
      `Amount must be a whole number of minor units between ${AMOUNT_MIN} and ${AMOUNT_MAX}.`
    );
  }
  return n;
}

function validCurrency(currency) {
  const c = String(currency || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw badRequest("Currency must be a 3-letter ISO code, e.g. EUR.");
  return c;
}

function validExpiry(month, year) {
  const m = parseInt(month, 10);
  if (!Number.isInteger(m) || m < 1 || m > 12) throw badRequest("Expiry month must be 01–12.");
  if (!/^\d{2,4}$/.test(String(year))) throw badRequest("Expiry year must be 2 or 4 digits.");
}

/** POST /api/3ds/sessions — the card number here may be an Evervault-encrypted token. */
function validateSessionBody(req, _res, next) {
  const b = req.body || {};
  if (!b.card || !b.card.number) throw badRequest("card.number is required.");
  if (!b.card.expiry) throw badRequest("card.expiry is required.");
  validExpiry(b.card.expiry.month, b.card.expiry.year);
  if (!b.payment) throw badRequest("payment details are required.");
  b.payment.amount = validAmount(b.payment.amount);
  b.payment.currency = validCurrency(b.payment.currency);
  if (!b.merchant || !b.merchant.name) throw badRequest("merchant.name is required.");
  next();
}

/** POST /api/payment/authorize — cardNumber here is the raw PAN (sent to Checkout.com). */
function validateAuthorizeBody(req, _res, next) {
  const b = req.body || {};
  requireFields(b, ["sessionId", "cardNumber", "expMonth", "expYear", "amount", "currency"]);
  if (!luhnValid(b.cardNumber)) {
    throw badRequest("That card number is not valid. Use a Checkout.com sandbox test card.");
  }
  validExpiry(b.expMonth, b.expYear);
  if (b.cvv && !/^\d{3,4}$/.test(String(b.cvv))) throw badRequest("CVV must be 3 or 4 digits.");
  b.amount = validAmount(b.amount);
  b.currency = validCurrency(b.currency);
  b.capture = Boolean(b.capture);
  next();
}

function validatePaymentAction(req, _res, next) {
  const b = req.body || {};
  requireFields(b, ["paymentId"]);
  if (b.amount !== undefined && b.amount !== null && b.amount !== "") b.amount = validAmount(b.amount);
  if (b.reason && String(b.reason).length > 255) throw badRequest("Reason must be 255 characters or fewer.");
  next();
}

module.exports = {
  validateSessionBody,
  validateAuthorizeBody,
  validatePaymentAction,
  AMOUNT_MIN,
  AMOUNT_MAX,
};
