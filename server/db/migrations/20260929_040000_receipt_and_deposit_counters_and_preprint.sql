-- ============================================================================
-- Migration: 20260929_040000_receipt_and_deposit_counters_and_preprint.sql
-- 1. Table `receipt_counters` (cashier_code, shift_code, business_date, last_value, updated_at)
-- 2. Table `deposit_counters` (cashier_code, shift_code, business_date, last_value, updated_at)
-- 3. Add `allocated_receipt_no` column to `rooms` table
-- 4. Add `allocated_receipt_no` column to `scheduled_bookings` table
-- ============================================================================

CREATE TABLE IF NOT EXISTS receipt_counters (
  cashier_code   VARCHAR(10) NOT NULL,
  shift_code     VARCHAR(5) NOT NULL,
  business_date  VARCHAR(10) NOT NULL,
  last_value     BIGINT NOT NULL DEFAULT 0,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cashier_code, shift_code, business_date)
);

CREATE TABLE IF NOT EXISTS deposit_counters (
  cashier_code   VARCHAR(10) NOT NULL,
  shift_code     VARCHAR(5) NOT NULL,
  business_date  VARCHAR(10) NOT NULL,
  last_value     BIGINT NOT NULL DEFAULT 0,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cashier_code, shift_code, business_date)
);

ALTER TABLE rooms ADD COLUMN allocated_receipt_no VARCHAR(64) DEFAULT NULL;

ALTER TABLE scheduled_bookings ADD COLUMN allocated_receipt_no VARCHAR(64) DEFAULT NULL;
