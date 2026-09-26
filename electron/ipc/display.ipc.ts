/**
 * electron/ipc/display.ipc.ts
 * Multi-Monitor Display Manager for Guest-Facing Customer Display.
 */

import { ipcMain, screen, BrowserWindow, app } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let customerWindow: BrowserWindow | null = null;

export function getCustomerWindow(): BrowserWindow | null {
  return customerWindow;
}

export function registerDisplayIpc(
  getMainWindow: () => BrowserWindow | null,
  getAppUrl: (subpath: string) => string
) {
  // ─── 1. Get All Connected Displays ─────────────────────────────────────────
  ipcMain.handle('display:get-all', async () => {
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();

    return displays.map(d => ({
      id: d.id,
      label: d.label || `Display ${d.id}`,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
      isPrimary: d.id === primaryDisplay.id,
    }));
  });

  // ─── 2. Toggle or Open Customer Display Window ─────────────────────────────
  ipcMain.handle('display:toggle-customer-window', async (_, enable?: boolean) => {
    try {
      if (enable === false) {
        if (customerWindow && !customerWindow.isDestroyed()) {
          customerWindow.close();
          customerWindow = null;
        }
        return { success: true, isOpen: false };
      }

      if (customerWindow && !customerWindow.isDestroyed()) {
        customerWindow.focus();
        return { success: true, isOpen: true };
      }

      const displays = screen.getAllDisplays();
      const primaryDisplay = screen.getPrimaryDisplay();

      // Find secondary display (first display that is not primary)
      const secondaryDisplay = displays.find(d => d.id !== primaryDisplay.id) || primaryDisplay;

      const { x, y, width, height } = secondaryDisplay.bounds;

      customerWindow = new BrowserWindow({
        x: x + 50,
        y: y + 50,
        width: Math.min(1280, width),
        height: Math.min(800, height),
        minWidth: 1024,
        minHeight: 600,
        title: 'Sedona Court - Customer Display',
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(app.getAppPath(), 'dist-electron', 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      const customerUrl = getAppUrl('display');
      customerWindow.loadURL(customerUrl);

      // Maximize on secondary monitor
      if (displays.length > 1) {
        customerWindow.setBounds(secondaryDisplay.bounds);
        customerWindow.setFullScreen(true);
      }

      customerWindow.on('closed', () => {
        customerWindow = null;
      });

      return { success: true, isOpen: true, displayId: secondaryDisplay.id };
    } catch (err: any) {
      console.error('Error toggling customer display window:', err);
      return { success: false, error: err.message };
    }
  });

  // ─── Screen Change Detection ───────────────────────────────────────────────
  screen.on('display-added', () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('display:changed');
    }
  });

  screen.on('display-removed', () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('display:changed');
    }
  });
}
