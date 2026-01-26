/**
 * WebSocket Event Server
 * Real-time event streaming for the Live Operations Dashboard
 *
 * Features:
 * - Channel-based subscriptions (agents, tasks, messages, memory, topology, metrics)
 * - Heartbeat mechanism (configurable interval)
 * - Client connection tracking
 * - Circular event replay buffer
 * - Broadcast capabilities
 */

import { EventEmitter } from 'events';
import type { WebSocket as WSWebSocket, WebSocketServer as WSServer } from 'ws';
import * as http from 'http';

// Event types
export type EventChannel = 'agents' | 'tasks' | 'messages' | 'memory' | 'topology' | 'metrics';

export interface ServerEvent {
  id: string;
  channel: EventChannel;
  type: string;
  data: unknown;
  timestamp: number;
}

export interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping' | 'pong' | 'replay' | 'event';
  channel?: EventChannel;
  channels?: EventChannel[];
  since?: number; // For replay - timestamp or event count
  event?: ServerEvent; // For 'event' type - the event to broadcast
}

export interface ServerMessage {
  type: 'event' | 'subscribed' | 'unsubscribed' | 'pong' | 'replay' | 'error' | 'welcome';
  channel?: EventChannel;
  channels?: EventChannel[];
  events?: ServerEvent[];
  event?: ServerEvent;
  error?: string;
  clientId?: string;
  timestamp?: number;
}

export interface EventServerConfig {
  port: number;
  host: string;
  maxConnections: number;
  heartbeatInterval: number;
  replayBufferSize: number;
}

interface ClientState {
  id: string;
  socket: WSWebSocket;
  subscriptions: Set<EventChannel>;
  lastPing: number;
  lastPong: number;
  connectedAt: number;
}

// Default configuration
const DEFAULT_CONFIG: EventServerConfig = {
  port: 3001,
  host: 'localhost',
  maxConnections: 100,
  heartbeatInterval: 30000,
  replayBufferSize: 1000,
};

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Circular buffer for event replay
 */
class CircularBuffer<T> {
  private buffer: T[] = [];
  private maxSize: number;
  private head = 0;
  private count = 0;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  push(item: T): void {
    if (this.count < this.maxSize) {
      this.buffer.push(item);
      this.count++;
    } else {
      this.buffer[this.head] = item;
      this.head = (this.head + 1) % this.maxSize;
    }
  }

  getAll(): T[] {
    if (this.count < this.maxSize) {
      return [...this.buffer];
    }
    // Return items in order (oldest first)
    return [
      ...this.buffer.slice(this.head),
      ...this.buffer.slice(0, this.head),
    ];
  }

  getSince(predicate: (item: T) => boolean): T[] {
    const all = this.getAll();
    const startIndex = all.findIndex(predicate);
    return startIndex >= 0 ? all.slice(startIndex) : [];
  }

  getLast(n: number): T[] {
    const all = this.getAll();
    return all.slice(-n);
  }

  size(): number {
    return this.count;
  }

  clear(): void {
    this.buffer = [];
    this.head = 0;
    this.count = 0;
  }
}

/**
 * WebSocket Event Server - Real-time event streaming
 */
export class EventServer extends EventEmitter {
  private config: EventServerConfig;
  private wss: WSServer | null = null;
  private httpServer: http.Server | null = null;
  private clients: Map<string, ClientState> = new Map();
  private eventBuffer: CircularBuffer<ServerEvent>;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private running = false;
  private startedAt?: Date;
  private eventCounter = 0;

  constructor(config?: Partial<EventServerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eventBuffer = new CircularBuffer(this.config.replayBufferSize);
  }

  /**
   * Start the WebSocket server
   */
  async start(): Promise<void> {
    if (this.running) {
      this.emit('warning', 'Event server already running');
      return;
    }

    try {
      // Dynamic import of ws module
      const { WebSocketServer } = await import('ws');

      this.wss = new WebSocketServer({
        port: this.config.port,
        host: this.config.host,
        maxPayload: 1024 * 1024, // 1MB max message size
      });

      this.setupServerHandlers();
      this.startHeartbeat();
      this.setupHttpEndpoint();

      this.running = true;
      this.startedAt = new Date();

      this.emit('started', {
        port: this.config.port,
        host: this.config.host,
        startedAt: this.startedAt,
      });

      this.log('info', `Event server started on ws://${this.config.host}:${this.config.port}`);
      this.log('info', `HTTP endpoint available at http://${this.config.host}:${this.config.port + 1}/event`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('error', { message: `Failed to start event server: ${message}` });
      throw error;
    }
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    if (!this.running) {
      this.emit('warning', 'Event server not running');
      return;
    }

    // Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Close all client connections
    for (const [clientId, client] of this.clients) {
      try {
        this.sendToClient(client, {
          type: 'error',
          error: 'Server shutting down',
          timestamp: Date.now(),
        });
        client.socket.close(1001, 'Server shutting down');
      } catch {
        // Ignore close errors
      }
      this.clients.delete(clientId);
    }

    // Close server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    this.running = false;
    this.emit('stopped', { stoppedAt: new Date() });
    this.log('info', 'Event server stopped');
  }

  /**
   * Setup WebSocket server event handlers
   */
  private setupServerHandlers(): void {
    if (!this.wss) return;

    this.wss.on('connection', (socket: WSWebSocket, request) => {
      // Check max connections
      if (this.clients.size >= this.config.maxConnections) {
        socket.close(1013, 'Max connections reached');
        this.log('warn', 'Connection rejected: max connections reached');
        return;
      }

      const clientId = generateId();
      const clientState: ClientState = {
        id: clientId,
        socket,
        subscriptions: new Set(),
        lastPing: Date.now(),
        lastPong: Date.now(),
        connectedAt: Date.now(),
      };

      this.clients.set(clientId, clientState);

      // Send welcome message
      this.sendToClient(clientState, {
        type: 'welcome',
        clientId,
        timestamp: Date.now(),
      });

      this.emit('client:connected', {
        clientId,
        remoteAddress: request.socket.remoteAddress,
        totalClients: this.clients.size,
      });

      this.log('info', `Client connected: ${clientId} (total: ${this.clients.size})`);

      // Setup client handlers
      socket.on('message', (data) => {
        this.handleClientMessage(clientState, data);
      });

      socket.on('close', (code, reason) => {
        this.clients.delete(clientId);
        this.emit('client:disconnected', {
          clientId,
          code,
          reason: reason.toString(),
          totalClients: this.clients.size,
        });
        this.log('info', `Client disconnected: ${clientId} (total: ${this.clients.size})`);
      });

      socket.on('error', (error) => {
        this.emit('client:error', { clientId, error: error.message });
        this.log('error', `Client error ${clientId}: ${error.message}`);
      });

      socket.on('pong', () => {
        clientState.lastPong = Date.now();
      });
    });

    this.wss.on('error', (error) => {
      this.emit('server:error', { error: error.message });
      this.log('error', `Server error: ${error.message}`);
    });
  }

  /**
   * Handle incoming client messages
   */
  private handleClientMessage(client: ClientState, data: Buffer | ArrayBuffer | Buffer[]): void {
    try {
      const dataStr = Buffer.isBuffer(data) ? data.toString('utf-8') : String(data);
      const message: ClientMessage = JSON.parse(dataStr);

      switch (message.type) {
        case 'subscribe':
          this.handleSubscribe(client, message);
          break;

        case 'unsubscribe':
          this.handleUnsubscribe(client, message);
          break;

        case 'ping':
          this.handlePing(client);
          break;

        case 'pong':
          client.lastPong = Date.now();
          break;

        case 'replay':
          this.handleReplay(client, message);
          break;

        case 'event':
          // CLI clients can send events to be broadcast to all subscribers
          this.handleIncomingEvent(client, message as unknown as { type: 'event'; channel: EventChannel; event: ServerEvent });
          break;

        default:
          this.sendToClient(client, {
            type: 'error',
            error: `Unknown message type: ${(message as { type: string }).type}`,
            timestamp: Date.now(),
          });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.sendToClient(client, {
        type: 'error',
        error: `Invalid message format: ${errorMessage}`,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle subscription request
   */
  private handleSubscribe(client: ClientState, message: ClientMessage): void {
    const channels = message.channels || (message.channel ? [message.channel] : []);

    for (const channel of channels) {
      if (this.isValidChannel(channel)) {
        client.subscriptions.add(channel);
      }
    }

    const subscribedChannels = Array.from(client.subscriptions);

    this.sendToClient(client, {
      type: 'subscribed',
      channels: subscribedChannels,
      timestamp: Date.now(),
    });

    this.emit('client:subscribed', {
      clientId: client.id,
      channels: subscribedChannels,
    });

    this.log('info', `Client ${client.id} subscribed to: ${subscribedChannels.join(', ')}`);
  }

  /**
   * Handle unsubscription request
   */
  private handleUnsubscribe(client: ClientState, message: ClientMessage): void {
    const channels = message.channels || (message.channel ? [message.channel] : []);

    for (const channel of channels) {
      client.subscriptions.delete(channel);
    }

    const remainingChannels = Array.from(client.subscriptions);

    this.sendToClient(client, {
      type: 'unsubscribed',
      channels: remainingChannels,
      timestamp: Date.now(),
    });

    this.emit('client:unsubscribed', {
      clientId: client.id,
      unsubscribedFrom: channels,
      remainingChannels,
    });

    this.log('info', `Client ${client.id} unsubscribed from: ${channels.join(', ')}`);
  }

  /**
   * Handle ping request
   */
  private handlePing(client: ClientState): void {
    client.lastPing = Date.now();
    this.sendToClient(client, {
      type: 'pong',
      timestamp: Date.now(),
    });
  }

  /**
   * Handle incoming event from CLI client and broadcast to all subscribers
   */
  private handleIncomingEvent(client: ClientState, message: { type: 'event'; channel: EventChannel; event: ServerEvent }): void {
    if (!message.event || !message.channel) {
      this.sendToClient(client, {
        type: 'error',
        error: 'Invalid event message: missing event or channel',
        timestamp: Date.now(),
      });
      return;
    }

    // Broadcast to all subscribed clients (including dashboard)
    this.broadcast({
      channel: message.channel,
      type: message.event.type || 'event',
      data: message.event.data || message.event,
    });

    this.log('info', `Received and broadcast event: ${message.event.type} on channel ${message.channel}`);
  }

  /**
   * Handle replay request
   */
  private handleReplay(client: ClientState, message: ClientMessage): void {
    let events: ServerEvent[];

    if (message.since) {
      // Replay events since timestamp
      events = this.eventBuffer.getSince((event) => event.timestamp >= message.since!);
    } else {
      // Replay last N events (default: 100)
      events = this.eventBuffer.getLast(100);
    }

    // Filter by client's subscriptions if they have any
    if (client.subscriptions.size > 0) {
      events = events.filter((event) => client.subscriptions.has(event.channel));
    }

    this.sendToClient(client, {
      type: 'replay',
      events,
      timestamp: Date.now(),
    });

    this.log('info', `Replayed ${events.length} events to client ${client.id}`);
  }

  /**
   * Setup HTTP endpoint for receiving events from CLI commands
   */
  private setupHttpEndpoint(): void {
    const httpPort = this.config.port + 1; // HTTP on port+1 (e.g., 3002)

    this.httpServer = http.createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'POST' && req.url === '/event') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const { channel, type, event } = data;

            if (!channel || !type) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing channel or type' }));
              return;
            }

            // Broadcast to all WebSocket clients
            // Send in format dashboard expects: { type: 'agent:status', channel: 'agents', ...eventData }
            const eventData = event || data;
            const message = {
              type,
              channel,
              payload: eventData,
              timestamp: eventData.timestamp || Date.now(),
              ...eventData, // Spread event fields at top level for compatibility
            };

            // Use broadcastRaw to send directly without wrapping
            this.broadcastRaw(channel as EventChannel, message);

            this.log('info', `HTTP: Received and broadcast ${type} on ${channel}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found. POST to /event' }));
      }
    });

    this.log('info', `Setting up HTTP server on port ${httpPort}...`);

    this.httpServer.on('error', (err) => {
      this.log('error', `HTTP server error: ${err.message}`);
    });

    try {
      this.httpServer.listen(httpPort, this.config.host, () => {
        this.log('info', `HTTP event endpoint listening on http://${this.config.host}:${httpPort}/event`);
      });
    } catch (err) {
      this.log('error', `Failed to start HTTP server: ${err}`);
    }
  }

  /**
   * Start heartbeat mechanism
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const timeout = this.config.heartbeatInterval * 2; // 2x interval for timeout

      for (const [clientId, client] of this.clients) {
        // Check if client is alive
        if (now - client.lastPong > timeout) {
          this.log('warn', `Client ${clientId} timed out (no pong received)`);
          client.socket.terminate();
          this.clients.delete(clientId);
          this.emit('client:timeout', { clientId });
          continue;
        }

        // Send ping
        try {
          client.socket.ping();
        } catch {
          // Client may have disconnected
        }
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Broadcast a raw message to all subscribed clients (without wrapping)
   * Used for sending events in the format the dashboard expects
   */
  broadcastRaw(channel: EventChannel, message: Record<string, unknown>): void {
    // Store in replay buffer as ServerEvent
    const fullEvent: ServerEvent = {
      id: `evt-${++this.eventCounter}-${generateId()}`,
      channel,
      type: (message.type as string) || 'unknown',
      data: message,
      timestamp: (message.timestamp as number) || Date.now(),
    };
    this.eventBuffer.push(fullEvent);

    // Emit for internal listeners
    this.emit('event', fullEvent);

    // Send to subscribed clients - send the message directly without wrapping
    let sentCount = 0;
    for (const client of this.clients.values()) {
      if (client.subscriptions.has(channel)) {
        try {
          if (client.socket.readyState === 1) { // WebSocket.OPEN
            client.socket.send(JSON.stringify(message));
            sentCount++;
          }
        } catch {
          // Ignore send errors
        }
      }
    }

    this.log('debug', `BroadcastRaw ${message.type} to ${sentCount} clients on channel ${channel}`);
  }

  /**
   * Broadcast an event to all subscribed clients
   */
  broadcast(event: Omit<ServerEvent, 'id' | 'timestamp'>): void {
    const fullEvent: ServerEvent = {
      ...event,
      id: `evt-${++this.eventCounter}-${generateId()}`,
      timestamp: Date.now(),
    };

    // Store in replay buffer
    this.eventBuffer.push(fullEvent);

    // Emit for internal listeners
    this.emit('event', fullEvent);

    // Send to subscribed clients
    let sentCount = 0;
    for (const client of this.clients.values()) {
      if (client.subscriptions.has(fullEvent.channel)) {
        this.sendToClient(client, {
          type: 'event',
          event: fullEvent,
          timestamp: fullEvent.timestamp,
        });
        sentCount++;
      }
    }

    this.log('debug', `Broadcast ${fullEvent.type} to ${sentCount} clients on channel ${fullEvent.channel}`);
  }

  /**
   * Send message to a specific client
   */
  private sendToClient(client: ClientState, message: ServerMessage): void {
    try {
      if (client.socket.readyState === 1) { // WebSocket.OPEN
        client.socket.send(JSON.stringify(message));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log('error', `Failed to send to client ${client.id}: ${errorMessage}`);
    }
  }

  /**
   * Validate channel name
   */
  private isValidChannel(channel: unknown): channel is EventChannel {
    return typeof channel === 'string' &&
      ['agents', 'tasks', 'messages', 'memory', 'topology', 'metrics'].includes(channel);
  }

  /**
   * Get server status
   */
  getStatus(): {
    running: boolean;
    port: number;
    host: string;
    startedAt?: Date;
    clientCount: number;
    eventCount: number;
    bufferSize: number;
  } {
    return {
      running: this.running,
      port: this.config.port,
      host: this.config.host,
      startedAt: this.startedAt,
      clientCount: this.clients.size,
      eventCount: this.eventCounter,
      bufferSize: this.eventBuffer.size(),
    };
  }

  /**
   * Get client list
   */
  getClients(): Array<{
    id: string;
    subscriptions: EventChannel[];
    connectedAt: number;
    lastPing: number;
    lastPong: number;
  }> {
    return Array.from(this.clients.values()).map((client) => ({
      id: client.id,
      subscriptions: Array.from(client.subscriptions),
      connectedAt: client.connectedAt,
      lastPing: client.lastPing,
      lastPong: client.lastPong,
    }));
  }

  /**
   * Get buffered events
   */
  getBufferedEvents(channel?: EventChannel, limit?: number): ServerEvent[] {
    let events = this.eventBuffer.getAll();

    if (channel) {
      events = events.filter((e) => e.channel === channel);
    }

    if (limit && limit > 0) {
      events = events.slice(-limit);
    }

    return events;
  }

  /**
   * Clear event buffer
   */
  clearBuffer(): void {
    this.eventBuffer.clear();
    this.log('info', 'Event buffer cleared');
  }

  /**
   * Log message
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const timestamp = new Date().toISOString();
    this.emit('log', { level, message, timestamp });

    // Also emit to console in development
    if (process.env.NODE_ENV !== 'production' && level !== 'debug') {
      const prefix = `[${timestamp}] [EventServer] [${level.toUpperCase()}]`;
      if (level === 'error') {
        console.error(`${prefix} ${message}`);
      } else if (level === 'warn') {
        console.warn(`${prefix} ${message}`);
      } else {
        console.log(`${prefix} ${message}`);
      }
    }
  }
}

// Singleton instance
let eventServerInstance: EventServer | undefined;

/**
 * Get the current event server instance (if running)
 */
export function getEventServer(): EventServer | undefined {
  return eventServerInstance;
}

/**
 * Start the event server with optional configuration
 */
export async function startEventServer(config?: Partial<EventServerConfig>): Promise<EventServer> {
  if (eventServerInstance?.getStatus().running) {
    return eventServerInstance;
  }

  eventServerInstance = new EventServer(config);
  await eventServerInstance.start();
  return eventServerInstance;
}

/**
 * Stop the event server
 */
export async function stopEventServer(): Promise<void> {
  if (eventServerInstance) {
    await eventServerInstance.stop();
    eventServerInstance = undefined;
  }
}

export default EventServer;
