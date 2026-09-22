import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Room, ForceCheckoutReason, ForceCheckoutResolution } from '../types';
import { X, ShieldAlert, AlertTriangle, Send, CheckCircle2, UserX, Clock, Scale, Siren, RefreshCw, Loader2 } from 'lucide-react';
import { submitForceCheckoutRequest, directForceCheckoutOverride } from '../api/force-checkout';
import { formatStayDuration } from '../utils/pricing';

interface ForceCheckoutModalProps {
  room: Room;
  role: string;
  loggedInUser: string;
  uncollectedAmount: number;
  billedBreakdown: Array<{ description: string; subtext?: string; amount: number }>;
  onClose: () => void;
  onSuccess: () => void;
}

const REASONS: Array<{
  key: ForceCheckoutReason;
  label: string;
  desc: string;
  icon: React.ReactNode;
}> = [
  {
    key: 'skip_out',
    label: 'Guest Skipped Out / Non-Payment',
    desc: 'Guest departed premises without settling room rent or orders.',
    icon: <UserX size={15} className="text-rose-600" />,
  },
  {
    key: 'overstay_unreachable',
    label: 'Overstay & Unreachable (Abandoned)',
    desc: 'Guest exceeded stay duration and is not responding to calls/knocks.',
    icon: <Clock size={15} className="text-amber-600" />,
  },
  {
    key: 'disputed_bill',
    label: 'Disputed Billing / Unsettled Charges',
    desc: 'Unresolvable customer dispute requiring manager write-off.',
    icon: <Scale size={15} className="text-indigo-600" />,
  },
  {
    key: 'emergency_eviction',
    label: 'Emergency / Property Damage / Eviction',
    desc: 'Immediate room clearance required due to rule violation or damage.',
    icon: <Siren size={15} className="text-red-700" />,
  },
  {
    key: 'system_error',
    label: 'System Desync / Accidental Occupancy',
    desc: 'Room was marked occupied mistakenly or guest checked out in previous shift.',
    icon: <RefreshCw size={15} className="text-slate-600" />,
  },
  {
    key: 'other',
    label: 'Other Exceptional Incident',
    desc: 'Special case documented in incident explanation below.',
    icon: <ShieldAlert size={15} className="text-primary" />,
  },
];

export const ForceCheckoutModal: React.FC<ForceCheckoutModalProps> = ({
  room,
  role,
  loggedInUser,
  uncollectedAmount,
  billedBreakdown,
  onClose,
  onSuccess,
}) => {
  const isAdminOrOwner = role === 'admin' || role === 'owner';
  const [isDirectOverride, setIsDirectOverride] = useState(isAdminOrOwner);
  const [reason, setReason] = useState<ForceCheckoutReason>('skip_out');
  const [notes, setNotes] = useState('');
  const [resolutionType, setResolutionType] = useState<ForceCheckoutResolution>('loss_write_off');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notes.trim()) {
      setError('Please provide a brief incident explanation / notes for the audit trail.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      if (isAdminOrOwner && isDirectOverride) {
        // Direct admin force checkout
        await directForceCheckoutOverride({
          roomNumber: room.number,
          reason,
          adminNotes: notes.trim(),
          uncollectedAmount,
          billedBreakdown,
          resolutionType,
        });
      } else {
        // Cashier escalation request
        await submitForceCheckoutRequest({
          roomNumber: room.number,
          reason,
          cashierNotes: notes.trim(),
          uncollectedAmount,
          billedBreakdown,
        });
      }
      onSuccess();
    } catch (err: any) {
      console.error('Force checkout submission error:', err);
      setError(err.message || 'Failed to submit force checkout request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-charcoal/60 backdrop-blur-sm animate-fade-in">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-3xl shadow-2xl border border-secondary max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-5 bg-rose-50/70 border-b border-rose-200 flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-600 text-white flex items-center justify-center shadow-md shadow-rose-600/20">
              <ShieldAlert size={20} />
            </div>
            <div>
              <h3 className="font-display font-extrabold text-base text-rose-950">
                {isAdminOrOwner && isDirectOverride ? 'Direct Force Check-Out (Admin Override)' : 'Request Force Check-Out (Admin Escalation)'}
              </h3>
              <p className="text-xs text-rose-800/80 font-mono mt-0.5">
                Room {room.number} • {room.roomType || 'Standard'} • Guest: {room.guestName || 'Anonymous'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-charcoal/40 hover:text-charcoal hover:bg-white/80 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 text-xs font-sans">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Uncollected Bill Warning Banner */}
          <div className="p-3.5 bg-cream/40 rounded-2xl border border-secondary/60 space-y-2">
            <div className="flex justify-between items-center font-mono">
              <span className="text-charcoal/70 uppercase text-[11px] font-bold">Uncollected Bill Amount:</span>
              <span className="text-base font-display font-extrabold text-rose-700">
                ₱{uncollectedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="text-[10px] font-mono text-charcoal/50 border-t border-secondary/30 pt-1.5 flex justify-between">
              <span>Applied Stay: {formatStayDuration(room.rateSelected)}</span>
              <span>Logged Cashier: {loggedInUser}</span>
            </div>
          </div>

          {/* Admin Toggle (if admin is operating) */}
          {isAdminOrOwner && (
            <div className="flex rounded-xl bg-cream/30 p-1 border border-secondary/40">
              <button
                type="button"
                onClick={() => setIsDirectOverride(true)}
                className={`flex-1 py-1.5 text-xs font-mono font-bold rounded-lg transition cursor-pointer ${
                  isDirectOverride
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-charcoal/70 hover:text-charcoal'
                }`}
              >
                Direct Override (Now)
              </button>
              <button
                type="button"
                onClick={() => setIsDirectOverride(false)}
                className={`flex-1 py-1.5 text-xs font-mono font-bold rounded-lg transition cursor-pointer ${
                  !isDirectOverride
                    ? 'bg-primary text-white shadow-xs'
                    : 'text-charcoal/70 hover:text-charcoal'
                }`}
              >
                Send Request Queue
              </button>
            </div>
          )}

          {/* Incident Reason Selection */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono uppercase font-bold text-charcoal/70 block">
              Incident Reason <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto pr-1">
              {REASONS.map((r) => {
                const isSelected = reason === r.key;
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setReason(r.key)}
                    className={`p-2.5 rounded-xl border text-left flex items-start gap-2.5 transition cursor-pointer ${
                      isSelected
                        ? 'bg-rose-50/80 border-rose-400 ring-1 ring-rose-400'
                        : 'bg-white border-secondary/50 hover:bg-cream/20'
                    }`}
                  >
                    <div className="p-1 rounded-lg bg-white border border-secondary/30 shadow-2xs shrink-0 mt-0.5">
                      {r.icon}
                    </div>
                    <div className="flex-1">
                      <span className="font-bold text-charcoal block leading-tight text-xs">{r.label}</span>
                      <span className="text-[10px] text-charcoal/50 leading-relaxed block mt-0.5">{r.desc}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Direct Admin Resolution Type Selector */}
          {isAdminOrOwner && isDirectOverride && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase font-bold text-charcoal/70 block">
                Accounting Resolution Type
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'loss_write_off', label: 'Bad Debt / Loss Write-Off', desc: '₱0 cash, audited operational loss' },
                  { key: 'deposit_forfeit', label: 'Forfeit Room Deposit', desc: 'Cover from guest security deposit' },
                  { key: 'void_mistake', label: 'System Void (No Loss)', desc: 'Room was occupied by error' },
                  { key: 'manual_settle', label: 'Manual Settlement', desc: 'Resolved outside POS' },
                ].map((res) => (
                  <button
                    key={res.key}
                    type="button"
                    onClick={() => setResolutionType(res.key as ForceCheckoutResolution)}
                    className={`p-2 rounded-xl border text-left transition cursor-pointer ${
                      resolutionType === res.key
                        ? 'bg-primary/10 border-primary text-primary font-bold'
                        : 'bg-white border-secondary/40 text-charcoal/70'
                    }`}
                  >
                    <span className="text-[11px] font-bold block">{res.label}</span>
                    <span className="text-[9px] text-charcoal/50 block font-normal">{res.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Incident Explanation & Audit Notes */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono uppercase font-bold text-charcoal/70 flex justify-between items-center">
              <span>Incident Explanation & Notes <span className="text-rose-500">*</span></span>
              <span className="text-[9px] text-charcoal/40 font-normal font-sans">Recorded in audit log</span>
            </label>
            <textarea
              required
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Guest left keycard on frontdesk counter at 5:30 AM and walked out without paying..."
              className="w-full p-2.5 text-xs bg-cream/10 border border-secondary rounded-xl font-sans outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-300 resize-none"
            />
          </div>

          {/* Notice */}
          <div className="p-3 bg-amber-50/60 border border-amber-200/80 rounded-xl text-[10px] font-mono text-amber-900 leading-relaxed">
            <p className="font-bold flex items-center gap-1">
              <AlertTriangle size={12} className="text-amber-700 shrink-0" />
              <span>Auditing & Drawer Protection Notice:</span>
            </p>
            <p className="mt-0.5 text-charcoal/70">
              Force Check-Out frees Room {room.number} to cleaning status and records ₱0 cash collected to prevent drawer cash discrepancies.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2.5 pt-2 border-t border-secondary/40">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 bg-white hover:bg-cream/40 border border-secondary text-charcoal font-sans text-xs font-bold py-3 rounded-xl cursor-pointer transition text-center disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-[2] bg-rose-600 hover:bg-rose-700 text-white font-sans text-xs font-bold py-3 rounded-xl cursor-pointer transition shadow-md shadow-rose-600/10 flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Processing...</span>
                </>
              ) : isAdminOrOwner && isDirectOverride ? (
                <>
                  <ShieldAlert size={14} />
                  <span>Execute Direct Force Check-Out</span>
                </>
              ) : (
                <>
                  <Send size={14} />
                  <span>Submit Escalation to Admin</span>
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
