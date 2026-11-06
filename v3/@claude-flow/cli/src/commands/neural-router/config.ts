import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

// ADR-149 iter 54 — consolidated env-var inspection. The router has ~15
// CLAUDE_FLOW_ROUTER_* env vars accumulated across iters 12-53. Operators
// need a single command that lists each with its current value (or default),
// effect, and which iter introduced it. Color-coded: green = override set,
// dim = default.
export const routerConfigCommand: Command = {
  name: 'config',
  description: 'List all CLAUDE_FLOW_ROUTER_* env vars with current values + effects (ADR-149 iter 54)',
  options: [
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
    { name: 'only-overrides', type: 'boolean', description: 'Only show env vars that are explicitly set (hide defaults)', default: false },
  ],
  examples: [
    { command: 'claude-flow neural router config', description: 'All router env vars with current values' },
    { command: 'claude-flow neural router config --only-overrides', description: 'Just what the operator has set' },
    { command: 'claude-flow neural router config --format json | jq', description: 'Audit / diff against another deployment' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fmt = (ctx.flags.format as string) || 'table';
    const onlyOverrides = Boolean(ctx.flags['only-overrides'] ?? ctx.flags.onlyOverrides);

    interface EnvVarRow {
      name: string;
      iter: number;
      defaultValue: string;
      currentValue: string;
      isOverride: boolean;
      effect: string;
    }
    const rows: EnvVarRow[] = [
      // Core gate (iter 0)
      { name: 'CLAUDE_FLOW_ROUTER_NEURAL',                       iter: 0,  defaultValue: 'unset (0)',   currentValue: process.env.CLAUDE_FLOW_ROUTER_NEURAL ?? '',     isOverride: !!process.env.CLAUDE_FLOW_ROUTER_NEURAL,                       effect: 'Gate. =1 enables neural router; otherwise pure-bandit heuristic.' },
      { name: 'CLAUDE_FLOW_ROUTER_MODEL_PATH',                   iter: 0,  defaultValue: 'unset',       currentValue: process.env.CLAUDE_FLOW_ROUTER_MODEL_PATH ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_MODEL_PATH,                   effect: 'Override the KRR artifact path. Defaults to bundled.' },
      { name: 'CLAUDE_FLOW_ROUTER_QUALITY_BAR',                  iter: 0,  defaultValue: '0.50',        currentValue: process.env.CLAUDE_FLOW_ROUTER_QUALITY_BAR ?? '',isOverride: !!process.env.CLAUDE_FLOW_ROUTER_QUALITY_BAR,                  effect: 'Cost-optimal mode: minimum predicted quality to pick a candidate.' },
      // Trajectory (iter 17)
      { name: 'CLAUDE_FLOW_ROUTER_TRAJECTORY',                   iter: 17, defaultValue: 'unset (0)',   currentValue: process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY,                   effect: 'Gate. =1 writes decision+outcome rows to .swarm/model-router-trajectories.jsonl.' },
      { name: 'CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH',              iter: 17, defaultValue: '.swarm/model-router-trajectories.jsonl', currentValue: process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH, effect: 'Override the trajectory JSONL path.' },
      { name: 'CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXSIZE',           iter: 17, defaultValue: '10485760 (10MB)', currentValue: process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXSIZE ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXSIZE, effect: 'Bytes before rotation. Set 0 to disable rotation.' },
      { name: 'CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXROTATIONS',      iter: 17, defaultValue: '3',           currentValue: process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXROTATIONS ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXROTATIONS, effect: 'Max .bak files to keep when rotating.' },
      { name: 'CLAUDE_FLOW_ROUTER_TRAJECTORY_TASKLEN',           iter: 17, defaultValue: '500',         currentValue: process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_TASKLEN ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_TASKLEN, effect: 'Max chars of task text to persist per row (truncated above this).' },
      // Latency budget (iter 12)
      { name: 'CLAUDE_FLOW_ROUTER_LATENCY_BUDGET_MS',            iter: 12, defaultValue: '0 (unbounded)', currentValue: process.env.CLAUDE_FLOW_ROUTER_LATENCY_BUDGET_MS ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_LATENCY_BUDGET_MS, effect: 'Drop candidates whose measured p50 latency > this many ms before selection.' },
      // Per-modelId bandit (iter 14)
      { name: 'CLAUDE_FLOW_ROUTER_BANDIT_PER_MODEL',             iter: 14, defaultValue: 'unset (0)',   currentValue: process.env.CLAUDE_FLOW_ROUTER_BANDIT_PER_MODEL ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_BANDIT_PER_MODEL, effect: 'Gate. =1 enables per-modelId Thompson sampling perturbation of neural prediction.' },
      // k-NN backend (iter 0)
      { name: 'CLAUDE_FLOW_ROUTER_KNN_K',                        iter: 0,  defaultValue: '5',           currentValue: process.env.CLAUDE_FLOW_ROUTER_KNN_K ?? '',      isOverride: !!process.env.CLAUDE_FLOW_ROUTER_KNN_K,                        effect: 'k for the k-NN backend when KRR is not loadable.' },
      { name: 'CLAUDE_FLOW_ROUTER_SEED_CORPUS',                  iter: 0,  defaultValue: 'bundled seed-rows.json', currentValue: process.env.CLAUDE_FLOW_ROUTER_SEED_CORPUS ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_SEED_CORPUS, effect: 'Override the DRACO seed corpus path.' },
      // Calibration (iter 22-25)
      { name: 'CLAUDE_FLOW_ROUTER_CALIBRATE',                    iter: 24, defaultValue: 'unset (default ON)', currentValue: process.env.CLAUDE_FLOW_ROUTER_CALIBRATE ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_CALIBRATE, effect: 'Isotonic calibration of KRR predictions. =0 opts out (recovers raw KRR). Default-on since iter 24 (OOS validated).' },
      { name: 'CLAUDE_FLOW_ROUTER_CALIBRATOR_PATH',              iter: 22, defaultValue: 'bundled seed-router.calibrator.json', currentValue: process.env.CLAUDE_FLOW_ROUTER_CALIBRATOR_PATH ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_CALIBRATOR_PATH, effect: 'Override the unified calibrator path. Per-tier files (low/med/high) load from the same dir.' },
      // Cost ceiling (iter 29)
      { name: 'CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK',    iter: 29, defaultValue: '0 (disabled)', currentValue: process.env.CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK, effect: 'Orthogonal selector mode: pick BEST quality among candidates ≤ ceiling $/Mtok blended.' },
      // A/B mode (iter 5/37)
      { name: 'CLAUDE_FLOW_ROUTER_AB',                           iter: 5,  defaultValue: 'unset (0)',   currentValue: process.env.CLAUDE_FLOW_ROUTER_AB ?? '',         isOverride: !!process.env.CLAUDE_FLOW_ROUTER_AB,                           effect: 'Legacy all-on A/B mode. Records bandit_pick + hybrid_pick on every decision.' },
      { name: 'CLAUDE_FLOW_ROUTER_AB_SAMPLE_RATE',               iter: 37, defaultValue: '0 (disabled)', currentValue: process.env.CLAUDE_FLOW_ROUTER_AB_SAMPLE_RATE ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_AB_SAMPLE_RATE, effect: 'Sampled A/B mode. 0..1 fraction of decisions to A/B (deterministic by task_hash). Overrides legacy AB=1.' },
      // Ensemble uncertainty (iter 44)
      { name: 'CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD', iter: 44, defaultValue: '0 (disabled)', currentValue: process.env.CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD, effect: 'When > 0: if |unified_q - specialist_q| > threshold for picked model, fall back to bandit.' },
      // Bandit warmup (iter 52/53)
      { name: 'CLAUDE_FLOW_ROUTER_BANDIT_WARMUP_RANGE',          iter: 52, defaultValue: '8',           currentValue: process.env.CLAUDE_FLOW_ROUTER_BANDIT_WARMUP_RANGE ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_BANDIT_WARMUP_RANGE, effect: 'Continuous warmup denominator. Smaller = bandit ramps faster; larger = more conservative.' },
      { name: 'CLAUDE_FLOW_ROUTER_BANDIT_FULL_INFLUENCE',        iter: 53, defaultValue: 'unset (0)',   currentValue: process.env.CLAUDE_FLOW_ROUTER_BANDIT_FULL_INFLUENCE ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_BANDIT_FULL_INFLUENCE, effect: 'Gate. =1 uses asymptotic curve (samples-2)/(samples+WARMUP) — bandit dominates at scale.' },
      { name: 'CLAUDE_FLOW_ROUTER_BANDIT_SHRINKAGE_LAMBDA',      iter: 57, defaultValue: '4',           currentValue: process.env.CLAUDE_FLOW_ROUTER_BANDIT_SHRINKAGE_LAMBDA ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_BANDIT_SHRINKAGE_LAMBDA, effect: 'Cross-bucket shrinkage strength. λ=0 disables; higher λ = more bias toward marginal anchor for cold cells.' },
    ];

    const visible = onlyOverrides ? rows.filter(r => r.isOverride) : rows;

    if (fmt === 'json') {
      output.writeln(JSON.stringify(visible, null, 2));
      return { success: true, data: visible };
    }

    output.writeln();
    output.writeln(output.bold('Router config — ADR-149 iter 54 (env-var inventory)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  ${visible.length} of ${rows.length} entries  (${rows.filter(r => r.isOverride).length} overridden, ${rows.length - rows.filter(r => r.isOverride).length} default)`);
    output.writeln('');
    for (const r of visible) {
      const value = r.isOverride ? output.success(r.currentValue) : output.dim(`(default: ${r.defaultValue})`);
      output.writeln(`  ${r.name} = ${value}`);
      output.writeln(`    ${output.dim(`iter ${r.iter}`)} ${r.effect}`);
      output.writeln('');
    }
    if (visible.length === 0 && onlyOverrides) {
      output.writeln(output.dim('  No overrides — all router behavior is at defaults.'));
      output.writeln('');
    }
    return { success: true, data: visible };
  },
};
