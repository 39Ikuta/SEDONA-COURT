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

function validateMoneyValue(v: any, field: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 999999) {
    throw Object.assign(new Error(`Invalid ${field}: must be a finite number 0..999999.`), { statusCode: 400 });
  }
  return n;
}

function validateServicePayload(s: any, isUpdate: boolean) {
  if (!isUpdate || s.name !== undefined) {
    if (!s.name || !String(s.name).trim()) throw Object.assign(new Error('Service name is required.'), { statusCode: 400 });
  }
  if (!isUpdate || s.type !== undefined) {
    if (!s.type || !String(s.type).trim()) throw Object.assign(new Error('Service type is required.'), { statusCode: 400 });
  }
  if (!isUpdate || s.category !== undefined) {
    if (!s.category || !String(s.category).trim()) throw Object.assign(new Error('Service category is required.'), { statusCode: 400 });
  }
  if (s.price !== undefined) validateMoneyValue(s.price, 'price');
  for (const f of ['weekdayOverride', 'weekendOverride', 'seasonalOverride'] as const) {
    if (s[f] !== undefined && s[f] !== null && s[f] !== '') validateMoneyValue(s[f], f);
  }
  if (s.rateType !== undefined && s.rateType !== null && s.rateType !== '') {
    const allowed = ['1h', '3h', '6h', '12h', '24h', 'promo', 'custom'];
    if (s.type === 'room_rate' && !allowed.includes(String(s.rateType))) {
      throw Object.assign(new Error(`Invalid rateType: ${s.rateType}.`), { statusCode: 400 });
    }
  }
  for (const f of ['seasonalStart', 'seasonalEnd'] as const) {
    if (s[f] !== undefined && s[f] !== null && s[f] !== '') {
      if (!/^\d{2}-\d{2}$/.test(String(s[f]))) {
        throw Object.assign(new Error(`Invalid ${f}: expected MM-DD.`), { statusCode: 400 });
      }
    }
  }
}

async function auditServiceChange(operator: any, action: string, details: string) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (operator, action, details, timestamp) VALUES (?, ?, ?, datetime('now','localtime'))`,
      [operator?.username || 'system', action, details]
    );
  } catch (e) {
    console.warn('[billable-services] audit log failed:', e);
  }
}

// GET /api/services
router.get('/', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const includeDeleted = String((req.query as any)?.includeDeleted || '') === 'true';
    const op = (req as any).operator;
    if (includeDeleted && op?.role !== 'owner' && op?.role !== 'admin') {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    const result = await pool.query(
      includeDeleted
        ? `SELECT * FROM billable_services ORDER BY type ASC, category ASC, name ASC`
        : `SELECT * FROM billable_services WHERE is_deleted = FALSE OR is_deleted = 0 ORDER BY type ASC, category ASC, name ASC`
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
    validateServicePayload(s, false);
    const price = validateMoneyValue(s.price, 'price') ?? 0;
    const weekdayOverride = validateMoneyValue(s.weekdayOverride, 'weekdayOverride');
    const weekendOverride = validateMoneyValue(s.weekendOverride, 'weekendOverride');
    const seasonalOverride = validateMoneyValue(s.seasonalOverride, 'seasonalOverride');
    await pool.query(
      `INSERT INTO billable_services (
        id, type, name, price, category, active, description,
        rate_type, weekday_override, weekend_override, seasonal_override,
        seasonal_start, seasonal_end, image_url, is_deleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, s.type, s.name, price, s.category,
        s.active !== undefined ? s.active : true,
        s.description || null, s.rateType || null,
        weekdayOverride, weekendOverride,
        seasonalOverride, s.seasonalStart || null,
        s.seasonalEnd || null, s.imageUrl || null, false,
      ]
    );

    const fetchResult = await pool.query('SELECT * FROM billable_services WHERE id = ?', [id]);
    await auditServiceChange((req as any).operator, 'SERVICE_CREATED', `${id} ${s.type}/${s.category} price=${price}`);
    res.status(201).json(rowToService(fetchResult.rows[0]));
  } catch (err: any) {
    if (err?.statusCode === 400) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error('POST /services error:', err);
    res.status(500).json({ error: 'Failed to create service' });
  }
}));

// PUT /api/services/:id
router.put('/:id', requireAuth, requireOwner, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const s = req.body;
  try {
    validateServicePayload(s, true);
    const existing = await pool.query('SELECT * FROM billable_services WHERE id = ?', [id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    const prev = existing.rows[0];
    const price = s.price !== undefined ? (validateMoneyValue(s.price, 'price') ?? 0) : Number(prev.price || 0);
    const weekdayOverride = s.weekdayOverride !== undefined ? validateMoneyValue(s.weekdayOverride, 'weekdayOverride') : prev.weekday_override;
    const weekendOverride = s.weekendOverride !== undefined ? validateMoneyValue(s.weekendOverride, 'weekendOverride') : prev.weekend_override;
    const seasonalOverride = s.seasonalOverride !== undefined ? validateMoneyValue(s.seasonalOverride, 'seasonalOverride') : prev.seasonal_override;
    // Preserve soft-delete unless explicit restore flag is sent
    const isDeleted = s.isDeleted !== undefined ? Boolean(s.isDeleted) : Boolean(s.restore === true ? false : prev.is_deleted);
    await pool.query(
      `UPDATE billable_services SET
        name = ?, price = ?, category = ?, active = ?, description = ?,
        rate_type = ?, weekday_override = ?, weekend_override = ?,
        seasonal_override = ?, seasonal_start = ?, seasonal_end = ?,
        image_url = ?, is_deleted = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        s.name ?? prev.name, price, s.category ?? prev.category, s.active ?? prev.active, s.description ?? prev.description,
        s.rateType ?? prev.rate_type, weekdayOverride, weekendOverride,
        seasonalOverride, s.seasonalStart ?? prev.seasonal_start, s.seasonalEnd ?? prev.seasonal_end,
        s.imageUrl ?? prev.image_url, isDeleted, id,
      ]
    );

    const fetchResult = await pool.query('SELECT * FROM billable_services WHERE id = ?', [id]);
    await auditServiceChange((req as any).operator, 'SERVICE_UPDATED', `${id} price ${prev.price}->${price}`);
    res.json(rowToService(fetchResult.rows[0]));
  } catch (err: any) {
    if (err?.statusCode === 400) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(`PUT /services/${id} error:`, err);
    res.status(500).json({ error: 'Failed to update service' });
  }
}));

// DELETE /api/services/:id — soft delete
router.delete('/:id', requireAuth, requireOwner, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const existing = await pool.query('SELECT * FROM billable_services WHERE id = ?', [id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    await pool.query(
      `UPDATE billable_services SET is_deleted = TRUE, updated_at = NOW() WHERE id = ?`,
      [id]
    );
    await auditServiceChange((req as any).operator, 'SERVICE_DELETED', `${id} soft-deleted`);
    res.json({ success: true });
  } catch (err) {
    console.error(`DELETE /services/${id} error:`, err);
    res.status(500).json({ error: 'Failed to delete service' });
  }
}));

export default router;
