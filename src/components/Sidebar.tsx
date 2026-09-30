import React from 'react';
import { Room } from '../types';
import { Filter, Eye, CircleDot, RefreshCw } from 'lucide-react';

interface SidebarProps {
  rooms: Room[];
  selectedStatusFilter: string;
  setSelectedStatusFilter: (status: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  rooms,
  selectedStatusFilter,
  setSelectedStatusFilter,
}) => {
  // Compute real-time stats
  const totalRooms = rooms.length;
  const occupiedCount = rooms.filter((r) => r.state === 'occupied').length;
  const availableCount = rooms.filter((r) => r.state === 'available').length;
  const overdueCount = rooms.filter((r) => r.state === 'overdue').length;
  const maintenanceCount = rooms.filter((r) => r.state === 'maintenance').length;

  const nowMs = Date.now();
  const almostInTimeCount = rooms.filter((r) => {
    if (r.isStaffHouse || r.roomType === 'Staff House' || String(r.number) === '12') return false;
    if ((r.state === 'occupied' || r.state === 'overdue') && r.checkOutTime) {
      const diffMins = (new Date(r.checkOutTime).getTime() - nowMs) / 60000;
      return diffMins <= 15; // 15m warning or overdue
    }
    return false;
  }).length;

  const occupancyRate = totalRooms > 0 ? Math.round((occupiedCount / totalRooms) * 100) : 0;

  const statusFilters = [
    { id: 'all', label: 'All Statuses', count: totalRooms, color: 'bg-charcoal/10 text-charcoal' },
    { id: 'almost_in_time', label: '⚠️ Almost in Time', count: almostInTimeCount, isUrgent: true },
    { id: 'available', label: 'Available', count: availableCount, color: 'bg-green-100 text-green-700' },
    { id: 'occupied', label: 'Occupied', count: occupiedCount, color: 'bg-rose-100 text-rose-700' },
    { id: 'overdue', label: 'Late Checkout', count: overdueCount, color: 'bg-purple-100 text-purple-700' },
  ];

  return (
    <aside className="w-full lg:w-64 flex flex-col gap-6">
      {/* Live Occupancy Gauge & Status Distribution Graph */}
      <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex flex-col gap-5">
        <div className="flex justify-between items-center">
          <div className="flex flex-col">
            <h2 className="font-display font-black text-xs tracking-wider text-primary uppercase">
              Occupancy Graph
            </h2>
            <span className="text-[9px] font-mono uppercase text-charcoal/40 tracking-wider">
              Real-time Distribution
            </span>
          </div>
          <span className="font-mono text-[9px] text-emerald-600 bg-emerald-50 border border-emerald-200/50 px-2 py-0.5 rounded-md font-bold animate-pulse">
            ● LIVE
          </span>
        </div>

        {/* Circular gauge with nested state counters */}
        <div className="flex items-center justify-between gap-4 py-1.5 border-b border-secondary/30 pb-4">
          <div className="relative w-20 h-20 flex-shrink-0">
            {/* SVG circle meter */}
            <svg className="w-full h-full transform -rotate-90">
              {/* Outer track */}
              <circle
                cx="40"
                cy="40"
                r="34"
                className="stroke-cream/50"
                strokeWidth="7"
                fill="transparent"
              />
              {/* Highlight fill */}
              <circle
                cx="40"
                cy="40"
                r="34"
                className="stroke-primary"
                strokeWidth="7"
                fill="transparent"
                strokeDasharray={213.6}
                strokeDashoffset={213.6 - (213.6 * occupancyRate) / 100}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono font-black text-base text-primary leading-none">
                {occupancyRate}%
              </span>
              <span className="text-[8px] font-mono text-charcoal/40 uppercase tracking-widest mt-0.5 font-bold">
                Booked
              </span>
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-center">
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-2xl font-black tracking-tight text-primary">
                {occupiedCount}
              </span>
              <span className="text-xs font-mono text-charcoal/40 font-semibold">
                / {totalRooms}
              </span>
            </div>
            <p className="text-[10px] text-charcoal/60 leading-tight font-medium">
              Occupied Apartments
            </p>
            <span className="text-[9px] text-emerald-600 font-semibold flex items-center gap-1 mt-1 font-mono">
              {availableCount} vacant & ready
            </span>
          </div>
        </div>

        {/* State distribution vertical bar graphs */}
        <div className="space-y-3">
          <div className="flex justify-between text-[10px] font-mono text-charcoal/40 uppercase tracking-wider font-semibold">
            <span>Status Breakdown</span>
            <span>Ratio & %</span>
          </div>

          {/* Bar rows */}
          <div className="space-y-2.5">
            {/* Occupied row */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-xs">
                <span className="font-medium text-charcoal/80 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 border border-rose-600/10 flex-shrink-0" />
                  Occupied
                </span>
                <span className="font-mono text-[11px] font-bold text-charcoal/60">
                  {occupiedCount} <span className="text-charcoal/40 font-normal">({Math.round((occupiedCount/totalRooms)*100)}%)</span>
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-cream/40 overflow-hidden border border-secondary/35">
                <div
                  className="bg-rose-500 h-full rounded-full transition-all duration-1000"
                  style={{ width: `${(occupiedCount / totalRooms) * 100}%` }}
                />
              </div>
            </div>

            {/* Available row */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-xs">
                <span className="font-medium text-charcoal/80 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500 border border-green-600/10 flex-shrink-0" />
                  Available
                </span>
                <span className="font-mono text-[11px] font-bold text-charcoal/60">
                  {availableCount} <span className="text-charcoal/40 font-normal">({Math.round((availableCount/totalRooms)*100)}%)</span>
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-cream/40 overflow-hidden border border-secondary/35">
                <div
                  className="bg-green-500 h-full rounded-full transition-all duration-1000"
                  style={{ width: `${(availableCount / totalRooms) * 100}%` }}
                />
              </div>
            </div>

            {/* Overdue row */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-xs">
                <span className="font-medium text-charcoal/80 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500 border border-purple-600/10 flex-shrink-0" />
                  Late Checkout
                </span>
                <span className="font-mono text-[11px] font-bold text-charcoal/60">
                  {overdueCount} <span className="text-charcoal/40 font-normal">({Math.round((overdueCount/totalRooms)*100)}%)</span>
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-cream/40 overflow-hidden border border-secondary/35">
                <div
                  className="bg-purple-500 h-full rounded-full transition-all duration-1000"
                  style={{ width: `${(overdueCount / totalRooms) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters: Status */}
      <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex flex-col gap-4">
        <div className="flex items-center gap-2 text-primary font-display font-bold text-sm tracking-wide uppercase">
          <Filter size={14} />
          <h2>Status Filters</h2>
        </div>

        <div className="flex flex-col gap-1.5">
          {statusFilters.map((filter) => {
            const isActive = selectedStatusFilter === filter.id;
            return (
              <button
                key={filter.id}
                onClick={() => setSelectedStatusFilter(filter.id)}
                className={`w-full flex justify-between items-center px-3.5 py-2 rounded-xl text-xs font-medium cursor-pointer transition border ${
                  isActive
                    ? 'bg-primary/5 border-primary text-primary'
                    : 'bg-white border-secondary/40 text-charcoal/70 hover:bg-cream/40'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      filter.id === 'all'
                        ? 'bg-charcoal/40'
                        : filter.id === 'almost_in_time'
                        ? 'bg-amber-500 animate-pulse'
                        : filter.id === 'available'
                        ? 'bg-green-500'
                        : filter.id === 'occupied'
                        ? 'bg-rose-500'
                        : 'bg-purple-500'
                    }`}
                  />
                  <span className={filter.id === 'almost_in_time' && filter.count > 0 ? 'font-bold text-amber-900' : ''}>
                    {filter.label}
                  </span>
                </span>
                <span className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  filter.id === 'almost_in_time' && filter.count > 0
                    ? 'bg-amber-500 text-amber-950 animate-pulse'
                    : 'bg-cream'
                }`}>
                  {filter.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
};
