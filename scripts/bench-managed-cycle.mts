/** Same signed rows and durable semantics: legacy individual writes versus atomic cycle admission. */
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, digest, observationOf } from '../v3/@claude-flow/cli/src/services/managed-learning.js';
import { learningStatus, recordLearning, recordLearningBatch } from '../v3/@claude-flow/cli/src/services/managed-learning-store.js';

const pair = generateKeyPairSync('ed25519'), key = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const rows = Array.from({ length: 18 }, (_, i) => {
  const observation = observationOf({ v: 1, attemptId: digest(`attempt-${i}`), taskHash: digest(`task-${i}`), sourceHash: digest('source'), artifactHash: digest('artifact'), policyHash: digest('policy'), corpusHash: digest('train'), evaluatorHash: digest('evaluator'), taskType: 'implementation', split: 'train', trial: 0,
    strategy: { id: 'fixture', model: 'no-model', workers: 1, template: 'bench' }, budgetCents: 100, costCents: 1, durationMs: 1,
    checks: { acceptance: true, safety: true, replay: true, adversarial: true, drift: 0, driftThreshold: .05, rollbackRate: 0 } });
  return { observation, signature: sign(null, Buffer.from(canonical(observation)), pair.privateKey).toString('base64') };
});
const sequential: number[] = [], atomic: number[] = [];
for (let round = 0; round < 7; round++) {
  const root = mkdtempSync(join(tmpdir(), 'managed-cycle-bench-'));
  try {
    const a = join(root, 'sequential'), b = join(root, 'atomic');
    const { mkdirSync } = await import('node:fs'); mkdirSync(a); mkdirSync(b);
    let at = performance.now(); for (const e of rows) recordLearning(a, e, key); sequential.push(performance.now() - at);
    at = performance.now(); recordLearningBatch(b, rows, key); atomic.push(performance.now() - at);
    assert.equal(learningStatus(a, key).verified, 18); assert.equal(learningStatus(b, key).verified, 18);
    const records = (path: string) => JSON.parse(readFileSync(join(path, '.claude-flow/managed-learning/state.json'), 'utf8')).records;
    assert.equal(digest(records(a)), digest(records(b)), 'Both paths must persist identical evidence');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
const source = 'v3/@claude-flow/cli/src/services/managed-learning-store.ts';
console.log(JSON.stringify({ kind: 'local durable-admission CPU benchmark', node: process.version, rounds: 7, signedRows: 18,
  baseline: '18 recordLearning transactions', candidate: 'one recordLearningBatch transaction', equivalentEvidence: true,
  sequentialMedianMs: median(sequential), atomicMedianMs: median(atomic), speedup: median(sequential) / median(atomic),
  admissionTransactions: { baseline: 18, candidate: 1 }, sourceSha256: createHash('sha256').update(readFileSync(source)).digest('hex'),
  limitations: 'Synthetic metadata, same-machine temporary filesystem and seven runs. No provider task quality, native backend speed, billing savings or deployment promotion is inferred.' }, null, 2));
