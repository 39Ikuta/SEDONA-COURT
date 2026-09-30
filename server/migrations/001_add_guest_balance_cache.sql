/**
 * Database migration script to fix deposit race conditions (C-02)
 * Creates a materialized balance cache table with proper locking support.
 *
 * Run this migration to add the guest_balance_cache table.
 */

-- Create guest balance cache table for atomic operations
CREATE TABLE IF NOT EXISTS guest_balance_cache (
  guest_identifier TEXT PRIMARY KEY COLLATE NOCASE,
  balance_centavos INTEGER NOT NULL DEFAULT 0,
  total_in_centavos INTEGER NOT NULL DEFAULT 0,
  total_out_centavos INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lock_version INTEGER NOT NULL DEFAULT 0
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_guest_balance_updated ON guest_balance_cache(last_updated);

-- Populate initial data from existing transactions
INSERT OR REPLACE INTO guest_balance_cache (
  guest_identifier,
  balance_centavos,
  total_in_centavos,
  total_out_centavos,
  last_updated,
  lock_version
)
SELECT
  guest_identifier,
  COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_centavos ELSE -amount_centavos END), 0) AS balance_centavos,
  COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_centavos ELSE 0 END), 0) AS total_in_centavos,
  COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount_centavos ELSE 0 END), 0) AS total_out_centavos,
  datetime('now', 'localtime') AS last_updated,
  0 AS lock_version
FROM deposit_transactions
GROUP BY LOWER(guest_identifier);

-- Add audit log entry
INSERT INTO audit_logs (id, timestamp, operator, action, details)
VALUES (
  'migration-deposit-cache-' || strftime('%s', 'now') || '-' || abs(random() % 9000 + 1000),
  datetime('now', 'localtime'),
  'SYSTEM',
  'MIGRATION',
  'Created guest_balance_cache table with optimistic locking for deposit race condition prevention (C-02 fix)'
);
