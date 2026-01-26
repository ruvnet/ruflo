/**
 * WebSocket Connection Manager
 * Handles WebSocket connections with auto-reconnect, heartbeat, and event routing
 */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface WebSocketMessage {
  type: string;
  channel?: string;
  payload?: unknown;
  timestamp?: number;
}

export type EventHandler<T = unknown> = (data: T) => void;

export interface WebSocketManagerConfig {
  url: string;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  heartbeatInterval?: number;
  protocols?: string[];
}

export class WebSocketManager {
  private url: string;
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private reconnectDelay: number;
  private heartbeatInterval: number;
  private protocols: string[];

  private eventHandlers: Map<string, Set<EventHandler>> = new Map();
  private subscribedChannels: Set<string> = new Set();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionStatus: ConnectionStatus = 'disconnected';
  private statusListeners: Set<(status: ConnectionStatus) => void> = new Set();
  private lastPongTime = 0;

  constructor(config: WebSocketManagerConfig) {
    this.url = config.url;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 10;
    this.reconnectDelay = config.reconnectDelay ?? 1000;
    this.heartbeatInterval = config.heartbeatInterval ?? 30000;
    this.protocols = config.protocols ?? [];
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  /**
   * Subscribe to connection status changes
   */
  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.connectionStatus !== status) {
      this.connectionStatus = status;
      this.statusListeners.forEach(listener => listener(status));
    }
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.setStatus('connecting');

      try {
        this.socket = this.protocols.length > 0
          ? new WebSocket(this.url, this.protocols)
          : new WebSocket(this.url);
      } catch (error) {
        this.setStatus('error');
        reject(error);
        return;
      }

      this.socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus('connected');
        this.startHeartbeat();

        // Resubscribe to previously subscribed channels
        this.subscribedChannels.forEach(channel => {
          this.sendMessage({ type: 'subscribe', channel });
        });

        resolve();
      };

      this.socket.onmessage = (event: MessageEvent) => {
        this.handleMessage(event);
      };

      this.socket.onclose = (event: CloseEvent) => {
        this.handleClose(event);
      };

      this.socket.onerror = (event: Event) => {
        this.handleError(event, reject);
      };
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(event: MessageEvent): void {
    let message: WebSocketMessage;

    try {
      message = JSON.parse(event.data);
    } catch {
      // Handle non-JSON messages
      message = { type: 'raw', payload: event.data };
    }

    // Normalize timestamp
    if (!message.timestamp) {
      message.timestamp = Date.now();
    }

    // Handle pong response for heartbeat
    if (message.type === 'pong') {
      this.lastPongTime = Date.now();
      return;
    }

    // Route message to appropriate handlers
    this.routeMessage(message);
  }

  /**
   * Route message to registered event handlers
   */
  private routeMessage(message: WebSocketMessage): void {
    const { type, channel } = message;

    // Notify type-specific handlers
    const typeHandlers = this.eventHandlers.get(type);
    if (typeHandlers) {
      typeHandlers.forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          console.error(`Error in event handler for type "${type}":`, error);
        }
      });
    }

    // Notify channel-specific handlers
    if (channel) {
      const channelHandlers = this.eventHandlers.get(`channel:${channel}`);
      if (channelHandlers) {
        channelHandlers.forEach(handler => {
          try {
            handler(message);
          } catch (error) {
            console.error(`Error in channel handler for "${channel}":`, error);
          }
        });
      }
    }

    // Notify wildcard handlers
    const wildcardHandlers = this.eventHandlers.get('*');
    if (wildcardHandlers) {
      wildcardHandlers.forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          console.error('Error in wildcard event handler:', error);
        }
      });
    }
  }

  /**
   * Handle WebSocket close event
   */
  private handleClose(event: CloseEvent): void {
    this.stopHeartbeat();

    // Normal closure or intentional disconnect
    if (event.code === 1000 || event.code === 1001) {
      this.setStatus('disconnected');
      return;
    }

    // Attempt reconnection
    this.attemptReconnect();
  }

  /**
   * Handle WebSocket error event
   */
  private handleError(event: Event, reject?: (reason?: unknown) => void): void {
    console.error('WebSocket error:', event);

    if (this.connectionStatus === 'connecting' && reject) {
      this.setStatus('error');
      reject(new Error('WebSocket connection failed'));
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus('error');
      console.error('Max reconnection attempts reached');
      return;
    }

    this.setStatus('reconnecting');
    this.reconnectAttempts++;

    // Calculate delay with exponential backoff (max 30 seconds)
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      30000
    );

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(error => {
        console.error('Reconnection failed:', error);
      });
    }, delay);
  }

  /**
   * Start heartbeat ping/pong mechanism
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastPongTime = Date.now();

    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }

      // Check if last pong was received within expected time
      const timeSinceLastPong = Date.now() - this.lastPongTime;
      if (timeSinceLastPong > this.heartbeatInterval * 2) {
        console.warn('Heartbeat timeout - connection may be stale');
        this.socket.close(4000, 'Heartbeat timeout');
        return;
      }

      this.sendMessage({ type: 'ping', timestamp: Date.now() });
    }, this.heartbeatInterval);
  }

  /**
   * Stop heartbeat mechanism
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Send a message through the WebSocket
   */
  sendMessage(message: WebSocketMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send message - WebSocket not connected');
      return false;
    }

    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Error sending message:', error);
      return false;
    }
  }

  /**
   * Subscribe to a channel
   */
  subscribe(channel: string): boolean {
    this.subscribedChannels.add(channel);

    if (this.socket?.readyState === WebSocket.OPEN) {
      return this.sendMessage({ type: 'subscribe', channel });
    }

    return true; // Will subscribe on reconnect
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channel: string): boolean {
    this.subscribedChannels.delete(channel);

    // Remove channel handlers
    this.eventHandlers.delete(`channel:${channel}`);

    if (this.socket?.readyState === WebSocket.OPEN) {
      return this.sendMessage({ type: 'unsubscribe', channel });
    }

    return true;
  }

  /**
   * Register an event handler for a specific event type
   * Returns an unsubscribe function
   */
  on<T = unknown>(eventType: string, handler: EventHandler<T>): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }

    const handlers = this.eventHandlers.get(eventType)!;
    handlers.add(handler as EventHandler);

    // Return unsubscribe function
    return () => {
      handlers.delete(handler as EventHandler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(eventType);
      }
    };
  }

  /**
   * Register a handler for messages on a specific channel
   */
  onChannel<T = unknown>(channel: string, handler: EventHandler<T>): () => void {
    return this.on(`channel:${channel}`, handler);
  }

  /**
   * Register a handler for all messages
   */
  onAll<T = unknown>(handler: EventHandler<T>): () => void {
    return this.on('*', handler);
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.onclose = null; // Prevent reconnection attempt
      this.socket.close(1000, 'Client disconnected');
      this.socket = null;
    }

    this.setStatus('disconnected');
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Get list of subscribed channels
   */
  getSubscribedChannels(): string[] {
    return Array.from(this.subscribedChannels);
  }

  /**
   * Clear all event handlers
   */
  clearHandlers(): void {
    this.eventHandlers.clear();
  }
}
