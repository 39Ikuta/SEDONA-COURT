/**
 * src/components/GuestCountCards.tsx
 * Executive summary KPI cards displaying real-time guest headcount metrics:
 * - Guests Today (In-House + Completed Checkouts)
 * - Guests This Shift (Current Day/Night Shift Headcount)
 * - Average Stay Duration & Revenue Per Guest (RevPAG)
 * 
 * Restricted to Owner and Admin roles.
 */

import React, { useMemo } from 'react';
import { Room, Receipt, getTierDisplayName } from '../types';
import { Users, UserCheck, BedDouble, TrendingUp, Clock, Sparkles, DollarSign } from 'lucide-react';
import { getManilaDateParts } from '../utils/pricing';

export interface GuestCountCardsProps {
  rooms: Room[];
  receipts: Receipt[];
  userRole?: string;
  className?: string;
}

/**
 * Helper to compute headcount from a single receipt.
 * Base room checkout covers up to 2 persons; extra person item adds additional guests.
 * POS direct orders count as 1 guest.
 */
export function getReceiptGuestCount(r: Receipt): number {
  const extraPersonItem = (r.items || []).find((it) =>
    it.description?.toLowerCase().includes('extra person') ||
    it.description?.toLowerCase().includes('extra guest')
  );
  let extraGuests = 0;
  if (extraPersonItem) {
    const subtextMatch = extraPersonItem.subtext?.match(/(\d+)\s*Extra/i);
    const descMatch = extraPersonItem.description?.match(/(\d+)\s*Extra/i);
    if (subtextMatch) {
      extraGuests = parseInt(subtextMatch[1], 10) || 0;
    } else if (descMatch) {
      extraGuests = parseInt(descMatch[1], 10) || 0;
    } else if (extraPersonItem.amount > 0) {
      extraGuests = Math.round(extraPersonItem.amount / 150);
    }
  }

  const isRoom = Boolean(r.roomNumber && r.roomNumber !== 'POS');
  const base = isRoom ? 2 : 1;
  return base + extraGuests;
}

/**
 * Returns Business Day Date string (YYYY-MM-DD) and Shift ('DAY' | 'NIGHT')
 * Hospitality Business Day begins at 06:00 Manila Time.
 */
export function getBusinessDayAndShift(dateInput: Date | string | number = new Date()): {
  businessDate: string;
  shiftType: 'DAY' | 'NIGHT';
  shiftLabel: string;
  displayDate: string;
} {
  const d = typeof dateInput === 'string'
    ? new Date(dateInput.includes(' ') && !dateInput.includes('T') ? dateInput.replace(' ', 'T') : dateInput)
    : new Date(dateInput);
  const validDate = isNaN(d.getTime()) ? new Date() : d;

  const { year, month, day, hour } = getManilaDateParts(validDate);

  // If before 06:00, belongs to previous calendar date's business day
  let bYear = year;
  let bMonth = month;
  let bDay = day;
  if (hour < 6) {
    const prev = new Date(validDate.getTime() - 24 * 3600 * 1000);
    const prevParts = getManilaDateParts(prev);
    bYear = prevParts.year;
    bMonth = prevParts.month;
    bDay = prevParts.day;
  }

  const shiftType: 'DAY' | 'NIGHT' = hour >= 6 && hour < 18 ? 'DAY' : 'NIGHT';
  const pad = (n: number) => String(n).padStart(2, '0');
  const businessDate = `${bYear}-${pad(bMonth)}-${pad(bDay)}`;

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const displayDate = `${monthNames[bMonth - 1]} ${bDay}, ${bYear}`;
  const shiftLabel = shiftType === 'DAY' ? 'Day Shift (06:00 - 18:00)' : 'Night Shift (18:00 - 06:00)';

  return { businessDate, shiftType, shiftLabel, displayDate };
}

export const GuestCountCards: React.FC<GuestCountCardsProps> = ({
  rooms,
  receipts,
  userRole = 'admin',
  className = '',
}) => {
  const effectiveRole = userRole.toLowerCase();
  const isAdminOrOwner = effectiveRole === 'admin' || effectiveRole === 'owner';

  // Compute live guest metrics
  const stats = useMemo(() => {
    const nowInfo = getBusinessDayAndShift(new Date());

    // 1. In-House guests (active occupied / overdue rooms)
    const occupiedRooms = rooms.filter(
      (r) => (r.state === 'occupied' || r.state === 'overdue') && !r.isStaffHouse && r.roomType !== 'Staff House' && r.number !== '12'
    );
    const inHouseCount = occupiedRooms.reduce((sum, r) => sum + (r.numGuests || 2), 0);
    const occupiedRoomCount = occupiedRooms.length;

    // 2. Completed checkouts today (business day)
    const receiptsToday = receipts.filter((r) => {
      if (!r.dateTime) return false;
      const rInfo = getBusinessDayAndShift(r.dateTime);
      return rInfo.businessDate === nowInfo.businessDate;
    });
    const completedTodayCount = receiptsToday.reduce((sum, r) => sum + getReceiptGuestCount(r), 0);
    const completedCheckoutsToday = receiptsToday.length;
    const totalTodayHeadcount = inHouseCount + completedTodayCount;
    const todayRevenue = receiptsToday.reduce((sum, r) => sum + r.total, 0);

    // 3. Completed checkouts this shift
    const receiptsThisShift = receiptsToday.filter((r) => {
      const rInfo = getBusinessDayAndShift(r.dateTime);
      return rInfo.shiftType === nowInfo.shiftType;
    });
    const completedThisShiftCount = receiptsThisShift.reduce((sum, r) => sum + getReceiptGuestCount(r), 0);
    const completedCheckoutsThisShift = receiptsThisShift.length;
    const totalShiftHeadcount = inHouseCount + completedThisShiftCount;
    const shiftRevenue = receiptsThisShift.reduce((sum, r) => sum + r.total, 0);

    // 4. Revenue per Guest (RevPAG)
    const revPagToday = totalTodayHeadcount > 0 ? todayRevenue / totalTodayHeadcount : 0;
    const revPagShift = totalShiftHeadcount > 0 ? shiftRevenue / totalShiftHeadcount : 0;

    return {
      nowInfo,
      inHouseCount,
      occupiedRoomCount,
      completedTodayCount,
      completedCheckoutsToday,
      totalTodayHeadcount,
      todayRevenue,
      completedThisShiftCount,
      completedCheckoutsThisShift,
      totalShiftHeadcount,
      shiftRevenue,
      revPagToday,
      revPagShift,
    };
  }, [rooms, receipts]);

  // Restrict display strictly to Admin and Owner roles
  if (!isAdminOrOwner) {
    return null;
  }

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${className}`}>
      {/* Card 1: Guests Today */}
      <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm hover:border-primary/40 transition-all flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-primary/5 text-primary text-[10px] font-mono font-bold uppercase">
              <Users size={12} />
              <span>Guests Today (Business Day)</span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display font-black text-3xl text-primary tracking-tight">
                {stats.totalTodayHeadcount}
              </span>
              <span className="text-xs font-mono text-charcoal/50 uppercase font-bold">
                Total Headcount
              </span>
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-primary/5 border border-primary/10 text-primary flex items-center justify-center shrink-0">
            <Users size={20} />
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-secondary/40 grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div className="bg-cream/20 p-2 rounded-xl border border-secondary/30">
            <span className="text-[10px] text-charcoal/50 uppercase block">In-House</span>
            <span className="font-bold text-emerald-700 text-sm">
              {stats.inHouseCount} pax
            </span>
            <span className="text-[9px] text-charcoal/40 block mt-0.5">
              {stats.occupiedRoomCount} active room{stats.occupiedRoomCount !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="bg-cream/20 p-2 rounded-xl border border-secondary/30">
            <span className="text-[10px] text-charcoal/50 uppercase block">Completed</span>
            <span className="font-bold text-indigo-700 text-sm">
              {stats.completedTodayCount} pax
            </span>
            <span className="text-[9px] text-charcoal/40 block mt-0.5">
              {stats.completedCheckoutsToday} checkout{stats.completedCheckoutsToday !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Card 2: Guests This Shift */}
      <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm hover:border-primary/40 transition-all flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-800 text-[10px] font-mono font-bold uppercase">
              <Clock size={12} className="text-amber-600" />
              <span>Guests This Shift ({stats.nowInfo.shiftType})</span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display font-black text-3xl text-amber-900 tracking-tight">
                {stats.totalShiftHeadcount}
              </span>
              <span className="text-xs font-mono text-charcoal/50 uppercase font-bold">
                Shift Headcount
              </span>
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
            <Clock size={20} />
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-secondary/40 grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div className="bg-cream/20 p-2 rounded-xl border border-secondary/30">
            <span className="text-[10px] text-charcoal/50 uppercase block">Active In-House</span>
            <span className="font-bold text-emerald-700 text-sm">
              {stats.inHouseCount} pax
            </span>
            <span className="text-[9px] text-charcoal/40 block mt-0.5">
              Live in rooms
            </span>
          </div>
          <div className="bg-cream/20 p-2 rounded-xl border border-secondary/30">
            <span className="text-[10px] text-charcoal/50 uppercase block">Shift Checkouts</span>
            <span className="font-bold text-amber-800 text-sm">
              {stats.completedThisShiftCount} pax
            </span>
            <span className="text-[9px] text-charcoal/40 block mt-0.5">
              {stats.completedCheckoutsThisShift} invoice{stats.completedCheckoutsThisShift !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Card 3: Revenue Per Guest & Headcount Yield */}
      <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm hover:border-primary/40 transition-all flex flex-col justify-between md:col-span-2 lg:col-span-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-100 text-[10px] font-mono font-bold uppercase">
              <TrendingUp size={12} className="text-emerald-600" />
              <span>RevPAG (Revenue / Guest)</span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display font-black text-3xl text-emerald-700 tracking-tight">
                ₱{stats.revPagToday.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-xs font-mono text-charcoal/50 uppercase font-bold">
                / Guest
              </span>
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
            <DollarSign size={20} />
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-secondary/40 flex items-center justify-between text-[11px] font-mono text-charcoal/60">
          <span>Shift RevPAG:</span>
          <span className="font-bold text-primary">
            ₱{stats.revPagShift.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / pax
          </span>
        </div>
      </div>
    </div>
  );
};

export default GuestCountCards;
