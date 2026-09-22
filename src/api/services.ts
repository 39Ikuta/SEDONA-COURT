import { BillableService } from '../types';
import { apiFetch } from './client';

export async function getServices(): Promise<BillableService[]> {
  return apiFetch<BillableService[]>('/services');
}

export async function addService(service: Omit<BillableService, 'id'>): Promise<BillableService> {
  return apiFetch<BillableService>('/services', {
    method: 'POST',
    body: JSON.stringify(service),
  });
}

export async function updateService(service: BillableService): Promise<BillableService> {
  return apiFetch<BillableService>(`/services/${service.id}`, {
    method: 'PUT',
    body: JSON.stringify(service),
  });
}

export async function deleteService(id: string): Promise<void> {
  await apiFetch(`/services/${id}`, { method: 'DELETE' });
}
