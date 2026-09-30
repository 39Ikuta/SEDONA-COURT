import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Room, POSItem, Receipt } from '../../types';
import {
  Users,
  UtensilsCrossed,
  Search,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  CheckCircle2,
  Receipt as ReceiptIcon,
  ChevronRight,
  Sparkles,
  ShoppingBag,
  Clock,
  Printer,
  ShieldCheck,
  AlertCircle,
  Tag,
  FileSpreadsheet,
  Layers,
  DollarSign
} from 'lucide-react';
import { kitchenOrderService } from '../../api/kitchen';
import { useToast } from '../ui/Toast';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface StaffHouseViewProps {
  room: Room;
  dynamicCatalog: POSItem[];
  chargedFood: Array<{ item: POSItem; quantity: number }>;
  addFoodItem: (item: POSItem) => void;
  changeFoodQty: (itemId: string, diff: number) => void;
  onUpdateRoom: (updatedRoom: Room) => void | Promise<void>;
  onGenerateReceipt: (receipt: Receipt) => void | Promise<void>;
  onClose: () => void;
  activeCashier: string;
  loggedInUser: string;
}

export const StaffHouseView: React.FC<StaffHouseViewProps> = ({
  room,
  dynamicCatalog,
  chargedFood,
  addFoodItem,
  changeFoodQty,
  onUpdateRoom,
  onGenerateReceipt,
  onClose,
  activeCashier,
  loggedInUser,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'GCASH' | 'MIXED'>('CASH');
  const [gcashRef, setGcashRef] = useState('');
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [gcashAmount, setGcashAmount] = useState<number>(0);
  const [staffNotes, setStaffNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false);
  const toast = useToast();
  const [showOrderCatalog, setShowOrderCatalog] = useState(true);

  // Extract unique categories
  const categories = ['All', ...Array.from(new Set(dynamicCatalog.map((i) => i.category)))];

  // Filter menu catalog
  const filteredCatalog = dynamicCatalog.filter((item) => {
    const categoryMatches = activeCategory === 'All' || item.category === activeCategory;
    const searchMatches =
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description.toLowerCase().includes(searchTerm.toLowerCase());
    return categoryMatches && searchMatches;
  });

  // Calculate bill total (Items & Room Charges only — ₱0 room rent)
  const itemsTotal = chargedFood.reduce((sum, f) => sum + f.item.price * f.quantity, 0);
  const totalItemCount = chargedFood.reduce((sum, f) => sum + f.quantity, 0);

  const handleCashAmountChange = (val: number) => {
    setCashAmount(val);
    const rem = Math.max(0, itemsTotal - val);
    setGcashAmount(rem);
  };

  const handleGcashAmountChange = (val: number) => {
    setGcashAmount(val);
    const rem = Math.max(0, itemsTotal - val);
    setCashAmount(rem);
  };

  // Add food item and dispatch kitchen ticket
  const handleAddAndDispatch = async (item: POSItem) => {
    addFoodItem(item);

    // Dispatch to kitchen queue
    try {
      await kitchenOrderService.createOrder({
        room_number: '12',
        guest_name: 'Sedona Staff',
        cashier_name: activeCashier || loggedInUser || 'CASHIER',
        items: [
          {
            item_id: item.id,
            name: item.name,
            quantity: 1,
            special_instructions: staffNotes ? `[STAFF] ${staffNotes}` : '[STAFF HOUSE ORDER]',
          },
        ],
        total_amount: item.price,
        special_instructions: staffNotes ? `[STAFF] ${staffNotes}` : '[STAFF HOUSE ORDER]',
      });
    } catch (err) {
      console.warn('Failed to send kitchen ticket:', err);
    }
  };

  // Settle Staff Tab (Generate Receipt & Clear food tab)
  const handleSettleStaffTab = () => {
    if (itemsTotal <= 0) return;
    setIsSubmitting(true);

    const now = new Date();
    const receiptNo = `STF-${Math.floor(100000 + Math.random() * 900000)}`;

    const items = chargedFood.map((f) => ({
      item_id: f.item.id,
      id: f.item.id,
      quantity: f.quantity,
      name: f.item.name,
      description: f.item.name,
      subtext: `${f.quantity} Qty @ ₱${f.item.price} • ${f.item.category || 'Item Order'}`,
      amount: f.item.price * f.quantity,
    }));

    const receipt: Receipt = {
      receiptNo,
      dateTime: now.toISOString(),
      guestName: 'Sedona Staff (Staff House)',
      roomNumber: '12',
      roomType: 'Staff House (No Rent)',
      paymentMethod,
      gcashRef: paymentMethod !== 'CASH' ? gcashRef : undefined,
      cashAmount: paymentMethod === 'MIXED' ? cashAmount : paymentMethod === 'CASH' ? itemsTotal : 0,
      gcashAmount: paymentMethod === 'MIXED' ? gcashAmount : paymentMethod === 'GCASH' ? itemsTotal : 0,
      checkIn: now.toISOString(),
      checkOut: now.toISOString(),
      items,
      subtotal: itemsTotal,
      serviceCharge: 0,
      total: itemsTotal,
      amountTendered: itemsTotal,
      changeAmount: 0,
      amountTenderedCents: Math.round(itemsTotal * 100),
      changeCents: 0,
      cashierId: activeCashier || loggedInUser || 'CASHIER',
      rateSelected: 'STAFF',
      stayDuration: 'Staff Living Quarters (₱0 Rent)',
    };

    // 1. Clear chargedFood on the room
    Promise.resolve(onUpdateRoom({
      ...room,
      chargedFood: [],
    })).catch(() => { /* already toasted */ });

    // 2. Generate Receipt for POS Revenue & Ledger
    Promise.resolve(onGenerateReceipt(receipt)).catch(() => { /* already toasted */ });
    setIsSubmitting(false);
  };

  // Clear tab without generating receipt
  const handleClearTab = () => {
    setIsConfirmClearOpen(true);
  };

  const handleConfirmClearTab = () => {
    setIsConfirmClearOpen(false);
    Promise.resolve(onUpdateRoom({
      ...room,
      chargedFood: [],
    })).catch(() => { /* already toasted */ });
    toast.success('Tab Cleared', 'Staff House active orders have been reset.');
  };

  return (
    <div className="space-y-5">
      {/* ─── 1. Permanent Staff House Banner ─── */}
      <div className="bg-indigo-50/70 border border-indigo-200/80 rounded-2xl p-4 flex flex-col gap-2.5 shadow-2xs">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <Users size={18} />
            </div>
            <div>
              <span className="text-[9px] font-mono uppercase text-indigo-900 font-bold tracking-wider block">
                Permanent Employee Quarters
              </span>
              <h4 className="font-display font-extrabold text-sm text-indigo-950">
                Staff House (Room 12)
              </h4>
            </div>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold uppercase">
            ₱0.00 Room Rent
          </span>
        </div>

        <div className="text-[11px] font-sans text-indigo-950/80 bg-white/80 p-2.5 rounded-xl border border-indigo-100 flex items-center gap-2">
          <ShieldCheck size={15} className="text-indigo-600 shrink-0" />
          <span>
            <strong>No Room Rent is Charged.</strong> Staff living quarters are permanently free of rent. You can order kitchen meals, drinks, snacks, and room supplies below.
          </span>
        </div>
      </div>

      {/* ─── 2. ACTUAL ORDERS OF ITEMS & ROOM CHARGES LEDGER ─── */}
      <div className="bg-white border border-secondary/70 rounded-2xl p-4 space-y-3 shadow-xs">
        <div className="flex justify-between items-center border-b border-secondary/30 pb-2.5">
          <div className="flex items-center gap-2">
            <ShoppingBag size={16} className="text-primary" />
            <div>
              <h5 className="font-display font-bold text-xs text-charcoal uppercase tracking-wider">
                Actual Orders: Items &amp; Room Charges
              </h5>
              <span className="text-[9px] font-mono text-charcoal/50">
                Itemized Staff Quarters Consumption Ledger
              </span>
            </div>
          </div>
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
            {totalItemCount} {totalItemCount === 1 ? 'Item' : 'Items'}
          </span>
        </div>

        {/* Room Stay Charge Row: Always ₱0.00 */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50/50 border border-emerald-200/60 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <div>
              <span className="font-bold text-emerald-950 block">Room Stay &amp; Living Quarters</span>
              <span className="text-[10px] text-emerald-700">Permanent Employee Housing &bull; Zero Rent</span>
            </div>
          </div>
          <span className="font-black text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded text-xs">
            ₱0.00 (FREE)
          </span>
        </div>

        {/* Itemized Order Breakdown */}
        {chargedFood.length === 0 ? (
          <div className="text-center py-6 text-charcoal/40 font-mono text-xs space-y-1 bg-cream/10 rounded-xl border border-dashed border-secondary/50 p-4">
            <UtensilsCrossed size={24} className="mx-auto text-charcoal/30 mb-1" />
            <p className="font-bold text-charcoal/60">No Active Items or F&amp;B Orders Charged</p>
            <p className="text-[10px] text-charcoal/40 font-sans">
              Choose food, beverages, snacks, or amenities from the catalog below to add charges to the staff house.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {chargedFood.map(({ item, quantity }) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-cream/20 border border-secondary/40 text-xs hover:border-primary/30 transition"
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-charcoal block truncate">{item.name}</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-white border border-secondary/50 text-charcoal/60 shrink-0">
                        {item.category}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-charcoal/60">
                      ₱{item.price.toFixed(2)} &times; {quantity} = <strong className="text-primary font-bold">₱{(item.price * quantity).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => changeFoodQty(item.id, -1)}
                      className="w-6 h-6 rounded-lg bg-white border border-secondary/50 flex items-center justify-center text-charcoal/70 hover:text-charcoal hover:bg-cream/40 transition cursor-pointer"
                      title="Decrease Quantity"
                    >
                      <Minus size={11} />
                    </button>
                    <span className="w-6 text-center font-mono font-bold text-xs text-charcoal">
                      {quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => changeFoodQty(item.id, 1)}
                      className="w-6 h-6 rounded-lg bg-white border border-secondary/50 flex items-center justify-center text-charcoal/70 hover:text-charcoal hover:bg-cream/40 transition cursor-pointer"
                      title="Increase Quantity"
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Subtotal summary ledger table */}
            <div className="pt-3 border-t border-secondary/30 space-y-1.5 font-mono text-xs">
              <div className="flex justify-between text-charcoal/60">
                <span>Room Stay &amp; Rent:</span>
                <span className="text-emerald-700 font-bold">₱0.00 (Free)</span>
              </div>
              <div className="flex justify-between text-charcoal/60">
                <span>Items &amp; Service Orders ({totalItemCount}):</span>
                <span className="font-bold text-charcoal">
                  ₱{itemsTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-secondary/40 font-bold text-sm">
                <span className="uppercase text-charcoal/80">Total Room Charges Due:</span>
                <span className="font-display font-black text-lg text-primary">
                  ₱{itemsTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── 3. Menu & Catalog Browser ─── */}
      <div className="bg-white border border-secondary/60 rounded-2xl p-4 space-y-3 shadow-xs">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <UtensilsCrossed size={15} className="text-primary" />
            <h5 className="font-display font-bold text-xs text-charcoal uppercase tracking-wider">
              Avail Menu Items &amp; Supplies
            </h5>
          </div>
          <button
            type="button"
            onClick={() => setShowOrderCatalog(!showOrderCatalog)}
            className="text-[10px] font-mono text-primary font-bold hover:underline cursor-pointer"
          >
            {showOrderCatalog ? 'Hide Catalog' : 'Show Catalog'}
          </button>
        </div>

        {showOrderCatalog && (
          <div className="space-y-2.5">
            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-charcoal/40" />
              <input
                type="text"
                placeholder="Search food, beverages, snacks, laundry..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-cream/10 border border-secondary/60 rounded-xl font-sans outline-none focus:border-primary"
              />
            </div>

            {/* Category pills */}
            <div className="flex gap-1 overflow-x-auto pb-1 text-[10px] font-mono">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`px-2.5 py-1 rounded-lg transition shrink-0 cursor-pointer ${
                    activeCategory === cat
                      ? 'bg-primary text-white font-bold shadow-2xs'
                      : 'bg-cream/40 text-charcoal/70 hover:bg-cream/70'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Catalog list */}
            <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
              {filteredCatalog.map((item) => {
                const currentQty = chargedFood.find((f) => f.item.id === item.id)?.quantity || 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleAddAndDispatch(item)}
                    className="p-2.5 rounded-xl border border-secondary/50 bg-cream/5 hover:bg-cream/25 hover:border-primary/40 text-left transition flex flex-col justify-between gap-1.5 cursor-pointer group active:scale-[0.98]"
                  >
                    <div>
                      <span className="font-bold text-xs text-charcoal group-hover:text-primary transition line-clamp-1">
                        {item.name}
                      </span>
                      <span className="text-[10px] text-charcoal/50 font-sans line-clamp-1">
                        {item.description || item.category}
                      </span>
                    </div>

                    <div className="flex justify-between items-center pt-1 border-t border-secondary/20 font-mono text-[11px]">
                      <span className="font-bold text-primary">₱{item.price}</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                        currentQty > 0
                          ? 'text-indigo-800 bg-indigo-50 border border-indigo-200'
                          : 'text-emerald-700 bg-emerald-50'
                      }`}>
                        {currentQty > 0 ? `In Tab (${currentQty})` : '+ Add'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ─── 4. Settlement & Payment (If Charges exist) ─── */}
      {itemsTotal > 0 && (
        <div className="bg-emerald-50/30 border border-emerald-200/70 rounded-2xl p-4 space-y-3">
          <div className="flex justify-between items-center">
            <span className="font-mono text-xs uppercase font-bold text-emerald-950">
              Settle Items &amp; Room Charges
            </span>
            <span className="font-display font-extrabold text-base text-emerald-900">
              ₱{itemsTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>

          {/* Payment Method Selector */}
          <div className="flex rounded-xl bg-white p-1 border border-secondary/40">
            {(['CASH', 'GCASH', 'MIXED'] as const).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setPaymentMethod(method)}
                className={`flex-1 py-1.5 text-[11px] font-mono font-bold rounded-lg transition cursor-pointer ${
                  paymentMethod === method
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-charcoal/70 hover:text-charcoal'
                }`}
              >
                {method}
              </button>
            ))}
          </div>

          {/* GCash Reference if applicable */}
          {paymentMethod === 'GCASH' && (
            <div className="space-y-1">
              <label className="text-[10px] font-mono text-charcoal/60 uppercase">GCash Reference No.</label>
              <input
                type="text"
                value={gcashRef}
                onChange={(e) => setGcashRef(e.target.value)}
                placeholder="e.g. GC-9823472"
                className="w-full p-2 text-xs bg-white border border-secondary rounded-xl font-mono outline-none focus:border-emerald-600"
              />
            </div>
          )}

          {/* Mixed Payment Breakdown */}
          {paymentMethod === 'MIXED' && (
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div>
                <label className="text-[10px] text-charcoal/60 uppercase block">Cash (₱)</label>
                <input
                  type="number"
                  value={cashAmount || ''}
                  onChange={(e) => handleCashAmountChange(parseFloat(e.target.value) || 0)}
                  className="w-full p-2 bg-white border border-secondary rounded-xl font-mono outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-charcoal/60 uppercase block">GCash (₱)</label>
                <input
                  type="number"
                  value={gcashAmount || ''}
                  onChange={(e) => handleGcashAmountChange(parseFloat(e.target.value) || 0)}
                  className="w-full p-2 bg-white border border-secondary rounded-xl font-mono outline-none"
                />
              </div>
            </div>
          )}

          {/* Settle / Clear Buttons */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleClearTab}
              className="flex-1 bg-white hover:bg-rose-50 border border-rose-200 text-rose-700 font-sans text-xs font-bold py-3 rounded-xl cursor-pointer transition text-center"
            >
              Clear Charges
            </button>
            <button
              type="button"
              onClick={handleSettleStaffTab}
              disabled={isSubmitting}
              className="flex-[2] bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-xs font-bold py-3 rounded-xl cursor-pointer transition shadow-md shadow-emerald-600/10 flex items-center justify-center gap-1.5 active:scale-[0.98]"
            >
              <ReceiptIcon size={14} />
              <span>Settle Items Receipt</span>
            </button>
          </div>
        </div>
      )}

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="w-full bg-white hover:bg-cream/40 border border-secondary text-charcoal font-sans text-xs font-bold py-3 rounded-xl cursor-pointer transition text-center"
      >
        Close Drawer
      </button>

      {/* Confirm Clear Tab Dialog */}
      <ConfirmDialog
        isOpen={isConfirmClearOpen}
        title="Clear Staff House Tab"
        message="Are you sure you want to clear all active food orders and room charges for the Staff House? This will reset the order list to ₱0."
        confirmLabel="Clear Orders"
        variant="warning"
        onConfirm={handleConfirmClearTab}
        onCancel={() => setIsConfirmClearOpen(false)}
      />
    </div>
  );
};
