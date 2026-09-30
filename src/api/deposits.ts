/**
 * src/api/deposits.ts
 * Frontend API client for guest deposits and credit balance ledger.
 */

import { DepositTransaction, DepositBalanceInfo, Deposit } from '../types';
import { apiFetch } from './client';

export async function getGuestDepositBalance(guestIdentifier: string): Promise<DepositBalanceInfo> {
  const cleanId = encodeURIComponent(guestIdentifier.trim());
  return apiFetch<DepositBalanceInfo>(`/deposits/${cleanId}`);
}

export async function getAllDepositTransactions(filters?: {
  guestIdentifier?: string;
  direction?: 'IN' | 'OUT';
  limit?: number;
}): Promise<DepositTransaction[]> {
  const params = new URLSearchParams();
  if (filters?.guestIdentifier) params.append('guestIdentifier', filters.guestIdentifier);
  if (filters?.direction) params.append('direction', filters.direction);
  if (filters?.limit) params.append('limit', String(filters.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<DepositTransaction[]>(`/deposits${qs}`);
}

export interface RecordDepositParams {
  guestIdentifier: string;
  guestName?: string;
  amountCentavos: number;
  paymentMethod: 'CASH' | 'GCASH' | 'MIXED';
  cashAmountCentavos?: number;
  gcashAmountCentavos?: number;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
}

export async function recordDeposit(params: RecordDepositParams): Promise<{
  alreadyExists: boolean;
  transaction: DepositTransaction;
  balanceCentavos: number;
  balance: number;
}> {
  const key = params.idempotencyKey || `dep-key-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  return apiFetch('/deposits', {
    method: 'POST',
    headers: {
      'X-Idempotency-Key': key,
    },
    body: JSON.stringify({
      ...params,
      idempotencyKey: key,
    }),
  });
}

export interface ApplyDepositParams {
  guestIdentifier: string;
  amountCentavos: number;
  applyType: 'room_extension' | 'booking' | 'receipt';
  roomNumber?: string;
  extensionHours?: number;
  bookingId?: string;
  receiptNo?: string;
  notes?: string;
  idempotencyKey?: string;
}

export async function applyDeposit(params: ApplyDepositParams): Promise<{
  alreadyExists: boolean;
  transaction: DepositTransaction;
  balanceCentavos: number;
  balance: number;
  updatedRoom?: any;
}> {
  const key = params.idempotencyKey || `apply-key-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  return apiFetch('/deposits/apply', {
    method: 'POST',
    headers: {
      'X-Idempotency-Key': key,
    },
    body: JSON.stringify({
      ...params,
      idempotencyKey: key,
    }),
  });
}

export async function collectSecurityDeposit(params: {
  roomNumber: string | number;
  amountCents: number;
  paymentMethod?: 'CASH' | 'GCASH' | 'MIXED';
  guestName?: string;
  bookingId?: string | number;
  notes?: string;
  idempotencyKey?: string;
}): Promise<{ deposit: Deposit; escposBufferBase64?: string }> {
  const key = params.idempotencyKey || (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `sec-key-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`);
  return apiFetch('/deposits/security', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': key },
    body: JSON.stringify({ ...params, idempotencyKey: key }),
  });
}

export async function getActiveRoomDeposit(roomNumber: string | number): Promise<{
  hasHeldDeposit: boolean;
  deposit: Deposit | null;
}> {
  return apiFetch<{ hasHeldDeposit: boolean; deposit: Deposit | null }>(`/deposits/active/${roomNumber}`);
}

export async function resolveDeposit(
  depositNumber: string,
  params: {
    action: 'refund' | 'apply' | 'forfeit';
    notes?: string;
    linkedReceiptNo?: string;
  }
): Promise<{
  deposit: Deposit;
  escposBufferBase64?: string;
}> {
  return apiFetch<{ deposit: Deposit; escposBufferBase64?: string }>(`/deposits/${depositNumber}/resolve`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getAllDeposits(filters?: {
  status?: string;
  limit?: number;
}): Promise<Deposit[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.limit) params.append('limit', String(filters.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<Deposit[]>(`/deposits/all${qs}`);
}


