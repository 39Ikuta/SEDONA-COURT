-- ============================================================
-- Sedona Court Travellers Inn — SQLite Schema
-- Automatically initialized on server startup.
-- Stores all data in a local file (server/data/sedona_pms.db).
-- ============================================================

-- ============================================================
-- USERS
-- Operator accounts with bcrypt-hashed access codes.
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  username         TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('kitchen', 'cashier', 'admin', 'owner', 'customer_display')),
  access_code_hash TEXT NOT NULL,
  created_at       TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============================================================
-- ROOMS
-- Hotel apartments and live occupancy state.
-- charged_food is stored as JSON string.
-- ============================================================
CREATE TABLE IF NOT EXISTS rooms (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  number         TEXT NOT NULL UNIQUE,
  tier           TEXT NOT NULL CHECK (tier IN ('Standard', 'Deluxe', 'Suite')),
  floor          INTEGER NOT NULL DEFAULT 1,
  room_type      TEXT NOT NULL,
  state          TEXT NOT NULL DEFAULT 'available' CHECK (state IN ('available', 'occupied', 'cleaning', 'overdue', 'maintenance')),
  label          TEXT DEFAULT 'Available',
  guest_name     TEXT DEFAULT '',
  guest_id       TEXT DEFAULT '',
  num_guests     INTEGER DEFAULT 0,
  rate_selected  TEXT DEFAULT '24h',
  custom_hours   INTEGER DEFAULT NULL,
  extra_beds     INTEGER DEFAULT 0,
  towel_sets     INTEGER DEFAULT 0,
  check_in_time  TEXT,
  check_out_time TEXT,
  is_overdue     INTEGER DEFAULT 0,
  charged_food   TEXT DEFAULT '[]',
  discount_type  TEXT DEFAULT 'NONE',
  discount_id_ref TEXT DEFAULT '',
  updated_at     TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_rooms_state ON rooms(state);
CREATE INDEX IF NOT EXISTS idx_rooms_number ON rooms(number);

-- ============================================================
-- SCHEDULED BOOKINGS
-- Advance reservations from the Booking Calendar.
-- ============================================================
CREATE TABLE IF NOT EXISTS scheduled_bookings (
  id             TEXT PRIMARY KEY,
  room_number    TEXT NOT NULL,
  guest_name     TEXT NOT NULL,
  guest_id       TEXT,
  check_in_date  TEXT NOT NULL,
  check_out_date TEXT NOT NULL,
  rate_selected  TEXT NOT NULL,
  num_guests     INTEGER DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'checked-in', 'cancelled')),
  created_at     TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_status ON scheduled_bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON scheduled_bookings(check_in_date, check_out_date);

-- ============================================================
-- RECEIPTS
-- Full checkout receipt records (never deleted).
-- items is stored as JSON string.
-- ============================================================
CREATE TABLE IF NOT EXISTS receipts (
  receipt_no      TEXT PRIMARY KEY,
  date_time       TEXT NOT NULL,
  guest_name      TEXT,
  room_number     TEXT,
  room_type       TEXT,
  payment_method  TEXT NOT NULL CHECK (payment_method IN ('CASH', 'GCASH', 'MIXED')),
  gcash_ref       TEXT,
  cash_amount     REAL,
  gcash_amount    REAL,
  check_in        TEXT,
  check_out       TEXT,
  items           TEXT NOT NULL DEFAULT '[]',
  subtotal        REAL NOT NULL DEFAULT 0.00,
  service_charge  REAL NOT NULL DEFAULT 0.00,
  total           REAL NOT NULL DEFAULT 0.00,
  discount_type   TEXT DEFAULT NULL,
  discount_amount REAL DEFAULT 0.00,
  discount_id_ref TEXT DEFAULT NULL,
  rate_selected   TEXT DEFAULT NULL,
  stay_duration   TEXT DEFAULT NULL,
  cashier_id      TEXT,
  created_at      TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(date_time);
CREATE INDEX IF NOT EXISTS idx_receipts_room ON receipts(room_number);

-- ============================================================
-- BILLABLE SERVICES
-- Room rates, menu items, and service add-ons.
-- ============================================================
CREATE TABLE IF NOT EXISTS billable_services (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL CHECK (type IN ('room_rate', 'menu_item', 'service')),
  name              TEXT NOT NULL,
  price             REAL NOT NULL,
  category          TEXT NOT NULL,
  active            INTEGER DEFAULT 1,
  description       TEXT,
  rate_type         TEXT,
  weekday_override  REAL,
  weekend_override  REAL,
  seasonal_override REAL,
  seasonal_start    TEXT,
  seasonal_end      TEXT,
  image_url         TEXT,
  is_deleted        INTEGER DEFAULT 0,
  created_at        TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at        TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_services_type ON billable_services(type);
CREATE INDEX IF NOT EXISTS idx_services_active ON billable_services(active);

-- ============================================================
-- AUDIT LOGS
-- Administrative audit trail for settings and checkouts.
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  timestamp  TEXT NOT NULL,
  operator   TEXT NOT NULL,
  action     TEXT NOT NULL,
  details    TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);

-- ============================================================
-- HANDOFF TASKS
-- Shift turnover checklist items.
-- ============================================================
CREATE TABLE IF NOT EXISTS handoff_tasks (
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  completed   INTEGER DEFAULT 0,
  priority    TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  assigned_to TEXT,
  created_at  TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============================================================
-- POS REVENUE
-- Aggregated daily point-of-sale revenue by category.
-- ============================================================
CREATE TABLE IF NOT EXISTS pos_revenue (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL UNIQUE,
  kitchen    REAL NOT NULL DEFAULT 0.00,
  drinks     REAL NOT NULL DEFAULT 0.00,
  miscell    REAL NOT NULL DEFAULT 0.00,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_pos_revenue_date ON pos_revenue(date);

-- ============================================================
-- KITCHEN ORDERS
-- Queue-based kitchen display system organized by room orders.
-- ============================================================
CREATE TABLE IF NOT EXISTS kitchen_orders (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number         TEXT NOT NULL UNIQUE,
  receipt_no           TEXT,
  room_number          TEXT NOT NULL,
  guest_name           TEXT NOT NULL,
  cashier_name         TEXT NOT NULL,
  items                TEXT NOT NULL DEFAULT '[]',
  total_items          INTEGER NOT NULL DEFAULT 0,
  total_amount         REAL NOT NULL DEFAULT 0.00,
  status               TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'preparing', 'ready', 'delivered', 'cancelled')),
  priority             TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  ordered_at           TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  preparing_started_at TEXT,
  ready_at             TEXT,
  delivered_at         TEXT,
  cancelled_at         TEXT,
  assigned_to          TEXT,
  prepared_by          TEXT,
  delivered_by         TEXT,
  special_instructions TEXT,
  kitchen_notes        TEXT,
  print_status         TEXT NOT NULL DEFAULT 'pending' CHECK (print_status IN ('pending', 'printing', 'printed', 'failed')),
  printed_at           TEXT,
  print_attempts       INTEGER NOT NULL DEFAULT 0,
  print_error          TEXT,
  created_at           TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at           TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_kitchen_orders_status ON kitchen_orders(status);
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_room ON kitchen_orders(room_number);
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_print_status ON kitchen_orders(print_status);

-- ============================================================
-- WEEKLY SHIFT ENTRIES
-- 14 shift entries per week (7 days × 2 shifts)
-- ============================================================
CREATE TABLE IF NOT EXISTS weekly_shift_entries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  date              TEXT NOT NULL,
  day_of_week       TEXT NOT NULL,
  shift_type        TEXT NOT NULL CHECK (shift_type IN ('DAY', 'NIGHT')),
  cashier_name      TEXT NOT NULL,
  total_checkins    INTEGER NOT NULL DEFAULT 0,
  checkout_count    INTEGER NOT NULL DEFAULT 0,
  transfer_count    INTEGER NOT NULL DEFAULT 0,
  room_bill         REAL NOT NULL DEFAULT 0.00,
  kitchen_bill      REAL NOT NULL DEFAULT 0.00,
  drinks_bill       REAL NOT NULL DEFAULT 0.00,
  miscell_purchases REAL NOT NULL DEFAULT 0.00,
  extras            REAL NOT NULL DEFAULT 0.00,
  discount          REAL NOT NULL DEFAULT 0.00,
  payment_received  REAL NOT NULL DEFAULT 0.00,
  week_number       INTEGER NOT NULL,
  year              INTEGER NOT NULL,
  created_at        TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at        TEXT DEFAULT (datetime('now', 'localtime')),
  UNIQUE (date, shift_type)
);

CREATE INDEX IF NOT EXISTS idx_shift_date ON weekly_shift_entries(date);
CREATE INDEX IF NOT EXISTS idx_shift_week ON weekly_shift_entries(year, week_number);

-- ============================================================
-- WEEKLY EXPENSES
-- Two-column expense tracking per week
-- ============================================================
CREATE TABLE IF NOT EXISTS weekly_expenses (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start          TEXT NOT NULL UNIQUE,
  week_end            TEXT NOT NULL,
  kitchen_expenses    REAL NOT NULL DEFAULT 0.00,
  wilkins_pure        REAL NOT NULL DEFAULT 0.00,
  ate_lanie_beddings  REAL NOT NULL DEFAULT 0.00,
  krico_gas_laundry   REAL NOT NULL DEFAULT 0.00,
  tissue_flexi_cling  REAL NOT NULL DEFAULT 0.00,
  miscellaneous       REAL NOT NULL DEFAULT 0.00,
  kovi                REAL NOT NULL DEFAULT 0.00,
  cm_surc_rh          REAL NOT NULL DEFAULT 0.00,
  lempo               REAL NOT NULL DEFAULT 0.00,
  marbont             REAL NOT NULL DEFAULT 0.00,
  aquapura            REAL NOT NULL DEFAULT 0.00,
  andeng_store        REAL NOT NULL DEFAULT 0.00,
  george_cable        REAL NOT NULL DEFAULT 0.00,
  rh_meat             REAL NOT NULL DEFAULT 0.00,
  coke_zero           REAL NOT NULL DEFAULT 0.00,
  short_pau           REAL NOT NULL DEFAULT 0.00,
  venyen_zonrox       REAL NOT NULL DEFAULT 0.00,
  vale_pau_cam_id     REAL NOT NULL DEFAULT 0.00,
  admin_gretch_sa     REAL NOT NULL DEFAULT 0.00,
  custom_expenses     TEXT NOT NULL DEFAULT '[]',
  total_expenses_col1 REAL NOT NULL DEFAULT 0.00,
  total_expenses_col2 REAL NOT NULL DEFAULT 0.00,
  total_expenses      REAL NOT NULL DEFAULT 0.00,
  created_at          TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at          TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_expenses_week ON weekly_expenses(week_start);

-- ============================================================
-- GCASH ENTRIES
-- Audit trail for GCash payments
-- ============================================================
CREATE TABLE IF NOT EXISTS gcash_entries (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  date             TEXT NOT NULL,
  shift_type       TEXT NOT NULL CHECK (shift_type IN ('DAY', 'NIGHT')),
  reference_number TEXT,
  amount           REAL NOT NULL,
  guest_name       TEXT,
  room_number      TEXT,
  receipt_no       TEXT,
  cashier_id       TEXT,
  week_number      INTEGER NOT NULL,
  year             INTEGER NOT NULL,
  created_at       TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_gcash_date ON gcash_entries(date);
CREATE INDEX IF NOT EXISTS idx_gcash_week ON gcash_entries(year, week_number);

-- ============================================================
-- CASH DENOMINATION REPORT
-- Physical cash counting report
-- ============================================================
CREATE TABLE IF NOT EXISTS cash_denomination_report (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start      TEXT NOT NULL,
  report_date     TEXT NOT NULL UNIQUE,
  bills_1000_count INTEGER NOT NULL DEFAULT 0,
  bills_500_count  INTEGER NOT NULL DEFAULT 0,
  bills_200_count  INTEGER NOT NULL DEFAULT 0,
  bills_100_count  INTEGER NOT NULL DEFAULT 0,
  bills_50_count   INTEGER NOT NULL DEFAULT 0,
  coins_total      REAL NOT NULL DEFAULT 0.00,
  total_1000       REAL NOT NULL DEFAULT 0.00,
  total_500        REAL NOT NULL DEFAULT 0.00,
  total_200        REAL NOT NULL DEFAULT 0.00,
  total_100        REAL NOT NULL DEFAULT 0.00,
  total_50         REAL NOT NULL DEFAULT 0.00,
  grand_total      REAL NOT NULL DEFAULT 0.00,
  received_by      TEXT,
  counted_by       TEXT,
  verified_by      TEXT,
  notes            TEXT,
  created_at       TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at       TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_denom_week ON cash_denomination_report(week_start);

-- ============================================================
-- FORCE CHECKOUT REQUESTS
-- Cashier-to-Admin escalation requests for uncollected/disputed/overstayed stays
-- ============================================================
CREATE TABLE IF NOT EXISTS force_checkout_requests (
  id                  TEXT PRIMARY KEY,
  room_number         TEXT NOT NULL,
  room_type           TEXT,
  guest_name          TEXT,
  guest_id            TEXT,
  check_in_time       TEXT,
  rate_selected       TEXT,
  uncollected_amount  REAL NOT NULL DEFAULT 0.00,
  billed_breakdown    TEXT,
  reason              TEXT NOT NULL,
  cashier_notes       TEXT,
  requested_by        TEXT NOT NULL,
  requested_at        TEXT NOT NULL,
  status              TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  admin_notes         TEXT,
  resolved_by         TEXT,
  resolved_at         TEXT,
  resolution_type     TEXT,
  created_at          TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at          TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_fcr_status ON force_checkout_requests(status);
CREATE INDEX IF NOT EXISTS idx_fcr_room ON force_checkout_requests(room_number);

-- ============================================================
-- DEPOSIT TRANSACTIONS
-- Append-only monetary ledger for guest deposit / credit balances.
-- All amounts stored as integer centavos (no floats).
-- Balance is a computed sum: SUM(CASE WHEN direction = 'IN' THEN amount_centavos ELSE -amount_centavos END).
-- ============================================================
CREATE TABLE IF NOT EXISTS deposit_transactions (
  id                    TEXT PRIMARY KEY,
  guest_identifier      TEXT NOT NULL,
  guest_name            TEXT,
  amount_centavos       INTEGER NOT NULL CHECK (amount_centavos > 0),
  direction             TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  payment_method        TEXT CHECK (payment_method IN ('CASH', 'GCASH', 'MIXED', 'BALANCE_APPLIED')),
  cash_amount_centavos  INTEGER DEFAULT 0,
  gcash_amount_centavos INTEGER DEFAULT 0,
  reference_id          TEXT,
  idempotency_key       TEXT NOT NULL UNIQUE,
  booking_id            TEXT,
  room_number           TEXT,
  receipt_no            TEXT,
  notes                 TEXT,
  operator              TEXT NOT NULL,
  created_at            TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_deposit_tx_guest ON deposit_transactions(guest_identifier);
CREATE INDEX IF NOT EXISTS idx_deposit_tx_idempotency ON deposit_transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_deposit_tx_created ON deposit_transactions(created_at);

-- Database-level check ensuring running balance never goes negative
CREATE TRIGGER IF NOT EXISTS trg_prevent_negative_deposit_balance
BEFORE INSERT ON deposit_transactions
FOR EACH ROW
WHEN NEW.direction = 'OUT'
BEGIN
  SELECT CASE
    WHEN (
      (SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_centavos ELSE -amount_centavos END), 0)
       FROM deposit_transactions
       WHERE guest_identifier = NEW.guest_identifier) < NEW.amount_centavos
    )
    THEN RAISE(ABORT, 'Insufficient deposit balance: transaction would result in negative balance')
  END;
END;

-- ============================================================
-- DISCOUNT RATES
-- Fixed discount amounts reference table in integer centavos.
-- ============================================================
CREATE TABLE IF NOT EXISTS discount_rates (
  id                TEXT PRIMARY KEY,
  discount_type     TEXT NOT NULL CHECK (discount_type IN ('SENIOR', 'DC')),
  room_tier         TEXT NOT NULL CHECK (room_tier IN ('CLASSIC', 'PREMIUM', 'VIP')),
  duration          TEXT NOT NULL CHECK (duration IN ('3HR', '12HR', '24HR')),
  amount_centavos   INTEGER NOT NULL CHECK (amount_centavos > 0),
  description       TEXT,
  created_at        TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at        TEXT DEFAULT (datetime('now', 'localtime')),
  UNIQUE(discount_type, room_tier, duration)
);

CREATE INDEX IF NOT EXISTS idx_discount_rates_lookup ON discount_rates(discount_type, room_tier, duration);

-- ============================================================
-- MENU ITEM INVENTORY
-- Live available quantity cache per menu item.
-- ============================================================
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

-- ============================================================
-- INVENTORY EVENTS
-- Append-only event log for all stock-set entries and kitchen order consumption.
-- ============================================================
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

-- Database-level check ensuring running inventory balance never goes negative
CREATE TRIGGER IF NOT EXISTS trg_prevent_negative_inventory
BEFORE INSERT ON inventory_events
FOR EACH ROW
WHEN NEW.balance_after < 0
BEGIN
  SELECT RAISE(ABORT, 'Inventory quantity cannot be negative');
END;

-- ============================================================
-- SHIFT EXPENSES
-- Cashier end-of-shift operating expenses
-- ============================================================
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

-- ============================================================
-- ROOM TRANSFERS
-- Log of guest room relocations with reason and timestamps
-- ============================================================
CREATE TABLE IF NOT EXISTS room_transfers (
  id                  TEXT PRIMARY KEY,
  source_room_number  TEXT NOT NULL,
  target_room_number  TEXT NOT NULL,
  guest_name          TEXT NOT NULL,
  guest_id            TEXT,
  reason              TEXT NOT NULL,
  transferred_by      TEXT NOT NULL,
  transferred_at      TEXT DEFAULT (datetime('now', 'localtime')),
  source_tier         TEXT,
  target_tier         TEXT,
  rate_selected       TEXT,
  charged_food        TEXT,
  price_difference    REAL DEFAULT 0.00,
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_room_transfers_time ON room_transfers(transferred_at);
CREATE INDEX IF NOT EXISTS idx_room_transfers_source ON room_transfers(source_room_number);
CREATE INDEX IF NOT EXISTS idx_room_transfers_target ON room_transfers(target_room_number);


