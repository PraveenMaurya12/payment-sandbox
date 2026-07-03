"use strict";

/**
 * Domain vocabulary in one place, so status/action strings are never retyped
 * as literals across routes, services and the store (they used to be).
 */
const TxStatus = Object.freeze({
  AUTHORIZED: "Authorized",
  CAPTURED: "Captured",
  DECLINED: "Declined",
  VOIDED: "Voided",
  REFUNDED: "Refunded",
});

const ActionType = Object.freeze({
  AUTHORIZE: "authorize",
  AUTHORIZE_CAPTURE: "authorize+capture",
  CAPTURE: "capture",
  VOID: "void",
  REFUND: "refund",
});

module.exports = { TxStatus, ActionType };
