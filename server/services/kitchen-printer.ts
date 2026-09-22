/**
 * server/services/kitchen-printer.ts
 * Network/IP ESC/POS Thermal Printer service for kitchen orders.
 *
 * Non-negotiable guarantees:
 * 1. Printing is strictly a non-blocking side-effect (never delays/blocks order creation or check-in).
 * 2. Atomic idempotency guards prevent duplicate prints on retried requests or rapid double-clicks.
 * 3. Print failures after background retries are recorded as 'failed' with visible broadcast to UI.
 * 4. Configuration is environment-driven with zero hardcoding.
 */

import net from 'net';
import { pool } from '../db/pool';
import { KitchenOrder } from './kitchen-orders';
import { socketManager } from '../websocket/socket-manager';

export interface PrinterConfig {
  ip: string;
  port: number;
  enabled: boolean;
  timeoutMs: number;
  maxRetries: number;
}

// Configurable environment defaults
let config: PrinterConfig = {
  ip: process.env.KITCHEN_PRINTER_IP || '127.0.0.1',
  port: parseInt(process.env.KITCHEN_PRINTER_PORT || '9100', 10),
  enabled: process.env.KITCHEN_PRINTER_ENABLED !== 'false',
  timeoutMs: parseInt(process.env.KITCHEN_PRINTER_TIMEOUT_MS || '3000', 10),
  maxRetries: parseInt(process.env.KITCHEN_PRINTER_MAX_RETRIES || '1', 10),
};

// In-memory deduplication cache to prevent triple-printing / rapid re-triggers
const recentPrintJobs = new Map<number, number>();
const DEDUP_WINDOW_MS = 30_000; // 30 seconds window

/**
 * Update printer config at runtime (used for testing or dynamic config)
 */
export function setPrinterConfig(newConfig: Partial<PrinterConfig>): void {
  config = { ...config, ...newConfig };
}

export function getPrinterConfig(): PrinterConfig {
  return { ...config };
}

/**
 * Format timestamp nicely for receipt printing
 */
function formatTicketTime(isoOrStr?: string): string {
  if (!isoOrStr) return new Date().toLocaleString('en-US');
  const d = new Date(isoOrStr);
  if (isNaN(d.getTime())) return String(isoOrStr);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Generate standard ESC/POS bytes for 80mm thermal kitchen ticket
 */
export function formatTicketBytes(order: KitchenOrder): Buffer {
  const parts: Buffer[] = [];

  // ESC @: Initialize printer
  parts.push(Buffer.from([0x1b, 0x40]));

  // ESC a 1: Center alignment
  parts.push(Buffer.from([0x1b, 0x61, 0x01]));

  // ESC ! 0x30: Double-height + Double-width bold header
  parts.push(Buffer.from([0x1b, 0x21, 0x30]));
  parts.push(Buffer.from('SEDONA COURT\n'));

  // ESC ! 0x10: Double-height title
  parts.push(Buffer.from([0x1b, 0x21, 0x10]));
  parts.push(Buffer.from('KITCHEN ORDER TICKET\n'));

  // ESC ! 0x00: Normal text
  parts.push(Buffer.from([0x1b, 0x21, 0x00]));
  parts.push(Buffer.from('==========================================\n'));

  // ESC a 0: Left alignment
  parts.push(Buffer.from([0x1b, 0x61, 0x00]));

  const roomLabel = order.room_number === 'WALK-IN' 
    ? 'WALK-IN GUEST' 
    : order.room_number === '12' 
    ? 'ROOM 12 (STAFF HOUSE)' 
    : `ROOM ${order.room_number}`;

  // ESC E 1: Bold on for Room and Order #
  parts.push(Buffer.from([0x1b, 0x45, 0x01]));
  parts.push(Buffer.from(`ORDER #:   ${order.order_number}\n`));
  parts.push(Buffer.from(`ROOM:      ${roomLabel}\n`));
  parts.push(Buffer.from([0x1b, 0x45, 0x00]));

  parts.push(Buffer.from(`TIME:      ${formatTicketTime(order.ordered_at)}\n`));
  parts.push(Buffer.from(`SERVER:    ${order.cashier_name || 'Frontdesk'}\n`));
  if (order.receipt_no) {
    parts.push(Buffer.from(`RECEIPT:   ${order.receipt_no}\n`));
  }

  if (order.priority === 'urgent') {
    parts.push(Buffer.from([0x1b, 0x45, 0x01]));
    parts.push(Buffer.from('*** PRIORITY: URGENT ***\n'));
    parts.push(Buffer.from([0x1b, 0x45, 0x00]));
  }

  parts.push(Buffer.from('------------------------------------------\n'));
  parts.push(Buffer.from('QTY   ITEM DESCRIPTION\n'));
  parts.push(Buffer.from('------------------------------------------\n'));

  const items = Array.isArray(order.items) ? order.items : [];
  for (const item of items) {
    const qtyStr = String(item.quantity).padStart(3, ' ');
    parts.push(Buffer.from([0x1b, 0x45, 0x01]));
    parts.push(Buffer.from(`${qtyStr}   ${item.name}\n`));
    parts.push(Buffer.from([0x1b, 0x45, 0x00]));

    if (item.special_instructions) {
      parts.push(Buffer.from(`       * NOTE: ${item.special_instructions}\n`));
    }
  }

  parts.push(Buffer.from('------------------------------------------\n'));
  parts.push(Buffer.from(`TOTAL ITEMS: ${order.total_items || items.reduce((s, i) => s + i.quantity, 0)}\n`));

  if (order.special_instructions) {
    parts.push(Buffer.from(`ORDER NOTES: ${order.special_instructions}\n`));
  }

  // Footer & Feed
  parts.push(Buffer.from('==========================================\n\n\n\n'));

  // GS V A 3: Full paper cut with 3 line feed
  parts.push(Buffer.from([0x1d, 0x56, 0x41, 0x03]));

  return Buffer.concat(parts);
}

/**
 * Send raw byte payload to network ESC/POS printer via TCP socket
 */
export function sendToNetworkPrinter(
  payload: Buffer,
  ip: string,
  port: number,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      const canWriteMore = socket.write(payload, (err) => {
        if (err) {
          if (!settled) {
            settled = true;
            cleanup();
            reject(err);
          }
          return;
        }

        // Allow printer buffer a brief moment to ingest bytes before closing socket
        setTimeout(() => {
          socket.end(() => {
            if (!settled) {
              settled = true;
              cleanup();
              resolve();
            }
          });
        }, 150);
      });

      if (!canWriteMore) {
        socket.once('drain', () => {
          // Socket buffer drained
        });
      }
    });

    socket.on('timeout', () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Printer connection timed out after ${timeoutMs}ms (${ip}:${port})`));
      }
    });

    socket.on('error', (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    });

    socket.connect(port, ip);
  });
}

/**
 * Background retry worker: attempts to send ticket up to maxRetries
 */
async function executePrintWithRetries(
  orderId: number,
  ticketBuffer: Buffer,
  orderNumber: string
): Promise<{ success: boolean; error?: string }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      // Re-query database to ensure order hasn't already been printed by a parallel worker
      if (attempt > 1) {
        const checkRes = await pool.query('SELECT print_status FROM kitchen_orders WHERE id = ?', [orderId]);
        if (checkRes.rows[0]?.print_status === 'printed') {
          console.log(`[Kitchen Printer] Order ${orderNumber} already marked printed in DB, skipping retry attempt ${attempt}`);
          return { success: true };
        }
      }

      // Record this attempt in the database
      const attemptIso = new Date().toISOString();
      await pool.query(
        `UPDATE kitchen_orders 
         SET print_attempts = print_attempts + 1, updated_at = ?
         WHERE id = ?`,
        [attemptIso, orderId]
      );

      if (config.enabled) {
        await sendToNetworkPrinter(ticketBuffer, config.ip, config.port, config.timeoutMs);
      } else {
        // Disabled / simulation mode: log ticket to stdout without failing
        console.log(`[Printer Simulated] Ticket successfully generated for ${orderNumber} (${ticketBuffer.length} bytes)`);
      }

      // Success: mark order as printed
      const nowIso = new Date().toISOString();
      await pool.query(
        `UPDATE kitchen_orders 
         SET print_status = 'printed', printed_at = ?, print_error = NULL, updated_at = ?
         WHERE id = ?`,
        [nowIso, nowIso, orderId]
      );

      // Record timestamp in in-memory deduplication cache
      recentPrintJobs.set(orderId, Date.now());

      console.log(`🖨️ [Kitchen Printer] Order ${orderNumber} ticket printed successfully on attempt ${attempt}`);

      // Broadcast update to TV & Kitchen displays
      broadcastPrintStatus(orderId, 'printed', nowIso, null);
      return { success: true };
    } catch (err: any) {
      lastError = err;
      console.warn(
        `⚠️ [Kitchen Printer] Print attempt ${attempt}/${config.maxRetries} failed for ${orderNumber}: ${err.message}`
      );

      // Brief exponential backoff between retries: 500ms, 1500ms, etc.
      if (attempt < config.maxRetries) {
        await new Promise((res) => setTimeout(res, attempt * 500));
      }
    }
  }

  // All retries exhausted: mark order as 'failed' with visible error
  const errMsg = lastError?.message || 'Unknown thermal printer connection failure';
  const nowIso = new Date().toISOString();

  await pool.query(
    `UPDATE kitchen_orders 
     SET print_status = 'failed', print_error = ?, updated_at = ?
     WHERE id = ?`,
    [errMsg, nowIso, orderId]
  );

  console.error(
    `❌ [Kitchen Printer] Print failed for order ${orderNumber} after ${config.maxRetries} attempts: ${errMsg}. Order marked as 'failed' for staff visibility.`
  );

  broadcastPrintStatus(orderId, 'failed', null, errMsg);
  return { success: false, error: errMsg };
}

/**
 * Broadcast print status change via Socket.IO
 */
async function broadcastPrintStatus(
  orderId: number,
  status: 'pending' | 'printing' | 'printed' | 'failed',
  printedAt: string | null,
  printError: string | null
): Promise<void> {
  try {
    const res = await pool.query('SELECT * FROM kitchen_orders WHERE id = ?', [orderId]);
    if (res.rows.length > 0) {
      const orderRow = res.rows[0];
      const parsedItems = typeof orderRow.items === 'string' ? JSON.parse(orderRow.items) : orderRow.items;
      const orderPayload = {
        ...orderRow,
        items: parsedItems,
        print_status: status,
        printed_at: printedAt,
        print_error: printError,
      };

      socketManager.broadcast('kitchen:order_updated', orderPayload);
    }
  } catch (err) {
    console.warn('Could not broadcast print status:', err);
  }
}

export class KitchenPrinterService {
  /**
   * Queue a print ticket job for a kitchen order.
   * Runs completely in the background without blocking order creation.
   *
   * @param order The kitchen order to print
   * @param isReprint If true, allows re-printing orders that were already printed or failed
   */
  async printKitchenTicket(
    order: KitchenOrder,
    isReprint: boolean = false
  ): Promise<{ success: boolean; message: string }> {
    const orderId = order.id;

    // 1. In-memory deduplication window check (e.g. rapid double-clicks)
    const lastPrintTime = recentPrintJobs.get(orderId);
    const now = Date.now();
    if (!isReprint && lastPrintTime && (now - lastPrintTime) < DEDUP_WINDOW_MS) {
      console.log(`[Kitchen Printer] In-memory dedup: Order ${order.order_number} was printed ${Math.round((now - lastPrintTime)/1000)}s ago. Skipping duplicate.`);
      return { success: false, message: 'Order was already printed moments ago.' };
    }

    // 2. ATOMIC IDEMPOTENCY GUARD:
    // For automated prints, claim order only if 'pending'.
    // For manual reprints, claim order if NOT currently 'printing'.
    const whereClause = isReprint 
      ? "id = ? AND print_status != 'printing'" 
      : "id = ? AND print_status = 'pending'";

    const claimRes = await pool.query(
      `UPDATE kitchen_orders 
       SET print_status = 'printing', updated_at = datetime('now', 'localtime')
       WHERE ${whereClause}`,
      [orderId]
    );

    if (claimRes.rowCount === 0) {
      if (!isReprint) {
        console.log(`[Kitchen Printer] Duplicate print prevented: order ${order.order_number} is already processed or printing.`);
        return { success: false, message: 'Print already triggered or completed for this order.' };
      } else {
        console.log(`[Kitchen Printer] Reprint ignored: order ${order.order_number} is already in the middle of printing.`);
        return { success: false, message: 'A print job is currently in flight for this order.' };
      }
    }

    // Broadcast 'printing' state immediately so UI shows spinner
    broadcastPrintStatus(orderId, 'printing', null, null);

    // Format ticket bytes
    const ticketBytes = formatTicketBytes(order);

    // 3. FIRE BACKGROUND WORKER ASYNCHRONOUSLY (Non-blocking side-effect)
    setImmediate(() => {
      executePrintWithRetries(orderId, ticketBytes, order.order_number).catch((err) => {
        console.error('Unhandled error in background print execution:', err);
      });
    });

    return { success: true, message: isReprint ? 'Reprint job dispatched' : 'Print job dispatched' };
  }
}

export const kitchenPrinterService = new KitchenPrinterService();
