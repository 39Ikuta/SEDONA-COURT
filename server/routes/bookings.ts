/**
 * server/routes/bookings.ts
 * GET    /api/bookings       — list all non-cancelled bookings
 * POST   /api/bookings       — create a new booking
 * PUT    /api/bookings/:id   — update booking status (check-in, cancel)
 * DELETE /api/bookings/:id   — hard delete a booking
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { socketManager } from '../websocket/socket-manager';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

function formatDate(val: any): string {
  if (!val) return '';
  if (val instanceof Date) {
    return val.toISOString().split('T')[0];
  }
  const str = String(val);
  return str.includes('T') ? str.split('T')[0] : str;
}

function rowToBooking(row: any) {
  return {
    id: row.id,
    roomNumber: String(row.room_number),
    guestName: row.guest_name,
    guestId: row.guest_id || '',
    checkInDate: formatDate(row.check_in_date),
    checkOutDate: formatDate(row.check_out_date),
    rateSelected: row.rate_selected,
    numGuests: Number(row.num_guests || 1),
    status: row.status,
  };
}

// GET /api/bookings
router.get('/', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM scheduled_bookings WHERE status != 'cancelled' ORDER BY check_in_date ASC`
    );
    res.json(result.rows.map(rowToBooking));
  } catch (err) {
    console.error('GET /bookings error:', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
}));

// POST /api/bookings
router.post('/', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const b = req.body;
  try {
    await pool.query(
      `INSERT INTO scheduled_bookings
        (id, room_number, guest_name, guest_id, check_in_date, check_out_date, rate_selected, num_guests, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.id, b.roomNumber, b.guestName, b.guestId || null, b.checkInDate, b.checkOutDate, b.rateSelected, b.numGuests || 1, b.status || 'scheduled']
    );
    
    const fetchResult = await pool.query('SELECT * FROM scheduled_bookings WHERE id = ?', [b.id]);
    const newBooking = rowToBooking(fetchResult.rows[0]);
    
    // Broadcast booking creation
    socketManager.broadcastBookingEvent({
      id: newBooking.id,
      roomNumber: newBooking.roomNumber,
      guestName: newBooking.guestName,
      action: 'created',
      timestamp: new Date().toISOString(),
    });
    
    res.status(201).json(newBooking);
  } catch (err) {
    console.error('POST /bookings error:', err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
}));

// PUT /api/bookings/:id — update status
router.put('/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    await pool.query(
      `UPDATE scheduled_bookings SET status = ? WHERE id = ?`,
      [status, id]
    );

    const fetchResult = await pool.query('SELECT * FROM scheduled_bookings WHERE id = ?', [id]);
    if (fetchResult.rows.length === 0) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }
    
    const updatedBooking = rowToBooking(fetchResult.rows[0]);
    
    // Broadcast booking update
    socketManager.broadcastBookingEvent({
      id: updatedBooking.id,
      roomNumber: updatedBooking.roomNumber,
      guestName: updatedBooking.guestName,
      action: status === 'checked-in' ? 'checked-in' : status === 'cancelled' ? 'cancelled' : 'updated',
      timestamp: new Date().toISOString(),
    });
    
    res.json(updatedBooking);
  } catch (err) {
    console.error(`PUT /bookings/${id} error:`, err);
    res.status(500).json({ error: 'Failed to update booking' });
  }
}));

// DELETE /api/bookings/:id
router.delete('/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM scheduled_bookings WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(`DELETE /bookings/${id} error:`, err);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
}));

export default router;
