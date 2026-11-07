import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

// ADR-149 iter 28 — observability into recorded routing decisions. The
// trajectory JSONL (iter 17+) records every decision the router makes;
// this subcommand exposes that data as filtered + aggregated views so
// operators don't have to grep the file.
export const routerDecisionsCommand: Command = {
  name: 'decisions',
  description: 'Query the routing-decision JSONL (iter 17+): filter, aggregate, paginate (ADR-149 iter 28)',
  options: [
    { name: 'in', short: 'i', type: 'string', description: 'Trajectory JSONL path (default: $CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH or .swarm/model-router-trajectories.jsonl)' },
    { name: 'since', short: 's', type: 'string', description: 'Time window suffix: 1h, 24h, 7d, 30d (default: all)' },
    { name: 'routed-by', type: 'string', description: 'Filter by decision mechanism: hybrid | bandit-fallback | heuristic' },
    { name: 'model', short: 'm', type: 'string', description: 'Filter by chosen model id (substring match, e.g. haiku, gpt-4)' },
    { name: 'bucket', type: 'string', description: 'Filter by complexity bucket: cheap (< 0.34) | mid (< 0.67) | strong (≥ 0.67) — iter 58' },
    { name: 'task-hash', type: 'string', description: 'Filter by exact task_hash (FNV-1a-32). Use for incident investigation — iter 59' },
    { name: 'limit', short: 'l', type: 'number', description: 'Max recent decisions to list (default 20)', default: '20' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router decisions', description: 'Aggregate stats + 20 most-recent decisions' },
    { command: 'claude-flow neural router decisions --since 24h', description: 'Last 24 hours only' },
    { command: 'claude-flow neural router decisions --routed-by bandit-fallback', description: 'Find decisions where neural backend failed' },
    { command: 'claude-flow neural router decisions --model haiku --format json', description: 'All haiku picks, JSON output' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const inPath = (ctx.flags.in as string | undefined)
      ?? process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? path.resolve(process.cwd(), '.swarm', 'model-router-trajectories.jsonl');
    const since = ctx.flags.since as string | undefined;
    const routedByFilter = (ctx.flags['routed-by'] ?? ctx.flags.routedBy) as string | undefined;
    const modelFilter = ctx.flags.model as string | undefined;
    const bucketFilterRaw = (ctx.flags.bucket as string | undefined)?.toLowerCase();
    const bucketFilter: 'cheap' | 'mid' | 'strong' | undefined =
      bucketFilterRaw === 'cheap' || bucketFilterRaw === 'mid' || bucketFilterRaw === 'strong'
        ? bucketFilterRaw : undefined;
    if (bucketFilterRaw && !bucketFilter) {
      output.printError(`--bucket must be one of: cheap | mid | strong (got "${bucketFilterRaw}")`);
      return { success: false, exitCode: 1 };
    }
    // iter 59 — task_hash filter for incident investigation. Accepts the 8-char
    // FNV-1a-32 hex format the trajectory recorder uses.
    const taskHashFilter = ((ctx.flags['task-hash'] ?? ctx.flags.taskHash) as string | undefined)?.toLowerCase();
    if (taskHashFilter && !/^[0-9a-f]{8}$/.test(taskHashFilter)) {
      output.printError(`--task-hash must be an 8-char hex string (got "${taskHashFilter}")`);
      return { success: false, exitCode: 1 };
    }
    const limit = parseInt(ctx.flags.limit as string || '20', 10) || 20;
    const fmt = (ctx.flags.format as string) || 'table';

    if (!fs.existsSync(inPath)) {
      const msg = `Trajectory file not found at ${inPath}`;
      if (fmt === 'json') {
        output.writeln(JSON.stringify({ error: msg, hint: 'Set CLAUDE_FLOW_ROUTER_TRAJECTORY=1 to enable recording.' }, null, 2));
      } else {
        output.printError(msg);
        output.writeln(output.dim('  Set CLAUDE_FLOW_ROUTER_TRAJECTORY=1 to enable trajectory recording.'));
      }
      return { success: false, exitCode: 1 };
    }

    // Parse JSONL — only decision rows are relevant here.
    interface DecisionRow {
      v: number; type: 'decision'; ts: string; task_hash: string; task?: string;
      model: string; complexity: number; confidence: number; uncertainty: number;
      routed_by: string; neural_backend?: string; provider?: string; openrouter_model?: string;
    }
    const text = fs.readFileSync(inPath, 'utf8');
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const decisions: DecisionRow[] = [];
    // iter 31 — pair outcomes by task_hash for cost-aggregate joins.
    // iter 65 — outcomes now ARRAY (was Map). Same correctness fix as iter
    // 62 applied to cost-savings: deduping by task_hash collapses multiple
    // runs of the same task into one, biasing cost aggregates toward the
    // LATEST outcome's cost counted N times instead of summing all N costs.
    interface OutcomeMini { task_hash: string; ts: string; quality?: number; cost_usd?: number; tokens?: { input: number; output: number }; model_id?: string }
    const outcomesByHash = new Map<string, OutcomeMini[]>();
    let malformed = 0;
    for (const l of lines) {
      try {
        const row = JSON.parse(l);
        if (row.type === 'decision') {
          decisions.push(row);
        } else if (row.type === 'outcome') {
          const arr = outcomesByHash.get(row.task_hash) ?? [];
          arr.push({
            task_hash: row.task_hash,
            ts: row.ts,
            quality: row.quality,
            cost_usd: row.cost_usd,
            tokens: row.tokens,
            model_id: row.model_id,
          });
          outcomesByHash.set(row.task_hash, arr);
        }
      } catch { malformed++; }
    }

    // Time-window filter.
    let cutoffMs: number | null = null;
    if (since) {
      const m = since.match(/^(\d+)([hdmw])$/);
      if (m) {
        const n = parseInt(m[1], 10);
        const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[m[2]] ?? 0;
        cutoffMs = Date.now() - n * unitMs;
      }
    }

    let filtered = decisions;
    if (cutoffMs !== null) {
      filtered = filtered.filter(d => Date.parse(d.ts) >= cutoffMs!);
    }
    if (routedByFilter) {
      filtered = filtered.filter(d => d.routed_by === routedByFilter);
    }
    if (bucketFilter) {
      filtered = filtered.filter(d => {
        const bucket = d.complexity < 0.34 ? 'cheap' : d.complexity < 0.67 ? 'mid' : 'strong';
        return bucket === bucketFilter;
      });
    }
    if (taskHashFilter) {
      filtered = filtered.filter(d => d.task_hash === taskHashFilter);
    }
    if (modelFilter) {
      const needle = modelFilter.toLowerCase();
      filtered = filtered.filter(d => {
        const id = (d.openrouter_model ?? d.model).toLowerCase();
        return id.includes(needle);
      });
    }

    // Aggregate.
    const byRoutedBy: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    const byTier: Record<string, number> = { cheap: 0, mid: 0, strong: 0 };
    // iter 31 — cost aggregation. Sum cost_usd from paired outcome rows.
    let costTotalUsd = 0;
    let costPairedCount = 0;
    const costByModel: Record<string, number> = {};
    const costByTier: Record<string, number> = { cheap: 0, mid: 0, strong: 0 };
    // iter 65 — track per-hash decision-iteration so we can pair the N-th
    // decision for a hash with the N-th outcome (instead of always pulling
    // the latest outcome). Iter 17's recorder writes decision then outcome
    // in chronological order, so this index-pairing matches what the agent
    // actually dispatched.
    const decisionIndexByHash = new Map<string, number>();
    for (const d of filtered) {
      byRoutedBy[d.routed_by] = (byRoutedBy[d.routed_by] ?? 0) + 1;
      const id = d.openrouter_model ?? d.model;
      byModel[id] = (byModel[id] ?? 0) + 1;
      const tier = d.complexity < 0.34 ? 'cheap' : d.complexity < 0.67 ? 'mid' : 'strong';
      byTier[tier]++;
      // iter 31 + iter 65 — JOIN to the i-th OUTCOME row for this task_hash
      // (where i is the i-th DECISION for this hash). Avoids double-counting
      // costs when a task ran multiple times.
      const outcomeArr = outcomesByHash.get(d.task_hash);
      if (outcomeArr && outcomeArr.length > 0) {
        const seen = decisionIndexByHash.get(d.task_hash) ?? 0;
        const out = outcomeArr[Math.min(seen, outcomeArr.length - 1)];
        decisionIndexByHash.set(d.task_hash, seen + 1);
        if (out?.cost_usd != null) {
          costTotalUsd += out.cost_usd;
          costPairedCount++;
          const modelKey = out.model_id ?? id;
          costByModel[modelKey] = (costByModel[modelKey] ?? 0) + out.cost_usd;
          costByTier[tier] += out.cost_usd;
        }
      }
    }
    const fallbackRate = filtered.length > 0
      ? ((byRoutedBy['bandit-fallback'] ?? 0) / filtered.length) * 100
      : 0;

    // Sort by ts ascending so "most recent" is well-defined regardless of
    // file order (rotation, concurrent writes can break monotonicity).
    const sorted = [...filtered].sort((a, b) => a.ts.localeCompare(b.ts));
    const recent = sorted.slice(-limit).reverse(); // newest first

    const payload = {
      input: inPath,
      totalRows: lines.length,
      decisionRows: decisions.length,
      malformed,
      filtered: filtered.length,
      filters: { since, routedBy: routedByFilter, model: modelFilter, bucket: bucketFilter, taskHash: taskHashFilter },
      aggregates: {
        byRoutedBy, byModel, byTier,
        fallbackRatePct: Math.round(fallbackRate * 100) / 100,
        // iter 31 — cost aggregates. Only populated when outcome rows
        // carry cost_usd (post-iter-31 trajectories).
        ...(costPairedCount > 0 ? {
          costTotalUsd: Math.round(costTotalUsd * 1000000) / 1000000,
          costPairedCount,
          costByModel: Object.fromEntries(Object.entries(costByModel).map(([k, v]) => [k, Math.round(v * 1000000) / 1000000])),
          costByTier: Object.fromEntries(Object.entries(costByTier).map(([k, v]) => [k, Math.round(v * 1000000) / 1000000])),
          avgCostPerCall: Math.round((costTotalUsd / costPairedCount) * 1000000) / 1000000,
        } : {}),
      },
      recent,
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('Routing decisions (ADR-149 iter 17+, query iter 28)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  Input:           ${inPath}`);
    output.writeln(`  JSONL rows:      ${lines.length}  (${decisions.length} decision, ${malformed} malformed)`);
    if (since || routedByFilter || modelFilter || bucketFilter || taskHashFilter) {
      output.writeln(`  Filters:         ${[since && `since=${since}`, routedByFilter && `routed-by=${routedByFilter}`, modelFilter && `model~${modelFilter}`, bucketFilter && `bucket=${bucketFilter}`, taskHashFilter && `task_hash=${taskHashFilter}`].filter(Boolean).join(', ')}`);
    }
    output.writeln(`  After filters:   ${filtered.length}`);
    output.writeln('');

    if (filtered.length === 0) {
      output.writeln(output.dim('  No decisions match the filters.'));
      output.writeln('');
      return { success: true, data: payload };
    }

    output.writeln(`  Fallback rate:   ${fallbackRate.toFixed(2)}%   (neural backend → bandit when prediction unusable)`);
    output.writeln('');
    output.writeln('  By routed_by:');
    for (const [k, v] of Object.entries(byRoutedBy).sort((a, b) => b[1] - a[1])) {
      const pct = ((v / filtered.length) * 100).toFixed(1).padStart(5);
      output.writeln(`    ${k.padEnd(18)}  ${String(v).padStart(6)}  ${pct}%`);
    }
    output.writeln('');
    output.writeln('  By model:');
    for (const [k, v] of Object.entries(byModel).sort((a, b) => b[1] - a[1])) {
      const pct = ((v / filtered.length) * 100).toFixed(1).padStart(5);
      output.writeln(`    ${k.padEnd(42)}  ${String(v).padStart(6)}  ${pct}%`);
    }
    output.writeln('');
    output.writeln('  By tier (complexity bucket):');
    for (const [k, v] of Object.entries(byTier)) {
      const pct = filtered.length > 0 ? ((v / filtered.length) * 100).toFixed(1).padStart(5) : '  0.0';
      output.writeln(`    ${k.padEnd(8)}  ${String(v).padStart(6)}  ${pct}%`);
    }
    output.writeln('');
    // iter 31 — cost block (only when outcome rows carry cost_usd).
    if (costPairedCount > 0) {
      output.writeln('  Cost (USD, from paired outcomes):');
      output.writeln(`    Total:           $${costTotalUsd.toFixed(4)}  across ${costPairedCount} paired decisions`);
      output.writeln(`    Avg per call:    $${(costTotalUsd / costPairedCount).toFixed(6)}`);
      output.writeln('    By model:');
      for (const [k, v] of Object.entries(costByModel).sort((a, b) => b[1] - a[1])) {
        output.writeln(`      ${k.padEnd(40)}  $${v.toFixed(4)}`);
      }
      output.writeln('    By tier:');
      for (const [k, v] of Object.entries(costByTier)) {
        output.writeln(`      ${k.padEnd(8)}  $${v.toFixed(4)}`);
      }
      output.writeln('');
    }
    // iter 59 — incident detail mode. When --task-hash is set, render each
    // matching decision with FULL task text, paired outcome, complexity,
    // ab_pair, ensemble_disagreement. Operators investigating "why was
    // THIS task routed to X?" want maximum context per decision.
    if (taskHashFilter && filtered.length > 0) {
      // iter 64 — sort occurrences newest-first by ts. JSONL insertion order
      // may not match chronological order after rotation or out-of-order writes.
      const incidentSorted = [...filtered].sort((a, b) => b.ts.localeCompare(a.ts));
      output.writeln(output.bold(`  Incident detail for task_hash=${taskHashFilter} (${filtered.length} occurrence(s), newest first):`));
      for (const d of incidentSorted) {
        // iter 65 — outcomesByHash is now an array of all outcomes per hash.
        // For the incident detail at this decision's timestamp, pick the
        // outcome closest in time (typically the corresponding one written
        // by iter 17's recorder immediately after the decision).
        const allOutcomes = outcomesByHash.get(d.task_hash) ?? [];
        const dts = Date.parse(d.ts);
        let out: OutcomeMini | undefined;
        let bestDelta = Infinity;
        for (const o of allOutcomes) {
          const delta = Math.abs(Date.parse(o.ts) - dts);
          if (delta < bestDelta) { bestDelta = delta; out = o; }
        }
        const bucket = d.complexity < 0.34 ? 'cheap' : d.complexity < 0.67 ? 'mid' : 'strong';
        output.writeln('');
        output.writeln(`    ts:                  ${d.ts}`);
        output.writeln(`    task:                "${(d as unknown as { task?: string }).task ?? '<task text not stored>'}"`);
        output.writeln(`    complexity:          ${d.complexity.toFixed(3)} (bucket: ${bucket})`);
        output.writeln(`    picked model:        ${d.openrouter_model ?? d.model}`);
        output.writeln(`    routed_by:           ${d.routed_by}${(d as unknown as { neural_backend?: string }).neural_backend ? `  via ${(d as unknown as { neural_backend: string }).neural_backend}` : ''}`);
        output.writeln(`    confidence:          ${d.confidence.toFixed(3)}   uncertainty: ${d.uncertainty.toFixed(3)}`);
        const apd = (d as unknown as { ab_pair?: { bandit_pick: string; hybrid_pick: string; disagree: boolean } }).ab_pair;
        if (apd) {
          output.writeln(`    ab_pair:             bandit=${apd.bandit_pick}  hybrid=${apd.hybrid_pick}  disagree=${apd.disagree}`);
        }
        const ed = (d as unknown as { ensemble_disagreement?: number }).ensemble_disagreement;
        if (typeof ed === 'number') {
          output.writeln(`    ensemble disagree:   ${ed.toFixed(4)}`);
        }
        if (out) {
          output.writeln(`    outcome:             quality=${out.quality ?? '—'}  cost_usd=${out.cost_usd != null ? '$' + out.cost_usd.toFixed(6) : '—'}  source=${(out as unknown as { source?: string }).source ?? '—'}`);
        } else {
          output.writeln(`    outcome:             ${output.warning('(no paired outcome row)')}`);
        }
      }
      output.writeln('');
      return { success: true, data: payload };
    }
    output.writeln(`  ${Math.min(limit, recent.length)} most-recent decisions (newest first):`);
    output.writeln('    ' + 'ts'.padEnd(20) + 'routed_by'.padEnd(18) + 'model'.padEnd(34) + 'conf');
    for (const d of recent) {
      const ts = d.ts.slice(0, 19);
      const id = (d.openrouter_model ?? d.model).slice(0, 32);
      output.writeln(`    ${ts.padEnd(20)}${d.routed_by.padEnd(18)}${id.padEnd(34)}${d.confidence.toFixed(2)}`);
    }
    output.writeln('');
    return { success: true, data: payload };
  },
};
