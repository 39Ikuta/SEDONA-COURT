/**
 * src/api/socket.ts
 * Real-time WebSocket client instance for SCTI Property Management System.
 * Supports auto-fallback between WebSocket and HTTP polling transports,
 * passes stored JWT tokens for server authentication, and supports live auth refreshes.
 */

import { io, Socket } from 'socket.io-client';

/**
 * Retrieve current JWT session token from session or local storage across all known keys.
 */
export function getStoredToken(): string {
  if (typeof window === 'undefined') return '';
  return (
    sessionStorage.getItem('scti_token') ||
    localStorage.getItem('scti_token') ||
    sessionStorage.getItem('scti_session_token') ||
    localStorage.getItem('scti_session_token') ||
    sessionStorage.getItem('token') ||
    localStorage.getItem('token') ||
    ''
  );
}

/**
 * Determine the server base URL for WebSocket connections.
 * Defaults to current window origin or standard localhost port.
 */
const getSocketUrl = (): string => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost:3000';
};

// Create singleton socket instance
export const socket: Socket = io(getSocketUrl(), {
  transports: ['websocket', 'polling'],
  upgrade: true,
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  auth: (cb) => {
    cb({ token: getStoredToken() });
  },
});

/**
 * Refresh or update the authentication token on the active socket.
 * Call after login, token refresh, or logout.
 */
export function updateSocketAuth(newToken?: string): void {
  const token = newToken !== undefined ? newToken : getStoredToken();
  socket.auth = { token };

  if (socket.connected) {
    socket.emit('auth:authenticate', token, (res: { success?: boolean; role?: string; error?: string }) => {
      if (!res?.success && token) {
        console.warn('⚠️ Socket live authentication failed, reconnecting...');
        socket.disconnect().connect();
      }
    });
  } else {
    socket.connect();
  }
}

// Lifecycle diagnostics
socket.on('connect', () => {
  console.log(`⚡ WebSocket connected [${socket.id}] transport: ${socket.io.engine?.transport?.name}`);
});

socket.on('connect_error', (err) => {
  console.warn('⚠️ WebSocket connection notice:', err.message);
});

socket.io.engine?.on('upgrade', (transport) => {
  console.log('🚀 WebSocket transport upgraded to:', transport.name);
});
