/**
 * src/api/inventory.ts
 * Frontend API client for Cashier Shift Menu Inventory & Daily/Weekly Reports.
 */

import { apiFetch, getAuthHeader } from './client';

export interface InventoryItem {
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

export interface ShiftInfo {
  shiftId: string;
  shiftType: 'DAY' | 'NIGHT';
  dateStr: string;
}

export interface InventoryCurrentResponse {
  currentShift: ShiftInfo;
  items: InventoryItem[];
}

export interface StockSetResponse {
  success: boolean;
  message: string;
  data: InventoryItem;
  event: any;
}

export interface BatchStockSetResponse {
  success: boolean;
  count: number;
  message: string;
  items: InventoryItem[];
}

export interface DailyInventoryReport {
  period: {
    date: string;
    dayOfWeek: string;
    formattedDate: string;
  };
  summary: {
    totalTrackedItems: number;
    totalUnitsSold: number;
    itemsOutOfStock: number;
    eventsCount: number;
  };
  items: Array<{
    itemId: string;
    itemName: string;
    category: string;
    isTracked: boolean;
    startingQuantity: number;
    stockSetEvents: Array<{
      id: string;
      operator: string;
      quantitySet: number;
      delta: number;
      shiftId: string;
      shiftType: string;
      timestamp: string;
      notes?: string;
    }>;
    totalSold: number;
    endingQuantity: number;
    zeroStockEvents: Array<{
      timestamp: string;
      operator: string;
      referenceId?: string;
      shiftId: string;
    }>;
    isOutOfStock: boolean;
  }>;
}

export interface WeeklyInventoryReport {
  period: {
    weekStart: string;
    weekEnd: string;
    weekLabel: string;
  };
  summary: {
    totalTrackedItems: number;
    totalUnitsSold: number;
    itemsCurrentlyOutOfStock: number;
    totalEventsInWeek: number;
  };
  dailyBreakdowns: Array<{
    date: string;
    dayOfWeek: string;
    eventsCount: number;
    unitsSold: number;
  }>;
  items: Array<{
    itemId: string;
    itemName: string;
    category: string;
    isTracked: boolean;
    startingQuantity: number;
    stockSetCount: number;
    stockSetEvents: Array<any>;
    totalSold: number;
    endingQuantity: number;
    zeroStockEventsCount: number;
    zeroStockEvents: Array<any>;
    isOutOfStock: boolean;
  }>;
}

/**
 * Fetch current menu inventory and live availability.
 */
export async function getCurrentInventory(): Promise<InventoryCurrentResponse> {
  return apiFetch<InventoryCurrentResponse>('/inventory/current');
}

/**
 * Set stock count for a single item (stock-count-as-of-now overwrite).
 */
export async function setStockCount(
  itemId: string,
  quantity: number,
  notes?: string,
  isTracked: boolean = true
): Promise<StockSetResponse> {
  return apiFetch<StockSetResponse>('/inventory/stock', {
    method: 'POST',
    body: JSON.stringify({ itemId, quantity, notes, isTracked }),
  });
}

/**
 * Batch update stock counts for shift start.
 */
export async function batchSetStock(
  items: Array<{ itemId: string; quantity: number; isTracked?: boolean }>,
  notes?: string
): Promise<BatchStockSetResponse> {
  return apiFetch<BatchStockSetResponse>('/inventory/stock/batch', {
    method: 'POST',
    body: JSON.stringify({ items, notes }),
  });
}

/**
 * Register a new item or supply into menu_item_inventory.
 */
export async function createInventoryItem(payload: {
  itemId?: string;
  itemName: string;
  category: string;
  initialQuantity?: number;
  price?: number;
  isTracked?: boolean;
  description?: string;
}): Promise<{ success: boolean; message: string; data: InventoryItem }> {
  return apiFetch<{ success: boolean; message: string; data: InventoryItem }>('/inventory/item', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Get daily inventory report data (JSON).
 */
export async function getDailyReport(date?: string): Promise<DailyInventoryReport> {
  const url = date ? `/inventory/report/daily?date=${date}` : '/inventory/report/daily';
  return apiFetch<DailyInventoryReport>(url);
}

/**
 * Get weekly inventory report data (JSON).
 */
export async function getWeeklyReport(weekStart?: string): Promise<WeeklyInventoryReport> {
  const url = weekStart ? `/inventory/report/weekly?weekStart=${weekStart}` : '/inventory/report/weekly';
  return apiFetch<WeeklyInventoryReport>(url);
}

/**
 * Download daily inventory report as a styled XLSX workbook
 * (shared DB-workbook theme, generated live by the server).
 */
export async function downloadDailyInventoryCsv(date?: string): Promise<void> {
  const dateStr = date || new Date().toISOString().slice(0, 10);
  const authHeader = getAuthHeader();
  const headers: Record<string, string> = {};
  if (authHeader) headers['Authorization'] = authHeader;

  const res = await fetch(`/api/inventory/report/daily?date=${dateStr}&format=xlsx`, {
    headers,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Failed to download report');
    throw new Error(errorText);
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Sedona_Daily_Inventory_${dateStr}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

/**
 * Download weekly inventory report as a styled XLSX workbook
 * (shared DB-workbook theme, generated live by the server).
 */
export async function downloadWeeklyInventoryCsv(weekStart?: string): Promise<void> {
  const authHeader = getAuthHeader();
  const headers: Record<string, string> = {};
  if (authHeader) headers['Authorization'] = authHeader;

  const urlParam = weekStart ? `?weekStart=${weekStart}&format=xlsx` : '?format=xlsx';
  const res = await fetch(`/api/inventory/report/weekly${urlParam}`, {
    headers,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Failed to download weekly report');
    throw new Error(errorText);
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Sedona_Weekly_Inventory_${weekStart || 'current'}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
