import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion } from 'motion/react';
import { Room, POSItem, Receipt, getTierDisplayName, BillableService, Deposit } from '../types';
import { X, Calendar, User, FileText, ShoppingBag, Plus, Minus, CreditCard, ChevronRight, Sparkles, CheckCircle2, ShieldAlert, AlertTriangle, Loader2, Printer, ArrowRightLeft, Ticket, BellOff, ShieldCheck } from 'lucide-react';
import { USER_ACCOUNTS } from '../data';
import { calculateStayRate, mapServicesToPOSItems, getStayDurationHours, formatStayDuration, DEFAULT_TIER_RATES, calculateExpectedCheckout, EXCESS_HOUR_RATE, calculateExcessHours } from '../utils/pricing';
import { getDiscountAmountPesos } from '../utils/discount-rates';
import { getRoomStatusConfig, formatManilaTime } from '../utils/roomStatus';
import { acknowledgeRoomAlarm, extendRoomStay, snoozeRoomAlarm, switchRoomToOpenTime } from '../api/rooms';
import { WalkInCheckIn } from './room-detail/WalkInCheckIn';
import { OccupiedRoomView } from './room-detail/OccupiedRoomView';
import { RoomServicePanel } from './room-detail/RoomServicePanel';
import { CheckoutActions } from './room-detail/CheckoutActions';
import { DrawerSection } from './room-detail/DrawerSection';
import { StayRatePicker } from './room-detail/StayRatePicker';
import { ForceCheckoutModal } from './ForceCheckoutModal';
import { PrePrintBillModal } from './PrePrintBillModal';
import { GatePassModal } from './GatePassModal';
import { GatePassData } from './PrintableGatePass';
import { TransferRoomModal } from './room-detail/TransferRoomModal';
import { StaffHouseView } from './room-detail/StaffHouseView';
import { GuestDepositSection } from './room-detail/GuestDepositSection';
import { useToast } from './ui/Toast';
import { kitchenOrderService } from '../api/kitchen';
import { getCurrentInventory, InventoryItem } from '../api/inventory';
import { getGuestDepositBalance, getActiveRoomDeposit } from '../api/deposits';
import { prePrintReceipt } from '../api/receipts';
import { useModalEscape } from '../hooks/useModalEscape';

interface RoomDetailSidebarProps {
  room: Room | null;
  onClose: () => void;
  onUpdateRoom: (updatedRoom: Room) => Promise<void>;
  onGenerateReceipt: (receipt: Receipt) => Promise<void>;
  activeCashier: string;
  loggedInUser: string;
  billableServices: BillableService[];
  allRooms?: Room[];
  onTransferSuccess?: (sourceRoom: Room, targetRoom: Room) => void;
}

export const RoomDetailSidebar: React.FC<RoomDetailSidebarProps> = ({
  room,
  onClose,
  onUpdateRoom,
  onGenerateReceipt,
  activeCashier,
  loggedInUser,
  billableServices,
  allRooms = [],
  onTransferSuccess,
}) => {
  useModalEscape(Boolean(room), onClose);

  if (!room) return null;

  const toast = useToast();

  const currentUser = USER_ACCOUNTS.find(
    (a) => a.username.toLowerCase() === loggedInUser.toLowerCase()
  ) || {
    username: loggedInUser,
    name: loggedInUser,
    role: 'unknown',
  };

  const role = currentUser.role;
  const isStaffHouse = Boolean(room.isStaffHouse || room.roomType === 'Staff House' || room.number === '12');

  // Map active billable services to standard POS catalog format with useMemo
  const dynamicCatalog = useMemo(() => mapServicesToPOSItems(billableServices), [billableServices]);

  // Dynamic price lookup for extra bed, towel, and extra person services with useMemo
  const extraBedService = useMemo(() => billableServices.find(s => s.id === 'extra-bed') || { price: 250 }, [billableServices]);
  const towelService = useMemo(() => billableServices.find(s => s.id === 'towel') || { price: 100 }, [billableServices]);
  const extraPersonService = useMemo(() => billableServices.find(s => s.id === 'extra-person') || { price: 150 }, [billableServices]);
  const excessHourService = useMemo(() => billableServices.find(s => s.id === 'late-checkout-extension') || { price: EXCESS_HOUR_RATE }, [billableServices]);

  // Rates configuration per tier dynamically mapped from custom settings and overrides
  const getRateValue = useCallback((tier: Room['tier'], rateType: Room['rateSelected']) => {
    if (rateType === 'custom') {
      return (customHours || 1) * 130;
    }
    const service = billableServices.find(
      (s) => s.type === 'room_rate' && s.category === tier && s.rateType === rateType && !s.isDeleted
    );
    if (!service) {
      return DEFAULT_TIER_RATES[tier]?.[rateType] || 0;
    }
    return calculateStayRate(service, room.checkInTime || undefined);
  }, [billableServices, room.checkInTime]);

  // Helper to format ISO to input datetime-local string
  const toLocalIsoString = (isoOrDate?: string | Date | null) => {
    const d = isoOrDate ? new Date(isoOrDate) : new Date();
    if (isNaN(d.getTime())) {
      const now = new Date();
      return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  // Local Form state
  const [guestName, setGuestName] = useState(room.guestName || '');
  const [guestId, setGuestId] = useState(room.guestId || '');
  const [numGuests, setNumGuests] = useState(room.numGuests || 1);
  const [rateSelected, setRateSelected] = useState<Room['rateSelected']>(room.rateSelected || '24h');
  const [customHours, setCustomHours] = useState<number>(room.customHours || 1);
  const [checkInTime, setCheckInTime] = useState<string>(toLocalIsoString(room.checkInTime));
  const [extraBeds, setExtraBeds] = useState(room.extraBeds || 0);
  const [towelSets, setTowelSets] = useState(room.towelSets || 0);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'GCASH' | 'MIXED'>('CASH');
  const [gcashRef, setGcashRef] = useState('');
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [gcashAmount, setGcashAmount] = useState<number>(0);
  const [amountTendered, setAmountTendered] = useState<number>(0);
  const prevPaymentMethodRef = useRef<'CASH' | 'GCASH' | 'MIXED'>(paymentMethod);
  const [discountType, setDiscountType] = useState<'NONE' | 'SENIOR' | 'DC'>(room.discountType || 'NONE');
  const [discountIdRef, setDiscountIdRef] = useState(room.discountIdRef || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isForceCheckoutModalOpen, setIsForceCheckoutModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [prePrintReceipt, setPrePrintReceipt] = useState<Receipt | null>(null);
  const [gatePassData, setGatePassData] = useState<GatePassData | null>(null);
  // isDirty: true while cashier is actively editing form fields.
  const isDirty = useRef(false);
  const [isSavingChanges, setIsSavingChanges] = useState(false);

  // Active Held Deposit State
  const [activeDeposit, setActiveDeposit] = useState<Deposit | null>(null);
  const [depositResolution, setDepositResolution] = useState<'apply' | 'refund' | 'forfeit'>('apply');
  const [depositNotes, setDepositNotes] = useState('');

  // Fetch active deposit for occupied rooms
  useEffect(() => {
    let isCancelled = false;
    const fetchActiveDeposit = async () => {
      if (room.state !== 'occupied' && room.state !== 'overdue') {
        setActiveDeposit(null);
        return;
      }
      try {
        const res = await getActiveRoomDeposit(room.number);
        if (!isCancelled) {
          if (res.hasHeldDeposit && res.deposit && res.deposit.status === 'held') {
            setActiveDeposit(res.deposit);
            setDepositResolution('apply');
            setDepositNotes('');
          } else {
            setActiveDeposit(null);
          }
        }
      } catch (err) {
        if (!isCancelled) setActiveDeposit(null);
      }
    };
    fetchActiveDeposit();
    return () => { isCancelled = true; };
  }, [room.number, room.state]);

  // Collapsible drawer sections
  const [openSections, setOpenSections] = useState({
    stay: true,
    charges: true,
    deposit: false,
    payment: true,
    guestStay: true,
    extras: false,
  });
  useEffect(() => {
    setOpenSections({ stay: true, charges: true, deposit: false, payment: true, guestStay: true, extras: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.number]);
  const toggleSection = (key: keyof typeof openSections) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // Charged food orders
  const [chargedFood, setChargedFood] = useState<Array<{ item: POSItem; quantity: number }>>([]);

  // Live shift inventory
  const [inventoryMap, setInventoryMap] = useState<Record<string, InventoryItem>>({});
  const refreshInventory = async () => {
    try {
      const res = await getCurrentInventory();
      const map: Record<string, InventoryItem> = {};
      res.items.forEach((it) => {
        map[it.item_id] = it;
      });
      setInventoryMap(map);
    } catch (err) {
      console.warn('Could not load inventory in RoomDetailSidebar:', err);
    }
  };
  useEffect(() => {
    refreshInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.number]);

  /** True when a tracked item has run out */
  const isOutOfStock = (itemId: string): boolean => {
    const inv = inventoryMap[itemId];
    return Boolean(inv && inv.is_tracked && inv.current_quantity <= 0);
  };
  /** Remaining portions for a tracked item */
  const stockRemaining = (itemId: string): number | null => {
    const inv = inventoryMap[itemId];
    return inv && inv.is_tracked ? inv.current_quantity : null;
  };

  // Track previous room number to reset dirty state on room switch
  const prevRoomNumberRef = useRef<string | null>(null);

  // Load room data when active room changes
  useEffect(() => {
    if (prevRoomNumberRef.current !== room.number) {
      isDirty.current = false;
      prevRoomNumberRef.current = room.number;
    }
    if (isDirty.current) return;
    setGuestName(room.guestName || '');
    setGuestId(room.guestId || '');
    // Section 11: Default persons = 2 on every new check-in form, freshly initialized on open (never remembers previous value, no carry-over)
    setNumGuests(room.state === 'available' ? 2 : (room.numGuests || 2));
    setRateSelected(room.rateSelected || '24h');
    setCustomHours(room.customHours || 1);
    setCheckInTime(toLocalIsoString(room.checkInTime));
    setExtraBeds(room.extraBeds || 0);
    setTowelSets(room.towelSets || 0);
    setPaymentMethod('CASH');
    setGcashRef('');
    setAmountTendered(0);
    setDiscountType(room.discountType || 'NONE');
    setDiscountIdRef(room.discountIdRef || '');

    // Seed or load from room.chargedFood
    if (room.chargedFood) {
      setChargedFood(room.chargedFood);
    } else if (room.number === '204' && room.state === 'occupied') {
      const tapsilog = dynamicCatalog.find(f => f.id === 'silog-special');
      const beer = dynamicCatalog.find(f => f.id === 'san-miguel-pale');
      const seeded = [];
      if (tapsilog) seeded.push({ item: tapsilog, quantity: 1 });
      if (beer) seeded.push({ item: beer, quantity: 1 });
      setChargedFood(seeded);
    } else {
      setChargedFood([]);
    }
  }, [room.number, room.state, dynamicCatalog]);

  /** Mark the form dirty so background room-poll won't overwrite edits. */
  const markDirty = useCallback(() => { isDirty.current = true; }, []);

  /** Save current form edits to the server explicitly, then clear dirty flag. */
  const handleSaveChanges = useCallback(async () => {
    if (isSavingChanges) return;
    setIsSavingChanges(true);
    try {
      const parsedIn = checkInTime ? new Date(checkInTime) : (room.checkInTime ? new Date(room.checkInTime) : new Date());
      const validIn = !isNaN(parsedIn.getTime()) ? parsedIn : new Date();
      const newCheckOut = calculateExpectedCheckout(rateSelected, validIn, customHours).toISOString();
      await onUpdateRoom({
        ...room,
        guestName: guestName.trim() || room.guestName || 'Walk-in Guest',
        guestId,
        numGuests,
        rateSelected,
        customHours: rateSelected === 'custom' ? customHours : undefined,
        extraBeds,
        towelSets,
        chargedFood,
        discountType,
        discountIdRef,
        checkInTime: validIn.toISOString(),
        checkOutTime: newCheckOut,
      });
      isDirty.current = false;
      toast.success('Changes Saved', 'Room details have been updated successfully.');
    } catch {
      // onUpdateRoom already toasted the error
    } finally {
      setIsSavingChanges(false);
    }
  }, [
    isSavingChanges,
    checkInTime,
    room,
    rateSelected,
    customHours,
    onUpdateRoom,
    guestName,
    guestId,
    numGuests,
    extraBeds,
    towelSets,
    chargedFood,
    discountType,
    discountIdRef,
    toast,
  ]);

  // Compute Bill breakdown with useMemo
  const financialBreakdown = useMemo(() => {
    const baseRate = getRateValue(room.tier, rateSelected);
    const bedsCharge = extraBeds * extraBedService.price;
    const towelsCharge = towelSets * towelService.price;
    const currentNumGuests = room.state === 'occupied' ? (room.numGuests || 1) : numGuests;
    const extraGuests = Math.max(0, currentNumGuests - 2);
    const extraPersonCharge = extraGuests * extraPersonService.price;
    const foodCharge = chargedFood.reduce((sum, order) => sum + order.item.price * order.quantity, 0);

    // Overdue excess hours calculation (past 15-minute grace period)
    const isOccupiedOrOverdue = room.state === 'occupied' || room.state === 'overdue';
    const excessHours = (isOccupiedOrOverdue && rateSelected !== 'custom') ? calculateExcessHours(room.checkOutTime) : 0;
    const excessHoursCharge = excessHours * (excessHourService.price || EXCESS_HOUR_RATE);

    const rawDiscount = discountType !== 'NONE'
      ? getDiscountAmountPesos(discountType, room.tier, rateSelected)
      : null;
    const discountAmount = rawDiscount !== null ? rawDiscount : 0;
    const runningTotal = Math.max(0, baseRate - discountAmount + bedsCharge + towelsCharge + extraPersonCharge + foodCharge + excessHoursCharge);
    const chargedCount = chargedFood.reduce((sum, f) => sum + f.quantity, 0);

    // Deposit resolution adjustments
    const appliedDepositAmount = (depositResolution === 'apply' && activeDeposit)
      ? Math.min(runningTotal, activeDeposit.amount)
      : 0;
    const excessDepositRefund = (depositResolution === 'apply' && activeDeposit && activeDeposit.amount > runningTotal)
      ? activeDeposit.amount - runningTotal
      : 0;
    const netTotalDue = Math.max(0, runningTotal - appliedDepositAmount);

    return {
      baseRate,
      bedsCharge,
      towelsCharge,
      currentNumGuests,
      extraGuests,
      extraPersonCharge,
      foodCharge,
      excessHours,
      excessHoursCharge,
      rawDiscount,
      discountAmount,
      runningTotal,
      chargedCount,
      appliedDepositAmount,
      excessDepositRefund,
      netTotalDue,
    };
  }, [
    room.tier,
    room.state,
    room.numGuests,
    room.checkOutTime,
    rateSelected,
    extraBeds,
    extraBedService.price,
    towelSets,
    towelService.price,
    numGuests,
    extraPersonService.price,
    chargedFood,
    excessHourService.price,
    discountType,
    getRateValue,
    depositResolution,
    activeDeposit,
  ]);

  const {
    baseRate,
    bedsCharge,
    towelsCharge,
    extraGuests,
    extraPersonCharge,
    foodCharge,
    excessHours,
    excessHoursCharge,
    rawDiscount,
    discountAmount,
    runningTotal,
    chargedCount,
    appliedDepositAmount,
    excessDepositRefund,
    netTotalDue,
  } = financialBreakdown;

  // Legacy extras inventory tracking
  const extraBedStock = stockRemaining('extra-bed');
  const extraTowelStock = stockRemaining('towel');
  const isExtraBedCapped = extraBedStock !== null && extraBeds >= extraBedStock;
  const isExtraTowelCapped = extraTowelStock !== null && towelSets >= extraTowelStock;
  const bumpExtraBeds = useCallback(() => {
    if (extraBedStock !== null && extraBeds >= extraBedStock) {
      toast.warning(
        extraBedStock <= 0 ? 'Out of Stock' : 'Stock Limit',
        extraBedStock <= 0
          ? 'No extra beds left in inventory.'
          : `Only ${extraBedStock} extra bed(s) available in stock.`
      );
      return;
    }
    setExtraBeds(prev => prev + 1);
  }, [extraBedStock, extraBeds, toast]);

  const bumpTowelSets = useCallback(() => {
    if (extraTowelStock !== null && towelSets >= extraTowelStock) {
      toast.warning(
        extraTowelStock <= 0 ? 'Out of Stock' : 'Stock Limit',
        extraTowelStock <= 0
          ? 'No towel sets left in inventory.'
          : `Only ${extraTowelStock} towel set(s) available in stock.`
      );
      return;
    }
    setTowelSets(prev => prev + 1);
  }, [extraTowelStock, towelSets, toast]);

  // Rate change for occupied room
  const handleOccupiedRateChange = useCallback((newRate: Room['rateSelected']) => {
    setRateSelected(newRate);
    const parsedIn = checkInTime ? new Date(checkInTime) : (room.checkInTime ? new Date(room.checkInTime) : new Date());
    const validIn = !isNaN(parsedIn.getTime()) ? parsedIn : new Date();
    const newCheckOut = calculateExpectedCheckout(newRate, validIn, customHours).toISOString();
    onUpdateRoom({
      ...room,
      rateSelected: newRate,
      customHours: newRate === 'custom' ? customHours : undefined,
      checkOutTime: newCheckOut,
      discountType,
      discountIdRef,
    }).catch(() => { /* already toasted + reverted */ });
  }, [checkInTime, room, customHours, onUpdateRoom, discountType, discountIdRef]);

  // Discount handlers
  const handleDiscountTypeChange = useCallback((type: 'NONE' | 'SENIOR' | 'DC') => {
    markDirty();
    setDiscountType(type);
    const newRef = type === 'NONE' ? '' : discountIdRef;
    if (type === 'NONE') {
      setDiscountIdRef('');
    }
    if (room.state === 'occupied' || room.state === 'overdue') {
      onUpdateRoom({
        ...room,
        discountType: type,
        discountIdRef: newRef,
      }).catch(() => { /* already toasted + reverted */ });
    }
  }, [markDirty, discountIdRef, room, onUpdateRoom]);

  const handleDiscountIdRefChange = useCallback((refVal: string) => {
    markDirty();
    setDiscountIdRef(refVal);
  }, [markDirty]);

  const handleDiscountIdRefBlur = useCallback(() => {
    if (room.state === 'occupied' || room.state === 'overdue') {
      onUpdateRoom({
        ...room,
        discountType,
        discountIdRef,
      }).catch(() => { /* already toasted + reverted */ });
    }
  }, [room, discountType, discountIdRef, onUpdateRoom]);

  const handleDiscountAndRateChange = useCallback((newDiscountType: 'NONE' | 'SENIOR' | 'DC', newRate?: Room['rateSelected']) => {
    markDirty();
    const nextRate = newRate || rateSelected;
    setDiscountType(newDiscountType);
    const updatedRef = newDiscountType === 'NONE' ? '' : discountIdRef;
    if (newDiscountType === 'NONE') {
      setDiscountIdRef('');
    }
    if (newRate) {
      setRateSelected(newRate);
    }
    if (room.state === 'occupied' || room.state === 'overdue') {
      const parsedIn = checkInTime ? new Date(checkInTime) : (room.checkInTime ? new Date(room.checkInTime) : new Date());
      const validIn = !isNaN(parsedIn.getTime()) ? parsedIn : new Date();
      const newCheckOut = calculateExpectedCheckout(nextRate, validIn, customHours).toISOString();
      onUpdateRoom({
        ...room,
        rateSelected: nextRate,
        customHours: nextRate === 'custom' ? customHours : undefined,
        checkOutTime: newCheckOut,
        discountType: newDiscountType,
        discountIdRef: updatedRef,
      }).catch(() => { /* already toasted + reverted */ });
    }
  }, [markDirty, rateSelected, discountIdRef, room, checkInTime, customHours, onUpdateRoom]);

  // Quick Extension Handler
  const handleQuickExtend = async (hours: number) => {
    try {
      const res = await extendRoomStay(room.number, { hours });
      if (res.success && res.room) {
        await onUpdateRoom(res.room);
        toast.success('Stay Extended', `Extended Room ${room.number} by ${hours} hour(s).`);
      }
    } catch (err: any) {
      toast.error('Extension Failed', err.message || 'Failed to extend stay');
    }
  };

  // Alarm Snooze Handler
  const handleSnooze = async (minutes: number = 10) => {
    try {
      const res = await snoozeRoomAlarm(room.number, minutes);
      if (res.success) {
        const updatedRoom: Room = res.room || {
          ...room,
          snoozedUntil: res.snoozedUntil,
        };
        await onUpdateRoom(updatedRoom);
        toast.success('Alarm Snoozed', `Room ${room.number} alarm snoozed for ${minutes} minutes.`);
      }
    } catch (err: any) {
      toast.error('Snooze Failed', err.message || 'Failed to snooze alarm');
    }
  };

  // Switch to Open-Time Handler
  const handleSwitchOpenTime = async () => {
    try {
      const res = await switchRoomToOpenTime(room.number);
      if (res.success) {
        const updatedRoom: Room = res.room || {
          ...room,
          billingMode: 'open_time',
          openTimeStartedAt: res.openTimeStartedAt,
        };
        await onUpdateRoom(updatedRoom);
        toast.success('Switched to Open-Time', `Room ${room.number} is now in continuous Open-Time billing mode.`);
      }
    } catch (err: any) {
      toast.error('Switch Failed', err.message || 'Failed to switch to open-time mode');
    }
  };

  // Sticky-bar checkout gating (mirrors CheckoutActions validation + server 400 contract)
  const isDiscountUnmapped = discountType !== 'NONE' && rawDiscount === null;
  const gcashRefTrimmedForBar = gcashRef.trim();
  const isGcashMissingForBar = netTotalDue > 0 &&
    (paymentMethod === 'GCASH' || (paymentMethod === 'MIXED' && gcashAmount > 0)) && !gcashRefTrimmedForBar;
  const isGcashFormatInvalidForBar = netTotalDue > 0 &&
    (paymentMethod === 'GCASH' || (paymentMethod === 'MIXED' && gcashAmount > 0)) &&
    Boolean(gcashRefTrimmedForBar) && !/^\d{13}$/.test(gcashRefTrimmedForBar);
  const isMixedImbalancedForBar =
    paymentMethod === 'MIXED' && netTotalDue > 0 && Math.abs((cashAmount + gcashAmount) - netTotalDue) >= 0.01;
  const isTenderedInsufficientForBar = netTotalDue > 0 && (
    paymentMethod === 'CASH'
      ? (amountTendered < netTotalDue || amountTendered <= 0)
      : paymentMethod === 'MIXED'
      ? (cashAmount > 0 && (amountTendered < cashAmount || amountTendered <= 0))
      : false
  );
  const isForfeitMissingNoteForBar = depositResolution === 'forfeit' && Boolean(activeDeposit) && !depositNotes.trim();

  const isCheckoutBlocked = isSubmitting || isDiscountUnmapped || isGcashMissingForBar || isGcashFormatInvalidForBar || isMixedImbalancedForBar || isTenderedInsufficientForBar || isForfeitMissingNoteForBar;
  const checkoutBlockReason = isSubmitting
    ? 'Processing…'
    : isDiscountUnmapped
      ? `No discount configured for ${discountType}/${room.tier}/${rateSelected} (No ${discountType === 'SENIOR' ? 'Senior/PWD' : 'Discount Card'} discount configured). Remove client discount selection.`
      : isForfeitMissingNoteForBar
        ? 'Forfeit reason required'
        : isGcashMissingForBar || isGcashFormatInvalidForBar
          ? 'GCash transaction reference must be exactly 13 digits.'
          : isMixedImbalancedForBar
            ? 'Cash + GCash must equal net total due'
            : isTenderedInsufficientForBar
              ? `Amount tendered (₱${amountTendered.toFixed(2)}) is less than total due (₱${(paymentMethod === 'MIXED' ? cashAmount : netTotalDue).toFixed(2)})`
              : null;

  const handleCashAmountChange = useCallback((val: number) => {
    markDirty();
    setCashAmount(val);
    const remaining = Math.max(0, netTotalDue - val);
    setGcashAmount(remaining);
  }, [markDirty, netTotalDue]);

  const handleGcashAmountChange = useCallback((val: number) => {
    markDirty();
    setGcashAmount(val);
    const remaining = Math.max(0, netTotalDue - val);
    setCashAmount(remaining);
  }, [markDirty, netTotalDue]);

  // Fix MIXED payment split reset bug: only initialize amounts on explicit transition into 'MIXED',
  // never overwrite on every netTotalDue tick.
  useEffect(() => {
    if (paymentMethod === 'MIXED' && prevPaymentMethodRef.current !== 'MIXED') {
      setCashAmount(netTotalDue);
      setGcashAmount(0);
    }
    prevPaymentMethodRef.current = paymentMethod;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentMethod]);

  const handleCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalGuestName = guestName.trim() || 'Walk-in Guest';
    const stayHours = getStayDurationHours(rateSelected, customHours);
    const parsedCheckIn = checkInTime ? new Date(checkInTime) : new Date();
    const checkInDate = !isNaN(parsedCheckIn.getTime()) ? parsedCheckIn : new Date();
    const checkInIso = checkInDate.toISOString();
    const checkOutIso = calculateExpectedCheckout(rateSelected, checkInDate, customHours).toISOString();

    const updated: Room = {
      ...room,
      state: 'occupied',
      label: finalGuestName.split(',')[0],
      guestName: finalGuestName,
      guestId,
      numGuests,
      rateSelected,
      customHours: rateSelected === 'custom' ? customHours : undefined,
      extraBeds,
      towelSets,
      chargedFood,
      discountType,
      discountIdRef: discountType === 'NONE' ? '' : discountIdRef,
      time: `${stayHours}h 00m`,
      checkInTime: checkInIso,
      checkOutTime: checkOutIso,
      billingMode: 'standard',
      openTimeStartedAt: undefined,
      snoozedUntil: undefined,
      repeatCount: 0,
      overtimeWaived: false,
    };
    try {
      await onUpdateRoom(updated);
    } catch {
      // onUpdateRoom already toasted + reverted; keep drawer open.
      return;
    }

    // Create kitchen order if there are pre-added food/drink items
    const kitchenFoodItems = chargedFood.filter(f => kitchenOrderService.isFoodItem(f.item));
    if (kitchenFoodItems.length > 0) {
      kitchenOrderService.createOrder({
        room_number: room.number,
        guest_name: finalGuestName,
        cashier_name: activeCashier || loggedInUser || 'Frontdesk',
        items: kitchenFoodItems.map(f => ({
          item_id: f.item.id,
          name: f.item.name,
          quantity: f.quantity,
        })),
        total_amount: kitchenFoodItems.reduce((sum, f) => sum + (f.item.price * f.quantity), 0),
        priority: 'normal',
      }).catch(err => console.error('Failed to create check-in kitchen order:', err));
    }
  };

  const handleCheckOut = async () => {
    if (isSubmitting) return;

    // Guard against double-checkout
    if (room.state !== 'occupied' && room.state !== 'overdue') {
      toast.warning('Already Checked Out', `Room ${room.number} is currently ${room.state.toUpperCase()}.`);
      return;
    }

    if (discountType !== 'NONE' && rawDiscount === null) {
      toast.warning('Unconfigured Discount', `No discount configured for ${discountType}/${room.tier}/${rateSelected} (No ${discountType === 'SENIOR' ? 'Senior/PWD' : 'Discount Card'} discount configured). Remove client discount selection.`);
      return;
    }

    if (depositResolution === 'forfeit' && Boolean(activeDeposit) && !depositNotes.trim()) {
      toast.warning('Forfeit Reason Required', 'Please provide a reason/incident note when forfeiting a security deposit.');
      return;
    }

    if (netTotalDue > 0) {
      if (paymentMethod === 'MIXED' && Math.abs((cashAmount + gcashAmount) - netTotalDue) > 0.01) {
        toast.warning('Payment Mismatch', 'The sum of Cash and GCash amounts must equal the net amount due.');
        return;
      }
      if ((paymentMethod === 'GCASH' || (paymentMethod === 'MIXED' && gcashAmount > 0))) {
        const refTrimmed = gcashRef.trim();
        if (!refTrimmed) {
          toast.warning('GCash Ref Required', 'Please enter the GCash Transaction Reference Number.');
          return;
        }
        if (!/^\d{13}$/.test(refTrimmed)) {
          toast.warning('Invalid GCash Reference', 'GCash transaction reference must be exactly 13 digits.');
          return;
        }
      }

      if (paymentMethod === 'CASH' && (amountTendered < netTotalDue || amountTendered <= 0)) {
        toast.warning('Insufficient Cash Tendered', `Tendered cash (₱${amountTendered.toFixed(2)}) is less than total due (₱${netTotalDue.toFixed(2)}).`);
        return;
      }
      if (paymentMethod === 'MIXED' && cashAmount > 0 && (amountTendered < cashAmount || amountTendered <= 0)) {
        toast.warning('Insufficient Cash Tendered', `Tendered cash (₱${amountTendered.toFixed(2)}) is less than cash portion (₱${cashAmount.toFixed(2)}).`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      // Flush latest drawer ledger to SQLite BEFORE receipt is created
      try {
        await onUpdateRoom({
          ...room,
          rateSelected,
          customHours: rateSelected === 'custom' ? customHours : undefined,
          extraBeds,
          towelSets,
          chargedFood,
          discountType,
          discountIdRef,
        });
      } catch (flushErr) {
        return;
      }

      // Generate Receipt structure
      const parsedCheckIn = checkInTime ? new Date(checkInTime) : (room.checkInTime ? new Date(room.checkInTime) : new Date(Date.now() - 86400000));
      const checkInIso = !isNaN(parsedCheckIn.getTime()) ? parsedCheckIn.toISOString() : new Date(Date.now() - 86400000).toISOString();
      const checkOutIso = new Date().toISOString();
      const stayDurationLabel = room.billingMode === 'open_time' ? 'Open-Time Stay' : formatStayDuration(rateSelected, customHours);
      const rateSubtext = room.billingMode === 'open_time'
        ? 'Open-Time Continuous Stay'
        : rateSelected === 'custom'
        ? `${customHours} Hours × ₱130/hr`
        : `${stayDurationLabel} Base Rate`;

      const finalTendered = netTotalDue === 0
        ? 0
        : paymentMethod === 'CASH'
        ? amountTendered
        : paymentMethod === 'GCASH'
        ? netTotalDue
        : (amountTendered > 0 ? amountTendered : cashAmount);
      const cashDue = paymentMethod === 'MIXED' ? cashAmount : netTotalDue;
      const finalChange = paymentMethod === 'GCASH' ? 0 : Math.max(0, finalTendered - cashDue);

      const idempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `checkout-${room.number}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const items = [
        { description: `${room.roomType} Rent${rateSelected === 'custom' ? ' (Custom Stay)' : ''}`, subtext: rateSubtext, amount: baseRate },
      ];
      if (discountAmount > 0 && discountType !== 'NONE') {
        const desc = discountType === 'DC' ? 'Discount Card (DC)' : 'Senior / PWD Discount';
        const subtext = discountType === 'DC'
          ? (discountIdRef.trim() ? `Fixed Card Discount [Card #: ${discountIdRef.trim()}]` : 'Fixed Card Discount')
          : (discountIdRef.trim() ? `Fixed Statutory Discount [ID: ${discountIdRef.trim()}]` : 'Fixed Statutory Discount');
        items.push({ description: desc, subtext: subtext, amount: -discountAmount });
      }
      if (extraBeds > 0) {
        items.push({ description: 'Extra Bed Add-on', subtext: `${extraBeds} Bed(s) x ₱${extraBedService.price}`, amount: bedsCharge });
      }
      if (towelSets > 0) {
        items.push({ description: 'Extra Towels Add-on', subtext: `${towelSets} Set(s) x ₱${towelService.price}`, amount: towelsCharge });
      }
      if (extraPersonCharge > 0) {
        items.push({ description: 'Extra Person Surcharge', subtext: `${extraGuests} Extra Guest(s) (beyond 2) x ₱${extraPersonService.price}`, amount: extraPersonCharge });
      }
      if (excessHoursCharge > 0) {
        items.push({
          description: 'Excess Stay / Late Checkout Surcharge',
          subtext: `${excessHours} Overstay Hour(s) × ₱${excessHourService.price || EXCESS_HOUR_RATE}/hr (past 15m grace)`,
          amount: excessHoursCharge,
        });
      }
      chargedFood.forEach(f => {
        items.push({ description: f.item.name, subtext: `${f.quantity} Qty x ₱${f.item.price}`, amount: f.item.price * f.quantity });
      });

      // Include applied security deposit in items if applied
      if (appliedDepositAmount > 0 && depositResolution === 'apply' && activeDeposit) {
        items.push({
          description: `Applied Security Deposit (${activeDeposit.depositNumber})`,
          subtext: 'Deducted from check-out account balance',
          amount: -appliedDepositAmount,
        });
      }

      let depositBalance = 0;
      try {
        const depositData = await getGuestDepositBalance(room.guestId || room.guestName || 'Walk-in Guest');
        depositBalance = depositData.balance;
      } catch (err) {
        console.warn('Failed to fetch deposit balance during checkout:', err);
      }

      const receiptObj: Receipt = {
        receiptNo: '', // Sequential receipt number allocated server-side
        idempotencyKey,
        dateTime: checkOutIso,
        guestName: guestName || room.guestName || 'Walk-in Guest',
        roomNumber: room.number,
        roomType: room.roomType,
        paymentMethod,
        gcashRef: (netTotalDue > 0 && (paymentMethod === 'GCASH' || (paymentMethod === 'MIXED' && gcashAmount > 0))) ? gcashRef.trim() : undefined,
        cashAmount: paymentMethod === 'MIXED' ? cashAmount : (paymentMethod === 'CASH' ? netTotalDue : 0),
        gcashAmount: paymentMethod === 'MIXED' ? gcashAmount : (paymentMethod === 'GCASH' ? netTotalDue : 0),
        amountTendered: finalTendered,
        changeAmount: finalChange,
        amountTenderedCents: Math.round(finalTendered * 100),
        changeCents: Math.round(finalChange * 100),
        checkIn: checkInIso,
        checkOut: checkOutIso,
        items,
        subtotal: runningTotal + discountAmount,
        serviceCharge: 0,
        total: netTotalDue,
        discount: discountAmount > 0 ? discountAmount : undefined,
        discountType: discountType !== 'NONE' ? discountType : undefined,
        discountIdRef: discountAmount > 0 && discountIdRef.trim() ? discountIdRef.trim() : undefined,
        isSeniorPwdDiscount: discountType === 'SENIOR',
        isDiscountCard: discountType === 'DC',
        seniorPwdId: discountType === 'SENIOR' ? (discountIdRef.trim() || undefined) : undefined,
        discountCardId: discountType === 'DC' ? (discountIdRef.trim() || undefined) : undefined,
        cashierId: activeCashier,
        rateSelected: rateSelected,
        stayDuration: stayDurationLabel,
        depositBalance: depositBalance > 0 ? depositBalance : undefined,
        // F-04: resolve held deposit in-tx with the single POST /api/receipts call.
        ...(activeDeposit && activeDeposit.status === 'held'
          ? {
              depositResolution: {
                action: depositResolution,
                ...(depositNotes.trim() ? { notes: depositNotes.trim() } : {}),
              },
            }
          : {}),
      };

      await onGenerateReceipt(receiptObj);

      // NOTE: no second resolveDeposit call — server resolves the held deposit
      // atomically inside POST /api/receipts. Single-call path only.

      // Auto-clear / mark delivered any remaining active kitchen orders
      try {
        await kitchenOrderService.updateRoomStatus(room.number, 'delivered');
      } catch (kitchenErr) {
        console.warn('Auto-clearing kitchen orders on checkout warning:', kitchenErr);
      }

      // Reset room locally to Available (NO cleaning state)
      const updated: Room = {
        ...room,
        state: 'available',
        time: 'READY',
        label: 'Available',
        guestName: '',
        guestId: '',
        numGuests: 0,
        rateSelected: '24h',
        customHours: undefined,
        extraBeds: 0,
        towelSets: 0,
        checkInTime: undefined,
        checkOutTime: undefined,
        isOverdue: false,
        chargedFood: [],
        discountType: 'NONE',
        discountIdRef: '',
        billingMode: 'standard',
        openTimeStartedAt: undefined,
        snoozedUntil: undefined,
        repeatCount: 0,
        overtimeWaived: false,
      };
      await onUpdateRoom(updated);
    } catch (err: any) {
      console.error('Checkout error:', err);
      toast.error('Checkout Failed', err.message || 'Failed to complete checkout');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrePrintBill = async () => {
    const parsedCheckIn = checkInTime ? new Date(checkInTime) : (room.checkInTime ? new Date(room.checkInTime) : new Date(Date.now() - 86400000));
    const checkInIso = !isNaN(parsedCheckIn.getTime()) ? parsedCheckIn.toISOString() : new Date(Date.now() - 86400000).toISOString();
    const checkOutIso = new Date().toISOString();
    const stayDurationLabel = room.billingMode === 'open_time' ? 'Open-Time Stay' : formatStayDuration(rateSelected, customHours);
    const rateSubtext = room.billingMode === 'open_time'
      ? 'Open-Time Continuous Stay'
      : rateSelected === 'custom'
      ? `${customHours} Hours × ₱130/hr`
      : `${stayDurationLabel} Base Rate`;

    const items = [
      { description: `${room.roomType} Rent${rateSelected === 'custom' ? ' (Custom Stay)' : ''}`, subtext: rateSubtext, amount: baseRate },
    ];
    if (discountAmount > 0 && discountType !== 'NONE') {
      const desc = discountType === 'DC' ? 'Discount Card (DC)' : 'Senior / PWD Discount';
      const subtext = discountType === 'DC'
        ? (discountIdRef.trim() ? `Fixed Card Discount [Card #: ${discountIdRef.trim()}]` : 'Fixed Card Discount')
        : (discountIdRef.trim() ? `Fixed Statutory Discount [ID: ${discountIdRef.trim()}]` : 'Fixed Statutory Discount');
      items.push({ description: desc, subtext: subtext, amount: -discountAmount });
    }
    if (extraBeds > 0) {
      items.push({ description: 'Extra Bed Add-on', subtext: `${extraBeds} Bed(s) x ₱${extraBedService.price}`, amount: bedsCharge });
    }
    if (towelSets > 0) {
      items.push({ description: 'Extra Towels Add-on', subtext: `${towelSets} Set(s) x ₱${towelService.price}`, amount: towelsCharge });
    }
    if (extraPersonCharge > 0) {
      items.push({ description: 'Extra Person Surcharge', subtext: `${extraGuests} Extra Guest(s) (beyond 2) x ₱${extraPersonService.price}`, amount: extraPersonCharge });
    }
    if (excessHoursCharge > 0) {
      items.push({
        description: 'Excess Stay / Late Checkout Surcharge',
        subtext: `${excessHours} Overstay Hour(s) × ₱${excessHourService.price || EXCESS_HOUR_RATE}/hr (past 15m grace)`,
        amount: excessHoursCharge,
      });
    }
    chargedFood.forEach(f => {
      items.push({ description: f.item.name, subtext: `${f.quantity} Qty x ₱${f.item.price}`, amount: f.item.price * f.quantity });
    });

    if (appliedDepositAmount > 0 && depositResolution === 'apply' && activeDeposit) {
      items.push({
        description: `Applied Security Deposit (${activeDeposit.depositNumber})`,
        subtext: 'Deducted from check-out account balance',
        amount: -appliedDepositAmount,
      });
    }

    let depositBalance = 0;
    try {
      const depositData = await getGuestDepositBalance(room.guestId || room.guestName || 'Walk-in Guest');
      depositBalance = depositData.balance;
    } catch (err) {
      console.warn('Failed to fetch deposit balance during pre-print:', err);
    }

    const preReceipt: Receipt = {
      receiptNo: `SCTI-${room.number}-${Date.now().toString().slice(-4)}`,
      dateTime: checkOutIso,
      guestName: guestName || room.guestName || 'Walk-in Guest',
      roomNumber: room.number,
      roomType: room.roomType,
      paymentMethod: paymentMethod || 'CASH',
      cashAmount: paymentMethod === 'MIXED' ? cashAmount : undefined,
      gcashAmount: paymentMethod === 'MIXED' ? gcashAmount : undefined,
      gcashRef: (paymentMethod === 'GCASH' || paymentMethod === 'MIXED') && gcashRef.trim() ? gcashRef.trim() : undefined,
      checkIn: checkInIso,
      checkOut: checkOutIso,
      items,
      subtotal: runningTotal + discountAmount,
      serviceCharge: 0,
      total: netTotalDue,
      discount: discountAmount > 0 ? discountAmount : undefined,
      discountType: discountType !== 'NONE' ? discountType : undefined,
      discountIdRef: discountAmount > 0 && discountIdRef.trim() ? discountIdRef.trim() : undefined,
      cashierId: activeCashier,
      rateSelected: rateSelected,
      stayDuration: stayDurationLabel,
      depositBalance: depositBalance > 0 ? depositBalance : undefined,
    };

    // Flush unsaved drawer edits so server pre-print sees the same state, then
    // prefer the server-computed sequential pre-print (same number final will reuse).
    try {
      if (isDirty.current) {
        const parsedIn = checkInTime ? new Date(checkInTime) : (room.checkInTime ? new Date(room.checkInTime) : new Date());
        const validIn = !isNaN(parsedIn.getTime()) ? parsedIn : new Date();
        const newCheckOut = calculateExpectedCheckout(rateSelected, validIn, customHours).toISOString();
        await onUpdateRoom({
          ...room,
          guestName: guestName.trim() || room.guestName || 'Walk-in Guest',
          guestId,
          numGuests,
          rateSelected,
          customHours: rateSelected === 'custom' ? customHours : undefined,
          extraBeds,
          towelSets,
          chargedFood,
          discountType,
          discountIdRef,
          checkInTime: validIn.toISOString(),
          checkOutTime: newCheckOut,
        });
        isDirty.current = false;
      }
      const serverPre = await prePrintReceipt({
        roomNumber: room.number,
        cashierId: activeCashier,
        paymentMethod: paymentMethod || 'CASH',
        cashAmount: paymentMethod === 'MIXED' ? cashAmount : undefined,
        gcashAmount: paymentMethod === 'MIXED' ? gcashAmount : undefined,
        gcashRef: gcashRef.trim() || undefined,
        amountTendered: undefined,
        discountType: discountType !== 'NONE' ? discountType : undefined,
        discountIdRef: discountIdRef.trim() || undefined,
        rateSelected,
        customHours: rateSelected === 'custom' ? customHours : undefined,
        extraBeds,
        towelSets,
        chargedFood: chargedFood as any,
      });
      setPrePrintReceipt({ ...serverPre, depositBalance: depositBalance > 0 ? depositBalance : undefined });
    } catch (e: any) {
      console.warn('Server pre-print failed, falling back to local preview:', e);
      toast.warning('Pre-print offline', 'Showing local preview — final receipt number may differ. Save changes and retry for sequential number.');
      setPrePrintReceipt(preReceipt);
    }
  };

  const handleOpenGatePass = () => {
    const parsedCheckIn = checkInTime ? new Date(checkInTime) : (room.checkInTime ? new Date(room.checkInTime) : new Date(Date.now() - 86400000));
    const checkInIso = !isNaN(parsedCheckIn.getTime()) ? parsedCheckIn.toISOString() : new Date(Date.now() - 86400000).toISOString();
    const checkOutIso = new Date().toISOString();

    const data: GatePassData = {
      ticketNo: `GP-${room.number}-${Date.now().toString().slice(-4)}`,
      roomNumber: room.number,
      roomType: room.roomType,
      guestName: guestName || room.guestName || 'Walk-in Guest',
      checkIn: checkInIso,
      checkOut: checkOutIso,
      cashierName: activeCashier,
    };
    setGatePassData(data);
  };

  const handleStatusChange = (status: Room['state']) => {
    const updated: Room = {
      ...room,
      state: status,
      label: status === 'available' ? 'Available' : room.label,
      time: status === 'available' ? 'READY' : room.time,
    };
    onUpdateRoom(updated).catch(() => { /* already toasted + reverted */ });
  };

  const addFoodItem = (item: POSItem) => {
    if (isOutOfStock(item.id)) {
      toast.warning('Out of Stock', `"${item.name}" is currently 86'd / out of stock.`);
      return;
    }
    const alreadyCharged = chargedFood.find(f => f.item.id === item.id)?.quantity || 0;
    const remaining = stockRemaining(item.id);
    if (remaining !== null && alreadyCharged >= remaining) {
      toast.warning('Stock Limit', `Only ${remaining} portion(s) of "${item.name}" are available in stock.`);
      return;
    }
    const exist = chargedFood.find(f => f.item.id === item.id);
    let updated: Array<{ item: POSItem; quantity: number }>;
    if (exist) {
      updated = chargedFood.map(f => f.item.id === item.id ? { ...f, quantity: f.quantity + 1 } : f);
    } else {
      updated = [...chargedFood, { item, quantity: 1 }];
    }
    setChargedFood(updated);
    onUpdateRoom({ ...room, chargedFood: updated }).catch(() => { /* already toasted + reverted */ });
    refreshInventory();
  };

  const changeFoodQty = (itemId: string, diff: number) => {
    const targetItem = chargedFood.find(f => f.item.id === itemId);
    if (diff > 0 && targetItem) {
      if (isOutOfStock(itemId)) {
        toast.warning('Out of Stock', `"${targetItem.item.name}" is currently 86'd / out of stock.`);
        return;
      }
      const remaining = stockRemaining(itemId);
      if (remaining !== null && targetItem.quantity >= remaining) {
        toast.warning('Stock Limit', `Only ${remaining} portion(s) of "${targetItem.item.name}" are available in stock.`);
        return;
      }
    }
    const updated = chargedFood.map(f => {
      if (f.item.id === itemId) {
        const newQty = f.quantity + diff;
        return newQty > 0 ? { ...f, quantity: newQty } : null;
      }
      return f;
    }).filter(Boolean) as Array<{ item: POSItem; quantity: number }>;
    setChargedFood(updated);
    onUpdateRoom({ ...room, chargedFood: updated }).catch(() => { /* already toasted + reverted */ });
    if (diff > 0) {
      refreshInventory();
    }
  };

  return (
    <>
      {/* Drawer Overlay Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Centered Large Modal Container */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-detail-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 md:p-6 overflow-hidden pointer-events-none"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 12 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="pointer-events-auto w-full max-w-lg md:max-w-2xl lg:max-w-3xl max-h-[92vh] bg-white border border-secondary/80 shadow-2xl flex flex-col justify-between font-sans rounded-3xl overflow-hidden"
        >
          {/* Top sticky header */}
          <div className="p-5 sm:px-6 sm:py-4.5 border-b border-secondary/80 flex justify-between items-center bg-cream/30 shrink-0 backdrop-blur-md">
            <div>
              <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-widest font-bold">
                {isStaffHouse ? 'Employee Housing Terminal' : 'Frontdesk Drawer'}
              </span>
              <h2 id="room-detail-title" className="font-display font-black text-xl text-primary leading-tight flex items-center gap-2">
                {isStaffHouse ? 'Staff House (Room 12)' : `Room Terminal ${room.number}`}
              </h2>
            </div>
            <div className="flex items-center gap-1.5">
              {!isStaffHouse && (room.state === 'occupied' || room.state === 'overdue') && role !== 'kitchen' && (
                <button
                  type="button"
                  onClick={() => setIsForceCheckoutModalOpen(true)}
                  title={role === 'admin' || role === 'owner' ? 'Direct Force Check-Out (Admin Override)' : 'Request Force Check-Out (Admin Escalation)'}
                  className="p-1.5 rounded-full border border-rose-200 bg-rose-50/60 text-rose-600 hover:bg-rose-100 transition cursor-pointer"
                >
                  <ShieldAlert size={16} />
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-cream rounded-full transition text-charcoal/40 hover:text-charcoal cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="p-5 sm:p-6 flex-1 overflow-y-auto flex flex-col gap-4">
            {/* Role-Based Guidance Banners */}
            {role === 'kitchen' && !isStaffHouse && (
              <div className="bg-amber-50 border border-amber-200/60 p-3.5 rounded-xl flex items-start gap-2.5 text-xs text-amber-800">
                <ShieldAlert size={16} className="text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <span className="font-bold">Kitchen Operator Mode</span>
                  <p className="text-[11px] text-amber-700/85 mt-0.5 font-sans leading-relaxed">
                    You can view active guest rooms and charge restaurant or minibar food orders to their account. Check-in and check-out capabilities are restricted.
                  </p>
                </div>
              </div>
            )}

            {/* Room properties status capsule */}
            {isStaffHouse ? (
              <div className="bg-indigo-50/50 rounded-xl p-4 border border-indigo-200/70 flex justify-between items-center">
                <div>
                  <span className="text-[10px] font-mono uppercase text-indigo-900 font-bold">Property Designation</span>
                  <div className="font-display font-bold text-sm text-indigo-950">Staff Living Quarters</div>
                  <span className="text-[10px] text-emerald-700 font-mono font-bold">₱0.00 Base Rent (Free Housing)</span>
                </div>
                <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-indigo-100 text-indigo-800 border border-indigo-300 font-mono uppercase">
                  STAFF QUARTERS
                </span>
              </div>
            ) : (
              <div className="bg-cream/40 rounded-xl p-4 border border-secondary/40 flex justify-between items-center">
                <div>
                  <span className="text-[10px] font-mono uppercase text-charcoal/50">Classification</span>
                  <div className="font-display font-bold text-sm text-charcoal">{room.roomType}</div>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-primary/5 text-primary border border-primary/10">
                  {getTierDisplayName(room.tier)}
                </span>
              </div>
            )}

            {/* Urgent Checkout / Overdue Grace Banner */}
            {(() => {
              const config = getRoomStatusConfig(room);
              if (!config.isUrgent || !room.checkOutTime) return null;

              const checkout = new Date(room.expectedCheckoutAt || room.checkOutTime);
              const isOverdue = config.urgencyLevel === 'overdue' || config.urgencyLevel === 'late-past-grace';
              const isDue = config.urgencyLevel === 'due' || config.urgencyLevel === 'overdue-grace';
              const isWarning = config.urgencyLevel === 'warning';

              if (isOverdue) {
                return (
                  <div className="bg-rose-50 border-2 border-rose-500 p-3.5 rounded-xl flex items-start gap-3 text-rose-950 shadow-sm animate-pulse-slow">
                    <AlertTriangle size={18} className="text-rose-600 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-extrabold font-mono text-xs uppercase tracking-wide">
                          🚨 OVERDUE CHECKOUT (+15m Grace Expired)
                        </span>
                        <span className="text-[10px] font-mono font-black bg-rose-200 text-rose-950 px-2 py-0.5 rounded border border-rose-400">
                          {room.time}
                        </span>
                      </div>
                      <p className="text-[11px] font-sans text-rose-900 mt-1 leading-relaxed">
                        15-minute grace period has expired for this apartment. Scheduled checkout was {formatManilaTime(checkout)}.
                        {excessHoursCharge > 0 && (
                          <span className="block mt-1 font-bold font-mono text-rose-950">
                            ⚡ Automatic Excess Charge: +₱{excessHoursCharge.toLocaleString()} ({excessHours} hr{excessHours === 1 ? '' : 's'} @ ₱{excessHourService.price || EXCESS_HOUR_RATE}/hr) added to bill.
                          </span>
                        )}
                      </p>

                      {/* Alarm Acknowledgment Action */}
                      <div className="mt-2.5 pt-2 border-t border-rose-200/80 flex items-center justify-between gap-2">
                        {room.acknowledgedAt ? (
                          <div className="inline-flex items-center gap-1.5 text-[11px] font-mono font-bold text-rose-900 bg-rose-200/70 px-2.5 py-1 rounded-md border border-rose-300">
                            <CheckCircle2 size={13} className="text-rose-700" />
                            <span>Acknowledged by {room.acknowledgedBy || 'staff'} at {formatManilaTime(room.acknowledgedAt)}</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const res = await acknowledgeRoomAlarm(room.number);
                                await onUpdateRoom({
                                  ...room,
                                  acknowledgedAt: res.acknowledgedAt,
                                  acknowledgedBy: res.acknowledgedBy,
                                });
                                toast.success('Alarm Acknowledged', `Alarm for Room ${room.number} marked acknowledged.`);
                              } catch (err: any) {
                                toast.error('Acknowledgment Failed', err.message || 'Failed to acknowledge alarm');
                              }
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-mono font-bold rounded-lg shadow-xs transition cursor-pointer active:scale-95"
                          >
                            <BellOff size={13} />
                            <span>Acknowledge Alarm</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              } else if (isDue) {
                return (
                  <div className="bg-orange-50 border border-orange-300 p-3.5 rounded-xl flex items-start gap-3 text-orange-950 shadow-sm">
                    <AlertTriangle size={18} className="text-orange-600 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-extrabold font-mono text-xs uppercase tracking-wide">
                          ⏰ CHECKOUT DUE (0-15m Grace Period Active)
                        </span>
                        <span className="text-[10px] font-mono font-bold bg-orange-200 text-orange-950 px-2 py-0.5 rounded border border-orange-300">
                          {room.time}
                        </span>
                      </div>
                      <p className="text-[11px] font-sans text-orange-900 mt-1 leading-relaxed">
                        Guest reached scheduled checkout ({formatManilaTime(checkout)}) and is currently within the 15-minute grace window.
                      </p>
                    </div>
                  </div>
                );
              } else if (isWarning) {
                return (
                  <div className="bg-amber-50 border border-amber-300 p-3.5 rounded-xl flex items-start gap-3 text-amber-950 shadow-sm">
                    <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-extrabold font-mono text-xs uppercase tracking-wide">
                          ⚠️ CHECKOUT DUE SOON (&lt;15m)
                        </span>
                        <span className="text-[10px] font-mono font-bold bg-amber-200 text-amber-950 px-2 py-0.5 rounded border border-amber-300">
                          {room.time}
                        </span>
                      </div>
                      <p className="text-[11px] font-sans text-amber-900 mt-1 leading-relaxed">
                        Checkout scheduled in less than 15 minutes ({formatManilaTime(checkout)}).
                      </p>
                    </div>
                  </div>
                );
              }
              return null;
            })()}

            {/* Dynamic status controller */}
            {!isStaffHouse && (
              <div className="space-y-2">
                <label className="text-[11px] font-mono uppercase tracking-wider text-charcoal/50">
                  Override Status
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['available', 'maintenance'] as Room['state'][]).map((st) => (
                    <button
                      key={st}
                      onClick={() => handleStatusChange(st)}
                      className={`py-1.5 rounded-lg text-[10px] font-mono font-bold tracking-wide uppercase transition border cursor-pointer ${
                        room.state === st
                          ? 'bg-primary border-primary text-white'
                          : 'bg-white border-secondary/40 text-charcoal/60 hover:bg-cream/40'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Room Transfer Action for Occupied Rooms */}
            {!isStaffHouse && (room.state === 'occupied' || room.state === 'overdue') && (
              <button
                type="button"
                onClick={() => setIsTransferModalOpen(true)}
                className="w-full py-2.5 px-3 rounded-2xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 text-indigo-950 font-mono text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-[0.99]"
                title="Relocate guest to another available room"
              >
                <ArrowRightLeft size={14} className="text-indigo-600 shrink-0" />
                <span>Transfer Guest to Another Room</span>
              </button>
            )}

            {/* CONDITIONAL PANEL: STAFF HOUSE vs AVAILABLE vs OCCUPIED */}
            {isStaffHouse ? (
              <StaffHouseView
                room={room}
                dynamicCatalog={dynamicCatalog}
                chargedFood={chargedFood}
                addFoodItem={addFoodItem}
                changeFoodQty={changeFoodQty}
                onUpdateRoom={onUpdateRoom}
                onGenerateReceipt={onGenerateReceipt}
                onClose={onClose}
                activeCashier={activeCashier}
                loggedInUser={loggedInUser}
              />
            ) : role === 'kitchen' && room.state !== 'occupied' && room.state !== 'overdue' ? (
              <div className="space-y-4 pt-4 border-t border-secondary/35 flex flex-col items-stretch text-center">
                <p className="text-xs text-charcoal/50 italic leading-relaxed">
                  This room is currently vacant. Kitchen staff can only charge restaurant orders to rooms with an active guest stay.
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full bg-primary hover:bg-primary-light text-white font-sans text-xs font-bold py-3.5 rounded-xl transition cursor-pointer active:scale-[0.98]"
                >
                  Close Drawer
                </button>
              </div>
            ) : room.state !== 'occupied' && room.state !== 'overdue' ? (
              <form onSubmit={handleCheckIn} className="space-y-3">
                <DrawerSection
                  title="Guest & Stay"
                  subtitle={`${formatStayDuration(rateSelected, customHours)} • ₱${baseRate.toLocaleString()}`}
                  open={openSections.guestStay}
                  onToggle={() => toggleSection('guestStay')}
                >
                  <div className="space-y-4">
                    <WalkInCheckIn
                      room={room}
                      guestName={guestName}
                      setGuestName={setGuestName}
                      guestId={guestId}
                      setGuestId={setGuestId}
                      numGuests={numGuests}
                      setNumGuests={setNumGuests}
                      rateSelected={rateSelected}
                      setRateSelected={setRateSelected}
                      customHours={customHours}
                      setCustomHours={setCustomHours}
                      getRateValue={getRateValue}
                      checkInTime={checkInTime}
                      setCheckInTime={setCheckInTime}
                      handleCheckIn={handleCheckIn}
                    />

                    {/* Check-In Summary Box */}
                    {(() => {
                      const stayHours = getStayDurationHours(rateSelected);
                      const parsedIn = checkInTime ? new Date(checkInTime) : new Date();
                      const expOut = new Date(parsedIn.getTime() + stayHours * 3600000);
                      const formattedIn = !isNaN(parsedIn.getTime())
                        ? parsedIn.toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                          })
                        : 'Now';
                      const formattedOut = !isNaN(expOut.getTime())
                        ? expOut.toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                          })
                        : 'N/A';

                      return (
                        <div className="bg-primary/5 border border-primary/10 rounded-2xl p-4 space-y-2 font-mono text-xs text-primary">
                          <div className="flex justify-between">
                            <span>Room Base Stay ({formatStayDuration(rateSelected)})</span>
                            <span>₱{baseRate.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-charcoal/80 text-[11px]">
                            <span>Occupancy:</span>
                            <span className="font-bold text-primary">
                              {numGuests === 1
                                ? 'PERSONS: 1 (Single - Base Rate)'
                                : numGuests === 2
                                ? 'PERSONS: 2 (Base Rate Covers 2 Pax)'
                                : `PERSONS: 2 + ${extraGuests} (${numGuests} Total Pax)`}
                            </span>
                          </div>
                          {extraPersonCharge > 0 && (
                            <div className="flex justify-between text-amber-900 font-bold bg-amber-50/90 px-2 py-1 rounded-lg border border-amber-200 text-[11px]">
                              <span>Extra Person Surcharge (2 + {extraGuests} Pax)</span>
                              <span>+₱{extraPersonCharge.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                          <div className="flex justify-between text-charcoal/80 border-t border-primary/15 pt-2 text-[11px]">
                            <span className="font-semibold text-emerald-800">Check-In Time:</span>
                            <span className="font-bold text-emerald-800">{formattedIn}</span>
                          </div>
                          <div className="flex justify-between text-charcoal/80 text-[11px]">
                            <span className="font-semibold text-primary">Expected Checkout:</span>
                            <span className="font-bold text-primary">{formattedOut}</span>
                          </div>
                          {bedsCharge > 0 && (
                            <div className="flex justify-between">
                              <span>Legacy Bed Setup</span>
                              <span>₱{bedsCharge.toLocaleString()}</span>
                            </div>
                          )}
                          {towelsCharge > 0 && (
                            <div className="flex justify-between">
                              <span>Legacy Towel Setup</span>
                              <span>₱{towelsCharge.toLocaleString()}</span>
                            </div>
                          )}
                          {foodCharge > 0 && (
                            <div className="flex justify-between font-semibold">
                              <span>Pre-added Extras & Menu</span>
                              <span>₱{foodCharge.toLocaleString()}</span>
                            </div>
                          )}
                          <div className="flex justify-between border-t border-primary/20 pt-2 font-display font-bold text-base tracking-tight">
                            <span>Total Due</span>
                            <span>₱{runningTotal.toLocaleString()}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </DrawerSection>

                <DrawerSection
                  title="Extras & Pre-Add Menu"
                  subtitle={chargedCount > 0 ? `${chargedCount} item(s) • ₱${(foodCharge + bedsCharge + towelsCharge).toLocaleString()}` : 'Optional extras for this stay'}
                  badge={chargedCount > 0 ? chargedCount : undefined}
                  badgeTone="primary"
                  open={openSections.extras}
                  onToggle={() => toggleSection('extras')}
                >
                  <div className="space-y-4">
                    <RoomServicePanel
                      isWalkIn={true}
                      chargedFood={chargedFood}
                      dynamicCatalog={dynamicCatalog}
                      addFoodItem={addFoodItem}
                      changeFoodQty={changeFoodQty}
                      roomNumber={room.number}
                      guestName={guestName || room.guestName || 'Walk-in Guest'}
                      activeCashier={activeCashier || loggedInUser || 'Frontdesk'}
                      inventoryMap={inventoryMap}
                    />

                    {/* Legacy Stay Room Extras */}
                    <div className="space-y-2 border-t border-secondary/30 pt-4">
                      <span className="text-[11px] font-mono uppercase tracking-wider text-charcoal/50 block font-bold">
                        Additional Legacy Extras
                      </span>

                      {/* Extra Bed */}
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-xs font-medium block">Extra Bed Setup (Legacy)</span>
                          <span className="text-[10px] font-mono text-charcoal/40">
                            +₱300 per bed
                            {extraBedStock !== null && (
                              <span className={`font-bold ${extraBedStock <= 3 ? 'text-amber-700' : ''}`}>
                                {' '}• {extraBedStock <= 0 ? 'Out of stock' : `${extraBedStock} in stock`}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setExtraBeds(Math.max(0, extraBeds - 1))}
                            className="p-1 rounded bg-cream border border-secondary text-primary cursor-pointer hover:bg-secondary/40"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="font-mono text-xs font-bold w-6 text-center">{extraBeds}</span>
                          <button
                            type="button"
                            onClick={bumpExtraBeds}
                            disabled={isExtraBedCapped}
                            title={isExtraBedCapped ? 'No more stock available' : 'Add extra bed'}
                            className="p-1 rounded bg-cream border border-secondary text-primary cursor-pointer hover:bg-secondary/40 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </div>

                      {/* Extra Towels */}
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-xs font-medium block">Extra Towel Sets (Legacy)</span>
                          <span className="text-[10px] font-mono text-charcoal/40">
                            +₱50 per set
                            {extraTowelStock !== null && (
                              <span className={`font-bold ${extraTowelStock <= 3 ? 'text-amber-700' : ''}`}>
                                {' '}• {extraTowelStock <= 0 ? 'Out of stock' : `${extraTowelStock} in stock`}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setTowelSets(Math.max(0, towelSets - 1))}
                            className="p-1 rounded bg-cream border border-secondary text-primary cursor-pointer hover:bg-secondary/40"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="font-mono text-xs font-bold w-6 text-center">{towelSets}</span>
                          <button
                            type="button"
                            onClick={bumpTowelSets}
                            disabled={isExtraTowelCapped}
                            title={isExtraTowelCapped ? 'No more stock available' : 'Add towel set'}
                            className="p-1 rounded bg-cream border border-secondary text-primary cursor-pointer hover:bg-secondary/40 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </DrawerSection>

                {/* Sticky check-in bar */}
                <div className="sticky bottom-0 z-10 bg-white/95 backdrop-blur border border-secondary rounded-2xl px-4 py-3 space-y-2 shadow-lg">
                  <div className="flex items-center justify-between font-mono">
                    <span className="text-[10px] uppercase tracking-wider text-charcoal/50">Total Due</span>
                    <span className="font-display font-extrabold text-xl text-emerald-700">₱{runningTotal.toLocaleString()}</span>
                  </div>
                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={onClose}
                      className="flex-1 bg-white hover:bg-cream/40 border border-secondary text-charcoal font-sans text-xs font-bold py-3 rounded-xl cursor-pointer transition text-center active:scale-[0.98]"
                    >
                      Go Back
                    </button>
                    <button
                      type="submit"
                      className="flex-[2] bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-xs font-bold py-3 rounded-xl cursor-pointer transition shadow-sm active:scale-[0.98] flex items-center justify-center gap-1.5"
                    >
                      <span>Verify &amp; Check In Walk-In</span>
                    </button>
                  </div>
                  <p className="text-center text-[9px] font-mono text-charcoal/35 uppercase">
                    Cashier: {activeCashier}
                  </p>
                </div>
              </form>
            ) : (
              /* OCCUPIED: sectioned layout with sticky checkout bar */
              <div className="space-y-3">
                <DrawerSection
                  title="Stay & Guest"
                  subtitle={`${room.guestName || 'Guest'} • ${room.billingMode === 'open_time' ? 'Open-Time' : formatStayDuration(rateSelected, customHours)} • ₱${baseRate.toLocaleString()}`}
                  open={openSections.stay}
                  onToggle={() => toggleSection('stay')}
                >
                  <div className="space-y-4">
                    <OccupiedRoomView
                      room={room}
                      rateSelected={rateSelected}
                      customHours={customHours}
                      onPrePrintBill={handlePrePrintBill}
                      onGatePass={handleOpenGatePass}
                      onTransferRoom={() => setIsTransferModalOpen(true)}
                      onQuickExtend={handleQuickExtend}
                      onSnooze={handleSnooze}
                      onSwitchOpenTime={handleSwitchOpenTime}
                      hideStayRate
                      getRateValue={getRateValue}
                      checkInTime={checkInTime}
                      setCheckInTime={(newTime) => {
                        setCheckInTime(newTime);
                        const parsed = new Date(newTime);
                        if (!isNaN(parsed.getTime())) {
                          const newCheckOut = calculateExpectedCheckout(rateSelected, parsed, customHours).toISOString();
                          onUpdateRoom({
                            ...room,
                            checkInTime: parsed.toISOString(),
                            checkOutTime: newCheckOut,
                          }).catch(() => { /* already toasted + reverted */ });
                        }
                      }}
                    />
                    {room.billingMode !== 'open_time' && (
                      <StayRatePicker
                        tier={room.tier}
                        rateSelected={rateSelected}
                        onChange={handleOccupiedRateChange}
                        getRateValue={getRateValue}
                        customHours={customHours}
                        setCustomHours={setCustomHours}
                      />
                    )}
                  </div>
                </DrawerSection>

                <DrawerSection
                  title="Charges & Room Service"
                  subtitle={chargedCount > 0 ? `${chargedCount} item(s) • ₱${(foodCharge + bedsCharge + towelsCharge).toLocaleString()}` : 'No charges yet — tap menu items to add'}
                  badge={chargedCount > 0 ? chargedCount : undefined}
                  badgeTone="primary"
                  open={openSections.charges}
                  onToggle={() => toggleSection('charges')}
                >
                  <RoomServicePanel
                    isWalkIn={false}
                    chargedFood={chargedFood}
                    dynamicCatalog={dynamicCatalog}
                    addFoodItem={addFoodItem}
                    changeFoodQty={changeFoodQty}
                    roomNumber={room.number}
                    guestName={guestName || room.guestName || 'Guest'}
                    activeCashier={activeCashier || loggedInUser || 'Frontdesk'}
                    inventoryMap={inventoryMap}
                  />
                </DrawerSection>

                <DrawerSection
                  title="Deposit & Credit"
                  subtitle={activeDeposit ? `Active Deposit: ₱${activeDeposit.amount.toLocaleString()}` : 'Pay from balance or extend stay'}
                  open={openSections.deposit}
                  onToggle={() => toggleSection('deposit')}
                >
                  <GuestDepositSection
                    room={room}
                    onRoomUpdated={onUpdateRoom}
                    getRateValue={getRateValue}
                    activeCashier={activeCashier || loggedInUser || 'Frontdesk'}
                  />
                </DrawerSection>

                <DrawerSection
                  title="Payment & Checkout"
                  subtitle={`Total ₱${netTotalDue.toLocaleString()}`}
                  open={openSections.payment}
                  onToggle={() => toggleSection('payment')}
                >
                  <CheckoutActions
                    room={room}
                    role={role}
                    foodCharge={foodCharge}
                    baseRate={baseRate}
                    bedsCharge={bedsCharge}
                    extraBeds={extraBeds}
                    towelsCharge={towelsCharge}
                    towelSets={towelSets}
                    extraGuests={extraGuests}
                    extraPersonCharge={extraPersonCharge}
                    excessHours={excessHours}
                    excessHoursCharge={excessHoursCharge}
                    runningTotal={runningTotal}
                    activeDeposit={activeDeposit}
                    depositResolution={depositResolution}
                    setDepositResolution={setDepositResolution}
                    depositNotes={depositNotes}
                    setDepositNotes={setDepositNotes}
                    appliedDepositAmount={appliedDepositAmount}
                    excessDepositRefund={excessDepositRefund}
                    netTotalDue={netTotalDue}
                    paymentMethod={paymentMethod}
                    setPaymentMethod={(val) => { markDirty(); setPaymentMethod(val); }}
                    gcashRef={gcashRef}
                    setGcashRef={(val) => { markDirty(); setGcashRef(val); }}
                    cashAmount={cashAmount}
                    handleCashAmountChange={handleCashAmountChange}
                    gcashAmount={gcashAmount}
                    handleGcashAmountChange={handleGcashAmountChange}
                    amountTendered={amountTendered}
                    handleAmountTenderedChange={(val) => { markDirty(); setAmountTendered(val); }}
                    handleCheckOut={handleCheckOut}
                    onClose={onClose}
                    discountType={discountType}
                    setDiscountType={handleDiscountTypeChange}
                    discountIdRef={discountIdRef}
                    setDiscountIdRef={handleDiscountIdRefChange}
                    onDiscountIdRefBlur={handleDiscountIdRefBlur}
                    onDiscountAndRateChange={handleDiscountAndRateChange}
                    discountAmount={discountAmount}
                    discountUnconfiguredMessage={
                      discountType !== 'NONE' && rawDiscount === null
                        ? `No discount configured for ${discountType}/${room.tier}/${rateSelected} (No ${discountType === 'SENIOR' ? 'Senior/PWD' : 'Discount Card'} discount configured). Remove client discount selection.`
                        : null
                    }
                    isSubmitting={isSubmitting}
                    rateSelected={rateSelected}
                    setRateSelected={handleOccupiedRateChange}
                    getRateValue={getRateValue}
                    onPrePrintBill={handlePrePrintBill}
                    onGatePass={handleOpenGatePass}
                    showFooterActions={false}
                  />
                </DrawerSection>
              </div>
            )}
          </div>

          {/* Sticky checkout bar */}
          {(room.state === 'occupied' || room.state === 'overdue') && !isStaffHouse && role !== 'kitchen' && (
            <div className="sticky bottom-0 z-10 bg-white/95 backdrop-blur border-t border-secondary px-4 sm:px-5 py-3 space-y-2.5 shadow-lg">
              <div className="flex items-center justify-between font-mono">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-charcoal/50 block">
                    {appliedDepositAmount > 0 ? 'Net Total Due' : 'Account Total'}
                  </span>
                  {appliedDepositAmount > 0 && (
                    <span className="text-[9px] text-indigo-700 font-bold">
                      (Deposit ₱{appliedDepositAmount.toLocaleString()} Applied)
                    </span>
                  )}
                </div>
                <span className="font-display font-extrabold text-xl text-primary">
                  ₱{netTotalDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              {checkoutBlockReason && (
                <p className="text-[10px] font-mono text-amber-700 flex items-center gap-1">
                  <AlertTriangle size={11} className="shrink-0" />
                  <span>{checkoutBlockReason}</span>
                </p>
              )}
              {/* Responsive 2-tier layout */}
              <div className="flex flex-col gap-2">
                {/* Tier 1: Auxiliary actions */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isSubmitting}
                    className="bg-white hover:bg-cream/40 border border-secondary text-charcoal font-sans text-xs font-bold py-2.5 sm:py-3 rounded-xl cursor-pointer transition text-center active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Go Back
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveChanges}
                    disabled={isSubmitting || isSavingChanges}
                    title="Save current changes to room details without checking out"
                    className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-900 font-sans text-xs font-bold py-2.5 sm:py-3 rounded-xl cursor-pointer transition text-center active:scale-[0.98] flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSavingChanges ? (
                      <><Loader2 size={13} className="animate-spin" /><span>Saving…</span></>
                    ) : (
                      <><CheckCircle2 size={13} /><span>Save</span></>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handlePrePrintBill}
                    disabled={isSubmitting}
                    title="Pre-print bill before checkout"
                    className="bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 font-sans text-xs font-bold py-2.5 sm:py-3 rounded-xl cursor-pointer transition text-center active:scale-[0.98] flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Printer size={14} className="text-amber-700" />
                    <span>Pre-Print</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenGatePass}
                    disabled={isSubmitting}
                    title="Print Gate Pass for exit security clearance"
                    className="bg-slate-900 hover:bg-slate-800 text-white font-sans text-xs font-bold py-2.5 sm:py-3 rounded-xl cursor-pointer transition text-center active:scale-[0.98] flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Ticket size={14} className="text-amber-400" />
                    <span>Gate Pass</span>
                  </button>
                </div>

                {/* Tier 2: Primary Main Action */}
                <button
                  type="button"
                  onClick={handleCheckOut}
                  disabled={isCheckoutBlocked}
                  className="w-full bg-primary hover:bg-primary-light disabled:bg-charcoal/30 text-white font-sans text-xs sm:text-sm font-bold py-3.5 rounded-xl cursor-pointer disabled:cursor-not-allowed transition shadow-md flex items-center justify-center gap-2 active:scale-[0.98]"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Processing…</span>
                    </>
                  ) : (
                    <>
                      <span>Check Out Guest</span>
                      <ChevronRight size={14} />
                    </>
                  )}
                </button>
              </div>
              <p className="text-center text-[9px] font-mono text-charcoal/35 uppercase">
                Cashier: {activeCashier}
              </p>
            </div>
          )}

          {/* Force Check-Out Request Modal */}
          {isForceCheckoutModalOpen && (
            <ForceCheckoutModal
              room={room}
              role={role}
              loggedInUser={loggedInUser}
              uncollectedAmount={netTotalDue}
              billedBreakdown={[
                { description: `${room.roomType} Rent`, subtext: `${formatStayDuration(rateSelected)} Base Rate`, amount: baseRate },
                ...(bedsCharge > 0 ? [{ description: 'Extra Bed Add-on', subtext: `${extraBeds} Bed(s)`, amount: bedsCharge }] : []),
                ...(towelsCharge > 0 ? [{ description: 'Extra Towels Add-on', subtext: `${towelSets} Set(s)`, amount: towelsCharge }] : []),
                ...(extraPersonCharge > 0 ? [{ description: 'Extra Person Surcharge', subtext: `${extraGuests} Extra Pax`, amount: extraPersonCharge }] : []),
                ...chargedFood.map(f => ({ description: f.item.name, subtext: `${f.quantity} Qty x ₱${f.item.price}`, amount: f.item.price * f.quantity }))
              ]}
              onClose={() => setIsForceCheckoutModalOpen(false)}
              onSuccess={() => {
                setIsForceCheckoutModalOpen(false);
                if (role === 'admin' || role === 'owner') {
                  onUpdateRoom({
                    ...room,
                    state: 'available',
                    time: 'READY',
                    label: 'Available',
                    guestName: '',
                    guestId: '',
                    numGuests: 0,
                    rateSelected: '24h',
                    customHours: undefined,
                    extraBeds: 0,
                    towelSets: 0,
                    checkInTime: undefined,
                    checkOutTime: undefined,
                    isOverdue: false,
                    chargedFood: [],
                    discountType: 'NONE',
                    discountIdRef: '',
                    billingMode: 'standard',
                    openTimeStartedAt: undefined,
                    snoozedUntil: undefined,
                    repeatCount: 0,
                    overtimeWaived: false,
                  }).catch(() => { /* already toasted + reverted */ });
                  onClose();
                } else {
                  onUpdateRoom({
                    ...room,
                    forceCheckoutPending: true,
                  }).catch(() => { /* already toasted + reverted */ });
                  toast.success('Force Check-Out Submitted', `Force Check-Out escalation request submitted to management for Room ${room.number}.`);
                }
              }}
            />
          )}

          {/* Pre-Print Bill Thermal Receipt Modal */}
          {prePrintReceipt && (
            <PrePrintBillModal
              receipt={prePrintReceipt}
              isOpen={Boolean(prePrintReceipt)}
              onClose={() => setPrePrintReceipt(null)}
            />
          )}

          {/* Gate Pass Modal */}
          {gatePassData && (
            <GatePassModal
              data={gatePassData}
              isOpen={Boolean(gatePassData)}
              onClose={() => setGatePassData(null)}
            />
          )}

          {/* Transfer Room Modal */}
          {isTransferModalOpen && (
            <TransferRoomModal
              isOpen={isTransferModalOpen}
              onClose={() => setIsTransferModalOpen(false)}
              sourceRoom={room}
              allRooms={allRooms}
              onTransferSuccess={(src, tgt) => {
                setIsTransferModalOpen(false);
                if (onTransferSuccess) {
                  onTransferSuccess(src, tgt);
                } else {
                  onClose();
                }
              }}
            />
          )}

          {/* Slim footer for flows without a sticky bar */}
          {(isStaffHouse || role === 'kitchen') && (
            <div className="p-4 border-t border-secondary bg-cream/10 text-center">
              <span className="text-[10px] font-mono text-charcoal/40 uppercase">
                LOGGED Cashier Terminal Operator: {activeCashier}
              </span>
            </div>
          )}
        </motion.div>
      </div>
    </>
  );
};
