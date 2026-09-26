/**
 * server/db/reset.ts
 * Completely clears all mock data, bookings, receipts, kitchen orders, shift reports,
 * and resets all rooms, services, and accounts to pristine factory defaults.
 *
 * Run with: npm run db:reset
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import bcrypt from 'bcryptjs';
import { pool, withTransaction } from './pool';
import { INITIAL_ROOMS, DEFAULT_BILLABLE_SERVICES } from '../../src/data';
import { SEED_USER_ACCOUNTS } from '../data/seed-accounts';

const SALT_ROUNDS = 10;

async function resetAllData() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Safety Guard: Cannot run database reset in production environment.');
  }

  console.log('\n🧹 Starting complete PMS database reset...\n');

  await withTransaction(async (conn) => {
    // 1. Clear operational & transaction tables
    console.log('🗑️  Clearing mock transaction & operational data...');
    await conn.query('DELETE FROM scheduled_bookings');
    await conn.query('DELETE FROM kitchen_orders');
    await conn.query('DELETE FROM handoff_tasks');
    await conn.query('DELETE FROM pos_revenue');
    await conn.query('DELETE FROM weekly_shift_entries');
    await conn.query('DELETE FROM weekly_expenses');
    await conn.query('DELETE FROM gcash_entries');
    await conn.query('DELETE FROM cash_denomination_report');
    await conn.query('DELETE FROM force_checkout_requests').catch(() => {});
    await conn.query('DELETE FROM deposit_transactions').catch(() => {});
    await conn.query('DELETE FROM inventory_events').catch(() => {});
    await conn.query('DELETE FROM menu_item_inventory').catch(() => {});
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
    for (const item of trackableItems) {
      await conn.query(
        `INSERT INTO menu_item_inventory (item_id, item_name, category, current_quantity, is_tracked)
         VALUES (?, ?, ?, 0, 1)
         ON DUPLICATE KEY UPDATE
           item_name = VALUES(item_name),
           category = VALUES(category),
           current_quantity = 0`,
        [item.id, item.name, item.category]
      ).catch(() => {});
    }
    console.log(`   ✅ Cleared bookings, receipts, kitchen orders, logs, deposits, shift reports, force checkouts, and initialized ${trackableItems.length} inventory items.`);

    // 2. Reset Rooms to pristine defaults
    console.log('🏨 Resetting all rooms to initial default state...');
    await conn.query('DELETE FROM rooms');
    for (const room of INITIAL_ROOMS) {
      await conn.query(
        `INSERT INTO rooms (
          number, tier, floor, room_type, state, label,
          guest_name, guest_id, num_guests, rate_selected,
          extra_beds, towel_sets, check_in_time, check_out_time,
          is_overdue, charged_food
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
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
          room.isOverdue || false,
          JSON.stringify(room.chargedFood || []),
        ]
      );
    }
    console.log(`   ✅ ${INITIAL_ROOMS.length} rooms reset to pristine defaults.`);

    // 3. Reset Billable Services
    console.log('📋 Resetting billable services catalog...');
    await conn.query('DELETE FROM billable_services');
    for (const svc of DEFAULT_BILLABLE_SERVICES) {
      await conn.query(
        `INSERT INTO billable_services (
          id, type, name, price, category, active, description,
          rate_type, weekday_override, weekend_override, seasonal_override,
          seasonal_start, seasonal_end, image_url, is_deleted
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
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
          svc.isDeleted ? 1 : 0,
        ]
      );
    }
    console.log(`   ✅ ${DEFAULT_BILLABLE_SERVICES.length} billable services restored.`);

    // 4. Reset User Accounts
    console.log('👥 Resetting user accounts...');
    await conn.query('DELETE FROM users');
    for (const user of SEED_USER_ACCOUNTS) {
      const hash = await bcrypt.hash(user.accessCode, SALT_ROUNDS);
      await conn.query(
        `INSERT INTO users (username, name, role, access_code_hash)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           role = VALUES(role),
           access_code_hash = VALUES(access_code_hash)`,
        [user.username, user.name, user.role, hash]
      );
    }
    console.log(`   ✅ ${SEED_USER_ACCOUNTS.length} user accounts verified & active.`);

    // 5. Initial audit log
    await conn.query(
      `INSERT INTO audit_logs (id, timestamp, operator, action, details)
       VALUES (?, NOW(), 'system', 'SYSTEM_RESET', 'Database reset to factory defaults for clean live testing.')`,
      [`log-reset-${Date.now()}`]
    );
  });

  console.log('\n✨ Database successfully reset to clean testing state!\n');
}

async function main() {
  try {
    await resetAllData();
  } catch (err) {
    console.error('\n❌ Reset failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
