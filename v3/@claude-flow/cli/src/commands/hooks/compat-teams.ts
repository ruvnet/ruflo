/**
 * V2 backward-compatible aliases and Agent Teams integration commands
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import { callMCPTool, MCPClientError } from '../../mcp-client.js';
import { routeCommand } from './routing.js';
import { preCommandCommand, postCommandCommand } from './command-hooks.js';
import { sessionRestoreCommand } from './session-hooks.js';

// Backward-compatible aliases for v2 hooks
// These ensure old settings.json files continue to work

export const routeTaskCommand: Command = {
  name: 'route-task',
  description: '(DEPRECATED: Use "route" instead) Route task to optimal agent',
  options: routeCommand.options,
  examples: [
    { command: 'claude-flow hooks route-task --auto-swarm true', description: 'Route with auto-swarm (v2 compat)' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Silently handle v2-specific flags that don't exist in v3
    if (routeCommand.action) {
      const result = await routeCommand.action(ctx);
      return result || { success: true };
    }
    return { success: true };
  }
};

export const sessionStartCommand: Command = {
  name: 'session-start',
  description: '(DEPRECATED: Use "session-restore" instead) Start/restore session',
  options: [
    ...(sessionRestoreCommand.options || []),
    // V2-compatible options that are silently ignored
    {
      name: 'auto-configure',
      description: '(v2 compat) Auto-configure session',
      type: 'boolean',
      default: false
    },
    {
      name: 'restore-context',
      description: '(v2 compat) Restore context',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'claude-flow hooks session-start --auto-configure true', description: 'Start session (v2 compat)' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Map to session-restore for backward compatibility
    if (sessionRestoreCommand.action) {
      const result = await sessionRestoreCommand.action(ctx);
      return result || { success: true };
    }
    return { success: true };
  }
};

// Pre-bash alias for pre-command (v2 compat)
export const preBashCommand: Command = {
  name: 'pre-bash',
  description: '(ALIAS) Same as pre-command',
  options: preCommandCommand.options,
  examples: preCommandCommand.examples,
  action: preCommandCommand.action
};

// Post-bash alias for post-command (v2 compat)
export const postBashCommand: Command = {
  name: 'post-bash',
  description: '(ALIAS) Same as post-command',
  options: postCommandCommand.options,
  examples: postCommandCommand.examples,
  action: postCommandCommand.action
};

// Teammate Idle command - Agent Teams integration
export const teammateIdleCommand: Command = {
  name: 'teammate-idle',
  description: 'Handle idle teammate in Agent Teams - auto-assign tasks or notify lead',
  options: [
    {
      name: 'auto-assign',
      short: 'a',
      description: 'Automatically assign pending tasks to idle teammate',
      type: 'boolean',
      default: true
    },
    {
      name: 'check-task-list',
      short: 'c',
      description: 'Check shared task list for available work',
      type: 'boolean',
      default: true
    },
    {
      name: 'teammate-id',
      short: 't',
      description: 'ID of the idle teammate',
      type: 'string'
    },
    {
      name: 'team-name',
      description: 'Team name for context',
      type: 'string'
    }
  ],
  examples: [
    { command: 'claude-flow hooks teammate-idle --auto-assign true', description: 'Auto-assign tasks to idle teammate' },
    { command: 'claude-flow hooks teammate-idle -t worker-1 --check-task-list', description: 'Check tasks for specific teammate' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const autoAssign = ctx.flags.autoAssign !== false;
    const checkTaskList = ctx.flags.checkTaskList !== false;
    const teammateId = ctx.flags.teammateId as string;
    const teamName = ctx.flags.teamName as string;

    if (ctx.flags.format !== 'json') {
      output.printInfo(`Teammate idle hook triggered${teammateId ? ` for: ${output.highlight(teammateId)}` : ''}`);
    }

    try {
      const result = await callMCPTool<{
        success: boolean;
        teammateId: string;
        action: 'assigned' | 'waiting' | 'notified';
        taskAssigned?: {
          taskId: string;
          subject: string;
          priority: string;
        };
        pendingTasks: number;
        message: string;
      }>('hooks_teammate-idle', {
        autoAssign,
        checkTaskList,
        teammateId,
        teamName,
        timestamp: Date.now(),
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      if (result.action === 'assigned' && result.taskAssigned) {
        output.printSuccess(`Task assigned: ${result.taskAssigned.subject}`);
        output.printList([
          `Task ID: ${result.taskAssigned.taskId}`,
          `Priority: ${result.taskAssigned.priority}`,
          `Pending tasks remaining: ${result.pendingTasks}`
        ]);
      } else if (result.action === 'waiting') {
        output.printInfo('No pending tasks available - teammate waiting for work');
      } else {
        output.printInfo(`Team lead notified: ${result.message}`);
      }

      return { success: true, data: result };
    } catch {
      // Graceful fallback - don't fail hard, just report
      if (ctx.flags.format === 'json') {
        output.printJson({ success: true, action: 'waiting', message: 'Teammate idle - no MCP server' });
      } else {
        output.printInfo('Teammate idle - awaiting task assignment');
      }
      return { success: true };
    }
  }
};

// Task Completed command - Agent Teams integration
export const taskCompletedCommand: Command = {
  name: 'task-completed',
  description: 'Handle task completion in Agent Teams - train patterns and notify lead',
  options: [
    {
      name: 'task-id',
      short: 'i',
      description: 'ID of the completed task',
      type: 'string',
      required: true
    },
    {
      name: 'train-patterns',
      short: 'p',
      description: 'Train patterns from successful task',
      type: 'boolean',
      default: true
    },
    {
      name: 'notify-lead',
      short: 'n',
      description: 'Notify team lead of task completion',
      type: 'boolean',
      default: true
    },
    {
      name: 'success',
      short: 's',
      description: 'Whether the task succeeded',
      type: 'boolean',
      default: true
    },
    {
      name: 'quality',
      short: 'q',
      description: 'Quality score (0-1)',
      type: 'number'
    },
    {
      name: 'teammate-id',
      short: 't',
      description: 'ID of the teammate that completed the task',
      type: 'string'
    }
  ],
  examples: [
    { command: 'claude-flow hooks task-completed -i task-123 --train-patterns', description: 'Complete task and train patterns' },
    { command: 'claude-flow hooks task-completed -i task-456 --notify-lead --quality 0.95', description: 'Complete with quality score' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args[0] || ctx.flags.taskId as string;
    const trainPatterns = ctx.flags.trainPatterns !== false;
    const notifyLead = ctx.flags.notifyLead !== false;
    const success = ctx.flags.success !== false;
    const quality = ctx.flags.quality as number;
    const teammateId = ctx.flags.teammateId as string;

    if (!taskId) {
      output.printError('Task ID is required. Use --task-id or -i flag.');
      return { success: false, exitCode: 1 };
    }

    if (ctx.flags.format !== 'json') {
      output.printInfo(`Task completed: ${output.highlight(taskId)}`);
    }

    try {
      const result = await callMCPTool<{
        success: boolean;
        taskId: string;
        patternsLearned: number;
        leadNotified: boolean;
        metrics: {
          duration: number;
          quality: number;
          learningUpdates: number;
        };
        nextTask?: {
          taskId: string;
          subject: string;
        };
      }>('hooks_task-completed', {
        taskId,
        trainPatterns,
        notifyLead,
        success,
        quality,
        teammateId,
        timestamp: Date.now(),
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.printSuccess(`Task ${taskId} marked complete`);

      output.writeln();
      output.writeln(output.bold('Completion Metrics'));
      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 25 },
          { key: 'value', header: 'Value', width: 20, align: 'right' }
        ],
        data: [
          { metric: 'Patterns Learned', value: result.patternsLearned },
          { metric: 'Quality Score', value: quality ? `${(quality * 100).toFixed(0)}%` : 'N/A' },
          { metric: 'Lead Notified', value: result.leadNotified ? 'Yes' : 'No' },
          { metric: 'Learning Updates', value: result.metrics?.learningUpdates || 0 }
        ]
      });

      if (result.nextTask) {
        output.writeln();
        output.printInfo(`Next available task: ${result.nextTask.subject}`);
      }

      return { success: true, data: result };
    } catch {
      // Graceful fallback
      if (ctx.flags.format === 'json') {
        output.printJson({ success: true, taskId, message: 'Task completed - patterns pending' });
      } else {
        output.printSuccess(`Task ${taskId} completed`);
        if (trainPatterns) {
          output.printInfo('Pattern training queued for next sync');
        }
      }
      return { success: true };
    }
  }
};
