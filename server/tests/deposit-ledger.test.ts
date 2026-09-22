/**
 * server/tests/deposit-ledger.test.ts
 * Rigorous test suite verifying all acceptance criteria for the Guest Deposit & Credit Balance Ledger:
 * 
 * 1. Two concurrent apply requests against a balance that can only satisfy one of them:
 *    - Exactly one must succeed, not both, not neither.
 * 2. Retried apply request with duplicate idempotency key:
 *    - Must not double-deduct and must return existing transaction.
 * 3. Concurrent load & negative balance prevention:
 *    - Simultaneous applies against a fixed balance; assert final balance is never negative and matches computed sum.
 * 4. Customer Display & RBAC security:
 *    - customer_display role receives 403 on every deposit route.
 *    - Unauthenticated requests receive 401.
 * 5. Audit log & operator derivation:
 *    - Operator on deposit transactions and audit logs is derived from authenticated session, never spoofed body.
 * 6. Integer centavos & payment validation:
 *    - Floats and non-positive numbers rejected.
 *    - MIXED split validation strictly enforced.
 * 7. Atomic room extension:
 *    - Extending room stay updates checkout time and debits ledger in the same transaction.
 */

process.env.NODE_ENV = 'test';
process.env.TZ = 'Asia/Manila';

import http from 'http';
import { pool, sqliteDb } from '../db/pool';
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
  console.log('\n💳 STARTING GUEST DEPOSIT & CREDIT BALANCE LEDGER TEST SUITE\n');

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

    const customerDisplayToken = signJwt({
      id: 9999,
      username: 'kiosk',
      name: 'Lobby Display Kiosk',
      role: 'customer_display',
    }, 3600);

    // Request helper
    async function request(path: string, options: { method?: string; body?: any; token?: string; headers?: Record<string, string> } = {}) {
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

    // Ensure clean state for test rooms
    await pool.query("DELETE FROM deposit_transactions WHERE room_number IN ('991', '992', '993', '994')").catch(() => {});
    await pool.query("DELETE FROM rooms WHERE number IN ('991', '992', '993', '994')").catch(() => {});

    // =========================================================================
    // SECTION 1: CONCURRENT APPLY RACE CONDITION (Exactly 1 succeeds)
    // =========================================================================
    console.log('--- 1. Concurrent Apply Race Condition ---');
    const guestRaceId = `GUEST-RACE-${Date.now()}`;

    // 1.1 Deposit ₱1,500.00 (150,000 centavos)
    const depRaceRes = await request('/api/deposits', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: guestRaceId,
        guestName: 'Race Guest',
        amountCentavos: 150000,
        paymentMethod: 'CASH',
        idempotencyKey: `dep-race-init-${Date.now()}`,
      },
    });

    assertTest(
      '1.1: Deposit ₱1,500.00 (150,000 centavos) successfully created',
      depRaceRes.status === 201 && depRaceRes.data.balanceCentavos === 150000,
      `Status: ${depRaceRes.status}, data: ${JSON.stringify(depRaceRes.data)}`
    );

    // 1.2 Fire two concurrent apply requests for 150,000 centavos each
    // Set up test room in occupied state
    await pool.query(
      `INSERT OR REPLACE INTO rooms (number, tier, floor, room_type, state, guest_name, guest_id, check_in_time, check_out_time)
       VALUES ('991', 'Standard', 1, 'Standard Single', 'occupied', 'Race Guest', ?, datetime('now'), datetime('now', '+1 day'))`,
      [guestRaceId]
    );

    const [raceRes1, raceRes2] = await Promise.all([
      request('/api/deposits/apply', {
        method: 'POST',
        token: cashierToken,
        body: {
          guestIdentifier: guestRaceId,
          amountCentavos: 150000,
          applyType: 'room_extension',
          roomNumber: '991',
          extensionHours: 24,
          idempotencyKey: `apply-race-1-${Date.now()}`,
        },
      }),
      request('/api/deposits/apply', {
        method: 'POST',
        token: cashierToken,
        body: {
          guestIdentifier: guestRaceId,
          amountCentavos: 150000,
          applyType: 'room_extension',
          roomNumber: '991',
          extensionHours: 24,
          idempotencyKey: `apply-race-2-${Date.now()}`,
        },
      }),
    ]);

    const raceStatuses = [raceRes1.status, raceRes2.status].sort();
    const exactlyOneSucceeded = raceStatuses[0] === 201 && raceStatuses[1] === 400;
    assertTest(
      '1.2: Exactly ONE concurrent apply succeeds (201) and ONE fails (400 Insufficient balance)',
      exactlyOneSucceeded,
      `Statuses: ${raceRes1.status}, ${raceRes2.status}. Data1: ${JSON.stringify(raceRes1.data)}, Data2: ${JSON.stringify(raceRes2.data)}`
    );

    // 1.3 Check final balance is exactly 0
    const balRaceRes = await request(`/api/deposits/${guestRaceId}`, { token: cashierToken });
    assertTest(
      '1.3: Final computed balance after race is exactly 0 centavos (no negative balance)',
      balRaceRes.data.balanceCentavos === 0,
      `Expected 0, got ${balRaceRes.data.balanceCentavos}`
    );

    // =========================================================================
    // SECTION 2: IDEMPOTENCY (No Double-Deduction on Retry)
    // =========================================================================
    console.log('\n--- 2. Idempotency & Retry Behavior ---');
    const guestIdemId = `GUEST-IDEM-${Date.now()}`;
    const fixedIdemKey = `idem-key-${Date.now()}`;

    // 2.1 Deposit ₱3,000.00 (300,000 centavos)
    await request('/api/deposits', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: guestIdemId,
        amountCentavos: 300000,
        paymentMethod: 'CASH',
        idempotencyKey: `dep-idem-init-${Date.now()}`,
      },
    });

    // 2.2 First apply of ₱1,000.00 (100,000 centavos)
    await pool.query(
      `INSERT OR REPLACE INTO rooms (number, tier, floor, room_type, state, guest_name, guest_id, check_in_time, check_out_time)
       VALUES ('992', 'Standard', 1, 'Standard Single', 'occupied', 'Idem Guest', ?, datetime('now'), datetime('now', '+1 day'))`,
      [guestIdemId]
    );

    const firstApply = await request('/api/deposits/apply', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: guestIdemId,
        amountCentavos: 100000,
        applyType: 'room_extension',
        roomNumber: '992',
        extensionHours: 12,
        idempotencyKey: fixedIdemKey,
      },
    });

    assertTest(
      '2.1: First apply with idempotency key succeeds (status 201)',
      firstApply.status === 201 && firstApply.data.balanceCentavos === 200000,
      `Status: ${firstApply.status}, balanceCentavos: ${firstApply.data.balanceCentavos}`
    );

    // 2.3 Retried apply with IDENTICAL idempotency key
    const retryApply = await request('/api/deposits/apply', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: guestIdemId,
        amountCentavos: 100000,
        applyType: 'room_extension',
        roomNumber: '992',
        extensionHours: 12,
        idempotencyKey: fixedIdemKey,
      },
    });

    assertTest(
      '2.2: Retried apply with same idempotency key returns 200 (idempotent replay)',
      retryApply.status === 200 && retryApply.data.alreadyExists === true,
      `Status: ${retryApply.status}, data: ${JSON.stringify(retryApply.data)}`
    );

    // 2.4 Verify balance is still 200,000 centavos (no double deduction)
    const checkBalRes = await request(`/api/deposits/${guestIdemId}`, { token: cashierToken });
    assertTest(
      '2.3: Balance remains 200,000 centavos (did NOT double-deduct)',
      checkBalRes.data.balanceCentavos === 200000,
      `Expected 200000, got ${checkBalRes.data.balanceCentavos}`
    );

    // 2.5 Verify database row count for this idempotency key is exactly 1
    const dbRows = await pool.query('SELECT COUNT(*) as count FROM deposit_transactions WHERE idempotency_key = ?', [fixedIdemKey]);
    assertTest(
      '2.4: Exactly 1 row exists in deposit_transactions for the idempotency key',
      Number(dbRows.rows[0].count) === 1,
      `Expected 1, got ${dbRows.rows[0].count}`
    );

    // =========================================================================
    // SECTION 3: CONCURRENT LOAD & NEGATIVE BALANCE PREVENTION
    // =========================================================================
    console.log('\n--- 3. Concurrent Load & Negative Balance Prevention ---');
    const guestStressId = `GUEST-STRESS-${Date.now()}`;

    // 3.1 Deposit ₱5,000.00 (500,000 centavos)
    await request('/api/deposits', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: guestStressId,
        amountCentavos: 500000,
        paymentMethod: 'CASH',
        idempotencyKey: `dep-stress-init-${Date.now()}`,
      },
    });

    // 3.2 Fire 10 simultaneous applies of ₱1,000.00 (100,000 centavos) each
    // Available funds can only satisfy exactly 5 of the 10 requests!
    await pool.query(
      `INSERT OR REPLACE INTO rooms (number, tier, floor, room_type, state, guest_name, guest_id, check_in_time, check_out_time)
       VALUES ('993', 'Standard', 1, 'Standard Single', 'occupied', 'Stress Guest', ?, datetime('now'), datetime('now', '+1 day'))`,
      [guestStressId]
    );

    const stressPromises = Array.from({ length: 10 }, (_, i) =>
      request('/api/deposits/apply', {
        method: 'POST',
        token: cashierToken,
        body: {
          guestIdentifier: guestStressId,
          amountCentavos: 100000,
          applyType: 'room_extension',
          roomNumber: '993',
          extensionHours: 6,
          idempotencyKey: `stress-apply-${Date.now()}-${i}`,
        },
      })
    );

    const stressResults = await Promise.all(stressPromises);
    const successCount = stressResults.filter((r) => r.status === 201).length;
    const failCount = stressResults.filter((r) => r.status === 400).length;

    assertTest(
      '3.1: Under 10 concurrent requests against 5-capacity balance, exactly 5 succeed and 5 fail',
      successCount === 5 && failCount === 5,
      `Successes: ${successCount}, Failures: ${failCount}`
    );

    // 3.3 Verify final balance is exactly 0 and never went negative
    const stressFinalBal = await request(`/api/deposits/${guestStressId}`, { token: cashierToken });
    assertTest(
      '3.2: Final computed balance is exactly 0 centavos under high concurrent load',
      stressFinalBal.data.balanceCentavos === 0,
      `Expected 0, got ${stressFinalBal.data.balanceCentavos}`
    );

    // 3.4 Direct Schema Trigger Test: Ensure SQLite trigger blocks any negative balance insertion
    let triggerBlocked = false;
    try {
      await pool.query(
        `INSERT INTO deposit_transactions (
          id, guest_identifier, amount_centavos, direction, payment_method,
          idempotency_key, operator, created_at
        ) VALUES ('bypass-test', ?, 50000, 'OUT', 'BALANCE_APPLIED', 'bypass-key', 'admin', datetime('now'))`,
        [guestStressId]
      );
    } catch (err: any) {
      triggerBlocked = err.message.includes('Insufficient deposit balance') || err.message.includes('negative balance');
    }

    assertTest(
      '3.3: Database TRIGGER trg_prevent_negative_deposit_balance aborts direct insert causing negative balance',
      triggerBlocked,
      'Direct insert did not trigger expected SQLite abort'
    );

    // =========================================================================
    // SECTION 4: RBAC & CUSTOMER_DISPLAY ROLE REJECTION
    // =========================================================================
    console.log('\n--- 4. RBAC & Role Hardening ---');

    // 4.1 customer_display cannot POST /api/deposits
    const dispDeposit = await request('/api/deposits', {
      method: 'POST',
      token: customerDisplayToken,
      body: {
        guestIdentifier: 'GUEST-TEST',
        amountCentavos: 10000,
        paymentMethod: 'CASH',
        idempotencyKey: 'kiosk-dep-test',
      },
    });
    assertTest(
      '4.1: customer_display role receives 403 Forbidden on POST /api/deposits',
      dispDeposit.status === 403,
      `Received status ${dispDeposit.status}`
    );

    // 4.2 customer_display cannot POST /api/deposits/apply
    const dispApply = await request('/api/deposits/apply', {
      method: 'POST',
      token: customerDisplayToken,
      body: {
        guestIdentifier: 'GUEST-TEST',
        amountCentavos: 10000,
        applyType: 'room_extension',
        roomNumber: '991',
        idempotencyKey: 'kiosk-apply-test',
      },
    });
    assertTest(
      '4.2: customer_display role receives 403 Forbidden on POST /api/deposits/apply',
      dispApply.status === 403,
      `Received status ${dispApply.status}`
    );

    // 4.3 customer_display cannot GET /api/deposits/:guestIdentifier
    const dispRead = await request('/api/deposits/GUEST-TEST', {
      token: customerDisplayToken,
    });
    assertTest(
      '4.3: customer_display role receives 403 Forbidden on GET /api/deposits/:guestIdentifier',
      dispRead.status === 403,
      `Received status ${dispRead.status}`
    );

    // 4.4 Unauthenticated request receives 401
    const unauthRes = await request('/api/deposits', {
      method: 'POST',
      body: { guestIdentifier: 'GUEST-TEST' },
    });
    assertTest(
      '4.4: Unauthenticated request receives 401 Unauthorized',
      unauthRes.status === 401,
      `Received status ${unauthRes.status}`
    );

    // 4.5 Admin and Cashier positive controls
    const adminRead = await request(`/api/deposits/${guestRaceId}`, { token: adminToken });
    assertTest(
      '4.5: Admin token can read deposits (status 200)',
      adminRead.status === 200 && adminRead.data.guestIdentifier === guestRaceId,
      `Status: ${adminRead.status}`
    );

    // =========================================================================
    // SECTION 5: AUDIT LOG INTEGRITY & OPERATOR DERIVATION
    // =========================================================================
    console.log('\n--- 5. Audit Log & Operator Derivation ---');
    const guestAuditId = `GUEST-AUDIT-${Date.now()}`;
    const auditDepIdem = `audit-dep-${Date.now()}`;

    // Cashier token logs in as 'ann'. Spoof operator as 'hacker_admin' in body.
    const spoofDepRes = await request('/api/deposits', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: guestAuditId,
        amountCentavos: 200000,
        paymentMethod: 'CASH',
        idempotencyKey: auditDepIdem,
        operator: 'hacker_admin_spoofed', // spoof attempt
      },
    });

    assertTest(
      '5.1: Deposit transaction records server-derived operator (ann), ignoring spoofed body',
      spoofDepRes.status === 201 && spoofDepRes.data.transaction.operator === 'ann',
      `Expected 'ann', got '${spoofDepRes.data.transaction?.operator}'`
    );

    // Check system audit log
    const auditLogsRes = await pool.query(
      `SELECT * FROM audit_logs WHERE action = 'RECORD_DEPOSIT' AND details LIKE ? ORDER BY timestamp DESC LIMIT 1`,
      [`%${guestAuditId}%`]
    );
    assertTest(
      '5.2: Audit log entry created with server-derived operator (ann)',
      auditLogsRes.rows.length > 0 && auditLogsRes.rows[0].operator === 'ann',
      `Audit log rows: ${JSON.stringify(auditLogsRes.rows)}`
    );

    // Spoofed apply operation
    const spoofApplyRes = await request('/api/deposits/apply', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: guestAuditId,
        amountCentavos: 50000,
        applyType: 'room_extension',
        roomNumber: '991',
        idempotencyKey: `audit-apply-${Date.now()}`,
        operator: 'fake_owner_spoofed', // spoof attempt
      },
    });

    assertTest(
      '5.3: Apply transaction records server-derived operator (ann), ignoring spoofed body',
      spoofApplyRes.status === 201 && spoofApplyRes.data.transaction.operator === 'ann',
      `Expected 'ann', got '${spoofApplyRes.data.transaction?.operator}'`
    );

    const applyAuditRes = await pool.query(
      `SELECT * FROM audit_logs WHERE action = 'APPLY_DEPOSIT' AND details LIKE ? ORDER BY timestamp DESC LIMIT 1`,
      [`%${guestAuditId}%`]
    );
    assertTest(
      '5.4: Audit log entry for apply has server-derived operator (ann)',
      applyAuditRes.rows.length > 0 && applyAuditRes.rows[0].operator === 'ann',
      `Audit log rows: ${JSON.stringify(applyAuditRes.rows)}`
    );

    // =========================================================================
    // SECTION 6: INTEGER CENTAVOS & PAYMENT METHOD VALIDATION
    // =========================================================================
    console.log('\n--- 6. Integer Centavos & Payment Validation ---');

    // 6.1 Reject floating point amounts
    const floatRes = await request('/api/deposits', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: 'FLOAT-TEST',
        amountCentavos: 1500.5,
        paymentMethod: 'CASH',
        idempotencyKey: `float-key-${Date.now()}`,
      },
    });
    assertTest(
      '6.1: Floating point amountCentavos is rejected with 400',
      floatRes.status === 400 && floatRes.data.error.includes('strictly positive integer'),
      `Status: ${floatRes.status}, error: ${floatRes.data.error}`
    );

    // 6.2 Reject negative amounts
    const negRes = await request('/api/deposits', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: 'NEG-TEST',
        amountCentavos: -5000,
        paymentMethod: 'CASH',
        idempotencyKey: `neg-key-${Date.now()}`,
      },
    });
    assertTest(
      '6.2: Negative amountCentavos is rejected with 400',
      negRes.status === 400,
      `Status: ${negRes.status}`
    );

    // 6.3 GCash requires transaction reference
    const gcashNoRef = await request('/api/deposits', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: 'GCASH-TEST',
        amountCentavos: 100000,
        paymentMethod: 'GCASH',
        idempotencyKey: `gcash-noref-${Date.now()}`,
      },
    });
    assertTest(
      '6.3: GCash deposit without reference number is rejected with 400',
      gcashNoRef.status === 400 && gcashNoRef.data.error.includes('reference is required'),
      `Status: ${gcashNoRef.status}, error: ${gcashNoRef.data.error}`
    );

    // 6.4 Valid GCash deposit with reference succeeds
    const gcashWithRef = await request('/api/deposits', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: 'GCASH-TEST',
        amountCentavos: 100000,
        paymentMethod: 'GCASH',
        reference: 'GCASH-REF-889900',
        idempotencyKey: `gcash-valid-${Date.now()}`,
      },
    });
    assertTest(
      '6.4: Valid GCash deposit with reference succeeds with 201',
      gcashWithRef.status === 201 && gcashWithRef.data.transaction.referenceId === 'GCASH-REF-889900',
      `Status: ${gcashWithRef.status}, referenceId: ${gcashWithRef.data.transaction?.referenceId}`
    );

    // 6.5 MIXED payment: Cash + GCash split must equal total
    const mixedMismatch = await request('/api/deposits', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: 'MIXED-TEST',
        amountCentavos: 200000,
        paymentMethod: 'MIXED',
        cashAmountCentavos: 100000,
        gcashAmountCentavos: 50000, // Sum = 150000 != 200000
        reference: 'GCASH-MIXED-123',
        idempotencyKey: `mixed-bad-${Date.now()}`,
      },
    });
    assertTest(
      '6.5: MIXED payment with unequal sum is rejected with 400',
      mixedMismatch.status === 400 && mixedMismatch.data.error.includes('do not sum to total'),
      `Status: ${mixedMismatch.status}, error: ${mixedMismatch.data.error}`
    );

    // 6.6 Valid MIXED payment succeeds
    const mixedValid = await request('/api/deposits', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: 'MIXED-TEST',
        amountCentavos: 200000,
        paymentMethod: 'MIXED',
        cashAmountCentavos: 120000,
        gcashAmountCentavos: 80000,
        reference: 'GCASH-MIXED-VALID',
        idempotencyKey: `mixed-valid-${Date.now()}`,
      },
    });
    assertTest(
      '6.6: Valid MIXED payment records cash/gcash centavos breakdown (201)',
      mixedValid.status === 201 &&
        mixedValid.data.transaction.cashAmountCentavos === 120000 &&
        mixedValid.data.transaction.gcashAmountCentavos === 80000,
      `Status: ${mixedValid.status}, tx: ${JSON.stringify(mixedValid.data.transaction)}`
    );

    // =========================================================================
    // SECTION 7: ATOMIC ROOM EXTENSION
    // =========================================================================
    console.log('\n--- 7. Atomic Room Extension ---');
    const guestExtId = `GUEST-EXT-${Date.now()}`;
    const initialCheckout = new Date(Date.now() + 3600000).toISOString(); // 1 hr from now

    await pool.query(
      `INSERT OR REPLACE INTO rooms (number, tier, floor, room_type, state, guest_name, guest_id, check_in_time, check_out_time, is_overdue)
       VALUES ('994', 'Standard', 1, 'Standard Single', 'occupied', 'Ext Guest', ?, datetime('now'), ?, 0)`,
      [guestExtId, initialCheckout]
    );

    // Deposit ₱1,500.00
    await request('/api/deposits', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: guestExtId,
        amountCentavos: 150000,
        paymentMethod: 'CASH',
        idempotencyKey: `ext-dep-${Date.now()}`,
      },
    });

    // Apply 24h extension
    const extRes = await request('/api/deposits/apply', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: guestExtId,
        amountCentavos: 150000,
        applyType: 'room_extension',
        roomNumber: '994',
        extensionHours: 24,
        idempotencyKey: `ext-apply-${Date.now()}`,
      },
    });

    const roomDb = await pool.query('SELECT check_out_time, state FROM rooms WHERE number = ?', ['994']);
    const newCheckout = new Date(roomDb.rows[0].check_out_time).getTime();
    const oldCheckout = new Date(initialCheckout).getTime();
    const extendedHours = (newCheckout - oldCheckout) / 3600000;

    assertTest(
      '7.1: Room checkout time was extended by ~24 hours atomically',
      extRes.status === 201 && Math.round(extendedHours) === 24,
      `Status: ${extRes.status}, Extended by ${extendedHours} hours`
    );

    assertTest(
      '7.2: Guest deposit balance is reduced to 0 after extension',
      extRes.data.balanceCentavos === 0,
      `Expected 0, got ${extRes.data.balanceCentavos}`
    );

    // 7.3 Reject non-positive extensionHours with 400
    const invalidExtRes = await request('/api/deposits/apply', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: guestExtId,
        amountCentavos: 13000,
        applyType: 'room_extension',
        roomNumber: '994',
        extensionHours: 0,
        idempotencyKey: `ext-invalid-${Date.now()}`,
      },
    });
    assertTest(
      '7.3: Non-positive extensionHours (0) is rejected with 400',
      invalidExtRes.status === 400,
      `Status: ${invalidExtRes.status}`
    );

    // 7.4 Typed custom extension hours (e.g. 3 hours @ ₱130/hr = 39,000 centavos)
    const customGuestId = `GUEST-CUSTOM-${Date.now()}`;
    await request('/api/deposits', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: customGuestId,
        guestName: 'Custom Hours Guest',
        amountCentavos: 50000, // ₱500.00 deposit
        paymentMethod: 'CASH',
        idempotencyKey: `custom-dep-${Date.now()}`,
      },
    });

    const beforeCheckout = new Date(roomDb.rows[0].check_out_time).getTime();
    const customExtRes = await request('/api/deposits/apply', {
      method: 'POST',
      token: cashierToken,
      body: {
        guestIdentifier: customGuestId,
        amountCentavos: 39000, // 3 hours * ₱130 = ₱390 (39,000 centavos)
        applyType: 'room_extension',
        roomNumber: '994',
        extensionHours: 3,
        idempotencyKey: `custom-apply-${Date.now()}`,
      },
    });

    const roomDbAfterCustom = await pool.query('SELECT check_out_time FROM rooms WHERE number = ?', ['994']);
    const afterCheckout = new Date(roomDbAfterCustom.rows[0].check_out_time).getTime();
    const customHoursAdded = (afterCheckout - beforeCheckout) / 3600000;

    assertTest(
      '7.4: Typed custom extension (3h @ ₱130/excess hr = ₱390) extends checkout time by exactly 3 hours',
      customExtRes.status === 201 && Math.round(customHoursAdded) === 3 && customExtRes.data.balanceCentavos === 11000,
      `Status: ${customExtRes.status}, Hours: ${customHoursAdded}, Remaining: ₱${customExtRes.data?.balanceCentavos / 100}`
    );

  } finally {
    try {
      await pool.query("DELETE FROM deposit_transactions WHERE room_number IN ('991', '992', '993', '994')");
      await pool.query("DELETE FROM rooms WHERE number IN ('991', '992', '993', '994')");
    } catch (_) {}
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      await pool.end();
    } catch (_) {}
  }

  // Test Summary Report
  console.log('\n=================================================');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  console.log(`📊 TEST RESULTS: ${passed}/${total} PASSED ${failed > 0 ? `(${failed} FAILED)` : '🎉 ALL PASSED'}`);
  console.log('=================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Fatal error running deposit ledger tests:', err);
  process.exit(1);
});
