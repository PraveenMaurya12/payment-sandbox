"use strict";

const express = require("express");
const { asyncHandler } = require("../middleware/asyncHandler");

/**
 * Per-visitor transaction history. Scoping is by the opaque X-Visitor-Id header
 * only; there is no cross-visitor access path.
 */
module.exports = function transactionsRoutes({ store }) {
  const router = express.Router();

  router.get(
    "/transactions",
    asyncHandler(async (req, res) => {
      const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
      const before = req.query.before || null;
      const items = await store.listTransactions({ visitorId: req.visitorId, limit, before });
      const nextBefore = items.length === limit ? items[items.length - 1].createdAt : null;
      res.json({ count: items.length, items, nextBefore });
    })
  );

  router.get(
    "/transactions/:id",
    asyncHandler(async (req, res) => {
      const txn = await store.getTransaction(req.params.id, req.visitorId);
      if (!txn) return res.status(404).json({ error: "Transaction not found." });
      res.json(txn);
    })
  );

  return router;
};
