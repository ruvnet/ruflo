import { getErrorMessage } from '../utils/error-handler.js';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { Logger } from '../core/logger.js';
import { generateId } from '../utils/helpers.js';
import type { WebSocketMessage } from './websocket-coordinator.js';

export interface WebSocketClientConfig {
  url: string;
  agentId: string;
  capabilities: string[];
  reconnection: boolean;
  reconnectionAttempts: number;
  reconnectionDelay: number;
  reconnectionDelayMax: number;
  heartbeatInterval: number;
  messageTimeout: number;
  queueSize: number;
  enableCompression: boolean;
  autoAcknowledge: boolean;
}

export interface ClientMessage {
  id: string;
  type: string;
  payload: any;
  timestamp: number;
  handled?: boolean;
}

/**
 * WebSocket client for agents to connect to the coordination system
 * Provides reliable communication, automatic reconnection, and message handling
 */
export class WebSocketClient extends EventEmitter {
  private logger: Logger;
  private config: WebSocketClientConfig;
  private socket: WebSocket | null = null;
  private connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' = 'disconnected';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private messageQueue: WebSocketMessage[] = [];
  private pendingRequests: Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    timestamp: number;
  }> = new Map();
  private messageHandlers: Map<string, (message: ClientMessage) => void | Promise<void>> = new Map();
  private lastHeartbeat: number = 0;
  private connectionId: string | null = null;

  constructor(config: Partial<WebSocketClientConfig> = {}) {
    super();
    
    this.config = {
      url: 'ws://localhost:8080',
      agentId: generateId('agent'),
      capabilities: [],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      heartbeatInterval: 30000,
      messageTimeout: 30000,
      queueSize: 1000,
      enableCompression: true,
      autoAcknowledge: true,
      ...config
    };

    this.logger = new Logger(`WebSocketClient-${this.config.agentId}`);
    this.setupDefaultHandlers();
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      this.logger.warn('Already connected or connecting');
      return;
    }

    this.logger.info(`Connecting to WebSocket server: ${this.config.url}`);
    this.connectionState = 'connecting';

    try {
      // Construct connection URL with agent ID
      const url = new URL(this.config.url);
      url.searchParams.set('agentId', this.config.agentId);

      // Create WebSocket connection
      this.socket = new WebSocket(url.toString(), {
        perMessageDeflate: this.config.enableCompression,
        headers: {
          'X-Agent-ID': this.config.agentId,
          'X-Agent-Capabilities': this.config.capabilities.join(',')
        }
      });

      // Set up socket event handlers
      this.setupSocketHandlers();

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);

        this.socket!.once('open', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.socket!.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

    } catch (error) {
      this.logger.error('Failed to connect:', error);
      this.connectionState = 'disconnected';
      
      if (this.config.reconnection) {
        this.scheduleReconnect();
      }
      
      throw error;
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting from WebSocket server');
    
    // Clear reconnection timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Clear heartbeat timer
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Clear pending requests
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Client disconnected'));
    }
    this.pendingRequests.clear();

    // Close socket
    if (this.socket) {
      this.socket.close(1000, 'Client disconnect');
      this.socket = null;
    }

    this.connectionState = 'disconnected';
    this.connectionId = null;
    this.emit('disconnected');
  }

  /**
   * Send message to server or specific agent
   */
  async send(to: string | null, payload: any, priority: number = 0): Promise<void> {
    const message: WebSocketMessage = {
      id: generateId('msg'),
      type: 'message',
      from: this.config.agentId,
      to: to || undefined,
      payload,
      timestamp: Date.now(),
      priority
    };

    return this.sendMessage(message);
  }

  /**
   * Send request and wait for response
   */
  async sendRequest(to: string, payload: any, timeout: number = this.config.messageTimeout): Promise<any> {
    const message: WebSocketMessage = {
      id: generateId('request'),
      type: 'request',
      from: this.config.agentId,
      to,
      payload,
      timestamp: Date.now(),
      priority: 1
    };

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      this.pendingRequests.set(message.id, {
        resolve,
        reject,
        timeout: timeoutHandle,
        timestamp: Date.now()
      });

      this.sendMessage(message).catch(error => {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(message.id);
        reject(error);
      });
    });
  }

  /**
   * Send response to a request
   */
  async sendResponse(requestId: string, payload: any): Promise<void> {
    const message: WebSocketMessage = {
      id: generateId('response'),
      type: 'response',
      from: this.config.agentId,
      payload,
      timestamp: Date.now(),
      priority: 1,
      responseId: requestId
    };

    return this.sendMessage(message);
  }

  /**
   * Broadcast message to all agents
   */
  async broadcast(payload: any, excludeSelf: boolean = true): Promise<void> {
    const message: WebSocketMessage = {
      id: generateId('broadcast'),
      type: 'broadcast',
      from: this.config.agentId,
      payload: {
        ...payload,
        excludeSelf
      },
      timestamp: Date.now(),
      priority: 0
    };

    return this.sendMessage(message);
  }

  /**
   * Register message handler for specific message types
   */
  onMessage(type: string, handler: (message: ClientMessage) => void | Promise<void>): void {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Remove message handler
   */
  offMessage(type: string): void {
    this.messageHandlers.delete(type);
  }

  /**
   * Send heartbeat with current status
   */
  async sendHeartbeat(statusPayload: any = {}): Promise<void> {
    const message: WebSocketMessage = {
      id: generateId('heartbeat'),
      type: 'heartbeat',
      from: this.config.agentId,
      payload: {
        ...statusPayload,
        capabilities: this.config.capabilities,
        timestamp: Date.now()
      },
      timestamp: Date.now(),
      priority: 1
    };

    return this.sendMessage(message);
  }

  /**
   * Update agent capabilities
   */
  updateCapabilities(capabilities: string[]): void {
    this.config.capabilities = capabilities;
    this.logger.info('Updated capabilities:', capabilities);
    
    // Send capability update if connected
    if (this.isConnected()) {
      this.sendHeartbeat({ capabilitiesUpdated: true });
    }
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.connectionState === 'connected' && 
           this.socket !== null && 
           this.socket.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection state
   */
  getConnectionState(): typeof this.connectionState {
    return this.connectionState;
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    connectionState: string;
    reconnectAttempts: number;
    queuedMessages: number;
    pendingRequests: number;
    lastHeartbeat: number;
    connectionId: string | null;
  } {
    return {
      connectionState: this.connectionState,
      reconnectAttempts: this.reconnectAttempts,
      queuedMessages: this.messageQueue.length,
      pendingRequests: this.pendingRequests.size,
      lastHeartbeat: this.lastHeartbeat,
      connectionId: this.connectionId
    };
  }

  /**
   * Set up socket event handlers
   */
  private setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.on('open', () => {
      this.handleOpen();
    });

    this.socket.on('message', (data) => {
      this.handleMessage(data);
    });

    this.socket.on('close', (code, reason) => {
      this.handleClose(code, reason?.toString());
    });

    this.socket.on('error', (error) => {
      this.handleError(error);
    });

    this.socket.on('ping', () => {
      this.socket!.pong();
    });

    this.socket.on('pong', () => {
      this.lastHeartbeat = Date.now();
    });
  }

  /**
   * Handle connection open
   */
  private handleOpen(): void {
    this.logger.info('WebSocket connection established');
    this.connectionState = 'connected';
    this.reconnectAttempts = 0;
    this.lastHeartbeat = Date.now();

    // Start heartbeat
    this.startHeartbeat();

    // Process queued messages
    this.processMessageQueue();

    // Send initial heartbeat with capabilities
    this.sendHeartbeat({ connected: true });

    this.emit('connected');
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(data: Buffer | string): Promise<void> {
    try {
      const messageStr = data.toString();
      const message: WebSocketMessage = JSON.parse(messageStr);

      this.logger.debug('Received message:', { 
        type: message.type, 
        from: message.from,
        id: message.id 
      });

      // Handle different message types
      switch (message.type) {
        case 'pong':
          this.handlePong(message);
          break;
        case 'response':
          this.handleResponse(message);
          break;
        case 'request':
          await this.handleRequest(message);
          break;
        case 'message':
        case 'broadcast':
          await this.handleIncomingMessage(message);
          break;
        case 'error':
          this.handleServerError(message);
          break;
        case 'heartbeat':
          this.handleHeartbeatResponse(message);
          break;
        default:
          await this.handleIncomingMessage(message);
      }

      this.emit('message-received', message);

    } catch (error) {
      this.logger.error('Failed to process message:', error);
      this.emit('message-error', error);
    }
  }

  /**
   * Handle connection close
   */
  private handleClose(code: number, reason?: string): void {
    this.logger.info(`WebSocket connection closed: ${code} ${reason || ''}`);
    
    this.connectionState = 'disconnected';
    this.connectionId = null;

    // Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.emit('disconnected', { code, reason });

    // Attempt reconnection if enabled
    if (this.config.reconnection && code !== 1000) { // 1000 = normal closure
      this.scheduleReconnect();
    }
  }

  /**
   * Handle connection error
   */
  private handleError(error: Error): void {
    this.logger.error('WebSocket error:', error);
    this.emit('error', error);
  }

  /**
   * Handle pong response
   */
  private handlePong(message: WebSocketMessage): void {
    this.lastHeartbeat = Date.now();
  }

  /**
   * Handle response to request
   */
  private handleResponse(message: WebSocketMessage): void {
    const requestId = message.responseId;
    if (!requestId) return;

    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      pending.resolve(message.payload);
    }
  }

  /**
   * Handle incoming request
   */
  private async handleRequest(message: WebSocketMessage): Promise<void> {
    const clientMessage: ClientMessage = {
      id: message.id,
      type: message.type,
      payload: message.payload,
      timestamp: message.timestamp
    };

    // Check for specific request handler
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      try {
        await handler(clientMessage);
        
        if (this.config.autoAcknowledge && !clientMessage.handled) {
          await this.sendResponse(message.id, { acknowledged: true });
        }
      } catch (error) {
        this.logger.error('Request handler error:', error);
        await this.sendResponse(message.id, { 
          error: getErrorMessage(error),
          acknowledged: false 
        });
      }
    } else {
      // No specific handler, emit as event
      this.emit('request', clientMessage, (response: any) => {
        this.sendResponse(message.id, response);
      });
    }
  }

  /**
   * Handle incoming message or broadcast
   */
  private async handleIncomingMessage(message: WebSocketMessage): Promise<void> {
    const clientMessage: ClientMessage = {
      id: message.id,
      type: message.type,
      payload: message.payload,
      timestamp: message.timestamp
    };

    // Check for specific message handler
    const payloadType = message.payload?.type || message.type;
    const handler = this.messageHandlers.get(payloadType);
    
    if (handler) {
      try {
        await handler(clientMessage);
      } catch (error) {
        this.logger.error('Message handler error:', error);
        this.emit('handler-error', { message: clientMessage, error });
      }
    }

    // Always emit as event for additional handling
    this.emit('message', clientMessage);
  }

  /**
   * Handle server error message
   */
  private handleServerError(message: WebSocketMessage): void {
    const error = new Error(`Server error: ${message.payload?.message || 'Unknown error'}`);
    this.logger.error('Server error:', message.payload);
    this.emit('server-error', error, message.payload);
  }

  /**
   * Handle heartbeat response
   */
  private handleHeartbeatResponse(message: WebSocketMessage): void {
    this.lastHeartbeat = Date.now();
    
    if (message.payload?.serverTime) {
      const latency = Date.now() - message.payload.serverTime;
      this.emit('heartbeat', { latency, serverTime: message.payload.serverTime });
    }
  }

  /**
   * Send message to server
   */
  private async sendMessage(message: WebSocketMessage): Promise<void> {
    if (!this.isConnected()) {
      if (this.config.queueSize > 0 && this.messageQueue.length < this.config.queueSize) {
        this.messageQueue.push(message);
        this.logger.debug('Message queued (not connected):', message.id);
        return;
      } else {
        throw new Error('Not connected to WebSocket server');
      }
    }

    try {
      const messageStr = JSON.stringify(message);
      this.socket!.send(messageStr);
      this.logger.debug('Message sent:', { type: message.type, id: message.id });
    } catch (error) {
      this.logger.error('Failed to send message:', error);
      throw error;
    }
  }

  /**
   * Process queued messages
   */
  private processMessageQueue(): void {
    if (this.messageQueue.length === 0) return;

    this.logger.info(`Processing ${this.messageQueue.length} queued messages`);
    
    const messages = [...this.messageQueue];
    this.messageQueue = [];

    for (const message of messages) {
      this.sendMessage(message).catch(error => {
        this.logger.error('Failed to send queued message:', error);
        // Re-queue if still under limit
        if (this.messageQueue.length < this.config.queueSize) {
          this.messageQueue.push(message);
        }
      });
    }
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this.sendHeartbeat().catch(error => {
          this.logger.error('Failed to send heartbeat:', error);
        });
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.reconnectionAttempts) {
      this.logger.error('Max reconnection attempts reached');
      this.emit('reconnect-failed');
      return;
    }

    this.connectionState = 'reconnecting';
    this.reconnectAttempts++;

    const delay = Math.min(
      this.config.reconnectionDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.config.reconnectionDelayMax
    );

    this.logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.reconnectionAttempts})`);
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(error => {
        this.logger.error('Reconnection failed:', error);
      });
    }, delay);
  }

  /**
   * Set up default message handlers
   */
  private setupDefaultHandlers(): void {
    // Handle welcome message
    this.onMessage('welcome', (message) => {
      this.connectionId = message.payload?.clientId;
      this.logger.info('Received welcome message:', message.payload);
    });

    // Handle initial state
    this.onMessage('initial-state', (message) => {
      this.logger.info('Received initial state:', {
        connectedAgents: message.payload?.connectedAgents?.length || 0,
        swarmStatus: message.payload?.swarmStatus
      });
      this.emit('initial-state', message.payload);
    });

    // Handle swarm events
    this.onMessage('agent-registered', (message) => {
      this.emit('agent-registered', message.payload);
    });

    this.onMessage('agent-terminated', (message) => {
      this.emit('agent-terminated', message.payload);
    });

    this.onMessage('task-assigned', (message) => {
      this.emit('task-assigned', message.payload);
    });

    this.onMessage('task-completed', (message) => {
      this.emit('task-completed', message.payload);
    });

    this.onMessage('task-failed', (message) => {
      this.emit('task-failed', message.payload);
    });

    // Handle status updates
    this.onMessage('status-update', (message) => {
      this.emit('status-update', message.payload);
    });

    this.onMessage('task-update', (message) => {
      this.emit('task-update', message.payload);
    });
  }
}