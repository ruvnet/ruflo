/**
 * @claude-flow/memory - Beads Memory Adapter
 *
 * Bridges Claude-Flow's memory system with Beads (@beads/bd) - a git-backed
 * task tracker for AI agents. Provides persistent task state that survives
 * across sessions.
 *
 * @module @claude-flow/memory/beads-adapter
 *
 * @example
 * ```typescript
 * import { BeadsMemoryAdapter } from '@claude-flow/memory';
 *
 * const adapter = new BeadsMemoryAdapter({
 *   beadsPath: '.beads',
 *   autoSync: true,
 * });
 *
 * await adapter.initialize();
 *
 * // Create a task
 * const task = await adapter.createTask({
 *   title: 'Implement authentication',
 *   type: 'feature',
 *   description: 'Add OAuth2 support',
 *   design: 'Use passport.js strategy pattern',
 * });
 *
 * // Get ready tasks
 * const ready = await adapter.getReadyTasks();
 *
 * // Close a task
 * await adapter.closeTask(task.id, 'Completed implementation');
 * ```
 */

import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  BeadsTask,
  BeadsTaskInput,
  BeadsTaskUpdate,
  BeadsTaskQuery,
  BeadsTaskStatus,
  BeadsEpic,
  BeadsEpicInput,
  BeadsDependency,
  BeadsDependencyResult,
  BeadsSyncResult,
  BeadsSyncConflict,
  BeadsAdapterConfig,
  BeadsEvent,
  BeadsEventHandler,
  BeadsStats,
  DEFAULT_BEADS_CONFIG,
  generateBeadsId,
  createDefaultTask,
  computeEpicStatus,
  calculateEpicProgress,
  priorityValue,
} from './beads-types.js';

/**
 * Beads Memory Adapter
 *
 * Provides bidirectional synchronization between Claude-Flow memory
 * and Beads' git-backed task storage.
 */
export class BeadsMemoryAdapter extends EventEmitter {
  private config: Required<BeadsAdapterConfig>;
  private tasks: Map<string, BeadsTask> = new Map();
  private epics: Map<string, BeadsEpic> = new Map();
  private dependencies: BeadsDependency[] = [];
  private initialized: boolean = false;
  private syncTimer?: ReturnType<typeof setInterval>;
  private cache: Map<string, { data: unknown; expiresAt: number }> = new Map();
  private stats: {
    cacheHits: number;
    cacheMisses: number;
    lastSyncAt?: number;
  } = { cacheHits: 0, cacheMisses: 0 };

  constructor(config: BeadsAdapterConfig = {}) {
    super();
    this.config = { ...DEFAULT_BEADS_CONFIG, ...config };
  }

  // ===== Lifecycle =====

  /**
   * Initialize the adapter
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure beads directory exists
    if (!existsSync(this.config.beadsPath)) {
      mkdirSync(this.config.beadsPath, { recursive: true });
    }

    // Load existing data
    await this.loadFromBeads();

    // Start sync timer if configured
    if (this.config.syncInterval > 0) {
      this.syncTimer = setInterval(
        () => this.sync(),
        this.config.syncInterval
      );
    }

    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Shutdown the adapter
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    // Clear sync timer
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }

    // Final sync
    if (this.config.autoSync) {
      await this.syncToBeads();
    }

    this.initialized = false;
    this.emit('shutdown');
  }

  // ===== Task Operations =====

  /**
   * Create a new task
   */
  async createTask(input: BeadsTaskInput): Promise<BeadsTask> {
    const task = createDefaultTask(input);
    this.tasks.set(task.id, task);

    // Update dependencies
    if (input.dependsOn?.length) {
      for (const depId of input.dependsOn) {
        this.dependencies.push({
          from: task.id,
          to: depId,
          type: 'explicit',
        });
      }
      this.updateBlockedBy(task.id);
    }

    // Auto-detect file overlap dependencies
    if (this.config.detectFileOverlap && input.files?.length) {
      await this.detectFileOverlapDependencies(task);
    }

    // Add to epic if specified
    if (input.epic) {
      const epic = this.epics.get(input.epic);
      if (epic && !epic.tasks.includes(task.id)) {
        epic.tasks.push(task.id);
        this.updateEpicStatus(input.epic);
      }
    }

    // Auto-sync
    if (this.config.autoSync) {
      await this.saveTaskToBeads(task);
    }

    this.emitEvent('task:created', { task });
    return task;
  }

  /**
   * Get a task by ID
   */
  async getTask(id: string): Promise<BeadsTask | null> {
    // Check cache
    const cached = this.getFromCache<BeadsTask>(`task:${id}`);
    if (cached) return cached;

    const task = this.tasks.get(id) || null;
    if (task) {
      this.setCache(`task:${id}`, task);
    }
    return task;
  }

  /**
   * Update a task
   */
  async updateTask(id: string, update: BeadsTaskUpdate): Promise<BeadsTask | null> {
    const task = this.tasks.get(id);
    if (!task) return null;

    const wasBlocked = task.blockedBy.length > 0;

    // Apply updates
    Object.assign(task, {
      ...update,
      updatedAt: Date.now(),
    });

    // Update dependencies if changed
    if (update.dependsOn !== undefined) {
      // Remove old dependencies
      this.dependencies = this.dependencies.filter(
        (d) => d.from !== id || d.type !== 'explicit'
      );
      // Add new dependencies
      for (const depId of update.dependsOn) {
        this.dependencies.push({
          from: id,
          to: depId,
          type: 'explicit',
        });
      }
      this.updateBlockedBy(id);
    }

    // Check if blocked status changed
    const isBlocked = task.blockedBy.length > 0;
    if (wasBlocked && !isBlocked) {
      this.emitEvent('task:unblocked', { task });
    } else if (!wasBlocked && isBlocked) {
      this.emitEvent('task:blocked', { task, blockedBy: task.blockedBy });
    }

    // Invalidate cache
    this.invalidateCache(`task:${id}`);

    // Auto-sync
    if (this.config.autoSync) {
      await this.saveTaskToBeads(task);
    }

    this.emitEvent('task:updated', { task });
    return task;
  }

  /**
   * Close a task
   */
  async closeTask(id: string, reason: string): Promise<BeadsTask | null> {
    const task = this.tasks.get(id);
    if (!task) return null;

    task.status = 'closed';
    task.closedAt = Date.now();
    task.closeReason = reason;
    task.updatedAt = Date.now();

    // Unblock dependent tasks
    for (const dep of this.dependencies.filter((d) => d.to === id)) {
      this.updateBlockedBy(dep.from);
    }

    // Update epic status
    if (task.epic) {
      this.updateEpicStatus(task.epic);
    }

    // Invalidate cache
    this.invalidateCache(`task:${id}`);

    // Auto-sync
    if (this.config.autoSync) {
      await this.saveTaskToBeads(task);
    }

    this.emitEvent('task:closed', { task, reason });
    return task;
  }

  /**
   * Delete a task
   */
  async deleteTask(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) return false;

    // Remove from epic
    if (task.epic) {
      const epic = this.epics.get(task.epic);
      if (epic) {
        epic.tasks = epic.tasks.filter((t) => t !== id);
        this.updateEpicStatus(task.epic);
      }
    }

    // Remove dependencies
    this.dependencies = this.dependencies.filter(
      (d) => d.from !== id && d.to !== id
    );

    // Remove task
    this.tasks.delete(id);

    // Invalidate cache
    this.invalidateCache(`task:${id}`);

    // Auto-sync (delete file)
    if (this.config.autoSync) {
      await this.deleteTaskFromBeads(id);
    }

    return true;
  }

  /**
   * Query tasks
   */
  async queryTasks(query: BeadsTaskQuery = {}): Promise<BeadsTask[]> {
    let results = Array.from(this.tasks.values());

    // Apply filters
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      results = results.filter((t) => statuses.includes(t.status));
    }

    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      results = results.filter((t) => types.includes(t.type));
    }

    if (query.epic) {
      results = results.filter((t) => t.epic === query.epic);
    }

    if (query.assignee) {
      results = results.filter((t) => t.assignee === query.assignee);
    }

    if (query.priority) {
      const priorities = Array.isArray(query.priority)
        ? query.priority
        : [query.priority];
      results = results.filter((t) => priorities.includes(t.priority));
    }

    if (query.tags?.length) {
      results = results.filter((t) =>
        query.tags!.some((tag) => t.tags.includes(tag))
      );
    }

    if (query.files?.length) {
      results = results.filter((t) =>
        query.files!.some((file) => t.files.includes(file))
      );
    }

    if (query.search) {
      const searchLower = query.search.toLowerCase();
      results = results.filter(
        (t) =>
          t.title.toLowerCase().includes(searchLower) ||
          t.description.toLowerCase().includes(searchLower)
      );
    }

    if (query.ready) {
      results = results.filter(
        (t) => t.blockedBy.length === 0 && t.status !== 'closed'
      );
    }

    if (query.blocked) {
      results = results.filter((t) => t.blockedBy.length > 0);
    }

    // Sort
    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder || 'desc';
    results.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      if (sortBy === 'priority') {
        aVal = priorityValue(a.priority);
        bVal = priorityValue(b.priority);
      } else if (sortBy === 'title') {
        aVal = a.title.toLowerCase();
        bVal = b.title.toLowerCase();
      } else {
        aVal = a[sortBy];
        bVal = b[sortBy];
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    // Pagination
    const offset = query.offset || 0;
    const limit = query.limit || results.length;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /**
   * Get ready (unblocked) tasks
   */
  async getReadyTasks(epicId?: string): Promise<BeadsTask[]> {
    return this.queryTasks({
      epic: epicId,
      ready: true,
      status: ['open', 'in_progress'],
    });
  }

  /**
   * Get blocked tasks
   */
  async getBlockedTasks(epicId?: string): Promise<BeadsTask[]> {
    return this.queryTasks({
      epic: epicId,
      blocked: true,
    });
  }

  // ===== Epic Operations =====

  /**
   * Create a new epic
   */
  async createEpic(input: BeadsEpicInput): Promise<BeadsEpic> {
    const now = Date.now();
    const epic: BeadsEpic = {
      id: generateBeadsId(),
      title: input.title,
      description: input.description || '',
      status: 'not_started',
      tasks: [],
      progress: 0,
      totalTasks: 0,
      completedTasks: 0,
      blockedTasks: 0,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata || {},
    };

    this.epics.set(epic.id, epic);

    // Create tasks if provided
    if (input.tasks?.length) {
      for (const taskInput of input.tasks) {
        await this.createTask({ ...taskInput, epic: epic.id });
      }
      this.updateEpicStatus(epic.id);
    }

    // Auto-sync
    if (this.config.autoSync) {
      await this.saveEpicToBeads(epic);
    }

    this.emitEvent('epic:created', { epic });
    return epic;
  }

  /**
   * Get an epic by ID
   */
  async getEpic(id: string): Promise<BeadsEpic | null> {
    return this.epics.get(id) || null;
  }

  /**
   * Get epic status with task details
   */
  async getEpicStatus(epicId: string): Promise<{
    epic: BeadsEpic;
    tasks: BeadsTask[];
    readyTasks: BeadsTask[];
    blockedTasks: BeadsTask[];
  } | null> {
    const epic = this.epics.get(epicId);
    if (!epic) return null;

    const tasks = await this.queryTasks({ epic: epicId });
    const readyTasks = tasks.filter(
      (t) => t.blockedBy.length === 0 && t.status !== 'closed'
    );
    const blockedTasks = tasks.filter((t) => t.blockedBy.length > 0);

    return { epic, tasks, readyTasks, blockedTasks };
  }

  /**
   * List all epics
   */
  async listEpics(): Promise<BeadsEpic[]> {
    return Array.from(this.epics.values());
  }

  // ===== Dependency Operations =====

  /**
   * Resolve dependencies for a task
   */
  async resolveDependencies(taskId: string): Promise<BeadsDependencyResult> {
    const visited = new Set<string>();
    const dependencies: string[] = [];

    // Find all dependencies (transitive)
    const findDeps = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      for (const dep of this.dependencies.filter((d) => d.from === id)) {
        dependencies.push(dep.to);
        findDeps(dep.to);
      }
    };

    findDeps(taskId);

    // Find dependents
    const dependents = this.dependencies
      .filter((d) => d.to === taskId)
      .map((d) => d.from);

    // Check blocked status
    const task = this.tasks.get(taskId);
    const blockedBy = task?.blockedBy || [];
    const isBlocked = blockedBy.length > 0;

    // Calculate order index
    const orderIndex = this.calculateOrderIndex(taskId);

    return {
      taskId,
      dependencies,
      dependents,
      isBlocked,
      blockedBy,
      orderIndex,
    };
  }

  /**
   * Get execution order for an epic
   */
  async getExecutionOrder(epicId: string): Promise<string[]> {
    const tasks = await this.queryTasks({ epic: epicId });
    const taskIds = tasks.map((t) => t.id);

    // Topological sort
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const id of taskIds) {
      inDegree.set(id, 0);
      adjacency.set(id, []);
    }

    for (const dep of this.dependencies) {
      if (taskIds.includes(dep.from) && taskIds.includes(dep.to)) {
        inDegree.set(dep.from, (inDegree.get(dep.from) || 0) + 1);
        adjacency.get(dep.to)?.push(dep.from);
      }
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);

      for (const next of adjacency.get(current) || []) {
        const newDegree = (inDegree.get(next) || 1) - 1;
        inDegree.set(next, newDegree);
        if (newDegree === 0) queue.push(next);
      }
    }

    return order;
  }

  // ===== Sync Operations =====

  /**
   * Sync with beads storage
   */
  async sync(): Promise<BeadsSyncResult> {
    const startTime = Date.now();
    const result: BeadsSyncResult = {
      direction: this.config.syncDirection,
      pushedTasks: 0,
      pulledTasks: 0,
      conflicts: [],
      syncedAt: startTime,
      duration: 0,
    };

    this.emitEvent('sync:started', { direction: this.config.syncDirection });

    try {
      if (
        this.config.syncDirection === 'from_beads' ||
        this.config.syncDirection === 'bidirectional'
      ) {
        const pulled = await this.loadFromBeads();
        result.pulledTasks = pulled;
      }

      if (
        this.config.syncDirection === 'to_beads' ||
        this.config.syncDirection === 'bidirectional'
      ) {
        const pushed = await this.syncToBeads();
        result.pushedTasks = pushed;
      }

      result.duration = Date.now() - startTime;
      this.stats.lastSyncAt = result.syncedAt;

      this.emitEvent('sync:completed', { result });
    } catch (error) {
      this.emitEvent('sync:failed', { error });
      throw error;
    }

    return result;
  }

  /**
   * Sync state to beads files
   */
  async syncToBeads(): Promise<number> {
    let count = 0;

    for (const task of this.tasks.values()) {
      await this.saveTaskToBeads(task);
      count++;
    }

    for (const epic of this.epics.values()) {
      await this.saveEpicToBeads(epic);
    }

    return count;
  }

  // ===== Statistics =====

  /**
   * Get adapter statistics
   */
  async getStats(): Promise<BeadsStats> {
    const tasks = Array.from(this.tasks.values());
    const epics = Array.from(this.epics.values());

    const tasksByStatus: Record<BeadsTaskStatus, number> = {
      open: 0,
      in_progress: 0,
      review: 0,
      closed: 0,
      blocked: 0,
    };

    const tasksByType: Record<string, number> = {
      task: 0,
      bug: 0,
      feature: 0,
      epic: 0,
      story: 0,
      spike: 0,
      chore: 0,
    };

    const tasksByPriority: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    for (const task of tasks) {
      tasksByStatus[task.status]++;
      tasksByType[task.type]++;
      tasksByPriority[task.priority]++;
    }

    const epicsByStatus: Record<string, number> = {
      not_started: 0,
      in_progress: 0,
      review: 0,
      completed: 0,
    };

    for (const epic of epics) {
      epicsByStatus[epic.status]++;
    }

    const totalHits = this.stats.cacheHits + this.stats.cacheMisses;
    const cacheHitRate = totalHits > 0 ? this.stats.cacheHits / totalHits : 0;

    return {
      totalTasks: tasks.length,
      tasksByStatus: tasksByStatus as Record<BeadsTaskStatus, number>,
      tasksByType: tasksByType as Record<string, number>,
      tasksByPriority: tasksByPriority as Record<string, number>,
      totalEpics: epics.length,
      epicsByStatus: epicsByStatus as Record<string, number>,
      avgTasksPerEpic:
        epics.length > 0
          ? epics.reduce((sum, e) => sum + e.tasks.length, 0) / epics.length
          : 0,
      totalDependencies: this.dependencies.length,
      blockedTasks: tasks.filter((t) => t.blockedBy.length > 0).length,
      lastSyncAt: this.stats.lastSyncAt,
      cacheHitRate,
    };
  }

  // ===== Event Handling =====

  /**
   * Register an event handler
   */
  onEvent(handler: BeadsEventHandler): void {
    this.on('beads-event', handler);
  }

  // ===== Private Methods =====

  private emitEvent(type: BeadsEvent['type'], data: Record<string, unknown>): void {
    const event: BeadsEvent = {
      type,
      timestamp: Date.now(),
      data,
    };
    this.emit('beads-event', event);
    this.emit(type, data);
  }

  private async loadFromBeads(): Promise<number> {
    let count = 0;
    const tasksDir = join(this.config.beadsPath, 'tasks');
    const epicsDir = join(this.config.beadsPath, 'epics');

    // Load tasks
    if (existsSync(tasksDir)) {
      const files = readdirSync(tasksDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const content = readFileSync(join(tasksDir, file), 'utf-8');
          const task = JSON.parse(content) as BeadsTask;
          this.tasks.set(task.id, task);
          count++;
        } catch {
          // Skip invalid files
        }
      }
    }

    // Load epics
    if (existsSync(epicsDir)) {
      const files = readdirSync(epicsDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const content = readFileSync(join(epicsDir, file), 'utf-8');
          const epic = JSON.parse(content) as BeadsEpic;
          this.epics.set(epic.id, epic);
        } catch {
          // Skip invalid files
        }
      }
    }

    // Rebuild dependency graph
    this.rebuildDependencies();

    return count;
  }

  private async saveTaskToBeads(task: BeadsTask): Promise<void> {
    const tasksDir = join(this.config.beadsPath, 'tasks');
    if (!existsSync(tasksDir)) {
      mkdirSync(tasksDir, { recursive: true });
    }

    const filePath = join(tasksDir, `${task.id}.json`);
    writeFileSync(filePath, JSON.stringify(task, null, 2));
  }

  private async deleteTaskFromBeads(taskId: string): Promise<void> {
    const filePath = join(this.config.beadsPath, 'tasks', `${taskId}.json`);
    if (existsSync(filePath)) {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(filePath);
    }
  }

  private async saveEpicToBeads(epic: BeadsEpic): Promise<void> {
    const epicsDir = join(this.config.beadsPath, 'epics');
    if (!existsSync(epicsDir)) {
      mkdirSync(epicsDir, { recursive: true });
    }

    const filePath = join(epicsDir, `${epic.id}.json`);
    writeFileSync(filePath, JSON.stringify(epic, null, 2));
  }

  private rebuildDependencies(): void {
    this.dependencies = [];

    for (const task of this.tasks.values()) {
      for (const depId of task.dependsOn) {
        this.dependencies.push({
          from: task.id,
          to: depId,
          type: 'explicit',
        });
      }
    }

    // Update all blocked-by lists
    for (const task of this.tasks.values()) {
      this.updateBlockedBy(task.id);
    }
  }

  private updateBlockedBy(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const blockedBy: string[] = [];
    for (const dep of this.dependencies.filter((d) => d.from === taskId)) {
      const depTask = this.tasks.get(dep.to);
      if (depTask && depTask.status !== 'closed') {
        blockedBy.push(dep.to);
      }
    }

    task.blockedBy = blockedBy;
  }

  private async detectFileOverlapDependencies(task: BeadsTask): Promise<void> {
    if (!task.files?.length) return;

    for (const existingTask of this.tasks.values()) {
      if (existingTask.id === task.id) continue;
      if (existingTask.status === 'closed') continue;

      const overlapping = task.files.filter((f) =>
        existingTask.files.includes(f)
      );

      if (overlapping.length > 0) {
        // Earlier task (by creation) is the dependency
        if (existingTask.createdAt < task.createdAt) {
          this.dependencies.push({
            from: task.id,
            to: existingTask.id,
            type: 'file_overlap',
            overlappingFiles: overlapping,
          });
          this.updateBlockedBy(task.id);
        }
      }
    }
  }

  private updateEpicStatus(epicId: string): void {
    const epic = this.epics.get(epicId);
    if (!epic) return;

    const tasks = Array.from(this.tasks.values()).filter(
      (t) => t.epic === epicId
    );

    epic.status = computeEpicStatus(tasks);
    epic.progress = calculateEpicProgress(tasks);
    epic.totalTasks = tasks.length;
    epic.completedTasks = tasks.filter((t) => t.status === 'closed').length;
    epic.blockedTasks = tasks.filter((t) => t.blockedBy.length > 0).length;
    epic.updatedAt = Date.now();

    if (epic.status === 'completed' && !epic.completedAt) {
      epic.completedAt = Date.now();
      this.emitEvent('epic:completed', { epic });
    }
  }

  private calculateOrderIndex(taskId: string): number {
    const order = Array.from(this.tasks.keys());
    // Simple: count dependencies as order index
    const deps = this.dependencies.filter((d) => d.from === taskId);
    return deps.length;
  }

  // ===== Cache Methods =====

  private getFromCache<T>(key: string): T | null {
    if (!this.config.cacheEnabled) return null;

    const cached = this.cache.get(key);
    if (!cached) {
      this.stats.cacheMisses++;
      return null;
    }

    if (Date.now() > cached.expiresAt) {
      this.cache.delete(key);
      this.stats.cacheMisses++;
      return null;
    }

    this.stats.cacheHits++;
    return cached.data as T;
  }

  private setCache(key: string, data: unknown): void {
    if (!this.config.cacheEnabled) return;

    // Enforce cache size limit
    if (this.cache.size >= this.config.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }

    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.config.cacheTtl,
    });
  }

  private invalidateCache(key: string): void {
    this.cache.delete(key);
  }
}

// ===== Factory Functions =====

/**
 * Create a beads adapter with default configuration
 */
export function createBeadsAdapter(
  config?: BeadsAdapterConfig
): BeadsMemoryAdapter {
  return new BeadsMemoryAdapter(config);
}

/**
 * Create an adapter connected to an existing .beads directory
 */
export function connectToBeads(beadsPath: string): BeadsMemoryAdapter {
  return new BeadsMemoryAdapter({ beadsPath, autoSync: true });
}
