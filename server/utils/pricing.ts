/**
 * server/utils/pricing.ts
 * Server-side stay rate and add-on pricing engine.
 * Recomputes rates from database source data to prevent client-side price tampering.
 *
 * TODO: Migrate monetary fields from floating-point number to integer centavos (or Decimal.js) for high-precision accounting
 */

export interface BillableServiceRow {
  id: string;
  type: string;
  name: string;
  price: number;
  category: string;
  active: boolean;
  rate_type?: string;
  rateType?: string;
  weekday_override?: number;
  weekdayOverride?: number;
  weekend_override?: number;
  weekendOverride?: number;
  seasonal_override?: number;
  seasonalOverride?: number;
  seasonal_start?: string;
  seasonalStart?: string;
  seasonal_end?: string;
  seasonalEnd?: string;
  is_deleted?: boolean;
}

export const DEFAULT_TIER_RATES: Record<string, Record<string, number>> = {
  Standard: { '1h': 130, '3h': 395, '6h': 790, '12h': 1195, '24h': 2100, promo: 995 },
  Deluxe: { '1h': 130, '3h': 495, '6h': 890, '12h': 1295, '24h': 2300, promo: 1055 },
  Suite: { '1h': 130, '3h': 695, '6h': 1090, '12h': 1395, '24h': 2500, promo: 1155 },
};

export const EXCESS_HOUR_RATE = 130;

export const getStayDurationHours = (rateType: string, customHours?: number): number => {
  switch (rateType) {
    case '1h':
      return 1;
    case '3h':
      return 3;
    case '6h':
      return 6;
    case '12h':
      return 12;
    case '24h':
      return 24;
    case 'promo':
      // Strictly 8pm check-in to 6am check-out (nominal 10 hours)
      return 10;
    case 'custom':
      return customHours && customHours > 0 ? customHours : 1;
    default:
      return 24;
  }
};

/**
 * Computes expected checkout date/time according to the selected rate.
 * For Midnight Promo: strictly 8pm check-in to 6am check-out.
 */
export const calculateExpectedCheckout = (
  rateType: string,
  checkInDate: Date = new Date(),
  customHours?: number
): Date => {
  if (rateType === 'promo') {
    const checkout = new Date(checkInDate);
    if (checkInDate.getHours() < 6) {
      checkout.setUTCHours(22, 0, 0, 0); // 6 AM Manila is 22:00 UTC previous day
    } else {
      checkout.setDate(checkout.getDate() + 1);
      checkout.setUTCHours(22, 0, 0, 0); // 6 AM Manila is 22:00 UTC previous day
    }
    return checkout;
  }
  const hours = getStayDurationHours(rateType, customHours);
  return new Date(checkInDate.getTime() + hours * 3600000);
};

export const formatStayDuration = (rateType: string, customHours?: number): string => {
  switch (rateType) {
    case '1h':
      return '1 Hour Stay (1h Block)';
    case '3h':
      return '3 Hours (3h Base)';
    case '6h':
      return '6 Hours (6h Block)';
    case '12h':
      return '12 Hours (12h Block)';
    case '24h':
      return '24 Hours (Full Day)';
    case 'promo':
      return 'Midnight Promo (8pm - 6am)';
    case 'custom':
      return `${customHours && customHours > 0 ? customHours : 1} Hours (Custom Stay)`;
    default:
      return `${rateType.toUpperCase()} Stay`;
  }
};

/**
 * Extracts date parts in Asia/Manila timezone (UTC+8)
 */
export function getManilaDateParts(dateInput?: string | Date | null): {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  hour: number;
  minute: number;
} {
  let date: Date;
  if (!dateInput) {
    date = new Date();
  } else if (dateInput instanceof Date) {
    date = isNaN(dateInput.getTime()) ? new Date() : dateInput;
  } else {
    date = new Date(dateInput);
    if (isNaN(date.getTime())) {
      date = new Date();
    }
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  let year = date.getFullYear();
  let month = date.getMonth() + 1;
  let day = date.getDate();
  let dayOfWeek = date.getDay();
  let hour = date.getHours();
  let minute = date.getMinutes();

  const WEEKDAY_MAP: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  for (const part of parts) {
    if (part.type === 'year') year = parseInt(part.value, 10);
    else if (part.type === 'month') month = parseInt(part.value, 10);
    else if (part.type === 'day') day = parseInt(part.value, 10);
    else if (part.type === 'weekday') dayOfWeek = WEEKDAY_MAP[part.value] ?? dayOfWeek;
    else if (part.type === 'hour') hour = parseInt(part.value, 10);
    else if (part.type === 'minute') minute = parseInt(part.value, 10);
  }

  if (hour === 24) hour = 0;

  return { year, month, day, dayOfWeek, hour, minute };
}

/**
 * Validates whether the check-in time qualifies for the Midnight Promo rate.
 * Promo stays are strictly restricted to check-ins between 8:00 PM (20:00) and 6:00 AM (06:00) Manila time.
 */
export function isMidnightPromoAllowed(checkInDate: Date | string = new Date()): boolean {
  const { hour, minute } = getManilaDateParts(checkInDate);
  return hour >= 20 || hour < 6 || (hour === 6 && minute === 0);
}

/**
 * Calculates stay rate from service configuration and check-in date
 */
export function calculateStayRate(
  service: BillableServiceRow | undefined | null,
  checkInDateStr?: string | Date | null
): number {
  if (!service) return 0;

  const weekdayOverride = service.weekdayOverride ?? service.weekday_override;
  const weekendOverride = service.weekendOverride ?? service.weekend_override;
  const seasonalOverride = service.seasonalOverride ?? service.seasonal_override;
  const seasonalStart = service.seasonalStart ?? service.seasonal_start;
  const seasonalEnd = service.seasonalEnd ?? service.seasonal_end;

  const { month, day, dayOfWeek } = getManilaDateParts(checkInDateStr);

  // Seasonal override check
  if (seasonalOverride !== undefined && seasonalOverride !== null && seasonalStart && seasonalEnd) {
    const [startMonth, startDay] = seasonalStart.split('-').map(Number);
    const [endMonth, endDay] = seasonalEnd.split('-').map(Number);

    if (!isNaN(startMonth) && !isNaN(startDay) && !isNaN(endMonth) && !isNaN(endDay)) {
      const currentDateVal = month * 100 + day;
      const startDateVal = startMonth * 100 + startDay;
      const endDateVal = endMonth * 100 + endDay;

      let isSeasonal = false;
      if (startDateVal <= endDateVal) {
        isSeasonal = currentDateVal >= startDateVal && currentDateVal <= endDateVal;
      } else {
        // Crosses year boundary (e.g. Dec 15 to Jan 15)
        isSeasonal = currentDateVal >= startDateVal || currentDateVal <= endDateVal;
      }

      if (isSeasonal) {
        const val = Number(seasonalOverride);
        if (isNaN(val)) throw Object.assign(new Error(`Invalid seasonal override value: ${seasonalOverride}`), { statusCode: 400 });
        return val;
      }
    }
  }

  // Weekend override check (Friday, Saturday, Sunday)
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
  if (isWeekend && weekendOverride !== undefined && weekendOverride !== null) {
    const val = Number(weekendOverride);
    if (isNaN(val)) throw Object.assign(new Error(`Invalid weekend override value: ${weekendOverride}`), { statusCode: 400 });
    return val;
  }

  // Weekday override check (Monday, Tuesday, Wednesday, Thursday)
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 4;
  if (isWeekday && weekdayOverride !== undefined && weekdayOverride !== null) {
    const val = Number(weekdayOverride);
    if (isNaN(val)) throw Object.assign(new Error(`Invalid weekday override value: ${weekdayOverride}`), { statusCode: 400 });
    return val;
  }

  const basePrice = Number(service.price || 0);
  if (isNaN(basePrice)) throw Object.assign(new Error(`Invalid base price for service: ${service.price}`), { statusCode: 400 });
  return basePrice;
}

/**
 * Calculates extra person charge only when guest count exceeds 2
 */
export function calculateExtraPersonCharge(
  numGuests: number | undefined | null,
  unitPrice: number = 150
): number {
  const extraGuests = Math.max(0, Number(numGuests || 0) - 2);
  return extraGuests * Number(unitPrice || 0);
}

/**
 * Calculates excess hours past the expected checkout time after deducting a 15-minute grace period.
 * Standard hospitality rule: Overtime past 15 mins is rounded up to the nearest hour.
 */
export function calculateExcessHours(
  expectedCheckOut?: string | Date | null,
  actualCheckOut: Date = new Date(),
  gracePeriodMinutes: number = 15
): number {
  if (!expectedCheckOut) return 0;
  const expected = new Date(expectedCheckOut);
  if (isNaN(expected.getTime())) return 0;
  const overdueMs = actualCheckOut.getTime() - expected.getTime();
  const graceMs = gracePeriodMinutes * 60 * 1000;
  if (overdueMs <= graceMs) return 0;
  return Math.max(0, Math.ceil(overdueMs / (60 * 60 * 1000)));
}


