/** Real disk/native-memory probe. Run write, then recall in a NEW process with tsx.
 * Synthetic signed fixtures test plumbing only; they are not measured model outcomes.
 * Usage: tsx scripts/e2e-managed-native.mts write|status|recall /absolute/isolated/state
 * Does not install dependencies, call a model, persist a private key or change defaults.
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { canonical, digest, observationOf } from '../v3/@claude-flow/cli/src/services/managed-learning.js';
import { indexLearning, learningStatus, recallLearning, recordLearning, recommendLearning } from '../v3/@claude-flow/cli/src/services/managed-learning-store.js';
import { managedMemoryClient } from '../v3/@claude-flow/cli/src/services/managed-memory-client.js';

const [mode, inputRoot] = process.argv.slice(2);
assert(['write', 'status', 'recall'].includes(mode));
assert(inputRoot && isAbsolute(inputRoot), 'Use an explicit isolated absolute state directory');
const root = resolve(inputRoot), metadata = join(root, 'probe.json');
const scope = { taskType: 'code-review', policyHash: digest('native-probe-policy'), evaluatorHash: digest('synthetic-plumbing-only') };
let output: Record<string, unknown> = { mode, syntheticFixtures: true, modelCalls: 0, defaultsChanged: false };
try {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  process.chdir(root); // Native memory paths are scoped to the process project root.
  if (mode === 'write') {
    assert(!existsSync(metadata), 'Refusing to overwrite an existing probe');
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const pair = generateKeyPairSync('ed25519');
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const ids: string[] = [];
    for (let trial = 0; trial < 3; trial++) {
      const observation = observationOf({ v: 1, attemptId: digest(`native-attempt-${trial}`), taskHash: digest(`native-task-${trial}`),
        sourceHash: digest('synthetic-source'), artifactHash: digest('synthetic-artifact'), corpusHash: digest('native-train'), ...scope,
        split: 'train', trial, strategy: { id: 'fixture', model: 'synthetic-no-model', workers: 1, template: 'plumbing' }, budgetCents: 100,
        costCents: 1, durationMs: 1, checks: { acceptance: true, safety: true, replay: true, adversarial: true, drift: 0, driftThreshold: .05, rollbackRate: 0 } });
      const evidence = { observation, signature: sign(null, Buffer.from(canonical(observation)), pair.privateKey).toString('base64') };
      const stored = recordLearning(root, evidence, publicKey);
      assert(stored.verified);
      ids.push(stored.id);
    }
    writeFileSync(metadata, JSON.stringify({ publicKey, ids }), { mode: 0o600 });
    const recommendation = recommendLearning(root, scope, publicKey);
    assert.equal(recommendation.selected?.samples, 3);
    assert.equal(learningStatus(root, publicKey).verified, 3);
    const indexed = [], indexMs = [];
    for (const id of ids) { const started = performance.now(); indexed.push(await indexLearning(root, id, publicKey)); indexMs.push(performance.now() - started); }
    assert(indexed.every(row => row.durable));
    // Replay the same immutable native rows instead of attempting overwrite.
    for (const id of ids) assert.equal((await indexLearning(root, id, publicKey)).durable, true);
    output = { ...output, verifiedRows: 3, indexed, indexMs, nativeReplayRows: ids.length, workers: managedMemoryClient.stats().workers, advisoryStrategy: recommendation.selected?.strategy.id };
  } else {
    const { publicKey, ids } = JSON.parse(readFileSync(metadata, 'utf8'));
    assert.equal(learningStatus(root, publicKey).verified, 3);
    if (mode === 'status') {
      output = { ...output, verifiedRows: 3, ledgerReloaded: true, nativeBackendExercised: false };
    } else {
      const recalled = await recallLearning(root, scope, publicKey);
      assert(recalled.available, 'Memory backend unavailable after restart');
      assert.equal(recalled.evidence.length, ids.length, 'Every indexed fixture must survive restart and signature validation');
      assert(recalled.evidence.every(row => ids.includes(row.id)));
      assert.equal(recalled.recommendation.selected?.samples, 3);
      output = { ...output, verifiedRows: 3, recalled: recalled.evidence.length, backend: recalled.backend,
        similarityIsVerification: recalled.similarityIsVerification, advisoryStrategy: recalled.recommendation.selected?.strategy.id };
    }
  }
  output.passed = true;
} catch (error) {
  output = { ...output, passed: false, error: (error as Error).message };
  process.exitCode = 1;
} finally {
  managedMemoryClient.close();
  writeFileSync(join(root, `native-${mode}.json`), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output));
}
