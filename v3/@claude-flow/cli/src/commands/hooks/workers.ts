/**
 * Worker commands - background worker management (12 workers)
 *
 * Workers: ultralearn, optimize, consolidate, predict, audit, map,
 * preload, deepdive, document, refactor, benchmark, testgaps
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import { callMCPTool, MCPClientError } from '../../mcp-client.js';

/** Format worker status with appropriate color coding. */
function formatWorkerStatus(status: string): string {
  switch (status) {
    case 'running': return output.highlight(status);
    case 'completed': return output.success(status);
    case 'failed': return output.error(status);
    case 'pending': return output.dim(status);
    default: return status;
  }
}

const workerListCommand: Command = {
  name: 'list',
  description: 'List all 12 background workers and their status',
  options: [
    { name: 'active', short: 'a', description: 'Show only active worker instances', type: 'boolean', default: false }
  ],
  examples: [
    { command: 'claude-flow hooks worker list', description: 'List all workers' },
    { command: 'claude-flow hooks worker list --active', description: 'Show active instances only' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    output.printInfo('Fetching background workers...');

    try {
      const result = await callMCPTool<{
        workers: Array<{
          name: string; description: string; status: string;
          trigger: string; lastRun?: string; instances: number;
        }>;
        activeInstances: Array<{
          id: string; worker: string; status: string;
          startedAt: string; progress?: number;
        }>;
      }>('hooks_worker-list', {
        activeOnly: ctx.flags.active || false,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold(`Background Workers (${result.workers.length})`));
      output.printTable({
        columns: [
          { key: 'name', header: 'Worker', width: 15 },
          { key: 'description', header: 'Description', width: 30 },
          { key: 'status', header: 'Status', width: 12, format: (v) => formatWorkerStatus(String(v)) },
          { key: 'trigger', header: 'Trigger', width: 20 },
          { key: 'instances', header: 'Instances', width: 10, align: 'right' }
        ],
        data: result.workers
      });

      if (result.activeInstances.length > 0) {
        output.writeln();
        output.writeln(output.bold('Active Instances'));
        output.printTable({
          columns: [
            { key: 'id', header: 'Instance ID', width: 20 },
            { key: 'worker', header: 'Worker', width: 15 },
            { key: 'status', header: 'Status', width: 12, format: (v) => formatWorkerStatus(String(v)) },
            { key: 'startedAt', header: 'Started', width: 20 },
            { key: 'progress', header: 'Progress', width: 10, align: 'right', format: (v) => v != null ? `${Number(v)}%` : '-' }
          ],
          data: result.activeInstances
        });
      } else {
        output.writeln();
        output.writeln(output.dim('No active worker instances.'));
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Worker list failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

const workerDispatchCommand: Command = {
  name: 'dispatch',
  description: 'Dispatch a background worker by trigger',
  options: [
    { name: 'trigger', short: 't', description: 'Worker trigger name', type: 'string', required: true },
    { name: 'context', short: 'c', description: 'Additional context for the worker', type: 'string' },
    { name: 'priority', short: 'p', description: 'Execution priority (low, normal, high)', type: 'string', default: 'normal', choices: ['low', 'normal', 'high'] },
    { name: 'sync', short: 's', description: 'Wait for worker to complete', type: 'boolean', default: false }
  ],
  examples: [
    { command: 'claude-flow hooks worker dispatch -t optimize', description: 'Dispatch optimize worker' },
    { command: 'claude-flow hooks worker dispatch -t audit -p high --sync', description: 'Dispatch audit synchronously' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const trigger = ctx.args[0] || ctx.flags.trigger as string;

    if (!trigger) {
      output.printError('Trigger is required. Use --trigger or -t flag.');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Dispatching worker: ${output.highlight(trigger)}`);

    try {
      const result = await callMCPTool<{
        instanceId: string; worker: string; trigger: string;
        status: string; priority: string;
        result?: { summary: string; findings: string[]; duration: number };
      }>('hooks_worker-dispatch', {
        trigger,
        context: ctx.flags.context,
        priority: ctx.flags.priority || 'normal',
        sync: ctx.flags.sync || false,
        timestamp: Date.now(),
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.printSuccess(`Worker dispatched: ${result.worker}`);
      output.writeln();
      output.printTable({
        columns: [
          { key: 'field', header: 'Field', width: 15 },
          { key: 'value', header: 'Value', width: 40 }
        ],
        data: [
          { field: 'Instance ID', value: result.instanceId },
          { field: 'Worker', value: result.worker },
          { field: 'Trigger', value: result.trigger },
          { field: 'Status', value: formatWorkerStatus(result.status) },
          { field: 'Priority', value: result.priority }
        ]
      });

      if (result.result) {
        output.writeln();
        output.writeln(output.bold('Result'));
        output.writeln(result.result.summary);
        if (result.result.findings.length > 0) {
          output.writeln();
          output.printList(result.result.findings);
        }
        output.writeln(output.dim(`Duration: ${(result.result.duration / 1000).toFixed(1)}s`));
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Worker dispatch failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

const workerStatusCommand: Command = {
  name: 'status',
  description: 'Check worker instance status',
  options: [
    { name: 'id', short: 'i', description: 'Worker instance ID to check', type: 'string' },
    { name: 'all', short: 'a', description: 'Show status of all running instances', type: 'boolean', default: false }
  ],
  examples: [
    { command: 'claude-flow hooks worker status -i wk-abc123', description: 'Check specific instance' },
    { command: 'claude-flow hooks worker status --all', description: 'Show all running instances' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const instanceId = ctx.args[0] || ctx.flags.id as string;
    const showAll = ctx.flags.all as boolean;

    if (!instanceId && !showAll) {
      output.printError('Provide an instance ID with --id or use --all to show all.');
      return { success: false, exitCode: 1 };
    }

    try {
      const result = await callMCPTool<{
        instance?: {
          id: string; worker: string; status: string;
          startedAt: string; completedAt?: string;
          progress: number; output?: string; error?: string;
        };
        instances?: Array<{
          id: string; worker: string; status: string;
          startedAt: string; progress: number;
        }>;
      }>('hooks_worker-status', {
        instanceId,
        all: showAll,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      if (result.instance) {
        const inst = result.instance;
        output.writeln();
        output.printBox(
          [
            `Instance: ${inst.id}`,
            `Worker: ${output.highlight(inst.worker)}`,
            `Status: ${formatWorkerStatus(inst.status)}`,
            `Started: ${inst.startedAt}`,
            inst.completedAt ? `Completed: ${inst.completedAt}` : null,
            `Progress: ${inst.progress}%`
          ].filter(Boolean).join('\n'),
          'Worker Instance'
        );
        if (inst.output) {
          output.writeln();
          output.writeln(output.bold('Output'));
          output.writeln(inst.output);
        }
        if (inst.error) {
          output.writeln();
          output.writeln(output.bold(output.error('Error')));
          output.writeln(output.error(inst.error));
        }
      }

      if (result.instances && result.instances.length > 0) {
        output.writeln();
        output.writeln(output.bold(`Running Instances (${result.instances.length})`));
        output.printTable({
          columns: [
            { key: 'id', header: 'Instance ID', width: 20 },
            { key: 'worker', header: 'Worker', width: 15 },
            { key: 'status', header: 'Status', width: 12, format: (v) => formatWorkerStatus(String(v)) },
            { key: 'startedAt', header: 'Started', width: 20 },
            { key: 'progress', header: 'Progress', width: 10, align: 'right', format: (v) => `${Number(v)}%` }
          ],
          data: result.instances
        });
      } else if (!result.instance) {
        output.writeln();
        output.writeln(output.dim('No running worker instances found.'));
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Worker status failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

const workerDetectCommand: Command = {
  name: 'detect',
  description: 'Detect worker triggers from prompt text',
  options: [
    { name: 'prompt', short: 'p', description: 'Prompt text to analyze for triggers', type: 'string', required: true },
    { name: 'auto-dispatch', short: 'a', description: 'Automatically dispatch detected workers', type: 'boolean', default: false },
    { name: 'min-confidence', short: 'm', description: 'Minimum confidence threshold (0-1)', type: 'number', default: 0.5 }
  ],
  examples: [
    { command: 'claude-flow hooks worker detect -p "optimize the auth module"', description: 'Detect triggers' },
    { command: 'claude-flow hooks worker detect -p "audit security" --auto-dispatch', description: 'Detect and dispatch' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const prompt = ctx.args[0] || ctx.flags.prompt as string;

    if (!prompt) {
      output.printError('Prompt is required. Use --prompt or -p flag.');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Detecting triggers in: ${output.highlight(prompt)}`);

    try {
      const result = await callMCPTool<{
        prompt: string;
        detectedTriggers: Array<{
          worker: string; trigger: string; confidence: number;
          reason: string; dispatched?: boolean; instanceId?: string;
        }>;
        totalDetected: number;
        autoDispatched: number;
      }>('hooks_worker-detect', {
        prompt,
        autoDispatch: ctx.flags.autoDispatch || false,
        minConfidence: ctx.flags.minConfidence || 0.5,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();

      if (result.detectedTriggers.length === 0) {
        output.writeln(output.dim('No worker triggers detected for this prompt.'));
        return { success: true, data: result };
      }

      output.writeln(output.bold(`Detected Triggers (${result.totalDetected})`));
      output.printTable({
        columns: [
          { key: 'worker', header: 'Worker', width: 15 },
          { key: 'trigger', header: 'Trigger', width: 20 },
          { key: 'confidence', header: 'Confidence', width: 12, align: 'right', format: (v) => `${(Number(v) * 100).toFixed(1)}%` },
          { key: 'reason', header: 'Reason', width: 30 }
        ],
        data: result.detectedTriggers
      });

      if (result.autoDispatched > 0) {
        output.writeln();
        output.printSuccess(`Auto-dispatched ${result.autoDispatched} worker(s)`);
        const dispatched = result.detectedTriggers.filter(t => t.dispatched);
        for (const trigger of dispatched) {
          output.writeln(output.dim(`  ${trigger.worker}: ${trigger.instanceId}`));
        }
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Worker detect failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

const workerCancelCommand: Command = {
  name: 'cancel',
  description: 'Cancel a running worker instance',
  options: [
    { name: 'id', short: 'i', description: 'Worker instance ID to cancel', type: 'string', required: true }
  ],
  examples: [
    { command: 'claude-flow hooks worker cancel -i wk-abc123', description: 'Cancel a worker instance' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const instanceId = ctx.args[0] || ctx.flags.id as string;

    if (!instanceId) {
      output.printError('Instance ID is required. Use --id or -i flag.');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Cancelling worker: ${output.highlight(instanceId)}`);

    try {
      const result = await callMCPTool<{
        instanceId: string; worker: string;
        cancelled: boolean; previousStatus: string;
      }>('hooks_worker-cancel', {
        instanceId,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      if (result.cancelled) {
        output.printSuccess(`Worker cancelled: ${result.worker} (${result.instanceId})`);
        output.writeln(output.dim(`Previous status: ${result.previousStatus}`));
      } else {
        output.printWarning(`Worker could not be cancelled: ${result.instanceId}`);
        output.writeln(output.dim(`Current status: ${result.previousStatus}`));
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Worker cancel failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

export const workerCommand: Command = {
  name: 'worker',
  description: 'Background worker management (12 workers for analysis/optimization)',
  subcommands: [workerListCommand, workerDispatchCommand, workerStatusCommand, workerDetectCommand, workerCancelCommand],
  examples: [
    { command: 'claude-flow hooks worker list', description: 'List all workers' },
    { command: 'claude-flow hooks worker dispatch -t optimize', description: 'Dispatch a worker' },
    { command: 'claude-flow hooks worker status --all', description: 'Check all running workers' },
    { command: 'claude-flow hooks worker detect -p "analyze performance"', description: 'Detect triggers' },
    { command: 'claude-flow hooks worker cancel -i wk-abc123', description: 'Cancel a worker' }
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Background Worker Management'));
    output.writeln();
    output.writeln('12 background workers available for analysis and optimization:');
    output.writeln();
    output.printTable({
      columns: [
        { key: 'name', header: 'Worker', width: 15 },
        { key: 'description', header: 'Description', width: 50 }
      ],
      data: [
        { name: 'ultralearn', description: 'Ultra-fast learning from patterns and outcomes' },
        { name: 'optimize', description: 'Code and performance optimization analysis' },
        { name: 'consolidate', description: 'Consolidate and deduplicate patterns' },
        { name: 'predict', description: 'Predictive analysis for task outcomes' },
        { name: 'audit', description: 'Security and quality audit scanning' },
        { name: 'map', description: 'Codebase structure and dependency mapping' },
        { name: 'preload', description: 'Preload and cache frequently used resources' },
        { name: 'deepdive', description: 'Deep analysis of specific modules or areas' },
        { name: 'document', description: 'Automated documentation generation' },
        { name: 'refactor', description: 'Refactoring opportunity detection' },
        { name: 'benchmark', description: 'Performance benchmarking and profiling' },
        { name: 'testgaps', description: 'Test coverage gap analysis' }
      ]
    });
    output.writeln();
    output.writeln(output.bold('Subcommands'));
    output.writeln();
    output.printList([
      `${output.highlight('list')}      - List all workers and active instances`,
      `${output.highlight('dispatch')}  - Dispatch a worker by trigger`,
      `${output.highlight('status')}    - Check worker instance status`,
      `${output.highlight('detect')}    - Detect worker triggers from prompt text`,
      `${output.highlight('cancel')}    - Cancel a running worker instance`
    ]);
    output.writeln();
    output.writeln(output.dim('Run "claude-flow hooks worker <subcommand> --help" for details.'));

    return { success: true };
  }
};
