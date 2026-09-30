import { asyncHandler } from '../utils/async-handler';

/**
 * server/routes/rooms.ts
 * GET  /api/rooms       — list all rooms
 * PUT  /api/rooms/:number — update a single room's state
 * POST /api/rooms/reset  — reset all rooms to seed defaults (admin/owner only)
 */

import { Router, Request, Response } from 'express';
import { pool, withTransaction } from '../db/pool';
import { requireAuth, requireCashierStaff } from '../middleware/auth';
import { socketManager } from '../websocket/socket-manager';

import { INITIAL_ROOMS } from '../../src/data';
import { isMidnightPromoAllowed, calculateExpectedCheckout } from '../utils/pricing';
import {
  getAlarmSettings,
  updateAlarmSettings,
  computeAlarmState,
  acknowledgeAlarm,
  extendStay,
  snoozeAlarm,
  switchToOpenTime,
  waiveOvertime,
  AlarmState,
} from '../services/alarm-service';
import { analyticsService } from '../services/analytics-service';

export function getMaxRoomCapacity(roomType: string, tier: string): number {
  const typeLower = (roomType || '').toLowerCase();
  const tierLower = (tier || '').toLowerCase();

  if (typeLower.includes('vip') || typeLower.includes('suite') || tierLower === 'suite') {
    return 6;
  }
  if (typeLower.includes('premium') || typeLower.includes('deluxe') || tierLower === 'deluxe') {
    return 5;
  }
  return 4; // Classic Room / Standard
}

export function validateRoomPersons(
  persons: number,
  roomType: string,
  tier: string
): { valid: boolean; error?: string; persons: number; extraPersons: number } {
  const p = Math.max(1, Math.round(Number(persons) || 2));
  const maxCapacity = getMaxRoomCapacity(roomType, tier);

  if (p < 1) {
    return { valid: false, error: 'Guest count must be at least 1 person.', persons: 2, extraPersons: 0 };
  }

  if (p > maxCapacity) {
    return {
      valid: false,
      error: `Maximum occupancy for ${roomType || 'this room'} is ${maxCapacity} persons (Base 2 + up to ${maxCapacity - 2} extra). Provided: ${p} persons.`,
      persons: p,
      extraPersons: Math.max(0, p - 2),
    };
  }

  return {
    valid: true,
    persons: p,
    extraPersons: Math.max(0, p - 2),
  };
}

const router = Router();

// Map DB row → frontend Room object
function rowToRoom(row: any) {
  let chargedFood = [];
  if (row.charged_food) {
    try {
      chargedFood = typeof row.charged_food === 'string'
        ? JSON.parse(row.charged_food)
        : row.charged_food;
    } catch (e) {
      console.warn('Failed to parse charged_food for room', row.number);
      chargedFood = [];
    }
  }

  const checkInRaw = row.check_in_at || row.check_in_time;
  let expectedCheckoutRaw = row.expected_checkout_at || row.check_out_time;
  const billingMode = (row.billing_mode || 'standard') as 'standard' | 'open_time';

  // Add expected_checkout_at if missing: check_in_at + booked duration (Task 1)
  if (!expectedCheckoutRaw && checkInRaw && (row.state === 'occupied' || row.state === 'overdue') && billingMode !== 'open_time') {
    const parsedIn = new Date(checkInRaw);
    if (!isNaN(parsedIn.getTime())) {
      const calc = calculateExpectedCheckout(row.rate_selected || '24h', parsedIn, row.custom_hours);
      expectedCheckoutRaw = calc.toISOString();
    }
  }

  const checkInAt = checkInRaw ? new Date(checkInRaw).toISOString() : undefined;
  const expectedCheckoutAt = expectedCheckoutRaw ? new Date(expectedCheckoutRaw).toISOString() : undefined;

  // Compute time string and open-time badge
  let timeStr = 'READY';
  if (row.room_type === 'Staff House' || String(row.number) === '12') {
    timeStr = 'STAFF';
  } else if (billingMode === 'open_time') {
    const startMs = row.open_time_started_at
      ? new Date(row.open_time_started_at).getTime()
      : (checkInRaw ? new Date(checkInRaw).getTime() : Date.now());
    const elapsedMs = Math.max(0, Date.now() - startMs);
    const h = Math.floor(elapsedMs / 3600000);
    const m = Math.floor((elapsedMs % 3600000) / 60000);
    timeStr = `Open time · ${h}h ${m}m`;
  } else if (row.check_out_time || expectedCheckoutAt) {
    const checkoutTimeVal = expectedCheckoutAt || row.check_out_time;
    const diff = new Date(checkoutTimeVal).getTime() - Date.now();
    if (diff > 0) {
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
    } else {
      const od = Math.abs(diff);
      const h = Math.floor(od / 3600000);
      const m = Math.floor((od % 3600000) / 60000);
      timeStr = h > 0 ? `+${h}h ${m}m` : `+${m}m`;
    }
  }

  return {
    number: String(row.number),
    tier: row.tier,
    floor: Number(row.floor),
    roomType: row.room_type,
    state: row.state,
    label: billingMode === 'open_time' ? (row.label && row.label !== 'Available' ? row.label : timeStr) : row.label,
    guestName: row.guest_name || '',
    guestId: row.guest_id || '',
    numGuests: Number(row.num_guests || 0),
    rateSelected: row.rate_selected || '24h',
    customHours: row.custom_hours ? Number(row.custom_hours) : undefined,
    extraBeds: Number(row.extra_beds || 0),
    towelSets: Number(row.towel_sets || 0),
    checkInTime: checkInAt,
    checkOutTime: expectedCheckoutAt,
    checkInAt,
    expectedCheckoutAt,
    alarmState: (row.alarm_state as AlarmState) || 'NORMAL',
    acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at).toISOString() : undefined,
    acknowledgedBy: row.acknowledged_by || undefined,
    isOverdue: Boolean(row.is_overdue),
    billingMode,
    openTimeStartedAt: row.open_time_started_at ? new Date(row.open_time_started_at).toISOString() : undefined,
    snoozedUntil: row.snoozed_until ? new Date(row.snoozed_until).toISOString() : undefined,
    repeatCount: Number(row.repeat_count || 0),
    overtimeWaived: Boolean(row.overtime_waived),
    overtimeWaivedBy: row.overtime_waived_by || undefined,
    overtimeWaivedReason: row.overtime_waived_reason || undefined,
    chargedFood: chargedFood,
    discountType: (row.discount_type || 'NONE') as 'NONE' | 'SENIOR' | 'DC',
    discountIdRef: row.discount_id_ref || '',
    allocatedReceiptNo: row.allocated_receipt_no || undefined,
    forceCheckoutPending: Boolean(row.fcr_id),
    forceCheckoutRequestId: row.fcr_id || undefined,
    isStaffHouse: Boolean(row.room_type === 'Staff House' || String(row.number) === '12'),
    time: timeStr,
  };
}

// GET /api/rooms — list all rooms (staff only; contains guest PII and stay data)
router.get('/', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT r.*, fcr.id AS fcr_id 
      FROM rooms r 
      LEFT JOIN force_checkout_requests fcr 
        ON r.number = fcr.room_number AND fcr.status = 'pending'
      ORDER BY CAST(r.number AS INTEGER) ASC
    `);
    res.json(result.rows.map(rowToRoom));
  } catch (err) {
    console.error('GET /rooms error:', err);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
}));

// PUT /api/rooms/:number
router.put('/:number', requireCashierStaff, asyncHandler(async (req: Request, res: Response) => {
  const { number } = req.params;
  const room = req.body;
  const operator = (req as any).operator;

  const rateSelected = room.rateSelected || room.rate_selected;
  if (rateSelected === 'promo') {
    const checkInDate = room.checkInTime || room.check_in_time ? new Date(room.checkInTime || room.check_in_time) : new Date();
    if (!isMidnightPromoAllowed(checkInDate)) {
      res.status(400).json({ error: 'Midnight promo rate is only valid for check-ins between 8:00 PM and 6:00 AM' });
      return;
    }
  }

  try {
    const isOccupiedState = room.state === 'occupied' || room.state === 'overdue';
    let checkInIso: string | null = null;
    let expectedCheckoutIso: string | null = null;
    const settings = await getAlarmSettings();
    let nextAlarmState: AlarmState = 'NORMAL';
    let isOverdueVal = Boolean(room.isOverdue);
    const chargedFoodStr = JSON.stringify(room.chargedFood || []);

    if (isOccupiedState) {
      const rawIn = room.checkInAt || room.check_in_at || room.checkInTime || room.check_in_time;
      if (rawIn) {
        const d = new Date(rawIn);
        checkInIso = !isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
      } else {
        checkInIso = new Date().toISOString();
      }

      const rawOut = room.expectedCheckoutAt || room.expected_checkout_at || room.checkOutTime || room.check_out_time;
      if (rawOut) {
        const d = new Date(rawOut);
        expectedCheckoutIso = !isNaN(d.getTime()) ? d.toISOString() : null;
      }

      if (!expectedCheckoutIso && checkInIso) {
        const customH = room.customHours || (rateSelected === 'custom' ? (room.custom_hours || 1) : null);
        const exp = calculateExpectedCheckout(rateSelected || '24h', new Date(checkInIso), customH);
        expectedCheckoutIso = exp.toISOString();
      }

      if (expectedCheckoutIso) {
        nextAlarmState = computeAlarmState(expectedCheckoutIso, Date.now(), settings);
        isOverdueVal = nextAlarmState === 'OVERDUE' || nextAlarmState === 'DUE';
      }
    }

    // Room update + bed/towel stock consume run in one atomic transaction:
    // only newly assigned extras are deducted, and a stock shortage rolls
    // the entire update back (HTTP 400) instead of checking in without stock.
    const { updatedRoom, prevAlarmState } = await withTransaction(async (conn) => {
      const stored = await conn.query(
        'SELECT extra_beds, towel_sets, state, charged_food, alarm_state FROM rooms WHERE number = ?',
        [number]
      );
      if (stored.rows.length === 0) {
        const notFound: any = new Error(`Room ${number} not found`);
        notFound.statusCode = 404;
        throw notFound;
      }

      const prevState: string = stored.rows[0].state || 'available';
      const prevAlarmState: AlarmState = stored.rows[0].alarm_state || 'NORMAL';

      // Section 11: Validate check-in persons & capacity limits
      const roomType = room.roomType || stored.rows[0].room_type || '';
      const tier = room.tier || stored.rows[0].tier || '';
      const rawNumGuests = room.numGuests != null ? Number(room.numGuests) : (isOccupiedState ? 2 : 0);
      const personValidation = validateRoomPersons(rawNumGuests, roomType, tier);
      if (!personValidation.valid && isOccupiedState) {
        throw Object.assign(new Error(personValidation.error), { statusCode: 400 });
      }
      const finalNumGuests = isOccupiedState ? personValidation.persons : 0;

      // Deduct 1 guest kit when a room first becomes occupied (check-in)
      const isNewCheckIn = prevState !== 'occupied' && prevState !== 'overdue' && room.state === 'occupied';

      const allocatedReceiptNo = isOccupiedState
        ? (room.allocatedReceiptNo !== undefined ? (room.allocatedReceiptNo || null) : (stored.rows[0].allocated_receipt_no || null))
        : null;

      await conn.query(
        `UPDATE rooms SET
          state = ?, label = ?, guest_name = ?, guest_id = ?,
          num_guests = ?, rate_selected = ?, custom_hours = ?, extra_beds = ?,
          towel_sets = ?, check_in_time = ?, check_out_time = ?,
          check_in_at = ?, expected_checkout_at = ?, alarm_state = ?,
          acknowledged_at = CASE WHEN ? = 1 THEN NULL ELSE acknowledged_at END,
          acknowledged_by = CASE WHEN ? = 1 THEN NULL ELSE acknowledged_by END,
          is_overdue = ?, charged_food = ?, discount_type = ?, discount_id_ref = ?,
          allocated_receipt_no = ?, updated_at = NOW()
         WHERE number = ?`,
        [
          isOccupiedState && (nextAlarmState === 'OVERDUE' || nextAlarmState === 'DUE') ? 'overdue' : room.state,
          room.label || 'Available',
          room.guestName || '',
          room.guestId || '',
          finalNumGuests,
          room.rateSelected || '24h',
          room.customHours || (room.rateSelected === 'custom' ? (room.custom_hours || 1) : null),
          room.extraBeds || 0,
          room.towelSets || 0,
          checkInIso,
          expectedCheckoutIso,
          checkInIso,
          expectedCheckoutIso,
          nextAlarmState,
          isNewCheckIn || !isOccupiedState ? 1 : 0,
          isNewCheckIn || !isOccupiedState ? 1 : 0,
          isOverdueVal ? 1 : 0,
          chargedFoodStr,
          room.discountType || 'NONE',
          room.discountIdRef || '',
          allocatedReceiptNo,
          number,
        ]
      );

      const checkResult = await conn.query('SELECT * FROM rooms WHERE number = ?', [number]);
      return { updatedRoom: rowToRoom(checkResult.rows[0]), prevAlarmState };
    });
    
    // Broadcast room update via WebSocket
    socketManager.broadcastRoomUpdate({
      roomNumber: number,
      state: updatedRoom.state,
      label: updatedRoom.label,
      guestName: updatedRoom.guestName,
      checkInTime: updatedRoom.checkInTime,
      checkOutTime: updatedRoom.checkOutTime,
      checkInAt: updatedRoom.checkInAt,
      expectedCheckoutAt: updatedRoom.expectedCheckoutAt,
      alarmState: updatedRoom.alarmState,
      acknowledgedAt: updatedRoom.acknowledgedAt,
      acknowledgedBy: updatedRoom.acknowledgedBy,
      billingMode: updatedRoom.billingMode,
      snoozedUntil: updatedRoom.snoozedUntil,
      repeatCount: updatedRoom.repeatCount,
      overtimeWaived: updatedRoom.overtimeWaived,
      timestamp: new Date().toISOString(),
    });
    
    // If alarm state changed, broadcast state machine transition event
    if (prevAlarmState !== updatedRoom.alarmState) {
      socketManager.broadcastAlarmStateChanged({
        roomNumber: number,
        previousState: prevAlarmState,
        newState: updatedRoom.alarmState,
        expectedCheckoutAt: updatedRoom.expectedCheckoutAt,
        acknowledgedAt: updatedRoom.acknowledgedAt,
        acknowledgedBy: updatedRoom.acknowledgedBy,
        timestamp: new Date().toISOString(),
      });
    }

    analyticsService.notifyGuestCountsUpdated().catch(console.warn);
    
    res.json(updatedRoom);
  } catch (err: any) {
    console.error(`PUT /rooms/${number} error:`, err);
    const status = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
    res.status(status).json({ error: status === 404 ? err.message : `Failed to update room: ${err?.message || 'unknown database error'}` });
  }
}));

// POST /api/rooms/reset — resets all rooms and operational data to defaults
router.post('/reset', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const operator = (req as any).operator;
  if (operator.role !== 'admin' && operator.role !== 'owner') {
    res.status(403).json({ error: 'Only admin or owner can reset the database' });
    return;
  }
  const confirm = String((req.body as any)?.confirm || req.query.confirm || '');
  if (confirm !== 'RESET-ALL-DATA') {
    res.status(400).json({ error: "Confirmation required: send { confirm: 'RESET-ALL-DATA' }." });
    return;
  }
  try {
    const resultRows = await withTransaction(async (conn) => {
      // 1. Clear operational tables
      await conn.query('DELETE FROM scheduled_bookings');
      await conn.query('DELETE FROM receipts');
      await conn.query('DELETE FROM kitchen_orders');
      await conn.query('DELETE FROM handoff_tasks');
      await conn.query('DELETE FROM pos_revenue');
      await conn.query('DELETE FROM weekly_shift_entries');
      await conn.query('DELETE FROM weekly_expenses');
      await conn.query('DELETE FROM gcash_entries');
      await conn.query('DELETE FROM cash_denomination_report');
      await conn.query('DELETE FROM force_checkout_requests');
      await conn.query('DELETE FROM room_transfers');
      await conn.query('DELETE FROM deposit_transactions');
      await conn.query('DELETE FROM deposits');
      await conn.query('DELETE FROM inventory_events');
      await conn.query('DELETE FROM shift_expenses');
      await conn.query('DELETE FROM discount_rates');

      // 2. Reset all rooms to pristine initial states
      for (const room of INITIAL_ROOMS) {
        await conn.query(
          `UPDATE rooms SET
            state = ?, label = ?, guest_name = ?, guest_id = ?,
            num_guests = ?, rate_selected = ?, extra_beds = ?,
            towel_sets = ?, check_in_time = ?, check_out_time = ?,
            check_in_at = NULL, expected_checkout_at = NULL,
            alarm_state = 'NORMAL', acknowledged_at = NULL, acknowledged_by = NULL,
            is_overdue = ?, charged_food = ?, discount_type = 'NONE', discount_id_ref = '',
            allocated_receipt_no = NULL,
            billing_mode = 'standard', open_time_started_at = NULL, last_reminder_at = NULL,
            snoozed_until = NULL, repeat_count = 0, overtime_waived = 0, overtime_waived_by = NULL,
            overtime_waived_reason = NULL, updated_at = NOW()
           WHERE number = ?`,
          [
            room.state, room.label, room.guestName || '', room.guestId || '',
            room.numGuests || 0, room.rateSelected || '24h', room.extraBeds || 0,
            room.towelSets || 0, room.checkInTime || null, room.checkOutTime || null,
            room.isOverdue || false, JSON.stringify(room.chargedFood || []), room.number,
          ]
        );
      }
      const res = await conn.query('SELECT * FROM rooms ORDER BY CAST(number AS INTEGER) ASC');
      await conn.query(
        `INSERT INTO audit_logs (id, timestamp, operator, action, details) VALUES (?, datetime('now','localtime'), ?, 'ROOMS_RESET', ?)`,
        [`log-reset-${Date.now()}`, operator.username, `Board reset by ${operator.username}: wiped receipts/deposits/shifts/expenses and restored ${INITIAL_ROOMS.length} rooms`]
      ).catch((e: any) => console.warn('reset audit failed', e));
      return res.rows;
    });
    
    // Broadcast system notification and kitchen queue clear
    socketManager.broadcastSystemNotification(
      `System data and all rooms have been reset to default state by ${operator.username}`,
      'warning'
    );
    socketManager.broadcast('kitchen:queue_updated', []);
    
    res.json(resultRows.map(rowToRoom));
  } catch (err) {
    console.error('POST /rooms/reset error:', err);
    res.status(500).json({ error: 'Failed to reset rooms' });
  }
}));

// GET /api/rooms/transfers — list room transfer history
router.get('/transfers', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { date, limit = 100 } = req.query;
    let sql = 'SELECT * FROM room_transfers';
    const params: any[] = [];
    if (date && typeof date === 'string') {
      sql += ' WHERE DATE(transferred_at) = DATE(?)';
      params.push(date);
    }
    sql += ' ORDER BY transferred_at DESC LIMIT ?';
    params.push(Number(limit) || 100);

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /rooms/transfers error:', err);
    res.status(500).json({ error: 'Failed to fetch room transfers' });
  }
}));

// POST /api/rooms/transfer — execute guest room relocation atomically
router.post('/transfer', requireCashierStaff, asyncHandler(async (req: Request, res: Response) => {
  const operator = (req as any).operator;
  const operatorName = operator?.name || operator?.username || 'Frontdesk';
  const {
    sourceRoomNumber,
    targetRoomNumber,
    reason,
    notes = '',
    priceDifference = 0,
  } = req.body;

  if (!sourceRoomNumber || !targetRoomNumber || !reason) {
    res.status(400).json({ error: 'sourceRoomNumber, targetRoomNumber, and reason are required' });
    return;
  }

  if (String(sourceRoomNumber) === String(targetRoomNumber)) {
    res.status(400).json({ error: 'Source room and target room must be different' });
    return;
  }

  try {
    const transferId = `rt-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const auditLogId = `log-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const { updatedSource, updatedTarget, transferRecord } = await withTransaction(async (conn) => {
      // 1. Fetch Source Room
      const sourceResult = await conn.query('SELECT * FROM rooms WHERE number = ?', [String(sourceRoomNumber)]);
      if (sourceResult.rows.length === 0) {
        const err: any = new Error(`Source Room ${sourceRoomNumber} not found`);
        err.statusCode = 404;
        throw err;
      }
      const source = sourceResult.rows[0];
      if (source.state !== 'occupied' && source.state !== 'overdue') {
        const err: any = new Error(`Source Room ${sourceRoomNumber} is currently ${source.state.toUpperCase()} (must be occupied to transfer)`);
        err.statusCode = 400;
        throw err;
      }

      // 2. Fetch Target Room — must be available
      const targetResult = await conn.query('SELECT * FROM rooms WHERE number = ?', [String(targetRoomNumber)]);
      if (targetResult.rows.length === 0) {
        const err: any = new Error(`Target Room ${targetRoomNumber} not found`);
        err.statusCode = 404;
        throw err;
      }
      const target = targetResult.rows[0];
      if (target.state !== 'available') {
        const err: any = new Error(`Target Room ${targetRoomNumber} is currently ${target.state.toUpperCase()}. Please select an available room.`);
        err.statusCode = 400;
        throw err;
      }

      const chargedFoodStr = typeof source.charged_food === 'string'
        ? source.charged_food
        : JSON.stringify(source.charged_food || []);

      // 3. Insert Room Transfer Record
      await conn.query(
        `INSERT INTO room_transfers (
          id, source_room_number, target_room_number, guest_name, guest_id,
          reason, transferred_by, transferred_at, source_tier, target_tier,
          rate_selected, charged_food, price_difference, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?)`,
        [
          transferId,
          String(sourceRoomNumber),
          String(targetRoomNumber),
          source.guest_name || 'Guest',
          source.guest_id || '',
          reason,
          operatorName,
          source.tier || 'STANDARD',
          target.tier || 'STANDARD',
          source.rate_selected || '24h',
          chargedFoodStr,
          Number(priceDifference) || 0,
          notes || '',
        ]
      );

      const checkInVal = source.check_in_at || source.check_in_time;
      const expectedCheckoutVal = source.expected_checkout_at || source.check_out_time;

      // 4. Update Target Room to OCCUPIED with all guest stay data including alarm state, billing mode, and allocated_receipt_no
      await conn.query(
        `UPDATE rooms SET
          state = 'occupied',
          label = ?,
          guest_name = ?,
          guest_id = ?,
          num_guests = ?,
          rate_selected = ?,
          custom_hours = ?,
          extra_beds = ?,
          towel_sets = ?,
          check_in_time = ?,
          check_out_time = ?,
          check_in_at = ?,
          expected_checkout_at = ?,
          alarm_state = ?,
          acknowledged_at = ?,
          acknowledged_by = ?,
          is_overdue = ?,
          billing_mode = ?,
          open_time_started_at = ?,
          last_reminder_at = ?,
          snoozed_until = ?,
          repeat_count = ?,
          overtime_waived = ?,
          overtime_waived_by = ?,
          overtime_waived_reason = ?,
          charged_food = ?,
          discount_type = ?,
          discount_id_ref = ?,
          allocated_receipt_no = ?,
          updated_at = NOW()
        WHERE number = ?`,
        [
          source.label || source.guest_name || 'Guest',
          source.guest_name || '',
          source.guest_id || '',
          source.num_guests || 1,
          source.rate_selected || '24h',
          source.custom_hours || null,
          source.extra_beds || 0,
          source.towel_sets || 0,
          checkInVal || null,
          expectedCheckoutVal || null,
          checkInVal || null,
          expectedCheckoutVal || null,
          source.alarm_state || 'NORMAL',
          source.acknowledged_at || null,
          source.acknowledged_by || null,
          source.is_overdue || false,
          source.billing_mode || 'standard',
          source.open_time_started_at || null,
          source.last_reminder_at || null,
          source.snoozed_until || null,
          source.repeat_count || 0,
          source.overtime_waived || 0,
          source.overtime_waived_by || null,
          source.overtime_waived_reason || null,
          chargedFoodStr,
          source.discount_type || 'NONE',
          source.discount_id_ref || '',
          source.allocated_receipt_no || null,
          String(targetRoomNumber),
        ]
      );

      // 5. Reset Source Room directly to AVAILABLE
      await conn.query(
        `UPDATE rooms SET
          state = 'available',
          label = 'Available',
          guest_name = '',
          guest_id = '',
          num_guests = 0,
          rate_selected = '24h',
          custom_hours = NULL,
          extra_beds = 0,
          towel_sets = 0,
          check_in_time = NULL,
          check_out_time = NULL,
          check_in_at = NULL,
          expected_checkout_at = NULL,
          alarm_state = 'NORMAL',
          acknowledged_at = NULL,
          acknowledged_by = NULL,
          is_overdue = 0,
          charged_food = '[]',
          discount_type = 'NONE',
          discount_id_ref = '',
          allocated_receipt_no = NULL,
          billing_mode = 'standard',
          open_time_started_at = NULL,
          last_reminder_at = NULL,
          snoozed_until = NULL,
          repeat_count = 0,
          overtime_waived = 0,
          overtime_waived_by = NULL,
          overtime_waived_reason = NULL,
          updated_at = NOW()
        WHERE number = ?`,
        [String(sourceRoomNumber)]
      );

      // 6. Reroute active (non-delivered) kitchen orders to the new target room
      await conn.query(
        `UPDATE kitchen_orders SET
          room_number = ?,
          updated_at = NOW()
        WHERE room_number = ? AND status NOT IN ('delivered', 'cancelled')`,
        [String(targetRoomNumber), String(sourceRoomNumber)]
      );

      // 7. Reroute pending force checkout request if any
      await conn.query(
        `UPDATE force_checkout_requests SET
          room_number = ?
        WHERE room_number = ? AND status = 'pending'`,
        [String(targetRoomNumber), String(sourceRoomNumber)]
      );

      // 8. Log Immutable Audit Record
      const auditDetails = `Transferred Guest "${source.guest_name || 'Guest'}" from Room ${sourceRoomNumber} (${source.room_type || source.tier}) to Room ${targetRoomNumber} (${target.room_type || target.tier}). Reason: ${reason}${notes ? ` | Notes: ${notes}` : ''}`;
      await conn.query(
        `INSERT INTO audit_logs (id, timestamp, operator, action, details)
         VALUES (?, NOW(), ?, 'ROOM_TRANSFER', ?)`,
        [auditLogId, operatorName, auditDetails]
      );

      const updatedSourceRow = await conn.query('SELECT * FROM rooms WHERE number = ?', [String(sourceRoomNumber)]);
      const updatedTargetRow = await conn.query('SELECT * FROM rooms WHERE number = ?', [String(targetRoomNumber)]);

      return {
        updatedSource: rowToRoom(updatedSourceRow.rows[0]),
        updatedTarget: rowToRoom(updatedTargetRow.rows[0]),
        transferRecord: {
          id: transferId,
          sourceRoomNumber: String(sourceRoomNumber),
          targetRoomNumber: String(targetRoomNumber),
          guestName: source.guest_name || 'Guest',
          guestId: source.guest_id || '',
          reason,
          transferredBy: operatorName,
          transferredAt: new Date().toISOString(),
          sourceTier: source.tier,
          targetTier: target.tier,
          rateSelected: source.rate_selected,
          notes,
        },
      };
    });

    // Broadcast room updates via WebSocket
    socketManager.broadcastRoomUpdate({
      roomNumber: String(sourceRoomNumber),
      state: updatedSource.state,
      label: updatedSource.label,
      guestName: '',
      billingMode: 'standard',
      timestamp: new Date().toISOString(),
    });

    socketManager.broadcastRoomUpdate({
      roomNumber: String(targetRoomNumber),
      state: updatedTarget.state,
      label: updatedTarget.label,
      guestName: updatedTarget.guestName,
      checkInTime: updatedTarget.checkInTime,
      checkOutTime: updatedTarget.checkOutTime,
      billingMode: updatedTarget.billingMode,
      openTimeStartedAt: updatedTarget.openTimeStartedAt,
      timestamp: new Date().toISOString(),
    });

    socketManager.broadcastSystemNotification(
      `Room Transfer: Guest "${updatedTarget.guestName}" moved from Room ${sourceRoomNumber} to Room ${targetRoomNumber} (${reason}) by ${operatorName}`,
      'info'
    );

    res.json({
      success: true,
      transfer: transferRecord,
      sourceRoom: updatedSource,
      targetRoom: updatedTarget,
      message: `Successfully transferred guest from Room ${sourceRoomNumber} to Room ${targetRoomNumber}`,
    });
  } catch (err: any) {
    console.error('POST /api/rooms/transfer error:', err);
    const status = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
    res.status(status).json({ error: err.message || 'Failed to transfer room' });
  }
}));

// POST /api/rooms/:number/alarm/ack — acknowledge overdue alert (idempotent, role-checked)
router.post('/:number/alarm/ack', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { number } = req.params;
  const operator = (req as any).operator;
  if (!operator || !['cashier', 'admin', 'owner'].includes(operator.role)) {
    return res.status(403).json({ error: 'Unauthorized role for alarm acknowledgment' });
  }

  const operatorUsername = operator.username || operator.name || 'Frontdesk';
  const result = await acknowledgeAlarm(number, operatorUsername);
  res.json(result);
}));

// POST /api/rooms/:number/extend — extend stay (role-checked, server-side calculated)
router.post('/:number/extend', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { number } = req.params;
  const operator = (req as any).operator;
  if (!operator || !['cashier', 'admin', 'owner'].includes(operator.role)) {
    return res.status(403).json({ error: 'Unauthorized role for stay extension' });
  }

  const { hours, rateSelected, customHours } = req.body;
  const operatorUsername = operator.username || operator.name || 'Frontdesk';
  const result = await extendStay(number, { hours, rateSelected, customHours }, operatorUsername);
  res.json(result);
}));

// POST /api/rooms/:number/snooze — snooze alarm for snooze_minutes
router.post('/:number/snooze', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { number } = req.params;
  const operator = (req as any).operator;
  if (!operator || !['cashier', 'admin', 'owner'].includes(operator.role)) {
    return res.status(403).json({ error: 'Unauthorized role for alarm snooze' });
  }

  const operatorUsername = operator.username || operator.name || 'Frontdesk';
  const result = await snoozeAlarm(number, operatorUsername);
  res.json(result);
}));

// POST /api/rooms/:number/open-time — switch room to open-time billing mode
router.post('/:number/open-time', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { number } = req.params;
  const { reason = '' } = req.body;
  const operator = (req as any).operator;
  if (!operator || !['cashier', 'admin', 'owner'].includes(operator.role)) {
    return res.status(403).json({ error: 'Unauthorized role for open time switch' });
  }

  const operatorUsername = operator.username || operator.name || 'Frontdesk';
  const result = await switchToOpenTime(number, operatorUsername, reason);
  res.json(result);
}));

// POST /api/rooms/:number/waive-overtime — waive overtime charges for room
router.post('/:number/waive-overtime', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { number } = req.params;
  const { reason = '' } = req.body;
  const operator = (req as any).operator;
  if (!operator || !['cashier', 'admin', 'owner'].includes(operator.role)) {
    return res.status(403).json({ error: 'Unauthorized role for waiving overtime' });
  }

  const operatorUsername = operator.username || operator.name || 'Frontdesk';
  const result = await waiveOvertime(number, operatorUsername, reason);
  res.json(result);
}));

// GET /api/rooms/settings/alarm — fetch alarm settings
router.get('/settings/alarm', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  const settings = await getAlarmSettings();
  res.json(settings);
}));

// PUT /api/rooms/settings/alarm — update alarm settings (Admin or Owner only)
router.put('/settings/alarm', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const operator = (req as any).operator;
  if (!operator || (operator.role !== 'admin' && operator.role !== 'owner')) {
    return res.status(403).json({ error: 'Only Admin or Owner can modify system alarm settings' });
  }

  const {
    alarm_pre_minutes,
    alarm_post_minutes,
    snooze_minutes,
    overdue_repeat_minutes,
    overdue_max_repeats,
    extra_hour_rate,
    open_time_reminder_hours,
  } = req.body;

  const updated = await updateAlarmSettings({
    alarm_pre_minutes: alarm_pre_minutes !== undefined ? Number(alarm_pre_minutes) : undefined,
    alarm_post_minutes: alarm_post_minutes !== undefined ? Number(alarm_post_minutes) : undefined,
    snooze_minutes: snooze_minutes !== undefined ? Number(snooze_minutes) : undefined,
    overdue_repeat_minutes: overdue_repeat_minutes !== undefined ? Number(overdue_repeat_minutes) : undefined,
    overdue_max_repeats: overdue_max_repeats !== undefined ? Number(overdue_max_repeats) : undefined,
    extra_hour_rate: extra_hour_rate !== undefined ? Number(extra_hour_rate) : undefined,
    open_time_reminder_hours: open_time_reminder_hours !== undefined ? Number(open_time_reminder_hours) : undefined,
  });

  res.json(updated);
}));

export default router;
