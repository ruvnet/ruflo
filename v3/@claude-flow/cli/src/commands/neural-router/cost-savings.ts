import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

// ADR-149 iter 32 — counterfactual cost-savings analysis. Iter 31 added
// cost_usd to outcome rows; this subcommand consumes that and asks "what
// would each decision have cost on the heuristic-only path?" — surfacing
// the actual production savings the router delivers.
export const routerCostSavingsCommand: Command = {
  name: 'cost-savings',
  description: 'Compute actual vs heuristic-counterfactual cost from paired decision+outcome rows (ADR-149 iter 32)',
  options: [
    { name: 'in', short: 'i', type: 'string', description: 'Trajectory JSONL path (default: $CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH or .swarm/...)' },
    { name: 'since', short: 's', type: 'string', description: 'Time window suffix: 1h, 24h, 7d, 30d' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
    { name: 'top-n', type: 'number', description: 'Show top-N largest individual savings (default 5)', default: '5' },
    { name: 'baseline', short: 'b', type: 'string', description: 'Counterfactual baseline: heuristic | always-haiku | always-sonnet | always-opus | always-gpt-4.1 | all (default: all)', default: 'all' },
    { name: 'window', short: 'w', type: 'string', description: 'Bin decisions into successive windows of this duration (e.g. 1h, 24h, 7d). Output adds a trend table — iter 34 drift detection.' },
    { name: 'task-hash', type: 'string', description: 'Filter to specific task_hash (FNV-1a-32 hex). For per-task cost investigation — iter 61.' },
    { name: 'alert-on-drop-pct', type: 'number', description: 'Exit 1 if the most recent window\'s savings% falls > N points below the mean of prior windows. Requires --window. Default off. (ADR-149 iter 50)' },
  ],
  examples: [
    { command: 'claude-flow neural router cost-savings', description: 'All-time, all baselines (heuristic + Sonnet-always + Opus-always)' },
    { command: 'claude-flow neural router cost-savings --baseline always-sonnet', description: 'Compare only against Sonnet-always' },
    { command: 'claude-flow neural router cost-savings --window 24h', description: 'Daily savings trend — iter 34 drift detection' },
    { command: 'claude-flow neural router cost-savings --since 7d --format json | jq .baselines.heuristic.savings.totalUsd', description: 'Pipe-friendly headline' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { MODEL_PRICES } = await import('../../ruvector/model-prices.js');

    const inPath = (ctx.flags.in as string | undefined)
      ?? process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? path.resolve(process.cwd(), '.swarm', 'model-router-trajectories.jsonl');
    const since = ctx.flags.since as string | undefined;
    const fmt = (ctx.flags.format as string) || 'table';
    const topN = parseInt((ctx.flags['top-n'] ?? ctx.flags.topN) as string || '5', 10) || 5;

    if (!fs.existsSync(inPath)) {
      const msg = `Trajectory file not found at ${inPath}`;
      if (fmt === 'json') {
        output.writeln(JSON.stringify({ error: msg }, null, 2));
      } else {
        output.printError(msg);
      }
      return { success: false, exitCode: 1 };
    }

    interface DecisionRow {
      type: 'decision'; ts: string; task_hash: string; task?: string;
      model: string; complexity: number; openrouter_model?: string;
      ab_pair?: { bandit_pick: string; hybrid_pick: string; disagree: boolean };
    }
    interface OutcomeRow {
      type: 'outcome'; ts: string; task_hash: string;
      cost_usd?: number; tokens?: { input: number; output: number }; model_id?: string;
    }

    // iter 62 — preserve ALL outcomes (don't dedup by task_hash). Decisions
    // can still dedup because all occurrences of the same task have the
    // same embedding/complexity (it's the same task!), but different runs
    // produce different token counts and costs. The Array preserves those.
    const decisions = new Map<string, DecisionRow>();
    const outcomes: OutcomeRow[] = [];
    let malformed = 0;
    for (const l of fs.readFileSync(inPath, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try {
        const r = JSON.parse(l);
        if (r.type === 'decision') decisions.set(r.task_hash, r);
        else if (r.type === 'outcome') outcomes.push(r);
      } catch { malformed++; }
    }

    // Time-window filter (on the OUTCOME ts, since that's when cost was incurred).
    let cutoffMs: number | null = null;
    if (since) {
      const m = since.match(/^(\d+)([hdmw])$/);
      if (m) {
        const n = parseInt(m[1], 10);
        const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[m[2]] ?? 0;
        cutoffMs = Date.now() - n * unitMs;
      }
    }

    // iter 33 — multi-baseline counterfactuals. Each per-call row carries
    // the actual cost AND a map of counterfactual costs (one per baseline),
    // so a single LOO over the trajectory data computes all baselines at once.
    const baselineArg = (ctx.flags.baseline as string | undefined) ?? 'all';
    const allBaselines = ['heuristic', 'always-haiku', 'always-sonnet', 'always-opus', 'always-gpt-4.1'];
    const baselines = baselineArg === 'all' ? allBaselines : [baselineArg];
    // Map each baseline label → the modelId used for pricing.
    const baselineModelFor = (baseline: string, dec: DecisionRow): string => {
      switch (baseline) {
        case 'heuristic':
          return dec.ab_pair?.bandit_pick
            ?? (dec.complexity < 0.34 ? 'haiku' : dec.complexity < 0.67 ? 'sonnet' : 'opus');
        case 'always-haiku':    return 'haiku';
        case 'always-sonnet':   return 'sonnet';
        case 'always-opus':     return 'opus';
        case 'always-gpt-4.1':  return 'openai/gpt-4.1';
        default:                return baseline; // operator passes raw modelId
      }
    };

    interface PerCallSavings {
      task_hash: string; ts: string;
      actualModel: string; actualCost: number;
      counterfactuals: Record<string, { model: string; cost: number; savings: number }>;
      tokens: { input: number; output: number };
      complexity: number; tier: 'cheap' | 'mid' | 'strong';
    }
    const perCall: PerCallSavings[] = [];
    let droppedNoOutcomeCost = 0;
    let droppedNoDecision = 0;
    let droppedNoTokens = 0;

    // iter 61 — task-hash filter for per-task cost investigation.
    const taskHashFilter = ((ctx.flags['task-hash'] ?? ctx.flags.taskHash) as string | undefined)?.toLowerCase();
    if (taskHashFilter && !/^[0-9a-f]{8}$/.test(taskHashFilter)) {
      output.printError(`--task-hash must be an 8-char hex string (got "${taskHashFilter}")`);
      return { success: false, exitCode: 1 };
    }

    // iter 62 — iterate ALL outcomes (Array), not just one per hash. Multiple
    // occurrences of the same task contribute separately to the aggregate.
    for (const out of outcomes) {
      if (cutoffMs !== null && Date.parse(out.ts) < cutoffMs) continue;
      if (taskHashFilter && out.task_hash !== taskHashFilter) continue;
      if (out.cost_usd == null) { droppedNoOutcomeCost++; continue; }
      const dec = decisions.get(out.task_hash);
      if (!dec) { droppedNoDecision++; continue; }
      if (!out.tokens) { droppedNoTokens++; continue; }

      const actualCost = out.cost_usd;
      const actualModel = out.model_id ?? dec.openrouter_model ?? dec.model;
      const tier = dec.complexity < 0.34 ? 'cheap' : dec.complexity < 0.67 ? 'mid' : 'strong';

      // Compute every baseline at once. Cost = (input × $/Mtok_in + output ×
      // $/Mtok_out) / 1e6 — same formula iter 31's costUsd() uses.
      const counterfactuals: Record<string, { model: string; cost: number; savings: number }> = {};
      for (const b of baselines) {
        const m = baselineModelFor(b, dec);
        const p = MODEL_PRICES[m] ?? { in: 1, out: 1 };
        const cost = (out.tokens.input * p.in + out.tokens.output * p.out) / 1_000_000;
        counterfactuals[b] = { model: m, cost, savings: cost - actualCost };
      }

      perCall.push({
        task_hash: out.task_hash, ts: out.ts,
        actualModel, actualCost,
        counterfactuals,
        tokens: out.tokens,
        complexity: dec.complexity, tier,
      });
    }

    const round6 = (x: number) => Math.round(x * 1_000_000) / 1_000_000;
    const round2 = (x: number) => Math.round(x * 100) / 100;
    const totalActual = perCall.reduce((s, p) => s + p.actualCost, 0);

    // Per-baseline aggregates.
    type BaselineAgg = {
      totalUsd: number; savingsPct: number;
      actualUsd: number; counterfactualUsd: number;
      byTier: Record<string, { n: number; actualUsd: number; counterfactualUsd: number; savingsUsd: number; savingsPct: number }>;
    };
    const baselineAggs: Record<string, BaselineAgg> = {};
    for (const b of baselines) {
      let totalCf = 0;
      const byTier: Record<string, { actual: number; counterfactual: number; n: number }> = {
        cheap: { actual: 0, counterfactual: 0, n: 0 },
        mid: { actual: 0, counterfactual: 0, n: 0 },
        strong: { actual: 0, counterfactual: 0, n: 0 },
      };
      for (const c of perCall) {
        const cf = c.counterfactuals[b]?.cost ?? 0;
        totalCf += cf;
        byTier[c.tier].actual += c.actualCost;
        byTier[c.tier].counterfactual += cf;
        byTier[c.tier].n += 1;
      }
      const savings = totalCf - totalActual;
      const pct = totalCf > 0 ? (savings / totalCf) * 100 : 0;
      baselineAggs[b] = {
        totalUsd: round6(savings),
        savingsPct: round2(pct),
        actualUsd: round6(totalActual),
        counterfactualUsd: round6(totalCf),
        byTier: Object.fromEntries(Object.entries(byTier).map(([k, v]) => [k, {
          n: v.n,
          actualUsd: round6(v.actual),
          counterfactualUsd: round6(v.counterfactual),
          savingsUsd: round6(v.counterfactual - v.actual),
          savingsPct: v.counterfactual > 0 ? round2(((v.counterfactual - v.actual) / v.counterfactual) * 100) : 0,
        }])),
      };
    }

    // Top-N largest individual savings — use the first baseline's per-call savings.
    const primaryBaseline = baselines[0];
    const topSavings = [...perCall].sort((a, b) =>
      (b.counterfactuals[primaryBaseline]?.savings ?? 0) - (a.counterfactuals[primaryBaseline]?.savings ?? 0)
    ).slice(0, topN);

    const payload = {
      input: inPath,
      filters: { since, taskHash: taskHashFilter },
      pairs: perCall.length,
      dropped: { noOutcomeCost: droppedNoOutcomeCost, noDecision: droppedNoDecision, noTokens: droppedNoTokens },
      baselines: Object.fromEntries(Object.entries(baselineAggs).map(([k, v]) => [k, {
        savings: { totalUsd: v.totalUsd, savingsPct: v.savingsPct, actualUsd: v.actualUsd, counterfactualUsd: v.counterfactualUsd },
        byTier: v.byTier,
      }])),
      // Back-compat: top-level `savings` and `byTier` mirror the PRIMARY baseline
      // (first in the requested list, which for --baseline all is "heuristic" — same
      // as iter 32's output shape). Iter 32 callers parsing the old shape keep working.
      savings: baselineAggs[primaryBaseline]
        ? { totalUsd: baselineAggs[primaryBaseline].totalUsd, savingsPct: baselineAggs[primaryBaseline].savingsPct, actualUsd: baselineAggs[primaryBaseline].actualUsd, counterfactualUsd: baselineAggs[primaryBaseline].counterfactualUsd }
        : { totalUsd: 0, savingsPct: 0, actualUsd: round6(totalActual), counterfactualUsd: 0 },
      byTier: baselineAggs[primaryBaseline]?.byTier ?? {},
      topSavings: topSavings.map(t => ({
        ts: t.ts, actualModel: t.actualModel,
        counterfactualModel: t.counterfactuals[primaryBaseline]?.model ?? '—',
        actualUsd: round6(t.actualCost),
        counterfactualUsd: round6(t.counterfactuals[primaryBaseline]?.cost ?? 0),
        savingsUsd: round6(t.counterfactuals[primaryBaseline]?.savings ?? 0),
      })),
    };

    // iter 34 — windowed drift detection. When --window is set, bin the
    // paired calls into successive duration windows and emit a trend table
    // (one row per window). Useful for "is the router degrading over time?"
    // — a sudden drop in savings %% across windows surfaces calibration drift,
    // workload shifts, or model deprecation.
    const windowArg = (ctx.flags.window as string | undefined);
    let windowedTrend: Array<{
      windowStart: string; windowEnd: string; n: number;
      actualUsd: number; counterfactualUsd: number; savingsUsd: number; savingsPct: number;
      deltaVsPriorPct: number | null;
    }> | undefined;
    if (windowArg) {
      const m = windowArg.match(/^(\d+)([hdmw])$/);
      if (!m) {
        output.printError(`--window must match Nh|Nd|Nm|Nw (got ${windowArg})`);
        return { success: false, exitCode: 1 };
      }
      const n = parseInt(m[1], 10);
      const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[m[2]] ?? 0;
      const windowMs = n * unitMs;
      if (windowMs <= 0) {
        output.printError(`--window must be positive (got ${windowArg})`);
        return { success: false, exitCode: 1 };
      }
      // Bin perCall by (outcome.ts - earliest.ts) / windowMs.
      // Sort first so window indices are monotonic and gaps are visible.
      const sorted = [...perCall].sort((a, b) => a.ts.localeCompare(b.ts));
      if (sorted.length === 0) {
        windowedTrend = [];
      } else {
        const earliestMs = Date.parse(sorted[0].ts);
        const bins = new Map<number, typeof sorted>();
        for (const c of sorted) {
          const idx = Math.floor((Date.parse(c.ts) - earliestMs) / windowMs);
          if (!bins.has(idx)) bins.set(idx, []);
          bins.get(idx)!.push(c);
        }
        const rows: NonNullable<typeof windowedTrend> = [];
        let priorPct: number | null = null;
        for (const idx of [...bins.keys()].sort((a, b) => a - b)) {
          const items = bins.get(idx)!;
          let actual = 0, cf = 0;
          for (const c of items) {
            actual += c.actualCost;
            cf += c.counterfactuals[primaryBaseline]?.cost ?? 0;
          }
          const savings = cf - actual;
          const pct = cf > 0 ? (savings / cf) * 100 : 0;
          const windowStart = new Date(earliestMs + idx * windowMs).toISOString();
          const windowEnd = new Date(earliestMs + (idx + 1) * windowMs - 1).toISOString();
          const deltaVsPriorPct = priorPct === null ? null : round2(pct - priorPct);
          priorPct = pct;
          rows.push({
            windowStart, windowEnd, n: items.length,
            actualUsd: round6(actual),
            counterfactualUsd: round6(cf),
            savingsUsd: round6(savings),
            savingsPct: round2(pct),
            deltaVsPriorPct,
          });
        }
        windowedTrend = rows;
      }
      (payload as typeof payload & { windowedTrend?: typeof windowedTrend; windowConfig?: { duration: string; primaryBaseline: string } }).windowedTrend = windowedTrend;
      (payload as typeof payload & { windowedTrend?: typeof windowedTrend; windowConfig?: { duration: string; primaryBaseline: string } }).windowConfig = { duration: windowArg, primaryBaseline };
    }

    // iter 50 — drift alert. When --alert-on-drop-pct is set AND --window
    // produced ≥ 2 windows, compare the most-recent window's savings% to
    // the mean of prior windows'. If it dropped by > threshold, fail
    // (exit 1) so monitoring catches it. Independent of fmt — alert
    // state goes into the payload AND drives the exit code.
    const alertDropPctArg = (ctx.flags['alert-on-drop-pct'] ?? ctx.flags.alertOnDropPct) as string | number | undefined;
    let alertTriggered = false;
    let alertReason: string | null = null;
    if (alertDropPctArg !== undefined && alertDropPctArg !== null && alertDropPctArg !== '') {
      const dropThreshold = typeof alertDropPctArg === 'string' ? parseFloat(alertDropPctArg) : alertDropPctArg;
      if (!isFinite(dropThreshold) || dropThreshold <= 0) {
        output.printError(`--alert-on-drop-pct must be a positive number (got ${alertDropPctArg})`);
        return { success: false, exitCode: 1 };
      }
      if (!windowedTrend || windowedTrend.length < 2) {
        alertReason = `not enough windows for drift detection (need ≥ 2, got ${windowedTrend?.length ?? 0}) — alert skipped`;
      } else {
        const latest = windowedTrend[windowedTrend.length - 1];
        const prior = windowedTrend.slice(0, -1);
        const priorMean = prior.reduce((s, w) => s + w.savingsPct, 0) / prior.length;
        const dropPct = priorMean - latest.savingsPct;
        if (dropPct > dropThreshold) {
          alertTriggered = true;
          alertReason = `latest window savings ${latest.savingsPct.toFixed(2)}% is ${dropPct.toFixed(2)} points BELOW prior windows' mean ${priorMean.toFixed(2)}% (threshold ${dropThreshold})`;
        } else {
          alertReason = `latest window savings ${latest.savingsPct.toFixed(2)}% within ${dropThreshold} points of prior mean ${priorMean.toFixed(2)}% — OK`;
        }
      }
      (payload as typeof payload & { alert?: { triggered: boolean; reason: string | null; dropThreshold: number } }).alert = {
        triggered: alertTriggered,
        reason: alertReason,
        dropThreshold,
      };
    }

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return alertTriggered
        ? { success: false, exitCode: 1, data: payload }
        : { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('Cost-savings analysis (ADR-149 iter 32)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  Input:           ${inPath}`);
    if (since) output.writeln(`  Time window:     since ${since}`);
    if (taskHashFilter) output.writeln(`  Task hash:       ${taskHashFilter}  (filtered to this task)`);
    output.writeln(`  Paired calls:    ${perCall.length}  (dropped: no-cost=${droppedNoOutcomeCost}, no-decision=${droppedNoDecision}, no-tokens=${droppedNoTokens})`);
    output.writeln('');
    if (perCall.length === 0) {
      output.writeln(output.dim('  No cost-bearing paired rows. Enable trajectory recording AND make sure'));
      output.writeln(output.dim('  outcome rows include `tokens` (iter 31 wired this through agent-execute-core).'));
      output.writeln('');
      return { success: true, data: payload };
    }
    output.writeln(output.bold('  Headline (actual = $' + totalActual.toFixed(6) + '):'));
    output.writeln('    baseline            counterfactual   savings        %');
    for (const [b, agg] of Object.entries(baselineAggs)) {
      const savingsStr = agg.totalUsd >= 0 ? '$' + agg.totalUsd.toFixed(6) : '-$' + Math.abs(agg.totalUsd).toFixed(6);
      const colored = agg.totalUsd >= 0 ? output.success(savingsStr) : output.warning(savingsStr);
      output.writeln(`    ${b.padEnd(18)}  $${agg.counterfactualUsd.toFixed(6).padEnd(14)}  ${colored.padEnd(20)} ${agg.savingsPct.toString().padStart(6)}%`);
    }
    output.writeln('');
    output.writeln(output.dim(`  Primary baseline for per-tier and top-savings views: "${primaryBaseline}"`));
    output.writeln('');
    const primaryAgg = baselineAggs[primaryBaseline];
    output.writeln(output.bold('  By tier (' + primaryBaseline + '):'));
    output.writeln('    tier      n   actual          counterfactual  savings         %');
    for (const [k, v] of Object.entries(primaryAgg.byTier)) {
      output.writeln(`    ${k.padEnd(8)}  ${String(v.n).padStart(3)}  $${v.actualUsd.toFixed(6).padEnd(14)} $${v.counterfactualUsd.toFixed(6).padEnd(14)} $${v.savingsUsd.toFixed(6).padEnd(14)} ${v.savingsPct.toString().padStart(6)}%`);
    }
    output.writeln('');
    if (topSavings.length > 0) {
      output.writeln(output.bold(`  Top ${topSavings.length} largest individual savings (${primaryBaseline}):`));
      output.writeln('    ts                  actual                                    → counterfactual                           saved');
      for (const t of topSavings) {
        const cfModel = t.counterfactuals[primaryBaseline]?.model ?? '—';
        const sv = t.counterfactuals[primaryBaseline]?.savings ?? 0;
        output.writeln(`    ${t.ts.slice(0, 19)}  ${t.actualModel.padEnd(40)} → ${cfModel.padEnd(40)}  $${sv.toFixed(6)}`);
      }
      output.writeln('');
    }
    // iter 34 — windowed trend table for drift detection.
    if (windowedTrend && windowedTrend.length > 0) {
      output.writeln(output.bold(`  Windowed trend (${windowArg} bins, baseline=${primaryBaseline}):`));
      output.writeln('    window start         n    actual       counterfactual  savings      %       Δ% vs prior');
      for (const w of windowedTrend) {
        const arrow = w.deltaVsPriorPct === null ? ''
          : w.deltaVsPriorPct > 0 ? output.success(`↑ +${w.deltaVsPriorPct.toFixed(2)}`)
          : w.deltaVsPriorPct < 0 ? output.warning(`↓ ${w.deltaVsPriorPct.toFixed(2)}`)
          : '·';
        output.writeln(`    ${w.windowStart.slice(0, 19)}  ${String(w.n).padStart(3)}  $${w.actualUsd.toFixed(6).padEnd(11)} $${w.counterfactualUsd.toFixed(6).padEnd(14)} $${w.savingsUsd.toFixed(6).padEnd(11)} ${w.savingsPct.toString().padStart(6)}%  ${arrow}`);
      }
      output.writeln('');
      output.writeln(output.dim('    Δ% vs prior: change in savings % from the prior window. Large negative'));
      output.writeln(output.dim('    deltas suggest router degradation, workload shift, or calibration drift.'));
      output.writeln('');
    }
    // iter 50 — alert footer when --alert-on-drop-pct was used.
    if (alertReason !== null) {
      if (alertTriggered) {
        output.writeln(output.warning(`  ⚠ ALERT: ${alertReason}`));
      } else {
        output.writeln(output.dim(`  ${alertReason}`));
      }
      output.writeln('');
    }
    return alertTriggered
      ? { success: false, exitCode: 1, data: payload }
      : { success: true, data: payload };
  },
};
