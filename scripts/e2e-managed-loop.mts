/** Real verifier subprocess + real ledger services; costs/workloads are synthetic fixtures. */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { digest, isVerified, manifestOf } from '../v3/@claude-flow/cli/src/services/managed-learning.js';
import { evaluateLearning, learningStatus, recordLearning, recommendLearning } from '../v3/@claude-flow/cli/src/services/managed-learning-store.js';
import { cycleLearning } from '../v3/@claude-flow/cli/src/services/managed-learning-loop.js';
import { treeHash, type HostManifest } from './managed-outcome-verifier.mjs';

const root = mkdtempSync(join(tmpdir(), 'managed-verifier-e2e-'));
const keys = mkdtempSync(join(tmpdir(), 'managed-verifier-keys-'));
const cycleRoot = mkdtempSync(join(tmpdir(), 'managed-verifier-cycle-'));
const deniedRoot = mkdtempSync(join(tmpdir(), 'managed-verifier-denied-'));
chmodSync(root, 0o700); chmodSync(keys, 0o700);
const pair = generateKeyPairSync('ed25519');
const publicKey = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const privatePath = join(keys, 'verifier.pem');
writeFileSync(privatePath, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
// Hosted tool-cache executables can be group-writable. Keep the verifier's
// executable policy intact by staging an owner-only fixture binary.
const fixtureNode = join(keys, 'node-fixture');
copyFileSync(process.execPath, fixtureNode); chmodSync(fixtureNode, 0o700);
const verifier = join(dirname(fileURLToPath(import.meta.url)), 'managed-outcome-verifier.mjs');
let assertions = 0;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); assertions++; };
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
const fixtureSource = `const fs = require('node:fs'), assert = require('node:assert/strict');
const artifact = JSON.parse(fs.readFileSync('artifact.json', 'utf8'));
const task = JSON.parse(fs.readFileSync('task.json', 'utf8'));
const solve = x => { if (!Number.isInteger(x) || x < 0 || x > 100) throw Error('invalid'); return x * 2; };
const kind = process.argv[2];
if (kind === 'acceptance') { if (artifact.strategy === 'baseline') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); assert.equal(artifact.output, task.expected); }
else if (kind === 'safety') { assert.deepEqual(Object.keys(artifact).sort(), ['output','strategy','x']); assert.ok(Number.isSafeInteger(artifact.output)); assert.equal(process.env.RUFLO_MANAGED_VERIFIER_PRIVATE_KEY_FILE, undefined); }
else if (kind === 'replay') { assert.equal(solve(artifact.x), solve(artifact.x)); assert.equal(solve(artifact.x), artifact.output); }
else if (kind === 'adversarial') { for (const x of ['injection', -1, 101, null]) assert.throws(() => solve(x)); }
else if (kind === 'metrics') { const samples = [1,2,3], failed = samples.filter(x => solve(x) !== x*2).length; console.log(JSON.stringify({ drift: failed/samples.length, driftThreshold: .05, rollbackRate: failed/samples.length })); }
else if (kind === 'slow') setTimeout(() => {}, 10000);
else if (kind === 'mutate') fs.appendFileSync('check.cjs', '\\n// changed');
else if (kind === 'private-failure') { console.error('private-child-diagnostic-marker'); process.exitCode = 1; }
else throw Error('unknown check');
`;
writeFileSync(join(root, 'check.cjs'), fixtureSource, { mode: 0o600 });
json(join(root, 'policy.json'), { v: 1, policy: 'bounded-fixture-tests', release: false });
json(join(root, 'evaluator.json'), { v: 1, measures: 'functional fixture checks, not universal safety or live provider performance' });
const heldTasks = [{ id: 'held-one', x: 5, expected: 10 }, { id: 'held-two', x: 7, expected: 14 }];
const manifest = manifestOf({ taskHashes: heldTasks.map(digest), trials: [0, 1, 2] });
json(join(root, 'corpus.json'), manifest);
const command = (kind: string) => ({ argv: [fixtureNode, join(root, 'check.cjs'), kind], cwd: '.', timeoutMs: 3000 });
let lastManifest: HostManifest;
function prepare(task: { id: string; x: number; expected: number }, strategyId: string, split: 'train' | 'holdout', trial: number): HostManifest {
  json(join(root, 'task.json'), task);
  json(join(root, 'artifact.json'), { strategy: strategyId, x: task.x, output: task.expected });
  const strategy = { id: strategyId, model: 'fixture-no-provider', workers: strategyId === 'baseline' ? 1 : 2, template: 'functional-fixture' };
  const sourceHash = treeHash(root, ['check.cjs']), artifactHash = treeHash(root, ['artifact.json']);
  json(join(root, 'cost.json'), { v: 1, origin: 'synthetic-fixture', amountCents: strategyId === 'baseline' ? 100 : 50, taskHash: digest(task), sourceHash, artifactHash, strategyHash: digest(strategy), receiptId: digest({ task, strategyId, split, trial }) });
  lastManifest = { v: 1, root, sourceFiles: ['check.cjs'], artifactFiles: ['artifact.json'], taskSpec: 'task.json', policySpec: 'policy.json', corpusSpec: 'corpus.json', evaluatorSpec: 'evaluator.json', costReceipt: 'cost.json', taskType: 'code-review', split, trial, strategy, budgetCents: 250,
    checks: { acceptance: [command('acceptance')], safety: [command('safety')], replay: [command('replay')], adversarial: [command('adversarial')] }, metrics: command('metrics') };
  json(join(root, 'host-manifest.json'), lastManifest);
  return lastManifest;
}
function invoke(expectSuccess = true) {
  const result = spawnSync(process.execPath, [verifier, join(root, 'host-manifest.json')], { encoding: 'utf8', timeout: 125_000, maxBuffer: 1_000_000, env: { PATH: '/usr/bin:/bin', RUFLO_MANAGED_VERIFIER_PRIVATE_KEY_FILE: privatePath, RUFLO_MANAGED_VERIFIER_ALLOW_SYNTHETIC: '1' } });
  check(expectSuccess ? result.status === 0 : result.status !== 0, `Verifier unexpected exit ${result.status}`);
  check(!result.stdout.includes('PRIVATE KEY') && !result.stdout.includes('private-child-diagnostic-marker') && !result.stderr.includes('private-child-diagnostic-marker'), 'Private check output must not escape');
  return expectSuccess ? JSON.parse(result.stdout) : null;
}

try {
  const evidence = [];
  for (const strategyId of ['baseline', 'candidate']) {
    for (let trial = 0; trial < 3; trial++) {
      prepare({ id: `training-${trial}`, x: trial + 1, expected: (trial + 1) * 2 }, strategyId, 'train', trial);
      const result = invoke(); evidence.push(result.evidence);
      check(isVerified(result.evidence, publicKey), 'Verifier receipt must authenticate');
      check(result.report.costOrigin === 'synthetic-fixture' && result.report.checks.length === 5, 'Every declared independent check must execute');
      check(result.evidence.observation.durationMs > 0 && result.evidence.observation.checks.safety, 'Metrics are from actual subprocess checks');
      if (strategyId === 'baseline' && trial === 0) {
        recordLearning(root, { observation: result.evidence.observation }, publicKey);
        check(learningStatus(root, publicKey).verified === 0, 'Unsigned outcome must remain quarantined');
      }
      recordLearning(root, result.evidence, publicKey);
    }
    for (const task of heldTasks) for (const trial of manifest.trials) {
      prepare(task, strategyId, 'holdout', trial);
      const result = invoke(); evidence.push(result.evidence); recordLearning(root, result.evidence, publicKey);
    }
  }
  const scope = { taskType: 'code-review' as const, policyHash: evidence[0].observation.policyHash, evaluatorHash: evidence[0].observation.evaluatorHash };
  const recommendation = recommendLearning(root, scope, publicKey);
  check(recommendation.selected?.strategy.id === 'candidate' && recommendation.defaultsChanged === false, 'Real ledger must recommend from full trusted training cohort');
  const evaluation = evaluateLearning(root, { scope, manifest, baselineId: 'baseline', candidateId: 'candidate' }, publicKey);
  check(evaluation.pairedResults === 6 && evaluation.delta === 1 && evaluation.defaultsChanged === false, 'Real paired holdout must retain immutable evaluation boundaries');
  check(evaluation.eligible, 'Bounded fixture should satisfy independent gate under measured latency');
  check(learningStatus(root, publicKey).verified === 18, 'All verifier subprocess receipts must reload and authenticate');
  const cycleInput = { scope, evidence, evaluation: { manifest, baselineId: 'baseline', candidateId: 'candidate' }, index: false };
  const cycle = await cycleLearning(cycleRoot, cycleInput, publicKey, () => true);
  check(cycle.recorded.length === 18 && cycle.evaluation?.eligible && cycle.phases.join(',') === 'admitted,recorded,recommended,evaluated', 'Real feedback cycle must admit, record, recommend and evaluate');
  const replay = await cycleLearning(cycleRoot, cycleInput, publicKey, () => true);
  check(replay.cycleId === cycle.cycleId && replay.recorded.length === 0 && replay.duplicates.length === 18, 'Actual cycle replay must be idempotent');
  await assert.rejects(cycleLearning(deniedRoot, cycleInput, publicKey, () => false)); assertions++;
  check(!existsSync(join(deniedRoot, '.claude-flow')), 'Denied cycle must have no ledger side effects');
  const copied = JSON.parse(JSON.stringify(evidence[0])); copied.observation.costCents = 1;
  check(!isVerified(copied, publicKey), 'Post-verification cost mutation must invalidate signature');
  assert.throws(() => recordLearning(root, copied, publicKey)); assertions++;
  const wrongKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' }).toString();
  check(learningStatus(root, wrongKey).lastEvaluation === null, 'Key rotation must invalidate old eligible advice');

  prepare({ id: 'failure', x: 2, expected: 4 }, 'candidate', 'train', 9);
  lastManifest!.checks.acceptance = [command('private-failure')]; json(join(root, 'host-manifest.json'), lastManifest!);
  const failure = invoke();
  check(failure.evidence.observation.checks.acceptance === false && isVerified(failure.evidence, publicKey), 'Actual failed checks must remain signed failures');
  prepare({ id: 'timeout', x: 2, expected: 4 }, 'candidate', 'train', 10);
  lastManifest!.checks.acceptance = [{ ...command('slow'), timeoutMs: 30 }]; json(join(root, 'host-manifest.json'), lastManifest!);
  const timeout = invoke();
  check(timeout.evidence.observation.checks.acceptance === false && timeout.report.checks[0].timedOut, 'Timeout must never become a passing check');
  prepare({ id: 'bad-cost', x: 2, expected: 4 }, 'candidate', 'train', 11);
  const cost = JSON.parse(readFileSync(join(root, 'cost.json'), 'utf8')); cost.taskHash = digest('wrong-task'); json(join(root, 'cost.json'), cost); invoke(false);
  prepare({ id: 'bad-command', x: 2, expected: 4 }, 'candidate', 'train', 12);
  lastManifest!.checks.acceptance[0]!.argv[0] = 'node'; json(join(root, 'host-manifest.json'), lastManifest!); invoke(false);
  prepare({ id: 'unsafe-executable', x: 2, expected: 4 }, 'candidate', 'train', 12);
  chmodSync(fixtureNode, 0o770); invoke(false); chmodSync(fixtureNode, 0o700);
  prepare({ id: 'shell-command', x: 2, expected: 4 }, 'candidate', 'train', 12);
  lastManifest!.checks.acceptance[0]!.argv = ['/bin/sh', '-c', 'exit 0']; json(join(root, 'host-manifest.json'), lastManifest!); invoke(false);
  prepare({ id: 'bad-cwd', x: 2, expected: 4 }, 'candidate', 'train', 13);
  lastManifest!.checks.acceptance[0]!.cwd = '../'; json(join(root, 'host-manifest.json'), lastManifest!); invoke(false);
  prepare({ id: 'key-mode', x: 2, expected: 4 }, 'candidate', 'train', 14);
  chmodSync(privatePath, 0o644); invoke(false); chmodSync(privatePath, 0o600);
  prepare({ id: 'mutated-source', x: 2, expected: 4 }, 'candidate', 'train', 15);
  lastManifest!.checks.acceptance = [command('mutate')]; json(join(root, 'host-manifest.json'), lastManifest!); invoke(false);
  console.log(JSON.stringify({ schema: 'ruflo.managed-verifier-e2e/v1', assertions, verifiedSubprocessReceipts: 18, cyclePhases: cycle.phases, replayedDuplicates: replay.duplicates.length, deniedCycleWrites: 0, training: 6, pairedHoldout: evaluation.pairedResults, advisoryEligible: evaluation.eligible, measuredBaselineP95Ms: evaluation.baselineP95Ms, measuredCandidateP95Ms: evaluation.candidateP95Ms, defaultsChanged: false, costOrigin: 'synthetic-fixture', limitations: 'Real verifier subprocesses, signatures, file persistence, feedback cycle and heldout gates; synthetic workload and cost fixture only. No live provider quality, billing savings, universal safety or native vector backend is claimed.' }, null, 2));
} finally { for (const path of [root, keys, cycleRoot, deniedRoot]) rmSync(path, { recursive: true, force: true }); }
