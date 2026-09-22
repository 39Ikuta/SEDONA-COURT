import { ScheduledBooking } from '../types';
import { apiFetch } from './client';

export async function getBookings(): Promise<ScheduledBooking[]> {
  return apiFetch<ScheduledBooking[]>('/bookings');
}

export async function addBooking(booking: ScheduledBooking): Promise<ScheduledBooking> {
  return apiFetch<ScheduledBooking>('/bookings', {
    method: 'POST',
    body: JSON.stringify(booking),
  });
}

export async function updateBookingStatus(
  id: string,
  status: ScheduledBooking['status']
): Promise<ScheduledBooking> {
  return apiFetch<ScheduledBooking>(`/bookings/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

export async function deleteBooking(id: string): Promise<void> {
  await apiFetch(`/bookings/${id}`, { method: 'DELETE' });
}
