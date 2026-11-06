import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

// ADR-149 iter 49 — single-command SRE dashboard. The router has 13 subcommands
// (iter 48); ops want ONE that says "is everything working AND saving money?".
// Aggregates the most-asked signals into one terse screen.
export const routerStatsSummaryCommand: Command = {
  name: 'stats-summary',
  description: 'One-screen SRE dashboard: gate, recent activity, savings, bandit warmest cell (ADR-149 iter 49)',
  options: [
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router stats-summary', description: 'One-screen health check' },
    { command: 'claude-flow neural router stats-summary --format json | jq .', description: 'Pipe to dashboards / alerting' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const fmt = (ctx.flags.format as string) || 'table';

    // 1. Backend gate / status
    const { neuralRouterStatus } = await import('../../ruvector/neural-router.js');
    const { getModelRouterStats } = await import('../../ruvector/model-router.js');
    const backend = await neuralRouterStatus();
    const stats = getModelRouterStats();

    // 2. Trajectory existence + basic counts
    const trajectoryPath = process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? path.resolve(process.cwd(), '.swarm', 'model-router-trajectories.jsonl');
    let trajectory: {
      exists: boolean; rows: number; decisions: number; outcomes: number;
      pairedWithCost: number; oldestTs: string | null; newestTs: string | null;
    } = { exists: false, rows: 0, decisions: 0, outcomes: 0, pairedWithCost: 0, oldestTs: null, newestTs: null };
    let recent24h: { decisions: number; fallbacks: number; fallbackRatePct: number } | null = null;
    let cost7d: { pairs: number; actualUsd: number; counterfactualUsd: number; savingsUsd: number; savingsPct: number } | null = null;

    if (fs.existsSync(trajectoryPath)) {
      trajectory.exists = true;
      const { MODEL_PRICES } = await import('../../ruvector/model-prices.js');
      const lines = fs.readFileSync(trajectoryPath, 'utf8').split('\n').filter(l => l.trim().length > 0);
      trajectory.rows = lines.length;

      const cutoff24h = Date.now() - 24 * 3600_000;
      const cutoff7d = Date.now() - 7 * 86400_000;
      let recDec = 0, recFallback = 0;
      interface DecLite { ts: string; task_hash: string; complexity: number; routed_by: string; ab_pair?: { bandit_pick: string } }
      interface OutLite { ts: string; task_hash: string; cost_usd?: number; tokens?: { input: number; output: number } }
      const decs7d = new Map<string, DecLite>();
      const outs7d = new Map<string, OutLite>();
      for (const l of lines) {
        try {
          const r = JSON.parse(l);
          const tsMs = Date.parse(r.ts);
          if (r.type === 'decision') {
            trajectory.decisions++;
            if (tsMs >= cutoff24h) {
              recDec++;
              if (r.routed_by === 'bandit-fallback') recFallback++;
            }
            if (tsMs >= cutoff7d) decs7d.set(r.task_hash, r);
          } else if (r.type === 'outcome') {
            trajectory.outcomes++;
            if (r.cost_usd != null) trajectory.pairedWithCost++;
            if (tsMs >= cutoff7d) outs7d.set(r.task_hash, r);
          }
          if (r.ts) {
            if (!trajectory.oldestTs || r.ts < trajectory.oldestTs) trajectory.oldestTs = r.ts;
            if (!trajectory.newestTs || r.ts > trajectory.newestTs) trajectory.newestTs = r.ts;
          }
        } catch { /* malformed */ }
      }
      recent24h = {
        decisions: recDec, fallbacks: recFallback,
        fallbackRatePct: recDec > 0 ? Math.round((recFallback / recDec) * 10000) / 100 : 0,
      };

      // 7-day cost via heuristic counterfactual
      let pairs = 0, actual = 0, cf = 0;
      for (const [hash, dec] of decs7d) {
        const out = outs7d.get(hash);
        if (!out?.cost_usd || !out.tokens) continue;
        pairs++;
        actual += out.cost_usd;
        const tierModel = dec.complexity < 0.34 ? 'haiku' : dec.complexity < 0.67 ? 'sonnet' : 'opus';
        const cfModel = dec.ab_pair?.bandit_pick ?? tierModel;
        const p = MODEL_PRICES[cfModel] ?? { in: 1, out: 1 };
        cf += (out.tokens.input * p.in + out.tokens.output * p.out) / 1_000_000;
      }
      if (pairs > 0) {
        cost7d = {
          pairs,
          actualUsd: Math.round(actual * 1_000_000) / 1_000_000,
          counterfactualUsd: Math.round(cf * 1_000_000) / 1_000_000,
          savingsUsd: Math.round((cf - actual) * 1_000_000) / 1_000_000,
          savingsPct: cf > 0 ? Math.round(((cf - actual) / cf) * 10000) / 100 : 0,
        };
      }
    }

    // 3. Warmest bandit cell from persisted state
    interface BetaCell { bucket: string; key: string; samples: number; meanQuality: number }
    let warmestCell: BetaCell | null = null;
    const statePath = path.resolve(process.cwd(), '.swarm', 'model-router-state.json');
    if (fs.existsSync(statePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        const priors = state.priorsById ?? state.priors ?? {};
        let bestSamples = 0;
        for (const bucket of ['low', 'med', 'high']) {
          const b = priors[bucket];
          if (!b) continue;
          for (const [k, p] of Object.entries(b as Record<string, { alpha: number; beta: number }>)) {
            const samples = p.alpha + p.beta - 2;
            if (samples > bestSamples) {
              bestSamples = samples;
              warmestCell = { bucket, key: k, samples, meanQuality: p.alpha / (p.alpha + p.beta) };
            }
          }
        }
      } catch { /* malformed */ }
    }

    const payload = {
      backend: {
        enabled: backend.enabled,
        available: backend.available,
        routedBy: backend.routedBy,
        reason: backend.reason,
      },
      processLocal: {
        totalDecisions: stats.totalDecisions,
        modelDistribution: stats.modelDistribution,
        routedByCounts: stats.routedByCounts,
        abDisagreementRate: stats.ab.comparisons > 0 ? Math.round(stats.ab.disagreementRate * 10000) / 100 : 0,
      },
      trajectory,
      recent24h,
      cost7d,
      warmestBanditCell: warmestCell,
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('Router stats summary — ADR-149 iter 49 (one-screen SRE view)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln('');
    output.writeln(output.bold('  Backend:'));
    output.writeln(`    gate:           ${backend.enabled ? output.success('open (NEURAL=1)') : output.warning('closed')}`);
    output.writeln(`    available:      ${backend.available ? output.success('yes') : output.warning('no')}`);
    output.writeln(`    active backend: ${backend.routedBy ?? '—'}`);
    output.writeln(`    reason:         ${backend.reason}`);
    output.writeln('');
    output.writeln(output.bold('  Process-local (since this server started):'));
    output.writeln(`    decisions:      ${stats.totalDecisions}`);
    output.writeln(`    routed_by:      heuristic=${stats.routedByCounts.heuristic}  hybrid=${stats.routedByCounts.hybrid}  bandit-fallback=${stats.routedByCounts['bandit-fallback']}`);
    if (stats.ab.comparisons > 0) {
      output.writeln(`    A/B:            ${stats.ab.comparisons} comparisons, ${stats.ab.disagreements} disagreements (${(stats.ab.disagreementRate * 100).toFixed(1)}%)`);
    }
    output.writeln('');
    output.writeln(output.bold('  Trajectory log:'));
    if (!trajectory.exists) {
      output.writeln(`    ${output.warning('file does not exist — recorder OFF or no decisions made')}`);
    } else {
      output.writeln(`    rows:           ${trajectory.rows}  (${trajectory.decisions} decisions / ${trajectory.outcomes} outcomes / ${trajectory.pairedWithCost} cost-bearing)`);
      if (trajectory.oldestTs && trajectory.newestTs) {
        output.writeln(`    span:           ${trajectory.oldestTs.slice(0, 19)} → ${trajectory.newestTs.slice(0, 19)}`);
      }
    }
    output.writeln('');
    if (recent24h) {
      const rateStr = recent24h.fallbackRatePct > 30 ? output.warning(recent24h.fallbackRatePct + '% ⚠')
        : recent24h.fallbackRatePct > 10 ? recent24h.fallbackRatePct + '%'
        : output.success(recent24h.fallbackRatePct + '%');
      output.writeln(output.bold(`  Last 24h:`));
      output.writeln(`    decisions:      ${recent24h.decisions}`);
      output.writeln(`    fallback rate:  ${rateStr}  (neural backend → bandit when prediction unusable)`);
      output.writeln('');
    }
    if (cost7d) {
      const savingsStr = cost7d.savingsUsd >= 0
        ? output.success(`$${cost7d.savingsUsd.toFixed(4)}`)
        : output.warning(`-$${Math.abs(cost7d.savingsUsd).toFixed(4)}`);
      output.writeln(output.bold('  Last 7d cost-savings (vs heuristic baseline):'));
      output.writeln(`    paired calls:    ${cost7d.pairs}`);
      output.writeln(`    actual:          $${cost7d.actualUsd.toFixed(4)}`);
      output.writeln(`    counterfactual:  $${cost7d.counterfactualUsd.toFixed(4)}`);
      output.writeln(`    savings:         ${savingsStr}  (${cost7d.savingsPct}%)`);
      output.writeln('');
    }
    if (warmestCell) {
      output.writeln(output.bold('  Bandit warmest cell:'));
      output.writeln(`    ${warmestCell.bucket} × ${warmestCell.key}  →  ${warmestCell.samples} samples, meanQ=${warmestCell.meanQuality.toFixed(3)}`);
      output.writeln('');
    }
    output.writeln(output.dim('  For drill-down: `router decisions`, `router cost-savings`, `router bandit-state`'));
    output.writeln('');
    return { success: true, data: payload };
  },
};
