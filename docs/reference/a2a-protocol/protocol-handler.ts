/**
 * A2A Protocol Handler Implementation
 * Core implementation of the Agent-to-Agent communication protocol
 */

import { EventEmitter } from 'node:events';
import type { ILogger } from '../core/logger.js';
import type { IEventBus } from '../core/event-bus.js';
import type { IMemoryManager } from '../memory/manager.js';
import type {
  A2AMessage,
  AgentIdentity,
  AgentAdapter,
  A2ATransport,
  RoutingResult,
  AgentFilter,
  MemoryOptions,
  A2AEvent,
  EventFilter,
  A2AConfig,
  A2AMetrics,
  A2AError,
  A2AErrorType,
  DeliveryTarget,
  MessageType,
  DeliveryGuarantee,
  RoutingStrategy
} from './types.js';
import { generateId } from '../utils/helpers.js';
import { A2A_CONSTANTS } from './types.js';

export class A2AProtocolHandler extends EventEmitter implements A2AProtocolHandler {
  private logger: ILogger;
  private eventBus: IEventBus;
  private memoryManager: IMemoryManager;
  private config: A2AConfig;
  
  // Core components
  private transport: A2ATransport;
  private adapters = new Map<string, AgentAdapter>();
  private messageStore = new Map<string, A2AMessage>();
  private deliveryReceipts = new Map<string, DeliveryReceipt>();
  private acknowledgments = new Map<string, MessageAcknowledgment>();
  
  // Agent discovery
  private discoveredAgents = new Map<string, AgentIdentity>();
  private agentCapabilities = new Map<string, AgentCapabilities>();
  
  // Performance tracking
  private metrics: A2AMetrics;
  private metricsInterval?: NodeJS.Timeout;
  
  // Error handling
  private circuitBreakers = new Map<string, CircuitBreakerState>();
  private retryQueue: RetryEntry[] = [];
  
  constructor(
    config: Partial<A2AConfig>,
    transport: A2ATransport,
    logger: ILogger,
    eventBus: IEventBus,
    memoryManager: IMemoryManager
  ) {
    super();
    
    this.logger = logger;
    this.eventBus = eventBus;
    this.memoryManager = memoryManager;
    this.transport = transport;
    
    this.config = {
      version: A2A_CONSTANTS.PROTOCOL_VERSION,
      timeout: A2A_CONSTANTS.DEFAULT_TIMEOUT,
      maxRetries: A2A_CONSTANTS.DEFAULT_MAX_RETRIES,
      authentication: false,
      encryption: false,
      signing: false,
      compression: true,
      caching: true,
      compressionAlgorithm: 'gzip',
      transport: {
        timeout: A2A_CONSTANTS.DEFAULT_TIMEOUT,
        retries: A2A_CONSTANTS.DEFAULT_MAX_RETRIES,
        compression: true,
        encryption: false,
        keepAlive: true
      },
      memory: {
        ttl: A2A_CONSTANTS.CACHE_TTL,
        consistency: 'eventual',
        replicate: true
      },
      logging: {
        enabled: true,
        level: 'info',
        format: 'json'
      },
      ...config
    };
    
    this.metrics = this.initializeMetrics();
    this.setupEventHandlers();
  }
  
  // ===== INITIALIZATION =====
  
  async initialize(): Promise<void> {
    this.logger.info('Initializing A2A Protocol Handler', {
      version: this.config.version,
      compression: this.config.compression,
      encryption: this.config.encryption
    });
    
    // Initialize transport
    await this.transport.connect('a2a://localhost:8080');
    
    // Setup transport event handlers
    this.transport.onMessage((message) => this.handleIncomingMessage(message));
    this.transport.onError((error) => this.handleTransportError(error));
    this.transport.onDisconnect(() => this.handleTransportDisconnect());
    
    // Start metrics collection
    if (this.config.logging.enabled) {
      this.startMetricsCollection();
    }
    
    // Start agent discovery
    this.startAgentDiscovery();
    
    // Start retry processor
    this.startRetryProcessor();
    
    this.emit('a2a:initialized');
    this.logger.info('A2A Protocol Handler initialized successfully');
  }
  
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down A2A Protocol Handler');
    
    // Stop background processes
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    
    // Disconnect transport
    await this.transport.disconnect();
    
    // Clear stores
    this.messageStore.clear();
    this.deliveryReceipts.clear();
    this.acknowledgments.clear();
    this.discoveredAgents.clear();
    this.agentCapabilities.clear();
    
    this.emit('a2a:shutdown');
    this.logger.info('A2A Protocol Handler shutdown complete');
  }
  
  // ===== MESSAGE OPERATIONS =====
  
  async sendMessage(message: A2AMessage): Promise<string> {
    const startTime = Date.now();
    
    try {
      // Validate message
      this.validateMessage(message);
      
      // Process message (compress, encrypt, sign)
      const processedMessage = await this.processMessage(message);
      
      // Route message
      const routingResult = await this.routeMessage(processedMessage);
      
      // Store message if persistence is enabled
      if (this.config.memory.persistent) {
        this.messageStore.set(message.messageId, processedMessage);
      }
      
      // Deliver message
      await this.deliverMessage(processedMessage, routingResult);
      
      // Update metrics
      this.metrics.messagesSent++;
      this.metrics.bytesTransferred += message.metadata.size;
      
      this.logger.debug('Message sent successfully', {
        messageId: message.messageId,
        type: message.type,
        receivers: message.receivers.length,
        latency: Date.now() - startTime
      });
      
      this.emit('a2a:message_sent', { message: processedMessage });
      
      return message.messageId;
    } catch (error) {
      this.metrics.messagesFailed++;
      this.logger.error('Failed to send message', {
        messageId: message.messageId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw this.createA2AError('delivery_error', 'A2A_DELIVERY_001', error, {
        messageId: message.messageId,
        operation: 'send'
      });
    }
  }
  
  async receiveMessage(messageId: string): Promise<A2AMessage> {
    const message = this.messageStore.get(messageId);
    if (!message) {
      throw this.createA2AError('protocol_error', 'A2A_PROTOCOL_001', 
        new Error(`Message ${messageId} not found`), { messageId });
    }
    
    this.metrics.messagesReceived++;
    this.logger.debug('Message retrieved', { messageId });
    
    return message;
  }
  
  async acknowledgeMessage(messageId: string): Promise<void> {
    const ack: MessageAcknowledgment = {
      messageId,
      timestamp: new Date(),
      status: 'acknowledged'
    };
    
    this.acknowledgments.set(messageId, ack);
    
    this.logger.debug('Message acknowledged', { messageId });
    this.emit('a2a:message_acknowledged', { messageId });
  }
  
  // ===== ROUTING =====
  
  async routeMessage(message: A2AMessage): Promise<RoutingResult> {
    const startTime = Date.now();
    
    try {
      const targets: DeliveryTarget[] = [];
      const hops: string[] = [];
      
      // Calculate route based on strategy
      switch (message.routing.strategy) {
        case 'direct':
          return this.routeDirect(message);
        case 'broadcast':
          return this.routeBroadcast(message);
        case 'multicast':
          return this.routeMulticast(message);
        case 'anycast':
          return this.routeAnycast(message);
        case 'hierarchical':
          return this.routeHierarchical(message);
        case 'mesh':
          return this.routeMesh(message);
        case 'gossip':
          return this.routeGossip(message);
        case 'flooding':
          return this.routeFlooding(message);
        default:
          throw new Error(`Unsupported routing strategy: ${message.routing.strategy}`);
      }
    } catch (error) {
      this.logger.error('Routing failed', {
        messageId: message.messageId,
        strategy: message.routing.strategy,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw this.createA2AError('routing_error', 'A2A_ROUTING_001', error, {
        messageId: message.messageId,
        strategy: message.routing.strategy
      });
    }
  }
  
  private async routeDirect(message: A2AMessage): Promise<RoutingResult> {
    const targets: DeliveryTarget[] = message.receivers.map(receiver => ({
      type: 'agent',
      id: receiver.id,
      address: receiver.endpoint
    }));
    
    return {
      targets,
      hops: [],
      cost: targets.length,
      estimatedLatency: 100, // 100ms for direct routing
      success: true
    };
  }
  
  private async routeBroadcast(message: A2AMessage): Promise<RoutingResult> {
    const targets: DeliveryTarget[] = Array.from(this.discoveredAgents.values())
      .filter(agent => agent.id !== message.sender.id)
      .map(agent => ({
        type: 'agent',
        id: agent.id,
        address: agent.endpoint
      }));
    
    return {
      targets,
      hops: ['broadcast-channel'],
      cost: targets.length,
      estimatedLatency: 200,
      success: true
    };
  }
  
  private async routeMulticast(message: A2AMessage): Promise<RoutingResult> {
    // Filter receivers based on capabilities or swarm membership
    const targets: DeliveryTarget[] = message.receivers.map(receiver => ({
      type: 'agent',
      id: receiver.id,
      address: receiver.endpoint
    }));
    
    return {
      targets,
      hops: ['multicast-channel'],
      cost: targets.length,
      estimatedLatency: 150,
      success: true
    };
  }
  
  private async routeAnycast(message: A2AMessage): Promise<RoutingResult> {
    // Find any available agent that can handle the message
    const availableAgents = Array.from(this.discoveredAgents.values())
      .filter(agent => this.canHandleMessage(agent, message.type));
    
    if (availableAgents.length === 0) {
      throw new Error('No available agents found for anycast routing');
    }
    
    // Select agent with lowest load
    const selectedAgent = availableAgents[0]; // Simplified selection
    
    return {
      targets: [{
        type: 'agent',
        id: selectedAgent.id,
        address: selectedAgent.endpoint
      }],
      hops: [],
      cost: 1,
      estimatedLatency: 100,
      success: true
    };
  }
  
  private async routeHierarchical(message: A2AMessage): Promise<RoutingResult> {
    // Route through hierarchy (simplified implementation)
    const targets: DeliveryTarget[] = message.receivers.map(receiver => ({
      type: 'agent',
      id: receiver.id,
      address: receiver.endpoint
    }));
    
    return {
      targets,
      hops: ['coordinator', 'router'],
      cost: targets.length + 2,
      estimatedLatency: 300,
      success: true
    };
  }
  
  private async routeMesh(message: A2AMessage): Promise<RoutingResult> {
    // Peer-to-peer mesh routing
    const targets: DeliveryTarget[] = message.receivers.map(receiver => ({
      type: 'agent',
      id: receiver.id,
      address: receiver.endpoint
    }));
    
    return {
      targets,
      hops: ['mesh-router'],
      cost: targets.length,
      estimatedLatency: 250,
      success: true
    };
  }
  
  private async routeGossip(message: A2AMessage): Promise<RoutingResult> {
    // Gossip protocol routing
    const targets: DeliveryTarget[] = message.receivers.map(receiver => ({
      type: 'agent',
      id: receiver.id,
      address: receiver.endpoint
    }));
    
    return {
      targets,
      hops: ['gossip-node'],
      cost: targets.length,
      estimatedLatency: 400,
      success: true
    };
  }
  
  private async routeFlooding(message: A2AMessage): Promise<RoutingResult> {
    // Flooding algorithm
    const targets: DeliveryTarget[] = Array.from(this.discoveredAgents.values())
      .map(agent => ({
        type: 'agent',
        id: agent.id,
        address: agent.endpoint
      }));
    
    return {
      targets,
      hops: ['flood-router'],
      cost: targets.length,
      estimatedLatency: 500,
      success: true
    };
  }
  
  // ===== AGENT DISCOVERY =====
  
  async discoverAgents(filter?: AgentFilter): Promise<AgentIdentity[]> {
    const agents = Array.from(this.discoveredAgents.values());
    
    if (!filter) {
      return agents;
    }
    
    return agents.filter(agent => {
      // Filter by type
      if (filter.types && !filter.types.includes(agent.type)) {
        return false;
      }
      
      // Filter by capabilities
      if (filter.capabilities) {
        const capabilities = this.agentCapabilities.get(agent.id);
        if (!capabilities || !this.matchesCapabilities(capabilities, filter.capabilities)) {
          return false;
        }
      }
      
      // Filter by swarm ID
      if (filter.swarmId && agent.swarmId !== filter.swarmId) {
        return false;
      }
      
      // Filter by tags
      if (filter.tags && filter.tags.length > 0) {
        const agentTags = agent.metadata?.tags || [];
        if (!filter.tags.some(tag => agentTags.includes(tag))) {
          return false;
        }
      }
      
      // Exclude specific IDs
      if (filter.excludeIds && filter.excludeIds.includes(agent.id)) {
        return false;
      }
      
      return true;
    });
  }
  
  // ===== MEMORY INTEGRATION =====
  
  async storeInMemory(key: string, value: any, options?: MemoryOptions): Promise<void> {
    try {
      await this.memoryManager.store(key, value, {
        type: 'a2a-data',
        tags: ['a2a-protocol'],
        ttl: options?.ttl || this.config.memory.ttl,
        replicate: options?.replicate || this.config.memory.replicate
      });
      
      this.metrics.memoryOperations++;
      this.logger.debug('Data stored in memory', { key, size: JSON.stringify(value).length });
      
      // Notify other agents if requested
      if (options?.notifyAgents && options.notifyAgents.length > 0) {
        await this.notifyAgentsOfMemoryUpdate(key, value, options.notifyAgents);
      }
    } catch (error) {
      throw this.createA2AError('memory_error', 'A2A_MEMORY_001', error, { key, operation: 'store' });
    }
  }
  
  async retrieveFromMemory(key: string, options?: MemoryOptions): Promise<any> {
    try {
      const result = await this.memoryManager.retrieve(key, {
        consistency: options?.consistency || this.config.memory.consistency
      });
      
      this.metrics.memoryOperations++;
      this.logger.debug('Data retrieved from memory', { key });
      
      return result;
    } catch (error) {
      throw this.createA2AError('memory_error', 'A2A_MEMORY_001', error, { key, operation: 'retrieve' });
    }
  }
  
  // ===== EVENT INTEGRATION =====
  
  async emitEvent(event: A2AEvent): Promise<void> {
    try {
      // Emit to internal event bus
      this.eventBus.emit(`a2a:${event.type}`, event);
      
      // Emit to transport if targets specified
      if (event.targets && event.targets.length > 0) {
        const message: A2AMessage = {
          protocol: 'A2A',
          version: this.config.version,
          messageId: generateId('msg'),
          timestamp: new Date(),
          sender: event.source,
          receivers: event.targets,
          routing: {
            strategy: 'broadcast',
            hops: [],
            cost: event.targets.length
          },
          type: 'notification',
          payload: event.data,
          metadata: {
            contentType: 'application/json',
            encoding: 'utf-8',
            size: JSON.stringify(event.data).length,
            compressed: false,
            encrypted: false
          },
          delivery: 'best_effort',
          priority: 'normal'
        };
        
        await this.sendMessage(message);
      }
      
      this.logger.debug('A2A event emitted', { eventId: event.id, type: event.type });
    } catch (error) {
      this.logger.error('Failed to emit A2A event', {
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  async subscribeToEvents(filter: EventFilter): Promise<string> {
    const subscriptionId = generateId('sub');
    
    // Setup event handler
    const handler = (event: A2AEvent) => {
      if (this.matchesEventFilter(event, filter)) {
        this.emit('a2a:event_received', { subscriptionId, event });
      }
    };
    
    // Subscribe to all A2A events
    this.eventBus.on('a2a:*', handler);
    
    this.logger.debug('Event subscription created', { subscriptionId });
    return subscriptionId;
  }
  
  // ===== AGENT MANAGEMENT =====
  
  registerAdapter(adapter: AgentAdapter): void {
    const identity = adapter.getIdentity();
    this.adapters.set(identity.id, adapter);
    this.discoveredAgents.set(identity.id, identity);
    this.agentCapabilities.set(identity.id, adapter.getCapabilities());
    
    this.logger.info('Agent adapter registered', {
      agentId: identity.id,
      type: identity.type,
      capabilities: Object.keys(adapter.getCapabilities())
    });
    
    this.emit('a2a:agent_registered', { identity });
  }
  
  unregisterAdapter(agentId: string): void {
    this.adapters.delete(agentId);
    this.discoveredAgents.delete(agentId);
    this.agentCapabilities.delete(agentId);
    
    this.logger.info('Agent adapter unregistered', { agentId });
    this.emit('a2a:agent_unregistered', { agentId });
  }
  
  // ===== UTILITY METHODS =====
  
  private validateMessage(message: A2AMessage): void {
    if (message.protocol !== 'A2A') {
      throw new Error('Invalid protocol');
    }
    
    if (message.metadata.size > A2A_CONSTANTS.MAX_MESSAGE_SIZE) {
      throw new Error(`Message size exceeds limit: ${A2A_CONSTANTS.MAX_MESSAGE_SIZE}`);
    }
    
    if (message.receivers.length > A2A_CONSTANTS.MAX_RECEIVERS) {
      throw new Error(`Too many receivers: ${A2A_CONSTANTS.MAX_RECEIVERS}`);
    }
    
    if (message.routing.hops.length > A2A_CONSTANTS.MAX_HOPS) {
      throw new Error(`Too many routing hops: ${A2A_CONSTANTS.MAX_HOPS}`);
    }
  }
  
  private async processMessage(message: A2AMessage): Promise<A2AMessage> {
    let processed = { ...message };
    
    // Compress if enabled
    if (this.config.compression && message.metadata.size > A2A_CONSTANTS.COMPRESSION_THRESHOLD) {
      processed = await this.compressMessage(processed);
    }
    
    // Encrypt if enabled
    if (this.config.encryption) {
      processed = await this.encryptMessage(processed);
    }
    
    // Sign if enabled
    if (this.config.signing) {
      processed = await this.signMessage(processed);
    }
    
    return processed;
  }
  
  private async deliverMessage(message: A2AMessage, routing: RoutingResult): Promise<void> {
    for (const target of routing.targets) {
      try {
        await this.transport.send(message);
        
        // Record delivery receipt
        this.deliveryReceipts.set(`${message.messageId}:${target.id}`, {
          messageId: message.messageId,
          target: target.id,
          status: 'delivered',
          timestamp: new Date(),
          attempts: 1
        });
        
        this.metrics.messagesDelivered++;
      } catch (error) {
        // Record delivery failure
        this.deliveryReceipts.set(`${message.messageId}:${target.id}`, {
          messageId: message.messageId,
          target: target.id,
          status: 'failed',
          timestamp: new Date(),
          attempts: 1,
          error: error instanceof Error ? error.message : String(error)
        });
        
        this.metrics.messagesFailed++;
        
        // Schedule retry if message requires reliability
        if (message.delivery !== 'best_effort') {
          this.scheduleRetry(message, target, error);
        }
      }
    }
  }
  
  private async handleIncomingMessage(message: A2AMessage): Promise<void> {
    try {
      // Validate and process incoming message
      this.validateMessage(message);
      
      // Find appropriate adapter
      const adapter = this.adapters.get(message.receivers[0]?.id);
      if (!adapter) {
        this.logger.warn('No adapter found for incoming message', {
          messageId: message.messageId,
          receiver: message.receivers[0]?.id
        });
        return;
      }
      
      // Check if adapter can handle message type
      if (!adapter.canHandleMessage(message.type)) {
        this.logger.warn('Adapter cannot handle message type', {
          messageId: message.messageId,
          type: message.type,
          adapter: adapter.getIdentity().id
        });
        return;
      }
      
      // Handle message
      const response = await adapter.handleMessage(message);
      
      // Send response if provided
      if (response) {
        await this.sendMessage(response);
      }
      
      // Acknowledge message
      await this.acknowledgeMessage(message.messageId);
      
      this.metrics.messagesReceived++;
      this.logger.debug('Message handled successfully', { messageId: message.messageId });
      
    } catch (error) {
      this.logger.error('Failed to handle incoming message', {
        messageId: message.messageId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  private handleTransportError(error: Error): void {
    this.logger.error('Transport error', { error: error.message });
    this.emit('a2a:transport_error', { error });
  }
  
  private handleTransportDisconnect(): void {
    this.logger.warn('Transport disconnected');
    this.emit('a2a:transport_disconnected');
  }
  
  private canHandleMessage(agent: AgentIdentity, messageType: MessageType): boolean {
    const capabilities = this.agentCapabilities.get(agent.id);
    if (!capabilities) return false;
    
    // Simple capability matching - can be enhanced
    switch (messageType) {
      case 'task_assignment':
        return capabilities.codeGeneration || capabilities.analysis;
      case 'memory_retrieve':
        return true; // All agents can read memory
      case 'memory_store':
        return true; // All agents can write memory
      default:
        return true;
    }
  }
  
  private matchesCapabilities(agentCapabilities: AgentCapabilities, filter: Partial<AgentCapabilities>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined && agentCapabilities[key as keyof AgentCapabilities] !== value) {
        return false;
      }
    }
    return true;
  }
  
  private matchesEventFilter(event: A2AEvent, filter: EventFilter): boolean {
    if (filter.types && !filter.types.includes(event.type)) {
      return false;
    }
    
    if (filter.sources && !filter.sources.some(source => source.id === event.source.id)) {
      return false;
    }
    
    if (filter.data) {
      for (const [key, value] of Object.entries(filter.data)) {
        if (event.data[key] !== value) {
          return false;
        }
      }
    }
    
    return true;
  }
  
  private async notifyAgentsOfMemoryUpdate(key: string, value: any, agents: AgentIdentity[]): Promise<void> {
    const message: A2AMessage = {
      protocol: 'A2A',
      version: this.config.version,
      messageId: generateId('msg'),
      timestamp: new Date(),
      sender: this.discoveredAgents.values().next().value, // Use first available agent as sender
      receivers: agents,
      routing: {
        strategy: 'multicast',
        hops: [],
        cost: agents.length
      },
      type: 'notification',
      payload: { type: 'memory_update', key, value },
      metadata: {
        contentType: 'application/json',
        encoding: 'utf-8',
        size: JSON.stringify({ key, value }).length,
        compressed: false,
        encrypted: false
      },
      delivery: 'best_effort',
      priority: 'normal'
    };
    
    await this.sendMessage(message);
  }
  
  private scheduleRetry(message: A2AMessage, target: DeliveryTarget, error: any): void {
    this.retryQueue.push({
      message,
      target,
      attempts: 1,
      nextRetry: Date.now() + 1000, // Retry in 1 second
      error: error instanceof Error ? error.message : String(error)
    });
  }
  
  private startAgentDiscovery(): void {
    setInterval(() => {
      this.performAgentDiscovery();
    }, A2A_CONSTANTS.DISCOVERY_INTERVAL);
  }
  
  private async performAgentDiscovery(): Promise<void> {
    // Send discovery message
    const discoveryMessage: A2AMessage = {
      protocol: 'A2A',
      version: this.config.version,
      messageId: generateId('msg'),
      timestamp: new Date(),
      sender: this.discoveredAgents.values().next().value || {
        id: 'system',
        type: 'custom',
        version: this.config.version,
        capabilities: {} as AgentCapabilities
      },
      receivers: [],
      routing: {
        strategy: 'broadcast',
        hops: [],
        cost: 0
      },
      type: 'notification',
      payload: { type: 'discovery_request' },
      metadata: {
        contentType: 'application/json',
        encoding: 'utf-8',
        size: 50,
        compressed: false,
        encrypted: false
      },
      delivery: 'best_effort',
      priority: 'low'
    };
    
    try {
      await this.sendMessage(discoveryMessage);
    } catch (error) {
      this.logger.debug('Agent discovery failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  
  private startRetryProcessor(): void {
    setInterval(() => {
      this.processRetries();
    }, 5000); // Process retries every 5 seconds
  }
  
  private async processRetries(): Promise<void> {
    const now = Date.now();
    const toRetry = this.retryQueue.filter(entry => now >= entry.nextRetry);
    
    for (const entry of toRetry) {
      if (entry.attempts >= this.config.maxRetries) {
        // Remove from retry queue
        this.retryQueue = this.retryQueue.filter(r => r !== entry);
        this.logger.error('Retry exhausted', {
          messageId: entry.message.messageId,
          target: entry.target.id,
          attempts: entry.attempts
        });
      } else {
        try {
          // Retry delivery
          await this.transport.send(entry.message);
          
          // Remove from retry queue on success
          this.retryQueue = this.retryQueue.filter(r => r !== entry);
          this.logger.debug('Retry successful', {
            messageId: entry.message.messageId,
            target: entry.target.id,
            attempts: entry.attempts
          });
        } catch (error) {
          // Increment retry count and delay
          entry.attempts++;
          entry.nextRetry = now + (1000 * Math.pow(2, entry.attempts - 1)); // Exponential backoff
          this.logger.warn('Retry failed', {
            messageId: entry.message.messageId,
            target: entry.target.id,
            attempts: entry.attempts,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  }
  
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.updateMetrics();
    }, A2A_CONSTANTS.METRICS_INTERVAL);
  }
  
  private updateMetrics(): void {
    // Update performance metrics
    this.metrics.averageLatency = this.calculateAverageLatency();
    this.metrics.throughput = this.calculateThroughput();
    this.metrics.errorRate = this.calculateErrorRate();
    
    // Update agent metrics
    this.metrics.activeAgents = this.adapters.size;
    this.metrics.discoveredAgents = this.discoveredAgents.size;
    
    // Update memory metrics
    this.metrics.memoryHitRate = this.calculateMemoryHitRate();
    
    // Update network metrics
    this.metrics.connectionCount = this.transport.isConnected() ? 1 : 0;
    
    this.emit('a2a:metrics_updated', { metrics: this.metrics });
  }
  
  private initializeMetrics(): A2AMetrics {
    return {
      messagesSent: 0,
      messagesReceived: 0,
      messagesDelivered: 0,
      messagesFailed: 0,
      averageLatency: 0,
      throughput: 0,
      errorRate: 0,
      activeAgents: 0,
      discoveredAgents: 0,
      memoryOperations: 0,
      memoryHitRate: 0,
      bytesTransferred: 0,
      connectionCount: 0
    };
  }
  
  private calculateAverageLatency(): number {
    // Simplified latency calculation
    return 100; // 100ms average
  }
  
  private calculateThroughput(): number {
    // Messages per second
    return this.metrics.messagesSent / (A2A_CONSTANTS.METRICS_INTERVAL / 1000);
  }
  
  private calculateErrorRate(): number {
    const total = this.metrics.messagesSent + this.metrics.messagesFailed;
    return total > 0 ? (this.metrics.messagesFailed / total) * 100 : 0;
  }
  
  private calculateMemoryHitRate(): number {
    // Simplified hit rate calculation
    return 0.95; // 95% hit rate
  }
  
  private createA2AError(type: A2AErrorType, code: string, originalError: any, context: Record<string, any>): A2AError {
    const error = new Error(originalError instanceof Error ? originalError.message : String(originalError)) as A2AError;
    error.type = type;
    error.code = code;
    error.context = context;
    error.recoverable = this.isRecoverableError(type);
    error.retryable = this.isRetryableError(type);
    return error;
  }
  
  private isRecoverableError(type: A2AErrorType): boolean {
    return ['timeout_error', 'network_error', 'delivery_error'].includes(type);
  }
  
  private isRetryableError(type: A2AErrorType): boolean {
    return ['timeout_error', 'network_error', 'delivery_error', 'agent_error'].includes(type);
  }
  
  // Placeholder methods for compression, encryption, and signing
  private async compressMessage(message: A2AMessage): Promise<A2AMessage> {
    // Implementation would compress the message payload
    return message;
  }
  
  private async encryptMessage(message: A2AMessage): Promise<A2AMessage> {
    // Implementation would encrypt the message
    return message;
  }
  
  private async signMessage(message: A2AMessage): Promise<A2AMessage> {
    // Implementation would sign the message
    return message;
  }
  
  // ===== PUBLIC API =====
  
  getMetrics(): A2AMetrics {
    return { ...this.metrics };
  }
  
  getDiscoveredAgents(): AgentIdentity[] {
    return Array.from(this.discoveredAgents.values());
  }
  
  getRegisteredAdapters(): AgentAdapter[] {
    return Array.from(this.adapters.values());
  }
  
  isAgentRegistered(agentId: string): boolean {
    return this.adapters.has(agentId);
  }
}

// ===== SUPPORTING INTERFACES =====

interface DeliveryReceipt {
  messageId: string;
  target: string;
  status: 'delivered' | 'failed' | 'pending';
  timestamp: Date;
  attempts: number;
  error?: string;
}

interface MessageAcknowledgment {
  messageId: string;
  timestamp: Date;
  status: 'acknowledged' | 'rejected';
}

interface CircuitBreakerState {
  isOpen: boolean;
  failureCount: number;
  lastFailureTime: Date;
  nextAttemptTime: Date;
}

interface RetryEntry {
  message: A2AMessage;
  target: DeliveryTarget;
  attempts: number;
  nextRetry: number;
  error: string;
}