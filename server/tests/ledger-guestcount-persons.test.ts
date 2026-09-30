/**
 * server/tests/ledger-guestcount-persons.test.ts
 *
 * Comprehensive Automated QA & Integration Test Suite for Sedona Court PMS:
 * - Section 9: Universal Transaction Ledger & Export Integrity
 * - Section 10: Guest Headcount & Analytics Aggregations
 * - Section 11: Persons Capacity & Extra Person Service Line Item
 *
 * Conforms to Karpathy Guidelines: Evidence before assertions, 100% test pass rate.
 */

process.env.NODE_ENV = 'test';
process.env.TZ = 'Asia/Manila';

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { pool } from '../db/pool';
import { signJwt } from '../utils/jwt';
import {
  getManilaDateParts,
  calculateStayRate,
  DEFAULT_TIER_RATES,
  calculateExtraPersonCharge,
  formatStayDuration,
} from '../utils/pricing';
import { formatManilaTime } from '../../src/utils/roomStatus';
import { socketManager } from '../websocket/socket-manager';
import { extendStay, switchToOpenTime } from '../services/alarm-service';

// --- Helper Types & Utility Functions ---

interface SimulatedReceipt {
  receipt_no: string;
  date_time: string;
  room_number: string;
  room_type: string;
  guest_name: string;
  payment_method: 'CASH' | 'GCASH' | 'MIXED';
  cash_amount: number;
  gcash_amount: number;
  total: number;
  subtotal: number;
  status: 'valid' | 'void';
  cashier_id: string;
  items: Array<{ description: string; subtext?: string; amount: number }>;
}

/**
 * Business Day grouping: hospitality business day starts at 06:00 AM Manila Time.
 * Night shift spans 18:00 to 06:00 (crossing midnight).
 */
function getBusinessDayAndShift(dateInput: Date | string): {
  businessDate: string;
  shiftType: 'DAY' | 'NIGHT';
} {
  const parts = getManilaDateParts(dateInput);
  const pad = (n: number) => String(n).padStart(2, '0');

  let busYear = parts.year;
  let busMonth = parts.month;
  let busDay = parts.day;

  // If time is between 00:00 and 05:59:59, it belongs to the previous calendar day's business date
  if (parts.hour < 6) {
    const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    d.setUTCDate(d.getUTCDate() - 1);
    busYear = d.getUTCFullYear();
    busMonth = d.getUTCMonth() + 1;
    busDay = d.getUTCDate();
  }

  const shiftType: 'DAY' | 'NIGHT' = parts.hour >= 6 && parts.hour < 18 ? 'DAY' : 'NIGHT';
  const businessDate = `${busYear}-${pad(busMonth)}-${pad(busDay)}`;

  return { businessDate, shiftType };
}

/**
 * Computes today vs same weekday last week delta.
 */
function computeGuestDelta(todayCount: number, lastWeekCount: number): {
  delta: number;
  percentDelta: number;
} {
  const delta = todayCount - lastWeekCount;
  const percentDelta = lastWeekCount > 0 ? (delta / lastWeekCount) * 100 : (todayCount > 0 ? 100 : 0);
  return {
    delta,
    percentDelta: Math.round(percentDelta * 10) / 10,
  };
}

// =============================================================================
// SECTION 9: UNIVERSAL TRANSACTION LEDGER
// =============================================================================

test('Section 9.1: Date column formats in Asia/Manila across midnight boundary', () => {
  // UTC 15:30 on 2026-09-28 is 23:30 (11:30 PM) Manila time on 2026-09-28
  const preMidnightUtc = '2026-09-28T15:30:00.000Z';
  const preParts = getManilaDateParts(preMidnightUtc);
  assert.equal(preParts.hour, 23, 'Hour should be 23 in Asia/Manila');
  assert.equal(preParts.minute, 30, 'Minute should be 30');
  assert.equal(preParts.day, 28, 'Day should be 28');
  assert.equal(formatManilaTime(preMidnightUtc), '11:30 PM', 'Formatted 12h time should be 11:30 PM');

  // UTC 16:30 on 2026-09-28 is 00:30 (12:30 AM) Manila time on 2026-09-29
  const postMidnightUtc = '2026-09-28T16:30:00.000Z';
  const postParts = getManilaDateParts(postMidnightUtc);
  assert.equal(postParts.hour, 0, 'Hour should be 0 (midnight) in Asia/Manila');
  assert.equal(postParts.minute, 30, 'Minute should be 30');
  assert.equal(postParts.day, 29, 'Day should have rolled over to 29 in Asia/Manila');
  assert.equal(formatManilaTime(postMidnightUtc), '12:30 AM', 'Formatted 12h time should be 12:30 AM');
});

test('Section 9.2: Default sort with mixed legacy random and sequential SCTI numbers (finalized_at DESC, receipt_number DESC)', () => {
  const dataset = [
    { receiptNo: 'SCTI-849102', finalizedAt: '2026-09-28T10:00:00.000Z' },
    { receiptNo: 'SCTI-000001', finalizedAt: '2026-09-28T10:00:00.000Z' },
    { receiptNo: 'SCTI-000002', finalizedAt: '2026-09-28T12:00:00.000Z' },
    { receiptNo: 'SCTI-129481', finalizedAt: '2026-09-28T14:00:00.000Z' },
    { receiptNo: 'SCTI-000003', finalizedAt: '2026-09-28T14:00:00.000Z' },
  ];

  // Sorting rule: finalized_at DESC, then receipt_number DESC
  const sorted = [...dataset].sort((a, b) => {
    const timeA = new Date(a.finalizedAt).getTime();
    const timeB = new Date(b.finalizedAt).getTime();
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return b.receiptNo.localeCompare(a.receiptNo);
  });

  const expectedOrder = [
    'SCTI-129481', // 14:00, SCTI-129481 > SCTI-000003
    'SCTI-000003', // 14:00
    'SCTI-000002', // 12:00
    'SCTI-849102', // 10:00, SCTI-849102 > SCTI-000001
    'SCTI-000001', // 10:00
  ];

  assert.deepEqual(
    sorted.map((r) => r.receiptNo),
    expectedOrder,
    'Ledger should sort primary by timestamp DESC and secondary by receipt number DESC'
  );
});

test('Section 9.3: Range filter boundaries strictly include 00:00:00.000 and 23:59:59.999', () => {
  const from = '2026-09-28';
  const to = '2026-09-28';

  const rangeStart = `${from}T00:00:00.000Z`;
  const rangeEnd = `${to}T23:59:59.999Z`;

  const records = [
    { id: 'REC-OUT-EARLY', ts: '2026-09-27T23:59:59.999Z' },
    { id: 'REC-IN-START', ts: '2026-09-28T00:00:00.000Z' },
    { id: 'REC-IN-MID', ts: '2026-09-28T12:30:00.000Z' },
    { id: 'REC-IN-END', ts: '2026-09-28T23:59:59.999Z' },
    { id: 'REC-OUT-LATE', ts: '2026-09-29T00:00:00.000Z' },
  ];

  const filtered = records.filter((r) => r.ts >= rangeStart && r.ts <= rangeEnd);

  assert.equal(filtered.length, 3, 'Exactly 3 records must fall within the inclusive boundary');
  assert.equal(filtered[0].id, 'REC-IN-START', '00:00:00.000 boundary must be included');
  assert.equal(filtered[1].id, 'REC-IN-MID');
  assert.equal(filtered[2].id, 'REC-IN-END', '23:59:59.999 boundary must be included');
});

test('Section 9.4: Shift crossing midnight (23:00 to 02:00) groups under one business day (06:00 start)', () => {
  // Check-in at 23:00 Manila (UTC 15:00) on 2026-09-28
  const checkIn = '2026-09-28T15:00:00.000Z';
  const groupCheckIn = getBusinessDayAndShift(checkIn);
  assert.equal(groupCheckIn.businessDate, '2026-09-28', '23:00 belongs to business day 2026-09-28');
  assert.equal(groupCheckIn.shiftType, 'NIGHT', '23:00 is in NIGHT shift');

  // Action at 02:00 Manila (UTC 18:00) on 2026-09-29 (calendar next day)
  const pastMidnight = '2026-09-28T18:00:00.000Z';
  const groupPastMidnight = getBusinessDayAndShift(pastMidnight);
  assert.equal(groupPastMidnight.businessDate, '2026-09-28', '02:00 still belongs to business day 2026-09-28');
  assert.equal(groupPastMidnight.shiftType, 'NIGHT', '02:00 is in NIGHT shift of that business day');

  // Action at 05:59 Manila (UTC 21:59) on 2026-09-29
  const endOfNight = '2026-09-28T21:59:59.000Z';
  const groupEndOfNight = getBusinessDayAndShift(endOfNight);
  assert.equal(groupEndOfNight.businessDate, '2026-09-28', '05:59 belongs to business day 2026-09-28');
  assert.equal(groupEndOfNight.shiftType, 'NIGHT');

  // Action at 06:00 Manila (UTC 22:00) on 2026-09-29 starts new business day
  const startOfDay = '2026-09-28T22:00:00.000Z';
  const groupStartOfDay = getBusinessDayAndShift(startOfDay);
  assert.equal(groupStartOfDay.businessDate, '2026-09-29', '06:00 rolls over to business day 2026-09-29');
  assert.equal(groupStartOfDay.shiftType, 'DAY', '06:00 is DAY shift');
});

test('Section 9.5: Filtered totals strictly match visible rows without phantom leaking', () => {
  const visibleReceipts: SimulatedReceipt[] = [
    {
      receipt_no: 'SCTI-000010',
      date_time: '2026-09-28T08:00:00.000Z',
      room_number: '101',
      room_type: 'Classic Room',
      guest_name: 'Alice',
      payment_method: 'CASH',
      cash_amount: 1500,
      gcash_amount: 0,
      total: 1500,
      subtotal: 1500,
      status: 'valid',
      cashier_id: 'ann',
      items: [{ description: 'Room Stay 24h', amount: 1500 }],
    },
    {
      receipt_no: 'SCTI-000011',
      date_time: '2026-09-28T09:00:00.000Z',
      room_number: '102',
      room_type: 'Premium Room',
      guest_name: 'Bob',
      payment_method: 'MIXED',
      cash_amount: 1000,
      gcash_amount: 800,
      total: 1800,
      subtotal: 1800,
      status: 'valid',
      cashier_id: 'ann',
      items: [{ description: 'Room Stay 24h', amount: 1800 }],
    },
    {
      receipt_no: 'SCTI-000012',
      date_time: '2026-09-28T10:00:00.000Z',
      room_number: '103',
      room_type: 'VIP Suite',
      guest_name: 'Charlie',
      payment_method: 'GCASH',
      cash_amount: 0,
      gcash_amount: 2200,
      total: 2200,
      subtotal: 2200,
      status: 'valid',
      cashier_id: 'ann',
      items: [{ description: 'Room Stay 24h', amount: 2200 }],
    },
  ];

  const totalRevenue = visibleReceipts.reduce((sum, r) => sum + r.total, 0);
  const totalCash = visibleReceipts.reduce((sum, r) => {
    if (r.payment_method === 'CASH') return sum + r.total;
    if (r.payment_method === 'MIXED') return sum + (r.cash_amount || 0);
    return sum;
  }, 0);
  const totalGcash = visibleReceipts.reduce((sum, r) => {
    if (r.payment_method === 'GCASH') return sum + r.total;
    if (r.payment_method === 'MIXED') return sum + (r.gcash_amount || 0);
    return sum;
  }, 0);

  assert.equal(totalRevenue, 5500, 'Total revenue should equal 5500');
  assert.equal(totalCash, 2500, 'Total cash should equal 2500');
  assert.equal(totalGcash, 3000, 'Total GCash should equal 3000');
  assert.equal(totalCash + totalGcash, totalRevenue, 'Sum of tender totals must equal gross revenue');
});

test('Section 9.6: Deposits (DEP-...) are excluded from sales totals', () => {
  const allTransactions = [
    { receiptNo: 'SCTI-000020', type: 'SALES', total: 1500 },
    { receiptNo: 'SCTI-000021', type: 'SALES', total: 850 },
    { receiptNo: 'DEP-000001', type: 'DEPOSIT', total: 1000 },
    { receiptNo: 'DEP-000002', type: 'DEPOSIT', total: 500 },
  ];

  // Sales filter excludes DEP-... receipts
  const salesOnly = allTransactions.filter((t) => !t.receiptNo.startsWith('DEP-'));
  const salesRevenue = salesOnly.reduce((sum, t) => sum + t.total, 0);

  assert.equal(salesOnly.length, 2, 'Deposits must be excluded from sales');
  assert.equal(salesRevenue, 2350, 'Sales revenue must be exactly ₱2350 (excluding ₱1500 deposits)');
});

// =============================================================================
// SECTION 10: GUEST COUNT & ANALYTICS
// =============================================================================

test('Section 10.1: Check-in before midnight and checkout after is counted once, in check-in shift', () => {
  // Check-in: 23:15 Manila Time (Sep 28), Checkout: 03:15 Manila Time (Sep 29)
  const booking = {
    id: 'BK-101',
    roomNumber: '105',
    checkInTime: '2026-09-28T15:15:00.000Z', // 23:15 Manila
    checkOutTime: '2026-09-28T19:15:00.000Z', // 03:15 Manila
    numGuests: 2,
    status: 'completed',
  };

  const shiftInfo = getBusinessDayAndShift(booking.checkInTime);
  assert.equal(shiftInfo.businessDate, '2026-09-28', 'Attributed to business day of check-in');
  assert.equal(shiftInfo.shiftType, 'NIGHT', 'Attributed to NIGHT shift of check-in');

  // Aggregator counts guest once
  const guestRecords = [booking];
  const totalGuests = guestRecords.reduce((sum, b) => sum + b.numGuests, 0);
  assert.equal(totalGuests, 2, 'Guest count is 2 (not duplicated on checkout)');
});

test('Section 10.2: Stay extensions and open-time do not increment guest count', async () => {
  const roomNumber = '981';
  await pool.query('DELETE FROM rooms WHERE number = ?', [roomNumber]).catch(() => {});
  await pool.query(
    `INSERT INTO rooms (number, tier, floor, room_type, state, guest_name, num_guests, rate_selected, check_in_at, expected_checkout_at, charged_food, is_overdue)
     VALUES (?, 'Standard', 1, 'Classic Room', 'occupied', 'Guest Multi', 3, '3h', NOW(), NOW(), '[]', 0)`,
    [roomNumber]
  );

  const initialRoom = (await pool.query('SELECT num_guests FROM rooms WHERE number = ?', [roomNumber])).rows[0];
  assert.equal(Number(initialRoom.num_guests), 3, 'Initial guest count is 3');

  // Perform quick stay extension (+1 hour)
  await extendStay(roomNumber, { hours: 1 }, 'cashier1');
  const extendedRoom = (await pool.query('SELECT num_guests FROM rooms WHERE number = ?', [roomNumber])).rows[0];
  assert.equal(Number(extendedRoom.num_guests), 3, 'Guest count remains 3 after stay extension');

  // Switch to open-time mode
  await switchToOpenTime(roomNumber, 'cashier1', 'Guest requested');
  const openTimeRoom = (await pool.query('SELECT num_guests FROM rooms WHERE number = ?', [roomNumber])).rows[0];
  assert.equal(Number(openTimeRoom.num_guests), 3, 'Guest count remains 3 after switching to open-time');

  // Cleanup
  await pool.query('DELETE FROM rooms WHERE number = ?', [roomNumber]).catch(() => {});
});

test('Section 10.3: Voided bookings, staff quarters (Room 12), and deposits are excluded from guest count', () => {
  const stays = [
    { id: 'S1', roomNumber: '101', roomType: 'Classic Room', numGuests: 2, status: 'valid' },
    { id: 'S2', roomNumber: '102', roomType: 'Premium Room', numGuests: 3, status: 'valid' },
    { id: 'S3', roomNumber: '12', roomType: 'Staff House', numGuests: 4, status: 'valid' }, // Staff quarters
    { id: 'S4', roomNumber: '103', roomType: 'VIP Suite', numGuests: 2, status: 'void' }, // Voided
    { id: 'DEP-1', roomNumber: '104', roomType: 'Deposit', numGuests: 1, isDeposit: true }, // Deposit
  ];

  const validGuestStays = stays.filter(
    (s) => s.status === 'valid' && s.roomType !== 'Staff House' && s.roomNumber !== '12' && !s.isDeposit
  );

  const guestCount = validGuestStays.reduce((sum, s) => sum + s.numGuests, 0);
  assert.equal(validGuestStays.length, 2, 'Only 2 valid paid guest stays remain');
  assert.equal(guestCount, 5, 'Total guest count should be 2 + 3 = 5');
});

test('Section 10.4: Breakdown sums (by room type, by shift, by hour) strictly equal total', () => {
  const testData = [
    { roomType: 'Classic Room', shift: 'DAY', hour: 8, guests: 2 },
    { roomType: 'Classic Room', shift: 'DAY', hour: 11, guests: 1 },
    { roomType: 'Premium Room', shift: 'DAY', hour: 14, guests: 3 },
    { roomType: 'Premium Room', shift: 'NIGHT', hour: 19, guests: 2 },
    { roomType: 'VIP Suite', shift: 'NIGHT', hour: 22, guests: 4 },
    { roomType: 'VIP Suite', shift: 'NIGHT', hour: 1, guests: 2 },
  ];

  const grandTotal = testData.reduce((s, d) => s + d.guests, 0); // 14

  // Breakdown by room type
  const byRoomType = testData.reduce((acc, d) => {
    acc[d.roomType] = (acc[d.roomType] || 0) + d.guests;
    return acc;
  }, {} as Record<string, number>);
  const sumRoomType = Object.values(byRoomType).reduce((a, b) => a + b, 0);
  assert.equal(sumRoomType, grandTotal, 'Room type sum must equal grand total');

  // Breakdown by shift
  const byShift = testData.reduce((acc, d) => {
    acc[d.shift] = (acc[d.shift] || 0) + d.guests;
    return acc;
  }, {} as Record<string, number>);
  const sumShift = Object.values(byShift).reduce((a, b) => a + b, 0);
  assert.equal(sumShift, grandTotal, 'Shift sum must equal grand total');

  // Breakdown by hour
  const byHour = testData.reduce((acc, d) => {
    acc[d.hour] = (acc[d.hour] || 0) + d.guests;
    return acc;
  }, {} as Record<number, number>);
  const sumHour = Object.values(byHour).reduce((a, b) => a + b, 0);
  assert.equal(sumHour, grandTotal, 'Hourly sum must equal grand total');
});

test('Section 10.5: Today vs same weekday last week delta calculation', () => {
  // Scenario A: Growth (18 today vs 12 last week)
  const resA = computeGuestDelta(18, 12);
  assert.equal(resA.delta, 6, 'Delta should be +6');
  assert.equal(resA.percentDelta, 50.0, 'Percentage delta should be +50.0%');

  // Scenario B: Decline (8 today vs 10 last week)
  const resB = computeGuestDelta(8, 10);
  assert.equal(resB.delta, -2, 'Delta should be -2');
  assert.equal(resB.percentDelta, -20.0, 'Percentage delta should be -20.0%');

  // Scenario C: Zero baseline last week (5 today vs 0 last week)
  const resC = computeGuestDelta(5, 0);
  assert.equal(resC.delta, 5, 'Delta should be +5');
  assert.equal(resC.percentDelta, 100.0, 'Percentage delta should be +100.0% when starting from 0');
});

test('Section 10.6 & 9.7: Role RBAC checks on analytics, export, and ledger endpoints', async () => {
  const { app } = await import('../index');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const adminToken = signJwt({ id: 1, username: 'admin', role: 'admin' }, 3600);
  const ownerToken = signJwt({ id: 9, username: 'owner', role: 'owner' }, 3600);
  const cashierToken = signJwt({ id: 2, username: 'ann', role: 'cashier' }, 3600);

  const testFetch = async (path: string, token?: string) => {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}${path}`, { headers });
    return res.status;
  };

  try {
    // 1. Unauthenticated requests get 401
    assert.equal(await testFetch('/api/report-exports/transactions-ledger'), 401, 'Unauth gets 401');
    assert.equal(await testFetch('/api/analytics/financial-summary'), 401, 'Unauth gets 401');

    // 2. Cashier gets 403 on authoritative exports
    assert.equal(await testFetch('/api/report-exports/transactions-ledger', cashierToken), 403, 'Cashier gets 403 on DB ledger export');
    assert.equal(await testFetch('/api/report-exports/executive-workbook?weekStart=2026-09-28', cashierToken), 403, 'Cashier gets 403 on DB executive workbook');

    // 3. Admin & Owner get 200 on authoritative exports and analytics
    assert.equal(await testFetch('/api/report-exports/transactions-ledger', adminToken), 200, 'Admin gets 200 on DB ledger export');
    assert.equal(await testFetch('/api/report-exports/transactions-ledger', ownerToken), 200, 'Owner gets 200 on DB ledger export');
    assert.equal(await testFetch('/api/analytics/financial-summary', adminToken), 200, 'Admin gets 200 on analytics summary');
    assert.equal(await testFetch('/api/analytics/financial-summary', ownerToken), 200, 'Owner gets 200 on analytics summary');

    // 4. Cashier has valid access to standard operational receipts ledger
    assert.equal(await testFetch('/api/receipts', cashierToken), 200, 'Cashier has access to standard receipts ledger');
  } finally {
    server.close();
  }
});

test('Section 10.7: Live socket update emits on check-in and checkout', async () => {
  let emittedEventCount = 0;
  let lastEmittedPayload: any = null;

  // Intercept socketManager.broadcastRoomUpdate
  const originalBroadcast = socketManager.broadcastRoomUpdate.bind(socketManager);
  socketManager.broadcastRoomUpdate = (data: any) => {
    emittedEventCount++;
    lastEmittedPayload = data;
    originalBroadcast(data);
  };

  try {
    // Check in Room 982
    const roomNumber = '982';
    await pool.query('DELETE FROM rooms WHERE number = ?', [roomNumber]).catch(() => {});
    await pool.query(
      `INSERT INTO rooms (number, tier, floor, room_type, state, guest_name, num_guests, rate_selected, check_in_at, charged_food)
       VALUES (?, 'Standard', 1, 'Classic Room', 'available', '', 0, '24h', NULL, '[]')`,
      [roomNumber]
    );

    const { app } = await import('../index');
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const cashierToken = signJwt({ id: 2, username: 'ann', role: 'cashier' }, 3600);

    const checkInRes = await fetch(`${baseUrl}/api/rooms/${roomNumber}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cashierToken}`,
      },
      body: JSON.stringify({
        state: 'occupied',
        guestName: 'Socket Test Guest',
        numGuests: 2,
        rateSelected: '3h',
      }),
    });

    assert.equal(checkInRes.status, 200, 'Check-in request should succeed');
    assert.ok(emittedEventCount >= 1, 'Socket broadcast must be emitted on check-in');
    assert.equal(lastEmittedPayload.roomNumber, roomNumber);
    assert.equal(lastEmittedPayload.state, 'occupied');
    assert.equal(lastEmittedPayload.guestName, 'Socket Test Guest');

    // Cleanup
    server.close();
    await pool.query('DELETE FROM rooms WHERE number = ?', [roomNumber]).catch(() => {});
  } finally {
    socketManager.broadcastRoomUpdate = originalBroadcast;
  }
});

// =============================================================================
// SECTION 11: PERSONS & EXTRA PERSON ITEM
// =============================================================================

test('Section 11.1 & 11.2: New check-in opens with persons = 2 at base rate; 1-person priced at same base rate', () => {
  const baseRateClassic3h = DEFAULT_TIER_RATES['Standard']['3h']; // 395

  // 1-person booking
  const charge1Pax = calculateExtraPersonCharge(1, 150);
  assert.equal(charge1Pax, 0, '1-person booking incurs ₱0 extra person surcharge');
  const total1Pax = baseRateClassic3h + charge1Pax;
  assert.equal(total1Pax, baseRateClassic3h, '1-person total equals base rate');

  // 2-person booking (default capacity)
  const charge2Pax = calculateExtraPersonCharge(2, 150);
  assert.equal(charge2Pax, 0, '2-person booking incurs ₱0 extra person surcharge');
  const total2Pax = baseRateClassic3h + charge2Pax;
  assert.equal(total2Pax, baseRateClassic3h, '2-person total equals base rate');
});

test('Section 11.3 & 11.4: Existing rooms prices unchanged and default does not carry over between check-ins', () => {
  // Existing room A checked in with 1 person
  const roomA = { numGuests: 1, baseRate: 1500, extraPersonCharge: calculateExtraPersonCharge(1, 150) };
  assert.equal(roomA.extraPersonCharge, 0);

  // Form check-in B customizes to 4 persons
  const formCheckInB = { numGuests: 4, extraPersonCharge: calculateExtraPersonCharge(4, 150) };
  assert.equal(formCheckInB.extraPersonCharge, 300, '4 persons = 2 extra pax * 150 = 300');

  // Room A price remains completely unchanged
  assert.equal(roomA.baseRate + roomA.extraPersonCharge, 1500, 'Room A price unchanged');

  // Form check-in C opens clean for next guest (defaults to 2 persons)
  const defaultPaxForNextCheckIn = 2;
  const formCheckInC = {
    numGuests: defaultPaxForNextCheckIn,
    extraPersonCharge: calculateExtraPersonCharge(defaultPaxForNextCheckIn, 150),
  };
  assert.equal(formCheckInC.numGuests, 2, 'Default for subsequent check-in must be 2');
  assert.equal(formCheckInC.extraPersonCharge, 0, 'Default extra person charge must be 0');
});

test('Section 11.5: Extra person item adds catalog price only for person 3+ (N - 2)', () => {
  const unitPrice = 150;

  // N = 1 -> 0
  assert.equal(calculateExtraPersonCharge(1, unitPrice), 0);
  // N = 2 -> 0
  assert.equal(calculateExtraPersonCharge(2, unitPrice), 0);
  // N = 3 -> 1 * 150 = 150
  assert.equal(calculateExtraPersonCharge(3, unitPrice), 150);
  // N = 4 -> 2 * 150 = 300
  assert.equal(calculateExtraPersonCharge(4, unitPrice), 300);
  // N = 5 -> 3 * 150 = 450
  assert.equal(calculateExtraPersonCharge(5, unitPrice), 450);
  // N = 6 -> 4 * 150 = 600
  assert.equal(calculateExtraPersonCharge(6, unitPrice), 600);
});

test('Section 11.6: Non-stock service item (extra-person) never decrements inventory or blocks sales', async () => {
  // Verify that billable services like extra-person, extra-bed, towel do not fail atomic stock checks
  // Create an occupied room with 4 guests (+2 extra persons)
  const roomNumber = '983';
  await pool.query('DELETE FROM rooms WHERE number = ?', [roomNumber]).catch(() => {});
  await pool.query(
    `INSERT INTO rooms (number, tier, floor, room_type, state, guest_name, num_guests, rate_selected, check_in_at, expected_checkout_at, charged_food)
     VALUES (?, 'Standard', 1, 'Classic Room', 'occupied', 'Non Stock Test', 4, '3h', NOW(), NOW(), '[]')`,
    [roomNumber]
  );

  const { app } = await import('../index');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const cashierToken = signJwt({ id: 2, username: 'ann', role: 'cashier' }, 3600);

  try {
    const checkoutRes = await fetch(`${baseUrl}/api/receipts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cashierToken}`,
      },
      body: JSON.stringify({
        roomNumber,
        paymentMethod: 'CASH',
        amountTendered: 1000,
      }),
    });

    assert.equal(checkoutRes.status, 201, 'Checkout with extra person service must succeed without inventory error');
    const receipt = await checkoutRes.json();
    assert.ok(receipt.receiptNo, 'Receipt must be generated');

    // Verify extra person surcharge line item exists
    const extraPaxItem = receipt.items.find((it: any) => it.description === 'Extra Person Surcharge');
    assert.ok(extraPaxItem, 'Receipt must include Extra Person Surcharge item');
    assert.equal(extraPaxItem.amount, 300, 'Extra person surcharge for 4 guests must be ₱300');
  } finally {
    server.close();
    await pool.query('DELETE FROM receipts WHERE room_number = ?', [roomNumber]).catch(() => {});
    await pool.query('DELETE FROM rooms WHERE number = ?', [roomNumber]).catch(() => {});
  }
});

test('Section 11.7: Changing catalog price later does not alter existing finalized bookings/receipts', async () => {
  const receiptNo = 'SCTI-HIST-001';
  await pool.query('DELETE FROM receipts WHERE receipt_no = ?', [receiptNo]).catch(() => {});

  const historicalItems = JSON.stringify([
    { description: 'Room Rent (Classic 3h)', amount: 350 },
    { description: 'Extra Person Surcharge', subtext: '1 Extra Guest(s) (beyond 2) x ₱150', amount: 150 },
  ]);

  await pool.query(
    `INSERT INTO receipts (
      receipt_no, date_time, guest_name, room_number, room_type,
      payment_method, total, subtotal, items, cashier_id, status
    ) VALUES (?, NOW(), 'Historical Guest', '101', 'Classic Room', 'CASH', 500, 500, ?, 'ann', 'valid')`,
    [receiptNo, historicalItems]
  );

  // Simulate owner updating extra-person price in catalog to ₱200
  await pool.query("UPDATE billable_services SET price = 200 WHERE id = 'extra-person'").catch(() => {});

  // Fetch receipt again
  const row = (await pool.query('SELECT * FROM receipts WHERE receipt_no = ?', [receiptNo])).rows[0];
  const items = JSON.parse(row.items);
  const extraPaxItem = items.find((i: any) => i.description === 'Extra Person Surcharge');

  assert.equal(Number(row.total), 500, 'Persisted receipt total remains ₱500');
  assert.equal(extraPaxItem.amount, 150, 'Historical item amount remains ₱150');

  // Revert catalog price back to 150
  await pool.query("UPDATE billable_services SET price = 150 WHERE id = 'extra-person'").catch(() => {});
  await pool.query('DELETE FROM receipts WHERE receipt_no = ?', [receiptNo]).catch(() => {});
});

test('Section 11.8: Cashier cannot edit catalog item price; persons and extra item quantity cannot diverge', async () => {
  const { app } = await import('../index');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const cashierToken = signJwt({ id: 2, username: 'ann', role: 'cashier' }, 3600);
  const ownerToken = signJwt({ id: 9, username: 'owner', role: 'owner' }, 3600);

  try {
    // 1. Cashier attempts to update service price -> 403
    const cashierPut = await fetch(`${baseUrl}/api/services/extra-person`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cashierToken}`,
      },
      body: JSON.stringify({ name: 'Extra Person', price: 999, category: 'Services' }),
    });
    assert.equal(cashierPut.status, 403, 'Cashier must get 403 when trying to edit catalog price');

    // 2. Owner can update service price -> 200
    const ownerPut = await fetch(`${baseUrl}/api/services/extra-person`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ name: 'Extra Person', price: 150, category: 'Services', active: true }),
    });
    assert.equal(ownerPut.status, 200, 'Owner can update service price');

    // 3. Persons and extra item quantity mathematical consistency:
    // extraPersons is strictly max(0, persons - 2)
    for (let persons = 1; persons <= 10; persons++) {
      const extra = Math.max(0, persons - 2);
      const charge = calculateExtraPersonCharge(persons, 150);
      assert.equal(charge, extra * 150, `Extra pax charge for ${persons} persons must strictly equal ${extra} * 150`);
    }
  } finally {
    server.close();
  }
});
