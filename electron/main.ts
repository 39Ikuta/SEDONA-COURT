/**
 * electron/main.ts
 * Main process entry point for Sedona Court Travellers Inn PMS desktop application.
 */

import { app, BrowserWindow, ipcMain, powerSaveBlocker } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerPrinterIpc } from './ipc/printer.ipc';
import { registerDisplayIpc } from './ipc/display.ipc';
import { registerBackupIpc } from './ipc/backup.ipc';
import { startEmbeddedServer, stopEmbeddedServer } from './server-manager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set application name & prevent power sleep
app.setName('Sedona Court Travellers Inn - PMS');
let powerSaveBlockerId: number | null = null;

let mainWindow: BrowserWindow | null = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.log('⚡ Another instance is already running. Exiting...');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Prevent computer / network sleep while PMS is open
    try {
      powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    } catch (e) {
      console.warn('Could not initialize powerSaveBlocker:', e);
    }

    // Start embedded Express + SQLite + Socket.io backend
    await startEmbeddedServer();

    // Helper to resolve route URLs
    const getAppUrl = (subpath: string = '') => {
      const devServerUrl = process.env.VITE_DEV_SERVER_URL;
      if (devServerUrl) {
        return subpath ? `${devServerUrl}#/${subpath}` : devServerUrl;
      }
      const indexPath = path.join(__dirname, '../dist/index.html');
      return `file://${indexPath}${subpath ? `#/${subpath}` : ''}`;
    };

    // Create Main Frontdesk Window
    createMainWindow(getAppUrl);

    // Register Native IPC Engines
    registerPrinterIpc(() => mainWindow);
    registerDisplayIpc(() => mainWindow, getAppUrl);
    registerBackupIpc();

    // Register Window Control IPCs
    ipcMain.on('window:minimize', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize();
      }
    });

    ipcMain.on('window:maximize', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize();
        } else {
          mainWindow.maximize();
        }
      }
    });

    ipcMain.on('window:close', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      stopEmbeddedServer();
      if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
        powerSaveBlocker.stop(powerSaveBlockerId);
      }
      app.quit();
    }
  });

  app.on('before-quit', () => {
    stopEmbeddedServer();
  });
}

function createMainWindow(getAppUrl: (subpath?: string) => string) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    title: 'Sedona Court Travellers Inn - Property Management System',
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#F7F4EE',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const targetUrl = getAppUrl();
  console.log(`🌐 Loading main window URL: ${targetUrl}`);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}
