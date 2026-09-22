import React, { useState } from 'react';
import { Room } from '../../types';
import { Clock, Calendar, Edit3, Check, ShieldAlert, Printer, ArrowRightLeft, Ticket } from 'lucide-react';
import { formatStayDuration, getStayDurationHours, calculateExpectedCheckout, EXCESS_HOUR_RATE } from '../../utils/pricing';

interface OccupiedRoomViewProps {
  room: Room;
  rateSelected: Room['rateSelected'];
  setRateSelected?: (val: Room['rateSelected']) => void;
  getRateValue: (tier: Room['tier'], rateType: Room['rateSelected']) => number;
  checkInTime: string;
  setCheckInTime: (val: string) => void;
  onPrePrintBill?: () => void;
  onGatePass?: () => void;
  onTransferRoom?: () => void;
  customHours?: number;
  /** When true, the stay-rate block is hidden (rate is picked once via StayRatePicker). */
  hideStayRate?: boolean;
}

export const OccupiedRoomView: React.FC<OccupiedRoomViewProps> = ({
  room,
  rateSelected,
  setRateSelected,
  getRateValue,
  checkInTime,
  setCheckInTime,
  onPrePrintBill,
  onGatePass,
  onTransferRoom,
  customHours = 1,
  hideStayRate = false,
}) => {
  const [isEditingTime, setIsEditingTime] = useState(false);

  const formatDisplayTime = (val?: string) => {
    if (!val) return 'N/A';
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    }
    return val;
  };

  const stayHours = getStayDurationHours(rateSelected, customHours);

  return (
    <div className="bg-rose-50/20 border border-rose-200/50 rounded-2xl p-4 flex flex-col gap-3">
      {room.forceCheckoutPending && (
        <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl flex items-center gap-2 text-amber-900 font-mono text-[11px] font-bold animate-pulse">
          <ShieldAlert size={14} className="text-amber-600 shrink-0" />
          <span>Force Check-Out Request Pending Admin Review</span>
        </div>
      )}

      <div className="flex justify-between items-start">
        <div>
          <span className="text-[9px] font-mono uppercase text-rose-800 font-bold tracking-wider">
            Guest Account
          </span>
          <h4 className="font-display font-extrabold text-sm text-charcoal">
            {room.guestName || 'Anonymous Guest'}
          </h4>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {onTransferRoom && (
            <button
              type="button"
              onClick={onTransferRoom}
              title="Transfer this guest to another available room"
              className="text-[10px] font-mono font-bold px-2 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-600 hover:text-white transition flex items-center gap-1 shadow-xs cursor-pointer"
            >
              <ArrowRightLeft size={11} />
              <span>Transfer Room</span>
            </button>
          )}
          {onPrePrintBill && (
            <button
              type="button"
              onClick={onPrePrintBill}
              title="Pre-print preliminary bill to hand to guest in room"
              className="text-[10px] font-mono font-bold px-2 py-1 rounded-lg bg-white border border-primary/40 text-primary hover:bg-primary hover:text-white transition flex items-center gap-1 shadow-xs cursor-pointer"
            >
              <Printer size={11} />
              <span>Pre-Print</span>
            </button>
          )}
          {onGatePass && (
            <button
              type="button"
              onClick={onGatePass}
              title="Print Gate Pass for exit security clearance"
              className="text-[10px] font-mono font-bold px-2 py-1 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition flex items-center gap-1 shadow-xs cursor-pointer"
            >
              <Ticket size={11} className="text-amber-400" />
              <span>Gate Pass</span>
            </button>
          )}
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-100 text-rose-800 uppercase font-bold">
            {formatStayDuration(rateSelected, customHours)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-[11px] font-mono text-charcoal/60">
        <div>
          <span className="text-[9px] uppercase tracking-wide text-charcoal/40 block">Id Number</span>
          <span>{room.guestId || 'None Captured'}</span>
        </div>
        <div>
          <span className="text-[9px] uppercase tracking-wide text-charcoal/40 block">Packs Count</span>
          <span className="font-bold text-primary">{room.numGuests || 1} Pax</span>
        </div>
        <div>
          <span className="text-[9px] uppercase tracking-wide text-charcoal/40 block">Billed Extras</span>
          <span>{room.extraBeds} Bed / {room.towelSets} Towel</span>
        </div>
      </div>

      {/* Unified 1:1 Stay Rate & Check-In Time Section */}
      <div className="mt-1 pt-3 border-t border-rose-200/40 space-y-2.5 text-xs font-mono">
        {/* Check-In & Expected Checkout Timestamps */}
        <div className="bg-white/80 p-2.5 rounded-xl border border-secondary/50 space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-charcoal/70 font-bold flex items-center gap-1 text-[11px]">
              <Clock size={12} className="text-primary" />
              Check-In Time:
            </span>
            <div className="flex items-center gap-2">
              <span className="font-bold text-emerald-800">{formatDisplayTime(checkInTime || room.checkInTime)}</span>
              <button
                type="button"
                onClick={() => setIsEditingTime(!isEditingTime)}
                className="text-[10px] text-primary hover:underline flex items-center gap-0.5 cursor-pointer font-sans font-semibold"
              >
                <Edit3 size={10} />
                <span>{isEditingTime ? 'Done' : 'Edit'}</span>
              </button>
            </div>
          </div>

          {isEditingTime && (
            <div className="pt-2 border-t border-secondary/30 space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-mono text-charcoal/60 uppercase font-bold">
                  Custom Check-In Timestamp
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                    setCheckInTime(localIso);
                  }}
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cream border border-secondary text-primary font-semibold hover:bg-secondary/40 cursor-pointer"
                >
                  Set to Now
                </button>
              </div>
              <input
                type="datetime-local"
                value={checkInTime}
                onChange={(e) => setCheckInTime(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-secondary rounded-lg font-mono outline-none focus:border-primary bg-cream/10"
              />
            </div>
          )}

          {/* 1:1 Calculated Checkout Preview */}
          {(() => {
            const parsedIn = checkInTime ? new Date(checkInTime) : (room.checkInTime ? new Date(room.checkInTime) : new Date());
            const validIn = !isNaN(parsedIn.getTime()) ? parsedIn : new Date();
            const expOut = calculateExpectedCheckout(rateSelected, validIn, customHours);
            return (
              <div className="flex justify-between items-center text-[10px] text-charcoal/70 border-t border-secondary/25 pt-1">
                <span>Expected Checkout:</span>
                <span className="font-bold text-primary font-mono">{formatDisplayTime(expOut.toISOString())}</span>
              </div>
            );
          })()}
        </div>

        {/* Stay Rate Block Selector (hidden when unified StayRatePicker is used) */}
        {!hideStayRate && (
        <div className="space-y-1">
          <div className="flex justify-between items-center text-[10px] uppercase text-charcoal/60">
            <span className="font-bold flex items-center gap-1">
              <span>Stay Rate Block</span>
              {room.rateSelected && room.rateSelected !== rateSelected && (
                <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold lowercase">
                  (orig: {room.rateSelected})
                </span>
              )}
            </span>
            <span className="text-emerald-700 font-bold">Min: 3h Base</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
            {((['3h', '6h', '12h', '24h', 'promo'] as Room['rateSelected'][]).concat(rateSelected === 'custom' || room.rateSelected === 'custom' ? ['custom'] : [])).map((rate) => {
              const isSelected = rateSelected === rate;
              const val = getRateValue(room.tier, rate);
              return (
                <button
                  key={rate}
                  type="button"
                  onClick={() => setRateSelected?.(rate)}
                  className={`py-2 px-1.5 rounded-xl border text-center transition cursor-pointer ${
                    isSelected
                      ? 'bg-primary text-white border-primary font-bold shadow-xs'
                      : 'bg-white border-secondary/40 text-charcoal/70 hover:bg-cream/50'
                  }`}
                >
                  <div className="text-[9.5px] uppercase font-bold leading-tight">
                    {rate === '3h' ? '3h Base' : rate === '6h' ? '6h' : rate === '12h' ? '12 Hours' : rate === '24h' ? '24 Hours' : rate === 'promo' ? 'Midnight Promo' : 'Custom'}
                  </div>
                  <div className={`text-[9px] font-mono mt-0.5 font-extrabold ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                    ₱{val.toLocaleString()}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-[9px] font-mono text-amber-800 bg-amber-50/80 border border-amber-200/80 rounded-lg p-1.5 mt-1">
            NOTE: +₱{EXCESS_HOUR_RATE} for every excess hour of stay.
            {rateSelected === 'custom' && ` (Custom stay: ${customHours}h × ₱130/hr)`}
          </p>
        </div>
        )}
      </div>
    </div>
  );
};
