"use strict";

/**
 * Card helpers. The PAN is used transiently to authorize a sandbox payment and
 * to derive a *masked* representation (brand + last 4). The full PAN and CVV are
 * never persisted or logged.
 */

function digitsOnly(pan) {
  return String(pan || "").replace(/\D/g, "");
}

/** Luhn checksum — validates the structure of a card number. */
function luhnValid(pan) {
  const s = digitsOnly(pan);
  if (s.length < 12 || s.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = s.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Best-effort card brand from the leading digits. */
function detectBrand(pan) {
  const s = digitsOnly(pan);
  if (/^4/.test(s)) return "Visa";
  if (/^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/.test(s)) return "Mastercard";
  if (/^3[47]/.test(s)) return "Amex";
  if (/^(6011|65|64[4-9]|622)/.test(s)) return "Discover";
  if (/^3(0[0-5]|[68])/.test(s)) return "Diners";
  if (/^35/.test(s)) return "JCB";
  return "Card";
}

/** Returns just the last 4 digits (safe to display and store). */
function last4(pan) {
  const s = digitsOnly(pan);
  return s.length >= 4 ? s.slice(-4) : s;
}

module.exports = { digitsOnly, luhnValid, detectBrand, last4 };
