-- ============================================================================
-- Migration: 20260929_040000_add_sequential_receipt_counters.sql
-- Sedona Court PMS Sequential Receipt & Deposit Number Generation Engine
-- Atomic counters per cashier_code, shift_code, and business_date (MMDDYY)
-- ============================================================================

CREATE TABLE IF NOT EXISTS receipt_counters (
  cashier_code   VARCHAR(10) NOT NULL,
  shift_code     VARCHAR(2) NOT NULL,
  business_date  VARCHAR(10) NOT NULL,
  last_value     BIGINT NOT NULL DEFAULT 0,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cashier_code, shift_code, business_date)
);

CREATE TABLE IF NOT EXISTS deposit_counters (
  cashier_code   VARCHAR(10) NOT NULL,
  shift_code     VARCHAR(2) NOT NULL,
  business_date  VARCHAR(10) NOT NULL,
  last_value     BIGINT NOT NULL DEFAULT 0,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cashier_code, shift_code, business_date)
);
