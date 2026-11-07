import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

/**
 * ADR-149 iter 8 — `neural router models`: list the candidate registry
 * with measured per-tier scores from the most recent seed-corpus bench,
 * latency, and cost. Reads:
 *   - assets/model-router/seed-rows.json (which model ids exist in the corpus)
 *   - latest docs/benchmarks/runs/seed-corpus-*.json (per-candidate aggregates)
 *   - assets/model-router/openrouter-alts.json (tier mapping + alt rankings)
 * Falls back gracefully when files are missing.
 */
export const routerModelsCommand: Command = {
  name: 'models',
  description: 'List the cost-optimal router registry with measured per-tier scores, latency, and cost (ADR-149)',
  options: [
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router models', description: 'Show candidate registry with measured stats' },
    { command: 'claude-flow neural router models -f json', description: 'Machine-readable JSON' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fmt = (ctx.flags.format as string) || 'table';
    const fs = await import('node:fs');
    const path = await import('node:path');

    const { neuralRouterStatus } = await import('../../ruvector/neural-router.js');
    const status = await neuralRouterStatus();
    const seedPath = status.config.seedCorpusPath;

    interface Candidate {
      id: string;
      tier: 'haiku' | 'sonnet' | 'opus' | 'unknown';
      cost_in?: number;
      cost_out?: number;
      cheap?: number;
      mid?: number;
      strong?: number;
      overall?: number;
      latency_ms?: number;
    }

    // Best-effort: the candidate set is the union of ids appearing in
    // seed-rows.json scores keys. The latest measurement run's
    // perCandidate array is the authoritative source for measured stats.
    const candidates: Map<string, Candidate> = new Map();
    try {
      if (fs.existsSync(seedPath)) {
        const rows = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
        for (const r of rows) {
          for (const id of Object.keys(r.scores ?? {})) {
            if (!candidates.has(id)) candidates.set(id, { id, tier: 'unknown' });
          }
        }
      }
    } catch { /* keep going */ }

    // Pull latest FULL-CORPUS measurement for per-tier scores + latency.
    // Prefer files with cheap+mid+strong all populated (40-row+ runs); fall
    // back to the most-recent partial file if no full run is found.
    try {
      const benchDir = path.resolve(process.cwd(), 'docs', 'benchmarks', 'runs');
      if (fs.existsSync(benchDir)) {
        const files = fs.readdirSync(benchDir)
          .filter(f => f.startsWith('seed-corpus-') && f.endsWith('.json'))
          .sort()
          .reverse();
        // Scan files newest-first; pick the first one that has all three
        // tiers populated for the median model.
        let chosen: { perCandidate?: unknown[] } | null = null;
        for (const f of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(benchDir, f), 'utf8')) as { perCandidate?: Array<{ cheap_avg_score?: number | null; mid_avg_score?: number | null; strong_avg_score?: number | null }> };
            const sample = data.perCandidate?.[0];
            if (sample && sample.cheap_avg_score != null && sample.mid_avg_score != null && sample.strong_avg_score != null) {
              chosen = data; break;
            }
            if (!chosen) chosen = data; // fallback to newest
          } catch { /* skip malformed */ }
        }
        if (chosen) {
          for (const raw of chosen.perCandidate ?? []) {
            const r = raw as { id: string; tier?: string; cost_per_m_tok_in?: number; cost_per_m_tok_out?: number; cheap_avg_score?: number | null; mid_avg_score?: number | null; strong_avg_score?: number | null; overall_avg_score?: number | null; latency_mean_ms?: number | null };
            const existing = candidates.get(r.id);
            const c: Candidate = existing ?? { id: r.id, tier: 'unknown' };
            c.tier = ((r.tier as Candidate['tier']) ?? c.tier) || 'unknown';
            c.cost_in = r.cost_per_m_tok_in;
            c.cost_out = r.cost_per_m_tok_out;
            c.cheap = r.cheap_avg_score ?? undefined;
            c.mid = r.mid_avg_score ?? undefined;
            c.strong = r.strong_avg_score ?? undefined;
            c.overall = r.overall_avg_score ?? undefined;
            c.latency_ms = r.latency_mean_ms ?? undefined;
            candidates.set(r.id, c);
          }
        }
      }
    } catch { /* keep going */ }

    const rows = Array.from(candidates.values()).sort((a, b) =>
      (b.overall ?? -1) - (a.overall ?? -1));

    if (fmt === 'json') {
      output.writeln(JSON.stringify({ count: rows.length, candidates: rows }, null, 2));
      return { success: true, data: { count: rows.length, candidates: rows } };
    }

    output.writeln();
    output.writeln(output.bold('Cost-Optimal Router Registry (ADR-149)'));
    output.writeln(output.dim('─'.repeat(60)));
    output.writeln(`  Source: ${seedPath}`);
    output.writeln(`  Candidates: ${rows.length}`);
    output.writeln();
    if (rows.length === 0) {
      output.writeln(output.warning('  No candidates — corpus not generated or measurement not run.'));
      output.writeln(output.dim('  Run: node scripts/gen-seed-corpus-v2.mjs && OPENROUTER_API_KEY=... node scripts/benchmark-seed-corpus.mjs --live'));
      return { success: true, data: { count: 0 } };
    }
    const fmtPct = (v: number | undefined) => v == null ? '—'.padStart(6) : `${(v * 100).toFixed(1)}%`.padStart(6);
    const fmtCost = (v: number | undefined) => v == null ? '—' : `$${v.toFixed(2)}`;
    const fmtLat = (v: number | undefined) => v == null ? '—' : `${v.toFixed(0)}ms`;
    output.writeln('  | Candidate                                  | Tier   |  Cheap |   Mid  | Strong | Overall | $/Mtok in/out | Latency |');
    output.writeln('  |--------------------------------------------|--------|--------|--------|--------|---------|---------------|---------|');
    for (const c of rows) {
      output.writeln(`  | ${c.id.padEnd(42)} | ${c.tier.padEnd(6)} | ${fmtPct(c.cheap)} | ${fmtPct(c.mid)} | ${fmtPct(c.strong)} | ${fmtPct(c.overall)} | ${fmtCost(c.cost_in).padStart(5)}/${fmtCost(c.cost_out).padEnd(6)} | ${fmtLat(c.latency_ms).padStart(7)} |`);
    }
    output.writeln();
    output.writeln(output.dim('  Sorted by overall score desc. Empty cells = no measurement on that tier.'));
    output.writeln(output.dim('  To re-measure: OPENROUTER_API_KEY=... node scripts/benchmark-seed-corpus.mjs --live'));
    output.writeln();
    return { success: true, data: { count: rows.length, candidates: rows } };
  },
};
