/**
 * Edit hooks - pre-edit and post-edit commands
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import { callMCPTool, MCPClientError } from '../../mcp-client.js';

// Pre-edit subcommand
export const preEditCommand: Command = {
  name: 'pre-edit',
  description: 'Get context and agent suggestions before editing a file',
  options: [
    {
      name: 'file',
      short: 'f',
      description: 'File path to edit',
      type: 'string',
      required: true
    },
    {
      name: 'operation',
      short: 'o',
      description: 'Type of edit operation (create, update, delete, refactor)',
      type: 'string',
      default: 'update'
    },
    {
      name: 'context',
      short: 'c',
      description: 'Additional context about the edit',
      type: 'string'
    }
  ],
  examples: [
    { command: 'claude-flow hooks pre-edit -f src/utils.ts', description: 'Get context before editing' },
    { command: 'claude-flow hooks pre-edit -f src/api.ts -o refactor', description: 'Pre-edit with operation type' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const filePath = ctx.args[0] || ctx.flags.file as string;
    const operation = ctx.flags.operation as string || 'update';

    if (!filePath) {
      output.printError('File path is required. Use --file or -f flag.');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Analyzing context for: ${output.highlight(filePath)}`);

    try {
      // Call MCP tool for pre-edit hook
      const result = await callMCPTool<{
        filePath: string;
        operation: string;
        context: {
          fileExists: boolean;
          fileType: string;
          relatedFiles: string[];
          suggestedAgents: string[];
          patterns: Array<{ pattern: string; confidence: number }>;
          risks: string[];
        };
        recommendations: string[];
      }>('hooks_pre-edit', {
        filePath,
        operation,
        context: ctx.flags.context,
        includePatterns: true,
        includeRisks: true,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.printBox(
        [
          `File: ${result.filePath}`,
          `Operation: ${result.operation}`,
          `Type: ${result.context.fileType}`,
          `Exists: ${result.context.fileExists ? 'Yes' : 'No'}`
        ].join('\n'),
        'File Context'
      );

      if (result.context.suggestedAgents.length > 0) {
        output.writeln();
        output.writeln(output.bold('Suggested Agents'));
        output.printList(result.context.suggestedAgents.map(a => output.highlight(a)));
      }

      if (result.context.relatedFiles.length > 0) {
        output.writeln();
        output.writeln(output.bold('Related Files'));
        output.printList(result.context.relatedFiles.slice(0, 5).map(f => output.dim(f)));
      }

      if (result.context.patterns.length > 0) {
        output.writeln();
        output.writeln(output.bold('Learned Patterns'));
        output.printTable({
          columns: [
            { key: 'pattern', header: 'Pattern', width: 40 },
            { key: 'confidence', header: 'Confidence', width: 12, align: 'right', format: (v) => `${(Number(v) * 100).toFixed(1)}%` }
          ],
          data: result.context.patterns
        });
      }

      if (result.context.risks.length > 0) {
        output.writeln();
        output.writeln(output.bold(output.error('Potential Risks')));
        output.printList(result.context.risks.map(r => output.warning(r)));
      }

      if (result.recommendations.length > 0) {
        output.writeln();
        output.writeln(output.bold('Recommendations'));
        output.printList(result.recommendations.map(r => output.success(`• ${r}`)));
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Pre-edit hook failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Post-edit subcommand
export const postEditCommand: Command = {
  name: 'post-edit',
  description: 'Record editing outcome for learning',
  options: [
    {
      name: 'file',
      short: 'f',
      description: 'File path that was edited',
      type: 'string',
      required: true
    },
    {
      name: 'success',
      short: 's',
      description: 'Whether the edit was successful',
      type: 'boolean',
      required: true
    },
    {
      name: 'outcome',
      short: 'o',
      description: 'Outcome description',
      type: 'string'
    },
    {
      name: 'metrics',
      short: 'm',
      description: 'Performance metrics (e.g., "time:500ms,quality:0.95")',
      type: 'string'
    }
  ],
  examples: [
    { command: 'claude-flow hooks post-edit -f src/utils.ts --success true', description: 'Record successful edit' },
    { command: 'claude-flow hooks post-edit -f src/api.ts --success false -o "Type error"', description: 'Record failed edit' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const filePath = ctx.args[0] || ctx.flags.file as string;
    const success = ctx.flags.success as boolean;

    if (!filePath) {
      output.printError('File path is required. Use --file or -f flag.');
      return { success: false, exitCode: 1 };
    }

    if (success === undefined) {
      output.printError('Success flag is required. Use --success true/false.');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Recording outcome for: ${output.highlight(filePath)}`);

    try {
      // Parse metrics if provided
      const metrics: Record<string, number> = {};
      if (ctx.flags.metrics) {
        const metricsStr = ctx.flags.metrics as string;
        metricsStr.split(',').forEach(pair => {
          const [key, value] = pair.split(':');
          if (key && value) {
            metrics[key.trim()] = parseFloat(value);
          }
        });
      }

      // Call MCP tool for post-edit hook
      const result = await callMCPTool<{
        filePath: string;
        success: boolean;
        recorded: boolean;
        patternId?: string;
        learningUpdates: {
          patternsUpdated: number;
          confidenceAdjusted: number;
          newPatterns: number;
        };
      }>('hooks_post-edit', {
        filePath,
        success,
        outcome: ctx.flags.outcome,
        metrics,
        timestamp: Date.now(),
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.printSuccess(`Outcome recorded for ${filePath}`);

      if (result.learningUpdates) {
        output.writeln();
        output.writeln(output.bold('Learning Updates'));
        output.printTable({
          columns: [
            { key: 'metric', header: 'Metric', width: 25 },
            { key: 'value', header: 'Value', width: 15, align: 'right' }
          ],
          data: [
            { metric: 'Patterns Updated', value: result.learningUpdates.patternsUpdated },
            { metric: 'Confidence Adjusted', value: result.learningUpdates.confidenceAdjusted },
            { metric: 'New Patterns', value: result.learningUpdates.newPatterns }
          ]
        });
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Post-edit hook failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};
