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

// Import command - Enhanced with MarkdownPlanImporter
const importCommand: Command = {
  name: 'import',
  description: 'Import tasks from a markdown plan file',
  options: [
    {
      name: 'epic',
      short: 'e',
      description: 'Create epics from headings',
      type: 'boolean',
      default: true,
    },
    {
      name: 'dependencies',
      short: 'd',
      description: 'Infer dependencies from nesting',
      type: 'boolean',
      default: true,
    },
    {
      name: 'close-completed',
      short: 'c',
      description: 'Mark completed tasks ([x]) as closed',
      type: 'boolean',
      default: false,
    },
    {
      name: 'priority',
      short: 'p',
      description: 'Default priority (0-4, 0=critical)',
      type: 'number',
      default: 2,
    },
    {
      name: 'labels',
      short: 'l',
      description: 'Additional labels (comma-separated)',
      type: 'string',
    },
    {
      name: 'heading-level',
      description: 'Minimum heading level for epics (2-6)',
      type: 'number',
      default: 2,
    },
    {
      name: 'dry-run',
      description: 'Preview import without creating tasks',
      type: 'boolean',
      default: false,
    },
    {
      name: 'verbose',
      short: 'v',
      description: 'Show detailed output',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    { command: 'claude-flow beads import docs/plan.md', description: 'Import from plan' },
    { command: 'claude-flow beads import plan.md --dry-run', description: 'Preview import' },
    { command: 'claude-flow beads import plan.md -c', description: 'Import and close completed' },
    { command: 'claude-flow beads import plan.md --no-epic', description: 'Import without epics' },
    { command: 'claude-flow beads import plan.md -l "sprint-1,backend"', description: 'Add labels' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const filePath = ctx.args[0];

    if (!filePath) {
      output.printError('File path is required');
      output.printInfo('Usage: claude-flow beads import <file.md>');
      return { success: false, exitCode: 1 };
    }

    if (!existsSync(filePath)) {
      output.printError(`File not found: ${filePath}`);
      return { success: false, exitCode: 1 };
    }

    // Import the MarkdownPlanImporter dynamically
    const { MarkdownPlanImporter } = await import('../beads/import.js');

    const createEpics = ctx.flags.epic as boolean;
    const inferDependencies = ctx.flags.dependencies as boolean;
    const closeCompleted = ctx.flags['close-completed'] as boolean;
    const defaultPriority = (ctx.flags.priority as number) || 2;
    const additionalLabels = ctx.flags.labels
      ? (ctx.flags.labels as string).split(',').map((l) => l.trim())
      : ['imported'];
    const epicHeadingLevel = (ctx.flags['heading-level'] as number) || 2;
    const dryRun = ctx.flags['dry-run'] as boolean;
    const verbose = ctx.flags.verbose as boolean;

    // Create importer with options
    const importer = new MarkdownPlanImporter({
      createEpics,
      inferDependencies,
      defaultPriority: defaultPriority as 0 | 1 | 2 | 3 | 4,
      defaultType: 'task',
      additionalLabels,
      closeCompletedTasks: closeCompleted,
      epicHeadingLevel,
    });

    // Parse the markdown file
    let plan;
    try {
      plan = importer.parseFile(filePath);
    } catch (err) {
      output.printError(`Failed to parse file: ${(err as Error).message}`);
      return { success: false, exitCode: 1 };
    }

    // Get statistics
    const stats = importer.getStatistics(plan);

    if (plan.totalTasks === 0) {
      output.printWarning('No tasks found in file (looking for - [ ] or - [x] format)');
      return { success: true, exitCode: 0 };
    }

    // Show preview in dry-run mode
    if (dryRun) {
      output.printHeader('Import Preview (Dry Run)');
      output.printInfo(`File: ${filePath}`);
      output.printInfo(`Title: ${plan.title || '(untitled)'}`);
      if (plan.description) {
        output.printInfo(`Description: ${plan.description.substring(0, 80)}...`);
      }
      output.printInfo('');
      output.printSubHeader('Statistics');
      output.printInfo(`  Epics: ${stats.totalEpics}`);
      output.printInfo(`  Tasks: ${stats.totalTasks}`);
      output.printInfo(`  Completed: ${stats.completedTasks}`);
      output.printInfo(`  Pending: ${stats.pendingTasks}`);
      output.printInfo('');
      output.printSubHeader('By Priority');
      output.printInfo(`  Critical (P0): ${stats.tasksByPriority[0] || 0}`);
      output.printInfo(`  High (P1): ${stats.tasksByPriority[1] || 0}`);
      output.printInfo(`  Medium (P2): ${stats.tasksByPriority[2] || 0}`);
      output.printInfo(`  Low (P3): ${stats.tasksByPriority[3] || 0}`);
      output.printInfo(`  Nice-to-have (P4): ${stats.tasksByPriority[4] || 0}`);
      output.printInfo('');

      if (verbose && plan.epics.length > 0) {
        output.printSubHeader('Epics');
        for (const epic of plan.epics) {
          output.printInfo(`  ## ${epic.title} (${epic.tasks.length} tasks)`);
          for (const task of epic.tasks.slice(0, 3)) {
            const status = task.completed ? '[x]' : '[ ]';
            output.printInfo(`    ${status} ${task.title}`);
          }
          if (epic.tasks.length > 3) {
            output.printInfo(`    ... and ${epic.tasks.length - 3} more`);
          }
        }
      }

      if (verbose && plan.orphanTasks.length > 0) {
        output.printSubHeader('Standalone Tasks');
        for (const task of plan.orphanTasks.slice(0, 5)) {
          const status = task.completed ? '[x]' : '[ ]';
          output.printInfo(`  ${status} ${task.title}`);
        }
        if (plan.orphanTasks.length > 5) {
          output.printInfo(`  ... and ${plan.orphanTasks.length - 5} more`);
        }
      }

      output.printInfo('');
      output.printInfo('Run without --dry-run to import.');
      return { success: true, exitCode: 0 };
    }

    // Perform actual import
    ensureBeadsDir();
    const now = Date.now();
    const createdEpics: string[] = [];
    const createdTasks: string[] = [];
    const taskIdMap = new Map<number, string>(); // Map task index to created ID

    // Helper to convert priority
    const convertPriority = (p: number): BeadsTask['priority'] => {
      const mapping: Record<number, BeadsTask['priority']> = {
        0: 'critical',
        1: 'high',
        2: 'medium',
        3: 'low',
        4: 'low',
      };
      return mapping[p] || 'medium';
    };

    // Create epics and their tasks
    for (const epicData of plan.epics) {
      const epic: BeadsEpic = {
        id: generateId(),
        title: epicData.title,
        description: epicData.description || `Imported from ${filePath}`,
        status: 'not_started',
        tasks: [],
        progress: 0,
        totalTasks: epicData.tasks.length,
        completedTasks: 0,
        blockedTasks: 0,
        createdAt: now,
        updatedAt: now,
      };

      // Create tasks for this epic
      const epicTaskIds: string[] = [];
      let completedCount = 0;

      for (let i = 0; i < epicData.tasks.length; i++) {
        const taskData = epicData.tasks[i];
        const taskId = generateId();
        taskIdMap.set(i, taskId);

        const task: BeadsTask = {
          id: taskId,
          title: taskData.title,
          status: taskData.completed && closeCompleted ? 'closed' : 'open',
          type: taskData.type as BeadsTask['type'],
          description: taskData.description,
          design: '',
          notes: taskData.notes || `Imported from ${filePath}`,
          dependsOn: [],
          blockedBy: [],
          epic: epic.id,
          assignee: taskData.assignee,
          priority: convertPriority(taskData.priority),
          tags: [...new Set([...taskData.labels, ...additionalLabels])],
          files: [],
          createdAt: now,
          updatedAt: now,
        };

        if (taskData.completed && closeCompleted) {
          task.closedAt = now;
          task.closeReason = 'Imported as completed';
          completedCount++;
        }

        saveTask(task);
        epicTaskIds.push(taskId);
        createdTasks.push(taskId);

        if (verbose) {
          const statusIcon = task.status === 'closed' ? '●' : '○';
          output.printInfo(`  ${statusIcon} Created task: ${task.id} - ${task.title}`);
        }
      }

      // Set up dependencies if enabled
      if (inferDependencies) {
        const deps = importer.buildDependencies(epicData.tasks);
        for (const [taskIdx, depIndices] of deps) {
          const taskId = taskIdMap.get(taskIdx);
          if (taskId) {
            const task = loadTask(taskId);
            if (task) {
              for (const depIdx of depIndices) {
                const depId = taskIdMap.get(depIdx);
                if (depId) {
                  task.dependsOn.push(depId);
                }
              }
              saveTask(task);
            }
          }
        }
      }

      // Update epic with task IDs
      epic.tasks = epicTaskIds;
      epic.completedTasks = completedCount;
      epic.progress = epicTaskIds.length > 0
        ? Math.round((completedCount / epicTaskIds.length) * 100)
        : 0;

      if (epic.progress === 100) {
        epic.status = 'completed';
        epic.completedAt = now;
      } else if (completedCount > 0) {
        epic.status = 'in_progress';
      }

      saveEpic(epic);
      createdEpics.push(epic.id);

      output.printSuccess(`Created epic: ${epic.id} - ${epic.title} (${epic.tasks.length} tasks)`);
    }

    // Create orphan tasks (not under any epic)
    if (plan.orphanTasks.length > 0) {
      let orphanEpicId: string | undefined;

      // Create a container epic for orphan tasks if creating epics
      if (createEpics && plan.orphanTasks.length > 0) {
        const orphanEpic: BeadsEpic = {
          id: generateId(),
          title: plan.title || 'Imported Tasks',
          description: plan.description || `Imported from ${filePath}`,
          status: 'not_started',
          tasks: [],
          progress: 0,
          totalTasks: plan.orphanTasks.length,
          completedTasks: 0,
          blockedTasks: 0,
          createdAt: now,
          updatedAt: now,
        };
        orphanEpicId = orphanEpic.id;

        const orphanTaskIds: string[] = [];
        let orphanCompletedCount = 0;

        for (const taskData of plan.orphanTasks) {
          const taskId = generateId();
          const task: BeadsTask = {
            id: taskId,
            title: taskData.title,
            status: taskData.completed && closeCompleted ? 'closed' : 'open',
            type: taskData.type as BeadsTask['type'],
            description: taskData.description,
            design: '',
            notes: taskData.notes || `Imported from ${filePath}`,
            dependsOn: [],
            blockedBy: [],
            epic: orphanEpicId,
            assignee: taskData.assignee,
            priority: convertPriority(taskData.priority),
            tags: [...new Set([...taskData.labels, ...additionalLabels])],
            files: [],
            createdAt: now,
            updatedAt: now,
          };

          if (taskData.completed && closeCompleted) {
            task.closedAt = now;
            task.closeReason = 'Imported as completed';
            orphanCompletedCount++;
          }

          saveTask(task);
          orphanTaskIds.push(taskId);
          createdTasks.push(taskId);

          if (verbose) {
            const statusIcon = task.status === 'closed' ? '●' : '○';
            output.printInfo(`  ${statusIcon} Created task: ${task.id} - ${task.title}`);
          }
        }

        orphanEpic.tasks = orphanTaskIds;
        orphanEpic.completedTasks = orphanCompletedCount;
        orphanEpic.progress = orphanTaskIds.length > 0
          ? Math.round((orphanCompletedCount / orphanTaskIds.length) * 100)
          : 0;

        if (orphanEpic.progress === 100) {
          orphanEpic.status = 'completed';
          orphanEpic.completedAt = now;
        } else if (orphanCompletedCount > 0) {
          orphanEpic.status = 'in_progress';
        }

        saveEpic(orphanEpic);
        createdEpics.push(orphanEpic.id);

        output.printSuccess(`Created epic: ${orphanEpic.id} - ${orphanEpic.title} (${orphanEpic.tasks.length} tasks)`);
      } else {
        // Create tasks without epic
        for (const taskData of plan.orphanTasks) {
          const taskId = generateId();
          const task: BeadsTask = {
            id: taskId,
            title: taskData.title,
            status: taskData.completed && closeCompleted ? 'closed' : 'open',
            type: taskData.type as BeadsTask['type'],
            description: taskData.description,
            design: '',
            notes: taskData.notes || `Imported from ${filePath}`,
            dependsOn: [],
            blockedBy: [],
            assignee: taskData.assignee,
            priority: convertPriority(taskData.priority),
            tags: [...new Set([...taskData.labels, ...additionalLabels])],
            files: [],
            createdAt: now,
            updatedAt: now,
          };

          if (taskData.completed && closeCompleted) {
            task.closedAt = now;
            task.closeReason = 'Imported as completed';
          }

          saveTask(task);
          createdTasks.push(taskId);

          if (verbose) {
            const statusIcon = task.status === 'closed' ? '●' : '○';
            output.printInfo(`  ${statusIcon} Created task: ${task.id} - ${task.title}`);
          }
        }

        output.printSuccess(`Created ${plan.orphanTasks.length} standalone tasks`);
      }
    }

    // Summary
    output.printInfo('');
    output.printHeader('Import Summary');
    output.printInfo(`  File: ${filePath}`);
    output.printInfo(`  Epics created: ${createdEpics.length}`);
    output.printInfo(`  Tasks created: ${createdTasks.length}`);
    if (closeCompleted) {
      output.printInfo(`  Closed (completed): ${stats.completedTasks}`);
    }
    output.printInfo('');
    output.printInfo('Next steps:');
    output.printInfo('  claude-flow beads status');
    output.printInfo('  claude-flow beads ready');
    if (createdEpics.length > 0) {
      output.printInfo(`  claude-flow beads continue ${createdEpics[0]}`);
    }

    return {
      success: true,
      exitCode: 0,
      data: {
        epics: createdEpics,
        tasks: createdTasks,
        stats,
      },
    };
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

// Graph command
const graphCommand: Command = {
  name: 'graph',
  description: 'Visualize task dependency graph',
  options: [
    {
      name: 'epic',
      short: 'e',
      description: 'Filter by epic ID',
      type: 'string',
    },
    {
      name: 'format',
      short: 'f',
      description: 'Output format (ascii, mermaid, dot)',
      type: 'string',
      default: 'ascii',
    },
    {
      name: 'all',
      short: 'a',
      description: 'Include closed tasks',
      type: 'boolean',
      default: false,
    },
    {
      name: 'critical',
      short: 'c',
      description: 'Show critical path only',
      type: 'boolean',
      default: false,
    },
    {
      name: 'direction',
      short: 'd',
      description: 'Graph direction (TB, BT, LR, RL)',
      type: 'string',
      default: 'TB',
    },
    {
      name: 'output',
      short: 'o',
      description: 'Output file path (prints to stdout if not specified)',
      type: 'string',
    },
  ],
  examples: [
    { command: 'claude-flow beads graph', description: 'Show ASCII dependency graph' },
    { command: 'claude-flow beads graph --epic bd_xxx', description: 'Graph for specific epic' },
    { command: 'claude-flow beads graph --format mermaid', description: 'Generate Mermaid diagram' },
    { command: 'claude-flow beads graph --format dot -o graph.dot', description: 'Export to Graphviz' },
    { command: 'claude-flow beads graph --critical', description: 'Show critical path only' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const epicId = ctx.flags.epic as string;
    const format = (ctx.flags.format as string || 'ascii').toLowerCase();
    const includeAll = ctx.flags.all as boolean;
    const criticalOnly = ctx.flags.critical as boolean;
    const direction = ctx.flags.direction as string || 'TB';
    const outputPath = ctx.flags.output as string;

    // Load tasks
    let tasks = loadAllTasks();
    updateBlockedBy(tasks);

    // Filter by epic if specified
    if (epicId) {
      const epic = loadEpic(epicId);
      if (!epic) {
        output.printError(`Epic not found: ${epicId}`);
        return { success: false, exitCode: 1 };
      }
      tasks = tasks.filter((t) => t.epic === epicId);
      output.printInfo(`Generating graph for epic: ${epic.title}`);
    }

    if (tasks.length === 0) {
      output.printInfo('No tasks found');
      return { success: true, exitCode: 0 };
    }

    // Convert BeadsTask to BeadsIssue format for the graph
    const issues = tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status === 'blocked' ? 'open' as const : task.status === 'review' ? 'in_progress' as const : task.status as 'open' | 'in_progress' | 'closed',
      priority: priorityToNumber(task.priority),
      type: task.type as 'bug' | 'feature' | 'task' | 'epic' | 'chore',
      assignee: task.assignee,
      labels: task.tags,
      created_at: new Date(task.createdAt).toISOString(),
      updated_at: new Date(task.updatedAt).toISOString(),
      closed_at: task.closedAt ? new Date(task.closedAt).toISOString() : undefined,
      close_reason: task.closeReason,
      dependencies: task.dependsOn.map((depId) => ({
        from_id: task.id,
        to_id: depId,
        type: 'blocks' as const,
        created_at: new Date(task.createdAt).toISOString(),
      })),
      notes: task.notes,
    }));

    // Import graph functions dynamically
    const { DependencyGraph } = await import('../beads/graph.js');

    // Create graph with options
    const graph = new DependencyGraph(issues, {
      includeClosed: includeAll,
      showCriticalPath: true,
      showBlocked: true,
      showStatus: true,
      direction: direction as 'TB' | 'BT' | 'LR' | 'RL',
    });

    // Generate output based on format
    let graphOutput: string;
    switch (format) {
      case 'mermaid':
      case 'md':
        graphOutput = graph.toMermaid();
        break;
      case 'dot':
      case 'graphviz':
        graphOutput = graph.toDOT();
        break;
      case 'ascii':
      default:
        graphOutput = graph.toASCII();
        break;
    }

    // Filter to critical path if requested
    if (criticalOnly && format === 'ascii') {
      const criticalPath = graph.getCriticalPath();
      if (criticalPath.length === 0) {
        output.printWarning('No critical path detected (may indicate cycles or no dependencies)');
      } else {
        output.writeln(output.bold('=== Critical Path ==='));
        output.printInfo(criticalPath.map((n) => `${n.id}: ${n.title}`).join('\n -> '));
      }
      return { success: true, exitCode: 0, data: { criticalPath } };
    }

    // Output to file or stdout
    if (outputPath) {
      writeFileSync(outputPath, graphOutput);
      output.printSuccess(`Graph written to: ${outputPath}`);

      // Provide hint for rendering
      if (format === 'dot' || format === 'graphviz') {
        output.printInfo('Render with: dot -Tpng ' + outputPath + ' -o graph.png');
      } else if (format === 'mermaid' || format === 'md') {
        output.printInfo('View in any Mermaid-compatible viewer or paste into GitHub markdown');
      }
    } else {
      console.log(graphOutput);
    }

    // Print stats
    const stats = graph.getStats();
    output.printInfo('');
    output.printInfo(`Stats: ${stats.totalNodes} tasks, ${stats.totalEdges} dependencies, ${stats.criticalNodes} on critical path`);
    if (stats.blockedNodes > 0) {
      output.printWarning(`${stats.blockedNodes} tasks are blocked`);
    }
    if (stats.hasCycles) {
      output.printError(`Dependency cycle detected in: ${stats.cycleNodes.join(', ')}`);
    }

    return { success: true, exitCode: 0, data: { stats } };
  },
};

// Helper to convert priority string to number
function priorityToNumber(priority: string): 0 | 1 | 2 | 3 | 4 {
  switch (priority) {
    case 'critical': return 0;
    case 'high': return 1;
    case 'medium': return 2;
    case 'low': return 3;
    default: return 2;
  }
}

// ===== GitHub Integration Commands =====

// GitHub sync command
const githubSyncCommand: Command = {
  name: 'sync',
  description: 'Sync beads tasks with GitHub issues',
  options: [
    {
      name: 'direction',
      short: 'd',
      description: 'Sync direction (to-github, from-github, bidirectional)',
      type: 'string',
      default: 'bidirectional',
    },
    {
      name: 'repo',
      short: 'r',
      description: 'Repository in owner/repo format',
      type: 'string',
    },
    {
      name: 'include-closed',
      description: 'Include closed issues/tasks in sync',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    { command: 'claude-flow beads github sync', description: 'Bidirectional sync' },
    { command: 'claude-flow beads github sync --direction=to-github', description: 'Push to GitHub' },
    { command: 'claude-flow beads github sync --direction=from-github', description: 'Pull from GitHub' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const direction = ctx.flags.direction as string;
    const repo = ctx.flags.repo as string | undefined;
    const includeClosed = ctx.flags['include-closed'] as boolean;

    output.printInfo('Checking GitHub CLI availability...');

    // Check gh CLI
    try {
      execSync('gh auth status', { stdio: 'pipe' });
    } catch {
      output.printError('GitHub CLI (gh) is not installed or not authenticated');
      output.printInfo('Install: https://cli.github.com/');
      output.printInfo('Then run: gh auth login');
      return { success: false, exitCode: 1 };
    }

    // Dynamically import GitHub sync
    const { GitHubSync } = await import('../beads/github.js');
    const { BeadsCliWrapper } = await import('../beads/cli-wrapper.js');

    const beadsWrapper = new BeadsCliWrapper();
    const githubSync = new GitHubSync(beadsWrapper, {
      repo,
      syncClosed: includeClosed,
    });

    output.printInfo(`Starting ${direction} sync...`);

    const validDirections = ['to-github', 'from-github', 'bidirectional'];
    if (!validDirections.includes(direction)) {
      output.printError(`Invalid direction: ${direction}`);
      output.printInfo(`Valid options: ${validDirections.join(', ')}`);
      return { success: false, exitCode: 1 };
    }

    const result = await githubSync.sync(direction as 'to-github' | 'from-github' | 'bidirectional');

    if (result.success) {
      output.printSuccess('Sync completed successfully');
      output.printInfo(`  Pushed to GitHub: ${result.pushedToGitHub}`);
      output.printInfo(`  Pulled from GitHub: ${result.pulledFromGitHub}`);
      if (result.created.length > 0) {
        output.printInfo(`  Created: ${result.created.join(', ')}`);
      }
      if (result.updated.length > 0) {
        output.printInfo(`  Updated: ${result.updated.join(', ')}`);
      }
      if (result.imported.length > 0) {
        output.printInfo(`  Imported: ${result.imported.join(', ')}`);
      }
    } else {
      output.printWarning('Sync completed with errors');
      for (const err of result.errors) {
        if (err.taskId) {
          output.printError(`  Task ${err.taskId}: ${err.error}`);
        } else if (err.issueNumber) {
          output.printError(`  Issue #${err.issueNumber}: ${err.error}`);
        } else {
          output.printError(`  ${err.error}`);
        }
      }
    }

    return { success: result.success, exitCode: result.success ? 0 : 1, data: result };
  },
};

// GitHub link command
const githubLinkCommand: Command = {
  name: 'link',
  description: 'Link a beads task to an existing GitHub issue',
  options: [],
  examples: [
    { command: 'claude-flow beads github link bd_xxx https://github.com/owner/repo/issues/42', description: 'Link task to issue' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args[0];
    const issueUrl = ctx.args[1];

    if (!taskId) {
      output.printError('Task ID is required');
      output.printInfo('Usage: claude-flow beads github link <task-id> <issue-url>');
      return { success: false, exitCode: 1 };
    }

    if (!issueUrl) {
      output.printError('GitHub issue URL is required');
      output.printInfo('Usage: claude-flow beads github link <task-id> <issue-url>');
      return { success: false, exitCode: 1 };
    }

    // Dynamically import GitHub sync
    const { GitHubSync } = await import('../beads/github.js');
    const { BeadsCliWrapper } = await import('../beads/cli-wrapper.js');

    const beadsWrapper = new BeadsCliWrapper();
    const githubSync = new GitHubSync(beadsWrapper);

    const result = await githubSync.linkIssue(taskId, issueUrl);

    if (result.success && result.data) {
      output.printSuccess(`Linked task ${taskId} to GitHub issue #${result.data.issueNumber}`);
      output.printInfo(`  Repository: ${result.data.repo}`);
      output.printInfo(`  URL: ${result.data.issueUrl}`);
    } else {
      output.printError(`Failed to link: ${result.error}`);
    }

    return { success: result.success, exitCode: result.success ? 0 : 1 };
  },
};

// GitHub unlink command
const githubUnlinkCommand: Command = {
  name: 'unlink',
  description: 'Unlink a beads task from its GitHub issue',
  options: [],
  examples: [
    { command: 'claude-flow beads github unlink bd_xxx', description: 'Unlink task from issue' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args[0];

    if (!taskId) {
      output.printError('Task ID is required');
      output.printInfo('Usage: claude-flow beads github unlink <task-id>');
      return { success: false, exitCode: 1 };
    }

    // Dynamically import GitHub sync
    const { GitHubSync } = await import('../beads/github.js');
    const { BeadsCliWrapper } = await import('../beads/cli-wrapper.js');

    const beadsWrapper = new BeadsCliWrapper();
    const githubSync = new GitHubSync(beadsWrapper);

    const result = await githubSync.unlinkIssue(taskId);

    if (result.success) {
      output.printSuccess(`Unlinked task ${taskId} from GitHub`);
    } else {
      output.printError(`Failed to unlink: ${result.error}`);
    }

    return { success: result.success, exitCode: result.success ? 0 : 1 };
  },
};

// GitHub status command
const githubStatusCommand: Command = {
  name: 'status',
  description: 'Show GitHub sync status for tasks',
  options: [
    {
      name: 'task',
      short: 't',
      description: 'Show status for specific task',
      type: 'string',
    },
  ],
  examples: [
    { command: 'claude-flow beads github status', description: 'Show all linked tasks' },
    { command: 'claude-flow beads github status --task bd_xxx', description: 'Show specific task' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.flags.task as string | undefined;

    // Check gh CLI
    try {
      execSync('gh auth status', { stdio: 'pipe' });
    } catch {
      output.printError('GitHub CLI (gh) is not installed or not authenticated');
      return { success: false, exitCode: 1 };
    }

    // Dynamically import GitHub sync
    const { GitHubSync } = await import('../beads/github.js');
    const { BeadsCliWrapper } = await import('../beads/cli-wrapper.js');

    const beadsWrapper = new BeadsCliWrapper();
    const githubSync = new GitHubSync(beadsWrapper);

    if (taskId) {
      const link = githubSync.getLink(taskId);
      if (!link) {
        output.printInfo(`Task ${taskId} is not linked to any GitHub issue`);
        return { success: true, exitCode: 0 };
      }

      output.printHeader(`GitHub Link: ${taskId}`);
      output.printInfo(`  Issue: #${link.issueNumber}`);
      output.printInfo(`  Repository: ${link.repo}`);
      output.printInfo(`  URL: ${link.issueUrl}`);
      output.printInfo(`  Linked: ${link.linkedAt}`);
      if (link.lastSyncAt) {
        output.printInfo(`  Last Sync: ${link.lastSyncAt}`);
      }
    } else {
      const links = githubSync.getAllLinks();

      if (links.length === 0) {
        output.printInfo('No tasks are linked to GitHub issues');
        output.printInfo('');
        output.printInfo('Link a task: claude-flow beads github link <task-id> <issue-url>');
        output.printInfo('Sync tasks:  claude-flow beads github sync');
        return { success: true, exitCode: 0 };
      }

      output.printHeader(`GitHub Links (${links.length})`);
      for (const link of links) {
        output.printInfo(`  ${link.taskId} -> #${link.issueNumber} (${link.repo})`);
      }
    }

    return { success: true, exitCode: 0 };
  },
};

// GitHub command group
const githubCommand: Command = {
  name: 'github',
  description: 'GitHub issues integration',
  subcommands: [githubSyncCommand, githubLinkCommand, githubUnlinkCommand, githubStatusCommand],
  examples: [
    { command: 'claude-flow beads github sync', description: 'Sync with GitHub' },
    { command: 'claude-flow beads github link bd_xxx <url>', description: 'Link task to issue' },
    { command: 'claude-flow beads github status', description: 'Show sync status' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Default: show status
    return githubStatusCommand.action(ctx);
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
    graphCommand,
    githubCommand,
  ],
  examples: [
    { command: 'claude-flow beads init', description: 'Initialize beads' },
    { command: 'claude-flow beads status', description: 'Show status' },
    { command: 'claude-flow beads create "My task"', description: 'Create task' },
    { command: 'claude-flow beads epic create "My epic"', description: 'Create epic' },
    { command: 'claude-flow beads ready', description: 'List ready tasks' },
    { command: 'claude-flow beads continue bd_xxx', description: 'Continue epic' },
    { command: 'claude-flow beads graph', description: 'Show dependency graph' },
    { command: 'claude-flow beads graph --format mermaid', description: 'Export Mermaid diagram' },
    { command: 'claude-flow beads github sync', description: 'Sync with GitHub issues' },
    { command: 'claude-flow beads github link bd_xxx <url>', description: 'Link task to GitHub issue' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Default: show status
    return statusCommand.action(ctx);
  },
};

export default beadsCommand;
