/**
 * electron/preload.ts
 * Secure IPC Context Bridge exposing window.electronAPI to the React frontend.
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  // Printing & Hardware
  getPrinters: () => Promise<Array<{ name: string; displayName: string; description: string; isDefault: boolean; status: number }>>;
  printReceiptSilent: (options: {
    html: string;
    deviceName?: string;
    density?: 'normal' | 'high' | 'ultra';
    kickDrawer?: boolean;
    drawerPin?: 2 | 5;
  }) => Promise<{ success: boolean; message?: string; error?: string }>;
  printKitchenTicketRaw: (options: {
    host?: string;
    port?: number;
    orderNumber: string;
    roomNumber: string;
    guestName: string;
    items: Array<{ name: string; quantity: number; notes?: string }>;
    specialInstructions?: string;
    dateTime?: string;
  }) => Promise<{ success: boolean; message?: string; error?: string }>;
  openCashDrawer: (options?: { printerName?: string; drawerPin?: 2 | 5 }) => Promise<{ success: boolean; message?: string; error?: string }>;
  
  // Multi-Monitor Customer Display
  getDisplays: () => Promise<Array<{ id: number; label: string; bounds: any; workArea: any; scaleFactor: number; isPrimary: boolean }>>;
  toggleCustomerDisplay: (enable?: boolean) => Promise<{ success: boolean; isOpen?: boolean; displayId?: number; error?: string }>;
  onDisplayChange: (callback: () => void) => () => void;

  // System & Database
  backupDatabase: () => Promise<{ success: boolean; backupPath?: string; sizeBytes?: number; timestamp?: string; message?: string; error?: string }>;
  getAppDataPath: () => Promise<{ userData: string; appPath: string; cwd: string }>;
  openDataFolder: () => Promise<{ success: boolean; path?: string; error?: string }>;

  // Window Controls
  minimize: () => void;
  maximize: () => void;
  close: () => void;
}

const electronAPI: ElectronAPI = {
  isElectron: true,
  platform: process.platform,

  // Printing & Hardware
  getPrinters: () => ipcRenderer.invoke('printer:get-list'),
  printReceiptSilent: (options) => ipcRenderer.invoke('printer:print-receipt-silent', options),
  printKitchenTicketRaw: (options) => ipcRenderer.invoke('printer:print-kitchen-raw', options),
  openCashDrawer: (options) => ipcRenderer.invoke('printer:open-cash-drawer', options),

  // Multi-Monitor
  getDisplays: () => ipcRenderer.invoke('display:get-all'),
  toggleCustomerDisplay: (enable) => ipcRenderer.invoke('display:toggle-customer-window', enable),
  onDisplayChange: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('display:changed', handler);
    return () => {
      ipcRenderer.removeListener('display:changed', handler);
    };
  },

  // System & Database
  backupDatabase: () => ipcRenderer.invoke('system:backup-database'),
  getAppDataPath: () => ipcRenderer.invoke('system:get-app-data-path'),
  openDataFolder: () => ipcRenderer.invoke('system:open-data-folder'),

  // Window Controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
