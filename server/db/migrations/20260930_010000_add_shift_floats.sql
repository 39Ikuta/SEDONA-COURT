-- Shift float tracking: replaces hardcoded ₱5000 across settlement/handoff/export.
CREATE TABLE IF NOT EXISTS shift_floats (
  shift_date TEXT NOT NULL,
  shift_type TEXT NOT NULL CHECK (shift_type IN ('DAY','NIGHT')),
  opening_float INTEGER NOT NULL DEFAULT 500000,
  closing_float INTEGER,
  counted_by TEXT,
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (shift_date, shift_type)
);
