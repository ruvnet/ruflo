/**
 * Event types for the Live Operations Dashboard
 * @module types/events
 */

import type { AgentStatus, AgentMetrics, AgentNode, AgentType } from './agents';
import type { TaskStatus, TaskPriority, TaskError, TaskResult } from './tasks';
import type { MessageType, MessagePayload, MessagePriority } from './messages';
import type { MemoryOperationType, ExtendedMemoryOperationType, VectorSearchResult } from './memory';
import type { TopologyType, Connection } from './topology';

/**
 * WebSocket connection status
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

/**
 * All event type discriminators
 */
export type EventType =
  | 'agent:status'
  | 'task:update'
  | 'message:sent'
  | 'memory:operation'
  | 'topology:change'
  | 'metrics:update'
  | 'error'
  | 'connection'
  | 'swarm'
  | 'consensus'
  | 'subscribed'
  | 'pong';

/**
 * Base event structure
 */
export interface BaseEvent {
  /** Event type discriminator */
  type: EventType;
  /** Event timestamp */
  timestamp: number;
}

/**
 * Agent status change event
 */
export interface AgentStatusEvent extends BaseEvent {
  type: 'agent:status';
  /** Agent ID */
  agentId: string;
  /** Agent name */
  name: string;
  /** Agent type */
  agentType: AgentType;
  /** New status */
  status: AgentStatus;
  /** Previous status */
  previousStatus?: AgentStatus;
  /** Current task ID (if any) */
  taskId?: string;
  /** Current task description (if any) */
  taskDescription?: string;
  /** Agent metrics */
  metrics?: Partial<AgentMetrics>;
  /** Error message (if status is error) */
  errorMessage?: string;
  /** Full error information */
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
}

/**
 * Task update event
 */
export interface TaskUpdateEvent extends BaseEvent {
  type: 'task:update';
  /** Task ID */
  taskId: string;
  /** Task status */
  status: TaskStatus;
  /** Previous status */
  previousStatus?: TaskStatus;
  /** Assigned agent ID */
  agentId?: string;
  /** Assigned agent name */
  agentName?: string;
  /** Task description */
  description: string;
  /** Task priority */
  priority?: TaskPriority;
  /** Progress percentage (0-100) */
  progress?: number;
  /** Current step description */
  currentStep?: string;
  /** Error message (if status is failed) */
  error?: string;
  /** Full error information */
  errorDetails?: TaskError;
  /** Task result (if completed) */
  result?: TaskResult;
  /** Task start time */
  startTime?: number;
  /** Task end time */
  endTime?: number;
  /** Estimated remaining time in milliseconds */
  estimatedRemaining?: number;
  /** Task dependencies */
  dependencies?: string[];
  /** Task tags */
  tags?: string[];
}

/**
 * Message event
 */
export interface MessageEvent extends BaseEvent {
  type: 'message:sent';
  /** Message ID */
  messageId: string;
  /** Source agent ID */
  source: string;
  /** Source agent name */
  sourceName?: string;
  /** Target agent ID (null for broadcasts) */
  target: string | null;
  /** Target agent name */
  targetName?: string;
  /** Message type */
  messageType: MessageType;
  /** Message priority */
  priority?: MessagePriority;
  /** Message payload */
  payload: MessagePayload;
  /** Message size in bytes */
  size: number;
  /** Correlation ID */
  correlationId?: string;
}

/**
 * Memory operation event
 */
export interface MemoryOperationEvent extends BaseEvent {
  type: 'memory:operation';
  /** Operation type */
  operation: MemoryOperationType | ExtendedMemoryOperationType;
  /** Target namespace */
  namespace: string;
  /** Target key */
  key?: string;
  /** Search query */
  query?: string;
  /** Stored/retrieved value (may be truncated for large values) */
  value?: unknown;
  /** Number of results (for searches) */
  resultCount?: number;
  /** Search results */
  results?: VectorSearchResult[];
  /** Whether it was a cache hit */
  cacheHit?: boolean;
  /** Operation latency in milliseconds */
  latency: number;
  /** Whether operation succeeded */
  success?: boolean;
  /** Error message if failed */
  error?: string;
  /** Agent that performed the operation */
  agentId?: string;
  /** Agent name */
  agentName?: string;
}

/**
 * Topology change event
 */
export interface TopologyChangeEvent extends BaseEvent {
  type: 'topology:change';
  /** Topology type */
  topology: TopologyType;
  /** Previous topology type */
  previousTopology?: TopologyType;
  /** All nodes in the topology */
  nodes: AgentNode[];
  /** All edges in the topology */
  edges: Connection[];
  /** Reason for topology change */
  reason?: string;
  /** Coordinator agent ID (for hierarchical) */
  coordinatorId?: string;
}

/**
 * System metrics
 */
export interface SystemMetrics {
  /** CPU usage percentage (0-100) */
  cpu: number;
  /** Memory usage in bytes */
  memory: number;
  /** Memory available in bytes */
  memoryAvailable?: number;
  /** Heap used in bytes */
  heapUsed?: number;
  /** Heap total in bytes */
  heapTotal?: number;
  /** Active agent count */
  activeAgents: number;
  /** Pending task count */
  pendingTasks: number;
  /** Messages per second */
  messagesPerSecond: number;
  /** Memory operations per second */
  memoryOpsPerSecond: number;
  /** Average latency in milliseconds */
  avgLatency: number;
  /** Active connections count */
  activeConnections?: number;
  /** Event loop latency in milliseconds */
  eventLoopLatency?: number;
  /** Uptime in seconds */
  uptime?: number;
}

/**
 * Agent metrics aggregation
 */
export interface AgentMetricsAggregate {
  /** Total agents */
  totalAgents: number;
  /** Active agents */
  activeAgents: number;
  /** Busy agents */
  busyAgents: number;
  /** Idle agents */
  idleAgents: number;
  /** Error agents */
  errorAgents: number;
  /** Total tasks completed */
  totalTasksCompleted: number;
  /** Total tasks failed */
  totalTasksFailed: number;
  /** Average task duration */
  avgTaskDuration: number;
}

/**
 * Task metrics aggregation
 */
export interface TaskMetricsAggregate {
  /** Total tasks */
  totalTasks: number;
  /** Pending tasks */
  pendingTasks: number;
  /** In-progress tasks */
  inProgressTasks: number;
  /** Completed tasks */
  completedTasks: number;
  /** Failed tasks */
  failedTasks: number;
  /** Average completion time */
  avgCompletionTime: number;
  /** Throughput (tasks per minute) */
  throughputPerMinute: number;
}

/**
 * Memory metrics aggregation
 */
export interface MemoryMetricsAggregate {
  /** Total operations */
  totalOperations: number;
  /** Cache hit rate (0-1) */
  cacheHitRate: number;
  /** Average latency */
  avgLatency: number;
  /** Total entries */
  totalEntries: number;
  /** Total size in bytes */
  totalSize: number;
}

/**
 * Metrics update event
 */
export interface MetricsUpdateEvent extends BaseEvent {
  type: 'metrics:update';
  /** System-level metrics */
  metrics: SystemMetrics;
  /** Agent metrics (optional, for detailed updates) */
  agents?: AgentMetricsAggregate;
  /** Task metrics (optional, for detailed updates) */
  tasks?: TaskMetricsAggregate;
  /** Memory metrics (optional, for detailed updates) */
  memory?: MemoryMetricsAggregate;
}

/**
 * Error event
 */
export interface ErrorEvent extends BaseEvent {
  type: 'error';
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Error severity */
  severity: 'warning' | 'error' | 'critical';
  /** Component that produced the error */
  component: string;
  /** Stack trace */
  stack?: string;
  /** Related agent ID */
  agentId?: string;
  /** Related task ID */
  taskId?: string;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Connection event
 */
export interface ConnectionEvent extends BaseEvent {
  type: 'connection';
  /** Connection status */
  status: 'connected' | 'disconnected' | 'reconnecting';
  /** Client ID */
  clientId: string;
  /** Connection latency in milliseconds */
  latency?: number;
  /** Disconnect reason */
  reason?: string;
  /** Reconnect attempt number */
  reconnectAttempt?: number;
}

/**
 * Swarm event
 */
export interface SwarmEvent extends BaseEvent {
  type: 'swarm';
  /** Swarm action */
  action: 'init' | 'started' | 'stopped' | 'scaled' | 'reconfigured';
  /** Swarm ID */
  swarmId: string;
  /** Swarm configuration */
  config?: {
    topology: TopologyType;
    maxAgents: number;
    strategy: string;
  };
  /** Agent count */
  agentCount: number;
  /** Active task count */
  activeTaskCount: number;
}

/**
 * Consensus event
 */
export interface ConsensusEvent extends BaseEvent {
  type: 'consensus';
  /** Consensus round ID */
  roundId: string;
  /** Consensus action */
  action: 'proposed' | 'voting' | 'committed' | 'aborted';
  /** Proposal topic */
  topic: string;
  /** Vote count */
  voteCount: number;
  /** Required votes */
  requiredVotes: number;
  /** Consensus reached */
  reached: boolean;
  /** Leader agent ID */
  leaderId?: string;
}

/**
 * Subscribed event (acknowledgment)
 */
export interface SubscribedEvent extends BaseEvent {
  type: 'subscribed';
  /** Channel that was subscribed to */
  channel: string;
}

/**
 * Pong event (heartbeat response)
 */
export interface PongEvent extends BaseEvent {
  type: 'pong';
}

/**
 * Union type for all dashboard events
 */
export type DashboardEvent =
  | AgentStatusEvent
  | TaskUpdateEvent
  | MessageEvent
  | MemoryOperationEvent
  | TopologyChangeEvent
  | MetricsUpdateEvent
  | ErrorEvent
  | ConnectionEvent
  | SwarmEvent
  | ConsensusEvent
  | SubscribedEvent
  | PongEvent;

/**
 * Event filter for subscriptions
 */
export interface EventFilter {
  /** Event types to include */
  eventTypes?: EventType[];
  /** Agent IDs to filter */
  agentIds?: string[];
  /** Task IDs to filter */
  taskIds?: string[];
  /** Time range start */
  startTime?: number;
  /** Time range end */
  endTime?: number;
  /** Maximum events to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Event subscription request
 */
export interface EventSubscription {
  /** Subscription ID */
  id: string;
  /** Event filter */
  filter: EventFilter;
  /** Callback URL for webhooks (optional) */
  callbackUrl?: string;
  /** Whether to include historical events */
  includeHistory?: boolean;
  /** Maximum historical events */
  historyLimit?: number;
}

// WebSocket protocol messages

/**
 * Subscribe message from client
 */
export interface SubscribeMessage {
  type: 'subscribe';
  channel: string;
}

/**
 * Unsubscribe message from client
 */
export interface UnsubscribeMessage {
  type: 'unsubscribe';
  channel: string;
}

/**
 * Ping message from client
 */
export interface PingMessage {
  type: 'ping';
}

/**
 * Replay message from client (request historical events)
 */
export interface ReplayMessage {
  type: 'replay';
  since: number;
  filter?: EventFilter;
}

/**
 * Union type for all client messages
 */
export type ClientMessage = SubscribeMessage | UnsubscribeMessage | PingMessage | ReplayMessage;
