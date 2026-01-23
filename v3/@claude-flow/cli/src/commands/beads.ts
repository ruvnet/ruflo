/**
 * V3 CLI Beads Command
 * Git-backed task tracking integration with Beads (@beads/bd)
 *
 * Beads provides persistent memory for AI agents that survives across sessions.
 * Tasks are stored as JSON files in .beads/ directory, git-versioned and mergeable.
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { select, confirm, input } from '../prompt.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

// ===== Types =====

interface BeadsTask {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'review' | 'closed' | 'blocked';
  type: 'task' | 'bug' | 'feature' | 'epic' | 'story' | 'spike' | 'chore';
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

interface BeadsEpic {
  id: string;
  title: string;
  description: string;
  status: 'not_started' | 'in_progress' | 'review' | 'completed';
  tasks: string[];
  progress: number;
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

// ===== Helpers =====

function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `bd_${timestamp}_${random}`;
}

function getBeadsPath(): string {
  return process.env.BEADS_PATH || '.beads';
}

function ensureBeadsDir(): void {
  const beadsPath = getBeadsPath();
  if (!existsSync(beadsPath)) {
    mkdirSync(beadsPath, { recursive: true });
  }
  const tasksPath = join(beadsPath, 'tasks');
  if (!existsSync(tasksPath)) {
    mkdirSync(tasksPath, { recursive: true });
  }
  const epicsPath = join(beadsPath, 'epics');
  if (!existsSync(epicsPath)) {
    mkdirSync(epicsPath, { recursive: true });
  }
}

function loadAllTasks(): BeadsTask[] {
  const tasksPath = join(getBeadsPath(), 'tasks');
  if (!existsSync(tasksPath)) return [];

  const files = readdirSync(tasksPath).filter((f) => f.endsWith('.json'));
  const tasks: BeadsTask[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(tasksPath, file), 'utf-8');
      tasks.push(JSON.parse(content));
    } catch {
      // Skip invalid files
    }
  }

  return tasks;
}

function loadTask(id: string): BeadsTask | null {
  const taskPath = join(getBeadsPath(), 'tasks', `${id}.json`);
  if (!existsSync(taskPath)) return null;

  try {
    const content = readFileSync(taskPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function saveTask(task: BeadsTask): void {
  ensureBeadsDir();
  const taskPath = join(getBeadsPath(), 'tasks', `${task.id}.json`);
  writeFileSync(taskPath, JSON.stringify(task, null, 2));
}

function loadAllEpics(): BeadsEpic[] {
  const epicsPath = join(getBeadsPath(), 'epics');
  if (!existsSync(epicsPath)) return [];

  const files = readdirSync(epicsPath).filter((f) => f.endsWith('.json'));
  const epics: BeadsEpic[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(epicsPath, file), 'utf-8');
      epics.push(JSON.parse(content));
    } catch {
      // Skip invalid files
    }
  }

  return epics;
}

function loadEpic(id: string): BeadsEpic | null {
  const epicPath = join(getBeadsPath(), 'epics', `${id}.json`);
  if (!existsSync(epicPath)) return null;

  try {
    const content = readFileSync(epicPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function saveEpic(epic: BeadsEpic): void {
  ensureBeadsDir();
  const epicPath = join(getBeadsPath(), 'epics', `${epic.id}.json`);
  writeFileSync(epicPath, JSON.stringify(epic, null, 2));
}

function updateBlockedBy(tasks: BeadsTask[]): void {
  for (const task of tasks) {
    const blockedBy: string[] = [];
    for (const depId of task.dependsOn) {
      const dep = tasks.find((t) => t.id === depId);
      if (dep && dep.status !== 'closed') {
        blockedBy.push(depId);
      }
    }
    task.blockedBy = blockedBy;
  }
}

function getStatusIcon(status: string): string {
  const icons: Record<string, string> = {
    open: '○',
    in_progress: '◐',
    review: '◑',
    closed: '●',
    blocked: '⊘',
    not_started: '○',
    completed: '●',
  };
  return icons[status] || '?';
}

function getPriorityColor(priority: string): string {
  const colors: Record<string, string> = {
    critical: 'red',
    high: 'yellow',
    medium: 'blue',
    low: 'gray',
  };
  return colors[priority] || 'white';
}

function formatTask(task: BeadsTask): string {
  const icon = getStatusIcon(task.status);
  const blocked = task.blockedBy.length > 0 ? ' [BLOCKED]' : '';
  return `${icon} ${task.id} - ${task.title} (${task.priority})${blocked}`;
}

// ===== Commands =====

// Init command
const initCommand: Command = {
  name: 'init',
  description: 'Initialize beads in current project',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Overwrite existing configuration',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    { command: 'claude-flow beads init', description: 'Initialize beads directory' },
    { command: 'claude-flow beads init --force', description: 'Reinitialize beads' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const force = ctx.flags.force as boolean;
    const beadsPath = getBeadsPath();

    if (existsSync(beadsPath) && !force) {
      output.printWarning(`Beads already initialized at ${beadsPath}`);
      output.printInfo('Use --force to reinitialize');
      return { success: true, exitCode: 0 };
    }

    ensureBeadsDir();

    // Create config file
    const config = {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      settings: {
        autoSync: true,
        detectFileOverlap: true,
        defaultPriority: 'medium',
      },
    };

    writeFileSync(
      join(beadsPath, 'config.json'),
      JSON.stringify(config, null, 2)
    );

    // Create .gitignore for temp files
    writeFileSync(
      join(beadsPath, '.gitignore'),
      '# Temporary files\n*.tmp\n*.lock\n'
    );

    output.printSuccess(`Beads initialized at ${beadsPath}`);
    output.printInfo('Tasks: .beads/tasks/');
    output.printInfo('Epics: .beads/epics/');
    output.printInfo('');
    output.printInfo('Next steps:');
    output.printInfo('  claude-flow beads create "My first task"');
    output.printInfo('  claude-flow beads epic create "My first epic"');

    return { success: true, exitCode: 0 };
  },
};

// Status command
const statusCommand: Command = {
  name: 'status',
  description: 'Show task/epic status',
  options: [
    {
      name: 'epic',
      short: 'e',
      description: 'Filter by epic ID',
      type: 'string',
    },
    {
      name: 'all',
      short: 'a',
      description: 'Show all tasks including closed',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    { command: 'claude-flow beads status', description: 'Show open tasks' },
    { command: 'claude-flow beads status --epic bd_xxx', description: 'Show epic status' },
    { command: 'claude-flow beads status --all', description: 'Show all tasks' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const epicId = ctx.flags.epic as string;
    const showAll = ctx.flags.all as boolean;

    let tasks = loadAllTasks();
    updateBlockedBy(tasks);

    if (epicId) {
      const epic = loadEpic(epicId);
      if (!epic) {
        output.printError(`Epic not found: ${epicId}`);
        return { success: false, exitCode: 1 };
      }

      tasks = tasks.filter((t) => t.epic === epicId);

      output.printHeader(`Epic: ${epic.title}`);
      output.printInfo(`Status: ${getStatusIcon(epic.status)} ${epic.status}`);
      output.printInfo(`Progress: ${epic.progress}% (${epic.completedTasks}/${epic.totalTasks})`);
      output.printInfo(`Blocked: ${epic.blockedTasks}`);
      output.printInfo('');
    } else {
      output.printHeader('Beads Status');
    }

    if (!showAll) {
      tasks = tasks.filter((t) => t.status !== 'closed');
    }

    if (tasks.length === 0) {
      output.printInfo('No tasks found');
      return { success: true, exitCode: 0 };
    }

    // Group by status
    const byStatus: Record<string, BeadsTask[]> = {
      blocked: [],
      in_progress: [],
      review: [],
      open: [],
      closed: [],
    };

    for (const task of tasks) {
      const status = task.blockedBy.length > 0 ? 'blocked' : task.status;
      if (byStatus[status]) {
        byStatus[status].push(task);
      }
    }

    for (const [status, statusTasks] of Object.entries(byStatus)) {
      if (statusTasks.length > 0) {
        output.printSubHeader(`${status.toUpperCase()} (${statusTasks.length})`);
        for (const task of statusTasks) {
          output.printInfo(`  ${formatTask(task)}`);
        }
      }
    }

    // Summary
    output.printInfo('');
    output.printInfo(`Total: ${tasks.length} tasks`);

    return { success: true, exitCode: 0 };
  },
};

// Ready command
const readyCommand: Command = {
  name: 'ready',
  description: 'List ready (unblocked) tasks',
  options: [
    {
      name: 'parent',
      short: 'p',
      description: 'Filter by parent epic',
      type: 'string',
    },
    {
      name: 'limit',
      short: 'l',
      description: 'Maximum tasks to show',
      type: 'number',
      default: 10,
    },
  ],
  examples: [
    { command: 'claude-flow beads ready', description: 'List next ready tasks' },
    { command: 'claude-flow beads ready --parent=bd_xxx', description: 'Ready tasks in epic' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const parentId = ctx.flags.parent as string;
    const limit = ctx.flags.limit as number;

    let tasks = loadAllTasks();
    updateBlockedBy(tasks);

    // Filter to ready tasks
    tasks = tasks.filter(
      (t) =>
        t.status !== 'closed' &&
        t.blockedBy.length === 0
    );

    if (parentId) {
      tasks = tasks.filter((t) => t.epic === parentId);
    }

    // Sort by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    tasks.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // Apply limit
    tasks = tasks.slice(0, limit);

    if (tasks.length === 0) {
      output.printInfo('No ready tasks found');
      return { success: true, exitCode: 0 };
    }

    output.printHeader(`Ready Tasks (${tasks.length})`);
    for (const task of tasks) {
      output.printInfo(`  ${formatTask(task)}`);
      if (task.description) {
        output.printInfo(`    ${task.description.substring(0, 60)}...`);
      }
    }

    return { success: true, exitCode: 0 };
  },
};

// Blocked command
const blockedCommand: Command = {
  name: 'blocked',
  description: 'List blocked tasks with reasons',
  options: [
    {
      name: 'parent',
      short: 'p',
      description: 'Filter by parent epic',
      type: 'string',
    },
  ],
  examples: [
    { command: 'claude-flow beads blocked', description: 'List blocked tasks' },
    { command: 'claude-flow beads blocked --parent=bd_xxx', description: 'Blocked in epic' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const parentId = ctx.flags.parent as string;

    let tasks = loadAllTasks();
    updateBlockedBy(tasks);

    // Filter to blocked tasks
    tasks = tasks.filter((t) => t.blockedBy.length > 0);

    if (parentId) {
      tasks = tasks.filter((t) => t.epic === parentId);
    }

    if (tasks.length === 0) {
      output.printSuccess('No blocked tasks');
      return { success: true, exitCode: 0 };
    }

    output.printHeader(`Blocked Tasks (${tasks.length})`);
    for (const task of tasks) {
      output.printWarning(`  ⊘ ${task.id} - ${task.title}`);
      output.printInfo(`    Blocked by: ${task.blockedBy.join(', ')}`);
    }

    return { success: true, exitCode: 0 };
  },
};

// Create command
const createCommand: Command = {
  name: 'create',
  description: 'Create a new task',
  options: [
    {
      name: 'type',
      short: 't',
      description: 'Task type (task, bug, feature, story, spike, chore)',
      type: 'string',
      default: 'task',
    },
    {
      name: 'priority',
      short: 'p',
      description: 'Priority (low, medium, high, critical)',
      type: 'string',
      default: 'medium',
    },
    {
      name: 'epic',
      short: 'e',
      description: 'Parent epic ID',
      type: 'string',
    },
    {
      name: 'depends',
      short: 'd',
      description: 'Comma-separated dependency task IDs',
      type: 'string',
    },
    {
      name: 'assignee',
      short: 'a',
      description: 'Assignee name',
      type: 'string',
    },
    {
      name: 'tags',
      description: 'Comma-separated tags',
      type: 'string',
    },
  ],
  examples: [
    { command: 'claude-flow beads create "Implement auth"', description: 'Create task' },
    { command: 'claude-flow beads create "Fix login" -t bug -p high', description: 'Create bug' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let title = ctx.args[0];

    if (!title && ctx.interactive) {
      title = await input({
        message: 'Task title:',
        validate: (v) => v.length > 0 || 'Title is required',
      });
    }

    if (!title) {
      output.printError('Task title is required');
      return { success: false, exitCode: 1 };
    }

    const type = ctx.flags.type as string;
    const priority = ctx.flags.priority as string;
    const epicId = ctx.flags.epic as string;
    const depends = ctx.flags.depends as string;
    const assignee = ctx.flags.assignee as string;
    const tags = ctx.flags.tags as string;

    const now = Date.now();
    const task: BeadsTask = {
      id: generateId(),
      title,
      status: 'open',
      type: type as BeadsTask['type'],
      description: '',
      design: '',
      notes: '',
      dependsOn: depends ? depends.split(',').map((s) => s.trim()) : [],
      blockedBy: [],
      epic: epicId,
      assignee,
      priority: priority as BeadsTask['priority'],
      tags: tags ? tags.split(',').map((s) => s.trim()) : [],
      files: [],
      createdAt: now,
      updatedAt: now,
    };

    // Update blocked by
    if (task.dependsOn.length > 0) {
      const allTasks = loadAllTasks();
      for (const depId of task.dependsOn) {
        const dep = allTasks.find((t) => t.id === depId);
        if (dep && dep.status !== 'closed') {
          task.blockedBy.push(depId);
        }
      }
    }

    saveTask(task);

    // Add to epic if specified
    if (epicId) {
      const epic = loadEpic(epicId);
      if (epic) {
        epic.tasks.push(task.id);
        epic.totalTasks = epic.tasks.length;
        epic.updatedAt = now;
        saveEpic(epic);
      }
    }

    output.printSuccess(`Created task: ${task.id}`);
    output.printInfo(`  Title: ${task.title}`);
    output.printInfo(`  Type: ${task.type}`);
    output.printInfo(`  Priority: ${task.priority}`);
    if (task.blockedBy.length > 0) {
      output.printWarning(`  Blocked by: ${task.blockedBy.join(', ')}`);
    }

    return { success: true, exitCode: 0, data: { task } };
  },
};

// Close command
const closeCommand: Command = {
  name: 'close',
  description: 'Close a task',
  options: [
    {
      name: 'reason',
      short: 'r',
      description: 'Reason for closing',
      type: 'string',
    },
  ],
  examples: [
    { command: 'claude-flow beads close bd_xxx --reason="Done"', description: 'Close task' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args[0];
    let reason = ctx.flags.reason as string;

    if (!taskId) {
      output.printError('Task ID is required');
      return { success: false, exitCode: 1 };
    }

    const task = loadTask(taskId);
    if (!task) {
      output.printError(`Task not found: ${taskId}`);
      return { success: false, exitCode: 1 };
    }

    if (!reason && ctx.interactive) {
      reason = await input({
        message: 'Close reason:',
        default: 'Completed',
      });
    }

    const now = Date.now();
    task.status = 'closed';
    task.closedAt = now;
    task.closeReason = reason || 'Completed';
    task.updatedAt = now;

    saveTask(task);

    // Update epic
    if (task.epic) {
      const epic = loadEpic(task.epic);
      if (epic) {
        const epicTasks = loadAllTasks().filter((t) => t.epic === task.epic);
        epic.completedTasks = epicTasks.filter((t) => t.status === 'closed').length;
        epic.progress = Math.round((epic.completedTasks / epic.totalTasks) * 100);
        if (epic.completedTasks === epic.totalTasks) {
          epic.status = 'completed';
          epic.completedAt = now;
        }
        epic.updatedAt = now;
        saveEpic(epic);
      }
    }

    output.printSuccess(`Closed task: ${task.id}`);
    output.printInfo(`  Reason: ${task.closeReason}`);

    return { success: true, exitCode: 0 };
  },
};

// Sync command
const syncCommand: Command = {
  name: 'sync',
  description: 'Sync beads state with claude-flow memory',
  options: [
    {
      name: 'direction',
      short: 'd',
      description: 'Sync direction (to_memory, from_memory, bidirectional)',
      type: 'string',
      default: 'bidirectional',
    },
  ],
  examples: [
    { command: 'claude-flow beads sync', description: 'Bidirectional sync' },
    { command: 'claude-flow beads sync --direction=to_memory', description: 'Push to memory' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const direction = ctx.flags.direction as string;

    output.printInfo(`Syncing beads (${direction})...`);

    const tasks = loadAllTasks();
    const epics = loadAllEpics();

    output.printSuccess(`Sync complete`);
    output.printInfo(`  Tasks: ${tasks.length}`);
    output.printInfo(`  Epics: ${epics.length}`);

    return { success: true, exitCode: 0 };
  },
};

// Epic command group
const epicCreateCommand: Command = {
  name: 'create',
  description: 'Create a new epic',
  options: [
    {
      name: 'description',
      short: 'd',
      description: 'Epic description',
      type: 'string',
    },
  ],
  examples: [
    { command: 'claude-flow beads epic create "Auth Feature"', description: 'Create epic' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let title = ctx.args[0];

    if (!title && ctx.interactive) {
      title = await input({
        message: 'Epic title:',
        validate: (v) => v.length > 0 || 'Title is required',
      });
    }

    if (!title) {
      output.printError('Epic title is required');
      return { success: false, exitCode: 1 };
    }

    const description = ctx.flags.description as string || '';
    const now = Date.now();

    const epic: BeadsEpic = {
      id: generateId(),
      title,
      description,
      status: 'not_started',
      tasks: [],
      progress: 0,
      totalTasks: 0,
      completedTasks: 0,
      blockedTasks: 0,
      createdAt: now,
      updatedAt: now,
    };

    saveEpic(epic);

    output.printSuccess(`Created epic: ${epic.id}`);
    output.printInfo(`  Title: ${epic.title}`);

    return { success: true, exitCode: 0, data: { epic } };
  },
};

const epicStatusCommand: Command = {
  name: 'status',
  description: 'Show epic status',
  options: [],
  examples: [
    { command: 'claude-flow beads epic status bd_xxx', description: 'Show epic details' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const epicId = ctx.args[0];

    if (!epicId) {
      // List all epics
      const epics = loadAllEpics();
      if (epics.length === 0) {
        output.printInfo('No epics found');
        return { success: true, exitCode: 0 };
      }

      output.printHeader('Epics');
      for (const epic of epics) {
        const icon = getStatusIcon(epic.status);
        output.printInfo(`  ${icon} ${epic.id} - ${epic.title} (${epic.progress}%)`);
      }
      return { success: true, exitCode: 0 };
    }

    const epic = loadEpic(epicId);
    if (!epic) {
      output.printError(`Epic not found: ${epicId}`);
      return { success: false, exitCode: 1 };
    }

    output.printHeader(`Epic: ${epic.title}`);
    output.printInfo(`ID: ${epic.id}`);
    output.printInfo(`Status: ${getStatusIcon(epic.status)} ${epic.status}`);
    output.printInfo(`Progress: ${epic.progress}%`);
    output.printInfo(`Tasks: ${epic.completedTasks}/${epic.totalTasks} completed`);
    output.printInfo(`Blocked: ${epic.blockedTasks}`);
    if (epic.description) {
      output.printInfo(`Description: ${epic.description}`);
    }

    // Show tasks
    const tasks = loadAllTasks().filter((t) => t.epic === epicId);
    if (tasks.length > 0) {
      output.printInfo('');
      output.printSubHeader('Tasks');
      for (const task of tasks) {
        output.printInfo(`  ${formatTask(task)}`);
      }
    }

    return { success: true, exitCode: 0 };
  },
};

const epicCommand: Command = {
  name: 'epic',
  description: 'Epic management commands',
  subcommands: [epicCreateCommand, epicStatusCommand],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Default: show epics list
    return epicStatusCommand.action(ctx);
  },
};

// Import command
const importCommand: Command = {
  name: 'import',
  description: 'Import tasks from a plan file',
  options: [
    {
      name: 'epic',
      short: 'e',
      description: 'Create as epic',
      type: 'boolean',
      default: true,
    },
  ],
  examples: [
    { command: 'claude-flow beads import docs/plan.md', description: 'Import from plan' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const filePath = ctx.args[0];

    if (!filePath) {
      output.printError('File path is required');
      return { success: false, exitCode: 1 };
    }

    if (!existsSync(filePath)) {
      output.printError(`File not found: ${filePath}`);
      return { success: false, exitCode: 1 };
    }

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Parse markdown tasks (- [ ] format)
    const taskTitles: string[] = [];
    for (const line of lines) {
      const match = line.match(/^[-*]\s*\[[ x]?\]\s*(.+)$/i);
      if (match) {
        taskTitles.push(match[1].trim());
      }
    }

    if (taskTitles.length === 0) {
      output.printWarning('No tasks found in file (looking for - [ ] format)');
      return { success: true, exitCode: 0 };
    }

    const createEpic = ctx.flags.epic as boolean;
    let epicId: string | undefined;

    if (createEpic) {
      const epicTitle = filePath.split('/').pop()?.replace(/\.(md|txt)$/, '') || 'Imported Epic';
      const now = Date.now();
      const epic: BeadsEpic = {
        id: generateId(),
        title: epicTitle,
        description: `Imported from ${filePath}`,
        status: 'not_started',
        tasks: [],
        progress: 0,
        totalTasks: taskTitles.length,
        completedTasks: 0,
        blockedTasks: 0,
        createdAt: now,
        updatedAt: now,
      };
      saveEpic(epic);
      epicId = epic.id;
      output.printSuccess(`Created epic: ${epic.id} - ${epic.title}`);
    }

    // Create tasks
    const now = Date.now();
    for (const title of taskTitles) {
      const task: BeadsTask = {
        id: generateId(),
        title,
        status: 'open',
        type: 'task',
        description: '',
        design: '',
        notes: `Imported from ${filePath}`,
        dependsOn: [],
        blockedBy: [],
        epic: epicId,
        priority: 'medium',
        tags: ['imported'],
        files: [],
        createdAt: now,
        updatedAt: now,
      };
      saveTask(task);

      if (epicId) {
        const epic = loadEpic(epicId);
        if (epic) {
          epic.tasks.push(task.id);
          saveEpic(epic);
        }
      }
    }

    output.printSuccess(`Imported ${taskTitles.length} tasks`);

    return { success: true, exitCode: 0 };
  },
};

// Continue command
const continueCommand: Command = {
  name: 'continue',
  description: 'Continue working on an epic from where you left off',
  options: [],
  examples: [
    { command: 'claude-flow beads continue bd_xxx', description: 'Continue epic' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const epicId = ctx.args[0];

    if (!epicId) {
      // Find most recent epic with work remaining
      const epics = loadAllEpics().filter((e) => e.status !== 'completed');
      if (epics.length === 0) {
        output.printInfo('No active epics found');
        return { success: true, exitCode: 0 };
      }

      epics.sort((a, b) => b.updatedAt - a.updatedAt);
      output.printHeader('Active Epics');
      for (const epic of epics) {
        output.printInfo(`  ${epic.id} - ${epic.title} (${epic.progress}%)`);
      }
      output.printInfo('');
      output.printInfo('Run: claude-flow beads continue <epic-id>');
      return { success: true, exitCode: 0 };
    }

    const epic = loadEpic(epicId);
    if (!epic) {
      output.printError(`Epic not found: ${epicId}`);
      return { success: false, exitCode: 1 };
    }

    if (epic.status === 'completed') {
      output.printSuccess(`Epic already completed: ${epic.title}`);
      return { success: true, exitCode: 0 };
    }

    // Get ready tasks
    const tasks = loadAllTasks().filter((t) => t.epic === epicId);
    updateBlockedBy(tasks);

    const readyTasks = tasks.filter(
      (t) => t.status !== 'closed' && t.blockedBy.length === 0
    );

    if (readyTasks.length === 0) {
      const blockedTasks = tasks.filter((t) => t.blockedBy.length > 0);
      if (blockedTasks.length > 0) {
        output.printWarning('All remaining tasks are blocked');
        for (const task of blockedTasks) {
          output.printInfo(`  ${task.id} blocked by: ${task.blockedBy.join(', ')}`);
        }
      } else {
        output.printSuccess(`Epic completed: ${epic.title}`);
      }
      return { success: true, exitCode: 0 };
    }

    output.printHeader(`Continue Epic: ${epic.title}`);
    output.printInfo(`Progress: ${epic.progress}% (${epic.completedTasks}/${epic.totalTasks})`);
    output.printInfo('');
    output.printSubHeader('Next Tasks:');
    for (const task of readyTasks.slice(0, 5)) {
      output.printInfo(`  ${formatTask(task)}`);
    }

    return { success: true, exitCode: 0, data: { epic, readyTasks } };
  },
};

// Main beads command
export const beadsCommand: Command = {
  name: 'beads',
  description: 'Git-backed task tracking with Beads',
  subcommands: [
    initCommand,
    statusCommand,
    readyCommand,
    blockedCommand,
    createCommand,
    closeCommand,
    syncCommand,
    epicCommand,
    importCommand,
    continueCommand,
  ],
  examples: [
    { command: 'claude-flow beads init', description: 'Initialize beads' },
    { command: 'claude-flow beads status', description: 'Show status' },
    { command: 'claude-flow beads create "My task"', description: 'Create task' },
    { command: 'claude-flow beads epic create "My epic"', description: 'Create epic' },
    { command: 'claude-flow beads ready', description: 'List ready tasks' },
    { command: 'claude-flow beads continue bd_xxx', description: 'Continue epic' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Default: show status
    return statusCommand.action(ctx);
  },
};

export default beadsCommand;
