/**
 * Intelligence hooks - RuVector intelligence system management
 * Handles Pattern (SoNA), MoE, HNSW, and embedding components
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import { confirm } from '../../prompt.js';
import { callMCPTool, MCPClientError } from '../../mcp-client.js';

/**
 * Intelligence result shape returned from the MCP tool
 */
interface IntelligenceResult {
  mode: string;
  status: string;
  components: {
    sona: {
      status: string;
      patterns: number;
      accuracy: number;
      lastUpdated: string;
    };
    moe: {
      status: string;
      experts: number;
      activeExperts: number;
      gatingAccuracy: number;
    };
    hnsw: {
      status: string;
      vectors: number;
      dimensions: number;
      searchLatencyMs: number;
      speedup: string;
    };
    embeddings: {
      status: string;
      provider: string;
      model: string;
      indexed: number;
      dimensions: number;
    };
  };
  performance: {
    flashAttention: string;
    memoryReduction: string;
    searchSpeedup: string;
    tokenReduction: string;
    moeSpeedup: string;
  };
  lastTrainingMs: number;
}

/**
 * Format intelligence component status with appropriate coloring.
 *
 * Maps status strings to output formatting:
 * - 'active' / 'ready' -> output.success (green)
 * - 'training'         -> output.highlight (cyan bold)
 * - 'idle'             -> output.dim (dimmed)
 * - 'disabled' / 'error' -> output.error (red)
 * - anything else      -> plain string
 */
export function formatIntelligenceStatus(status: string): string {
  switch (status) {
    case 'active':
    case 'ready':
      return output.success(status);
    case 'training':
      return output.highlight(status);
    case 'idle':
      return output.dim(status);
    case 'disabled':
    case 'error':
      return output.error(status);
    default:
      return status;
  }
}

// Intelligence subcommand
export const intelligenceCommand: Command = {
  name: 'intelligence',
  description: 'RuVector intelligence system (Pattern, MoE, HNSW 150x faster)',
  options: [
    {
      name: 'mode',
      short: 'm',
      description: 'Intelligence mode',
      type: 'string',
      default: 'balanced',
      choices: ['real-time', 'batch', 'edge', 'research', 'balanced']
    },
    {
      name: 'enable-sona',
      description: 'Enable SoNA pattern component',
      type: 'boolean',
      default: true
    },
    {
      name: 'enable-moe',
      description: 'Enable Mixture-of-Experts component',
      type: 'boolean',
      default: true
    },
    {
      name: 'enable-hnsw',
      description: 'Enable HNSW vector search component',
      type: 'boolean',
      default: true
    },
    {
      name: 'status',
      short: 's',
      description: 'Show intelligence system status',
      type: 'boolean',
      default: false
    },
    {
      name: 'train',
      short: 't',
      description: 'Trigger training cycle',
      type: 'boolean',
      default: false
    },
    {
      name: 'reset',
      description: 'Reset intelligence system state',
      type: 'boolean',
      default: false
    },
    {
      name: 'embedding-provider',
      description: 'Embedding provider to use',
      type: 'string',
      default: 'onnx'
    }
  ],
  examples: [
    { command: 'claude-flow hooks intelligence --status', description: 'Show intelligence status' },
    { command: 'claude-flow hooks intelligence --mode real-time', description: 'Switch to real-time mode' },
    { command: 'claude-flow hooks intelligence --train', description: 'Trigger training cycle' },
    { command: 'claude-flow hooks intelligence --reset', description: 'Reset intelligence state' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Handle reset flow separately
    if (ctx.flags.reset) {
      const confirmed = await confirm({
        message: 'Are you sure you want to reset the intelligence system? This will clear all learned patterns.',
        default: false
      });

      if (!confirmed) {
        output.printInfo('Reset cancelled.');
        return { success: false, message: 'Reset cancelled by user' };
      }

      try {
        const result = await callMCPTool<{ success: boolean; message: string }>(
          'hooks_intelligence-reset',
          {}
        );

        output.printSuccess(result.message || 'Intelligence system reset successfully.');
        return { success: true, data: result };
      } catch (error) {
        if (error instanceof MCPClientError) {
          output.printError(`Intelligence reset failed: ${error.message}`);
        } else {
          output.printError(`Unexpected error: ${String(error)}`);
        }
        return { success: false, exitCode: 1 };
      }
    }

    // Standard intelligence flow
    const mode = (ctx.flags.mode || ctx.flags.m || 'balanced') as string;
    const enableSona = ctx.flags['enable-sona'] !== false && ctx.flags.enableSona !== false;
    const enableMoe = ctx.flags['enable-moe'] !== false && ctx.flags.enableMoe !== false;
    const enableHnsw = ctx.flags['enable-hnsw'] !== false && ctx.flags.enableHnsw !== false;
    const embeddingProvider = (ctx.flags['embedding-provider'] || ctx.flags.embeddingProvider || 'onnx') as string;

    const spinner = output.createSpinner({ text: 'Initializing intelligence system...', spinner: 'dots' });

    try {
      spinner.start();

      const result = await callMCPTool<IntelligenceResult>('hooks_intelligence', {
        mode,
        enableSona,
        enableMoe,
        enableHnsw,
        status: ctx.flags.status || false,
        train: ctx.flags.train || false,
        embeddingProvider,
      });

      spinner.succeed('Intelligence system ready');

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold(`Intelligence System (${result.mode} mode)`));
      output.writeln(`Status: ${formatIntelligenceStatus(result.status)}`);
      output.writeln();

      // Pattern (SoNA) component table
      output.writeln(output.bold('Pattern Component (SoNA)'));
      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 25 },
          { key: 'value', header: 'Value', width: 25, align: 'right' }
        ],
        data: [
          { metric: 'Status', value: formatIntelligenceStatus(result.components.sona.status) },
          { metric: 'Patterns Learned', value: result.components.sona.patterns },
          { metric: 'Accuracy', value: `${(result.components.sona.accuracy * 100).toFixed(1)}%` },
          { metric: 'Last Updated', value: result.components.sona.lastUpdated }
        ]
      });

      output.writeln();

      // MoE component table
      output.writeln(output.bold('Mixture-of-Experts (MoE)'));
      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 25 },
          { key: 'value', header: 'Value', width: 25, align: 'right' }
        ],
        data: [
          { metric: 'Status', value: formatIntelligenceStatus(result.components.moe.status) },
          { metric: 'Total Experts', value: result.components.moe.experts },
          { metric: 'Active Experts', value: result.components.moe.activeExperts },
          { metric: 'Gating Accuracy', value: `${(result.components.moe.gatingAccuracy * 100).toFixed(1)}%` }
        ]
      });

      output.writeln();

      // HNSW component table
      output.writeln(output.bold('HNSW Vector Search'));
      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 25 },
          { key: 'value', header: 'Value', width: 25, align: 'right' }
        ],
        data: [
          { metric: 'Status', value: formatIntelligenceStatus(result.components.hnsw.status) },
          { metric: 'Vectors Indexed', value: result.components.hnsw.vectors },
          { metric: 'Dimensions', value: result.components.hnsw.dimensions },
          { metric: 'Search Latency', value: `${result.components.hnsw.searchLatencyMs.toFixed(3)}ms` },
          { metric: 'Speedup', value: output.success(result.components.hnsw.speedup) }
        ]
      });

      output.writeln();

      // Embeddings table
      output.writeln(output.bold('Embeddings'));
      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 25 },
          { key: 'value', header: 'Value', width: 25, align: 'right' }
        ],
        data: [
          { metric: 'Status', value: formatIntelligenceStatus(result.components.embeddings.status) },
          { metric: 'Provider', value: result.components.embeddings.provider },
          { metric: 'Model', value: result.components.embeddings.model },
          { metric: 'Documents Indexed', value: result.components.embeddings.indexed },
          { metric: 'Dimensions', value: result.components.embeddings.dimensions }
        ]
      });

      output.writeln();

      // V3 Performance Gains list
      output.writeln(output.bold('V3 Performance Gains'));
      output.printList([
        `Flash Attention: ${output.success(result.performance.flashAttention)}`,
        `Memory Reduction: ${output.success(result.performance.memoryReduction)}`,
        `Search Speedup: ${output.success(result.performance.searchSpeedup)}`,
        `Token Reduction: ${output.success(result.performance.tokenReduction)}`,
        `MoE Speedup: ${output.success(result.performance.moeSpeedup)}`
      ]);

      if (result.lastTrainingMs > 0) {
        output.writeln();
        output.writeln(output.dim(`Last training completed in ${(result.lastTrainingMs / 1000).toFixed(1)}s`));
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Intelligence system initialization failed');
      if (error instanceof MCPClientError) {
        output.printError(`Intelligence error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};
