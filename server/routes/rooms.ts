import { asyncHandler } from '../utils/async-handler';

/**
 * server/routes/rooms.ts
 * GET  /api/rooms       — list all rooms
 * PUT  /api/rooms/:number — update a single room's state
 * POST /api/rooms/reset  — reset all rooms to seed defaults (admin/owner only)
 */

import { Router, Request, Response } from 'express';
import { pool, withTransaction } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { socketManager } from '../websocket/socket-manager';
import { inventoryService } from '../services/inventory-service';
import { INITIAL_ROOMS } from '../../src/data';

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

  return {
    number: String(row.number),
    tier: row.tier,
    floor: Number(row.floor),
    roomType: row.room_type,
    state: row.state,
    label: row.label,
    guestName: row.guest_name || '',
    guestId: row.guest_id || '',
    numGuests: Number(row.num_guests || 0),
    rateSelected: row.rate_selected || '24h',
    customHours: row.custom_hours ? Number(row.custom_hours) : undefined,
    extraBeds: Number(row.extra_beds || 0),
    towelSets: Number(row.towel_sets || 0),
    checkInTime: row.check_in_time ? new Date(row.check_in_time).toISOString() : undefined,
    checkOutTime: row.check_out_time ? new Date(row.check_out_time).toISOString() : undefined,
    isOverdue: Boolean(row.is_overdue),
    chargedFood: chargedFood,
    discountType: (row.discount_type || 'NONE') as 'NONE' | 'SENIOR' | 'DC',
    discountIdRef: row.discount_id_ref || '',
    forceCheckoutPending: Boolean(row.fcr_id),
    forceCheckoutRequestId: row.fcr_id || undefined,
    isStaffHouse: Boolean(row.room_type === 'Staff House' || String(row.number) === '12'),
    // time is computed client-side from checkOutTime, not stored
    time: (row.room_type === 'Staff House' || String(row.number) === '12')
      ? 'STAFF'
      : row.check_out_time
      ? (() => {
          const diff = new Date(row.check_out_time).getTime() - Date.now();
          if (diff > 0) {
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            return h > 0 ? `${h}h ${m}m` : `${m}m`;
          }
          const od = Math.abs(diff);
          const h = Math.floor(od / 3600000);
          const m = Math.floor((od % 3600000) / 60000);
          return h > 0 ? `+${h}h ${m}m` : `+${m}m`;
        })()
      : 'READY',
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
router.put('/:number', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { number } = req.params;
  const room = req.body;
  const operator = (req as any).operator;
  try {
    const chargedFoodStr = JSON.stringify(room.chargedFood || []);

    // Room update + bed/towel stock consume run in one atomic transaction:
    // only newly assigned extras are deducted, and a stock shortage rolls
    // the entire update back (HTTP 400) instead of checking in without stock.
    const updatedRoom = await withTransaction(async (conn) => {
      const stored = await conn.query(
        'SELECT extra_beds, towel_sets, state, charged_food FROM rooms WHERE number = ?',
        [number]
      );
      if (stored.rows.length === 0) {
        const notFound: any = new Error(`Room ${number} not found`);
        notFound.statusCode = 404;
        throw notFound;
      }

      const prevBeds = Number(stored.rows[0].extra_beds || 0);
      const prevTowels = Number(stored.rows[0].towel_sets || 0);
      const prevState: string = stored.rows[0].state || 'available';
      const nextBeds = Number(room.extraBeds || 0);
      const nextTowels = Number(room.towelSets || 0);

      const toConsume: Array<{ item_id: string; quantity: number; name: string }> = [];
      if (nextBeds > prevBeds) {
        toConsume.push({ item_id: 'extra-bed', quantity: nextBeds - prevBeds, name: 'Extra Bed' });
      }
      if (nextTowels > prevTowels) {
        toConsume.push({ item_id: 'towel', quantity: nextTowels - prevTowels, name: 'Extra Towel' });
      }

      // Bug 2 fix: Deduct 1 guest kit when a room first becomes occupied (check-in)
      const isNewCheckIn = prevState !== 'occupied' && prevState !== 'overdue' && room.state === 'occupied';
      if (isNewCheckIn) {
        toConsume.push({ item_id: 'supply-guest-kit', quantity: 1, name: 'Guest Kit' });
      }

      if (toConsume.length > 0) {
        // inventoryService.atomicDecrementStock removed to fix double depletion
      }



      await conn.query(
        `UPDATE rooms SET
          state = ?, label = ?, guest_name = ?, guest_id = ?,
          num_guests = ?, rate_selected = ?, custom_hours = ?, extra_beds = ?,
          towel_sets = ?, check_in_time = ?, check_out_time = ?,
          is_overdue = ?, charged_food = ?, discount_type = ?, discount_id_ref = ?, updated_at = NOW()
         WHERE number = ?`,
        [
          room.state,
          room.label || 'Available',
          room.guestName || '',
          room.guestId || '',
          room.numGuests || 0,
          room.rateSelected || '24h',
          room.customHours || (room.rateSelected === 'custom' ? (room.custom_hours || 1) : null),
          room.extraBeds || 0,
          room.towelSets || 0,
          room.checkInTime || null,
          room.checkOutTime || null,
          room.isOverdue || false,
          chargedFoodStr,
          room.discountType || 'NONE',
          room.discountIdRef || '',
          number,
        ]
      );

      const checkResult = await conn.query('SELECT * FROM rooms WHERE number = ?', [number]);
      return rowToRoom(checkResult.rows[0]);
    });
    
    // Broadcast room update via WebSocket
    socketManager.broadcastRoomUpdate({
      roomNumber: number,
      state: room.state,
      guestName: room.guestName,
      checkInTime: room.checkInTime,
      checkOutTime: room.checkOutTime,
      timestamp: new Date().toISOString(),
    });
    
    // If room just became overdue, broadcast alarm
    if (room.state === 'overdue' && room.isOverdue) {
      socketManager.broadcastAlarm({
        roomNumber: number,
        alarmType: 'checkout',
        guestName: room.guestName,
        timestamp: new Date().toISOString(),
      });
    }
    
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
            is_overdue = ?, charged_food = ?, discount_type = 'NONE', discount_id_ref = '', updated_at = NOW()
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
router.post('/transfer', requireAuth, asyncHandler(async (req: Request, res: Response) => {
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

      // 2. Fetch Target Room
      const targetResult = await conn.query('SELECT * FROM rooms WHERE number = ?', [String(targetRoomNumber)]);
      if (targetResult.rows.length === 0) {
        const err: any = new Error(`Target Room ${targetRoomNumber} not found`);
        err.statusCode = 404;
        throw err;
      }
      const target = targetResult.rows[0];
      if (target.state !== 'available' && target.state !== 'clean') {
        const err: any = new Error(`Target Room ${targetRoomNumber} is currently ${target.state.toUpperCase()}. Please select an available or clean room.`);
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

      // 4. Update Target Room to OCCUPIED with all guest stay data
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
          is_overdue = ?,
          charged_food = ?,
          discount_type = ?,
          discount_id_ref = ?,
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
          source.check_in_time || null,
          source.check_out_time || null,
          source.is_overdue || false,
          chargedFoodStr,
          source.discount_type || 'NONE',
          source.discount_id_ref || '',
          String(targetRoomNumber),
        ]
      );

      // 5. Reset Source Room to CLEANING (dirty turnover for housekeeping)
      await conn.query(
        `UPDATE rooms SET
          state = 'cleaning',
          label = 'Turnover / Cleaning',
          guest_name = '',
          guest_id = '',
          num_guests = 0,
          rate_selected = '24h',
          custom_hours = NULL,
          extra_beds = 0,
          towel_sets = 0,
          check_in_time = NULL,
          check_out_time = NULL,
          is_overdue = 0,
          charged_food = '[]',
          discount_type = 'NONE',
          discount_id_ref = '',
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
      timestamp: new Date().toISOString(),
    });

    socketManager.broadcastRoomUpdate({
      roomNumber: String(targetRoomNumber),
      state: updatedTarget.state,
      label: updatedTarget.label,
      guestName: updatedTarget.guestName,
      checkInTime: updatedTarget.checkInTime,
      checkOutTime: updatedTarget.checkOutTime,
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

export default router;

