/**
 * server/utils/jwt.ts
 * Lightweight, zero-dependency JSON Web Token (JWT) implementation
 * using Node.js built-in crypto (HMAC SHA-256).
 */

import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    'FATAL: JWT_SECRET environment variable is not set. ' +
    'Generate a strong random secret and add JWT_SECRET to your .env.local file. ' +
    'Example: JWT_SECRET=$(openssl rand -base64 48)'
  );
}
if (JWT_SECRET.length < 32 || ['123', 'secret', 'password', 'changeme', 'test'].includes(JWT_SECRET.toLowerCase())) {
  throw new Error(
    'FATAL: JWT_SECRET is too weak (min 32 random chars). ' +
    'Generate a strong secret: JWT_SECRET=$(openssl rand -base64 48)'
  );
}
const DEFAULT_EXPIRY_SECONDS = 14 * 60 * 60; // 14 hours (shift-based kiosk)

export interface JwtPayload {
  id?: number;
  username: string;
  name?: string;
  role: string;
  iat?: number;
  exp?: number;
  [key: string]: any;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Sign a payload into a JWT token
 */
export function signJwt(payload: JwtPayload, expiresInSeconds: number = DEFAULT_EXPIRY_SECONDS): string {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${data}.${signature}`;
}

export interface VerifyResult {
  valid: boolean;
  payload?: JwtPayload;
  error?: string;
}

const revokedTokens = new Set<string>();

export function revokeJwt(token: string) {
  revokedTokens.add(token);
}

/**
 * Verify and decode a JWT token. Checks HMAC signature and expiration.
 */
export function verifyJwt(token: string): VerifyResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token is required' };
  }
  if (revokedTokens.has(token)) {
    return { valid: false, error: 'Token has been revoked' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid token structure' };
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const data = `${encodedHeader}.${encodedPayload}`;

  // Recalculate expected signature
  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { valid: false, error: 'Invalid signature' };
  }

  try {
    const payload: JwtPayload = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && payload.exp < now) {
      return { valid: false, error: 'Token has expired' };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: 'Malformed token payload' };
  }
}
