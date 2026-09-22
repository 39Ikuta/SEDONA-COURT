-- Migration: Add shift_expenses table for cashier end-of-shift operating expenses

CREATE TABLE IF NOT EXISTS shift_expenses (
  id          TEXT PRIMARY KEY,
  shift_date  TEXT NOT NULL,
  shift_type  TEXT NOT NULL CHECK (shift_type IN ('DAY', 'NIGHT')),
  cashier_id  TEXT NOT NULL,
  description TEXT NOT NULL,
  amount      REAL NOT NULL DEFAULT 0.00,
  created_at  TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_shift_expenses_date ON shift_expenses(shift_date, shift_type);
CREATE INDEX IF NOT EXISTS idx_shift_expenses_cashier ON shift_expenses(cashier_id);
