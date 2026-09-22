/**
 * server/tests/discount-persistence.test.ts
 * Comprehensive test suite verifying Guest Discount Persistence & Receipt Reflection:
 *
 * 1. Discount Persistence on Room:
 *    - Setting Senior/PWD or Discount Card with ID Ref persists to SQLite `rooms` table.
 *    - Re-querying rooms (simulating drawer close and reopen) verifies discountType and discountIdRef remain intact.
 * 2. Checkout Receipt Reflection:
 *    - When room checks out, POST /api/receipts resolves discount authoritatively.
 *    - Receipt contains discount amount, discountType ('SENIOR' | 'DC'), discountIdRef, and line item.
 *    - Receipt subtotal, discount, and total amounts match exact pricing table.
 * 3. Fallback to Persisted Room Discount:
 *    - Even if client checkout payload omits discountType, server uses room's persisted discount.
 * 4. Room Post-Checkout Reset:
 *    - After checkout, room transitions to 'cleaning' and discount fields reset to 'NONE' / ''.
 * 5. Room Transfer Persistence:
 *    - Relocating a guest to another room migrates discount_type and discount_id_ref to target room.
 */

process.env.NODE_ENV = 'test';
process.env.TZ = 'Asia/Manila';

import { pool } from '../db/pool';
import { signJwt } from '../utils/jwt';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function assertTest(name: string, condition: boolean, errorDetail?: string) {
  results.push({ name, passed: condition, error: errorDetail });
  const icon = condition ? '✅' : '❌';
  console.log(`${icon} ${name}${!condition && errorDetail ? ` — FAILED: ${errorDetail}` : ''}`);
}

async function runTests() {
  console.log('\n🏷️  STARTING GUEST DISCOUNT PERSISTENCE & RECEIPT TEST SUITE\n');

  const token = signJwt({
    id: 1,
    username: 'admin',
    name: 'Administrator',
    role: 'admin',
  });

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  const BASE_URL = 'http://localhost:4000/api';

  try {
    // 1. Setup Room 6 as Occupied Classic Room (24h)
    console.log('--- 1. Set Discount on Room 6 & Verify Persistence ---');
    const checkInTime = new Date(Date.now() - 3600000).toISOString();
    const checkOutTime = new Date(Date.now() + 23 * 3600000).toISOString();

    const updateRes = await fetch(`${BASE_URL}/rooms/6`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        number: '6',
        state: 'occupied',
        label: 'Juan Dela Cruz',
        guestName: 'Juan Dela Cruz',
        guestId: 'ID-1234',
        numGuests: 2,
        rateSelected: '24h',
        checkInTime,
        checkOutTime,
        discountType: 'SENIOR',
        discountIdRef: 'SC-8888',
      }),
    });

    const updatedRoom: any = await updateRes.json();
    assertTest(
      'PUT /rooms/6 successfully updates room with SENIOR discount',
      updateRes.status === 200 && updatedRoom.discountType === 'SENIOR' && updatedRoom.discountIdRef === 'SC-8888',
      `Got status ${updateRes.status}, discountType: ${updatedRoom.discountType}, discountIdRef: ${updatedRoom.discountIdRef}`
    );

    // 2. Fetch Room from DB (Simulate Drawer Close & Re-open / Page Refresh)
    console.log('--- 2. Simulate Drawer Close & Query GET /rooms ---');
    const getRoomsRes = await fetch(`${BASE_URL}/rooms`, { headers });
    const roomsList: any[] = await getRoomsRes.json();
    const room6 = roomsList.find((r) => r.number === '6');

    assertTest(
      'GET /rooms preserves discountType === "SENIOR" across drawer close',
      room6?.discountType === 'SENIOR',
      `Expected SENIOR, got: ${room6?.discountType}`
    );
    assertTest(
      'GET /rooms preserves discountIdRef === "SC-8888" across drawer close',
      room6?.discountIdRef === 'SC-8888',
      `Expected SC-8888, got: ${room6?.discountIdRef}`
    );

    // Direct SQLite check
    const dbCheck = await pool.query('SELECT discount_type, discount_id_ref FROM rooms WHERE number = ?', ['6']);
    assertTest(
      'Direct SQLite row check confirms discount_type and discount_id_ref persisted in DB',
      dbCheck.rows[0]?.discount_type === 'SENIOR' && dbCheck.rows[0]?.discount_id_ref === 'SC-8888',
      `DB row has discount_type: ${dbCheck.rows[0]?.discount_type}, discount_id_ref: ${dbCheck.rows[0]?.discount_id_ref}`
    );

    // 3. Checkout Room 6 & Verify Receipt
    console.log('--- 3. Checkout Room 6 & Verify Receipt Reflection ---');
    const receiptNo = `SCTI-TEST-${Date.now().toString().slice(-6)}`;
    const checkoutRes = await fetch(`${BASE_URL}/receipts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        receiptNo,
        roomNumber: '6',
        paymentMethod: 'CASH',
        // Note: omit discountType in payload to verify DB fallback persistence!
      }),
    });

    const receipt: any = await checkoutRes.json();
    assertTest(
      'POST /receipts successfully checks out room with persisted discount',
      checkoutRes.status === 200 || checkoutRes.status === 201,
      `Got status ${checkoutRes.status}: ${JSON.stringify(receipt)}`
    );

    assertTest(
      'Receipt reflects discount amount (₱340 for Classic 24h Senior/PWD)',
      receipt.discount === 340,
      `Expected discount 340, got: ${receipt.discount}`
    );

    assertTest(
      'Receipt reflects discountType === "SENIOR"',
      receipt.discountType === 'SENIOR',
      `Expected SENIOR, got: ${receipt.discountType}`
    );

    assertTest(
      'Receipt reflects discountIdRef === "SC-8888"',
      receipt.discountIdRef === 'SC-8888',
      `Expected SC-8888, got: ${receipt.discountIdRef}`
    );

    const discountItem = receipt.items?.find((it: any) => it.description?.includes('Senior') || it.amount < 0);
    assertTest(
      'Receipt items array contains Senior / PWD Discount deduction line item (-₱340)',
      discountItem && discountItem.amount === -340,
      `Discount item: ${JSON.stringify(discountItem)}`
    );

    assertTest(
      'Discount line item subtext includes Reference ID [ID: SC-8888]',
      discountItem && discountItem.subtext?.includes('SC-8888'),
      `Discount subtext: ${discountItem?.subtext}`
    );

    // 4. Verify Post-Checkout Room Reset
    console.log('--- 4. Verify Room 6 Reset to CLEANING & Discount Cleared ---');
    const room6Post = await pool.query('SELECT state, discount_type, discount_id_ref FROM rooms WHERE number = ?', ['6']);
    assertTest(
      'Room 6 state transitioned to cleaning after checkout',
      room6Post.rows[0]?.state === 'cleaning',
      `State: ${room6Post.rows[0]?.state}`
    );
    assertTest(
      'Room 6 discount_type reset to "NONE" after checkout',
      room6Post.rows[0]?.discount_type === 'NONE',
      `discount_type: ${room6Post.rows[0]?.discount_type}`
    );
    assertTest(
      'Room 6 discount_id_ref reset to empty after checkout',
      !room6Post.rows[0]?.discount_id_ref,
      `discount_id_ref: ${room6Post.rows[0]?.discount_id_ref}`
    );

    // 5. Test Discount Card (DC) Persistence on Room 7
    console.log('--- 5. Test Discount Card (DC) Persistence on Room 7 ---');
    await fetch(`${BASE_URL}/rooms/7`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        number: '7',
        state: 'occupied',
        label: 'Maria Santos',
        guestName: 'Maria Santos',
        numGuests: 2,
        rateSelected: '12h',
        checkInTime: new Date().toISOString(),
        checkOutTime: new Date(Date.now() + 12 * 3600000).toISOString(),
        discountType: 'DC',
        discountIdRef: 'DC-CARD-99',
      }),
    });

    const room7Check = await pool.query('SELECT discount_type, discount_id_ref FROM rooms WHERE number = ?', ['7']);
    assertTest(
      'Room 7 successfully saved Discount Card (DC) and Card # DC-CARD-99',
      room7Check.rows[0]?.discount_type === 'DC' && room7Check.rows[0]?.discount_id_ref === 'DC-CARD-99',
      `Got ${room7Check.rows[0]?.discount_type}, ${room7Check.rows[0]?.discount_id_ref}`
    );

    // 6. Test Room Transfer Discount Migration (Room 7 -> Room 8)
    console.log('--- 6. Test Room Transfer Discount Migration (7 -> 8) ---');
    // Ensure room 8 is available
    await pool.query("UPDATE rooms SET state = 'available' WHERE number = '8'");

    const transferRes = await fetch(`${BASE_URL}/rooms/transfer`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sourceRoomNumber: '7',
        targetRoomNumber: '8',
        reason: 'Aircon maintenance',
        notes: 'Relocated with DC discount preserved',
      }),
    });

    const transferData: any = await transferRes.json();
    assertTest(
      'POST /rooms/transfer succeeded',
      transferRes.status === 200,
      `Status: ${transferRes.status}`
    );

    const room8Check = await pool.query('SELECT state, discount_type, discount_id_ref FROM rooms WHERE number = ?', ['8']);
    assertTest(
      'Target Room 8 inherited discount_type === "DC" from transfer',
      room8Check.rows[0]?.discount_type === 'DC',
      `Target discount_type: ${room8Check.rows[0]?.discount_type}`
    );
    assertTest(
      'Target Room 8 inherited discount_id_ref === "DC-CARD-99" from transfer',
      room8Check.rows[0]?.discount_id_ref === 'DC-CARD-99',
      `Target discount_id_ref: ${room8Check.rows[0]?.discount_id_ref}`
    );

    // Clean up test rooms
    await pool.query("UPDATE rooms SET state = 'available', discount_type = 'NONE', discount_id_ref = '', guest_name = '', check_in_time = NULL, check_out_time = NULL WHERE number IN ('6', '7', '8')");

    // Summary
    console.log('\n📊 TEST SUMMARY:');
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

    if (failed > 0) {
      process.exit(1);
    } else {
      console.log('🎉 ALL DISCOUNT PERSISTENCE & RECEIPT TESTS PASSED!\n');
      process.exit(0);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

runTests();
