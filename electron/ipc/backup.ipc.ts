/**
 * electron/ipc/backup.ipc.ts
 * Safe SQLite snapshot backups and system file manager helpers.
 */

import { ipcMain, app, shell } from 'electron';
import fs from 'fs';
import path from 'path';

export function registerBackupIpc() {
  // ─── 1. Backup SQLite Database File ───────────────────────────────────────
  ipcMain.handle('system:backup-database', async () => {
    try {
      const candidates = [
        path.resolve(process.cwd(), 'server/data/sedona_pms.db'),
        path.resolve(process.cwd(), 'server/data/sedona_court.db'),
        path.join(app.getPath('userData'), 'sedona_pms.db'),
      ];

      let sourceDbPath = candidates.find(p => fs.existsSync(p));
      if (!sourceDbPath) {
        // Create parent if missing
        sourceDbPath = candidates[0];
      }

      const backupDir = path.join(app.getPath('userData'), 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const destPath = path.join(backupDir, `sedona_pms_backup_${timestamp}.db`);

      if (fs.existsSync(sourceDbPath)) {
        fs.copyFileSync(sourceDbPath, destPath);
        const stats = fs.statSync(destPath);
        return {
          success: true,
          backupPath: destPath,
          sizeBytes: stats.size,
          timestamp: now.toISOString(),
          message: `Backup successfully created (${Math.round(stats.size / 1024)} KB)`,
        };
      } else {
        return {
          success: false,
          error: 'Source database file not found yet. It will be created on first start.',
        };
      }
    } catch (err: any) {
      console.error('Database backup error:', err);
      return { success: false, error: err.message };
    }
  });

  // ─── 2. Get User Application Data Path ─────────────────────────────────────
  ipcMain.handle('system:get-app-data-path', async () => {
    return {
      userData: app.getPath('userData'),
      appPath: app.getAppPath(),
      cwd: process.cwd(),
    };
  });

  // ─── 3. Open Data / Logs Folder in Windows Explorer ────────────────────────
  ipcMain.handle('system:open-data-folder', async () => {
    try {
      const targetDir = fs.existsSync(path.resolve(process.cwd(), 'server/data'))
        ? path.resolve(process.cwd(), 'server/data')
        : app.getPath('userData');
      
      await shell.openPath(targetDir);
      return { success: true, path: targetDir };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
