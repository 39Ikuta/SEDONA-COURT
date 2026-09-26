import { AuditLogEntry } from '../types';
import { apiFetch } from './client';

export async function getAuditLogs(): Promise<AuditLogEntry[]> {
  try {
    return await apiFetch<AuditLogEntry[]>('/audit-logs');
  } catch (err: any) {
    if (
      err?.status === 403 ||
      err?.statusCode === 403 ||
      err?.message?.includes('403') ||
      err?.message?.includes('Access denied') ||
      err?.message?.includes('authorized') ||
      err?.message?.includes('Forbidden')
    ) {
      console.warn('Skipping audit logs fetch: current operator role is not authorized for admin audit logs.');
      return [];
    }
    throw err;
  }
}

export async function createAuditLog(log: Omit<AuditLogEntry, 'id'> & { id?: string }): Promise<AuditLogEntry> {
  return apiFetch<AuditLogEntry>('/audit-logs', {
    method: 'POST',
    body: JSON.stringify(log),
  });
}
