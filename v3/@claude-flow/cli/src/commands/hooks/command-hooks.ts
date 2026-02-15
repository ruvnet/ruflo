/**
 * Command hooks - pre-command and post-command commands
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import { callMCPTool, MCPClientError } from '../../mcp-client.js';

// Pre-command subcommand
export const preCommandCommand: Command = {
  name: 'pre-command',
  description: 'Assess risk before executing a command',
  options: [
    {
      name: 'command',
      short: 'c',
      description: 'Command to execute',
      type: 'string',
      required: true
    },
    {
      name: 'dry-run',
      short: 'd',
      description: 'Only analyze, do not execute',
      type: 'boolean',
      default: true
    }
  ],
  examples: [
    { command: 'claude-flow hooks pre-command -c "rm -rf dist"', description: 'Assess command risk' },
    { command: 'claude-flow hooks pre-command -c "npm install lodash"', description: 'Check package install' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const command = ctx.args[0] || ctx.flags.command as string;

    if (!command) {
      output.printError('Command is required. Use --command or -c flag.');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Analyzing command: ${output.highlight(command)}`);

    try {
      // Call MCP tool for pre-command hook
      const result = await callMCPTool<{
        command: string;
        riskLevel: 'low' | 'medium' | 'high' | 'critical';
        risks: Array<{ type: string; severity: string; description: string }>;
        recommendations: string[];
        safeAlternatives?: string[];
        shouldProceed: boolean;
      }>('hooks_pre-command', {
        command,
        includeAlternatives: true,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();

      // Risk level indicator
      let riskIndicator: string;
      switch (result.riskLevel) {
        case 'critical':
          riskIndicator = output.error('CRITICAL');
          break;
        case 'high':
          riskIndicator = output.error('HIGH');
          break;
        case 'medium':
          riskIndicator = output.warning('MEDIUM');
          break;
        default:
          riskIndicator = output.success('LOW');
      }

      output.printBox(
        [
          `Risk Level: ${riskIndicator}`,
          `Should Proceed: ${result.shouldProceed ? output.success('Yes') : output.error('No')}`
        ].join('\n'),
        'Risk Assessment'
      );

      if (result.risks.length > 0) {
        output.writeln();
        output.writeln(output.bold('Identified Risks'));
        output.printTable({
          columns: [
            { key: 'type', header: 'Type', width: 15 },
            { key: 'severity', header: 'Severity', width: 10 },
            { key: 'description', header: 'Description', width: 40 }
          ],
          data: result.risks
        });
      }

      if (result.safeAlternatives && result.safeAlternatives.length > 0) {
        output.writeln();
        output.writeln(output.bold('Safe Alternatives'));
        output.printList(result.safeAlternatives.map(a => output.success(a)));
      }

      if (result.recommendations.length > 0) {
        output.writeln();
        output.writeln(output.bold('Recommendations'));
        output.printList(result.recommendations);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Pre-command hook failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Post-command subcommand
export const postCommandCommand: Command = {
  name: 'post-command',
  description: 'Record command execution outcome',
  options: [
    {
      name: 'command',
      short: 'c',
      description: 'Command that was executed',
      type: 'string',
      required: true
    },
    {
      name: 'success',
      short: 's',
      description: 'Whether the command succeeded',
      type: 'boolean',
      required: true
    },
    {
      name: 'exit-code',
      short: 'e',
      description: 'Command exit code',
      type: 'number',
      default: 0
    },
    {
      name: 'duration',
      short: 'd',
      description: 'Execution duration in milliseconds',
      type: 'number'
    }
  ],
  examples: [
    { command: 'claude-flow hooks post-command -c "npm test" --success true', description: 'Record successful test run' },
    { command: 'claude-flow hooks post-command -c "npm build" --success false -e 1', description: 'Record failed build' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const command = ctx.args[0] || ctx.flags.command as string;
    const success = ctx.flags.success as boolean;

    if (!command) {
      output.printError('Command is required. Use --command or -c flag.');
      return { success: false, exitCode: 1 };
    }

    if (success === undefined) {
      output.printError('Success flag is required. Use --success true/false.');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Recording command outcome: ${output.highlight(command)}`);

    try {
      // Call MCP tool for post-command hook
      const result = await callMCPTool<{
        command: string;
        success: boolean;
        recorded: boolean;
        learningUpdates: {
          commandPatternsUpdated: number;
          riskAssessmentUpdated: boolean;
        };
      }>('hooks_post-command', {
        command,
        success,
        exitCode: ctx.flags.exitCode || 0,
        duration: ctx.flags.duration,
        timestamp: Date.now(),
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.printSuccess('Command outcome recorded');

      if (result.learningUpdates) {
        output.writeln();
        output.writeln(output.dim(`Patterns updated: ${result.learningUpdates.commandPatternsUpdated}`));
        output.writeln(output.dim(`Risk assessment: ${result.learningUpdates.riskAssessmentUpdated ? 'Updated' : 'No change'}`));
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Post-command hook failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};
