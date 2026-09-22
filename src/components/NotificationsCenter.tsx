import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Volume2,
  VolumeX,
  Sparkles,
  ArrowRight,
  RefreshCw,
  BellOff,
  History,
  ShieldAlert,
  DoorOpen,
  User,
  Coffee,
  Coins,
  ChevronRight,
  Flame,
  Radio
} from 'lucide-react';
import { Room, getTierDisplayName, NotificationLogItem } from '../types';
import { playChime, stopAlarm, ChimeType } from '../utils/audio';

export interface SnoozedAlarmItem {
  roomNumber: string;
  type: 'warning' | 'checkout' | 'grace';
  message: string;
  snoozedUntil: number;
}

interface NotificationsCenterProps {
  rooms: Room[];
  activeAlarms: Array<{
    id: string;
    roomNumber: string;
    type: 'warning' | 'checkout' | 'grace';
    message: string;
    timestamp: string;
  }>;
  snoozedAlarms: Record<string, SnoozedAlarmItem>;
  notificationHistory: NotificationLogItem[];
  onSelectRoom: (roomNumber: string) => void;
  onSnoozeAlarm: (
    alarm: { id: string; roomNumber: string; type: 'warning' | 'checkout' | 'grace'; message: string },
    minutes?: number
  ) => void;
  onWakeSnoozedAlarm: (key: string) => void;
  onDismissAlarm: (id: string) => void;
  onClearAllSnoozes: () => void;
  onClearHistory?: () => void;
  onBackToDashboard?: () => void;
}

type TabCategory = 'all' | 'critical' | 'checkout' | 'warning' | 'snoozed' | 'history';

export const NotificationsCenter: React.FC<NotificationsCenterProps> = ({
  rooms,
  activeAlarms,
  snoozedAlarms,
  notificationHistory,
  onSelectRoom,
  onSnoozeAlarm,
  onWakeSnoozedAlarm,
  onDismissAlarm,
  onClearAllSnoozes,
  onClearHistory,
  onBackToDashboard,
}) => {
  const [selectedTab, setSelectedTab] = useState<TabCategory>('all');
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const [audioFeedback, setAudioFeedback] = useState<string | null>(null);

  // Live 1-second ticker to update countdowns smoothly
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Compute room statuses & urgency groups based on the hotel's alerting system
  const {
    urgentRooms,
    pastGraceRooms,
    checkoutGraceRooms,
    warningRooms,
    allAttentionCount,
  } = useMemo(() => {
    const now = currentTime;
    const pastGrace: Array<{ room: Room; diffMs: number; diffMins: number; statusText: string }> = [];
    const checkoutGrace: Array<{ room: Room; diffMs: number; diffMins: number; statusText: string }> = [];
    const warning: Array<{ room: Room; diffMs: number; diffMins: number; statusText: string }> = [];
    const allUrgent: Array<{
      room: Room;
      category: 'grace' | 'checkout' | 'warning';
      diffMs: number;
      diffMins: number;
      statusText: string;
      urgencyLabel: string;
    }> = [];

    rooms.forEach((room) => {
      // Exclude staff house or quarters
      if (room.isStaffHouse || room.roomType === 'Staff House' || String(room.number) === '12') {
        return;
      }

      if ((room.state === 'occupied' || room.state === 'overdue') && room.checkOutTime) {
        const checkout = new Date(room.checkOutTime).getTime();
        const diffMs = checkout - now;
        const diffMins = diffMs / 60000;

        // 1. Past Grace Period (+15m overdue)
        if (diffMins <= -15) {
          const overdueMs = Math.abs(diffMs);
          const hrs = Math.floor(overdueMs / 3600000);
          const mins = Math.floor((overdueMs % 3600000) / 60000);
          const secs = Math.floor((overdueMs % 60000) / 1000);
          const timeStr = hrs > 0 ? `+${hrs}h ${mins}m` : `+${mins}m ${secs < 10 ? '0' : ''}${secs}s`;

          pastGrace.push({ room, diffMs, diffMins, statusText: timeStr });
          allUrgent.push({
            room,
            category: 'grace',
            diffMs,
            diffMins,
            statusText: timeStr,
            urgencyLabel: 'LATE PAST GRACE (+15M)',
          });
        }
        // 2. Checkout Time Reached (In 15m Grace Period)
        else if (diffMins <= 0 && diffMins > -15) {
          const overdueMs = Math.abs(diffMs);
          const mins = Math.floor(overdueMs / 60000);
          const secs = Math.floor((overdueMs % 60000) / 1000);
          const timeStr = `+${mins}m ${secs < 10 ? '0' : ''}${secs}s`;

          checkoutGrace.push({ room, diffMs, diffMins, statusText: timeStr });
          allUrgent.push({
            room,
            category: 'checkout',
            diffMs,
            diffMins,
            statusText: timeStr,
            urgencyLabel: 'CHECKOUT REACHED (GRACE)',
          });
        }
        // 3. Approaching Checkout Warning (< 15 mins remaining)
        else if (diffMins <= 15 && diffMins > 0) {
          const mins = Math.floor(diffMs / 60000);
          const secs = Math.floor((diffMs % 60000) / 1000);
          const timeStr = `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;

          warning.push({ room, diffMs, diffMins, statusText: timeStr });
          allUrgent.push({
            room,
            category: 'warning',
            diffMs,
            diffMins,
            statusText: timeStr,
            urgencyLabel: 'CHECKOUT < 15M WARNING',
          });
        }
      }
    });

    // Sort urgent rooms: most overdue first, then lowest remaining time
    allUrgent.sort((a, b) => a.diffMs - b.diffMs);
    pastGrace.sort((a, b) => a.diffMs - b.diffMs);
    checkoutGrace.sort((a, b) => a.diffMs - b.diffMs);
    warning.sort((a, b) => a.diffMs - b.diffMs);

    const snoozedCount = Object.keys(snoozedAlarms).length;
    const totalCount = allUrgent.length + snoozedCount;

    return {
      urgentRooms: allUrgent,
      pastGraceRooms: pastGrace,
      checkoutGraceRooms: checkoutGrace,
      warningRooms: warning,
      allAttentionCount: totalCount,
    };
  }, [rooms, currentTime, snoozedAlarms]);

  // Audio preview helper
  const handleTestChime = (type: ChimeType, label: string) => {
    playChime(type);
    setAudioFeedback(`Playing ${label}...`);
    setTimeout(() => setAudioFeedback(null), 2500);
  };

  const handleQuickSnooze = (
    roomNumber: string,
    type: 'warning' | 'checkout' | 'grace',
    minutes: number
  ) => {
    const active = activeAlarms.find((a) => a.roomNumber === roomNumber && a.type === type);
    const id = active ? active.id : `${roomNumber}_${type}_manual_${Date.now()}`;
    const message = active
      ? active.message
      : `Apartment ${roomNumber} checkout alert (${type})`;
    onSnoozeAlarm({ id, roomNumber, type, message }, minutes);
  };

  const snoozedEntries = Object.entries(snoozedAlarms) as [string, SnoozedAlarmItem][];

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto font-sans pb-12">
      {/* ─── 1. TOP HEADER & AUDIO CONTROLS HUB ───────────────────────────── */}
      <div className="bg-white p-5 sm:p-6 rounded-3xl border border-[#E1DAD0] shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#793743] to-[#5a2530] text-white flex items-center justify-center shadow-md shrink-0">
            <Bell size={24} className="animate-bounce" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display font-black text-xl sm:text-2xl text-primary tracking-tight">
                Live Room Alerting &amp; Notifications
              </h1>
              {allAttentionCount > 0 ? (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-rose-600 text-white animate-pulse shadow-xs">
                  {allAttentionCount} Needing Action
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  ● All On Schedule
                </span>
              )}
            </div>
            <p className="text-xs font-mono text-charcoal/60 mt-0.5">
              Live checkout tracker • 15m advance warning, checkout time, &amp; +15m grace monitoring
            </p>
          </div>
        </div>

        {/* Quick Chime & Sound Controls */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {audioFeedback && (
            <span className="text-[11px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg animate-pulse">
              {audioFeedback}
            </span>
          )}

          <div className="flex items-center bg-[#F2EEE9]/80 border border-[#E1DAD0] rounded-2xl p-1 gap-1">
            <button
              type="button"
              onClick={() => handleTestChime('warning', '15m Warning Bell')}
              title="Test 15-Minute Advance Warning 4-Tone Chime"
              className="px-2.5 py-1.5 rounded-xl font-mono text-xs font-bold text-amber-900 hover:bg-amber-100 transition flex items-center gap-1.5 cursor-pointer"
            >
              <Volume2 size={13} className="text-amber-700" />
              <span>15m Chime</span>
            </button>

            <button
              type="button"
              onClick={() => handleTestChime('checkout', 'Digital Checkout Alarm')}
              title="Test Checkout & Grace Period Siren"
              className="px-2.5 py-1.5 rounded-xl font-mono text-xs font-bold text-rose-900 hover:bg-rose-100 transition flex items-center gap-1.5 cursor-pointer"
            >
              <Volume2 size={13} className="text-rose-700" />
              <span>Alarm Siren</span>
            </button>

            <button
              type="button"
              onClick={() => handleTestChime('bell', 'Frontdesk Service Bell')}
              title="Test Triple Metallic Desk Bell"
              className="px-2.5 py-1.5 rounded-xl font-mono text-xs font-bold text-charcoal/80 hover:bg-white transition flex items-center gap-1.5 cursor-pointer"
            >
              <Volume2 size={13} className="text-charcoal/60" />
              <span>Desk Bell</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              stopAlarm();
              setAudioFeedback('Alarm Silenced');
              setTimeout(() => setAudioFeedback(null), 2000);
            }}
            title="Silence any active audible siren"
            className="p-2.5 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition font-mono text-xs font-bold flex items-center gap-1.5 cursor-pointer active:scale-95"
          >
            <VolumeX size={15} />
            <span className="hidden sm:inline">Silence</span>
          </button>
        </div>
      </div>

      {/* ─── 2. SUMMARY METRIC PILLS ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        {/* 1. Past Grace Exceeded */}
        <div
          onClick={() => setSelectedTab('critical')}
          className={`p-4 rounded-3xl border transition-all cursor-pointer select-none ${
            selectedTab === 'critical'
              ? 'bg-purple-900 text-white border-purple-950 shadow-md ring-2 ring-purple-400/50'
              : 'bg-purple-50/60 hover:bg-purple-50 text-purple-950 border-purple-200 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider opacity-80">
              Late Past Grace (+15m)
            </span>
            <AlertTriangle size={16} className={pastGraceRooms.length > 0 ? 'text-purple-400 animate-pulse' : 'opacity-40'} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display font-black text-3xl tracking-tight">
              {pastGraceRooms.length}
            </span>
            <span className="text-xs font-mono opacity-70">apartments</span>
          </div>
          <p className="text-[10px] font-mono mt-1 opacity-70">
            {pastGraceRooms.length > 0 ? 'Exceeded 15m grace window' : 'No late apartments'}
          </p>
        </div>

        {/* 2. Checkout Time Reached */}
        <div
          onClick={() => setSelectedTab('checkout')}
          className={`p-4 rounded-3xl border transition-all cursor-pointer select-none ${
            selectedTab === 'checkout'
              ? 'bg-rose-700 text-white border-rose-800 shadow-md ring-2 ring-rose-400/50'
              : 'bg-rose-50/60 hover:bg-rose-50 text-rose-950 border-rose-200 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider opacity-80">
              Checkout Reached
            </span>
            <Clock size={16} className={checkoutGraceRooms.length > 0 ? 'text-rose-400 animate-pulse' : 'opacity-40'} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display font-black text-3xl tracking-tight">
              {checkoutGraceRooms.length}
            </span>
            <span className="text-xs font-mono opacity-70">apartments</span>
          </div>
          <p className="text-[10px] font-mono mt-1 opacity-70">
            {checkoutGraceRooms.length > 0 ? 'Currently in 15m grace period' : 'None at checkout'}
          </p>
        </div>

        {/* 3. Approaching Checkout */}
        <div
          onClick={() => setSelectedTab('warning')}
          className={`p-4 rounded-3xl border transition-all cursor-pointer select-none ${
            selectedTab === 'warning'
              ? 'bg-amber-600 text-white border-amber-700 shadow-md ring-2 ring-amber-400/50'
              : 'bg-amber-50/60 hover:bg-amber-50 text-amber-950 border-amber-200 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider opacity-80">
              Warning (&lt; 15 Mins)
            </span>
            <Radio size={16} className={warningRooms.length > 0 ? 'text-amber-300 animate-pulse' : 'opacity-40'} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display font-black text-3xl tracking-tight">
              {warningRooms.length}
            </span>
            <span className="text-xs font-mono opacity-70">apartments</span>
          </div>
          <p className="text-[10px] font-mono mt-1 opacity-70">
            {warningRooms.length > 0 ? 'Expiring in next 15 minutes' : 'None expiring soon'}
          </p>
        </div>

        {/* 4. Snoozed Alerts */}
        <div
          onClick={() => setSelectedTab('snoozed')}
          className={`p-4 rounded-3xl border transition-all cursor-pointer select-none ${
            selectedTab === 'snoozed'
              ? 'bg-primary text-white border-primary shadow-md ring-2 ring-primary/50'
              : 'bg-white hover:bg-[#F2EEE9] text-charcoal border-[#E1DAD0] shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider opacity-80">
              Snoozed Alerts
            </span>
            <BellOff size={16} className={snoozedEntries.length > 0 ? 'text-amber-400' : 'opacity-40'} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display font-black text-3xl tracking-tight">
              {snoozedEntries.length}
            </span>
            <span className="text-xs font-mono opacity-70">paused</span>
          </div>
          <p className="text-[10px] font-mono mt-1 opacity-70">
            {snoozedEntries.length > 0 ? 'Will re-alert upon timer expiry' : 'No paused alerts'}
          </p>
        </div>
      </div>

      {/* ─── 3. CATEGORY TABS BAR ────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-[#E1DAD0] pb-2 overflow-x-auto gap-2">
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setSelectedTab('all')}
            className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              selectedTab === 'all'
                ? 'bg-primary text-white shadow-xs'
                : 'bg-white text-charcoal/70 hover:bg-[#F2EEE9] border border-[#E1DAD0]'
            }`}
          >
            <span>All Alerts &amp; Expiring</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
              selectedTab === 'all' ? 'bg-white/20 text-white' : 'bg-charcoal/10 text-charcoal'
            }`}>
              {urgentRooms.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedTab('critical')}
            className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              selectedTab === 'critical'
                ? 'bg-purple-900 text-white shadow-xs'
                : 'bg-white text-purple-900 hover:bg-purple-50 border border-purple-200'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-purple-500 animate-ping" />
            <span>Past Grace (+15m)</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
              selectedTab === 'critical' ? 'bg-white/20 text-white' : 'bg-purple-100 text-purple-900'
            }`}>
              {pastGraceRooms.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedTab('checkout')}
            className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              selectedTab === 'checkout'
                ? 'bg-rose-700 text-white shadow-xs'
                : 'bg-white text-rose-900 hover:bg-rose-50 border border-rose-200'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            <span>Checkout Reached</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
              selectedTab === 'checkout' ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-900'
            }`}>
              {checkoutGraceRooms.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedTab('warning')}
            className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              selectedTab === 'warning'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'bg-white text-amber-900 hover:bg-amber-50 border border-amber-200'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span>Warning (&lt;15m)</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
              selectedTab === 'warning' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-900'
            }`}>
              {warningRooms.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedTab('snoozed')}
            className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              selectedTab === 'snoozed'
                ? 'bg-primary text-white shadow-xs'
                : 'bg-white text-charcoal/70 hover:bg-[#F2EEE9] border border-[#E1DAD0]'
            }`}
          >
            <BellOff size={14} />
            <span>Snoozed</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
              selectedTab === 'snoozed' ? 'bg-white/20 text-white' : 'bg-charcoal/10 text-charcoal'
            }`}>
              {snoozedEntries.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedTab('history')}
            className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              selectedTab === 'history'
                ? 'bg-primary text-white shadow-xs'
                : 'bg-white text-charcoal/70 hover:bg-[#F2EEE9] border border-[#E1DAD0]'
            }`}
          >
            <History size={14} />
            <span>Session Log</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
              selectedTab === 'history' ? 'bg-white/20 text-white' : 'bg-charcoal/10 text-charcoal'
            }`}>
              {notificationHistory.length}
            </span>
          </button>
        </div>

        {onBackToDashboard && (
          <button
            type="button"
            onClick={onBackToDashboard}
            className="px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold text-primary hover:bg-primary/10 transition flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <span>Back to Grid</span>
            <ArrowRight size={13} />
          </button>
        )}
      </div>

      {/* ─── 4. MAIN CONTENT AREA: CARDS / SNOOZES / LOGS ────────────────── */}
      <AnimatePresence mode="wait">
        {selectedTab === 'snoozed' ? (
          /* Snoozed Alarms Section */
          <motion.div
            key="tab-snoozed"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono text-charcoal/60">
                <BellOff size={15} />
                <span>Currently Active Snoozed Alarms ({snoozedEntries.length})</span>
              </div>
              {snoozedEntries.length > 0 && (
                <button
                  type="button"
                  onClick={onClearAllSnoozes}
                  className="text-xs font-mono font-bold text-rose-700 hover:text-rose-900 underline cursor-pointer"
                >
                  Clear All Snoozes
                </button>
              )}
            </div>

            {snoozedEntries.length === 0 ? (
              <div className="bg-white/60 border border-dashed border-[#E1DAD0] rounded-3xl p-12 text-center">
                <BellOff size={40} className="text-charcoal/30 mx-auto mb-3" />
                <h3 className="font-display font-bold text-charcoal/80 text-sm">No Active Snoozed Alarms</h3>
                <p className="text-xs font-mono text-charcoal/50 mt-1">
                  When you snooze an alarm for 5m or 10m, it will count down and appear here.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {snoozedEntries.map(([key, item]) => {
                  const remainingSecs = Math.max(0, Math.ceil((item.snoozedUntil - currentTime) / 1000));
                  const mins = Math.floor(remainingSecs / 60);
                  const secs = remainingSecs % 60;

                  return (
                    <div
                      key={key}
                      className="bg-amber-50/80 border-2 border-amber-300 rounded-3xl p-5 flex flex-col justify-between gap-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-display font-black text-2xl text-amber-950">
                              Apt {item.roomNumber}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-amber-200 text-amber-900 border border-amber-300">
                              {item.type}
                            </span>
                          </div>
                          <p className="text-xs font-sans text-charcoal/80 mt-1 line-clamp-2">
                            {item.message}
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-[10px] font-mono uppercase font-bold text-amber-800">
                            Re-alerts In
                          </span>
                          <div className="font-mono font-black text-lg text-amber-950">
                            {mins}m {secs < 10 ? `0${secs}` : secs}s
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-amber-200/80 pt-3 gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectRoom(item.roomNumber)}
                          className="px-3 py-1.5 rounded-xl font-mono text-xs font-bold bg-white hover:bg-amber-100 text-amber-950 border border-amber-300 transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <DoorOpen size={14} />
                          <span>Open Room</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onWakeSnoozedAlarm(key)}
                          className="px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold bg-amber-500 hover:bg-amber-400 text-amber-950 shadow-xs transition cursor-pointer flex items-center gap-1.5 active:scale-95"
                        >
                          <Bell size={14} />
                          <span>Wake Now</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        ) : selectedTab === 'history' ? (
          /* Session Log History Section */
          <motion.div
            key="tab-history"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono text-charcoal/60">
                <History size={15} />
                <span>Triggered Notifications During This Session ({notificationHistory.length})</span>
              </div>
              {notificationHistory.length > 0 && onClearHistory && (
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="text-xs font-mono font-bold text-charcoal/50 hover:text-charcoal underline cursor-pointer"
                >
                  Clear History Log
                </button>
              )}
            </div>

            {notificationHistory.length === 0 ? (
              <div className="bg-white/60 border border-dashed border-[#E1DAD0] rounded-3xl p-12 text-center">
                <History size={40} className="text-charcoal/30 mx-auto mb-3" />
                <h3 className="font-display font-bold text-charcoal/80 text-sm">No Notification Logs Yet</h3>
                <p className="text-xs font-mono text-charcoal/50 mt-1">
                  Automatic warning bells and checkout chimes will be logged chronologically here.
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-3xl border border-[#E1DAD0] shadow-sm divide-y divide-[#E1DAD0]/70 overflow-hidden">
                {notificationHistory.map((item) => {
                  const isGrace = item.type === 'grace';
                  const isCheckout = item.type === 'checkout';
                  const isWarning = item.type === 'warning';

                  return (
                    <div
                      key={item.id}
                      className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F2EEE9]/40 transition"
                    >
                      <div className="flex items-start gap-3.5">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-mono font-black text-xs shrink-0 ${
                          isGrace
                            ? 'bg-purple-100 text-purple-900 border border-purple-300'
                            : isCheckout
                            ? 'bg-rose-100 text-rose-900 border border-rose-300'
                            : isWarning
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : 'bg-charcoal/10 text-charcoal'
                        }`}>
                          {item.roomNumber}
                        </div>

                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-sans font-bold text-sm text-charcoal">
                              {item.title || `Apartment ${item.roomNumber}`}
                            </span>
                            <span className={`px-2 py-0.2 rounded text-[9px] font-mono font-extrabold uppercase ${
                              isGrace
                                ? 'bg-purple-100 text-purple-900'
                                : isCheckout
                                ? 'bg-rose-100 text-rose-900'
                                : 'bg-amber-100 text-amber-900'
                            }`}>
                              {item.type}
                            </span>
                          </div>
                          <p className="text-xs font-sans text-charcoal/70 mt-0.5">
                            {item.message}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 self-end sm:self-auto">
                        <span className="text-xs font-mono text-charcoal/50">
                          {item.timestamp}
                        </span>
                        <button
                          type="button"
                          onClick={() => onSelectRoom(item.roomNumber)}
                          className="p-2 rounded-xl bg-[#F2EEE9] hover:bg-white text-primary border border-[#E1DAD0] transition text-xs font-mono font-bold flex items-center gap-1 cursor-pointer"
                          title="Open room details"
                        >
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        ) : (
          /* Urgent & Expiring Room Cards Section */
          <motion.div
            key={`tab-${selectedTab}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {(() => {
              const displayList =
                selectedTab === 'critical'
                  ? urgentRooms.filter((u) => u.category === 'grace')
                  : selectedTab === 'checkout'
                  ? urgentRooms.filter((u) => u.category === 'checkout')
                  : selectedTab === 'warning'
                  ? urgentRooms.filter((u) => u.category === 'warning')
                  : urgentRooms;

              if (displayList.length === 0) {
                return (
                  <div className="bg-white/80 border border-dashed border-[#E1DAD0] rounded-3xl p-16 text-center shadow-xs">
                    <CheckCircle2 size={48} className="text-emerald-500 mx-auto mb-3" />
                    <h3 className="font-display font-black text-charcoal text-base">
                      {selectedTab === 'critical'
                        ? 'No Apartments Past Grace Period'
                        : selectedTab === 'checkout'
                        ? 'No Apartments at Exact Checkout'
                        : selectedTab === 'warning'
                        ? 'No Apartments Expiring in < 15 Mins'
                        : 'All Apartments On Schedule'}
                    </h3>
                    <p className="text-xs font-mono text-charcoal/50 mt-1 max-w-md mx-auto">
                      All currently checked-in guests have comfortable time remaining on their stays.
                      Automatic alerts will trigger when an apartment enters the 15-minute checkout window.
                    </p>
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {displayList.map(({ room, category, statusText, urgencyLabel }) => {
                    const isGrace = category === 'grace';
                    const isCheckout = category === 'checkout';
                    const isWarning = category === 'warning';

                    // Compute charges/food orders
                    const pendingFoodOrders = room.chargedFood || [];
                    const foodTotal = pendingFoodOrders.reduce(
                      (sum, o) => sum + o.item.price * o.quantity,
                      0
                    );

                    return (
                      <div
                        key={room.number}
                        className={`rounded-3xl p-5 border-2 transition-all flex flex-col justify-between gap-4 shadow-xs hover:shadow-md ${
                          isGrace
                            ? 'bg-purple-50/70 border-purple-600 ring-1 ring-purple-400/30'
                            : isCheckout
                            ? 'bg-rose-50/70 border-rose-500 ring-1 ring-rose-400/30'
                            : 'bg-amber-50/70 border-amber-400 ring-1 ring-amber-300/30'
                        }`}
                      >
                        {/* Top: Room Number, Tier, Urgency Badge */}
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-display font-black text-3xl text-charcoal tracking-tight leading-none">
                                {room.number}
                              </span>
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-white/80 border border-[#E1DAD0] text-charcoal">
                                {getTierDisplayName(room.tier)}
                              </span>
                            </div>
                            <span className="text-[10px] font-mono uppercase font-semibold text-charcoal/50 mt-1 block">
                              {room.roomType}
                            </span>
                          </div>

                          <div className="flex flex-col items-end gap-1">
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-black uppercase tracking-wider shadow-2xs ${
                              isGrace
                                ? 'bg-purple-900 text-white animate-pulse'
                                : isCheckout
                                ? 'bg-rose-700 text-white animate-pulse'
                                : 'bg-amber-500 text-amber-950 font-black animate-pulse'
                            }`}>
                              {urgencyLabel}
                            </span>
                          </div>
                        </div>

                        {/* Mid: Guest & Time Details */}
                        <div className="bg-white/90 rounded-2xl p-3 border border-[#E1DAD0]/70 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5 font-bold text-charcoal truncate">
                              <User size={13} className="text-charcoal/40 shrink-0" />
                              <span className="truncate">{room.guestName || room.label}</span>
                            </div>
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#F2EEE9] text-charcoal shrink-0">
                              {room.rateSelected ? room.rateSelected.toUpperCase() : 'STANDARD'}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1 border-t border-[#E1DAD0]/40">
                            <div>
                              <span className="text-charcoal/40 text-[9px] uppercase block">Check-In</span>
                              <span className="font-bold text-charcoal">
                                {room.checkInTime ? new Date(room.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--'}
                              </span>
                            </div>
                            <div>
                              <span className="text-charcoal/40 text-[9px] uppercase block">Scheduled Checkout</span>
                              <span className="font-bold text-charcoal">
                                {room.checkOutTime ? new Date(room.checkOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--'}
                              </span>
                            </div>
                          </div>

                          {/* Live Ticking Countdown Pill */}
                          <div className={`p-2 rounded-xl flex items-center justify-between gap-2 font-mono text-xs font-black ${
                            isGrace
                              ? 'bg-purple-100 text-purple-950 border border-purple-300'
                              : isCheckout
                              ? 'bg-rose-100 text-rose-950 border border-rose-300'
                              : 'bg-amber-100 text-amber-950 border border-amber-300'
                          }`}>
                            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
                              <Clock size={13} />
                              {isGrace ? 'Late Overdue' : isCheckout ? 'Grace Elapsed' : 'Time Left'}
                            </span>
                            <span className="text-sm font-black">
                              {statusText}
                            </span>
                          </div>

                          {/* Food orders preview if any */}
                          {foodTotal > 0 && (
                            <div className="flex items-center justify-between text-[10px] font-mono text-amber-900 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200">
                              <span className="flex items-center gap-1">
                                <Coffee size={11} /> Unpaid F&amp;B Orders:
                              </span>
                              <span className="font-bold">₱{foodTotal.toLocaleString()}</span>
                            </div>
                          )}
                        </div>

                        {/* Bottom Action Buttons */}
                        <div className="flex flex-col gap-2 pt-1 border-t border-charcoal/10">
                          <div className="flex items-center gap-1.5">
                            {/* Snooze 5m */}
                            <button
                              type="button"
                              onClick={() => handleQuickSnooze(room.number, category, 5)}
                              className="flex-1 py-1.5 px-2 rounded-xl font-mono text-[11px] font-bold bg-white hover:bg-amber-100 text-charcoal/80 border border-[#E1DAD0] transition flex items-center justify-center gap-1 cursor-pointer active:scale-95"
                              title="Snooze alert for 5 minutes"
                            >
                              <Clock size={12} />
                              <span>Snooze 5m</span>
                            </button>

                            {/* Snooze 10m */}
                            <button
                              type="button"
                              onClick={() => handleQuickSnooze(room.number, category, 10)}
                              className="py-1.5 px-2.5 rounded-xl font-mono text-[11px] font-bold bg-white hover:bg-amber-100 text-charcoal/80 border border-[#E1DAD0] transition cursor-pointer active:scale-95"
                              title="Snooze alert for 10 minutes"
                            >
                              10m
                            </button>

                            {/* Replay Chime */}
                            <button
                              type="button"
                              onClick={() => playChime(category)}
                              className="p-1.5 rounded-xl bg-white hover:bg-charcoal/5 text-charcoal/70 border border-[#E1DAD0] transition cursor-pointer"
                              title="Play notification chime"
                            >
                              <Volume2 size={14} />
                            </button>
                          </div>

                          {/* Primary: Open Room Detail Sidebar for Checkout / Stay Extension */}
                          <button
                            type="button"
                            onClick={() => onSelectRoom(room.number)}
                            className="w-full py-2 px-3 rounded-xl font-mono text-xs font-bold text-white bg-primary hover:bg-primary-light transition flex items-center justify-center gap-2 shadow-xs cursor-pointer active:scale-98"
                          >
                            <DoorOpen size={14} />
                            <span>Open Room &bull; Checkout / Extend</span>
                            <ArrowRight size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default NotificationsCenter;
