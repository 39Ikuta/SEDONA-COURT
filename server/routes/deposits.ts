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
import { requireDepositStaff } from '../middleware/auth';
import { socketManager } from '../websocket/socket-manager';
import { asyncHandler } from '../utils/async-handler';

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
             state = 'occupied', 
             is_overdue = 0, 
             updated_at = datetime('now', 'localtime') 
           WHERE number = ?`,
          [newCheckoutIso, roomNumber]
        );

        updatedRoom = {
          number: roomNumber,
          checkOutTime: newCheckoutIso,
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

export default router;
