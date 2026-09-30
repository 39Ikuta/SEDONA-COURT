import { HelpCircle, Sparkles, User, AlertTriangle, CheckCircle, Users } from 'lucide-react';
import { Room, AlarmState } from '../types';

/**
 * Formats a UTC ISO timestamp or Date into Asia/Manila 12-hour time (e.g. "4:05 PM").
 */
export function formatManilaTime(dateInput?: string | Date | null): string {
  if (!dateInput) return '';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Returns formatted check-in and scheduled checkout string e.g. "In 4:05 PM · Out 7:05 PM"
 * or "In 4:05 PM · Open Time" in Asia/Manila timezone, 12h format.
 * Returns null for available, maintenance, or staff rooms.
 */
export function getRoomStayScheduleText(room: Room): string | null {
  if (room.isStaffHouse || room.roomType === 'Staff House' || String(room.number) === '12') {
    return null;
  }
  if (room.state !== 'occupied' && room.state !== 'overdue') {
    return null;
  }

  const inFormatted = formatManilaTime(room.checkInAt || room.checkInTime);

  if (room.billingMode === 'open_time') {
    if (inFormatted) {
      return `In ${inFormatted} · Open Time`;
    }
    return 'Open Time';
  }

  let checkOut = room.expectedCheckoutAt || room.checkOutTime;

  // Backfill expectedCheckoutAt if missing: check_in_at + duration
  if (!checkOut && (room.checkInAt || room.checkInTime)) {
    const checkIn = room.checkInAt || room.checkInTime;
    let durationHours = 24;
    if (room.rateSelected === '1h') durationHours = 1;
    else if (room.rateSelected === '3h') durationHours = 3;
    else if (room.rateSelected === '6h') durationHours = 6;
    else if (room.rateSelected === '12h') durationHours = 12;
    else if (room.rateSelected === '24h') durationHours = 24;
    else if (room.rateSelected === 'custom' && room.customHours) durationHours = room.customHours;

    const inMs = new Date(checkIn!).getTime();
    if (!isNaN(inMs)) {
      checkOut = new Date(inMs + durationHours * 3600000).toISOString();
    }
  }

  if (!inFormatted && !checkOut) return null;

  const outFormatted = formatManilaTime(checkOut);

  if (inFormatted && outFormatted) {
    return `In ${inFormatted} · Out ${outFormatted}`;
  } else if (inFormatted) {
    return `In ${inFormatted}`;
  } else if (outFormatted) {
    return `Out ${outFormatted}`;
  }
  return null;
}

export function getRoomTimeText(room: Room): string {
  if (room.isStaffHouse || room.roomType === 'Staff House' || String(room.number) === '12') {
    return 'STAFF';
  }
  if (room.state !== 'occupied' && room.state !== 'overdue') {
    return 'READY';
  }
  if (room.billingMode === 'open_time') {
    const start = room.openTimeStartedAt || room.checkInAt || room.checkInTime;
    if (start) {
      const elapsed = Math.max(0, Date.now() - new Date(start).getTime());
      const h = Math.floor(elapsed / 3600000);
      const m = Math.floor((elapsed % 3600000) / 60000);
      return `Open time · ${h}h ${m}m`;
    }
    return 'Open time';
  }
  return room.time || 'READY';
}

export interface RoomStatusConfig {
  bg: string;
  border: string;
  text: string;
  tagBg: string;
  indicator: string;
  icon: any;
  label: string;
  isUrgent: boolean;
  urgencyLevel: 'none' | 'warning' | 'due' | 'overdue' | 'overdue-grace' | 'late-past-grace';
  timeClass: string;
  diffMins?: number;
}

export const getRoomStatusConfig = (room: Room, serverTimeMs?: number): RoomStatusConfig => {
  // Staff House Quarters bypasses guest checkout alarms and has dedicated permanent styling
  if (room.isStaffHouse || room.roomType === 'Staff House' || String(room.number) === '12') {
    return {
      bg: 'bg-indigo-50/40 hover:bg-indigo-50/70 border-indigo-200/80',
      border: 'border-indigo-200/80',
      text: 'text-indigo-900 font-bold',
      tagBg: 'bg-indigo-100 text-indigo-800 border-indigo-200 font-bold',
      indicator: 'bg-indigo-500',
      icon: Users,
      label: 'STAFF HOUSE',
      isUrgent: false,
      urgencyLevel: 'none',
      timeClass: 'text-indigo-700 bg-indigo-50 border-indigo-200 font-bold',
    };
  }

  // Open Time Billing Mode: Neutral styling with "Open time · Xh Ym", no pulsating red
  if (room.billingMode === 'open_time' && (room.state === 'occupied' || room.state === 'overdue')) {
    return {
      bg: 'bg-white hover:bg-slate-50/90 border-slate-200 shadow-xs',
      border: 'border-slate-300',
      text: 'text-slate-800 font-bold',
      tagBg: 'bg-blue-50 text-blue-800 border-blue-200 font-bold',
      indicator: 'bg-blue-500',
      icon: User,
      label: 'OPEN TIME',
      isUrgent: false,
      urgencyLevel: 'none',
      timeClass: 'text-blue-700 bg-blue-50 border-blue-200 font-bold',
      diffMins: 0,
    };
  }

  // Active Occupied or Overdue Rooms: Alarm state machine styling
  if (room.state === 'occupied' || room.state === 'overdue') {
    const checkoutTime = room.expectedCheckoutAt || room.checkOutTime;
    const nowMs = serverTimeMs || Date.now();
    let diffMins = 0;

    let effectiveState: AlarmState = room.alarmState || 'NORMAL';

    if (checkoutTime) {
      const checkoutMs = new Date(checkoutTime).getTime();
      if (!isNaN(checkoutMs)) {
        diffMins = (checkoutMs - nowMs) / 60000;
        // If server hasn't pushed alarmState yet, derive client-side using 15m default windows
        if (!room.alarmState) {
          if (diffMins > 15) {
            effectiveState = 'NORMAL';
          } else if (diffMins > 0) {
            effectiveState = 'WARNING';
          } else if (diffMins > -15) {
            effectiveState = 'DUE';
          } else {
            effectiveState = 'OVERDUE';
          }
        }
      }
    }

    if (effectiveState === 'WARNING') {
      return {
        bg: 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-400 border-2 animate-pulse',
        border: 'border-amber-400',
        text: 'text-amber-800 font-bold',
        tagBg: 'bg-amber-100 text-amber-900 border-amber-300 font-extrabold',
        indicator: 'bg-amber-500',
        icon: AlertTriangle,
        label: 'WARNING',
        isUrgent: true,
        urgencyLevel: 'warning',
        timeClass: 'text-amber-800 bg-amber-100 border-amber-300 font-bold animate-pulse',
        diffMins,
      };
    }

    if (effectiveState === 'DUE') {
      return {
        bg: 'bg-orange-500/10 hover:bg-orange-500/20 border-orange-500 border-2',
        border: 'border-orange-500',
        text: 'text-orange-950 font-extrabold',
        tagBg: 'bg-orange-100 text-orange-950 border-orange-300 font-black',
        indicator: 'bg-orange-500',
        icon: AlertTriangle,
        label: 'DUE',
        isUrgent: true,
        urgencyLevel: 'due',
        timeClass: 'text-orange-900 bg-orange-100 border-orange-300 font-bold',
        diffMins,
      };
    }

    if (effectiveState === 'OVERDUE') {
      const isAcked = !!room.acknowledgedAt;
      return {
        bg: isAcked
          ? 'bg-rose-500/10 hover:bg-rose-500/15 border-rose-500 border-2'
          : 'bg-rose-500/15 hover:bg-rose-500/25 border-rose-600 border-2 animate-pulse-slow',
        border: isAcked ? 'border-rose-500' : 'border-rose-600',
        text: 'text-rose-950 font-black',
        tagBg: isAcked
          ? 'bg-rose-100 text-rose-900 border-rose-300 font-bold'
          : 'bg-rose-100 text-rose-950 border-rose-400 font-black shadow-xs',
        indicator: 'bg-rose-600',
        icon: AlertTriangle,
        label: isAcked ? 'OVERDUE (ACK)' : 'OVERDUE',
        isUrgent: true,
        urgencyLevel: 'overdue',
        timeClass: isAcked
          ? 'text-rose-900 bg-rose-100 border-rose-300 font-black shadow-xs'
          : 'text-rose-950 bg-rose-100 border-rose-400 font-black shadow-xs ring-1 ring-rose-400/50 animate-pulse',
        diffMins,
      };
    }

    // NORMAL state -> Neutral styling (fixes red countdown bug where 2h54m remaining showed red)
    return {
      bg: 'bg-white hover:bg-slate-50/90 border-slate-200 shadow-xs',
      border: 'border-slate-300',
      text: 'text-slate-800 font-bold',
      tagBg: 'bg-slate-100 text-slate-800 border-slate-200 font-bold',
      indicator: 'bg-slate-400',
      icon: User,
      label: 'OCCUPIED',
      isUrgent: false,
      urgencyLevel: 'none',
      timeClass: 'text-slate-700 bg-slate-100 border-slate-200 font-bold',
      diffMins,
    };
  }

  switch (room.state) {
    case 'available':
      return {
        bg: 'bg-green-50/40 hover:bg-green-50/70',
        border: 'border-emerald-200/80',
        text: 'text-emerald-800',
        tagBg: 'bg-emerald-100 text-emerald-800 border-emerald-200',
        indicator: 'bg-emerald-500',
        icon: CheckCircle,
        label: 'AVAILABLE',
        isUrgent: false,
        urgencyLevel: 'none',
        timeClass: 'text-emerald-600 bg-emerald-50 border-emerald-100',
      };
    case 'maintenance':
    default:
      return {
        bg: 'bg-gray-50/50 hover:bg-gray-50/80',
        border: 'border-gray-200',
        text: 'text-gray-700',
        tagBg: 'bg-gray-100 text-gray-700 border-gray-200',
        indicator: 'bg-gray-400',
        icon: HelpCircle,
        label: 'MAINTENANCE',
        isUrgent: false,
        urgencyLevel: 'none',
        timeClass: 'text-gray-500 bg-gray-50 border-gray-100',
      };
  }
};

