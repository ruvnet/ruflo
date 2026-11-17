/** Deterministic event-processing benchmark, not a model-quality benchmark.
 * Node >=22.18: node scripts/bench-managed-workflows.mjs
 */
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ManagedProgress } from '../v3/@claude-flow/cli/src/services/managed-workflows.ts';

const baselineCommit = '973d0ab497c9138d7bee1dc3c7a4d3985e37bf9e';
const baselinePath = 'v3/@claude-flow/cli/src/mcp-tools/managed-agent-tools.ts';
const baselineSource = execFileSync('git', ['show', `${baselineCommit}:${baselinePath}`], { encoding: 'utf8' });
// Exercise the exact original summarizer from the frozen source, compiled by
// Node's strip-types, rather than substituting a slower baseline algorithm.
const { stripTypeScriptTypes } = await import('node:module');
const original = baselineSource.slice(baselineSource.indexOf('function summarizeEvents('), baselineSource.indexOf('async function fetchSessionEvents('));
const summarize = new Function(`${stripTypeScriptTypes(original)}; return summarizeEvents;`)();
const hash = value => createHash('sha256').update(value).digest('hex');
const candidateSource = readFileSync('v3/@claude-flow/cli/src/services/managed-workflows.ts');
const events = Array.from({ length: 5000 }, (_, i) => ({
  id: `e${i}`, type: 'agent.message', processed_at: new Date(1792843200000 + i).toISOString(),
  content: [{ type: 'text', text: 'bounded result\n' }],
}));
events.push({ id: 'idle', type: 'session.status_idle', processed_at: '2026-10-24T13:00:00Z', stop_reason: { type: 'end_turn' } });

function run(mode) {
  const p = new ManagedProgress(); let result;
  const start = performance.now();
  for (let n = 100; n < events.length + 100; n += 100) {
    result = mode === 'baseline' ? summarize(events.slice(0, n)) : (p.accept(events.slice(n - 100, n)), p.snapshot());
  }
  return { ms: performance.now() - start, result };
}
for (let i = 0; i < 3; i++) { run('baseline'); run('incremental'); }
const baseline = [], candidate = [];
for (let i = 0; i < 9; i++) {
  // Alternate order to reduce systematic warmup bias.
  const order = i % 2 ? ['baseline', 'incremental'] : ['incremental', 'baseline'];
  for (const mode of order) {
    const r = run(mode); (mode === 'baseline' ? baseline : candidate).push(r.ms);
    if (r.result.assistantText !== events.slice(0, -1).map(e => e.content[0].text).join('')) throw new Error('Output mismatch');
  }
}
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const polls = Math.ceil(events.length / 100);
const baselineVisits = Array.from({ length: polls }, (_, i) => Math.min(events.length, (i + 1) * 100)).reduce((a, b) => a + b, 0);
console.log(JSON.stringify({
  kind: 'synthetic event processing only', node: process.version, baselineCommit,
  baselineSha256: hash(baselineSource), candidateSha256: hash(candidateSource),
  events: events.length, polls, repeats: 9,
  baselineMedianMs: median(baseline), candidateMedianMs: median(candidate),
  latencyRatio: median(baseline) / median(candidate),
  baselineEventVisits: baselineVisits, incrementalEventVisits: events.length,
  eventVisitReduction: 1 - events.length / baselineVisits,
  limitations: 'No provider latency, token savings, dollar savings or bug-finding improvement measured. Snapshot output assembly is included in both timings.',
}, null, 2));
