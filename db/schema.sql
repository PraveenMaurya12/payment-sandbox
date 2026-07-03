-- Payment Sandbox — Postgres schema
-- Stores transaction METADATA only. No PAN, no CVV, no cardholder name, no PII.
-- Applied automatically on boot when DATABASE_URL is set (see src/store/postgres.store.js).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- for gen_random_uuid()

CREATE TABLE IF NOT EXISTS transactions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id        TEXT        NOT NULL,           -- opaque, browser-generated (anonymous)
    reference         TEXT        NOT NULL,
    session_id        TEXT,                           -- Evervault 3DS session id
    payment_id        TEXT,                           -- Checkout.com payment id (pay_xxx)
    card_brand        TEXT,                           -- Visa / Mastercard / ...
    card_last4        VARCHAR(4),                     -- last 4 digits only
    amount_minor      INTEGER     NOT NULL,           -- amount in minor units (e.g. cents)
    currency          VARCHAR(3)  NOT NULL,
    status            TEXT        NOT NULL,           -- Authorized / Captured / Declined / Voided / Refunded / ...
    approved          BOOLEAN,
    eci               TEXT,
    three_ds_version  TEXT,
    liability_shift   BOOLEAN,
    response_summary  TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tx_visitor_created
    ON transactions (visitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_payment
    ON transactions (payment_id);

CREATE TABLE IF NOT EXISTS transaction_actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID        NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    action_type     TEXT        NOT NULL,             -- authorize / capture / void / refund
    amount_minor    INTEGER,
    status          TEXT,
    action_ref      TEXT,                             -- Checkout action_id or reference
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_action_tx
    ON transaction_actions (transaction_id, created_at ASC);
