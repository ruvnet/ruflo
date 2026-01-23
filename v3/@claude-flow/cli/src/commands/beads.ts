/**
 * V3 Beads Command
 *
 * CLI interface for Steve Yegge's Beads issue tracking system.
 * Provides commands for creating, listing, updating, and managing issues.
 *
 * @see https://github.com/steveyegge/beads
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import {
  createBeadsWrapper,
  type BeadsIssue,
} from '../beads/cli-wrapper.js';
import type { BeadsIssueStatus } from '../beads/types.js';

// ============================================================================
// Subcommands
// ============================================================================

const createCommand: Command = {
  name: 'create',
  aliases: ['new', 'add'],
  description: 'Create a new issue',
  options: [
    { name: 'title', short: 't', type: 'string', description: 'Issue title' },
    { name: 'description', short: 'd', type: 'string', description: 'Issue description' },
    { name: 'priority', short: 'p', type: 'number', description: 'Priority (0-4, 0=highest)', default: 2 },
    { name: 'type', type: 'string', description: 'Issue type (bug, feature, task, epic, chore)', default: 'task' },
    { name: 'assignee', short: 'a', type: 'string', description: 'Assignee name' },
    { name: 'labels', short: 'l', type: 'string', description: 'Comma-separated labels' },
    { name: 'parent', type: 'string', description: 'Parent issue ID' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const title = (ctx.flags.title || ctx.args.join(' ')) as string;

    if (!title) {
      output.printError('Title is required. Use --title or provide as argument.');
      return { success: false, exitCode: 1 };
    }

    const wrapper = createBeadsWrapper({ workingDir: ctx.cwd });
    const result = await wrapper.create({
      title,
      description: ctx.flags.description as string | undefined,
      priority: ctx.flags.priority as number,
      type: ctx.flags.type as string | undefined,
      assignee: ctx.flags.assignee as string | undefined,
      labels: ctx.flags.labels ? (ctx.flags.labels as string).split(',') : undefined,
      parent_id: ctx.flags.parent as string | undefined,
    });

    if (result.success && result.data) {
      output.printSuccess(`Created issue: ${result.data.id}`);
      output.writeln();
      printIssue(result.data);
      return { success: true, data: result.data };
    }

    output.printError(result.error || 'Failed to create issue');
    return { success: false, exitCode: 1 };
  },
};

const listCommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List issues',
  options: [
    { name: 'status', short: 's', type: 'string', description: 'Filter by status' },
    { name: 'assignee', short: 'a', type: 'string', description: 'Filter by assignee' },
    { name: 'priority', short: 'p', type: 'number', description: 'Filter by priority' },
    { name: 'labels', short: 'l', type: 'string', description: 'Filter by labels (comma-separated)' },
    { name: 'limit', short: 'n', type: 'number', description: 'Limit results', default: 20 },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const wrapper = createBeadsWrapper({ workingDir: ctx.cwd });
    const result = await wrapper.list({
      status: ctx.flags.status as string | undefined,
      assignee: ctx.flags.assignee as string | undefined,
      priority: ctx.flags.priority as number | undefined,
      labels: ctx.flags.labels ? (ctx.flags.labels as string).split(',') : undefined,
      limit: ctx.flags.limit as number,
    });

    if (!result.success || !result.data) {
      output.printError(result.error || 'Failed to list issues');
      return { success: false, exitCode: 1 };
    }

    const issues = result.data;

    if (issues.length === 0) {
      output.printInfo('No issues found');
      return { success: true, data: { issues: [] } };
    }

    output.writeln();
    output.writeln(output.bold(`Issues (${issues.length})`));
    output.writeln();

    const rows = issues.map(i => ({
      id: i.id,
      title: i.title.slice(0, 40) + (i.title.length > 40 ? '...' : ''),
      status: formatStatus(i.status),
      priority: `P${i.priority}`,
      assignee: i.assignee || '-',
    }));

    output.printTable({
      columns: [
        { key: 'id', header: 'ID', width: 14 },
        { key: 'title', header: 'Title', width: 42 },
        { key: 'status', header: 'Status', width: 14 },
        { key: 'priority', header: 'Pri', width: 5 },
        { key: 'assignee', header: 'Assignee', width: 12 },
      ],
      data: rows,
    });

    return { success: true, data: { issues } };
  },
};

const readyCommand: Command = {
  name: 'ready',
  description: 'Show issues ready to work on (no blockers)',
  options: [
    { name: 'limit', short: 'n', type: 'number', description: 'Limit results', default: 10 },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const wrapper = createBeadsWrapper({ workingDir: ctx.cwd });
    const result = await wrapper.ready({
      limit: ctx.flags.limit as number,
    });

    if (!result.success || !result.data) {
      output.printError(result.error || 'Failed to get ready issues');
      return { success: false, exitCode: 1 };
    }

    const issues = result.data;

    if (issues.length === 0) {
      output.printInfo('No ready issues found. All issues may be blocked or closed.');
      return { success: true, data: { issues: [] } };
    }

    output.writeln();
    output.writeln(output.bold(`Ready to Work (${issues.length})`));
    output.writeln();

    for (const issue of issues) {
      output.writeln(`  ${output.highlight(issue.id)} ${issue.title}`);
      output.writeln(`    Priority: P${issue.priority} | ${formatStatus(issue.status)}`);
      if (issue.description) {
        output.writeln(`    ${output.dim(issue.description.slice(0, 60))}...`);
      }
      output.writeln();
    }

    return { success: true, data: { issues } };
  },
};

const showCommand: Command = {
  name: 'show',
  aliases: ['view', 'get'],
  description: 'Show detailed issue information',
  options: [],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const id = ctx.args[0] as string;

    if (!id) {
      output.printError('Issue ID is required');
      return { success: false, exitCode: 1 };
    }

    const wrapper = createBeadsWrapper({ workingDir: ctx.cwd });
    const result = await wrapper.show({ id });

    if (!result.success || !result.data) {
      output.printError(result.error || `Issue not found: ${id}`);
      return { success: false, exitCode: 1 };
    }

    printIssue(result.data, true);
    return { success: true, data: result.data };
  },
};

const updateCommand: Command = {
  name: 'update',
  aliases: ['edit'],
  description: 'Update an issue',
  options: [
    { name: 'status', short: 's', type: 'string', description: 'New status' },
    { name: 'priority', short: 'p', type: 'number', description: 'New priority' },
    { name: 'assignee', short: 'a', type: 'string', description: 'New assignee' },
    { name: 'notes', short: 'n', type: 'string', description: 'Notes to add' },
    { name: 'labels', short: 'l', type: 'string', description: 'New labels (comma-separated)' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const id = ctx.args[0] as string;

    if (!id) {
      output.printError('Issue ID is required');
      return { success: false, exitCode: 1 };
    }

    const wrapper = createBeadsWrapper({ workingDir: ctx.cwd });
    const result = await wrapper.update({
      id,
      status: ctx.flags.status as string | undefined,
      priority: ctx.flags.priority as number | undefined,
      assignee: ctx.flags.assignee as string | undefined,
      notes: ctx.flags.notes as string | undefined,
      labels: ctx.flags.labels ? (ctx.flags.labels as string).split(',') : undefined,
    });

    if (result.success && result.data) {
      output.printSuccess(`Updated issue: ${id}`);
      output.writeln();
      printIssue(result.data);
      return { success: true, data: result.data };
    }

    output.printError(result.error || 'Failed to update issue');
    return { success: false, exitCode: 1 };
  },
};

const closeCommand: Command = {
  name: 'close',
  aliases: ['done', 'resolve'],
  description: 'Close an issue',
  options: [
    { name: 'reason', short: 'r', type: 'string', description: 'Resolution reason' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const id = ctx.args[0] as string;

    if (!id) {
      output.printError('Issue ID is required');
      return { success: false, exitCode: 1 };
    }

    const wrapper = createBeadsWrapper({ workingDir: ctx.cwd });
    const result = await wrapper.close({
      id,
      reason: ctx.flags.reason as string | undefined,
    });

    if (result.success && result.data) {
      output.printSuccess(`Closed issue: ${id}`);
      return { success: true, data: result.data };
    }

    output.printError(result.error || 'Failed to close issue');
    return { success: false, exitCode: 1 };
  },
};

const depAddCommand: Command = {
  name: 'dep-add',
  aliases: ['depends'],
  description: 'Add a dependency between issues',
  options: [],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fromId = ctx.args[0] as string;
    const toId = ctx.args[1] as string;

    if (!fromId || !toId) {
      output.printError('Usage: beads dep-add <issue-id> <depends-on-id>');
      return { success: false, exitCode: 1 };
    }

    const wrapper = createBeadsWrapper({ workingDir: ctx.cwd });
    const result = await wrapper.depAdd({ from_id: fromId, to_id: toId });

    if (result.success) {
      output.printSuccess(`Added dependency: ${fromId} depends on ${toId}`);
      return { success: true, data: result.data };
    }

    output.printError(result.error || 'Failed to add dependency');
    return { success: false, exitCode: 1 };
  },
};

const depTreeCommand: Command = {
  name: 'dep-tree',
  aliases: ['tree'],
  description: 'Show dependency tree',
  options: [],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const id = ctx.args[0] as string | undefined;

    const wrapper = createBeadsWrapper({ workingDir: ctx.cwd });
    const result = await wrapper.depTree({ id: id || '' });

    if (!result.success || !result.data) {
      output.printError(result.error || 'Failed to get dependency tree');
      return { success: false, exitCode: 1 };
    }

    output.writeln();
    output.writeln(output.bold('Dependency Tree'));
    output.writeln();

    const printNode = (node: { id: string; title?: string; status?: string; children?: unknown[] }, indent = 0) => {
      const prefix = '  '.repeat(indent) + (indent > 0 ? '|- ' : '');
      const status = node.status ? ` (${formatStatus(node.status as BeadsIssueStatus)})` : '';
      output.writeln(`${prefix}${output.highlight(node.id)} ${node.title || ''}${status}`);
      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          printNode(child as { id: string; title?: string; status?: string; children?: unknown[] }, indent + 1);
        }
      }
    };

    // result.data is unknown, so we need to cast it
    const data = result.data as { tree?: unknown[] } | unknown[];
    const tree = Array.isArray(data) ? data : (data as { tree?: unknown[] }).tree || [];
    for (const root of tree) {
      printNode(root as { id: string; title?: string; status?: string; children?: unknown[] });
    }

    return { success: true, data: result.data };
  },
};

const blockedCommand: Command = {
  name: 'blocked',
  description: 'Show blocked issues',
  options: [],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const wrapper = createBeadsWrapper({ workingDir: ctx.cwd });
    const result = await wrapper.blocked();

    if (!result.success || !result.data) {
      output.printError(result.error || 'Failed to get blocked issues');
      return { success: false, exitCode: 1 };
    }

    const issues = result.data;

    if (issues.length === 0) {
      output.printSuccess('No blocked issues!');
      return { success: true, data: { issues: [] } };
    }

    output.writeln();
    output.writeln(output.bold(`Blocked Issues (${issues.length})`));
    output.writeln();

    for (const issue of issues) {
      output.writeln(`  ${output.highlight(issue.id)} ${issue.title}`);
      if (issue.dependencies && issue.dependencies.length > 0) {
        const blockers = issue.dependencies.map(d => d.to_id).join(', ');
        output.writeln(`    Blocked by: ${blockers}`);
      }
      output.writeln();
    }

    return { success: true, data: { issues } };
  },
};

const statsCommand: Command = {
  name: 'stats',
  aliases: ['summary'],
  description: 'Show issue statistics',
  options: [],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const wrapper = createBeadsWrapper({ workingDir: ctx.cwd });
    const result = await wrapper.stats();

    if (!result.success || !result.data) {
      output.printError(result.error || 'Failed to get statistics');
      return { success: false, exitCode: 1 };
    }

    const stats = result.data;

    output.writeln();
    output.writeln(output.bold('Issue Statistics'));
    output.writeln();

    output.printBox([
      `Total: ${stats.total}`,
      `Open: ${stats.open}`,
      `In Progress: ${stats.in_progress}`,
      `Closed: ${stats.closed}`,
    ].join('\n'), 'Summary');

    if (Object.keys(stats.by_priority).length > 0) {
      output.writeln();
      output.writeln(output.bold('By Priority:'));
      for (const [priority, count] of Object.entries(stats.by_priority)) {
        const bar = '█'.repeat(Math.min(count as number, 20));
        output.writeln(`  P${priority}: ${bar} ${count}`);
      }
    }

    if (Object.keys(stats.by_type).length > 0) {
      output.writeln();
      output.writeln(output.bold('By Type:'));
      for (const [type, count] of Object.entries(stats.by_type)) {
        output.writeln(`  ${type}: ${count}`);
      }
    }

    return { success: true, data: stats };
  },
};

const syncCommand: Command = {
  name: 'sync',
  description: 'Sync issues with git',
  options: [
    { name: 'force', short: 'f', type: 'boolean', description: 'Force sync', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const wrapper = createBeadsWrapper({ workingDir: ctx.cwd });
    const result = await wrapper.sync(ctx.flags.force as boolean);

    if (result.success) {
      output.printSuccess('Sync completed');
      return { success: true, data: result.data };
    }

    output.printError(result.error || 'Failed to sync');
    return { success: false, exitCode: 1 };
  },
};

// ============================================================================
// Main Command
// ============================================================================

export const beadsCommand: Command = {
  name: 'beads',
  aliases: ['bd'],
  description: 'Beads issue tracking integration',
  subcommands: [
    createCommand,
    listCommand,
    readyCommand,
    showCommand,
    updateCommand,
    closeCommand,
    depAddCommand,
    depTreeCommand,
    blockedCommand,
    statsCommand,
    syncCommand,
  ],
  examples: [
    { command: 'claude-flow beads create "Fix login bug"', description: 'Create a new issue' },
    { command: 'claude-flow beads list --status open', description: 'List open issues' },
    { command: 'claude-flow beads ready', description: 'Show issues ready to work on' },
    { command: 'claude-flow beads show bd-abc123', description: 'Show issue details' },
    { command: 'claude-flow beads update bd-abc123 -s in_progress', description: 'Update issue status' },
    { command: 'claude-flow beads close bd-abc123 -r "Fixed in PR #42"', description: 'Close an issue' },
    { command: 'claude-flow beads dep-add bd-child bd-parent', description: 'Add dependency' },
    { command: 'claude-flow beads tree', description: 'Show dependency tree' },
    { command: 'claude-flow beads stats', description: 'Show statistics' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Beads Issue Tracking'));
    output.writeln(output.dim('AI-friendly issue tracking for agentic workflows'));
    output.writeln();
    output.writeln('Commands:');
    output.printList([
      'create     - Create a new issue',
      'list       - List issues with filters',
      'ready      - Show issues ready to work on',
      'show       - Show issue details',
      'update     - Update an issue',
      'close      - Close an issue',
      'dep-add    - Add a dependency',
      'dep-tree   - Show dependency tree',
      'blocked    - Show blocked issues',
      'stats      - Show statistics',
      'sync       - Sync with git',
    ]);
    output.writeln();
    output.writeln(output.dim('Use --help with any command for more details'));
    return { success: true };
  },
};

// ============================================================================
// Helpers
// ============================================================================

function formatStatus(status: BeadsIssueStatus | string): string {
  const icons: Record<string, string> = {
    open: '○',
    in_progress: '◐',
    closed: '✓',
  };
  return `${icons[status] || '?'} ${status}`;
}

function printIssue(issue: BeadsIssue, detailed = false): void {
  output.writeln(`${output.bold(output.highlight(issue.id))} ${issue.title}`);
  output.writeln(`  Status: ${formatStatus(issue.status)} | Priority: P${issue.priority}`);

  if (issue.type) {
    output.writeln(`  Type: ${issue.type}`);
  }

  if (issue.assignee) {
    output.writeln(`  Assignee: ${issue.assignee}`);
  }

  if (issue.labels && issue.labels.length > 0) {
    output.writeln(`  Labels: ${issue.labels.join(', ')}`);
  }

  if (detailed && issue.description) {
    output.writeln();
    output.writeln(output.dim('Description:'));
    output.writeln(`  ${issue.description}`);
  }

  if (detailed && issue.dependencies && issue.dependencies.length > 0) {
    output.writeln();
    output.writeln(output.dim('Dependencies:'));
    for (const dep of issue.dependencies) {
      output.writeln(`  ${dep.type}: ${dep.to_id}`);
    }
  }

  if (detailed) {
    output.writeln();
    output.writeln(output.dim(`Created: ${issue.created_at}`));
    if (issue.updated_at) {
      output.writeln(output.dim(`Updated: ${issue.updated_at}`));
    }
    if (issue.closed_at) {
      output.writeln(output.dim(`Closed: ${issue.closed_at}`));
    }
  }
}

export default beadsCommand;
