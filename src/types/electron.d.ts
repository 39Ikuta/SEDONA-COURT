/**
 * src/types/electron.d.ts
 * Global TypeScript definitions for window.electronAPI.
 */

export interface SystemPrinter {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  status: number;
}

export interface PrintReceiptOptions {
  html: string;
  deviceName?: string;
  density?: 'normal' | 'high' | 'ultra';
  kickDrawer?: boolean;
  drawerPin?: 2 | 5;
}

export interface KitchenRawPrintOptions {
  host?: string;
  port?: number;
  orderNumber: string;
  roomNumber: string;
  guestName: string;
  items: Array<{ name: string; quantity: number; notes?: string }>;
  specialInstructions?: string;
  dateTime?: string;
}

export interface CashDrawerOptions {
  printerName?: string;
  drawerPin?: 2 | 5;
}

export interface ConnectedDisplay {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
}

export interface BackupResult {
  success: boolean;
  backupPath?: string;
  sizeBytes?: number;
  timestamp?: string;
  message?: string;
  error?: string;
}

export interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  getPrinters: () => Promise<SystemPrinter[]>;
  printReceiptSilent: (options: PrintReceiptOptions) => Promise<{ success: boolean; message?: string; error?: string }>;
  printKitchenTicketRaw: (options: KitchenRawPrintOptions) => Promise<{ success: boolean; message?: string; error?: string }>;
  openCashDrawer: (options?: CashDrawerOptions) => Promise<{ success: boolean; message?: string; error?: string }>;
  getDisplays: () => Promise<ConnectedDisplay[]>;
  toggleCustomerDisplay: (enable?: boolean) => Promise<{ success: boolean; isOpen?: boolean; displayId?: number; error?: string }>;
  onDisplayChange: (callback: () => void) => () => void;
  backupDatabase: () => Promise<BackupResult>;
  getAppDataPath: () => Promise<{ userData: string; appPath: string; cwd: string }>;
  openDataFolder: () => Promise<{ success: boolean; path?: string; error?: string }>;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
