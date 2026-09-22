import { BillableService, POSItem, Room } from '../types';

export const calculateStayRate = (service: BillableService, checkInDateStr?: string): number => {
  if (!service) return 0;
  
  // Parse date or use current date
  const checkInDate = checkInDateStr ? new Date(checkInDateStr) : new Date();
  const dayOfWeek = checkInDate.getDay(); // 0 is Sunday, 5 is Friday, 6 is Saturday
  
  // Seasonal override check
  if (service.seasonalOverride !== undefined && service.seasonalStart && service.seasonalEnd) {
    const month = checkInDate.getMonth() + 1; // 1-indexed
    const date = checkInDate.getDate();
    
    // MM-DD format parse (e.g. "12-15")
    const [startMonth, startDay] = service.seasonalStart.split('-').map(Number);
    const [endMonth, endDay] = service.seasonalEnd.split('-').map(Number);
    
    if (!isNaN(startMonth) && !isNaN(startDay) && !isNaN(endMonth) && !isNaN(endDay)) {
      const currentDateVal = month * 100 + date;
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
        return service.seasonalOverride;
      }
    }
  }
  
  // Weekend override check (Friday, Saturday, Sunday)
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
  if (isWeekend && service.weekendOverride !== undefined) {
    return service.weekendOverride;
  }
  
  // Weekday override check (Monday, Tuesday, Wednesday, Thursday)
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 4;
  if (isWeekday && service.weekdayOverride !== undefined) {
    return service.weekdayOverride;
  }
  
  return service.price;
};

export const calculateExtraPersonCharge = (numGuests: number, unitPrice: number = 150): number => {
  const extraGuests = Math.max(0, Number(numGuests || 0) - 2);
  return extraGuests * unitPrice;
};

export const DEFAULT_TIER_RATES: Record<string, Record<string, number>> = {
  Standard: { '1h': 130, '3h': 395, '6h': 790, '12h': 1195, '24h': 2100, promo: 995 },
  Deluxe: { '1h': 130, '3h': 495, '6h': 890, '12h': 1295, '24h': 2300, promo: 1055 },
  Suite: { '1h': 130, '3h': 695, '6h': 1090, '12h': 1395, '24h': 2500, promo: 1155 },
};

export const EXCESS_HOUR_RATE = 130;

export const getStayDurationHours = (rateType: Room['rateSelected'] | string, customHours?: number): number => {
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
  rateType: Room['rateSelected'] | string,
  checkInDate: Date = new Date(),
  customHours?: number
): Date => {
  if (rateType === 'promo') {
    const checkout = new Date(checkInDate);
    // If checking in after midnight but before 6am, checkout is 6am today
    if (checkInDate.getHours() < 6) {
      checkout.setHours(6, 0, 0, 0);
    } else {
      // Otherwise, checkout is 6am tomorrow
      checkout.setDate(checkout.getDate() + 1);
      checkout.setHours(6, 0, 0, 0);
    }
    return checkout;
  }
  const hours = getStayDurationHours(rateType, customHours);
  return new Date(checkInDate.getTime() + hours * 3600000);
};

export const formatStayDuration = (rateType: Room['rateSelected'] | string, customHours?: number): string => {
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

export const mapServicesToPOSItems = (services: BillableService[]): POSItem[] => {
  return services
    .filter((s) => s.type !== 'room_rate' && s.active && !s.isDeleted)
    .map((s) => ({
      id: s.id,
      name: s.name,
      price: s.price,
      category: s.category,
      description: s.description || '',
      imageUrl: s.imageUrl || 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=120&q=80',
    }));
};

/**
 * Calculates excess hours past the expected checkout time after deducting a 15-minute grace period.
 * Standard hospitality rule: Overtime past 15 mins is rounded up to the nearest hour.
 */
export const calculateExcessHours = (
  expectedCheckOut?: string | Date | null,
  actualCheckOut: Date = new Date(),
  gracePeriodMinutes: number = 15
): number => {
  if (!expectedCheckOut) return 0;
  const expected = new Date(expectedCheckOut);
  if (isNaN(expected.getTime())) return 0;
  const overdueMs = actualCheckOut.getTime() - expected.getTime();
  const graceMs = gracePeriodMinutes * 60 * 1000;
  if (overdueMs <= graceMs) return 0;
  return Math.max(0, Math.ceil(overdueMs / (60 * 60 * 1000)));
};

