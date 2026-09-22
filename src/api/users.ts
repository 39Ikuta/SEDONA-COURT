/**
 * src/api/users.ts
 * Frontend API client for User Account Management (Owner operations).
 */

import { apiFetch } from './client';
import { UserRole } from '../types';

export interface UserAccountRecord {
  id: number;
  username: string;
  name: string;
  role: UserRole;
  created_at: string;
}

export interface UsersListResponse {
  users: UserAccountRecord[];
}

export interface CreateUserPayload {
  username: string;
  name: string;
  role: UserRole;
  accessCode: string;
}

/**
 * List all users. Only accessible by Owner and Admin.
 */
export async function getUsers(): Promise<UsersListResponse> {
  return apiFetch<UsersListResponse>('/users');
}

/**
 * Create a new user account. Restricted to Owner role.
 */
export async function createUser(
  data: CreateUserPayload
): Promise<{ success: boolean; message: string; user: UserAccountRecord }> {
  return apiFetch<{ success: boolean; message: string; user: UserAccountRecord }>('/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Delete a user account. Restricted to Owner role.
 */
export async function deleteUser(
  identifier: string | number
): Promise<{ success: boolean; message: string; deletedUser?: UserAccountRecord }> {
  return apiFetch<{ success: boolean; message: string; deletedUser?: UserAccountRecord }>(`/users/${identifier}`, {
    method: 'DELETE',
  });
}

/**
 * Reset staff access code / password. Restricted to Owner role.
 */
export async function resetUserPassword(
  identifier: string | number,
  accessCode: string
): Promise<{ success: boolean; message: string }> {
  return apiFetch<{ success: boolean; message: string }>(`/users/${identifier}/password`, {
    method: 'PUT',
    body: JSON.stringify({ accessCode }),
  });
}
