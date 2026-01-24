/**
 * @claude-flow/memory - Beads Integration Types
 *
 * Type definitions for integrating with Beads (@beads/bd) - a git-backed
 * task tracker for AI agents that provides persistent memory across sessions.
 *
 * @module @claude-flow/memory/beads-types
 */

// ===== Core Task Types =====

/**
 * Task status values matching Beads conventions
 */
export type BeadsTaskStatus = 'open' | 'in_progress' | 'review' | 'closed' | 'blocked';

/**
 * Task priority levels
 */
export type BeadsTaskPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Issue type classification
 */
export type BeadsIssueType =
  | 'task'
  | 'bug'
  | 'feature'
  | 'epic'
  | 'story'
  | 'spike'
  | 'chore';

/**
 * Core Beads task structure
 *
 * Tasks have three key fields:
 * - description: Implementation mechanics (steps, snippets, file paths, commands)
 * - design: Architectural context (goals, decisions, data flow, constraints)
 * - notes: Reference fallback (source document paths with line numbers)
 */
export interface BeadsTask {
  /** Unique task identifier */
  id: string;

  /** Human-readable task title */
  title: string;

  /** Current task status */
  status: BeadsTaskStatus;

  /** Issue type classification */
  type: BeadsIssueType;

  /**
   * Implementation mechanics
   * Contains: steps, code snippets, file paths, commands
   */
  description: string;

  /**
   * Architectural context
   * Contains: goals, decisions, data flow, constraints
   */
  design: string;

  /**
   * Reference fallback
   * Contains: source document paths with line numbers
   */
  notes: string;

  /** Task IDs this task depends on */
  dependsOn: string[];

  /** Computed: task IDs blocking this task */
  blockedBy: string[];

  /** Parent epic ID (if part of an epic) */
  epic?: string;

  /** Assigned agent or user */
  assignee?: string;

  /** Task priority */
  priority: BeadsTaskPriority;

  /** Tags for categorization */
  tags: string[];

  /** Files modified by this task */
  files: string[];

  /** Creation timestamp (ms since epoch) */
  createdAt: number;

  /** Last update timestamp (ms since epoch) */
  updatedAt: number;

  /** Closure timestamp (ms since epoch) */
  closedAt?: number;

  /** Reason for closing */
  closeReason?: string;

  /** Additional metadata */
  metadata: Record<string, unknown>;
}

/**
 * Input for creating a new task
 */
export interface BeadsTaskInput {
  title: string;
  type?: BeadsIssueType;
  description?: string;
  design?: string;
  notes?: string;
  dependsOn?: string[];
  epic?: string;
  assignee?: string;
  priority?: BeadsTaskPriority;
  tags?: string[];
  files?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Partial update for a task
 */
export interface BeadsTaskUpdate {
  title?: string;
  status?: BeadsTaskStatus;
  description?: string;
  design?: string;
  notes?: string;
  dependsOn?: string[];
  assignee?: string;
  priority?: BeadsTaskPriority;
  tags?: string[];
  files?: string[];
  metadata?: Record<string, unknown>;
}

// ===== Epic Types =====

/**
 * Epic status - computed from child tasks
 */
export type BeadsEpicStatus = 'not_started' | 'in_progress' | 'review' | 'completed';

/**
 * Epic structure (collection of related tasks)
 */
export interface BeadsEpic {
  /** Unique epic identifier */
  id: string;

  /** Epic title */
  title: string;

  /** Epic description */
  description: string;

  /** Computed status based on tasks */
  status: BeadsEpicStatus;

  /** Child task IDs */
  tasks: string[];

  /** Completion percentage (0-100) */
  progress: number;

  /** Total task count */
  totalTasks: number;

  /** Completed task count */
  completedTasks: number;

  /** Blocked task count */
  blockedTasks: number;

  /** Creation timestamp */
  createdAt: number;

  /** Last update timestamp */
  updatedAt: number;

  /** Completion timestamp */
  completedAt?: number;

  /** Additional metadata */
  metadata: Record<string, unknown>;
}

/**
 * Input for creating a new epic
 */
export interface BeadsEpicInput {
  title: string;
  description?: string;
  tasks?: BeadsTaskInput[];
  metadata?: Record<string, unknown>;
}

// ===== Query Types =====

/**
 * Query filters for tasks
 */
export interface BeadsTaskQuery {
  /** Filter by status */
  status?: BeadsTaskStatus | BeadsTaskStatus[];

  /** Filter by type */
  type?: BeadsIssueType | BeadsIssueType[];

  /** Filter by epic */
  epic?: string;

  /** Filter by assignee */
  assignee?: string;

  /** Filter by priority */
  priority?: BeadsTaskPriority | BeadsTaskPriority[];

  /** Filter by tags (any match) */
  tags?: string[];

  /** Filter by files (any match) */
  files?: string[];

  /** Text search in title/description */
  search?: string;

  /** Only include ready (unblocked) tasks */
  ready?: boolean;

  /** Only include blocked tasks */
  blocked?: boolean;

  /** Maximum results */
  limit?: number;

  /** Result offset */
  offset?: number;

  /** Sort field */
  sortBy?: 'createdAt' | 'updatedAt' | 'priority' | 'title';

  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

// ===== Dependency Types =====

/**
 * Dependency edge in the task graph
 */
export interface BeadsDependency {
  /** Source task ID (depends on target) */
  from: string;

  /** Target task ID (dependency) */
  to: string;

  /** Dependency type */
  type: 'explicit' | 'file_overlap' | 'inferred';

  /** Files causing overlap (if type is file_overlap) */
  overlappingFiles?: string[];
}

/**
 * Dependency resolution result
 */
export interface BeadsDependencyResult {
  /** Task ID */
  taskId: string;

  /** All dependencies (direct and transitive) */
  dependencies: string[];

  /** Tasks that depend on this one */
  dependents: string[];

  /** Whether task is blocked */
  isBlocked: boolean;

  /** Blocking task IDs */
  blockedBy: string[];

  /** Execution order index */
  orderIndex: number;
}

// ===== Sync Types =====

/**
 * Sync direction
 */
export type BeadsSyncDirection = 'to_beads' | 'from_beads' | 'bidirectional';

/**
 * Sync result
 */
export interface BeadsSyncResult {
  /** Sync direction performed */
  direction: BeadsSyncDirection;

  /** Tasks synced to beads */
  pushedTasks: number;

  /** Tasks synced from beads */
  pulledTasks: number;

  /** Conflicts detected */
  conflicts: BeadsSyncConflict[];

  /** Sync timestamp */
  syncedAt: number;

  /** Duration in ms */
  duration: number;
}

/**
 * Sync conflict
 */
export interface BeadsSyncConflict {
  /** Task ID with conflict */
  taskId: string;

  /** Conflict type */
  type: 'update_conflict' | 'delete_conflict' | 'create_conflict';

  /** Local version */
  local: BeadsTask | null;

  /** Remote (beads) version */
  remote: BeadsTask | null;

  /** Resolution strategy applied */
  resolution?: 'local_wins' | 'remote_wins' | 'manual';
}

// ===== Adapter Configuration =====

/**
 * Beads adapter configuration
 */
export interface BeadsAdapterConfig {
  /** Path to .beads directory (default: ./.beads) */
  beadsPath?: string;

  /** Path to beads SQLite database */
  databasePath?: string;

  /** Enable automatic sync on operations */
  autoSync?: boolean;

  /** Sync direction for auto-sync */
  syncDirection?: BeadsSyncDirection;

  /** Sync interval in ms (0 = disabled) */
  syncInterval?: number;

  /** Enable file overlap detection for dependencies */
  detectFileOverlap?: boolean;

  /** Default namespace for memory entries */
  namespace?: string;

  /** Enable caching */
  cacheEnabled?: boolean;

  /** Cache TTL in ms */
  cacheTtl?: number;

  /** Maximum cached entries */
  cacheSize?: number;
}

/**
 * Default adapter configuration
 */
export const DEFAULT_BEADS_CONFIG: Required<BeadsAdapterConfig> = {
  beadsPath: '.beads',
  databasePath: '.beads/beads.db',
  autoSync: true,
  syncDirection: 'bidirectional',
  syncInterval: 0,
  detectFileOverlap: true,
  namespace: 'beads',
  cacheEnabled: true,
  cacheTtl: 60000, // 1 minute
  cacheSize: 1000,
};

// ===== Event Types =====

/**
 * Beads event types
 */
export type BeadsEventType =
  | 'task:created'
  | 'task:updated'
  | 'task:closed'
  | 'task:blocked'
  | 'task:unblocked'
  | 'epic:created'
  | 'epic:updated'
  | 'epic:completed'
  | 'sync:started'
  | 'sync:completed'
  | 'sync:failed'
  | 'sync:conflict';

/**
 * Beads event payload
 */
export interface BeadsEvent {
  type: BeadsEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

/**
 * Beads event handler
 */
export type BeadsEventHandler = (event: BeadsEvent) => void | Promise<void>;

// ===== Statistics Types =====

/**
 * Beads adapter statistics
 */
export interface BeadsStats {
  /** Total task count */
  totalTasks: number;

  /** Tasks by status */
  tasksByStatus: Record<BeadsTaskStatus, number>;

  /** Tasks by type */
  tasksByType: Record<BeadsIssueType, number>;

  /** Tasks by priority */
  tasksByPriority: Record<BeadsTaskPriority, number>;

  /** Total epic count */
  totalEpics: number;

  /** Epics by status */
  epicsByStatus: Record<BeadsEpicStatus, number>;

  /** Average tasks per epic */
  avgTasksPerEpic: number;

  /** Total dependencies */
  totalDependencies: number;

  /** Blocked task count */
  blockedTasks: number;

  /** Last sync timestamp */
  lastSyncAt?: number;

  /** Cache hit rate */
  cacheHitRate?: number;
}

// ===== Utility Functions =====

/**
 * Generate a unique beads task ID
 */
export function generateBeadsId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `bd_${timestamp}_${random}`;
}

/**
 * Create a default task from input
 */
export function createDefaultTask(input: BeadsTaskInput): BeadsTask {
  const now = Date.now();
  return {
    id: generateBeadsId(),
    title: input.title,
    status: 'open',
    type: input.type || 'task',
    description: input.description || '',
    design: input.design || '',
    notes: input.notes || '',
    dependsOn: input.dependsOn || [],
    blockedBy: [],
    epic: input.epic,
    assignee: input.assignee,
    priority: input.priority || 'medium',
    tags: input.tags || [],
    files: input.files || [],
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata || {},
  };
}

/**
 * Compute epic status from tasks
 */
export function computeEpicStatus(tasks: BeadsTask[]): BeadsEpicStatus {
  if (tasks.length === 0) return 'not_started';

  const statuses = tasks.map((t) => t.status);
  const allClosed = statuses.every((s) => s === 'closed');
  const anyInProgress = statuses.some((s) => s === 'in_progress' || s === 'review');
  const anyOpen = statuses.some((s) => s === 'open');

  if (allClosed) return 'completed';
  if (anyInProgress) return 'in_progress';
  if (anyOpen) return 'not_started';
  return 'in_progress';
}

/**
 * Calculate epic progress percentage
 */
export function calculateEpicProgress(tasks: BeadsTask[]): number {
  if (tasks.length === 0) return 0;
  const completed = tasks.filter((t) => t.status === 'closed').length;
  return Math.round((completed / tasks.length) * 100);
}

/**
 * Priority sort value (higher = more important)
 */
export function priorityValue(priority: BeadsTaskPriority): number {
  const values: Record<BeadsTaskPriority, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  return values[priority];
}
