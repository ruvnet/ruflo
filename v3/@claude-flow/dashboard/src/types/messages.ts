/**
 * Message Types for Live Operations Dashboard
 * @module types/messages
 * Defines message events and related types for inter-agent communication
 */

// Try to re-export from store if available, otherwise define locally
// This provides flexibility for standalone type usage

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
 * Message type as enum for stricter typing
 */
export enum MessageTypeEnum {
  TASK = 'task',
  RESULT = 'result',
  QUERY = 'query',
  RESPONSE = 'response',
  BROADCAST = 'broadcast',
  ERROR = 'error',
  INFO = 'info',
  WARNING = 'warning',
  SYSTEM = 'system',
  AGENT = 'agent',
  MEMORY = 'memory',
  DEBUG = 'debug',
}

/**
 * Message direction
 */
export type MessageDirection = 'inbound' | 'outbound' | 'internal';

/**
 * Extended message types including system messages
 */
export type ExtendedMessageType =
  | MessageType
  | 'status'
  | 'heartbeat'
  | 'coordination'
  | 'memory_sync'
  | 'consensus';

/**
 * Message priority levels
 */
export type MessagePriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Message priority as enum
 */
export enum MessagePriorityEnum {
  CRITICAL = 'critical',
  HIGH = 'high',
  NORMAL = 'normal',
  LOW = 'low',
}

/**
 * Message delivery status
 */
export type MessageDeliveryStatus = 'queued' | 'sending' | 'delivered' | 'failed' | 'acknowledged';

/**
 * Message delivery status as enum
 */
export enum MessageDeliveryStatusEnum {
  QUEUED = 'queued',
  SENDING = 'sending',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  ACKNOWLEDGED = 'acknowledged',
}

/**
 * Task message payload
 */
export interface TaskMessagePayload {
  /** Task ID */
  taskId: string;
  /** Task description */
  description: string;
  /** Task instructions */
  instructions?: string;
  /** Task priority */
  priority: string;
  /** Task dependencies */
  dependencies?: string[];
}

/**
 * Result message payload
 */
export interface ResultMessagePayload {
  /** Task ID this result is for */
  taskId: string;
  /** Whether the task succeeded */
  success: boolean;
  /** Result data */
  data: unknown;
  /** Error message if failed */
  error?: string;
  /** Execution metrics */
  metrics?: {
    duration: number;
    tokensUsed: number;
  };
}

/**
 * Query message payload
 */
export interface QueryMessagePayload {
  /** Query ID for correlation */
  queryId: string;
  /** Query type */
  queryType: 'memory' | 'status' | 'capability' | 'custom';
  /** Query parameters */
  params: Record<string, unknown>;
}

/**
 * Response message payload
 */
export interface ResponseMessagePayload {
  /** Query ID this response is for */
  queryId: string;
  /** Response data */
  data: unknown;
  /** Whether the query succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Broadcast message payload
 */
export interface BroadcastMessagePayload {
  /** Broadcast topic */
  topic: string;
  /** Broadcast data */
  data: unknown;
  /** Target agent types (empty = all) */
  targetTypes?: string[];
}

/**
 * Consensus message payload
 */
export interface ConsensusMessagePayload {
  /** Consensus round ID */
  roundId: string;
  /** Consensus type */
  type: 'propose' | 'vote' | 'commit' | 'abort';
  /** Proposal or vote data */
  data: unknown;
  /** Voter/proposer ID */
  voterId: string;
}

/**
 * Union type for all message payloads
 */
export type MessagePayload =
  | TaskMessagePayload
  | ResultMessagePayload
  | QueryMessagePayload
  | ResponseMessagePayload
  | BroadcastMessagePayload
  | ConsensusMessagePayload
  | Record<string, unknown>;

/**
 * Message event from the WebSocket stream
 */
export interface Message {
  /** Unique message identifier */
  id: string;
  /** Source agent ID */
  source: string;
  /** Source agent name */
  sourceName?: string;
  /** Target agent ID (null/empty for broadcasts) */
  target: string;
  /** Target agent name */
  targetName?: string;
  /** Message type */
  messageType: MessageType;
  /** Message type (alias for compatibility) */
  type?: MessageType;
  /** Message direction */
  direction?: MessageDirection;
  /** Message priority */
  priority?: MessagePriority;
  /** Message payload */
  payload: unknown;
  /** Message content (alias) */
  content?: unknown;
  /** Payload size in bytes */
  size: number;
  /** Message timestamp */
  timestamp: number;
  /** Delivery status */
  deliveryStatus?: MessageDeliveryStatus;
  /** Correlation ID for request/response tracking */
  correlationId?: string;
  /** Number of delivery attempts */
  deliveryAttempts?: number;
  /** Acknowledgment timestamp */
  acknowledgedAt?: number;
}

/**
 * Message event from WebSocket (full event structure)
 */
export interface MessageEvent {
  /** Event type discriminator */
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
  /** Event timestamp */
  timestamp: number;
}

/**
 * Message flow for visualization
 */
export interface MessageFlow {
  /** Source agent ID */
  from: string;
  /** Target agent ID */
  to: string;
  /** Message count in this flow */
  count: number;
  /** Total bytes transferred */
  totalBytes: number;
  /** Messages by type */
  byType: Record<MessageType, number>;
  /** Average latency in milliseconds */
  avgLatency?: number;
  /** Last message timestamp */
  lastMessageAt: number;
}

/**
 * Message statistics
 */
export interface MessageStats {
  /** Total messages */
  total: number;
  /** Total messages sent */
  totalSent?: number;
  /** Total messages received */
  totalReceived?: number;
  /** Messages by type */
  byType: Record<MessageType, number>;
  /** Messages by direction */
  byDirection?: Record<MessageDirection, number>;
  /** Messages by priority */
  byPriority?: Record<MessagePriority, number>;
  /** Messages by delivery status */
  byDeliveryStatus?: Record<MessageDeliveryStatus, number>;
  /** Total bytes transferred */
  totalBytes?: number;
  /** Average message size in bytes */
  avgMessageSize?: number;
  /** Average delivery latency in milliseconds */
  avgLatency?: number;
  /** Messages per second (current rate) */
  messagesPerSecond?: number;
  /** Peak messages per second */
  peakMessagesPerSecond?: number;
}

/**
 * Message filter for queries/filtering
 */
export interface MessageFilter {
  /** Filter by source agents */
  sourceAgents?: string[];
  /** Filter by target agents */
  targetAgents?: string[];
  /** Filter by message types */
  types?: MessageType[];
  /** Filter by direction */
  direction?: MessageDirection;
  /** Search query for payload */
  searchQuery?: string;
  /** Search term */
  search?: string;
  /** Filter by time range */
  timeRange?: {
    start: number;
    end: number;
  };
  /** Filter by priority */
  priorities?: MessagePriority[];
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Message filter state for filtering the message stream (store compatible)
 */
export interface MessageFilterState {
  /** Filter by source agents */
  sourceAgents: string[];
  /** Filter by target agents */
  targetAgents: string[];
  /** Filter by message types */
  messageTypes: MessageType[];
  /** Search query for payload */
  searchQuery: string;
  /** Filter by time range */
  timeRange?: {
    start: number;
    end: number;
  };
  /** Filter by priority */
  priorities?: MessagePriority[];
}

/**
 * Message store state (for Zustand store)
 */
export interface MessageStoreState {
  messages: Message[];
  stats: MessageStats;
  filter: MessageFilter;
  isPaused: boolean;
  maxMessages: number;
}

/**
 * Message colors based on PRD color scheme
 */
export const MESSAGE_TYPE_COLORS: Record<MessageType, string> = {
  task: '#3b82f6',     // Blue
  result: '#22c55e',   // Green (was response)
  query: '#f59e0b',    // Amber
  response: '#8b5cf6', // Purple
  broadcast: '#06b6d4', // Cyan
  error: '#ef4444',    // Red
  info: '#06b6d4',     // Cyan
  warning: '#f59e0b',  // Amber
  system: '#64748b',   // Slate
  agent: '#8b5cf6',    // Purple
  memory: '#ec4899',   // Pink
  debug: '#6b7280',    // Gray
};

/**
 * Message type CSS classes
 */
export const MESSAGE_TYPE_CSS_COLORS: Record<MessageType, string> = {
  task: 'text-blue-500 bg-blue-500/10',
  result: 'text-green-500 bg-green-500/10',
  query: 'text-amber-500 bg-amber-500/10',
  response: 'text-purple-500 bg-purple-500/10',
  broadcast: 'text-cyan-500 bg-cyan-500/10',
  error: 'text-red-500 bg-red-500/10',
  info: 'text-cyan-500 bg-cyan-500/10',
  warning: 'text-amber-500 bg-amber-500/10',
  system: 'text-slate-500 bg-slate-500/10',
  agent: 'text-purple-500 bg-purple-500/10',
  memory: 'text-pink-500 bg-pink-500/10',
  debug: 'text-gray-500 bg-gray-500/10',
};

/**
 * Message type labels for display
 */
export const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  task: 'Task',
  result: 'Result',
  query: 'Query',
  response: 'Response',
  broadcast: 'Broadcast',
  error: 'Error',
  info: 'Info',
  warning: 'Warning',
  system: 'System',
  agent: 'Agent',
  memory: 'Memory',
  debug: 'Debug',
};

/**
 * All available message types
 */
export const ALL_MESSAGE_TYPES: MessageType[] = [
  'task',
  'result',
  'query',
  'response',
  'broadcast',
  'error',
  'info',
  'warning',
  'system',
  'agent',
  'memory',
  'debug',
];

/**
 * Message direction colors
 */
export const MESSAGE_DIRECTION_COLORS: Record<MessageDirection, string> = {
  inbound: '#22c55e',  // Green
  outbound: '#3b82f6', // Blue
  internal: '#8b5cf6', // Purple
};

/**
 * Message direction labels
 */
export const MESSAGE_DIRECTION_LABELS: Record<MessageDirection, string> = {
  inbound: 'Inbound',
  outbound: 'Outbound',
  internal: 'Internal',
};

/**
 * Default filter state
 */
export const DEFAULT_MESSAGE_FILTER: MessageFilterState = {
  sourceAgents: [],
  targetAgents: [],
  messageTypes: [],
  searchQuery: '',
};
