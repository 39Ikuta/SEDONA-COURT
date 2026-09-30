/**
 * server/routes/shift-settlement.ts
 * End-of-shift cashier cash reconciliation and operating expenses ledger.
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireCashierStaff } from '../middleware/auth';
import { asyncHandler } from '../utils/async-handler';
import { format, parseISO, addDays } from 'date-fns';
import crypto from 'crypto';

const router = Router();

export interface ShiftTimeWindow {
  dateStr: string;
  shiftType: 'DAY' | 'NIGHT';
  startTime: string; // YYYY-MM-DD HH:mm:ss
  endTime: string;   // YYYY-MM-DD HH:mm:ss
}

function getShiftTimeWindow(dateObj: Date = new Date(), overrideShift?: 'DAY' | 'NIGHT', overrideDate?: string): ShiftTimeWindow {
  let dateStr = overrideDate || format(dateObj, 'yyyy-MM-dd');
  const hour = dateObj.getHours();
  
  let shiftType: 'DAY' | 'NIGHT';
  if (overrideShift) {
    shiftType = overrideShift;
  } else {
    shiftType = hour >= 6 && hour < 18 ? 'DAY' : 'NIGHT';
  }

  let startTime: string;
  let endTime: string;

  if (shiftType === 'DAY') {
    startTime = `${dateStr}T06:00:00.000Z`;
    endTime = `${dateStr}T18:00:00.000Z`;
  } else {
    // Night shift spans from 18:00 today to 06:00 tomorrow (or if currently between 00:00 and 06:00, started yesterday 18:00)
    if (!overrideShift && hour < 6) {
      const yesterdayStr = format(addDays(dateObj, -1), 'yyyy-MM-dd');
      dateStr = yesterdayStr;
      startTime = `${yesterdayStr}T18:00:00.000Z`;
      endTime = `${format(dateObj, 'yyyy-MM-dd')}T06:00:00.000Z`;
    } else {
      const tomorrow = format(addDays(parseISO(dateStr), 1), 'yyyy-MM-dd');
      startTime = `${dateStr}T18:00:00.000Z`;
      endTime = `${tomorrow}T06:00:00.000Z`;
    }
  }

  return { dateStr, shiftType, startTime, endTime };
}

// GET /api/shift-settlement/summary
router.get('/summary', requireCashierStaff, asyncHandler(async (req: Request, res: Response) => {
  const { date, shift } = req.query;
  const targetDateStr = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  const targetShift = shift === 'DAY' || shift === 'NIGHT' ? (shift as 'DAY' | 'NIGHT') : undefined;

  const window = getShiftTimeWindow(new Date(), targetShift, targetDateStr);

  // 1. Query receipts in this shift window (excluding force-checkout write-off slips and void receipts)
  const receiptsRes = await pool.query(`
    SELECT 
      COALESCE(SUM(total), 0) AS total_income,
      COALESCE(SUM(CASE 
        WHEN payment_method = 'GCASH' THEN total 
        WHEN payment_method = 'MIXED' THEN COALESCE(gcash_amount, 0)
        ELSE 0 
      END), 0) AS total_gcash,
      COALESCE(SUM(CASE 
        WHEN payment_method = 'CASH' THEN 
          CASE WHEN amount_tendered_cents IS NOT NULL THEN amount_tendered_cents / 100.0 ELSE total END
        WHEN payment_method = 'MIXED' THEN 
          CASE WHEN amount_tendered_cents IS NOT NULL THEN amount_tendered_cents / 100.0 ELSE COALESCE(cash_amount, 0) END
        ELSE 0 
      END), 0) AS total_cash_tendered,
      COALESCE(SUM(CASE 
        WHEN payment_method IN ('CASH', 'MIXED') THEN COALESCE(change_cents, 0) / 100.0
        ELSE 0 
      END), 0) AS total_change_given,
      COALESCE(SUM(CASE 
        WHEN payment_method = 'CASH' THEN 
          CASE WHEN amount_tendered_cents IS NOT NULL AND change_cents IS NOT NULL 
            THEN (amount_tendered_cents - change_cents) / 100.0 
            ELSE total 
          END
        WHEN payment_method = 'MIXED' THEN 
          CASE WHEN amount_tendered_cents IS NOT NULL AND change_cents IS NOT NULL 
            THEN (amount_tendered_cents - change_cents) / 100.0 
            ELSE COALESCE(cash_amount, 0) 
          END
        ELSE 0 
      END), 0) AS total_cash_received,
      COUNT(receipt_no) AS receipt_count
    FROM receipts
    WHERE date_time >= ? AND date_time < ?
      AND (receipt_no NOT LIKE 'FCE-%')
      AND (status IS NULL OR status = 'valid')
      AND total > 0
  `, [window.startTime, window.endTime]);

  const totalIncome = Number(receiptsRes.rows[0]?.total_income || 0);
  const totalGcash = Number(receiptsRes.rows[0]?.total_gcash || 0);
  const totalCashTendered = Number(receiptsRes.rows[0]?.total_cash_tendered || 0);
  const totalChangeGiven = Number(receiptsRes.rows[0]?.total_change_given || 0);
  const totalCashReceived = Number(receiptsRes.rows[0]?.total_cash_received || 0);
  const receiptCount = Number(receiptsRes.rows[0]?.receipt_count || 0);

  // 2. Query cash deposits collected and refunded in this shift window
  const depositsRes = await pool.query(`
    SELECT 
      id, amount_cents, status, collected_at, resolved_at, refund_amount_cents, deposit_snapshot, resolution_snapshot
    FROM deposits
    WHERE (collected_at >= ? AND collected_at < ?)
       OR (resolved_at >= ? AND resolved_at < ?)
  `, [window.startTime, window.endTime, window.startTime, window.endTime]);

  let totalDepositsHeldCash = 0;
  let totalDepositsRefundedCash = 0;

  for (const dep of depositsRes.rows) {
    let isCash = true;
    if (dep.deposit_snapshot) {
      try {
        const snap = typeof dep.deposit_snapshot === 'string' ? JSON.parse(dep.deposit_snapshot) : dep.deposit_snapshot;
        if (snap && snap.paymentMethod && snap.paymentMethod !== 'CASH') {
          isCash = false;
        }
      } catch {}
    }

    if (isCash) {
      // Collected in this shift window
      if (dep.collected_at && dep.collected_at >= window.startTime && dep.collected_at < window.endTime) {
        totalDepositsHeldCash += Number(dep.amount_cents || 0) / 100.0;
      }
      // Refunded in this shift window
      if (dep.resolved_at && dep.resolved_at >= window.startTime && dep.resolved_at < window.endTime) {
        if (dep.status === 'refunded' || Number(dep.refund_amount_cents || 0) > 0) {
          const refundCents = Number(dep.refund_amount_cents || dep.amount_cents || 0);
          totalDepositsRefundedCash += refundCents / 100.0;
        }
      }
    }
  }

  // 3. Query expenses recorded for this shift
  const expensesRes = await pool.query(`
    SELECT id, shift_date, shift_type, cashier_id, description, amount, created_at, updated_at
    FROM shift_expenses
    WHERE shift_date = ? AND shift_type = ?
    ORDER BY created_at ASC
  `, [window.dateStr, window.shiftType]);

  const expenses = expensesRes.rows.map(e => ({
    id: e.id,
    shiftDate: e.shift_date,
    shiftType: e.shift_type,
    cashierId: e.cashier_id,
    description: e.description,
    amount: Number(e.amount || 0),
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  }));

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const expectedCashOnHand = totalCashReceived + totalDepositsHeldCash - totalDepositsRefundedCash - totalExpenses;
  const shortage = expectedCashOnHand < 0 ? Math.abs(expectedCashOnHand) : 0;
  const floatRes = await pool.query('SELECT opening_float, closing_float FROM shift_floats WHERE shift_date = ? AND shift_type = ?', [window.dateStr, window.shiftType]).catch(() => ({ rows: [] as any[] }));
  const openingFloat = floatRes.rows.length > 0 ? Number(floatRes.rows[0].opening_float || 500000) / 100 : 5000;
  const expectedWithFloat = openingFloat + expectedCashOnHand;

  res.json({
    shiftDate: window.dateStr,
    shiftType: window.shiftType,
    startTime: window.startTime,
    endTime: window.endTime,
    totalIncome,
    totalGcash,
    totalCashTendered,
    totalChangeGiven,
    totalCashReceived,
    totalDepositsHeldCash,
    totalDepositsRefundedCash,
    depositsHeld: totalDepositsHeldCash,
    depositsRefunded: totalDepositsRefundedCash,
    totalExpenses,
    expectedCashOnHand,
    shortage,
    openingFloat,
    expectedWithFloat,
    receiptCount,
    expenses,
  });
}));

// POST /api/shift-settlement/expenses
router.post('/expenses', requireCashierStaff, asyncHandler(async (req: Request, res: Response) => {
  const { description, amount, shiftDate, shiftType } = req.body;
  const operator = (req as any).operator?.username || 'cashier';

  if (!description || typeof description !== 'string' || !description.trim() || description.trim().length > 200) {
    res.status(400).json({ error: 'Description is required (max 200 chars).' });
    return;
  }

  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0 || numAmount > 500000) {
    res.status(400).json({ error: 'Valid positive expense amount is required (0..500000).' });
    return;
  }

  const window = getShiftTimeWindow(new Date(), shiftType, shiftDate);
  const expenseId = `exp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  await pool.query(`
    INSERT INTO shift_expenses (id, shift_date, shift_type, cashier_id, description, amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    expenseId,
    window.dateStr,
    window.shiftType,
    operator,
    description.trim(),
    numAmount,
    now,
    now
  ]);

  await pool.query(
    `INSERT INTO audit_logs (id, timestamp, operator, action, details)
     VALUES (?, datetime('now', 'localtime'), ?, 'EXPENSE_CREATED', ?)`,
    [
      `audit-exp-add-${Date.now()}`,
      operator,
      `Added shift expense: ${description.trim()} (Amount: ${numAmount}, Shift: ${window.dateStr} ${window.shiftType})`
    ]
  ).catch(err => console.warn('Audit write failed:', err));

  res.status(201).json({
    id: expenseId,
    shiftDate: window.dateStr,
    shiftType: window.shiftType,
    cashierId: operator,
    description: description.trim(),
    amount: numAmount,
    createdAt: now,
  });
}));

// DELETE /api/shift-settlement/expenses/:id
router.delete('/expenses/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const operator = (req as any).operator;

  const result = await pool.query('SELECT * FROM shift_expenses WHERE id = ?', [id]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Expense not found' });
    return;
  }
  const expense = result.rows[0];

  if (operator.role !== 'owner' && operator.role !== 'admin' && expense.cashier_id !== operator.username) {
    res.status(403).json({ error: 'You can only delete your own expenses' });
    return;
  }

  await pool.query('DELETE FROM shift_expenses WHERE id = ?', [id]);
  
  // Audit log
  const auditId = `audit-exp-del-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  await pool.query(
    `INSERT INTO audit_logs (id, timestamp, operator, action, details)
     VALUES (?, datetime('now', 'localtime'), ?, 'EXPENSE_DELETED', ?)`,
    [
      auditId,
      operator.username,
      `Deleted shift expense: ${expense.description} (Amount: ${expense.amount})`
    ]
  ).catch(err => console.warn('Audit write failed:', err));

  res.json({ success: true, deleted: id });
}));

// GET+POST /api/shift-settlement/float — opening float per shift (replaces hardcoded 5000)
router.get('/float', requireCashierStaff, asyncHandler(async (req: Request, res: Response) => {
  const { date, shift } = req.query;
  const targetDateStr = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  const targetShift = shift === 'DAY' || shift === 'NIGHT' ? (shift as 'DAY' | 'NIGHT') : undefined;
  const window = getShiftTimeWindow(new Date(), targetShift, targetDateStr);
  const r = await pool.query('SELECT * FROM shift_floats WHERE shift_date = ? AND shift_type = ?', [window.dateStr, window.shiftType]).catch(() => ({ rows: [] as any[] }));
  res.json(r.rows[0] ? { shiftDate: r.rows[0].shift_date, shiftType: r.rows[0].shift_type, openingFloat: Number(r.rows[0].opening_float || 500000) / 100 } : { shiftDate: window.dateStr, shiftType: window.shiftType, openingFloat: 5000 });
}));

router.post('/float', requireCashierStaff, asyncHandler(async (req: Request, res: Response) => {
  const { shiftDate, shiftType, openingFloat } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(shiftDate || '')) || (shiftType !== 'DAY' && shiftType !== 'NIGHT')) {
    res.status(400).json({ error: 'shiftDate YYYY-MM-DD and shiftType DAY|NIGHT required.' });
    return;
  }
  const cents = Math.round(Number(openingFloat) * 100);
  if (!Number.isFinite(cents) || cents < 0 || cents > 100000000) {
    res.status(400).json({ error: 'openingFloat must be 0..1000000.' });
    return;
  }
  await pool.query(
    `INSERT INTO shift_floats (shift_date, shift_type, opening_float, counted_by, updated_at)
     VALUES (?, ?, ?, ?, datetime('now','localtime'))
     ON DUPLICATE KEY UPDATE opening_float = VALUES(opening_float), counted_by = VALUES(counted_by), updated_at = datetime('now','localtime')`,
    [shiftDate, shiftType, cents, (req as any).operator?.username || 'cashier']
  );
  res.json({ shiftDate, shiftType, openingFloat: cents / 100 });
}));

export default router;
