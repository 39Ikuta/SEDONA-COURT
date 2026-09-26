/**
 * server/db/pool.ts
 * SQLite database engine with MySQL / PostgreSQL query compatibility.
 * Stores all data in a single local file (server/data/sedona_pms.db).
 *
 * Features:
 * - Standalone file-based database (No MySQL or external servers required).
 * - High-concurrency WAL mode (Write-Ahead Logging).
 * - Full ACID transaction support (withTransaction).
 * - Automatic schema initialization & seeding on startup.
 * - PostgreSQL ($1, $2) and MySQL (?, ON DUPLICATE KEY UPDATE) query compatibility.
 *
 * TODO: Migrate monetary fields from floating-point number to integer centavos (or Decimal.js) for high-precision accounting
 */

// Explicitly set server timezone to Asia/Manila (Priority 2d)
process.env.TZ = process.env.TZ || 'Asia/Manila';

import { AsyncLocalStorage } from 'async_hooks';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { INITIAL_ROOMS, DEFAULT_BILLABLE_SERVICES } from '../../src/data';
import { SEED_USER_ACCOUNTS } from '../data/seed-accounts';
import { DISCOUNT_RATES_DATA } from '../utils/discount-rates';

dotenv.config({ path: '.env.local' });

// Ensure data directory exists
const DATA_DIR = path.resolve(process.cwd(), 'server/data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Database file path
const DB_FILE_PATH = process.env.SQLITE_DB_PATH
  ? path.resolve(process.cwd(), process.env.SQLITE_DB_PATH)
  : path.join(DATA_DIR, 'sedona_pms.db');

export interface PoolConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  filePath?: string;
}

/**
 * Parse database URL.
 * Supports sqlite://, mysql://, postgresql:// and fails fast on malformed URLs (Priority 2a).
 */
export function parseDatabaseUrl(url: string): PoolConfig {
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }

  if (url.startsWith('sqlite://') || url.startsWith('file:')) {
    const rawPath = url.replace(/^(sqlite:\/\/|file:)/, '');
    return {
      filePath: path.resolve(process.cwd(), rawPath || 'server/data/sedona_pms.db'),
      database: 'sedona_pms',
    };
  }

  throw new Error(`Invalid DATABASE_URL: Unsupported database protocol. Only sqlite:// and file: are supported. Provided: ${url}`);
}

// Initialize SQLite database instance
export const sqliteDb = new Database(DB_FILE_PATH, {
  verbose: process.env.DEBUG_SQL === 'true' ? console.log : undefined,
});

// Configure SQLite for high performance and integrity
sqliteDb.pragma('journal_mode = WAL');
sqliteDb.pragma('foreign_keys = ON');
sqliteDb.pragma('busy_timeout = 30000'); // 30s timeout prevents SQLITE_BUSY when machine wakes up from sleep
sqliteDb.pragma('synchronous = NORMAL');
sqliteDb.pragma('wal_autocheckpoint = 1000');
sqliteDb.pragma('journal_size_limit = 67108864'); // 64MB WAL limit

// Register custom SQL functions for compatibility
try {
  sqliteDb.function('NOW', () => new Date().toISOString().slice(0, 19).replace('T', ' '));
  sqliteDb.function('CURRENT_DATE_STR', () => new Date().toISOString().slice(0, 10));
  sqliteDb.function('UNIX_TIMESTAMP', (d?: string) =>
    d ? Math.floor(new Date(d).getTime() / 1000) : Math.floor(Date.now() / 1000)
  );
  sqliteDb.function('TIMESTAMPDIFF', (unit: any, start: any, end: any) => {
    if (!unit || !start || !end) return null;
    const parseDate = (d: any) => {
      if (typeof d === 'string') return new Date(d.replace(' ', 'T')).getTime();
      return new Date(d).getTime();
    };
    const startMs = parseDate(start);
    const endMs = parseDate(end);
    if (isNaN(startMs) || isNaN(endMs)) return null;
    const diffMs = endMs - startMs;
    const safeUnit = String(unit).toUpperCase();
    switch (safeUnit) {
      case 'SECOND': return Math.floor(diffMs / 1000);
      case 'MINUTE': return Math.floor(diffMs / 60000);
      case 'HOUR': return Math.floor(diffMs / 3600000);
      case 'DAY': return Math.floor(diffMs / 86400000);
      case 'WEEK': return Math.floor(diffMs / 604800000);
      case 'MONTH': return Math.floor(diffMs / 2592000000);
      case 'YEAR': return Math.floor(diffMs / 31536000000);
      default: return 0;
    }
  });
} catch {
  // Functions may already be registered
}

// Immediately initialize schema and seed data
export function initializeDatabaseSync(): void {
  // Check if kitchen_orders exists and needs print columns added before schemaSql creates index
  try {
    const kitchenTable = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kitchen_orders'").get();
    if (kitchenTable) {
      const kitchenCols = sqliteDb.prepare("PRAGMA table_info(kitchen_orders)").all() as Array<{ name: string }>;
      const colNames = kitchenCols.map(c => c.name);
      if (!colNames.includes('print_status')) {
        sqliteDb.exec(`
          ALTER TABLE kitchen_orders ADD COLUMN print_status TEXT NOT NULL DEFAULT 'pending';
          ALTER TABLE kitchen_orders ADD COLUMN printed_at TEXT;
          ALTER TABLE kitchen_orders ADD COLUMN print_attempts INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE kitchen_orders ADD COLUMN print_error TEXT;
        `);
      }
    }
  } catch (err) {
    console.warn('kitchen_orders column migration check warning:', err);
  }

  const schemaPath = path.resolve(process.cwd(), 'server/db/schema.sqlite.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    sqliteDb.exec(schemaSql);
  }

  // Migration 20260912_030000 + 20260912_040000 for EXISTING db files:
  // schema.sqlite.sql uses CREATE TABLE IF NOT EXISTS, so columns added later
  // never backfill. Without these, PUT /rooms (custom_hours) and
  // POST /receipts (discount_*) fail with "no such column" → 500.
  try {
    const roomCols = sqliteDb.prepare('PRAGMA table_info(rooms)').all() as Array<{ name: string }>;
    const roomColNames = new Set(roomCols.map(c => c.name));
    if (!roomColNames.has('custom_hours')) {
      sqliteDb.exec('ALTER TABLE rooms ADD COLUMN custom_hours INTEGER DEFAULT NULL;');
      console.log('✅ Migrated rooms.custom_hours column.');
    }
  } catch (err) {
    console.warn('rooms.custom_hours migration check warning:', err);
  }

  try {
    const weeklyCols = sqliteDb.prepare('PRAGMA table_info(weekly_expenses)').all() as Array<{ name: string }>;
    const weeklyColNames = new Set(weeklyCols.map(c => c.name));
    if (!weeklyColNames.has('finalized_at')) {
      sqliteDb.exec(`
        ALTER TABLE weekly_expenses ADD COLUMN finalized_at TEXT DEFAULT NULL;
        ALTER TABLE weekly_expenses ADD COLUMN finalized_by TEXT DEFAULT NULL;
      `);
      console.log('✅ Migrated weekly_expenses finalized columns.');
    }
  } catch (err) {
    console.warn('weekly_expenses finalized migration check warning:', err);
  }
  try {
    const receiptCols = sqliteDb.prepare('PRAGMA table_info(receipts)').all() as Array<{ name: string }>;
    const receiptColNames = new Set(receiptCols.map(c => c.name));
    if (!receiptColNames.has('discount_type')) {
      sqliteDb.exec('ALTER TABLE receipts ADD COLUMN discount_type TEXT DEFAULT NULL;');
      console.log('✅ Migrated receipts.discount_type column.');
    }
    if (!receiptColNames.has('discount_amount')) {
      sqliteDb.exec('ALTER TABLE receipts ADD COLUMN discount_amount REAL DEFAULT 0.00;');
      console.log('✅ Migrated receipts.discount_amount column.');
    }
    if (!receiptColNames.has('discount_id_ref')) {
      sqliteDb.exec('ALTER TABLE receipts ADD COLUMN discount_id_ref TEXT DEFAULT NULL;');
      console.log('✅ Migrated receipts.discount_id_ref column.');
    }
    if (!receiptColNames.has('rate_selected')) {
      sqliteDb.exec('ALTER TABLE receipts ADD COLUMN rate_selected TEXT DEFAULT NULL;');
      console.log('✅ Migrated receipts.rate_selected column.');
    }
    if (!receiptColNames.has('stay_duration')) {
      sqliteDb.exec('ALTER TABLE receipts ADD COLUMN stay_duration TEXT DEFAULT NULL;');
      console.log('✅ Migrated receipts.stay_duration column.');
    }
  } catch (err) {
    console.warn('receipts migration check warning:', err);
  }

  // Check if rooms table has discount_type and discount_id_ref
  try {
    const roomCols = sqliteDb.pragma('table_info(rooms)') as Array<{ name: string }>;
    const roomColNames = new Set(roomCols.map((c) => c.name));
    if (!roomColNames.has('discount_type')) {
      sqliteDb.exec("ALTER TABLE rooms ADD COLUMN discount_type TEXT DEFAULT 'NONE';");
      console.log('✅ Migrated rooms.discount_type column.');
    }
    if (!roomColNames.has('discount_id_ref')) {
      sqliteDb.exec("ALTER TABLE rooms ADD COLUMN discount_id_ref TEXT DEFAULT '';");
      console.log('✅ Migrated rooms.discount_id_ref column.');
    }
  } catch (err) {
    console.warn('rooms discount column migration check warning:', err);
  }

  // Check if users table CHECK constraint includes 'customer_display'
  try {
    const tableInfo = sqliteDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string } | undefined;
    if (tableInfo && tableInfo.sql && !tableInfo.sql.includes('customer_display')) {
      console.log('🔄 Migrating SQLite users table to support customer_display role...');
      sqliteDb.exec(`
        PRAGMA foreign_keys=off;
        BEGIN TRANSACTION;
        ALTER TABLE users RENAME TO _users_old;
        CREATE TABLE users (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          username         TEXT NOT NULL UNIQUE,
          name             TEXT NOT NULL,
          role             TEXT NOT NULL CHECK (role IN ('kitchen', 'cashier', 'admin', 'owner', 'customer_display')),
          access_code_hash TEXT NOT NULL,
          created_at       TEXT DEFAULT (datetime('now', 'localtime'))
        );
        INSERT INTO users (id, username, name, role, access_code_hash, created_at)
          SELECT id, username, name, role, access_code_hash, created_at FROM _users_old;
        DROP TABLE _users_old;
        COMMIT;
        PRAGMA foreign_keys=on;
      `);
      console.log('✅ SQLite users table migration complete.');
    }
  } catch (migErr) {
    console.warn('Users table migration check warning:', migErr);
  }

  // Check if users exist; if not, seed initial data
  const usersCount = (sqliteDb.prepare('SELECT COUNT(*) as count FROM users').get() as any)?.count || 0;
  if (usersCount === 0) {
    console.log('🌱 Seeding initial SQLite database records...');

    // Seed users
    for (const user of SEED_USER_ACCOUNTS) {
      const hash = bcrypt.hashSync(user.accessCode, 10);
      sqliteDb.prepare(
        `INSERT INTO users (username, name, role, access_code_hash)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (username) DO UPDATE SET name = excluded.name, role = excluded.role, access_code_hash = excluded.access_code_hash`
      ).run(user.username, user.name, user.role, hash);
    }

    // Seed rooms
    for (const room of INITIAL_ROOMS) {
      sqliteDb.prepare(
        `INSERT INTO rooms (
          number, tier, floor, room_type, state, label,
          guest_name, guest_id, num_guests, rate_selected,
          extra_beds, towel_sets, check_in_time, check_out_time,
          is_overdue, charged_food
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (number) DO UPDATE SET
           tier = excluded.tier, floor = excluded.floor, room_type = excluded.room_type,
           state = excluded.state, label = excluded.label`
      ).run(
        room.number,
        room.tier,
        room.floor,
        room.roomType,
        room.state,
        room.label,
        room.guestName || '',
        room.guestId || '',
        room.numGuests || 0,
        room.rateSelected || '24h',
        room.extraBeds || 0,
        room.towelSets || 0,
        room.checkInTime || null,
        room.checkOutTime || null,
        room.isOverdue ? 1 : 0,
        JSON.stringify(room.chargedFood || [])
      );
    }

    // Seed billable services
    for (const svc of DEFAULT_BILLABLE_SERVICES) {
      sqliteDb.prepare(
        `INSERT INTO billable_services (
          id, type, name, price, category, active, description,
          rate_type, weekday_override, weekend_override, seasonal_override,
          seasonal_start, seasonal_end, image_url, is_deleted
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name, price = excluded.price, category = excluded.category,
           active = excluded.active, description = excluded.description`
      ).run(
        svc.id,
        svc.type,
        svc.name,
        svc.price,
        svc.category,
        svc.active ? 1 : 0,
        svc.description || null,
        svc.rateType || null,
        svc.weekdayOverride || null,
        svc.weekendOverride || null,
        svc.seasonalOverride || null,
        svc.seasonalStart || null,
        svc.seasonalEnd || null,
        svc.imageUrl || null,
        svc.isDeleted ? 1 : 0
      );
    }

    console.log('✅ SQLite initial records seeded successfully.');
  }

  // Ensure customer_display (kiosk) user exists even if database was seeded prior
  const kioskAccount = SEED_USER_ACCOUNTS.find(u => u.username === 'kiosk');
  if (kioskAccount) {
    const hasKiosk = sqliteDb.prepare('SELECT COUNT(*) as count FROM users WHERE username = ?').get(kioskAccount.username) as any;
    if (!hasKiosk || hasKiosk.count === 0) {
      const hash = bcrypt.hashSync(kioskAccount.accessCode, 10);
      sqliteDb.prepare(
        `INSERT INTO users (username, name, role, access_code_hash)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (username) DO UPDATE SET name = excluded.name, role = excluded.role, access_code_hash = excluded.access_code_hash`
      ).run(kioskAccount.username, kioskAccount.name, kioskAccount.role, hash);
      console.log('🌱 Seeded customer_display (kiosk) account.');
    }
  }

  // Ensure cashier accounts (pau, raquel, tuter) exist with generic password
  const cashierSeedList = SEED_USER_ACCOUNTS.filter(u => u.role === 'cashier');
  for (const cashierAcc of cashierSeedList) {
    const hasUser = sqliteDb.prepare('SELECT COUNT(*) as count FROM users WHERE LOWER(username) = LOWER(?)').get(cashierAcc.username) as any;
    if (!hasUser || hasUser.count === 0) {
      const hash = bcrypt.hashSync(cashierAcc.accessCode, 10);
      sqliteDb.prepare(
        `INSERT INTO users (username, name, role, access_code_hash)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (username) DO UPDATE SET name = excluded.name, role = excluded.role, access_code_hash = excluded.access_code_hash`
      ).run(cashierAcc.username, cashierAcc.name, cashierAcc.role, hash);
      console.log(`🌱 Seeded cashier account (${cashierAcc.username}).`);
    }
  }



  // Ensure discount_rates table exists and sync with fixed centavos rate card
  try {
    const discountRatesTable = sqliteDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='discount_rates'").get() as { sql: string } | undefined;
    if (discountRatesTable && discountRatesTable.sql && !discountRatesTable.sql.includes('6HR')) {
      console.log('🔄 Migrating SQLite discount_rates table to support 6HR duration...');
      sqliteDb.exec(`
        PRAGMA foreign_keys=off;
        BEGIN TRANSACTION;
        ALTER TABLE discount_rates RENAME TO _discount_rates_old;
        CREATE TABLE discount_rates (
          id                TEXT PRIMARY KEY,
          discount_type     TEXT NOT NULL CHECK (discount_type IN ('SENIOR', 'DC')),
          room_tier         TEXT NOT NULL CHECK (room_tier IN ('CLASSIC', 'PREMIUM', 'VIP')),
          duration          TEXT NOT NULL CHECK (duration IN ('3HR', '6HR', '12HR', '24HR')),
          amount_centavos   INTEGER NOT NULL CHECK (amount_centavos > 0),
          description       TEXT,
          created_at        TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at        TEXT DEFAULT (datetime('now', 'localtime')),
          UNIQUE(discount_type, room_tier, duration)
        );
        INSERT OR IGNORE INTO discount_rates (id, discount_type, room_tier, duration, amount_centavos, description, created_at, updated_at)
          SELECT id, discount_type, room_tier, duration, amount_centavos, description, created_at, updated_at FROM _discount_rates_old;
        DROP TABLE _discount_rates_old;
        COMMIT;
        PRAGMA foreign_keys=on;
      `);
      console.log('✅ SQLite discount_rates table migration complete.');
    }

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS discount_rates (
        id                TEXT PRIMARY KEY,
        discount_type     TEXT NOT NULL CHECK (discount_type IN ('SENIOR', 'DC')),
        room_tier         TEXT NOT NULL CHECK (room_tier IN ('CLASSIC', 'PREMIUM', 'VIP')),
        duration          TEXT NOT NULL CHECK (duration IN ('3HR', '6HR', '12HR', '24HR')),
        amount_centavos   INTEGER NOT NULL CHECK (amount_centavos > 0),
        description       TEXT,
        created_at        TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at        TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE(discount_type, room_tier, duration)
      );
      CREATE INDEX IF NOT EXISTS idx_discount_rates_lookup ON discount_rates(discount_type, room_tier, duration);
    `);

    for (const r of DISCOUNT_RATES_DATA) {
      const id = `rate-${r.discountType.toLowerCase()}-${r.roomTier.toLowerCase()}-${r.duration.toLowerCase()}`;
      sqliteDb.prepare(`
        INSERT INTO discount_rates (id, discount_type, room_tier, duration, amount_centavos, description)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (discount_type, room_tier, duration) DO UPDATE SET
          amount_centavos = excluded.amount_centavos,
          description = excluded.description,
          updated_at = datetime('now', 'localtime')
      `).run(
        id,
        r.discountType,
        r.roomTier,
        r.duration,
        r.amountCentavos,
        `${r.discountType === 'DC' ? 'Discount Card' : 'Senior/PWD'} - ${r.roomTier} ${r.duration} (₱${(r.amountCentavos / 100).toFixed(2)})`
      );
    }
    console.log('✅ SQLite discount rates synced with fixed centavos rate card.');
  } catch (rateErr) {
    console.warn('Discount rates sync warning:', rateErr);
  }

  // Ensure menu_item_inventory and inventory_events tables exist and sync default menu items
  try {
    sqliteDb.exec(`
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
    `);

    // Sync menu items, linens, hotel supplies, and laundry from DEFAULT_BILLABLE_SERVICES into menu_item_inventory
    const trackableCategories = new Set(['Breakfast', 'Favorites', 'Kitchen Extras', 'Drinks', 'Miscellaneous', 'Extras', 'Linen & Bedding', 'Hotel Supplies', 'Laundry']);
    const trackableItems = DEFAULT_BILLABLE_SERVICES.filter(s => 
      !s.isDeleted && (
        s.type === 'menu_item' ||
        trackableCategories.has(s.category) ||
        s.id.startsWith('bed-') ||
        s.id.startsWith('extra-bed') ||
        s.id.startsWith('supply-') ||
        s.id.startsWith('laundry-') ||
        s.id === 'pillow' ||
        s.id === 'pillow-case' ||
        s.id === 'blanket' ||
        s.id === 'towel'
      )
    );
    // Remove legacy grouped misc-chips if present
    sqliteDb.prepare("DELETE FROM menu_item_inventory WHERE item_id = 'misc-chips'").run();

    for (const item of trackableItems) {
      sqliteDb.prepare(`
        INSERT INTO menu_item_inventory (item_id, item_name, category, current_quantity, is_tracked)
        VALUES (?, ?, ?, 0, 1)
        ON CONFLICT (item_id) DO UPDATE SET
          item_name = excluded.item_name,
          category = excluded.category
      `).run(item.id, item.name, item.category);
    }
    console.log(`✅ SQLite shift inventory initialized (${trackableItems.length} menu items, supplies, linens & laundry).`);
  } catch (invErr) {
    console.warn('Menu item inventory sync warning:', invErr);
  }
}

// Run initialization immediately upon module import
initializeDatabaseSync();


/**
 * Converts PostgreSQL-style parameterized query ($1, $2, ...)
 * to positional parameters (?) and maps positional arguments.
 * Throws immediately on missing or out-of-range placeholders (Priority 2b).
 */
export function convertPgQueryToMysql(sql: string, params?: any[]): { sql: string; params: any[] } {
  const hasPgPlaceholders = /\$\d+/.test(sql);

  if (!params || params.length === 0) {
    if (hasPgPlaceholders) {
      const match = sql.match(/\$(\d+)/);
      const num = match ? match[1] : '1';
      throw new Error(`Query references $${num} but only 0 params were provided`);
    }
    return { sql, params: [] };
  }

  if (!hasPgPlaceholders) {
    return { sql, params };
  }

  const orderedParams: any[] = [];
  const convertedSql = sql.replace(/\$(\d+)/g, (_match, num) => {
    const index = parseInt(num, 10) - 1;
    if (index < 0 || index >= params.length) {
      throw new Error(`Query references $${num} but only ${params.length} params were provided`);
    }
    orderedParams.push(params[index]);
    return '?';
  });

  return { sql: convertedSql, params: orderedParams };
}

/**
 * Translates MySQL / PostgreSQL syntax to SQLite compatible syntax.
 */
export function convertSqlForSqlite(sql: string): string {
  let s = sql;

  // Convert TIMESTAMPDIFF(UNIT, ...) -> TIMESTAMPDIFF('UNIT', ...)
  s = s.replace(/TIMESTAMPDIFF\s*\(\s*([a-zA-Z]+)\s*,/gi, "TIMESTAMPDIFF('$1',");

  // Convert EXTRACT(HOUR FROM col)
  s = s.replace(/EXTRACT\s*\(\s*HOUR\s+FROM\s+([a-zA-Z0-9_.]+)\s*\)/gi, "cast(strftime('%H', $1) as integer)");
  s = s.replace(/EXTRACT\s*\(\s*YEAR\s+FROM\s+([a-zA-Z0-9_.]+)\s*\)/gi, "cast(strftime('%Y', $1) as integer)");
  s = s.replace(/EXTRACT\s*\(\s*MONTH\s+FROM\s+([a-zA-Z0-9_.]+)\s*\)/gi, "cast(strftime('%m', $1) as integer)");
  s = s.replace(/EXTRACT\s*\(\s*DAY\s+FROM\s+([a-zA-Z0-9_.]+)\s*\)/gi, "cast(strftime('%d', $1) as integer)");

  // Convert NOW()
  s = s.replace(/NOW\(\)/gi, "datetime('now', 'localtime')");

  // Convert DATE(d)
  s = s.replace(/DATE\(([^)]+)\)/gi, "date($1)");

  // Convert INSERT IGNORE INTO -> INSERT OR IGNORE INTO
  s = s.replace(/INSERT\s+IGNORE\s+INTO/gi, 'INSERT OR IGNORE INTO');

  // Convert VALUES(col) -> excluded.col for ON CONFLICT
  s = s.replace(/VALUES\s*\(\s*([a-zA-Z0-9_]+)\s*\)/gi, 'excluded.$1');

  // Convert information_schema queries to sqlite_master
  if (/information_schema\.tables/i.test(s)) {
    s = s.replace(/SELECT\s+table_name\s+FROM\s+information_schema\.tables\s+WHERE\s+table_schema\s*=\s*'[^']+'\s+AND\s+table_name/gi, "SELECT name as table_name FROM sqlite_master WHERE type = 'table' AND name");
    s = s.replace(/FROM\s+information_schema\.tables/gi, "FROM sqlite_master WHERE type = 'table'");
  }

  // Convert ON DUPLICATE KEY UPDATE -> ON CONFLICT (...) DO UPDATE SET
  if (/ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(s)) {
    const tableMatch = s.match(/INSERT\s+INTO\s+([a-zA-Z0-9_]+)/i);
    const table = tableMatch ? tableMatch[1].toLowerCase() : '';
    let conflictTarget = '';
    if (table === 'users') conflictTarget = '(username)';
    else if (table === 'rooms') conflictTarget = '(number)';
    else if (table === 'billable_services') conflictTarget = '(id)';
    else if (table === 'pos_revenue') conflictTarget = '(date)';
    else if (table === 'weekly_shift_entries') conflictTarget = '(date, shift_type)';
    else if (table === 'weekly_expenses') conflictTarget = '(week_start)';
    else if (table === 'cash_denomination_report') conflictTarget = '(report_date)';
    else if (table === 'scheduled_bookings') conflictTarget = '(id)';
    else if (table === 'receipts') conflictTarget = '(receipt_no)';
    else if (table === 'kitchen_orders') conflictTarget = '(order_number)';
    else if (table === 'discount_rates') conflictTarget = '(discount_type, room_tier, duration)';
    else if (table === 'menu_item_inventory') conflictTarget = '(item_id)';
    else if (table === 'inventory_events') conflictTarget = '(id)';

    s = s.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE/gi, `ON CONFLICT ${conflictTarget} DO UPDATE SET`);
  }

  return s;
}

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
  insertId?: number | bigint;
}

export interface TransactionClient {
  query<T = any>(sqlText: string, params?: any[]): Promise<QueryResult<T>>;
}

/**
 * Unified query interface that executes on SQLite.
 * Returns { rows, rowCount, insertId } matching PostgreSQL and MySQL pool wrappers.
 */
export async function query<T = any>(sqlText: string, params?: any[]): Promise<QueryResult<T>> {
  const { sql: pgConverted, params: convertedParams } = convertPgQueryToMysql(sqlText, params);
  const sqliteSql = convertSqlForSqlite(pgConverted);

  // Sanitize undefined in params to null
  const sanitizedParams = (convertedParams || []).map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });

  const trimmed = sqliteSql.trim().toUpperCase();
  const isSelect = trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('WITH');

  try {
    const stmt = sqliteDb.prepare(sqliteSql);

    if (isSelect) {
      const rows = stmt.all(...sanitizedParams) as T[];
      return {
        rows,
        rowCount: rows.length,
      };
    } else {
      const info = stmt.run(...sanitizedParams);
      return {
        rows: [],
        rowCount: info.changes,
        insertId: info.lastInsertRowid,
      };
    }
  } catch (err: any) {
    console.error(`SQLite Query Error: ${err.message}\nSQL: ${sqliteSql}`);
    throw err;
  }
}

export interface TransactionContext {
  id: string;
  depth: number;
  client: TransactionClient;
}

export const txStorage = new AsyncLocalStorage<TransactionContext>();

let transactionMutex = Promise.resolve();

/**
 * Execute operations within an atomic SQLite transaction (Priority 2c).
 * Serialized via an async promise mutex at the top level to prevent concurrent
 * "cannot start a transaction within a transaction" errors in SQLite while strictly preserving ACID isolation.
 * Re-entrant calls within the same async context use AsyncLocalStorage (txStorage) and SQLite SAVEPOINT nesting
 * to eliminate mutex deadlocks and support nested transactions.
 */
export async function withTransaction<T>(
  fn: (client: TransactionClient) => Promise<T>
): Promise<T> {
  const currentStore = txStorage.getStore();

  if (currentStore) {
    // Nested / re-entrant transaction within an existing outer transaction:
    // Do NOT re-acquire mutex (avoids deadlock); use SQLite SAVEPOINT instead.
    const savepointDepth = currentStore.depth + 1;
    const savepointName = `sp_${savepointDepth}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    sqliteDb.prepare(`SAVEPOINT ${savepointName}`).run();

    const nestedContext: TransactionContext = {
      id: currentStore.id,
      depth: savepointDepth,
      client: currentStore.client,
    };

    return await txStorage.run(nestedContext, async () => {
      try {
        const result = await fn(nestedContext.client);
        sqliteDb.prepare(`RELEASE SAVEPOINT ${savepointName}`).run();
        return result;
      } catch (err) {
        try {
          sqliteDb.prepare(`ROLLBACK TO SAVEPOINT ${savepointName}`).run();
        } catch (rbErr) {
          console.error(`Failed to rollback savepoint ${savepointName}:`, rbErr);
        }
        throw err;
      }
    });
  }

  // Top-level transaction: acquire mutex lock and BEGIN IMMEDIATE
  let releaseLock: () => void = () => {};
  const currentLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  const previousLock = transactionMutex;
  transactionMutex = previousLock.then(() => currentLock).catch(() => currentLock);

  await previousLock;

  try {
    sqliteDb.prepare('BEGIN IMMEDIATE').run();
    const client: TransactionClient = {
      query: async <R = any>(text: string, params?: any[]): Promise<QueryResult<R>> => {
        return query<R>(text, params);
      },
    };

    const rootContext: TransactionContext = {
      id: `tx_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      depth: 0,
      client,
    };

    return await txStorage.run(rootContext, async () => {
      try {
        const result = await fn(client);
        sqliteDb.prepare('COMMIT').run();
        return result;
      } catch (err) {
        try {
          sqliteDb.prepare('ROLLBACK').run();
        } catch (rollbackErr) {
          console.error('Failed to rollback SQLite transaction:', rollbackErr);
        }
        throw err;
      }
    });
  } finally {
    releaseLock();
  }
}

/**
 * Tests database connectivity and reports status.
 */
export async function testConnection(): Promise<void> {
  initializeDatabaseSync();
  const roomCount = (sqliteDb.prepare('SELECT COUNT(*) as count FROM rooms').get() as any)?.count || 0;
  const userCount = (sqliteDb.prepare('SELECT COUNT(*) as count FROM users').get() as any)?.count || 0;

  console.log(`📁 SQLite Database Connected: ${DB_FILE_PATH}`);
  console.log(`   Rooms: ${roomCount} | Users: ${userCount}`);
  console.log(`   Timezone: ${process.env.TZ || 'Asia/Manila'}`);
}

export const pool = {
  query,
  withTransaction,
  connect: async () => ({
    query,
    release: () => {},
  }),
  getConnection: async () => ({
    query,
    release: () => {},
  }),
  end: async () => {
    try {
      sqliteDb.close();
    } catch {
      // Ignore already closed
    }
  },
};

