import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

// ADR-149 iter 48 — bandit-state inspection. The persisted bandit posteriors
// (`.swarm/model-router-state.json`) accumulate across restarts but are
// otherwise invisible. Surfacing the (bucket × model) prior matrix lets
// operators see where bandit learning is thin (cold cells) and where it's
// confident (large α+β).
export const routerBanditStateCommand: Command = {
  name: 'bandit-state',
  description: 'Inspect persisted bandit Beta priors per bucket × model (ADR-149 iter 48)',
  options: [
    { name: 'path', type: 'string', description: 'Path to model-router-state.json (default: .swarm/model-router-state.json)' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
    { name: 'cold-threshold', type: 'number', description: 'Highlight cells with sample count below this (default 4 — matches iter 14 density guard)', default: '4' },
  ],
  examples: [
    { command: 'claude-flow neural router bandit-state', description: 'Show all Beta priors per bucket × tier + per bucket × modelId' },
    { command: 'claude-flow neural router bandit-state --format json | jq .priorsById', description: 'Just the per-modelId matrix' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const statePath = (ctx.flags.path as string | undefined)
      ?? path.resolve(process.cwd(), '.swarm', 'model-router-state.json');
    const fmt = (ctx.flags.format as string) || 'table';
    const requestedColdThreshold = parseInt(String(ctx.flags.coldThreshold ?? ctx.flags['cold-threshold'] ?? 4), 10);
    const coldThreshold = Number.isNaN(requestedColdThreshold) ? 4 : requestedColdThreshold;

    if (!fs.existsSync(statePath)) {
      const msg = `Bandit state file not found at ${statePath}`;
      if (fmt === 'json') output.writeln(JSON.stringify({ error: msg, hint: 'State is created on first routing decision. Run any agent_spawn flow with CLAUDE_FLOW_ROUTER_NEURAL=1.' }, null, 2));
      else {
        output.printError(msg);
        output.writeln(output.dim('  State is created on first routing decision. Run any agent_spawn flow.'));
      }
      return { success: false, exitCode: 1 };
    }

    interface BetaPrior { alpha: number; beta: number }
    interface BucketedPriors {
      low?:  Record<string, BetaPrior>;
      med?:  Record<string, BetaPrior>;
      high?: Record<string, BetaPrior>;
    }
    interface State {
      version?: number;
      totalDecisions?: number;
      lastUpdated?: string;
      priors?: BucketedPriors;
      priorsById?: BucketedPriors;
    }

    let state: State;
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (err) {
      const msg = `Failed to parse bandit state: ${err instanceof Error ? err.message : String(err)}`;
      if (fmt === 'json') output.writeln(JSON.stringify({ error: msg }, null, 2));
      else output.printError(msg);
      return { success: false, exitCode: 1 };
    }

    // Helper: enumerate all cells from a BucketedPriors with derived stats.
    const cells = (priors: BucketedPriors | undefined) => {
      const out: Array<{ bucket: string; key: string; alpha: number; beta: number; samples: number; meanQuality: number; cold: boolean }> = [];
      if (!priors) return out;
      for (const bucket of ['low', 'med', 'high'] as const) {
        const b = priors[bucket];
        if (!b) continue;
        for (const [k, p] of Object.entries(b)) {
          const samples = p.alpha + p.beta - 2;   // -2 because Beta(1,1) is the uniform prior
          const meanQuality = p.alpha / (p.alpha + p.beta);
          out.push({ bucket, key: k, alpha: p.alpha, beta: p.beta, samples, meanQuality, cold: samples < coldThreshold });
        }
      }
      return out;
    };

    const tierCells = cells(state.priors);
    const idCells = cells(state.priorsById);
    const coldTierCells = tierCells.filter(c => c.cold);
    const coldIdCells = idCells.filter(c => c.cold);

    const payload = {
      input: statePath,
      stateVersion: state.version ?? 2,
      totalDecisions: state.totalDecisions ?? 0,
      lastUpdated: state.lastUpdated ?? null,
      coldThreshold,
      priors: tierCells,
      priorsById: idCells,
      summary: {
        tierCells: tierCells.length,
        coldTierCells: coldTierCells.length,
        idCells: idCells.length,
        coldIdCells: coldIdCells.length,
        warmestIdCell: idCells.length > 0 ? [...idCells].sort((a, b) => b.samples - a.samples)[0] : null,
      },
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('Bandit state inspection (ADR-149 iter 48)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  Path:               ${statePath}`);
    output.writeln(`  Schema version:     v${state.version ?? 2}  (v2=tier priors only; v3=adds priorsById)`);
    output.writeln(`  Total decisions:    ${state.totalDecisions ?? 0}`);
    if (state.lastUpdated) output.writeln(`  Last update:        ${state.lastUpdated}`);
    output.writeln(`  Cold threshold:     samples < ${coldThreshold}  (iter 14 density-guard cutoff)`);
    output.writeln('');

    const renderTable = (label: string, rows: typeof tierCells) => {
      if (rows.length === 0) {
        output.writeln(`  ${label}:  (empty — no outcomes recorded yet for this layer)`);
        output.writeln('');
        return;
      }
      output.writeln(output.bold(`  ${label}:`));
      output.writeln('    bucket  key                                       α        β     samples  meanQ');
      for (const c of rows.sort((a, b) => (a.bucket.localeCompare(b.bucket)) || (b.samples - a.samples))) {
        const coldMark = c.cold ? output.warning(' ❄ cold') : '';
        output.writeln(`    ${c.bucket.padEnd(6)}  ${c.key.padEnd(38)}  ${c.alpha.toFixed(1).padStart(5)}  ${c.beta.toFixed(1).padStart(5)}  ${String(c.samples).padStart(7)}  ${c.meanQuality.toFixed(3)}${coldMark}`);
      }
      output.writeln('');
    };

    renderTable('Tier priors (bucket × tier label)', tierCells);
    renderTable('Per-modelId priors (bucket × concrete modelId, iter 14)', idCells);
    output.writeln(output.bold('  Summary:'));
    output.writeln(`    tier cells:        ${tierCells.length}  (cold: ${coldTierCells.length})`);
    output.writeln(`    per-modelId cells: ${idCells.length}  (cold: ${coldIdCells.length})`);
    if (payload.summary.warmestIdCell) {
      const w = payload.summary.warmestIdCell;
      output.writeln(`    warmest cell:      ${w.bucket} × ${w.key}  (${w.samples} samples, meanQ=${w.meanQuality.toFixed(3)})`);
    }
    output.writeln('');
    if (coldIdCells.length > 0 && idCells.length > 0) {
      output.writeln(output.dim(`  Cold cells suppress iter 14 per-modelId Thompson perturbation. Until α+β ≥ ${coldThreshold + 2},`));
      output.writeln(output.dim('  the neural prediction dominates that (bucket, modelId) pair without bandit correction.'));
      output.writeln('');
    }
    return { success: true, data: payload };
  },
};
