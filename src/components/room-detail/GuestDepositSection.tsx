/**
 * src/components/room-detail/GuestDepositSection.tsx
 * Staff-facing UI for managing Guest Deposit & Credit Balance tied to stay/profile.
 * Allows front desk cashier/admin/owner to:
 * - View real-time computed deposit balance
 * - Record a new deposit-in (Cash, GCash, or Mixed)
 * - Apply deposit toward extending the current room stay
 * - View guest deposit transaction history
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Room } from '../../types';
import { getGuestDepositBalance, recordDeposit, applyDeposit } from '../../api/deposits';
import { DepositTransaction } from '../../types';
import { useToast } from '../ui/Toast';
import {
  Wallet,
  PlusCircle,
  Clock,
  History,
  CheckCircle2,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Sparkles,
  ChevronDown,
  ChevronUp,
  X,
  CreditCard,
  Banknote,
  Smartphone
} from 'lucide-react';
import { formatStayDuration, EXCESS_HOUR_RATE } from '../../utils/pricing';

interface GuestDepositSectionProps {
  room: Room;
  onRoomUpdated: (updatedRoom: Room) => void | Promise<void>;
  getRateValue: (tier: Room['tier'], rateType: Room['rateSelected']) => number;
  activeCashier: string;
}

export const GuestDepositSection: React.FC<GuestDepositSectionProps> = ({
  room,
  onRoomUpdated,
  getRateValue,
  activeCashier,
}) => {
  const toast = useToast();

  const guestIdentifier = (room.guestId || room.guestName || `GUEST-RM${room.number}`).trim();

  const [balanceCentavos, setBalanceCentavos] = useState<number>(0);
  const [transactions, setTransactions] = useState<DepositTransaction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [showAddDepositModal, setShowAddDepositModal] = useState<boolean>(false);
  const [showExtendModal, setShowExtendModal] = useState<boolean>(false);
  const [showHistory, setShowHistory] = useState<boolean>(false);

  // Add Deposit Form State
  const [depositAmount, setDepositAmount] = useState<string>('1500');
  const [depositMethod, setDepositMethod] = useState<'CASH' | 'GCASH' | 'MIXED'>('CASH');
  const [cashSplitAmount, setCashSplitAmount] = useState<string>('750');
  const [gcashSplitAmount, setGcashSplitAmount] = useState<string>('750');
  const [gcashRef, setGcashRef] = useState<string>('');
  const [depositNotes, setDepositNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Extend Stay Form State - typed hours based on ₱130/excess hour
  const [extensionHoursInput, setExtensionHoursInput] = useState<string>('2');

  const fetchBalance = useCallback(async () => {
    if (!guestIdentifier) return;
    try {
      setIsLoading(true);
      const data = await getGuestDepositBalance(guestIdentifier);
      setBalanceCentavos(data.balanceCentavos || 0);
      setTransactions(data.transactions || []);
    } catch (err: any) {
      console.warn('Could not fetch deposit balance:', err);
    } finally {
      setIsLoading(false);
    }
  }, [guestIdentifier]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  const balancePesos = balanceCentavos / 100;

  // Compute extension cost based on typed hours & official excess hour rate (+₱130/hr)
  const parsedExtensionHours = Math.max(0, parseInt(extensionHoursInput, 10) || 0);
  const extensionCost = parsedExtensionHours * EXCESS_HOUR_RATE;
  const extensionCostCentavos = parsedExtensionHours * (EXCESS_HOUR_RATE * 100);
  const hasSufficientBalance = parsedExtensionHours > 0 && balanceCentavos >= extensionCostCentavos;
  const remainingAfterExtensionCentavos = Math.max(0, balanceCentavos - extensionCostCentavos);

  const formatDateTime = (dateVal: string | null | undefined): string => {
    if (!dateVal) return 'N/A';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const currentCheckoutDate = room.checkOutTime ? new Date(room.checkOutTime) : new Date();
  const baseCheckoutTime = (!isNaN(currentCheckoutDate.getTime()) && currentCheckoutDate.getTime() > Date.now())
    ? currentCheckoutDate.getTime()
    : Date.now();
  const previewNewCheckoutDate = new Date(baseCheckoutTime + parsedExtensionHours * 3600 * 1000);

  // Handle Record Deposit
  const handleRecordDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const parsedTotal = parseFloat(depositAmount);
    if (isNaN(parsedTotal) || parsedTotal <= 0) {
      toast.warning('Invalid Amount', 'Please enter a valid deposit amount.');
      return;
    }

    const totalCentavos = Math.round(parsedTotal * 100);

    let cashCentavos = 0;
    let gcashCentavos = 0;

    if (depositMethod === 'CASH') {
      cashCentavos = totalCentavos;
    } else if (depositMethod === 'GCASH') {
      gcashCentavos = totalCentavos;
      if (!gcashRef.trim()) {
        toast.warning('GCash Reference Required', 'Please provide the GCash transaction reference number.');
        return;
      }
    } else if (depositMethod === 'MIXED') {
      const parsedCash = parseFloat(cashSplitAmount) || 0;
      const parsedGcash = parseFloat(gcashSplitAmount) || 0;
      cashCentavos = Math.round(parsedCash * 100);
      gcashCentavos = Math.round(parsedGcash * 100);

      if (cashCentavos + gcashCentavos !== totalCentavos) {
        toast.warning(
          'Split Mismatch',
          `Cash (₱${parsedCash.toFixed(2)}) + GCash (₱${parsedGcash.toFixed(2)}) must equal total ₱${parsedTotal.toFixed(2)}.`
        );
        return;
      }

      if (gcashCentavos > 0 && !gcashRef.trim()) {
        toast.warning('GCash Reference Required', 'Please enter the GCash reference number for the GCash portion.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const res = await recordDeposit({
        guestIdentifier,
        guestName: room.guestName || undefined,
        amountCentavos: totalCentavos,
        paymentMethod: depositMethod,
        cashAmountCentavos: cashCentavos,
        gcashAmountCentavos: gcashCentavos,
        reference: gcashRef.trim() || undefined,
        notes: depositNotes.trim() || `Deposit received by ${activeCashier}`,
        idempotencyKey: `dep-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      });

      toast.success(
        'Deposit Recorded',
        `Successfully added ₱${(totalCentavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} to guest credit balance.`
      );

      setBalanceCentavos(res.balanceCentavos);
      setShowAddDepositModal(false);
      setDepositAmount('1500');
      setGcashRef('');
      setDepositNotes('');
      fetchBalance();
    } catch (err: any) {
      console.error('Record deposit error:', err);
      toast.error('Deposit Failed', err.message || 'Failed to record deposit');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Apply Deposit for Room Extension
  const handleApplyExtension = async () => {
    if (isSubmitting) return;

    if (parsedExtensionHours <= 0) {
      toast.warning('Invalid Hours', 'Please enter a valid number of hours to extend (minimum 1 hour).');
      return;
    }

    if (!hasSufficientBalance) {
      toast.warning(
        'Insufficient Deposit',
        `Deposit balance (₱${balancePesos.toLocaleString('en-US', { minimumFractionDigits: 2 })}) cannot cover extension cost (₱${extensionCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}).`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await applyDeposit({
        guestIdentifier,
        amountCentavos: extensionCostCentavos,
        applyType: 'room_extension',
        roomNumber: room.number,
        extensionHours: parsedExtensionHours,
        notes: `Stay extended by ${parsedExtensionHours} hour(s) (₱${extensionCost.toLocaleString('en-US', { minimumFractionDigits: 2 })} @ ₱${EXCESS_HOUR_RATE}/excess hr) from deposit balance by ${activeCashier}`,
        idempotencyKey: `ext-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      });

      toast.success(
        'Stay Extended Successfully',
        `Room ${room.number} extended by +${parsedExtensionHours} hr(s). Remaining deposit: ₱${(res.balanceCentavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      );

      setBalanceCentavos(res.balanceCentavos);
      setShowExtendModal(false);

      if (res.updatedRoom) {
        Promise.resolve(onRoomUpdated({
          ...room,
          checkOutTime: res.updatedRoom.checkOutTime,
          state: 'occupied',
          isOverdue: false,
        })).catch(() => { /* already toasted */ });
      }

      fetchBalance();
    } catch (err: any) {
      console.error('Extension apply error:', err);
      toast.error('Extension Failed', err.message || 'Failed to apply deposit to extend stay');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-emerald-200/80 shadow-xs overflow-hidden transition-all">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50/60 p-3 border-b border-emerald-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-700 flex items-center justify-center border border-emerald-500/20">
            <Wallet size={16} />
          </div>
          <div>
            <span className="text-[9px] font-mono uppercase font-bold text-emerald-800 tracking-wider flex items-center gap-1">
              <span>Guest Deposit & Credit</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            </span>
            <div className="text-xs font-mono font-bold text-charcoal flex items-center gap-1.5">
              <span>₱{balancePesos.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              <span className={`text-[9px] px-1.5 py-0.2 rounded font-sans font-bold uppercase ${
                balanceCentavos > 0
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-slate-100 text-slate-500 border border-slate-200'
              }`}>
                {balanceCentavos > 0 ? 'Credit Ready' : 'Zero Balance'}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowAddDepositModal(true)}
            className="px-2.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-sans text-[10.5px] font-bold shadow-xs flex items-center gap-1 transition cursor-pointer"
          >
            <PlusCircle size={13} />
            <span>Add Deposit</span>
          </button>

          <button
            type="button"
            onClick={() => setShowExtendModal(true)}
            className="px-2.5 py-1.5 rounded-xl bg-primary hover:bg-primary-hover text-white font-sans text-[10.5px] font-bold shadow-xs flex items-center gap-1 transition cursor-pointer"
          >
            <Clock size={13} />
            <span>Extend Stay</span>
          </button>
        </div>
      </div>

      {/* Guest Identifier info & Quick History Toggle */}
      <div className="p-3 bg-white space-y-2">
        <div className="flex justify-between items-center text-[10px] font-mono text-charcoal/70">
          <div>
            <span className="text-charcoal/40 uppercase tracking-wide mr-1">Identity:</span>
            <span className="font-bold text-charcoal">{guestIdentifier}</span>
          </div>
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className="text-emerald-700 hover:text-emerald-900 font-sans font-semibold text-[10px] flex items-center gap-1 cursor-pointer"
          >
            <History size={11} />
            <span>{showHistory ? 'Hide History' : `History (${transactions.length})`}</span>
            {showHistory ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>

        {/* Expandable History Table */}
        {showHistory && (
          <div className="pt-2 border-t border-slate-100 space-y-1.5">
            {transactions.length === 0 ? (
              <p className="text-[10px] font-mono text-charcoal/40 text-center py-2">
                No deposit transactions recorded for this guest identifier.
              </p>
            ) : (
              <div className="max-h-40 overflow-y-auto space-y-1 pr-1 font-mono text-[10px]">
                {transactions.map((tx) => {
                  const isIn = tx.direction === 'IN';
                  return (
                    <div
                      key={tx.id}
                      className="p-1.5 rounded-lg border border-slate-100 bg-slate-50/50 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-1.5">
                        <div
                          className={`w-4 h-4 rounded-full flex items-center justify-center ${
                            isIn ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                          }`}
                        >
                          {isIn ? <ArrowDownRight size={10} /> : <ArrowUpRight size={10} />}
                        </div>
                        <div>
                          <div className="font-bold text-charcoal">
                            {isIn ? 'Deposit In' : 'Applied'} · {tx.paymentMethod}
                          </div>
                          <div className="text-[9px] text-charcoal/50">
                            {new Date(tx.createdAt).toLocaleDateString()} {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} by {tx.operator}
                          </div>
                        </div>
                      </div>
                      <div className={`font-extrabold text-right ${isIn ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {isIn ? '+' : '-'}₱{(tx.amountCentavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 1: ADD DEPOSIT */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {showAddDepositModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-secondary max-w-md w-full p-5 space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex justify-between items-center border-b border-secondary/40 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <PlusCircle size={18} />
                </div>
                <div>
                  <h3 className="font-display font-extrabold text-charcoal text-sm">Record Guest Deposit</h3>
                  <p className="text-[10px] font-mono text-charcoal/50">
                    Received at desk for {guestIdentifier}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddDepositModal(false)}
                className="text-charcoal/40 hover:text-charcoal cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleRecordDeposit} className="space-y-3.5">
              {/* Amount Input */}
              <div className="space-y-1">
                <label className="text-[11px] font-mono uppercase font-bold text-charcoal/70">
                  Deposit Amount (₱)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal/50 font-bold font-mono">
                    ₱
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={depositAmount}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDepositAmount(val);
                      const half = (parseFloat(val) || 0) / 2;
                      setCashSplitAmount(half.toFixed(2));
                      setGcashSplitAmount(half.toFixed(2));
                    }}
                    required
                    className="w-full pl-8 pr-3 py-2 border border-secondary rounded-xl font-mono text-base font-extrabold text-charcoal outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 bg-cream/10"
                  />
                </div>
              </div>

              {/* Payment Method Selector */}
              <div className="space-y-1">
                <label className="text-[11px] font-mono uppercase font-bold text-charcoal/70">
                  Payment Method
                </label>
                <div className="grid grid-cols-3 gap-1.5 font-mono text-xs">
                  <button
                    type="button"
                    onClick={() => setDepositMethod('CASH')}
                    className={`py-2 rounded-xl border flex flex-col items-center gap-1 cursor-pointer transition ${
                      depositMethod === 'CASH'
                        ? 'bg-emerald-700 text-white border-emerald-700 font-bold shadow-xs'
                        : 'bg-white border-secondary/60 text-charcoal/70 hover:bg-cream/40'
                    }`}
                  >
                    <Banknote size={15} />
                    <span className="text-[10px]">CASH</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDepositMethod('GCASH')}
                    className={`py-2 rounded-xl border flex flex-col items-center gap-1 cursor-pointer transition ${
                      depositMethod === 'GCASH'
                        ? 'bg-blue-600 text-white border-blue-600 font-bold shadow-xs'
                        : 'bg-white border-secondary/60 text-charcoal/70 hover:bg-cream/40'
                    }`}
                  >
                    <Smartphone size={15} />
                    <span className="text-[10px]">GCASH</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDepositMethod('MIXED')}
                    className={`py-2 rounded-xl border flex flex-col items-center gap-1 cursor-pointer transition ${
                      depositMethod === 'MIXED'
                        ? 'bg-purple-700 text-white border-purple-700 font-bold shadow-xs'
                        : 'bg-white border-secondary/60 text-charcoal/70 hover:bg-cream/40'
                    }`}
                  >
                    <CreditCard size={15} />
                    <span className="text-[10px]">MIXED</span>
                  </button>
                </div>
              </div>

              {/* Mixed Payment Split Inputs */}
              {depositMethod === 'MIXED' && (
                <div className="p-3 bg-purple-50/60 rounded-xl border border-purple-200/80 space-y-2 text-xs font-mono">
                  <div className="flex justify-between items-center text-[10px] font-bold text-purple-900">
                    <span>Split Breakdown</span>
                    <span>Total: ₱{parseFloat(depositAmount || '0').toFixed(2)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[9px] uppercase text-charcoal/50 block">Cash Portion</span>
                      <input
                        type="number"
                        step="any"
                        value={cashSplitAmount}
                        onChange={(e) => {
                          const cashVal = parseFloat(e.target.value) || 0;
                          const total = parseFloat(depositAmount) || 0;
                          setCashSplitAmount(e.target.value);
                          setGcashSplitAmount(Math.max(0, total - cashVal).toFixed(2));
                        }}
                        className="w-full px-2 py-1.5 border border-purple-300 rounded-lg font-bold bg-white text-charcoal"
                      />
                    </div>
                    <div>
                      <span className="text-[9px] uppercase text-charcoal/50 block">GCash Portion</span>
                      <input
                        type="number"
                        step="any"
                        value={gcashSplitAmount}
                        onChange={(e) => {
                          const gcashVal = parseFloat(e.target.value) || 0;
                          const total = parseFloat(depositAmount) || 0;
                          setGcashSplitAmount(e.target.value);
                          setCashSplitAmount(Math.max(0, total - gcashVal).toFixed(2));
                        }}
                        className="w-full px-2 py-1.5 border border-purple-300 rounded-lg font-bold bg-white text-charcoal"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* GCash Reference Input */}
              {(depositMethod === 'GCASH' || depositMethod === 'MIXED') && (
                <div className="space-y-1">
                  <label className="text-[11px] font-mono uppercase font-bold text-charcoal/70 flex items-center justify-between">
                    <span>GCash Transaction Reference</span>
                    <span className="text-rose-600 font-bold">*Required</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. GCash Ref # / 13-digit code"
                    value={gcashRef}
                    onChange={(e) => setGcashRef(e.target.value)}
                    className="w-full px-3 py-2 border border-secondary rounded-xl font-mono text-xs outline-none focus:border-blue-600 bg-cream/10"
                  />
                </div>
              )}

              {/* Optional Notes */}
              <div className="space-y-1">
                <label className="text-[11px] font-mono uppercase font-bold text-charcoal/70">
                  Notes / Reference (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Pre-deposit for stay extension or advance meals"
                  value={depositNotes}
                  onChange={(e) => setDepositNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-secondary rounded-xl font-mono text-xs outline-none focus:border-emerald-600 bg-cream/10"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddDepositModal(false)}
                  className="flex-1 py-2 rounded-xl border border-secondary text-charcoal font-sans text-xs font-bold hover:bg-cream/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-sans text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Recording...' : 'Confirm Deposit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 2: EXTEND STAY WITH DEPOSIT */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {showExtendModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-secondary max-w-md w-full p-5 space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex justify-between items-center border-b border-secondary/40 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <Clock size={18} />
                </div>
                <div>
                  <h3 className="font-display font-extrabold text-charcoal text-sm">Extend Stay with Deposit</h3>
                  <p className="text-[10px] font-mono text-charcoal/50">
                    Room {room.number} ({room.tier}) · Available: ₱{balancePesos.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowExtendModal(false)}
                className="text-charcoal/40 hover:text-charcoal cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              {/* Rate Policy Banner */}
              <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-2.5 flex items-start gap-2 text-amber-900 text-[11px] font-mono">
                <Clock size={14} className="text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-bold flex items-center gap-1.5">
                    <span>Excess Hour Rate:</span>
                    <span className="text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded font-extrabold">+₱{EXCESS_HOUR_RATE} / excess hour</span>
                  </div>
                  <p className="text-[10px] text-amber-800/80">
                    Extension fee is calculated at +₱{EXCESS_HOUR_RATE} for every excess hour of stay.
                  </p>
                </div>
              </div>

              {/* Hours to Extend Input */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono uppercase font-bold text-charcoal/70 flex justify-between items-center">
                  <span>Type Hours to Extend</span>
                  <span className="text-[10px] text-slate-500 font-normal">
                    Current checkout: {formatDateTime(room.checkOutTime)}
                  </span>
                </label>

                {/* Stepper + Direct Typing Input */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const current = Math.max(1, (parseInt(extensionHoursInput, 10) || 1) - 1);
                      setExtensionHoursInput(String(current));
                    }}
                    disabled={parsedExtensionHours <= 1}
                    className="w-10 h-10 rounded-xl border border-secondary bg-white hover:bg-cream/40 text-charcoal font-bold text-lg flex items-center justify-center transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    -
                  </button>
                  <div className="relative flex-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={extensionHoursInput}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9]/g, '');
                        setExtensionHoursInput(val);
                      }}
                      placeholder="e.g. 2"
                      className="w-full h-10 px-3 pr-14 text-center font-mono font-bold text-base bg-white border border-secondary rounded-xl text-charcoal focus:outline-hidden focus:border-primary"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono font-medium text-charcoal/40 pointer-events-none">
                      {parsedExtensionHours === 1 ? 'hour' : 'hours'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const current = (parseInt(extensionHoursInput, 10) || 0) + 1;
                      setExtensionHoursInput(String(current));
                    }}
                    className="w-10 h-10 rounded-xl border border-secondary bg-white hover:bg-cream/40 text-charcoal font-bold text-lg flex items-center justify-center transition cursor-pointer"
                  >
                    +
                  </button>
                </div>

                {/* Quick Presets */}
                <div className="grid grid-cols-6 gap-1.5 pt-1 font-mono">
                  {[1, 2, 3, 6, 12, 24].map((preset) => {
                    const isSelected = parsedExtensionHours === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setExtensionHoursInput(String(preset))}
                        className={`py-1.5 rounded-lg border text-center text-xs transition cursor-pointer font-bold ${
                          isSelected
                            ? 'bg-primary text-white border-primary shadow-xs'
                            : 'bg-white border-secondary/60 text-charcoal/70 hover:bg-cream/40'
                        }`}
                      >
                        +{preset}h
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Expected New Checkout Preview */}
              <div className="p-2.5 bg-emerald-50/70 border border-emerald-200/80 rounded-xl flex items-center justify-between font-mono text-[11px] text-emerald-900">
                <div className="flex items-center gap-1.5">
                  <Clock size={13} className="text-emerald-700 shrink-0" />
                  <span className="font-semibold">New Expected Checkout:</span>
                </div>
                <span className="font-extrabold text-emerald-800">
                  {parsedExtensionHours > 0 ? formatDateTime(previewNewCheckoutDate.toISOString()) : 'Enter hours'}
                </span>
              </div>

              {/* Financial Summary & Balance Check */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1.5 font-mono text-xs">
                <div className="flex justify-between items-center text-charcoal/70">
                  <span>Extension Fee:</span>
                  <span className="font-bold text-charcoal">
                    {parsedExtensionHours} hr(s) × ₱{EXCESS_HOUR_RATE} = ₱{extensionCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center text-charcoal/70">
                  <span>Current Credit Balance:</span>
                  <span className="font-bold text-emerald-700">
                    ₱{balancePesos.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="pt-1.5 border-t border-slate-200 flex justify-between items-center">
                  <span className="font-bold text-charcoal">Remaining Balance:</span>
                  <span className={`font-extrabold ${hasSufficientBalance ? 'text-primary' : 'text-rose-600'}`}>
                    ₱{(remainingAfterExtensionCentavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {!hasSufficientBalance && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-rose-800 text-[11px] font-mono">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>
                    {parsedExtensionHours <= 0
                      ? 'Please enter at least 1 hour to extend.'
                      : `Insufficient deposit. Additional ₱${((extensionCostCentavos - balanceCentavos) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} deposit required.`}
                  </span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowExtendModal(false)}
                  className="flex-1 py-2 rounded-xl border border-secondary text-charcoal font-sans text-xs font-bold hover:bg-cream/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyExtension}
                  disabled={!hasSufficientBalance || isSubmitting}
                  className="flex-1 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white font-sans text-xs font-bold shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSubmitting
                    ? 'Extending...'
                    : `Confirm Extension (+${parsedExtensionHours}h · ₱${extensionCost.toLocaleString('en-US', { minimumFractionDigits: 2 })})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
