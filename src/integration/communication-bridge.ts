/**
 * Communication Bridge - Optimized inter-component communication for Claude Flow MCP
 * Created by System Coordinator for integrated system optimization
 */

import { getErrorMessage } from '../utils/error-handler.js';
import { EventBus } from '../core/event-bus.js';
import { Logger } from '../core/logger.js';
import type { SystemComponents } from './system-startup-manager.js';

export interface MessageEnvelope {
  id: string;
  timestamp: number;
  source: string;
  target: string;
  type: string;
  payload: any;
  priority: 'low' | 'normal' | 'high' | 'critical';
  timeout?: number;
  retries?: number;
}

export interface CommunicationMetrics {
  messagesSent: number;
  messagesReceived: number;
  messagesDropped: number;
  averageLatency: number;
  errorRate: number;
  throughput: number;
  queueDepth: number;
}

export interface CommunicationConfig {
  enablePrioritization: boolean;
  enableRetries: boolean;
  defaultTimeout: number;
  maxRetries: number;
  queueLimit: number;
  batchSize: number;
  flushInterval: number;
  enableMetrics: boolean;
  enableCompression: boolean;
}

export type MessageHandler = (message: MessageEnvelope) => Promise<any> | any;

export class CommunicationBridge {
  private eventBus: EventBus;
  private logger: Logger;
  private config: CommunicationConfig;
  private components: SystemComponents;
  
  // Message handling
  private handlers: Map<string, Map<string, MessageHandler>> = new Map();
  private messageQueue: Map<string, MessageEnvelope[]> = new Map();
  private processingQueue: Map<string, Promise<void>> = new Map();
  
  // Metrics and monitoring
  private metrics: CommunicationMetrics = {
    messagesSent: 0,
    messagesReceived: 0,
    messagesDropped: 0,
    averageLatency: 0,
    errorRate: 0,
    throughput: 0,
    queueDepth: 0
  };
  
  private latencyHistory: number[] = [];
  private startTime: number = Date.now();
  private flushTimer?: NodeJS.Timeout;

  constructor(
    components: SystemComponents,
    config: Partial<CommunicationConfig> = {}
  ) {
    this.components = components;
    this.eventBus = components.eventBus;
    this.logger = components.logger;
    
    this.config = {
      enablePrioritization: true,
      enableRetries: true,
      defaultTimeout: 5000,
      maxRetries: 3,
      queueLimit: 1000,
      batchSize: 10,
      flushInterval: 100,
      enableMetrics: true,
      enableCompression: false,
      ...config
    };

    this.initialize();
  }

  /**
   * Initialize the communication bridge
   */
  private initialize(): void {
    // Setup component handlers
    this.setupComponentHandlers();
    
    // Start batch processing
    this.startBatchProcessing();
    
    // Setup metrics collection
    if (this.config.enableMetrics) {
      this.startMetricsCollection();
    }

    this.logger.info('Communication bridge initialized');
  }

  /**
   * Setup handlers for each system component
   */
  private setupComponentHandlers(): void {
    // Memory Manager handlers
    if (this.components.memoryManager) {
      this.registerHandler('memory', 'store', async (message) => {
        return await this.components.memoryManager!.store(message.payload);
      });

      this.registerHandler('memory', 'retrieve', async (message) => {
        return await this.components.memoryManager!.retrieve(message.payload.id);
      });

      this.registerHandler('memory', 'query', async (message) => {
        return await this.components.memoryManager!.query(message.payload);
      });
    }

    // Swarm Coordinator handlers
    if (this.components.swarmCoordinator) {
      this.registerHandler('swarm', 'spawn_agent', async (message) => {
        // Assuming SwarmCoordinator has a spawnAgent method
        return await (this.components.swarmCoordinator as any).spawnAgent(message.payload);
      });

      this.registerHandler('swarm', 'create_task', async (message) => {
        // Assuming SwarmCoordinator has a createTask method
        return await (this.components.swarmCoordinator as any).createTask(message.payload);
      });

      this.registerHandler('swarm', 'get_status', async (message) => {
        // Assuming SwarmCoordinator has a getStatus method
        return await (this.components.swarmCoordinator as any).getStatus();
      });
    }

    // Orchestrator handlers
    if (this.components.orchestrator) {
      this.registerHandler('orchestrator', 'create_session', async (message) => {
        // Assuming Orchestrator has session management methods
        return await (this.components.orchestrator as any).createSession(message.payload);
      });

      this.registerHandler('orchestrator', 'get_health', async (message) => {
        return await this.components.orchestrator.performHealthCheck();
      });
    }

    // Health Check Manager handlers
    if (this.components.healthCheckManager) {
      this.registerHandler('health', 'check', async (message) => {
        return await this.components.healthCheckManager!.performHealthCheck();
      });

      this.registerHandler('health', 'get_metrics', async (message) => {
        // Assuming HealthCheckManager has metrics methods
        return await (this.components.healthCheckManager as any).getMetrics();
      });
    }
  }

  /**
   * Register a message handler for a component
   */
  registerHandler(component: string, messageType: string, handler: MessageHandler): void {
    if (!this.handlers.has(component)) {
      this.handlers.set(component, new Map());
    }
    
    this.handlers.get(component)!.set(messageType, handler);
    this.logger.debug(`Registered handler: ${component}.${messageType}`);
  }

  /**
   * Send a message to a component
   */
  async sendMessage(
    target: string,
    type: string,
    payload: any,
    options: {
      priority?: 'low' | 'normal' | 'high' | 'critical';
      timeout?: number;
      retries?: number;
    } = {}
  ): Promise<any> {
    const message: MessageEnvelope = {
      id: this.generateMessageId(),
      timestamp: Date.now(),
      source: 'bridge',
      target,
      type,
      payload,
      priority: options.priority || 'normal',
      timeout: options.timeout || this.config.defaultTimeout,
      retries: options.retries || this.config.maxRetries
    };

    return await this.processMessage(message);
  }

  /**
   * Send a batch of messages
   */
  async sendBatch(messages: Array<{
    target: string;
    type: string;
    payload: any;
    options?: { priority?: string; timeout?: number; retries?: number };
  }>): Promise<any[]> {
    const messageEnvelopes = messages.map(msg => ({
      id: this.generateMessageId(),
      timestamp: Date.now(),
      source: 'bridge',
      target: msg.target,
      type: msg.type,
      payload: msg.payload,
      priority: (msg.options?.priority as any) || 'normal',
      timeout: msg.options?.timeout || this.config.defaultTimeout,
      retries: msg.options?.retries || this.config.maxRetries
    }));

    return await Promise.all(messageEnvelopes.map(msg => this.processMessage(msg)));
  }

  /**
   * Process a single message
   */
  private async processMessage(message: MessageEnvelope): Promise<any> {
    const startTime = Date.now();
    this.metrics.messagesSent++;

    try {
      // Check if handler exists
      const componentHandlers = this.handlers.get(message.target);
      if (!componentHandlers || !componentHandlers.has(message.type)) {
        throw new Error(`No handler found for ${message.target}.${message.type}`);
      }

      const handler = componentHandlers.get(message.type)!;
      
      // Apply timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Message timeout')), message.timeout);
      });

      // Execute handler with timeout
      const result = await Promise.race([
        handler(message),
        timeoutPromise
      ]);

      // Update metrics
      const latency = Date.now() - startTime;
      this.updateLatencyMetrics(latency);
      this.metrics.messagesReceived++;

      // Emit success event
      this.eventBus.emit('communication:message:success', {
        messageId: message.id,
        target: message.target,
        type: message.type,
        latency,
        timestamp: Date.now()
      });

      return result;

    } catch (error) {
      this.metrics.errorRate = (this.metrics.errorRate + 1) / this.metrics.messagesSent;
      
      // Retry logic
      if (this.config.enableRetries && message.retries && message.retries > 0) {
        this.logger.warn(`Retrying message ${message.id}, attempts left: ${message.retries}`);
        
        message.retries--;
        // Exponential backoff
        await this.sleep(Math.pow(2, this.config.maxRetries - message.retries!) * 100);
        
        return await this.processMessage(message);
      }

      // Emit error event
      this.eventBus.emit('communication:message:error', {
        messageId: message.id,
        target: message.target,
        type: message.type,
        error: getErrorMessage(error),
        timestamp: Date.now()
      });

      this.logger.error(`Message processing failed: ${message.target}.${message.type}`, error);
      throw error;
    }
  }

  /**
   * Start batch processing for queued messages
   */
  private startBatchProcessing(): void {
    this.flushTimer = setInterval(() => {
      this.flushQueues();
    }, this.config.flushInterval);
  }

  /**
   * Flush message queues
   */
  private async flushQueues(): Promise<void> {
    for (const [component, queue] of this.messageQueue.entries()) {
      if (queue.length === 0) continue;

      // Avoid concurrent processing for the same component
      if (this.processingQueue.has(component)) continue;

      const batch = queue.splice(0, this.config.batchSize);
      if (batch.length === 0) continue;

      // Sort by priority
      if (this.config.enablePrioritization) {
        batch.sort((a, b) => this.getPriorityValue(b.priority) - this.getPriorityValue(a.priority));
      }

      // Process batch
      const processingPromise = this.processBatch(batch);
      this.processingQueue.set(component, processingPromise);

      try {
        await processingPromise;
      } catch (error) {
        this.logger.error(`Batch processing failed for ${component}`, error);
      } finally {
        this.processingQueue.delete(component);
      }
    }
  }

  /**
   * Process a batch of messages
   */
  private async processBatch(messages: MessageEnvelope[]): Promise<void> {
    await Promise.allSettled(messages.map(msg => this.processMessage(msg)));
  }

  /**
   * Get priority value for sorting
   */
  private getPriorityValue(priority: string): number {
    const values = { low: 1, normal: 2, high: 3, critical: 4 };
    return values[priority as keyof typeof values] || 2;
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    setInterval(() => {
      this.updateThroughputMetrics();
      this.emitMetrics();
    }, 5000); // Every 5 seconds
  }

  /**
   * Update latency metrics
   */
  private updateLatencyMetrics(latency: number): void {
    this.latencyHistory.push(latency);
    
    // Keep only last 100 measurements
    if (this.latencyHistory.length > 100) {
      this.latencyHistory.shift();
    }

    // Calculate average latency
    this.metrics.averageLatency = this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length;
  }

  /**
   * Update throughput metrics
   */
  private updateThroughputMetrics(): void {
    const elapsed = (Date.now() - this.startTime) / 1000; // seconds
    this.metrics.throughput = this.metrics.messagesReceived / elapsed;
    this.metrics.queueDepth = Array.from(this.messageQueue.values())
      .reduce((total, queue) => total + queue.length, 0);
  }

  /**
   * Emit metrics to event bus
   */
  private emitMetrics(): void {
    this.eventBus.emit('communication:metrics', {
      metrics: { ...this.metrics },
      timestamp: Date.now()
    });
  }

  /**
   * Get current metrics
   */
  getMetrics(): CommunicationMetrics {
    return { ...this.metrics };
  }

  /**
   * Optimize communication for specific component
   */
  optimizeComponent(component: string): void {
    const componentQueue = this.messageQueue.get(component) || [];
    
    // Remove duplicate messages
    const uniqueMessages = new Map<string, MessageEnvelope>();
    componentQueue.forEach(msg => {
      const key = `${msg.type}:${JSON.stringify(msg.payload)}`;
      if (!uniqueMessages.has(key) || msg.priority === 'critical') {
        uniqueMessages.set(key, msg);
      }
    });

    this.messageQueue.set(component, Array.from(uniqueMessages.values()));
    
    this.logger.debug(`Optimized queue for ${component}: ${componentQueue.length} -> ${uniqueMessages.size}`);
  }

  /**
   * Enable/disable component communication
   */
  setComponentEnabled(component: string, enabled: boolean): void {
    if (!enabled) {
      // Clear pending messages for disabled component
      this.messageQueue.delete(component);
      this.processingQueue.delete(component);
    }
    
    this.logger.info(`Component ${component} communication ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get communication health status
   */
  getHealthStatus(): {
    healthy: boolean;
    components: Record<string, boolean>;
    metrics: CommunicationMetrics;
    issues: string[];
  } {
    const issues: string[] = [];
    const componentStatus: Record<string, boolean> = {};

    // Check each component
    for (const component of this.handlers.keys()) {
      const queue = this.messageQueue.get(component) || [];
      const healthy = queue.length < this.config.queueLimit * 0.8; // 80% threshold
      
      componentStatus[component] = healthy;
      
      if (!healthy) {
        issues.push(`${component} queue overloaded: ${queue.length}/${this.config.queueLimit}`);
      }
    }

    // Check overall system health
    const healthy = issues.length === 0 && 
                   this.metrics.errorRate < 0.1 && 
                   this.metrics.averageLatency < 1000;

    if (this.metrics.errorRate >= 0.1) {
      issues.push(`High error rate: ${(this.metrics.errorRate * 100).toFixed(1)}%`);
    }

    if (this.metrics.averageLatency >= 1000) {
      issues.push(`High latency: ${this.metrics.averageLatency.toFixed(0)}ms`);
    }

    return {
      healthy,
      components: componentStatus,
      metrics: this.getMetrics(),
      issues
    };
  }

  /**
   * Shutdown the communication bridge
   */
  shutdown(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    // Process remaining messages
    this.flushQueues();

    this.logger.info('Communication bridge shutdown completed');
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}