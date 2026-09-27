/**
 * server/routes/inventory.ts
 * API endpoints for Cashier Shift Menu Inventory & Daily/Weekly Reports.
 *
 * GET  /api/inventory/current       - Get live menu availability and stock counts (requireAuth)
 * POST /api/inventory/stock         - Cashier sets/adjusts stock for single item (requireInventoryStaff)
 * POST /api/inventory/stock/batch   - Cashier bulk sets shift stock counts (requireInventoryStaff)
 * GET  /api/inventory/report/daily  - Daily inventory report JSON or CSV export (requireAuth)
 * GET  /api/inventory/report/weekly - Weekly inventory report JSON or CSV export (requireAuth)
 */

import { Router, Request, Response } from 'express';
import { requireAuth, requireInventoryStaff } from '../middleware/auth';
import { inventoryService } from '../services/inventory-service';
import { format, startOfWeek } from 'date-fns';
import { socketManager } from '../websocket/socket-manager';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

/**
 * GET /api/inventory/current
 * Returns current available stock for all menu items.
 * Staff access (cashier, admin, owner, kitchen).
 */
router.get('/current', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  try {
    const items = await inventoryService.getCurrentInventory();
    const shift = inventoryService.getShiftInfo();
    res.json({
      currentShift: shift,
      items,
    });
  } catch (err: any) {
    console.error('GET /api/inventory/current error:', err);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
}));

/**
 * POST /api/inventory/stock
 * Cashier enters or updates available quantity for a menu item (stock-count-as-of-now overwrite).
 * Role-gated: cashier, admin, owner. Server-derives operator.
 */
router.post('/stock', requireInventoryStaff, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { itemId, quantity, notes, isTracked } = req.body;
    const operator = (req as any).operator?.username || 'system';

    if (!itemId || typeof itemId !== 'string') {
      return res.status(400).json({ error: 'Missing required field: itemId' });
    }

    if (quantity === undefined || quantity === null || !Number.isInteger(Number(quantity)) || Number(quantity) < 0) {
      return res.status(400).json({ error: 'Quantity must be a non-negative integer' });
    }

    const qtyNum = parseInt(String(quantity), 10);
    const result = await inventoryService.setStockCount(
      itemId,
      qtyNum,
      operator,
      notes,
      isTracked !== undefined ? Boolean(isTracked) : true
    );

    // Broadcast inventory update via WebSocket
    socketManager.broadcastToStaff('inventory:updated', {
      itemId,
      currentQuantity: result.item.current_quantity,
      updatedBy: operator,
      timestamp: result.item.updated_at,
    });

    res.status(200).json({
      success: true,
      message: `Stock for ${result.item.item_name} set to ${qtyNum}`,
      data: result.item,
      event: result.event,
    });
  } catch (err: any) {
    console.error('POST /api/inventory/stock error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to set stock count' });
  }
}));

/**
 * POST /api/inventory/stock/batch
 * Cashier batch-sets stock counts at shift start.
 */
router.post('/stock/batch', requireInventoryStaff, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { items, notes } = req.body;
    const operator = (req as any).operator?.username || 'system';

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items must be a non-empty array' });
    }

    for (const it of items) {
      if (!it.itemId || it.quantity === undefined || !Number.isInteger(Number(it.quantity)) || Number(it.quantity) < 0) {
        return res.status(400).json({
          error: `Invalid item in batch: each entry must have itemId and non-negative integer quantity (received ${JSON.stringify(it)})`,
        });
      }
    }

    const updatedItems = await inventoryService.batchSetStockCounts(
      items.map(it => ({
        itemId: it.itemId,
        quantity: parseInt(String(it.quantity), 10),
        isTracked: it.isTracked !== undefined ? Boolean(it.isTracked) : true,
      })),
      operator,
      notes || 'Shift opening batch count'
    );

    socketManager.broadcastToStaff('inventory:batch_updated', {
      count: updatedItems.length,
      updatedBy: operator,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      count: updatedItems.length,
      message: `Batch stock counts updated for ${updatedItems.length} items`,
      items: updatedItems,
    });
  } catch (err: any) {
    console.error('POST /api/inventory/stock/batch error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update batch stock' });
  }
}));

/**
 * POST /api/inventory/item
 * Cashier or manager adds a new tracked inventory or supply item.
 */
router.post('/item', requireInventoryStaff, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { itemId, itemName, category, initialQuantity, price, isTracked, description } = req.body;
    const operator = (req as any).operator?.username || 'system';

    if (!itemName || typeof itemName !== 'string' || !itemName.trim()) {
      return res.status(400).json({ error: 'Missing required field: itemName' });
    }

    if (!category || typeof category !== 'string' || !category.trim()) {
      return res.status(400).json({ error: 'Missing required field: category' });
    }

    const newItem = await inventoryService.addNewInventoryItem(
      {
        itemId: itemId?.trim(),
        itemName: itemName.trim(),
        category: category.trim(),
        initialQuantity: initialQuantity !== undefined ? Number(initialQuantity) : 0,
        price: price !== undefined ? Number(price) : undefined,
        isTracked: isTracked !== undefined ? Boolean(isTracked) : true,
        description: description?.trim(),
      },
      operator
    );

    socketManager.broadcastToStaff('inventory:updated', {
      itemId: newItem.item_id,
      currentQuantity: newItem.current_quantity,
      updatedBy: operator,
      timestamp: newItem.updated_at,
    });

    res.status(201).json({
      success: true,
      message: `Item "${newItem.item_name}" registered in inventory`,
      data: newItem,
    });
  } catch (err: any) {
    console.error('POST /api/inventory/item error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to add inventory item' });
  }
}));

/**
 * GET /api/inventory/report/daily
 * Daily inventory summary report (stock-set events, total sold, ending quantity, zero-stock events).
 * Optional ?format=csv returns downloadable CSV.
 * Optional ?format=xlsx returns a styled workbook (shared DB-workbook theme).
 * Auth-gated with requireAuth.
 */
router.get('/report/daily', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const dateQuery = (req.query.date as string) || format(new Date(), 'yyyy-MM-dd');
    const formatType = (req.query.format as string)?.toLowerCase();

    const reportData = await inventoryService.getDailyReport(dateQuery);

    if (formatType === 'csv') {
      const csv = inventoryService.formatReportAsCsv(reportData, 'daily');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="Sedona_Daily_Inventory_${dateQuery}.csv"`);
      return res.status(200).send(csv);
    }

    if (formatType === 'xlsx') {
      const buffer = await inventoryService.formatReportAsWorkbook(reportData, 'daily');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Sedona_Daily_Inventory_${dateQuery}.xlsx"`);
      return res.status(200).send(buffer);
    }

    res.json(reportData);
  } catch (err: any) {
    console.error('GET /api/inventory/report/daily error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to generate daily inventory report' });
  }
}));

/**
 * GET /api/inventory/report/weekly
 * Weekly inventory summary report across 7 days.
 * Optional ?format=csv returns downloadable CSV.
 * Optional ?format=xlsx returns a styled workbook (shared DB-workbook theme).
 * Auth-gated with requireAuth.
 */
router.get('/report/weekly', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    let weekStartQuery = req.query.weekStart as string;
    if (!weekStartQuery) {
      const mon = startOfWeek(new Date(), { weekStartsOn: 1 });
      weekStartQuery = format(mon, 'yyyy-MM-dd');
    }

    const formatType = (req.query.format as string)?.toLowerCase();
    const reportData = await inventoryService.getWeeklyReport(weekStartQuery);

    if (formatType === 'csv') {
      const csv = inventoryService.formatReportAsCsv(reportData, 'weekly');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="Sedona_Weekly_Inventory_${weekStartQuery}.csv"`);
      return res.status(200).send(csv);
    }

    if (formatType === 'xlsx') {
      const buffer = await inventoryService.formatReportAsWorkbook(reportData, 'weekly');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Sedona_Weekly_Inventory_${weekStartQuery}.xlsx"`);
      return res.status(200).send(buffer);
    }

    res.json(reportData);
  } catch (err: any) {
    console.error('GET /api/inventory/report/weekly error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to generate weekly inventory report' });
  }
}));

export default router;
