/**
 * server/routes/deposits.ts
 * Append-only monetary ledger API for guest deposits and credit balances.
 * 
 * Strict Financial Integrity Rules:
 * 1. Integer centavos only (no floats).
 * 2. Append-only ledger; running balance is dynamically computed, never a mutable field.
 * 3. Every deposit mutation is atomic and idempotent.
 * 4. Sufficient balance check occurs inside the transaction immediately prior to debiting.
 * 5. Role-gated: cashier, admin, owner only. customer_display gets 403.
 * 6. Operator identity is derived strictly from server-authenticated session, never request body.
 * 7. Every deposit event writes to the system audit log.
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { pool, withTransaction } from '../db/pool';
import { requireDepositStaff, requireCashierStaff } from '../middleware/auth';
import { socketManager } from '../websocket/socket-manager';
import { asyncHandler } from '../utils/async-handler';
import { sequenceService } from '../services/sequence-service';
import {
  buildDepositSlipEscPosBuffer,
  buildDepositRefundSlipEscPosBuffer,
  DepositSlipPrintOptions,
  DepositRefundSlipPrintOptions,
} from '../utils/escpos';

const router = Router();

export interface DepositTransactionRecord {
  id: string;
  guestIdentifier: string;
  guestName: string | null;
  amountCentavos: number;
  amount: number;
  direction: 'IN' | 'OUT';
  paymentMethod: 'CASH' | 'GCASH' | 'MIXED' | 'BALANCE_APPLIED';
  cashAmountCentavos: number;
  gcashAmountCentavos: number;
  referenceId: string | null;
  idempotencyKey: string;
  bookingId: string | null;
  roomNumber: string | null;
  receiptNo: string | null;
  notes: string | null;
  operator: string;
  createdAt: string;
}

export function rowToDeposit(row: any): DepositTransactionRecord {
  const amountCentavos = Number(row.amount_centavos);
  return {
    id: row.id,
    guestIdentifier: row.guest_identifier,
    guestName: row.guest_name || null,
    amountCentavos,
    amount: amountCentavos / 100,
    direction: row.direction,
    paymentMethod: row.payment_method,
    cashAmountCentavos: Number(row.cash_amount_centavos || 0),
    gcashAmountCentavos: Number(row.gcash_amount_centavos || 0),
    referenceId: row.reference_id || null,
    idempotencyKey: row.idempotency_key,
    bookingId: row.booking_id || null,
    roomNumber: row.room_number ? String(row.room_number) : null,
    receiptNo: row.receipt_no || null,
    notes: row.notes || null,
    operator: row.operator,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

async function getGuestBalance(conn: any, guestIdentifier: string): Promise<{
  balanceCentavos: number;
  totalInCentavos: number;
  totalOutCentavos: number;
}> {
  const sumRes = await conn.query(
    `SELECT 
       COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_centavos ELSE -amount_centavos END), 0) AS balance_centavos,
       COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_centavos ELSE 0 END), 0) AS total_in_centavos,
       COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount_centavos ELSE 0 END), 0) AS total_out_centavos
     FROM deposit_transactions 
     WHERE LOWER(guest_identifier) = LOWER(?)`,
    [guestIdentifier]
  );
  const row = sumRes.rows[0] || {};
  return {
    balanceCentavos: Number(row.balance_centavos || 0),
    totalInCentavos: Number(row.total_in_centavos || 0),
    totalOutCentavos: Number(row.total_out_centavos || 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/deposits — List all deposit transactions across guests (Staff only)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', requireDepositStaff, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { guestIdentifier, direction, limit } = req.query;
    let sql = 'SELECT * FROM deposit_transactions WHERE 1=1';
    const params: any[] = [];

    if (guestIdentifier) {
      params.push(String(guestIdentifier).trim());
      sql += ' AND LOWER(guest_identifier) = LOWER(?)';
    }

    if (direction && (direction === 'IN' || direction === 'OUT')) {
      params.push(direction);
      sql += ' AND direction = ?';
    }

    sql += ' ORDER BY datetime(created_at) DESC, id DESC';

    const maxLimit = Math.min(Math.max(1, parseInt(String(limit || '100'), 10)), 500);
    params.push(maxLimit);
    sql += ' LIMIT ?';

    const result = await pool.query(sql, params);
    res.json(result.rows.map(rowToDeposit));
  } catch (err: any) {
    console.error('GET /api/deposits error:', err);
    res.status(500).json({ error: 'Failed to fetch deposit transactions' });
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/deposits/:guestIdentifier — Get computed balance and transaction history
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:guestIdentifier', requireDepositStaff, asyncHandler(async (req: Request, res: Response) => {
  const guestIdentifier = req.params.guestIdentifier?.trim();
  if (!guestIdentifier) {
    res.status(400).json({ error: 'guestIdentifier is required' });
    return;
  }

  try {
    const { balanceCentavos, totalInCentavos, totalOutCentavos } = await getGuestBalance(pool, guestIdentifier);
    const txResult = await pool.query(
      `SELECT * FROM deposit_transactions 
       WHERE LOWER(guest_identifier) = LOWER(?) 
       ORDER BY datetime(created_at) DESC, id DESC LIMIT 100`,
      [guestIdentifier]
    );

    res.json({
      guestIdentifier,
      balanceCentavos,
      balance: balanceCentavos / 100,
      totalInCentavos,
      totalOutCentavos,
      totalIn: totalInCentavos / 100,
      totalOut: totalOutCentavos / 100,
      transactions: txResult.rows.map(rowToDeposit),
    });
  } catch (err: any) {
    console.error(`GET /api/deposits/${guestIdentifier} error:`, err);
    res.status(500).json({ error: 'Failed to fetch guest deposit balance' });
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/deposits — Record a new deposit-in (Staff-entered only)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', requireDepositStaff, asyncHandler(async (req: Request, res: Response) => {
  const body = req.body || {};
  const operator = (req as any).operator?.username;
  const idempotencyKey = (req.headers['x-idempotency-key'] as string)?.trim() || body.idempotencyKey?.trim();

  // 1. Mandatory validations
  if (!operator) {
    res.status(401).json({ error: 'Unauthorized: missing authenticated operator' });
    return;
  }

  if (!idempotencyKey) {
    res.status(400).json({ error: 'idempotencyKey is required (in header X-Idempotency-Key or body idempotencyKey)' });
    return;
  }

  const guestIdentifier = String(body.guestIdentifier || '').trim();
  if (!guestIdentifier) {
    res.status(400).json({ error: 'guestIdentifier is required' });
    return;
  }

  // Determine amountCentavos (reject float numbers, accept integer centavos)
  let amountCentavos = body.amountCentavos;
  if (amountCentavos === undefined && typeof body.amount === 'number') {
    // If amount in pesos was passed, ensure it safely maps to integer centavos
    const converted = Math.round(body.amount * 100);
    if (!Number.isInteger(converted) || converted <= 0) {
      res.status(400).json({ error: 'amount must be a positive number' });
      return;
    }
    amountCentavos = converted;
  }

  if (typeof amountCentavos !== 'number' || !Number.isInteger(amountCentavos) || amountCentavos <= 0) {
    res.status(400).json({ error: 'amountCentavos must be a strictly positive integer' });
    return;
  }

  const paymentMethod = String(body.paymentMethod || '').toUpperCase();
  if (!['CASH', 'GCASH', 'MIXED'].includes(paymentMethod)) {
    res.status(400).json({ error: "paymentMethod must be 'CASH', 'GCASH', or 'MIXED'" });
    return;
  }

  let cashAmountCentavos = 0;
  let gcashAmountCentavos = 0;
  const referenceId = body.reference ? String(body.reference).trim() : (body.referenceId ? String(body.referenceId).trim() : null);

  if (paymentMethod === 'CASH') {
    cashAmountCentavos = amountCentavos;
    gcashAmountCentavos = 0;
  } else if (paymentMethod === 'GCASH') {
    if (!referenceId) {
      res.status(400).json({ error: 'GCash transaction reference is required for GCash deposits' });
      return;
    }
    cashAmountCentavos = 0;
    gcashAmountCentavos = amountCentavos;
  } else if (paymentMethod === 'MIXED') {
    cashAmountCentavos = Number(body.cashAmountCentavos);
    gcashAmountCentavos = Number(body.gcashAmountCentavos);

    // Fallback if cashAmount/gcashAmount in pesos were provided
    if (isNaN(cashAmountCentavos) && typeof body.cashAmount === 'number') {
      cashAmountCentavos = Math.round(body.cashAmount * 100);
    }
    if (isNaN(gcashAmountCentavos) && typeof body.gcashAmount === 'number') {
      gcashAmountCentavos = Math.round(body.gcashAmount * 100);
    }

    if (!Number.isInteger(cashAmountCentavos) || cashAmountCentavos < 0 ||
        !Number.isInteger(gcashAmountCentavos) || gcashAmountCentavos < 0) {
      res.status(400).json({ error: 'MIXED payment requires non-negative integer cashAmountCentavos and gcashAmountCentavos' });
      return;
    }

    if (cashAmountCentavos + gcashAmountCentavos !== amountCentavos) {
      res.status(400).json({
        error: `MIXED amounts do not sum to total. Cash (${cashAmountCentavos}) + GCash (${gcashAmountCentavos}) != Total (${amountCentavos}) centavos`,
      });
      return;
    }

    if (gcashAmountCentavos > 0 && !referenceId) {
      res.status(400).json({ error: 'GCash transaction reference is required when GCash portion is greater than zero' });
      return;
    }
  }

  const guestName = body.guestName ? String(body.guestName).trim() : null;
  const notes = body.notes ? String(body.notes).trim() : null;

  try {
    const result = await withTransaction(async (conn) => {
      // 1. Idempotency Check INSIDE transaction
      const existing = await conn.query(
        'SELECT * FROM deposit_transactions WHERE idempotency_key = ?',
        [idempotencyKey]
      );
      if (existing.rows.length > 0) {
        const existingTx = rowToDeposit(existing.rows[0]);
        const { balanceCentavos } = await getGuestBalance(conn, guestIdentifier);
        return {
          alreadyExists: true,
          transaction: existingTx,
          balanceCentavos,
          balance: balanceCentavos / 100,
        };
      }

      // 2. Insert into deposit_transactions
      const txId = `dep-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      await conn.query(
        `INSERT INTO deposit_transactions (
          id, guest_identifier, guest_name, amount_centavos, direction,
          payment_method, cash_amount_centavos, gcash_amount_centavos,
          reference_id, idempotency_key, booking_id, room_number, receipt_no,
          notes, operator, created_at
        ) VALUES (?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, datetime('now', 'localtime'))`,
        [
          txId,
          guestIdentifier,
          guestName,
          amountCentavos,
          paymentMethod,
          cashAmountCentavos,
          gcashAmountCentavos,
          referenceId,
          idempotencyKey,
          notes,
          operator,
        ]
      );

      // 3. Insert real audit log entry (server-derived operator)
      const auditLogId = `log-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
      const formattedAmount = (amountCentavos / 100).toFixed(2);
      const splitDetails = paymentMethod === 'MIXED'
        ? ` (Cash: ₱${(cashAmountCentavos / 100).toFixed(2)}, GCash: ₱${(gcashAmountCentavos / 100).toFixed(2)})`
        : '';
      const refDetails = referenceId ? ` [Ref: ${referenceId}]` : '';

      await conn.query(
        `INSERT INTO audit_logs (id, timestamp, operator, action, details)
         VALUES (?, datetime('now', 'localtime'), ?, 'RECORD_DEPOSIT', ?)`,
        [
          auditLogId,
          operator,
          `Recorded ₱${formattedAmount} deposit (${paymentMethod}${splitDetails}${refDetails}) for guest ${guestIdentifier}${guestName ? ` (${guestName})` : ''}`,
        ]
      );

      // 4. Compute updated balance
      const { balanceCentavos } = await getGuestBalance(conn, guestIdentifier);
      const createdRow = await conn.query('SELECT * FROM deposit_transactions WHERE id = ?', [txId]);

      return {
        alreadyExists: false,
        transaction: rowToDeposit(createdRow.rows[0]),
        balanceCentavos,
        balance: balanceCentavos / 100,
      };
    });

    // Broadcast deposit event via WebSocket
    socketManager.broadcast('deposit:recorded', {
      guestIdentifier,
      amountCentavos,
      balanceCentavos: result.balanceCentavos,
      operator,
      timestamp: new Date().toISOString(),
    });

    res.status(result.alreadyExists ? 200 : 201).json(result);
  } catch (err: any) {
    console.error('POST /api/deposits error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to record deposit' });
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/deposits/apply — Apply deposit balance toward room extension, booking, or receipt
// ─────────────────────────────────────────────────────────────────────────────
router.post('/apply', requireDepositStaff, asyncHandler(async (req: Request, res: Response) => {
  const body = req.body || {};
  const operator = (req as any).operator?.username;
  const idempotencyKey = (req.headers['x-idempotency-key'] as string)?.trim() || body.idempotencyKey?.trim();

  // 1. Mandatory validations
  if (!operator) {
    res.status(401).json({ error: 'Unauthorized: missing authenticated operator' });
    return;
  }

  if (!idempotencyKey) {
    res.status(400).json({ error: 'idempotencyKey is required' });
    return;
  }

  const guestIdentifier = String(body.guestIdentifier || '').trim();
  if (!guestIdentifier) {
    res.status(400).json({ error: 'guestIdentifier is required' });
    return;
  }

  // Parse amountCentavos
  let amountCentavos = body.amountCentavos;
  if (amountCentavos === undefined && typeof body.amount === 'number') {
    const converted = Math.round(body.amount * 100);
    if (!Number.isInteger(converted) || converted <= 0) {
      res.status(400).json({ error: 'amount must be a positive number' });
      return;
    }
    amountCentavos = converted;
  }

  if (typeof amountCentavos !== 'number' || !Number.isInteger(amountCentavos) || amountCentavos <= 0) {
    res.status(400).json({ error: 'amountCentavos must be a strictly positive integer' });
    return;
  }

  const applyType = body.applyType;
  if (!['room_extension', 'booking', 'receipt'].includes(applyType)) {
    res.status(400).json({ error: "applyType must be 'room_extension', 'booking', or 'receipt'" });
    return;
  }

  const roomNumber = body.roomNumber ? String(body.roomNumber).trim() : null;
  const bookingId = body.bookingId ? String(body.bookingId).trim() : null;
  const receiptNo = body.receiptNo ? String(body.receiptNo).trim() : null;
  const notes = body.notes ? String(body.notes).trim() : null;

  if (applyType === 'room_extension' && !roomNumber) {
    res.status(400).json({ error: "roomNumber is required when applyType is 'room_extension'" });
    return;
  }

  if (applyType === 'booking' && !bookingId) {
    res.status(400).json({ error: "bookingId is required when applyType is 'booking'" });
    return;
  }

  try {
    const result = await withTransaction(async (conn) => {
      // 1. Idempotency Check INSIDE transaction (prevents TOCTOU)
      const existing = await conn.query(
        'SELECT * FROM deposit_transactions WHERE idempotency_key = ?',
        [idempotencyKey]
      );
      if (existing.rows.length > 0) {
        const existingTx = rowToDeposit(existing.rows[0]);
        const { balanceCentavos } = await getGuestBalance(conn, guestIdentifier);
        return {
          alreadyExists: true,
          transaction: existingTx,
          balanceCentavos,
          balance: balanceCentavos / 100,
        };
      }

      // 2. Strict Balance Sufficiency Check INSIDE transaction immediately before deducting
      const { balanceCentavos } = await getGuestBalance(conn, guestIdentifier);
      if (balanceCentavos < amountCentavos) {
        throw Object.assign(
          new Error(`Insufficient deposit balance. Available: ₱${(balanceCentavos / 100).toFixed(2)}, requested deduction: ₱${(amountCentavos / 100).toFixed(2)}`),
          { statusCode: 400 }
        );
      }

      let updatedRoom: any = null;

      // 3. Atomically execute the target operation in the same transaction
      if (applyType === 'room_extension' && roomNumber) {
        const roomRes = await conn.query('SELECT * FROM rooms WHERE number = ?', [roomNumber]);
        if (roomRes.rows.length === 0) {
          throw Object.assign(new Error(`Room ${roomNumber} not found`), { statusCode: 404 });
        }
        const room = roomRes.rows[0];
        if (room.state !== 'occupied' && room.state !== 'overdue') {
          throw Object.assign(
            new Error(`Room ${roomNumber} is currently '${room.state}'. Only occupied or overdue rooms can be extended.`),
            { statusCode: 400 }
          );
        }

        const extensionHours = parseInt(String(body.extensionHours || '1'), 10);
        if (isNaN(extensionHours) || extensionHours <= 0) {
          throw Object.assign(
            new Error(`extensionHours must be a positive integer, received: ${body.extensionHours}`),
            { statusCode: 400 }
          );
        }
        const msToAdd = extensionHours * 3600 * 1000;

        // Base new checkout time off current check_out_time, or now if past/missing
        const currentCheckout = room.check_out_time ? new Date(room.check_out_time) : new Date();
        const baseTime = (!isNaN(currentCheckout.getTime()) && currentCheckout.getTime() > Date.now())
          ? currentCheckout.getTime()
          : Date.now();

        const newCheckoutDate = new Date(baseTime + msToAdd);
        const newCheckoutIso = newCheckoutDate.toISOString();

        await conn.query(
          `UPDATE rooms SET 
             check_out_time = ?, 
             expected_checkout_at = ?,
             alarm_state = 'NORMAL',
             acknowledged_at = NULL,
             acknowledged_by = NULL,
             state = 'occupied', 
             is_overdue = 0, 
             updated_at = NOW() 
           WHERE number = ?`,
          [newCheckoutIso, newCheckoutIso, roomNumber]
        );

        updatedRoom = {
          number: roomNumber,
          checkOutTime: newCheckoutIso,
          expectedCheckoutAt: newCheckoutIso,
          alarmState: 'NORMAL',
          acknowledgedAt: null,
          acknowledgedBy: null,
          state: 'occupied',
          isOverdue: false,
        };
      } else if (applyType === 'booking' && bookingId) {
        const bRes = await conn.query('SELECT * FROM scheduled_bookings WHERE id = ?', [bookingId]);
        if (bRes.rows.length === 0) {
          throw Object.assign(new Error(`Booking ${bookingId} not found`), { statusCode: 404 });
        }
      }

      // 4. Append 'OUT' row to deposit_transactions ledger
      const txId = `dep-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      await conn.query(
        `INSERT INTO deposit_transactions (
          id, guest_identifier, guest_name, amount_centavos, direction,
          payment_method, cash_amount_centavos, gcash_amount_centavos,
          reference_id, idempotency_key, booking_id, room_number, receipt_no,
          notes, operator, created_at
        ) VALUES (?, ?, ?, ?, 'OUT', 'BALANCE_APPLIED', 0, 0, NULL, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
        [
          txId,
          guestIdentifier,
          body.guestName || null,
          amountCentavos,
          idempotencyKey,
          bookingId,
          roomNumber,
          receiptNo,
          notes || `Applied to ${applyType}${roomNumber ? ` (Room ${roomNumber})` : ''}`,
          operator,
        ]
      );

      // 5. Append audit log entry (server-derived operator)
      const auditLogId = `log-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
      const formattedAmount = (amountCentavos / 100).toFixed(2);
      await conn.query(
        `INSERT INTO audit_logs (id, timestamp, operator, action, details)
         VALUES (?, datetime('now', 'localtime'), ?, 'APPLY_DEPOSIT', ?)`,
        [
          auditLogId,
          operator,
          `Applied ₱${formattedAmount} deposit for guest ${guestIdentifier} toward ${applyType}${roomNumber ? ` (Room ${roomNumber})` : ''}${bookingId ? ` [Booking ${bookingId}]` : ''}`,
        ]
      );

      // 6. Compute new remaining balance
      const remaining = await getGuestBalance(conn, guestIdentifier);
      const createdRow = await conn.query('SELECT * FROM deposit_transactions WHERE id = ?', [txId]);

      return {
        alreadyExists: false,
        transaction: rowToDeposit(createdRow.rows[0]),
        balanceCentavos: remaining.balanceCentavos,
        balance: remaining.balanceCentavos / 100,
        updatedRoom,
      };
    });

    // Real-time WebSocket notifications
    if (result.updatedRoom) {
      socketManager.broadcastRoomUpdate({
        roomNumber: result.updatedRoom.number,
        state: 'occupied',
        checkOutTime: result.updatedRoom.checkOutTime,
        expectedCheckoutAt: result.updatedRoom.expectedCheckoutAt,
        alarmState: result.updatedRoom.alarmState,
        timestamp: new Date().toISOString(),
      });
      socketManager.broadcastAlarmStateChanged({
        roomNumber: result.updatedRoom.number,
        previousState: 'OVERDUE',
        newState: 'NORMAL',
        expectedCheckoutAt: result.updatedRoom.expectedCheckoutAt,
        acknowledgedAt: null,
        acknowledgedBy: null,
        timestamp: new Date().toISOString(),
      });
    }

    socketManager.broadcast('deposit:applied', {
      guestIdentifier,
      amountCentavos,
      balanceCentavos: result.balanceCentavos,
      applyType,
      operator,
      timestamp: new Date().toISOString(),
    });

    res.status(result.alreadyExists ? 200 : 201).json(result);
  } catch (err: any) {
    console.error('POST /api/deposits/apply error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to apply deposit' });
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// ROOM SECURITY DEPOSITS (Official Sequential DEP-XXXXXX Slips & Resolutions)
// ─────────────────────────────────────────────────────────────────────────────

export function rowToSecurityDeposit(row: any) {
  let depositSnapshot = null;
  let resolutionSnapshot = null;
  try {
    if (row.deposit_snapshot) {
      depositSnapshot = typeof row.deposit_snapshot === 'string' ? JSON.parse(row.deposit_snapshot) : row.deposit_snapshot;
    }
  } catch (e) {
    depositSnapshot = null;
  }
  try {
    if (row.resolution_snapshot) {
      resolutionSnapshot = typeof row.resolution_snapshot === 'string' ? JSON.parse(row.resolution_snapshot) : row.resolution_snapshot;
    }
  } catch (e) {
    resolutionSnapshot = null;
  }

  return {
    id: row.id,
    bookingId: row.booking_id || null,
    roomId: String(row.room_id || ''),
    amountCents: Number(row.amount_cents || 0),
    amount: Number(row.amount_cents || 0) / 100,
    status: row.status as 'held' | 'refunded' | 'applied' | 'forfeited',
    collectedBy: row.collected_by,
    collectedAt: row.collected_at instanceof Date ? row.collected_at.toISOString() : String(row.collected_at),
    resolvedBy: row.resolved_by || null,
    resolvedAt: row.resolved_at instanceof Date ? row.resolved_at.toISOString() : (row.resolved_at ? String(row.resolved_at) : null),
    depositNumber: row.deposit_number,
    notes: row.notes || null,
    refundAmountCents: Number(row.refund_amount_cents || 0),
    refundAmount: Number(row.refund_amount_cents || 0) / 100,
    appliedAmountCents: Number(row.applied_amount_cents || 0),
    appliedAmount: Number(row.applied_amount_cents || 0) / 100,
    linkedReceiptNo: row.linked_receipt_no || null,
    depositSnapshot,
    resolutionSnapshot,
    reprintCount: Number(row.reprint_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/deposits/active/:roomNumber — Get active held deposit for a room
router.get('/active/:roomNumber', requireDepositStaff, asyncHandler(async (req: Request, res: Response) => {
  const { roomNumber } = req.params;
  const result = await pool.query(
    `SELECT * FROM deposits WHERE room_id = ? AND status = 'held' ORDER BY id DESC LIMIT 1`,
    [String(roomNumber)]
  );

  if (result.rows.length === 0) {
    return res.json({ hasHeldDeposit: false, deposit: null });
  }

  const deposit = rowToSecurityDeposit(result.rows[0]);
  return res.json({ hasHeldDeposit: true, deposit });
}));

// GET /api/deposits/room/:roomNumber — List all deposits for a room
router.get('/room/:roomNumber', requireDepositStaff, asyncHandler(async (req: Request, res: Response) => {
  const { roomNumber } = req.params;
  const result = await pool.query(
    `SELECT * FROM deposits WHERE room_id = ? ORDER BY id DESC`,
    [String(roomNumber)]
  );
  return res.json(result.rows.map(rowToSecurityDeposit));
}));

// POST /api/deposits/security — Collect a new security deposit for a room
router.post('/security', requireDepositStaff, asyncHandler(async (req: Request, res: Response) => {
  const body = req.body || {};
  const operator = (req as any).operator?.username || 'Frontdesk';
  const idempotencyKey = String(req.headers['x-idempotency-key'] || body.idempotencyKey || '').trim();
  const {
    roomNumber,
    bookingId,
    amountCents: rawAmountCents,
    amount: rawAmount,
    paymentMethod = 'CASH',
    notes = '',
    guestName = 'Valued Guest',
  } = body;

  const roomNumStr = String(roomNumber || '').trim();
  if (!roomNumStr) {
    return res.status(400).json({ error: 'roomNumber is required' });
  }

  let amountCents = rawAmountCents;
  if (amountCents === undefined && typeof rawAmount === 'number') {
    amountCents = Math.round(rawAmount * 100);
  }

  if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) {
    return res.status(400).json({ error: 'amountCents must be a strictly positive integer' });
  }

  const result = await withTransaction(async (conn) => {
    // Idempotency: return existing slip if key already seen (double-click safe)
    if (idempotencyKey) {
      const prior = await conn.query('SELECT * FROM deposits WHERE id = ? LIMIT 1', [`sec-${idempotencyKey}`]);
      if (prior.rows.length > 0) {
        const existing = rowToSecurityDeposit(prior.rows[0]);
        return { deposit: existing, escposBufferBase64: '', alreadyExists: true as const };
      }
    }
    // Check if room exists and is occupied
    const roomRes = await conn.query('SELECT * FROM rooms WHERE number = ?', [roomNumStr]);
    if (roomRes.rows.length === 0) {
      throw Object.assign(new Error(`Room ${roomNumStr} not found`), { statusCode: 404 });
    }
    const room = roomRes.rows[0];
    const finalGuestName = (guestName && guestName !== 'Valued Guest') ? guestName : (room.guest_name || 'Valued Guest');

    // Allocate sequential deposit number DEP-{CASHIER}-{SHIFT}-{MMDDYY}-{SEQ}
    const { depositNumber } = await sequenceService.allocateNextSequentialDepositNumber(conn, operator);

    const depositId = idempotencyKey ? `sec-${idempotencyKey}` : `dep-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const nowIso = new Date().toISOString();

    const snapshot = {
      depositNumber,
      dateTime: nowIso,
      roomNumber: roomNumStr,
      guestName: finalGuestName,
      cashierId: operator,
      amount: amountCents / 100,
      amountCents,
      paymentMethod,
      notes,
    };

    await conn.query(
      `INSERT INTO deposits (
        id, booking_id, room_id, amount_cents, status,
        collected_by, collected_at, deposit_number, notes,
        deposit_snapshot, reprint_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'held', ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        depositId,
        bookingId || null,
        roomNumStr,
        amountCents,
        operator,
        nowIso,
        depositNumber,
        notes || null,
        JSON.stringify(snapshot),
        nowIso,
        nowIso,
      ]
    );

    // Audit log
    const auditLogId = `log-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    await conn.query(
      `INSERT INTO audit_logs (id, timestamp, operator, action, details)
       VALUES (?, datetime('now', 'localtime'), ?, 'DEPOSIT_COLLECTED', ?)`,
      [
        auditLogId,
        operator,
        `Collected ₱${(amountCents / 100).toFixed(2)} deposit (${depositNumber}) for Room ${roomNumStr} (${finalGuestName}) [Method: ${paymentMethod}]`,
      ]
    );

    const createdRes = await conn.query('SELECT * FROM deposits WHERE id = ?', [depositId]);
    const createdDeposit = rowToSecurityDeposit(createdRes.rows[0]);

    // Build thermal ESC/POS buffer
    const escposBuffer = buildDepositSlipEscPosBuffer({
      depositNumber,
      dateTime: nowIso,
      roomNumber: roomNumStr,
      guestName: finalGuestName,
      cashierId: operator,
      amount: amountCents / 100,
      paymentMethod,
      notes,
    });

    return {
      deposit: createdDeposit,
      escposBufferBase64: escposBuffer.toString('base64'),
    };
  });

  socketManager.broadcast('deposit:created', {
    depositNumber: result.deposit.depositNumber,
    roomNumber: roomNumStr,
    amountCents: result.deposit.amountCents,
    status: 'held',
    collectedBy: operator,
    timestamp: new Date().toISOString(),
  });

  return res.status((result as any).alreadyExists ? 200 : 201).json(result);
}));

// POST /api/deposits/:depositNumber/resolve — Resolve deposit (refund, apply, forfeit)
router.post('/:depositNumber/resolve', requireDepositStaff, asyncHandler(async (req: Request, res: Response) => {
  const { depositNumber } = req.params;
  const operator = (req as any).operator?.username || 'Frontdesk';
  const role = (req as any).operator?.role || 'cashier';
  const { action, notes = '', linkedReceiptNo } = req.body;

  if (!['refund', 'apply', 'forfeit'].includes(action)) {
    return res.status(400).json({ error: "action must be 'refund', 'apply', or 'forfeit'" });
  }

  if (action === 'forfeit' && !['admin', 'owner'].includes(role)) {
    return res.status(403).json({ error: 'Only admin or owner can forfeit a deposit' });
  }

  const result = await withTransaction(async (conn) => {
    const depRes = await conn.query('SELECT * FROM deposits WHERE deposit_number = ?', [depositNumber]);
    if (depRes.rows.length === 0) {
      throw Object.assign(new Error(`Deposit ${depositNumber} not found`), { statusCode: 404 });
    }
    const deposit = depRes.rows[0];

    if (deposit.status !== 'held') {
      throw Object.assign(new Error(`Deposit ${depositNumber} is already ${deposit.status}`), { statusCode: 400 });
    }

    const nowIso = new Date().toISOString();
    const amountCents = Number(deposit.amount_cents || 0);
    const targetStatus = action === 'refund' ? 'refunded' : action === 'apply' ? 'applied' : 'forfeited';
    const refundAmountCents = action === 'refund' ? amountCents : 0;
    const appliedAmountCents = action === 'apply' ? amountCents : 0;

    let snapshotData: any = {};
    try {
      if (deposit.deposit_snapshot) {
        snapshotData = typeof deposit.deposit_snapshot === 'string' ? JSON.parse(deposit.deposit_snapshot) : deposit.deposit_snapshot;
      }
    } catch (e) {
      snapshotData = {};
    }

    const resolutionSnapshot = {
      depositNumber,
      dateTime: nowIso,
      roomNumber: deposit.room_id,
      guestName: snapshotData.guestName || 'Valued Guest',
      cashierId: operator,
      originalAmount: amountCents / 100,
      refundAmount: refundAmountCents / 100,
      appliedAmount: appliedAmountCents / 100,
      status: targetStatus,
      linkedReceiptNo: linkedReceiptNo || null,
      notes,
    };

    await conn.query(
      `UPDATE deposits SET
         status = ?,
         resolved_by = ?,
         resolved_at = ?,
         refund_amount_cents = ?,
         applied_amount_cents = ?,
         linked_receipt_no = ?,
         resolution_snapshot = ?,
         updated_at = ?
       WHERE deposit_number = ?`,
      [
        targetStatus,
        operator,
        nowIso,
        refundAmountCents,
        appliedAmountCents,
        linkedReceiptNo || null,
        JSON.stringify(resolutionSnapshot),
        nowIso,
        depositNumber,
      ]
    );

    // Audit log
    const auditLogId = `log-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    await conn.query(
      `INSERT INTO audit_logs (id, timestamp, operator, action, details)
       VALUES (?, datetime('now', 'localtime'), ?, 'DEPOSIT_RESOLVED', ?)`,
      [
        auditLogId,
        operator,
        `Deposit ${depositNumber} (₱${(amountCents / 100).toFixed(2)}) marked as ${targetStatus.toUpperCase()} by ${operator}${notes ? `. Notes: ${notes}` : ''}`,
      ]
    );

    const updatedRes = await conn.query('SELECT * FROM deposits WHERE deposit_number = ?', [depositNumber]);
    const updatedDeposit = rowToSecurityDeposit(updatedRes.rows[0]);

    // Build thermal ESC/POS buffer for refund/settlement slip
    const escposBuffer = buildDepositRefundSlipEscPosBuffer({
      depositNumber,
      dateTime: nowIso,
      roomNumber: deposit.room_id,
      guestName: snapshotData.guestName || 'Valued Guest',
      cashierId: operator,
      originalAmount: amountCents / 100,
      refundAmount: refundAmountCents / 100,
      appliedAmount: appliedAmountCents / 100,
      status: targetStatus,
      linkedReceiptNo,
      notes,
    });

    return {
      deposit: updatedDeposit,
      escposBufferBase64: escposBuffer.toString('base64'),
    };
  });

  socketManager.broadcast('deposit:resolved', {
    depositNumber,
    status: result.deposit.status,
    resolvedBy: operator,
    timestamp: new Date().toISOString(),
  });

  return res.json(result);
}));

// POST /api/deposits/:depositNumber/reprint — Reprint slip
router.post('/:depositNumber/reprint', requireCashierStaff, asyncHandler(async (req: Request, res: Response) => {
  const { depositNumber } = req.params;
  const operator = (req as any).operator?.username || 'Frontdesk';

  const depRes = await pool.query('SELECT * FROM deposits WHERE deposit_number = ?', [depositNumber]);
  if (depRes.rows.length === 0) {
    return res.status(404).json({ error: `Deposit ${depositNumber} not found` });
  }

  const deposit = depRes.rows[0];
  const newReprintCount = Number(deposit.reprint_count || 0) + 1;

  await pool.query(
    'UPDATE deposits SET reprint_count = ?, updated_at = NOW() WHERE deposit_number = ?',
    [newReprintCount, depositNumber]
  );

  let snapshotData: any = {};
  try {
    if (deposit.deposit_snapshot) {
      snapshotData = typeof deposit.deposit_snapshot === 'string' ? JSON.parse(deposit.deposit_snapshot) : deposit.deposit_snapshot;
    }
  } catch (e) {
    snapshotData = {};
  }

  let escposBuffer: Buffer;
  if (deposit.status === 'held') {
    escposBuffer = buildDepositSlipEscPosBuffer({
      depositNumber,
      dateTime: deposit.collected_at,
      roomNumber: deposit.room_id,
      guestName: snapshotData.guestName || 'Valued Guest',
      cashierId: deposit.collected_by,
      amount: Number(deposit.amount_cents || 0) / 100,
      paymentMethod: snapshotData.paymentMethod || 'CASH',
      notes: deposit.notes || undefined,
      reprintCount: newReprintCount,
    });
  } else {
    escposBuffer = buildDepositRefundSlipEscPosBuffer({
      depositNumber,
      dateTime: deposit.resolved_at || new Date().toISOString(),
      roomNumber: deposit.room_id,
      guestName: snapshotData.guestName || 'Valued Guest',
      cashierId: deposit.resolved_by || operator,
      originalAmount: Number(deposit.amount_cents || 0) / 100,
      refundAmount: Number(deposit.refund_amount_cents || 0) / 100,
      appliedAmount: Number(deposit.applied_amount_cents || 0) / 100,
      status: deposit.status,
      linkedReceiptNo: deposit.linked_receipt_no || undefined,
      notes: deposit.notes || undefined,
      reprintCount: newReprintCount,
    });
  }

  const auditLogId = `log-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  await pool.query(
    `INSERT INTO audit_logs (id, timestamp, operator, action, details)
     VALUES (?, datetime('now', 'localtime'), ?, 'DEPOSIT_REPRINT', ?)`,
    [auditLogId, operator, `Reprinted slip for deposit ${depositNumber} (Reprint #${newReprintCount})`]
  );

  const updatedRes = await pool.query('SELECT * FROM deposits WHERE deposit_number = ?', [depositNumber]);
  return res.json({
    deposit: rowToSecurityDeposit(updatedRes.rows[0]),
    escposBufferBase64: escposBuffer.toString('base64'),
    reprintCount: newReprintCount,
  });
}));

export default router;
