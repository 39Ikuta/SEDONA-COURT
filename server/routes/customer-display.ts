/**
 * server/routes/customer-display.ts
 * Sanitized Room Availability API for Customer Display / Lobby Kiosks.
 * 
 * LEAST-PRIVILEGE & ZERO-PII ARCHITECTURE:
 * - Read-only endpoint strictly limited to room availability status.
 * - Fresh SQL query returning ONLY: number, tier, floor, room_type, state, check_in_time.
 * - The check-in timestamp is exposed ONLY for occupied rooms (as checkInTime);
 *   it identifies no guest on its own.
 * - Does NOT return guest names, guest IDs, checkout dates/times, pricing/rates,
 *   service charges, receipts, charged food, or operational audit details.
 * - Buckets room states strictly into: 'available' | 'occupied' | 'unavailable'.
 * - Room 12 / Staff House is explicitly mapped to 'unavailable'.
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireCustomerDisplayAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

export interface SanitizedRoomAvailability {
  roomNumber: string;
  roomType: string;
  tier: string;
  floor: number;
  status: 'available' | 'occupied' | 'unavailable';
  /** Actual check-in timestamp (ISO) for occupied rooms; null otherwise. Never identifies a guest. */
  checkInTime: string | null;
}

/**
 * Maps raw room state into the 3 customer-facing availability buckets.
 * - available: room is ready for walk-in/check-in
 * - occupied / overdue: room is currently occupied
 * - maintenance: room is unavailable
 * - Room 12 / Staff House: always unavailable
 */
export function bucketRoomStatus(number: string, roomType: string, state: string): 'available' | 'occupied' | 'unavailable' {
  if (String(number) === '12' || roomType === 'Staff House') {
    return 'unavailable';
  }
  switch (state) {
    case 'available':
      return 'available';
    case 'occupied':
    case 'overdue':
      return 'occupied';
    case 'maintenance':
    default:
      return 'unavailable';
  }
}

// GET /api/display/rooms (or /api/public/room-availability)
router.get(['/rooms', '/room-availability'], requireCustomerDisplayAuth, asyncHandler(async (_req: Request, res: Response) => {
  try {
    // Fresh standalone query selecting physical room metadata, state, and
    // check-in timestamp ONLY (Zero PII — no guest identity travels with it)
    const result = await pool.query(`
      SELECT number, tier, floor, room_type, state, check_in_time
      FROM rooms
      ORDER BY CAST(number AS INTEGER) ASC
    `);

    const sanitizedRooms: SanitizedRoomAvailability[] = result.rows.map((row: any) => {
      const status = bucketRoomStatus(String(row.number), row.room_type, row.state);
      // Expose the actual check-in time exclusively for occupied rooms.
      let checkInTime: string | null = null;
      if (status === 'occupied' && row.check_in_time) {
        const parsed = new Date(row.check_in_time);
        if (!isNaN(parsed.getTime())) {
          checkInTime = parsed.toISOString();
        }
      }
      return {
        roomNumber: String(row.number),
        roomType: row.room_type,
        tier: row.tier,
        floor: Number(row.floor || 1),
        status,
        checkInTime,
      };
    });

    res.json(sanitizedRooms);
  } catch (err) {
    console.error('GET /display/rooms error:', err);
    res.status(500).json({ error: 'Failed to fetch room availability' });
  }
}));

export default router;
