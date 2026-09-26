/**
 * server/routes/audit-logs.ts
 * GET  /api/audit-logs  — list all audit log entries (newest first)
 * POST /api/audit-logs  — append a new log entry
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

function rowToLog(row: any) {
  return {
    id: row.id,
    timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp),
    operator: row.operator,
    action: row.action,
    details: row.details,
  };
}

// GET /api/audit-logs
router.get('/', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 500'
    );
    res.json(result.rows.map(rowToLog));
  } catch (err) {
    console.error('GET /audit-logs error:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
}));

// POST /api/audit-logs
router.post('/', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const log = req.body;
  const id = log.id || `log-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const timestamp = log.timestamp || new Date().toISOString();
  // Server-derived operator identity — prevent client spoofing
  const operator = (req as any).operator?.username || (req as any).operator?.name || 'System';

  try {
    await pool.query(
      `INSERT OR IGNORE INTO audit_logs (id, timestamp, operator, action, details)
       VALUES (?, ?, ?, ?, ?)`,
      [id, timestamp, operator, log.action, log.details]
    );
    const row = { id, timestamp, operator, action: log.action, details: log.details };
    res.status(201).json(rowToLog(row));
  } catch (err) {
    console.error('POST /audit-logs error:', err);
    res.status(500).json({ error: 'Failed to create audit log' });
  }
}));

export default router;
