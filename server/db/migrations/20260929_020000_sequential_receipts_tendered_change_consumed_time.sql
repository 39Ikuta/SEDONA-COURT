-- Migration: 20260929_020000_sequential_receipts_tendered_change_consumed_time.sql
-- 1. Receipt sequences counter table for strictly increasing sequential receipt numbering
-- 2. Tendered and change columns in integer centavos
-- 3. Consumed minutes column for durable historical stay duration
-- 4. Idempotency key, status, void tracking, and reprint metadata

CREATE TABLE IF NOT EXISTS receipt_sequences (
  name        VARCHAR(50) PRIMARY KEY,
  prefix      VARCHAR(20) NOT NULL DEFAULT 'SCTI',
  last_value  BIGINT NOT NULL DEFAULT 43,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO receipt_sequences (name, prefix, last_value)
VALUES ('default', 'SCTI', 43);

ALTER TABLE receipts ADD COLUMN amount_tendered_cents INTEGER DEFAULT NULL;
ALTER TABLE receipts ADD COLUMN change_cents INTEGER DEFAULT NULL;
ALTER TABLE receipts ADD COLUMN consumed_minutes INTEGER DEFAULT NULL;
ALTER TABLE receipts ADD COLUMN idempotency_key TEXT DEFAULT NULL;
ALTER TABLE receipts ADD COLUMN status TEXT NOT NULL DEFAULT 'valid';
ALTER TABLE receipts ADD COLUMN void_reason TEXT DEFAULT NULL;
ALTER TABLE receipts ADD COLUMN voided_at TEXT DEFAULT NULL;
ALTER TABLE receipts ADD COLUMN voided_by TEXT DEFAULT NULL;
ALTER TABLE receipts ADD COLUMN reprint_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE receipts ADD COLUMN last_reprinted_at TEXT DEFAULT NULL;
ALTER TABLE receipts ADD COLUMN last_reprinted_by TEXT DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_idempotency_key ON receipts(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status);
