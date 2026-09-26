/**
 * server/routes/shift-settlement.ts
 * End-of-shift cashier cash reconciliation and operating expenses ledger.
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
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
router.get('/summary', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { date, shift } = req.query;
  const targetDateStr = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  const targetShift = shift === 'DAY' || shift === 'NIGHT' ? (shift as 'DAY' | 'NIGHT') : undefined;

  const window = getShiftTimeWindow(new Date(), targetShift, targetDateStr);

  // 1. Query receipts in this shift window (excluding force-checkout write-off slips)
  const receiptsRes = await pool.query(`
    SELECT 
      COALESCE(SUM(total), 0) AS total_income,
      COALESCE(SUM(CASE 
        WHEN payment_method = 'GCASH' THEN total 
        WHEN payment_method = 'MIXED' THEN COALESCE(gcash_amount, 0)
        ELSE 0 
      END), 0) AS total_gcash,
      COALESCE(SUM(CASE 
        WHEN payment_method = 'CASH' THEN total 
        WHEN payment_method = 'MIXED' THEN COALESCE(cash_amount, 0)
        ELSE 0 
      END), 0) AS total_cash_received,
      COUNT(receipt_no) AS receipt_count
    FROM receipts
    WHERE date_time >= ? AND date_time < ?
      AND (receipt_no NOT LIKE 'FCE-%')
      AND total > 0
  `, [window.startTime, window.endTime]);

  const totalIncome = Number(receiptsRes.rows[0]?.total_income || 0);
  const totalGcash = Number(receiptsRes.rows[0]?.total_gcash || 0);
  const totalCashReceived = Number(receiptsRes.rows[0]?.total_cash_received || 0);
  const receiptCount = Number(receiptsRes.rows[0]?.receipt_count || 0);

  // 2. Query expenses recorded for this shift
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
  const expectedCashOnHand = Math.max(0, totalCashReceived - totalExpenses);

  res.json({
    shiftDate: window.dateStr,
    shiftType: window.shiftType,
    startTime: window.startTime,
    endTime: window.endTime,
    totalIncome,
    totalGcash,
    totalCashReceived,
    totalExpenses,
    expectedCashOnHand,
    receiptCount,
    expenses,
  });
}));

// POST /api/shift-settlement/expenses
router.post('/expenses', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { description, amount, shiftDate, shiftType } = req.body;
  const operator = (req as any).operator?.username || 'cashier';

  if (!description || typeof description !== 'string' || !description.trim()) {
    res.status(400).json({ error: 'Description is required.' });
    return;
  }

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    res.status(400).json({ error: 'Valid positive expense amount is required.' });
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

export default router;
