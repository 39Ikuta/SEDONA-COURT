/**
 * server/routes/force-checkout.ts
 * GET  /api/force-checkout          — list all force check-out requests (optional ?status=pending)
 * POST /api/force-checkout          — submit a new force check-out request (Cashier or Admin)
 * POST /api/force-checkout/:id/approve — approve & execute force checkout (Admin/Owner only)
 * POST /api/force-checkout/:id/reject  — reject request with notes (Admin/Owner only)
 * POST /api/force-checkout/direct-override — direct manager override checkout (Admin/Owner only)
 */

import { Router, Request, Response } from 'express';
import { pool, withTransaction } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { socketManager } from '../websocket/socket-manager';
import { formatStayDuration } from '../utils/pricing';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

function rowToForceCheckoutRequest(row: any) {
  let billedBreakdown = [];
  if (row.billed_breakdown) {
    try {
      billedBreakdown = typeof row.billed_breakdown === 'string'
        ? JSON.parse(row.billed_breakdown)
        : row.billed_breakdown;
    } catch (parseErr) {
      console.warn(`rowToForceCheckoutRequest: Failed to parse billed_breakdown JSON for ${row.id}:`, parseErr);
      billedBreakdown = [];
    }
  }

  return {
    id: row.id,
    roomNumber: String(row.room_number),
    roomType: row.room_type || undefined,
    guestName: row.guest_name || undefined,
    guestId: row.guest_id || undefined,
    checkInTime: row.check_in_time || undefined,
    rateSelected: row.rate_selected || undefined,
    uncollectedAmount: parseFloat(row.uncollected_amount || 0),
    billedBreakdown,
    reason: row.reason,
    cashierNotes: row.cashier_notes || '',
    requestedBy: row.requested_by,
    requestedAt: row.requested_at instanceof Date ? row.requested_at.toISOString() : String(row.requested_at),
    status: row.status,
    adminNotes: row.admin_notes || undefined,
    resolvedBy: row.resolved_by || undefined,
    resolvedAt: row.resolved_at ? (row.resolved_at instanceof Date ? row.resolved_at.toISOString() : String(row.resolved_at)) : undefined,
    resolutionType: row.resolution_type || undefined,
  };
}

// GET /api/force-checkout
router.get('/', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM force_checkout_requests';
    const params: any[] = [];

    if (status && status !== 'all') {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows.map(rowToForceCheckoutRequest));
  } catch (err) {
    console.error('GET /force-checkout error:', err);
    res.status(500).json({ error: 'Failed to fetch force checkout requests' });
  }
}));

// POST /api/force-checkout (Cashier submits escalation request)
router.post('/', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { roomNumber, reason, cashierNotes, uncollectedAmount, billedBreakdown } = req.body;
  const operator = (req as any).operator;

  if (!roomNumber || !reason) {
    return res.status(400).json({ error: 'Room number and incident reason are required.' });
  }

  try {
    // Check room exists and is active
    const roomResult = await pool.query('SELECT * FROM rooms WHERE number = ?', [roomNumber]);
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: `Room ${roomNumber} not found.` });
    }
    const room = roomResult.rows[0];

    // Check if there is already an active pending request for this room
    const existingPending = await pool.query(
      "SELECT id FROM force_checkout_requests WHERE room_number = ? AND status = 'pending'",
      [roomNumber]
    );
    if (existingPending.rows.length > 0) {
      return res.status(409).json({ error: `A pending Force Check-Out request already exists for Room ${roomNumber}.` });
    }

    const id = `fcr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString();

    await withTransaction(async (conn) => {
      await conn.query(
        `INSERT INTO force_checkout_requests (
          id, room_number, room_type, guest_name, guest_id,
          check_in_time, rate_selected, uncollected_amount, billed_breakdown,
          reason, cashier_notes, requested_by, requested_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          id,
          room.number,
          room.room_type,
          room.guest_name || 'Anonymous Guest',
          room.guest_id || '',
          room.check_in_time || null,
          room.rate_selected || '24h',
          Number(uncollectedAmount || 0),
          JSON.stringify(billedBreakdown || []),
          reason,
          cashierNotes || '',
          operator?.username || 'cashier',
          nowIso,
        ]
      );

      // Log in audit logs
      await conn.query(
        `INSERT INTO audit_logs (id, timestamp, operator, action, details)
         VALUES (?, ?, ?, 'FORCE_CHECKOUT_REQUESTED', ?)`,
        [
          `log-fcr-${Date.now()}`,
          nowIso,
          operator?.username || 'cashier',
          `Requested Force Check-Out for Room ${room.number} (Guest: ${room.guest_name || 'Walk-In'}). Reason: ${reason}. Uncollected: ₱${Number(uncollectedAmount || 0).toLocaleString()}. Notes: ${cashierNotes || 'None'}`
        ]
      );
    });

    const createdResult = await pool.query('SELECT * FROM force_checkout_requests WHERE id = ?', [id]);
    const createdItem = rowToForceCheckoutRequest(createdResult.rows[0]);

    // Broadcast to WebSocket clients (especially Admins)
    socketManager.broadcast('force_checkout:requested', {
      request: createdItem,
      roomNumber: room.number,
    });

    res.status(201).json(createdItem);
  } catch (err: any) {
    console.error('POST /force-checkout error:', err);
    res.status(500).json({ error: err.message || 'Failed to submit force checkout request' });
  }
}));

// POST /api/force-checkout/:id/approve (Admin approves and executes force checkout)
router.post('/:id/approve', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { adminNotes, resolutionType = 'loss_write_off' } = req.body;
  const operator = (req as any).operator;

  // Enforce admin/owner authorization
  if (operator?.role !== 'admin' && operator?.role !== 'owner') {
    return res.status(403).json({ error: 'Only Admin or Owner accounts can approve Force Check-Out requests.' });
  }

  try {
    const reqResult = await pool.query('SELECT * FROM force_checkout_requests WHERE id = ?', [id]);
    if (reqResult.rows.length === 0) {
      return res.status(404).json({ error: 'Force checkout request not found.' });
    }
    const fcr = reqResult.rows[0];

    if (fcr.status !== 'pending') {
      return res.status(400).json({ error: `Request is already ${fcr.status}.` });
    }

    const nowIso = new Date().toISOString();
    const roomNumber = fcr.room_number;

    await withTransaction(async (conn) => {
      // 1. Mark request as approved
      await conn.query(
        `UPDATE force_checkout_requests
         SET status = 'approved',
             admin_notes = ?,
             resolved_by = ?,
             resolved_at = ?,
             resolution_type = ?
         WHERE id = ?`,
        [
          adminNotes || 'Approved by management.',
          operator.username,
          nowIso,
          resolutionType,
          id
        ]
      );

      // 2. Fetch room details
      const roomRowResult = await conn.query('SELECT * FROM rooms WHERE number = ?', [roomNumber]);
      const roomRow = roomRowResult.rows[0] || {};

      // 3. Create Audited Incident Loss Slip (with ₱0 cash collected to avoid skewing physical drawer)
      const receiptNo = `FCE-${Math.floor(100000 + Math.random() * 900000)}`;
      const stayDurationLabel = formatStayDuration(fcr.rate_selected || roomRow.rate_selected || '24h');
      
      let breakdownItems: any[] = [];
      if (fcr.billed_breakdown) {
        breakdownItems = typeof fcr.billed_breakdown === 'string' ? JSON.parse(fcr.billed_breakdown) : fcr.billed_breakdown;
      }
      if (breakdownItems.length === 0) {
        breakdownItems = [
          { description: `${roomRow.room_type || 'Room'} Force Check-Out`, subtext: `${stayDurationLabel} (${fcr.reason})`, amount: Number(fcr.uncollected_amount || 0) }
        ];
      }

      await conn.query(
        `INSERT INTO receipts (
          receipt_no, date_time, guest_name, room_number, room_type,
          payment_method, gcash_ref, cash_amount, gcash_amount,
          check_in, check_out, items, subtotal, service_charge, total, cashier_id,
          rate_selected, stay_duration
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          receiptNo,
          nowIso,
          fcr.guest_name || roomRow.guest_name || 'Anonymous Guest',
          roomNumber,
          roomRow.room_type || fcr.room_type || 'Standard Room',
          'CASH', // Non-cash override, recorded with 0 cash received
          `FORCE-OUT-${(fcr.reason || 'UNKNOWN').toUpperCase()}`,
          0.00, // ₱0 cash collected
          null,
          fcr.check_in_time || roomRow.check_in_time || nowIso,
          nowIso,
          JSON.stringify(breakdownItems),
          Number(fcr.uncollected_amount || 0),
          0.00,
          0.00, // ₱0 total paid (audited loss)
          operator.username,
          roomRow.rate_selected || fcr.rate_selected || '24h',
          stayDurationLabel,
        ]
      );

      // 4. Reset target Room to 'cleaning' state
      await conn.query(
        `UPDATE rooms
         SET state = 'cleaning',
             label = 'Housekeep',
             guest_name = '',
             guest_id = '',
             num_guests = 0,
             extra_beds = 0,
             towel_sets = 0,
             check_in_time = NULL,
             check_out_time = NULL,
             charged_food = '[]',
             is_overdue = 0
         WHERE number = ?`,
        [roomNumber]
      );

      // 5. Log audit trail
      await conn.query(
        `INSERT INTO audit_logs (id, timestamp, operator, action, details)
         VALUES (?, ?, ?, 'FORCE_CHECKOUT_APPROVED', ?)`,
        [
          `log-fcr-app-${Date.now()}`,
          nowIso,
          operator.username,
          `Admin ${operator.username} approved Force Check-Out for Room ${roomNumber} (Request #${id}). Resolution: ${resolutionType}. Uncollected written-off: ₱${Number(fcr.uncollected_amount || 0).toLocaleString()}. Notes: ${adminNotes || 'None'}`
        ]
      );
    });

    const updatedResult = await pool.query('SELECT * FROM force_checkout_requests WHERE id = ?', [id]);
    const updatedItem = rowToForceCheckoutRequest(updatedResult.rows[0]);

    // Broadcast room update and force checkout resolution to all clients
    socketManager.broadcast('force_checkout:resolved', {
      request: updatedItem,
      roomNumber,
      action: 'approved',
    });
    socketManager.broadcast('room:updated', {
      number: roomNumber,
      state: 'cleaning',
    });

    res.json(updatedItem);
  } catch (err: any) {
    console.error('POST /force-checkout/:id/approve error:', err);
    res.status(500).json({ error: err.message || 'Failed to approve force checkout request' });
  }
}));

// POST /api/force-checkout/:id/reject (Admin rejects request with explanation)
router.post('/:id/reject', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { adminNotes } = req.body;
  const operator = (req as any).operator;

  if (operator?.role !== 'admin' && operator?.role !== 'owner') {
    return res.status(403).json({ error: 'Only Admin or Owner accounts can reject Force Check-Out requests.' });
  }

  try {
    const reqResult = await pool.query('SELECT * FROM force_checkout_requests WHERE id = ?', [id]);
    if (reqResult.rows.length === 0) {
      return res.status(404).json({ error: 'Force checkout request not found.' });
    }
    const fcr = reqResult.rows[0];

    if (fcr.status !== 'pending') {
      return res.status(400).json({ error: `Request is already ${fcr.status}.` });
    }

    const nowIso = new Date().toISOString();

    await withTransaction(async (conn) => {
      await conn.query(
        `UPDATE force_checkout_requests
         SET status = 'rejected',
             admin_notes = ?,
             resolved_by = ?,
             resolved_at = ?
         WHERE id = ?`,
        [
          adminNotes || 'Rejected by management.',
          operator.username,
          nowIso,
          id
        ]
      );

      await conn.query(
        `INSERT INTO audit_logs (id, timestamp, operator, action, details)
         VALUES (?, ?, ?, 'FORCE_CHECKOUT_REJECTED', ?)`,
        [
          `log-fcr-rej-${Date.now()}`,
          nowIso,
          operator.username,
          `Admin ${operator.username} rejected Force Check-Out for Room ${fcr.room_number} (Request #${id}). Notes: ${adminNotes || 'None'}`
        ]
      );
    });

    const updatedResult = await pool.query('SELECT * FROM force_checkout_requests WHERE id = ?', [id]);
    const updatedItem = rowToForceCheckoutRequest(updatedResult.rows[0]);

    socketManager.broadcast('force_checkout:resolved', {
      request: updatedItem,
      roomNumber: fcr.room_number,
      action: 'rejected',
    });

    res.json(updatedItem);
  } catch (err: any) {
    console.error('POST /force-checkout/:id/reject error:', err);
    res.status(500).json({ error: err.message || 'Failed to reject force checkout request' });
  }
}));

// POST /api/force-checkout/direct-override (Admin directly force checkouts without prior request)
router.post('/direct-override', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { roomNumber, reason, adminNotes, uncollectedAmount, billedBreakdown, resolutionType = 'loss_write_off' } = req.body;
  const operator = (req as any).operator;

  if (operator?.role !== 'admin' && operator?.role !== 'owner') {
    return res.status(403).json({ error: 'Only Admin or Owner accounts can execute Direct Force Check-Out.' });
  }

  if (!roomNumber || !reason) {
    return res.status(400).json({ error: 'Room number and incident reason are required.' });
  }

  try {
    const roomResult = await pool.query('SELECT * FROM rooms WHERE number = ?', [roomNumber]);
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: `Room ${roomNumber} not found.` });
    }
    const room = roomResult.rows[0];

    const nowIso = new Date().toISOString();
    const id = `fcr-direct-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    await withTransaction(async (conn) => {
      // 1. Insert auto-approved request record for tracking
      await conn.query(
        `INSERT INTO force_checkout_requests (
          id, room_number, room_type, guest_name, guest_id,
          check_in_time, rate_selected, uncollected_amount, billed_breakdown,
          reason, cashier_notes, requested_by, requested_at,
          status, admin_notes, resolved_by, resolved_at, resolution_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)`,
        [
          id,
          room.number,
          room.room_type,
          room.guest_name || 'Anonymous Guest',
          room.guest_id || '',
          room.check_in_time || null,
          room.rate_selected || '24h',
          Number(uncollectedAmount || 0),
          JSON.stringify(billedBreakdown || []),
          reason,
          'Direct Admin Force Check-Out Override',
          operator.username,
          nowIso,
          adminNotes || 'Direct manager override.',
          operator.username,
          nowIso,
          resolutionType
        ]
      );

      // 2. Create Audited Incident Loss Slip
      const receiptNo = `FCE-${Math.floor(100000 + Math.random() * 900000)}`;
      const stayDurationLabel = formatStayDuration(room.rate_selected || '24h');

      await conn.query(
        `INSERT INTO receipts (
          receipt_no, date_time, guest_name, room_number, room_type,
          payment_method, gcash_ref, cash_amount, gcash_amount,
          check_in, check_out, items, subtotal, service_charge, total, cashier_id,
          rate_selected, stay_duration
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          receiptNo,
          nowIso,
          room.guest_name || 'Anonymous Guest',
          room.number,
          room.room_type || 'Standard Room',
          'CASH',
          `FORCE-DIRECT-${(reason || 'UNKNOWN').toUpperCase()}`,
          0.00,
          null,
          room.check_in_time || nowIso,
          nowIso,
          JSON.stringify(billedBreakdown || [{ description: `${room.room_type || 'Room'} Force Check-Out`, subtext: `${stayDurationLabel} (${reason})`, amount: Number(uncollectedAmount || 0) }]),
          Number(uncollectedAmount || 0),
          0.00,
          0.00,
          operator.username,
          room.rate_selected || '24h',
          stayDurationLabel,
        ]
      );

      // 3. Reset Room to 'cleaning'
      await conn.query(
        `UPDATE rooms
         SET state = 'cleaning',
             label = 'Housekeep',
             guest_name = '',
             guest_id = '',
             num_guests = 0,
             extra_beds = 0,
             towel_sets = 0,
             check_in_time = NULL,
             check_out_time = NULL,
             charged_food = '[]',
             is_overdue = 0
         WHERE number = ?`,
        [room.number]
      );

      // 4. Audit Log
      await conn.query(
        `INSERT INTO audit_logs (id, timestamp, operator, action, details)
         VALUES (?, ?, ?, 'DIRECT_FORCE_CHECKOUT', ?)`,
        [
          `log-fcr-dir-${Date.now()}`,
          nowIso,
          operator.username,
          `Direct Force Check-Out executed by ${operator.username} for Room ${room.number} (Guest: ${room.guest_name || 'Walk-In'}). Reason: ${reason}. Uncollected written-off: ₱${Number(uncollectedAmount || 0).toLocaleString()}. Notes: ${adminNotes || 'None'}`
        ]
      );
    });

    socketManager.broadcast('room:updated', {
      number: room.number,
      state: 'cleaning',
    });

    res.json({ success: true, message: `Room ${room.number} successfully force checked out.` });
  } catch (err: any) {
    console.error('POST /force-checkout/direct-override error:', err);
    res.status(500).json({ error: err.message || 'Failed to execute direct force checkout' });
  }
}));

export default router;
