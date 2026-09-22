/**
 * src/api/display.ts
 * Dedicated, strictly-scoped API client for Customer Display / Lobby Kiosk.
 * 
 * LEAST-PRIVILEGE & ZERO-PII ARCHITECTURE:
 * Calls only the narrow, sanitized /display/rooms endpoint.
 * Does NOT import or call any staff API endpoints.
 */

import { apiFetch } from './client';

export interface SanitizedRoomDisplay {
  roomNumber: string;
  roomType: string;
  tier: 'Standard' | 'Deluxe' | 'Suite' | string;
  floor: number;
  status: 'available' | 'occupied' | 'unavailable';
  /** Actual check-in timestamp (ISO) for occupied rooms; null otherwise. */
  checkInTime?: string | null;
}

/**
 * Fetches sanitized room availability from the customer display endpoint.
 * Returns only safe lobby display fields (number, type, tier, floor, bucketed
 * status, plus check-in time for occupied rooms).
 */
export async function getSanitizedRoomAvailability(): Promise<SanitizedRoomDisplay[]> {
  return apiFetch<SanitizedRoomDisplay[]>('/display/rooms');
}
