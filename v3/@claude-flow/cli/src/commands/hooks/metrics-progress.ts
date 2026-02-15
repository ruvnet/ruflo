/**
 * Metrics and progress hooks
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import { callMCPTool, MCPClientError } from '../../mcp-client.js';

// Metrics subcommand
export const metricsCommand: Command = {
  name: 'metrics',
  description: 'View learning metrics dashboard',
  options: [
    {
      name: 'period',
      short: 'p',
      description: 'Time period (1h, 24h, 7d, 30d, all)',
      type: 'string',
      default: '24h'
    },
    {
      name: 'v3-dashboard',
      description: 'Show V3 performance dashboard',
      type: 'boolean',
      default: false
    },
    {
      name: 'category',
      short: 'c',
      description: 'Metric category (patterns, agents, commands, performance)',
      type: 'string'
    }
  ],
  examples: [
    { command: 'claude-flow hooks metrics', description: 'View 24h metrics' },
    { command: 'claude-flow hooks metrics --period 7d --v3-dashboard', description: 'V3 metrics for 7 days' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const period = ctx.flags.period as string || '24h';
    const v3Dashboard = ctx.flags.v3Dashboard as boolean;

    output.writeln();
    output.writeln(output.bold(`Learning Metrics Dashboard (${period})`));
    output.writeln();

    try {
      // Call MCP tool for metrics
      const result = await callMCPTool<{
        period: string;
        patterns: {
          total: number;
          successful: number;
          failed: number;
          avgConfidence: number;
        };
        agents: {
          routingAccuracy: number;
          totalRoutes: number;
          topAgent: string;
        };
        commands: {
          totalExecuted: number;
          successRate: number;
          avgRiskScore: number;
        };
        performance: {
          flashAttention: string;
          memoryReduction: string;
          searchImprovement: string;
          tokenReduction: string;
        };
      }>('hooks_metrics', {
        period,
        includeV3: v3Dashboard,
        category: ctx.flags.category,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      // Patterns section
      output.writeln(output.bold('Pattern Learning'));
      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 25 },
          { key: 'value', header: 'Value', width: 20, align: 'right' }
        ],
        data: [
          { metric: 'Total Patterns', value: result.patterns.total },
          { metric: 'Successful', value: output.success(String(result.patterns.successful)) },
          { metric: 'Failed', value: output.error(String(result.patterns.failed)) },
          { metric: 'Avg Confidence', value: `${(result.patterns.avgConfidence * 100).toFixed(1)}%` }
        ]
      });

      output.writeln();

      // Agent routing section
      output.writeln(output.bold('Agent Routing'));
      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 25 },
          { key: 'value', header: 'Value', width: 20, align: 'right' }
        ],
        data: [
          { metric: 'Routing Accuracy', value: `${(result.agents.routingAccuracy * 100).toFixed(1)}%` },
          { metric: 'Total Routes', value: result.agents.totalRoutes },
          { metric: 'Top Agent', value: output.highlight(result.agents.topAgent) }
        ]
      });

      output.writeln();

      // Command execution section
      output.writeln(output.bold('Command Execution'));
      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 25 },
          { key: 'value', header: 'Value', width: 20, align: 'right' }
        ],
        data: [
          { metric: 'Total Executed', value: result.commands.totalExecuted },
          { metric: 'Success Rate', value: `${(result.commands.successRate * 100).toFixed(1)}%` },
          { metric: 'Avg Risk Score', value: result.commands.avgRiskScore.toFixed(2) }
        ]
      });

      if (v3Dashboard && result.performance) {
        output.writeln();
        output.writeln(output.bold('V3 Performance Gains'));
        output.printList([
          `Flash Attention: ${output.success(result.performance.flashAttention)}`,
          `Memory Reduction: ${output.success(result.performance.memoryReduction)}`,
          `Search Improvement: ${output.success(result.performance.searchImprovement)}`,
          `Token Reduction: ${output.success(result.performance.tokenReduction)}`
        ]);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Metrics error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Progress hook command
export const progressHookCommand: Command = {
  name: 'progress',
  description: 'Check V3 implementation progress via hooks',
  options: [
    {
      name: 'detailed',
      short: 'd',
      description: 'Show detailed breakdown by category',
      type: 'boolean',
      default: false
    },
    {
      name: 'sync',
      short: 's',
      description: 'Sync and persist progress to file',
      type: 'boolean',
      default: false
    },
    {
      name: 'summary',
      description: 'Show human-readable summary',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'claude-flow hooks progress', description: 'Check current progress' },
    { command: 'claude-flow hooks progress -d', description: 'Detailed breakdown' },
    { command: 'claude-flow hooks progress --sync', description: 'Sync progress to file' },
    { command: 'claude-flow hooks progress --summary', description: 'Human-readable summary' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const detailed = ctx.flags.detailed as boolean;
    const sync = ctx.flags.sync as boolean;
    const summary = ctx.flags.summary as boolean;

    try {
      if (summary) {
        const spinner = output.createSpinner({ text: 'Getting progress summary...' });
        spinner.start();
        const result = await callMCPTool<{ summary: string }>('progress_summary', {});
        spinner.stop();

        if (ctx.flags.format === 'json') {
          output.printJson(result);
          return { success: true, data: result };
        }

        output.writeln();
        output.writeln(result.summary);
        return { success: true, data: result };
      }

      if (sync) {
        const spinner = output.createSpinner({ text: 'Syncing progress...' });
        spinner.start();
        const result = await callMCPTool<{
          progress: number;
          message: string;
          persisted: boolean;
          lastUpdated: string;
        }>('progress_sync', {});
        spinner.stop();

        if (ctx.flags.format === 'json') {
          output.printJson(result);
          return { success: true, data: result };
        }

        output.writeln();
        output.printSuccess(`Progress synced: ${result.progress}%`);
        output.writeln(output.dim(`  Persisted to .claude-flow/metrics/v3-progress.json`));
        output.writeln(output.dim(`  Last updated: ${result.lastUpdated}`));
        return { success: true, data: result };
      }

      // Default: check progress
      const spinner = output.createSpinner({ text: 'Checking V3 progress...' });
      spinner.start();
      const result = await callMCPTool<{
        progress?: number;
        overall?: number;
        summary?: string;
        breakdown?: Record<string, string>;
        cli?: { progress: number; commands: number; target: number };
        mcp?: { progress: number; tools: number; target: number };
        hooks?: { progress: number; subcommands: number; target: number };
        packages?: { progress: number; total: number; target: number; withDDD: number };
        ddd?: { progress: number };
        codebase?: { totalFiles: number; totalLines: number };
        lastUpdated?: string;
      }>('progress_check', { detailed });
      spinner.stop();

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      const progressValue = result.overall ?? result.progress ?? 0;

      // Create progress bar
      const barWidth = 30;
      const filled = Math.round((progressValue / 100) * barWidth);
      const empty = barWidth - filled;
      const bar = output.success('\u2588'.repeat(filled)) + output.dim('\u2591'.repeat(empty));

      output.writeln(output.bold('V3 Implementation Progress'));
      output.writeln();
      output.writeln(`[${bar}] ${progressValue}%`);
      output.writeln();

      if (detailed && result.cli) {
        output.writeln(output.highlight('CLI Commands:') + `     ${result.cli.progress}% (${result.cli.commands}/${result.cli.target})`);
        output.writeln(output.highlight('MCP Tools:') + `        ${result.mcp?.progress ?? 0}% (${result.mcp?.tools ?? 0}/${result.mcp?.target ?? 0})`);
        output.writeln(output.highlight('Hooks:') + `            ${result.hooks?.progress ?? 0}% (${result.hooks?.subcommands ?? 0}/${result.hooks?.target ?? 0})`);
        output.writeln(output.highlight('Packages:') + `         ${result.packages?.progress ?? 0}% (${result.packages?.total ?? 0}/${result.packages?.target ?? 0})`);
        output.writeln(output.highlight('DDD Structure:') + `    ${result.ddd?.progress ?? 0}% (${result.packages?.withDDD ?? 0}/${result.packages?.total ?? 0})`);
        output.writeln();
        if (result.codebase) {
          output.writeln(output.dim(`Codebase: ${result.codebase.totalFiles} files, ${result.codebase.totalLines.toLocaleString()} lines`));
        }
      } else if (result.breakdown) {
        output.writeln('Breakdown:');
        for (const [category, value] of Object.entries(result.breakdown)) {
          output.writeln(`  ${output.highlight(category)}: ${value}`);
        }
      }

      if (result.lastUpdated) {
        output.writeln(output.dim(`Last updated: ${result.lastUpdated}`));
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Progress check failed: ${error.message}`);
      } else {
        output.printError(`Progress check failed: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};
