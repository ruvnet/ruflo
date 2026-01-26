/**
 * Agent types for the Live Operations Dashboard
 * @module types/agents
 */

/**
 * Possible states an agent can be in
 */
export type AgentStatus = 'spawning' | 'active' | 'idle' | 'busy' | 'error' | 'stopped';

/**
 * Agent status as enum for stricter typing
 */
export enum AgentStatusEnum {
  SPAWNING = 'spawning',
  ACTIVE = 'active',
  IDLE = 'idle',
  BUSY = 'busy',
  ERROR = 'error',
  STOPPED = 'stopped',
}

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
 * Agent type as enum for stricter typing
 */
export enum AgentTypeEnum {
  COORDINATOR = 'coordinator',
  CODER = 'coder',
  TESTER = 'tester',
  REVIEWER = 'reviewer',
  RESEARCHER = 'researcher',
  ARCHITECT = 'architect',
  PLANNER = 'planner',
  SECURITY = 'security',
  PERFORMANCE = 'performance',
  MEMORY = 'memory',
  CUSTOM = 'custom',
}

/**
 * Performance metrics for an agent
 */
export interface AgentMetrics {
  /** CPU usage percentage (0-100) */
  cpu: number;
  /** Memory usage in bytes */
  memory: number;
  /** Total messages sent/received */
  messageCount: number;
  /** Total tasks processed */
  taskCount: number;
  /** Average response time in milliseconds */
  avgResponseTime: number;
  /** Tasks completed successfully */
  tasksCompleted?: number;
  /** Tasks that failed */
  tasksFailed?: number;
  /** Messages sent */
  messagesSent?: number;
  /** Messages received */
  messagesReceived?: number;
  /** Last activity timestamp */
  lastActivity?: number;
}

/**
 * Agent error information
 */
export interface AgentError {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Stack trace if available */
  stack?: string;
  /** Timestamp when error occurred */
  timestamp: number;
  /** Whether the error is recoverable */
  recoverable: boolean;
}

/**
 * Agent configuration options
 */
export interface AgentConfig {
  /** Maximum concurrent tasks */
  maxConcurrentTasks: number;
  /** Task timeout in milliseconds */
  taskTimeout: number;
  /** Memory limit in bytes */
  memoryLimit: number;
  /** Custom capabilities */
  capabilities: string[];
  /** Model to use for this agent */
  model: string;
  /** Temperature setting for LLM */
  temperature: number;
}

/**
 * Current state of an agent
 */
export interface AgentState {
  /** Unique identifier for the agent */
  id: string;
  /** Human-readable name */
  name: string;
  /** Type/role of the agent */
  type: AgentType;
  /** Current status */
  status: AgentStatus;
  /** Currently assigned task ID, if any */
  currentTaskId?: string;
  /** Current task description, if any */
  currentTaskDescription?: string;
  /** Agent performance metrics */
  metrics: AgentMetrics;
  /** Timestamp when agent was created */
  createdAt: number;
  /** Timestamp of last activity */
  lastActiveAt: number;
  /** Error message if status is error */
  errorMessage?: string;
  /** Full error information */
  error?: AgentError;
  /** Parent agent ID for hierarchical topologies */
  parentId?: string;
  /** Child agent IDs for hierarchical topologies */
  childIds?: string[];
  /** Agent configuration */
  config?: AgentConfig;
}

/**
 * Agent status change event from WebSocket
 */
export interface AgentStatusEvent {
  /** Event type discriminator */
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
  /** Event timestamp */
  timestamp: number;
}

/**
 * Node representation for topology visualization
 */
export interface AgentNode {
  /** Agent ID */
  id: string;
  /** Display label/name */
  name: string;
  /** Agent type */
  type: AgentType;
  /** Current status */
  status: AgentStatus;
  /** X position in visualization */
  x?: number;
  /** Y position in visualization */
  y?: number;
  /** Node size based on activity */
  size?: number;
  /** Node color based on status */
  color?: string;
  /** Additional data for tooltips */
  data?: Partial<AgentState>;
}

/**
 * Edge between agents in topology
 */
export interface AgentEdge {
  /** Unique edge ID */
  id: string;
  /** Source agent ID */
  source: string;
  /** Target agent ID */
  target: string;
  /** Edge weight (message frequency) */
  weight?: number;
  /** Edge label (relationship type) */
  label?: string;
  /** Whether this is a hierarchical edge */
  hierarchical?: boolean;
  /** Message count on this edge */
  messageCount?: number;
  /** Last message timestamp */
  lastMessage?: number;
}

/**
 * Summary statistics for all agents
 */
export interface AgentSummary {
  /** Total number of agents */
  total: number;
  /** Breakdown by status */
  byStatus: Record<AgentStatus, number>;
  /** Breakdown by type */
  byType: Record<AgentType | string, number>;
  /** Aggregate metrics */
  aggregateMetrics: {
    totalTasksCompleted: number;
    totalTasksFailed: number;
    avgCpuUsage: number;
    totalMemoryUsage: number;
    totalMessagesSent: number;
    totalMessagesReceived: number;
  };
}

/**
 * Agent filter for queries
 */
export interface AgentFilter {
  /** Filter by status */
  status?: AgentStatus[];
  /** Filter by type */
  types?: AgentType[];
  /** Filter by name search */
  search?: string;
  /** Filter by activity (active in last N ms) */
  activeWithin?: number;
}

/**
 * Icon mapping for agent types
 */
export const AGENT_TYPE_ICONS: Record<AgentType, string> = {
  coordinator: 'crown',
  coder: 'code',
  tester: 'flask',
  reviewer: 'eye',
  researcher: 'search',
  architect: 'blueprint',
  planner: 'calendar',
  security: 'shield',
  performance: 'gauge',
  memory: 'database',
  custom: 'puzzle',
};

/**
 * Text color classes for agent status
 */
export const STATUS_COLORS: Record<AgentStatus, string> = {
  spawning: 'text-status-spawning',
  active: 'text-status-active',
  idle: 'text-status-idle',
  busy: 'text-status-busy',
  error: 'text-status-error',
  stopped: 'text-gray-500',
};

/**
 * Background color classes for agent status
 */
export const STATUS_BG_COLORS: Record<AgentStatus, string> = {
  spawning: 'bg-status-spawning',
  active: 'bg-status-active',
  idle: 'bg-status-idle',
  busy: 'bg-status-busy',
  error: 'bg-status-error',
  stopped: 'bg-gray-500',
};

/**
 * Hex colors for agent status (for visualizations)
 */
export const STATUS_HEX_COLORS: Record<AgentStatus, string> = {
  spawning: '#8b5cf6',
  active: '#22c55e',
  idle: '#3b82f6',
  busy: '#f59e0b',
  error: '#ef4444',
  stopped: '#6b7280',
};
