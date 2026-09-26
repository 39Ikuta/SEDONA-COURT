/**
 * server/utils/cors.ts
 * Robust CORS configuration for local network (LAN), localhost, Electron, and tunneling setups.
 */

import { CorsOptions } from 'cors';

/**
 * Check if a given origin is allowed under local network and production policies.
 * 
 * Permitted Origins:
 * - Empty/undefined origins (CLI tools, curl, Electron file protocol, mobile native apps)
 * - Localhost & loopbacks: localhost, 127.0.0.1, [::1] on any port
 * - RFC 1918 Private LAN subnets: 192.168.x.x, 10.x.x.x, 172.16-31.x.x on any port
 * - RFC 3927 Link-Local: 169.254.x.x on any port
 * - Local hostnames: e.g. hostname.local or plain LAN computer hostnames
 * - Secure dev tunnels: *.ngrok-free.dev, *.ngrok.app, *.ngrok.io, *.loca.lt, *.trycloudflare.com
 * - Custom configured origins: process.env.APP_URL and comma-separated process.env.ALLOWED_ORIGINS
 */
export function isOriginAllowed(origin?: string): boolean {
  // Allow non-browser requests (curl, server-to-server, Electron, mobile native)
  if (!origin) return true;

  // Trim and strip trailing slashes for standard comparison
  const cleanOrigin = origin.trim().replace(/\/+$/, '');

  // 1. Explicitly configured origins
  const envOrigins = [
    process.env.APP_URL,
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : []),
  ].filter(Boolean) as string[];

  if (envOrigins.some((allowed) => cleanOrigin === allowed.replace(/\/+$/, ''))) {
    return true;
  }

  // 2. Localhost & IPv4/IPv6 loopback on any port
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(cleanOrigin)) {
    return true;
  }

  // 3. RFC 1918 Private IPv4 Networks
  // 192.168.0.0 - 192.168.255.255
  if (/^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(?::\d+)?$/i.test(cleanOrigin)) {
    return true;
  }
  // 10.0.0.0 - 10.255.255.255
  if (/^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?$/i.test(cleanOrigin)) {
    return true;
  }
  // 172.16.0.0 - 172.31.255.255
  if (/^https?:\/\/172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(?::\d+)?$/i.test(cleanOrigin)) {
    return true;
  }

  // 4. RFC 3927 Link-Local (169.254.0.0/16)
  if (/^https?:\/\/169\.254\.\d{1,3}\.\d{1,3}(?::\d+)?$/i.test(cleanOrigin)) {
    return true;
  }

  // 5. Local hostnames / mDNS (e.g. http://sedona-pos:3000, http://cashier-desk.local:3000)
  if (/^https?:\/\/[a-z0-9_-]+(?:\.local)?(?::\d+)?$/i.test(cleanOrigin)) {
    return true;
  }

  // 6. Tunnel domains
  if (
    cleanOrigin.endsWith('.ngrok-free.dev') ||
    cleanOrigin.endsWith('.ngrok.app') ||
    cleanOrigin.endsWith('.ngrok.io') ||
    cleanOrigin.endsWith('.loca.lt') ||
    cleanOrigin.endsWith('.trycloudflare.com')
  ) {
    return true;
  }

  return false;
}

/**
 * Standard Express CORS options configuration.
 */
export const expressCorsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      // Returning callback(null, true) authorizes the origin
      return callback(null, true);
    }
    // Returning callback(null, false) denies CORS without throwing an unhandled 500 exception
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'scti_token',
    'scti_session_token',
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 86400, // Cache preflight response for 24 hours
};
