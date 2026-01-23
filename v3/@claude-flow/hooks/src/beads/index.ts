/**
 * @claude-flow/hooks - Beads Integration Hooks
 *
 * Hooks for integrating Beads task tracking into the agent workflow.
 * These hooks automatically sync task state before and after agent operations.
 *
 * @module @claude-flow/hooks/beads
 */

import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ===== Types =====

export interface BeadsTask {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'review' | 'closed' | 'blocked';
  type: string;
  description: string;
  design: string;
  notes: string;
  dependsOn: string[];
  blockedBy: string[];
  epic?: string;
  assignee?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  tags: string[];
  files: string[];
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  closeReason?: string;
}

export interface BeadsHookContext {
  taskId?: string;
  epicId?: string;
  task?: BeadsTask;
  description?: string;
  files?: string[];
  success?: boolean;
  result?: unknown;
  error?: Error;
  metadata?: Record<string, unknown>;
}

export interface BeadsHookResult {
  success: boolean;
  message?: string;
  task?: BeadsTask;
  context?: Record<string, unknown>;
}

export type BeadsHookHandler = (ctx: BeadsHookContext) => Promise<BeadsHookResult>;

// ===== Beads Hooks Manager =====

export class BeadsHooksManager extends EventEmitter {
  private beadsPath: string;
  private handlers: Map<string, BeadsHookHandler[]> = new Map();

  constructor(beadsPath: string = '.beads') {
    super();
    this.beadsPath = beadsPath;
    this.registerDefaultHandlers();
  }

  // ===== Hook Registration =====

  /**
   * Register a hook handler
   */
  on(hook: string, handler: BeadsHookHandler): this {
    const handlers = this.handlers.get(hook) || [];
    handlers.push(handler);
    this.handlers.set(hook, handlers);
    return this;
  }

  /**
   * Execute hook handlers
   */
  async execute(hook: string, ctx: BeadsHookContext): Promise<BeadsHookResult[]> {
    const handlers = this.handlers.get(hook) || [];
    const results: BeadsHookResult[] = [];

    for (const handler of handlers) {
      try {
        const result = await handler(ctx);
        results.push(result);
        this.emit(hook, { ctx, result });
      } catch (error) {
        const errorResult: BeadsHookResult = {
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
        };
        results.push(errorResult);
        this.emit(`${hook}:error`, { ctx, error });
      }
    }

    return results;
  }

  // ===== Pre-Task Hook =====

  /**
   * Execute before starting a task
   * - Loads task context from beads
   * - Checks dependencies
   * - Sets task status to in_progress
   */
  async preTask(ctx: BeadsHookContext): Promise<BeadsHookResult[]> {
    return this.execute('beads:pre-task', ctx);
  }

  // ===== Post-Task Hook =====

  /**
   * Execute after completing a task
   * - Updates task status
   * - Records result
   * - Triggers dependent task checks
   */
  async postTask(ctx: BeadsHookContext): Promise<BeadsHookResult[]> {
    return this.execute('beads:post-task', ctx);
  }

  // ===== On-Block Hook =====

  /**
   * Execute when a task becomes blocked
   * - Notifies about blocker
   * - Suggests alternatives
   */
  async onBlock(ctx: BeadsHookContext): Promise<BeadsHookResult[]> {
    return this.execute('beads:on-block', ctx);
  }

  // ===== On-Complete Hook =====

  /**
   * Execute when an epic is completed
   * - Generates summary
   * - Triggers cleanup
   */
  async onComplete(ctx: BeadsHookContext): Promise<BeadsHookResult[]> {
    return this.execute('beads:on-complete', ctx);
  }

  // ===== Default Handlers =====

  private registerDefaultHandlers(): void {
    // Pre-task: Load context and mark in progress
    this.on('beads:pre-task', async (ctx) => {
      if (!ctx.taskId) {
        return { success: false, message: 'No task ID provided' };
      }

      const task = this.loadTask(ctx.taskId);
      if (!task) {
        return { success: false, message: `Task not found: ${ctx.taskId}` };
      }

      // Check if blocked
      if (task.blockedBy.length > 0) {
        return {
          success: false,
          message: `Task is blocked by: ${task.blockedBy.join(', ')}`,
          task,
        };
      }

      // Mark as in progress
      task.status = 'in_progress';
      task.updatedAt = Date.now();
      this.saveTask(task);

      return {
        success: true,
        message: `Starting task: ${task.title}`,
        task,
        context: {
          description: task.description,
          design: task.design,
          notes: task.notes,
          files: task.files,
        },
      };
    });

    // Post-task: Update status based on result
    this.on('beads:post-task', async (ctx) => {
      if (!ctx.taskId) {
        return { success: false, message: 'No task ID provided' };
      }

      const task = this.loadTask(ctx.taskId);
      if (!task) {
        return { success: false, message: `Task not found: ${ctx.taskId}` };
      }

      if (ctx.success) {
        // Move to review or closed based on configuration
        task.status = 'review';
        task.updatedAt = Date.now();
      } else {
        // Keep in progress but add error note
        task.notes += `\n\n[${new Date().toISOString()}] Error: ${ctx.error?.message || 'Unknown error'}`;
        task.updatedAt = Date.now();
      }

      this.saveTask(task);

      // Check if this unblocks other tasks
      this.updateDependentTasks(task.id);

      return {
        success: true,
        message: ctx.success
          ? `Task completed: ${task.title}`
          : `Task encountered error: ${task.title}`,
        task,
      };
    });

    // On-block: Log blocker information
    this.on('beads:on-block', async (ctx) => {
      if (!ctx.taskId) {
        return { success: false, message: 'No task ID provided' };
      }

      const task = this.loadTask(ctx.taskId);
      if (!task) {
        return { success: false, message: `Task not found: ${ctx.taskId}` };
      }

      // Get blocker details
      const blockers = task.blockedBy.map((id) => this.loadTask(id)).filter(Boolean);
      const blockerInfo = blockers.map((b) => `${b!.id}: ${b!.title} (${b!.status})`);

      return {
        success: true,
        message: `Task ${task.id} is blocked by ${task.blockedBy.length} task(s)`,
        task,
        context: {
          blockers: blockerInfo,
          suggestion: 'Consider working on one of the blocking tasks first',
        },
      };
    });

    // On-complete: Generate epic summary
    this.on('beads:on-complete', async (ctx) => {
      if (!ctx.epicId) {
        return { success: false, message: 'No epic ID provided' };
      }

      const epic = this.loadEpic(ctx.epicId);
      if (!epic) {
        return { success: false, message: `Epic not found: ${ctx.epicId}` };
      }

      const tasks = this.loadEpicTasks(ctx.epicId);
      const summary = {
        title: epic.title,
        totalTasks: tasks.length,
        completedTasks: tasks.filter((t) => t.status === 'closed').length,
        duration: Date.now() - epic.createdAt,
        files: [...new Set(tasks.flatMap((t) => t.files))],
      };

      // Update epic status
      epic.status = 'completed';
      epic.completedAt = Date.now();
      epic.updatedAt = Date.now();
      this.saveEpic(epic);

      return {
        success: true,
        message: `Epic completed: ${epic.title}`,
        context: summary,
      };
    });
  }

  // ===== Helper Methods =====

  private loadTask(id: string): BeadsTask | null {
    const taskPath = join(this.beadsPath, 'tasks', `${id}.json`);
    if (!existsSync(taskPath)) return null;

    try {
      return JSON.parse(readFileSync(taskPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  private saveTask(task: BeadsTask): void {
    const tasksDir = join(this.beadsPath, 'tasks');
    if (!existsSync(tasksDir)) {
      mkdirSync(tasksDir, { recursive: true });
    }
    const taskPath = join(tasksDir, `${task.id}.json`);
    writeFileSync(taskPath, JSON.stringify(task, null, 2));
  }

  private loadEpic(id: string): { id: string; title: string; status: string; completedAt?: number; updatedAt: number; createdAt: number } | null {
    const epicPath = join(this.beadsPath, 'epics', `${id}.json`);
    if (!existsSync(epicPath)) return null;

    try {
      return JSON.parse(readFileSync(epicPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  private saveEpic(epic: { id: string; [key: string]: unknown }): void {
    const epicsDir = join(this.beadsPath, 'epics');
    if (!existsSync(epicsDir)) {
      mkdirSync(epicsDir, { recursive: true });
    }
    const epicPath = join(epicsDir, `${epic.id}.json`);
    writeFileSync(epicPath, JSON.stringify(epic, null, 2));
  }

  private loadEpicTasks(epicId: string): BeadsTask[] {
    const tasksDir = join(this.beadsPath, 'tasks');
    if (!existsSync(tasksDir)) return [];

    const files = readdirSync(tasksDir).filter((f) => f.endsWith('.json'));
    const tasks: BeadsTask[] = [];

    for (const file of files) {
      try {
        const task = JSON.parse(readFileSync(join(tasksDir, file), 'utf-8')) as BeadsTask;
        if (task.epic === epicId) {
          tasks.push(task);
        }
      } catch {
        // Skip invalid files
      }
    }

    return tasks;
  }

  private updateDependentTasks(closedTaskId: string): void {
    const tasksDir = join(this.beadsPath, 'tasks');
    if (!existsSync(tasksDir)) return;

    const files = readdirSync(tasksDir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      try {
        const task = JSON.parse(readFileSync(join(tasksDir, file), 'utf-8')) as BeadsTask;
        if (task.blockedBy.includes(closedTaskId)) {
          // Remove from blocked list
          task.blockedBy = task.blockedBy.filter((id) => id !== closedTaskId);
          task.updatedAt = Date.now();
          this.saveTask(task);

          // Emit unblock event if now unblocked
          if (task.blockedBy.length === 0) {
            this.emit('beads:task-unblocked', { task });
          }
        }
      } catch {
        // Skip invalid files
      }
    }
  }
}

// ===== Factory Functions =====

/**
 * Create a beads hooks manager
 */
export function createBeadsHooks(beadsPath?: string): BeadsHooksManager {
  return new BeadsHooksManager(beadsPath);
}

/**
 * Create hooks connected to default .beads directory
 */
export function connectBeadsHooks(): BeadsHooksManager {
  return new BeadsHooksManager('.beads');
}

// ===== Hook Registration Helpers =====

/**
 * Pre-task hook that loads task context
 */
export async function beadsPreTaskHook(
  taskId: string,
  hooks: BeadsHooksManager
): Promise<BeadsHookResult[]> {
  return hooks.preTask({ taskId });
}

/**
 * Post-task hook that updates task status
 */
export async function beadsPostTaskHook(
  taskId: string,
  success: boolean,
  hooks: BeadsHooksManager,
  error?: Error
): Promise<BeadsHookResult[]> {
  return hooks.postTask({ taskId, success, error });
}

/**
 * On-block hook that handles blocked tasks
 */
export async function beadsOnBlockHook(
  taskId: string,
  hooks: BeadsHooksManager
): Promise<BeadsHookResult[]> {
  return hooks.onBlock({ taskId });
}

/**
 * On-complete hook that handles epic completion
 */
export async function beadsOnCompleteHook(
  epicId: string,
  hooks: BeadsHooksManager
): Promise<BeadsHookResult[]> {
  return hooks.onComplete({ epicId });
}

export default BeadsHooksManager;
