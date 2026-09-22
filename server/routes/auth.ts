/**
 * server/routes/auth.ts
 * POST /api/auth/login   — verify access code, issue signed JWT session token
 * GET  /api/auth/me      — return verified operator info from valid token
 * POST /api/auth/refresh — issue a refreshed token for active session
 * POST /api/auth/logout  — stateless; client drops session token
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool';
import { signJwt } from '../utils/jwt';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

// POST /api/auth/login
router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { username, accessCode } = req.body as { username: string; accessCode: string };
  if (!username || !accessCode) {
    res.status(400).json({ error: 'username and accessCode are required' });
    return;
  }
  try {
    const result = await pool.query(
      'SELECT id, username, name, role, access_code_hash FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid username or access code' });
      return;
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(accessCode, user.access_code_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid username or access code' });
      return;
    }

    const token = signJwt({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
    });

    res.json({
      token,
      username: user.username,
      name: user.name,
      role: user.role,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
}));


// GET /api/auth/me — returns current verified operator
router.get('/me', requireAuth, (req: Request, res: Response) => {
  const operator = (req as any).operator;
  res.json(operator);
});

// POST /api/auth/refresh — re-issues a fresh token for active session
router.post('/refresh', requireAuth, (req: Request, res: Response) => {
  const operator = (req as any).operator;
  const token = signJwt({
    id: operator.id,
    username: operator.username,
    name: operator.name,
    role: operator.role,
  });
  res.json({
    token,
    username: operator.username,
    name: operator.name,
    role: operator.role,
  });
});

// POST /api/auth/logout — stateless; client clears its own operator state
router.post('/logout', (_req: Request, res: Response) => {
  res.json({ success: true });
});

export default router;

