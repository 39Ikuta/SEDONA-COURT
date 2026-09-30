/**
 * server/services/analytics-service.ts
 *
 * Authoritative Guest Count Engine and Hospitality Analytics for Sedona Court PMS.
 *
 * Core Business Rules:
 * 1. Guest Count Definition: Count of bookings/stays checked in during the period by check_in_at (NOT finalized_at).
 *    A stay that checks in during Shift A and checks out in Shift B is counted in Shift A.
 * 2. Exclusions:
 *    - Voided / cancelled receipts and bookings (status = 'void' or status = 'cancelled')
 *    - Staff quarters (Staff House, Room 12)
 *    - Security Deposits (DEP-*)
 *    - Stay extensions (do not increment check-in count)
 *    - Open-time transitions (mode switches do not increment check-in count)
 * 3. Base Capacity & Headcount:
 *    - Default included persons = 2 per room. Single occupancy allowed (1 person).
 *    - Headcount is the sum of persons (num_guests) checked in during the window.
 * 4. Business Day & Shift Cutoffs:
 *    - Default business_day_start = 06:00.
 *    - DAY Shift: 06:00:00 to 17:59:59.999
 *    - NIGHT Shift: 18:00:00 to 05:59:59.999 of next calendar day (stays in one business day).
 */

import { pool } from '../db/pool';
import { socketManager } from '../websocket/socket-manager';

export interface GuestCountMetricsFilter {
  date?: string; // 'today' | 'yesterday' | 'this_shift' | 'YYYY-MM-DD'
  shift?: 'DAY' | 'NIGHT' | 'ALL';
  from?: string; // 'YYYY-MM-DD' or ISO
  to?: string;   // 'YYYY-MM-DD' or ISO
  businessDayStart?: string; // default '06:00'
}

export interface GuestCountBreakdown {
  bookingsCount: number;
  completedCount: number;
  headcount: number;
  revenue: number;
}

export interface GuestCountMetrics {
  period: {
    start: string;
    end: string;
    label: string;
    businessDate: string;
    shift?: string;
  };
  bookingsCount: number;      // Total bookings checked in during the window
  completedCount: number;     // Checked out during the window
  inHouseCount: number;       // Currently occupied now (excluding Staff House)
  overdueCount: number;       // Currently overdue now (excluding Staff House)
  headcount: number;          // Total guest persons (sum of num_guests) checked in during window
  breakdownByShift: {
    DAY: GuestCountBreakdown;
    NIGHT: GuestCountBreakdown;
  };
  breakdownByRoomType: Record<string, { bookingsCount: number; headcount: number; revenue: number }>;
  hourlyDistribution: number[]; // 24-element array for hours 0..23 (check-in peak-hour distribution)
  averageStayLengthHours: number;
  averageRevenuePerGuest: number;
  weekdayComparison: {
    today: { bookingsCount: number; headcount: number; completedCount: number; revenue: number };
    sameDayLastWeek: { bookingsCount: number; headcount: number; completedCount: number; revenue: number };
    delta: { bookingsCount: number; headcount: number; completedCount: number; revenue: number };
    percentChange: { bookingsCount: number; headcount: number; completedCount: number; revenue: number };
  };
}

/**
 * Parses business day start time string ("06:00" -> { hour: 6, minute: 0 }).
 */
export function parseBusinessDayStart(timeStr: string = '06:00'): { hour: number; minute: number } {
  const parts = String(timeStr || '06:00').trim().split(':');
  const hour = Math.min(23, Math.max(0, parseInt(parts[0], 10) || 6));
  const minute = Math.min(59, Math.max(0, parseInt(parts[1], 10) || 0));
  return { hour, minute };
}

/**
 * Given a timestamp, returns the associated Business Date (YYYY-MM-DD) and Shift ('DAY' | 'NIGHT').
 * Uses Manila / Server Timezone.
 */
export function getBusinessDateAndShift(
  dateInput: Date | string,
  businessDayStartStr: string = '06:00'
): { businessDate: string; shift: 'DAY' | 'NIGHT'; shiftWindow: { start: string; end: string } } {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const { hour: startHour } = parseBusinessDayStart(businessDayStartStr);

  const hours = d.getHours();
  const minutes = d.getMinutes();
  const currentMinutes = hours * 60 + minutes;
  const startMinutes = startHour * 60; // e.g. 360 for 06:00
  const dayShiftEndMinutes = (startHour + 12) * 60; // e.g. 18:00 (1080)

  let businessDateObj = new Date(d);

  // If timestamp is before business_day_start (e.g. 03:00 AM), it belongs to previous calendar day's business date
  if (currentMinutes < startMinutes) {
    businessDateObj.setDate(businessDateObj.getDate() - 1);
  }

  const y = businessDateObj.getFullYear();
  const m = String(businessDateObj.getMonth() + 1).padStart(2, '0');
  const day = String(businessDateObj.getDate()).padStart(2, '0');
  const businessDate = `${y}-${m}-${day}`;

  const isDayShift = currentMinutes >= startMinutes && currentMinutes < dayShiftEndMinutes;
  const shift: 'DAY' | 'NIGHT' = isDayShift ? 'DAY' : 'NIGHT';

  // Calculate shift window
  const shiftStartObj = new Date(businessDateObj);
  const shiftEndObj = new Date(businessDateObj);

  if (shift === 'DAY') {
    shiftStartObj.setHours(startHour, 0, 0, 0);
    shiftEndObj.setHours(startHour + 12, 0, 0, 0);
  } else {
    shiftStartObj.setHours(startHour + 12, 0, 0, 0);
    shiftEndObj.setDate(shiftEndObj.getDate() + 1);
    shiftEndObj.setHours(startHour, 0, 0, 0);
  }

  return {
    businessDate,
    shift,
    shiftWindow: {
      start: shiftStartObj.toISOString(),
      end: shiftEndObj.toISOString(),
    },
  };
}

/**
 * Resolves window boundaries based on filter parameters.
 */
export function resolveDateRange(
  filter: GuestCountMetricsFilter
): { startIso: string; endIso: string; label: string; businessDate: string; shift?: string } {
  const businessDayStart = filter.businessDayStart || '06:00';
  const { hour: startHour } = parseBusinessDayStart(businessDayStart);
  const now = new Date();

  // Helper to construct business day window for a specific YYYY-MM-DD
  const makeBusinessDayWindow = (dateStr: string, shiftFilter?: 'DAY' | 'NIGHT' | 'ALL') => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const start = new Date(year, month - 1, day, startHour, 0, 0, 0);
    const end = new Date(year, month - 1, day + 1, startHour, 0, 0, 0);

    if (shiftFilter === 'DAY') {
      const dayEnd = new Date(year, month - 1, day, startHour + 12, 0, 0, 0);
      return {
        startIso: start.toISOString(),
        endIso: dayEnd.toISOString(),
        label: `${dateStr} (DAY Shift)`,
        businessDate: dateStr,
        shift: 'DAY',
      };
    } else if (shiftFilter === 'NIGHT') {
      const nightStart = new Date(year, month - 1, day, startHour + 12, 0, 0, 0);
      return {
        startIso: nightStart.toISOString(),
        endIso: end.toISOString(),
        label: `${dateStr} (NIGHT Shift)`,
        businessDate: dateStr,
        shift: 'NIGHT',
      };
    }

    return {
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      label: dateStr,
      businessDate: dateStr,
      shift: shiftFilter === 'ALL' ? undefined : undefined,
    };
  };

  const { businessDate: todayBusinessDate, shift: currentShift } = getBusinessDateAndShift(now, businessDayStart);

  if (filter.date === 'today' || (!filter.date && !filter.from && !filter.to)) {
    return makeBusinessDayWindow(todayBusinessDate, filter.shift as any);
  }

  if (filter.date === 'this_shift') {
    return makeBusinessDayWindow(todayBusinessDate, currentShift);
  }

  if (filter.date === 'yesterday') {
    const [y, m, d] = todayBusinessDate.split('-').map(Number);
    const prevDateObj = new Date(y, m - 1, d - 1);
    const prevDateStr = `${prevDateObj.getFullYear()}-${String(prevDateObj.getMonth() + 1).padStart(2, '0')}-${String(prevDateObj.getDate()).padStart(2, '0')}`;
    return makeBusinessDayWindow(prevDateStr, filter.shift as any);
  }

  if (filter.date && /^\d{4}-\d{2}-\d{2}$/.test(filter.date)) {
    return makeBusinessDayWindow(filter.date, filter.shift as any);
  }

  if (filter.from && filter.to) {
    const fromStr = filter.from.slice(0, 10);
    const toStr = filter.to.slice(0, 10);
    const [y1, m1, d1] = fromStr.split('-').map(Number);
    const [y2, m2, d2] = toStr.split('-').map(Number);

    const start = new Date(y1, m1 - 1, d1, startHour, 0, 0, 0);
    const end = new Date(y2, m2 - 1, d2 + 1, startHour, 0, 0, 0);

    return {
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      label: `${fromStr} to ${toStr}`,
      businessDate: fromStr,
      shift: filter.shift && filter.shift !== 'ALL' ? filter.shift : undefined,
    };
  }

  return makeBusinessDayWindow(todayBusinessDate);
}

export class AnalyticsService {
  /**
   * Authoritative calculation of guest count and occupancy metrics.
   */
  async getGuestCountMetrics(filter: GuestCountMetricsFilter = {}): Promise<GuestCountMetrics> {
    const range = resolveDateRange(filter);
    const businessDayStart = filter.businessDayStart || '06:00';

    // 1. Fetch live rooms status for instant in-house / overdue counts
    const roomsRes = await pool.query(`
      SELECT number, tier, room_type, state, guest_name, num_guests, check_in_at, check_in_time, expected_checkout_at, is_overdue, alarm_state
      FROM rooms
      WHERE room_type != 'Staff House' AND number != '12'
    `);
    const allRooms = roomsRes.rows;

    const inHouseCount = allRooms.filter(r => r.state === 'occupied').length;
    const overdueCount = allRooms.filter(r => r.state === 'overdue' || r.is_overdue === 1 || r.alarm_state === 'OVERDUE' || r.alarm_state === 'DUE').length;

    // 2. Query checked-in stays during window:
    // Stays currently in rooms that checked in during window
    const liveCheckedIn = allRooms.filter((r: any) => {
      const cin = r.check_in_at || r.check_in_time;
      if (!cin) return false;
      const d = new Date(cin).toISOString();
      return d >= range.startIso && d < range.endIso;
    });

    // 3. Query historical checked-out receipts that checked in during window (excluding void, staff quarters, and deposits)
    const receiptsRes = await pool.query(`
      SELECT receipt_no, date_time, room_number, room_type, check_in, check_out, consumed_minutes,
             total, subtotal, status, items, receipt_snapshot
      FROM receipts
      WHERE (status IS NULL OR status != 'void')
        AND (room_number IS NOT NULL AND room_number != '12' AND room_number != '' AND room_number != 'POS')
        AND (room_type IS NULL OR room_type != 'Staff House')
        AND date_time >= ?
      ORDER BY date_time ASC
    `, [
      // Look back up to 30 days prior to window start to catch stays that checked in during window but checked out later
      new Date(new Date(range.startIso).getTime() - 30 * 86400000).toISOString()
    ]);

    const matchingReceiptsCheckedIn = receiptsRes.rows.filter((r: any) => {
      const cin = r.check_in;
      if (!cin) return false;
      const d = new Date(cin).toISOString();
      return d >= range.startIso && d < range.endIso;
    });

    // 4. Completed checkouts during the window (by check_out timestamp)
    const completedCheckouts = receiptsRes.rows.filter((r: any) => {
      const cout = r.check_out || r.date_time;
      if (!cout) return false;
      const d = new Date(cout).toISOString();
      return d >= range.startIso && d < range.endIso;
    });

    // Extract guests and headcount
    interface StayRecord {
      id: string;
      checkIn: string;
      checkOut?: string;
      roomNumber: string;
      roomType: string;
      numGuests: number;
      revenue: number;
      consumedMinutes?: number;
    }

    const stays: StayRecord[] = [];

    // Add active stays
    for (const r of liveCheckedIn) {
      const numGuests = Math.max(1, Number(r.num_guests || 2));
      stays.push({
        id: `room-${r.number}`,
        checkIn: (r.check_in_at || r.check_in_time)!,
        roomNumber: String(r.number),
        roomType: r.room_type || 'Standard Room',
        numGuests,
        revenue: 0,
      });
    }

    // Add completed stays from receipts
    for (const r of matchingReceiptsCheckedIn) {
      let numGuests = 2; // Default 2 included
      if (r.receipt_snapshot) {
        try {
          const snap = typeof r.receipt_snapshot === 'string' ? JSON.parse(r.receipt_snapshot) : r.receipt_snapshot;
          if (snap.persons) numGuests = Number(snap.persons);
          else if (snap.numGuests) numGuests = Number(snap.numGuests);
        } catch (_) {}
      } else if (r.items) {
        try {
          const items = typeof r.items === 'string' ? JSON.parse(r.items) : r.items;
          const extraPersonItem = items.find((i: any) => (i.description || '').toLowerCase().includes('extra person'));
          if (extraPersonItem) {
            const match = (extraPersonItem.subtext || '').match(/(\d+)\s*Extra/i);
            const extraQty = match ? parseInt(match[1], 10) : 1;
            numGuests = 2 + extraQty;
          }
        } catch (_) {}
      }

      stays.push({
        id: r.receipt_no,
        checkIn: r.check_in,
        checkOut: r.check_out || r.date_time,
        roomNumber: String(r.room_number || ''),
        roomType: r.room_type || 'Standard Room',
        numGuests: Math.max(1, numGuests),
        revenue: parseFloat(r.total || 0),
        consumedMinutes: r.consumed_minutes != null ? Number(r.consumed_minutes) : undefined,
      });
    }

    const bookingsCount = stays.length;
    const completedCount = completedCheckouts.length;
    const headcount = stays.reduce((sum, s) => sum + s.numGuests, 0);

    // Shift breakdown
    const breakdownByShift: { DAY: GuestCountBreakdown; NIGHT: GuestCountBreakdown } = {
      DAY: { bookingsCount: 0, completedCount: 0, headcount: 0, revenue: 0 },
      NIGHT: { bookingsCount: 0, completedCount: 0, headcount: 0, revenue: 0 },
    };

    const hourlyDistribution: number[] = new Array(24).fill(0);
    const breakdownByRoomType: Record<string, { bookingsCount: number; headcount: number; revenue: number }> = {
      'Classic Room': { bookingsCount: 0, headcount: 0, revenue: 0 },
      'Premium Room': { bookingsCount: 0, headcount: 0, revenue: 0 },
      'VIP Suite': { bookingsCount: 0, headcount: 0, revenue: 0 },
    };

    let totalStayMinutes = 0;
    let completedStaysWithDuration = 0;
    let totalRevenue = 0;

    for (const s of stays) {
      const cinDate = new Date(s.checkIn);
      const hour = cinDate.getHours();
      hourlyDistribution[hour]++;

      const { shift } = getBusinessDateAndShift(cinDate, businessDayStart);
      breakdownByShift[shift].bookingsCount++;
      breakdownByShift[shift].headcount += s.numGuests;
      breakdownByShift[shift].revenue += s.revenue;
      totalRevenue += s.revenue;

      // Room type breakdown normalization
      let rtKey = 'Classic Room';
      const rtLower = s.roomType.toLowerCase();
      if (rtLower.includes('vip') || rtLower.includes('suite')) rtKey = 'VIP Suite';
      else if (rtLower.includes('premium') || rtLower.includes('deluxe')) rtKey = 'Premium Room';

      if (!breakdownByRoomType[rtKey]) {
        breakdownByRoomType[rtKey] = { bookingsCount: 0, headcount: 0, revenue: 0 };
      }
      breakdownByRoomType[rtKey].bookingsCount++;
      breakdownByRoomType[rtKey].headcount += s.numGuests;
      breakdownByRoomType[rtKey].revenue += s.revenue;

      if (s.consumedMinutes != null && s.consumedMinutes > 0) {
        totalStayMinutes += s.consumedMinutes;
        completedStaysWithDuration++;
      } else if (s.checkOut) {
        const coutDate = new Date(s.checkOut);
        const diffMins = Math.max(0, Math.floor((coutDate.getTime() - cinDate.getTime()) / 60000));
        if (diffMins > 0) {
          totalStayMinutes += diffMins;
          completedStaysWithDuration++;
        }
      }
    }

    // Assign completed counts to shifts
    for (const c of completedCheckouts) {
      const coutDate = new Date(c.check_out || c.date_time);
      const { shift } = getBusinessDateAndShift(coutDate, businessDayStart);
      breakdownByShift[shift].completedCount++;
    }

    const averageStayLengthHours = completedStaysWithDuration > 0
      ? parseFloat((totalStayMinutes / completedStaysWithDuration / 60).toFixed(2))
      : 0;

    const averageRevenuePerGuest = headcount > 0
      ? parseFloat((totalRevenue / headcount).toFixed(2))
      : (bookingsCount > 0 ? parseFloat((totalRevenue / bookingsCount).toFixed(2)) : 0);

    // 5. Weekday Comparison: Compare target date vs same day 7 days ago
    const weekdayComparison = await this.computeWeekdayComparison(range.businessDate, businessDayStart);

    return {
      period: {
        start: range.startIso,
        end: range.endIso,
        label: range.label,
        businessDate: range.businessDate,
        shift: range.shift,
      },
      bookingsCount,
      completedCount,
      inHouseCount,
      overdueCount,
      headcount,
      breakdownByShift,
      breakdownByRoomType,
      hourlyDistribution,
      averageStayLengthHours,
      averageRevenuePerGuest,
      weekdayComparison,
    };
  }

  /**
   * Helper to compute comparison between target date and the same weekday 7 days ago.
   */
  private async computeWeekdayComparison(targetBusinessDate: string, businessDayStartStr: string = '06:00') {
    const [y, m, d] = targetBusinessDate.split('-').map(Number);
    const lastWeekDateObj = new Date(y, m - 1, d - 7);

    const fmt = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const lastWeekDateStr = fmt(lastWeekDateObj);

    const getDayMetrics = async (dateStr: string) => {
      const { startIso, endIso } = resolveDateRange({ date: dateStr, businessDayStart: businessDayStartStr });
      const recRes = await pool.query(`
        SELECT receipt_no, check_in, check_out, date_time, total, items, receipt_snapshot
        FROM receipts
        WHERE (status IS NULL OR status != 'void')
          AND (room_number IS NOT NULL AND room_number != '12' AND room_number != '' AND room_number != 'POS')
          AND check_in >= ? AND check_in < ?
      `, [startIso, endIso]);

      let bCount = recRes.rows.length;
      let hCount = 0;
      let rev = 0;

      for (const r of recRes.rows) {
        let numGuests = 2;
        if (r.receipt_snapshot) {
          try {
            const snap = typeof r.receipt_snapshot === 'string' ? JSON.parse(r.receipt_snapshot) : r.receipt_snapshot;
            if (snap.persons) numGuests = Number(snap.persons);
          } catch (_) {}
        }
        hCount += numGuests;
        rev += parseFloat(r.total || 0);
      }

      // Completed count on that day
      const compRes = await pool.query(`
        SELECT COUNT(*) as count FROM receipts
        WHERE (status IS NULL OR status != 'void')
          AND (room_number IS NOT NULL AND room_number != '12' AND room_number != '' AND room_number != 'POS')
          AND (check_out >= ? AND check_out < ?)
      `, [startIso, endIso]);

      const completed = Number(compRes.rows[0]?.count || 0);

      return { bookingsCount: bCount, headcount: hCount, completedCount: completed, revenue: parseFloat(rev.toFixed(2)) };
    };

    const todayMetrics = await getDayMetrics(targetBusinessDate);
    const lastWeekMetrics = await getDayMetrics(lastWeekDateStr);

    const bDelta = todayMetrics.bookingsCount - lastWeekMetrics.bookingsCount;
    const hDelta = todayMetrics.headcount - lastWeekMetrics.headcount;
    const cDelta = todayMetrics.completedCount - lastWeekMetrics.completedCount;
    const rDelta = parseFloat((todayMetrics.revenue - lastWeekMetrics.revenue).toFixed(2));

    const calcPct = (curr: number, prev: number) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return parseFloat((((curr - prev) / prev) * 100).toFixed(1));
    };

    return {
      today: todayMetrics,
      sameDayLastWeek: lastWeekMetrics,
      delta: {
        bookingsCount: bDelta,
        headcount: hDelta,
        completedCount: cDelta,
        revenue: rDelta,
      },
      percentChange: {
        bookingsCount: calcPct(todayMetrics.bookingsCount, lastWeekMetrics.bookingsCount),
        headcount: calcPct(todayMetrics.headcount, lastWeekMetrics.headcount),
        completedCount: calcPct(todayMetrics.completedCount, lastWeekMetrics.completedCount),
        revenue: calcPct(todayMetrics.revenue, lastWeekMetrics.revenue),
      },
    };
  }

  /**
   * Broadcast real-time guest counts update to staff terminals on check-in and checkout.
   */
  async notifyGuestCountsUpdated(): Promise<void> {
    try {
      const metrics = await this.getGuestCountMetrics({ date: 'today' });
      socketManager.broadcastToStaff('analytics:guest_counts_updated', metrics);
    } catch (err) {
      console.warn('⚠️ notifyGuestCountsUpdated warning:', err);
    }
  }
}

export const analyticsService = new AnalyticsService();
