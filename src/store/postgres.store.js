"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { config } = require("../config");
const logger = require("../logger");

/**
 * Postgres-backed transaction store. Enabled when DATABASE_URL is set.
 * Interface matches MemoryStore so the rest of the app is storage-agnostic.
 */
class PostgresStore {
  constructor() {
    const ssl =
      /\bsslmode=require\b/.test(config.databaseUrl) || config.isProd
        ? { rejectUnauthorized: false }
        : undefined;
    this.pool = new Pool({ connectionString: config.databaseUrl, ssl, max: 10 });
  }

  async init() {
    const schema = fs.readFileSync(path.join(__dirname, "..", "..", "db", "schema.sql"), "utf8");
    await this.pool.query(schema);
    logger.info("Transaction store: Postgres (persistent)");
  }

  async close() {
    await this.pool.end();
  }

  async insertTransaction(t) {
    const { rows } = await this.pool.query(
      `INSERT INTO transactions
         (visitor_id, reference, session_id, payment_id, card_brand, card_last4,
          amount_minor, currency, status, approved, eci, three_ds_version,
          liability_shift, response_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        t.visitorId, t.reference, t.sessionId, t.paymentId, t.cardBrand, t.cardLast4,
        t.amountMinor, t.currency, t.status, t.approved, t.eci, t.threeDsVersion,
        t.liabilityShift, t.responseSummary,
      ]
    );
    return mapTx(rows[0]);
  }

  async updateTransaction(id, patch) {
    const fields = [];
    const values = [];
    let i = 1;
    const col = {
      paymentId: "payment_id",
      status: "status",
      approved: "approved",
      eci: "eci",
      threeDsVersion: "three_ds_version",
      liabilityShift: "liability_shift",
      responseSummary: "response_summary",
    };
    for (const [k, v] of Object.entries(patch)) {
      if (!col[k]) continue;
      fields.push(`${col[k]} = $${i++}`);
      values.push(v);
    }
    if (!fields.length) return this.getTransaction(id, null);
    values.push(id);
    const { rows } = await this.pool.query(
      `UPDATE transactions SET ${fields.join(", ")}, updated_at = now()
       WHERE id = $${i} RETURNING *`,
      values
    );
    return rows[0] ? mapTx(rows[0]) : null;
  }

  async appendAction(transactionId, action) {
    const { rows } = await this.pool.query(
      `INSERT INTO transaction_actions (transaction_id, action_type, amount_minor, status, action_ref)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [transactionId, action.actionType, action.amountMinor ?? null, action.status ?? null, action.actionRef ?? null]
    );
    await this.pool.query(`UPDATE transactions SET updated_at = now() WHERE id = $1`, [transactionId]);
    return mapAction(rows[0]);
  }

  /** Atomic: insert the transaction and its first action in a single tx. */
  async recordAuthorization(txn, action) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO transactions
           (visitor_id, reference, session_id, payment_id, card_brand, card_last4,
            amount_minor, currency, status, approved, eci, three_ds_version,
            liability_shift, response_summary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          txn.visitorId, txn.reference, txn.sessionId, txn.paymentId, txn.cardBrand, txn.cardLast4,
          txn.amountMinor, txn.currency, txn.status, txn.approved, txn.eci, txn.threeDsVersion,
          txn.liabilityShift, txn.responseSummary,
        ]
      );
      const saved = mapTx(rows[0]);
      if (action) {
        await client.query(
          `INSERT INTO transaction_actions (transaction_id, action_type, amount_minor, status, action_ref)
           VALUES ($1,$2,$3,$4,$5)`,
          [saved.id, action.actionType, action.amountMinor ?? null, action.status ?? null, action.actionRef ?? null]
        );
      }
      await client.query("COMMIT");
      return saved;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Cheap ownership check — a single indexed lookup, no action rows fetched. */
  async ownsTransaction(id, visitorId) {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM transactions WHERE id = $1 AND visitor_id = $2`,
      [id, visitorId]
    );
    return rowCount > 0;
  }

  /**
   * Atomic + visitor-scoped: lock the row, append an action, patch status.
   * Returns false (a no-op) when the transaction isn't owned by this visitor.
   */
  async recordAction(id, visitorId, action, statusPatch) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rowCount } = await client.query(
        `SELECT 1 FROM transactions WHERE id = $1 AND visitor_id = $2 FOR UPDATE`,
        [id, visitorId]
      );
      if (!rowCount) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `INSERT INTO transaction_actions (transaction_id, action_type, amount_minor, status, action_ref)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, action.actionType, action.amountMinor ?? null, action.status ?? null, action.actionRef ?? null]
      );
      if (statusPatch && statusPatch.status) {
        await client.query(`UPDATE transactions SET status = $1, updated_at = now() WHERE id = $2`, [
          statusPatch.status,
          id,
        ]);
      } else {
        await client.query(`UPDATE transactions SET updated_at = now() WHERE id = $1`, [id]);
      }
      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listTransactions({ visitorId, limit = 25, before = null }) {
    if (!visitorId) return [];
    const params = [visitorId];
    let where = "visitor_id = $1";
    if (before) {
      params.push(before);
      where += ` AND created_at < $${params.length}`;
    }
    params.push(limit);
    const { rows } = await this.pool.query(
      `SELECT t.*, COALESCE(a.cnt, 0) AS action_count
         FROM transactions t
         LEFT JOIN (SELECT transaction_id, COUNT(*) cnt FROM transaction_actions GROUP BY transaction_id) a
           ON a.transaction_id = t.id
        WHERE ${where}
        ORDER BY t.created_at DESC
        LIMIT $${params.length}`,
      params
    );
    return rows.map(mapTx);
  }

  async getTransaction(id, visitorId) {
    const params = [id];
    let where = "id = $1";
    if (visitorId) {
      params.push(visitorId);
      where += ` AND visitor_id = $2`;
    }
    const { rows } = await this.pool.query(`SELECT * FROM transactions WHERE ${where}`, params);
    if (!rows[0]) return null;
    const tx = mapTx(rows[0]);
    const { rows: actions } = await this.pool.query(
      `SELECT * FROM transaction_actions WHERE transaction_id = $1 ORDER BY created_at ASC`,
      [id]
    );
    tx.actions = actions.map(mapAction);
    return tx;
  }
}

function mapTx(r) {
  return {
    id: r.id,
    visitorId: r.visitor_id,
    reference: r.reference,
    sessionId: r.session_id,
    paymentId: r.payment_id,
    cardBrand: r.card_brand,
    cardLast4: r.card_last4,
    amountMinor: r.amount_minor,
    currency: r.currency,
    status: r.status,
    approved: r.approved,
    eci: r.eci,
    threeDsVersion: r.three_ds_version,
    liabilityShift: r.liability_shift,
    responseSummary: r.response_summary,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    actionCount: r.action_count != null ? Number(r.action_count) : undefined,
  };
}

function mapAction(r) {
  return {
    id: r.id,
    actionType: r.action_type,
    amountMinor: r.amount_minor,
    status: r.status,
    actionRef: r.action_ref,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

module.exports = { PostgresStore };
