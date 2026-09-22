/**
 * server/routes/billable-services.ts
 * GET    /api/services        — list all active services (excludes soft-deleted)
 * POST   /api/services        — create a new service
 * PUT    /api/services/:id    — update a service
 * DELETE /api/services/:id    — soft-delete a service
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

function rowToService(row: any) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    price: parseFloat(row.price || 0),
    category: row.category,
    active: Boolean(row.active),
    description: row.description,
    rateType: row.rate_type,
    weekdayOverride: row.weekday_override ? parseFloat(row.weekday_override) : undefined,
    weekendOverride: row.weekend_override ? parseFloat(row.weekend_override) : undefined,
    seasonalOverride: row.seasonal_override ? parseFloat(row.seasonal_override) : undefined,
    seasonalStart: row.seasonal_start,
    seasonalEnd: row.seasonal_end,
    imageUrl: row.image_url,
    isDeleted: Boolean(row.is_deleted),
  };
}

function requireOwner(req: Request, res: Response, next: () => void) {
  const op = (req as any).operator;
  if (!op || op.role !== 'owner') {
    res.status(403).json({ error: 'Access denied: only the Owner account can add, edit, or delete services and rates' });
    return;
  }
  next();
}

// GET /api/services
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM billable_services ORDER BY type ASC, category ASC, name ASC`
    );
    res.json(result.rows.map(rowToService));
  } catch (err) {
    console.error('GET /services error:', err);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
}));

// POST /api/services
router.post('/', requireAuth, requireOwner, asyncHandler(async (req: Request, res: Response) => {
  const s = req.body;
  const id = s.id || `${s.type}-${Date.now()}`;
  try {
    await pool.query(
      `INSERT INTO billable_services (
        id, type, name, price, category, active, description,
        rate_type, weekday_override, weekend_override, seasonal_override,
        seasonal_start, seasonal_end, image_url, is_deleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, s.type, s.name, s.price, s.category,
        s.active !== undefined ? s.active : true,
        s.description || null, s.rateType || null,
        s.weekdayOverride || null, s.weekendOverride || null,
        s.seasonalOverride || null, s.seasonalStart || null,
        s.seasonalEnd || null, s.imageUrl || null, false,
      ]
    );

    const fetchResult = await pool.query('SELECT * FROM billable_services WHERE id = ?', [id]);
    res.status(201).json(rowToService(fetchResult.rows[0]));
  } catch (err) {
    console.error('POST /services error:', err);
    res.status(500).json({ error: 'Failed to create service' });
  }
}));

// PUT /api/services/:id
router.put('/:id', requireAuth, requireOwner, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const s = req.body;
  try {
    await pool.query(
      `UPDATE billable_services SET
        name = ?, price = ?, category = ?, active = ?, description = ?,
        rate_type = ?, weekday_override = ?, weekend_override = ?,
        seasonal_override = ?, seasonal_start = ?, seasonal_end = ?,
        image_url = ?, is_deleted = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        s.name, s.price, s.category, s.active, s.description || null,
        s.rateType || null, s.weekdayOverride || null, s.weekendOverride || null,
        s.seasonalOverride || null, s.seasonalStart || null, s.seasonalEnd || null,
        s.imageUrl || null, s.isDeleted || false, id,
      ]
    );

    const fetchResult = await pool.query('SELECT * FROM billable_services WHERE id = ?', [id]);
    if (fetchResult.rows.length === 0) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    res.json(rowToService(fetchResult.rows[0]));
  } catch (err) {
    console.error(`PUT /services/${id} error:`, err);
    res.status(500).json({ error: 'Failed to update service' });
  }
}));

// DELETE /api/services/:id — soft delete
router.delete('/:id', requireAuth, requireOwner, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE billable_services SET is_deleted = TRUE, updated_at = NOW() WHERE id = ?`,
      [id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(`DELETE /services/${id} error:`, err);
    res.status(500).json({ error: 'Failed to delete service' });
  }
}));

export default router;
