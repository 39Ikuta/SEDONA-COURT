-- ============================================================================
-- Migration: 20260929_030000_deposits_alarm_open_time_remove_cleaning.sql
-- Sedona Court PMS Full Blast Overhaul:
-- 1. Deposits table with DEP-{6-digit} sequence support and snapshot fields
-- 2. Deposit sequence seed ('deposit_default', prefix: 'DEP', last_value: 0)
-- 3. Receipts table immutable snapshot field (receipt_snapshot)
-- 4. Rooms table alarm & open time columns (billing_mode, open_time_started_at, snoozed_until, repeat_count)
-- 5. Idempotent cleaning removal: Converts any rooms with state='cleaning' to 'available'
-- ============================================================================

-- 1. Create deposits table
CREATE TABLE IF NOT EXISTS deposits (
  id VARCHAR(64) PRIMARY KEY,
  booking_id VARCHAR(64) DEFAULT NULL,
  room_id VARCHAR(32) DEFAULT NULL,
  amount_cents BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'held',
  collected_by VARCHAR(64) NOT NULL,
  collected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by VARCHAR(64) DEFAULT NULL,
  resolved_at DATETIME DEFAULT NULL,
  deposit_number VARCHAR(32) NOT NULL,
  notes TEXT DEFAULT NULL,
  refund_amount_cents BIGINT NOT NULL DEFAULT 0,
  applied_amount_cents BIGINT NOT NULL DEFAULT 0,
  linked_receipt_no VARCHAR(64) DEFAULT NULL,
  deposit_snapshot TEXT DEFAULT NULL,
  resolution_snapshot TEXT DEFAULT NULL,
  reprint_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_number ON deposits(deposit_number);
CREATE INDEX IF NOT EXISTS idx_deposits_room ON deposits(room_id);
CREATE INDEX IF NOT EXISTS idx_deposits_booking ON deposits(booking_id);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);

-- 2. Seed deposit_default sequence
INSERT INTO receipt_sequences (name, prefix, last_value)
VALUES ('deposit_default', 'DEP', 0)
ON DUPLICATE KEY UPDATE updated_at = NOW();

-- 3. Idempotently migrate existing 'cleaning' rooms to 'available'
UPDATE rooms SET state = 'available' WHERE state = 'cleaning';
