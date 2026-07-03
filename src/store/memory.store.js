"use strict";

const crypto = require("crypto");
const logger = require("../logger");

/**
 * In-memory transaction store. Zero configuration, resets on restart.
 * Good for local dev and quick public demos. For durable history, set
 * DATABASE_URL to switch to the Postgres store (same interface).
 *
 * Capped to MAX_RECORDS to bound memory on a long-running public instance.
 */
const MAX_RECORDS = 1000;

class MemoryStore {
  constructor() {
    this.byId = new Map(); // id -> transaction (with inline actions)
    this.order = []; // ids, oldest → newest
  }

  async init() {
    logger.info("Transaction store: in-memory (non-persistent)");
  }

  async close() {}

  async insertTransaction(txn) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const record = { id, createdAt: now, updatedAt: now, actions: [], ...txn };
    this.byId.set(id, record);
    this.order.push(id);
    while (this.order.length > MAX_RECORDS) {
      const evict = this.order.shift();
      this.byId.delete(evict);
    }
    return { ...record };
  }

  async updateTransaction(id, patch) {
    const rec = this.byId.get(id);
    if (!rec) return null;
    Object.assign(rec, patch, { updatedAt: new Date().toISOString() });
    return { ...rec };
  }

  async appendAction(transactionId, action) {
    const rec = this.byId.get(transactionId);
    if (!rec) return null;
    const entry = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...action };
    rec.actions.push(entry);
    rec.updatedAt = entry.createdAt;
    return { ...entry };
  }

  /** Atomic: persist a new transaction together with its first action. */
  async recordAuthorization(txn, action) {
    const saved = await this.insertTransaction(txn);
    if (action) await this.appendAction(saved.id, action);
    return saved;
  }

  /** Cheap ownership check (no action rows fetched). */
  async ownsTransaction(id, visitorId) {
    const rec = this.byId.get(id);
    return Boolean(rec && rec.visitorId === visitorId);
  }

  /**
   * Atomic + visitor-scoped: append an action and patch status in one step.
   * Returns false (a no-op) when the transaction isn't owned by this visitor.
   */
  async recordAction(id, visitorId, action, statusPatch) {
    const rec = this.byId.get(id);
    if (!rec || rec.visitorId !== visitorId) return false;
    await this.appendAction(id, action);
    if (statusPatch) await this.updateTransaction(id, statusPatch);
    return true;
  }

  async listTransactions({ visitorId, limit = 25, before = null }) {
    if (!visitorId) return [];
    const results = [];
    // Walk newest → oldest.
    for (let i = this.order.length - 1; i >= 0; i--) {
      const rec = this.byId.get(this.order[i]);
      if (!rec || rec.visitorId !== visitorId) continue;
      if (before && rec.createdAt >= before) continue;
      results.push(this.#summary(rec));
      if (results.length >= limit) break;
    }
    return results;
  }

  async getTransaction(id, visitorId) {
    const rec = this.byId.get(id);
    if (!rec || (visitorId && rec.visitorId !== visitorId)) return null;
    return { ...rec, actions: [...rec.actions] };
  }

  #summary(rec) {
    return {
      id: rec.id,
      reference: rec.reference,
      paymentId: rec.paymentId,
      cardBrand: rec.cardBrand,
      cardLast4: rec.cardLast4,
      amountMinor: rec.amountMinor,
      currency: rec.currency,
      status: rec.status,
      approved: rec.approved,
      eci: rec.eci,
      threeDsVersion: rec.threeDsVersion,
      liabilityShift: rec.liabilityShift,
      responseSummary: rec.responseSummary,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      actionCount: rec.actions.length,
    };
  }
}

module.exports = { MemoryStore };
