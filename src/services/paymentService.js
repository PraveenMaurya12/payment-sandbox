"use strict";

const crypto = require("crypto");
const { normalizeCryptogram } = require("./cryptogram");
const { detectBrand, last4 } = require("../domain/card");
const { badRequest } = require("../domain/errors");
const { TxStatus, ActionType } = require("../domain/constants");

/**
 * Orchestrates a payment across the 3DS provider, the card processor, and the
 * transaction store. Routes stay thin; this is where the flow lives.
 *
 * Dependencies are injected (store + the two upstream clients), so the service
 * is unit-testable in isolation and the app has a single composition root.
 */
class PaymentService {
  constructor({ store, evervault, checkout }) {
    this.store = store;
    this.evervault = evervault;
    this.checkout = checkout;
  }

  #newReference() {
    return `sbx_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  }

  /**
   * Read the authenticated 3DS session, authorize with the processor, then
   * persist SAFE metadata for the visitor (never the PAN/CVV).
   * Returns the authorization result plus the stored transaction id (or null).
   */
  async authorize({ visitorId, input }) {
    const reference = this.#newReference();

    const session = await this.evervault.getSession(input.sessionId);
    if (session.status !== "success") {
      throw badRequest(
        `3DS session status is '${session.status}' — it must be 'success' before authorizing.`,
        { detail: { failureReason: session.failureReason || null } }
      );
    }

    const eci = session.eci?.value ?? session.eci;
    const cryptogram = normalizeCryptogram(session.cryptogram);
    if (!eci || !cryptogram) {
      throw badRequest("The 3DS session is missing ECI or cryptogram data — cannot authorize.");
    }

    const result = await this.checkout.authorize({
      cardNumber: input.cardNumber,
      expMonth: input.expMonth,
      expYear: input.expYear,
      cvv: input.cvv,
      amount: input.amount,
      currency: input.currency,
      capture: input.capture,
      reference,
      eci,
      cryptogram,
      xid: session.xid || null,
      version: session.version || "2.0.0",
    });

    let transactionId = null;
    if (visitorId) {
      const saved = await this.store.recordAuthorization(
        {
          visitorId,
          reference,
          sessionId: input.sessionId,
          paymentId: result.paymentId,
          cardBrand: detectBrand(input.cardNumber),
          cardLast4: last4(input.cardNumber),
          amountMinor: result.amount,
          currency: result.currency,
          status: result.status,
          approved: result.approved,
          eci: result.eci,
          threeDsVersion: result.threeDs.version,
          liabilityShift: result.liabilityShift,
          responseSummary: result.responseSummary,
        },
        {
          actionType: input.capture ? ActionType.AUTHORIZE_CAPTURE : ActionType.AUTHORIZE,
          amountMinor: result.amount,
          status: result.status,
          actionRef: result.paymentId,
        }
      );
      transactionId = saved.id;
    }

    return { ...result, transactionId };
  }

  /** Append an action to the visitor's transaction (no-op if unowned/absent). */
  async #persistAction({ visitorId, transactionId, actionType, actionResult, status }) {
    if (!transactionId || !visitorId) return;
    await this.store.recordAction(
      transactionId,
      visitorId,
      {
        actionType,
        amountMinor: actionResult.amount ?? null,
        status,
        actionRef: actionResult.actionId,
      },
      { status }
    );
  }

  async capture({ visitorId, paymentId, transactionId, amount, reference }) {
    const result = await this.checkout.capture(paymentId, { amount, reference });
    await this.#persistAction({
      visitorId,
      transactionId,
      actionType: ActionType.CAPTURE,
      actionResult: result,
      status: TxStatus.CAPTURED,
    });
    return { captured: true, ...result, paymentId };
  }

  async void({ visitorId, paymentId, transactionId, reference }) {
    const result = await this.checkout.voidPayment(paymentId, { reference });
    await this.#persistAction({
      visitorId,
      transactionId,
      actionType: ActionType.VOID,
      actionResult: result,
      status: TxStatus.VOIDED,
    });
    return { voided: true, ...result, paymentId };
  }

  async refund({ visitorId, paymentId, transactionId, amount, reference, reason }) {
    const result = await this.checkout.refund(paymentId, { amount, reference, reason });
    await this.#persistAction({
      visitorId,
      transactionId,
      actionType: ActionType.REFUND,
      actionResult: result,
      status: TxStatus.REFUNDED,
    });
    return { refunded: true, ...result, paymentId };
  }

  getPayment(paymentId) {
    return this.checkout.getPayment(paymentId);
  }
}

module.exports = { PaymentService };
