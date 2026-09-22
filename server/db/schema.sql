-- ============================================================
-- Sedona Court Travellers Inn — PostgreSQL Schema
-- Run this file once to create all tables.
-- Usage: psql -U postgres -d sedona_court -f server/db/schema.sql
-- ============================================================

-- Drop tables in dependency order (for clean re-creation)
DROP TABLE IF EXISTS pos_revenue CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS handoff_tasks CASCADE;
DROP TABLE IF EXISTS receipts CASCADE;
DROP TABLE IF EXISTS scheduled_bookings CASCADE;
DROP TABLE IF EXISTS billable_services CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================================
-- USERS
-- Stores all operator accounts. Passwords are bcrypt-hashed.
-- ============================================================
CREATE TABLE users (
  id               SERIAL PRIMARY KEY,
  username         VARCHAR(50) UNIQUE NOT NULL,
  name             VARCHAR(100) NOT NULL,
  role             VARCHAR(20) NOT NULL
                   CHECK (role IN ('kitchen', 'cashier', 'admin', 'owner', 'customer_display')),
  access_code_hash VARCHAR(255) NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROOMS
-- Represents each physical hotel apartment and its live state.
-- charged_food is stored as JSONB: Array<{ item: POSItem; quantity: number }>
-- ============================================================
CREATE TABLE rooms (
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
  custom_hours   INTEGER DEFAULT NULL,
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
-- Advance reservations from the Booking Calendar.
-- ============================================================
CREATE TABLE scheduled_bookings (
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
-- Full checkout receipt records (never deleted).
-- items is JSONB: Array<{ description: string; subtext: string; amount: number }>
-- ============================================================
CREATE TABLE receipts (
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
  discount_type   VARCHAR(20) DEFAULT NULL,
  discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  discount_id_ref VARCHAR(100) DEFAULT NULL,
  rate_selected   VARCHAR(20) DEFAULT NULL,
  stay_duration   VARCHAR(50) DEFAULT NULL,
  cashier_id      VARCHAR(50),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- BILLABLE SERVICES
-- Room rates, menu items, and service add-ons.
-- Supports soft-delete via is_deleted flag.
-- ============================================================
CREATE TABLE billable_services (
  id                VARCHAR(100) PRIMARY KEY,
  type              VARCHAR(20) NOT NULL
                    CHECK (type IN ('room_rate', 'menu_item', 'service')),
  name              VARCHAR(200) NOT NULL,
  price             NUMERIC(10, 2) NOT NULL,
  category          VARCHAR(100) NOT NULL,
  active            BOOLEAN DEFAULT TRUE,
  description       TEXT,
  rate_type         VARCHAR(10),          -- '3h', '12h', '24h', 'promo' (room_rate only)
  weekday_override  NUMERIC(10, 2),
  weekend_override  NUMERIC(10, 2),
  seasonal_override NUMERIC(10, 2),
  seasonal_start    VARCHAR(5),           -- MM-DD format
  seasonal_end      VARCHAR(5),           -- MM-DD format
  image_url         TEXT,
  is_deleted        BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOGS
-- Administrative audit trail for settings changes.
-- ============================================================
CREATE TABLE audit_logs (
  id         VARCHAR(100) PRIMARY KEY,
  timestamp  TIMESTAMPTZ NOT NULL,
  operator   VARCHAR(100) NOT NULL,
  action     VARCHAR(100) NOT NULL,
  details    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- HANDOFF TASKS
-- Shift turnover checklist items.
-- ============================================================
CREATE TABLE handoff_tasks (
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
-- Aggregated daily point-of-sale revenue by category.
-- One row per calendar date.
-- ============================================================
CREATE TABLE pos_revenue (
  id         SERIAL PRIMARY KEY,
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  kitchen    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  drinks     NUMERIC(10, 2) NOT NULL DEFAULT 0,
  miscell    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (date)
);

-- Indexes for commonly queried columns
CREATE INDEX idx_rooms_state ON rooms(state);
CREATE INDEX idx_rooms_number ON rooms(number);
CREATE INDEX idx_bookings_status ON scheduled_bookings(status);
CREATE INDEX idx_bookings_dates ON scheduled_bookings(check_in_date, check_out_date);
CREATE INDEX idx_receipts_date ON receipts(date_time);
CREATE INDEX idx_receipts_room ON receipts(room_number);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_pos_revenue_date ON pos_revenue(date);
