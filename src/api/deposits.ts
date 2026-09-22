/**
 * src/api/deposits.ts
 * Frontend API client for guest deposits and credit balance ledger.
 */

import { DepositTransaction, DepositBalanceInfo } from '../types';
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
