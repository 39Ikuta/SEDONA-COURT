import { Receipt } from '../types';
import { apiFetch } from './client';

export interface SequenceInfo {
  sequence: string;
  prefix: string;
  lastValue: number;
  nextReceiptNumber: string;
}

export async function getReceipts(filters?: { cashier?: string; date?: string }): Promise<Receipt[]> {
  const params = new URLSearchParams();
  if (filters?.cashier) params.append('cashier', filters.cashier);
  if (filters?.date) params.append('date', filters.date);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<Receipt[]>(`/receipts${qs}`);
}

export async function getReceiptByNo(receiptNo: string): Promise<Receipt> {
  return apiFetch<Receipt>(`/receipts/${encodeURIComponent(receiptNo)}`);
}

export async function createReceipt(receipt: Receipt): Promise<Receipt> {
  const idempotencyKey = receipt.idempotencyKey || receipt.receiptNo || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
  return apiFetch<Receipt>('/receipts', {
    method: 'POST',
    headers: {
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      ...receipt,
      idempotencyKey,
    }),
  });
}

export async function reprintReceipt(receiptNo: string): Promise<Receipt> {
  return apiFetch<Receipt>(`/receipts/${encodeURIComponent(receiptNo)}/reprint`, {
    method: 'POST',
  });
}

export async function voidReceipt(receiptNo: string, reason: string): Promise<Receipt> {
  return apiFetch<Receipt>(`/receipts/${encodeURIComponent(receiptNo)}/void`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function getSequenceInfo(sequence: string = 'default'): Promise<SequenceInfo> {
  return apiFetch<SequenceInfo>(`/receipts/sequence-info?sequence=${encodeURIComponent(sequence)}`);
}

export async function updateSequenceSettings(
  startValue: number,
  prefix?: string,
  sequence: string = 'default'
): Promise<{ ok: boolean; sequence: string; lastValue: number; nextReceiptNumber: string }> {
  return apiFetch<{ ok: boolean; sequence: string; lastValue: number; nextReceiptNumber: string }>(
    '/receipts/sequence-settings',
    {
      method: 'POST',
      body: JSON.stringify({ sequence, startValue, prefix }),
    }
  );
}

export async function prePrintReceipt(payload: {
  roomNumber: string;
  cashierId?: string;
  paymentMethod?: string;
  cashAmount?: number;
  gcashAmount?: number;
  gcashRef?: string;
  amountTendered?: number;
  discountType?: string;
  discountIdRef?: string;
  rateSelected?: string;
  customHours?: number;
  extraBeds?: number;
  towelSets?: number;
  chargedFood?: any[];
}): Promise<Receipt> {
  return apiFetch<Receipt>('/receipts/pre-print', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

