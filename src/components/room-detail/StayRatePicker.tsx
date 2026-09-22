import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { Room } from '../../types';
import { formatStayDuration, EXCESS_HOUR_RATE } from '../../utils/pricing';

interface StayRatePickerProps {
  tier: Room['tier'];
  rateSelected: Room['rateSelected'];
  onChange: (rate: Room['rateSelected']) => void;
  getRateValue: (tier: Room['tier'], rateType: Room['rateSelected']) => number;
  customHours: number;
  setCustomHours: (hours: number) => void;
}

const RATE_OPTIONS: Array<{ value: Room['rateSelected']; label: string; hint?: (customHours: number) => string }> = [
  { value: '1h', label: '1 Hour', hint: () => '₱130 flat' },
  { value: '3h', label: '3 Hours' },
  { value: '6h', label: '6 Hours' },
  { value: '12h', label: '12 Hours' },
  { value: '24h', label: '24 Hours' },
  { value: 'promo', label: 'Midnight Promo', hint: () => '8pm – 6am' },
  { value: 'custom', label: 'Custom', hint: (h) => `₱130/hr × ${h}h` },
];

/**
 * The single stay-rate picker for the Frontdesk Drawer.
 * Replaces the three previously duplicated pickers (guest card, checkout
 * panel, discount buttons) so rate changes flow through one handler.
 */
export const StayRatePicker: React.FC<StayRatePickerProps> = ({
  tier,
  rateSelected,
  onChange,
  getRateValue,
  customHours,
  setCustomHours,
}) => {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-[11px] font-mono uppercase tracking-wider text-charcoal/50 font-bold">
          Stay Rate Block
        </span>
        <span className="text-[10px] font-mono text-emerald-700 font-bold">Min: 3h Base</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {RATE_OPTIONS.map((opt) => {
          const isSelected = rateSelected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`py-2 px-1.5 rounded-xl border text-center transition cursor-pointer ${
                isSelected
                  ? 'bg-primary text-white border-primary font-bold shadow-xs'
                  : 'bg-white border-secondary/40 text-charcoal/70 hover:bg-cream/50'
              }`}
            >
              <div className="text-[10px] uppercase font-bold leading-tight">
                {opt.label}
              </div>
              <div className={`text-[11px] font-mono mt-0.5 font-extrabold ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                ₱{getRateValue(tier, opt.value).toLocaleString()}
              </div>
              {opt.hint && (
                <div className={`text-[8px] font-mono mt-0.5 ${isSelected ? 'text-white/85' : 'text-charcoal/45'}`}>
                  {opt.hint(customHours)}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {rateSelected === 'custom' && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-2.5 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-mono uppercase text-primary font-bold">
              Custom Hours
            </span>
            <span className="text-[11px] font-mono font-bold text-primary">
              ₱130 × {customHours}h = ₱{(customHours * 130).toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCustomHours(Math.max(1, customHours - 1))}
              className="w-8 h-8 rounded-lg bg-white border border-primary/30 text-primary font-bold hover:bg-primary/10 flex items-center justify-center cursor-pointer"
              aria-label="Decrease custom hours"
            >
              <Minus size={13} />
            </button>
            <input
              type="number"
              min={1}
              max={72}
              value={customHours}
              onChange={(e) => setCustomHours(Math.max(1, Math.min(72, parseInt(e.target.value, 10) || 1)))}
              className="flex-1 py-1.5 px-3 text-center font-mono font-bold text-sm bg-white border border-primary/40 rounded-lg outline-none focus:border-primary text-charcoal"
            />
            <button
              type="button"
              onClick={() => setCustomHours(Math.min(72, customHours + 1))}
              className="w-8 h-8 rounded-lg bg-white border border-primary/30 text-primary font-bold hover:bg-primary/10 flex items-center justify-center cursor-pointer"
              aria-label="Increase custom hours"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>
      )}

      <p className="text-[9px] font-mono text-charcoal/50">
        Selected: <span className="font-bold text-primary">{formatStayDuration(rateSelected, customHours)}</span>
        {' '}• +₱{EXCESS_HOUR_RATE}/excess hr
      </p>
    </div>
  );
};
