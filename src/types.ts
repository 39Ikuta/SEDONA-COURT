/**
 * Types and interfaces for the Sedona Court Property Management System
 */

export interface Room {
  number: string; // e.g. '101'
  state: 'available' | 'occupied' | 'overdue' | 'maintenance';
  time: string; // text like '2h 14m', 'READY', '0h 15m'
  label: string; // smith, J., Housekeep, Vacant, Available
  tier: 'Standard' | 'Deluxe' | 'Suite';
  floor: number;
  roomType: string; // e.g. 'Standard Single', 'Deluxe Queen', 'Family Suite'
  guestName: string;
  guestId: string;
  numGuests: number;
  rateSelected: '1h' | '3h' | '6h' | '12h' | '24h' | 'promo' | 'custom';
  customHours?: number;
  extraBeds: number;
  towelSets: number;
  checkInTime?: string;
  checkOutTime?: string;
  checkInAt?: string;
  expectedCheckoutAt?: string;
  alarmState?: 'NORMAL' | 'WARNING' | 'DUE' | 'OVERDUE';
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  isOverdue?: boolean;
  chargedFood?: Array<{ item: POSItem; quantity: number }>;
  forceCheckoutPending?: boolean;
  forceCheckoutRequestId?: string;
  isStaffHouse?: boolean;
  discountType?: 'NONE' | 'SENIOR' | 'DC';
  discountIdRef?: string;
  billingMode?: 'standard' | 'open_time';
  openTimeStartedAt?: string;
  snoozedUntil?: string;
  repeatCount?: number;
  overtimeWaived?: boolean;
}

export type AlarmState = 'NORMAL' | 'WARNING' | 'DUE' | 'OVERDUE';

export interface AlarmStateChangedEvent {
  roomNumber: string;
  previousState: AlarmState;
  newState: AlarmState;
  expectedCheckoutAt: string;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  timestamp: string;
}

export interface AlarmSettings {
  alarm_pre_minutes: number;
  alarm_post_minutes: number;
  snooze_minutes?: number;
  overdue_repeat_minutes?: number;
  overdue_max_repeats?: number;
  extra_hour_rate?: number;
  open_time_reminder_hours?: number;
}

export type ForceCheckoutReason = 
  | 'skip_out' 
  | 'overstay_unreachable' 
  | 'disputed_bill' 
  | 'emergency_eviction' 
  | 'system_error' 
  | 'other';

export type ForceCheckoutResolution = 
  | 'loss_write_off' 
  | 'deposit_forfeit' 
  | 'void_mistake' 
  | 'manual_settle';

export interface ForceCheckoutRequest {
  id: string;
  roomNumber: string;
  roomType?: string;
  guestName?: string;
  guestId?: string;
  checkInTime?: string;
  rateSelected?: string;
  uncollectedAmount: number;
  billedBreakdown?: Array<{ description: string; subtext?: string; amount: number }>;
  reason: ForceCheckoutReason;
  cashierNotes: string;
  requestedBy: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  adminNotes?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionType?: ForceCheckoutResolution;
}

export interface POSItem {
  id: string;
  name: string;
  price: number;
  category: string; // Dynamic string categories
  description: string;
  imageUrl: string;
}

export interface BillableService {
  id: string;
  type: 'room_rate' | 'menu_item' | 'service';
  name: string;
  price: number; // Base price
  category: string; // Room tier, or F&B category, or custom service category
  active: boolean;
  description?: string;
  rateType?: '3h' | '6h' | '12h' | '24h' | 'promo'; // Only applicable for 'room_rate' type
  weekdayOverride?: number; // Mon-Thu override rate
  weekendOverride?: number; // Fri-Sun override rate
  seasonalOverride?: number; // Seasonal override rate
  seasonalStart?: string; // MM-DD
  seasonalEnd?: string; // MM-DD
  imageUrl?: string;
  isDeleted?: boolean; // Soft-delete flag
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  operator: string;
  action: string; // 'CREATE_SERVICE' | 'UPDATE_SERVICE' | 'DELETE_SERVICE'
  details: string; // e.g. "Changed Standard 3h Rate from ₱350 to ₱380"
}

export interface OrderItem {
  item: POSItem;
  quantity: number;
}

export interface ExpenseItem {
  name: string;
  amount: number;
  isSubtotal?: boolean;
}

export interface ShiftReport {
  date: string; // e.g. "Jun 15"
  dayOfWeek: string; // e.g. "MON"
  shift: 'DAY' | 'NIGHT';
  cashier: string;
  checkins: number;
  out: number;
  transf: number;
  roomBill: number;
  kitchen: number;
  drinks: number;
  miscell: number;
  extras: number;
  disc: number;
  received: number;
}

export interface Receipt {
  receiptNo: string;
  dateTime: string;
  guestName: string;
  roomNumber: string;
  roomType: string;
  paymentMethod: 'CASH' | 'GCASH' | 'MIXED';
  gcashRef?: string;
  cashAmount?: number;
  gcashAmount?: number;
  checkIn: string;
  checkOut: string;
  items: Array<{
    item_id?: string; // Service/menu item ID for inventory tracking
    id?: string; // Alternative field name (backwards compat)
    description: string;
    subtext: string;
    amount: number;
    quantity?: number; // Quantity for POS items
    name?: string; // Item name for POS items
  }>;
  subtotal: number;
  serviceCharge: number;
  total: number;
  discount?: number;
  discountType?: string;
  discountIdRef?: string;
  isSeniorPwdDiscount?: boolean;
  isDiscountCard?: boolean;
  seniorPwdId?: string;
  discountCardId?: string;
  cashierId: string;
  rateSelected?: '3h' | '6h' | '12h' | '24h' | 'promo' | string;
  stayDuration?: string;
  depositBalance?: number;
  amountTendered?: number;
  changeAmount?: number;
  amountTenderedCents?: number;
  changeCents?: number;
  consumedMinutes?: number;
  timeConsumed?: string;
  status?: 'valid' | 'void';
  voidReason?: string;
  voidedAt?: string;
  voidedBy?: string;
  reprintCount?: number;
  lastReprintedAt?: string;
  lastReprintedBy?: string;
  idempotencyKey?: string;
  sequenceName?: string;
  depositResolution?: { action: 'apply' | 'refund' | 'forfeit'; notes?: string };
}

export interface HandoffTask {
  id: string;
  text: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  assignedTo?: string;
}

export type UserRole = 'kitchen' | 'cashier' | 'admin' | 'owner' | 'customer_display';

export interface UserAccount {
  username: string;
  name: string;
  role: UserRole;
  accessCode?: string;  // Only present server-side for seeding; stripped from frontend bundle
  access_code?: string;
}

export interface ScheduledBooking {
  id: string;
  roomNumber: string;
  guestName: string;
  guestId?: string;
  checkInDate: string; // YYYY-MM-DD
  checkOutDate: string; // YYYY-MM-DD
  rateSelected: '3h' | '6h' | '12h' | '24h' | 'promo';
  numGuests: number;
  status: 'scheduled' | 'checked-in' | 'cancelled';
}

export type ScreenState = 'dashboard' | 'bookings' | 'rooms' | 'pos' | 'ledger' | 'reports' | 'weekly-reports' | 'shift-settlement' | 'kitchen-tv' | 'kitchen-view' | 'receipt-preview' | 'settings' | 'notifications';

export interface NotificationLogItem {
  id: string;
  roomNumber: string;
  guestName?: string;
  type: 'warning' | 'checkout' | 'grace' | 'snooze_expired' | 'manual';
  title: string;
  message: string;
  timestamp: string;
  rawTime: number;
  acknowledged?: boolean;
}

export const getTierDisplayName = (tier: Room['tier'] | string): string => {
  switch (tier) {
    case 'Suite':
      return 'VIP room';
    case 'Deluxe':
      return 'Premium room';
    case 'Standard':
    default:
      return 'Classic room';
  }
};

export interface DepositTransaction {
  id: string;
  guestIdentifier: string;
  guestName?: string | null;
  amountCentavos: number;
  amount: number;
  direction: 'IN' | 'OUT';
  paymentMethod: 'CASH' | 'GCASH' | 'MIXED' | 'BALANCE_APPLIED';
  cashAmountCentavos?: number;
  gcashAmountCentavos?: number;
  referenceId?: string | null;
  idempotencyKey: string;
  bookingId?: string | null;
  roomNumber?: string | null;
  receiptNo?: string | null;
  notes?: string | null;
  operator: string;
  createdAt: string;
}

export interface DepositBalanceInfo {
  guestIdentifier: string;
  balanceCentavos: number;
  balance: number;
  totalInCentavos: number;
  totalOutCentavos: number;
  totalIn: number;
  totalOut: number;
  transactions: DepositTransaction[];
}

export interface RoomTransferRecord {
  id: string;
  sourceRoomNumber: string;
  targetRoomNumber: string;
  guestName: string;
  guestId?: string;
  reason: string;
  transferredBy: string;
  transferredAt: string;
  sourceTier?: string;
  targetTier?: string;
  rateSelected?: string;
  chargedFood?: any;
  priceDifference?: number;
  notes?: string;
}

export interface TransferRoomParams {
  sourceRoomNumber: string;
  targetRoomNumber: string;
  reason: string;
  notes?: string;
  priceDifference?: number;
}

export interface TransferRoomResponse {
  success: boolean;
  transfer: RoomTransferRecord;
  sourceRoom: Room;
  targetRoom: Room;
  message: string;
}

export interface Deposit {
  id: string;
  bookingId?: string | null;
  roomId?: string;
  roomNumber?: string;
  amountCents: number;
  amount: number;
  status: 'held' | 'refunded' | 'applied' | 'forfeited';
  collectedBy: string;
  collectedAt: string;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  depositNumber: string;
  notes?: string | null;
  refundAmountCents?: number;
  refundAmount?: number;
  appliedAmountCents?: number;
  appliedAmount?: number;
  linkedReceiptNo?: string | null;
  depositSnapshot?: any;
  resolutionSnapshot?: any;
  reprintCount?: number;
  createdAt?: string;
  updatedAt?: string;
}


