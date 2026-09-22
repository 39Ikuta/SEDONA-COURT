/**
 * server/utils/discount-rates.ts
 * Authoritative discount rate table and lookup engine.
 *
 * Stores fixed discount amounts in integer centavos (PHP 1.00 = 100 centavos).
 * Replaces legacy floating-point percentage math (baseRate * 0.20) with explicit table data.
 */

export type DiscountType = 'SENIOR' | 'DC';
export type RoomTier = 'CLASSIC' | 'PREMIUM' | 'VIP';
export type StayDuration = '3HR' | '12HR' | '24HR';

export interface DiscountRateEntry {
  discountType: DiscountType;
  roomTier: RoomTier;
  duration: StayDuration;
  amountCentavos: number;
  amountPesos: number;
}

/**
 * Authoritative discount rate table mapping (discountType, roomTier, duration) -> amountCentavos.
 * All values stored as integer centavos to prevent floating point inaccuracies.
 */
export const DISCOUNT_RATES_DATA: DiscountRateEntry[] = [
  // Discount Card (DC)
  { discountType: 'DC', roomTier: 'CLASSIC', duration: '3HR', amountCentavos: 4000, amountPesos: 40.0 },
  { discountType: 'DC', roomTier: 'CLASSIC', duration: '12HR', amountCentavos: 5500, amountPesos: 55.0 },
  { discountType: 'DC', roomTier: 'CLASSIC', duration: '24HR', amountCentavos: 9500, amountPesos: 95.0 },
  { discountType: 'DC', roomTier: 'PREMIUM', duration: '3HR', amountCentavos: 5000, amountPesos: 50.0 },
  { discountType: 'DC', roomTier: 'PREMIUM', duration: '12HR', amountCentavos: 6000, amountPesos: 60.0 },
  { discountType: 'DC', roomTier: 'PREMIUM', duration: '24HR', amountCentavos: 10500, amountPesos: 105.0 },
  { discountType: 'DC', roomTier: 'VIP', duration: '3HR', amountCentavos: 6500, amountPesos: 65.0 },
  { discountType: 'DC', roomTier: 'VIP', duration: '12HR', amountCentavos: 7000, amountPesos: 70.0 },
  { discountType: 'DC', roomTier: 'VIP', duration: '24HR', amountCentavos: 11500, amountPesos: 115.0 },

  // Senior Citizen / PWD (SENIOR)
  // Gaps: No 3HR entries configured.
  // Note: "S. PREMIUM 24 HRS" resolved to SENIOR / PREMIUM / 24HR (₱375.00).
  { discountType: 'SENIOR', roomTier: 'CLASSIC', duration: '12HR', amountCentavos: 19500, amountPesos: 195.0 },
  { discountType: 'SENIOR', roomTier: 'CLASSIC', duration: '24HR', amountCentavos: 34000, amountPesos: 340.0 },
  { discountType: 'SENIOR', roomTier: 'PREMIUM', duration: '12HR', amountCentavos: 21500, amountPesos: 215.0 },
  { discountType: 'SENIOR', roomTier: 'PREMIUM', duration: '24HR', amountCentavos: 37500, amountPesos: 375.0 },
  { discountType: 'SENIOR', roomTier: 'VIP', duration: '12HR', amountCentavos: 25500, amountPesos: 255.0 },
  { discountType: 'SENIOR', roomTier: 'VIP', duration: '24HR', amountCentavos: 46000, amountPesos: 460.0 },
];

/**
 * Normalizes discount type string into canonical DiscountType enum or null.
 */
export function normalizeDiscountType(val?: string | null): DiscountType | null {
  if (!val) return null;
  const upper = String(val).trim().toUpperCase();
  if (
    upper === 'SENIOR' ||
    upper === 'PWD' ||
    upper === 'S' ||
    upper === 'S.' ||
    upper.startsWith('S. ') ||
    upper.includes('SENIOR') ||
    upper.includes('PWD')
  ) {
    return 'SENIOR';
  }
  if (upper === 'DC' || upper === 'DISCOUNT_CARD' || upper.includes('DISCOUNT CARD') || upper.includes('CARD')) {
    return 'DC';
  }
  return null;
}

/**
 * Explicit mapping of room tier / type names to canonical RoomTier.
 * Standard / Classic Room -> CLASSIC
 * Deluxe / Premium Room -> PREMIUM
 * Suite / VIP Suite -> VIP
 */
export function normalizeRoomTier(tierOrRoomType?: string | null): RoomTier | null {
  if (!tierOrRoomType) return null;
  const s = String(tierOrRoomType).trim().toUpperCase();

  if (s === 'CLASSIC' || s === 'STANDARD' || s.includes('CLASSIC') || s.includes('STANDARD')) {
    return 'CLASSIC';
  }
  if (s === 'PREMIUM' || s === 'DELUXE' || s.includes('PREMIUM') || s.includes('DELUXE')) {
    return 'PREMIUM';
  }
  if (s === 'VIP' || s === 'SUITE' || s.includes('VIP') || s.includes('SUITE')) {
    return 'VIP';
  }

  return null;
}

/**
 * Explicit mapping of duration strings (e.g. '3h', '12h', '24h', '3HR', '12S', '24S') to canonical StayDuration.
 */
export function normalizeStayDuration(duration?: string | null): StayDuration | null {
  if (!duration) return null;
  const s = String(duration).trim().toUpperCase();

  if (s === '3H' || s === '3HR' || s === '3' || s === '3S' || s === '3HRS' || s.startsWith('3H') || s.startsWith('3 HR') || s.includes('3 HOUR')) {
    return '3HR';
  }
  if (s === '12H' || s === '12HR' || s === '12' || s === '12S' || s === '12HRS' || s.startsWith('12H') || s.startsWith('12 HR') || s.includes('12 HOUR')) {
    return '12HR';
  }
  if (s === '24H' || s === '24HR' || s === '24' || s === '24S' || s === '24HRS' || s.startsWith('24H') || s.startsWith('24 HR') || s.includes('24 HOUR')) {
    return '24HR';
  }

  return null;
}

// Fast lookup map: `${discountType}:${roomTier}:${duration}` -> amountCentavos
const LOOKUP_MAP = new Map<string, number>();
for (const entry of DISCOUNT_RATES_DATA) {
  LOOKUP_MAP.set(`${entry.discountType}:${entry.roomTier}:${entry.duration}`, entry.amountCentavos);
}

/**
 * Authoritatively looks up discount amount in integer centavos.
 *
 * @param discountType 'SENIOR' | 'DC' (or any variant normalized)
 * @param roomTier 'CLASSIC' | 'PREMIUM' | 'VIP' (or Standard, Deluxe, Suite, etc.)
 * @param duration '3HR' | '12HR' | '24HR' (or 3h, 12h, 24h, etc.)
 * @returns amount in integer centavos (e.g. 19500 for ₱195.00), or null if unmapped combination.
 */
export function getDiscountAmount(
  discountType?: string | null,
  roomTier?: string | null,
  duration?: string | null
): number | null {
  const normType = normalizeDiscountType(discountType);
  const normTier = normalizeRoomTier(roomTier);
  const normDuration = normalizeStayDuration(duration);

  if (!normType || !normTier || !normDuration) {
    return null;
  }

  const key = `${normType}:${normTier}:${normDuration}`;
  const amount = LOOKUP_MAP.get(key);
  return amount !== undefined ? amount : null;
}

/**
 * Converts integer centavos to Pesos for display.
 */
export function centavosToPesos(centavos: number): number {
  return centavos / 100;
}

/**
 * Converts Pesos to integer centavos.
 */
export function pesosToCentavos(pesos: number): number {
  return Math.round(pesos * 100);
}
