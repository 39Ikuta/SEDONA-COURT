import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { socket } from '../api/socket';
import {
  RoomQueueGroup,
  KitchenOrder,
  getKitchenQueue,
  updateRoomOrdersStatus,
  cleanupStaleOrders,
  KITCHEN_QUEUE_TIMER_MINUTES,
} from '../api/kitchen';
import { useToast } from './ui/Toast';
import {
  Clock,
  ChefHat,
  PackageCheck,
  RefreshCw,
  Wifi,
  WifiOff,
  Check,
  Search,
  Sparkles,
  Tv,
  AlertTriangle,
} from 'lucide-react';
import { playKitchenChime } from '../utils/audio';
import { getCurrentInventory, InventoryItem } from '../api/inventory';

interface KitchenStaffViewProps {
  loggedInUser?: string;
  onSwitchToTV?: () => void;
}

export const KitchenStaffView: React.FC<KitchenStaffViewProps> = ({ loggedInUser, onSwitchToTV }) => {
  const toast = useToast();
  const [queue, setQueue] = useState<RoomQueueGroup[]>([]);
  const [outOfStockItems, setOutOfStockItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'new' | 'preparing' | 'ready'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [nowMs, setNowMs] = useState(Date.now());

  const fetchQueue = async () => {
    try {
      const data = await getKitchenQueue();
      setQueue(data);
      setLastRefresh(new Date());

      // Fetch stock availability for 86'd items
      getCurrentInventory()
        .then((res) => {
          setOutOfStockItems(res.items.filter((i) => i.is_tracked && i.current_quantity === 0));
        })
        .catch(() => {});
    } catch (err) {
      console.error('Failed to fetch kitchen queue:', err);
    } finally {
      setLoading(false);
    }
  };

  // 1-second live ticker for smooth countdown timers
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    fetchQueue();

    const handleConnect = () => {
      setWsStatus('connected');
      socket.emit('kitchen:join');
    };

    const handleDisconnect = () => {
      setWsStatus('disconnected');
    };

    const handleQueueUpdated = (updatedQueue: RoomQueueGroup[]) => {
      setQueue(updatedQueue);
      setLastRefresh(new Date());
    };

    const handleNewOrder = () => {
      fetchQueue();
      playKitchenChime();
    };

    const handleOrderUpdated = () => {
      fetchQueue();
    };

    const handleOrderCompleted = () => {
      fetchQueue();
    };

    if (socket.connected) {
      setWsStatus('connected');
      socket.emit('kitchen:join');
    }

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('kitchen:queue_updated', handleQueueUpdated);
    socket.on('kitchen:new_order', handleNewOrder);
    socket.on('kitchen:order_updated', handleOrderUpdated);
    socket.on('kitchen:order_completed', handleOrderCompleted);

    // High-frequency 4s auto-refresh so all newly input room orders appear immediately
    const interval = setInterval(fetchQueue, 4000);

    return () => {
      clearInterval(interval);
      socket.emit('kitchen:leave');
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('kitchen:queue_updated', handleQueueUpdated);
      socket.off('kitchen:new_order', handleNewOrder);
      socket.off('kitchen:order_updated', handleOrderUpdated);
      socket.off('kitchen:order_completed', handleOrderCompleted);
    };
  }, []);

  const handleUpdateRoomStatus = async (roomNumber: string, nextStatus: KitchenOrder['status']) => {
    setActionLoading(roomNumber);
    try {
      await updateRoomOrdersStatus(roomNumber, nextStatus);
      await fetchQueue();
    } catch (err) {
      console.error('Failed to update room status:', err);
      toast.error('Update Failed', 'Failed to update status. Please try again.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCleanupStale = async () => {
    try {
      const res = await cleanupStaleOrders(KITCHEN_QUEUE_TIMER_MINUTES);
      if (res.cleanedCount > 0) {
        toast.success('Cleanup Complete', `Cleaned up ${res.cleanedCount} expired order(s) (older than ${KITCHEN_QUEUE_TIMER_MINUTES} mins).`);
      }
      await fetchQueue();
    } catch (err) {
      console.error('Failed to cleanup stale orders:', err);
    }
  };

  const parseTimestamp = (ts: string) => {
    if (!ts) return Date.now();
    if (typeof ts === 'string' && ts.includes(' ') && !ts.includes('T')) {
      ts = ts.replace(' ', 'T') + 'Z';
    }
    const t = new Date(ts).getTime();
    return isNaN(t) ? Date.now() : t;
  };

  const formatCountdown = (remainSec: number) => {
    const m = Math.floor(remainSec / 60);
    const s = remainSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Filter out any locally expired tickets (> queue timer window) and apply UI search/filter
  const activeQueue = queue.filter((group) => {
    const orderedMs = parseTimestamp(group.oldest_ordered_at);
    const elapsedSec = Math.max(0, Math.floor((nowMs - orderedMs) / 1000));
    return elapsedSec < KITCHEN_QUEUE_TIMER_MINUTES * 60;
  });

  const hasStaleOrders = queue.some((group) => {
    const orderedMs = parseTimestamp(group.oldest_ordered_at);
    const elapsedSec = Math.max(0, Math.floor((nowMs - orderedMs) / 1000));
    return elapsedSec >= KITCHEN_QUEUE_TIMER_MINUTES * 60;
  });

  const filteredQueue = activeQueue.filter((group) => {
    if (filter !== 'all' && group.overall_status !== filter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchRoom = group.room_number.toLowerCase().includes(q);
      const matchGuest = group.guest_name.toLowerCase().includes(q);
      const matchItem = group.aggregated_items.some((i) => i.name.toLowerCase().includes(q));
      if (!matchRoom && !matchGuest && !matchItem) return false;
    }
    return true;
  });

  const totalRooms = activeQueue.length;
  const newCount = activeQueue.filter((q) => q.overall_status === 'new').length;
  const prepCount = activeQueue.filter((q) => q.overall_status === 'preparing').length;
  const readyCount = activeQueue.filter((q) => q.overall_status === 'ready').length;
  const totalItems = activeQueue.reduce((sum, q) => sum + q.total_items_count, 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 sm:p-6 lg:p-8">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 mb-6 shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-mono tracking-widest text-amber-400 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full font-bold">
              Kitchen Terminal Active
            </span>
            <span className={`flex items-center gap-1 text-xs font-mono font-bold ${wsStatus === 'connected' ? 'text-emerald-400' : 'text-slate-500'}`}>
              {wsStatus === 'connected' ? <Wifi size={12} /> : <WifiOff size={12} />}
              {wsStatus === 'connected' ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight mt-2 flex items-center gap-2">
            Kitchen Room Orders Queue
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Orders grouped by room in FIFO sequence. Advance room cooking status to notify front desk and servers.
          </p>
        </div>

        {/* Quick Stats & Controls */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl px-4 py-2.5 text-center">
            <span className="text-[9px] font-mono text-slate-500 uppercase block font-bold">Rooms</span>
            <span className="font-mono text-xl font-black text-white">{totalRooms}</span>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-2.5 text-center">
            <span className="text-[9px] font-mono text-amber-400 uppercase block font-bold">Items</span>
            <span className="font-mono text-xl font-black text-amber-300">{totalItems}</span>
          </div>
          {hasStaleOrders && (
            <button
              onClick={handleCleanupStale}
              title="Auto-archive orders older than 60 minutes"
              className="flex items-center gap-1.5 px-3 py-3 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold transition cursor-pointer"
            >
              <Sparkles size={13} />
              Clear Stale
            </button>
          )}
          {onSwitchToTV && (
            <button
              onClick={onSwitchToTV}
              title="Launch full-screen TV monitor"
              className="flex items-center gap-1.5 px-4 py-3 rounded-2xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-bold transition cursor-pointer border border-amber-500/40"
            >
              <Tv size={14} />
              TV Display
            </button>
          )}
          <button
            onClick={fetchQueue}
            className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer border border-slate-700"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* 86'd Out-of-Stock Items Alert Banner */}
      {outOfStockItems.length > 0 && (
        <div className="mb-6 p-4 rounded-2xl bg-rose-950/60 border border-rose-800 text-rose-200 flex flex-wrap items-center justify-between gap-3 text-xs shadow-lg">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 bg-rose-900/80 rounded-lg text-rose-400">
              <AlertTriangle size={16} />
            </span>
            <div>
              <span className="font-bold text-rose-300 mr-2 uppercase tracking-wide">
                86'D / OUT OF STOCK ({outOfStockItems.length}):
              </span>
              <span className="font-mono text-rose-200">
                {outOfStockItems.map((it) => it.item_name).join(', ')}
              </span>
            </div>
          </div>
          <span className="text-[10px] font-mono uppercase bg-rose-900/80 text-rose-300 px-2.5 py-1 rounded-lg border border-rose-700/60 font-semibold">
            Cashiers blocked from ordering
          </span>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-6 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search by room, guest, or meal item..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 outline-none focus:border-amber-500/60 transition"
          />
        </div>

        {/* Filter Badges */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setFilter('all')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold uppercase transition cursor-pointer ${
              filter === 'all'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            All ({totalRooms})
          </button>
          <button
            onClick={() => setFilter('new')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold uppercase transition cursor-pointer ${
              filter === 'new'
                ? 'bg-emerald-500 text-slate-950'
                : 'bg-slate-950 text-emerald-400 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            New ({newCount})
          </button>
          <button
            onClick={() => setFilter('preparing')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold uppercase transition cursor-pointer ${
              filter === 'preparing'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-950 text-amber-400 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            Cooking ({prepCount})
          </button>
          <button
            onClick={() => setFilter('ready')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold uppercase transition cursor-pointer ${
              filter === 'ready'
                ? 'bg-blue-500 text-slate-950'
                : 'bg-slate-950 text-blue-400 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            Ready ({readyCount})
          </button>
        </div>
      </div>

      {/* Main Queue Cards */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-amber-500/30 border-t-amber-500 animate-spin" />
          <p className="text-slate-400 text-sm font-medium">Loading kitchen queue...</p>
        </div>
      ) : filteredQueue.length === 0 ? (
        <div className="bg-slate-900/50 border border-slate-800 border-dashed rounded-3xl p-16 text-center">
          <ChefHat size={48} className="text-slate-700 mx-auto mb-4" />
          <p className="font-bold text-lg text-slate-400">No active kitchen orders found</p>
          <p className="text-xs text-slate-600 mt-1">
            {searchQuery || filter !== 'all' ? 'Try adjusting your search or filters.' : 'All incoming food orders will show up here.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          <AnimatePresence mode="popLayout">
            {filteredQueue.map((group) => {
              const isActionRunning = actionLoading === group.room_number;
              const orderedMs = parseTimestamp(group.oldest_ordered_at);
              const elapsedSec = Math.max(0, Math.floor((nowMs - orderedMs) / 1000));
              const totalSec = KITCHEN_QUEUE_TIMER_MINUTES * 60; // 30-min queue window
              const remainSec = Math.max(0, totalSec - elapsedSec);
              const percentRemaining = Math.max(0, Math.min(100, (remainSec / totalSec) * 100));

              const isUrgent = remainSec <= 180; // Under 3 mins left
              const isWarning = remainSec <= 420 && remainSec > 180; // Between 3 and 7 mins left

              return (
                <motion.div
                  layout
                  key={group.room_number}
                  initial={{ opacity: 0, scale: 0.95, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -15 }}
                  transition={{ duration: 0.2 }}
                  className={`bg-slate-900 rounded-3xl border-2 overflow-hidden shadow-xl flex flex-col justify-between ${
                    isUrgent
                      ? 'border-red-500/60 shadow-red-950/40'
                      : isWarning
                      ? 'border-amber-500/50 shadow-amber-950/30'
                      : 'border-slate-800'
                  }`}
                >
                  {/* Queue Timer Countdown Progress Bar */}
                  <div className="w-full bg-slate-950 h-1.5 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-1000 ease-linear ${
                        isUrgent ? 'bg-red-500 animate-pulse' : isWarning ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${percentRemaining}%` }}
                    />
                  </div>

                  {/* Card Header */}
                  <div className="p-5 bg-slate-950/60 border-b border-slate-800 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-black px-2 py-0.5 rounded-md bg-amber-500 text-slate-950">
                          #{group.queue_position}
                        </span>
                        <h3 className="text-xl font-black text-white flex items-center gap-1.5">
                          <span>{group.room_number === 'WALK-IN' ? 'Walk-In Guest' : group.room_number === '12' ? 'Room 12' : `Room ${group.room_number}`}</span>
                          {group.room_number === '12' && (
                            <span className="text-[10px] font-mono font-bold bg-indigo-500/30 text-indigo-300 border border-indigo-500/50 px-2 py-0.5 rounded">
                              STAFF HOUSE
                            </span>
                          )}
                        </h3>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 font-medium">{group.room_number === '12' ? 'Staff House Quarters' : (group.guest_name || 'Guest')}</p>
                    </div>

                    <div className="flex flex-col items-end gap-1.5">
                      <span
                        className={`text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded-lg border ${
                          group.overall_status === 'ready'
                            ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                            : group.overall_status === 'preparing'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                            : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        }`}
                      >
                        {group.overall_status === 'ready' ? 'Ready' : group.overall_status === 'preparing' ? 'Cooking' : 'New'}
                      </span>

                      {/* 15-Min Live Timer Badge */}
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



                  {/* Menu Items List */}
                  <div className="p-5 flex-1 space-y-3">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold flex justify-between">
                      <span>Menu Items Ordered</span>
                      <span>Quantity</span>
                    </div>

                    <div className="space-y-2">
                      {group.aggregated_items.map((item, idx) => (
                        <div
                          key={idx}
                          className="bg-slate-950 border border-slate-800/80 rounded-2xl p-3 flex items-start justify-between gap-3"
                        >
                          <div className="flex-1">
                            <span className="font-bold text-sm text-slate-100 block">{item.name}</span>
                            {item.special_instructions && (
                              <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded mt-1">
                                Note: {item.special_instructions}
                              </p>
                            )}
                          </div>
                          <span className="font-mono text-sm font-black text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-lg">
                            x{item.quantity}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex items-center gap-2">
                    {group.overall_status === 'new' && (
                      <button
                        onClick={() => handleUpdateRoomStatus(group.room_number, 'preparing')}
                        disabled={isActionRunning}
                        className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shadow-sm disabled:opacity-50"
                      >
                        <ChefHat size={14} />
                        Start Cooking
                      </button>
                    )}

                    {group.overall_status === 'preparing' && (
                      <button
                        onClick={() => handleUpdateRoomStatus(group.room_number, 'ready')}
                        disabled={isActionRunning}
                        className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shadow-sm disabled:opacity-50"
                      >
                        <Check size={14} />
                        Mark Ready for Pickup
                      </button>
                    )}

                    {group.overall_status === 'ready' && (
                      <button
                        onClick={() => handleUpdateRoomStatus(group.room_number, 'delivered')}
                        disabled={isActionRunning}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shadow-sm disabled:opacity-50"
                      >
                        <PackageCheck size={14} />
                        Complete & Delivered
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export default KitchenStaffView;
