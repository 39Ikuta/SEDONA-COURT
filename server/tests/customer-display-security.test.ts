/**
 * server/tests/customer-display-security.test.ts
 * Comprehensive Security & RBAC Verification for Customer Display Role.
 * 
 * Test Requirements:
 * 1. customer_display token/session can read the new endpoint.
 * 2. customer_display gets 401/403 on every existing staff route:
 *    - bookings (GET /api/bookings, POST /api/bookings)
 *    - receipts (GET /api/receipts, POST /api/receipts)
 *    - rooms admin (GET /api/rooms, PUT /api/rooms/:number, POST /api/rooms/reset)
 *    - analytics (GET /api/analytics/financial-summary)
 *    - audit-logs (GET /api/audit-logs, POST /api/audit-logs)
 *    - kitchen (GET /api/kitchen/orders, POST /api/kitchen/orders)
 *    - force-checkout (GET /api/force-checkout, POST /api/force-checkout)
 * 3. The new endpoint's response contains NONE of:
 *    - guest name (guestName, guest_name)
 *    - guest ID
 *    - exact rate / rate selected / pricing
 *    - checkout timestamps / stay time
 *    - receipt data
 *    - audit info
 *    - charged food or internal pending flags
 *    - Room 12 / Staff House is strictly 'unavailable'
 *    - EXCEPTION: checkInTime IS exposed, but ONLY for occupied rooms
 *      (no guest identity travels with it) — verified in Section 2b.
 */

process.env.NODE_ENV = 'test';
process.env.TZ = 'Asia/Manila';

import http from 'http';
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
  console.log('\n🔒 STARTING CUSTOMER DISPLAY SECURITY & RBAC TEST SUITE\n');

  const { app } = await import('../index');

  // Start ephemeral HTTP test server
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // Generate test tokens
    const customerDisplayToken = signJwt({
      id: 9999,
      username: 'kiosk',
      name: 'Lobby Display Kiosk',
      role: 'customer_display',
    }, 3600);

    const adminToken = signJwt({
      id: 1,
      username: 'admin',
      name: 'System Administrator',
      role: 'admin',
    }, 3600);

    const cashierToken = signJwt({
      id: 2,
      username: 'ann',
      name: 'Ann (Cashier 1)',
      role: 'cashier',
    }, 3600);

    const authHeaders = (token?: string) => token ? { Authorization: `Bearer ${token}` } : {};

    // Helper request function
    async function request(path: string, options: { method?: string; body?: any; token?: string } = {}) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (options.token) {
        headers['Authorization'] = `Bearer ${options.token}`;
      }
      const res = await fetch(`${baseUrl}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    }

    // =========================================================================
    // SECTION 1: CUSTOMER DISPLAY ACCESS TO NEW ENDPOINT
    // =========================================================================
    console.log('--- 1. Customer Display Endpoint Access ---');

    // 1.1 customer_display token can read /api/display/rooms
    const dispRes = await request('/api/display/rooms', { token: customerDisplayToken });
    assertTest(
      '1.1: customer_display token can read /api/display/rooms (status 200)',
      dispRes.status === 200 && Array.isArray(dispRes.data),
      `Received status ${dispRes.status}`
    );

    // 1.2 customer_display token can read /api/public/room-availability
    const pubRes = await request('/api/public/room-availability', { token: customerDisplayToken });
    assertTest(
      '1.2: customer_display token can read /api/public/room-availability (status 200)',
      pubRes.status === 200 && Array.isArray(pubRes.data),
      `Received status ${pubRes.status}`
    );

    // 1.3 Unauthenticated request without token can read sanitized rooms (Option a public fallback)
    const unauthRes = await request('/api/display/rooms');
    assertTest(
      '1.3: Unauthenticated public request to /api/display/rooms succeeds with sanitized data (status 200)',
      unauthRes.status === 200 && Array.isArray(unauthRes.data),
      `Expected 200, got ${unauthRes.status}`
    );

    // 1.4 Malformed Bearer token is rejected with 401
    const malformedRes = await request('/api/display/rooms', { token: 'invalid.forged.jwt.token' });
    assertTest(
      '1.4: Malformed or invalid Bearer token is rejected with 401',
      malformedRes.status === 401,
      `Expected 401, got ${malformedRes.status}`
    );

    // =========================================================================
    // SECTION 2: PAYLOAD SANITIZATION & ZERO-PII / ZERO-FINANCIAL ASSERTIONS
    // =========================================================================
    console.log('\n--- 2. Payload Shape & Zero-PII/Zero-Financial Assertions ---');

    const rooms = (dispRes.data as any[]) || [];
    assertTest('2.1: Endpoint returns non-empty room array', rooms.length > 0, `Length: ${rooms.length}`);

    // Check every single room for strict field hygiene
    // (checkInTime is the sole timestamp exception: occupied rooms only)
    const allowedKeys = new Set(['roomNumber', 'roomType', 'tier', 'floor', 'status', 'checkInTime']);
    const forbiddenKeys = [
      'guestName', 'guest_name', 'guestId', 'guest_id',
      'rateSelected', 'rate_selected', 'price', 'rates',
      'checkOutTime', 'check_out_time',
      'chargedFood', 'charged_food', 'fcr_id', 'forceCheckoutPending',
      'numGuests', 'extraBeds', 'towelSets', 'isOverdue', 'time',
      'receipts', 'subtotal', 'total', 'serviceCharge', 'auditLogs', 'logs'
    ];

    let allKeysValid = true;
    let noForbiddenKeysFound = true;
    let invalidStatusFound = false;
    let room12IsUnavailable = false;

    for (const room of rooms) {
      // Ensure all present keys are strictly within the allowed set
      for (const key of Object.keys(room)) {
        if (!allowedKeys.has(key)) {
          allKeysValid = false;
        }
      }
      // Ensure none of the forbidden keys are present
      for (const forbidden of forbiddenKeys) {
        if (room[forbidden] !== undefined) {
          noForbiddenKeysFound = false;
        }
      }
      // Status must be strictly one of: 'available' | 'occupied' | 'unavailable'
      if (!['available', 'occupied', 'unavailable'].includes(room.status)) {
        invalidStatusFound = true;
      }
      // Check room 12 specifically
      if (room.roomNumber === '12') {
        room12IsUnavailable = room.status === 'unavailable';
      }
    }

    assertTest(
      '2.2: Response contains ONLY authorized fields (roomNumber, roomType, tier, floor, status, checkInTime)',
      allKeysValid,
      'Found extra unexpected keys in room payload'
    );

    assertTest(
      '2.3: Zero PII / Zero Financial data: guest names, IDs, rates, checkout times, receipts completely absent (check-in time excepted)',
      noForbiddenKeysFound,
      'Detected sensitive guest/financial fields in payload'
    );

    assertTest(
      '2.4: Status is strictly bucketed into "available" | "occupied" | "unavailable"',
      !invalidStatusFound,
      'Found unbucketed or raw status values'
    );

    assertTest(
      '2.5: Room 12 (Staff House) is explicitly marked as "unavailable" per requirements',
      room12IsUnavailable,
      `Room 12 status was not 'unavailable'`
    );

    // =========================================================================
    // SECTION 2b: OCCUPIED CHECK-IN TIME ECHO (privacy-scoped)
    // =========================================================================
    console.log('\n--- 2b. Occupied Check-In Time Echo ---');

    // Snapshot room 3 so the suite restores it afterwards.
    const snapRes = await pool.query('SELECT * FROM rooms WHERE number = ?', ['3']);
    const snap3 = snapRes.rows[0];

    // Occupy room 3 with a known check-in time (staff PUT), keeping its
    // current extras so no inventory delta is consumed by the setup itself.
    const staffRooms = await request('/api/rooms', { token: cashierToken });
    const staffRoom3 = (staffRooms.data as any[]).find((r: any) => r.number === '3');
    const knownCheckIn = '2026-09-12T06:00:00.000Z';
    const occupyRes = await request('/api/rooms/3', {
      method: 'PUT',
      token: cashierToken,
      body: {
        ...staffRoom3,
        state: 'occupied',
        label: 'Test',
        guestName: 'Display Test',
        checkInTime: knownCheckIn,
        checkOutTime: '2026-09-13T06:00:00.000Z',
      },
    });
    assertTest(
      '2b.1: Staff can occupy room 3 for echo setup (status 200)',
      occupyRes.status === 200,
      `Expected 200, got ${occupyRes.status}`
    );

    const dispRes2 = await request('/api/display/rooms', { token: customerDisplayToken });
    const rooms2 = (dispRes2.data as any[]) || [];
    const echoRoom3 = rooms2.find((r: any) => r.roomNumber === '3');
    assertTest(
      '2b.2: Occupied room echoes its actual check-in time',
      echoRoom3?.status === 'occupied' && echoRoom3?.checkInTime === knownCheckIn,
      `Got: ${JSON.stringify(echoRoom3)}`
    );
    assertTest(
      '2b.3: Echoed room still carries no guest identity',
      echoRoom3 && echoRoom3.guestName === undefined && echoRoom3.guest_name === undefined,
      `Got: ${JSON.stringify(echoRoom3)}`
    );
    const nonOccupiedLeak = rooms2.some(
      (r: any) => r.roomNumber !== '3' && r.status !== 'occupied' && r.checkInTime != null
    );
    assertTest(
      '2b.4: Non-occupied rooms expose no check-in time (null)',
      !nonOccupiedLeak,
      'A non-occupied room exposed checkInTime'
    );

    // Restore room 3 to its pre-suite state.
    await pool.query(
      `UPDATE rooms SET state = ?, label = ?, guest_name = ?, guest_id = ?, num_guests = ?,
        rate_selected = ?, custom_hours = ?, extra_beds = ?, towel_sets = ?,
        check_in_time = ?, check_out_time = ?, is_overdue = ?, charged_food = ?
       WHERE number = '3'`,
      [
        snap3.state, snap3.label, snap3.guest_name, snap3.guest_id, snap3.num_guests,
        snap3.rate_selected, snap3.custom_hours, snap3.extra_beds, snap3.towel_sets,
        snap3.check_in_time, snap3.check_out_time, snap3.is_overdue, snap3.charged_food,
      ]
    );

    // =========================================================================
    // SECTION 3: REJECTION OF CUSTOMER_DISPLAY ON ALL STAFF ROUTES (401/403)
    // =========================================================================
    console.log('\n--- 3. Staff Route Access Denials (Least Privilege RBAC) ---');

    // 3.1 Bookings
    const getBookings = await request('/api/bookings', { token: customerDisplayToken });
    assertTest(
      '3.1a: customer_display receives 403 on GET /api/bookings',
      getBookings.status === 403,
      `Expected 403, got ${getBookings.status}`
    );

    const postBookings = await request('/api/bookings', {
      method: 'POST',
      body: { id: 'test-kiosk-booking', roomNumber: '101' },
      token: customerDisplayToken,
    });
    assertTest(
      '3.1b: customer_display receives 403 on POST /api/bookings (no self-service mutations)',
      postBookings.status === 403,
      `Expected 403, got ${postBookings.status}`
    );

    // 3.2 Receipts
    const getReceipts = await request('/api/receipts', { token: customerDisplayToken });
    assertTest(
      '3.2a: customer_display receives 403 on GET /api/receipts',
      getReceipts.status === 403,
      `Expected 403, got ${getReceipts.status}`
    );

    const postReceipts = await request('/api/receipts', {
      method: 'POST',
      body: { roomNumber: '101' },
      token: customerDisplayToken,
    });
    assertTest(
      '3.2b: customer_display receives 403 on POST /api/receipts',
      postReceipts.status === 403,
      `Expected 403, got ${postReceipts.status}`
    );

    // 3.3 Rooms Admin
    const getRoomsAdmin = await request('/api/rooms', { token: customerDisplayToken });
    assertTest(
      '3.3a: customer_display receives 403 on GET /api/rooms (internal room state with PII)',
      getRoomsAdmin.status === 403,
      `Expected 403, got ${getRoomsAdmin.status}`
    );

    const putRoomAdmin = await request('/api/rooms/101', {
      method: 'PUT',
      body: { state: 'available' },
      token: customerDisplayToken,
    });
    assertTest(
      '3.3b: customer_display receives 403 on PUT /api/rooms/:number',
      putRoomAdmin.status === 403,
      `Expected 403, got ${putRoomAdmin.status}`
    );

    const postRoomReset = await request('/api/rooms/reset', {
      method: 'POST',
      token: customerDisplayToken,
    });
    assertTest(
      '3.3c: customer_display receives 403 on POST /api/rooms/reset',
      postRoomReset.status === 403,
      `Expected 403, got ${postRoomReset.status}`
    );

    // 3.4 Analytics
    const getAnalytics = await request('/api/analytics/financial-summary', { token: customerDisplayToken });
    assertTest(
      '3.4: customer_display receives 403 on GET /api/analytics/financial-summary',
      getAnalytics.status === 403,
      `Expected 403, got ${getAnalytics.status}`
    );

    // 3.5 Audit Logs
    const getAuditLogs = await request('/api/audit-logs', { token: customerDisplayToken });
    assertTest(
      '3.5a: customer_display receives 403 on GET /api/audit-logs',
      getAuditLogs.status === 403,
      `Expected 403, got ${getAuditLogs.status}`
    );

    const postAuditLogs = await request('/api/audit-logs', {
      method: 'POST',
      body: { action: 'TEST', details: 'test' },
      token: customerDisplayToken,
    });
    assertTest(
      '3.5b: customer_display receives 403 on POST /api/audit-logs',
      postAuditLogs.status === 403,
      `Expected 403, got ${postAuditLogs.status}`
    );

    // 3.6 Kitchen
    const getKitchenOrders = await request('/api/kitchen/orders', { token: customerDisplayToken });
    assertTest(
      '3.6a: customer_display receives 403 on GET /api/kitchen/orders',
      getKitchenOrders.status === 403,
      `Expected 403, got ${getKitchenOrders.status}`
    );

    const postKitchenOrders = await request('/api/kitchen/orders', {
      method: 'POST',
      body: { roomNumber: '101' },
      token: customerDisplayToken,
    });
    assertTest(
      '3.6b: customer_display receives 403 on POST /api/kitchen/orders',
      postKitchenOrders.status === 403,
      `Expected 403, got ${postKitchenOrders.status}`
    );

    // 3.7 Force Checkout
    const getForceCheckout = await request('/api/force-checkout', { token: customerDisplayToken });
    assertTest(
      '3.7a: customer_display receives 403 on GET /api/force-checkout',
      getForceCheckout.status === 403,
      `Expected 403, got ${getForceCheckout.status}`
    );

    const postForceCheckout = await request('/api/force-checkout', {
      method: 'POST',
      body: { roomNumber: '101' },
      token: customerDisplayToken,
    });
    assertTest(
      '3.7b: customer_display receives 403 on POST /api/force-checkout',
      postForceCheckout.status === 403,
      `Expected 403, got ${postForceCheckout.status}`
    );

    // =========================================================================
    // SECTION 4: POSITIVE CONTROL FOR STAFF USERS
    // =========================================================================
    console.log('\n--- 4. Positive Controls (Staff Privileges Intact) ---');

    const adminRooms = await request('/api/rooms', { token: adminToken });
    assertTest(
      '4.1: Admin token can access staff GET /api/rooms (status 200)',
      adminRooms.status === 200 && Array.isArray(adminRooms.data),
      `Expected 200, got ${adminRooms.status}`
    );

    const cashierBookings = await request('/api/bookings', { token: cashierToken });
    assertTest(
      '4.2: Cashier token can access staff GET /api/bookings (status 200)',
      cashierBookings.status === 200 && Array.isArray(cashierBookings.data),
      `Expected 200, got ${cashierBookings.status}`
    );

    const staffDisplay = await request('/api/display/rooms', { token: cashierToken });
    assertTest(
      '4.3: Staff token can also view customer display endpoint /api/display/rooms (status 200)',
      staffDisplay.status === 200,
      `Expected 200, got ${staffDisplay.status}`
    );

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      await pool.end();
    } catch (_) {}
  }

  // Summary
  console.log('\n=================================================');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  console.log(`📊 TEST RESULTS: ${passed}/${total} PASSED ${failed > 0 ? `(${failed} FAILED)` : '🎉 ALL PASSED'}`);
  console.log('=================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Fatal error running customer display tests:', err);
  process.exit(1);
});
