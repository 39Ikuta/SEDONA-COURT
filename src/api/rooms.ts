import { Room, TransferRoomParams, TransferRoomResponse, RoomTransferRecord } from '../types';
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

