/** CPU-only collector/learning benchmark. Pass the directory compiled by tsc. */
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
const build = resolve(process.argv[2] ?? '/tmp/managed-integration-build');
const { ManagedRunCollector } = await import(pathToFileURL(join(build, 'managed-run-collector.js')));
const { canonical, digest, observationOf, recommend, trustedEvidence } = await import(pathToFileURL(join(build, 'managed-learning.js')));
const event = (id, type, rest = {}) => ({ id, type, processed_at: '2026-10-24T12:00:00Z', ...rest });
const events = [event('run', 'workflow_run.created', { workflow_run_id: 'wrun_a', phases: [] })];
for (let i = 0; i < 1000; i++) {
  const s = { workflow_run_id: 'wrun_a', session_thread_id: `thread_${i}` };
  events.push(event(`c${i}`, 'session.thread_created', s), event(`r${i}`, 'session.thread_status_running', s), event(`e${i}`, 'session.thread_status_terminated', s));
}
events.push(event('end', 'workflow_run.status_ended', { workflow_run_id: 'wrun_a', result: { type: 'completed' } }), event('idle', 'session.status_idle', { stop_reason: { type: 'end_turn' } }));
let reads = 0;
const collector = new ManagedRunCollector();
const transport = { readEvents: async () => { reads++; return [...events, ...events]; }, readSession: async () => { reads++; return { status: 'idle' }; } };
const start = performance.now();
const [one, two] = await Promise.all([collector.refresh('sesn_bench', transport), collector.refresh('sesn_bench', transport)]);
const collectionMs = performance.now() - start;
if (reads !== 2 || one.snapshot.threadCount !== 1000 || two.snapshot.verification !== 'unverified') throw Error('Collector invariant failed');
const pages = [];
for (let i = 0; i < 100; i++) { const at = performance.now(); collector.page('sesn_bench', (i % 16) * 60); pages.push(performance.now() - at); }
const before = reads;
for (let i = 0; i < 1000; i++) collector.snapshots();
if (reads !== before) throw Error('Inactive traffic');
const pair = generateKeyPairSync('ed25519'), key = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const scope = { taskType: 'code-review', policyHash: digest('policy'), evaluatorHash: digest('evaluator') };
const rows = [];
for (const id of ['baseline', 'candidate']) for (let i = 0; i < 30; i++) {
  const o = observationOf({ v: 1, attemptId: digest(`${id}-${i}`), taskHash: digest(`train-${i}`), sourceHash: digest('source'), artifactHash: digest('artifact'), corpusHash: digest('train'), ...scope, split: 'train', trial: 0,
    strategy: { id, model: 'claude-fixture', workers: 1, template: 'review' }, budgetCents: 250, costCents: id === 'candidate' ? 50 : 100, durationMs: 100,
    checks: { acceptance: true, safety: true, replay: true, adversarial: true, drift: 0, driftThreshold: .05, rollbackRate: 0 } });
  rows.push({ observation: o, signature: sign(null, Buffer.from(canonical(o)), pair.privateKey).toString('base64') });
}
const attestStart = performance.now(), trusted = trustedEvidence(rows, key), signatureVerificationMs = performance.now() - attestStart;
const samples = [];
for (let i = 0; i < 100; i++) { const at = performance.now(); const result = recommend(trusted, scope); if (result.selected?.strategy.id !== 'candidate') throw Error('Recommendation invariant'); samples.push(performance.now() - at); }
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const sourceHashes = Object.fromEntries(['managed-run-collector.ts', 'managed-learning.ts', 'managed-run-store.ts', 'managed-learning-store.ts'].map(f => [f, createHash('sha256').update(readFileSync(`v3/@claude-flow/cli/src/services/${f}`)).digest('hex')]));
console.log(JSON.stringify({ kind: 'synthetic CPU and contract benchmark', node: process.version, sourceHashes, workers: 1000, replayedEvents: events.length * 2, uniqueEvents: one.events.length, eventReads: 1, sessionReads: 1, inactiveReads: reads - before, collectionMs, workerPageMedianMs: median(pages), signedTrainingRows: trusted.length, signatureVerificationMs, recommendationMedianMs: median(samples), syntheticSelected: 'candidate', limitations: 'Fixture costs and outcomes are synthetic. No live provider quality, dollar savings, native vector backend or GPU/UI performance is measured. Warm console rendering is separately covered by view tests.' }, null, 2));
