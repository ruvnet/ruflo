/**
 * Dashboard Stores - Zustand state management
 * Re-exports all stores and their types for easy consumption
 */

// Dashboard Store
export {
  useDashboardStore,
  useConnectionStatus,
  useSelectedView,
  useSelectedAgent,
  useSelectedTask,
  useDashboardSettings,
  type ConnectionStatus,
  type DashboardView,
  type DashboardSettings,
  type DashboardState,
} from './dashboardStore';

// Agent Store
export {
  useAgentStore,
  useAgents,
  useAgentOrder,
  useAgentCount,
  useAgentsArray,
  useAgent,
  type AgentStatus,
  type AgentType,
  type AgentHealth,
  type AgentMetrics,
  type AgentState,
  type AgentStoreState,
} from './agentStore';

// Task Store
export {
  useTaskStore,
  useTasks,
  useTaskOrder,
  useTaskHistory,
  useTaskCount,
  useTasksArray,
  useTask,
  useAgentTasks,
  priorityToNumber,
  numberToPriority,
  type TaskPriority,
  type TaskStatus,
  type TaskMetadata,
  type TaskResult,
  type TaskState,
  type TaskStoreState,
} from './taskStore';

// Message Store
export {
  useMessageStore,
  useMessages,
  useIsPaused,
  useMessageFilter,
  useMessageStats,
  useFilteredMessages,
  useRecentMessages,
  type MessageType,
  type MessageDirection,
  type Message,
  type MessageFilter,
  type MessageStats,
  type MessageStoreState,
} from './messageStore';

// Memory Store
export {
  useMemoryStore,
  useMemoryOperations,
  useMemoryFilter,
  useShowValues,
  useMemoryStats,
  useMemoryNamespaces,
  useFilteredOperations,
  useRecentOperations,
  useNamespaceOperations,
  type MemoryOperationType,
  type MemoryType,
  type OperationStatus,
  type MemoryOperation,
  type MemoryFilter,
  type MemoryStats,
  type NamespaceInfo,
  type MemoryStoreState,
} from './memoryStore';
