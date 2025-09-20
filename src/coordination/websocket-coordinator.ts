import { getErrorMessage } from '../utils/error-handler.js';
import { EventEmitter } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer, Server } from 'node:http';
import { Logger } from '../core/logger.js';
import { EventBus } from '../core/event-bus.js';
import { generateId } from '../utils/helpers.js';
import { MemoryManager } from '../memory/manager.js';
import type { Message, CoordinationConfig } from '../utils/types.js';

export interface WebSocketMessage {
  id: string;
  type: 'ping' | 'pong' | 'message' | 'broadcast' | 'request' | 'response' | 'error' | 'heartbeat';
  from: string;
  to?: string;
  payload?: any;
  timestamp: number;
  priority: number;
  requestId?: string;
  responseId?: string;
  ttl?: number;
}

export interface WebSocketClient {
  id: string;
  agentId: string;
  socket: WebSocket;
  lastHeartbeat: number;
  connected: boolean;
  capabilities: string[];
  messageQueue: WebSocketMessage[];
  subscriptions: Set<string>;
  metadata: {
    userAgent?: string;
    connectTime: number;
    messagesSent: number;
    messagesReceived: number;
    totalBytes: number;
  };
}

export interface WebSocketCoordinatorConfig {
  port: number;
  host: string;
  heartbeatInterval: number;
  heartbeatTimeout: number;
  maxConnections: number;
  maxMessageSize: number;
  messageQueueSize: number;
  compressionEnabled: boolean;
  autoReconnect: boolean;
  retryAttempts: number;
  retryDelay: number;
  enableLoadBalancing: boolean;
  enableMessagePersistence: boolean;
  enableTopologyAware: boolean;
  topologyConstraints: 'none' | 'mesh' | 'hierarchical' | 'ring' | 'star';
}

export interface ConnectionPool {
  connections: Map<string, WebSocketClient>;
  byAgent: Map<string, string[]>; // agentId -> clientIds
  byCapability: Map<string, string[]>; // capability -> clientIds
  stats: {
    totalConnections: number;
    activeConnections: number;
    totalMessages: number;
    totalBytes: number;
    uptime: number;
  };
}

/**
 * Real-time WebSocket coordination system for agent communication
 * Provides reliable messaging, connection management, and topology-aware routing
 */
export class WebSocketCoordinator extends EventEmitter {
  private logger: Logger;
  private config: WebSocketCoordinatorConfig;
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private connectionPool: ConnectionPool;
  private memoryManager: MemoryManager;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private messageRouterMap: Map<string, string[]> = new Map(); // message type -> interested clients
  private pendingRequests: Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    timestamp: number;
  }> = new Map();

  constructor(config: Partial<WebSocketCoordinatorConfig> = {}, eventBus: EventBus, memoryManager: MemoryManager) {
    super();
    this.logger = new Logger('WebSocketCoordinator');
    this.config = {
      port: 8080,
      host: '0.0.0.0',
      heartbeatInterval: 30000, // 30 seconds
      heartbeatTimeout: 60000, // 60 seconds
      maxConnections: 1000,
      maxMessageSize: 1024 * 1024, // 1MB
      messageQueueSize: 100,
      compressionEnabled: true,
      autoReconnect: true,
      retryAttempts: 5,
      retryDelay: 1000,
      enableLoadBalancing: true,
      enableMessagePersistence: true,
      enableTopologyAware: true,
      topologyConstraints: 'mesh',
      ...config
    };

    this.connectionPool = {
      connections: new Map(),
      byAgent: new Map(),
      byCapability: new Map(),
      stats: {
        totalConnections: 0,
        activeConnections: 0,
        totalMessages: 0,
        totalBytes: 0,
        uptime: Date.now()
      }
    };

    this.memoryManager = memoryManager;
    this.setupEventHandlers();
  }

  /**
   * Start the WebSocket server and begin accepting connections
   */
  async start(): Promise<void> {
    if (this.server) {
      this.logger.warn('WebSocket coordinator already started');
      return;
    }

    this.logger.info(`Starting WebSocket coordinator on ${this.config.host}:${this.config.port}`);

    try {
      // Create HTTP server
      this.server = createServer();
      
      // Create WebSocket server
      this.wss = new WebSocketServer({
        server: this.server,
        perMessageDeflate: this.config.compressionEnabled,
        maxPayload: this.config.maxMessageSize,
        clientTracking: true
      });

      // Set up WebSocket server event handlers
      this.wss.on('connection', (socket, request) => {
        this.handleNewConnection(socket, request);
      });

      this.wss.on('error', (error) => {
        this.logger.error('WebSocket server error:', error);
        this.emit('server-error', error);
      });

      // Start HTTP server
      await new Promise<void>((resolve, reject) => {
        this.server!.listen(this.config.port, this.config.host, (error?: Error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      // Start background processes
      this.startHeartbeat();
      this.startCleanup();

      this.connectionPool.stats.uptime = Date.now();
      this.logger.info(`WebSocket coordinator started successfully`);
      this.emit('coordinator-started', { port: this.config.port, host: this.config.host });

    } catch (error) {
      this.logger.error('Failed to start WebSocket coordinator:', error);
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop the WebSocket server and close all connections
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping WebSocket coordinator...');

    // Stop background processes
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Clear pending requests
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('WebSocket coordinator shutting down'));
    }
    this.pendingRequests.clear();

    // Close all client connections
    for (const client of this.connectionPool.connections.values()) {
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.close(1001, 'Server shutting down');
      }
    }

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close HTTP server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          resolve();
        });
      });
      this.server = null;
    }

    this.connectionPool.connections.clear();
    this.connectionPool.byAgent.clear();
    this.connectionPool.byCapability.clear();

    this.logger.info('WebSocket coordinator stopped');
    this.emit('coordinator-stopped');
  }

  /**
   * Handle new WebSocket connection
   */
  private handleNewConnection(socket: WebSocket, request: any): void {
    // Check connection limits
    if (this.connectionPool.connections.size >= this.config.maxConnections) {
      this.logger.warn('Connection limit reached, rejecting new connection');
      socket.close(1013, 'Server overloaded');
      return;
    }

    const clientId = generateId('ws-client');
    const agentId = this.extractAgentId(request) || generateId('agent');

    const client: WebSocketClient = {
      id: clientId,
      agentId,
      socket,
      lastHeartbeat: Date.now(),
      connected: true,
      capabilities: [],
      messageQueue: [],
      subscriptions: new Set(),
      metadata: {
        userAgent: request.headers['user-agent'],
        connectTime: Date.now(),
        messagesSent: 0,
        messagesReceived: 0,
        totalBytes: 0
      }
    };

    // Register client
    this.connectionPool.connections.set(clientId, client);
    this.addToAgentIndex(agentId, clientId);
    this.connectionPool.stats.totalConnections++;
    this.connectionPool.stats.activeConnections++;

    this.logger.info(`New WebSocket connection established`, { clientId, agentId });

    // Set up client event handlers
    this.setupClientHandlers(client);

    // Send welcome message
    this.sendToClient(client, {
      id: generateId('msg'),
      type: 'message',
      from: 'coordinator',
      payload: {
        type: 'welcome',
        clientId,
        agentId,
        serverTime: Date.now()
      },
      timestamp: Date.now(),
      priority: 1
    });

    this.emit('client-connected', { clientId, agentId });
  }

  /**
   * Set up event handlers for a client connection
   */
  private setupClientHandlers(client: WebSocketClient): void {
    const { socket, id: clientId } = client;

    socket.on('message', async (data) => {
      try {
        await this.handleClientMessage(client, data);
      } catch (error) {
        this.logger.error(`Error handling message from client ${clientId}:`, error);
        this.sendError(client, 'message-error', getErrorMessage(error));
      }
    });

    socket.on('close', (code, reason) => {
      this.handleClientDisconnect(client, code, reason?.toString());
    });

    socket.on('error', (error) => {
      this.logger.error(`Client socket error for ${clientId}:`, error);
      this.handleClientError(client, error);
    });

    socket.on('pong', () => {
      client.lastHeartbeat = Date.now();
    });
  }

  /**
   * Handle incoming message from client
   */
  private async handleClientMessage(client: WebSocketClient, data: Buffer | string): Promise<void> {
    let message: WebSocketMessage;

    try {
      const messageStr = data.toString();
      message = JSON.parse(messageStr);
      
      // Update client stats
      client.metadata.messagesReceived++;
      client.metadata.totalBytes += messageStr.length;
      this.connectionPool.stats.totalMessages++;
      this.connectionPool.stats.totalBytes += messageStr.length;

    } catch (error) {
      this.sendError(client, 'parse-error', 'Invalid message format');
      return;
    }

    // Validate message
    if (!this.validateMessage(message)) {
      this.sendError(client, 'validation-error', 'Invalid message structure');
      return;
    }

    // Update message timestamp and ensure from field
    message.timestamp = Date.now();
    message.from = client.agentId;

    this.logger.debug(`Received message from ${client.agentId}`, { 
      type: message.type, 
      to: message.to,
      messageId: message.id 
    });

    // Handle different message types
    switch (message.type) {
      case 'ping':
        await this.handlePing(client, message);
        break;
      case 'message':
        await this.handleDirectMessage(client, message);
        break;
      case 'broadcast':
        await this.handleBroadcast(client, message);
        break;
      case 'request':
        await this.handleRequest(client, message);
        break;
      case 'response':
        await this.handleResponse(client, message);
        break;
      case 'heartbeat':
        await this.handleHeartbeat(client, message);
        break;
      default:
        this.sendError(client, 'unknown-type', `Unknown message type: ${message.type}`);
    }

    // Store message if persistence is enabled
    if (this.config.enableMessagePersistence) {
      await this.persistMessage(message);
    }

    this.emit('message-processed', { client: client.id, message });
  }

  /**
   * Handle ping message
   */
  private async handlePing(client: WebSocketClient, message: WebSocketMessage): Promise<void> {
    const pong: WebSocketMessage = {
      id: generateId('pong'),
      type: 'pong',
      from: 'coordinator',
      to: client.agentId,
      payload: { originalId: message.id },
      timestamp: Date.now(),
      priority: 1,
      responseId: message.id
    };

    this.sendToClient(client, pong);
  }

  /**
   * Handle direct message to specific agent
   */
  private async handleDirectMessage(client: WebSocketClient, message: WebSocketMessage): Promise<void> {
    if (!message.to) {
      this.sendError(client, 'missing-recipient', 'Direct messages must specify a recipient');
      return;
    }

    // Check topology constraints
    if (this.config.enableTopologyAware && !this.canCommunicate(client.agentId, message.to)) {
      this.sendError(client, 'topology-violation', 'Communication not allowed by topology constraints');
      return;
    }

    // Find target clients
    const targetClients = this.getClientsForAgent(message.to);
    if (targetClients.length === 0) {
      this.sendError(client, 'recipient-not-found', `No active connections for agent: ${message.to}`);
      return;
    }

    // Send to all clients for the target agent (load balancing)
    let delivered = 0;
    for (const targetClient of targetClients) {
      if (this.sendToClient(targetClient, message)) {
        delivered++;
      }
    }

    if (delivered === 0) {
      this.sendError(client, 'delivery-failed', 'Failed to deliver message to any target clients');
    }
  }

  /**
   * Handle broadcast message to all agents
   */
  private async handleBroadcast(client: WebSocketClient, message: WebSocketMessage): Promise<void> {
    const allClients = Array.from(this.connectionPool.connections.values());
    const excludeSelf = message.payload?.excludeSelf !== false;
    
    let delivered = 0;
    for (const targetClient of allClients) {
      if (excludeSelf && targetClient.id === client.id) {
        continue;
      }

      // Check topology constraints for broadcast
      if (this.config.enableTopologyAware && !this.canCommunicate(client.agentId, targetClient.agentId)) {
        continue;
      }

      if (this.sendToClient(targetClient, message)) {
        delivered++;
      }
    }

    this.logger.debug(`Broadcast delivered to ${delivered} clients`);
  }

  /**
   * Handle request message (expects response)
   */
  private async handleRequest(client: WebSocketClient, message: WebSocketMessage): Promise<void> {
    if (!message.to) {
      this.sendError(client, 'missing-recipient', 'Request messages must specify a recipient');
      return;
    }

    // Forward request and track for response
    await this.handleDirectMessage(client, message);
  }

  /**
   * Handle response message (to previous request)
   */
  private async handleResponse(client: WebSocketClient, message: WebSocketMessage): Promise<void> {
    if (!message.responseId) {
      this.sendError(client, 'missing-response-id', 'Response messages must specify responseId');
      return;
    }

    const pending = this.pendingRequests.get(message.responseId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.responseId);
      pending.resolve(message.payload);
    } else {
      // Forward response to original requester
      await this.handleDirectMessage(client, message);
    }
  }

  /**
   * Handle heartbeat message
   */
  private async handleHeartbeat(client: WebSocketClient, message: WebSocketMessage): Promise<void> {
    client.lastHeartbeat = Date.now();
    
    // Update capabilities if provided
    if (message.payload?.capabilities) {
      this.updateClientCapabilities(client, message.payload.capabilities);
    }

    // Send heartbeat response
    const response: WebSocketMessage = {
      id: generateId('heartbeat-response'),
      type: 'heartbeat',
      from: 'coordinator',
      to: client.agentId,
      payload: {
        serverTime: Date.now(),
        uptime: Date.now() - this.connectionPool.stats.uptime
      },
      timestamp: Date.now(),
      priority: 1,
      responseId: message.id
    };

    this.sendToClient(client, response);
  }

  /**
   * Handle client disconnection
   */
  private handleClientDisconnect(client: WebSocketClient, code: number, reason?: string): void {
    this.logger.info(`Client disconnected`, { 
      clientId: client.id, 
      agentId: client.agentId, 
      code, 
      reason 
    });

    // Remove from indexes
    this.connectionPool.connections.delete(client.id);
    this.removeFromAgentIndex(client.agentId, client.id);
    this.removeFromCapabilityIndexes(client);
    this.connectionPool.stats.activeConnections--;

    client.connected = false;

    this.emit('client-disconnected', { 
      clientId: client.id, 
      agentId: client.agentId, 
      code, 
      reason 
    });
  }

  /**
   * Handle client error
   */
  private handleClientError(client: WebSocketClient, error: Error): void {
    this.logger.error(`Client error for ${client.id}:`, error);
    this.emit('client-error', { clientId: client.id, agentId: client.agentId, error });
  }

  /**
   * Send message to specific client
   */
  private sendToClient(client: WebSocketClient, message: WebSocketMessage): boolean {
    if (!client.connected || client.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      const messageStr = JSON.stringify(message);
      client.socket.send(messageStr);
      
      // Update stats
      client.metadata.messagesSent++;
      client.metadata.totalBytes += messageStr.length;
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to send message to client ${client.id}:`, error);
      return false;
    }
  }

  /**
   * Send error message to client
   */
  private sendError(client: WebSocketClient, errorType: string, errorMessage: string): void {
    const errorMsg: WebSocketMessage = {
      id: generateId('error'),
      type: 'error',
      from: 'coordinator',
      to: client.agentId,
      payload: {
        errorType,
        message: errorMessage,
        timestamp: Date.now()
      },
      timestamp: Date.now(),
      priority: 2
    };

    this.sendToClient(client, errorMsg);
  }

  /**
   * Send message with response expectation
   */
  async sendMessageWithResponse(from: string, to: string, payload: any, timeout: number = 30000): Promise<any> {
    const message: WebSocketMessage = {
      id: generateId('request'),
      type: 'request',
      from,
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

      // Send the request
      const targetClients = this.getClientsForAgent(to);
      if (targetClients.length === 0) {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(message.id);
        reject(new Error(`No active connections for agent: ${to}`));
        return;
      }

      // Send to first available client (load balancing can be improved)
      if (!this.sendToClient(targetClients[0], message)) {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(message.id);
        reject(new Error('Failed to send request message'));
      }
    });
  }

  /**
   * Broadcast message to all connected agents
   */
  async broadcastMessage(from: string, payload: any, excludeAgents: string[] = []): Promise<number> {
    const message: WebSocketMessage = {
      id: generateId('broadcast'),
      type: 'broadcast',
      from,
      payload,
      timestamp: Date.now(),
      priority: 0
    };

    const allClients = Array.from(this.connectionPool.connections.values());
    let delivered = 0;

    for (const client of allClients) {
      if (excludeAgents.includes(client.agentId)) {
        continue;
      }

      if (this.sendToClient(client, message)) {
        delivered++;
      }
    }

    return delivered;
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.performHeartbeatCheck();
    }, this.config.heartbeatInterval);
  }

  /**
   * Perform heartbeat check on all clients
   */
  private performHeartbeatCheck(): void {
    const now = Date.now();
    const timeoutThreshold = now - this.config.heartbeatTimeout;
    const staleClients: WebSocketClient[] = [];

    for (const client of this.connectionPool.connections.values()) {
      if (client.lastHeartbeat < timeoutThreshold) {
        staleClients.push(client);
      } else if (client.socket.readyState === WebSocket.OPEN) {
        // Send ping to healthy clients
        client.socket.ping();
      }
    }

    // Disconnect stale clients
    for (const client of staleClients) {
      this.logger.warn(`Disconnecting stale client ${client.id} (last heartbeat: ${new Date(client.lastHeartbeat)})`);
      client.socket.close(1001, 'Heartbeat timeout');
    }
  }

  /**
   * Start periodic cleanup
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, 60000); // Every minute
  }

  /**
   * Perform periodic cleanup
   */
  private performCleanup(): void {
    // Clean up expired pending requests
    const now = Date.now();
    const expiredRequests: string[] = [];

    for (const [requestId, pending] of this.pendingRequests) {
      if (now - pending.timestamp > 300000) { // 5 minutes
        expiredRequests.push(requestId);
        clearTimeout(pending.timeout);
        pending.reject(new Error('Request expired during cleanup'));
      }
    }

    for (const requestId of expiredRequests) {
      this.pendingRequests.delete(requestId);
    }

    // Clean up message queues
    for (const client of this.connectionPool.connections.values()) {
      if (client.messageQueue.length > this.config.messageQueueSize) {
        const overflow = client.messageQueue.length - this.config.messageQueueSize;
        client.messageQueue.splice(0, overflow);
        this.logger.warn(`Cleaned up ${overflow} messages from client ${client.id} queue`);
      }
    }

    this.logger.debug('Cleanup completed', {
      expiredRequests: expiredRequests.length,
      activeConnections: this.connectionPool.stats.activeConnections
    });
  }

  /**
   * Utility methods
   */
  private extractAgentId(request: any): string | null {
    // Extract agent ID from query params, headers, or URL
    const url = new URL(request.url || '', 'http://localhost');
    return url.searchParams.get('agentId') || 
           request.headers['x-agent-id'] || 
           null;
  }

  private validateMessage(message: any): message is WebSocketMessage {
    return message && 
           typeof message.id === 'string' &&
           typeof message.type === 'string' &&
           typeof message.timestamp === 'number' &&
           typeof message.priority === 'number';
  }

  private getClientsForAgent(agentId: string): WebSocketClient[] {
    const clientIds = this.connectionPool.byAgent.get(agentId) || [];
    return clientIds
      .map(id => this.connectionPool.connections.get(id))
      .filter((client): client is WebSocketClient => client !== undefined && client.connected);
  }

  private addToAgentIndex(agentId: string, clientId: string): void {
    if (!this.connectionPool.byAgent.has(agentId)) {
      this.connectionPool.byAgent.set(agentId, []);
    }
    this.connectionPool.byAgent.get(agentId)!.push(clientId);
  }

  private removeFromAgentIndex(agentId: string, clientId: string): void {
    const clients = this.connectionPool.byAgent.get(agentId);
    if (clients) {
      const index = clients.indexOf(clientId);
      if (index !== -1) {
        clients.splice(index, 1);
      }
      if (clients.length === 0) {
        this.connectionPool.byAgent.delete(agentId);
      }
    }
  }

  private updateClientCapabilities(client: WebSocketClient, capabilities: string[]): void {
    // Remove from old capability indexes
    this.removeFromCapabilityIndexes(client);
    
    // Update client capabilities
    client.capabilities = capabilities;
    
    // Add to new capability indexes
    for (const capability of capabilities) {
      if (!this.connectionPool.byCapability.has(capability)) {
        this.connectionPool.byCapability.set(capability, []);
      }
      this.connectionPool.byCapability.get(capability)!.push(client.id);
    }
  }

  private removeFromCapabilityIndexes(client: WebSocketClient): void {
    for (const capability of client.capabilities) {
      const clients = this.connectionPool.byCapability.get(capability);
      if (clients) {
        const index = clients.indexOf(client.id);
        if (index !== -1) {
          clients.splice(index, 1);
        }
        if (clients.length === 0) {
          this.connectionPool.byCapability.delete(capability);
        }
      }
    }
  }

  private canCommunicate(fromAgent: string, toAgent: string): boolean {
    // Implement topology constraints
    switch (this.config.topologyConstraints) {
      case 'none':
        return true;
      case 'mesh':
        return true; // All agents can communicate
      case 'hierarchical':
        // Implement hierarchical constraints (parent-child relationships)
        return this.checkHierarchicalCommunication(fromAgent, toAgent);
      case 'ring':
        // Implement ring topology constraints
        return this.checkRingCommunication(fromAgent, toAgent);
      case 'star':
        // Implement star topology constraints (via central hub)
        return this.checkStarCommunication(fromAgent, toAgent);
      default:
        return true;
    }
  }

  private checkHierarchicalCommunication(fromAgent: string, toAgent: string): boolean {
    // TODO: Implement hierarchical topology checking
    // For now, allow all communication
    return true;
  }

  private checkRingCommunication(fromAgent: string, toAgent: string): boolean {
    // TODO: Implement ring topology checking
    // For now, allow all communication
    return true;
  }

  private checkStarCommunication(fromAgent: string, toAgent: string): boolean {
    // TODO: Implement star topology checking
    // For now, allow all communication
    return true;
  }

  private async persistMessage(message: WebSocketMessage): Promise<void> {
    try {
      await this.memoryManager.store({
        id: `ws-msg-${message.id}`,
        agentId: message.from,
        type: 'websocket-message',
        content: JSON.stringify(message),
        namespace: 'websocket',
        timestamp: new Date(message.timestamp),
        metadata: {
          type: message.type,
          to: message.to,
          priority: message.priority
        }
      });
    } catch (error) {
      this.logger.error('Failed to persist message:', error);
    }
  }

  private setupEventHandlers(): void {
    // Handle coordinator shutdown
    process.on('SIGTERM', () => {
      this.logger.info('Received SIGTERM, shutting down WebSocket coordinator');
      this.stop().catch(console.error);
    });

    process.on('SIGINT', () => {
      this.logger.info('Received SIGINT, shutting down WebSocket coordinator');
      this.stop().catch(console.error);
    });
  }

  /**
   * Public API methods
   */

  /**
   * Get current connection statistics
   */
  getConnectionStats(): ConnectionPool['stats'] & {
    connectionsByAgent: Record<string, number>;
    connectionsByCapability: Record<string, number>;
  } {
    const connectionsByAgent: Record<string, number> = {};
    const connectionsByCapability: Record<string, number> = {};

    for (const [agentId, clientIds] of this.connectionPool.byAgent) {
      connectionsByAgent[agentId] = clientIds.length;
    }

    for (const [capability, clientIds] of this.connectionPool.byCapability) {
      connectionsByCapability[capability] = clientIds.length;
    }

    return {
      ...this.connectionPool.stats,
      connectionsByAgent,
      connectionsByCapability
    };
  }

  /**
   * Get health status
   */
  async getHealthStatus(): Promise<{
    healthy: boolean;
    error?: string;
    metrics?: Record<string, number>;
  }> {
    try {
      const stats = this.getConnectionStats();
      const now = Date.now();
      
      return {
        healthy: this.server !== null && this.wss !== null,
        metrics: {
          activeConnections: stats.activeConnections,
          totalConnections: stats.totalConnections,
          totalMessages: stats.totalMessages,
          totalBytes: stats.totalBytes,
          uptime: now - stats.uptime,
          pendingRequests: this.pendingRequests.size,
          averageMessageSize: stats.totalMessages > 0 ? stats.totalBytes / stats.totalMessages : 0
        }
      };
    } catch (error) {
      return {
        healthy: false,
        error: getErrorMessage(error)
      };
    }
  }

  /**
   * Get list of connected agents
   */
  getConnectedAgents(): Array<{
    agentId: string;
    clientCount: number;
    capabilities: string[];
    lastActivity: number;
  }> {
    const agents: Array<{
      agentId: string;
      clientCount: number;
      capabilities: string[];
      lastActivity: number;
    }> = [];

    for (const [agentId, clientIds] of this.connectionPool.byAgent) {
      const clients = clientIds
        .map(id => this.connectionPool.connections.get(id))
        .filter((client): client is WebSocketClient => client !== undefined);

      if (clients.length > 0) {
        const allCapabilities = new Set<string>();
        let lastActivity = 0;

        for (const client of clients) {
          client.capabilities.forEach(cap => allCapabilities.add(cap));
          lastActivity = Math.max(lastActivity, client.lastHeartbeat);
        }

        agents.push({
          agentId,
          clientCount: clients.length,
          capabilities: Array.from(allCapabilities),
          lastActivity
        });
      }
    }

    return agents;
  }

  /**
   * Force disconnect an agent
   */
  async disconnectAgent(agentId: string, reason: string = 'Forced disconnect'): Promise<number> {
    const clients = this.getClientsForAgent(agentId);
    let disconnected = 0;

    for (const client of clients) {
      try {
        client.socket.close(1008, reason);
        disconnected++;
      } catch (error) {
        this.logger.error(`Failed to disconnect client ${client.id}:`, error);
      }
    }

    return disconnected;
  }

  /**
   * Update topology constraints
   */
  updateTopologyConstraints(constraints: WebSocketCoordinatorConfig['topologyConstraints']): void {
    this.config.topologyConstraints = constraints;
    this.logger.info(`Updated topology constraints to: ${constraints}`);
    this.emit('topology-updated', { constraints });
  }
}