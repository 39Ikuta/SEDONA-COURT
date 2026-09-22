/**
 * server/services/kitchen-orders.ts
 * Service for managing queue-based kitchen orders grouped by room.
 */

import { pool, withTransaction, TransactionClient } from '../db/pool';
import { inventoryService } from './inventory-service';

export interface KitchenOrderItem {
  item_id: string;
  name: string;
  quantity: number;
  special_instructions?: string;
}

export interface KitchenOrder {
  id: number;
  order_number: string;
  receipt_no?: string;
  room_number: string;
  guest_name: string;
  cashier_name: string;
  items: KitchenOrderItem[];
  total_items: number;
  total_amount: number;
  status: 'new' | 'preparing' | 'ready' | 'delivered' | 'cancelled';
  priority: 'normal' | 'urgent';
  ordered_at: string;
  preparing_started_at?: string;
  ready_at?: string;
  delivered_at?: string;
  cancelled_at?: string;
  assigned_to?: string;
  prepared_by?: string;
  delivered_by?: string;
  special_instructions?: string;
  kitchen_notes?: string;
  print_status: 'pending' | 'printing' | 'printed' | 'failed';
  printed_at?: string;
  print_attempts: number;
  print_error?: string;
  created_at: string;
  updated_at: string;
}

export interface RoomQueueGroup {
  room_number: string;
  guest_name: string;
  queue_position: number;
  oldest_ordered_at: string;
  minutes_elapsed: number;
  seconds_remaining?: number;
  minutes_remaining?: number;
  timer_duration_minutes?: number;
  urgency: 'normal' | 'warning' | 'critical';
  orders: KitchenOrder[];
  aggregated_items: { name: string; quantity: number; special_instructions?: string }[];
  total_items_count: number;
  overall_status: 'new' | 'preparing' | 'ready';
}

export interface CreateKitchenOrderData {
  receipt_no?: string;
  room_number: string;
  guest_name: string;
  cashier_name: string;
  items: KitchenOrderItem[];
  total_amount: number;
  special_instructions?: string;
  priority?: 'normal' | 'urgent';
}

function safeIsoTimestamp(val: any): string {
  if (!val) return new Date().toISOString();
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') {
    // If string is in format "YYYY-MM-DD HH:MM:SS" without timezone, parse it
    if (val.includes(' ') && !val.includes('T')) {
      const parsed = new Date(val.replace(' ', 'T') + 'Z');
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

const EGG_CONSUMING_ITEMS = new Set([
  'bf-bangsilog',
  'bf-chicksilog',
  'bf-hotsilog',
  'bf-longsilog',
  'bf-porksilog',
  'bf-tapsilog',
  'fav-lomi',
  'fav-sizzling-sisig-egg',
  'fav-calamares',
  'fav-buttered-chicken',
  'fav-garlic-chicken',
]);

export class KitchenOrderService {
  /**
   * Generate next order number (K-0001, K-0002, etc.)
   */
  private async generateOrderNumber(conn?: TransactionClient): Promise<string> {
    const q = conn ? conn.query.bind(conn) : pool.query.bind(pool);
    const result = await q(`
      SELECT order_number FROM kitchen_orders 
      WHERE order_number LIKE 'K-%' 
      ORDER BY id DESC 
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return 'K-0001';
    }

    const lastNumber = result.rows[0].order_number;
    const numPart = parseInt(lastNumber.substring(2), 10) + 1;
    return `K-${numPart.toString().padStart(4, '0')}`;
  }

  /**
   * Create a new kitchen order.
   * Atomically checks and decrements available menu item inventory in the exact same transaction.
   * If stock is insufficient, throws an error with statusCode 400, rolling back the transaction.
   */
  async createOrder(data: CreateKitchenOrderData, operatorUsername?: string): Promise<KitchenOrder> {
    return withTransaction(async (conn) => {
      const orderNumber = await this.generateOrderNumber(conn);
      const totalItems = data.items.reduce((sum, item) => sum + item.quantity, 0);
      const itemsJson = JSON.stringify(data.items);
      const nowIso = new Date().toISOString();
      const operator = operatorUsername || data.cashier_name || 'cashier';

      // 1. Atomically check and decrement inventory stock
      await inventoryService.atomicDecrementStock(data.items, orderNumber, operator, conn);

      // 1b. Automatically deduct eggs for egg-consuming dishes (softFail = true)
      let totalEggsToDeduct = 0;
      for (const item of data.items) {
        if (EGG_CONSUMING_ITEMS.has(item.item_id)) {
          totalEggsToDeduct += Number(item.quantity || 1);
        }
      }
      if (totalEggsToDeduct > 0) {
        await inventoryService.decrementStock(
          'ext-egg',
          totalEggsToDeduct,
          operator,
          orderNumber,
          `Auto Egg Deduct for ${orderNumber}`,
          true,
          conn
        );
      }

      // 2. Insert kitchen order
      await conn.query(
        `INSERT INTO kitchen_orders (
          order_number, receipt_no, room_number, guest_name, cashier_name,
          items, total_items, total_amount, special_instructions, priority, status,
          ordered_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`,
        [
          orderNumber,
          data.receipt_no || null,
          data.room_number,
          data.guest_name,
          data.cashier_name,
          itemsJson,
          totalItems,
          data.total_amount,
          data.special_instructions || null,
          data.priority || 'normal',
          nowIso,
          nowIso,
          nowIso,
        ]
      );

      const fetchResult = await conn.query('SELECT * FROM kitchen_orders WHERE order_number = ?', [orderNumber]);
      return this.formatOrder(fetchResult.rows[0]);
    });
  }

  /**
   * Auto-expire or clean up stale orders older than maxAgeMinutes (default 30 minutes)
   */
  async cleanupStaleOrders(maxAgeMinutes: number = 30): Promise<number> {
    try {
      const cutoffMs = Date.now() - maxAgeMinutes * 60 * 1000;

      const activeResult = await pool.query(
        `SELECT id, ordered_at FROM kitchen_orders 
         WHERE status IN ('new', 'preparing', 'ready')`
      );

      const staleIds: number[] = [];
      for (const row of activeResult.rows) {
        const orderIso = safeIsoTimestamp(row.ordered_at);
        const orderMs = new Date(orderIso).getTime();
        if (!isNaN(orderMs) && orderMs < cutoffMs) {
          staleIds.push(Number(row.id));
        }
      }

      if (staleIds.length === 0) return 0;

      const nowIso = new Date().toISOString();
      for (const id of staleIds) {
        await pool.query(
          `UPDATE kitchen_orders 
           SET status = 'cancelled', cancelled_at = ?, kitchen_notes = 'Auto-expired after 30 minutes queue timer', updated_at = ?
           WHERE id = ?`,
          [nowIso, nowIso, id]
        );
      }

      return staleIds.length;
    } catch (err) {
      console.warn('cleanupStaleOrders warning:', err);
      return 0;
    }
  }

  /**
   * Get all active orders (new, preparing, ready)
   */
  async getActiveOrders(): Promise<KitchenOrder[]> {
    const result = await pool.query(`
      SELECT * FROM kitchen_orders 
      WHERE status IN ('new', 'preparing', 'ready')
      ORDER BY id ASC
    `);

    return result.rows.map(row => this.formatOrder(row));
  }

  /**
   * Get room-based queue (active orders grouped by room in FIFO order)
   * Enforces a 30-minute live countdown timer; orders older than 30 mins automatically expire.
   */
  async getRoomQueue(): Promise<RoomQueueGroup[]> {
    const TIMER_DURATION_MINUTES = 30;
    const TIMER_DURATION_SECONDS = TIMER_DURATION_MINUTES * 60;

    // Auto-clean orders older than 30 minutes
    await this.cleanupStaleOrders(TIMER_DURATION_MINUTES);

    const activeOrders = await this.getActiveOrders();
    const nowMs = Date.now();

    // Group orders by room_number
    const roomMap = new Map<string, KitchenOrder[]>();
    for (const order of activeOrders) {
      const existing = roomMap.get(order.room_number) || [];
      existing.push(order);
      roomMap.set(order.room_number, existing);
    }

    const queue: RoomQueueGroup[] = [];
    let position = 1;

    for (const [roomNumber, orders] of roomMap.entries()) {
      // Find oldest order for this room
      const oldestOrder = orders.reduce((oldest, current) => {
        const cTime = new Date(current.ordered_at).getTime();
        const oTime = new Date(oldest.ordered_at).getTime();
        return cTime < oTime ? current : oldest;
      }, orders[0]);

      const orderedTimeMs = new Date(oldestOrder.ordered_at).getTime();
      const elapsedSeconds = Math.max(0, Math.floor((nowMs - orderedTimeMs) / 1000));
      const minutesElapsed = Math.floor(elapsedSeconds / 60);
      const secondsRemaining = Math.max(0, TIMER_DURATION_SECONDS - elapsedSeconds);
      const minutesRemaining = Math.ceil(secondsRemaining / 60);

      // If timer has expired (30 mins), skip from active queue
      if (secondsRemaining <= 0) {
        continue;
      }

      let urgency: 'normal' | 'warning' | 'critical' = 'normal';
      if (secondsRemaining <= 180) {
        // Less than 3 minutes remaining
        urgency = 'critical';
      } else if (secondsRemaining <= 420) {
        // Between 3 and 7 minutes remaining
        urgency = 'warning';
      }

      // Aggregate all menu items for this room
      const itemMap = new Map<string, { name: string; quantity: number; special_instructions?: string }>();
      for (const order of orders) {
        for (const item of order.items) {
          const key = item.name + (item.special_instructions ? `_${item.special_instructions}` : '');
          const existing = itemMap.get(key);
          if (existing) {
            existing.quantity += item.quantity;
          } else {
            itemMap.set(key, {
              name: item.name,
              quantity: item.quantity,
              special_instructions: item.special_instructions,
            });
          }
        }
      }

      const aggregatedItems = Array.from(itemMap.values());
      const totalItemsCount = aggregatedItems.reduce((sum, item) => sum + item.quantity, 0);

      // Determine overall status for the room group
      let overallStatus: 'new' | 'preparing' | 'ready' = 'new';
      if (orders.some(o => o.status === 'preparing')) {
        overallStatus = 'preparing';
      } else if (orders.every(o => o.status === 'ready')) {
        overallStatus = 'ready';
      }

      queue.push({
        room_number: roomNumber,
        guest_name: oldestOrder.guest_name,
        queue_position: position++,
        oldest_ordered_at: oldestOrder.ordered_at,
        minutes_elapsed: minutesElapsed,
        seconds_remaining: secondsRemaining,
        minutes_remaining: minutesRemaining,
        timer_duration_minutes: TIMER_DURATION_MINUTES,
        urgency,
        orders,
        aggregated_items: aggregatedItems,
        total_items_count: totalItemsCount,
        overall_status: overallStatus,
      });
    }

    // Sort queue by oldest order time (FIFO)
    queue.sort((a, b) => new Date(a.oldest_ordered_at).getTime() - new Date(b.oldest_ordered_at).getTime());

    // Re-assign queue positions after sort
    queue.forEach((item, index) => {
      item.queue_position = index + 1;
    });

    return queue;
  }

  /**
   * Get specific order by ID
   */
  async getOrderById(id: number): Promise<KitchenOrder | null> {
    const result = await pool.query('SELECT * FROM kitchen_orders WHERE id = ?', [id]);
    if (result.rows.length === 0) return null;
    return this.formatOrder(result.rows[0]);
  }

  /**
   * Update order status
   */
  async updateOrderStatus(
    id: number, 
    status: KitchenOrder['status'], 
    performedBy?: string,
    notes?: string
  ): Promise<KitchenOrder | null> {
    const nowIso = new Date().toISOString();
    let updateFields = 'status = ?, updated_at = ?';
    const params: any[] = [status, nowIso];

    switch (status) {
      case 'preparing':
        updateFields += ', preparing_started_at = ?, assigned_to = ?';
        params.push(nowIso, performedBy || null);
        break;
      case 'ready':
        updateFields += ', ready_at = ?, prepared_by = ?';
        params.push(nowIso, performedBy || null);
        break;
      case 'delivered':
        updateFields += ', delivered_at = ?, delivered_by = ?';
        params.push(nowIso, performedBy || null);
        break;
      case 'cancelled':
        updateFields += ', cancelled_at = ?';
        params.push(nowIso);
        break;
    }

    if (notes) {
      updateFields += ', kitchen_notes = ?';
      params.push(notes);
    }

    params.push(id);

    await pool.query(`UPDATE kitchen_orders SET ${updateFields} WHERE id = ?`, params);

    const fetchResult = await pool.query('SELECT * FROM kitchen_orders WHERE id = ?', [id]);
    if (fetchResult.rows.length === 0) return null;
    return this.formatOrder(fetchResult.rows[0]);
  }

  /**
   * Update status for all active orders of a room
   */
  async updateRoomOrdersStatus(
    roomNumber: string,
    status: KitchenOrder['status'],
    performedBy?: string
  ): Promise<KitchenOrder[]> {
    const activeOrders = await pool.query(
      `SELECT id FROM kitchen_orders WHERE room_number = ? AND status IN ('new', 'preparing', 'ready')`,
      [roomNumber]
    );

    const updated: KitchenOrder[] = [];
    for (const row of activeOrders.rows) {
      const order = await this.updateOrderStatus(row.id, status, performedBy);
      if (order) updated.push(order);
    }

    return updated;
  }

  /**
   * Cancel an order
   */
  async cancelOrder(id: number, reason?: string): Promise<KitchenOrder | null> {
    const nowIso = new Date().toISOString();
    await pool.query(
      `UPDATE kitchen_orders 
       SET status = 'cancelled', cancelled_at = ?, kitchen_notes = ?, updated_at = ?
       WHERE id = ? AND status IN ('new', 'preparing')`,
      [nowIso, reason || null, nowIso, id]
    );

    const fetchResult = await pool.query('SELECT * FROM kitchen_orders WHERE id = ?', [id]);
    if (fetchResult.rows.length === 0) return null;
    return this.formatOrder(fetchResult.rows[0]);
  }

  /**
   * Get orders for a specific room
   */
  async getOrdersByRoom(roomNumber: string): Promise<KitchenOrder[]> {
    const result = await pool.query(
      `SELECT * FROM kitchen_orders 
       WHERE room_number = ?
       ORDER BY id DESC
       LIMIT 10`,
      [roomNumber]
    );

    return result.rows.map(row => this.formatOrder(row));
  }

  /**
   * Get orders associated with a receipt number
   */
  async getOrdersByReceipt(receiptNo: string): Promise<KitchenOrder[]> {
    const result = await pool.query(
      `SELECT * FROM kitchen_orders 
       WHERE receipt_no = ?
       ORDER BY id DESC`,
      [receiptNo]
    );

    return result.rows.map(row => this.formatOrder(row));
  }

  /**
   * Get kitchen performance stats
   */
  async getPerformanceStats(date?: string) {
    const dateFilter = date ? 'DATE(ordered_at) = ?' : 'DATE(ordered_at) = CURRENT_DATE';
    const params = date ? [date] : [];

    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as completed_orders,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
        AVG(
          CASE WHEN delivered_at IS NOT NULL 
          THEN TIMESTAMPDIFF(MINUTE, ordered_at, delivered_at)
          END
        ) as avg_completion_minutes,
        AVG(
          CASE WHEN ready_at IS NOT NULL 
          THEN TIMESTAMPDIFF(MINUTE, preparing_started_at, ready_at)
          END
        ) as avg_preparation_minutes
      FROM kitchen_orders 
      WHERE ${dateFilter}
    `, params);

    return result.rows[0] || {};
  }

  /**
   * Format database row to KitchenOrder interface
   */
  private formatOrder(row: any): KitchenOrder {
    let items = [];
    if (row.items) {
      try {
        items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
      } catch (parseErr) {
        console.warn(`formatOrder: Failed to parse items JSON for order ${row.order_number}:`, parseErr);
        items = [];
      }
    }

    const formatOptIso = (val: any) => {
      if (!val) return undefined;
      return safeIsoTimestamp(val);
    };

    return {
      id: Number(row.id),
      order_number: row.order_number,
      receipt_no: row.receipt_no,
      room_number: String(row.room_number),
      guest_name: row.guest_name,
      cashier_name: row.cashier_name,
      items: items,
      total_items: Number(row.total_items || 0),
      total_amount: parseFloat(row.total_amount || 0),
      status: row.status,
      priority: row.priority,
      ordered_at: safeIsoTimestamp(row.ordered_at),
      preparing_started_at: formatOptIso(row.preparing_started_at),
      ready_at: formatOptIso(row.ready_at),
      delivered_at: formatOptIso(row.delivered_at),
      cancelled_at: formatOptIso(row.cancelled_at),
      assigned_to: row.assigned_to,
      prepared_by: row.prepared_by,
      delivered_by: row.delivered_by,
      special_instructions: row.special_instructions,
      kitchen_notes: row.kitchen_notes,
      print_status: row.print_status || 'pending',
      printed_at: formatOptIso(row.printed_at),
      print_attempts: Number(row.print_attempts || 0),
      print_error: row.print_error || undefined,
      created_at: safeIsoTimestamp(row.created_at),
      updated_at: safeIsoTimestamp(row.updated_at),
    };
  }
}

export const kitchenOrderService = new KitchenOrderService();