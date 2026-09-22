/**
 * src/api/kitchen.ts
 * API client for queue-based kitchen order management
 */

import { apiFetch } from './client';

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

export interface KitchenTVDisplayData {
  timestamp: string;
  queue: RoomQueueGroup[];
  orders: KitchenOrder[];
  summary: {
    total_rooms_in_queue: number;
    total_items_pending: number;
    new_rooms: number;
    preparing_rooms: number;
    ready_rooms: number;
  };
}

export interface KitchenStats {
  date: string;
  total_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  avg_completion_minutes: string;
  avg_preparation_minutes: string;
}

/**
 * Get room-based queue
 */
export const getKitchenQueue = async (): Promise<RoomQueueGroup[]> => {
  return apiFetch<RoomQueueGroup[]>('/kitchen/queue');
};

/**
 * Get all active kitchen orders
 */
export const getKitchenOrders = async (): Promise<KitchenOrder[]> => {
  return apiFetch<KitchenOrder[]>('/kitchen/orders');
};

/**
 * Get TV display data with room queue and summary
 */
export const getKitchenTVDisplay = async (): Promise<KitchenTVDisplayData> => {
  return apiFetch<KitchenTVDisplayData>('/kitchen/tv/display');
};

/**
 * Get specific kitchen order by ID
 */
export const getKitchenOrder = async (id: number): Promise<KitchenOrder> => {
  return apiFetch<KitchenOrder>(`/kitchen/orders/${id}`);
};

/**
 * Create a new kitchen order (called from POS system)
 */
export const createKitchenOrder = async (data: CreateKitchenOrderData): Promise<KitchenOrder> => {
  return apiFetch<KitchenOrder>('/kitchen/orders', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

/**
 * Update kitchen order status
 */
export const updateKitchenOrderStatus = async (
  id: number,
  status: KitchenOrder['status'],
  notes?: string
): Promise<KitchenOrder> => {
  return apiFetch<KitchenOrder>(`/kitchen/orders/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status, notes }),
  });
};

/**
 * Update status for ALL active orders of a room
 */
export const updateRoomOrdersStatus = async (
  roomNumber: string,
  status: KitchenOrder['status']
): Promise<{ success: boolean; updatedCount: number; orders: KitchenOrder[] }> => {
  return apiFetch<{ success: boolean; updatedCount: number; orders: KitchenOrder[] }>(
    `/kitchen/room/${encodeURIComponent(roomNumber)}/status`,
    {
      method: 'POST',
      body: JSON.stringify({ status }),
    }
  );
};

/**
 * Cancel a kitchen order (admin only)
 */
export const cancelKitchenOrder = async (
  id: number,
  reason?: string
): Promise<KitchenOrder> => {
  return apiFetch<KitchenOrder>(`/kitchen/orders/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
  });
};

/**
 * Get orders for specific room
 */
export const getKitchenOrdersByRoom = async (roomNumber: string): Promise<KitchenOrder[]> => {
  return apiFetch<KitchenOrder[]>(`/kitchen/orders/room/${encodeURIComponent(roomNumber)}`);
};

/**
 * Get orders for specific receipt number
 */
export const getKitchenOrdersByReceipt = async (receiptNo: string): Promise<KitchenOrder[]> => {
  return apiFetch<KitchenOrder[]>(`/kitchen/orders/by-receipt/${encodeURIComponent(receiptNo)}`);
};

/**
 * Trigger physical ticket print/reprint on kitchen thermal printer
 */
export const printKitchenOrder = async (
  id: number
): Promise<{ success: boolean; message: string; orderId: number }> => {
  return apiFetch<{ success: boolean; message: string; orderId: number }>(
    `/kitchen/orders/${id}/reprint`,
    {
      method: 'POST',
    }
  );
};

export const reprintKitchenOrder = printKitchenOrder;

/**
 * Get kitchen performance statistics
 */
export const getKitchenStats = async (date?: string): Promise<KitchenStats> => {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  return apiFetch<KitchenStats>(`/kitchen/stats${query}`);
};

/**
 * Helper function to determine if a service item or catalog item is food/drink (should go to kitchen)
 */
export const isFoodItem = (itemOrId: string | { id?: string; category?: string; type?: string; name?: string }): boolean => {
  if (!itemOrId) return false;

  const id = typeof itemOrId === 'string' ? itemOrId : (itemOrId.id || '');
  const category = typeof itemOrId === 'object' ? itemOrId.category : undefined;
  const type = typeof itemOrId === 'object' ? itemOrId.type : undefined;

  // Non-kitchen items
  const nonKitchenIds = [
    'extra-bed',
    'extra-person',
    'towel',
    'bed-sheet',
    'pillow-case',
    'blanket',
    'late-checkout',
    'damaged-item',
    'key-card-loss',
  ];

  if (nonKitchenIds.includes(id)) return false;
  if (category === 'Extras' || category === 'Miscellaneous') return false;
  if (type === 'room_rate' || type === 'service') {
    if (category === 'Extras') return false;
  }

  // Explicit kitchen categories
  const kitchenCategories = ['Favorites', 'Breakfast', 'Drinks', 'Mains', 'Food', 'Snacks', 'Beverages', 'Desserts', 'Meals', 'Kitchen Extras'];
  if (category && kitchenCategories.includes(category)) return true;
  if (type === 'menu_item') return category !== 'Miscellaneous';

  const foodItemIds = [
    'silog-special',
    'adobo-rice',
    'fried-chicken',
    'pork-sisig',
    'beef-tapa',
    'bangus-belly',
    'pancit-canton',
    'pancit-guisado',
    'lumpia-shanghai',
    'chicken-curry',
    'pork-menudo',
    'beef-mechado',
    'fish-fillet',
    'garlic-rice',
    'fried-rice',
    'plain-rice',
    'pasta-carbonara',
    'pasta-bolognese',
    'sandwich-club',
    'clubhouse-sandwich',
    'sandwich-ham',
    'burger-beef',
    'burger-chicken',
    'pizza-margherita',
    'pizza-pepperoni',
    'salad-caesar',
    'salad-garden',
    'soup-chicken',
    'soup-mushroom',
    'brewed-coffee',
    'fresh-mango-shake',
    'san-miguel-pale',
  ];

  const lowerId = id.toLowerCase();
  return (
    foodItemIds.includes(lowerId) ||
    lowerId.startsWith('menu_') ||
    lowerId.includes('meal') ||
    lowerId.includes('food') ||
    lowerId.includes('drink') ||
    lowerId.includes('coffee') ||
    lowerId.includes('silog') ||
    lowerId.includes('rice') ||
    lowerId.includes('shake') ||
    lowerId.includes('juice') ||
    lowerId.includes('beer') ||
    lowerId.includes('sandwich') ||
    lowerId.includes('pancit') ||
    lowerId.includes('pasta') ||
    lowerId.includes('pizza') ||
    lowerId.includes('soup') ||
    lowerId.includes('salad')
  );
};

/**
 * Extract food items from a receipt or charged food list to create kitchen order
 */
export const extractFoodItemsFromReceipt = (
  receiptItems: Array<{ serviceId?: string; id?: string; name: string; quantity: number; price?: number; category?: string }>
): KitchenOrderItem[] => {
  return receiptItems
    .filter(item => isFoodItem(item.serviceId || item.id || item))
    .map(item => ({
      item_id: item.serviceId || item.id || 'custom-item',
      name: item.name,
      quantity: item.quantity,
      special_instructions: undefined,
    }));
};

/**
 * Calculate total amount for food items only
 */
export const calculateFoodItemsTotal = (
  receiptItems: Array<{ serviceId?: string; id?: string; name: string; quantity: number; price: number; category?: string }>
): number => {
  return receiptItems
    .filter(item => isFoodItem(item.serviceId || item.id || item))
    .reduce((total, item) => total + (item.quantity * item.price), 0);
};

/**
 * Live countdown window for the kitchen queue. Orders older than this many
 * minutes automatically expire from the queue (server enforces the same).
 */
export const KITCHEN_QUEUE_TIMER_MINUTES = 30;

/**
 * Clean up stale orders older than maxAgeMinutes (default 30 minutes)
 */
export const cleanupStaleOrders = async (maxAgeMinutes: number = KITCHEN_QUEUE_TIMER_MINUTES): Promise<{ success: boolean; cleanedCount: number }> => {
  return apiFetch<{ success: boolean; cleanedCount: number }>('/kitchen/cleanup-stale', {
    method: 'POST',
    body: JSON.stringify({ maxAgeMinutes }),
  });
};

export const kitchenOrderService = {
  getQueue: getKitchenQueue,
  getOrders: getKitchenOrders,
  getTVDisplay: getKitchenTVDisplay,
  getOrder: getKitchenOrder,
  createOrder: createKitchenOrder,
  updateStatus: updateKitchenOrderStatus,
  updateRoomStatus: updateRoomOrdersStatus,
  cancelOrder: cancelKitchenOrder,
  getOrdersByRoom: getKitchenOrdersByRoom,
  getOrdersByReceipt: getKitchenOrdersByReceipt,
  printOrder: printKitchenOrder,
  reprintOrder: reprintKitchenOrder,
  getStats: getKitchenStats,
  cleanupStale: cleanupStaleOrders,
  isFoodItem,
  extractFoodItems: extractFoodItemsFromReceipt,
  calculateFoodTotal: calculateFoodItemsTotal,
};