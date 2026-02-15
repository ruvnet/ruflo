/**
 * Transfer and list hooks
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import { callMCPTool, MCPClientError } from '../../mcp-client.js';
import { storeCommand } from '../transfer-store.js';

// Transfer from project subcommand
const transferFromProjectCommand: Command = {
  name: 'from-project',
  aliases: ['project'],
  description: 'Transfer patterns from another project',
  options: [
    {
      name: 'source',
      short: 's',
      description: 'Source project path',
      type: 'string',
      required: true
    },
    {
      name: 'filter',
      short: 'f',
      description: 'Filter patterns by type',
      type: 'string'
    },
    {
      name: 'min-confidence',
      short: 'm',
      description: 'Minimum confidence threshold (0-1)',
      type: 'number',
      default: 0.7
    }
  ],
  examples: [
    { command: 'claude-flow hooks transfer from-project -s ../old-project', description: 'Transfer all patterns' },
    { command: 'claude-flow hooks transfer from-project -s ../prod --filter security -m 0.9', description: 'Transfer high-confidence security patterns' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const sourcePath = ctx.args[0] || ctx.flags.source as string;
    const minConfidence = ctx.flags.minConfidence as number || 0.7;

    if (!sourcePath) {
      output.printError('Source project path is required. Use --source or -s flag.');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Transferring patterns from: ${output.highlight(sourcePath)}`);

    const spinner = output.createSpinner({ text: 'Analyzing source patterns...', spinner: 'dots' });

    try {
      spinner.start();

      // Call MCP tool for transfer
      const result = await callMCPTool<{
        sourcePath: string;
        transferred: {
          total: number;
          byType: Record<string, number>;
        };
        skipped: {
          lowConfidence: number;
          duplicates: number;
          conflicts: number;
        };
        stats: {
          avgConfidence: number;
          avgAge: string;
        };
      }>('hooks_transfer', {
        sourcePath,
        filter: ctx.flags.filter,
        minConfidence,
        mergeStrategy: 'keep-highest-confidence',
      });

      spinner.succeed(`Transferred ${result.transferred.total} patterns`);

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Transfer Summary'));
      output.printTable({
        columns: [
          { key: 'category', header: 'Category', width: 25 },
          { key: 'count', header: 'Count', width: 15, align: 'right' }
        ],
        data: [
          { category: 'Total Transferred', count: output.success(String(result.transferred.total)) },
          { category: 'Skipped (Low Confidence)', count: result.skipped.lowConfidence },
          { category: 'Skipped (Duplicates)', count: result.skipped.duplicates },
          { category: 'Skipped (Conflicts)', count: result.skipped.conflicts }
        ]
      });

      if (Object.keys(result.transferred.byType).length > 0) {
        output.writeln();
        output.writeln(output.bold('By Pattern Type'));
        output.printTable({
          columns: [
            { key: 'type', header: 'Type', width: 20 },
            { key: 'count', header: 'Count', width: 15, align: 'right' }
          ],
          data: Object.entries(result.transferred.byType).map(([type, count]) => ({ type, count }))
        });
      }

      output.writeln();
      output.printList([
        `Avg Confidence: ${(result.stats.avgConfidence * 100).toFixed(1)}%`,
        `Avg Age: ${result.stats.avgAge}`
      ]);

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Transfer failed');
      if (error instanceof MCPClientError) {
        output.printError(`Transfer error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Parent transfer command combining all transfer methods
export const transferCommand: Command = {
  name: 'transfer',
  description: 'Transfer patterns and plugins via IPFS-based decentralized registry',
  subcommands: [storeCommand, transferFromProjectCommand],
  examples: [
    { command: 'claude-flow hooks transfer store list', description: 'List patterns from registry' },
    { command: 'claude-flow hooks transfer store search -q routing', description: 'Search patterns' },
    { command: 'claude-flow hooks transfer store download -p seraphine-genesis', description: 'Download pattern' },
    { command: 'claude-flow hooks transfer store publish', description: 'Publish pattern to registry' },
    { command: 'claude-flow hooks transfer from-project -s ../other-project', description: 'Transfer from project' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Pattern Transfer System'));
    output.writeln(output.dim('Decentralized pattern sharing via IPFS'));
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('store')}        - Pattern marketplace (list, search, download, publish)`,
      `${output.highlight('from-project')} - Transfer patterns from another project`,
    ]);
    output.writeln();
    output.writeln(output.bold('IPFS-Based Features:'));
    output.printList([
      'Decentralized registry via IPNS for discoverability',
      'Content-addressed storage for integrity',
      'Ed25519 signatures for verification',
      'Anonymization levels: minimal, standard, strict, paranoid',
      'Trust levels: unverified, community, verified, official',
    ]);
    output.writeln();
    output.writeln('Run "claude-flow hooks transfer <subcommand> --help" for details');
    return { success: true };
  }
};

// List subcommand
export const listCommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List all registered hooks',
  options: [
    {
      name: 'enabled',
      short: 'e',
      description: 'Show only enabled hooks',
      type: 'boolean',
      default: false
    },
    {
      name: 'type',
      short: 't',
      description: 'Filter by hook type',
      type: 'string'
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      // Call MCP tool for list
      const result = await callMCPTool<{
        hooks: Array<{
          name: string;
          type: string;
          enabled: boolean;
          priority: number;
          executionCount: number;
          lastExecuted?: string;
        }>;
        total: number;
      }>('hooks_list', {
        enabled: ctx.flags.enabled || undefined,
        type: ctx.flags.type || undefined,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Registered Hooks'));
      output.writeln();

      if (result.hooks.length === 0) {
        output.printInfo('No hooks found matching criteria');
        return { success: true, data: result };
      }

      output.printTable({
        columns: [
          { key: 'name', header: 'Name', width: 20 },
          { key: 'type', header: 'Type', width: 15 },
          { key: 'enabled', header: 'Enabled', width: 10, format: (v) => v ? output.success('Yes') : output.dim('No') },
          { key: 'priority', header: 'Priority', width: 10, align: 'right' },
          { key: 'executionCount', header: 'Executions', width: 12, align: 'right' },
          { key: 'lastExecuted', header: 'Last Executed', width: 20, format: (v) => v ? new Date(String(v)).toLocaleString() : 'Never' }
        ],
        data: result.hooks
      });

      output.writeln();
      output.printInfo(`Total: ${result.total} hooks`);

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to list hooks: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};
