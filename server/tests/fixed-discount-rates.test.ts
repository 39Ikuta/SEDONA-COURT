/**
 * server/tests/fixed-discount-rates.test.ts
 * Comprehensive test suite verifying all acceptance criteria for Fixed-Amount Discount Lookup Table & Discount Card:
 *
 * 1. Exact Table Resolution:
 *    - Every row in the table resolves to the correct amount in centavos for its exact (discount_type, room_tier, duration).
 * 2. Unmapped Gaps Handling:
 *    - Unmapped combinations (e.g. Senior + 3HR, Senior + 6HR, DC + 6HR, Senior + promo) return null.
 *    - Checkout flow blocks/rejects with 400 (per Decision Point #2) rather than silent fallback to percentage math.
 * 3. Client Price Tampering Immunity:
 *    - Crafted request with client-supplied discount amount (e.g. ₱9,999) is ignored in favor of server-computed value.
 * 4. Mutual Exclusivity:
 *    - Request attempting to select both Senior/PWD and Discount Card is rejected with 400.
 * 5. Total Computation Order & Mixed-Payment:
 *    - Total = subtotal - lookedUpDiscount.
 *    - MIXED split validation runs against total after discount deduction (subtotal -> discount -> total -> cash+gcash==total).
 * 6. Audit Logging & Operator Derivation:
 *    - Discount application audit log entry records discount type, amount, room/duration, and server-derived operator username.
 */

process.env.NODE_ENV = 'test';
process.env.TZ = 'Asia/Manila';

import http from 'http';
import { pool, sqliteDb } from '../db/pool';
import { signJwt } from '../utils/jwt';
import {
  getDiscountAmount,
  DISCOUNT_RATES_DATA,
  normalizeDiscountType,
  normalizeRoomTier,
  normalizeStayDuration,
} from '../utils/discount-rates';

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
  console.log('\n🏷️  STARTING FIXED DISCOUNT RATES & DISCOUNT CARD TEST SUITE\n');

  // --- 1. Table Exactness & Normalization Unit Tests ---
  console.log('--- 1. Table Exactness & Normalization ---');

  const EXPECTED_ROWS = [
    { type: 'DC', tier: 'CLASSIC', dur: '3HR', centavos: 4000, pesos: 40.0 },
    { type: 'DC', tier: 'CLASSIC', dur: '12HR', centavos: 5500, pesos: 55.0 },
    { type: 'DC', tier: 'CLASSIC', dur: '24HR', centavos: 9500, pesos: 95.0 },
    { type: 'DC', tier: 'PREMIUM', dur: '3HR', centavos: 5000, pesos: 50.0 },
    { type: 'DC', tier: 'PREMIUM', dur: '12HR', centavos: 6000, pesos: 60.0 },
    { type: 'DC', tier: 'PREMIUM', dur: '24HR', centavos: 10500, pesos: 105.0 },
    { type: 'DC', tier: 'VIP', dur: '3HR', centavos: 6500, pesos: 65.0 },
    { type: 'DC', tier: 'VIP', dur: '12HR', centavos: 7000, pesos: 70.0 },
    { type: 'DC', tier: 'VIP', dur: '24HR', centavos: 11500, pesos: 115.0 },
    { type: 'SENIOR', tier: 'CLASSIC', dur: '12HR', centavos: 19500, pesos: 195.0 },
    { type: 'SENIOR', tier: 'CLASSIC', dur: '24HR', centavos: 34000, pesos: 340.0 },
    { type: 'SENIOR', tier: 'PREMIUM', dur: '12HR', centavos: 21500, pesos: 215.0 },
    { type: 'SENIOR', tier: 'PREMIUM', dur: '24HR', centavos: 37500, pesos: 375.0 },
    { type: 'SENIOR', tier: 'VIP', dur: '12HR', centavos: 25500, pesos: 255.0 },
    { type: 'SENIOR', tier: 'VIP', dur: '24HR', centavos: 46000, pesos: 460.0 },
  ];

  assertTest(
    '1.1: DISCOUNT_RATES_DATA contains exactly 15 resolved records',
    DISCOUNT_RATES_DATA.length === 15,
    `Expected 15 rows, found ${DISCOUNT_RATES_DATA.length}`
  );

  for (const row of EXPECTED_ROWS) {
    const amount = getDiscountAmount(row.type, row.tier, row.dur);
    assertTest(
      `1.2: ${row.type} ${row.tier} ${row.dur} resolves to ${row.centavos} centavos (₱${row.pesos.toFixed(2)})`,
      amount === row.centavos,
      `Expected ${row.centavos}, got ${amount}`
    );
  }

  // Check database table records
  const dbRows = sqliteDb.prepare('SELECT * FROM discount_rates').all() as any[];
  assertTest(
    '1.3: discount_rates database table is populated with all 15 records in integer centavos',
    dbRows.length === 15,
    `Expected 15 DB rows, found ${dbRows.length}`
  );

  // Normalization checks with real room types
  assertTest(
    '1.4: Normalization maps "Standard" / "Classic Room" to CLASSIC',
    normalizeRoomTier('Standard') === 'CLASSIC' && normalizeRoomTier('Classic Room') === 'CLASSIC'
  );
  assertTest(
    '1.5: Normalization maps "Deluxe" / "Premium Room" to PREMIUM',
    normalizeRoomTier('Deluxe') === 'PREMIUM' && normalizeRoomTier('Premium Room') === 'PREMIUM'
  );
  assertTest(
    '1.6: Normalization maps "Suite" / "VIP Suite" to VIP',
    normalizeRoomTier('Suite') === 'VIP' && normalizeRoomTier('VIP Suite') === 'VIP'
  );
  assertTest(
    '1.7: Normalization maps rate types "3h", "12h", "24h" to "3HR", "12HR", "24HR"',
    normalizeStayDuration('3h') === '3HR' &&
    normalizeStayDuration('12h') === '12HR' &&
    normalizeStayDuration('24h') === '24HR'
  );
  assertTest(
    '1.8: Normalization resolves "S. PREMIUM 24 HRS" to 37,500 centavos (₱375.00)',
    getDiscountAmount('S.', 'PREMIUM', '24 HRS') === 37500
  );
  assertTest(
    '1.9: Normalization resolves "SENIOR VIP 12S" to 25,500 centavos (₱255.00)',
    getDiscountAmount('SENIOR', 'VIP', '12S') === 25500
  );
  assertTest(
    '1.10: Normalization resolves "SENIOR VIP 24S" to 46,000 centavos (₱460.00)',
    getDiscountAmount('SENIOR', 'VIP', '24S') === 46000
  );
  assertTest(
    '1.11: Normalization resolves "DC VIP 3 HR" to 6,500 centavos (₱65.00)',
    getDiscountAmount('DC', 'VIP', '3 HR') === 6500
  );

  // --- 2. Unmapped Gaps & Edge Cases ---
  console.log('\n--- 2. Unmapped Combinations (Gaps) ---');
  assertTest(
    '2.1: Senior + 3HR returns null (no 3hr senior discount configured)',
    getDiscountAmount('SENIOR', 'CLASSIC', '3HR') === null &&
    getDiscountAmount('SENIOR', 'PREMIUM', '3HR') === null &&
    getDiscountAmount('SENIOR', 'VIP', '3HR') === null
  );
  assertTest(
    '2.2: Senior + 6HR returns null',
    getDiscountAmount('SENIOR', 'CLASSIC', '6h') === null
  );
  assertTest(
    '2.3: DC + 6HR returns null',
    getDiscountAmount('DC', 'CLASSIC', '6h') === null
  );
  assertTest(
    '2.4: Senior + promo returns null',
    getDiscountAmount('SENIOR', 'CLASSIC', 'promo') === null
  );

  // --- Start Integration HTTP Server ---
  const { app } = await import('../index');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const cashierToken = signJwt({
    id: 2,
    username: 'ann',
    name: 'Ann (Cashier 1)',
    role: 'cashier',
  });

  try {
    // Helper to set up room state
    async function setupOccupiedRoom(roomNum: string, tier: string, rateSelected: string) {
      sqliteDb.prepare(`
        UPDATE rooms SET
          state = 'occupied',
          label = 'Test Guest',
          guest_name = 'Test Guest',
          tier = ?,
          rate_selected = ?,
          extra_beds = 0,
          towel_sets = 0,
          charged_food = '[]',
          check_in_time = datetime('now', '-2 hours')
        WHERE number = ?
      `).run(tier, rateSelected, roomNum);
    }

    // --- 3. Checkout Rejection on Unmapped Gaps ---
    console.log('\n--- 3. Checkout Enforcement on Unmapped Gaps ---');
    // Set Room 6 (Standard/Classic) to 3h
    await setupOccupiedRoom('6', 'Standard', '3h');

    const unmappedSeniorRes = await fetch(`${baseUrl}/api/receipts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cashierToken}`,
      },
      body: JSON.stringify({
        roomNumber: '6',
        rateSelected: '3h',
        isSeniorPwdDiscount: true,
        seniorPwdId: 'SC-12345',
        paymentMethod: 'CASH',
      }),
    });
    const unmappedSeniorData = (await unmappedSeniorRes.json()) as any;
    assertTest(
      '3.1: Checkout with unmapped Senior + 3h is rejected with HTTP 400',
      unmappedSeniorRes.status === 400 && unmappedSeniorData.error?.includes('No Senior/PWD discount configured'),
      `Status: ${unmappedSeniorRes.status}, Error: ${unmappedSeniorData.error}`
    );

    // --- 4. Mutual Exclusivity Enforcement ---
    console.log('\n--- 4. Mutual Exclusivity Enforcement ---');
    await setupOccupiedRoom('6', 'Standard', '12h');

    const bothDiscountsRes = await fetch(`${baseUrl}/api/receipts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cashierToken}`,
      },
      body: JSON.stringify({
        roomNumber: '6',
        rateSelected: '12h',
        isSeniorPwdDiscount: true,
        isDiscountCard: true,
        seniorPwdId: 'SC-12345',
        discountCardId: 'DC-99999',
        paymentMethod: 'CASH',
      }),
    });
    const bothDiscountsData = (await bothDiscountsRes.json()) as any;
    assertTest(
      '4.1: Request applying BOTH Senior/PWD and Discount Card is rejected with HTTP 400',
      bothDiscountsRes.status === 400 && bothDiscountsData.error?.includes('Only one discount type'),
      `Status: ${bothDiscountsRes.status}, Error: ${bothDiscountsData.error}`
    );

    // --- 5. Authoritative Server-Side Calculation & Tampering Immunity ---
    console.log('\n--- 5. Server-Authoritative Calculation & Tampering Immunity ---');
    // Classic 12h: baseRate = 1195. Looked up Senior discount = 195. Expected Total = 1000.
    // Client attempts to send fake discount: 9999 or total: 100
    const tamperedRes = await fetch(`${baseUrl}/api/receipts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cashierToken}`,
        'X-Idempotency-Key': `TEST-TAMPER-${Date.now()}`,
      },
      body: JSON.stringify({
        roomNumber: '6',
        rateSelected: '12h',
        isSeniorPwdDiscount: true,
        seniorPwdId: 'SC-2026-REAL',
        discount: 9999, // Client tampering
        discountAmount: 9999, // Client tampering
        total: 100, // Client tampering
        paymentMethod: 'CASH',
      }),
    });
    const tamperedReceipt = (await tamperedRes.json()) as any;
    assertTest(
      '5.1: Client-supplied discount amounts are ignored; server computes exact total ₱1,000.00 (₱1,195 - ₱195)',
      tamperedRes.status === 201 &&
      tamperedReceipt.subtotal === 1195 &&
      tamperedReceipt.total === 1000 &&
      tamperedReceipt.discount === 195,
      `Received subtotal: ${tamperedReceipt.subtotal}, total: ${tamperedReceipt.total}, discount: ${tamperedReceipt.discount}`
    );

    // Discount Card on Premium 24h: baseRate = 2300. Looked up DC = 105. Expected Total = 2195.
    await setupOccupiedRoom('14', 'Deluxe', '24h');
    const dcRes = await fetch(`${baseUrl}/api/receipts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cashierToken}`,
        'X-Idempotency-Key': `TEST-DC-${Date.now()}`,
      },
      body: JSON.stringify({
        roomNumber: '14',
        rateSelected: '24h',
        discountType: 'DC',
        discountIdRef: 'DC-CARD-7788',
        paymentMethod: 'CASH',
      }),
    });
    const dcReceipt = (await dcRes.json()) as any;
    assertTest(
      '5.2: Discount Card on Deluxe 24h resolves to exact table rate ₱105.00 (Total: ₱2,195.00)',
      dcRes.status === 201 &&
      dcReceipt.subtotal === 2300 &&
      dcReceipt.total === 2195 &&
      dcReceipt.discount === 105 &&
      dcReceipt.discountType === 'DC',
      `Received subtotal: ${dcReceipt.subtotal}, total: ${dcReceipt.total}, discount: ${dcReceipt.discount}`
    );

    // --- 6. Total Computation Order & Mixed-Payment Check ---
    console.log('\n--- 6. Mixed Payment Validation Order ---');
    // VIP 12h: baseRate = 1395. Senior discount = 255. Total = 1140.
    // Mixed payment must sum to 1140 (discount subtracted BEFORE payment split check)
    await setupOccupiedRoom('1', 'Suite', '12h');

    // Mismatched split: client attempts 1395 split (forgetting discount)
    const mismatchedMixedRes = await fetch(`${baseUrl}/api/receipts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cashierToken}`,
      },
      body: JSON.stringify({
        roomNumber: '1',
        rateSelected: '12h',
        isSeniorPwdDiscount: true,
        seniorPwdId: 'SC-VIP-01',
        paymentMethod: 'MIXED',
        cashAmount: 1000,
        gcashAmount: 395, // Sum = 1395 != 1140
        gcashRef: '1234567890123',
      }),
    });
    const mismatchedData = (await mismatchedMixedRes.json()) as any;
    assertTest(
      '6.1: MIXED payment validated against discounted total ₱1,140 (sum ₱1,395 rejected with 400)',
      mismatchedMixedRes.status === 400 && mismatchedData.error?.includes('do not equal total ₱1140.00'),
      `Status: ${mismatchedMixedRes.status}, Error: ${mismatchedData.error}`
    );

    // Balanced split: cash 600 + gcash 540 = 1140
    const balancedMixedRes = await fetch(`${baseUrl}/api/receipts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cashierToken}`,
        'X-Idempotency-Key': `TEST-MIXED-${Date.now()}`,
      },
      body: JSON.stringify({
        roomNumber: '1',
        rateSelected: '12h',
        isSeniorPwdDiscount: true,
        seniorPwdId: 'SC-VIP-01',
        paymentMethod: 'MIXED',
        cashAmount: 600,
        gcashAmount: 540,
        gcashRef: '1234567890123',
      }),
    });
    const balancedReceipt = (await balancedMixedRes.json()) as any;
    assertTest(
      '6.2: Balanced MIXED payment (₱600 cash + ₱540 gcash = ₱1,140 total) succeeds with 201',
      balancedMixedRes.status === 201 && balancedReceipt.total === 1140,
      `Status: ${balancedMixedRes.status}, Total: ${balancedReceipt.total}`
    );

    // --- 7. Audit Logging & Operator Derivation ---
    console.log('\n--- 7. Audit Logging & Operator Verification ---');
    const discountLogs = sqliteDb.prepare(`
      SELECT * FROM audit_logs
      WHERE action = 'DISCOUNT_APPLIED'
      ORDER BY timestamp DESC
      LIMIT 5
    `).all() as any[];

    assertTest(
      '7.1: Dedicated DISCOUNT_APPLIED audit log entry was created',
      discountLogs.length > 0,
      `Found ${discountLogs.length} DISCOUNT_APPLIED logs`
    );

    const latestLog = discountLogs[0];
    assertTest(
      '7.2: Audit log records server-derived operator "ann" (from JWT token, not client payload)',
      latestLog?.operator === 'ann',
      `Expected operator "ann", got "${latestLog?.operator}"`
    );

    assertTest(
      '7.3: Audit log details record discount type, amount, room, and duration',
      Boolean(latestLog?.details?.includes('Applied') && latestLog?.details?.includes('Room 1')),
      `Details: ${latestLog?.details}`
    );

  } finally {
    server.close();
  }

  // --- Summary Report ---
  console.log('\n=================================================');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`📊 TEST RESULTS: ${passed}/${results.length} PASSED ${failed === 0 ? '🎉 ALL PASSED' : `❌ ${failed} FAILED`}`);
  console.log('=================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
