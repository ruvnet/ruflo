/**
 * Base Agent Adapter
 * Abstract base class for implementing agent adapters
 */

import { EventEmitter } from 'node:events';
import type { 
  AbstractCodingAgent, 
  AgentCapabilities, 
  AgentConfiguration, 
  AgentHealth, 
  AgentMetrics, 
  AgentMessage, 
  AgentEvent,
  CodingTask, 
  CodingResult,
  AgentProvider,
  EventType,
  EventHandler
} from '../interfaces/abstract-coding-agent.js';
import type { AgentId, AgentStatus } from '../../swarm/types.js';

// ===== BASE ADAPTER CLASS =====

export abstract class BaseCodingAgentAdapter extends EventEmitter implements AbstractCodingAgent {
  // Core properties
  public readonly id: string;
  public readonly type: string;
  public readonly provider: AgentProvider;
  
  // Configuration
  protected config: AgentConfiguration;
  protected capabilities: AgentCapabilities;
  
  // State
  protected status: AgentStatus = 'initializing';
  protected health: AgentHealth;
  protected metrics: AgentMetrics;
  
  // Event handlers
  private eventHandlers = new Map<EventType, EventHandler[]>();
  
  // Lifecycle flags
  private initialized = false;
  private shuttingDown = false;

  constructor(
    id: string,
    type: string,
    provider: AgentProvider,
    config: AgentConfiguration
  ) {
    super();
    
    this.id = id;
    this.type = type;
    this.provider = provider;
    this.config = config;
    
    // Initialize default values
    this.capabilities = this.getDefaultCapabilities();
    this.health = this.createDefaultHealth();
    this.metrics = this.createDefaultMetrics();
    
    // Setup event handling
    this.setupEventHandling();
  }

  // ===== ABSTRACT METHODS (Must be implemented by subclasses) =====

  /**
   * Execute a coding task using the specific agent implementation
   */
  protected abstract executeTaskInternal(task: CodingTask): Promise<any>;

  /**
   * Get agent-specific capabilities
   */
  protected abstract getAgentCapabilities(): Promise<AgentCapabilities>;

  /**
   * Perform agent-specific health check
   */
  protected abstract performHealthCheck(): Promise<AgentHealth>;

  /**
   * Initialize agent-specific resources
   */
  protected abstract initializeInternal(): Promise<void>;

  /**
   * Shutdown agent-specific resources
   */
  protected abstract shutdownInternal(): Promise<void>;

  /**
   * Send message using agent-specific communication
   */
  protected abstract sendMessageInternal(to: AgentId, message: AgentMessage): Promise<void>;

  // ===== IMPLEMENTED METHODS =====

  /**
   * Execute a coding task with standardized error handling and metrics
   */
  async executeTask(task: CodingTask): Promise<CodingResult> {
    if (!this.initialized) {
      throw new Error(`Agent ${this.id} is not initialized`);
    }

    if (this.status !== 'idle' && this.status !== 'busy') {
      throw new Error(`Agent ${this.id} is not available (status: ${this.status})`);
    }

    const startTime = Date.now();
    this.status = 'busy';
    this.updateMetrics({ tasksStarted: 1 });

    try {
      // Execute the task using the specific implementation
      const rawResult = await this.executeTaskInternal(task);
      
      // Normalize the result to standard format
      const result = this.normalizeResult(rawResult, task, Date.now() - startTime);
      
      // Update metrics
      this.updateMetrics({ 
        tasksCompleted: 1,
        averageExecutionTime: this.calculateAverageExecutionTime(Date.now() - startTime),
        lastActivity: new Date()
      });

      this.status = 'idle';
      this.emit('task-completed', { taskId: task.id, result });
      
      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const agentError = this.normalizeError(error, task, executionTime);
      
      // Update metrics
      this.updateMetrics({ 
        tasksFailed: 1,
        lastActivity: new Date()
      });

      this.status = 'idle';
      this.emit('task-failed', { taskId: task.id, error: agentError });
      
      throw agentError;
    }
  }

  /**
   * Get agent capabilities
   */
  async getCapabilities(): Promise<AgentCapabilities> {
    if (!this.initialized) {
      return this.capabilities;
    }

    try {
      const agentCapabilities = await this.getAgentCapabilities();
      this.capabilities = { ...this.capabilities, ...agentCapabilities };
      return this.capabilities;
    } catch (error) {
      console.warn(`Failed to get capabilities for agent ${this.id}:`, error);
      return this.capabilities;
    }
  }

  /**
   * Perform health check
   */
  async healthCheck(): Promise<AgentHealth> {
    try {
      const health = await this.performHealthCheck();
      this.health = health;
      this.emit('health-changed', { health });
      return health;
    } catch (error) {
      console.error(`Health check failed for agent ${this.id}:`, error);
      this.health = this.createUnhealthyHealth(error);
      return this.health;
    }
  }

  /**
   * Configure the agent
   */
  async configure(config: AgentConfiguration): Promise<void> {
    this.config = { ...this.config, ...config };
    
    // Update capabilities if configuration changed
    if (config.capabilities) {
      this.capabilities = { ...this.capabilities, ...config.capabilities };
    }
    
    this.emit('configuration-changed', { config: this.config });
  }

  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.status = 'initializing';
      await this.initializeInternal();
      
      // Get initial capabilities
      this.capabilities = await this.getAgentCapabilities();
      
      // Perform initial health check
      this.health = await this.performHealthCheck();
      
      this.initialized = true;
      this.status = 'idle';
      
      this.emit('agent-initialized', { agentId: this.id });
    } catch (error) {
      this.status = 'error';
      this.emit('agent-initialization-failed', { agentId: this.id, error });
      throw error;
    }
  }

  /**
   * Shutdown the agent
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;
    this.status = 'terminating';

    try {
      await this.shutdownInternal();
      this.initialized = false;
      this.status = 'terminated';
      
      this.emit('agent-shutdown', { agentId: this.id });
    } catch (error) {
      console.error(`Shutdown failed for agent ${this.id}:`, error);
      this.status = 'error';
      throw error;
    }
  }

  /**
   * Get current status
   */
  async getStatus(): Promise<AgentStatus> {
    return this.status;
  }

  /**
   * Get current metrics
   */
  async getMetrics(): Promise<AgentMetrics> {
    return { ...this.metrics };
  }

  /**
   * Send message to another agent
   */
  async sendMessage(to: AgentId, message: AgentMessage): Promise<void> {
    if (!this.initialized) {
      throw new Error(`Agent ${this.id} is not initialized`);
    }

    try {
      await this.sendMessageInternal(to, message);
      this.emit('message-sent', { to, message });
    } catch (error) {
      this.emit('message-send-failed', { to, message, error });
      throw error;
    }
  }

  /**
   * Broadcast message to all agents
   */
  async broadcastMessage(message: AgentMessage): Promise<void> {
    // This would typically be handled by a coordination system
    this.emit('message-broadcast', { message });
  }

  /**
   * Subscribe to events
   */
  onEvent(eventType: EventType, handler: EventHandler): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
  }

  /**
   * Unsubscribe from events
   */
  offEvent(eventType: EventType, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  // ===== PROTECTED HELPER METHODS =====

  /**
   * Normalize raw result to standard format
   */
  protected normalizeResult(rawResult: any, task: CodingTask, executionTime: number): CodingResult {
    return {
      success: true,
      taskId: task.id,
      timestamp: new Date(),
      output: this.normalizeOutput(rawResult),
      artifacts: this.extractArtifacts(rawResult),
      executionTime,
      tokensUsed: this.extractTokensUsed(rawResult),
      cost: this.extractCost(rawResult),
      quality: this.assessQuality(rawResult),
      errors: [],
      warnings: this.extractWarnings(rawResult),
      recommendations: this.extractRecommendations(rawResult),
      nextSteps: this.extractNextSteps(rawResult),
      validated: false,
      metadata: this.createResultMetadata(task, executionTime)
    };
  }

  /**
   * Normalize error to standard format
   */
  protected normalizeError(error: any, task: CodingTask, executionTime: number): any {
    return {
      type: 'task-execution-error',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: {
        taskId: task.id,
        taskType: task.type,
        executionTime,
        agentId: this.id,
        provider: this.provider
      },
      recoverable: this.isRecoverableError(error),
      retryable: this.isRetryableError(error),
      severity: this.assessErrorSeverity(error),
      timestamp: new Date()
    };
  }

  /**
   * Update agent metrics
   */
  protected updateMetrics(updates: Partial<AgentMetrics>): void {
    this.metrics = { ...this.metrics, ...updates };
    this.emit('metrics-updated', { metrics: this.metrics });
  }

  /**
   * Calculate average execution time
   */
  protected calculateAverageExecutionTime(newExecutionTime: number): number {
    const totalTasks = this.metrics.tasksCompleted + this.metrics.tasksFailed;
    if (totalTasks === 0) return newExecutionTime;
    
    const totalTime = this.metrics.averageExecutionTime * (totalTasks - 1) + newExecutionTime;
    return totalTime / totalTasks;
  }

  /**
   * Create default capabilities
   */
  protected getDefaultCapabilities(): AgentCapabilities {
    return {
      codeGeneration: false,
      codeReview: false,
      debugging: false,
      refactoring: false,
      testing: false,
      documentation: false,
      languages: [],
      frameworks: [],
      domains: [],
      tools: [],
      maxConcurrentTasks: 1,
      maxTokensPerRequest: 1000,
      maxExecutionTime: 300000, // 5 minutes
      reliability: 0.8,
      speed: 0.8,
      quality: 0.8
    };
  }

  /**
   * Create default health
   */
  protected createDefaultHealth(): AgentHealth {
    return {
      status: 'healthy',
      score: 1.0,
      components: {
        connectivity: 1.0,
        performance: 1.0,
        reliability: 1.0,
        resources: 1.0
      },
      lastCheck: new Date(),
      issues: []
    };
  }

  /**
   * Create unhealthy health
   */
  protected createUnhealthyHealth(error: any): AgentHealth {
    return {
      status: 'unhealthy',
      score: 0.0,
      components: {
        connectivity: 0.0,
        performance: 0.0,
        reliability: 0.0,
        resources: 0.0
      },
      lastCheck: new Date(),
      issues: [{
        type: 'connectivity',
        severity: 'critical',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
        resolved: false
      }]
    };
  }

  /**
   * Create default metrics
   */
  protected createDefaultMetrics(): AgentMetrics {
    return {
      tasksCompleted: 0,
      tasksFailed: 0,
      averageExecutionTime: 0,
      successRate: 1.0,
      tokensUsed: 0,
      costIncurred: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      averageQuality: 0.8,
      codeQualityScore: 0.8,
      testCoverage: 0,
      uptime: Date.now(),
      lastActivity: new Date(),
      responseTime: 0
    };
  }

  /**
   * Setup event handling
   */
  private setupEventHandling(): void {
    // Handle internal events and forward them
    this.on('task-completed', (data) => {
      this.emitEvent('task-completed', data);
    });

    this.on('task-failed', (data) => {
      this.emitEvent('task-failed', data);
    });

    this.on('health-changed', (data) => {
      this.emitEvent('health-changed', data);
    });

    this.on('metrics-updated', (data) => {
      this.emitEvent('metrics-updated', data);
    });
  }

  /**
   * Emit event to registered handlers
   */
  private emitEvent(eventType: EventType, data: any): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const event: AgentEvent = {
        id: this.generateEventId(),
        type: eventType,
        source: { id: this.id, swarmId: 'default', type: this.type, instance: 1 },
        data,
        timestamp: new Date()
      };

      handlers.forEach(handler => {
        try {
          handler(event);
        } catch (error) {
          console.error(`Error in event handler for ${eventType}:`, error);
        }
      });
    }
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ===== ABSTRACT HELPER METHODS (Can be overridden by subclasses) =====

  /**
   * Normalize output from raw result
   */
  protected normalizeOutput(rawResult: any): any {
    return rawResult;
  }

  /**
   * Extract artifacts from raw result
   */
  protected extractArtifacts(rawResult: any): any[] {
    return [];
  }

  /**
   * Extract tokens used from raw result
   */
  protected extractTokensUsed(rawResult: any): number {
    return 0;
  }

  /**
   * Extract cost from raw result
   */
  protected extractCost(rawResult: any): number {
    return 0;
  }

  /**
   * Assess quality of result
   */
  protected assessQuality(rawResult: any): number {
    return 0.8; // Default quality score
  }

  /**
   * Extract warnings from raw result
   */
  protected extractWarnings(rawResult: any): any[] {
    return [];
  }

  /**
   * Extract recommendations from raw result
   */
  protected extractRecommendations(rawResult: any): any[] {
    return [];
  }

  /**
   * Extract next steps from raw result
   */
  protected extractNextSteps(rawResult: any): any[] {
    return [];
  }

  /**
   * Create result metadata
   */
  protected createResultMetadata(task: CodingTask, executionTime: number): any {
    return {
      version: '1.0.0',
      timestamp: new Date(),
      agentId: this.id,
      executionTime,
      environment: this.config.environment || 'default',
      tags: task.tags || [],
      custom: {}
    };
  }

  /**
   * Check if error is recoverable
   */
  protected isRecoverableError(error: any): boolean {
    return false; // Default to non-recoverable
  }

  /**
   * Check if error is retryable
   */
  protected isRetryableError(error: any): boolean {
    return false; // Default to non-retryable
  }

  /**
   * Assess error severity
   */
  protected assessErrorSeverity(error: any): 'low' | 'medium' | 'high' | 'critical' {
    return 'medium'; // Default severity
  }
}

// ===== EXPORTS =====

export default BaseCodingAgentAdapter;