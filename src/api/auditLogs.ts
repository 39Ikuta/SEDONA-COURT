import { AuditLogEntry } from '../types';
import { apiFetch } from './client';

export async function getAuditLogs(): Promise<AuditLogEntry[]> {
  return apiFetch<AuditLogEntry[]>('/audit-logs');
}

export async function createAuditLog(log: Omit<AuditLogEntry, 'id'> & { id?: string }): Promise<AuditLogEntry> {
  return apiFetch<AuditLogEntry>('/audit-logs', {
    method: 'POST',
    body: JSON.stringify(log),
  });
}
