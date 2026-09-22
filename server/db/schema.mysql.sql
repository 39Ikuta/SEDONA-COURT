-- ============================================================
-- Sedona Court Travellers Inn — MySQL Schema
-- Run this complete script in MySQL Workbench to create all tables.
-- ============================================================

-- Create database if not exists
CREATE DATABASE IF NOT EXISTS sedona_court
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE sedona_court;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS gcash_entries;
DROP TABLE IF EXISTS cash_denomination_report;
DROP TABLE IF EXISTS weekly_expenses;
DROP TABLE IF EXISTS weekly_shift_entries;
DROP TABLE IF EXISTS kitchen_orders;
DROP TABLE IF EXISTS pos_revenue;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS handoff_tasks;
DROP TABLE IF EXISTS receipts;
DROP TABLE IF EXISTS scheduled_bookings;
DROP TABLE IF EXISTS billable_services;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS schema_migrations;

-- ============================================================
-- SCHEMA MIGRATIONS (for migration runner)
-- ============================================================
CREATE TABLE schema_migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(255) NOT NULL UNIQUE,
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- USERS
-- Stores all operator accounts. Passwords are bcrypt-hashed.
-- Roles: 'kitchen', 'cashier', 'admin', 'owner'
-- ============================================================
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  role ENUM('kitchen', 'cashier', 'admin', 'owner', 'customer_display') NOT NULL,
  access_code_hash VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- ROOMS
-- Physical hotel rooms and live occupancy state.
-- charged_food is stored as JSON: Array<{ item: POSItem; quantity: number }>
-- ============================================================
CREATE TABLE rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(10) NOT NULL UNIQUE,
  tier ENUM('Standard', 'Deluxe', 'Suite') NOT NULL,
  floor INT NOT NULL DEFAULT 1,
  room_type VARCHAR(50) NOT NULL,
  state ENUM('available', 'occupied', 'cleaning', 'overdue', 'maintenance') NOT NULL DEFAULT 'available',
  label VARCHAR(100) DEFAULT 'Available',
  guest_name VARCHAR(100) DEFAULT '',
  guest_id VARCHAR(100) DEFAULT '',
  num_guests INT DEFAULT 0,
  rate_selected VARCHAR(10) DEFAULT '24h',
  custom_hours INT NULL,
  extra_beds INT DEFAULT 0,
  towel_sets INT DEFAULT 0,
  check_in_time DATETIME NULL,
  check_out_time DATETIME NULL,
  is_overdue BOOLEAN DEFAULT FALSE,
  charged_food JSON NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_rooms_state (state),
  INDEX idx_rooms_number (number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SCHEDULED BOOKINGS
-- Advance reservations from the Booking Calendar.
-- ============================================================
CREATE TABLE scheduled_bookings (
  id VARCHAR(50) PRIMARY KEY,
  room_number VARCHAR(10) NOT NULL,
  guest_name VARCHAR(100) NOT NULL,
  guest_id VARCHAR(100) NULL,
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  rate_selected VARCHAR(10) NOT NULL,
  num_guests INT DEFAULT 1,
  status ENUM('scheduled', 'checked-in', 'cancelled') NOT NULL DEFAULT 'scheduled',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bookings_status (status),
  INDEX idx_bookings_dates (check_in_date, check_out_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- RECEIPTS
-- Full checkout receipt records (never deleted).
-- items is JSON: Array<{ description: string; subtext: string; amount: number }>
-- ============================================================
CREATE TABLE receipts (
  receipt_no VARCHAR(50) PRIMARY KEY,
  date_time DATETIME NOT NULL,
  guest_name VARCHAR(100) NULL,
  room_number VARCHAR(10) NULL,
  room_type VARCHAR(50) NULL,
  payment_method ENUM('CASH', 'GCASH', 'MIXED') NOT NULL,
  gcash_ref VARCHAR(100) NULL,
  cash_amount DECIMAL(10, 2) NULL,
  gcash_amount DECIMAL(10, 2) NULL,
  check_in DATETIME NULL,
  check_out DATETIME NULL,
  items JSON NOT NULL,
  subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  service_charge DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  total DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  discount_type VARCHAR(20) NULL,
  discount_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  discount_id_ref VARCHAR(100) NULL,
  rate_selected VARCHAR(20) NULL,
  stay_duration VARCHAR(50) NULL,
  cashier_id VARCHAR(50) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_receipts_date (date_time),
  INDEX idx_receipts_room (room_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- BILLABLE SERVICES
-- Room rates, menu items, and service add-ons.
-- Supports soft-delete via is_deleted flag.
-- ============================================================
CREATE TABLE billable_services (
  id VARCHAR(100) PRIMARY KEY,
  type ENUM('room_rate', 'menu_item', 'service') NOT NULL,
  name VARCHAR(200) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  category VARCHAR(100) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  description TEXT NULL,
  rate_type VARCHAR(10) NULL,           -- '3h', '12h', '24h', 'promo' (room_rate only)
  weekday_override DECIMAL(10, 2) NULL,
  weekend_override DECIMAL(10, 2) NULL,
  seasonal_override DECIMAL(10, 2) NULL,
  seasonal_start VARCHAR(5) NULL,       -- MM-DD format
  seasonal_end VARCHAR(5) NULL,         -- MM-DD format
  image_url TEXT NULL,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_services_type (type),
  INDEX idx_services_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- AUDIT LOGS
-- Administrative audit trail for settings changes.
-- ============================================================
CREATE TABLE audit_logs (
  id VARCHAR(100) PRIMARY KEY,
  timestamp DATETIME NOT NULL,
  operator VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  details TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_logs_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- HANDOFF TASKS
-- Shift turnover checklist items.
-- ============================================================
CREATE TABLE handoff_tasks (
  id VARCHAR(100) PRIMARY KEY,
  text TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  priority ENUM('low', 'medium', 'high') DEFAULT 'medium',
  assigned_to VARCHAR(100) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- POS REVENUE
-- Aggregated daily point-of-sale revenue by category.
-- One row per calendar date.
-- ============================================================
CREATE TABLE pos_revenue (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date DATE NOT NULL,
  kitchen DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  drinks DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  miscell DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pos_revenue_date (date),
  INDEX idx_pos_revenue_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- KITCHEN ORDERS
-- Queue-based kitchen display system organized by room orders.
-- items is JSON: Array<{ item_id: string; name: string; quantity: number; special_instructions?: string }>
-- ============================================================
CREATE TABLE kitchen_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(20) NOT NULL UNIQUE,  -- e.g. "K-0001"
  receipt_no VARCHAR(50) NULL,
  room_number VARCHAR(10) NOT NULL,
  guest_name VARCHAR(100) NOT NULL,
  cashier_name VARCHAR(50) NOT NULL,
  items JSON NOT NULL,
  total_items INT NOT NULL DEFAULT 0,
  total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  status ENUM('new', 'preparing', 'ready', 'delivered', 'cancelled') NOT NULL DEFAULT 'new',
  priority ENUM('normal', 'urgent') NOT NULL DEFAULT 'normal',
  ordered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  preparing_started_at DATETIME NULL,
  ready_at DATETIME NULL,
  delivered_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  assigned_to VARCHAR(50) NULL,
  prepared_by VARCHAR(50) NULL,
  delivered_by VARCHAR(50) NULL,
  special_instructions TEXT NULL,
  kitchen_notes TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_kitchen_orders_status (status),
  INDEX idx_kitchen_orders_room (room_number),
  INDEX idx_kitchen_orders_ordered_at (ordered_at),
  INDEX idx_kitchen_orders_receipt (receipt_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- WEEKLY SHIFT ENTRIES
-- 14 shift entries per week (7 days × 2 shifts)
-- ============================================================
CREATE TABLE weekly_shift_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date DATE NOT NULL,
  day_of_week ENUM('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN') NOT NULL,
  shift_type ENUM('DAY', 'NIGHT') NOT NULL,
  cashier_name VARCHAR(50) NOT NULL,
  total_checkins INT NOT NULL DEFAULT 0,
  checkout_count INT NOT NULL DEFAULT 0,
  transfer_count INT NOT NULL DEFAULT 0,
  room_bill DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  kitchen_bill DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  drinks_bill DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  miscell_purchases DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  extras DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  discount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  payment_received DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  week_number INT NOT NULL,
  year INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shift_date_type (date, shift_type),
  INDEX idx_shift_date (date),
  INDEX idx_shift_week (year, week_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- WEEKLY EXPENSES
-- Two-column expense tracking per week
-- ============================================================
CREATE TABLE weekly_expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  kitchen_expenses DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  wilkins_pure DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  ate_lanie_beddings DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  krico_gas_laundry DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  tissue_flexi_cling DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  miscellaneous DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  kovi DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  cm_surc_rh DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  lempo DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  marbont DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  aquapura DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  andeng_store DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  george_cable DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  rh_meat DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  coke_zero DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  short_pau DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  venyen_zonrox DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  vale_pau_cam_id DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  admin_gretch_sa DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  custom_expenses JSON NOT NULL,
  total_expenses_col1 DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  total_expenses_col2 DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  total_expenses DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_expenses_week (week_start),
  INDEX idx_expenses_week (week_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- GCASH ENTRIES
-- Audit trail for GCash payments
-- ============================================================
CREATE TABLE gcash_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date DATE NOT NULL,
  shift_type ENUM('DAY', 'NIGHT') NOT NULL,
  reference_number VARCHAR(100) NULL,
  amount DECIMAL(10, 2) NOT NULL,
  guest_name VARCHAR(100) NULL,
  room_number VARCHAR(10) NULL,
  receipt_no VARCHAR(50) NULL,
  cashier_id VARCHAR(50) NULL,
  week_number INT NOT NULL,
  year INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_gcash_date (date),
  INDEX idx_gcash_week (year, week_number),
  INDEX idx_gcash_receipt (receipt_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- CASH DENOMINATION REPORT
-- Physical cash counting report
-- ============================================================
CREATE TABLE cash_denomination_report (
  id INT AUTO_INCREMENT PRIMARY KEY,
  week_start DATE NOT NULL,
  report_date DATE NOT NULL,
  bills_1000_count INT NOT NULL DEFAULT 0,
  bills_500_count INT NOT NULL DEFAULT 0,
  bills_200_count INT NOT NULL DEFAULT 0,
  bills_100_count INT NOT NULL DEFAULT 0,
  bills_50_count INT NOT NULL DEFAULT 0,
  coins_total DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  total_1000 DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  total_500 DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  total_200 DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  total_100 DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  total_50 DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  grand_total DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  received_by VARCHAR(100) NULL,
  counted_by VARCHAR(100) NULL,
  verified_by VARCHAR(100) NULL,
  notes TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_denom_date (report_date),
  INDEX idx_denom_week (week_start),
  INDEX idx_denom_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- FORCE CHECKOUT REQUESTS
-- Cashier-to-Admin escalation requests for uncollected/disputed/overstayed stays
-- ============================================================
CREATE TABLE force_checkout_requests (
  id VARCHAR(64) PRIMARY KEY,
  room_number VARCHAR(10) NOT NULL,
  room_type VARCHAR(100) NULL,
  guest_name VARCHAR(255) NULL,
  guest_id VARCHAR(100) NULL,
  check_in_time VARCHAR(50) NULL,
  rate_selected VARCHAR(20) NULL,
  uncollected_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  billed_breakdown TEXT NULL,
  reason VARCHAR(50) NOT NULL,
  cashier_notes TEXT NULL,
  requested_by VARCHAR(100) NOT NULL,
  requested_at DATETIME NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  admin_notes TEXT NULL,
  resolved_by VARCHAR(100) NULL,
  resolved_at DATETIME NULL,
  resolution_type VARCHAR(50) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_fcr_status (status),
  INDEX idx_fcr_room (room_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- DISCOUNT RATES
-- Fixed discount amounts reference table in integer centavos.
-- ============================================================
CREATE TABLE IF NOT EXISTS discount_rates (
  id VARCHAR(64) PRIMARY KEY,
  discount_type VARCHAR(20) NOT NULL,
  room_tier VARCHAR(20) NOT NULL,
  duration VARCHAR(20) NOT NULL,
  amount_centavos INT NOT NULL,
  description VARCHAR(255) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_discount_rate (discount_type, room_tier, duration),
  INDEX idx_discount_lookup (discount_type, room_tier, duration)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- MENU ITEM INVENTORY
-- Live available quantity cache per menu item.
-- ============================================================
CREATE TABLE IF NOT EXISTS menu_item_inventory (
  item_id VARCHAR(64) PRIMARY KEY,
  item_name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  current_quantity INT NOT NULL DEFAULT 0,
  is_tracked TINYINT(1) NOT NULL DEFAULT 1,
  last_event_id VARCHAR(64) NULL,
  last_shift_id VARCHAR(64) NULL,
  last_updated_by VARCHAR(100) NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_menu_inv_category (category),
  INDEX idx_menu_inv_tracked (is_tracked),
  CONSTRAINT chk_menu_inv_qty CHECK (current_quantity >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- INVENTORY EVENTS
-- Append-only event log for all stock-set entries and kitchen order consumption.
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_events (
  id VARCHAR(64) PRIMARY KEY,
  item_id VARCHAR(64) NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  event_type ENUM('stock_set', 'sold', 'adjustment') NOT NULL,
  quantity_change INT NOT NULL,
  balance_after INT NOT NULL,
  shift_id VARCHAR(64) NOT NULL,
  shift_type ENUM('DAY', 'NIGHT') NOT NULL,
  reference_id VARCHAR(64) NULL,
  operator VARCHAR(100) NOT NULL,
  notes TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_inv_events_item (item_id),
  INDEX idx_inv_events_shift (shift_id),
  INDEX idx_inv_events_date (created_at),
  INDEX idx_inv_events_type (event_type),
  CONSTRAINT chk_balance_after CHECK (balance_after >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
