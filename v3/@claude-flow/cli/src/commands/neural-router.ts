import type { Command, CommandResult } from '../types.js';
import { output } from '../output.js';
import { routerStatusCommand } from './neural-router/status.js';
import { routerTrainCommand } from './neural-router/train.js';
import { routerTrainFromTrajectoriesCommand } from './neural-router/train-from-trajectories.js';
import { routerReloadCommand } from './neural-router/reload.js';
import { routerModelsCommand } from './neural-router/models.js';
import { routerDecisionsCommand } from './neural-router/decisions.js';
import { routerDecideCommand } from './neural-router/decide.js';
import { routerCostSavingsCommand } from './neural-router/cost-savings.js';
import { routerTrajectoryHealthCommand } from './neural-router/trajectory-health.js';
import { routerConfigCommand } from './neural-router/config.js';
import { routerCompareModesCommand } from './neural-router/compare-modes.js';
import { routerStatsSummaryCommand } from './neural-router/stats-summary.js';
import { routerBanditStateCommand } from './neural-router/bandit-state.js';
import { routerAbStatsCommand } from './neural-router/ab-stats.js';
import { routerPricesCommand } from './neural-router/prices.js';
import { routerCostProjectionCommand } from './neural-router/cost-projection.js';

export const routerCommand: Command = {
  name: 'router',
  description: 'Cost-optimal neural router lifecycle (ADR-148/149): status, models, prices, config, train, train-from-trajectories, decide, compare-modes, decisions, cost-savings, cost-projection, trajectory-health, ab-stats, bandit-state, stats-summary, reload',
  subcommands: [routerStatusCommand, routerModelsCommand, routerPricesCommand, routerConfigCommand, routerTrainCommand, routerTrainFromTrajectoriesCommand, routerDecideCommand, routerCompareModesCommand, routerDecisionsCommand, routerCostSavingsCommand, routerCostProjectionCommand, routerTrajectoryHealthCommand, routerAbStatsCommand, routerBanditStateCommand, routerStatsSummaryCommand, routerReloadCommand],
  examples: [
    { command: 'claude-flow neural router status', description: 'Show router state, gate, counters' },
    { command: 'claude-flow neural router models', description: 'List candidate registry with measured stats (ADR-149)' },
    { command: 'claude-flow neural router prices', description: 'Show the canonical $/Mtok price table (iter 43)' },
    { command: 'claude-flow neural router config', description: 'Inventory all CLAUDE_FLOW_ROUTER_* env vars (iter 54)' },
    { command: 'claude-flow neural router train -o ./router.krr.json', description: 'Train a KRR artifact' },
    { command: 'claude-flow neural router train-from-trajectories -w production-rows.json', description: 'Pair production JSONL into a training corpus (iter 18)' },
    { command: 'claude-flow neural router decide "fix typo in cache.ts"', description: 'Inspect decision for a hypothetical task (iter 30)' },
    { command: 'claude-flow neural router compare-modes "task" --ceiling 5', description: 'Compare cost-optimal vs cost-ceiling side-by-side (iter 55)' },
    { command: 'claude-flow neural router decisions --since 24h', description: 'Query recorded decisions (iter 28)' },
    { command: 'claude-flow neural router cost-savings --since 7d', description: 'Actual vs heuristic-counterfactual spend (iter 32)' },
    { command: 'claude-flow neural router trajectory-health', description: 'JSONL log health: size, rotations, parse + pair-join rate (iter 36)' },
    { command: 'claude-flow neural router ab-stats', description: 'A/B disagreement matrix from sampled ab_pair (iter 37/38)' },
    { command: 'claude-flow neural router bandit-state', description: 'Persisted Beta priors per (bucket × model) (iter 48)' },
    { command: 'claude-flow neural router stats-summary', description: 'One-screen SRE dashboard (iter 49)' },
    { command: 'claude-flow neural router cost-projection', description: 'Project monthly/quarterly spend from measured rate (iter 41)' },
    { command: 'claude-flow neural router reload', description: 'Clear in-process backend cache' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln('Use a subcommand: status | models | prices | config | train | train-from-trajectories | decide | compare-modes | decisions | cost-savings | cost-projection | trajectory-health | ab-stats | bandit-state | stats-summary | reload');
    return { success: true };
  },
};
