import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Room, getTierDisplayName } from '../types';
import { 
  KeyRound,
  Users
} from 'lucide-react';
import { getRoomStatusConfig } from '../utils/roomStatus';
import { RoomGridSkeleton } from './ui/Skeleton';

interface RoomGridProps {
  rooms: Room[];
  selectedStatusFilter: string;
  onSelectRoom: (room: Room) => void;
  loading?: boolean;
  onClearFilter?: () => void;
}

export const RoomGrid: React.FC<RoomGridProps> = ({
  rooms,
  selectedStatusFilter,
  onSelectRoom,
  loading = false,
  onClearFilter,
}) => {
  // Apply filters
  const filteredRooms = useMemo(() => {
    const nowMs = Date.now();
    return rooms.filter((room) => {
      if (selectedStatusFilter === 'almost_in_time') {
        if (room.isStaffHouse || room.roomType === 'Staff House' || String(room.number) === '12') return false;
        if ((room.state === 'occupied' || room.state === 'overdue') && room.checkOutTime) {
          const diffMins = (new Date(room.checkOutTime).getTime() - nowMs) / 60000;
          return diffMins <= 15;
        }
        return false;
      }
      const statusMatches = selectedStatusFilter === 'all' || room.state === selectedStatusFilter;
      return statusMatches;
    });
  }, [rooms, selectedStatusFilter]);

  const getTierBadgeColor = (tier: Room['tier']) => {
    switch (tier) {
      case 'Suite':
        return 'bg-purple-100/90 text-purple-800 border-purple-200';
      case 'Deluxe':
        return 'bg-blue-100/90 text-blue-800 border-blue-200';
      case 'Standard':
      default:
        return 'bg-amber-100/90 text-amber-800 border-amber-200';
    }
  };

  const formatRateLabel = (room: Room) => {
    if (room.rateSelected === 'custom' && room.customHours) {
      return `${room.customHours}h Custom`;
    }
    if (room.rateSelected) {
      return room.rateSelected.toUpperCase();
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col gap-6">
        <div className="bg-white px-5 py-3.5 rounded-2xl border border-secondary shadow-xs animate-pulse">
          <div className="h-4 w-48 bg-secondary/40 rounded" />
        </div>
        <RoomGridSkeleton count={12} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-6">
      {/* ─── Legend & Grid Info Panel ───────────────────────────────────── */}
      <div className="bg-white px-5 py-3 rounded-2xl border border-secondary shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 text-xs text-charcoal/70 font-mono">
          <span className="font-bold uppercase text-charcoal/90">Apartment Tiers:</span>
          <span className="flex items-center gap-1.5 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-2xs" /> VIP room
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-2xs" /> Premium room
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-2xs" /> Classic room
          </span>
        </div>

        <div className="text-xs font-mono text-charcoal/60 uppercase">
          Filtered Apartments: <strong className="text-primary font-bold">{filteredRooms.length}</strong> / {rooms.length}
        </div>
      </div>

      {/* ─── Unified 32 Rooms Grid ──────────────────────────────────────── */}
      {filteredRooms.length === 0 ? (
        <div className="bg-white/50 border border-secondary border-dashed rounded-3xl p-16 text-center shadow-xs">
          <KeyRound size={44} className="text-charcoal/30 mx-auto mb-3" />
          <p className="font-display font-bold text-sm text-charcoal/70">No apartments match the applied filters.</p>
          <p className="text-xs text-charcoal/50 font-mono mt-1">Try selecting a different status filter or clear all filters.</p>
          {onClearFilter && (
            <button
              onClick={onClearFilter}
              className="text-xs text-primary underline font-bold mt-3 cursor-pointer hover:text-primary-light transition"
            >
              Show all apartments
            </button>
          )}
        </div>
      ) : (
        <motion.div
          layout
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"
        >
          <AnimatePresence mode="popLayout">
            {filteredRooms.map((room) => {
              const config = getRoomStatusConfig(room);
              const StatusIcon = config.icon;
              const isRoom12 = room.isStaffHouse || room.roomType === 'Staff House' || String(room.number) === '12';
              const isOccupied = room.state === 'occupied' || room.state === 'overdue';
              const rateLabel = formatRateLabel(room);

              return (
                <motion.div
                  layout
                  id={`room-card-${room.number}`}
                  key={room.number}
                  tabIndex={0}
                  role="button"
                  aria-label={`Apartment ${room.number}, ${room.roomType}, ${config.label}`}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => onSelectRoom(room)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectRoom(room);
                    }
                  }}
                  className={`border-2 ${config.border} ${config.bg} rounded-2xl p-3.5 cursor-pointer transition-all duration-200 flex flex-col justify-between min-h-[172px] h-auto shadow-xs hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] relative group select-none ${
                    isRoom12 ? 'ring-2 ring-indigo-300 ring-offset-1' : ''
                  }`}
                >
                  {/* Top Bar: Room Number & Tier Badge */}
                  <div className="flex justify-between items-start gap-2 min-w-0">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-display font-black text-2xl text-charcoal tracking-tight leading-none">
                          {room.number}
                        </span>
                        {isRoom12 && (
                          <span className="px-1.5 py-0.2 bg-indigo-600 text-white text-[9px] font-mono font-bold rounded uppercase tracking-wider">
                            STAFF
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] uppercase font-mono font-semibold tracking-wider text-charcoal/50 mt-1">
                        {isRoom12 ? 'Staff Quarters' : 'Apartment'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {room.forceCheckoutPending && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-black bg-rose-600 text-white animate-pulse shadow-xs">
                          ESC
                        </span>
                      )}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${getTierBadgeColor(room.tier)}`}>
                        {getTierDisplayName(room.tier)}
                      </span>
                    </div>
                  </div>

                  {/* Mid: Guest Name & Status Tag Pill */}
                  <div className="my-2 min-w-0">
                    <div className="flex items-center justify-between gap-1.5 mb-1">
                      <h3 className="font-sans font-bold text-xs tracking-tight text-charcoal truncate flex-1 min-w-0">
                        {isRoom12 
                          ? 'Housekeeping Staff' 
                          : room.state === 'available' 
                          ? 'Available' 
                          : (room.guestName || room.label)}
                      </h3>

                      {isOccupied && rateLabel && !isRoom12 && (
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                          {rateLabel}
                        </span>
                      )}

                      {config.isUrgent && (
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider shrink-0 whitespace-nowrap ${config.tagBg}`}>
                          {config.label}
                        </span>
                      )}

                      {isRoom12 && (
                        (() => {
                          const staffOrdersTotal = room.chargedFood?.reduce((sum, f) => sum + f.item.price * f.quantity, 0) || 0;
                          return staffOrdersTotal > 0 ? (
                            <span className="text-[10px] font-mono font-extrabold text-indigo-800 bg-indigo-100/90 border border-indigo-200 px-1.5 py-0.5 rounded shrink-0">
                              ₱{staffOrdersTotal.toLocaleString()} Orders
                            </span>
                          ) : null;
                        })()
                      )}
                    </div>

                    <p className="text-[10px] font-mono font-semibold text-charcoal/50 uppercase tracking-widest truncate">
                      {isRoom12 ? 'Free Housing • Staff Tab' : room.roomType}
                    </p>
                  </div>

                  {/* Bottom: State Indicator & Timer */}
                  <div className="flex items-center justify-between border-t border-secondary/30 pt-2 gap-1.5 min-w-0">
                    <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold tracking-wider uppercase min-w-0 shrink">
                      <StatusIcon size={14} className={`${config.text} shrink-0`} />
                      <span className={`${config.text} truncate whitespace-nowrap min-w-0`} title={config.label}>
                        {config.label}
                      </span>
                    </span>

                    <span className={`font-mono text-[10px] px-2 py-0.5 rounded-full border shrink-0 whitespace-nowrap font-extrabold ${config.timeClass}`}>
                      {isRoom12 ? 'QUARTERS' : room.time}
                    </span>
                  </div>

                  {/* Corner indicator circle */}
                  <div className={`absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full ${config.indicator} hidden`} />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
};
