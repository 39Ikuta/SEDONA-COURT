import { Room, TransferRoomParams, TransferRoomResponse, RoomTransferRecord, AlarmSettings } from '../types';
import { apiFetch } from './client';

export async function getRooms(): Promise<Room[]> {
  return apiFetch<Room[]>('/rooms');
}

export async function updateRoom(room: Room): Promise<Room> {
  return apiFetch<Room>(`/rooms/${room.number}`, {
    method: 'PUT',
    body: JSON.stringify(room),
  });
}

export async function resetRooms(): Promise<Room[]> {
  return apiFetch<Room[]>('/rooms/reset', { method: 'POST' });
}

export async function transferRoom(params: TransferRoomParams): Promise<TransferRoomResponse> {
  return apiFetch<TransferRoomResponse>('/rooms/transfer', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getRoomTransfers(date?: string): Promise<RoomTransferRecord[]> {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  return apiFetch<RoomTransferRecord[]>(`/rooms/transfers${query}`);
}

export async function fetchServerTime(): Promise<{ timestamp: number; iso: string; timezone: string }> {
  return apiFetch<{ timestamp: number; iso: string; timezone: string }>('/time');
}

export async function acknowledgeRoomAlarm(
  roomNumber: string | number
): Promise<{ success: boolean; acknowledgedAt: string; acknowledgedBy: string }> {
  return apiFetch<{ success: boolean; acknowledgedAt: string; acknowledgedBy: string }>(
    `/rooms/${roomNumber}/alarm/ack`,
    {
      method: 'POST',
    }
  );
}

export async function extendRoomStay(
  roomNumber: string | number,
  params: { hours?: number; rateSelected?: string; customHours?: number }
): Promise<{ success: boolean; room: Room; expectedCheckoutAt: string }> {
  return apiFetch<{ success: boolean; room: Room; expectedCheckoutAt: string }>(
    `/rooms/${roomNumber}/extend`,
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );
}

export async function snoozeRoomAlarm(
  roomNumber: string | number,
  minutes: number = 10
): Promise<{ success: boolean; snoozedUntil: string; room?: Room }> {
  return apiFetch<{ success: boolean; snoozedUntil: string; room?: Room }>(
    `/rooms/${roomNumber}/snooze`,
    {
      method: 'POST',
      body: JSON.stringify({ minutes }),
    }
  );
}

export async function switchRoomToOpenTime(
  roomNumber: string | number
): Promise<{ success: boolean; billingMode: string; openTimeStartedAt: string; room?: Room }> {
  return apiFetch<{ success: boolean; billingMode: string; openTimeStartedAt: string; room?: Room }>(
    `/rooms/${roomNumber}/open-time`,
    {
      method: 'POST',
    }
  );
}

export async function getAlarmSettings(): Promise<AlarmSettings> {
  return apiFetch<AlarmSettings>('/rooms/settings/alarm');
}

export async function updateAlarmSettings(
  settings: Partial<AlarmSettings>
): Promise<AlarmSettings> {
  return apiFetch<AlarmSettings>('/rooms/settings/alarm', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}


