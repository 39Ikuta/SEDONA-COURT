/**
 * src/components/KitchenTVDisplay.tsx
 * Queue-based TV display for kitchen staff (optimized for large screens 40-65").
 * Displays orders organized by ROOM QUEUE (FIFO: oldest unfulfilled room order first).
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import { RoomQueueGroup, KitchenTVDisplayData, KITCHEN_QUEUE_TIMER_MINUTES } from '../api/kitchen';
import { Clock, Utensils, AlertTriangle, CheckCircle, ChefHat, Sparkles, Wifi, WifiOff } from 'lucide-react';
import { playKitchenChime } from '../utils/audio';

interface KitchenTVDisplayProps {
  onClose?: () => void;
}

export const KitchenTVDisplay: React.FC<KitchenTVDisplayProps> = ({ onClose }) => {
  const [displayData, setDisplayData] = useState<KitchenTVDisplayData | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [nowMs, setNowMs] = useState(Date.now());
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const socketRef = useRef<Socket | null>(null);

  // Update clock & live ticker every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch initial data
  const fetchData = async () => {
    try {
      const res = await fetch('/api/kitchen/tv/display');
      if (res.ok) {
        const data: KitchenTVDisplayData = await res.json();
        setDisplayData(data);
      }
    } catch (err) {
      console.error('Kitchen TV: Failed to fetch data:', err);
    }
  };

  // WebSocket connection for real-time updates
  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionStatus('connected');
      console.log('Kitchen TV: Connected to WebSocket server');
      fetchData();
    });

    socket.on('disconnect', () => {
      setConnectionStatus('disconnected');
    });

    socket.on('kitchen:queue_updated', (newQueue: RoomQueueGroup[]) => {
      setDisplayData(prev => {
        if (!prev) return prev;
        const totalRooms = newQueue.length;
        const totalItems = newQueue.reduce((sum, q) => sum + q.total_items_count, 0);
        const newRooms = newQueue.filter(q => q.overall_status === 'new').length;
        const preparingRooms = newQueue.filter(q => q.overall_status === 'preparing').length;
        const readyRooms = newQueue.filter(q => q.overall_status === 'ready').length;

        return {
          ...prev,
          queue: newQueue,
          summary: {
            total_rooms_in_queue: totalRooms,
            total_items_pending: totalItems,
            new_rooms: newRooms,
            preparing_rooms: preparingRooms,
            ready_rooms: readyRooms,
          },
        };
      });
    });

    socket.on('kitchen:new_order', () => {
      fetchData();
      playKitchenChime();
    });

    socket.on('kitchen:order_updated', () => {
      fetchData();
    });

    socket.on('kitchen:order_completed', () => {
      fetchData();
    });

    fetchData();
    // High-frequency 4s auto-refresh so incoming orders appear instantly
    const interval = setInterval(fetchData, 4000);

    return () => {
      clearInterval(interval);
      socket.disconnect();
    };
  }, []);

  const formatTime = (time: Date) => {
    return time.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  const parseTimestamp = (ts: string) => {
    if (!ts) return Date.now();
    if (typeof ts === 'string' && ts.includes(' ') && !ts.includes('T')) {
      ts = ts.replace(' ', 'T') + 'Z';
    }
    const t = new Date(ts).getTime();
    return isNaN(t) ? Date.now() : t;
  };

  // Filter out any locally expired tickets (> queue timer window)
  const rawQueue = displayData?.queue || [];
  const queue = rawQueue.filter((group) => {
    const orderedMs = parseTimestamp(group.oldest_ordered_at);
    const elapsedSec = Math.max(0, Math.floor((nowMs - orderedMs) / 1000));
    return elapsedSec < KITCHEN_QUEUE_TIMER_MINUTES * 60;
  });

  const summary = displayData?.summary || {
    total_rooms_in_queue: queue.length,
    total_items_pending: queue.reduce((sum, q) => sum + q.total_items_count, 0),
    new_rooms: queue.filter(q => q.overall_status === 'new').length,
    preparing_rooms: queue.filter(q => q.overall_status === 'preparing').length,
    ready_rooms: queue.filter(q => q.overall_status === 'ready').length,
  };

  if (!displayData && connectionStatus === 'connecting') {
    return (
      <div className="h-screen w-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-7xl mb-6 animate-bounce">🍳</div>
          <h1 className="text-4xl font-black tracking-tight mb-2">SEDONA COURT KITCHEN DISPLAY</h1>
          <p className="text-xl text-slate-400">Connecting to order queue...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-slate-950 text-white flex flex-col overflow-hidden font-sans select-none">
      {/* Top Header Bar */}
      <header className="bg-slate-900/90 border-b border-slate-800 px-8 py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 font-bold text-2xl">
            🍳
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black tracking-tight text-white uppercase">
                Sedona Court Kitchen
              </h1>
              <span className="text-[10px] font-mono font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full">
                Room Order Queue
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">Real-Time Kitchen Display System (FIFO)</p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              title="Return to Orders Queue Board"
              className="ml-4 flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-mono font-bold transition cursor-pointer border border-slate-700"
            >
              <Utensils size={13} />
              <span>Exit TV Mode</span>
            </button>
          )}
        </div>

        {/* Live Metrics */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700 px-4 py-2 rounded-xl">
            <span className="text-xs font-bold text-slate-400 uppercase">Rooms in Queue:</span>
            <span className="text-2xl font-mono font-black text-amber-400">{summary.total_rooms_in_queue}</span>
          </div>

          <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700 px-4 py-2 rounded-xl">
            <span className="text-xs font-bold text-slate-400 uppercase">Total Items:</span>
            <span className="text-2xl font-mono font-black text-emerald-400">{summary.total_items_pending}</span>
          </div>

          {/* Clock & Status */}
          <div className="text-right pl-4 border-l border-slate-800">
            <div className="text-2xl font-mono font-black text-white">{formatTime(currentTime)}</div>
            <div className="flex items-center justify-end gap-1.5 text-xs">
              {connectionStatus === 'connected' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  <span className="text-emerald-400 font-bold font-mono">LIVE FEED</span>
                </>
              ) : (
                <>
                  <WifiOff size={12} className="text-rose-500" />
                  <span className="text-rose-400 font-bold font-mono">RECONNECTING...</span>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Queue Content Area */}
      <main className="flex-1 p-6 overflow-y-auto">
        {queue.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-12">
            <div className="w-28 h-28 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center text-5xl mb-6 shadow-inner">
              ✨
            </div>
            <h2 className="text-3xl font-black text-white tracking-tight mb-2">No Active Room Orders</h2>
            <p className="text-base text-slate-500 max-w-md">
              The kitchen queue is completely clear. Incoming room meal orders will appear here automatically in order of arrival.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            <AnimatePresence mode="popLayout">
              {queue.map((group) => (
                <RoomQueueCard key={group.room_number} group={group} nowMs={nowMs} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      {/* Bottom Summary Strip */}
      <footer className="bg-slate-900/90 border-t border-slate-800 px-8 py-3 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-1.5 font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span>{summary.new_rooms} New</span>
          </span>
          <span className="flex items-center gap-1.5 font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span>{summary.preparing_rooms} Preparing</span>
          </span>
          <span className="flex items-center gap-1.5 font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span>{summary.ready_rooms} Ready for Delivery</span>
          </span>
        </div>

        <div className="flex items-center gap-4 font-mono text-[11px]">
          <span className="flex items-center gap-1 text-amber-400 font-bold">
            <Clock size={12} /> 30-Min Timer Auto-Expiry Active
          </span>
          <span>&bull;</span>
          <span>FIFO Queue</span>
          <span>&bull;</span>
          <span className="text-emerald-400 font-bold">Live Auto-Refresh (4s)</span>
        </div>
      </footer>
    </div>
  );
};

interface RoomQueueCardProps {
  group: RoomQueueGroup;
  nowMs: number;
}

const parseCardTimestamp = (ts: string) => {
  if (!ts) return Date.now();
  if (typeof ts === 'string' && ts.includes(' ') && !ts.includes('T')) {
    ts = ts.replace(' ', 'T') + 'Z';
  }
  const t = new Date(ts).getTime();
  return isNaN(t) ? Date.now() : t;
};

const RoomQueueCard: React.FC<RoomQueueCardProps> = ({ group, nowMs }) => {
  const orderedMs = parseCardTimestamp(group.oldest_ordered_at);
  const elapsedSec = Math.max(0, Math.floor((nowMs - orderedMs) / 1000));
  const totalSec = KITCHEN_QUEUE_TIMER_MINUTES * 60; // 30-min queue window
  const remainSec = Math.max(0, totalSec - elapsedSec);
  const percentRemaining = Math.max(0, Math.min(100, (remainSec / totalSec) * 100));

  const isUrgent = remainSec <= 180; // Under 3 mins left
  const isWarning = remainSec <= 420 && remainSec > 180; // Between 3 and 7 mins left

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getUrgencyStyles = () => {
    if (isUrgent) {
      return {
        cardBg: 'bg-red-950/40 border-red-500/60 shadow-red-950/50',
        badgeBg: 'bg-red-500 text-white font-bold',
        headerBg: 'bg-red-900/30 border-red-500/30',
        timerText: 'text-red-400 font-black',
      };
    }
    if (isWarning) {
      return {
        cardBg: 'bg-amber-950/30 border-amber-500/50 shadow-amber-950/40',
        badgeBg: 'bg-amber-500 text-slate-950 font-bold',
        headerBg: 'bg-amber-900/30 border-amber-500/30',
        timerText: 'text-amber-400 font-bold',
      };
    }
    return {
      cardBg: 'bg-slate-900/80 border-slate-800 shadow-slate-950/50',
      badgeBg: 'bg-slate-800 text-slate-300 font-medium',
      headerBg: 'bg-slate-850 border-slate-800',
      timerText: 'text-slate-400 font-medium',
    };
  };

  const getStatusBadge = () => {
    switch (group.overall_status) {
      case 'ready':
        return (
          <span className="flex items-center gap-1 bg-blue-500/20 text-blue-300 border border-blue-500/40 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider">
            <CheckCircle size={12} /> Ready
          </span>
        );
      case 'preparing':
        return (
          <span className="flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider animate-pulse">
            <ChefHat size={12} /> Cooking
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider">
            <Sparkles size={12} /> New Order
          </span>
        );
    }
  };

  const styles = getUrgencyStyles();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: -20 }}
      transition={{ duration: 0.25 }}
      className={`rounded-3xl border-2 ${styles.cardBg} shadow-2xl flex flex-col justify-between overflow-hidden relative`}
    >
      {/* 15-Min Timer Countdown Progress Bar */}
      <div className="w-full bg-slate-950 h-2 overflow-hidden">
        <div
          className={`h-full transition-all duration-1000 ease-linear ${
            isUrgent ? 'bg-red-500 animate-pulse' : isWarning ? 'bg-amber-500' : 'bg-emerald-500'
          }`}
          style={{ width: `${percentRemaining}%` }}
        />
      </div>

      {/* Ticket Print Failure Banner */}
      {group.orders?.some((o) => o.print_status === 'failed') && (
        <div className="bg-red-600 text-white font-mono text-[11px] font-bold px-4 py-1.5 flex items-center justify-between gap-1 animate-pulse border-b border-red-700">
          <span className="flex items-center gap-1.5">
            <AlertTriangle size={13} className="shrink-0" />
            <span>⚠️ TICKET PRINT FAILED — WRITE DOWN ORDER</span>
          </span>
          <span className="text-[9px] uppercase bg-black/40 px-1.5 py-0.5 rounded font-bold">Manual Slip</span>
        </div>
      )}

      {/* Top Header */}
      <div className={`p-5 ${styles.headerBg} border-b flex items-start justify-between gap-3`}>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-black px-2 py-0.5 rounded-md bg-amber-500 text-slate-950">
              #{group.queue_position}
            </span>
            <h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <span>{group.room_number === 'WALK-IN' ? 'Walk-In Guest' : group.room_number === '12' ? 'Room 12' : `Room ${group.room_number}`}</span>
              {group.room_number === '12' && (
                <span className="text-xs font-mono font-bold bg-indigo-500/30 text-indigo-300 border border-indigo-500/50 px-2 py-0.5 rounded">
                  STAFF HOUSE
                </span>
              )}
            </h2>
          </div>
          <p className="text-xs text-slate-400 font-medium mt-1 truncate max-w-[180px]">
            {group.room_number === '12' ? 'Staff House Quarters' : (group.guest_name || 'Guest')}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          {getStatusBadge()}
          <span
            className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded-full border flex items-center gap-1 ${
              isUrgent
                ? 'bg-red-500/20 text-red-300 border-red-500/50 animate-pulse'
                : isWarning
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
            }`}
          >
            <Clock size={11} className={isUrgent ? 'animate-spin' : ''} />
            {formatCountdown(remainSec)} {isUrgent ? 'EXPIRING' : 'Left'}
          </span>
        </div>
      </div>

      {/* Meal Items List */}
      <div className="p-5 flex-1 space-y-3">
        <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 font-bold flex items-center justify-between">
          <span>Items Ordered ({group.total_items_count})</span>
          <span>Qty</span>
        </div>

        <div className="space-y-2">
          {group.aggregated_items.map((item, idx) => (
            <div
              key={idx}
              className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 flex items-start justify-between gap-3"
            >
              <div className="flex-1">
                <span className="font-bold text-base text-white leading-snug block">
                  {item.name}
                </span>
                {item.special_instructions && (
                  <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md mt-1 font-medium">
                    📝 {item.special_instructions}
                  </p>
                )}
              </div>
              <span className="font-mono text-lg font-black text-amber-400 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-lg">
                x{item.quantity}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer Info */}
      <div className="px-5 py-3 bg-slate-950/40 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500 font-mono">
        <span>{group.orders.length} order ticket{group.orders.length > 1 ? 's' : ''}</span>
        <span>Ticket #{group.orders.map(o => o.order_number).join(', ')}</span>
      </div>
    </motion.div>
  );
};

export default KitchenTVDisplay;