"use strict";

const express = require("express");
const { validateAuthorizeBody, validatePaymentAction } = require("../middleware/validate");
const { asyncHandler } = require("../middleware/asyncHandler");

/**
 * Payment routes. Thin: each handler validates, delegates to the injected
 * PaymentService, and shapes the HTTP response. All orchestration and
 * persistence live in the service.
 */
module.exports = function paymentsRoutes({ paymentService }) {
  const router = express.Router();

  // 1) authorize (optionally auth+capture) using the completed 3DS result.
  router.post(
    "/payment/authorize",
    validateAuthorizeBody,
    asyncHandler(async (req, res) => {
      const data = await paymentService.authorize({ visitorId: req.visitorId, input: req.body });
      res.json(data);
    })
  );

  router.post(
    "/payment/capture",
    validatePaymentAction,
    asyncHandler(async (req, res) => {
      const data = await paymentService.capture({
        visitorId: req.visitorId,
        paymentId: req.body.paymentId,
        transactionId: req.body.transactionId,
        amount: req.body.amount,
        reference: req.body.reference,
      });
      res.status(202).json(data);
    })
  );

  router.post(
    "/payment/void",
    validatePaymentAction,
    asyncHandler(async (req, res) => {
      const data = await paymentService.void({
        visitorId: req.visitorId,
        paymentId: req.body.paymentId,
        transactionId: req.body.transactionId,
        reference: req.body.reference,
      });
      res.status(202).json(data);
    })
  );

  router.post(
    "/payment/refund",
    validatePaymentAction,
    asyncHandler(async (req, res) => {
      const data = await paymentService.refund({
        visitorId: req.visitorId,
        paymentId: req.body.paymentId,
        transactionId: req.body.transactionId,
        amount: req.body.amount,
        reference: req.body.reference,
        reason: req.body.reason,
      });
      res.status(202).json(data);
    })
  );

  // Live detail, balances and action history from the processor.
  router.get(
    "/payment/:id",
    asyncHandler(async (req, res) => {
      res.json(await paymentService.getPayment(req.params.id));
    })
  );

  return router;
};
