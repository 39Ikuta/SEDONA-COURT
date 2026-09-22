-- Migration: 20260905_000000_add_deposit_transactions.sql
-- Creates deposit_transactions ledger table and negative balance prevention trigger

CREATE TABLE IF NOT EXISTS deposit_transactions (
  id                    TEXT PRIMARY KEY,
  guest_identifier      TEXT NOT NULL,
  guest_name            TEXT,
  amount_centavos       INTEGER NOT NULL CHECK (amount_centavos > 0),
  direction             TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  payment_method        TEXT CHECK (payment_method IN ('CASH', 'GCASH', 'MIXED', 'BALANCE_APPLIED')),
  cash_amount_centavos  INTEGER DEFAULT 0,
  gcash_amount_centavos INTEGER DEFAULT 0,
  reference_id          TEXT,
  idempotency_key       TEXT NOT NULL UNIQUE,
  booking_id            TEXT,
  room_number           TEXT,
  receipt_no            TEXT,
  notes                 TEXT,
  operator              TEXT NOT NULL,
  created_at            TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_deposit_tx_guest ON deposit_transactions(guest_identifier);
CREATE INDEX IF NOT EXISTS idx_deposit_tx_idempotency ON deposit_transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_deposit_tx_created ON deposit_transactions(created_at);

CREATE TRIGGER IF NOT EXISTS trg_prevent_negative_deposit_balance
BEFORE INSERT ON deposit_transactions
FOR EACH ROW
WHEN NEW.direction = 'OUT'
BEGIN
  SELECT CASE
    WHEN (
      (SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_centavos ELSE -amount_centavos END), 0)
       FROM deposit_transactions
       WHERE guest_identifier = NEW.guest_identifier) < NEW.amount_centavos
    )
    THEN RAISE(ABORT, 'Insufficient deposit balance: transaction would result in negative balance')
  END;
END;
