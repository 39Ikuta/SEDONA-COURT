import { apiFetch } from './client';

export interface LoginResult {
  token: string;
  username: string;
  name: string;
  role: string;
}

export async function login(username: string, accessCode: string): Promise<LoginResult> {
  const result = await apiFetch<LoginResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, accessCode }),
  });
  if (result.token) {
    sessionStorage.setItem('scti_token', result.token);
    sessionStorage.setItem('scti_operator_role', result.role);
  }
  return result;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } finally {
    sessionStorage.removeItem('scti_token');
    sessionStorage.removeItem('scti_operator');
    sessionStorage.removeItem('scti_operator_role');
  }
}

