/**
 * server/routes/users.ts
 * User Account Management endpoints.
 * 
 * RBAC:
 * - GET /api/users: accessible by 'owner' and 'admin' (lists all accounts without password hashes).
 * - POST /api/users: strictly restricted to 'owner' (creates account with bcrypt hashed password).
 * - DELETE /api/users/:identifier: strictly restricted to 'owner' (deletes account; prevents self-deletion).
 * - PUT /api/users/:identifier/password: strictly restricted to 'owner' (resets staff password/access code).
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool';
import { requireAuth, requireOwner } from '../middleware/auth';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

const VALID_ROLES = ['kitchen', 'cashier', 'admin', 'owner', 'customer_display'] as const;

/**
 * GET /api/users
 * Lists all registered user accounts with sanitized properties.
 * Role check: Owner and Admin only.
 */
router.get('/', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const operator = (req as any).operator;
  if (operator.role !== 'owner' && operator.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: Only administrators and owners can view user accounts' });
    return;
  }

  try {
    const result = await pool.query(
      'SELECT id, username, name, role, created_at FROM users ORDER BY id ASC'
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error('Failed to list users:', err);
    res.status(500).json({ error: 'Failed to retrieve user accounts' });
  }
}));

/**
 * POST /api/users
 * Creates a new user account.
 * Role check: Owner only.
 */
router.post('/', requireOwner, asyncHandler(async (req: Request, res: Response) => {
  const operator = (req as any).operator;
  const { username, name, role, accessCode } = req.body || {};

  if (!username || typeof username !== 'string' || !username.trim()) {
    res.status(400).json({ error: 'Username is required' });
    return;
  }

  const cleanUsername = username.trim().toLowerCase();
  if (cleanUsername.length < 2 || cleanUsername.length > 32) {
    res.status(400).json({ error: 'Username must be between 2 and 32 characters' });
    return;
  }

  if (!/^[a-z0-9_.-]+$/.test(cleanUsername)) {
    res.status(400).json({ error: 'Username can only contain alphanumeric characters, hyphens, and underscores' });
    return;
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Staff full name is required' });
    return;
  }
  const cleanName = name.trim();

  if (!role || !VALID_ROLES.includes(role)) {
    res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
    return;
  }

  if (!accessCode || typeof accessCode !== 'string' || accessCode.trim().length < 4) {
    res.status(400).json({ error: 'Password / access code must be at least 4 characters long' });
    return;
  }
  const cleanCode = accessCode.trim();

  try {
    // Check for duplicate username
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
      [cleanUsername]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: `Username "${cleanUsername}" is already taken` });
      return;
    }

    // Hash password
    const hash = await bcrypt.hash(cleanCode, 10);

    // Insert user
    await pool.query(
      `INSERT INTO users (username, name, role, access_code_hash)
       VALUES ($1, $2, $3, $4)`,
      [cleanUsername, cleanName, role, hash]
    );

    // Retrieve inserted record
    const createdRes = await pool.query(
      'SELECT id, username, name, role, created_at FROM users WHERE LOWER(username) = LOWER($1)',
      [cleanUsername]
    );
    const createdUser = createdRes.rows[0];

    // Audit log
    const auditId = `audit-usr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    await pool.query(
      `INSERT INTO audit_logs (id, timestamp, operator, action, details)
       VALUES (?, datetime('now', 'localtime'), ?, 'USER_CREATED', ?)`,
      [
        auditId,
        operator.username,
        `Owner created account "${cleanUsername}" (Name: ${cleanName}, Role: ${role})`,
      ]
    ).catch((auditErr) => console.warn('Audit log write error:', auditErr));

    res.status(201).json({
      success: true,
      message: `User account "${cleanUsername}" created successfully`,
      user: createdUser,
    });
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ error: 'Failed to create user account' });
  }
}));

/**
 * DELETE /api/users/:identifier
 * Deletes a user account by numeric ID or username.
 * Role check: Owner only.
 */
router.delete('/:identifier', requireOwner, asyncHandler(async (req: Request, res: Response) => {
  const operator = (req as any).operator;
  const { identifier } = req.params;

  if (!identifier) {
    res.status(400).json({ error: 'User identifier is required' });
    return;
  }

  try {
    // Find target user
    const findRes = await pool.query(
      'SELECT id, username, name, role FROM users WHERE id = $1 OR LOWER(username) = LOWER($1)',
      [identifier]
    );

    if (findRes.rows.length === 0) {
      res.status(404).json({ error: 'User account not found' });
      return;
    }

    const targetUser = findRes.rows[0];

    // Prevent owner from deleting own active account
    if (targetUser.username.toLowerCase() === operator.username.toLowerCase()) {
      res.status(400).json({ error: 'You cannot delete your own active owner account' });
      return;
    }

    // Delete user from database
    await pool.query('DELETE FROM users WHERE id = $1', [targetUser.id]);

    // Audit log
    const auditId = `audit-usr-del-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    await pool.query(
      `INSERT INTO audit_logs (id, timestamp, operator, action, details)
       VALUES (?, datetime('now', 'localtime'), ?, 'USER_DELETED', ?)`,
      [
        auditId,
        operator.username,
        `Owner deleted account "${targetUser.username}" (Name: ${targetUser.name}, Role: ${targetUser.role})`,
      ]
    ).catch((auditErr) => console.warn('Audit log write error:', auditErr));

    res.json({
      success: true,
      message: `User account "${targetUser.username}" deleted successfully`,
      deletedUser: targetUser,
    });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: 'Failed to delete user account' });
  }
}));

/**
 * PUT /api/users/:identifier/password
 * Resets/updates staff access code / password.
 * Role check: Owner only.
 */
router.put('/:identifier/password', requireOwner, asyncHandler(async (req: Request, res: Response) => {
  const operator = (req as any).operator;
  const { identifier } = req.params;
  const { accessCode } = req.body || {};

  if (!accessCode || typeof accessCode !== 'string' || accessCode.trim().length < 4) {
    res.status(400).json({ error: 'New password must be at least 4 characters long' });
    return;
  }
  const cleanCode = accessCode.trim();

  try {
    const findRes = await pool.query(
      'SELECT id, username, name, role FROM users WHERE id = $1 OR LOWER(username) = LOWER($1)',
      [identifier]
    );

    if (findRes.rows.length === 0) {
      res.status(404).json({ error: 'User account not found' });
      return;
    }

    const targetUser = findRes.rows[0];
    const hash = await bcrypt.hash(cleanCode, 10);

    await pool.query(
      'UPDATE users SET access_code_hash = $1 WHERE id = $2',
      [hash, targetUser.id]
    );

    // Audit log
    const auditId = `audit-usr-pwd-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    await pool.query(
      `INSERT INTO audit_logs (id, timestamp, operator, action, details)
       VALUES (?, datetime('now', 'localtime'), ?, 'USER_PASSWORD_RESET', ?)`,
      [
        auditId,
        operator.username,
        `Owner reset password for account "${targetUser.username}"`,
      ]
    ).catch((auditErr) => console.warn('Audit log write error:', auditErr));

    res.json({
      success: true,
      message: `Password for "${targetUser.username}" has been successfully updated`,
    });
  } catch (err) {
    console.error('Error updating password:', err);
    res.status(500).json({ error: 'Failed to update user password' });
  }
}));

export default router;
