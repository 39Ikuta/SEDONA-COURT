/**
 * server/utils/discount-rates.ts
 * Authoritative discount rate table and lookup engine.
 *
 * Stores fixed discount amounts in integer centavos (PHP 1.00 = 100 centavos).
 * Replaces legacy floating-point percentage math (baseRate * 0.20) with explicit table data.
 */

export type DiscountType = 'SENIOR' | 'DC';
export type RoomTier = 'CLASSIC' | 'PREMIUM' | 'VIP';
export type StayDuration = '3HR' | '6HR' | '12HR' | '24HR';

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
  { discountType: 'SENIOR', roomTier: 'CLASSIC', duration: '3HR', amountCentavos: 7900, amountPesos: 79.0 },
  { discountType: 'SENIOR', roomTier: 'CLASSIC', duration: '6HR', amountCentavos: 15800, amountPesos: 158.0 },
  { discountType: 'SENIOR', roomTier: 'CLASSIC', duration: '12HR', amountCentavos: 19500, amountPesos: 195.0 },
  { discountType: 'SENIOR', roomTier: 'CLASSIC', duration: '24HR', amountCentavos: 34000, amountPesos: 340.0 },
  { discountType: 'SENIOR', roomTier: 'PREMIUM', duration: '3HR', amountCentavos: 9900, amountPesos: 99.0 },
  { discountType: 'SENIOR', roomTier: 'PREMIUM', duration: '6HR', amountCentavos: 17800, amountPesos: 178.0 },
  { discountType: 'SENIOR', roomTier: 'PREMIUM', duration: '12HR', amountCentavos: 21500, amountPesos: 215.0 },
  { discountType: 'SENIOR', roomTier: 'PREMIUM', duration: '24HR', amountCentavos: 37500, amountPesos: 375.0 },
  { discountType: 'SENIOR', roomTier: 'VIP', duration: '3HR', amountCentavos: 13900, amountPesos: 139.0 },
  { discountType: 'SENIOR', roomTier: 'VIP', duration: '6HR', amountCentavos: 21800, amountPesos: 218.0 },
  { discountType: 'SENIOR', roomTier: 'VIP', duration: '12HR', amountCentavos: 25500, amountPesos: 255.0 },
  { discountType: 'SENIOR', roomTier: 'VIP', duration: '24HR', amountCentavos: 46000, amountPesos: 460.0 },
];

/**
 * Normalizes discount type string into canonical DiscountType enum or null.
 * Allowlist ONLY (audit F-01): no substring includes().
 */
export function normalizeDiscountType(val?: string | null): DiscountType | null {
  if (!val) return null;
  const upper = String(val).trim().toUpperCase();
  if (!upper) return null;
  if (
    upper === 'SENIOR' ||
    upper === 'PWD' ||
    upper === 'SENIOR CITIZEN' ||
    upper === 'PERSON WITH DISABILITY' ||
    upper === 'S.' ||
    upper.startsWith('SENIOR ') ||
    upper.startsWith('PWD ') ||
    upper.startsWith('S. ')
  ) {
    return 'SENIOR';
  }
  if (
    upper === 'DC' ||
    upper === 'DISCOUNT CARD' ||
    upper === 'DISCOUNT_CARD' ||
    upper === 'DISCOUNT-CARD'
  ) {
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
  if (!s) return null;

  // Exact match first. Order VIP/SUITE before PREMIUM/DELUXE before
  // CLASSIC/STANDARD to avoid e.g. 'DELUXE SUITE' misrouting to PREMIUM.
  if (s === 'VIP' || s === 'SUITE') {
    return 'VIP';
  }
  if (s === 'PREMIUM' || s === 'DELUXE') {
    return 'PREMIUM';
  }
  if (s === 'CLASSIC' || s === 'STANDARD') {
    return 'CLASSIC';
  }

  // Word-boundary match: split on non-alphanumerics so e.g. 'SUBSTANDARD'
  // does NOT match 'STANDARD'. Same priority order as exact match.
  const tokens = s.split(/[^A-Z0-9]+/).filter(Boolean);
  if (tokens.includes('VIP') || tokens.includes('SUITE')) {
    return 'VIP';
  }
  if (tokens.includes('PREMIUM') || tokens.includes('DELUXE')) {
    return 'PREMIUM';
  }
  if (tokens.includes('CLASSIC') || tokens.includes('STANDARD')) {
    return 'CLASSIC';
  }

  return null;
}

/**
 * Explicit mapping of duration strings (e.g. '3h', '12h', '24h', '3HR') to canonical StayDuration.
 * Allowlist ONLY (audit F-01): no startsWith/includes catch-alls (e.g. '3HXYZ' is null).
 */
export function normalizeStayDuration(duration?: string | null): StayDuration | null {
  if (!duration) return null;
  const s = String(duration).trim().toUpperCase().replace(/\s+/g, ' ');
  if (!s) return null;

  switch (s) {
    case '3':
    case '3H':
    case '3HR':
    case '3HRS':
    case '3 HR':
    case '3 HRS':
      return '3HR';
    case '6':
    case '6H':
    case '6HR':
    case '6HRS':
    case '6 HR':
    case '6 HRS':
      return '6HR';
    case '12':
    case '12H':
    case '12HR':
    case '12HRS':
    case '12 HR':
    case '12 HRS':
      return '12HR';
    case '24':
    case '24H':
    case '24HR':
    case '24HRS':
    case '24 HR':
    case '24 HRS':
      return '24HR';
    default:
      // Explicitly unmapped: promo/custom/1h/open_time and any other variant.
      return null;
  }
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
