/**
 * src/components/CustomerDisplay.tsx
 * Guest-facing, display-only room availability lobby monitor for Sedona Court Travellers Inn.
 * 
 * STRICT LEAST-PRIVILEGE & ZERO-PII ARCHITECTURE:
 * - Read-only display: rooms are NOT clickable buttons (no actions, no booking, no modals).
 * - Matches Sedona Court PMS light pastel sage/cream aesthetic and room card design.
 * - Fits all 32 rooms on a single monitor viewport (8 columns x 4 rows) with zero scrolling.
 * - Prominently displays the number of available rooms in text.
 * - No Socket.IO firehose: updates via resilient 20s REST polling from /api/display/rooms.
 * - Zero PII: displays only room number, tier badge, room type, and bucketed status.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Hotel,
  Clock,
  Calendar,
  CheckCircle,
  User,
  Users,
  LogOut,
  AlertCircle,
  Sparkles,
  RefreshCw
} from 'lucide-react';
import { getSanitizedRoomAvailability, SanitizedRoomDisplay } from '../api/display';
import { getTierDisplayName } from '../types';

interface CustomerDisplayProps {
  onLogout?: () => void;
}

export const CustomerDisplay: React.FC<CustomerDisplayProps> = ({ onLogout }) => {
  const [rooms, setRooms] = useState<SanitizedRoomDisplay[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Live clock
  useEffect(() => {
    const clockTimer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(clockTimer);
  }, []);

  // Fetch sanitized rooms from API
  const fetchAvailability = async () => {
    try {
      setFetchError(null);
      const data = await getSanitizedRoomAvailability();
      // Ensure sorted 1 to 32
      data.sort((a, b) => parseInt(a.roomNumber, 10) - parseInt(b.roomNumber, 10));
      setRooms(data);
      setLastRefreshed(new Date());
    } catch (err: any) {
      console.warn('Customer display polling warning:', err);
      setFetchError(err.message || 'Unable to sync live room availability');
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load and periodic 20-second polling (Constraint #4: No socket firehose)
  useEffect(() => {
    fetchAvailability();
    const pollInterval = setInterval(() => {
      fetchAvailability();
    }, 20000);

    return () => clearInterval(pollInterval);
  }, []);

  // Availability statistics summary
  const stats = useMemo(() => {
    const total = rooms.length;
    const available = rooms.filter(r => r.status === 'available').length;
    const occupied = rooms.filter(r => r.status === 'occupied').length;
    const unavailable = rooms.filter(r => r.status === 'unavailable').length;
    return { total, available, occupied, unavailable };
  }, [rooms]);

  const formattedDate = currentTime.toLocaleDateString('en-PH', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });

  const formattedTime = currentTime.toLocaleTimeString('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'Asia/Manila',
  });

  const formatCheckInTime = (iso?: string | null) => {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleTimeString('en-PH', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Manila',
      });
    } catch {
      return null;
    }
  };

  const getTierBadgeStyle = (tier: string) => {
    switch (tier) {
      case 'Suite':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'Deluxe':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'Standard':
      default:
        return 'bg-amber-100 text-amber-800 border-amber-200';
    }
  };

  return (
    <div className="h-screen w-screen max-h-screen overflow-hidden bg-[#edf3ed] text-slate-800 flex flex-col justify-between p-2.5 sm:p-3 font-sans select-none">
      {/* ─── Top Header & Available Count Text Banner ───────────────────────── */}
      <header className="bg-white/95 backdrop-blur-md rounded-2xl border border-[#cfe0d1] shadow-xs px-4 py-2 flex flex-col md:flex-row items-center justify-between gap-2.5 shrink-0">
        {/* Hotel Identity */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-800 flex items-center justify-center shadow-xs text-white">
            <Hotel className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-serif font-black tracking-tight text-slate-900 leading-tight">
                Sedona Court Travellers Inn
              </h1>
              <span className="hidden lg:inline-block text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                Lobby Display
              </span>
            </div>
            <p className="text-[10px] text-slate-500 font-mono tracking-wider uppercase">
              Guest Room Availability Directory &bull; Station Reception
            </p>
          </div>
        </div>

        {/* PROMINENT TEXT DISPLAY: Number of Available Rooms */}
        <div className="flex items-center gap-2 bg-[#e8f5eb] border-2 border-emerald-500/40 px-3.5 py-1.5 rounded-xl shadow-xs">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 animate-pulse" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-mono font-bold uppercase text-emerald-900 tracking-wider">
              Available Rooms:
            </span>
            <span className="text-lg font-black font-mono text-emerald-700 leading-none">
              {stats.available}
            </span>
            <span className="text-xs font-bold text-emerald-800">
              of {stats.total} Rooms Available for Check-In
            </span>
          </div>
        </div>

        {/* Live Clock & Exit */}
        <div className="flex items-center gap-2.5 text-xs font-mono">
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 text-[11px]">
            <Calendar className="w-3 h-3 text-slate-500" />
            <span>{formattedDate}</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-xs">
            <Clock className="w-3.5 h-3.5 text-emerald-600" />
            <span className="tracking-widest">{formattedTime}</span>
          </div>

          {onLogout && (
            <button
              onClick={onLogout}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-300 transition cursor-pointer text-[11px] font-semibold"
              title="Staff Exit"
            >
              <LogOut className="w-3 h-3" />
              <span className="hidden md:inline">Exit</span>
            </button>
          )}
        </div>
      </header>

      {/* ─── Main 32-Room Monitor Grid (8 Columns x 4 Rows = Exactly 32 Rooms) ─ */}
      <main className="flex-1 my-2 overflow-hidden flex flex-col justify-center">
        {fetchError && (
          <div className="mb-2 p-2 rounded-xl bg-rose-100 border border-rose-300 text-rose-800 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{fetchError}</span>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <RefreshCw className="w-8 h-8 animate-spin text-emerald-600 mb-2" />
            <p className="text-xs font-mono uppercase tracking-wider">Loading Room Directory...</p>
          </div>
        ) : (
          /*
           * FIT-TO-MONITOR DISPLAY-ONLY GRID
           * 8 columns x 4 rows = 32 apartments. Fits perfectly in 100vh on monitors without scrolling.
           * Non-clickable: rendered as plain display cards without button/pointer actions.
           */
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2 h-full items-stretch">
            {rooms.map((room) => {
              const isAvailable = room.status === 'available';
              const isOccupied = room.status === 'occupied';
              const isRoom12 = room.roomNumber === '12';
              const formattedCheckIn = isOccupied ? formatCheckInTime(room.checkInTime) : null;

              return (
                <div
                  key={room.roomNumber}
                  className={`border-2 rounded-2xl p-2 sm:p-2.5 flex flex-col justify-between transition-all duration-200 select-none shadow-2xs ${
                    isRoom12
                      ? 'bg-[#eff3fd] border-[#cad7f8]'
                      : isAvailable
                      ? 'bg-[#e6efe7] border-[#b8d8c2]'
                      : 'bg-[#fcebeb] border-[#f2b8b8]'
                  }`}
                >
                  {/* Top Bar: Room Number & Tier Badge */}
                  <div className="flex justify-between items-start gap-1 min-w-0">
                    <div className="flex flex-col min-w-0">
                      <span className="font-serif font-black text-xl sm:text-2xl text-slate-900 tracking-tight leading-none">
                        {room.roomNumber}
                      </span>
                      <span className="text-[9px] uppercase font-mono font-bold tracking-wider text-slate-400 leading-tight mt-0.5">
                        Apartment
                      </span>
                    </div>

                    <span
                      className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-md border shrink-0 leading-tight ${getTierBadgeStyle(
                        room.tier
                      )}`}
                    >
                      {getTierDisplayName(room.tier)}
                    </span>
                  </div>

                  {/* Mid: Status & Room Type Label (with Check-in Time if Occupied) */}
                  <div className="my-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <h3 className="font-sans font-bold text-xs tracking-tight text-slate-900 truncate">
                        {isRoom12 ? 'Housekeep' : isAvailable ? 'Available' : 'Occupied'}
                      </h3>
                      {formattedCheckIn && (
                        <span className="text-[9px] font-mono font-bold text-rose-800 bg-rose-100/90 px-1 py-0.5 rounded border border-rose-200 shrink-0">
                          In: {formattedCheckIn}
                        </span>
                      )}
                    </div>
                    <p className="text-[9px] font-mono font-semibold text-slate-500 uppercase tracking-wider truncate">
                      {isRoom12 ? 'Staff Quarters' : room.roomType}
                    </p>
                  </div>

                  {/* Bottom Bar: Status Indicator Pill */}
                  <div className="flex items-center justify-between border-t border-black/5 pt-1.5 gap-1 min-w-0">
                    {isRoom12 ? (
                      <>
                        <span className="flex items-center gap-1 text-[9px] font-mono font-bold tracking-wider uppercase text-indigo-700 min-w-0 truncate">
                          <Users size={12} className="shrink-0 text-indigo-600" />
                          <span className="truncate">STAFF</span>
                        </span>
                        <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-[#dce4f9] text-indigo-800 border border-indigo-200 shrink-0">
                          QUARTERS
                        </span>
                      </>
                    ) : isAvailable ? (
                      <>
                        <span className="flex items-center gap-1 text-[9px] font-mono font-bold tracking-wider uppercase text-emerald-800 min-w-0 truncate">
                          <CheckCircle size={12} className="shrink-0 text-emerald-600" />
                          <span className="truncate">AVAILABLE</span>
                        </span>
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#d7e9dc] text-emerald-800 border border-emerald-200 shrink-0">
                          READY
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="flex items-center gap-1 text-[9px] font-mono font-bold tracking-wider uppercase text-rose-800 min-w-0 truncate">
                          <User size={12} className="shrink-0 text-rose-600" />
                          <span className="truncate">OCCUPIED</span>
                        </span>
                        <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-[#fad4d4] text-rose-800 border border-rose-200 shrink-0">
                          IN USE
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ─── Bottom Footer with Legend & Availability Breakdown in Text ──────── */}
      <footer className="bg-white/95 backdrop-blur-md rounded-2xl border border-[#cfe0d1] shadow-xs px-4 py-1.5 flex flex-col sm:flex-row items-center justify-between gap-2 shrink-0 text-[11px] font-mono">
        {/* Visual Legend */}
        <div className="flex items-center gap-4 text-slate-600">
          <span className="font-bold text-slate-800 uppercase tracking-wider">Status:</span>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-2xs" />
            <span className="font-medium text-emerald-900">Available ({stats.available})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-2xs" />
            <span className="font-medium text-rose-900">Occupied ({stats.occupied})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-2xs" />
            <span className="font-medium text-indigo-900">Staff House ({stats.unavailable})</span>
          </div>
        </div>

        {/* Plain Text Availability Notice */}
        <div className="text-slate-600 text-center sm:text-right font-medium">
          Total 32 Apartments &bull; <strong className="text-emerald-700 font-bold">{stats.available} Rooms Available</strong> for Walk-In Guests
        </div>
      </footer>
    </div>
  );
};
