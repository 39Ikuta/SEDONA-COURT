import { apiFetch } from './client';

export interface POSRevenue {
  date: string;
  kitchen: number;
  drinks: number;
  miscell: number;
  total: number;
}

export async function getPOSRevenue(): Promise<POSRevenue> {
  return apiFetch<POSRevenue>('/pos-revenue');
}

export async function addPOSRevenue(
  amount: number,
  category: 'kitchen' | 'drinks' | 'miscell'
): Promise<POSRevenue> {
  return apiFetch<POSRevenue>('/pos-revenue/add', {
    method: 'POST',
    body: JSON.stringify({ amount, category }),
  });
}

export async function resetPOSRevenue(): Promise<POSRevenue> {
  return apiFetch<POSRevenue>('/pos-revenue/reset', { method: 'POST' });
}
