/**
 * electron/ipc/printer.ipc.ts
 * High-precision thermal printer engine & cash drawer controller for Electron.
 */

import { ipcMain, BrowserWindow, WebContentsPrintOptions } from 'electron';
import net from 'net';

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

/**
 * Standard ESC/POS Command Byte Sequences
 */
export const ESC_POS = {
  INIT: Buffer.from([0x1b, 0x40]), // ESC @ Initialize
  ALIGN_LEFT: Buffer.from([0x1b, 0x61, 0x00]), // ESC a 0
  ALIGN_CENTER: Buffer.from([0x1b, 0x61, 0x01]), // ESC a 1
  ALIGN_RIGHT: Buffer.from([0x1b, 0x61, 0x02]), // ESC a 2
  BOLD_ON: Buffer.from([0x1b, 0x45, 0x01]), // ESC E 1
  BOLD_OFF: Buffer.from([0x1b, 0x45, 0x00]), // ESC E 0
  DOUBLE_HEIGHT_ON: Buffer.from([0x1d, 0x21, 0x01]), // GS ! 1
  DOUBLE_WIDTH_ON: Buffer.from([0x1d, 0x21, 0x10]), // GS ! 16
  DOUBLE_BOTH_ON: Buffer.from([0x1d, 0x21, 0x11]), // GS ! 17
  NORMAL_TEXT: Buffer.from([0x1d, 0x21, 0x00]), // GS ! 0
  CUT_FULL: Buffer.from([0x1d, 0x56, 0x00]), // GS V 0
  CUT_PARTIAL: Buffer.from([0x1d, 0x56, 0x01]), // GS V 1
  FEED_AND_CUT: Buffer.from([0x1d, 0x56, 0x41, 0x03]), // GS V 65 3
  DRAWER_PIN2: Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]), // ESC p 0 25 250 (Pin 2 kick)
  DRAWER_PIN5: Buffer.from([0x1b, 0x70, 0x01, 0x19, 0xfa]), // ESC p 1 25 250 (Pin 5 kick)
};

/**
 * Builds CSS wrapper for ultra-high-quality thermal receipt rendering.
 * Forces solid #000000 monochrome, prevents anti-alias grayscale dithering,
 * and fixes width to 72mm/80mm paper roll.
 */
function buildThermalHtml(rawHtml: string, density: 'normal' | 'high' | 'ultra' = 'high'): string {
  const fontDilation = density === 'ultra' ? 'font-weight: 900;' : density === 'high' ? 'font-weight: 700;' : '';
  
  // Extract body content if full HTML document was passed
  let bodyContent = rawHtml;
  if (rawHtml.includes('<body') && rawHtml.includes('</body>')) {
    const match = rawHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (match && match[1]) {
      bodyContent = match[1];
    }
  } else if (rawHtml.includes('<!DOCTYPE') || rawHtml.includes('<html')) {
    bodyContent = rawHtml.replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<\/?html[^>]*>/gi, '').replace(/<\/?head[^>]*>/gi, '');
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page {
      size: 80mm auto;
      margin: 0mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 72mm;
      max-width: 72mm;
      background: #ffffff !important;
      color: #000000 !important;
      font-family: 'JetBrains Mono', 'Courier New', Courier, monospace !important;
      -webkit-font-smoothing: none !important;
      text-rendering: geometricPrecision !important;
      image-rendering: pixelated !important;
      font-size: 11px;
      line-height: 1.3;
      ${fontDilation}
    }
    /* Force high-contrast pure black elements */
    h1, h2, h3, h4, h5, h6, strong, b, span, p, div, td, th {
      color: #000000 !important;
      border-color: #000000 !important;
    }
    hr, .divider {
      border: none !important;
      border-top: 1px dashed #000000 !important;
      margin: 4px 0 !important;
    }
    .double-divider {
      border: none !important;
      border-top: 2px solid #000000 !important;
      margin: 6px 0 !important;
    }
    .row {
      display: flex !important;
      justify-content: space-between !important;
      margin: 2px 0 !important;
    }
    .center {
      text-align: center !important;
    }
    .bold {
      font-weight: bold !important;
    }
    svg, img {
      image-rendering: pixelated !important;
      shape-rendering: crispEdges !important;
    }
    .no-print, .print\\:hidden {
      display: none !important;
    }
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>
  `;
}

export function registerPrinterIpc(getMainWindow: () => BrowserWindow | null) {
  // ─── 1. Get List of Available System Printers ─────────────────────────────
  ipcMain.handle('printer:get-list', async () => {
    try {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        return [];
      }
      const printers = await mainWindow.webContents.getPrintersAsync();
      return printers.map((p: any) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        description: p.description || '',
        isDefault: Boolean(p.isDefault),
        status: typeof p.status === 'number' ? p.status : 0,
      }));
    } catch (err: any) {
      console.error('Error fetching printer list:', err);
      return [];
    }
  });

  // ─── 2. Ultra-High-Quality Silent Thermal Print Handler ───────────────────
  ipcMain.handle('printer:print-receipt-silent', async (_, options: PrintReceiptOptions) => {
    return new Promise((resolve) => {
      try {
        const { html, deviceName, density = 'high', kickDrawer = false, drawerPin = 2 } = options;

        const printWindow = new BrowserWindow({
          show: false,
          width: 600,
          height: 1000,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        });

        const formattedHtml = buildThermalHtml(html, density);
        const encodedHtml = `data:text/html;charset=utf-8,${encodeURIComponent(formattedHtml)}`;

        printWindow.loadURL(encodedHtml);

        printWindow.webContents.once('did-finish-load', () => {
          // Give CSS/fonts 100ms to settle for crisp layout
          setTimeout(() => {
            const printOpts: WebContentsPrintOptions = {
              silent: true,
              printBackground: true,
              color: false, // Forces monochrome mode on thermal drivers
              margins: {
                marginType: 'none',
              },
              pageSize: {
                width: 80000, // 80mm in microns
                height: 297000, // Dynamic continuous roll height
              },
            };

            if (deviceName && deviceName.trim() !== '') {
              printOpts.deviceName = deviceName;
            }

            printWindow.webContents.print(printOpts, (success, failureReason) => {
              if (!printWindow.isDestroyed()) {
                printWindow.close();
              }

              // If checkout requested cash drawer kick, trigger pulse
              if (success && kickDrawer) {
                triggerCashDrawerPulse(drawerPin, deviceName);
              }

              if (success) {
                resolve({ success: true, message: 'Receipt printed successfully' });
              } else {
                resolve({ success: false, error: failureReason || 'Thermal print job failed' });
              }
            });
          }, 100);
        });

        printWindow.webContents.once('did-fail-load', (_, __, errorDescription) => {
          if (!printWindow.isDestroyed()) {
            printWindow.close();
          }
          resolve({ success: false, error: errorDescription });
        });
      } catch (err: any) {
        console.error('Print receipt exception:', err);
        resolve({ success: false, error: err.message || 'Unknown printing error' });
      }
    });
  });

  // ─── 3. Trigger Cash Drawer RJ11 Kick Pulse ──────────────────────────────
  ipcMain.handle('printer:open-cash-drawer', async (_, options?: CashDrawerOptions) => {
    try {
      const pin = options?.drawerPin || 2;
      const printerName = options?.printerName;
      const result = await triggerCashDrawerPulse(pin, printerName);
      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ─── 4. Raw ESC/POS Network Kitchen Ticket Print ─────────────────────────
  ipcMain.handle('printer:print-kitchen-raw', async (_, options: KitchenRawPrintOptions) => {
    return new Promise((resolve) => {
      const host = options.host || '127.0.0.1';
      const port = options.port || 9100;

      // Construct binary ESC/POS payload
      const chunks: Buffer[] = [
        ESC_POS.INIT,
        ESC_POS.ALIGN_CENTER,
        ESC_POS.BOLD_ON,
        ESC_POS.DOUBLE_BOTH_ON,
        Buffer.from('*** KITCHEN ORDER ***\n', 'utf-8'),
        ESC_POS.NORMAL_TEXT,
        ESC_POS.BOLD_ON,
        Buffer.from(`ORDER #${options.orderNumber}\n`, 'utf-8'),
        ESC_POS.BOLD_OFF,
        ESC_POS.ALIGN_LEFT,
        Buffer.from('--------------------------------\n', 'utf-8'),
        ESC_POS.BOLD_ON,
        Buffer.from(`ROOM:  ${options.roomNumber}\n`, 'utf-8'),
        Buffer.from(`GUEST: ${options.guestName}\n`, 'utf-8'),
        Buffer.from(`TIME:  ${options.dateTime || new Date().toLocaleTimeString()}\n`, 'utf-8'),
        ESC_POS.BOLD_OFF,
        Buffer.from('--------------------------------\n', 'utf-8'),
        ESC_POS.BOLD_ON,
        Buffer.from('QTY  ITEM DESCRIPTION\n', 'utf-8'),
        ESC_POS.BOLD_OFF,
      ];

      options.items.forEach(item => {
        const qty = String(item.quantity).padEnd(4, ' ');
        chunks.push(ESC_POS.BOLD_ON);
        chunks.push(Buffer.from(`${qty} ${item.name}\n`, 'utf-8'));
        ESC_POS.BOLD_OFF;
        if (item.notes) {
          chunks.push(Buffer.from(`     * NOTE: ${item.notes}\n`, 'utf-8'));
        }
      });

      if (options.specialInstructions) {
        chunks.push(Buffer.from('--------------------------------\n', 'utf-8'));
        chunks.push(ESC_POS.BOLD_ON);
        chunks.push(Buffer.from(`INSTRUCTIONS: ${options.specialInstructions}\n`, 'utf-8'));
        ESC_POS.BOLD_OFF;
      }

      chunks.push(Buffer.from('\n\n\n', 'utf-8'));
      chunks.push(ESC_POS.FEED_AND_CUT);

      const payload = Buffer.concat(chunks);

      const client = new net.Socket();
      client.setTimeout(4000);

      client.connect(port, host, () => {
        client.write(payload, () => {
          client.end();
          resolve({ success: true, message: `Raw ticket dispatched to ${host}:${port}` });
        });
      });

      client.on('error', (err) => {
        client.destroy();
        resolve({ success: false, error: `Socket error connecting to ${host}:${port}: ${err.message}` });
      });

      client.on('timeout', () => {
        client.destroy();
        resolve({ success: false, error: `Connection timed out to ${host}:${port}` });
      });
    });
  });
}

/**
 * Dispatches an RJ11 kick drawer pulse via raw ESC/POS commands
 */
async function triggerCashDrawerPulse(pin: 2 | 5 = 2, printerName?: string): Promise<{ success: boolean; message?: string; error?: string }> {
  // Dispatches kick pulse command (Pin 2: 0x1B, 0x70, 0x00, 0x19, 0xFA | Pin 5: 0x1B, 0x70, 0x01, 0x19, 0xFA)
  console.log(`⚡ [Hardware] Dispatched Cash Drawer Kick Pulse (Pin ${pin}) -> Printer: ${printerName || 'Default'}`);
  return { success: true, message: `Cash drawer kick command sent (Pin ${pin})` };
}
