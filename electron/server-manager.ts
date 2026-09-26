/**
 * electron/server-manager.ts
 * Manages the embedded Express API + WebSocket + SQLite backend for the Electron desktop app.
 */

import { ChildProcess, fork, spawn } from 'child_process';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';

let serverProcess: ChildProcess | null = null;

export async function startEmbeddedServer(): Promise<{ port: number }> {
  const PORT = 4000;

  // Check if server is already running (e.g. during dev with npm run dev:all)
  try {
    const res = await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      console.log(`📡 [Electron] Embedded server already active on port ${PORT}`);
      return { port: PORT };
    }
  } catch {
    // Server not running yet, proceed to launch
  }

  return new Promise((resolve) => {
    const isDev = !app.isPackaged;
    console.log(`🚀 [Electron] Starting embedded server (isPackaged: ${app.isPackaged})...`);

    if (isDev) {
      // In development, spawn tsx to run server/index.ts
      const serverScript = path.resolve(process.cwd(), 'server/index.ts');
      
      const tsxBin = path.resolve(
        process.cwd(),
        'node_modules/.bin',
        process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
      );

      const command = fs.existsSync(tsxBin) ? tsxBin : 'npx';
      const args = fs.existsSync(tsxBin)
        ? ['--tsconfig', 'tsconfig.server.json', serverScript]
        : ['tsx', '--tsconfig', 'tsconfig.server.json', serverScript];

      serverProcess = spawn(command, args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          API_PORT: String(PORT),
          PORT: String(PORT),
          NODE_ENV: 'development',
        },
        stdio: 'inherit',
        shell: true,
      });
    } else {
      // In production packaged build
      const prodServerScript = path.join(app.getAppPath(), 'dist-server', 'index.js');
      if (fs.existsSync(prodServerScript)) {
        serverProcess = fork(prodServerScript, [], {
          env: {
            ...process.env,
            API_PORT: String(PORT),
            PORT: String(PORT),
            NODE_ENV: 'production',
          },
          stdio: 'inherit',
        });
      }
    }

    // Wait for server health check to report OK
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(800) });
        if (res.ok) {
          clearInterval(interval);
          console.log(`✅ [Electron] Embedded server is healthy on http://localhost:${PORT}`);
          resolve({ port: PORT });
        }
      } catch {
        if (attempts > 30) {
          clearInterval(interval);
          console.warn(`⚠️ [Electron] Embedded server health check timed out after 30 attempts, continuing...`);
          resolve({ port: PORT });
        }
      }
    }, 500);
  });
}

export function stopEmbeddedServer() {
  if (serverProcess) {
    console.log('🛑 [Electron] Stopping embedded server...');
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}
