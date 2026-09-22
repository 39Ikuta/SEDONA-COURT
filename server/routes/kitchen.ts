/**
 * server/routes/kitchen.ts
 * API endpoints for queue-based kitchen order management and TV display
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { kitchenOrderService, CreateKitchenOrderData } from '../services/kitchen-orders';
import { socketManager } from '../websocket/socket-manager';
import { kitchenPrinterService } from '../services/kitchen-printer';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

/**
 * GET /api/kitchen/queue
 * Get real-time room-based queue
 */
router.get('/queue', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  try {
    const queue = await kitchenOrderService.getRoomQueue();
    res.json(queue);
  } catch (err) {
    console.error('GET /kitchen/queue error:', err);
    res.status(500).json({ error: 'Failed to fetch kitchen queue' });
  }
}));

/**
 * GET /api/kitchen/orders
 * Get all active kitchen orders
 */
router.get('/orders', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  try {
    const orders = await kitchenOrderService.getActiveOrders();
    res.json(orders);
  } catch (err) {
    console.error('GET /kitchen/orders error:', err);
    res.status(500).json({ error: 'Failed to fetch kitchen orders' });
  }
}));

/**
 * GET /api/kitchen/tv/display
 * TV display endpoint: room-based queue + summary statistics
 */
router.get('/tv/display', asyncHandler(async (_req: Request, res: Response) => {
  try {
    const queue = await kitchenOrderService.getRoomQueue();
    const allActiveOrders = await kitchenOrderService.getActiveOrders();
    const now = new Date();

    const totalRooms = queue.length;
    const totalItems = queue.reduce((sum, q) => sum + q.total_items_count, 0);
    const newRooms = queue.filter(q => q.overall_status === 'new').length;
    const preparingRooms = queue.filter(q => q.overall_status === 'preparing').length;
    const readyRooms = queue.filter(q => q.overall_status === 'ready').length;

    res.json({
      timestamp: now.toISOString(),
      queue,
      orders: allActiveOrders,
      summary: {
        total_rooms_in_queue: totalRooms,
        total_items_pending: totalItems,
        new_rooms: newRooms,
        preparing_rooms: preparingRooms,
        ready_rooms: readyRooms,
      },
    });
  } catch (err) {
    console.error('GET /kitchen/tv/display error:', err);
    res.status(500).json({ error: 'Failed to fetch TV display data' });
  }
}));

/**
 * GET /api/kitchen/orders/:id
 * Get specific order details
 */
router.get('/orders/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const order = await kitchenOrderService.getOrderById(parseInt(id, 10));
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json(order);
  } catch (err) {
    console.error('GET /kitchen/orders/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
}));

/**
 * POST /api/kitchen/orders
 * Create a new kitchen order (from POS/receipt)
 */
router.post('/orders', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const orderData: CreateKitchenOrderData = req.body;
    
    if (!orderData.room_number || !orderData.guest_name || !orderData.cashier_name) {
      return res.status(400).json({ 
        error: 'Missing required fields: room_number, guest_name, cashier_name' 
      });
    }
    
    if (!orderData.items || orderData.items.length === 0) {
      return res.status(400).json({ 
        error: 'Order must contain at least one item' 
      });
    }
    
    const operatorUsername = (req as any).operator?.username || orderData.cashier_name;
    const order = await kitchenOrderService.createOrder(orderData, operatorUsername);
    
    // Broadcast updated queue to all connected clients & TV displays
    const updatedQueue = await kitchenOrderService.getRoomQueue();
    socketManager.broadcast('kitchen:queue_updated', updatedQueue);
    socketManager.broadcast('kitchen:new_order', order);
    
    // Automatic print is disabled; cashiers trigger thermal printing manually via button
    res.status(201).json(order);
  } catch (err: any) {
    console.error('POST /kitchen/orders error:', err);
    if (err.statusCode === 400 || (err.message && err.message.toLowerCase().includes('insufficient stock'))) {
      return res.status(400).json({ error: err.message || 'Insufficient stock' });
    }
    res.status(500).json({ error: 'Failed to create kitchen order' });
  }
}));

/**
 * POST /api/kitchen/orders/:id/reprint or /api/kitchen/orders/:id/print
 * Trigger manual ticket print/reprint (cashier, kitchen staff, admin, owner)
 */
router.post(['/orders/:id/reprint', '/orders/:id/print'], requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const operator = (req as any).operator;

    const allowedRoles = ['kitchen', 'cashier', 'admin', 'owner'];
    if (!allowedRoles.includes(operator?.role)) {
      return res.status(403).json({ error: 'Unauthorized to trigger kitchen reprint' });
    }

    const orderId = parseInt(id, 10);
    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    const order = await kitchenOrderService.getOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const result = await kitchenPrinterService.printKitchenTicket(order, true);
    res.json({ success: result.success, message: result.message, orderId: order.id });
  } catch (err) {
    console.error('POST /kitchen/orders/:id/reprint error:', err);
    res.status(500).json({ error: 'Failed to reprint kitchen order' });
  }
}));

/**
 * PUT /api/kitchen/orders/:id/status
 * Update order status (cashier/kitchen staff)
 */
router.put('/orders/:id/status', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const operator = (req as any).operator;
    
    const validStatuses = ['new', 'preparing', 'ready', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      });
    }
    
    const updatedOrder = await kitchenOrderService.updateOrderStatus(
      parseInt(id, 10),
      status,
      operator?.username,
      notes
    );
    
    if (!updatedOrder) {
      return res.status(404).json({ error: 'Order not found or cannot be updated' });
    }
    
    // Broadcast updated queue
    const updatedQueue = await kitchenOrderService.getRoomQueue();
    socketManager.broadcast('kitchen:queue_updated', updatedQueue);
    socketManager.broadcast('kitchen:order_updated', updatedOrder);
    
    if (status === 'delivered') {
      socketManager.broadcast('kitchen:order_completed', updatedOrder.id);
    }
    
    res.json(updatedOrder);
  } catch (err) {
    console.error('PUT /kitchen/orders/:id/status error:', err);
    res.status(500).json({ error: 'Failed to update order status' });
  }
}));

/**
 * POST /api/kitchen/room/:roomNumber/status
 * Update status for ALL active orders of a room (e.g. Mark Room Ready / Delivered)
 */
router.post('/room/:roomNumber/status', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { roomNumber } = req.params;
    const { status } = req.body;
    const operator = (req as any).operator;

    const validStatuses = ['new', 'preparing', 'ready', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status` });
    }

    const updatedOrders = await kitchenOrderService.updateRoomOrdersStatus(
      roomNumber,
      status,
      operator?.username
    );

    const updatedQueue = await kitchenOrderService.getRoomQueue();
    socketManager.broadcast('kitchen:queue_updated', updatedQueue);

    res.json({ success: true, updatedCount: updatedOrders.length, orders: updatedOrders });
  } catch (err) {
    console.error('POST /kitchen/room/:roomNumber/status error:', err);
    res.status(500).json({ error: 'Failed to update room orders status' });
  }
}));

/**
 * DELETE /api/kitchen/orders/:id
 * Cancel an order (admin only)
 */
router.delete('/orders/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const operator = (req as any).operator;
    
    if (operator.role !== 'admin' && operator.role !== 'owner') {
      return res.status(403).json({ error: 'Only admin or owner can cancel orders' });
    }
    
    const cancelledOrder = await kitchenOrderService.cancelOrder(parseInt(id, 10), reason);
    
    if (!cancelledOrder) {
      return res.status(404).json({ error: 'Order not found or cannot be cancelled' });
    }
    
    const updatedQueue = await kitchenOrderService.getRoomQueue();
    socketManager.broadcast('kitchen:queue_updated', updatedQueue);
    socketManager.broadcast('kitchen:order_completed', cancelledOrder.id);
    
    res.json(cancelledOrder);
  } catch (err) {
    console.error('DELETE /kitchen/orders/:id error:', err);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
}));

/**
 * GET /api/kitchen/orders/room/:roomNumber
 * Get orders for specific room
 */
router.get('/orders/room/:roomNumber', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { roomNumber } = req.params;
    const orders = await kitchenOrderService.getOrdersByRoom(roomNumber);
    res.json(orders);
  } catch (err) {
    console.error('GET /kitchen/orders/room/:roomNumber error:', err);
    res.status(500).json({ error: 'Failed to fetch room orders' });
  }
}));

/**
 * GET /api/kitchen/orders/by-receipt/:receiptNo
 * Get orders for specific receipt
 */
router.get('/orders/by-receipt/:receiptNo', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { receiptNo } = req.params;
    const orders = await kitchenOrderService.getOrdersByReceipt(receiptNo);
    res.json(orders);
  } catch (err) {
    console.error('GET /kitchen/orders/by-receipt/:receiptNo error:', err);
    res.status(500).json({ error: 'Failed to fetch receipt orders' });
  }
}));

/**
 * POST /api/kitchen/cleanup-stale
 * Clean up stale unfulfilled kitchen orders
 */
router.post('/cleanup-stale', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const maxAgeMinutes = Number(req.body.maxAgeMinutes) || 30;
    const cleanedCount = await kitchenOrderService.cleanupStaleOrders(maxAgeMinutes);

    if (cleanedCount > 0) {
      const updatedQueue = await kitchenOrderService.getRoomQueue();
      socketManager.broadcast('kitchen:queue_updated', updatedQueue);
    }

    res.json({ success: true, cleanedCount });
  } catch (err) {
    console.error('POST /kitchen/cleanup-stale error:', err);
    res.status(500).json({ error: 'Failed to clean up stale orders' });
  }
}));

export default router;