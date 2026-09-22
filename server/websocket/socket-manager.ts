/**
 * server/websocket/socket-manager.ts
 * WebSocket manager for real-time updates across the property management system
 */

import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';

export class SocketManager {
  private io: SocketIOServer | null = null;

  /**
   * Initialize Socket.IO server (matches existing interface)
   */
  initialize(httpServer: HTTPServer): void {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: "*", // Configure appropriately for production
        methods: ["GET", "POST"]
      },
      pingTimeout: 60000,
      pingInterval: 25000,
      connectTimeout: 45000,
      transports: ['websocket', 'polling']
    });

    this.io.on('connection', (socket) => {
      console.log(`WebSocket connected: ${socket.id}`);

      // Auto-join all clients to general room
      socket.join('general');
      socket.join('kitchen');

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
   */
  broadcastRoomUpdate(data: any): void {
    this.broadcast('room:update', data);
  }

  /**
   * Broadcast alarm (existing interface)
   */
  broadcastAlarm(data: any): void {
    this.broadcast('room:alarm', data);
  }

  /**
   * Broadcast system notification (existing interface)
   */
  broadcastSystemNotification(message: string, type: string): void {
    this.broadcast('system:notification', { message, type });
  }

  /**
   * Broadcast booking event (existing interface)
   */
  broadcastBookingEvent(data: any): void {
    this.broadcast('booking:event', data);
  }

  /**
   * Broadcast receipt creation (existing interface)
   */
  broadcastReceiptCreated(data: any): void {
    this.broadcast('receipt:created', data);
  }

  /**
   * Send message to kitchen room only
   */
  broadcastToKitchen(event: string, data: any): void {
    if (!this.io) {
      console.warn('WebSocket not initialized, cannot broadcast to kitchen');
      return;
    }

    this.io.to('kitchen').emit(event, data);
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