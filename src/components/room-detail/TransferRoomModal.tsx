import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Room, getTierDisplayName } from '../../types';
import { ArrowRightLeft, X, AlertTriangle, Check, ShieldCheck, Sparkles, Clock, Utensils, Bed, Bath, ArrowRight } from 'lucide-react';
import { transferRoom } from '../../api/rooms';
import { useToast } from '../ui/Toast';
import { formatStayDuration } from '../../utils/pricing';
import { useModalEscape } from '../../hooks/useModalEscape';

interface TransferRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceRoom: Room;
  allRooms: Room[];
  onTransferSuccess: (sourceRoom: Room, targetRoom: Room) => void;
}

const COMMON_TRANSFER_REASONS = [
  'Aircon / Cooling Malfunction',
  'Plumbing / Low Water Pressure',
  'Guest Requested Upgrade',
  'Noise / External Disturbance',
  'Electrical / Lighting Issue',
  'Frontdesk Operational Reassignment',
];

export const TransferRoomModal: React.FC<TransferRoomModalProps> = ({
  isOpen,
  onClose,
  sourceRoom,
  allRooms,
  onTransferSuccess,
}) => {
  const toast = useToast();
  const [targetRoomNumber, setTargetRoomNumber] = useState<string>('');
  const [selectedReason, setSelectedReason] = useState<string>(COMMON_TRANSFER_REASONS[0]);
  const [customReason, setCustomReason] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useModalEscape(isOpen, onClose, !isSubmitting);

  if (!isOpen) return null;

  // Filter available candidate target rooms (available, not current room, not staff house)
  const candidateRooms = allRooms.filter(
    (r) =>
      r.number !== sourceRoom.number &&
      r.state === 'available' &&
      !r.isStaffHouse &&
      r.roomType !== 'Staff House' &&
      r.number !== '12'
  );

  const selectedTargetRoom = allRooms.find((r) => r.number === targetRoomNumber);
  const effectiveReason = selectedReason === 'Other / Custom' ? customReason.trim() : selectedReason;
  const chargedFoodCount = (sourceRoom.chargedFood || []).reduce((acc, f) => acc + f.quantity, 0);

  const handleConfirmTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetRoomNumber) {
      toast.warning('Select Target Room', 'Please select an available room to transfer this guest to.');
      return;
    }
    if (!effectiveReason) {
      toast.warning('Reason Required', 'Please select or provide a reason for the room transfer.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await transferRoom({
        sourceRoomNumber: sourceRoom.number,
        targetRoomNumber,
        reason: effectiveReason,
        notes: notes.trim() || undefined,
      });

      if (res.success) {
        toast.success(
          'Room Transfer Completed',
          `Guest "${sourceRoom.guestName || 'Guest'}" successfully moved from Room ${sourceRoom.number} to Room ${targetRoomNumber}.`
        );
        onTransferSuccess(res.sourceRoom, res.targetRoom);
        onClose();
      } else {
        toast.error('Transfer Failed', res.message || 'Could not complete room transfer.');
      }
    } catch (err: any) {
      console.error('Room transfer error:', err);
      toast.error('Transfer Error', err.message || 'An unexpected error occurred during room transfer.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-room-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="bg-[#f7f5f2] rounded-3xl border border-secondary/60 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col my-auto max-h-[94vh]"
        >
          {/* Header */}
          <div className="bg-white p-5 md:p-6 border-b border-secondary/50 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center justify-center shadow-xs">
                <ArrowRightLeft size={20} />
              </div>
              <div>
                <h2 id="transfer-room-title" className="font-display font-black text-lg text-charcoal tracking-tight">
                  Transfer Guest to Another Room
                </h2>
                <p className="text-xs text-charcoal/60 font-mono mt-0.5">
                  Relocate Room {sourceRoom.number} ({sourceRoom.guestName || 'Active Guest'})
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-charcoal/50 hover:text-charcoal hover:bg-slate-100 rounded-xl transition cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Form Scroll Body */}
          <form onSubmit={handleConfirmTransfer} className="flex-1 overflow-y-auto p-5 md:p-6 space-y-5">
            {/* Source → Target Visual Banner */}
            <div className="bg-white p-4 rounded-2xl border border-secondary/70 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
              {/* Source Room Info */}
              <div className="flex-1 bg-cream/30 p-3 rounded-xl border border-secondary/40 space-y-1 w-full sm:w-auto">
                <span className="text-[10px] font-mono uppercase font-bold text-rose-800 block">
                  Current Room (Source)
                </span>
                <div className="font-display font-black text-base text-charcoal">
                  Room {sourceRoom.number}
                </div>
                <div className="text-[11px] font-mono text-charcoal/70">
                  {sourceRoom.roomType} • {getTierDisplayName(sourceRoom.tier)}
                </div>
                <div className="text-[11px] font-bold text-primary font-mono pt-0.5">
                  Guest: {sourceRoom.guestName || 'Active Guest'}
                </div>
              </div>

              <div className="p-2 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0">
                <ArrowRight size={18} />
              </div>

              {/* Target Room Info */}
              <div className="flex-1 bg-cream/30 p-3 rounded-xl border border-secondary/40 space-y-1 w-full sm:w-auto">
                <span className="text-[10px] font-mono uppercase font-bold text-emerald-800 block">
                  New Room (Destination)
                </span>
                <div className="font-display font-black text-base text-charcoal">
                  {selectedTargetRoom ? `Room ${selectedTargetRoom.number}` : 'None Selected'}
                </div>
                <div className="text-[11px] font-mono text-charcoal/70">
                  {selectedTargetRoom ? `${selectedTargetRoom.roomType} • ${getTierDisplayName(selectedTargetRoom.tier)}` : 'Select available room below'}
                </div>
                <div className="text-[11px] font-bold text-emerald-700 font-mono pt-0.5">
                  {selectedTargetRoom ? `Status: ${selectedTargetRoom.state.toUpperCase()}` : '—'}
                </div>
              </div>
            </div>

            {/* Target Room Selector */}
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-charcoal/70 flex items-center justify-between">
                <span>Select Destination Room (Available)</span>
                <span className="text-[11px] font-normal text-charcoal/50">
                  {candidateRooms.length} room(s) available
                </span>
              </label>

              {candidateRooms.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-48 overflow-y-auto p-1 bg-white rounded-2xl border border-secondary/60">
                  {candidateRooms.map((rm) => {
                    const isSelected = targetRoomNumber === rm.number;
                    return (
                      <button
                        key={rm.number}
                        type="button"
                        onClick={() => setTargetRoomNumber(rm.number)}
                        className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                            : 'bg-cream/10 border-secondary/50 text-charcoal hover:bg-cream/40'
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <span className="font-display font-black text-sm">
                            {rm.number}
                          </span>
                          <span
                            className={`text-[9px] font-mono px-1 py-0.2 rounded font-bold uppercase ${
                              isSelected ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {rm.state}
                          </span>
                        </div>
                        <div className={`text-[10px] font-mono truncate mt-1 ${isSelected ? 'text-indigo-100' : 'text-charcoal/60'}`}>
                          {rm.roomType}
                        </div>
                        <div className={`text-[9px] font-mono mt-0.5 ${isSelected ? 'text-white font-bold' : 'text-primary'}`}>
                          Floor {rm.floor}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-center text-amber-900 font-mono text-xs">
                  No available rooms found to transfer this guest.
                </div>
              )}
            </div>

            {/* Reason for Transfer */}
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-charcoal/70 block">
                Reason for Room Transfer <span className="text-rose-600">*</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_TRANSFER_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setSelectedReason(r);
                      setCustomReason('');
                    }}
                    className={`text-[11px] font-mono px-3 py-1.5 rounded-xl border transition cursor-pointer ${
                      selectedReason === r
                        ? 'bg-primary text-white border-primary font-bold shadow-xs'
                        : 'bg-white border-secondary/60 text-charcoal/70 hover:bg-cream/40'
                    }`}
                  >
                    {r}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSelectedReason('Other / Custom')}
                  className={`text-[11px] font-mono px-3 py-1.5 rounded-xl border transition cursor-pointer ${
                    selectedReason === 'Other / Custom'
                      ? 'bg-primary text-white border-primary font-bold shadow-xs'
                      : 'bg-white border-secondary/60 text-charcoal/70 hover:bg-cream/40'
                  }`}
                >
                  Other / Custom Reason
                </button>
              </div>

              {selectedReason === 'Other / Custom' && (
                <input
                  type="text"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Specify reason for room transfer..."
                  className="w-full px-3.5 py-2.5 bg-white border border-secondary rounded-xl text-xs font-mono text-charcoal outline-none focus:border-primary mt-1.5"
                />
              )}
            </div>

            {/* Additional Operator Notes */}
            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase font-bold text-charcoal/70 block">
                Internal Remarks / Staff Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="e.g. Guest moved immediately; Room 101 released back to available."
                className="w-full px-3.5 py-2 bg-white border border-secondary rounded-xl text-xs font-mono text-charcoal outline-none focus:border-primary resize-none"
              />
            </div>

            {/* What Will Transfer - Summary Checklist */}
            <div className="bg-white p-4 rounded-2xl border border-secondary/60 shadow-xs space-y-2.5 text-xs font-mono">
              <div className="text-[11px] font-bold uppercase text-charcoal/60 flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-emerald-700" />
                <span>Automatic Ledger & Stay Migration Details:</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-charcoal/80 text-[11px]">
                <div className="flex items-center gap-2">
                  <Check size={13} className="text-emerald-700 shrink-0" />
                  <span>Stay: {formatStayDuration(sourceRoom.rateSelected, sourceRoom.customHours)} (Check-in time retained)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check size={13} className="text-emerald-700 shrink-0" />
                  <span>Food Tab: {chargedFoodCount} item(s) transferred</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check size={13} className="text-emerald-700 shrink-0" />
                  <span>Extras: {sourceRoom.extraBeds} Bed(s) / {sourceRoom.towelSets} Towel(s)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check size={13} className="text-emerald-700 shrink-0" />
                  <span>Old Room {sourceRoom.number} marked as <b>Available</b></span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="w-full sm:w-auto px-5 py-3 rounded-xl border border-secondary text-charcoal/80 font-sans text-xs font-bold hover:bg-cream/40 transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !targetRoomNumber || candidateRooms.length === 0}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-sans text-xs font-bold transition cursor-pointer shadow-md shadow-indigo-900/10 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Executing Transfer...</span>
                  </>
                ) : (
                  <>
                    <ArrowRightLeft size={14} />
                    <span>Confirm & Relocate Guest</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
