#!/usr/bin/env node
/** Verify recorded evidence against current source bytes. No network access. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../..');
const sha = data => createHash('sha256').update(data).digest('hex');
const result = JSON.parse(readFileSync(resolve(process.argv[2] ?? join(here, 'results.json')), 'utf8'));
assert.equal(result.schema, 'ruflo.context-delegation-benchmark/v1');
assert.equal(result.kind, 'deterministic-extractive-protocol');
for (const [path, expected] of Object.entries(result.manifest)) assert.equal(sha(readFileSync(join(root, path))), expected, `source changed: ${path}`);
assert.equal(sha(JSON.stringify(result.manifest)), result.candidateSnapshotSha256);
const corpus = JSON.parse(readFileSync(join(here, 'corpus.json'), 'utf8'));
assert.equal(corpus.baselineCommit, result.baselineCommit);
for (const s of corpus.sources) assert.equal(sha(execFileSync('git', ['show', `${corpus.baselineCommit}:${s.path}`], { cwd: root })), s.sha256);
assert.equal(result.samples.length, corpus.cases.length * result.repetitions);
const seen = new Set();
for (const s of result.samples) {
  assert.ok(corpus.cases.some(c => c.id === s.case));
  assert.ok(Number.isInteger(s.trial) && s.trial >= 0 && s.trial < result.repetitions);
  const key = `${s.case}:${s.trial}`; assert.ok(!seen.has(key)); seen.add(key);
  assert.ok(s.quoteVerified && s.exactFactMatched);
  for (const key of ['baselineMs', 'candidateMs', 'baselineCoordinatorBytes', 'candidateCoordinatorBytes', 'workerInputBytes', 'workerOutputBytes']) assert.ok(Number.isFinite(s[key]) && s[key] >= 0);
  assert.equal(s.totalCandidateBoundaryBytes, s.workerInputBytes + s.workerOutputBytes + s.candidateCoordinatorBytes);
}
const sum = key => result.samples.reduce((n, s) => n + s[key], 0);
for (const key of ['baselineCoordinatorBytes', 'candidateCoordinatorBytes', 'workerInputBytes', 'workerOutputBytes', 'totalCandidateBoundaryBytes']) assert.equal(result.summary[key], sum(key));
assert.equal(result.summary.coordinatorByteReductionPct, (1 - sum('candidateCoordinatorBytes') / sum('baselineCoordinatorBytes')) * 100);
assert.ok(result.summary.coordinatorByteReductionPct >= 70);
assert.equal(result.workerCalls, result.samples.length);
console.log(`Verified ${result.samples.length} paired samples and ${Object.keys(result.manifest).length} source hashes. Deterministic protocol evidence only.`);

const attempt = JSON.parse(readFileSync(join(here, 'subscription-live-attempt.json'), 'utf8'));
assert.equal(sha(attempt.provenance.runnerSource), attempt.manifest.runner);
assert.equal(attempt.phases.baseline.status, 'failed');
assert.equal(attempt.phases.baseline.chargeUncertain, true);
assert.equal(attempt.phases.baseline.receipt.childTerminationConfirmed, true);
assert.equal(attempt.interpretation.cost, 'unknown');
assert.equal(attempt.interpretation.automaticRetry, false);
console.log('Verified archived failed live attempt provenance; cost remains unknown.');
