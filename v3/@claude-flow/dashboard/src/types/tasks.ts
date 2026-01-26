/**
 * Task types for the Live Operations Dashboard
 * @module types/tasks
 */

/**
 * Possible states a task can be in
 */
export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

/**
 * Task status as enum for stricter typing
 */
export enum TaskStatusEnum {
  PENDING = 'pending',
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * Task priority levels
 */
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Task priority as enum for stricter typing
 */
export enum TaskPriorityEnum {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Task types/categories
 */
export type TaskType =
  | 'code_generation'
  | 'code_review'
  | 'testing'
  | 'refactoring'
  | 'research'
  | 'documentation'
  | 'analysis'
  | 'coordination'
  | 'security_scan'
  | 'performance_optimization'
  | 'custom';

/**
 * Task result/output
 */
export interface TaskResult {
  /** Whether the task succeeded */
  success: boolean;
  /** Result data */
  data: unknown;
  /** Files created or modified */
  artifacts?: TaskArtifact[];
  /** Execution logs */
  logs?: string[];
  /** Output metrics */
  metrics?: TaskResultMetrics;
}

/**
 * Artifact produced by a task
 */
export interface TaskArtifact {
  /** Artifact type */
  type: 'file' | 'code' | 'report' | 'data';
  /** Artifact path or identifier */
  path: string;
  /** Size in bytes */
  size: number;
  /** Content hash */
  hash?: string;
  /** MIME type */
  mimeType?: string;
}

/**
 * Metrics from task execution
 */
export interface TaskResultMetrics {
  /** Execution time in milliseconds */
  executionTime: number;
  /** Tokens used (input) */
  tokensInput?: number;
  /** Tokens used (output) */
  tokensOutput?: number;
  /** API calls made */
  apiCalls?: number;
  /** Memory operations performed */
  memoryOperations?: number;
}

/**
 * Error information for failed tasks
 */
export interface TaskError {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Stack trace if available */
  stack?: string;
  /** Retry count */
  retryCount?: number;
  /** Whether the error is retryable */
  retryable?: boolean;
}

/**
 * Task dependency
 */
export interface TaskDependency {
  /** Dependent task ID */
  taskId: string;
  /** Dependency type */
  type: 'blocking' | 'soft';
  /** Current status of the dependency */
  status?: TaskStatus;
}

/**
 * Full task state
 */
export interface TaskState {
  /** Unique task identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** Task status */
  status: TaskStatus;
  /** Task priority */
  priority: TaskPriority;
  /** Assigned agent ID */
  assignedAgentId?: string;
  /** Assigned agent name */
  assignedAgentName?: string;
  /** Progress percentage (0-100) */
  progress?: number;
  /** Current step description */
  currentStep?: string;
  /** Total steps */
  totalSteps?: number;
  /** Current step number */
  currentStepNumber?: number;
  /** Error message (if status is failed) */
  error?: string;
  /** Full error information */
  errorDetails?: TaskError;
  /** Task result (when completed) */
  result?: TaskResult;
  /** Task creation timestamp */
  createdAt: number;
  /** Task start timestamp */
  startTime?: number;
  /** Task end timestamp */
  endTime?: number;
  /** Task duration in milliseconds */
  duration?: number;
  /** Estimated remaining time in milliseconds */
  estimatedRemaining?: number;
  /** Task dependencies */
  dependencies?: string[] | TaskDependency[];
  /** Parent task ID for subtasks */
  parentId?: string;
  /** Subtask IDs */
  subtasks?: string[];
  /** Task tags/labels */
  tags?: string[];
  /** Task metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Task update event from WebSocket
 */
export interface TaskUpdateEvent {
  /** Event type discriminator */
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
  /** Event timestamp */
  timestamp: number;
}

/**
 * Task queue state
 */
export interface TaskQueue {
  /** Pending tasks */
  pending: TaskState[];
  /** In-progress tasks */
  inProgress: TaskState[];
  /** Recently completed tasks */
  completed: TaskState[];
  /** Failed tasks */
  failed: TaskState[];
  /** Queue statistics */
  stats: TaskQueueStats;
}

/**
 * Task queue statistics
 */
export interface TaskQueueStats {
  /** Total tasks in queue */
  totalTasks: number;
  /** Tasks by status */
  byStatus: Record<TaskStatus, number>;
  /** Tasks by priority */
  byPriority: Record<TaskPriority, number>;
  /** Average wait time in milliseconds */
  avgWaitTime: number;
  /** Average execution time in milliseconds */
  avgExecutionTime: number;
  /** Task completion rate (0-1) */
  completionRate: number;
  /** Tasks completed in last hour */
  throughputPerHour: number;
}

/**
 * Task assignment request
 */
export interface TaskAssignment {
  /** Task ID */
  taskId: string;
  /** Target agent ID */
  agentId: string;
  /** Assignment reason */
  reason?: string;
  /** Assignment timestamp */
  timestamp: number;
}

/**
 * Task filter for queries
 */
export interface TaskFilter {
  /** Filter by status */
  status: TaskStatus[];
  /** Filter by assigned agents */
  agents: string[];
  /** Filter by priority */
  priority: TaskPriority[];
  /** Filter by time range */
  timeRange?: {
    start: number;
    end: number;
  };
  /** Search in description */
  search?: string;
  /** Filter by tags */
  tags?: string[];
}

/**
 * Task view type
 */
export type TaskView = 'timeline' | 'kanban' | 'list';

/**
 * Background color classes for task status
 */
export const STATUS_TASK_COLORS: Record<TaskStatus, string> = {
  pending: 'bg-gray-500',
  assigned: 'bg-blue-500',
  in_progress: 'bg-amber-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  cancelled: 'bg-gray-400',
};

/**
 * Hex colors for task status (for visualizations)
 */
export const STATUS_TASK_HEX_COLORS: Record<TaskStatus, string> = {
  pending: '#6b7280',
  assigned: '#3b82f6',
  in_progress: '#f59e0b',
  completed: '#22c55e',
  failed: '#ef4444',
  cancelled: '#9ca3af',
};

/**
 * Text color classes for task priority
 */
export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'text-gray-400',
  normal: 'text-blue-400',
  high: 'text-amber-400',
  critical: 'text-red-400',
};

/**
 * Hex colors for task priority
 */
export const PRIORITY_HEX_COLORS: Record<TaskPriority, string> = {
  low: '#9ca3af',
  normal: '#60a5fa',
  high: '#fbbf24',
  critical: '#f87171',
};
