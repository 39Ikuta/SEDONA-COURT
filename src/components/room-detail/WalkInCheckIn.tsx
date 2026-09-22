import React from 'react';
import { Room } from '../../types';
import { User, UserX, Clock, Calendar } from 'lucide-react';
import { getStayDurationHours, formatStayDuration, calculateExpectedCheckout, EXCESS_HOUR_RATE } from '../../utils/pricing';

interface WalkInCheckInProps {
  room: Room;
  guestName: string;
  setGuestName: (val: string) => void;
  guestId: string;
  setGuestId: (val: string) => void;
  numGuests: number;
  setNumGuests: (val: number) => void;
  rateSelected: Room['rateSelected'];
  setRateSelected: (val: Room['rateSelected']) => void;
  customHours?: number;
  setCustomHours?: (val: number) => void;
  getRateValue: (tier: Room['tier'], rateType: Room['rateSelected']) => number;
  checkInTime: string;
  setCheckInTime: (val: string) => void;
  handleCheckIn: (e: React.FormEvent) => void;
}

export const WalkInCheckIn: React.FC<WalkInCheckInProps> = ({
  room,
  guestName,
  setGuestName,
  guestId,
  setGuestId,
  numGuests,
  setNumGuests,
  rateSelected,
  setRateSelected,
  customHours = 10,
  setCustomHours,
  getRateValue,
  checkInTime,
  setCheckInTime,
  handleCheckIn
}) => {
  const isOptedOut = guestName === 'Walk-in Guest';

  const toggleOptOut = () => {
    if (isOptedOut) {
      setGuestName('');
    } else {
      setGuestName('Walk-in Guest');
    }
  };

  const setCheckInToNow = () => {
    const now = new Date();
    // format as local datetime string for input YYYY-MM-DDTHH:mm
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setCheckInTime(localIso);
  };

  // Compute expected checkout time preview using official rates rule
  const stayHours = getStayDurationHours(rateSelected, customHours);
  const parsedCheckIn = checkInTime ? new Date(checkInTime) : new Date();
  const validCheckIn = !isNaN(parsedCheckIn.getTime()) ? parsedCheckIn : new Date();
  const expectedCheckout = calculateExpectedCheckout(rateSelected, validCheckIn, customHours);

  const formattedExpectedCheckout = !isNaN(expectedCheckout.getTime())
    ? expectedCheckout.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : 'N/A';

  return (
    <>
      <h3 className="font-display font-bold text-sm text-primary uppercase border-b border-secondary/40 pb-2">
        Walk-in Check-in
      </h3>

      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <label className="text-[11px] font-mono uppercase tracking-wider text-charcoal/50">
            Primary Guest Name
          </label>
          <button
            type="button"
            onClick={toggleOptOut}
            className={`text-[10px] font-mono px-2 py-0.5 rounded-lg border transition cursor-pointer flex items-center gap-1 ${
              isOptedOut
                ? 'bg-primary/10 border-primary text-primary font-bold shadow-xs'
                : 'bg-white border-secondary/50 text-charcoal/60 hover:text-primary hover:bg-cream/40'
            }`}
          >
            <UserX size={11} />
            <span>{isOptedOut ? 'Opted Out ✓' : 'Opt Out of Name'}</span>
          </button>
        </div>
        <div className="relative">
          <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal/40" />
          <input
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder={isOptedOut ? 'Walk-in Guest (Opted Out)' : 'Last Name, First Name (or click Opt Out)'}
            className={`w-full pl-9 pr-3 py-2 border rounded-xl text-xs outline-none transition ${
              isOptedOut
                ? 'bg-cream/40 border-primary/30 text-charcoal/70 font-mono italic'
                : 'bg-cream/10 border-secondary focus:border-primary text-charcoal'
            }`}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[11px] font-mono uppercase tracking-wider text-charcoal/50">
            Guest ID No
          </label>
          <input
            type="text"
            value={guestId}
            onChange={(e) => setGuestId(e.target.value)}
            placeholder="e.g. Passport/License"
            className="w-full px-3 py-2 bg-cream/10 border border-secondary rounded-xl text-xs outline-none focus:border-primary transition"
          />
        </div>
        <div className="space-y-1.5 col-span-2">
          <label className="text-[11px] font-mono uppercase tracking-wider text-charcoal/50 block">
            Packs Count (Guests)
          </label>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5, 6].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => setNumGuests(num)}
                className={`flex-1 py-2 text-center text-xs font-mono font-bold rounded-xl border transition cursor-pointer ${
                  numGuests === num
                    ? 'bg-primary border-primary text-white shadow-sm'
                    : 'bg-white border-secondary/50 text-charcoal/80 hover:bg-cream/40'
                }`}
              >
                {num}
              </button>
            ))}
          </div>
          {numGuests > 2 && (
            <p className="text-[10px] text-amber-700 font-mono mt-1">
              +{numGuests - 2} Extra guest(s): +₱{((numGuests - 2) * 150).toLocaleString()} surcharge applies (capacity: 2 pax included).
            </p>
          )}
        </div>
      </div>

      {/* Check-In Time (Customizable / Editable) */}
      <div className="space-y-1.5 bg-cream/30 p-3 rounded-xl border border-secondary/40">
        <div className="flex justify-between items-center">
          <label className="text-[11px] font-mono uppercase tracking-wider text-charcoal/60 font-bold flex items-center gap-1">
            <Clock size={12} className="text-primary" />
            Check-In Time
          </label>
          <button
            type="button"
            onClick={setCheckInToNow}
            className="text-[10px] font-mono px-2 py-0.5 rounded bg-white border border-secondary text-primary font-semibold hover:bg-cream/60 cursor-pointer"
          >
            Set to Now
          </button>
        </div>
        <input
          type="datetime-local"
          value={checkInTime}
          onChange={(e) => setCheckInTime(e.target.value)}
          className="w-full px-3 py-1.5 bg-white border border-secondary rounded-lg text-xs font-mono outline-none focus:border-primary text-charcoal"
        />
        <div className="text-[10px] font-mono text-charcoal/60 flex justify-between pt-1">
          <span>Expected Checkout:</span>
          <span className="font-bold text-primary">{formattedExpectedCheckout}</span>
        </div>
      </div>

      {/* Stay Duration / Rate */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <label className="text-[11px] font-mono uppercase tracking-wider text-charcoal/50">
            Check-In Stay Duration Rate
          </label>
          <span className="text-[10px] font-mono text-emerald-700 font-bold">
            Min: 3h Base
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {((['3h', '6h', '12h', '24h', 'promo', 'custom'] as Room['rateSelected'][]).filter(r => r !== '6h' || rateSelected === '6h' || true)).map((rate) => {
            const val = getRateValue(room.tier, rate);
            return (
              <button
                key={rate}
                type="button"
                onClick={() => setRateSelected(rate)}
                className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition cursor-pointer ${
                  rateSelected === rate
                    ? 'bg-primary/10 border-primary text-primary shadow-xs ring-1 ring-primary/40'
                    : 'bg-white border-secondary/50 hover:bg-cream/30 text-charcoal/80'
                }`}
              >
                <span className="text-[10px] font-mono font-bold uppercase tracking-tight truncate">
                  {rate === '3h' ? '3 Hours' : rate === '6h' ? '6 Hours' : rate === '12h' ? '12 Hours' : rate === '24h' ? '24 Hours' : rate === 'promo' ? 'Midnight Promo' : 'Custom'}
                </span>
                <span className="font-display font-black text-sm tracking-tight mt-1 text-slate-900">
                  ₱{val.toLocaleString()}
                </span>
                {rate === 'promo' ? (
                  <span className="text-[8px] font-mono text-emerald-700 font-semibold mt-0.5">
                    8pm to 6am
                  </span>
                ) : rate === 'custom' ? (
                  <span className="text-[8px] font-mono text-primary font-semibold mt-0.5">
                    ₱130/hr × {customHours}h
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Custom Hours Input Stepper */}
        {rateSelected === 'custom' && (
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-[11px] font-mono uppercase tracking-wider text-primary font-bold">
                Custom Duration (Hours)
              </label>
              <span className="text-xs font-mono font-bold text-primary">
                ₱130 × {customHours} hrs = ₱{(customHours * 130).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCustomHours && setCustomHours(Math.max(1, customHours - 1))}
                className="w-8 h-8 rounded-lg bg-white border border-primary/30 text-primary font-bold hover:bg-primary/10 flex items-center justify-center cursor-pointer text-sm"
              >
                -
              </button>
              <input
                type="number"
                min="1"
                max="72"
                value={customHours}
                onChange={(e) => setCustomHours && setCustomHours(Math.max(1, Math.min(72, parseInt(e.target.value, 10) || 1)))}
                className="flex-1 py-1.5 px-3 text-center font-mono font-bold text-sm bg-white border border-primary/40 rounded-lg outline-none focus:border-primary text-charcoal"
              />
              <button
                type="button"
                onClick={() => setCustomHours && setCustomHours(Math.min(72, customHours + 1))}
                className="w-8 h-8 rounded-lg bg-white border border-primary/30 text-primary font-bold hover:bg-primary/10 flex items-center justify-center cursor-pointer text-sm"
              >
                +
              </button>
            </div>
            <div className="flex gap-1 pt-1">
              {[4, 5, 8, 10, 15, 18].map(h => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setCustomHours && setCustomHours(h)}
                  className={`flex-1 py-1 text-[10px] font-mono rounded border cursor-pointer transition ${
                    customHours === h ? 'bg-primary text-white border-primary' : 'bg-white border-secondary/60 text-charcoal hover:bg-cream/40'
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-2.5 space-y-1 text-[10px] font-mono text-amber-900">
          <div className="flex justify-between items-center font-bold">
            <span>Selected: {formatStayDuration(rateSelected, customHours)}</span>
            <span className="text-amber-800">₱{EXCESS_HOUR_RATE}/excess hr</span>
          </div>
          <p className="text-[9.5px] text-amber-800 font-medium leading-relaxed">
            NOTE: An additional ₱{EXCESS_HOUR_RATE} will be charged for every excess hour of stay.
            {rateSelected === 'promo' && ' Midnight Promo strictly applies from 8:00 PM check-in to 6:00 AM check-out.'}
            {rateSelected === 'custom' && ' Custom stay rate is computed flat at ₱130/hour.'}
          </p>
        </div>
      </div>
    </>
  );
};
