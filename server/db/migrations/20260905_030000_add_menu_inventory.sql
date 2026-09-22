-- Migration: 20260905_030000_add_menu_inventory.sql
-- Creates inventory_events append-only ledger, menu_item_inventory availability table,
-- and negative inventory prevention trigger.

CREATE TABLE IF NOT EXISTS menu_item_inventory (
  item_id          TEXT PRIMARY KEY,
  item_name        TEXT NOT NULL,
  category         TEXT NOT NULL,
  current_quantity INTEGER NOT NULL DEFAULT 0 CHECK (current_quantity >= 0),
  is_tracked       INTEGER NOT NULL DEFAULT 1,
  last_event_id    TEXT,
  last_shift_id    TEXT,
  last_updated_by  TEXT,
  updated_at       TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_menu_inv_category ON menu_item_inventory(category);
CREATE INDEX IF NOT EXISTS idx_menu_inv_tracked ON menu_item_inventory(is_tracked);

CREATE TABLE IF NOT EXISTS inventory_events (
  id               TEXT PRIMARY KEY,
  item_id          TEXT NOT NULL,
  item_name        TEXT NOT NULL,
  event_type       TEXT NOT NULL CHECK (event_type IN ('stock_set', 'sold', 'adjustment')),
  quantity_change  INTEGER NOT NULL,
  balance_after    INTEGER NOT NULL CHECK (balance_after >= 0),
  shift_id         TEXT NOT NULL,
  shift_type       TEXT NOT NULL CHECK (shift_type IN ('DAY', 'NIGHT')),
  reference_id     TEXT,
  operator         TEXT NOT NULL,
  notes            TEXT,
  created_at       TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_inv_events_item ON inventory_events(item_id);
CREATE INDEX IF NOT EXISTS idx_inv_events_shift ON inventory_events(shift_id);
CREATE INDEX IF NOT EXISTS idx_inv_events_date ON inventory_events(created_at);
CREATE INDEX IF NOT EXISTS idx_inv_events_type ON inventory_events(event_type);

CREATE TRIGGER IF NOT EXISTS trg_prevent_negative_inventory
BEFORE INSERT ON inventory_events
FOR EACH ROW
WHEN NEW.balance_after < 0
BEGIN
  SELECT RAISE(ABORT, 'Inventory quantity cannot be negative');
END;
