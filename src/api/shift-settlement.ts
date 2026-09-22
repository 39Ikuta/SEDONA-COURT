/**
 * src/api/shift-settlement.ts
 * Frontend client for cashier shift cash reconciliation and operating expenses.
 */

import { apiFetch } from './client';

export interface ShiftExpense {
  id: string;
  shiftDate: string;
  shiftType: 'DAY' | 'NIGHT';
  cashierId: string;
  description: string;
  amount: number;
  createdAt: string;
  updatedAt?: string;
}

export interface ShiftSettlementSummary {
  shiftDate: string;
  shiftType: 'DAY' | 'NIGHT';
  startTime: string;
  endTime: string;
  totalIncome: number;
  totalGcash: number;
  totalCashReceived: number;
  totalExpenses: number;
  expectedCashOnHand: number;
  receiptCount: number;
  expenses: ShiftExpense[];
}

export async function getShiftSettlementSummary(date?: string, shift?: 'DAY' | 'NIGHT'): Promise<ShiftSettlementSummary> {
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (shift) params.set('shift', shift);

  const query = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<ShiftSettlementSummary>(`/shift-settlement/summary${query}`);
}

export async function addShiftExpense(
  description: string,
  amount: number,
  shiftDate?: string,
  shiftType?: 'DAY' | 'NIGHT'
): Promise<ShiftExpense> {
  return apiFetch<ShiftExpense>('/shift-settlement/expenses', {
    method: 'POST',
    body: JSON.stringify({ description, amount, shiftDate, shiftType }),
  });
}

export async function deleteShiftExpense(id: string): Promise<void> {
  return apiFetch<void>(`/shift-settlement/expenses/${id}`, {
    method: 'DELETE',
  });
}

