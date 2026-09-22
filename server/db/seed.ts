/**
 * server/db/seed.ts
 * Seeds the MySQL database with initial data from src/data.ts.
 * Run with: npm run seed
 *
 * Safe to run multiple times (idempotent via ON DUPLICATE KEY UPDATE / INSERT IGNORE).
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import bcrypt from 'bcryptjs';
import { pool } from './pool';
import { INITIAL_ROOMS, DEFAULT_BILLABLE_SERVICES } from '../../src/data';
import { SEED_USER_ACCOUNTS } from '../data/seed-accounts';

const SALT_ROUNDS = 10;

async function seedUsers() {
  console.log('🌱 Seeding users...');
  for (const user of SEED_USER_ACCOUNTS) {
    const hash = await bcrypt.hash(user.accessCode, SALT_ROUNDS);
    await pool.query(
      `INSERT INTO users (username, name, role, access_code_hash)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         role = VALUES(role),
         access_code_hash = VALUES(access_code_hash)`,
      [user.username, user.name, user.role, hash]
    );
  }
  console.log(`  ✅ ${SEED_USER_ACCOUNTS.length} users seeded.`);
}

async function seedRooms() {
  console.log('🌱 Seeding rooms...');
  for (const room of INITIAL_ROOMS) {
    await pool.query(
      `INSERT INTO rooms (
        number, tier, floor, room_type, state, label,
        guest_name, guest_id, num_guests, rate_selected,
        extra_beds, towel_sets, check_in_time, check_out_time,
        is_overdue, charged_food
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         tier = VALUES(tier),
         floor = VALUES(floor),
         room_type = VALUES(room_type),
         state = VALUES(state),
         label = VALUES(label),
         guest_name = VALUES(guest_name),
         guest_id = VALUES(guest_id),
         num_guests = VALUES(num_guests),
         rate_selected = VALUES(rate_selected),
         extra_beds = VALUES(extra_beds),
         towel_sets = VALUES(towel_sets),
         check_in_time = VALUES(check_in_time),
         check_out_time = VALUES(check_out_time),
         is_overdue = VALUES(is_overdue),
         charged_food = VALUES(charged_food),
         updated_at = NOW()`,
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
  console.log(`  ✅ ${INITIAL_ROOMS.length} rooms seeded.`);
}

async function seedBillableServices() {
  console.log('🌱 Seeding billable services...');
  for (const svc of DEFAULT_BILLABLE_SERVICES) {
    await pool.query(
      `INSERT INTO billable_services (
        id, type, name, price, category, active, description,
        rate_type, weekday_override, weekend_override, seasonal_override,
        seasonal_start, seasonal_end, image_url, is_deleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         price = VALUES(price),
         category = VALUES(category),
         active = VALUES(active),
         description = VALUES(description),
         rate_type = VALUES(rate_type),
         weekday_override = VALUES(weekday_override),
         weekend_override = VALUES(weekend_override),
         seasonal_override = VALUES(seasonal_override),
         seasonal_start = VALUES(seasonal_start),
         seasonal_end = VALUES(seasonal_end),
         image_url = VALUES(image_url),
         is_deleted = VALUES(is_deleted),
         updated_at = NOW()`,
      [
        svc.id,
        svc.type,
        svc.name,
        svc.price,
        svc.category,
        svc.active,
        svc.description || null,
        svc.rateType || null,
        svc.weekdayOverride || null,
        svc.weekendOverride || null,
        svc.seasonalOverride || null,
        svc.seasonalStart || null,
        svc.seasonalEnd || null,
        svc.imageUrl || null,
        svc.isDeleted || false,
      ]
    );
  }
  console.log(`  ✅ ${DEFAULT_BILLABLE_SERVICES.length} billable services seeded.`);
}

async function main() {
  console.log('\n🚀 Starting MySQL database seed...\n');
  try {
    await seedUsers();
    await seedRooms();
    await seedBillableServices();
    console.log('\n✅ MySQL Database seeded successfully!');
    console.log('   All rooms are now available and ready.');
    console.log('   No mock bookings, tasks, or audit logs added.');
    console.log('   Start fresh with your own data!\n');
  } catch (err) {
    console.error('\n❌ Seed failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
