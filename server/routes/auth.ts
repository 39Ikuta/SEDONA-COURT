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
import { signJwt, revokeJwt } from '../utils/jwt';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

const loginAttempts = new Map<string, { count: number; timestamp: number }>();

// POST /api/auth/login
router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { username, accessCode } = req.body as { username: string; accessCode: string };
  if (!username || !accessCode) {
    res.status(400).json({ error: 'username and accessCode are required' });
    return;
  }

  const now = Date.now();
  const ip = String(req.ip || req.socket?.remoteAddress || '').slice(0, 64);
  const attemptKey = `${username.toLowerCase()}|${ip}`;
  const attempt = loginAttempts.get(attemptKey) || loginAttempts.get(username) || { count: 0, timestamp: now };
  if (now - attempt.timestamp > 15 * 60 * 1000) {
    attempt.count = 0;
    attempt.timestamp = now;
  }
  if (attempt.count >= 5) {
    res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
    return;
  }

  try {
    const result = await pool.query(
      'SELECT id, username, name, role, access_code_hash FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    if (result.rows.length === 0) {
      attempt.count += 1;
      loginAttempts.set(attemptKey, attempt);
      res.status(401).json({ error: 'Invalid username or access code' });
      return;
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(accessCode, user.access_code_hash);
    if (!valid) {
      attempt.count += 1;
      loginAttempts.set(attemptKey, attempt);
      res.status(401).json({ error: 'Invalid username or access code' });
      return;
    }

    loginAttempts.delete(attemptKey);
    loginAttempts.delete(username);

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
router.post('/logout', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || req.headers.Authorization as string;
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      revokeJwt(match[1].trim());
    }
  }
  res.json({ success: true });
});

export default router;

