import { ForceCheckoutRequest, ForceCheckoutReason, ForceCheckoutResolution } from '../types';
import { apiFetch } from './client';

export interface SubmitForceCheckoutPayload {
  roomNumber: string;
  reason: ForceCheckoutReason;
  cashierNotes?: string;
  uncollectedAmount: number;
  billedBreakdown?: Array<{ description: string; subtext?: string; amount: number }>;
}

export interface ApproveForceCheckoutPayload {
  adminNotes?: string;
  resolutionType?: ForceCheckoutResolution;
}

export interface RejectForceCheckoutPayload {
  adminNotes: string;
}

export interface DirectForceCheckoutPayload {
  roomNumber: string;
  reason: ForceCheckoutReason;
  adminNotes?: string;
  uncollectedAmount: number;
  billedBreakdown?: Array<{ description: string; subtext?: string; amount: number }>;
  resolutionType?: ForceCheckoutResolution;
}

export async function getForceCheckoutRequests(status?: string): Promise<ForceCheckoutRequest[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiFetch<ForceCheckoutRequest[]>(`/force-checkout${query}`);
}

export async function submitForceCheckoutRequest(payload: SubmitForceCheckoutPayload): Promise<ForceCheckoutRequest> {
  return apiFetch<ForceCheckoutRequest>('/force-checkout', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function approveForceCheckoutRequest(
  id: string,
  payload: ApproveForceCheckoutPayload = {}
): Promise<ForceCheckoutRequest> {
  return apiFetch<ForceCheckoutRequest>(`/force-checkout/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function rejectForceCheckoutRequest(
  id: string,
  payload: RejectForceCheckoutPayload
): Promise<ForceCheckoutRequest> {
  return apiFetch<ForceCheckoutRequest>(`/force-checkout/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function directForceCheckoutOverride(
  payload: DirectForceCheckoutPayload
): Promise<{ success: boolean; message: string }> {
  return apiFetch<{ success: boolean; message: string }>('/force-checkout/direct-override', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
