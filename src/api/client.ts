/**
 * src/api/client.ts
 * Base fetch wrapper for all API calls with automatic retry on transient
 * proxy/gateway errors (502, 503, 504) and system sleep/wake recovery.
 * Automatically attaches the signed JWT Bearer token from sessionStorage.
 */

const API_BASE = '/api';

export interface ApiFetchOptions extends RequestInit {
  retries?: number;
  retryDelay?: number;
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const maxRetries = options.retries !== undefined ? options.retries : 2;
  const initialDelay = options.retryDelay || 400;

  let attempt = 0;

  while (true) {
    attempt++;
    try {
      const token = sessionStorage.getItem('scti_token') || '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
      });

      if (!res.ok) {
        // Handle transient 502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout
        const isTransientGatewayError = res.status === 502 || res.status === 503 || res.status === 504;
        if (isTransientGatewayError && attempt <= maxRetries) {
          const delay = initialDelay * Math.pow(2, attempt - 1);
          console.warn(`⚠️ Transient ${res.status} on ${path}. Retrying in ${delay}ms (attempt ${attempt}/${maxRetries})...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        const body = await res.json().catch(() => ({}));
        if (
          res.status === 401 &&
          (body.error?.includes('expire') ||
            body.error?.includes('token') ||
            body.error?.includes('Invalid') ||
            body.error?.includes('Unauthorized'))
        ) {
          sessionStorage.removeItem('scti_token');
          sessionStorage.removeItem('scti_operator');
          window.dispatchEvent(
            new CustomEvent('scti:session-expired', {
              detail: { error: body.error || 'Token expired' },
            })
          );
        }

        const fallbackError = isTransientGatewayError
          ? 'Backend server is temporarily reconnecting (502 Bad Gateway). Please retry in a moment.'
          : `API error ${res.status}`;
        throw new Error(body.error || fallbackError);
      }

      return (await res.json()) as Promise<T>;
    } catch (err: any) {
      // Catch network-level failures (e.g. Failed to fetch during computer sleep/wake)
      const isNetworkError =
        err instanceof TypeError ||
        err?.message?.includes('Failed to fetch') ||
        err?.message?.includes('NetworkError') ||
        err?.message?.includes('Load failed');

      if (isNetworkError && attempt <= maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt - 1);
        console.warn(`⚠️ Network fetch error on ${path}. Retrying in ${delay}ms (attempt ${attempt}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw err;
    }
  }
}

export function getAuthHeader(): string | null {
  const token = sessionStorage.getItem('scti_token');
  return token ? `Bearer ${token}` : null;
}


