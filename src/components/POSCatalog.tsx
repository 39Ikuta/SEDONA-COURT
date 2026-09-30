import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { POSItem, OrderItem, Room, Receipt, BillableService } from '../types';
import { Search, ShoppingBag, Plus, Minus, CreditCard, Trash2, CheckCircle2, UserCheck, ReceiptCent, HelpCircle, ChefHat, Package, Download, AlertTriangle } from 'lucide-react';
import { USER_ACCOUNTS } from '../data';
import { mapServicesToPOSItems } from '../utils/pricing';
import { kitchenOrderService } from '../api/kitchen';
import { useToast } from './ui/Toast';
import KitchenOrderManager from './KitchenOrderManager';
import { CashierInventoryModal } from './CashierInventoryModal';
import { getCurrentInventory, downloadDailyInventoryCsv, InventoryItem } from '../api/inventory';

interface POSCatalogProps {
  rooms: Room[];
  activeCashier: string;
  billableServices: BillableService[];
  onUpdateRoom: (room: Room) => void | Promise<void>;
  onGenerateReceipt: (receipt: Receipt) => void | Promise<void>;
  onPostPOSOrderDirect: (amount: number, category: 'kitchen' | 'drinks' | 'miscell') => void;
  loggedInUser?: string;
}

export const POSCatalog: React.FC<POSCatalogProps> = ({
  rooms,
  activeCashier,
  billableServices,
  onUpdateRoom,
  onGenerateReceipt,
  onPostPOSOrderDirect,
  loggedInUser = '',
}) => {
  const matchedUser = USER_ACCOUNTS.find(u => u.username === loggedInUser);
  const role = matchedUser ? matchedUser.role : 'cashier';
  const toast = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'GCASH' | 'MIXED'>('CASH');
  const [gcashRef, setGcashRef] = useState('');
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [gcashAmount, setGcashAmount] = useState<number>(0);
  const [chargeToRoomNumber, setChargeToRoomNumber] = useState<string>(''); // empty means walk-in direct sale
  const [successMsg, setSuccessMsg] = useState('');
  const [showKitchenManager, setShowKitchenManager] = useState(false);
  const [showInventoryModal, setShowInventoryModal] = useState(false);
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
      console.warn('Could not load inventory in POSCatalog:', err);
    }
  };

  useEffect(() => {
    refreshInventory();
  }, []);

  // Map services to standard catalog format
  const dynamicCatalog = mapServicesToPOSItems(billableServices);

  // Filter catalog
  const filteredCatalog = dynamicCatalog.filter((item) => {
    const categoryMatches = activeCategory === 'All' || item.category === activeCategory;
    const searchMatches = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          item.description.toLowerCase().includes(searchTerm.toLowerCase());
    return categoryMatches && searchMatches;
  });

  // Active Orderable Rooms (Occupied Guest Rooms + Permanent Staff House)
  const orderableRooms = rooms.filter(
    (r) => r.state === 'occupied' || r.state === 'overdue' || r.isStaffHouse || r.roomType === 'Staff House' || r.number === '12'
  );

  // Tracked Inventory Metrics
  const inventoryItems: InventoryItem[] = Object.values(inventoryMap) as InventoryItem[];
  const trackedItemsList: InventoryItem[] = inventoryItems.filter((i: InventoryItem) => Boolean(i.is_tracked));
  const trackedItemsCount = trackedItemsList.length;
  const outOfStockItemsList: InventoryItem[] = trackedItemsList.filter((i: InventoryItem) => i.current_quantity <= 0);
  const outOfStockItemsCount = outOfStockItemsList.length;

  const addToCart = (item: POSItem) => {
    const inv = inventoryMap[item.id];
    if (inv && inv.is_tracked) {
      if (inv.current_quantity <= 0) {
        toast.warning('Out of Stock', `"${item.name}" is currently 86'd / out of stock.`);
        return;
      }
      const existingInCart = cart.find((i) => i.item.id === item.id);
      if (existingInCart && existingInCart.quantity >= inv.current_quantity) {
        toast.warning('Stock Limit', `Only ${inv.current_quantity} portions of "${item.name}" are available in stock.`);
        return;
      }
    }

    setCart((prev) => {
      const exist = prev.find((i) => i.item.id === item.id);
      if (exist) {
        return prev.map((i) => (i.item.id === item.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { item, quantity: 1 }];
    });
  };

  const updateCartQty = (itemId: string, diff: number) => {
    if (diff > 0) {
      const inv = inventoryMap[itemId];
      if (inv && inv.is_tracked) {
        const existingInCart = cart.find((i) => i.item.id === itemId);
        if (existingInCart && existingInCart.quantity >= inv.current_quantity) {
          toast.warning('Stock Limit', `Only ${inv.current_quantity} portions of "${inv.item_name}" are available.`);
          return;
        }
      }
    }

    setCart((prev) => {
      return prev
        .map((i) => {
          if (i.item.id === itemId) {
            const newQty = i.quantity + diff;
            return newQty > 0 ? { ...i, quantity: newQty } : null;
          }
          return i;
        })
        .filter(Boolean) as OrderItem[];
    });
  };

  const removeFromCart = (itemId: string) => {
    setCart((prev) => prev.filter((i) => i.item.id !== itemId));
  };

  const subtotal = cart.reduce((sum, item) => sum + item.item.price * item.quantity, 0);
  const serviceCharge = 0;
  const total = subtotal + serviceCharge;

  const handleCashAmountChange = (val: number) => {
    setCashAmount(val);
    const remaining = Math.max(0, total - val);
    setGcashAmount(remaining);
  };

  const handleGcashAmountChange = (val: number) => {
    setGcashAmount(val);
    const remaining = Math.max(0, total - val);
    setCashAmount(remaining);
  };

  React.useEffect(() => {
    if (paymentMethod === 'MIXED') {
      setCashAmount(total);
      setGcashAmount(0);
    }
  }, [paymentMethod, total]);

  const handleCheckout = (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;

    if (role === 'kitchen' && !chargeToRoomNumber) {
      toast.warning('Unauthorized', 'As a kitchen operator, you are only authorized to charge food orders directly to active guest room folios. Direct walk-in cash or GCash transactions must be handled at the frontdesk cashier counter.');
      return;
    }

    if (!chargeToRoomNumber) {
      if (paymentMethod === 'MIXED' && Math.abs((cashAmount + gcashAmount) - total) > 0.01) {
        toast.warning('Payment Mismatch', 'The sum of Cash and GCash amounts must equal the total amount.');
        return;
      }
      if ((paymentMethod === 'GCASH' || (paymentMethod === 'MIXED' && gcashAmount > 0)) && !gcashRef.trim()) {
        toast.warning('GCash Ref Required', 'Please enter the GCash Transaction Reference Number.');
        return;
      }
    }

    if (chargeToRoomNumber) {
      // CHARGE TO ROOM FLOW
      const targetRoom = rooms.find((r) => r.number === chargeToRoomNumber);
      if (targetRoom) {
        // Build the food details and persist them
        const roomUpdate = { ...targetRoom };
        const existingCharged = roomUpdate.chargedFood ? [...roomUpdate.chargedFood] : [];
        
        cart.forEach((cartItem) => {
          const matchIndex = existingCharged.findIndex((item) => item.item.id === cartItem.item.id);
          if (matchIndex > -1) {
            existingCharged[matchIndex] = {
              ...existingCharged[matchIndex],
              quantity: existingCharged[matchIndex].quantity + cartItem.quantity,
            };
          } else {
            existingCharged.push({
              item: cartItem.item,
              quantity: cartItem.quantity,
            });
          }
        });
        
        roomUpdate.chargedFood = existingCharged;
        Promise.resolve(onUpdateRoom(roomUpdate)).catch(() => { /* already toasted */ });

        // CREATE KITCHEN ORDER FOR ROOM CHARGE
        try {
          const foodItems = cart.filter(cartItem => 
            kitchenOrderService.isFoodItem(cartItem.item)
          );

          if (foodItems.length > 0) {
            kitchenOrderService.createOrder({
              receipt_no: undefined, // no receipt yet, charged to room
              room_number: chargeToRoomNumber,
              guest_name: targetRoom.guestName || 'Room Guest',
              cashier_name: activeCashier,
              items: foodItems.map(item => ({
                item_id: item.item.id,
                name: item.item.name,
                quantity: item.quantity,
                special_instructions: undefined
              })),
              total_amount: foodItems.reduce((sum, item) => sum + (item.item.price * item.quantity), 0),
              special_instructions: undefined,
              priority: 'normal'
            }).then(() => console.log('Kitchen order created for room charge:', chargeToRoomNumber))
              .catch(err => console.error('Failed to create kitchen order:', err));
          }
        } catch (err) {
          console.error('Failed to prepare kitchen order:', err);
        }

        setSuccessMsg(`₱${total.toLocaleString()} charged directly to Room ${chargeToRoomNumber} billing folio!`);
        setCart([]);
        setChargeToRoomNumber('');
        setGcashRef('');

        // Trigger parent state update to reflect new POS numbers inside analytics directly
        const kitchenAmt = cart
          .filter(c => c.item.category === 'Favorites' || c.item.category === 'Breakfast' || c.item.category === 'Kitchen Extras')
          .reduce((s, c) => s + c.item.price * c.quantity, 0);
        const drinksAmt = cart
          .filter(c => c.item.category === 'Drinks')
          .reduce((s, c) => s + c.item.price * c.quantity, 0);
        const miscAmt = total - kitchenAmt - drinksAmt;

        if (kitchenAmt > 0) onPostPOSOrderDirect(kitchenAmt, 'kitchen');
        if (drinksAmt > 0) onPostPOSOrderDirect(drinksAmt, 'drinks');
        if (miscAmt > 0) onPostPOSOrderDirect(miscAmt, 'miscell');

        setTimeout(() => setSuccessMsg(''), 4000);
      }
    } else {
      // DIRECT STANDALONE CASH/GCASH WALK-IN SALE
      const nowIso = new Date().toISOString();
      const receiptNo = `SCTI-POS-${Math.floor(10000 + Math.random() * 90000)}`;

      const receiptObj: Receipt = {
        receiptNo,
        dateTime: nowIso,
        guestName: 'POS Counter Sale',
        roomNumber: 'WALK-IN',
        roomType: 'Walk-In Customer',
        paymentMethod,
        gcashRef: (paymentMethod === 'GCASH' || (paymentMethod === 'MIXED' && gcashAmount > 0)) ? gcashRef.trim() : undefined,
        cashAmount: paymentMethod === 'MIXED' ? cashAmount : (paymentMethod === 'CASH' ? total : 0),
        gcashAmount: paymentMethod === 'MIXED' ? gcashAmount : (paymentMethod === 'GCASH' ? total : 0),
        checkIn: nowIso,
        checkOut: nowIso,
        items: cart.map(c => ({
          id: c.item.id,
          item_id: c.item.id,  // Critical: item_id must be present for inventory deduction
          quantity: c.quantity,
          description: c.item.name,
          subtext: `${c.quantity} Qty x ₱${c.item.price}`,
          amount: c.item.price * c.quantity,
          name: c.item.name,  // Add name field for better error messages
        })),
        subtotal,
        serviceCharge,
        total,
        amountTendered: total,
        changeAmount: 0,
        amountTenderedCents: Math.round(total * 100),
        changeCents: 0,
        cashierId: activeCashier
      };

      // Direct receipt generation
      Promise.resolve(onGenerateReceipt(receiptObj)).catch(() => { /* already toasted */ });

      // Create kitchen order if there are food items
      const createKitchenOrder = async () => {
        try {
          // Extract food items from cart
          const foodItems = cart.filter(cartItem => 
            kitchenOrderService.isFoodItem(cartItem.item)
          );

          if (foodItems.length > 0) {
            const kitchenOrderData = {
              receipt_no: receiptObj.receiptNo,
              room_number: chargeToRoomNumber || 'WALK-IN',
              guest_name: receiptObj.guestName,
              cashier_name: activeCashier,
              items: foodItems.map(item => ({
                item_id: item.item.id,
                name: item.item.name,
                quantity: item.quantity,
                special_instructions: undefined
              })),
              total_amount: foodItems.reduce((sum, item) => sum + (item.item.price * item.quantity), 0),
              special_instructions: undefined,
              priority: 'normal' as const
            };

            await kitchenOrderService.createOrder(kitchenOrderData);
            console.log('Kitchen order created for receipt:', receiptObj.receiptNo);
          }
        } catch (err) {
          console.error('Failed to create kitchen order:', err);
          // Don't block checkout for kitchen order failures
        }
      };

      // Create kitchen order asynchronously (don't block checkout)
      createKitchenOrder();

      // Trigger analytics updates
      const kitchenAmt = cart
        .filter(c => c.item.category === 'Favorites' || c.item.category === 'Breakfast' || c.item.category === 'Kitchen Extras')
        .reduce((s, c) => s + c.item.price * c.quantity, 0);
      const drinksAmt = cart
        .filter(c => c.item.category === 'Drinks')
        .reduce((s, c) => s + c.item.price * c.quantity, 0);
      const miscAmt = total - kitchenAmt - drinksAmt;

      if (kitchenAmt > 0) onPostPOSOrderDirect(kitchenAmt, 'kitchen');
      if (drinksAmt > 0) onPostPOSOrderDirect(drinksAmt, 'drinks');
      if (miscAmt > 0) onPostPOSOrderDirect(miscAmt, 'miscell');

      setCart([]);
      setGcashRef('');
      setSuccessMsg('Counter order processed and receipt generated!');
      setTimeout(() => setSuccessMsg(''), 4000);
    }
  };

  // Extract unique categories dynamically and sort according to official menu hierarchy
  const preferredCategoryOrder = ['All', 'Breakfast', 'Favorites', 'Kitchen Extras', 'Drinks', 'Miscellaneous', 'Extras'];
  const allFoundCategories = Array.from(new Set(dynamicCatalog.map(item => item.category)));
  const categories = [
    'All',
    ...preferredCategoryOrder.filter(c => c !== 'All' && allFoundCategories.includes(c)),
    ...allFoundCategories.filter(c => !preferredCategoryOrder.includes(c))
  ];

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-6 max-w-7xl mx-auto min-h-0 font-sans">
      {/* Left Menu Selection Column */}
      <div className="flex-1 flex flex-col gap-4 min-h-0">
        {/* Operating Hours Banner */}
        <div className="bg-primary/5 border border-primary/20 px-4 py-2.5 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-primary font-bold">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Hot kitchen open 6:00 AM – 10:00 PM daily</span>
          </div>
          <div className="flex items-center gap-2.5 text-charcoal/70 font-medium">
            <span>Drinks &amp; Miscellaneous available 24/7</span>
            {['admin', 'owner', 'cashier'].includes(role) && (
              <button
                type="button"
                onClick={() => setShowInventoryModal(true)}
                className="px-3 py-1 bg-primary hover:bg-primary-light text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer ml-1"
                title="Open Cashier Shift Menu Inventory"
              >
                <Package size={13} />
                <span>Shift Inventory</span>
              </button>
            )}
          </div>
        </div>

        {/* Search and Category Filter Header */}
        <div className="bg-white p-4 rounded-2xl border border-secondary shadow-sm flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
          {/* Search bar */}
          <div className="relative flex-1 max-w-sm">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-charcoal/40" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search dining item..."
              className="w-full pl-10 pr-4 py-2 bg-cream/30 border border-secondary/60 rounded-xl text-xs outline-none focus:border-primary transition"
            />
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto py-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition ${
                  activeCategory === cat
                    ? 'bg-primary text-white border-primary'
                    : 'bg-cream/40 border border-secondary/40 text-charcoal/70 hover:bg-cream/70'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Success Alert */}
        <AnimatePresence>
          {successMsg && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-medium flex items-center gap-2"
            >
              <CheckCircle2 size={15} />
              {successMsg}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Items Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pb-8">
          {filteredCatalog.map((item) => {
            const inv = inventoryMap[item.id];
            const isTracked = inv ? Boolean(inv.is_tracked) : false;
            const currentStock = inv ? inv.current_quantity : null;
            const isOutOfStock = isTracked && currentStock === 0;
            const isLowStock = isTracked && currentStock !== null && currentStock > 0 && currentStock <= 3;

            return (
              <div
                key={item.id}
                className={`bg-white border rounded-2xl p-3.5 flex flex-col justify-between transition-all shadow-sm group hover:shadow-md ${
                  isOutOfStock
                    ? 'border-rose-200 bg-rose-50/20'
                    : 'border-secondary hover:border-primary/40'
                }`}
              >
                {/* Image Header */}
                <div className="aspect-video w-full rounded-xl overflow-hidden bg-cream border border-secondary/20 relative mb-3">
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    referrerPolicy="no-referrer"
                    className={`w-full h-full object-cover transition duration-300 ${
                      isOutOfStock ? 'opacity-60 grayscale-[0.4]' : 'group-hover:scale-105'
                    }`}
                  />
                  {/* Stock Availability Badge */}
                  {isTracked && (
                    <span
                      className={`absolute top-2 left-2 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md shadow-xs ${
                        isOutOfStock
                          ? 'bg-rose-600 text-white'
                          : isLowStock
                          ? 'bg-amber-500 text-white'
                          : 'bg-emerald-600/95 text-white'
                      }`}
                    >
                      {isOutOfStock ? "86'D / OUT OF STOCK" : `${currentStock} in stock`}
                    </span>
                  )}
                  <span className="absolute bottom-2 right-2 bg-primary/95 text-white font-mono text-xs font-bold px-2 py-0.5 rounded-md shadow-sm">
                    ₱{item.price}
                  </span>
                </div>

                {/* Title Description */}
                <div className="space-y-1">
                  <h3 className="font-display font-extrabold text-sm text-charcoal group-hover:text-primary transition leading-snug">
                    {item.name}
                  </h3>
                  <p className="text-[11px] text-charcoal/50 font-sans leading-relaxed line-clamp-2">
                    {item.description}
                  </p>
                </div>

                {/* Add Button */}
                <button
                  onClick={() => addToCart(item)}
                  disabled={isOutOfStock}
                  className={`w-full font-bold text-xs py-2 rounded-xl mt-4 transition cursor-pointer active:scale-[0.98] flex items-center justify-center gap-1 ${
                    isOutOfStock
                      ? 'bg-rose-100 text-rose-500 border border-rose-200 cursor-not-allowed'
                      : 'bg-cream hover:bg-primary hover:text-white border border-secondary/70 hover:border-primary text-primary'
                  }`}
                >
                  <Plus size={13} />
                  {isOutOfStock ? "Out of Stock (86'd)" : 'Order Item'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Order Sidebar Drawer Column */}
      <div className="w-full lg:w-80 flex flex-col gap-4 flex-shrink-0">
        {/* Active Dining Cart Container */}
        <div className="w-full bg-white border border-secondary rounded-2xl shadow-sm flex flex-col justify-between overflow-hidden h-fit">
          {/* Cart Header */}
          <div className="p-4 border-b border-secondary/40 bg-cream/10 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <ShoppingBag size={16} className="text-primary" />
              <h2 className="font-display font-bold text-sm text-charcoal uppercase tracking-wide">
                Active Dining Cart
              </h2>
            </div>
            <span className="font-mono text-xs font-bold bg-primary/5 text-primary px-2 py-0.5 rounded-full">
              {cart.length} items
            </span>
          </div>

          {/* Cart List - set a robust max-height so it scrolls nicely and doesn't push the forms off screen */}
          <div className="max-h-[280px] overflow-y-auto p-4 space-y-3.5">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center text-charcoal/30">
                <ShoppingBag size={28} className="opacity-40 mb-2" />
                <p className="text-xs font-medium font-display">Cart is empty</p>
                <p className="text-[10px] uppercase font-mono mt-0.5 mb-2.5">Click catalog items to add</p>
                {['admin', 'owner', 'cashier'].includes(role) && (
                  <button
                    type="button"
                    onClick={() => setShowInventoryModal(true)}
                    className="text-[10px] font-mono font-bold text-primary hover:text-primary-light bg-primary/5 hover:bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-lg transition flex items-center gap-1 cursor-pointer"
                  >
                    <Plus size={10} />
                    <span>Add Shift Menu Inventory</span>
                  </button>
                )}
              </div>
            ) : (
            cart.map((c) => (
              <div key={c.item.id} className="flex gap-3 justify-between items-start text-xs border-b border-cream pb-3">
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-charcoal truncate">{c.item.name}</h4>
                  <p className="text-[10px] font-mono text-charcoal/40">₱{c.item.price} each</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateCartQty(c.item.id, -1)}
                    className="p-1 rounded bg-cream border border-secondary text-primary cursor-pointer hover:bg-secondary/40"
                  >
                    <Minus size={10} />
                  </button>
                  <span className="font-mono font-bold w-4 text-center">{c.quantity}</span>
                  <button
                    onClick={() => updateCartQty(c.item.id, 1)}
                    className="p-1 rounded bg-cream border border-secondary text-primary cursor-pointer hover:bg-secondary/40"
                  >
                    <Plus size={10} />
                  </button>
                  <button
                    onClick={() => removeFromCart(c.item.id)}
                    className="p-1 text-charcoal/30 hover:text-accent cursor-pointer rounded ml-1"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Checkout config form panel */}
        {cart.length > 0 && (
          <form onSubmit={handleCheckout} className="p-4 border-t border-secondary bg-cream/15 space-y-4">
            {/* Charge Target Selection */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-wider text-charcoal/50 block">
                Order Destination
              </label>
              <select
                value={chargeToRoomNumber}
                onChange={(e) => setChargeToRoomNumber(e.target.value)}
                className="w-full bg-white border border-secondary/60 rounded-xl text-xs px-3 py-2 outline-none focus:border-primary transition"
              >
                {role === 'kitchen' ? (
                  <>
                    <option value="">-- Select Room / Staff House to Charge --</option>
                    {orderableRooms.map((r) => {
                      const isStaff = r.isStaffHouse || r.roomType === 'Staff House' || r.number === '12';
                      return (
                        <option key={r.number} value={r.number}>
                          {isStaff ? `Room ${r.number} - Staff House (Employee Quarters)` : `Room ${r.number} - ${r.label}`}
                        </option>
                      );
                    })}
                  </>
                ) : (
                  <>
                    <option value="">Stand-alone Cashier Counter Sale</option>
                    <optgroup label="Charge Direct to Room / Staff Tab:">
                      {orderableRooms.map((r) => {
                        const isStaff = r.isStaffHouse || r.roomType === 'Staff House' || r.number === '12';
                        return (
                          <option key={r.number} value={r.number}>
                            {isStaff ? `Room ${r.number} - Staff House (Employee Quarters)` : `Room ${r.number} - ${r.label}`}
                          </option>
                        );
                      })}
                    </optgroup>
                  </>
                )}
              </select>
            </div>

            {/* If counter sale, show cash/gcash/mixed payment */}
            {!chargeToRoomNumber && (
              <div className="space-y-3 pt-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-charcoal/50 block">
                  Payment Settlement
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['CASH', 'GCASH', 'MIXED'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase transition border cursor-pointer ${
                        paymentMethod === method
                          ? 'bg-primary border-primary text-white'
                          : 'bg-white border-secondary/50 text-charcoal/60 hover:bg-cream/40'
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>

                {paymentMethod === 'MIXED' && (
                  <div className="space-y-2 p-2.5 bg-cream/30 border border-secondary/40 rounded-xl">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9px] font-mono uppercase text-charcoal/60">Cash Amount</label>
                        <input
                          type="number"
                          min={0}
                          max={total}
                          step="any"
                          value={cashAmount || ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            handleCashAmountChange(val);
                          }}
                          className="w-full px-2 py-1 bg-white border border-secondary rounded-lg text-xs font-mono outline-none focus:border-primary"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-mono uppercase text-charcoal/60">GCash Amount</label>
                        <input
                          type="number"
                          min={0}
                          max={total}
                          step="any"
                          value={gcashAmount || ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            handleGcashAmountChange(val);
                          }}
                          className="w-full px-2 py-1 bg-white border border-secondary rounded-lg text-xs font-mono outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                    <div className="text-[10px] text-charcoal/50 font-mono flex justify-between px-1">
                      <span>Total: ₱{(cashAmount + gcashAmount).toLocaleString()}</span>
                      <span className={Math.abs((cashAmount + gcashAmount) - total) < 0.01 ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>
                        {Math.abs((cashAmount + gcashAmount) - total) < 0.01 ? "Balanced ✓" : `Remaining: ₱${(total - (cashAmount + gcashAmount)).toLocaleString()}`}
                      </span>
                    </div>
                  </div>
                )}

                {(paymentMethod === 'GCASH' || (paymentMethod === 'MIXED' && gcashAmount > 0)) && (
                  <input
                    type="text"
                    required
                    value={gcashRef}
                    onChange={(e) => setGcashRef(e.target.value)}
                    placeholder="Enter 13-digit G-Cash Reference"
                    className="w-full px-3 py-1.5 bg-white border border-secondary rounded-lg text-xs font-mono outline-none focus:border-primary"
                  />
                )}
              </div>
            )}

            {/* Bill Summary */}
            <div className="border-t border-secondary/40 pt-3 space-y-1 text-xs font-mono text-charcoal/70">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>₱{subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-t border-secondary/20 pt-1.5 font-display font-bold text-sm text-primary">
                <span>Cart total:</span>
                <span>₱{total.toLocaleString()}</span>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-primary hover:bg-primary-light text-white font-sans text-xs font-bold py-3 rounded-xl cursor-pointer transition shadow-md shadow-primary/5 hover:shadow-primary/15 uppercase tracking-wide"
            >
              {chargeToRoomNumber ? 'Charge Direct to Room' : 'Process Checkout Sale'}
            </button>

            {/* Kitchen Order Management Button */}
            {['admin', 'owner', 'cashier'].includes(role) && (
              <button
                type="button"
                onClick={() => setShowKitchenManager(true)}
                className="w-full bg-orange-600 hover:bg-orange-700 text-white font-sans text-xs font-bold py-2.5 rounded-xl cursor-pointer transition shadow-md shadow-orange-600/5 hover:shadow-orange-600/15 uppercase tracking-wide flex items-center justify-center gap-2"
              >
                <ChefHat className="w-4 h-4" />
                Manage Kitchen Orders
              </button>
            )}

            {/* Shift Menu Inventory Management Button */}
            {['admin', 'owner', 'cashier'].includes(role) && (
              <button
                type="button"
                onClick={() => setShowInventoryModal(true)}
                className="w-full bg-[#5a2530] hover:bg-primary text-white font-sans text-xs font-bold py-2.5 rounded-xl cursor-pointer transition shadow-xs uppercase tracking-wide flex items-center justify-center gap-2"
              >
                <Package className="w-4 h-4" />
                Shift Menu Inventory
              </button>
            )}
          </form>
        )}
      </div>

      {/* Below Active Dining Cart: Cashier Shift Menu Inventory Card */}
      {['admin', 'owner', 'cashier'].includes(role) && (
        <div className="w-full bg-white border border-secondary rounded-2xl shadow-sm overflow-hidden flex flex-col h-fit">
          {/* Header */}
          <div className="p-3.5 border-b border-secondary/40 bg-cream/20 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Package size={16} className="text-primary" />
              <h3 className="font-display font-bold text-xs text-charcoal uppercase tracking-wider">
                Cashier Shift Menu Inventory
              </h3>
            </div>
            <span
              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                outOfStockItemsCount > 0
                  ? 'bg-rose-100 text-rose-700 border border-rose-200'
                  : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
              }`}
            >
              {outOfStockItemsCount > 0 ? `${outOfStockItemsCount} 86'd` : 'All Stocked'}
            </span>
          </div>

          {/* Body */}
          <div className="p-4 space-y-3.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-charcoal/70">
                <UserCheck size={13} className="text-primary/70" />
                <span className="font-mono text-[11px] text-charcoal/80 font-medium truncate max-w-[130px]">
                  {activeCashier || loggedInUser || 'Cashier'}
                </span>
              </div>
              <div className="font-mono text-[11px] text-charcoal/60">
                <span className="font-bold text-primary">{trackedItemsCount}</span> items tracked
              </div>
            </div>

            {/* Status Banner */}
            {outOfStockItemsCount > 0 ? (
              <div className="bg-rose-50 border border-rose-200/80 rounded-xl p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1">
                    <AlertTriangle size={11} /> 86'd / Out of Stock
                  </span>
                  <span className="text-[10px] font-mono text-rose-600 font-bold">
                    {outOfStockItemsCount} item{outOfStockItemsCount > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {outOfStockItemsList.slice(0, 3).map((it) => (
                    <span
                      key={it.item_id}
                      className="bg-white border border-rose-200 text-rose-800 text-[10px] px-1.5 py-0.5 rounded font-medium truncate max-w-[110px]"
                      title={it.item_name}
                    >
                      {it.item_name}
                    </span>
                  ))}
                  {outOfStockItemsCount > 3 && (
                    <span className="text-[10px] text-rose-600 font-mono self-center">
                      +{outOfStockItemsCount - 3} more
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-cream/40 border border-secondary/30 rounded-xl p-2.5 flex items-center justify-between text-xs">
                <span className="text-[11px] text-charcoal/60">Shift portion levels</span>
                <span className="text-[11px] font-mono font-semibold text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Live Synced
                </span>
              </div>
            )}

            {/* Action Button: Add / Update Cashier Shift Menu Inventory */}
            <button
              type="button"
              onClick={() => setShowInventoryModal(true)}
              className="w-full bg-primary hover:bg-primary-light text-white font-sans text-xs font-bold py-2.5 px-3 rounded-xl cursor-pointer transition shadow-xs flex items-center justify-center gap-2 uppercase tracking-wide active:scale-[0.98]"
            >
              <Plus size={14} />
              <span>Add / Update Shift Inventory</span>
            </button>

            {/* Footer Quick Links */}
            <div className="pt-2 border-t border-secondary/30 flex items-center justify-between text-[11px]">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await downloadDailyInventoryCsv();
                    toast.success('Downloaded', 'Daily shift inventory workbook exported');
                  } catch (e: any) {
                    toast.error('Export Error', e?.message || 'Failed to download daily inventory report');
                  }
                }}
                className="text-charcoal/60 hover:text-primary font-mono text-[10px] flex items-center gap-1 cursor-pointer transition py-0.5"
                title="Download Daily Inventory Audit Workbook"
              >
                <Download size={11} />
                <span>Export Shift XLSX</span>
              </button>

              <button
                type="button"
                onClick={() => setShowInventoryModal(true)}
                className="text-primary hover:underline font-mono text-[10px] cursor-pointer"
              >
                View Full List →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kitchen Order Manager Quick Button */}
      {['admin', 'owner', 'cashier'].includes(role) && (
        <button
          type="button"
          onClick={() => setShowKitchenManager(true)}
          className="w-full bg-white hover:bg-orange-50 border border-orange-200 text-orange-800 font-sans text-xs font-bold py-2 px-3 rounded-2xl cursor-pointer transition flex items-center justify-center gap-2 uppercase tracking-wide shadow-2xs"
        >
          <ChefHat className="w-3.5 h-3.5 text-orange-600" />
          <span>Manage Kitchen Orders</span>
        </button>
      )}
    </div>

      {/* Kitchen Order Management Modal */}
      <KitchenOrderManager
        isOpen={showKitchenManager}
        onClose={() => setShowKitchenManager(false)}
        currentRoomNumber={chargeToRoomNumber || undefined}
      />

      {/* Cashier Shift Menu Inventory Modal */}
      <CashierInventoryModal
        isOpen={showInventoryModal}
        onClose={() => setShowInventoryModal(false)}
        activeCashier={activeCashier}
        onInventoryChanged={refreshInventory}
      />
    </div>
  );
};

