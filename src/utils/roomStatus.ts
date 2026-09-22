import { HelpCircle, Sparkles, User, AlertTriangle, CheckCircle, Users } from 'lucide-react';
import { Room } from '../types';

export const getRoomStatusConfig = (room: Room) => {
  // Staff House Quarters bypasses guest checkout alarms and has dedicated permanent styling
  if (room.isStaffHouse || room.roomType === 'Staff House' || room.number === '12') {
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

  // If room is occupied/overdue and has checkOutTime, apply dynamic checkout alarm colors
  if ((room.state === 'occupied' || room.state === 'overdue') && room.checkOutTime) {
    const now = new Date();
    const checkout = new Date(room.checkOutTime);
    const diffMs = checkout.getTime() - now.getTime();
    const diffMins = diffMs / 60000;

    if (diffMins <= 15 && diffMins > 0) {
      // Warning zone: Checkout in less than 15 minutes
      return {
        bg: 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-400 border-2 animate-pulse',
        border: 'border-amber-400',
        text: 'text-amber-800 font-bold',
        tagBg: 'bg-amber-100 text-amber-900 border-amber-300 font-extrabold',
        indicator: 'bg-amber-500',
        icon: AlertTriangle,
        label: 'CHECKOUT < 15M',
        isUrgent: true,
        urgencyLevel: 'warning',
        timeClass: 'text-amber-800 bg-amber-100 border-amber-300 font-bold animate-pulse',
        diffMins,
      };
    } else if (diffMins <= 0 && diffMins > -15) {
      // Overdue but within 15 mins grace period
      return {
        bg: 'bg-rose-500/10 hover:bg-rose-500/20 border-rose-500 border-2 animate-pulse',
        border: 'border-rose-500',
        text: 'text-rose-900 font-extrabold',
        tagBg: 'bg-rose-100 text-rose-950 border-rose-300 font-black',
        indicator: 'bg-rose-600',
        icon: AlertTriangle,
        label: 'OVERDUE GRACE',
        isUrgent: true,
        urgencyLevel: 'overdue-grace',
        timeClass: 'text-rose-800 bg-rose-100 border-rose-300 font-bold animate-pulse',
        diffMins,
      };
    } else if (diffMins <= -15) {
      // Overdue past 15 mins grace period
      return {
        bg: 'bg-purple-500/15 hover:bg-purple-500/25 border-purple-600 border-2 animate-pulse-slow',
        border: 'border-purple-600',
        text: 'text-purple-950 font-black',
        tagBg: 'bg-purple-200 text-purple-950 border-purple-400 font-black shadow-xs',
        indicator: 'bg-purple-700',
        icon: AlertTriangle,
        label: 'LATE PAST GRACE',
        isUrgent: true,
        urgencyLevel: 'late-past-grace',
        timeClass: 'text-purple-900 bg-purple-100 border-purple-300 font-black shadow-xs ring-1 ring-purple-400/50 animate-pulse',
        diffMins,
      };
    }
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
    case 'occupied':
      return {
        bg: 'bg-rose-50/35 hover:bg-rose-50/60',
        border: 'border-rose-200/80',
        text: 'text-rose-900',
        tagBg: 'bg-rose-100 text-rose-800 border-rose-200',
        indicator: 'bg-rose-500',
        icon: User,
        label: 'OCCUPIED',
        isUrgent: false,
        urgencyLevel: 'none',
        timeClass: 'text-rose-600 bg-rose-50 border-rose-100',
      };
    case 'cleaning':
      return {
        bg: 'bg-amber-50/35 hover:bg-amber-50/60',
        border: 'border-amber-200/80',
        text: 'text-amber-900',
        tagBg: 'bg-amber-100 text-amber-800 border-amber-200',
        indicator: 'bg-amber-500',
        icon: Sparkles,
        label: 'CLEANING',
        isUrgent: false,
        urgencyLevel: 'none',
        timeClass: 'text-amber-600 bg-amber-50 border-amber-100',
      };
    case 'overdue':
      return {
        bg: 'bg-purple-50/40 hover:bg-purple-50/70 animate-pulse-slow',
        border: 'border-purple-300 animate-border-pulse',
        text: 'text-purple-900',
        tagBg: 'bg-purple-100 text-purple-800 border-purple-200',
        indicator: 'bg-purple-500',
        icon: AlertTriangle,
        label: 'LATE CHECKOUT',
        isUrgent: false,
        urgencyLevel: 'none',
        timeClass: 'text-purple-600 bg-purple-50 border-purple-100',
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
