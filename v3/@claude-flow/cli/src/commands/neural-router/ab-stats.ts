import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

// ADR-149 iter 38 — consumer for iter 37's sampled A/B mode. Aggregates
// ab_pair from decision rows into a (bandit_pick × hybrid_pick) confusion
// matrix plus disagreement rate. Operators see WHERE the neural prior
// moves the bandit's decisions.
export const routerAbStatsCommand: Command = {
  name: 'ab-stats',
  description: 'Aggregate A/B (bandit-vs-hybrid) disagreement from trajectory ab_pair rows (ADR-149 iter 38)',
  options: [
    { name: 'in', short: 'i', type: 'string', description: 'Trajectory JSONL path (default: $CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH or .swarm/...)' },
    { name: 'since', short: 's', type: 'string', description: 'Time window suffix: 1h, 24h, 7d, 30d' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router ab-stats', description: 'All A/B comparisons recorded so far' },
    { command: 'claude-flow neural router ab-stats --since 7d --format json', description: 'Last 7 days, pipe-friendly' },
    { command: 'CLAUDE_FLOW_ROUTER_AB_SAMPLE_RATE=0.05 ... && claude-flow neural router ab-stats', description: 'After running with iter 37 sampling on' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const inPath = (ctx.flags.in as string | undefined)
      ?? process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? path.resolve(process.cwd(), '.swarm', 'model-router-trajectories.jsonl');
    const since = ctx.flags.since as string | undefined;
    const fmt = (ctx.flags.format as string) || 'table';

    if (!fs.existsSync(inPath)) {
      const msg = `Trajectory file not found at ${inPath}`;
      if (fmt === 'json') output.writeln(JSON.stringify({ error: msg }, null, 2));
      else {
        output.printError(msg);
        output.writeln(output.dim('  Set CLAUDE_FLOW_ROUTER_TRAJECTORY=1 + CLAUDE_FLOW_ROUTER_AB_SAMPLE_RATE=0.05 to start collecting ab_pair data.'));
      }
      return { success: false, exitCode: 1 };
    }

    interface AbRow {
      type: 'decision';
      ts: string;
      ab_pair?: { bandit_pick: string; hybrid_pick: string; disagree: boolean };
    }

    // Parse + filter to decision rows that carry ab_pair.
    let cutoffMs: number | null = null;
    if (since) {
      const m = since.match(/^(\d+)([hdmw])$/);
      if (m) {
        const n = parseInt(m[1], 10);
        const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[m[2]] ?? 0;
        cutoffMs = Date.now() - n * unitMs;
      }
    }
    const rows = fs.readFileSync(inPath, 'utf8').split('\n').filter(l => l.trim().length > 0);
    let totalDecisions = 0;
    let malformed = 0;
    const abRows: AbRow[] = [];
    for (const l of rows) {
      try {
        const r = JSON.parse(l) as AbRow & { task_hash?: string };
        if (r.type !== 'decision') continue;
        totalDecisions++;
        if (!r.ab_pair) continue;
        if (cutoffMs !== null && Date.parse(r.ts) < cutoffMs) continue;
        abRows.push(r);
      } catch { malformed++; }
    }

    // Confusion matrix + disagree breakdown.
    interface Cell { bandit: string; hybrid: string; count: number }
    const cells = new Map<string, Cell>();
    let disagree = 0;
    const banditTotals: Record<string, number> = {};
    const hybridTotals: Record<string, number> = {};
    for (const r of abRows) {
      const ap = r.ab_pair!;
      const key = `${ap.bandit_pick}→${ap.hybrid_pick}`;
      const cell = cells.get(key) ?? { bandit: ap.bandit_pick, hybrid: ap.hybrid_pick, count: 0 };
      cell.count++;
      cells.set(key, cell);
      banditTotals[ap.bandit_pick] = (banditTotals[ap.bandit_pick] ?? 0) + 1;
      hybridTotals[ap.hybrid_pick] = (hybridTotals[ap.hybrid_pick] ?? 0) + 1;
      if (ap.disagree) disagree++;
    }
    const disagreeRatePct = abRows.length > 0 ? Math.round((disagree / abRows.length) * 10000) / 100 : 0;

    // Models actually seen, in stable iteration order.
    const allModels = Array.from(new Set([...Object.keys(banditTotals), ...Object.keys(hybridTotals)])).sort();

    const matrix: Record<string, Record<string, number>> = {};
    for (const b of allModels) {
      matrix[b] = {};
      for (const h of allModels) {
        matrix[b][h] = cells.get(`${b}→${h}`)?.count ?? 0;
      }
    }

    // Disagreement breakdown — off-diagonal cells sorted by count desc.
    const offDiag: Array<{ bandit: string; hybrid: string; count: number; pctOfDisagrees: number }> = [];
    for (const c of cells.values()) {
      if (c.bandit !== c.hybrid) {
        offDiag.push({ ...c, pctOfDisagrees: disagree > 0 ? Math.round((c.count / disagree) * 10000) / 100 : 0 });
      }
    }
    offDiag.sort((a, b) => b.count - a.count);

    const payload = {
      input: inPath,
      filters: { since },
      totalDecisions, malformed,
      abComparisons: abRows.length,
      disagreements: disagree,
      disagreementRatePct: disagreeRatePct,
      models: allModels,
      banditTotals, hybridTotals,
      confusionMatrix: matrix,
      disagreementBreakdown: offDiag,
      coveragePct: totalDecisions > 0 ? Math.round((abRows.length / totalDecisions) * 10000) / 100 : 0,
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('A/B (bandit vs hybrid) stats — ADR-149 iter 37/38'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  Input:              ${inPath}`);
    if (since) output.writeln(`  Time window:        since ${since}`);
    output.writeln(`  Total decisions:    ${totalDecisions}  (${malformed} malformed)`);
    output.writeln(`  A/B comparisons:    ${abRows.length}  (${payload.coveragePct}% of decisions had ab_pair)`);
    output.writeln('');
    if (abRows.length === 0) {
      output.writeln(output.dim('  No ab_pair rows found. Enable iter 37 sampling:'));
      output.writeln(output.dim('    export CLAUDE_FLOW_ROUTER_TRAJECTORY=1'));
      output.writeln(output.dim('    export CLAUDE_FLOW_ROUTER_AB_SAMPLE_RATE=0.05  # 5% sampling'));
      output.writeln('');
      return { success: true, data: payload };
    }
    output.writeln(`  Disagreements:      ${disagree}  (${disagreeRatePct}% of A/B comparisons)`);
    output.writeln('');
    output.writeln(output.bold(`  Confusion matrix (rows = bandit pick, cols = hybrid pick, ${allModels.length} models):`));
    const headerPad = Math.max(8, ...allModels.map(m => m.length));
    output.writeln('    ' + 'bandit \\ hybrid'.padEnd(headerPad) + '  ' + allModels.map(m => m.padStart(8)).join(''));
    for (const b of allModels) {
      const cells = allModels.map(h => String(matrix[b][h] ?? 0).padStart(8));
      output.writeln(`    ${b.padEnd(headerPad)}  ${cells.join('')}`);
    }
    output.writeln(output.dim('    (Diagonal cells = agreement, off-diagonal = disagreement.)'));
    output.writeln('');
    if (offDiag.length > 0) {
      output.writeln(output.bold('  Disagreement breakdown (bandit → hybrid):'));
      output.writeln('    transition'.padEnd(40) + '  count  % of disagrees');
      for (const c of offDiag) {
        output.writeln(`    ${(c.bandit + ' → ' + c.hybrid).padEnd(38)}  ${String(c.count).padStart(5)}  ${c.pctOfDisagrees.toString().padStart(6)}%`);
      }
      output.writeln('');
    }
    return { success: true, data: payload };
  },
};
