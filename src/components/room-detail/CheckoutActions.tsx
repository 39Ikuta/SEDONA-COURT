import React from 'react';
import { motion } from 'motion/react';
import { Room, Deposit } from '../../types';
import { CreditCard, ChevronRight, UserCheck, Loader2, AlertCircle, ShieldAlert, ChevronDown, Printer, Ticket, Banknote, ShieldCheck } from 'lucide-react';
import { formatStayDuration } from '../../utils/pricing';
import { getDiscountAmountPesos } from '../../utils/discount-rates';

interface CheckoutActionsProps {
  room: Room;
  role: string;
  foodCharge: number;
  baseRate: number;
  bedsCharge: number;
  extraBeds: number;
  towelsCharge: number;
  towelSets: number;
  extraGuests?: number;
  extraPersonCharge?: number;
  excessHours?: number;
  excessHoursCharge?: number;
  runningTotal: number;
  activeDeposit?: Deposit | null;
  depositResolution?: 'apply' | 'refund' | 'forfeit';
  setDepositResolution?: (val: 'apply' | 'refund' | 'forfeit') => void;
  depositNotes?: string;
  setDepositNotes?: (val: string) => void;
  appliedDepositAmount?: number;
  excessDepositRefund?: number;
  netTotalDue?: number;
  paymentMethod: 'CASH' | 'GCASH' | 'MIXED';
  setPaymentMethod: (val: 'CASH' | 'GCASH' | 'MIXED') => void;
  gcashRef: string;
  setGcashRef: (val: string) => void;
  cashAmount: number;
  handleCashAmountChange: (val: number) => void;
  gcashAmount: number;
  handleGcashAmountChange: (val: number) => void;
  amountTendered?: number;
  handleAmountTenderedChange?: (val: number) => void;
  handleCheckOut: () => void;
  onClose: () => void;
  discountType: 'NONE' | 'SENIOR' | 'DC';
  setDiscountType: (val: 'NONE' | 'SENIOR' | 'DC') => void;
  discountIdRef: string;
  setDiscountIdRef: (val: string) => void;
  onDiscountIdRefBlur?: () => void;
  onDiscountAndRateChange?: (type: 'NONE' | 'SENIOR' | 'DC', rate?: Room['rateSelected']) => void;
  discountAmount: number;
  discountUnconfiguredMessage?: string | null;
  isSubmitting?: boolean;
  rateSelected: Room['rateSelected'];
  setRateSelected?: (val: Room['rateSelected']) => void;
  getRateValue?: (tier: Room['tier'], rateType: Room['rateSelected']) => number;
  onRequestForceCheckout?: () => void;
  onPrePrintBill?: () => void;
  onGatePass?: () => void;
  /** When false, the CTA button row + force-checkout trigger are hidden
   * (parent renders them in the sticky action bar instead). */
  showFooterActions?: boolean;
}

export const CheckoutActions: React.FC<CheckoutActionsProps> = ({
  room,
  role,
  foodCharge,
  baseRate,
  bedsCharge,
  extraBeds,
  towelsCharge,
  towelSets,
  extraGuests = 0,
  extraPersonCharge = 0,
  excessHours = 0,
  excessHoursCharge = 0,
  runningTotal,
  activeDeposit,
  depositResolution = 'apply',
  setDepositResolution,
  depositNotes = '',
  setDepositNotes,
  appliedDepositAmount,
  excessDepositRefund = 0,
  netTotalDue,
  paymentMethod,
  setPaymentMethod,
  gcashRef,
  setGcashRef,
  cashAmount,
  handleCashAmountChange,
  gcashAmount,
  handleGcashAmountChange,
  amountTendered = 0,
  handleAmountTenderedChange,
  handleCheckOut,
  onClose,
  discountType,
  setDiscountType,
  discountIdRef,
  setDiscountIdRef,
  onDiscountIdRefBlur,
  onDiscountAndRateChange,
  discountAmount,
  discountUnconfiguredMessage,
  isSubmitting = false,
  rateSelected,
  setRateSelected,
  getRateValue,
  onRequestForceCheckout,
  onPrePrintBill,
  onGatePass,
  showFooterActions = true,
}) => {
  // depositResolution state: use props when parent controls it, else manage locally.
  const [localResolution, setLocalResolution] = React.useState<'apply' | 'refund' | 'forfeit'>(depositResolution ?? 'apply');
  const [localNotes, setLocalNotes] = React.useState<string>(depositNotes ?? '');
  const effectiveResolution = setDepositResolution ? (depositResolution ?? 'apply') : localResolution;
  const effectiveNotes = setDepositNotes ? (depositNotes ?? '') : localNotes;
  const handleResolutionChange = (val: 'apply' | 'refund' | 'forfeit') => {
    if (setDepositResolution) setDepositResolution(val);
    else setLocalResolution(val);
  };
  const handleNotesChange = (val: string) => {
    if (setDepositNotes) setDepositNotes(val);
    else setLocalNotes(val);
  };
  // Discount details start collapsed unless a discount is actively applied.
  const [discountOpen, setDiscountOpen] = React.useState(discountType !== 'NONE');
  React.useEffect(() => {
    if (discountType !== 'NONE') {
      setDiscountOpen(true);
    }
  }, [discountType]);
  const discountSummary = discountType === 'NONE'
    ? 'No discount'
    : `${discountType === 'DC' ? 'Discount Card' : 'Senior / PWD'} −₱${discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (role === 'kitchen') {
    return (
      <div className="space-y-4 pt-4 border-t border-secondary/35">
        <div className="bg-amber-50 border border-amber-200/50 rounded-2xl p-4 space-y-2 font-mono text-xs text-amber-900">
          <div className="flex justify-between font-bold text-sm">
            <span>Food Service Subtotal</span>
            <span>₱{foodCharge.toLocaleString()}</span>
          </div>
          <p className="text-[10px] text-amber-700 font-sans leading-relaxed mt-1">
            Meal and beverage charges have been recorded and saved directly to Room {room.number}'s billing ledger. The Frontdesk Cashier will process the final payment upon check-out.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full bg-primary hover:bg-primary-light text-white font-sans text-xs font-bold py-3.5 rounded-xl transition cursor-pointer active:scale-[0.98] text-center"
        >
          Save & Close Terminal
        </button>
      </div>
    );
  }

  // Effective deposit applied to bill
  const appliedDeposit = (effectiveResolution === 'apply' && activeDeposit)
    ? (appliedDepositAmount ?? Math.min(runningTotal, activeDeposit.amount))
    : 0;
  const effectiveTotalDue = netTotalDue !== undefined ? netTotalDue : Math.max(0, runningTotal - appliedDeposit);

  // Priority 3d: GCash 13-digit format validation check
  const isGcashRequired = effectiveTotalDue > 0 && (paymentMethod === 'GCASH' || (paymentMethod === 'MIXED' && gcashAmount > 0));
  const isGcashFormatValid = !gcashRef.trim() || /^\d{13}$/.test(gcashRef.trim());
  const isGcashMissing = isGcashRequired && !gcashRef.trim();
  const isGcashFormatInvalid = isGcashRequired && Boolean(gcashRef.trim()) && !isGcashFormatValid;

  // Compute table discount amounts for this room tier and duration
  const seniorAmount = getDiscountAmountPesos('SENIOR', room.tier, rateSelected);
  const dcAmount = getDiscountAmountPesos('DC', room.tier, rateSelected);

  // Table rate card amounts for all available durations for this room tier
  const senior12Amount = getDiscountAmountPesos('SENIOR', room.tier, '12h');
  const senior24Amount = getDiscountAmountPesos('SENIOR', room.tier, '24h');
  const dc3Amount = getDiscountAmountPesos('DC', room.tier, '3h');
  const dc12Amount = getDiscountAmountPesos('DC', room.tier, '12h');
  const dc24Amount = getDiscountAmountPesos('DC', room.tier, '24h');

  // Discount validation check: unmapped table combinations block discount checkout
  const isDiscountActive = discountType !== 'NONE';
  const isDiscountUnmapped = isDiscountActive && Boolean(discountUnconfiguredMessage);

  // Mixed split balance check
  const isMixedImbalanced = paymentMethod === 'MIXED' && effectiveTotalDue > 0 && Math.abs((cashAmount + gcashAmount) - effectiveTotalDue) >= 0.01;

  // Tendered amount validation
  const cashDue = paymentMethod === 'MIXED' ? cashAmount : effectiveTotalDue;
  const effectiveTendered = paymentMethod === 'CASH'
    ? (amountTendered || 0)
    : paymentMethod === 'MIXED'
    ? (amountTendered || 0)
    : effectiveTotalDue;

  const changeDue = (paymentMethod === 'CASH' || paymentMethod === 'MIXED')
    ? Math.max(0, effectiveTendered - cashDue)
    : 0;

  const isTenderedInsufficient = effectiveTotalDue > 0 && (
    paymentMethod === 'CASH'
      ? ((amountTendered || 0) < effectiveTotalDue || (amountTendered || 0) <= 0)
      : paymentMethod === 'MIXED'
      ? (cashAmount > 0 && ((amountTendered || 0) < cashAmount || (amountTendered || 0) <= 0))
      : false
  );

  const isForfeitMissingNote = effectiveResolution === 'forfeit' && Boolean(activeDeposit) && !effectiveNotes.trim();

  // Checkout is 100% selectable — no typing of code or ID required to check out
  // Discount-unmapped blocks checkout (mirrors server 400); GCash requires exact 13 digits.
  const isCheckoutDisabled = isSubmitting || isDiscountUnmapped || isGcashMissing || isGcashFormatInvalid || isMixedImbalanced || isTenderedInsufficient || isForfeitMissingNote;

  return (
    <>
      {/* Active Held Deposit Resolution Card */}
      {activeDeposit && activeDeposit.status === 'held' && (
        <div className="space-y-2.5 p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                <ShieldCheck size={16} />
              </div>
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-900 font-extrabold block">
                  Active Held Deposit
                </span>
                <span className="text-xs font-mono font-bold text-indigo-950">
                  Deposit #{activeDeposit.depositNumber}
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[9px] font-mono text-indigo-700 uppercase block">Held Amount</span>
              <span className="text-sm font-mono font-black text-indigo-900">
                ₱{activeDeposit.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Resolution Options */}
          <div className="space-y-1.5 pt-2 border-t border-indigo-200/60">
            <label className="text-[10px] font-mono uppercase font-bold text-indigo-900 block">
              Checkout Resolution Action
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => handleResolutionChange('apply')}
                className={`py-2 px-1.5 rounded-xl border text-center font-mono text-xs font-bold transition cursor-pointer ${
                  effectiveResolution === 'apply'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-white border-indigo-200 text-indigo-900 hover:bg-indigo-50'
                }`}
              >
                <div className="text-[10px] leading-tight">Apply to Bill</div>
                <div className="text-[8px] font-normal opacity-80 mt-0.5">Deduct ₱{Math.min(runningTotal, activeDeposit.amount).toFixed(0)}</div>
              </button>
              <button
                type="button"
                onClick={() => handleResolutionChange('refund')}
                className={`py-2 px-1.5 rounded-xl border text-center font-mono text-xs font-bold transition cursor-pointer ${
                  effectiveResolution === 'refund'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : 'bg-white border-emerald-200 text-emerald-900 hover:bg-emerald-50'
                }`}
              >
                <div className="text-[10px] leading-tight">Refund to Guest</div>
                <div className="text-[8px] font-normal opacity-80 mt-0.5">Return ₱{activeDeposit.amount.toFixed(0)}</div>
              </button>
              <button
                type="button"
                onClick={() => handleResolutionChange('forfeit')}
                className={`py-2 px-1.5 rounded-xl border text-center font-mono text-xs font-bold transition cursor-pointer ${
                  effectiveResolution === 'forfeit'
                    ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                    : 'bg-white border-rose-200 text-rose-900 hover:bg-rose-50'
                }`}
              >
                <div className="text-[10px] leading-tight">Forfeit</div>
                <div className="text-[8px] font-normal opacity-80 mt-0.5">Keep Deposit</div>
              </button>
            </div>

            {effectiveResolution === 'forfeit' && (
              <div className="pt-1.5 space-y-1">
                <label className="text-[9px] font-mono uppercase text-rose-800 font-bold block">
                  Forfeit Reason / Audit Notes <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={effectiveNotes}
                  onChange={(e) => handleNotesChange(e.target.value)}
                  placeholder="e.g. Room key lost / stained bedsheet / unpaid minibar"
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-rose-300 rounded-lg focus:outline-none focus:border-rose-500"
                />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3 pt-3 border-t border-secondary/30">
        <h3 className="font-display font-bold text-sm text-primary uppercase">
          Payment & Check-Out Method
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {(['CASH', 'GCASH', 'MIXED'] as const).map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => {
                setPaymentMethod(method);
                if (method === 'CASH') setGcashRef('');
              }}
              className={`py-2 rounded-xl text-xs font-mono font-bold tracking-wide uppercase transition border cursor-pointer flex items-center justify-center gap-1.5 ${
                paymentMethod === method
                  ? 'bg-primary border-primary text-white'
                  : 'bg-white border-secondary/40 text-charcoal/60 hover:bg-cream/40'
              }`}
            >
              <CreditCard size={13} />
              {method}
            </button>
          ))}
        </div>

        {/* Split amounts when MIXED is selected */}
        {paymentMethod === 'MIXED' && effectiveTotalDue > 0 && (
          <div className="space-y-2 p-3 bg-cream border border-secondary rounded-xl">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/50">Cash Portion</label>
                <input
                  type="number"
                  min={0}
                  max={effectiveTotalDue}
                  step="any"
                  value={cashAmount || ''}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    handleCashAmountChange(val);
                  }}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-secondary rounded-xl focus:outline-none focus:border-primary"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/50">GCash Portion</label>
                <input
                  type="number"
                  min={0}
                  max={effectiveTotalDue}
                  step="any"
                  value={gcashAmount || ''}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    handleGcashAmountChange(val);
                  }}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-secondary rounded-xl focus:outline-none focus:border-primary"
                />
              </div>
            </div>
            {isMixedImbalanced && (
              <p className="text-[10px] text-rose-600 font-mono flex items-center gap-1">
                <AlertCircle size={11} />
                Split sum (₱{(cashAmount + gcashAmount).toFixed(2)}) must equal ₱{effectiveTotalDue.toFixed(2)}
              </p>
            )}
          </div>
        )}

        {/* GCash Reference Input */}
        {effectiveTotalDue > 0 && (paymentMethod === 'GCASH' || (paymentMethod === 'MIXED' && gcashAmount > 0)) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="space-y-1 pt-1"
          >
            <label className="text-[10px] font-mono uppercase tracking-wider text-primary flex justify-between items-center font-bold">
              <span>GCash Transaction Ref <span className="text-rose-500 font-bold">*</span></span>
              <span className="text-[9px] text-charcoal/40 font-mono">13-digit number</span>
            </label>
            <input
              type="text"
              required
              maxLength={13}
              value={gcashRef}
              onChange={(e) => setGcashRef(e.target.value.replace(/\D/g, '').slice(0, 13))}
              placeholder="e.g. 1001234567890"
              className={`w-full px-3 py-2 text-xs font-mono bg-cream border rounded-xl focus:outline-none focus:ring-1 ${
                gcashRef && !isGcashFormatValid
                  ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-300'
                  : isGcashMissing
                  ? 'border-amber-400 focus:border-amber-500'
                  : 'border-secondary focus:border-primary focus:ring-primary/20'
              }`}
            />
            {isGcashMissing && (
              <p className="text-[10px] text-amber-600 font-sans flex items-center gap-1">
                <AlertCircle size={11} className="shrink-0" />
                <span>GCash transaction reference is required before checkout.</span>
              </p>
            )}
            {gcashRef && !isGcashFormatValid && (
              <p className="text-[10px] text-rose-600 font-sans flex items-center gap-1">
                <AlertCircle size={11} className="shrink-0" />
                <span>Reference must be exactly 13 digits (currently {gcashRef.length}/13).</span>
              </p>
            )}
          </motion.div>
        )}

        {/* Cash / Tendered & Live Change Section */}
        {effectiveTotalDue > 0 && (paymentMethod === 'CASH' || (paymentMethod === 'MIXED' && cashAmount > 0)) && (
          <div className="space-y-3 p-3.5 bg-cream/60 border border-secondary rounded-2xl">
            <div className="flex items-center justify-between">
              <label className="text-xs font-mono font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <Banknote size={15} />
                <span>Amount Tendered (Cash) <span className="text-rose-500">*</span></span>
              </label>
              <span className="text-[10px] font-mono text-charcoal/50">
                Due: ₱{(paymentMethod === 'MIXED' ? cashAmount : effectiveTotalDue).toFixed(2)}
              </span>
            </div>

            {/* Numeric Input */}
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono font-bold text-charcoal/50">
                ₱
              </span>
              <input
                type="number"
                min={0}
                step="any"
                placeholder="Enter cash received"
                value={amountTendered || ''}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  if (handleAmountTenderedChange) handleAmountTenderedChange(val);
                }}
                className={`w-full pl-8 pr-4 py-2.5 text-sm font-mono font-bold bg-white border rounded-xl focus:outline-none focus:ring-2 ${
                  isTenderedInsufficient
                    ? 'border-amber-400 focus:border-amber-500 focus:ring-amber-200'
                    : 'border-secondary/60 focus:border-primary focus:ring-primary/20'
                }`}
              />
            </div>

            {/* Quick Tender Buttons */}
            <div className="space-y-1">
              <div className="text-[10px] font-mono text-charcoal/50 uppercase font-semibold">
                Quick Tender Buttons
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const exact = paymentMethod === 'MIXED' ? cashAmount : effectiveTotalDue;
                    if (handleAmountTenderedChange) handleAmountTenderedChange(exact);
                  }}
                  className="px-2.5 py-1.5 text-xs font-mono font-bold bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary rounded-xl transition cursor-pointer active:scale-95"
                >
                  Exact (₱{(paymentMethod === 'MIXED' ? cashAmount : effectiveTotalDue).toFixed(2)})
                </button>
                {[100, 200, 500, 1000].map((denom) => (
                  <button
                    key={denom}
                    type="button"
                    onClick={() => {
                      if (handleAmountTenderedChange) handleAmountTenderedChange(denom);
                    }}
                    className="px-2.5 py-1.5 text-xs font-mono font-bold bg-white hover:bg-cream border border-secondary/60 text-charcoal rounded-xl transition cursor-pointer active:scale-95 shadow-2xs"
                  >
                    ₱{denom.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>

            {/* Live Calculation Display */}
            <div className="p-3 bg-white border border-secondary/50 rounded-xl space-y-2 font-mono text-xs">
              <div className="flex justify-between items-center text-charcoal/70">
                <span>Total Cash Due:</span>
                <span className="font-bold">₱{(paymentMethod === 'MIXED' ? cashAmount : effectiveTotalDue).toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-charcoal/70">
                <span>Cash Tendered:</span>
                <span className="font-bold text-primary">₱{(amountTendered || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-secondary/40">
                <span className="font-bold uppercase tracking-wider text-xs">CHANGE:</span>
                <span className={`text-xl font-black ${
                  changeDue > 0 ? 'text-emerald-700' : 'text-charcoal'
                }`}>
                  ₱{changeDue.toFixed(2)}
                </span>
              </div>
            </div>

            {isTenderedInsufficient && (
              <p className="text-[11px] text-rose-600 font-mono flex items-center gap-1.5 bg-rose-50 border border-rose-200 p-2 rounded-xl">
                <AlertCircle size={13} className="shrink-0" />
                <span>
                  Tendered cash (₱{(amountTendered || 0).toFixed(2)}) is less than total due (₱{cashDue.toFixed(2)}). Need ₱{(cashDue - (amountTendered || 0)).toFixed(2)} more.
                </span>
              </p>
            )}
          </div>
        )}

        {/* Full deposit coverage note */}
        {effectiveTotalDue === 0 && activeDeposit && effectiveResolution === 'apply' && (
          <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl space-y-1 font-mono text-xs text-emerald-950">
            <div className="flex items-center gap-1.5 font-bold">
              <ShieldCheck size={14} className="text-emerald-600" />
              <span>Full Balance Covered by Security Deposit</span>
            </div>
            <p className="text-[11px] font-sans text-emerald-800">
              No additional cash or electronic payment required. The guest's security deposit covers the total account.
            </p>
          </div>
        )}

        {/* GCash non-cash live display */}
        {paymentMethod === 'GCASH' && effectiveTotalDue > 0 && (
          <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-xl space-y-1 font-mono text-xs text-blue-900">
            <div className="flex justify-between">
              <span>Total Due:</span>
              <span className="font-bold">₱{effectiveTotalDue.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Amount Tendered:</span>
              <span className="font-bold">₱{effectiveTotalDue.toFixed(2)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-blue-200/60 font-bold">
              <span>CHANGE:</span>
              <span className="text-sm">₱0.00</span>
            </div>
          </div>
        )}
      </div>

      {/* Guest Discount */}
      <div className="space-y-2.5 pt-3 border-t border-secondary/30">
        <button
          type="button"
          onClick={() => setDiscountOpen((o) => !o)}
          aria-expanded={discountOpen}
          className="w-full flex items-center justify-between gap-3 cursor-pointer text-left bg-white border border-secondary/40 hover:border-primary/40 hover:bg-cream/20 p-3 rounded-xl transition"
        >
          <span className="font-display font-extrabold text-sm text-primary uppercase flex items-center gap-2">
            <UserCheck size={16} className="text-primary" />
            <span>Guest Discount</span>
          </span>
          <span className="flex items-center gap-2 shrink-0">
            <span className={`text-xs font-mono font-bold px-3 py-1 rounded-md border shadow-sm ${
              discountType === 'NONE'
                ? 'bg-slate-100 text-slate-600 border-slate-300'
                : 'bg-emerald-100 text-emerald-800 border-emerald-400'
            }`}>
              {discountSummary}
            </span>
            <ChevronDown size={16} className={`text-charcoal/60 transition-transform ${discountOpen ? 'rotate-180' : ''}`} />
          </span>
        </button>

        {discountOpen && (
        <>
        <p className="text-[10px] font-mono text-charcoal/50">
          Rate: <span className="font-bold text-primary">{formatStayDuration(rateSelected)}</span> (set above)
        </p>

        {/* Dropdown Selector */}
        <div className="relative">
          <label htmlFor="guest-discount-select" className="sr-only">
            Select Guest Discount
          </label>
          <select
            id="guest-discount-select"
            value={
              discountType === 'NONE'
                ? 'NONE'
                : `${discountType}_${rateSelected}`
            }
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'NONE') {
                if (onDiscountAndRateChange) {
                  onDiscountAndRateChange('NONE');
                } else {
                  setDiscountType('NONE');
                }
              } else if (val === 'SENIOR_12h') {
                if (onDiscountAndRateChange) {
                  onDiscountAndRateChange('SENIOR', '12h');
                } else {
                  setDiscountType('SENIOR');
                  if (setRateSelected && rateSelected !== '12h') setRateSelected('12h');
                }
              } else if (val === 'SENIOR_24h') {
                if (onDiscountAndRateChange) {
                  onDiscountAndRateChange('SENIOR', '24h');
                } else {
                  setDiscountType('SENIOR');
                  if (setRateSelected && rateSelected !== '24h') setRateSelected('24h');
                }
              } else if (val === 'DC_3h') {
                if (onDiscountAndRateChange) {
                  onDiscountAndRateChange('DC', '3h');
                } else {
                  setDiscountType('DC');
                  if (setRateSelected && rateSelected !== '3h') setRateSelected('3h');
                }
              } else if (val === 'DC_12h') {
                if (onDiscountAndRateChange) {
                  onDiscountAndRateChange('DC', '12h');
                } else {
                  setDiscountType('DC');
                  if (setRateSelected && rateSelected !== '12h') setRateSelected('12h');
                }
              } else if (val === 'DC_24h') {
                if (onDiscountAndRateChange) {
                  onDiscountAndRateChange('DC', '24h');
                } else {
                  setDiscountType('DC');
                  if (setRateSelected && rateSelected !== '24h') setRateSelected('24h');
                }
              }
            }}
            className="w-full appearance-none px-3.5 py-2.5 text-xs font-mono font-bold bg-white border border-secondary/50 rounded-xl text-charcoal shadow-sm hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary pr-9 cursor-pointer transition"
          >
            <option value="NONE">
              No Discount (Standard Stay Rate)
            </option>
            <option value="SENIOR_12h" disabled={senior12Amount === null}>
              Senior / PWD 12HR ({senior12Amount !== null ? `-₱${senior12Amount.toFixed(2)}` : 'N/A'})
            </option>
            <option value="SENIOR_24h" disabled={senior24Amount === null}>
              Senior / PWD 24HR ({senior24Amount !== null ? `-₱${senior24Amount.toFixed(2)}` : 'N/A'})
            </option>
            <option value="DC_3h" disabled={dc3Amount === null}>
              Discount Card (DC) 3HR ({dc3Amount !== null ? `-₱${dc3Amount.toFixed(2)}` : 'N/A'})
            </option>
            <option value="DC_12h" disabled={dc12Amount === null}>
              Discount Card (DC) 12HR ({dc12Amount !== null ? `-₱${dc12Amount.toFixed(2)}` : 'N/A'})
            </option>
            <option value="DC_24h" disabled={dc24Amount === null}>
              Discount Card (DC) 24HR ({dc24Amount !== null ? `-₱${dc24Amount.toFixed(2)}` : 'N/A'})
            </option>
          </select>
          <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-charcoal/50 pointer-events-none" />
        </div>

        {/* Dedicated 1-Tap Buttons for Cashier Quick Navigation */}
        <div className="space-y-2">
          {/* No Discount Button */}
          <button
            type="button"
            onClick={() => {
              if (onDiscountAndRateChange) {
                onDiscountAndRateChange('NONE');
              } else {
                setDiscountType('NONE');
              }
            }}
            className={`w-full py-2 px-3 rounded-xl border-2 transition cursor-pointer flex items-center justify-between text-left ${
              discountType === 'NONE'
                ? 'bg-primary/5 border-primary text-primary shadow-xs font-bold'
                : 'bg-white border-secondary/40 hover:border-secondary text-charcoal/70'
            }`}
          >
            <span className="text-xs font-bold">Standard Rate (No Discount)</span>
            <span className="text-[10px] font-mono text-charcoal/40 font-semibold">₱0.00 deduction</span>
          </button>

          {/* Senior / PWD Rate Buttons */}
          <div className="space-y-1">
            <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-800 font-extrabold flex items-center gap-1">
              <UserCheck size={11} className="text-emerald-600" />
              <span>Senior / PWD Rate Buttons</span>
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={senior12Amount === null}
                onClick={() => {
                  if (discountType === 'SENIOR' && rateSelected === '12h') {
                    if (onDiscountAndRateChange) {
                      onDiscountAndRateChange('NONE');
                    } else {
                      setDiscountType('NONE');
                    }
                  } else {
                    if (onDiscountAndRateChange) {
                      onDiscountAndRateChange('SENIOR', '12h');
                    } else {
                      setDiscountType('SENIOR');
                      if (setRateSelected && rateSelected !== '12h') setRateSelected('12h');
                    }
                  }
                }}
                className={`p-2.5 rounded-xl border-2 transition flex flex-col justify-between text-left ${
                  senior12Amount === null
                    ? 'opacity-40 bg-stone-100 border-secondary/30 text-charcoal/40 cursor-not-allowed'
                    : discountType === 'SENIOR' && rateSelected === '12h'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-900 shadow-sm ring-1 ring-emerald-400 cursor-pointer'
                    : 'bg-white border-secondary/40 hover:border-secondary text-charcoal/70 cursor-pointer'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="text-[11px] font-bold">Senior / PWD 12HR</span>
                  <UserCheck size={13} className={senior12Amount === null ? 'text-charcoal/30' : discountType === 'SENIOR' && rateSelected === '12h' ? 'text-emerald-600' : 'text-charcoal/40'} />
                </div>
                <span className={`text-xs font-mono font-extrabold ${
                  senior12Amount === null ? 'text-charcoal/40' : discountType === 'SENIOR' && rateSelected === '12h' ? 'text-emerald-700' : 'text-emerald-800'
                }`}>
                  {senior12Amount !== null ? `-₱${senior12Amount.toFixed(2)}` : 'N/A'}
                </span>
              </button>

              <button
                type="button"
                disabled={senior24Amount === null}
                onClick={() => {
                  if (discountType === 'SENIOR' && rateSelected === '24h') {
                    if (onDiscountAndRateChange) {
                      onDiscountAndRateChange('NONE');
                    } else {
                      setDiscountType('NONE');
                    }
                  } else {
                    if (onDiscountAndRateChange) {
                      onDiscountAndRateChange('SENIOR', '24h');
                    } else {
                      setDiscountType('SENIOR');
                      if (setRateSelected && rateSelected !== '24h') setRateSelected('24h');
                    }
                  }
                }}
                className={`p-2.5 rounded-xl border-2 transition flex flex-col justify-between text-left ${
                  senior24Amount === null
                    ? 'opacity-40 bg-stone-100 border-secondary/30 text-charcoal/40 cursor-not-allowed'
                    : discountType === 'SENIOR' && rateSelected === '24h'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-900 shadow-sm ring-1 ring-emerald-400 cursor-pointer'
                    : 'bg-white border-secondary/40 hover:border-secondary text-charcoal/70 cursor-pointer'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="text-[11px] font-bold">Senior / PWD 24HR</span>
                  <UserCheck size={13} className={senior24Amount === null ? 'text-charcoal/30' : discountType === 'SENIOR' && rateSelected === '24h' ? 'text-emerald-600' : 'text-charcoal/40'} />
                </div>
                <span className={`text-xs font-mono font-extrabold ${
                  senior24Amount === null ? 'text-charcoal/40' : discountType === 'SENIOR' && rateSelected === '24h' ? 'text-emerald-700' : 'text-emerald-800'
                }`}>
                  {senior24Amount !== null ? `-₱${senior24Amount.toFixed(2)}` : 'N/A'}
                </span>
              </button>
            </div>
          </div>

          {/* Discount Card (DC) Rate Buttons */}
          <div className="space-y-1">
            <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-800 font-extrabold flex items-center gap-1">
              <CreditCard size={11} className="text-emerald-600" />
              <span>Discount Card (DC) Rate Buttons</span>
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                disabled={dc3Amount === null}
                onClick={() => {
                  if (discountType === 'DC' && rateSelected === '3h') {
                    if (onDiscountAndRateChange) {
                      onDiscountAndRateChange('NONE');
                    } else {
                      setDiscountType('NONE');
                    }
                  } else {
                    if (onDiscountAndRateChange) {
                      onDiscountAndRateChange('DC', '3h');
                    } else {
                      setDiscountType('DC');
                      if (setRateSelected && rateSelected !== '3h') setRateSelected('3h');
                    }
                  }
                }}
                className={`p-2 rounded-xl border-2 transition flex flex-col justify-between text-left ${
                  dc3Amount === null
                    ? 'opacity-40 bg-stone-100 border-secondary/30 text-charcoal/40 cursor-not-allowed'
                    : discountType === 'DC' && rateSelected === '3h'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-900 shadow-sm ring-1 ring-emerald-400 cursor-pointer'
                    : 'bg-white border-secondary/40 hover:border-secondary text-charcoal/70 cursor-pointer'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-0.5">
                  <span className="text-[10px] font-bold">DC 3HR</span>
                  <CreditCard size={11} className={dc3Amount === null ? 'text-charcoal/30' : discountType === 'DC' && rateSelected === '3h' ? 'text-emerald-600' : 'text-charcoal/40'} />
                </div>
                <span className={`text-[10px] font-mono font-extrabold ${dc3Amount === null ? 'text-charcoal/40' : 'text-emerald-700'}`}>
                  {dc3Amount !== null ? `-₱${dc3Amount.toFixed(2)}` : 'N/A'}
                </span>
              </button>

              <button
                type="button"
                disabled={dc12Amount === null}
                onClick={() => {
                  if (discountType === 'DC' && rateSelected === '12h') {
                    if (onDiscountAndRateChange) {
                      onDiscountAndRateChange('NONE');
                    } else {
                      setDiscountType('NONE');
                    }
                  } else {
                    if (onDiscountAndRateChange) {
                      onDiscountAndRateChange('DC', '12h');
                    } else {
                      setDiscountType('DC');
                      if (setRateSelected && rateSelected !== '12h') setRateSelected('12h');
                    }
                  }
                }}
                className={`p-2 rounded-xl border-2 transition flex flex-col justify-between text-left ${
                  dc12Amount === null
                    ? 'opacity-40 bg-stone-100 border-secondary/30 text-charcoal/40 cursor-not-allowed'
                    : discountType === 'DC' && rateSelected === '12h'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-900 shadow-sm ring-1 ring-emerald-400 cursor-pointer'
                    : 'bg-white border-secondary/40 hover:border-secondary text-charcoal/70 cursor-pointer'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-0.5">
                  <span className="text-[10px] font-bold">DC 12HR</span>
                  <CreditCard size={11} className={dc12Amount === null ? 'text-charcoal/30' : discountType === 'DC' && rateSelected === '12h' ? 'text-emerald-600' : 'text-charcoal/40'} />
                </div>
                <span className={`text-[10px] font-mono font-extrabold ${dc12Amount === null ? 'text-charcoal/40' : 'text-emerald-700'}`}>
                  {dc12Amount !== null ? `-₱${dc12Amount.toFixed(2)}` : 'N/A'}
                </span>
              </button>

              <button
                type="button"
                disabled={dc24Amount === null}
                onClick={() => {
                  if (discountType === 'DC' && rateSelected === '24h') {
                    if (onDiscountAndRateChange) {
                      onDiscountAndRateChange('NONE');
                    } else {
                      setDiscountType('NONE');
                    }
                  } else {
                    if (onDiscountAndRateChange) {
                      onDiscountAndRateChange('DC', '24h');
                    } else {
                      setDiscountType('DC');
                      if (setRateSelected && rateSelected !== '24h') setRateSelected('24h');
                    }
                  }
                }}
                className={`p-2 rounded-xl border-2 transition flex flex-col justify-between text-left ${
                  dc24Amount === null
                    ? 'opacity-40 bg-stone-100 border-secondary/30 text-charcoal/40 cursor-not-allowed'
                    : discountType === 'DC' && rateSelected === '24h'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-900 shadow-sm ring-1 ring-emerald-400 cursor-pointer'
                    : 'bg-white border-secondary/40 hover:border-secondary text-charcoal/70 cursor-pointer'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-0.5">
                  <span className="text-[10px] font-bold">DC 24HR</span>
                  <CreditCard size={11} className={dc24Amount === null ? 'text-charcoal/30' : discountType === 'DC' && rateSelected === '24h' ? 'text-emerald-600' : 'text-charcoal/40'} />
                </div>
                <span className={`text-[10px] font-mono font-extrabold ${dc24Amount === null ? 'text-charcoal/40' : 'text-emerald-700'}`}>
                  {dc24Amount !== null ? `-₱${dc24Amount.toFixed(2)}` : 'N/A'}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Unconfigured Gap Alert */}
        {discountType !== 'NONE' && discountUnconfiguredMessage && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 space-y-1"
          >
            <div className="flex items-center gap-1.5 font-bold text-xs">
              <AlertCircle size={14} className="shrink-0 text-amber-600" />
              <span>Discount Not Configured</span>
            </div>
            <p className="text-[10px] text-amber-800 font-sans leading-relaxed">
              {discountUnconfiguredMessage}
            </p>
          </motion.div>
        )}

        {/* Active Discount Confirmation & Optional Reference Field */}
        {discountType !== 'NONE' && !discountUnconfiguredMessage && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2 p-3 bg-emerald-50/70 border border-emerald-300/70 rounded-xl"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                <UserCheck size={14} className="text-emerald-600" />
                <span>{discountType === 'DC' ? 'Discount Card Applied' : 'Senior / PWD Discount Applied'}</span>
              </span>
              <span className="text-xs font-mono font-extrabold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-lg border border-emerald-300">
                -₱{discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="space-y-1 pt-1 border-t border-emerald-200/60">
              <div className="flex items-center justify-between">
                <label htmlFor="discount-id-ref" className="text-[10px] font-mono uppercase tracking-wider text-emerald-900 font-medium">
                  {discountType === 'DC' ? 'Card # / Member ID' : 'Senior / PWD ID #'}
                </label>
                <span className="text-[9px] text-charcoal/50 font-mono">
                  Optional Reference
                </span>
              </div>
              <input
                id="discount-id-ref"
                type="text"
                value={discountIdRef}
                onChange={(e) => setDiscountIdRef(e.target.value)}
                onBlur={onDiscountIdRefBlur}
                placeholder={discountType === 'DC' ? 'e.g. DC-2026-9876 (optional)' : 'e.g. SC-1234 or PWD-7890 (optional)'}
                className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-emerald-200 rounded-lg focus:outline-none focus:ring-1 focus:border-emerald-400 focus:ring-emerald-300 placeholder:text-charcoal/30"
              />
              <p className="text-[9px] text-emerald-700/80 font-sans">
                No code required to apply discount. Reference ID will appear on receipt if entered.
              </p>
            </div>
          </motion.div>
        )}
        </>
        )}
      </div>

      {/* Bill summary and check out action */}
      <div className="bg-primary/5 border border-primary/10 rounded-2xl p-4 space-y-2.5 font-mono text-xs text-primary">
        <div className="flex justify-between items-center">
          <span>Base Rent Charge ({formatStayDuration(rateSelected)})</span>
          <span>₱{baseRate.toLocaleString()}</span>
        </div>
        {discountAmount > 0 && discountType !== 'NONE' && (
          <div className="flex justify-between text-emerald-700 font-semibold">
            <span>{discountType === 'DC' ? 'Discount Card (DC)' : 'Senior / PWD Discount'}</span>
            <span>-₱{discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        )}
        {bedsCharge > 0 && (
          <div className="flex justify-between">
            <span>Extra Beds ({extraBeds} pcs)</span>
            <span>₱{bedsCharge.toLocaleString()}</span>
          </div>
        )}
        {towelsCharge > 0 && (
          <div className="flex justify-between">
            <span>Extra Towels ({towelSets} sets)</span>
            <span>₱{towelsCharge.toLocaleString()}</span>
          </div>
        )}
        {extraPersonCharge > 0 && (
          <div className="flex justify-between">
            <span>Extra Person Fee ({extraGuests} extra pax)</span>
            <span>₱{extraPersonCharge.toLocaleString()}</span>
          </div>
        )}
        {foodCharge > 0 && (
          <div className="flex justify-between font-medium">
            <span>Room Service & Extra Charges</span>
            <span>₱{foodCharge.toLocaleString()}</span>
          </div>
        )}
        {excessHoursCharge > 0 && (
          <div className="flex justify-between text-rose-700 font-semibold bg-rose-50/80 p-2 rounded-lg border border-rose-200">
            <span>Excess Stay Surcharge (+{excessHours} hr{excessHours === 1 ? '' : 's'} @ ₱130/hr)</span>
            <span>+₱{excessHoursCharge.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        )}
        {appliedDeposit > 0 && effectiveResolution === 'apply' && (
          <div className="flex justify-between text-indigo-700 font-bold bg-indigo-50/80 p-2 rounded-lg border border-indigo-200">
            <span>Security Deposit Applied ({activeDeposit?.depositNumber})</span>
            <span>-₱{appliedDeposit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-primary/20 pt-2 font-display font-extrabold text-lg tracking-tight text-primary">
          <span>{appliedDeposit > 0 ? 'Net Total Due' : 'Account Total'}</span>
          <span>₱{effectiveTotalDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        {excessDepositRefund > 0 && effectiveResolution === 'apply' && (
          <div className="flex justify-between text-emerald-800 font-bold bg-emerald-50 p-2 rounded-lg border border-emerald-300 text-xs">
            <span>Excess Deposit Refund to Guest:</span>
            <span>₱{excessDepositRefund.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        )}
      </div>

      {showFooterActions && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 bg-white hover:bg-cream/40 border border-secondary text-charcoal font-sans text-xs font-bold py-3.5 rounded-xl cursor-pointer transition text-center active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Go Back
          </button>
          {onPrePrintBill && (
            <button
              type="button"
              onClick={onPrePrintBill}
              disabled={isSubmitting}
              className="flex-1 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 font-sans text-xs font-bold py-3.5 rounded-xl cursor-pointer transition text-center active:scale-[0.98] flex items-center justify-center gap-1.5 shadow-2xs"
              title="Pre-Print Transaction Finalized receipt before checkout"
            >
              <Printer size={14} className="text-amber-700" />
              <span>Pre-Print</span>
            </button>
          )}
          {onGatePass && (
            <button
              type="button"
              onClick={onGatePass}
              disabled={isSubmitting}
              className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-sans text-xs font-bold py-3.5 rounded-xl cursor-pointer transition text-center active:scale-[0.98] flex items-center justify-center gap-1.5 shadow-sm"
              title="Print Gate Pass for exit security clearance"
            >
              <Ticket size={14} className="text-amber-400" />
              <span>Gate Pass</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCheckOut}
            disabled={isCheckoutDisabled}
            className="flex-[2] bg-primary hover:bg-primary-light disabled:bg-charcoal/30 text-white font-sans text-xs font-bold py-3.5 rounded-xl cursor-pointer disabled:cursor-not-allowed transition shadow-md shadow-primary/5 hover:shadow-primary/15 flex items-center justify-center gap-2 active:scale-[0.98]"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Processing Check-Out...</span>
              </>
            ) : (
              <>
                <span>Check Out Guest</span>
                <ChevronRight size={14} />
              </>
            )}
          </button>
        </div>
      )}

      {/* Force Check-Out Trigger Button */}
      {showFooterActions && onRequestForceCheckout && (
        <div className="pt-2 border-t border-secondary/30 text-center">
          <button
            type="button"
            onClick={onRequestForceCheckout}
            className="w-full py-2.5 px-3 rounded-xl border border-rose-200 bg-rose-50/50 hover:bg-rose-100/70 text-rose-700 font-mono text-[11px] font-bold flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-[0.98]"
          >
            <ShieldAlert size={13} className="text-rose-600" />
            <span>
              {role === 'admin' || role === 'owner' ? 'Direct Force Check-Out (Admin Override)' : 'Request Force Check-Out (Admin Escalation)'}
            </span>
          </button>
        </div>
      )}
    </>
  );
};
