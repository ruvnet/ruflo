/**
 * Live Operations Dashboard Types
 * @module types
 *
 * Comprehensive TypeScript types for the Live Operations Dashboard,
 * providing type-safe interfaces for WebSocket events, agent management,
 * task orchestration, message passing, and memory operations.
 */

// ============================================================================
// Agent Types
// ============================================================================
export type {
  AgentStatus,
  AgentType,
  AgentMetrics,
  AgentState,
  AgentConfig,
  AgentError,
  AgentNode,
  AgentEdge,
  AgentSummary,
  AgentFilter,
  AgentStatusEvent,
} from './agents';

export {
  AgentStatusEnum,
  AgentTypeEnum,
  AGENT_TYPE_ICONS,
  STATUS_COLORS,
  STATUS_BG_COLORS,
  STATUS_HEX_COLORS,
} from './agents';

// ============================================================================
// Task Types
// ============================================================================
export type {
  TaskStatus,
  TaskPriority,
  TaskType,
  TaskResult,
  TaskArtifact,
  TaskResultMetrics,
  TaskError,
  TaskDependency,
  TaskState,
  TaskQueue,
  TaskQueueStats,
  TaskAssignment,
  TaskFilter,
  TaskView,
  TaskUpdateEvent,
} from './tasks';

export {
  TaskStatusEnum,
  TaskPriorityEnum,
  STATUS_TASK_COLORS,
  STATUS_TASK_HEX_COLORS,
  PRIORITY_COLORS,
  PRIORITY_HEX_COLORS,
} from './tasks';

// ============================================================================
// Message Types
// ============================================================================
export type {
  MessageType,
  MessageDirection,
  ExtendedMessageType,
  MessagePriority,
  MessageDeliveryStatus,
  TaskMessagePayload,
  ResultMessagePayload,
  QueryMessagePayload,
  ResponseMessagePayload,
  BroadcastMessagePayload,
  ConsensusMessagePayload,
  MessagePayload,
  Message,
  MessageEvent,
  MessageFlow,
  MessageStats,
  MessageFilter,
  MessageFilterState,
  MessageStoreState,
} from './messages';

export {
  MessageTypeEnum,
  MessagePriorityEnum,
  MessageDeliveryStatusEnum,
  MESSAGE_TYPE_COLORS,
  MESSAGE_TYPE_CSS_COLORS,
  MESSAGE_TYPE_LABELS,
  ALL_MESSAGE_TYPES,
  MESSAGE_DIRECTION_COLORS,
  MESSAGE_DIRECTION_LABELS,
  DEFAULT_MESSAGE_FILTER,
} from './messages';

// ============================================================================
// Memory Types
// ============================================================================
export type {
  MemoryOperationType,
  ExtendedMemoryOperationType,
  MemoryNamespaceString,
  MemoryMetadata,
  MemoryEntry,
  MemoryOperation,
  MemoryOperationEvent,
  VectorSearchQuery,
  VectorSearchResult,
  MemoryStats,
  MemoryConfig,
  NamespaceStats,
  MemoryFilters,
} from './memory';

export {
  OperationType,
  MemoryNamespace,
  OPERATION_TYPE_COLORS,
  OPERATION_TYPE_CSS_COLORS,
  OPERATION_TYPE_LABELS,
  ALL_MEMORY_OPERATIONS,
  DEFAULT_MEMORY_FILTERS,
} from './memory';

// ============================================================================
// Topology Types
// ============================================================================
export type {
  TopologyType,
  TopologyLayoutType,
  ConnectionHealth,
  EdgeHealth,
  NodeStatus,
  Connection,
  TopologyEdgeData,
  TopologyNodeData,
  SimulationNodeDatum,
  SimulationLinkDatum,
  MessageParticleData,
  Position,
  TopologyState,
  LiveTopologyState,
  TopologyChangeEvent,
  LayoutType,
  TopologyLayout,
  UseTopologyReturn,
  TopologyControlsProps,
  AnimatedEdgeProps,
  MessageParticleProps,
  LiveTopologyProps,
} from './topology';

export {
  HEALTH_COLORS,
  EDGE_HEALTH_HEX,
  NODE_STATUS_HEX,
  MESSAGE_TYPE_HEX,
  TOPOLOGY_DESCRIPTIONS,
  getStatusColor,
  getHealthColor,
  getMessageTypeColor,
} from './topology';

// ============================================================================
// Event Types
// ============================================================================
export type {
  ConnectionStatus,
  EventType,
  BaseEvent,
  SystemMetrics,
  AgentMetricsAggregate,
  TaskMetricsAggregate,
  MemoryMetricsAggregate,
  MetricsUpdateEvent,
  ErrorEvent,
  ConnectionEvent,
  SwarmEvent,
  ConsensusEvent,
  SubscribedEvent,
  PongEvent,
  DashboardEvent,
  EventFilter,
  EventSubscription,
  SubscribeMessage,
  UnsubscribeMessage,
  PingMessage,
  ReplayMessage,
  ClientMessage,
} from './events';

// ============================================================================
// Dashboard Configuration
// ============================================================================

/**
 * Dashboard configuration options
 */
export interface DashboardConfig {
  // WebSocket
  /** WebSocket server URL */
  wsUrl: string;
  /** Maximum reconnection attempts */
  reconnectMaxAttempts: number;
  /** Base delay for reconnection (ms) */
  reconnectBaseDelay: number;
  /** Heartbeat/ping interval (ms) */
  heartbeatInterval: number;

  // Display
  /** Maximum messages to keep in memory */
  maxMessages: number;
  /** Maximum memory operations to keep */
  maxMemoryOps: number;
  /** Throttle interval for updates (ms) */
  updateThrottleMs: number;

  // Features
  /** Show full message content */
  enableMessageContent: boolean;
  /** Show full memory values */
  enableMemoryValues: boolean;
  /** Auto-scroll message lists */
  autoScroll: boolean;
}

/**
 * Default dashboard configuration
 */
export const DEFAULT_CONFIG: DashboardConfig = {
  wsUrl: 'ws://localhost:3001',
  reconnectMaxAttempts: 10,
  reconnectBaseDelay: 1000,
  heartbeatInterval: 30000,
  maxMessages: 1000,
  maxMemoryOps: 1000,
  updateThrottleMs: 16,
  enableMessageContent: true,
  enableMemoryValues: true,
  autoScroll: true,
};

/**
 * Dashboard view types
 */
export type DashboardView = 'overview' | 'agents' | 'tasks' | 'messages' | 'memory' | 'topology';

/**
 * All dashboard views
 */
export const ALL_DASHBOARD_VIEWS: DashboardView[] = [
  'overview',
  'agents',
  'tasks',
  'messages',
  'memory',
  'topology',
];

/**
 * Dashboard view labels
 */
export const DASHBOARD_VIEW_LABELS: Record<DashboardView, string> = {
  overview: 'Overview',
  agents: 'Agents',
  tasks: 'Tasks',
  messages: 'Messages',
  memory: 'Memory',
  topology: 'Topology',
};

/**
 * Keyboard shortcut definition
 */
export interface KeyboardShortcut {
  key: string;
  description: string;
  modifiers?: ('ctrl' | 'alt' | 'shift' | 'meta')[];
}

/**
 * Keyboard shortcuts
 */
export const KEYBOARD_SHORTCUTS: Record<string, KeyboardShortcut> = {
  switchAgents: { key: '1', description: 'Switch to Agents view' },
  switchTasks: { key: '2', description: 'Switch to Tasks view' },
  switchMessages: { key: '3', description: 'Switch to Messages view' },
  switchMemory: { key: '4', description: 'Switch to Memory view' },
  switchTopology: { key: '5', description: 'Switch to Topology view' },
  togglePause: { key: 'Space', description: 'Pause/resume message stream' },
  closePanel: { key: 'Escape', description: 'Close detail panel' },
  focusSearch: { key: '/', description: 'Focus search input' },
  showHelp: { key: '?', description: 'Show keyboard shortcuts' },
  refresh: { key: 'r', description: 'Refresh data' },
  toggleFullscreen: { key: 'f', description: 'Toggle fullscreen' },
};

// ============================================================================
// Namespace Re-exports for Convenience
// ============================================================================

export * as AgentTypes from './agents';
export * as TaskTypes from './tasks';
export * as MessageTypes from './messages';
export * as MemoryTypes from './memory';
export * as TopologyTypes from './topology';
export * as EventTypes from './events';
