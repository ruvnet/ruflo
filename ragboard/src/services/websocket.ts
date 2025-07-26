export type WebSocketEvent = 
  | 'resource.created'
  | 'resource.updated'
  | 'resource.deleted'
  | 'resource.processing'
  | 'resource.processed'
  | 'chat.message'
  | 'chat.connected'
  | 'board.updated'
  | 'connection.created'
  | 'connection.deleted'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'max_reconnect_failed'
  | 'send_failed';

interface WebSocketMessage {
  event: WebSocketEvent;
  data: any;
  timestamp: string;
}

// Browser-compatible EventEmitter implementation
class EventEmitter {
  private events: Map<string, Array<(...args: any[]) => void>> = new Map();

  on(event: string, listener: (...args: any[]) => void): void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(listener);
  }

  off(event: string, listener: (...args: any[]) => void): void {
    const listeners = this.events.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  emit(event: string, ...args: any[]): void {
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(...args);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }
}

class WebSocketService extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private heartbeatInterval: number | null = null;
  private isConnected = false;

  constructor(private wsUrl: string = 'ws://localhost:8000/ws') {
    super();
  }

  connect(boardId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    const token = localStorage.getItem('auth_token');
    const url = `${this.wsUrl}?board_id=${boardId}&token=${token}`;

    try {
      this.ws = new WebSocket(url);
      this.setupEventHandlers();
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      this.scheduleReconnect();
    }
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.emit('connected');
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        console.log('WebSocket message:', message);
        this.emit(message.event, message.data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', error);
    };

    this.ws.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      this.isConnected = false;
      this.stopHeartbeat();
      this.emit('disconnected');
      
      if (!event.wasClean) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.emit('max_reconnect_failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    setTimeout(() => {
      if (!this.isConnected) {
        const boardId = new URLSearchParams(window.location.search).get('board_id') || '';
        this.connect(boardId);
      }
    }, delay);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send('ping', {});
      }
    }, 30000); // Send ping every 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  send(event: string, data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({ event, data });
      this.ws.send(message);
    } else {
      console.warn('WebSocket is not connected');
      this.emit('send_failed', { event, data });
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.isConnected = false;
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  // Subscribe to specific events
  onResourceCreated(callback: (data: any) => void): void {
    this.on('resource.created', callback);
  }

  onResourceUpdated(callback: (data: any) => void): void {
    this.on('resource.updated', callback);
  }

  onResourceProcessing(callback: (data: any) => void): void {
    this.on('resource.processing', callback);
  }

  onResourceProcessed(callback: (data: any) => void): void {
    this.on('resource.processed', callback);
  }

  onChatMessage(callback: (data: any) => void): void {
    this.on('chat.message', callback);
  }

  onBoardUpdated(callback: (data: any) => void): void {
    this.on('board.updated', callback);
  }
}

// Create singleton instance
const wsService = new WebSocketService();

export default wsService;