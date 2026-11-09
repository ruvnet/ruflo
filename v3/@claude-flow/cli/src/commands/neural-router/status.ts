import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

// ============================================================================
// ADR-148 — `neural router` subcommand tree: status / train / reload
// ============================================================================

export const routerStatusCommand: Command = {
  name: 'status',
  description: 'Show the cost-optimal neural router state (ADR-148) — gate, backend, artifact, counters',
  options: [
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router status', description: 'Show router state' },
    { command: 'CLAUDE_FLOW_ROUTER_NEURAL=1 claude-flow neural router status', description: 'Show status with gate open' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const format = (ctx.flags.format as string) || 'table';
    const { neuralRouterStatus } = await import('../../ruvector/neural-router.js');
    const { getModelRouterStats } = await import('../../ruvector/model-router.js');
    const status = await neuralRouterStatus();
    const stats = getModelRouterStats();
    const payload = { neuralRouter: status, modelRouter: stats };
    if (format === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }
    output.writeln();
    output.writeln(output.bold('Cost-Optimal Neural Router (ADR-148)'));
    output.writeln(output.dim('─'.repeat(60)));
    output.writeln(`  Gate (CLAUDE_FLOW_ROUTER_NEURAL=1): ${status.enabled ? output.success('open') : output.warning('closed')}`);
    output.writeln(`  Backend available:                  ${status.available ? output.success('yes') : output.warning('no')}`);
    output.writeln(`  Active backend (routedBy):          ${status.routedBy ?? '—'}`);
    output.writeln(`  Reason:                             ${status.reason}`);
    output.writeln(`  Quality bar:                        ${status.config.qualityBar}`);
    output.writeln(`  Seed corpus path:                   ${status.config.seedCorpusPath}`);
    output.writeln(`  Bundled KRR artifact path:          ${status.config.bundledKrrPath}`);
    output.writeln(`  User artifact (modelPath):          ${status.config.modelPath ?? '—'}`);
    output.writeln();
    output.writeln(output.bold('Counters (process-local since last reset)'));
    output.writeln(output.dim('─'.repeat(60)));
    output.writeln(`  Total decisions:    ${stats.totalDecisions}`);
    output.writeln(`  routedBy:           heuristic=${stats.routedByCounts.heuristic}  hybrid=${stats.routedByCounts.hybrid}  bandit-fallback=${stats.routedByCounts['bandit-fallback']}`);
    output.writeln(`  neuralBackend:      knn=${stats.neuralBackendCounts['metaharness-knn']}  krr=${stats.neuralBackendCounts['metaharness-krr']}  fastgrnn=${stats.neuralBackendCounts.fastgrnn}`);
    output.writeln(`  A/B mode:           ${stats.ab.comparisons} comparisons, ${stats.ab.disagreements} disagreements (${(stats.ab.disagreementRate * 100).toFixed(1)}%)`);
    output.writeln();
    return { success: true, data: payload };
  },
};
