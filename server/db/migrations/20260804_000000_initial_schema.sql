-- Migration: Initial Schema
-- Created: 2026-08-04T00:00:00.000Z
-- 
-- This migration represents the initial database schema.
-- It is a documentation migration and should only run on fresh databases.

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id               SERIAL PRIMARY KEY,
  username         VARCHAR(50) UNIQUE NOT NULL,
  name             VARCHAR(100) NOT NULL,
  role             VARCHAR(20) NOT NULL
                   CHECK (role IN ('kitchen', 'cashier', 'admin', 'owner')),
  access_code_hash VARCHAR(255) NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROOMS
-- ============================================================
CREATE TABLE IF NOT EXISTS rooms (
  id             SERIAL PRIMARY KEY,
  number         VARCHAR(10) UNIQUE NOT NULL,
  tier           VARCHAR(20) NOT NULL
                 CHECK (tier IN ('Standard', 'Deluxe', 'Suite')),
  floor          INTEGER NOT NULL DEFAULT 1,
  room_type      VARCHAR(50) NOT NULL,
  state          VARCHAR(20) NOT NULL DEFAULT 'available'
                 CHECK (state IN ('available', 'occupied', 'cleaning', 'overdue', 'maintenance')),
  label          VARCHAR(100) DEFAULT 'Available',
  guest_name     VARCHAR(100) DEFAULT '',
  guest_id       VARCHAR(100) DEFAULT '',
  num_guests     INTEGER DEFAULT 0,
  rate_selected  VARCHAR(10) DEFAULT '24h',
  extra_beds     INTEGER DEFAULT 0,
  towel_sets     INTEGER DEFAULT 0,
  check_in_time  TIMESTAMPTZ,
  check_out_time TIMESTAMPTZ,
  is_overdue     BOOLEAN DEFAULT FALSE,
  charged_food   JSONB DEFAULT '[]'::jsonb,
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SCHEDULED BOOKINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS scheduled_bookings (
  id             VARCHAR(50) PRIMARY KEY,
  room_number    VARCHAR(10) NOT NULL,
  guest_name     VARCHAR(100) NOT NULL,
  guest_id       VARCHAR(100),
  check_in_date  DATE NOT NULL,
  check_out_date DATE NOT NULL,
  rate_selected  VARCHAR(10) NOT NULL,
  num_guests     INTEGER DEFAULT 1,
  status         VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled', 'checked-in', 'cancelled')),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RECEIPTS
-- ============================================================
CREATE TABLE IF NOT EXISTS receipts (
  receipt_no      VARCHAR(50) PRIMARY KEY,
  date_time       TIMESTAMPTZ NOT NULL,
  guest_name      VARCHAR(100),
  room_number     VARCHAR(10),
  room_type       VARCHAR(50),
  payment_method  VARCHAR(10) NOT NULL
                  CHECK (payment_method IN ('CASH', 'GCASH', 'MIXED')),
  gcash_ref       VARCHAR(100),
  cash_amount     NUMERIC(10, 2),
  gcash_amount    NUMERIC(10, 2),
  check_in        TIMESTAMPTZ,
  check_out       TIMESTAMPTZ,
  items           JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal        NUMERIC(10, 2) NOT NULL DEFAULT 0,
  service_charge  NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total           NUMERIC(10, 2) NOT NULL DEFAULT 0,
  cashier_id      VARCHAR(50),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- BILLABLE SERVICES
-- ============================================================
CREATE TABLE IF NOT EXISTS billable_services (
  id                VARCHAR(100) PRIMARY KEY,
  type              VARCHAR(20) NOT NULL
                    CHECK (type IN ('room_rate', 'menu_item', 'service')),
  name              VARCHAR(200) NOT NULL,
  price             NUMERIC(10, 2) NOT NULL,
  category          VARCHAR(100) NOT NULL,
  active            BOOLEAN DEFAULT TRUE,
  description       TEXT,
  rate_type         VARCHAR(10),
  weekday_override  NUMERIC(10, 2),
  weekend_override  NUMERIC(10, 2),
  seasonal_override NUMERIC(10, 2),
  seasonal_start    VARCHAR(5),
  seasonal_end      VARCHAR(5),
  image_url         TEXT,
  is_deleted        BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id         VARCHAR(100) PRIMARY KEY,
  timestamp  TIMESTAMPTZ NOT NULL,
  operator   VARCHAR(100) NOT NULL,
  action     VARCHAR(100) NOT NULL,
  details    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- HANDOFF TASKS
-- ============================================================
CREATE TABLE IF NOT EXISTS handoff_tasks (
  id          VARCHAR(100) PRIMARY KEY,
  text        TEXT NOT NULL,
  completed   BOOLEAN DEFAULT FALSE,
  priority    VARCHAR(10) DEFAULT 'medium'
              CHECK (priority IN ('low', 'medium', 'high')),
  assigned_to VARCHAR(100),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- POS REVENUE
-- ============================================================
CREATE TABLE IF NOT EXISTS pos_revenue (
  id         SERIAL PRIMARY KEY,
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  kitchen    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  drinks     NUMERIC(10, 2) NOT NULL DEFAULT 0,
  miscell    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (date)
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_rooms_state ON rooms(state);
CREATE INDEX IF NOT EXISTS idx_rooms_number ON rooms(number);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON scheduled_bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON scheduled_bookings(check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(date_time);
CREATE INDEX IF NOT EXISTS idx_receipts_room ON receipts(room_number);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_pos_revenue_date ON pos_revenue(date);
