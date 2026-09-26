/**
 * server/websocket/socket-manager.ts
 * WebSocket manager for real-time updates across the property management system
 */

import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';

import { bucketRoomStatus } from '../routes/customer-display';
import { isOriginAllowed } from '../utils/cors';

export interface SanitizedDisplayRoomEvent {
  roomNumber: string;
  roomType: string;
  tier: string;
  floor: number;
  status: 'available' | 'occupied' | 'unavailable';
  checkInTime: string | null;
}

function sanitizeRoomForDisplay(data: any): SanitizedDisplayRoomEvent {
  const roomNumber = String(data.number || data.roomNumber || '');
  const roomType = data.room_type || data.roomType || 'Standard Room';
  const state = data.state || 'available';
  const tier = data.tier || 'Standard';
  const floor = Number(data.floor || 1);

  const status = bucketRoomStatus(roomNumber, roomType, state);
  let checkInTime: string | null = null;
  if (status === 'occupied') {
    const raw = data.checkInTime || data.check_in_time;
    if (raw) {
      const parsed = new Date(raw);
      if (!isNaN(parsed.getTime())) {
        checkInTime = parsed.toISOString();
      }
    }
  }

  return {
    roomNumber,
    roomType,
    tier,
    floor,
    status,
    checkInTime,
  };
}

export class SocketManager {
  private io: SocketIOServer | null = null;

  /**
   * Initialize Socket.IO server (matches existing interface)
   */
  initialize(httpServer: HTTPServer): void {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: (origin, callback) => {
          if (isOriginAllowed(origin)) {
            return callback(null, true);
          }
          return callback(null, false);
        },
        methods: ['GET', 'POST'],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
      connectTimeout: 45000,
      transports: ['websocket', 'polling'],
    });

    this.io.use((socket, next) => {
      const token = socket.handshake.auth?.token || (socket.handshake.query?.token as string);
      if (!token) {
        // Safe default to guest display for unauthenticated clients/kiosks
        socket.data.user = { id: 0, username: 'guest', role: 'customer_display', name: 'Guest Display' };
        (socket as any).user = socket.data.user;
        return next();
      }
      try {
        const { verifyJwt } = require('../utils/jwt');
        const verifyResult = verifyJwt(token);
        if (!verifyResult.valid || !verifyResult.payload) {
          // Token expired or invalid - fallback to guest display
          socket.data.user = { id: 0, username: 'guest', role: 'customer_display', name: 'Guest Display' };
          (socket as any).user = socket.data.user;
          return next();
        }
        (socket as any).user = verifyResult.payload;
        socket.data.user = verifyResult.payload;
        next();
      } catch {
        socket.data.user = { id: 0, username: 'guest', role: 'customer_display', name: 'Guest Display' };
        (socket as any).user = socket.data.user;
        next();
      }
    });

    this.io.on('connection', (socket) => {
      const user = socket.data.user || (socket as any).user;
      const role = user?.role;
      console.log(`WebSocket connected: ${socket.id} (User: ${user?.username || 'guest'}, Role: ${role || 'customer_display'})`);

      // Automatic least-privilege room routing
      if (role === 'customer_display') {
        socket.join('room:display');
      } else if (role === 'kitchen') {
        socket.join('room:kitchen');
        socket.join('kitchen-staff');
      } else if (role === 'cashier' || role === 'admin' || role === 'owner') {
        socket.join('room:staff');
      } else {
        socket.join('room:display');
      }

      // Handle dynamic token authentication & refresh
      socket.on('auth:authenticate', (token: string, callback?: (res: any) => void) => {
        try {
          if (!token) {
            socket.data.user = { id: 0, username: 'guest', role: 'customer_display', name: 'Guest Display' };
            (socket as any).user = socket.data.user;
            socket.leave('room:staff');
            socket.leave('room:kitchen');
            socket.leave('kitchen-staff');
            socket.join('room:display');
            if (callback) callback({ success: true, role: 'customer_display' });
            return;
          }
          const { verifyJwt } = require('../utils/jwt');
          const verifyResult = verifyJwt(token);
          if (verifyResult.valid && verifyResult.payload) {
            socket.data.user = verifyResult.payload;
            (socket as any).user = verifyResult.payload;
            const newRole = verifyResult.payload.role;
            if (newRole === 'kitchen') {
              socket.join('room:kitchen');
              socket.join('kitchen-staff');
            } else if (newRole === 'cashier' || newRole === 'admin' || newRole === 'owner') {
              socket.join('room:staff');
            } else {
              socket.join('room:display');
            }
            console.log(`🔑 WebSocket ${socket.id} re-authenticated as ${verifyResult.payload.username} (${newRole})`);
            if (callback) callback({ success: true, role: newRole });
          } else {
            if (callback) callback({ success: false, error: 'Invalid or expired token' });
          }
        } catch (err: any) {
          if (callback) callback({ success: false, error: err.message });
        }
      });

      socket.on('disconnect', () => {
        console.log(`WebSocket disconnected: ${socket.id}`);
      });

      // Handle kitchen-specific events
      socket.on('kitchen:join', () => {
        socket.join('kitchen-staff');
        console.log(`Socket ${socket.id} joined kitchen staff room`);
      });

      socket.on('kitchen:leave', () => {
        socket.leave('kitchen-staff');
        console.log(`Socket ${socket.id} left kitchen staff room`);
      });
    });

    console.log('🔄 WebSocket server initialized');
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(event: string, data: any): void {
    if (!this.io) {
      console.warn('WebSocket not initialized, cannot broadcast');
      return;
    }

    this.io.emit(event, data);
    console.log(`📡 Broadcast: ${event}`);
  }

  /**
   * Broadcast room update (existing interface)
   * Sends full data to staff room and sanitized data to display room.
   */
  broadcastRoomUpdate(data: any): void {
    if (!this.io) {
      console.warn('WebSocket not initialized, cannot broadcast room update');
      return;
    }
    this.io.to('room:staff').emit('room:updated', data);
    const sanitized = sanitizeRoomForDisplay(data);
    this.io.to('room:display').emit('room:updated', sanitized);
  }

  /**
   * Broadcast alarm (existing interface)
   */
  broadcastAlarm(data: any): void {
    if (!this.io) return;
    this.io.to('room:staff').emit('room:alarm', data);
  }

  /**
   * Broadcast system notification (existing interface)
   */
  broadcastSystemNotification(message: string, type: string): void {
    if (!this.io) return;
    this.io.to('room:staff').emit('system:notification', { message, type });
  }

  /**
   * Broadcast booking event (existing interface)
   */
  broadcastBookingEvent(data: any): void {
    if (!this.io) return;
    this.io.to('room:staff').emit('booking:event', data);
  }

  /**
   * Broadcast receipt creation (existing interface)
   * STRICT PII SEGREGATION: Receipts never broadcast to display/kiosk
   */
  broadcastReceiptCreated(data: any): void {
    if (!this.io) return;
    this.io.to('room:staff').emit('receipt:created', data);
  }

  /**
   * Send message to kitchen room only
   */
  broadcastToKitchen(event: string, data: any): void {
    if (!this.io) {
      console.warn('WebSocket not initialized, cannot broadcast to kitchen');
      return;
    }

    this.io.to('kitchen-staff').emit(event, data);
    console.log(`🍳 Kitchen broadcast: ${event}`);
  }

  /**
   * Send message to kitchen staff only
   */
  broadcastToKitchenStaff(event: string, data: any): void {
    if (!this.io) {
      console.warn('WebSocket not initialized, cannot broadcast to kitchen staff');
      return;
    }

    this.io.to('kitchen-staff').emit(event, data);
    console.log(`👨‍🍳 Kitchen staff broadcast: ${event}`);
  }

  /**
   * Get Socket.IO instance for advanced usage
   */
  getIO(): SocketIOServer | null {
    return this.io;
  }

  /**
   * Get connection count (existing interface)
   */
  getConnectedCount(): number {
    if (!this.io) return 0;
    return this.io.engine.clientsCount;
  }
}

// Export singleton instance
export const socketManager = new SocketManager();