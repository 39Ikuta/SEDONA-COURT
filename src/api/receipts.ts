import { Receipt } from '../types';
import { apiFetch } from './client';

export async function getReceipts(filters?: { cashier?: string; date?: string }): Promise<Receipt[]> {
  const params = new URLSearchParams();
  if (filters?.cashier) params.append('cashier', filters.cashier);
  if (filters?.date) params.append('date', filters.date);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<Receipt[]>(`/receipts${qs}`);
}

export async function createReceipt(receipt: Receipt): Promise<Receipt> {
  return apiFetch<Receipt>('/receipts', {
    method: 'POST',
    headers: {
      'X-Idempotency-Key': receipt.receiptNo,
    },
    body: JSON.stringify(receipt),
  });
}

