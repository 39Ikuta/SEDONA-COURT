import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion } from 'motion/react';
import { Room, POSItem, Receipt, getTierDisplayName, BillableService } from '../types';
import { X, Calendar, User, FileText, ShoppingBag, Plus, Minus, CreditCard, ChevronRight, Sparkles, CheckCircle2, ShieldAlert, AlertTriangle, Loader2, Printer, ArrowRightLeft, Ticket } from 'lucide-react';
import { USER_ACCOUNTS } from '../data';
import { calculateStayRate, mapServicesToPOSItems, getStayDurationHours, formatStayDuration, DEFAULT_TIER_RATES, calculateExpectedCheckout, EXCESS_HOUR_RATE, calculateExcessHours } from '../utils/pricing';
import { getDiscountAmountPesos } from '../utils/discount-rates';
import { getRoomStatusConfig } from '../utils/roomStatus';
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
import { getGuestDepositBalance } from '../api/deposits';
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
  const prevPaymentMethodRef = useRef<'CASH' | 'GCASH' | 'MIXED'>(paymentMethod);
  const [discountType, setDiscountType] = useState<'NONE' | 'SENIOR' | 'DC'>(room.discountType || 'NONE');
  const [discountIdRef, setDiscountIdRef] = useState(room.discountIdRef || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isForceCheckoutModalOpen, setIsForceCheckoutModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [prePrintReceipt, setPrePrintReceipt] = useState<Receipt | null>(null);
  const [gatePassData, setGatePassData] = useState<GatePassData | null>(null);
  // isDirty: true while cashier is actively editing form fields.
  // Prevents background WebSocket room-poll from overwriting unsaved changes.
  const isDirty = useRef(false);
  const [isSavingChanges, setIsSavingChanges] = useState(false);

  // Collapsible drawer sections (reset per room so a collapsed section on one
  // room never hides content on the next)
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

  // Charged food orders (simulated local order sheet for this room)
  const [chargedFood, setChargedFood] = useState<Array<{ item: POSItem; quantity: number }>>([]);

  // Live shift inventory (cashier-entered counts). Fail-open: empty map means
  // show everything so charging never bricks when the backend is down.
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

  /** True when a tracked item has run out (untracked items are unlimited). */
  const isOutOfStock = (itemId: string): boolean => {
    const inv = inventoryMap[itemId];
    return Boolean(inv && inv.is_tracked && inv.current_quantity <= 0);
  };
  /** Remaining portions for a tracked item, or null when unlimited/unknown. */
  const stockRemaining = (itemId: string): number | null => {
    const inv = inventoryMap[itemId];
    return inv && inv.is_tracked ? inv.current_quantity : null;
  };

  // Load room data when active room changes.
  // When isDirty is true (cashier is actively editing), skip the sync so that
  // background WebSocket room-poll updates don't clobber unsaved form changes.
  useEffect(() => {
    if (isDirty.current) return;
    setGuestName(room.guestName || '');
    setGuestId(room.guestId || '');
    setNumGuests(room.numGuests || (room.state === 'occupied' ? 2 : 1));
    setRateSelected(room.rateSelected || '24h');
    setCustomHours(room.customHours || 1);
    setCheckInTime(toLocalIsoString(room.checkInTime));
    setExtraBeds(room.extraBeds || 0);
    setTowelSets(room.towelSets || 0);
    setPaymentMethod('CASH');
    setGcashRef('');
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
  } = financialBreakdown;

  // Legacy extras are inventory-tracked too ('extra-bed' / 'towel').
  // Null = untracked/unknown → unlimited (fail-open).
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

  // Single rate-change path for occupied rooms: local state + server persist
  // with checkout recalculated from the official pricing rule.
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

  // Persistent discount handlers for occupied / overdue rooms
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

  // Sticky-bar checkout gating (mirrors CheckoutActions validation)
  const isDiscountUnmapped = discountType !== 'NONE' && rawDiscount === null;
  const isGcashMissingForBar =
    (paymentMethod === 'GCASH' || (paymentMethod === 'MIXED' && gcashAmount > 0)) && !gcashRef.trim();
  const isMixedImbalancedForBar =
    paymentMethod === 'MIXED' && Math.abs((cashAmount + gcashAmount) - runningTotal) >= 0.01;
  const isCheckoutBlocked = isSubmitting || isDiscountUnmapped || isGcashMissingForBar || isMixedImbalancedForBar;
  const checkoutBlockReason = isSubmitting
    ? 'Processing…'
    : isDiscountUnmapped
      ? 'Discount not configured for this rate'
      : isGcashMissingForBar
        ? 'GCash reference required'
        : isMixedImbalancedForBar
          ? 'Cash + GCash must equal total'
          : null;

  const handleCashAmountChange = useCallback((val: number) => {
    markDirty();
    setCashAmount(val);
    const remaining = Math.max(0, runningTotal - val);
    setGcashAmount(remaining);
  }, [markDirty, runningTotal]);

  const handleGcashAmountChange = useCallback((val: number) => {
    markDirty();
    setGcashAmount(val);
    const remaining = Math.max(0, runningTotal - val);
    setCashAmount(remaining);
  }, [markDirty, runningTotal]);

  // Fix MIXED payment split reset bug: track prevPaymentMethodRef and only initialize amounts on explicit transition to 'MIXED'
  useEffect(() => {
    if (paymentMethod === 'MIXED' && prevPaymentMethodRef.current !== 'MIXED') {
      setCashAmount(runningTotal);
      setGcashAmount(0);
    }
    prevPaymentMethodRef.current = paymentMethod;
  }, [paymentMethod, runningTotal]);

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

    // Guard against double-checkout: server rejects non-occupied rooms (H-05).
    if (room.state !== 'occupied' && room.state !== 'overdue') {
      toast.warning('Already Checked Out', `Room ${room.number} is currently ${room.state.toUpperCase()}.`);
      return;
    }

    if (discountType !== 'NONE' && rawDiscount === null) {
      toast.warning('Unconfigured Discount', `No ${discountType === 'DC' ? 'Discount Card' : 'Senior / PWD'} discount configured for this room tier / duration.`);
      return;
    }

    if (paymentMethod === 'MIXED' && Math.abs((cashAmount + gcashAmount) - runningTotal) > 0.01) {
      toast.warning('Payment Mismatch', 'The sum of Cash and GCash amounts must equal the total amount.');
      return;
    }
    if ((paymentMethod === 'GCASH' || (paymentMethod === 'MIXED' && gcashAmount > 0)) && !gcashRef.trim()) {
      toast.warning('GCash Ref Required', 'Please enter the GCash Transaction Reference Number.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Flush latest drawer ledger (food charges / rate / discount) to SQLite BEFORE the
      // receipt is created. POST /receipts recomputes totals from the DB row,
      // so an unflushed chargedFood would cause a total mismatch (MIXED split
      // failure) or missing food lines on the saved receipt.
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
        // onUpdateRoom already toasted + reverted; abort checkout.
        return;
      }

      // Generate Receipt structure
      const parsedCheckIn = checkInTime ? new Date(checkInTime) : (room.checkInTime ? new Date(room.checkInTime) : new Date(Date.now() - 86400000));
      const checkInIso = !isNaN(parsedCheckIn.getTime()) ? parsedCheckIn.toISOString() : new Date(Date.now() - 86400000).toISOString();
      const checkOutIso = new Date().toISOString();
      const receiptNo = `SCTI-${Math.floor(100000 + Math.random() * 900000)}`;
      const stayDurationLabel = formatStayDuration(rateSelected, customHours);
      const rateSubtext = rateSelected === 'custom' ? `${customHours} Hours × ₱130/hr` : `${stayDurationLabel} Base Rate`;

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

      let depositBalance = 0;
      try {
        const depositData = await getGuestDepositBalance(room.guestId || room.guestName || 'Walk-in Guest');
        depositBalance = depositData.balance;
      } catch (err) {
        console.warn('Failed to fetch deposit balance during checkout:', err);
      }

      const receiptObj: Receipt = {
        receiptNo,
        dateTime: checkOutIso,
        guestName: guestName || room.guestName || 'Walk-in Guest',
        roomNumber: room.number,
        roomType: room.roomType,
        paymentMethod,
        gcashRef: (paymentMethod === 'GCASH' || (paymentMethod === 'MIXED' && gcashAmount > 0)) ? gcashRef.trim() : undefined,
        cashAmount: paymentMethod === 'MIXED' ? cashAmount : (paymentMethod === 'CASH' ? runningTotal : 0),
        gcashAmount: paymentMethod === 'MIXED' ? gcashAmount : (paymentMethod === 'GCASH' ? runningTotal : 0),
        checkIn: checkInIso,
        checkOut: checkOutIso,
        items,
        subtotal: runningTotal + discountAmount,
        serviceCharge: 0,
        total: runningTotal,
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
      };

      // POST /receipts is authoritative and already transitions the room to
      // 'cleaning' in the same DB transaction. If it throws (validation, auth,
      // backend down), abort here so we never fake a checkout locally.
      // onGenerateReceipt already toasts the server message.
      await onGenerateReceipt(receiptObj);

      // Auto-clear / mark delivered any remaining active kitchen orders for this room so the queue stays clean
      try {
        await kitchenOrderService.updateRoomStatus(room.number, 'delivered');
      } catch (kitchenErr) {
        console.warn('Auto-clearing kitchen orders on checkout warning:', kitchenErr);
      }

      // Re-assert cleaning locally for instant UI + drawer close.
      // Server already did this; this PUT is idempotent. Fully reset stay
      // fields so a reload can never resurrect the old guest.
      const updated: Room = {
        ...room,
        state: 'cleaning',
        time: '0h 30m',
        label: 'Housekeep',
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
    const stayDurationLabel = formatStayDuration(rateSelected, customHours);
    const rateSubtext = rateSelected === 'custom' ? `${customHours} Hours × ₱130/hr` : `${stayDurationLabel} Base Rate`;

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
      total: runningTotal,
      discount: discountAmount > 0 ? discountAmount : undefined,
      discountType: discountType !== 'NONE' ? discountType : undefined,
      discountIdRef: discountAmount > 0 && discountIdRef.trim() ? discountIdRef.trim() : undefined,
      cashierId: activeCashier,
      rateSelected: rateSelected,
      stayDuration: stayDurationLabel,
      depositBalance: depositBalance > 0 ? depositBalance : undefined,
    };

    // Open in-drawer PrePrintBillModal for non-destructive pre-checkout printing
    setPrePrintReceipt(preReceipt);
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
      label: status === 'available' ? 'Available' : status === 'cleaning' ? 'Housekeep' : room.label,
      time: status === 'available' ? 'READY' : status === 'cleaning' ? '0h 30m' : room.time,
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
    // Re-read counts so the next tap sees the decremented stock.
    refreshInventory();

    // Auto-create of itemized kitchen orders removed. Grouped tickets are now sent via RoomServicePanel.
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
      // Re-read counts so the next tap sees the decremented stock.
      refreshInventory();
    }

    // Auto-create of itemized kitchen orders removed. Grouped tickets are now sent via RoomServicePanel.
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

          const checkout = new Date(room.checkOutTime);

          if (config.urgencyLevel === 'late-past-grace') {
            return (
              <div className="bg-purple-100 border-2 border-purple-400 p-3.5 rounded-xl flex items-start gap-3 text-purple-950 shadow-sm animate-pulse-slow">
                <AlertTriangle size={18} className="text-purple-700 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-extrabold font-mono text-xs uppercase tracking-wide">
                      🚨 LATE PAST GRACE (+15m Expired)
                    </span>
                    <span className="text-[10px] font-mono font-black bg-purple-200 text-purple-950 px-2 py-0.5 rounded border border-purple-400">
                      {room.time}
                    </span>
                  </div>
                  <p className="text-[11px] font-sans text-purple-900 mt-1 leading-relaxed">
                    15-minute grace period has expired for this apartment. Checkout was expected at {checkout.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                    {excessHoursCharge > 0 && (
                      <span className="block mt-1 font-bold font-mono text-purple-950">
                        ⚡ Automatic Excess Charge: +₱{excessHoursCharge.toLocaleString()} ({excessHours} hr{excessHours === 1 ? '' : 's'} @ ₱{excessHourService.price || EXCESS_HOUR_RATE}/hr) added to bill.
                      </span>
                    )}
                  </p>
                </div>
              </div>
            );
          } else if (config.urgencyLevel === 'overdue-grace') {
            return (
              <div className="bg-rose-100 border border-rose-300 p-3.5 rounded-xl flex items-start gap-3 text-rose-950 shadow-sm">
                <AlertTriangle size={18} className="text-rose-700 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-extrabold font-mono text-xs uppercase tracking-wide">
                      ⏰ OVERDUE GRACE PERIOD (0-15m)
                    </span>
                    <span className="text-[10px] font-mono font-bold bg-rose-200 text-rose-950 px-2 py-0.5 rounded border border-rose-300">
                      {room.time}
                    </span>
                  </div>
                  <p className="text-[11px] font-sans text-rose-900 mt-1 leading-relaxed">
                    Guest is currently within the 15-minute grace window past checkout time.
                  </p>
                </div>
              </div>
            );
          } else if (config.urgencyLevel === 'warning') {
            return (
              <div className="bg-amber-100 border border-amber-300 p-3.5 rounded-xl flex items-start gap-3 text-amber-950 shadow-sm">
                <AlertTriangle size={18} className="text-amber-700 shrink-0 mt-0.5" />
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
                    Checkout scheduled in less than 15 minutes.
                  </p>
                </div>
              </div>
            );
          }
          return null;
        })()}

        {/* Dynamic status controller (Disabled for permanent Staff House) */}
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

            {/* Legacy Stay Room Extras (Extra Bed / Towel Setup Slider) */}
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

            {/* Sticky check-in bar (inside the form so Verify submits it) */}
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
              subtitle={`${room.guestName || 'Guest'} • ${formatStayDuration(rateSelected, customHours)} • ₱${baseRate.toLocaleString()}`}
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
                  hideStayRate
                  getRateValue={getRateValue}
                  checkInTime={checkInTime}
                  setCheckInTime={(newTime) => {
                    setCheckInTime(newTime);
                    const parsed = new Date(newTime);
                    if (!isNaN(parsed.getTime())) {
                      const stayHours = getStayDurationHours(rateSelected, customHours);
                      const newCheckOut = calculateExpectedCheckout(rateSelected, parsed, customHours).toISOString();
                      onUpdateRoom({
                        ...room,
                        checkInTime: parsed.toISOString(),
                        checkOutTime: newCheckOut,
                      }).catch(() => { /* already toasted + reverted */ });
                    }
                  }}
                />
                <StayRatePicker
                  tier={room.tier}
                  rateSelected={rateSelected}
                  onChange={handleOccupiedRateChange}
                  getRateValue={getRateValue}
                  customHours={customHours}
                  setCustomHours={setCustomHours}
                />
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
              subtitle="Pay from balance or extend stay"
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
              subtitle={`Total ₱${runningTotal.toLocaleString()}`}
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
                paymentMethod={paymentMethod}
                setPaymentMethod={(val) => { markDirty(); setPaymentMethod(val); }}
                gcashRef={gcashRef}
                setGcashRef={(val) => { markDirty(); setGcashRef(val); }}
                cashAmount={cashAmount}
                handleCashAmountChange={handleCashAmountChange}
                gcashAmount={gcashAmount}
                handleGcashAmountChange={handleGcashAmountChange}
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
                    ? `No ${discountType === 'DC' ? 'Discount Card' : 'Senior / PWD'} discount configured for ${room.roomType} (${formatStayDuration(rateSelected)}) — contact management.`
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

      {/* Sticky checkout bar — total + CTA always visible for occupied rooms */}
      {(room.state === 'occupied' || room.state === 'overdue') && !isStaffHouse && role !== 'kitchen' && (
        <div className="sticky bottom-0 z-10 bg-white/95 backdrop-blur border-t border-secondary px-4 sm:px-5 py-3 space-y-2.5 shadow-lg">
          <div className="flex items-center justify-between font-mono">
            <span className="text-[10px] uppercase tracking-wider text-charcoal/50">Account Total</span>
            <span className="font-display font-extrabold text-xl text-primary">₱{runningTotal.toLocaleString()}</span>
          </div>
          {checkoutBlockReason && (
            <p className="text-[10px] font-mono text-amber-700 flex items-center gap-1">
              <AlertTriangle size={11} className="shrink-0" />
              <span>{checkoutBlockReason}</span>
            </p>
          )}
          {/* Responsive 2-tier layout for <480px screens */}
          <div className="flex flex-col gap-2">
            {/* Tier 1: Auxiliary / Utility actions */}
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
          uncollectedAmount={runningTotal}
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
              // Server direct-override already set room to 'cleaning' + wrote
              // FCE receipt. Re-assert locally; idempotent.
              onUpdateRoom({
                ...room,
                state: 'cleaning',
                time: '0h 30m',
                label: 'Housekeep',
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

      {/* Slim footer for flows without a sticky bar (staff house / kitchen) */}
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
