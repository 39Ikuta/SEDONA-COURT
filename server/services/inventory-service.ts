/**
 * server/services/inventory-service.ts
 * Append-only inventory ledger and stock tracking service for Sedona Court PMS.
 *
 * Core Principles:
 * 1. Event Log Ledger: Every stock entry or decrement writes to append-only `inventory_events`.
 * 2. Current Quantity: Cached in `menu_item_inventory`, strictly updated in the same transaction as the event.
 * 3. Atomic Decrements: Checked and decremented atomically within order transaction; no negative stock allowed.
 * 4. Shift & Operator Attribution: Every event records shift_id (e.g. 2026-09-05_DAY) and server-derived operator.
 * 5. Daily & Weekly Reporting: Aggregates starting counts, sets, consumptions, ending balances, and zero-stock events.
 */

import { pool, withTransaction, TransactionClient } from '../db/pool';
import { format, parseISO, startOfWeek, endOfWeek, addDays } from 'date-fns';
import ExcelJS from 'exceljs';
import { socketManager } from '../websocket/socket-manager';
import {
  styleHeaderRow,
  addTitleBlock,
  asInt,
  statusFill,
  styleTotalsRow,
  setupPrint,
} from '../utils/excel-theme';

export interface MenuItemInventoryRow {
  item_id: string;
  item_name: string;
  category: string;
  current_quantity: number;
  is_tracked: number;
  last_event_id?: string | null;
  last_shift_id?: string | null;
  last_updated_by?: string | null;
  updated_at: string;
}

export interface InventoryEventRow {
  id: string;
  item_id: string;
  item_name: string;
  event_type: 'stock_set' | 'sold' | 'adjustment';
  quantity_change: number;
  balance_after: number;
  shift_id: string;
  shift_type: 'DAY' | 'NIGHT';
  reference_id?: string | null;
  operator: string;
  notes?: string | null;
  created_at: string;
}

export interface ShiftInfo {
  shiftId: string;
  shiftType: 'DAY' | 'NIGHT';
  dateStr: string;
}

export class InventoryService {
  /**
   * Determine current operational shift and shift ID.
   * DAY: 06:00 - 18:00
   * NIGHT: 18:00 - 06:00
   */
  getShiftInfo(date: Date = new Date()): ShiftInfo {
    const hour = date.getHours();
    const shiftType: 'DAY' | 'NIGHT' = hour >= 6 && hour < 18 ? 'DAY' : 'NIGHT';
    const dateStr = format(date, 'yyyy-MM-dd');
    return {
      shiftId: `${dateStr}_${shiftType}`,
      shiftType,
      dateStr,
    };
  }

  /**
   * Get all menu items with current available stock and tracking status.
   */
  async getCurrentInventory(): Promise<MenuItemInventoryRow[]> {
    const result = await pool.query<MenuItemInventoryRow>(`
      SELECT item_id, item_name, category, current_quantity, is_tracked,
             last_event_id, last_shift_id, last_updated_by, updated_at
      FROM menu_item_inventory
      ORDER BY category ASC, item_name ASC
    `);
    return result.rows.map(row => ({
      ...row,
      current_quantity: Number(row.current_quantity || 0),
      is_tracked: Number(row.is_tracked || 0),
    }));
  }

  /**
   * Set stock count for a menu item (explicit stock-count-as-of-now overwrite).
   * Appends a 'stock_set' event and updates menu_item_inventory inside an atomic transaction.
   */
  async setStockCount(
    itemId: string,
    quantity: number,
    operator: string,
    notes?: string,
    isTracked: boolean = true,
    client?: TransactionClient
  ): Promise<{ item: MenuItemInventoryRow; event: InventoryEventRow }> {
    if (!Number.isInteger(quantity) || quantity < 0) {
      const err: any = new Error(`Quantity must be a non-negative integer. Received: ${quantity}`);
      err.statusCode = 400;
      throw err;
    }

    const execute = async (conn: TransactionClient) => {
      // 1. Fetch existing item or create if not present
      let currentItem = (
        await conn.query<MenuItemInventoryRow>(
          'SELECT * FROM menu_item_inventory WHERE item_id = ?',
          [itemId]
        )
      ).rows[0];

      if (!currentItem) {
        // Look up in billable_services
        const svcResult = await conn.query(
          'SELECT id, name, category FROM billable_services WHERE id = ?',
          [itemId]
        );
        const svc = svcResult.rows[0];
        const itemName = svc ? svc.name : itemId;
        const category = svc ? svc.category : 'General';

        await conn.query(
          `INSERT INTO menu_item_inventory (item_id, item_name, category, current_quantity, is_tracked)
           VALUES (?, ?, ?, 0, ?)`,
          [itemId, itemName, category, isTracked ? 1 : 0]
        );

        currentItem = {
          item_id: itemId,
          item_name: itemName,
          category,
          current_quantity: 0,
          is_tracked: isTracked ? 1 : 0,
          updated_at: new Date().toISOString(),
        };
      }

      const prevQty = Number(currentItem.current_quantity || 0);
      const delta = quantity - prevQty;
      const shift = this.getShiftInfo();
      const eventId = `inv-evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const nowIso = new Date().toISOString();

      // 2. Insert append-only ledger event
      await conn.query(
        `INSERT INTO inventory_events (
          id, item_id, item_name, event_type, quantity_change, balance_after,
          shift_id, shift_type, reference_id, operator, notes, created_at
        ) VALUES (?, ?, ?, 'stock_set', ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          eventId,
          itemId,
          currentItem.item_name,
          delta,
          quantity,
          shift.shiftId,
          shift.shiftType,
          operator,
          notes || (prevQty === 0 ? 'Initial shift stock count' : `Recount: adjusted from ${prevQty} to ${quantity}`),
          nowIso,
        ]
      );

      // 3. Update cached availability
      await conn.query(
        `UPDATE menu_item_inventory
         SET current_quantity = ?,
             is_tracked = ?,
             last_event_id = ?,
             last_shift_id = ?,
             last_updated_by = ?,
             updated_at = ?
         WHERE item_id = ?`,
        [
          quantity,
          isTracked ? 1 : 0,
          eventId,
          shift.shiftId,
          operator,
          nowIso,
          itemId,
        ]
      );

      const updatedRow = (
        await conn.query<MenuItemInventoryRow>(
          'SELECT * FROM menu_item_inventory WHERE item_id = ?',
          [itemId]
        )
      ).rows[0];

      const eventRow: InventoryEventRow = {
        id: eventId,
        item_id: itemId,
        item_name: currentItem.item_name,
        event_type: 'stock_set',
        quantity_change: delta,
        balance_after: quantity,
        shift_id: shift.shiftId,
        shift_type: shift.shiftType,
        operator,
        notes: notes || null,
        created_at: nowIso,
      };

      return { item: updatedRow, event: eventRow };
    };

    if (client) {
      return execute(client);
    }
    return withTransaction(execute);
  }

  /**
   * Batch update stock counts (e.g. cashier shift start setup).
   */
  async batchSetStockCounts(
    items: Array<{ itemId: string; quantity: number; isTracked?: boolean }>,
    operator: string,
    notes?: string
  ): Promise<MenuItemInventoryRow[]> {
    return withTransaction(async (conn) => {
      const results: MenuItemInventoryRow[] = [];
      for (const it of items) {
        const res = await this.setStockCount(
          it.itemId,
          it.quantity,
          operator,
          notes,
          it.isTracked ?? true,
          conn
        );
        results.push(res.item);
      }
      return results;
    });
  }

  /**
   * Add a new item or register an untracked billable service into menu_item_inventory.
   */
  async addNewInventoryItem(
    item: {
      itemId?: string;
      itemName: string;
      category: string;
      initialQuantity?: number;
      price?: number;
      isTracked?: boolean;
      description?: string;
    },
    operator: string
  ): Promise<MenuItemInventoryRow> {
    const rawId = (item.itemId || `inv-${item.category.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${item.itemName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`).trim();
    const itemId = rawId.length > 0 ? rawId : `item-${Date.now()}`;
    const initialQty = Math.max(0, parseInt(String(item.initialQuantity || 0), 10));
    const isTracked = item.isTracked !== undefined ? (item.isTracked ? 1 : 0) : 1;

    return withTransaction(async (conn) => {
      // 1. Ensure item exists in billable_services if price is provided
      if (item.price !== undefined && item.price >= 0) {
        await conn.query(
          `INSERT INTO billable_services (id, type, name, price, category, active, description, is_deleted)
           VALUES (?, 'service', ?, ?, ?, 1, ?, 0)
           ON CONFLICT (id) DO UPDATE SET
             name = excluded.name,
             price = excluded.price,
             category = excluded.category,
             active = 1,
             is_deleted = 0`,
          [itemId, item.itemName, item.price, item.category, item.description || null]
        );
      }

      // 2. Insert or update menu_item_inventory
      await conn.query(
        `INSERT INTO menu_item_inventory (item_id, item_name, category, current_quantity, is_tracked, last_updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
         ON CONFLICT (item_id) DO UPDATE SET
           item_name = excluded.item_name,
           category = excluded.category,
           is_tracked = excluded.is_tracked`,
        [itemId, item.itemName, item.category, initialQty, isTracked, operator]
      );

      // 3. If initialQty > 0, log an inventory event
      if (initialQty > 0) {
        const shift = this.getShiftInfo();
        const eventId = `inv-evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        const nowIso = new Date().toISOString();

        await conn.query(
          `INSERT INTO inventory_events (
            id, item_id, item_name, event_type, quantity_change, balance_after,
            shift_id, shift_type, reference_id, operator, notes, created_at
          ) VALUES (?, ?, ?, 'stock_set', ?, ?, ?, ?, NULL, ?, 'Initial inventory setup', ?)`,
          [eventId, itemId, item.itemName, initialQty, initialQty, shift.shiftId, shift.shiftType, operator, nowIso]
        );

        await conn.query(
          `UPDATE menu_item_inventory
           SET current_quantity = ?, last_event_id = ?, last_shift_id = ?, last_updated_by = ?, updated_at = ?
           WHERE item_id = ?`,
          [initialQty, eventId, shift.shiftId, operator, nowIso, itemId]
        );
      }

      const res = await conn.query<MenuItemInventoryRow>(
        'SELECT * FROM menu_item_inventory WHERE item_id = ?',
        [itemId]
      );
      return res.rows[0];
    });
  }

  /**
   * Atomically check and decrement stock for a list of ordered items.
   * MUST be executed inside an active transaction.
   * Throws HTTP 400 error if any tracked item has insufficient stock.
   */
  async atomicDecrementStock(
    items: Array<{ item_id: string; quantity: number; name?: string }>,
    orderNumber: string,
    operator: string,
    conn: TransactionClient
  ): Promise<InventoryEventRow[]> {
    const shift = this.getShiftInfo();
    const eventRows: InventoryEventRow[] = [];

    for (const orderItem of items) {
      const qtyToDeduct = Number(orderItem.quantity);
      if (!qtyToDeduct || qtyToDeduct <= 0) continue;

      // Fetch current stock
      const checkRes = await conn.query<MenuItemInventoryRow>(
        'SELECT * FROM menu_item_inventory WHERE item_id = ?',
        [orderItem.item_id]
      );

      // If item is not in menu_item_inventory, check if it exists in billable_services
      let currentItem = checkRes.rows[0];
      if (!currentItem) {
        const svcRes = await conn.query(
          'SELECT id, name, category, type FROM billable_services WHERE id = ?',
          [orderItem.item_id]
        );
        if (svcRes.rows.length === 0) {
          // Not a tracked item (e.g. generic custom charge); skip inventory decrement
          continue;
        }
        // It is an item without prior stock set (defaults to 0 available)
        const svc = svcRes.rows[0];
        await conn.query(
          `INSERT INTO menu_item_inventory (item_id, item_name, category, current_quantity, is_tracked)
           VALUES (?, ?, ?, 0, 1)`,
          [svc.id, svc.name, svc.category]
        );
        currentItem = {
          item_id: svc.id,
          item_name: svc.name,
          category: svc.category,
          current_quantity: 0,
          is_tracked: 1,
          updated_at: new Date().toISOString(),
        };
      }

      // If not tracked, skip check & decrement
      if (currentItem.is_tracked === 0) {
        continue;
      }

      const available = Number(currentItem.current_quantity || 0);

      // Check available stock
      if (available < qtyToDeduct) {
        const err: any = new Error(
          `Insufficient stock for "${currentItem.item_name}": available ${available}, requested ${qtyToDeduct}`
        );
        err.statusCode = 400;
        throw err;
      }

      const balanceAfter = available - qtyToDeduct;
      const eventId = `inv-evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const nowIso = new Date().toISOString();

      // Append 'sold' event
      await conn.query(
        `INSERT INTO inventory_events (
          id, item_id, item_name, event_type, quantity_change, balance_after,
          shift_id, shift_type, reference_id, operator, notes, created_at
        ) VALUES (?, ?, ?, 'sold', ?, ?, ?, ?, ?, ?, 'Kitchen Order', ?)`,
        [
          eventId,
          currentItem.item_id,
          currentItem.item_name,
          -qtyToDeduct,
          balanceAfter,
          shift.shiftId,
          shift.shiftType,
          orderNumber,
          operator,
          nowIso,
        ]
      );

      // Update menu_item_inventory
      await conn.query(
        `UPDATE menu_item_inventory
         SET current_quantity = ?,
             last_event_id = ?,
             last_shift_id = ?,
             last_updated_by = ?,
             updated_at = ?
         WHERE item_id = ?`,
        [
          balanceAfter,
          eventId,
          shift.shiftId,
          operator,
          nowIso,
          currentItem.item_id,
        ]
      );

      eventRows.push({
        id: eventId,
        item_id: currentItem.item_id,
        item_name: currentItem.item_name,
        event_type: 'sold',
        quantity_change: -qtyToDeduct,
        balance_after: balanceAfter,
        shift_id: shift.shiftId,
        shift_type: shift.shiftType,
        reference_id: orderNumber,
        operator,
        notes: 'Kitchen Order',
        created_at: nowIso,
      });
    }

    return eventRows;
  }

  /**
   * Decrement stock for a single item with optional softFail.
   * If softFail=true, does not throw when stock < requested; deducts to 0 instead.
   */
  async decrementStock(
    itemId: string,
    quantity: number,
    operator: string,
    referenceId?: string,
    notes?: string,
    softFail: boolean = false,
    client?: TransactionClient
  ): Promise<InventoryEventRow | null> {
    const execute = async (conn: TransactionClient): Promise<InventoryEventRow | null> => {
      const shift = this.getShiftInfo();
      const checkRes = await conn.query<MenuItemInventoryRow>(
        'SELECT * FROM menu_item_inventory WHERE item_id = ?',
        [itemId]
      );

      let currentItem = checkRes.rows[0];
      if (!currentItem) {
        const svcRes = await conn.query(
          'SELECT id, name, category FROM billable_services WHERE id = ?',
          [itemId]
        );
        if (svcRes.rows.length === 0) return null;
        const svc = svcRes.rows[0];
        await conn.query(
          `INSERT INTO menu_item_inventory (item_id, item_name, category, current_quantity, is_tracked)
           VALUES (?, ?, ?, 0, 1)`,
          [svc.id, svc.name, svc.category]
        );
        currentItem = {
          item_id: svc.id,
          item_name: svc.name,
          category: svc.category,
          current_quantity: 0,
          is_tracked: 1,
          updated_at: new Date().toISOString(),
        };
      }

      if (currentItem.is_tracked === 0) return null;

      const available = Number(currentItem.current_quantity || 0);
      let actualDeduct = quantity;

      if (available < quantity) {
        if (softFail) {
          actualDeduct = available;
          console.warn(`[Inventory] Soft deduct for "${currentItem.item_name}": wanted ${quantity}, had ${available}. Deducted to 0.`);
        } else {
          const err: any = new Error(
            `Insufficient stock for "${currentItem.item_name}": available ${available}, requested ${quantity}`
          );
          err.statusCode = 400;
          throw err;
        }
      }

      if (actualDeduct <= 0) return null;

      const balanceAfter = Math.max(0, available - actualDeduct);
      const eventId = `inv-evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const nowIso = new Date().toISOString();

      await conn.query(
        `INSERT INTO inventory_events (
          id, item_id, item_name, event_type, quantity_change, balance_after,
          shift_id, shift_type, reference_id, operator, notes, created_at
        ) VALUES (?, ?, ?, 'sold', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          currentItem.item_id,
          currentItem.item_name,
          -actualDeduct,
          balanceAfter,
          shift.shiftId,
          shift.shiftType,
          referenceId || null,
          operator,
          notes || 'Auto Deduct',
          nowIso,
        ]
      );

      await conn.query(
        `UPDATE menu_item_inventory
         SET current_quantity = ?,
             last_event_id = ?,
             last_shift_id = ?,
             last_updated_by = ?,
             updated_at = ?
         WHERE item_id = ?`,
        [
          balanceAfter,
          eventId,
          shift.shiftId,
          operator,
          nowIso,
          currentItem.item_id,
        ]
      );

      return {
        id: eventId,
        item_id: currentItem.item_id,
        item_name: currentItem.item_name,
        event_type: 'sold',
        quantity_change: -actualDeduct,
        balance_after: balanceAfter,
        shift_id: shift.shiftId,
        shift_type: shift.shiftType,
        reference_id: referenceId || null,
        operator,
        notes: notes || 'Auto Deduct',
        created_at: nowIso,
      };
    };

    if (client) {
      return execute(client);
    }
    return withTransaction(execute);
  }

  /**
   * Daily Report: Aggregates stock entries, consumption, ending balance, and zero-stock events for a given day.
   */
  async getDailyReport(dateStr: string): Promise<any> {
    // Validate date format YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const err: any = new Error('Invalid date format. Use YYYY-MM-DD');
      err.statusCode = 400;
      throw err;
    }

    const dateObj = parseISO(dateStr);
    if (isNaN(dateObj.getTime())) {
      const err: any = new Error('Invalid date');
      err.statusCode = 400;
      throw err;
    }

    // 1. Fetch all events for this day
    const eventsResult = await pool.query<InventoryEventRow>(
      `SELECT * FROM inventory_events
       WHERE created_at LIKE ? OR created_at LIKE ?
       ORDER BY created_at ASC`,
      [`${dateStr}%`, `${dateStr}T%`]
    );
    const dayEvents = eventsResult.rows;

    // 2. Fetch all menu items
    const allItems = await this.getCurrentInventory();

    // 3. Aggregate per item
    const itemReports = allItems.map((item) => {
      const itemEvts = dayEvents.filter((e) => e.item_id === item.item_id);

      const stockSetEvents = itemEvts
        .filter((e) => e.event_type === 'stock_set')
        .map((e) => ({
          id: e.id,
          operator: e.operator,
          quantitySet: e.balance_after,
          delta: e.quantity_change,
          shiftId: e.shift_id,
          shiftType: e.shift_type,
          timestamp: e.created_at,
          notes: e.notes,
        }));

      const soldEvents = itemEvts.filter((e) => e.event_type === 'sold');
      const totalSold = soldEvents.reduce((sum, e) => sum + Math.abs(e.quantity_change), 0);

      const zeroStockEvents = itemEvts
        .filter((e) => e.balance_after === 0)
        .map((e) => ({
          timestamp: e.created_at,
          operator: e.operator,
          referenceId: e.reference_id,
          shiftId: e.shift_id,
          eventType: e.event_type,
        }));

      // Starting quantity: balance before first event of the day, or current quantity if no events
      let startingQuantity = item.current_quantity;
      if (itemEvts.length > 0) {
        const firstEvt = itemEvts[0];
        startingQuantity = firstEvt.balance_after - firstEvt.quantity_change;
      }

      // Ending quantity: balance after last event of the day, or current quantity
      let endingQuantity = item.current_quantity;
      if (itemEvts.length > 0) {
        endingQuantity = itemEvts[itemEvts.length - 1].balance_after;
      }

      return {
        itemId: item.item_id,
        itemName: item.item_name,
        category: item.category,
        isTracked: Boolean(item.is_tracked),
        startingQuantity,
        stockSetEvents,
        totalSold,
        endingQuantity,
        zeroStockEvents,
        isOutOfStock: endingQuantity === 0 && Boolean(item.is_tracked),
      };
    });

    const totalSoldAll = itemReports.reduce((s, it) => s + it.totalSold, 0);
    const outOfStockCount = itemReports.filter((it) => it.isOutOfStock).length;
    const trackedCount = itemReports.filter((it) => it.isTracked).length;

    return {
      period: {
        date: dateStr,
        dayOfWeek: format(dateObj, 'EEE').toUpperCase(),
        formattedDate: format(dateObj, 'MMMM dd, yyyy'),
      },
      summary: {
        totalTrackedItems: trackedCount,
        totalUnitsSold: totalSoldAll,
        itemsOutOfStock: outOfStockCount,
        eventsCount: dayEvents.length,
      },
      items: itemReports,
    };
  }

  /**
   * Weekly Report: Aggregates across Monday-to-Sunday week, following weekly-reports.ts.
   */
  async getWeeklyReport(weekStartStr: string): Promise<any> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartStr)) {
      const err: any = new Error('Invalid weekStart format. Use YYYY-MM-DD');
      err.statusCode = 400;
      throw err;
    }

    const start = parseISO(weekStartStr);
    if (isNaN(start.getTime())) {
      const err: any = new Error('Invalid date');
      err.statusCode = 400;
      throw err;
    }

    const weekStartObj = startOfWeek(start, { weekStartsOn: 1 });
    const weekEndObj = endOfWeek(start, { weekStartsOn: 1 });
    const weekStartFormatted = format(weekStartObj, 'yyyy-MM-dd');
    const weekEndFormatted = format(weekEndObj, 'yyyy-MM-dd');

    // Fetch all events for the 7 days
    const eventsResult = await pool.query<InventoryEventRow>(
      `SELECT * FROM inventory_events
       WHERE created_at >= ? AND created_at <= ?
       ORDER BY created_at ASC`,
      [`${weekStartFormatted} 00:00:00`, `${weekEndFormatted} 23:59:59`]
    );
    const weekEvents = eventsResult.rows;

    const allItems = await this.getCurrentInventory();

    // 7 days interval
    const dailyBreakdowns: any[] = [];
    for (let i = 0; i < 7; i++) {
      const dayDate = addDays(weekStartObj, i);
      const dayStr = format(dayDate, 'yyyy-MM-dd');
      const dayEvts = weekEvents.filter((e) => e.created_at.startsWith(dayStr));
      const unitsSold = dayEvts
        .filter((e) => e.event_type === 'sold')
        .reduce((sum, e) => sum + Math.abs(e.quantity_change), 0);

      dailyBreakdowns.push({
        date: dayStr,
        dayOfWeek: format(dayDate, 'EEE').toUpperCase(),
        eventsCount: dayEvts.length,
        unitsSold,
      });
    }

    // Aggregate per item for the whole week
    const itemReports = allItems.map((item) => {
      const itemEvts = weekEvents.filter((e) => e.item_id === item.item_id);

      const stockSetEvents = itemEvts
        .filter((e) => e.event_type === 'stock_set')
        .map((e) => ({
          id: e.id,
          operator: e.operator,
          quantitySet: e.balance_after,
          delta: e.quantity_change,
          shiftId: e.shift_id,
          shiftType: e.shift_type,
          timestamp: e.created_at,
          notes: e.notes,
        }));

      const totalSold = itemEvts
        .filter((e) => e.event_type === 'sold')
        .reduce((sum, e) => sum + Math.abs(e.quantity_change), 0);

      const zeroStockEvents = itemEvts
        .filter((e) => e.balance_after === 0)
        .map((e) => ({
          timestamp: e.created_at,
          operator: e.operator,
          referenceId: e.reference_id,
          shiftId: e.shift_id,
        }));

      let startingQuantity = item.current_quantity;
      if (itemEvts.length > 0) {
        const firstEvt = itemEvts[0];
        startingQuantity = firstEvt.balance_after - firstEvt.quantity_change;
      }

      let endingQuantity = item.current_quantity;
      if (itemEvts.length > 0) {
        endingQuantity = itemEvts[itemEvts.length - 1].balance_after;
      }

      return {
        itemId: item.item_id,
        itemName: item.item_name,
        category: item.category,
        isTracked: Boolean(item.is_tracked),
        startingQuantity,
        stockSetCount: stockSetEvents.length,
        stockSetEvents,
        totalSold,
        endingQuantity,
        zeroStockEventsCount: zeroStockEvents.length,
        zeroStockEvents,
        isOutOfStock: endingQuantity === 0 && Boolean(item.is_tracked),
      };
    });

    const totalSoldAll = itemReports.reduce((s, it) => s + it.totalSold, 0);
    const outOfStockCount = itemReports.filter((it) => it.isOutOfStock).length;

    return {
      period: {
        weekStart: weekStartFormatted,
        weekEnd: weekEndFormatted,
        weekLabel: `${format(weekStartObj, 'MMM dd')} - ${format(weekEndObj, 'MMM dd, yyyy')}`,
      },
      summary: {
        totalTrackedItems: allItems.length,
        totalUnitsSold: totalSoldAll,
        itemsCurrentlyOutOfStock: outOfStockCount,
        totalEventsInWeek: weekEvents.length,
      },
      dailyBreakdowns,
      items: itemReports,
    };
  }

  /**
   * Formats daily or weekly report data as standard RFC 4180 CSV string.
   */
  formatReportAsCsv(reportData: any, type: 'daily' | 'weekly'): string {
    const lines: string[] = [];

    // Title & Metadata
    lines.push(`"SEDONA COURT TRAVELLERS INN - ${type === 'daily' ? 'DAILY' : 'WEEKLY'} MENU INVENTORY REPORT"`);
    if (type === 'daily') {
      lines.push(`"Date: ${reportData.period.date} (${reportData.period.dayOfWeek}) - ${reportData.period.formattedDate}"`);
    } else {
      lines.push(`"Period: ${reportData.period.weekLabel} (${reportData.period.weekStart} to ${reportData.period.weekEnd})"`);
    }
    lines.push(`"Generated At: ${new Date().toISOString()}"`);
    lines.push('');

    // Summary block
    lines.push('"SUMMARY"');
    lines.push(`"Total Items Tracked",${reportData.summary.totalTrackedItems}`);
    lines.push(`"Total Units Sold / Consumed",${reportData.summary.totalUnitsSold}`);
    lines.push(`"Items Out of Stock",${type === 'daily' ? reportData.summary.itemsOutOfStock : reportData.summary.itemsCurrentlyOutOfStock}`);
    lines.push('');

    // Table headers
    lines.push(
      [
        '"Item ID"',
        '"Item Name"',
        '"Category"',
        '"Starting Qty"',
        '"Total Stock Sets"',
        '"Units Sold"',
        '"Ending Qty"',
        '"Status"',
        '"Zero-Stock Occurrences"',
        '"Latest Stock-Set Operator & Time"',
      ].join(',')
    );

    // Rows
    for (const it of reportData.items) {
      const latestSet = it.stockSetEvents && it.stockSetEvents.length > 0
        ? it.stockSetEvents[it.stockSetEvents.length - 1]
        : null;

      const latestSetInfo = latestSet
        ? `${latestSet.operator} (set to ${latestSet.quantitySet} at ${latestSet.timestamp.slice(11, 16)})`
        : 'N/A';

      const status = !it.isTracked ? 'Untracked' : it.endingQuantity === 0 ? 'OUT OF STOCK' : 'Available';
      const zeroEventsCount = it.zeroStockEvents ? it.zeroStockEvents.length : 0;

      lines.push(
        [
          `"${it.itemId}"`,
          `"${it.itemName.replace(/"/g, '""')}"`,
          `"${it.category.replace(/"/g, '""')}"`,
          it.startingQuantity,
          it.stockSetEvents ? it.stockSetEvents.length : 0,
          it.totalSold,
          it.endingQuantity,
          `"${status}"`,
          zeroEventsCount,
          `"${latestSetInfo}"`,
        ].join(',')
      );
    }

    return lines.join('\r\n');
  }

  /**
   * Formats daily or weekly report data as a styled XLSX workbook buffer
   * (shared DB-workbook theme). Same data as formatReportAsCsv, beautified.
   */
  async formatReportAsWorkbook(reportData: any, type: 'daily' | 'weekly'): Promise<Buffer> {
    const isDaily = type === 'daily';
    const periodLabel = isDaily
      ? `Date: ${reportData.period.date} (${reportData.period.dayOfWeek}) — ${reportData.period.formattedDate}`
      : `Period: ${reportData.period.weekLabel} (${reportData.period.weekStart} to ${reportData.period.weekEnd})`;
    const controlNo = `INV-${(isDaily ? reportData.period.date : reportData.period.weekStart).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sedona Court PMS (server)';
    wb.created = new Date();

    // ── Sheet 1: movement table ──
    const ws = wb.addWorksheet(isDaily ? 'Daily Inventory' : 'Weekly Inventory');
    const headers = [
      'ITEM ID', 'ITEM NAME', 'CATEGORY', 'TRACKED',
      'STARTING QTY', 'STOCK SETS', 'UNITS SOLD', 'ENDING QTY',
      'STATUS', 'ZERO-STOCK HITS', 'LAST SET BY & AT',
    ];
    ws.columns = [
      { width: 18 }, { width: 32 }, { width: 18 }, { width: 10 },
      { width: 13 }, { width: 12 }, { width: 12 }, { width: 12 },
      { width: 15 }, { width: 15 }, { width: 30 },
    ];
    const r0 = addTitleBlock(
      ws,
      isDaily ? 'DAILY MENU INVENTORY REPORT' : 'WEEKLY MENU INVENTORY REPORT',
      `${periodLabel} | Generated: ${new Date().toISOString()}`,
      controlNo,
      headers.length
    );
    headers.forEach((h, i) => {
      ws.getCell(r0, i + 1).value = h;
    });
    styleHeaderRow(ws, r0, headers.length);

    let r = r0 + 1;
    for (const it of reportData.items) {
      const latestSet = it.stockSetEvents && it.stockSetEvents.length > 0
        ? it.stockSetEvents[it.stockSetEvents.length - 1]
        : null;
      const status = !it.isTracked ? 'Untracked' : it.endingQuantity === 0 ? 'OUT OF STOCK' : it.endingQuantity <= 3 ? 'LOW' : 'Available';
      const vals: Array<number | string> = [
        it.itemId,
        it.itemName,
        it.category,
        it.isTracked ? 'YES' : 'NO',
        Number(it.startingQuantity || 0),
        it.stockSetEvents ? it.stockSetEvents.length : 0,
        Number(it.totalSold || 0),
        Number(it.endingQuantity || 0),
        status,
        it.zeroStockEvents ? it.zeroStockEvents.length : (it.zeroStockEventsCount || 0),
        latestSet ? `${latestSet.operator} → ${latestSet.quantitySet} @ ${String(latestSet.timestamp || '').slice(0, 16)}` : 'N/A',
      ];
      vals.forEach((v, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = v;
        cell.border = {
          top: { style: 'thin' }, bottom: { style: 'thin' },
          left: { style: 'thin' }, right: { style: 'thin' },
        };
        if (typeof v === 'number') {
          asInt(cell);
          cell.alignment = { horizontal: 'right' };
        }
      });
      const statusCell = ws.getCell(r, 9);
      if (status === 'OUT OF STOCK') statusFill(statusCell, 'bad');
      else if (status === 'LOW') statusFill(statusCell, 'warn');
      else if (status === 'Available') statusFill(statusCell, 'good');
      r += 1;
    }

    const outOfStock = isDaily ? reportData.summary.itemsOutOfStock : reportData.summary.itemsCurrentlyOutOfStock;
    const summaryVals: Array<number | string> = [
      `TOTALS (${reportData.items.length} items)`, '', '', '',
      '', '',
      Number(reportData.summary.totalUnitsSold || 0),
      '',
      `${outOfStock} out of stock`,
      '', '',
    ];
    summaryVals.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = v;
      if (typeof v === 'number') {
        asInt(cell);
        cell.alignment = { horizontal: 'right' };
      }
    });
    styleTotalsRow(ws.getRow(r), headers.length);
    ws.views = [{ state: 'frozen', ySplit: r0 }];
    ws.pageSetup = {
      ...ws.pageSetup, paperSize: 9, orientation: 'landscape',
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    } as ExcelJS.PageSetup;

    // ── Sheet 2: summary ──
    const ws2 = wb.addWorksheet('Summary');
    ws2.columns = [{ width: 32 }, { width: 24 }];
    addTitleBlock(ws2, 'REPORT SUMMARY', periodLabel, controlNo, 2);
    const summaryRows: Array<[string, number | string]> = [
      ['Total Items Tracked', Number(reportData.summary.totalTrackedItems || 0)],
      ['Total Units Sold / Consumed', Number(reportData.summary.totalUnitsSold || 0)],
      ['Items Out of Stock', Number(outOfStock || 0)],
      ['Ledger Events', Number((isDaily ? reportData.summary.eventsCount : reportData.summary.totalEventsInWeek) || 0)],
    ];
    let sr = 6;
    ws2.getCell(`A${sr}`).value = 'METRIC';
    ws2.getCell(`B${sr}`).value = 'VALUE';
    styleHeaderRow(ws2, sr, 2);
    sr += 1;
    for (const [k, v] of summaryRows) {
      ws2.getCell(`A${sr}`).value = k;
      ws2.getCell(`B${sr}`).value = v;
      if (typeof v === 'number') {
        asInt(ws2.getCell(`B${sr}`));
        ws2.getCell(`B${sr}`).alignment = { horizontal: 'right' };
      }
      ws2.getCell(`A${sr}`).border = ws2.getCell(`B${sr}`).border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
      sr += 1;
    }

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}

export const inventoryService = new InventoryService();
