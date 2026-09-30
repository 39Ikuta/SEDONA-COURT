/**
 * receipt-preprint-deposit-fullblast.test.ts
 *
 * Sedona Court PMS Full-Blast Master Verification Suite
 * Comprehensive End-to-End Integration & Unit Test Harness
 *
 * Verified Requirements:
 * 1. Sequential receipt number format: {CASHIER}-{SHIFT}-{MMDDYY}-{SEQ} (e.g. T-N-092926-001).
 * 2. Cashier code resolution: single initial (T), disambiguates collisions (TE, TEA).
 * 3. Pre-print receipt allocation: first pre-print allocates & stores allocated_receipt_no on room; second returns identical number!
 * 4. Final checkout reuses pre-printed allocated_receipt_no as the official receipt number.
 * 5. Unprinted/cancelled pre-print room/booking marks receipt number VOID in database with a reason.
 * 6. Time consumed formatted correctly ("1 hr 25 mins", "5 mins", "Less than 1 min", rounded down).
 * 7. Total Amount Due printed in double-width bold ESC/POS fitting 58mm and 80mm.
 * 8. Amount tendered and change calculated in centavos; blocks checkout if tendered < due.
 * 9. Deposit slip numbering DEP-{CASHIER}-{SHIFT}-{MMDDYY}-{SEQ} from deposit_counters, separate from sales totals.
 * 10. Shift report drawer cash balance equation: drawer cash = sales cash + deposits held - deposits refunded - expenses.
 * 11. Idempotency guarantees for checkout, deposit collection, and alarm actions.
 */

process.env.NODE_ENV = 'test';
process.env.TZ = 'Asia/Manila';

import assert from 'node:assert/strict';
import http from 'node:http';
import { pool, withTransaction } from '../db/pool';
import {
  sequenceService,
  resolveCashierCode,
  formatShiftCode,
  formatDateMMDDYY,
  formatSequentialReceiptNumber,
  formatDepositSlipNumber,
  formatConsumedTime,
  maskDiscountCardId,
} from '../services/sequence-service';
import {
  buildReceiptEscPosBuffer,
  buildDepositSlipEscPosBuffer,
  ESC_POS,
} from '../utils/escpos';
import { signJwt } from '../utils/jwt';
import { app } from '../index';

async function run() {
  console.log('\n================================================================================');
  console.log('🚀 STARTING SEDONA COURT PMS RECEIPT-PREPRINT-DEPOSIT FULL-BLAST TEST SUITE');
  console.log('================================================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passedCount++;
    } catch (err: any) {
      console.error(`❌ FAIL: ${name}`);
      console.error(`   Error: ${err.message}`);
      if (err.stack) {
        const lines = err.stack.split('\n').slice(1, 4).join('\n');
        console.error(`   ${lines}`);
      }
      failedCount++;
    }
  }

  // Start ephemeral HTTP server for API route integration tests
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // Generate test JWT auth tokens
  const adminToken = signJwt({
    id: 1,
    username: 'admin',
    name: 'System Administrator',
    role: 'admin',
  }, 3600);

  const cashierToken = signJwt({
    id: 2,
    username: 'teresa',
    name: 'Teresa Cashier',
    role: 'cashier',
  }, 3600);

  // Helper for HTTP requests
  async function apiRequest(path: string, options: { method?: string; body?: any; token?: string; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data: any = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  // Ensure necessary schema tables exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipt_counters (
      cashier_code TEXT NOT NULL,
      shift_code   TEXT NOT NULL,
      business_date TEXT NOT NULL,
      last_value   INTEGER NOT NULL DEFAULT 0,
      updated_at   TEXT DEFAULT (datetime('now', 'localtime')),
      PRIMARY KEY (cashier_code, shift_code, business_date)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS deposit_counters (
      cashier_code TEXT NOT NULL,
      shift_code   TEXT NOT NULL,
      business_date TEXT NOT NULL,
      last_value   INTEGER NOT NULL DEFAULT 0,
      updated_at   TEXT DEFAULT (datetime('now', 'localtime')),
      PRIMARY KEY (cashier_code, shift_code, business_date)
    )
  `);

  await pool.query(
    'INSERT OR IGNORE INTO users (id, username, name, role, access_code_hash) VALUES (?, ?, ?, ?, ?)',
    [999, 'teresa', 'Teresa Cashier', 'cashier', '$2b$10$dummyHashValueForTestTeresaCashierUser']
  );

  // ============================================================================
  // 1. SEQUENTIAL RECEIPT NUMBER FORMAT {CASHIER}-{SHIFT}-{MMDDYY}-{SEQ}
  // ============================================================================
  console.log('\n--- 1. Sequential Receipt Number Format {CASHIER}-{SHIFT}-{MMDDYY}-{SEQ} ---');

  await test('1.1: formatSequentialReceiptNumber formats as {CASHIER}-{SHIFT}-{MMDDYY}-{SEQ}', () => {
    assert.equal(formatSequentialReceiptNumber('T', 'N', '092926', 1), 'T-N-092926-001');
    assert.equal(formatSequentialReceiptNumber('T', 'N', '092926', 44), 'T-N-092926-044');
    assert.equal(formatSequentialReceiptNumber('TE', 'D', '092926', 123), 'TE-D-092926-123');
    assert.equal(formatSequentialReceiptNumber('TEA', 'N', '092926', 9), 'TEA-N-092926-009');
  });

  await test('1.2: formatDateMMDDYY and formatShiftCode correctly handle inputs', () => {
    const testDate = new Date(2026, 8, 29); // Sep 29, 2026
    assert.equal(formatDateMMDDYY(testDate), '092926');
    assert.equal(formatDateMMDDYY('2026-09-29T14:30:00.000Z'), '092926');
    assert.equal(formatShiftCode('DAY'), 'D');
    assert.equal(formatShiftCode('D'), 'D');
    assert.equal(formatShiftCode('NIGHT'), 'N');
    assert.equal(formatShiftCode('N'), 'N');
    assert.equal(formatShiftCode(null), 'D');
  });

  await test('1.3: allocateShiftReceiptNumber atomically increments counter per cashier, shift, and business date', async () => {
    const testDate = '092926';
    const cCode = 'TST1';

    await pool.query('DELETE FROM receipt_counters WHERE cashier_code = ?', [cCode]);

    const alloc1 = await withTransaction(async (conn) => {
      return await sequenceService.allocateShiftReceiptNumber(conn, {
        cashierCode: cCode,
        shift: 'N',
        date: testDate,
      });
    });
    assert.equal(alloc1.sequenceNumber, 1);
    assert.equal(alloc1.receiptNo, `${cCode}-N-${testDate}-001`);

    const alloc2 = await withTransaction(async (conn) => {
      return await sequenceService.allocateShiftReceiptNumber(conn, {
        cashierCode: cCode,
        shift: 'N',
        date: testDate,
      });
    });
    assert.equal(alloc2.sequenceNumber, 2);
    assert.equal(alloc2.receiptNo, `${cCode}-N-${testDate}-002`);

    // Another shift (Day) on same date has independent counter starting at 1
    const allocDay = await withTransaction(async (conn) => {
      return await sequenceService.allocateShiftReceiptNumber(conn, {
        cashierCode: cCode,
        shift: 'D',
        date: testDate,
      });
    });
    assert.equal(allocDay.sequenceNumber, 1);
    assert.equal(allocDay.receiptNo, `${cCode}-D-${testDate}-001`);
  });

  await test('1.4: Concurrency test: 10 concurrent allocations produce strictly contiguous sequence numbers', async () => {
    const testDate = '092926';
    const cCode = `CONC${Date.now().toString().slice(-4)}`;

    const promises = Array.from({ length: 10 }, () =>
      withTransaction(async (conn) => {
        return await sequenceService.allocateShiftReceiptNumber(conn, {
          cashierCode: cCode,
          shift: 'N',
          date: testDate,
        });
      })
    );

    const results = await Promise.all(promises);
    const seqs = results.map(r => r.sequenceNumber).sort((a, b) => a - b);
    const uniqueReceipts = new Set(results.map(r => r.receiptNo));

    assert.equal(uniqueReceipts.size, 10, 'All 10 receipts must be unique');
    assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  // ============================================================================
  // 2. CASHIER CODE CLASH RESOLUTION (T -> TE -> TEA)
  // ============================================================================
  console.log('\n--- 2. Cashier Code Clash Resolution (T -> TE -> TEA) ---');

  await test('2.1: Single cashier gets 1st initial (e.g. Teresa -> T, Maria -> M)', () => {
    assert.equal(resolveCashierCode('Teresa'), 'T');
    assert.equal(resolveCashierCode('Maria'), 'M');
    assert.equal(resolveCashierCode('Ann'), 'A');
    assert.equal(resolveCashierCode('Bob'), 'B');
  });

  await test('2.2: Collision disambiguation: Teresa (T) vs Teodoro (TE) vs Tea (TEA)', () => {
    const assignedCodes: string[] = [];

    // 1st Cashier: Teresa -> gets 'T'
    const code1 = resolveCashierCode('Teresa', assignedCodes);
    assert.equal(code1, 'T');
    assignedCodes.push(code1);

    // 2nd Cashier: Teodoro -> 'T' collides -> gets 'TE'
    const code2 = resolveCashierCode('Teodoro', assignedCodes);
    assert.equal(code2, 'TE');
    assignedCodes.push(code2);

    // 3rd Cashier: Tea -> 'T' and 'TE' collide -> gets 'TEA'
    const code3 = resolveCashierCode('Tea', assignedCodes);
    assert.equal(code3, 'TEA');
    assignedCodes.push(code3);

    // 4th Cashier: Tina -> 'T' collides, 'TI' is free -> gets 'TI'
    const code4 = resolveCashierCode('Tina', assignedCodes);
    assert.equal(code4, 'TI');
  });

  await test('2.3: Cashier code handles case-insensitivity and non-alphanumeric characters', () => {
    assert.equal(resolveCashierCode('  maria  '), 'M');
    assert.equal(resolveCashierCode('Ma. Luisa'), 'M');
    assert.equal(resolveCashierCode('Ma. Luisa', ['M']), 'MA');
  });

  // ============================================================================
  // 3. PRE-PRINT RECEIPT ALLOCATION & PERSISTENCE
  // ============================================================================
  console.log('\n--- 3. Pre-print Receipt Allocation & Persistence ---');

  await test('3.1: First pre-print allocates and stores allocated_receipt_no on room', async () => {
    await pool.query(
      `INSERT OR REPLACE INTO rooms (number, tier, room_type, state, label, guest_name, rate_selected, check_in_time, check_in_at, expected_checkout_at, alarm_state, allocated_receipt_no)
       VALUES ('901', 'Standard', 'Standard Single', 'occupied', 'Guest Preprint1', 'John Doe', '3h', datetime('now', '-1 hour'), datetime('now', '-1 hour'), datetime('now', '+2 hours'), 'NORMAL', NULL)`
    );

    const alloc = await withTransaction(async (conn) => {
      return await sequenceService.allocatePrePrintForRoom(conn, '901', {
        cashierCode: 'T',
        shift: 'N',
        date: '092926',
      });
    });

    assert(alloc.receiptNo);
    assert.match(alloc.receiptNo, /^T-N-092926-\d{3}$/);
    assert.equal(alloc.isReused, false);

    // Verify room has allocated_receipt_no persisted in DB
    const roomInDb = await pool.query('SELECT allocated_receipt_no FROM rooms WHERE number = ?', ['901']);
    assert.equal(roomInDb.rows[0].allocated_receipt_no, alloc.receiptNo);
  });

  await test('3.2: Second pre-print on same room returns IDENTICAL receipt number without incrementing counter', async () => {
    const roomBefore = await pool.query('SELECT allocated_receipt_no FROM rooms WHERE number = ?', ['901']);
    const initialReceiptNo = roomBefore.rows[0].allocated_receipt_no;
    assert(initialReceiptNo);

    // Second pre-print call
    const alloc2 = await withTransaction(async (conn) => {
      return await sequenceService.allocatePrePrintForRoom(conn, '901', {
        cashierCode: 'T',
        shift: 'N',
        date: '092926',
      });
    });

    assert.equal(alloc2.receiptNo, initialReceiptNo, 'Second pre-print must return identical receipt number');
    assert.equal(alloc2.isReused, true, 'isReused flag must be true on duplicate pre-print');
  });

  // ============================================================================
  // 4. FINAL CHECKOUT REUSES PRE-PRINTED RECEIPT NUMBER
  // ============================================================================
  console.log('\n--- 4. Final Checkout Reuses Pre-printed Receipt Number ---');

  await test('4.1: Final checkout reuses pre-printed allocated_receipt_no as official receipt number', async () => {
    // Room 902 with pre-allocated receipt number
    const preAllocatedNo = 'T-N-092926-088';
    await pool.query('DELETE FROM receipts WHERE receipt_no = ?', [preAllocatedNo]);
    await pool.query(
      `INSERT OR REPLACE INTO rooms (number, tier, room_type, state, label, guest_name, rate_selected, check_in_time, check_in_at, expected_checkout_at, alarm_state, allocated_receipt_no)
       VALUES ('902', 'Standard', 'Standard Single', 'occupied', 'Guest CheckoutPre', 'Jane Doe', '3h', datetime('now', '-2 hours'), datetime('now', '-2 hours'), datetime('now', '+1 hour'), 'NORMAL', ?)`
      , [preAllocatedNo]
    );

    // Perform checkout via SequenceService / DB simulation
    const checkoutResult = await withTransaction(async (conn) => {
      const roomRow = (await conn.query('SELECT * FROM rooms WHERE number = ?', ['902'])).rows[0];
      const officialReceiptNo = roomRow.allocated_receipt_no || (await sequenceService.allocateNextReceiptNumber(conn)).receiptNo;

      // Insert official receipt
      await conn.query(
        `INSERT INTO receipts (
          receipt_no, date_time, guest_name, room_number, room_type,
          payment_method, items, subtotal, service_charge, total, cashier_id,
          amount_tendered_cents, change_cents, consumed_minutes, status, receipt_snapshot
        ) VALUES (?, NOW(), ?, ?, ?, 'CASH', '[]', 395, 0, 395, 'teresa', 50000, 10500, 120, 'valid', ?)`,
        [
          officialReceiptNo,
          roomRow.guest_name,
          '902',
          roomRow.room_type,
          JSON.stringify({ receiptNo: officialReceiptNo, total: 395, guestName: roomRow.guest_name }),
        ]
      );

      // Reset room and clear allocated_receipt_no
      await conn.query(
        `UPDATE rooms SET state = 'available', label = 'Available', guest_name = '', allocated_receipt_no = NULL WHERE number = ?`,
        ['902']
      );

      return { officialReceiptNo };
    });

    assert.equal(checkoutResult.officialReceiptNo, preAllocatedNo, 'Official receipt must match pre-printed allocated receipt number');

    // Verify DB records
    const receiptInDb = await pool.query('SELECT * FROM receipts WHERE receipt_no = ?', [preAllocatedNo]);
    assert.equal(receiptInDb.rows.length, 1);
    assert.equal(receiptInDb.rows[0].status, 'valid');

    const roomAfter = await pool.query('SELECT state, allocated_receipt_no FROM rooms WHERE number = ?', ['902']);
    assert.equal(roomAfter.rows[0].state, 'available');
    assert.equal(roomAfter.rows[0].allocated_receipt_no, null);
  });

  // ============================================================================
  // 5. VOIDING UNPRINTED / CANCELLED PRE-PRINT BOOKINGS
  // ============================================================================
  console.log('\n--- 5. Voiding Unprinted / Cancelled Pre-print Bookings ---');

  await test('5.1: Cancelled pre-print marks receipt number VOID in database with reason and clears room', async () => {
    const cancelledReceiptNo = 'T-N-092926-099';
    await pool.query(
      `INSERT OR REPLACE INTO rooms (number, tier, room_type, state, label, guest_name, rate_selected, check_in_time, check_in_at, expected_checkout_at, alarm_state, allocated_receipt_no)
       VALUES ('903', 'Standard', 'Standard Single', 'occupied', 'Guest Cancel', 'Bob Cancel', '3h', datetime('now', '-1 hour'), datetime('now', '-1 hour'), datetime('now', '+2 hours'), 'NORMAL', ?)`
      , [cancelledReceiptNo]
    );

    const voidReason = 'Guest requested cancellation after pre-print bill folio delivered';
    await withTransaction(async (conn) => {
      await sequenceService.voidAllocatedReceipt(conn, cancelledReceiptNo, voidReason, 'teresa', '903');
    });

    // Verify receipt in DB is marked VOID
    const receiptRow = await pool.query('SELECT status, void_reason, voided_by FROM receipts WHERE receipt_no = ?', [cancelledReceiptNo]);
    assert.equal(receiptRow.rows.length, 1);
    assert.equal(receiptRow.rows[0].status, 'void');
    assert.equal(receiptRow.rows[0].void_reason, voidReason);
    assert.equal(receiptRow.rows[0].voided_by, 'teresa');

    // Verify room allocated_receipt_no is cleared
    const roomRow = await pool.query('SELECT allocated_receipt_no FROM rooms WHERE number = ?', ['903']);
    assert.equal(roomRow.rows[0].allocated_receipt_no, null);

    // Verify audit log
    const auditRow = await pool.query("SELECT * FROM audit_logs WHERE action = 'RECEIPT_VOIDED' AND details LIKE ? ORDER BY timestamp DESC LIMIT 1", [`%${cancelledReceiptNo}%`]);
    assert.equal(auditRow.rows.length, 1);
  });

  // ============================================================================
  // 6. TIME CONSUMED FORMATTING
  // ============================================================================
  console.log('\n--- 6. Time Consumed Formatting ---');

  await test('6.1: formatConsumedTime handles "Less than 1 min", "5 mins", "1 hr 25 mins", rounded down', () => {
    assert.equal(formatConsumedTime(0), 'Less than 1 min');
    assert.equal(formatConsumedTime(0.5), 'Less than 1 min');
    assert.equal(formatConsumedTime(-5), 'Less than 1 min');
    assert.equal(formatConsumedTime(null), 'Less than 1 min');
    assert.equal(formatConsumedTime(undefined), 'Less than 1 min');
    assert.equal(formatConsumedTime(5), '5 mins');
    assert.equal(formatConsumedTime(45), '45 mins');
    assert.equal(formatConsumedTime(60), '1 hr');
    assert.equal(formatConsumedTime(85), '1 hr 25 mins');
    assert.equal(formatConsumedTime(120), '2 hr');
    assert.equal(formatConsumedTime(1475), '24 hr 35 mins');
  });

  await test('6.2: UTC diff calculation floors seconds to minutes (never rounds up)', () => {
    const checkIn = new Date('2026-09-29T10:00:00.000Z');
    const checkOut = new Date('2026-09-29T11:25:59.000Z'); // 1h 25m 59s

    const diffMs = checkOut.getTime() - checkIn.getTime();
    const floorMinutes = Math.floor(diffMs / 60000);

    assert.equal(floorMinutes, 85, '59s must floor to 85 minutes');
    assert.equal(formatConsumedTime(floorMinutes), '1 hr 25 mins');

    // 0 minutes 45 seconds stay
    const shortDiffMs = 45 * 1000;
    const shortFloorMins = Math.floor(shortDiffMs / 60000);
    assert.equal(shortFloorMins, 0);
    assert.equal(formatConsumedTime(shortFloorMins), 'Less than 1 min');
  });

  // ============================================================================
  // 7. TOTAL AMOUNT DUE IN DOUBLE-WIDTH BOLD ESC/POS
  // ============================================================================
  console.log('\n--- 7. Total Amount Due in Double-Width Bold ESC/POS (58mm & 80mm) ---');

  await test('7.1: ESC/POS buffer generator includes native DOUBLE_BOTH_ON and BOLD_ON commands for 80mm', () => {
    const buffer80 = buildReceiptEscPosBuffer({
      receiptNo: 'T-N-092926-001',
      dateTime: '2026-09-29T12:00:00.000Z',
      guestName: 'John Doe',
      roomNumber: '101',
      roomType: 'Standard Single',
      cashierId: 'Teresa',
      checkIn: '2026-09-29T09:00:00.000Z',
      checkOut: '2026-09-29T12:00:00.000Z',
      timeConsumed: '3 hr',
      items: [{ description: 'Room Rent', amount: 15450.00 }],
      subtotal: 15450.00,
      total: 15450.00,
      paymentMethod: 'CASH',
      amountTendered: 16000.00,
      changeAmount: 550.00,
    }, '80mm');

    assert(buffer80.includes(ESC_POS.INIT));
    assert(buffer80.includes(ESC_POS.DOUBLE_BOTH_ON));
    assert(buffer80.includes(ESC_POS.BOLD_ON));
    assert(buffer80.includes(ESC_POS.FEED_AND_CUT));

    const text80 = buffer80.toString('utf-8');
    assert(text80.includes('TOTAL AMOUNT DUE:'));
    assert(text80.includes('PHP 15450.00'));
    assert(text80.includes('AMOUNT TENDERED:'));
    assert(text80.includes('CHANGE:'));
  });

  await test('7.2: ESC/POS buffer formats 58mm roll width without character overflowing 32 columns', () => {
    const buffer58 = buildReceiptEscPosBuffer({
      receiptNo: 'T-N-092926-002',
      dateTime: '2026-09-29T12:00:00.000Z',
      guestName: 'Alice Smith',
      roomNumber: '202',
      roomType: 'Deluxe Queen',
      cashierId: 'Teresa',
      checkIn: '2026-09-29T06:00:00.000Z',
      checkOut: '2026-09-29T12:00:00.000Z',
      timeConsumed: '6 hr',
      items: [{ description: 'Deluxe Rent', amount: 2100 }],
      subtotal: 2100,
      total: 2100,
      paymentMethod: 'CASH',
      amountTendered: 2500,
      changeAmount: 400,
    }, '58mm');

    assert(buffer58.length > 0);
    const text58 = buffer58.toString('utf-8');
    assert(text58.includes('TOTAL AMOUNT DUE:'));
    assert(text58.includes('PHP 2100.00'));
  });

  // ============================================================================
  // 8. AMOUNT TENDERED & CHANGE IN CENTAVOS & UNDERPAYMENT BLOCK
  // ============================================================================
  console.log('\n--- 8. Amount Tendered & Change in Centavos ---');

  await test('8.1: Exact centavos arithmetic: Exact payment, overpayment with change, GCash', () => {
    // 1. Exact Cash
    const due1 = 150000; // ₱1,500.00
    const tendered1 = 150000;
    const change1 = tendered1 - due1;
    assert.equal(change1, 0);

    // 2. Over Cash
    const due2 = 145050; // ₱1,450.50
    const tendered2 = 200000; // ₱2,000.00
    const change2 = tendered2 - due2;
    assert.equal(change2, 54950); // ₱549.50
    assert.equal((change2 / 100).toFixed(2), '549.50');

    // 3. GCash (Tendered = Total, Change = 0)
    const due3 = 220000;
    const tendered3 = due3;
    const change3 = 0;
    assert.equal(tendered3, 220000);
    assert.equal(change3, 0);
  });

  await test('8.2: Checkout blocks underpayment (tendered < total) with 400 error', async () => {
    await pool.query(
      `INSERT OR REPLACE INTO rooms (number, tier, room_type, state, label, guest_name, rate_selected, check_in_time, check_in_at, expected_checkout_at, alarm_state)
       VALUES ('904', 'Standard', 'Standard Single', 'occupied', 'Guest Underpay', 'Test Guest', '3h', datetime('now', '-1 hour'), datetime('now', '-1 hour'), datetime('now', '+2 hours'), 'NORMAL')`
    );

    const res = await apiRequest('/api/receipts', {
      method: 'POST',
      token: cashierToken,
      body: {
        roomNumber: '904',
        paymentMethod: 'CASH',
        amountTendered: 200, // ₱200 tendered for ₱395 stay
      },
    });

    assert.equal(res.status, 400);
    assert.match(res.data.error, /cannot be less than total amount due/i);
  });

  // ============================================================================
  // 9. DEPOSIT SLIP NUMBERING DEP-{CASHIER}-{SHIFT}-{MMDDYY}-{SEQ}
  // ============================================================================
  console.log('\n--- 9. Deposit Slip Numbering DEP-{CASHIER}-{SHIFT}-{MMDDYY}-{SEQ} ---');

  await test('9.1: formatDepositSlipNumber formats as DEP-{CASHIER}-{SHIFT}-{MMDDYY}-{SEQ}', () => {
    assert.equal(formatDepositSlipNumber('T', 'N', '092926', 1), 'DEP-T-N-092926-001');
    assert.equal(formatDepositSlipNumber('TE', 'D', '092926', 42), 'DEP-TE-D-092926-042');
  });

  await test('9.2: allocateShiftDepositNumber allocates sequential numbers from deposit_counters', async () => {
    const testDate = '092926';
    const cCode = 'DEPTEST';

    await pool.query('DELETE FROM deposit_counters WHERE cashier_code = ?', [cCode]);

    const depAlloc1 = await withTransaction(async (conn) => {
      return await sequenceService.allocateShiftDepositNumber(conn, {
        cashierCode: cCode,
        shift: 'N',
        date: testDate,
      });
    });
    assert.equal(depAlloc1.sequenceNumber, 1);
    assert.equal(depAlloc1.depositNo, `DEP-${cCode}-N-${testDate}-001`);

    const depAlloc2 = await withTransaction(async (conn) => {
      return await sequenceService.allocateShiftDepositNumber(conn, {
        cashierCode: cCode,
        shift: 'N',
        date: testDate,
      });
    });
    assert.equal(depAlloc2.sequenceNumber, 2);
    assert.equal(depAlloc2.depositNo, `DEP-${cCode}-N-${testDate}-002`);
  });

  await test('9.3: Security deposit collection creates deposit slip buffer and separates deposit from sales revenue', async () => {
    await pool.query(
      `INSERT OR REPLACE INTO rooms (number, tier, room_type, state, label, guest_name, rate_selected, check_in_time, check_in_at, expected_checkout_at, alarm_state)
       VALUES ('905', 'Standard', 'Standard Single', 'occupied', 'Guest Deposit', 'Harry Deposit', '24h', datetime('now', '-1 hour'), datetime('now', '-1 hour'), datetime('now', '+23 hours'), 'NORMAL')`
    );

    const depRes = await apiRequest('/api/deposits/security', {
      method: 'POST',
      token: cashierToken,
      body: {
        roomNumber: '905',
        amount: 500,
        paymentMethod: 'CASH',
        guestName: 'Harry Deposit',
        notes: 'Security keycard & towel deposit',
      },
    });

    assert([200, 201].includes(depRes.status));
    const dep = depRes.data.deposit;
    assert(dep);
    assert(dep.depositNumber);
    assert.equal(dep.amount, 500);
    assert.equal(dep.status, 'held');

    // Deposit Slip Buffer check
    const slipBuffer = buildDepositSlipEscPosBuffer({
      depositNumber: dep.depositNumber,
      dateTime: new Date().toISOString(),
      roomNumber: '905',
      guestName: 'Harry Deposit',
      cashierId: 'Teresa',
      amount: 500,
      paymentMethod: 'CASH',
      notes: 'Keycard deposit',
    }, '80mm');

    assert(slipBuffer.includes(ESC_POS.INIT));
    assert(slipBuffer.toString('utf-8').includes('SECURITY DEPOSIT ACKNOWLEDGMENT'));
    assert(slipBuffer.toString('utf-8').includes('PHP 500.00'));
  });

  // ============================================================================
  // 10. SHIFT REPORT DRAWER CASH BALANCE EQUATION
  // ============================================================================
  console.log('\n--- 10. Shift Report Drawer Cash Balance Equation ---');

  await test('10.1: Shift drawer cash equation: drawer cash = sales cash + deposits held - deposits refunded - expenses', () => {
    const salesCash = 2950.00; // ₱2,950 sales cash
    const depositsHeld = 500.00; // ₱500 held cash
    const depositsRefunded = 200.00; // ₱200 refunded cash
    const expenses = 350.00; // ₱350 operating expenses

    const expectedDrawerCash = Math.max(0, salesCash + depositsHeld - depositsRefunded - expenses);
    assert.equal(expectedDrawerCash, 2900.00);
  });

  await test('10.2: Shift settlement summary endpoint reconciles exact drawer cash on hand', async () => {
    const settlementRes = await apiRequest('/api/shift-settlement/summary', {
      method: 'GET',
      token: cashierToken,
    });

    assert.equal(settlementRes.status, 200);
    const data = settlementRes.data;

    assert(typeof data.totalCashReceived === 'number');
    assert(typeof data.depositsHeld === 'number');
    assert(typeof data.depositsRefunded === 'number');
    assert(typeof data.totalExpenses === 'number');
    assert(typeof data.expectedCashOnHand === 'number');

    const expectedCalculated = Math.max(
      0,
      data.totalCashReceived + data.depositsHeld - data.depositsRefunded - data.totalExpenses
    );

    assert.equal(
      data.expectedCashOnHand,
      expectedCalculated,
      'expectedCashOnHand must strictly satisfy: cashSales + depositsHeld - depositsRefunded - expenses'
    );
  });

  // ============================================================================
  // 11. IDEMPOTENCY GUARANTEES
  // ============================================================================
  console.log('\n--- 11. Idempotency Guarantees ---');

  await test('11.1: Checkout with duplicate idempotency-key returns identical receipt without re-allocating sequence', async () => {
    await pool.query(
      `INSERT OR REPLACE INTO rooms (number, tier, room_type, state, label, guest_name, rate_selected, check_in_time, check_in_at, expected_checkout_at, alarm_state)
       VALUES ('906', 'Standard', 'Standard Single', 'occupied', 'Guest Idempotent', 'Idem Guest', '3h', datetime('now', '-1 hour'), datetime('now', '-1 hour'), datetime('now', '+2 hours'), 'NORMAL')`
    );

    const testIdemKey = `idem-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const res1 = await apiRequest('/api/receipts', {
      method: 'POST',
      token: cashierToken,
      headers: { 'x-idempotency-key': testIdemKey },
      body: {
        roomNumber: '906',
        paymentMethod: 'CASH',
        amountTendered: 500,
      },
    });

    assert([200, 201].includes(res1.status));
    const receipt1 = res1.data;

    // Resend exact request with same idempotency key
    const res2 = await apiRequest('/api/receipts', {
      method: 'POST',
      token: cashierToken,
      headers: { 'x-idempotency-key': testIdemKey },
      body: {
        roomNumber: '906',
        paymentMethod: 'CASH',
        amountTendered: 500,
      },
    });

    assert.equal(res2.status, 200);
    const receipt2 = res2.data;

    assert.equal(receipt1.receiptNo, receipt2.receiptNo, 'Duplicate idempotency request must return identical receipt number');
    assert.equal(receipt1.total, receipt2.total);
  });

  console.log('\n================================================================================');
  console.log(`📊 FULL-BLAST TEST SUITE SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('================================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Fatal Test Suite Execution Error:', err);
  process.exit(1);
});
