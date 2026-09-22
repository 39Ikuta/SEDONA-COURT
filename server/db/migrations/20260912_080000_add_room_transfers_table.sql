-- Migration: Add room_transfers table for tracking guest room relocations
-- Tracks source room, target room, reason, operator, food ledger snapshot, and timestamps.

CREATE TABLE IF NOT EXISTS room_transfers (
  id VARCHAR(64) PRIMARY KEY,
  source_room_number VARCHAR(16) NOT NULL,
  target_room_number VARCHAR(16) NOT NULL,
  guest_name VARCHAR(255) NOT NULL,
  guest_id VARCHAR(100),
  reason VARCHAR(255) NOT NULL,
  transferred_by VARCHAR(100) NOT NULL,
  transferred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  source_tier VARCHAR(50),
  target_tier VARCHAR(50),
  rate_selected VARCHAR(20),
  charged_food TEXT,
  price_difference REAL DEFAULT 0.00,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_room_transfers_time ON room_transfers(transferred_at);
CREATE INDEX IF NOT EXISTS idx_room_transfers_source ON room_transfers(source_room_number);
CREATE INDEX IF NOT EXISTS idx_room_transfers_target ON room_transfers(target_room_number);
