
/**
 * server/routes/pos-revenue.ts
 * GET  /api/pos-revenue          — get today's (or all-time) POS revenue
 * POST /api/pos-revenue/add      — add revenue to today's record
 * POST /api/pos-revenue/reset    — reset today's revenue to 0 (admin only)
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

function rowToRevenue(row: any) {
  return {
    id: row.id,
    date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : String(row.date).split('T')[0],
    kitchen: parseFloat(row.kitchen || 0),
    drinks: parseFloat(row.drinks || 0),
    miscell: parseFloat(row.miscell || 0),
    total: parseFloat(row.kitchen || 0) + parseFloat(row.drinks || 0) + parseFloat(row.miscell || 0),
  };
}

// GET /api/pos-revenue — returns today's row (or 0s if not created yet)
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await pool.query(
      `SELECT * FROM pos_revenue WHERE date = ?`,
      [today]
    );
    if (result.rows.length === 0) {
      res.json({ date: today, kitchen: 0, drinks: 0, miscell: 0, total: 0 });
      return;
    }
    res.json(rowToRevenue(result.rows[0]));
  } catch (err) {
    console.error('GET /pos-revenue error:', err);
    res.status(500).json({ error: 'Failed to fetch POS revenue' });
  }
}));

// POST /api/pos-revenue/add — upsert and add to today's revenue
router.post('/add', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { amount, category } = req.body as { amount: number; category: 'kitchen' | 'drinks' | 'miscell' };
  if (!amount || !category) {
    res.status(400).json({ error: 'amount and category are required' });
    return;
  }
  const today = new Date().toISOString().split('T')[0];
  try {
    const kAdd = category === 'kitchen' ? amount : 0;
    const dAdd = category === 'drinks' ? amount : 0;
    const mAdd = category === 'miscell' ? amount : 0;

    await pool.query(
      `INSERT INTO pos_revenue (date, kitchen, drinks, miscell)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         kitchen = kitchen + VALUES(kitchen),
         drinks  = drinks  + VALUES(drinks),
         miscell = miscell + VALUES(miscell),
         updated_at = NOW()`,
      [today, kAdd, dAdd, mAdd]
    );

    const fetchResult = await pool.query(`SELECT * FROM pos_revenue WHERE date = ?`, [today]);
    res.json(rowToRevenue(fetchResult.rows[0]));
  } catch (err) {
    console.error('POST /pos-revenue/add error:', err);
    res.status(500).json({ error: 'Failed to add POS revenue' });
  }
}));

// POST /api/pos-revenue/reset — reset today's to 0 (admin/owner)
router.post('/reset', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const operator = (req as any).operator;
  if (operator.role !== 'admin' && operator.role !== 'owner') {
    res.status(403).json({ error: 'Only admin or owner can reset POS revenue' });
    return;
  }
  const today = new Date().toISOString().split('T')[0];
  try {
    await pool.query(
      `INSERT INTO pos_revenue (date, kitchen, drinks, miscell)
       VALUES (?, 0, 0, 0)
       ON DUPLICATE KEY UPDATE kitchen = 0, drinks = 0, miscell = 0, updated_at = NOW()`,
      [today]
    );
    res.json({ date: today, kitchen: 0, drinks: 0, miscell: 0, total: 0 });
  } catch (err) {
    console.error('POST /pos-revenue/reset error:', err);
    res.status(500).json({ error: 'Failed to reset POS revenue' });
  }
}));

export default router;
