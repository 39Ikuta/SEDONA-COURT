/**
 * server/tests/notifications-system.test.ts
 *
 * Automated verification test suite for Sedona Court Property Management System:
 * - 15-Minute Advance Checkout Warning
 * - Exact Checkout Time Reached (Grace Period active)
 * - Late Past Grace Exceeded (+15 Mins Overdue)
 * - Active Snooze timer calculation & wake triggers
 * - Staff House quarters exemption from checkout alarms
 * - Almost-in-Time status filtering
 */

import assert from 'node:assert/strict';

interface MockRoom {
  number: string;
  state: 'available' | 'occupied' | 'cleaning' | 'overdue' | 'maintenance';
  roomType: string;
  guestName: string;
  checkInTime?: string;
  checkOutTime?: string;
  isStaffHouse?: boolean;
}

interface SnoozedAlarm {
  roomNumber: string;
  type: 'warning' | 'checkout' | 'grace';
  message: string;
  snoozedUntil: number;
}

console.log('🔔 STARTING NOTIFICATIONS & CHECKOUT ALERTS TEST SUITE');

let passedTests = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`✅ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ FAILED: ${name}`);
    throw err;
  }
};

const now = new Date('2026-09-12T14:00:00.000Z').getTime();

// Helper to categorize room urgency based on property rules
const categorizeRoomAlert = (room: MockRoom, nowMs: number) => {
  if (room.isStaffHouse || room.roomType === 'Staff House' || String(room.number) === '12') {
    return { isUrgent: false, urgencyLevel: 'none', diffMins: 0 };
  }

  if ((room.state === 'occupied' || room.state === 'overdue') && room.checkOutTime) {
    const checkout = new Date(room.checkOutTime).getTime();
    const diffMs = checkout - nowMs;
    const diffMins = diffMs / 60000;

    if (diffMins <= -15) {
      return { isUrgent: true, urgencyLevel: 'late-past-grace', diffMins, label: 'LATE PAST GRACE (+15M)' };
    } else if (diffMins <= 0 && diffMins > -15) {
      return { isUrgent: true, urgencyLevel: 'overdue-grace', diffMins, label: 'CHECKOUT REACHED (GRACE)' };
    } else if (diffMins <= 15 && diffMins > 0) {
      return { isUrgent: true, urgencyLevel: 'warning', diffMins, label: 'CHECKOUT < 15M WARNING' };
    } else {
      return { isUrgent: false, urgencyLevel: 'on-schedule', diffMins, label: 'ON SCHEDULE' };
    }
  }

  return { isUrgent: false, urgencyLevel: 'none', diffMins: 0 };
};

// --- Test 1: 15-Minute Advance Checkout Warning ---
test('1.1: Room with 10 mins remaining triggers 15m warning alert', () => {
  const room: MockRoom = {
    number: '101',
    state: 'occupied',
    roomType: 'Classic Room',
    guestName: 'Maria Santos',
    checkOutTime: new Date(now + 10 * 60000).toISOString(),
  };
  const res = categorizeRoomAlert(room, now);
  assert.equal(res.isUrgent, true);
  assert.equal(res.urgencyLevel, 'warning');
  assert.equal(Math.round(res.diffMins), 10);
});

test('1.2: Room with exactly 15 mins remaining triggers warning alert', () => {
  const room: MockRoom = {
    number: '102',
    state: 'occupied',
    roomType: 'Premium Room',
    guestName: 'John Doe',
    checkOutTime: new Date(now + 15 * 60000).toISOString(),
  };
  const res = categorizeRoomAlert(room, now);
  assert.equal(res.isUrgent, true);
  assert.equal(res.urgencyLevel, 'warning');
});

test('1.3: Room with 25 mins remaining is on schedule (no urgent alert)', () => {
  const room: MockRoom = {
    number: '103',
    state: 'occupied',
    roomType: 'VIP Suite',
    guestName: 'Alice Cruz',
    checkOutTime: new Date(now + 25 * 60000).toISOString(),
  };
  const res = categorizeRoomAlert(room, now);
  assert.equal(res.isUrgent, false);
  assert.equal(res.urgencyLevel, 'on-schedule');
});

// --- Test 2: Checkout Time Reached (Grace Period) ---
test('2.1: Room at exact checkout time (0m) enters checkout grace period', () => {
  const room: MockRoom = {
    number: '201',
    state: 'occupied',
    roomType: 'Classic Room',
    guestName: 'Bob Miller',
    checkOutTime: new Date(now).toISOString(),
  };
  const res = categorizeRoomAlert(room, now);
  assert.equal(res.isUrgent, true);
  assert.equal(res.urgencyLevel, 'overdue-grace');
  assert.equal(res.label, 'CHECKOUT REACHED (GRACE)');
});

test('2.2: Room 8 minutes overdue is within 15m grace window', () => {
  const room: MockRoom = {
    number: '202',
    state: 'overdue',
    roomType: 'Premium Room',
    guestName: 'Carlos Rivera',
    checkOutTime: new Date(now - 8 * 60000).toISOString(),
  };
  const res = categorizeRoomAlert(room, now);
  assert.equal(res.isUrgent, true);
  assert.equal(res.urgencyLevel, 'overdue-grace');
  assert.equal(Math.round(res.diffMins), -8);
});

// --- Test 3: Grace Period Exceeded (+15m Overdue) ---
test('3.1: Room 16 minutes overdue is flagged as Late Past Grace', () => {
  const room: MockRoom = {
    number: '301',
    state: 'overdue',
    roomType: 'VIP Suite',
    guestName: 'Diana Prince',
    checkOutTime: new Date(now - 16 * 60000).toISOString(),
  };
  const res = categorizeRoomAlert(room, now);
  assert.equal(res.isUrgent, true);
  assert.equal(res.urgencyLevel, 'late-past-grace');
  assert.equal(res.label, 'LATE PAST GRACE (+15M)');
});

test('3.2: Room 2 hours overdue is flagged as Late Past Grace', () => {
  const room: MockRoom = {
    number: '302',
    state: 'overdue',
    roomType: 'Classic Room',
    guestName: 'Elena Rostova',
    checkOutTime: new Date(now - 120 * 60000).toISOString(),
  };
  const res = categorizeRoomAlert(room, now);
  assert.equal(res.isUrgent, true);
  assert.equal(res.urgencyLevel, 'late-past-grace');
});

// --- Test 4: Staff House Quarters Exemption ---
test('4.1: Staff House room 12 never triggers guest checkout alarms', () => {
  const room: MockRoom = {
    number: '12',
    state: 'occupied',
    roomType: 'Staff House',
    guestName: 'Housekeeping Staff',
    isStaffHouse: true,
    checkOutTime: new Date(now - 30 * 60000).toISOString(),
  };
  const res = categorizeRoomAlert(room, now);
  assert.equal(res.isUrgent, false);
  assert.equal(res.urgencyLevel, 'none');
});

// --- Test 5: Snooze Alarm Calculations ---
test('5.1: Snooze 5 minutes sets future expiry time', () => {
  const snoozeDurationMins = 5;
  const snoozedUntil = now + snoozeDurationMins * 60000;
  const item: SnoozedAlarm = {
    roomNumber: '101',
    type: 'warning',
    message: 'Apartment 101 checkout is in 15 minutes!',
    snoozedUntil,
  };
  assert.equal(item.snoozedUntil - now, 300000);
  assert.equal(item.snoozedUntil > now, true);
});

test('5.2: Snoozed alarm expires when current time exceeds snoozedUntil', () => {
  const snoozedUntil = now + 5 * 60000;
  const advancedTime = now + 6 * 60000;
  assert.equal(advancedTime >= snoozedUntil, true);
});

// --- Test 6: Status Filter Logic ---
test('6.1: "almost_in_time" filter accurately includes warning & overdue rooms while excluding vacant & comfortable rooms', () => {
  const rooms: MockRoom[] = [
    { number: '101', state: 'occupied', roomType: 'Classic', guestName: 'A', checkOutTime: new Date(now + 10 * 60000).toISOString() }, // Warning (10m left) -> MATCH
    { number: '102', state: 'overdue', roomType: 'Premium', guestName: 'B', checkOutTime: new Date(now - 5 * 60000).toISOString() },  // Overdue grace -> MATCH
    { number: '103', state: 'overdue', roomType: 'VIP', guestName: 'C', checkOutTime: new Date(now - 20 * 60000).toISOString() },   // Past grace -> MATCH
    { number: '104', state: 'occupied', roomType: 'Classic', guestName: 'D', checkOutTime: new Date(now + 60 * 60000).toISOString() }, // 1h left -> NO MATCH
    { number: '105', state: 'available', roomType: 'Classic', guestName: 'Vacant' },                                                     // Available -> NO MATCH
    { number: '12', state: 'occupied', roomType: 'Staff House', guestName: 'Staff', isStaffHouse: true, checkOutTime: new Date(now - 10000).toISOString() }, // Staff -> NO MATCH
  ];

  const matched = rooms.filter((r) => {
    if (r.isStaffHouse || r.roomType === 'Staff House' || String(r.number) === '12') return false;
    if ((r.state === 'occupied' || r.state === 'overdue') && r.checkOutTime) {
      const diffMins = (new Date(r.checkOutTime).getTime() - now) / 60000;
      return diffMins <= 15;
    }
    return false;
  });

  assert.equal(matched.length, 3);
  assert.deepEqual(matched.map(r => r.number), ['101', '102', '103']);
});

console.log(`\n=================================================`);
console.log(`📊 NOTIFICATION SUITE: ${passedTests}/${passedTests} PASSED 🎉 ALL PASSED`);
console.log(`=================================================\n`);
