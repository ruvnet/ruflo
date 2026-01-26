/**
 * Event Emitter Bridge for Live Operations Dashboard
 *
 * Provides a singleton bridge between CLI operations and the WebSocket event server.
 * Buffers events when the server is not connected and flushes when connection is established.
 *
 * @module services/event-emitter
 */

import { EventEmitter } from 'events';

// ============================================
// Event Type Definitions
// ============================================

/**
 * Agent status values
 */
export type AgentStatus = 'spawning' | 'active' | 'idle' | 'busy' | 'error' | 'stopped';

/**
 * Agent type categories
 */
export type AgentType =
  | 'coordinator'
  | 'coder'
  | 'tester'
  | 'reviewer'
  | 'researcher'
  | 'architect'
  | 'planner'
  | 'security'
  | 'performance'
  | 'memory'
  | 'custom';

/**
 * Task status values
 */
export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

/**
 * Task priority levels
 */
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Message types for inter-agent communication
 */
export type MessageType =
  | 'task'
  | 'result'
  | 'query'
  | 'response'
  | 'broadcast'
  | 'error'
  | 'info'
  | 'warning'
  | 'system'
  | 'agent'
  | 'memory'
  | 'debug';

/**
 * Message priority levels
 */
export type MessagePriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Memory operation types
 */
export type MemoryOperationType = 'store' | 'retrieve' | 'search' | 'delete' | 'update';

/**
 * Extended memory operation types
 */
export type ExtendedMemoryOperationType =
  | MemoryOperationType
  | 'batch_store'
  | 'batch_retrieve'
  | 'vector_search'
  | 'list_keys'
  | 'clear';

/**
 * Topology types
 */
export type TopologyType = 'hierarchical' | 'mesh' | 'adaptive' | 'hierarchical-mesh';

/**
 * Error severity levels
 */
export type ErrorSeverity = 'warning' | 'error' | 'critical';

// ============================================
// Event Interfaces
// ============================================

/**
 * Agent status change event
 */
export interface AgentStatusEvent {
  type: 'agent:status';
  agentId: string;
  name: string;
  agentType: AgentType;
  status: AgentStatus;
  previousStatus?: AgentStatus;
  taskId?: string;
  taskDescription?: string;
  metrics?: {
    cpu: number;
    memory: number;
    messageCount: number;
    taskCount?: number;
    avgResponseTime?: number;
  };
  errorMessage?: string;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
  timestamp: number;
}

/**
 * Task error information
 */
export interface TaskError {
  code: string;
  message: string;
  stack?: string;
  retryCount?: number;
  retryable?: boolean;
}

/**
 * Task result information
 */
export interface TaskResult {
  success: boolean;
  data: unknown;
  artifacts?: Array<{
    type: 'file' | 'code' | 'report' | 'data';
    path: string;
    size: number;
    hash?: string;
    mimeType?: string;
  }>;
  logs?: string[];
  metrics?: {
    executionTime: number;
    tokensInput?: number;
    tokensOutput?: number;
    apiCalls?: number;
    memoryOperations?: number;
  };
}

/**
 * Task update event
 */
export interface TaskUpdateEvent {
  type: 'task:update';
  taskId: string;
  status: TaskStatus;
  previousStatus?: TaskStatus;
  agentId?: string;
  agentName?: string;
  description: string;
  priority?: TaskPriority;
  progress?: number;
  currentStep?: string;
  error?: string;
  errorDetails?: TaskError;
  result?: TaskResult;
  startTime?: number;
  endTime?: number;
  estimatedRemaining?: number;
  dependencies?: string[];
  tags?: string[];
  timestamp: number;
}

/**
 * Message payload types
 */
export type MessagePayload =
  | { taskId: string; description: string; instructions?: string; priority: string; dependencies?: string[] }
  | { taskId: string; success: boolean; data: unknown; error?: string; metrics?: { duration: number; tokensUsed: number } }
  | { queryId: string; queryType: string; params: Record<string, unknown> }
  | { queryId: string; data: unknown; success: boolean; error?: string }
  | { topic: string; data: unknown; targetTypes?: string[] }
  | Record<string, unknown>;

/**
 * Message event
 */
export interface MessageEvent {
  type: 'message:sent';
  messageId: string;
  source: string;
  sourceName?: string;
  target: string | null;
  targetName?: string;
  messageType: MessageType;
  priority?: MessagePriority;
  payload: MessagePayload;
  size: number;
  correlationId?: string;
  timestamp: number;
}

/**
 * Vector search result
 */
export interface VectorSearchResult {
  key: string;
  namespace: string;
  similarity: number;
  distance?: number;
  rank?: number;
  value?: unknown;
  highlight?: string;
  metadata?: {
    createdAt: number;
    updatedAt: number;
    expiresAt?: number;
    size: number;
    contentType?: string;
    tags?: string[];
    sourceAgent?: string;
  };
}

/**
 * Memory operation event
 */
export interface MemoryOperationEvent {
  type: 'memory:operation';
  operation: MemoryOperationType | ExtendedMemoryOperationType;
  namespace: string;
  key?: string;
  query?: string;
  value?: unknown;
  resultCount?: number;
  results?: VectorSearchResult[];
  cacheHit?: boolean;
  latency: number;
  success?: boolean;
  error?: string;
  agentId?: string;
  agentName?: string;
  timestamp: number;
}

/**
 * Agent node for topology
 */
export interface AgentNode {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  x?: number;
  y?: number;
  size?: number;
  color?: string;
}

/**
 * Connection between agents
 */
export interface Connection {
  id: string;
  source: string;
  target: string;
  health: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  latency?: number;
  messageCount: number;
  lastMessage?: number;
}

/**
 * Topology change event
 */
export interface TopologyChangeEvent {
  type: 'topology:change';
  topology: TopologyType;
  previousTopology?: TopologyType;
  nodes: AgentNode[];
  edges: Connection[];
  reason?: string;
  coordinatorId?: string;
  timestamp: number;
}

/**
 * System metrics
 */
export interface SystemMetrics {
  cpu: number;
  memory: number;
  memoryAvailable?: number;
  heapUsed?: number;
  heapTotal?: number;
  activeAgents: number;
  pendingTasks: number;
  messagesPerSecond: number;
  memoryOpsPerSecond: number;
  avgLatency: number;
  activeConnections?: number;
  eventLoopLatency?: number;
  uptime?: number;
}

/**
 * Agent metrics aggregate
 */
export interface AgentMetricsAggregate {
  totalAgents: number;
  activeAgents: number;
  busyAgents: number;
  idleAgents: number;
  errorAgents: number;
  totalTasksCompleted: number;
  totalTasksFailed: number;
  avgTaskDuration: number;
}

/**
 * Task metrics aggregate
 */
export interface TaskMetricsAggregate {
  totalTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  failedTasks: number;
  avgCompletionTime: number;
  throughputPerMinute: number;
}

/**
 * Memory metrics aggregate
 */
export interface MemoryMetricsAggregate {
  totalOperations: number;
  cacheHitRate: number;
  avgLatency: number;
  totalEntries: number;
  totalSize: number;
}

/**
 * Metrics update event
 */
export interface MetricsUpdateEvent {
  type: 'metrics:update';
  metrics: SystemMetrics;
  agents?: AgentMetricsAggregate;
  tasks?: TaskMetricsAggregate;
  memory?: MemoryMetricsAggregate;
  timestamp: number;
}

/**
 * Swarm configuration
 */
export interface SwarmConfig {
  topology: TopologyType;
  maxAgents: number;
  strategy: string;
}

/**
 * Swarm event
 */
export interface SwarmEvent {
  type: 'swarm';
  action: 'init' | 'started' | 'stopped' | 'scaled' | 'reconfigured';
  swarmId: string;
  config?: SwarmConfig;
  agentCount: number;
  activeTaskCount: number;
  timestamp: number;
}

/**
 * Consensus event
 */
export interface ConsensusEvent {
  type: 'consensus';
  roundId: string;
  action: 'proposed' | 'voting' | 'committed' | 'aborted';
  topic: string;
  voteCount: number;
  requiredVotes: number;
  reached: boolean;
  leaderId?: string;
  timestamp: number;
}

/**
 * Error event
 */
export interface ErrorEvent {
  type: 'error';
  code: string;
  message: string;
  severity: ErrorSeverity;
  component: string;
  stack?: string;
  agentId?: string;
  taskId?: string;
  context?: Record<string, unknown>;
  timestamp: number;
}

/**
 * Union type of all dashboard events
 */
export type DashboardEvent =
  | AgentStatusEvent
  | TaskUpdateEvent
  | MessageEvent
  | MemoryOperationEvent
  | TopologyChangeEvent
  | MetricsUpdateEvent
  | SwarmEvent
  | ConsensusEvent
  | ErrorEvent;

// ============================================
// Event Emitter Bridge Implementation
// ============================================

/**
 * Event listener callback type
 */
export type EventListener = (event: DashboardEvent) => void;

/**
 * Server connection interface for event delivery
 */
export interface EventServer {
  broadcast(event: DashboardEvent): void;
  isConnected(): boolean;
}

/**
 * Buffer configuration
 */
export interface BufferConfig {
  maxSize: number;
  flushOnConnect: boolean;
}

/**
 * Default buffer configuration
 */
const DEFAULT_BUFFER_CONFIG: BufferConfig = {
  maxSize: 1000,
  flushOnConnect: true,
};

/**
 * EventEmitterBridge - Singleton bridge for dashboard events
 *
 * Provides a centralized event emission system that:
 * - Buffers events when the server is not connected
 * - Flushes buffered events when connection is established
 * - Provides typed emit methods for all event types
 * - Supports multiple listeners for testing and debugging
 */
export class EventEmitterBridge extends EventEmitter {
  private static instance: EventEmitterBridge | null = null;

  private eventBuffer: DashboardEvent[] = [];
  private server: EventServer | null = null;
  private bufferConfig: BufferConfig;
  private isConnected: boolean = false;

  /**
   * Private constructor for singleton pattern
   */
  private constructor(config: Partial<BufferConfig> = {}) {
    super();
    this.bufferConfig = { ...DEFAULT_BUFFER_CONFIG, ...config };
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(config?: Partial<BufferConfig>): EventEmitterBridge {
    if (!EventEmitterBridge.instance) {
      EventEmitterBridge.instance = new EventEmitterBridge(config);
    }
    return EventEmitterBridge.instance;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  public static resetInstance(): void {
    if (EventEmitterBridge.instance) {
      EventEmitterBridge.instance.removeAllListeners();
      EventEmitterBridge.instance.clearBuffer();
      EventEmitterBridge.instance = null;
    }
  }

  /**
   * Connect to the event server
   */
  public connectServer(server: EventServer): void {
    this.server = server;
    this.isConnected = true;

    if (this.bufferConfig.flushOnConnect) {
      this.flushBuffer();
    }

    this.emit('server:connected');
  }

  /**
   * Disconnect from the event server
   */
  public disconnectServer(): void {
    this.server = null;
    this.isConnected = false;
    this.emit('server:disconnected');
  }

  /**
   * Check if server is connected
   */
  public isServerConnected(): boolean {
    return this.isConnected && this.server !== null && this.server.isConnected();
  }

  /**
   * Get current buffer size
   */
  public getBufferSize(): number {
    return this.eventBuffer.length;
  }

  /**
   * Get buffered events (read-only copy)
   */
  public getBufferedEvents(): readonly DashboardEvent[] {
    return [...this.eventBuffer];
  }

  /**
   * Clear the event buffer
   */
  public clearBuffer(): void {
    this.eventBuffer = [];
  }

  /**
   * Flush buffered events to the server
   */
  public flushBuffer(): void {
    if (!this.isServerConnected() || this.eventBuffer.length === 0) {
      return;
    }

    const events = [...this.eventBuffer];
    this.eventBuffer = [];

    for (const event of events) {
      this.deliverEvent(event);
    }

    this.emit('buffer:flushed', { count: events.length });
  }

  /**
   * Internal method to deliver an event
   */
  private deliverEvent(event: DashboardEvent): void {
    // Always emit locally for listeners
    this.emit('event', event);
    this.emit(event.type, event);

    // Deliver to server if connected
    if (this.isServerConnected() && this.server) {
      try {
        this.server.broadcast(event);
      } catch (error) {
        // Buffer event if delivery fails
        this.bufferEvent(event);
        this.emit('delivery:error', { event, error });
      }
    } else {
      // Buffer event if not connected
      this.bufferEvent(event);
    }
  }

  /**
   * Buffer an event for later delivery
   */
  private bufferEvent(event: DashboardEvent): void {
    // Enforce buffer size limit (drop oldest events)
    if (this.eventBuffer.length >= this.bufferConfig.maxSize) {
      const dropped = this.eventBuffer.shift();
      this.emit('buffer:overflow', { dropped });
    }

    this.eventBuffer.push(event);
  }

  /**
   * Generate a timestamp
   */
  private now(): number {
    return Date.now();
  }

  // ============================================
  // Typed Emit Methods
  // ============================================

  /**
   * Emit an agent status event
   */
  public emitAgentStatus(event: Omit<AgentStatusEvent, 'type' | 'timestamp'> & { timestamp?: number }): void {
    const fullEvent: AgentStatusEvent = {
      ...event,
      type: 'agent:status',
      timestamp: event.timestamp ?? this.now(),
    };
    this.deliverEvent(fullEvent);
  }

  /**
   * Emit a task update event
   */
  public emitTaskUpdate(event: Omit<TaskUpdateEvent, 'type' | 'timestamp'> & { timestamp?: number }): void {
    const fullEvent: TaskUpdateEvent = {
      ...event,
      type: 'task:update',
      timestamp: event.timestamp ?? this.now(),
    };
    this.deliverEvent(fullEvent);
  }

  /**
   * Emit a message event
   */
  public emitMessage(event: Omit<MessageEvent, 'type' | 'timestamp'> & { timestamp?: number }): void {
    const fullEvent: MessageEvent = {
      ...event,
      type: 'message:sent',
      timestamp: event.timestamp ?? this.now(),
    };
    this.deliverEvent(fullEvent);
  }

  /**
   * Emit a memory operation event
   */
  public emitMemoryOperation(event: Omit<MemoryOperationEvent, 'type' | 'timestamp'> & { timestamp?: number }): void {
    const fullEvent: MemoryOperationEvent = {
      ...event,
      type: 'memory:operation',
      timestamp: event.timestamp ?? this.now(),
    };
    this.deliverEvent(fullEvent);
  }

  /**
   * Emit a topology change event
   */
  public emitTopologyChange(event: Omit<TopologyChangeEvent, 'type' | 'timestamp'> & { timestamp?: number }): void {
    const fullEvent: TopologyChangeEvent = {
      ...event,
      type: 'topology:change',
      timestamp: event.timestamp ?? this.now(),
    };
    this.deliverEvent(fullEvent);
  }

  /**
   * Emit a metrics update event
   */
  public emitMetrics(event: Omit<MetricsUpdateEvent, 'type' | 'timestamp'> & { timestamp?: number }): void {
    const fullEvent: MetricsUpdateEvent = {
      ...event,
      type: 'metrics:update',
      timestamp: event.timestamp ?? this.now(),
    };
    this.deliverEvent(fullEvent);
  }

  /**
   * Emit a swarm event
   */
  public emitSwarm(event: Omit<SwarmEvent, 'type' | 'timestamp'> & { timestamp?: number }): void {
    const fullEvent: SwarmEvent = {
      ...event,
      type: 'swarm',
      timestamp: event.timestamp ?? this.now(),
    };
    this.deliverEvent(fullEvent);
  }

  /**
   * Emit a consensus event
   */
  public emitConsensus(event: Omit<ConsensusEvent, 'type' | 'timestamp'> & { timestamp?: number }): void {
    const fullEvent: ConsensusEvent = {
      ...event,
      type: 'consensus',
      timestamp: event.timestamp ?? this.now(),
    };
    this.deliverEvent(fullEvent);
  }

  /**
   * Emit an error event
   */
  public emitError(event: Omit<ErrorEvent, 'type' | 'timestamp'> & { timestamp?: number }): void {
    const fullEvent: ErrorEvent = {
      ...event,
      type: 'error',
      timestamp: event.timestamp ?? this.now(),
    };
    this.deliverEvent(fullEvent);
  }

  /**
   * Emit a generic dashboard event
   */
  public emitEvent(event: DashboardEvent): void {
    this.deliverEvent(event);
  }

  // ============================================
  // Convenience Methods
  // ============================================

  /**
   * Emit agent spawning status
   */
  public emitAgentSpawning(agentId: string, name: string, agentType: AgentType): void {
    this.emitAgentStatus({
      agentId,
      name,
      agentType,
      status: 'spawning',
    });
  }

  /**
   * Emit agent active status
   */
  public emitAgentActive(agentId: string, name: string, agentType: AgentType): void {
    this.emitAgentStatus({
      agentId,
      name,
      agentType,
      status: 'active',
      previousStatus: 'spawning',
    });
  }

  /**
   * Emit agent busy status with task
   */
  public emitAgentBusy(agentId: string, name: string, agentType: AgentType, taskId: string, taskDescription?: string): void {
    this.emitAgentStatus({
      agentId,
      name,
      agentType,
      status: 'busy',
      previousStatus: 'idle',
      taskId,
      taskDescription,
    });
  }

  /**
   * Emit agent idle status
   */
  public emitAgentIdle(agentId: string, name: string, agentType: AgentType): void {
    this.emitAgentStatus({
      agentId,
      name,
      agentType,
      status: 'idle',
      previousStatus: 'busy',
    });
  }

  /**
   * Emit agent error status
   */
  public emitAgentError(
    agentId: string,
    name: string,
    agentType: AgentType,
    error: { code: string; message: string; recoverable: boolean }
  ): void {
    this.emitAgentStatus({
      agentId,
      name,
      agentType,
      status: 'error',
      error,
      errorMessage: error.message,
    });
  }

  /**
   * Emit agent stopped status
   */
  public emitAgentStopped(agentId: string, name: string, agentType: AgentType): void {
    this.emitAgentStatus({
      agentId,
      name,
      agentType,
      status: 'stopped',
    });
  }

  /**
   * Emit task created
   */
  public emitTaskCreated(taskId: string, description: string, priority: TaskPriority = 'normal'): void {
    this.emitTaskUpdate({
      taskId,
      status: 'pending',
      description,
      priority,
    });
  }

  /**
   * Emit task assigned
   */
  public emitTaskAssigned(taskId: string, description: string, agentId: string, agentName?: string): void {
    this.emitTaskUpdate({
      taskId,
      status: 'assigned',
      previousStatus: 'pending',
      description,
      agentId,
      agentName,
    });
  }

  /**
   * Emit task started
   */
  public emitTaskStarted(taskId: string, description: string, agentId?: string): void {
    this.emitTaskUpdate({
      taskId,
      status: 'in_progress',
      previousStatus: 'assigned',
      description,
      agentId,
      startTime: this.now(),
      progress: 0,
    });
  }

  /**
   * Emit task progress
   */
  public emitTaskProgress(taskId: string, description: string, progress: number, currentStep?: string): void {
    this.emitTaskUpdate({
      taskId,
      status: 'in_progress',
      description,
      progress: Math.min(100, Math.max(0, progress)),
      currentStep,
    });
  }

  /**
   * Emit task completed
   */
  public emitTaskCompleted(taskId: string, description: string, result?: TaskResult): void {
    this.emitTaskUpdate({
      taskId,
      status: 'completed',
      previousStatus: 'in_progress',
      description,
      progress: 100,
      result,
      endTime: this.now(),
    });
  }

  /**
   * Emit task failed
   */
  public emitTaskFailed(taskId: string, description: string, error: string, errorDetails?: TaskError): void {
    this.emitTaskUpdate({
      taskId,
      status: 'failed',
      previousStatus: 'in_progress',
      description,
      error,
      errorDetails,
      endTime: this.now(),
    });
  }

  /**
   * Emit memory store operation
   */
  public emitMemoryStore(
    namespace: string,
    key: string,
    latency: number,
    options?: { agentId?: string; agentName?: string; success?: boolean; error?: string }
  ): void {
    this.emitMemoryOperation({
      operation: 'store',
      namespace,
      key,
      latency,
      success: options?.success ?? true,
      ...options,
    });
  }

  /**
   * Emit memory retrieve operation
   */
  public emitMemoryRetrieve(
    namespace: string,
    key: string,
    latency: number,
    options?: { cacheHit?: boolean; agentId?: string; agentName?: string; success?: boolean; error?: string }
  ): void {
    this.emitMemoryOperation({
      operation: 'retrieve',
      namespace,
      key,
      latency,
      success: options?.success ?? true,
      ...options,
    });
  }

  /**
   * Emit memory search operation
   */
  public emitMemorySearch(
    namespace: string,
    query: string,
    latency: number,
    resultCount: number,
    options?: { results?: VectorSearchResult[]; cacheHit?: boolean; agentId?: string; agentName?: string }
  ): void {
    this.emitMemoryOperation({
      operation: 'search',
      namespace,
      query,
      latency,
      resultCount,
      success: true,
      ...options,
    });
  }

  /**
   * Emit swarm initialized
   */
  public emitSwarmInit(swarmId: string, config: SwarmConfig, agentCount: number = 0): void {
    this.emitSwarm({
      action: 'init',
      swarmId,
      config,
      agentCount,
      activeTaskCount: 0,
    });
  }

  /**
   * Emit swarm started
   */
  public emitSwarmStarted(swarmId: string, agentCount: number, activeTaskCount: number = 0): void {
    this.emitSwarm({
      action: 'started',
      swarmId,
      agentCount,
      activeTaskCount,
    });
  }

  /**
   * Emit swarm stopped
   */
  public emitSwarmStopped(swarmId: string): void {
    this.emitSwarm({
      action: 'stopped',
      swarmId,
      agentCount: 0,
      activeTaskCount: 0,
    });
  }

  /**
   * Emit critical error
   */
  public emitCriticalError(component: string, code: string, message: string, context?: Record<string, unknown>): void {
    this.emitError({
      code,
      message,
      severity: 'critical',
      component,
      context,
    });
  }

  /**
   * Emit warning
   */
  public emitWarning(component: string, code: string, message: string, context?: Record<string, unknown>): void {
    this.emitError({
      code,
      message,
      severity: 'warning',
      component,
      context,
    });
  }
}

// ============================================
// Singleton Accessor
// ============================================

/**
 * Get the singleton EventEmitterBridge instance
 *
 * @param config Optional buffer configuration
 * @returns The singleton EventEmitterBridge instance
 *
 * @example
 * ```typescript
 * import { getEventEmitter } from './services/event-emitter.js';
 *
 * const emitter = getEventEmitter();
 *
 * // Emit agent status
 * emitter.emitAgentStatus({
 *   agentId: 'agent-1',
 *   name: 'Coder',
 *   agentType: 'coder',
 *   status: 'active',
 * });
 *
 * // Use convenience methods
 * emitter.emitAgentSpawning('agent-2', 'Tester', 'tester');
 * emitter.emitTaskCreated('task-1', 'Implement feature X');
 * ```
 */
export function getEventEmitter(config?: Partial<BufferConfig>): EventEmitterBridge {
  const emitter = EventEmitterBridge.getInstance(config);

  // Auto-connect to HTTP event endpoint if not already connected
  if (!emitter.isServerConnected()) {
    connectToEventServer(emitter);
  }

  return emitter;
}

/**
 * Connect the event emitter to the HTTP event endpoint
 * Uses synchronous HTTP POST which works for CLI commands
 */
function connectToEventServer(emitter: EventEmitterBridge): void {
  const httpPort = process.env.CLAUDE_FLOW_EVENT_PORT || '3002';

  // Connect the emitter to broadcast via HTTP (using execSync for synchronous delivery)
  emitter.connectServer({
    broadcast: (event: DashboardEvent) => {
      // Map event type to channel
      const channelMap: Record<string, string> = {
        'agent:status': 'agents',
        'task:update': 'tasks',
        'message:sent': 'messages',
        'memory:operation': 'memory',
        'topology:change': 'topology',
        'metrics:update': 'metrics',
        'swarm': 'agents',
        'consensus': 'agents',
        'error': 'agents',
      };
      const channel = channelMap[event.type] || 'agents';

      const payload = JSON.stringify({
        channel,
        type: event.type,
        event,
        timestamp: event.timestamp || Date.now(),
      });

      // Use curl for synchronous HTTP POST
      try {
        const { execSync } = require('child_process');
        execSync(
          `curl -s -X POST http://localhost:${httpPort}/event -H "Content-Type: application/json" -d '${payload.replace(/'/g, "'\\''")}' --connect-timeout 1 -m 2`,
          { stdio: 'ignore', timeout: 3000 }
        );
      } catch {
        // Silently fail - event server may not be running
      }
    },
    isConnected: () => true, // Always return true since HTTP is stateless
  });
}

/**
 * Reset the event emitter singleton (for testing)
 */
export function resetEventEmitter(): void {
  EventEmitterBridge.resetInstance();
}

// Default export
export default EventEmitterBridge;
