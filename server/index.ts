/**
 * server/index.ts
 * Main Express application entry point.
 * Mounts all API routes and starts the server.
 *
 * Start with: npm run server
 * Or alongside frontend: npm run dev:all
 */

// Explicitly set server timezone to Asia/Manila (Priority 2d)
process.env.TZ = process.env.TZ || 'Asia/Manila';

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs';
import path from 'path';

// ─── Process-Level Crash Handlers (F-01, F-04) ───────────────────────────────
// Without these, any unhandled error kills the process silently with no log.
// Node.js ≥15 terminates on unhandled rejections by default.

const CRASH_LOG_PATH = path.resolve(process.cwd(), 'server/data/logs');

function writeCrashLog(label: string, err: unknown): void {
  const timestamp = new Date().toISOString();
  const message = err instanceof Error
    ? `${err.message}\n${err.stack || '(no stack)'}`
    : String(err);
  const entry = `[${timestamp}] ${label}: ${message}\n\n`;

  try {
    if (!fs.existsSync(CRASH_LOG_PATH)) {
      fs.mkdirSync(CRASH_LOG_PATH, { recursive: true });
    }
    fs.appendFileSync(path.join(CRASH_LOG_PATH, 'crash.log'), entry);
  } catch {
    // If we can't write to the log file, at least stderr will have it
  }
  console.error(`\n❌ ${entry}`);
}

// Socket/network abort error codes that occur naturally when clients disconnect,
// go to sleep, or close tabs mid-request. These should NEVER terminate the server.
const IGNORABLE_NETWORK_ERRORS = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNABORTED',
  'ERR_HTTP_HEADERS_SENT',
  'ERR_STREAM_WRITE_AFTER_END',
  'ECANCELED',
  'EHOSTUNREACH',
  'ENOTFOUND',
]);

process.on('uncaughtException', (err: any) => {
  const code = err?.code || err?.name;
  if (code && IGNORABLE_NETWORK_ERRORS.has(code)) {
    console.warn(`⚠️ Non-fatal network disconnect caught (${code}): ${err.message}`);
    return;
  }
  writeCrashLog('UNCAUGHT EXCEPTION', err);
  // Exit so the process supervisor (pm2/nodemon) can restart cleanly if severe.
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  writeCrashLog('UNHANDLED REJECTION', reason);
  // Do NOT exit — a rejected promise doesn't corrupt process state.
  // Log it for forensics and continue serving other requests.
});

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { testConnection } from './db/pool';
import { validateEnvironment } from './utils/env-validator';
import { socketManager } from './websocket/socket-manager';

import authRouter from './routes/auth';
import roomsRouter from './routes/rooms';
import bookingsRouter from './routes/bookings';
import receiptsRouter from './routes/receipts';
import servicesRouter from './routes/billable-services';
import auditLogsRouter from './routes/audit-logs';
import tasksRouter from './routes/tasks';
import posRevenueRouter from './routes/pos-revenue';
import weeklyReportsRouter from './routes/weekly-reports';
import kitchenRouter from './routes/kitchen';
import analyticsRouter from './routes/analytics';
import forceCheckoutRouter from './routes/force-checkout';
import customerDisplayRouter from './routes/customer-display';
import depositsRouter from './routes/deposits';
import inventoryRouter from './routes/inventory';
import usersRouter from './routes/users';
import shiftSettlementRouter from './routes/shift-settlement';
import reportExportsRouter from './routes/report-exports';

// Validate environment variables before starting
const envConfig = validateEnvironment();
const PORT = parseInt(envConfig.API_PORT, 10);

const app = express();
const httpServer = createServer(app);

// ─── HTTP Server Timeouts & Resiliency (Fix 502 Bad Gateway) ─────────────────
// Node.js defaults keepAliveTimeout to 5 seconds. If a reverse proxy (Vite, Cloudflare,
// Ngrok, Nginx) sends a request over an idle connection that Node closed, a 502 Bad Gateway occurs.
// Setting keepAliveTimeout > proxy idle timeout (65s) completely eliminates 502 keep-alive races.
httpServer.keepAliveTimeout = 65000;
httpServer.headersTimeout = 66000;
httpServer.requestTimeout = 300000; // 5 minutes for long queries/reports

// Handle client socket errors gracefully (e.g. laptop sleeps while TCP connection is open)
httpServer.on('clientError', (err: any, socket) => {
  if (err.code === 'ECONNRESET' || socket.destroyed) {
    return;
  }
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (curl, server-to-server, mobile apps)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://doretta-unordained-josiah.ngrok-free.dev',
      'http://doretta-unordained-josiah.ngrok-free.dev',
      process.env.APP_URL,
    ].filter(Boolean) as string[];

    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith('.ngrok-free.dev') ||
      origin.endsWith('.ngrok.app') ||
      origin.endsWith('.ngrok.io')
    ) {
      return callback(null, true);
    }

    return callback(null, true); // Permissive for development tunnels
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

// ─── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    websocket: {
      enabled: true,
      connectedClients: socketManager.getConnectedCount(),
    },
    environment: envConfig.NODE_ENV,
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/receipts', receiptsRouter);
app.use('/api/services', servicesRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/pos-revenue', posRevenueRouter);
app.use('/api/weekly-reports', weeklyReportsRouter);
app.use('/api/kitchen', kitchenRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/force-checkout', forceCheckoutRouter);
app.use('/api/display', customerDisplayRouter);
app.use('/api/public', customerDisplayRouter);
app.use('/api/deposits', depositsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/users', usersRouter);
app.use('/api/shift-settlement', shiftSettlementRouter);
app.use('/api/report-exports', reportExportsRouter);

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
async function start() {
  try {
    console.log('\n🚀 Starting Sedona Court API Server...\n');
    
    // Test database connection
    await testConnection();
    
    // Initialize WebSocket server
    socketManager.initialize(httpServer);
    
    // Start HTTP server
    httpServer.listen(PORT, () => {
      console.log(`\n🏨 Sedona Court API running at http://localhost:${PORT}`);
      console.log(`   Health check: http://localhost:${PORT}/api/health`);
      console.log(`   WebSocket: ws://localhost:${PORT}`);
      console.log(`   Environment: ${envConfig.NODE_ENV}\n`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

// Start listener automatically unless running in test environment
if (process.env.NODE_ENV !== 'test') {
  start();
}

export { app, httpServer, start };
