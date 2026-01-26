/**
 * Task Store - Task state management
 * Manages task lifecycle with history tracking
 */

import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';

/**
 * Task priority levels
 */
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Task status throughout its lifecycle
 */
export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'assigned'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

/**
 * Task metadata
 */
export interface TaskMetadata {
  requiredCapabilities?: string[];
  retryCount?: number;
  maxRetries?: number;
  critical?: boolean;
  parentTaskId?: string;
  childTaskIds?: string[];
  tags?: string[];
  deadline?: Date;
  estimatedDuration?: number;
  source?: string;
  [key: string]: unknown;
}

/**
 * Task result after completion
 */
export interface TaskResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
  duration: number;
  metrics?: {
    tokensUsed?: number;
    memoryPeakMb?: number;
    retryCount?: number;
  };
}

/**
 * Task state representation
 */
export interface TaskState {
  id: string;
  type: string;
  description: string;
  priority: number;
  status: TaskStatus;

  // Assignment
  assignedAgent?: string;

  // Timestamps
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;

  // Timeout configuration
  timeout?: number;

  // Input/Output
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;

  // Result
  result?: TaskResult;

  // Metadata
  metadata?: TaskMetadata;
}

/**
 * Maximum history size
 */
const MAX_HISTORY_SIZE = 500;

/**
 * Task store state shape
 */
export interface TaskStoreState {
  // State
  tasks: Map<string, TaskState>;
  taskOrder: string[]; // For maintaining display order
  taskHistory: TaskState[]; // Completed/failed tasks

  // Loading state
  isLoading: boolean;
  lastUpdated: Date | null;

  // Actions
  addTask: (task: TaskState) => void;
  updateTask: (taskId: string, updates: Partial<TaskState>) => void;
  removeTask: (taskId: string) => void;
  moveToHistory: (taskId: string) => void;
  clearTasks: () => void;
  clearHistory: () => void;
  setTasks: (tasks: TaskState[]) => void;

  // Selectors (as actions for easier use)
  getTaskById: (taskId: string) => TaskState | undefined;
  getTasksByAgent: (agentId: string) => TaskState[];
  getTasksByStatus: (status: TaskStatus) => TaskState[];
  getTasksByPriority: (priority: TaskPriority | number) => TaskState[];
  getPendingTasks: () => TaskState[];
  getRunningTasks: () => TaskState[];
  getTaskCount: () => number;
}

/**
 * Convert priority label to number
 */
export const priorityToNumber = (priority: TaskPriority | number): number => {
  if (typeof priority === 'number') {
    return Math.max(0, Math.min(100, priority));
  }
  switch (priority) {
    case 'critical': return 100;
    case 'high': return 75;
    case 'medium': return 50;
    case 'low': return 25;
    default: return 50;
  }
};

/**
 * Convert priority number to label
 */
export const numberToPriority = (value: number): TaskPriority => {
  if (value >= 90) return 'critical';
  if (value >= 70) return 'high';
  if (value >= 40) return 'medium';
  return 'low';
};

/**
 * Check if task is terminal (completed, failed, cancelled, timeout)
 */
const isTerminalStatus = (status: TaskStatus): boolean => {
  return ['completed', 'failed', 'cancelled', 'timeout'].includes(status);
};

/**
 * Task Zustand store
 */
export const useTaskStore = create<TaskStoreState>()(
  devtools(
    subscribeWithSelector((set, get) => ({
      // Initial state
      tasks: new Map(),
      taskOrder: [],
      taskHistory: [],
      isLoading: false,
      lastUpdated: null,

      // Actions
      addTask: (task) =>
        set(
          (state) => {
            const newTasks = new Map(state.tasks);
            newTasks.set(task.id, task);
            const newOrder = state.taskOrder.includes(task.id)
              ? state.taskOrder
              : [...state.taskOrder, task.id];
            return {
              tasks: newTasks,
              taskOrder: newOrder,
              lastUpdated: new Date(),
            };
          },
          false,
          'addTask'
        ),

      updateTask: (taskId, updates) =>
        set(
          (state) => {
            const existing = state.tasks.get(taskId);
            if (!existing) return state;

            const updated = { ...existing, ...updates };
            const newTasks = new Map(state.tasks);
            newTasks.set(taskId, updated);

            // Auto-move to history if status became terminal
            if (updates.status && isTerminalStatus(updates.status)) {
              const completedTask = { ...updated, completedAt: new Date() };
              newTasks.delete(taskId);
              const newHistory = [completedTask, ...state.taskHistory].slice(0, MAX_HISTORY_SIZE);
              return {
                tasks: newTasks,
                taskOrder: state.taskOrder.filter((id) => id !== taskId),
                taskHistory: newHistory,
                lastUpdated: new Date(),
              };
            }

            return {
              tasks: newTasks,
              lastUpdated: new Date(),
            };
          },
          false,
          'updateTask'
        ),

      removeTask: (taskId) =>
        set(
          (state) => {
            const newTasks = new Map(state.tasks);
            newTasks.delete(taskId);
            return {
              tasks: newTasks,
              taskOrder: state.taskOrder.filter((id) => id !== taskId),
              lastUpdated: new Date(),
            };
          },
          false,
          'removeTask'
        ),

      moveToHistory: (taskId) =>
        set(
          (state) => {
            const task = state.tasks.get(taskId);
            if (!task) return state;

            const newTasks = new Map(state.tasks);
            newTasks.delete(taskId);

            const historyTask = { ...task, completedAt: task.completedAt ?? new Date() };
            const newHistory = [historyTask, ...state.taskHistory].slice(0, MAX_HISTORY_SIZE);

            return {
              tasks: newTasks,
              taskOrder: state.taskOrder.filter((id) => id !== taskId),
              taskHistory: newHistory,
              lastUpdated: new Date(),
            };
          },
          false,
          'moveToHistory'
        ),

      clearTasks: () =>
        set(
          {
            tasks: new Map(),
            taskOrder: [],
            lastUpdated: new Date(),
          },
          false,
          'clearTasks'
        ),

      clearHistory: () =>
        set(
          {
            taskHistory: [],
            lastUpdated: new Date(),
          },
          false,
          'clearHistory'
        ),

      setTasks: (tasks) =>
        set(
          () => {
            const newTasks = new Map<string, TaskState>();
            const order: string[] = [];
            const history: TaskState[] = [];

            for (const task of tasks) {
              if (isTerminalStatus(task.status)) {
                history.push(task);
              } else {
                newTasks.set(task.id, task);
                order.push(task.id);
              }
            }

            return {
              tasks: newTasks,
              taskOrder: order,
              taskHistory: history.slice(0, MAX_HISTORY_SIZE),
              lastUpdated: new Date(),
            };
          },
          false,
          'setTasks'
        ),

      // Selector actions
      getTaskById: (taskId) => {
        const task = get().tasks.get(taskId);
        if (task) return task;
        // Check history
        return get().taskHistory.find((t) => t.id === taskId);
      },

      getTasksByAgent: (agentId) => {
        const result: TaskState[] = [];
        for (const task of get().tasks.values()) {
          if (task.assignedAgent === agentId) {
            result.push(task);
          }
        }
        return result;
      },

      getTasksByStatus: (status) => {
        const result: TaskState[] = [];
        for (const task of get().tasks.values()) {
          if (task.status === status) {
            result.push(task);
          }
        }
        return result;
      },

      getTasksByPriority: (priority) => {
        const targetPriority = priorityToNumber(priority);
        const result: TaskState[] = [];
        for (const task of get().tasks.values()) {
          if (task.priority >= targetPriority) {
            result.push(task);
          }
        }
        return result;
      },

      getPendingTasks: () => {
        const result: TaskState[] = [];
        for (const task of get().tasks.values()) {
          if (task.status === 'pending' || task.status === 'queued') {
            result.push(task);
          }
        }
        return result;
      },

      getRunningTasks: () => {
        const result: TaskState[] = [];
        for (const task of get().tasks.values()) {
          if (task.status === 'running' || task.status === 'assigned') {
            result.push(task);
          }
        }
        return result;
      },

      getTaskCount: () => get().tasks.size,
    })),
    { name: 'TaskStore' }
  )
);

/**
 * Selector hooks for optimized re-renders
 */
export const useTasks = () => useTaskStore((state) => state.tasks);
export const useTaskOrder = () => useTaskStore((state) => state.taskOrder);
export const useTaskHistory = () => useTaskStore((state) => state.taskHistory);
export const useTaskCount = () => useTaskStore((state) => state.tasks.size);

/**
 * Get tasks as array (sorted by order)
 */
export const useTasksArray = (): TaskState[] => {
  const tasks = useTaskStore((state) => state.tasks);
  const order = useTaskStore((state) => state.taskOrder);
  return order.map((id) => tasks.get(id)).filter((t): t is TaskState => t !== undefined);
};

/**
 * Get task by ID with reactive updates
 */
export const useTask = (taskId: string): TaskState | undefined => {
  return useTaskStore((state) => state.tasks.get(taskId) ?? state.taskHistory.find((t) => t.id === taskId));
};

/**
 * Get tasks for a specific agent
 */
export const useAgentTasks = (agentId: string): TaskState[] => {
  const tasks = useTaskStore((state) => state.tasks);
  const result: TaskState[] = [];
  for (const task of tasks.values()) {
    if (task.assignedAgent === agentId) {
      result.push(task);
    }
  }
  return result;
};
