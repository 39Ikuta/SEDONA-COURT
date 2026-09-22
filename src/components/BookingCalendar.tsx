import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Room, ScheduledBooking } from '../types';
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar as CalendarIcon, 
  Plus, 
  X, 
  User, 
  Clock, 
  Check, 
  AlertTriangle,
  Bookmark,
  Trash2,
  CalendarDays
} from 'lucide-react';

interface BookingCalendarProps {
  rooms: Room[];
  bookings: ScheduledBooking[];
  onAddBooking: (booking: ScheduledBooking) => void;
  onCancelBooking: (bookingId: string) => void;
  onCheckInBooking: (booking: ScheduledBooking) => void;
}

export const BookingCalendar: React.FC<BookingCalendarProps> = ({
  rooms,
  bookings,
  onAddBooking,
  onCancelBooking,
  onCheckInBooking,
}) => {
  // Center initial state on July 16, 2026
  const [currentDate, setCurrentDate] = useState<Date>(new Date(2026, 6, 16));
  const [selectedDay, setSelectedDay] = useState<number | null>(16);
  const [isNewBookingModalOpen, setIsNewBookingModalOpen] = useState(false);

  // New Booking form state
  const [formRoomNumber, setFormRoomNumber] = useState<string>(rooms[0]?.number || '1');
  const [formGuestName, setFormGuestName] = useState<string>('');
  const [formGuestId, setFormGuestId] = useState<string>('');
  const [formRateSelected, setFormRateSelected] = useState<ScheduledBooking['rateSelected']>('24h');
  const [formNumGuests, setFormNumGuests] = useState<number>(1);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Days of the week header
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Helper function to get days in month
  const getDaysInMonth = (y: number, m: number) => {
    return new Date(y, m + 1, 0).getDate();
  };

  // Helper function to get first day of month index
  const getFirstDayOfMonth = (y: number, m: number) => {
    return new Date(y, m, 1).getDay();
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDayIndex = getFirstDayOfMonth(year, month);

  // Previous month padding
  const prevMonthDaysCount = getDaysInMonth(year, month - 1);
  const prevMonthPadding = Array.from({ length: firstDayIndex }, (_, i) => {
    return {
      day: prevMonthDaysCount - firstDayIndex + i + 1,
      isCurrentMonth: false,
      monthOffset: -1,
    };
  });

  // Current month days
  const currentMonthDays = Array.from({ length: daysInMonth }, (_, i) => {
    return {
      day: i + 1,
      isCurrentMonth: true,
      monthOffset: 0,
    };
  });

  // Next month padding to complete 42 cells (6 rows)
  const totalCells = 42;
  const nextMonthPaddingCount = totalCells - (prevMonthPadding.length + currentMonthDays.length);
  const nextMonthPadding = Array.from({ length: nextMonthPaddingCount }, (_, i) => {
    return {
      day: i + 1,
      isCurrentMonth: false,
      monthOffset: 1,
    };
  });

  const allCalendarCells = [...prevMonthPadding, ...currentMonthDays, ...nextMonthPadding];

  // Format date helper: YYYY-MM-DD
  const formatDateString = (y: number, m: number, d: number) => {
    const formattedM = String(m + 1).padStart(2, '0');
    const formattedD = String(d).padStart(2, '0');
    return `${y}-${formattedM}-${formattedD}`;
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
    setSelectedDay(null);
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
    setSelectedDay(null);
  };

  // Filter bookings for selected month & year
  const getBookingsForDate = (y: number, m: number, d: number) => {
    const targetDateStr = formatDateString(y, m, d);
    return bookings.filter(b => b.checkInDate === targetDateStr && b.status === 'scheduled');
  };

  const handleOpenBookingModal = (day: number) => {
    setSelectedDay(day);
    setIsNewBookingModalOpen(true);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedDay === null) return;

    const finalGuestName = formGuestName.trim() || 'Walk-in Guest';
    const checkInStr = formatDateString(year, month, selectedDay);
    // Rough calculation of checkout date depending on selected duration hours
    const checkInDateObj = new Date(year, month, selectedDay);
    const checkOutDateObj = new Date(checkInDateObj);
    if (formRateSelected === '24h' || formRateSelected === 'promo') {
      checkOutDateObj.setDate(checkInDateObj.getDate() + 1);
    } // else checkout is same day for 3h / 12h

    const checkOutStr = formatDateString(
      checkOutDateObj.getFullYear(),
      checkOutDateObj.getMonth(),
      checkOutDateObj.getDate()
    );

    const newBooking: ScheduledBooking = {
      id: `booking-${Math.floor(100000 + Math.random() * 900000)}`,
      roomNumber: formRoomNumber,
      guestName: finalGuestName,
      guestId: formGuestId || undefined,
      checkInDate: checkInStr,
      checkOutDate: checkOutStr,
      rateSelected: formRateSelected,
      numGuests: formNumGuests,
      status: 'scheduled',
    };

    onAddBooking(newBooking);
    setFormGuestName('');
    setFormGuestId('');
    setIsNewBookingModalOpen(false);
  };

  return (
    <div className="bg-white p-6 rounded-3xl border border-secondary shadow-sm flex flex-col xl:flex-row gap-6 w-full">
      {/* LEFT BLOCK: Calendar Month View */}
      <div className="flex-1">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <CalendarIcon size={18} className="text-primary" />
            <h3 className="font-display font-black text-base text-primary uppercase tracking-tight">
              Advanced Reservation Calendar
            </h3>
          </div>

          <div className="flex items-center gap-1.5 bg-cream/40 border border-secondary/60 p-1 rounded-xl">
            <button
              onClick={handlePrevMonth}
              className="p-1 hover:bg-cream rounded-lg text-charcoal/60 hover:text-charcoal transition cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="font-mono text-xs font-bold text-primary uppercase px-2 min-w-28 text-center">
              {monthNames[month]} {year}
            </span>
            <button
              onClick={handleNextMonth}
              className="p-1 hover:bg-cream rounded-lg text-charcoal/60 hover:text-charcoal transition cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Days of week titles */}
        <div className="grid grid-cols-7 gap-2 text-center mb-2">
          {daysOfWeek.map((day) => (
            <span key={day} className="text-[10px] font-mono font-bold text-charcoal/40 uppercase tracking-widest py-1">
              {day}
            </span>
          ))}
        </div>

        {/* Calendar Day Grid */}
        <div className="grid grid-cols-7 gap-2">
          {allCalendarCells.map((cell, idx) => {
            const isToday = cell.isCurrentMonth && cell.day === 16 && month === 6 && year === 2026;
            const isSelected = cell.isCurrentMonth && cell.day === selectedDay;
            const targetBookings = cell.isCurrentMonth ? getBookingsForDate(year, month, cell.day) : [];
            const hasBooking = targetBookings.length > 0;

            return (
              <div
                key={`${idx}-${cell.day}`}
                onClick={() => {
                  if (cell.isCurrentMonth) {
                    setSelectedDay(cell.day);
                  }
                }}
                className={`min-h-24 p-2 rounded-xl border flex flex-col justify-between transition-all duration-150 relative select-none ${
                  cell.isCurrentMonth 
                    ? isSelected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : isToday
                        ? 'border-emerald-300 bg-emerald-50/20'
                        : 'border-secondary/40 bg-white hover:bg-cream/20'
                    : 'border-secondary/20 bg-cream/10 text-charcoal/20 opacity-40 cursor-not-allowed'
                } ${cell.isCurrentMonth ? 'cursor-pointer' : ''}`}
              >
                {/* Date indicator */}
                <div className="flex justify-between items-start">
                  <span className={`font-mono text-xs font-bold leading-none p-1 rounded-md ${
                    isToday 
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : cell.isCurrentMonth
                        ? isSelected
                          ? 'text-primary'
                          : 'text-charcoal'
                        : 'text-charcoal/30'
                  }`}>
                    {cell.day}
                  </span>

                  {cell.isCurrentMonth && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenBookingModal(cell.day);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-primary/10 rounded text-primary transition cursor-pointer md:opacity-30"
                      title="Add Booking"
                    >
                      <Plus size={12} />
                    </button>
                  )}
                </div>

                {/* Booking list indicators inside cells */}
                <div className="space-y-1 mt-1 overflow-hidden">
                  {targetBookings.map((b) => (
                    <div 
                      key={b.id} 
                      className="text-[9px] font-mono leading-tight bg-primary text-white font-bold py-0.5 px-1 rounded truncate border border-primary/20 flex items-center gap-0.5"
                      title={`${b.guestName} (Room ${b.roomNumber})`}
                    >
                      <span className="bg-white/20 px-0.5 rounded text-[8px]">{b.roomNumber}</span>
                      <span className="truncate">{b.guestName}</span>
                    </div>
                  ))}

                  {/* Render dot indicator if cell has booking but space is tight */}
                  {hasBooking && (
                    <div className="flex justify-center gap-1 mt-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT BLOCK: Selected Day's Bookings & Management Side panel */}
      <div className="w-full xl:w-80 border-t xl:border-t-0 xl:border-l border-secondary/40 pt-6 xl:pt-0 xl:pl-6 flex flex-col justify-between">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-[10px] font-mono font-bold tracking-wider text-charcoal/40 uppercase">
                Date Workspace Selection
              </span>
              <h4 className="font-display font-black text-sm text-charcoal uppercase tracking-tight mt-0.5">
                {selectedDay ? `${monthNames[month]} ${selectedDay}, ${year}` : 'Select a date...'}
              </h4>
            </div>

            {selectedDay && (
              <button
                onClick={() => handleOpenBookingModal(selectedDay)}
                className="bg-primary hover:bg-primary/95 text-white font-mono text-[10px] font-bold px-3 py-1.5 rounded-xl flex items-center gap-1 cursor-pointer transition shadow-sm"
              >
                <Plus size={12} />
                Reserve
              </button>
            )}
          </div>

          <div className="border-t border-secondary/40 pt-4">
            <h5 className="text-[9px] font-mono font-bold text-charcoal/40 uppercase tracking-widest mb-3">
              Bookings Scheduled for Day ({selectedDay ? getBookingsForDate(year, month, selectedDay).length : 0})
            </h5>

            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
              {selectedDay && getBookingsForDate(year, month, selectedDay).length > 0 ? (
                getBookingsForDate(year, month, selectedDay).map((b) => (
                  <div 
                    key={b.id} 
                    className="p-3 bg-cream/20 border border-secondary/50 rounded-xl flex flex-col justify-between gap-2 shadow-xs"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[10px] font-mono uppercase bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded font-bold">
                          Room {b.roomNumber}
                        </span>
                        <div className="font-sans font-extrabold text-charcoal text-xs mt-1.5 flex items-center gap-1.5">
                          <User size={11} className="text-charcoal/40" />
                          {b.guestName}
                        </div>
                      </div>
                      <button
                        onClick={() => onCancelBooking(b.id)}
                        className="text-charcoal/40 hover:text-red-600 p-1 hover:bg-red-50 rounded-lg transition cursor-pointer border border-transparent hover:border-red-100"
                        title="Cancel booking"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div className="flex justify-between items-center text-[9px] font-mono text-charcoal/50 border-t border-secondary/35 pt-2">
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {b.rateSelected.toUpperCase()} RATE
                      </span>
                      <span className="font-bold">
                        {b.numGuests} {b.numGuests === 1 ? 'GUEST' : 'GUESTS'}
                      </span>
                    </div>

                    {/* Direct Check-In Trigger */}
                    <button
                      onClick={() => onCheckInBooking(b)}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-sans font-bold py-1.5 px-3 rounded-lg flex items-center justify-center gap-1 transition shadow-sm cursor-pointer mt-1"
                    >
                      <Check size={10} />
                      Verify & Check-In Now
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 border border-dashed border-secondary/50 bg-cream/5 rounded-2xl">
                  <CalendarDays size={24} className="text-charcoal/20 mx-auto mb-2" />
                  <p className="text-[11px] font-sans text-charcoal/40">No advanced reservations on this date.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Calendar Key Legend */}
        <div className="border-t border-secondary/40 pt-4 mt-6">
          <span className="text-[9px] font-mono font-bold text-charcoal/40 uppercase tracking-widest block mb-2">
            Legend Keys
          </span>
          <div className="flex gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-charcoal/60">
              <span className="h-2 w-2 rounded bg-primary" />
              Active Booking
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-charcoal/60">
              <span className="h-2 w-2 rounded bg-emerald-600" />
              Current Today
            </div>
          </div>
        </div>
      </div>

      {/* NEW RESERVATION OVERLAY MODAL */}
      <AnimatePresence>
        {isNewBookingModalOpen && selectedDay !== null && (
          <div className="fixed inset-0 bg-charcoal/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl border border-secondary shadow-lg max-w-md w-full overflow-hidden"
            >
              {/* Header */}
              <div className="bg-primary text-white p-5 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Bookmark size={16} />
                  <h4 className="font-display font-black text-sm uppercase tracking-tight">
                    Advanced Apartment Reservation
                  </h4>
                </div>
                <button
                  onClick={() => setIsNewBookingModalOpen(false)}
                  className="p-1 hover:bg-white/10 rounded-lg text-white/80 hover:text-white transition cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Form Body */}
              <form onSubmit={handleFormSubmit} className="p-6 space-y-4">
                <div className="flex gap-3 bg-cream/40 border border-secondary/50 rounded-2xl p-3.5 items-center">
                  <CalendarDays size={18} className="text-primary" />
                  <div className="flex flex-col">
                    <span className="text-[9px] font-mono text-charcoal/40 uppercase font-semibold">Scheduled Date</span>
                    <span className="text-xs font-mono font-black text-primary uppercase">
                      {monthNames[month]} {selectedDay}, {year}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-charcoal/50 uppercase font-bold block mb-1.5">
                      Select Apartment
                    </label>
                    <select
                      value={formRoomNumber}
                      onChange={(e) => setFormRoomNumber(e.target.value)}
                      className="w-full bg-cream/35 border border-secondary/60 rounded-xl px-3 py-2 text-xs font-mono focus:ring-1 focus:ring-primary outline-none"
                    >
                      {rooms.map((r) => (
                        <option key={r.number} value={r.number}>
                          Rm {r.number} ({r.tier})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-mono text-charcoal/50 uppercase font-bold block mb-1.5">
                      Rate / Tier select
                    </label>
                    <select
                      value={formRateSelected}
                      onChange={(e) => setFormRateSelected(e.target.value as ScheduledBooking['rateSelected'])}
                      className="w-full bg-cream/35 border border-secondary/60 rounded-xl px-3 py-2 text-xs font-mono focus:ring-1 focus:ring-primary outline-none"
                    >
                      <option value="3h">3 hours rate</option>
                      <option value="12h">12 hours rate</option>
                      <option value="24h">24 hours rate</option>
                      <option value="promo">Midnight Promo (8pm - 6am)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-[10px] font-mono text-charcoal/50 uppercase font-bold">
                      Lead Guest Name
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        if (formGuestName === 'Walk-in Guest') {
                          setFormGuestName('');
                        } else {
                          setFormGuestName('Walk-in Guest');
                        }
                      }}
                      className={`text-[9px] font-mono px-2 py-0.5 rounded-lg border transition cursor-pointer flex items-center gap-1 ${
                        formGuestName === 'Walk-in Guest'
                          ? 'bg-primary/10 border-primary text-primary font-bold shadow-xs'
                          : 'bg-white border-secondary/50 text-charcoal/60 hover:text-primary hover:bg-cream/40'
                      }`}
                    >
                      <User size={10} />
                      <span>{formGuestName === 'Walk-in Guest' ? 'Opted Out ✓' : 'Opt Out of Name'}</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    value={formGuestName}
                    onChange={(e) => setFormGuestName(e.target.value)}
                    placeholder={formGuestName === 'Walk-in Guest' ? 'Walk-in Guest (Opted Out)' : 'e.g. John Doe (or click Opt Out)'}
                    className="w-full bg-cream/35 border border-secondary/60 rounded-xl px-3 py-2.5 text-xs font-sans font-medium focus:ring-1 focus:ring-primary outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-charcoal/50 uppercase font-bold block mb-1.5">
                      Guest ID Ref
                    </label>
                    <input
                      type="text"
                      value={formGuestId}
                      onChange={(e) => setFormGuestId(e.target.value)}
                      placeholder="Optional"
                      className="w-full bg-cream/35 border border-secondary/60 rounded-xl px-3 py-2 text-xs font-mono focus:ring-1 focus:ring-primary outline-none"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="text-[10px] font-mono text-charcoal/50 uppercase font-bold block mb-1.5">
                      Packs Count (Guests)
                    </label>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5, 6].map((num) => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => setFormNumGuests(num)}
                          className={`flex-1 py-1.5 text-center text-xs font-mono font-bold rounded-xl border transition cursor-pointer ${
                            formNumGuests === num
                              ? 'bg-primary border-primary text-white shadow-sm'
                              : 'bg-white border-secondary/50 text-charcoal/80 hover:bg-cream/40'
                          }`}
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary/95 text-white font-sans text-xs font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-1.5 transition shadow-sm cursor-pointer mt-2"
                >
                  <Check size={14} />
                  Confirm Advanced Reservation
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
