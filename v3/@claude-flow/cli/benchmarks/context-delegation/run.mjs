#!/usr/bin/env node
/** Deterministic protocol benchmark; NO LLM, no billing or semantic-quality claims.
 * Node >=24. Import the production TypeScript through native type stripping.
 * Baseline is the full-source coordinator transport reference, not a historical
 * instrumented host trace. Corpus is pinned to the pre-change git commit.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, resolve, dirname, relative } from 'node:path';
import { cpus } from 'node:os';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../..');
const service = join(root, 'v3/@claude-flow/cli/src/services/context-delegation.ts');
const sha = data => createHash('sha256').update(data).digest('hex');
const bytes = data => Buffer.byteLength(data, 'utf8');
const importStarted = performance.now();
const { delegateContextRead } = await import(service);
const coldImportMs = performance.now() - importStarted;
const corpusPath = join(here, 'corpus.json');
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
const sources = new Map(corpus.sources.map(s => {
  const content = execFileSync('git', ['show', `${corpus.baselineCommit}:${s.path}`], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(sha(content), s.sha256); assert.equal(bytes(content), s.bytes);
  return [s.path, { path: s.path, content }];
}));
for (const c of corpus.cases) assert.equal(sources.get(c.path).content.split('\n')[c.line - 1], c.quote);
const trackedSources = [
  'v3/@claude-flow/cli/src/services/context-delegation.ts',
  'v3/@claude-flow/cli/src/commands/context-plan.ts',
  'v3/@claude-flow/cli/__tests__/context-delegation.test.ts',
  relative(root, corpusPath), relative(root, fileURLToPath(import.meta.url)),
  relative(root, join(here, 'verify.mjs')),
  'v3/@claude-flow/cli/tsconfig.context-delegation.json',
  'v3/@claude-flow/cli/src/services/anthropic-context-adapter.ts',
  'v3/@claude-flow/cli/__tests__/anthropic-context-adapter.test.ts',
  'v3/@claude-flow/cli/__tests__/context-provider-pilot.test.ts',
  'v3/@claude-flow/cli/__tests__/context-subscription-pilot.test.ts',
  'v3/@claude-flow/cli/benchmarks/context-delegation/subscription-pilot.mjs',
  'v3/@claude-flow/cli/benchmarks/context-delegation/subscription-live-attempt.json',
  'v3/@claude-flow/cli/benchmarks/context-delegation/provider-pilot.mjs',
];
const manifest = Object.fromEntries(trackedSources.map(p => [p, sha(readFileSync(join(root, p)))]));
const candidateSnapshotSha256 = sha(JSON.stringify(manifest));
const baseline = c => JSON.stringify({ question: c.question, sources: [sources.get(c.path)] });
let workerCalls = 0;
const candidate = c => delegateContextRead({
  read: { mode: 'enforce', intent: 'analysis' }, question: c.question, sources: [sources.get(c.path)],
  adapter: {
    authorize: async () => true, // fixture only: no policy or provider is contacted
    invoke: async request => {
      workerCalls++;
      // Explicit extractive oracle: uses the known requested line, not a model.
      // The service validates this against source identity and exact line content.
      const s = request.sources[0];
      return JSON.stringify({ findings: [{ path: s.path, sourceSha256: s.sha256,
        startLine: c.line, endLine: c.line, quote: s.content.split('\n')[c.line - 1], answer: c.quote }] });
    },
  },
});
// Warm each case; warmup is excluded from raw timed samples and call accounting.
for (const c of corpus.cases) { baseline(c); assert.equal((await candidate(c)).status, 'delegated'); }
workerCalls = 0;
const samples = [];
for (let trial = 0; trial < 10; trial++) {
  for (const c of corpus.cases) {
    let before, after, baselineMs, candidateMs;
    const runBefore = () => { const t = performance.now(); before = baseline(c); baselineMs = performance.now() - t; };
    const runAfter = async () => { const t = performance.now(); after = await candidate(c); candidateMs = performance.now() - t; };
    if ((trial + Number(c.id)) % 2 === 0) { runBefore(); await runAfter(); } else { await runAfter(); runBefore(); }
    assert.equal(after.status, 'delegated');
    assert.equal(after.findings[0].quote, c.quote);
    assert.equal(after.findings[0].answer, c.quote);
    assert.equal(after.receipt.coordinatorBytes, bytes(JSON.stringify(after)));
    const directBytes = bytes(before);
    samples.push({ case: c.id, trial, order: (trial + Number(c.id)) % 2 === 0 ? 'baseline-first' : 'candidate-first',
      baselineMs, candidateMs, addedMs: candidateMs - baselineMs, sourceBytes: after.receipt.sourceBytes,
      baselineCoordinatorBytes: directBytes, candidateCoordinatorBytes: after.receipt.coordinatorBytes,
      workerInputBytes: after.receipt.workerInputBytes, workerOutputBytes: after.receipt.workerOutputBytes,
      totalCandidateBoundaryBytes: after.receipt.workerInputBytes + after.receipt.workerOutputBytes + after.receipt.coordinatorBytes,
      quoteVerified: true, exactFactMatched: true });
  }
}
const sum = key => samples.reduce((n, s) => n + s[key], 0);
const percentile = (key, p) => { const values = samples.map(s => s[key]).sort((a,b) => a-b); return values[Math.ceil(values.length * p) - 1]; };
const baselineBytes = sum('baselineCoordinatorBytes');
const coordinatorBytes = sum('candidateCoordinatorBytes');
const reduction = 1 - coordinatorBytes / baselineBytes;
assert.equal(samples.length, 300); assert.equal(workerCalls, 300); assert.ok(reduction >= 0.7);
const result = {
  schema: 'ruflo.context-delegation-benchmark/v1', generatedAt: new Date().toISOString(),
  kind: 'deterministic-extractive-protocol', baseline: 'full-source coordinator transport reference; not a live historical host trace',
  baselineCommit: corpus.baselineCommit, candidateSnapshotSha256, manifest,
  runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model },
  coldImportMs, warmupCases: 30, cases: 30, repetitions: 10, workerCalls,
  summary: {
    baselineCoordinatorBytes: baselineBytes, candidateCoordinatorBytes: coordinatorBytes,
    coordinatorByteReductionPct: reduction * 100, workerInputBytes: sum('workerInputBytes'), workerOutputBytes: sum('workerOutputBytes'),
    totalCandidateBoundaryBytes: sum('totalCandidateBoundaryBytes'),
    totalBoundaryIncreasePct: (sum('totalCandidateBoundaryBytes') / baselineBytes - 1) * 100,
    baselineP50Ms: percentile('baselineMs', .5), baselineP95Ms: percentile('baselineMs', .95),
    candidateP50Ms: percentile('candidateMs', .5), candidateP95Ms: percentile('candidateMs', .95),
    addedP50Ms: percentile('addedMs', .5), addedP95Ms: percentile('addedMs', .95),
    exactFactsMatched: samples.length, quotesVerified: samples.length,
  },
  limitations: [
    'No LLM or network calls: no measured model quality, inference latency, token counts, billing or realized dollar savings.',
    'Oracle worker has the expected target line; exact-fact pass rate is transport fidelity only, not semantic accuracy.',
    'Baseline protocol is reconstructed full-source transport using pinned pre-change files, not an instrumented production session.',
    'Total bytes include worker input, worker output and complete coordinator result; no inference cost is inferred from bytes.',
    'Timing is in-process on this machine; warm filesystem and omitted provider work make it unsuitable for production latency forecasts.',
  ],
  samples,
};
const output = resolve(process.argv[2] ?? join(here, 'results.json'));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, candidateSnapshotSha256, ...result.summary }, null, 2));
