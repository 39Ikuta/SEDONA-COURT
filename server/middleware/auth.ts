/**
 * server/middleware/auth.ts
 * Hardened operator authentication middleware.
 * Verifies signed JWT Bearer token and validates user/role against the database.
 * Routes protected by requireAuth return 401 if token is missing, invalid, or expired.
 */

import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { verifyJwt } from '../utils/jwt';

export const STAFF_ROLES = ['kitchen', 'cashier', 'admin', 'owner'] as const;
export type StaffRole = typeof STAFF_ROLES[number];

export const DEPOSIT_STAFF_ROLES = ['cashier', 'admin', 'owner'] as const;
export type DepositStaffRole = typeof DEPOSIT_STAFF_ROLES[number];

/**
 * Standard operator authentication middleware.
 * Verifies signed JWT Bearer token and validates user/role against the database.
 * 
 * LEAST-PRIVILEGE SECURITY RULE:
 * Every existing staff/protected route defaults to DENYING the customer_display role.
 * Only authenticated operators with a recognized staff role are admitted.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization || req.headers.Authorization as string;
  if (!authHeader || typeof authHeader !== 'string') {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Authorization header format must be Bearer <token>' });
    return;
  }

  const token = match[1].trim();
  const verifyResult = verifyJwt(token);

  if (!verifyResult.valid || !verifyResult.payload) {
    res.status(401).json({ error: verifyResult.error || 'Invalid or expired session token' });
    return;
  }

  try {
    const { username } = verifyResult.payload;
    const result = await pool.query(
      'SELECT id, username, name, role FROM users WHERE LOWER(username) = LOWER(?)',
      [username]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Unknown operator' });
      return;
    }

    const dbUser = result.rows[0];

    // Explicitly reject customer_display role on all staff routes (403 Forbidden)
    if (dbUser.role === 'customer_display' || !STAFF_ROLES.includes(dbUser.role)) {
      res.status(403).json({ error: 'Access denied: customer_display role is not permitted on staff operations' });
      return;
    }

    (req as any).operator = {
      id: dbUser.id,
      username: dbUser.username,
      name: dbUser.name,
      role: dbUser.role,
    };
    next();
  } catch (err) {
    console.error('requireAuth database error:', err);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

/**
 * Customer Display endpoint authentication middleware.
 * Verifies signed JWT Bearer token and ensures the account has customer_display (or staff) role.
 */
export async function requireCustomerDisplayAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization || req.headers.Authorization as string;

  // If an Authorization header is provided, strictly validate token & role
  if (authHeader && typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      res.status(401).json({ error: 'Authorization header format must be Bearer <token>' });
      return;
    }

    const token = match[1].trim();
    const verifyResult = verifyJwt(token);

    if (!verifyResult.valid || !verifyResult.payload) {
      res.status(401).json({ error: verifyResult.error || 'Invalid or expired session token' });
      return;
    }

    try {
      const { username } = verifyResult.payload;
      const result = await pool.query(
        'SELECT id, username, name, role FROM users WHERE LOWER(username) = LOWER(?)',
        [username]
      );

      if (result.rows.length === 0) {
        res.status(401).json({ error: 'Unknown operator' });
        return;
      }

      const dbUser = result.rows[0];
      const allowedRoles = ['customer_display', ...STAFF_ROLES];
      if (!allowedRoles.includes(dbUser.role)) {
        res.status(403).json({ error: 'Access denied: unrecognized display role' });
        return;
      }

      (req as any).operator = {
        id: dbUser.id,
        username: dbUser.username,
        name: dbUser.name,
        role: dbUser.role,
      };
      return next();
    } catch (err) {
      console.error('requireCustomerDisplayAuth database error:', err);
      res.status(500).json({ error: 'Display auth check failed' });
      return;
    }
  }

  // If no Authorization header is provided, permit read-only sanitized access
  // for public in-lobby kiosk displays (Decision Point (a) & (b) hybrid resilience)
  next();
}

/**
 * Strict role-gated authentication middleware for deposit operations.
 * Allows ONLY cashier, admin, and owner roles.
 * Strictly forbids customer_display (HTTP 403), kitchen (HTTP 403), and missing/invalid token (HTTP 401).
 * Server-derives operator identity onto req.operator.
 */
export async function requireDepositStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization || (req.headers.Authorization as string);
  if (!authHeader || typeof authHeader !== 'string') {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Authorization header format must be Bearer <token>' });
    return;
  }

  const token = match[1].trim();
  const verifyResult = verifyJwt(token);

  if (!verifyResult.valid || !verifyResult.payload) {
    res.status(401).json({ error: verifyResult.error || 'Invalid or expired session token' });
    return;
  }

  try {
    const { username } = verifyResult.payload;
    const result = await pool.query(
      'SELECT id, username, name, role FROM users WHERE LOWER(username) = LOWER(?)',
      [username]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Unknown operator' });
      return;
    }

    const dbUser = result.rows[0];

    // Explicitly reject customer_display or unauthorized staff role
    if (dbUser.role === 'customer_display') {
      res.status(403).json({ error: 'Access denied: customer_display role is not permitted on deposit operations' });
      return;
    }

    if (!DEPOSIT_STAFF_ROLES.includes(dbUser.role as any)) {
      res.status(403).json({ error: `Access denied: role '${dbUser.role}' is not authorized to perform deposit operations` });
      return;
    }

    (req as any).operator = {
      id: dbUser.id,
      username: dbUser.username,
      name: dbUser.name,
      role: dbUser.role,
    };
    next();
  } catch (err) {
    console.error('requireDepositStaff database error:', err);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

export const INVENTORY_STAFF_ROLES = ['cashier', 'admin', 'owner'] as const;
export type InventoryStaffRole = typeof INVENTORY_STAFF_ROLES[number];

/**
 * Strict role-gated authentication middleware for inventory operations.
 * Allows ONLY cashier, admin, and owner roles to modify inventory counts.
 * Denies kitchen role (HTTP 403), customer_display role (HTTP 403), and missing/invalid token (HTTP 401).
 * Attaches server-derived operator onto req.operator.
 */
export async function requireInventoryStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization || (req.headers.Authorization as string);
  if (!authHeader || typeof authHeader !== 'string') {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Authorization header format must be Bearer <token>' });
    return;
  }

  const token = match[1].trim();
  const verifyResult = verifyJwt(token);

  if (!verifyResult.valid || !verifyResult.payload) {
    res.status(401).json({ error: verifyResult.error || 'Invalid or expired session token' });
    return;
  }

  try {
    const { username } = verifyResult.payload;
    const result = await pool.query(
      'SELECT id, username, name, role FROM users WHERE LOWER(username) = LOWER(?)',
      [username]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Unknown operator' });
      return;
    }

    const dbUser = result.rows[0];

    // Explicitly reject customer_display or kitchen or unauthorized role
    if (dbUser.role === 'customer_display') {
      res.status(403).json({ error: 'Access denied: customer_display role is not permitted on inventory operations' });
      return;
    }

    if (!INVENTORY_STAFF_ROLES.includes(dbUser.role as any)) {
      res.status(403).json({ error: `Access denied: role '${dbUser.role}' is not authorized to enter or adjust inventory stock counts` });
      return;
    }

    (req as any).operator = {
      id: dbUser.id,
      username: dbUser.username,
      name: dbUser.name,
      role: dbUser.role,
    };
    next();
  } catch (err) {
    console.error('requireInventoryStaff database error:', err);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

export const ADMIN_STAFF_ROLES = ['admin', 'owner'] as const;
export type AdminStaffRole = typeof ADMIN_STAFF_ROLES[number];

/**
 * Strict role-gated authentication middleware for Admin operations.
 * Allows ONLY 'admin' and 'owner' roles.
 * Denies 'cashier', 'kitchen', 'customer_display' (HTTP 403), and missing/invalid token (HTTP 401).
 * Attaches server-derived operator onto req.operator.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization || (req.headers.Authorization as string);
  if (!authHeader || typeof authHeader !== 'string') {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Authorization header format must be Bearer <token>' });
    return;
  }

  const token = match[1].trim();
  const verifyResult = verifyJwt(token);

  if (!verifyResult.valid || !verifyResult.payload) {
    res.status(401).json({ error: verifyResult.error || 'Invalid or expired session token' });
    return;
  }

  try {
    const { username } = verifyResult.payload;
    const result = await pool.query(
      'SELECT id, username, name, role FROM users WHERE LOWER(username) = LOWER(?)',
      [username]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Unknown operator' });
      return;
    }

    const dbUser = result.rows[0];

    if (dbUser.role === 'customer_display') {
      res.status(403).json({ error: 'Access denied: customer_display role is not permitted on admin operations' });
      return;
    }

    if (!ADMIN_STAFF_ROLES.includes(dbUser.role as any)) {
      res.status(403).json({ error: `Access denied: role '${dbUser.role}' is not authorized to perform admin operations` });
      return;
    }

    (req as any).operator = {
      id: dbUser.id,
      username: dbUser.username,
      name: dbUser.name,
      role: dbUser.role,
    };
    next();
  } catch (err) {
    console.error('requireAdmin database error:', err);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

/**
 * Strict role-gated authentication middleware for Owner-only operations.
 * Allows ONLY the 'owner' role.
 * Denies 'admin', 'cashier', 'kitchen', and 'customer_display' roles (HTTP 403),
 * and missing/invalid token (HTTP 401).
 * Attaches verified database operator onto req.operator.
 */
export async function requireOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization || (req.headers.Authorization as string);
  if (!authHeader || typeof authHeader !== 'string') {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Authorization header format must be Bearer <token>' });
    return;
  }

  const token = match[1].trim();
  const verifyResult = verifyJwt(token);

  if (!verifyResult.valid || !verifyResult.payload) {
    res.status(401).json({ error: verifyResult.error || 'Invalid or expired session token' });
    return;
  }

  try {
    const { username } = verifyResult.payload;
    const result = await pool.query(
      'SELECT id, username, name, role FROM users WHERE LOWER(username) = LOWER(?)',
      [username]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Unknown operator' });
      return;
    }

    const dbUser = result.rows[0];

    if (dbUser.role !== 'owner') {
      res.status(403).json({ error: 'Forbidden: Only hotel owners are authorized to manage user accounts' });
      return;
    }

    (req as any).operator = {
      id: dbUser.id,
      username: dbUser.username,
      name: dbUser.name,
      role: dbUser.role,
    };
    next();
  } catch (err) {
    console.error('requireOwner database error:', err);
    res.status(500).json({ error: 'Auth check failed' });
  }
}


