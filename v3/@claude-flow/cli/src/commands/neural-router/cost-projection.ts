import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

// ADR-149 iter 41 — forward-looking budget projection. Iter 32-34 measure
// past cost (actual vs counterfactual, per-window drift). This subcommand
// extrapolates: given the measured rate and average cost per decision over
// a recent window, what will routing cost over the next 7d / 30d / 90d /
// 365d? Also projects the heuristic baseline so operators see the savings
// trajectory across a quarter or year.
export const routerCostProjectionCommand: Command = {
  name: 'cost-projection',
  description: 'Project monthly/quarterly cost from measured rate (ADR-149 iter 41)',
  options: [
    { name: 'in', short: 'i', type: 'string', description: 'Trajectory JSONL path (default: $CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH or .swarm/...)' },
    { name: 'window', short: 'w', type: 'string', description: 'Measurement window to extrapolate FROM (default 7d). Format: 1h, 24h, 7d, 30d' },
    { name: 'horizons', type: 'string', description: 'Projection horizons (CSV of duration suffixes). Default: 7d,30d,90d,365d' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router cost-projection', description: 'Project from last 7d of data → 7d/30d/90d/365d horizons' },
    { command: 'claude-flow neural router cost-projection --window 24h --horizons 7d,30d', description: 'Project from last day only' },
    { command: 'claude-flow neural router cost-projection --format json | jq .horizons[1].projectedSavingsUsd', description: '30-day savings projection for dashboards' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { MODEL_PRICES } = await import('../../ruvector/model-prices.js');

    const inPath = (ctx.flags.in as string | undefined)
      ?? process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? path.resolve(process.cwd(), '.swarm', 'model-router-trajectories.jsonl');
    const windowSpec = (ctx.flags.window as string | undefined) ?? '7d';
    const horizonSpecs = ((ctx.flags.horizons as string | undefined) ?? '7d,30d,90d,365d').split(',').map(s => s.trim());
    const fmt = (ctx.flags.format as string) || 'table';

    const parseDuration = (s: string): number | null => {
      const m = s.match(/^(\d+)([hdmw])$/);
      if (!m) return null;
      const n = parseInt(m[1], 10);
      const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[m[2]] ?? 0;
      return n * unitMs;
    };
    const windowMs = parseDuration(windowSpec);
    if (!windowMs || windowMs <= 0) {
      output.printError(`--window must be Nh/Nd/Nm/Nw (got ${windowSpec})`);
      return { success: false, exitCode: 1 };
    }

    if (!fs.existsSync(inPath)) {
      const msg = `Trajectory file not found at ${inPath}`;
      if (fmt === 'json') output.writeln(JSON.stringify({ error: msg }, null, 2));
      else output.printError(msg);
      return { success: false, exitCode: 1 };
    }

    interface DecisionRow {
      type: 'decision'; ts: string; task_hash: string;
      model: string; complexity: number; openrouter_model?: string;
      ab_pair?: { bandit_pick: string; hybrid_pick: string; disagree: boolean };
    }
    interface OutcomeRow {
      type: 'outcome'; ts: string; task_hash: string;
      cost_usd?: number; tokens?: { input: number; output: number }; model_id?: string;
    }

    // iter 66 — outcomes now ARRAY (was Map). Same fix as iter 62/63/65:
    // a Map keyed by task_hash collapses multiple runs of the same task to
    // the LATEST outcome only, biasing the rate downward (pairCount =
    // unique-tasks, not unique-calls). Production projections were
    // systematically too small for any workload with recurring tasks.
    const decisions = new Map<string, DecisionRow>();
    const outcomes: OutcomeRow[] = [];
    let malformed = 0;
    const cutoffMs = Date.now() - windowMs;
    for (const l of fs.readFileSync(inPath, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try {
        const r = JSON.parse(l);
        if (Date.parse(r.ts) < cutoffMs) continue;
        if (r.type === 'decision') decisions.set(r.task_hash, r);
        else if (r.type === 'outcome') outcomes.push(r);
      } catch { malformed++; }
    }

    // Pair + compute window totals. Iterate OUTCOMES (not deduped decisions);
    // each outcome row contributes its own cost + tokens to the rate.
    let pairCount = 0;
    let actualUsd = 0;
    let counterfactualUsd = 0;     // heuristic = tier-by-complexity baseline (iter 32 default)
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    for (const out of outcomes) {
      if (!out?.cost_usd || !out.tokens) continue;
      const dec = decisions.get(out.task_hash);
      if (!dec) continue;
      pairCount++;
      actualUsd += out.cost_usd;
      totalInputTokens += out.tokens.input;
      totalOutputTokens += out.tokens.output;
      // Heuristic counterfactual: tier-by-complexity (matches iter 32 default).
      const tierModel = dec.complexity < 0.34 ? 'haiku'
        : dec.complexity < 0.67 ? 'sonnet' : 'opus';
      const cfModel = dec.ab_pair?.bandit_pick ?? tierModel;
      const p = MODEL_PRICES[cfModel] ?? { in: 1, out: 1 };
      counterfactualUsd += (out.tokens.input * p.in + out.tokens.output * p.out) / 1_000_000;
    }

    if (pairCount === 0) {
      const msg = `No paired cost-bearing rows in the last ${windowSpec}. Cannot project.`;
      const payload = { error: msg, windowSpec, hint: 'Enable CLAUDE_FLOW_ROUTER_TRAJECTORY=1 and run some routed agent calls first.' };
      if (fmt === 'json') output.writeln(JSON.stringify(payload, null, 2));
      else {
        output.printError(msg);
        output.writeln(output.dim(`  ${payload.hint}`));
      }
      return { success: true, data: payload };
    }

    // Per-second rate from this window's pair count.
    const callsPerSecond = pairCount / (windowMs / 1000);
    const avgActualPerCall = actualUsd / pairCount;
    const avgCounterfactualPerCall = counterfactualUsd / pairCount;

    // Extrapolate to horizons. Costs scale linearly with calls; calls scale
    // linearly with elapsed time at the measured rate.
    const horizons = horizonSpecs.map(spec => {
      const ms = parseDuration(spec);
      if (!ms) return { spec, error: 'invalid duration' };
      const projectedCalls = Math.round(callsPerSecond * (ms / 1000));
      const projectedActualUsd = avgActualPerCall * projectedCalls;
      const projectedCounterfactualUsd = avgCounterfactualPerCall * projectedCalls;
      const projectedSavingsUsd = projectedCounterfactualUsd - projectedActualUsd;
      const projectedSavingsPct = projectedCounterfactualUsd > 0
        ? (projectedSavingsUsd / projectedCounterfactualUsd) * 100 : 0;
      return {
        spec, durationMs: ms,
        projectedCalls,
        projectedActualUsd: Math.round(projectedActualUsd * 1_000_000) / 1_000_000,
        projectedCounterfactualUsd: Math.round(projectedCounterfactualUsd * 1_000_000) / 1_000_000,
        projectedSavingsUsd: Math.round(projectedSavingsUsd * 1_000_000) / 1_000_000,
        projectedSavingsPct: Math.round(projectedSavingsPct * 100) / 100,
      };
    });

    const payload = {
      input: inPath,
      window: windowSpec,
      malformed,
      measurement: {
        pairs: pairCount,
        actualUsd: Math.round(actualUsd * 1_000_000) / 1_000_000,
        counterfactualUsd: Math.round(counterfactualUsd * 1_000_000) / 1_000_000,
        savingsUsd: Math.round((counterfactualUsd - actualUsd) * 1_000_000) / 1_000_000,
        callsPerSecond: Math.round(callsPerSecond * 1_000_000) / 1_000_000,
        callsPerDay: Math.round(callsPerSecond * 86400 * 100) / 100,
        avgActualPerCall: Math.round(avgActualPerCall * 1_000_000) / 1_000_000,
        avgCounterfactualPerCall: Math.round(avgCounterfactualPerCall * 1_000_000) / 1_000_000,
        avgInputTokensPerCall: Math.round(totalInputTokens / pairCount),
        avgOutputTokensPerCall: Math.round(totalOutputTokens / pairCount),
      },
      horizons,
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('Cost projection (ADR-149 iter 41)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  Input:             ${inPath}`);
    output.writeln(`  Measurement window: last ${windowSpec}  (${pairCount} paired calls)`);
    output.writeln('');
    output.writeln(output.bold('  Measured rate:'));
    output.writeln(`    Calls/day:                  ${payload.measurement.callsPerDay}`);
    output.writeln(`    Avg actual cost/call:       $${payload.measurement.avgActualPerCall.toFixed(6)}`);
    output.writeln(`    Avg counterfactual/call:    $${payload.measurement.avgCounterfactualPerCall.toFixed(6)}  (heuristic: cheap→haiku, mid→sonnet, strong→opus)`);
    output.writeln(`    Avg tokens/call:            ${payload.measurement.avgInputTokensPerCall} in / ${payload.measurement.avgOutputTokensPerCall} out`);
    output.writeln('');
    output.writeln(output.bold('  Projections (linear extrapolation from measured rate):'));
    output.writeln('    horizon  projected calls   actual $        counterfactual $  savings $      %');
    for (const h of horizons) {
      if ('error' in h) {
        output.writeln(`    ${h.spec.padEnd(7)}  invalid duration`);
        continue;
      }
      const savingsStr = h.projectedSavingsUsd >= 0
        ? output.success(`$${h.projectedSavingsUsd.toFixed(2)}`)
        : output.warning(`-$${Math.abs(h.projectedSavingsUsd).toFixed(2)}`);
      output.writeln(`    ${h.spec.padEnd(7)}  ${String(h.projectedCalls).padStart(15)}   $${h.projectedActualUsd.toFixed(2).padStart(12)}   $${h.projectedCounterfactualUsd.toFixed(2).padStart(14)}   ${savingsStr.padEnd(14)} ${h.projectedSavingsPct.toFixed(2).padStart(6)}%`);
    }
    output.writeln('');
    output.writeln(output.dim('  Assumes the next horizon\'s workload mix and rate matches the measurement window.'));
    output.writeln(output.dim('  Use iter 34 (--window) to check if recent windows are drifting before trusting these.'));
    output.writeln('');
    return { success: true, data: payload };
  },
};
