-- Migration: Add Weekly Reporting Tables
-- Created: 2026-08-04T12:00:00.000Z
--
-- Adds comprehensive weekly reporting infrastructure:
-- - weekly_shift_entries: Tracks 14 daily shift records (7 days × 2 shifts)
-- - weekly_expenses: Operational and administrative expenses
-- - gcash_entries: GCash transaction audit trail
-- - cash_denomination_report: Cash counting/denomination tracking

-- ============================================================
-- WEEKLY SHIFT ENTRIES
-- Stores daily shift records: 14 rows per week (7 days × 2 shifts)
-- ============================================================
CREATE TABLE IF NOT EXISTS weekly_shift_entries (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  day_of_week VARCHAR(10) NOT NULL CHECK (day_of_week IN ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN')),
  shift_type VARCHAR(10) NOT NULL CHECK (shift_type IN ('DAY', 'NIGHT')),
  cashier_name VARCHAR(50) NOT NULL,
  
  -- Activity counts
  total_checkins INTEGER NOT NULL DEFAULT 0,
  checkout_count INTEGER NOT NULL DEFAULT 0,
  transfer_count INTEGER NOT NULL DEFAULT 0,
  
  -- Revenue breakdown (all in PHP)
  room_bill NUMERIC(10, 2) NOT NULL DEFAULT 0,
  kitchen_bill NUMERIC(10, 2) NOT NULL DEFAULT 0,
  drinks_bill NUMERIC(10, 2) NOT NULL DEFAULT 0,
  miscell_purchases NUMERIC(10, 2) NOT NULL DEFAULT 0,
  extras NUMERIC(10, 2) NOT NULL DEFAULT 0,
  discount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  payment_received NUMERIC(10, 2) NOT NULL DEFAULT 0,
  
  -- Metadata
  week_number INTEGER NOT NULL,
  year INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(date, shift_type)
);

-- ============================================================
-- WEEKLY EXPENSES
-- Two-column expense tracking matching your format
-- ============================================================
CREATE TABLE IF NOT EXISTS weekly_expenses (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  
  -- Column 1: Operations & Kitchen Supplies
  kitchen_expenses NUMERIC(10, 2) NOT NULL DEFAULT 0,
  wilkins_pure NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ate_lanie_beddings NUMERIC(10, 2) NOT NULL DEFAULT 0,
  krico_gas_laundry NUMERIC(10, 2) NOT NULL DEFAULT 0,
  tissue_flexi_cling NUMERIC(10, 2) NOT NULL DEFAULT 0,
  miscellaneous NUMERIC(10, 2) NOT NULL DEFAULT 0,
  kovi NUMERIC(10, 2) NOT NULL DEFAULT 0,
  cm_surc_rh NUMERIC(10, 2) NOT NULL DEFAULT 0,
  lempo NUMERIC(10, 2) NOT NULL DEFAULT 0,
  marbont NUMERIC(10, 2) NOT NULL DEFAULT 0,
  aquapura NUMERIC(10, 2) NOT NULL DEFAULT 0,
  andeng_store NUMERIC(10, 2) NOT NULL DEFAULT 0,
  george_cable NUMERIC(10, 2) NOT NULL DEFAULT 0,
  rh_meat NUMERIC(10, 2) NOT NULL DEFAULT 0,
  coke_zero NUMERIC(10, 2) NOT NULL DEFAULT 0,
  short_pau NUMERIC(10, 2) NOT NULL DEFAULT 0,
  venyen_zonrox NUMERIC(10, 2) NOT NULL DEFAULT 0,
  
  -- Column 2: Admin & Personnel
  vale_pau_cam_id NUMERIC(10, 2) NOT NULL DEFAULT 0,
  admin_gretch_sa NUMERIC(10, 2) NOT NULL DEFAULT 0,
  
  -- Additional custom expenses stored as JSONB
  -- Format: [{ "name": "description", "amount": 0, "category": "col1|col2" }]
  custom_expenses JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Calculated totals
  total_expenses_col1 NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_expenses_col2 NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_expenses NUMERIC(10, 2) NOT NULL DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(week_start)
);

-- ============================================================
-- GCASH ENTRIES
-- Tracks GCash transactions with reference numbers for audit
-- ============================================================
CREATE TABLE IF NOT EXISTS gcash_entries (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  shift_type VARCHAR(10) NOT NULL CHECK (shift_type IN ('DAY', 'NIGHT')),
  reference_number VARCHAR(100),
  amount NUMERIC(10, 2) NOT NULL,
  
  -- Details for audit trail
  guest_name VARCHAR(100),
  room_number VARCHAR(10),
  receipt_no VARCHAR(50),
  cashier_id VARCHAR(50),
  
  -- Metadata
  week_number INTEGER NOT NULL,
  year INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  FOREIGN KEY (receipt_no) REFERENCES receipts(receipt_no) ON DELETE SET NULL
);

-- ============================================================
-- CASH DENOMINATION REPORT
-- Records the physical cash counting at end of week/day
-- ============================================================
CREATE TABLE IF NOT EXISTS cash_denomination_report (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL,
  report_date DATE NOT NULL,
  
  -- Denomination counts
  bills_1000_count INTEGER NOT NULL DEFAULT 0,
  bills_500_count INTEGER NOT NULL DEFAULT 0,
  bills_200_count INTEGER NOT NULL DEFAULT 0,
  bills_100_count INTEGER NOT NULL DEFAULT 0,
  bills_50_count INTEGER NOT NULL DEFAULT 0,
  coins_total NUMERIC(10, 2) NOT NULL DEFAULT 0,
  
  -- Calculated totals
  total_1000 NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_500 NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_200 NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_100 NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_50 NUMERIC(10, 2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(10, 2) NOT NULL DEFAULT 0,
  
  -- Audit trail
  received_by VARCHAR(100),
  counted_by VARCHAR(100),
  verified_by VARCHAR(100),
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(report_date)
);

-- ============================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_weekly_shift_entries_date 
  ON weekly_shift_entries(date DESC);

CREATE INDEX IF NOT EXISTS idx_weekly_shift_entries_week 
  ON weekly_shift_entries(year DESC, week_number DESC);

CREATE INDEX IF NOT EXISTS idx_weekly_expenses_week 
  ON weekly_expenses(week_start DESC);

CREATE INDEX IF NOT EXISTS idx_gcash_entries_date 
  ON gcash_entries(date DESC);

CREATE INDEX IF NOT EXISTS idx_gcash_entries_week 
  ON gcash_entries(year DESC, week_number DESC);

CREATE INDEX IF NOT EXISTS idx_cash_denom_report_week 
  ON cash_denomination_report(week_start DESC);

CREATE INDEX IF NOT EXISTS idx_cash_denom_report_date 
  ON cash_denomination_report(report_date DESC);
