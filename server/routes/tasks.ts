/**
 * server/routes/tasks.ts
 * GET    /api/tasks         — list all handoff tasks
 * POST   /api/tasks         — create a new task
 * PUT    /api/tasks/:id     — update task (toggle complete, priority, text)
 * DELETE /api/tasks/:id     — delete a task
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

function rowToTask(row: any) {
  return {
    id: row.id,
    text: row.text,
    completed: Boolean(row.completed),
    priority: row.priority || 'medium',
    assignedTo: row.assigned_to,
  };
}

// GET /api/tasks
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM handoff_tasks ORDER BY created_at ASC');
    res.json(result.rows.map(rowToTask));
  } catch (err) {
    console.error('GET /tasks error:', err);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
}));

// POST /api/tasks
router.post('/', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const t = req.body;
  const id = t.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
  try {
    await pool.query(
      `INSERT INTO handoff_tasks (id, text, completed, priority, assigned_to)
       VALUES (?, ?, ?, ?, ?)`,
      [id, t.text, t.completed || false, t.priority || 'medium', t.assignedTo || null]
    );

    const fetchResult = await pool.query('SELECT * FROM handoff_tasks WHERE id = ?', [id]);
    res.status(201).json(rowToTask(fetchResult.rows[0]));
  } catch (err) {
    console.error('POST /tasks error:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
}));

// PUT /api/tasks/:id
router.put('/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const t = req.body;
  try {
    await pool.query(
      `UPDATE handoff_tasks SET
        text = COALESCE(?, text),
        completed = COALESCE(?, completed),
        priority = COALESCE(?, priority),
        assigned_to = ?,
        updated_at = NOW()
       WHERE id = ?`,
      [t.text !== undefined ? t.text : null, t.completed !== undefined ? t.completed : null, t.priority !== undefined ? t.priority : null, t.assignedTo || null, id]
    );

    const fetchResult = await pool.query('SELECT * FROM handoff_tasks WHERE id = ?', [id]);
    if (fetchResult.rows.length === 0) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(rowToTask(fetchResult.rows[0]));
  } catch (err) {
    console.error(`PUT /tasks/${id} error:`, err);
    res.status(500).json({ error: 'Failed to update task' });
  }
}));

// DELETE /api/tasks/:id
router.delete('/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM handoff_tasks WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(`DELETE /tasks/${id} error:`, err);
    res.status(500).json({ error: 'Failed to delete task' });
  }
}));

export default router;
