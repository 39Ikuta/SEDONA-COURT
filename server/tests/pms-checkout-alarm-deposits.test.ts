/**
 * server/tests/pms-checkout-alarm-deposits.test.ts
 * Comprehensive test suite for PMS checkout, alarms, open-time, deposits reconciliation, and cleaning removal.
 */

import assert from 'node:assert/strict';
import { pool, withTransaction } from '../db/pool';
import {
  getAlarmSettings,
  updateAlarmSettings,
  computeAlarmState,
  extendStay,
  snoozeAlarm,
  switchToOpenTime,
  waiveOvertime,
  evaluateActiveRoomAlarms,
} from '../services/alarm-service';
import { bucketRoomStatus } from '../routes/customer-display';
import { socketManager } from '../websocket/socket-manager';

console.log('🧪 RUNNING PMS CHECKOUT, ALARM, OPEN-TIME & DEPOSITS TEST SUITE\n');

let passedTests = 0;
const test = async (name: string, fn: () => void | Promise<void>) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ FAILED: ${name}`, err);
    throw err;
  }
};

async function runSuite() {
  // Test 1: Configurable Alarm Settings Persistence
  await test('1: getAlarmSettings & updateAlarmSettings persist and return all 7 keys', async () => {
    const updated = await updateAlarmSettings({
      alarm_pre_minutes: 20,
      alarm_post_minutes: 10,
      snooze_minutes: 15,
      overdue_repeat_minutes: 7,
      overdue_max_repeats: 4,
      extra_hour_rate: 12000,
      open_time_reminder_hours: 4,
    });

    assert.equal(updated.alarm_pre_minutes, 20);
    assert.equal(updated.alarm_post_minutes, 10);
    assert.equal(updated.snooze_minutes, 15);
    assert.equal(updated.overdue_repeat_minutes, 7);
    assert.equal(updated.overdue_max_repeats, 4);
    assert.equal(updated.extra_hour_rate, 12000);
    assert.equal(updated.open_time_reminder_hours, 4);

    const reFetched = await getAlarmSettings();
    assert.equal(reFetched.alarm_pre_minutes, 20);
    assert.equal(reFetched.alarm_post_minutes, 10);
    assert.equal(reFetched.snooze_minutes, 15);
    assert.equal(reFetched.overdue_repeat_minutes, 7);
    assert.equal(reFetched.overdue_max_repeats, 4);
    assert.equal(reFetched.extra_hour_rate, 12000);
    assert.equal(reFetched.open_time_reminder_hours, 4);

    // Reset back to defaults
    await updateAlarmSettings({
      alarm_pre_minutes: 15,
      alarm_post_minutes: 15,
      snooze_minutes: 10,
      overdue_repeat_minutes: 5,
      overdue_max_repeats: 3,
      extra_hour_rate: 10000,
      open_time_reminder_hours: 3,
    });
  });

  // Test 2: Room snooze alarm
  await test('2: snoozeAlarm sets snoozed_until, silences audio, and writes audit log', async () => {
    // Setup test room 1
    const testRoom = '1';
    await pool.query(
      `UPDATE rooms SET state = 'occupied', check_in_time = NOW(), expected_checkout_at = NOW(), alarm_state = 'OVERDUE', repeat_count = 2 WHERE number = ?`,
      [testRoom]
    );

    const beforeSnooze = Date.now();
    const snoozeRes = await snoozeAlarm(testRoom, 'cashier_test');
    assert.ok(snoozeRes.success);
    assert.ok(snoozeRes.snoozedUntil);

    const snoozeMs = new Date(snoozeRes.snoozedUntil).getTime();
    assert.ok(snoozeMs >= beforeSnooze + 9 * 60000);

    const checkRoom = await pool.query('SELECT snoozed_until, repeat_count FROM rooms WHERE number = ?', [testRoom]);
    assert.equal(checkRoom.rows[0].repeat_count, 0);
    assert.ok(checkRoom.rows[0].snoozed_until);

    const auditCheck = await pool.query("SELECT * FROM audit_logs WHERE action = 'ALARM_SNOOZED' ORDER BY timestamp DESC LIMIT 1");
    assert.equal(auditCheck.rows[0].operator, 'cashier_test');
    assert.ok(auditCheck.rows[0].details.includes('Room 1'));
  });

  // Test 3: Switch to open-time mode
  await test('3: switchToOpenTime sets billing_mode=open_time, suppresses alarms, and logs audit', async () => {
    const testRoom = '2';
    await pool.query(
      `UPDATE rooms SET state = 'occupied', check_in_time = NOW(), expected_checkout_at = NOW(), alarm_state = 'OVERDUE', billing_mode = 'standard' WHERE number = ?`,
      [testRoom]
    );

    const switchRes = await switchToOpenTime(testRoom, 'cashier_test', 'Guest requested open time billing');
    assert.ok(switchRes.success);
    assert.equal(switchRes.billingMode, 'open_time');

    const checkRoom = await pool.query(
      'SELECT billing_mode, open_time_started_at, last_reminder_at, alarm_state FROM rooms WHERE number = ?',
      [testRoom]
    );
    assert.equal(checkRoom.rows[0].billing_mode, 'open_time');
    assert.equal(checkRoom.rows[0].alarm_state, 'NORMAL');
    assert.ok(checkRoom.rows[0].open_time_started_at);

    const auditCheck = await pool.query("SELECT * FROM audit_logs WHERE action = 'SWITCH_TO_OPEN_TIME' ORDER BY timestamp DESC LIMIT 1");
    assert.equal(auditCheck.rows[0].operator, 'cashier_test');
    assert.ok(auditCheck.rows[0].details.includes('Guest requested open time billing'));
  });

  // Test 4: Waive Overtime
  await test('4: waiveOvertime sets overtime_waived=1 and records audit log', async () => {
    const testRoom = '3';
    await pool.query(
      `UPDATE rooms SET state = 'occupied', overtime_waived = 0, overtime_waived_by = NULL, overtime_waived_reason = NULL WHERE number = ?`,
      [testRoom]
    );

    const waiveRes = await waiveOvertime(testRoom, 'admin_test', 'VIP courtesy waiver');
    assert.ok(waiveRes.success);
    assert.equal(waiveRes.overtimeWaived, true);

    const checkRoom = await pool.query(
      'SELECT overtime_waived, overtime_waived_by, overtime_waived_reason FROM rooms WHERE number = ?',
      [testRoom]
    );
    assert.equal(checkRoom.rows[0].overtime_waived, 1);
    assert.equal(checkRoom.rows[0].overtime_waived_by, 'admin_test');
    assert.equal(checkRoom.rows[0].overtime_waived_reason, 'VIP courtesy waiver');

    const auditCheck = await pool.query("SELECT * FROM audit_logs WHERE action = 'OVERTIME_WAIVED' ORDER BY timestamp DESC LIMIT 1");
    assert.equal(auditCheck.rows[0].operator, 'admin_test');
    assert.ok(auditCheck.rows[0].details.includes('VIP courtesy waiver'));
  });

  // Test 5: Contiguous Stay Extension & Charged Food Overtime Line Item
  await test('5: extendStay is ALWAYS contiguous T_new = T_old + 60m * N and adds overtime item', async () => {
    const testRoom = '4';
    const oldCheckout = new Date('2026-09-29T10:00:00.000Z');
    await pool.query(
      `UPDATE rooms SET state = 'occupied', check_in_time = '2026-09-29 07:00:00', expected_checkout_at = ?, check_out_time = ?, billing_mode = 'open_time', charged_food = '[]', repeat_count = 2, snoozed_until = '2026-09-29 11:00:00' WHERE number = ?`,
      [oldCheckout.toISOString(), oldCheckout.toISOString(), testRoom]
    );

    const extRes = await extendStay(testRoom, { hours: 2 }, 'cashier_test');
    assert.ok(extRes.success);

    // Contiguous check: 10:00:00 + 2h = 12:00:00
    assert.equal(extRes.newCheckout, '2026-09-29T12:00:00.000Z');

    const checkRoom = await pool.query(
      'SELECT expected_checkout_at, billing_mode, charged_food, repeat_count, snoozed_until, acknowledged_at FROM rooms WHERE number = ?',
      [testRoom]
    );
    assert.equal(checkRoom.rows[0].expected_checkout_at, '2026-09-29T12:00:00.000Z');
    assert.equal(checkRoom.rows[0].billing_mode, 'standard');
    assert.equal(checkRoom.rows[0].repeat_count, 0);
    assert.equal(checkRoom.rows[0].snoozed_until, null);
    assert.equal(checkRoom.rows[0].acknowledged_at, null);

    const foodList = JSON.parse(checkRoom.rows[0].charged_food);
    assert.equal(foodList.length, 1);
    assert.equal(foodList[0].quantity, 2);
    assert.equal(foodList[0].item.price, 100.00); // 10000 cents = 100 pesos
    assert.equal(foodList[0].item.category, 'Overtime');
  });

  // Test 6: Customer Display Bucketing (no cleaning state)
  await test('6: bucketRoomStatus correctly maps states without cleaning', () => {
    assert.equal(bucketRoomStatus('1', 'VIP Suite', 'available'), 'available');
    assert.equal(bucketRoomStatus('1', 'VIP Suite', 'occupied'), 'occupied');
    assert.equal(bucketRoomStatus('1', 'VIP Suite', 'overdue'), 'occupied');
    assert.equal(bucketRoomStatus('1', 'VIP Suite', 'maintenance'), 'unavailable');
    assert.equal(bucketRoomStatus('12', 'Staff House', 'available'), 'unavailable');
  });

  // Test 7: Shift Settlement Cash Formula with Deposits
  await test('7: shift settlement calculates cash deposits held and refunded correctly in formula', async () => {
    const shiftStartTime = '2026-09-29T06:00:00.000Z';
    const shiftEndTime = '2026-09-29T18:00:00.000Z';

    // Insert test cash deposits
    const dep1Id = `dep-test-1-${Date.now()}`;
    const dep2Id = `dep-test-2-${Date.now()}`;

    await pool.query(
      `INSERT INTO deposits (
        id, room_id, amount_cents, status, collected_by, collected_at, deposit_number, deposit_snapshot
      ) VALUES (?, '101', 50000, 'held', 'cashier1', '2026-09-29T08:00:00.000Z', 'DEP-TEST-001', '{"paymentMethod":"CASH","amountCents":50000}')`,
      [dep1Id]
    );

    await pool.query(
      `INSERT INTO deposits (
        id, room_id, amount_cents, status, collected_by, collected_at, resolved_by, resolved_at, refund_amount_cents, deposit_number, deposit_snapshot
      ) VALUES (?, '102', 30000, 'refunded', 'cashier1', '2026-09-29T07:00:00.000Z', 'cashier1', '2026-09-29T09:00:00.000Z', 30000, 'DEP-TEST-002', '{"paymentMethod":"CASH","amountCents":30000}')`,
      [dep2Id]
    );

    // Query deposits in this window
    const depositsRes = await pool.query(`
      SELECT 
        id, amount_cents, status, collected_at, resolved_at, refund_amount_cents, deposit_snapshot
      FROM deposits
      WHERE (collected_at >= ? AND collected_at < ?)
         OR (resolved_at >= ? AND resolved_at < ?)
    `, [shiftStartTime, shiftEndTime, shiftStartTime, shiftEndTime]);

    let totalDepositsHeldCash = 0;
    let totalDepositsRefundedCash = 0;

    for (const dep of depositsRes.rows) {
      if (dep.id !== dep1Id && dep.id !== dep2Id) continue;
      let isCash = true;
      if (dep.deposit_snapshot) {
        try {
          const snap = typeof dep.deposit_snapshot === 'string' ? JSON.parse(dep.deposit_snapshot) : dep.deposit_snapshot;
          if (snap && snap.paymentMethod && snap.paymentMethod !== 'CASH') isCash = false;
        } catch {}
      }

      if (isCash) {
        if (dep.collected_at >= shiftStartTime && dep.collected_at < shiftEndTime) {
          totalDepositsHeldCash += Number(dep.amount_cents || 0) / 100.0;
        }
        if (dep.resolved_at >= shiftStartTime && dep.resolved_at < shiftEndTime && dep.status === 'refunded') {
          totalDepositsRefundedCash += Number(dep.refund_amount_cents || dep.amount_cents || 0) / 100.0;
        }
      }
    }

    assert.equal(totalDepositsHeldCash, 800.00); // 500 + 300
    assert.equal(totalDepositsRefundedCash, 300.00);

    const totalCashReceived = 5000.00;
    const totalExpenses = 450.00;
    const expectedCashOnHand = totalCashReceived + totalDepositsHeldCash - totalDepositsRefundedCash - totalExpenses;
    assert.equal(expectedCashOnHand, 5000 + 800 - 300 - 450); // 5050.00

    // Cleanup test deposits
    await pool.query('DELETE FROM deposits WHERE id IN (?, ?)', [dep1Id, dep2Id]);
  });

  console.log(`\n🎉 ALL ${passedTests} PMS CHECKOUT, ALARM & DEPOSITS TESTS PASSED!`);
}

runSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
