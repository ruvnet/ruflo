/**
 * Coverage-aware routing commands
 * Routes tasks, suggests improvements, and lists gaps based on test coverage data.
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import { callMCPTool, MCPClientError } from '../../mcp-client.js';

/** Truncate a file path to fit a column, preserving the tail for readability. */
function truncatePath(s: string, maxLen: number = 32): string {
  return s.length > maxLen ? '...' + s.slice(-maxLen) : s;
}

/** Format severity/priority with appropriate color. */
function formatSeverity(value: unknown): string {
  const s = String(value);
  if (s === 'critical') return output.error(s.toUpperCase());
  if (s === 'high') return output.warning(s.toUpperCase());
  return s.toUpperCase();
}

/** Handle errors consistently across all coverage commands. */
function handleError(label: string, error: unknown): CommandResult {
  if (error instanceof MCPClientError) {
    output.printError(`${label}: ${error.message}`);
  } else {
    output.printError(`Unexpected error: ${String(error)}`);
  }
  return { success: false, exitCode: 1 };
}

// Coverage route subcommand
export const coverageRouteCommand: Command = {
  name: 'coverage-route',
  description: 'Route task based on test coverage gaps',
  options: [
    { name: 'task', short: 't', description: 'Task description to route', type: 'string', required: true },
    { name: 'threshold', description: 'Minimum coverage threshold percentage', type: 'number', default: 80 },
    { name: 'no-vector', description: 'Disable vector-based routing', type: 'boolean', default: false },
  ],
  examples: [
    { command: 'claude-flow hooks coverage-route -t "Add error handling to auth module"', description: 'Route task using coverage gaps' },
    { command: 'claude-flow hooks coverage-route -t "Refactor parser" --threshold 90', description: 'Route with higher threshold' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const task = ctx.args[0] || (ctx.flags.task as string);
    const threshold = (ctx.flags.threshold as number) || 80;
    const noVector = ctx.flags.noVector as boolean;

    if (!task) {
      output.printError('Task description is required. Use --task or -t flag.');
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: 'Analyzing coverage for routing...' });
    spinner.start();

    try {
      const result = await callMCPTool<{
        task: string;
        routing: { agent: string; confidence: number; reason: string; coverageDriven: boolean };
        coverageGaps: Array<{
          file: string; coverage: number;
          priority: 'critical' | 'high' | 'medium' | 'low'; uncoveredLines: number;
        }>;
        metrics: { overallCoverage: number; filesCovered: number; filesTotal: number; threshold: number };
        suggestions: string[];
      }>('hooks_coverage-route', { task, threshold, useVector: !noVector });

      spinner.succeed('Coverage analysis complete');

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      // Routing box
      output.writeln();
      output.printBox(
        [
          `Task: ${output.highlight(result.task)}`,
          `Agent: ${output.highlight(result.routing.agent)}`,
          `Confidence: ${(result.routing.confidence * 100).toFixed(1)}%`,
          `Reason: ${result.routing.reason}`,
          `Coverage-Driven: ${result.routing.coverageDriven ? output.success('Yes') : 'No'}`,
        ].join('\n'),
        'Coverage-Aware Routing'
      );

      // Priority coverage gaps table
      if (result.coverageGaps.length > 0) {
        output.writeln();
        output.writeln(output.bold('Priority Coverage Gaps'));
        output.printTable({
          columns: [
            { key: 'file', header: 'File', width: 38, format: (v) => truncatePath(String(v ?? ''), 32) },
            { key: 'coverage', header: 'Coverage', width: 12, align: 'right', format: (v) => `${Number(v).toFixed(1)}%` },
            { key: 'priority', header: 'Priority', width: 12, format: formatSeverity },
            { key: 'uncoveredLines', header: 'Uncovered', width: 12, align: 'right', format: (v) => `${Number(v)} lines` },
          ],
          data: result.coverageGaps,
        });
      }

      // Coverage metrics
      output.writeln();
      output.writeln(output.bold('Coverage Metrics'));
      const covPct = result.metrics.overallCoverage.toFixed(1) + '%';
      const coverageColor = result.metrics.overallCoverage >= result.metrics.threshold
        ? output.success(covPct) : output.error(covPct);
      output.printList([
        `Overall Coverage: ${coverageColor}`,
        `Files Covered: ${result.metrics.filesCovered}/${result.metrics.filesTotal}`,
        `Threshold: ${result.metrics.threshold}%`,
      ]);

      // Suggestions
      if (result.suggestions.length > 0) {
        output.writeln();
        output.writeln(output.bold('Suggestions'));
        output.printNumberedList(result.suggestions);
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Coverage routing failed');
      return handleError('Coverage routing failed', error);
    }
  },
};

// Coverage suggest subcommand
export const coverageSuggestCommand: Command = {
  name: 'coverage-suggest',
  description: 'Suggest coverage improvements for a path',
  options: [
    { name: 'path', short: 'p', description: 'File or directory path to analyze', type: 'string', required: true },
    { name: 'threshold', description: 'Minimum coverage threshold percentage', type: 'number', default: 80 },
    { name: 'limit', short: 'l', description: 'Maximum number of suggestions', type: 'number', default: 20 },
  ],
  examples: [
    { command: 'claude-flow hooks coverage-suggest -p src/auth', description: 'Suggest improvements for auth module' },
    { command: 'claude-flow hooks coverage-suggest -p src/ --threshold 90 -l 10', description: 'Top 10 suggestions at 90% threshold' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetPath = ctx.args[0] || (ctx.flags.path as string);
    const threshold = (ctx.flags.threshold as number) || 80;
    const limit = (ctx.flags.limit as number) || 20;

    if (!targetPath) {
      output.printError('Path is required. Use --path or -p flag.');
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: 'Analyzing coverage suggestions...' });
    spinner.start();

    try {
      const result = await callMCPTool<{
        path: string;
        summary: { totalFiles: number; coveredFiles: number; averageCoverage: number; belowThreshold: number };
        suggestions: Array<{
          file: string; currentCoverage: number; targetCoverage: number;
          suggestion: string; effort: 'low' | 'medium' | 'high'; impact: 'low' | 'medium' | 'high';
        }>;
        priorityFiles: Array<{ file: string; coverage: number; reason: string }>;
      }>('hooks_coverage-suggest', { path: targetPath, threshold, limit });

      spinner.succeed('Coverage analysis complete');

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      // Coverage summary box
      output.writeln();
      const avgPct = result.summary.averageCoverage.toFixed(1) + '%';
      const avgColor = result.summary.averageCoverage >= threshold
        ? output.success(avgPct) : output.warning(avgPct);
      output.printBox(
        [
          `Path: ${output.highlight(result.path)}`,
          `Total Files: ${result.summary.totalFiles}`,
          `Covered Files: ${result.summary.coveredFiles}`,
          `Average Coverage: ${avgColor}`,
          `Below Threshold: ${result.summary.belowThreshold > 0 ? output.error(String(result.summary.belowThreshold)) : '0'}`,
        ].join('\n'),
        'Coverage Summary'
      );

      // Suggestions table
      if (result.suggestions.length > 0) {
        output.writeln();
        output.writeln(output.bold('Coverage Suggestions'));
        output.printTable({
          columns: [
            { key: 'file', header: 'File', width: 35, format: (v) => truncatePath(String(v ?? ''), 32) },
            { key: 'currentCoverage', header: 'Current', width: 10, align: 'right', format: (v) => `${Number(v).toFixed(1)}%` },
            { key: 'targetCoverage', header: 'Target', width: 10, align: 'right', format: (v) => `${Number(v).toFixed(1)}%` },
            {
              key: 'effort', header: 'Effort', width: 8,
              format: (v) => {
                const e = String(v);
                if (e === 'low') return output.success(e);
                if (e === 'high') return output.error(e);
                return output.warning(e);
              },
            },
            {
              key: 'impact', header: 'Impact', width: 8,
              format: (v) => {
                const i = String(v);
                if (i === 'high') return output.success(i);
                if (i === 'low') return output.warning(i);
                return i;
              },
            },
            { key: 'suggestion', header: 'Suggestion', width: 30 },
          ],
          data: result.suggestions,
        });
      }

      // Priority files
      if (result.priorityFiles.length > 0) {
        output.writeln();
        output.writeln(output.bold('Priority Files'));
        output.printNumberedList(
          result.priorityFiles.map(
            (f) => `${truncatePath(f.file, 32)} (${f.coverage.toFixed(1)}%) - ${f.reason}`
          )
        );
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Coverage suggestion failed');
      return handleError('Coverage suggestion failed', error);
    }
  },
};

// Coverage gaps subcommand
export const coverageGapsCommand: Command = {
  name: 'coverage-gaps',
  description: 'List all coverage gaps below threshold',
  options: [
    { name: 'threshold', description: 'Minimum coverage threshold percentage', type: 'number', default: 80 },
    { name: 'group-by-agent', description: 'Group gaps by recommended agent type', type: 'boolean', default: true },
    { name: 'critical-only', description: 'Show only critical coverage gaps', type: 'boolean', default: false },
  ],
  examples: [
    { command: 'claude-flow hooks coverage-gaps', description: 'List all coverage gaps' },
    { command: 'claude-flow hooks coverage-gaps --threshold 90 --critical-only', description: 'Only critical gaps at 90% threshold' },
    { command: 'claude-flow hooks coverage-gaps --no-group-by-agent', description: 'Flat list without agent grouping' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const threshold = (ctx.flags.threshold as number) || 80;
    const groupByAgent = ctx.flags.groupByAgent !== false;
    const criticalOnly = ctx.flags.criticalOnly as boolean;

    const spinner = output.createSpinner({ text: 'Scanning for coverage gaps...' });
    spinner.start();

    try {
      const result = await callMCPTool<{
        threshold: number;
        totalGaps: number;
        gaps: Array<{
          file: string; coverage: number;
          severity: 'critical' | 'high' | 'medium' | 'low';
          uncoveredLines: number; recommendedAgent: string;
        }>;
        agentGroups: Record<string, Array<{
          file: string; coverage: number;
          severity: 'critical' | 'high' | 'medium' | 'low'; uncoveredLines: number;
        }>>;
        summary: { critical: number; high: number; medium: number; low: number; averageCoverage: number };
      }>('hooks_coverage-gaps', { threshold, groupByAgent, criticalOnly });

      spinner.succeed(`Found ${result.totalGaps} coverage gap${result.totalGaps !== 1 ? 's' : ''}`);

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      // Coverage gap analysis box
      output.writeln();
      output.printBox(
        [
          `Threshold: ${result.threshold}%`,
          `Total Gaps: ${result.totalGaps}`,
          `Average Coverage: ${result.summary.averageCoverage.toFixed(1)}%`,
          `Critical: ${result.summary.critical > 0 ? output.error(String(result.summary.critical)) : '0'}`,
          `High: ${result.summary.high > 0 ? output.warning(String(result.summary.high)) : '0'}`,
          `Medium: ${result.summary.medium}`,
          `Low: ${result.summary.low}`,
        ].join('\n'),
        'Coverage Gap Analysis'
      );

      // Gaps table
      if (result.gaps.length > 0) {
        output.writeln();
        output.writeln(output.bold('Coverage Gaps'));
        output.printTable({
          columns: [
            { key: 'file', header: 'File', width: 35, format: (v) => truncatePath(String(v ?? ''), 32) },
            { key: 'coverage', header: 'Coverage', width: 12, align: 'right', format: (v) => `${Number(v).toFixed(1)}%` },
            { key: 'severity', header: 'Severity', width: 12, format: formatSeverity },
            { key: 'uncoveredLines', header: 'Uncovered', width: 12, align: 'right', format: (v) => `${Number(v)} lines` },
            { key: 'recommendedAgent', header: 'Agent', width: 14, format: (v) => output.highlight(String(v ?? '')) },
          ],
          data: result.gaps,
        });
      }

      // Agent group assignments
      if (groupByAgent && result.agentGroups) {
        const agentNames = Object.keys(result.agentGroups);
        if (agentNames.length > 0) {
          output.writeln();
          output.writeln(output.bold('Agent Assignments'));
          for (const agent of agentNames) {
            const files = result.agentGroups[agent];
            if (files.length === 0) continue;
            output.writeln();
            output.writeln(`  ${output.highlight(agent)} (${files.length} file${files.length !== 1 ? 's' : ''})`);
            for (const f of files) {
              const label = f.severity === 'critical' ? output.error(f.severity)
                : f.severity === 'high' ? output.warning(f.severity) : f.severity;
              output.writeln(`    ${truncatePath(f.file, 32)}  ${f.coverage.toFixed(1)}%  [${label}]`);
            }
          }
        }
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Coverage gap analysis failed');
      return handleError('Coverage gap analysis failed', error);
    }
  },
};
