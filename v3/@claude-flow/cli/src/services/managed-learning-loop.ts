/** Bounded, replayable feedback cycle. Evaluation is never promotion authority. */
import { digest, evidenceOf, isVerified, manifestOf, scopeOf, trustedEvidence } from './managed-learning.js';
import { evaluateLearning, indexLearning, recallLearning, recordLearningBatch, recommendLearning } from './managed-learning-store.js';

export type ManagedCycleInput = {
  scope: unknown; evidence: unknown[]; index?: boolean; maxP95Ms?: number;
  evaluation?: { manifest: unknown; baselineId: string; candidateId: string };
};

function inputOf(value: unknown): ManagedCycleInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a managed cycle');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['scope', 'evidence', 'index', 'maxP95Ms', 'evaluation'].includes(k)) || !Array.isArray(v.evidence) || v.evidence.length > 24) throw new Error('Managed cycle accepts at most 24 signed outcomes');
  if (v.index !== undefined && typeof v.index !== 'boolean') throw new Error('Invalid indexing request');
  if (v.maxP95Ms !== undefined && (typeof v.maxP95Ms !== 'number' || !Number.isFinite(v.maxP95Ms) || v.maxP95Ms <= 0 || v.maxP95Ms > 86_400_000)) throw new Error('Invalid latency constraint');
  if (v.evaluation !== undefined) {
    const e = v.evaluation as Record<string, unknown>;
    if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).length !== 3 || Object.keys(e).some(k => !['manifest', 'baselineId', 'candidateId'].includes(k)) || typeof e.baselineId !== 'string' || typeof e.candidateId !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(e.baselineId) || !/^[a-z][a-z0-9-]{0,39}$/.test(e.candidateId) || e.baselineId === e.candidateId) throw new Error('Invalid evaluation request');
    manifestOf(e.manifest);
  }
  scopeOf(v.scope);
  return structuredClone(v) as ManagedCycleInput;
}

/** authorize is host-owned and rechecked across asynchronous boundaries. */
export async function cycleLearning(root: string, value: unknown, publicKey: string | undefined, authorize: () => boolean) {
  const started = performance.now(), input = inputOf(value), scope = scopeOf(input.scope);
  const rows = input.evidence.map(evidenceOf);
  const check = () => { if (!authorize() || !publicKey) throw new Error('Host learning policy or verifier changed'); };
  check();
  // Reject the whole batch before any write; unsigned input cannot start a cycle.
  for (const e of rows) if (!isVerified(e, publicKey) || e.observation.costCents === null || e.observation.durationMs === null || e.observation.taskType !== scope.taskType || e.observation.policyHash !== scope.policyHash || e.observation.evaluatorHash !== scope.evaluatorHash) throw new Error('Every cycle outcome must be authenticated, measured and in scope');
  const trusted = trustedEvidence(rows, publicKey).sort((a, b) => digest(a.observation).localeCompare(digest(b.observation)));
  if (input.index && trusted.filter(e => e.observation.split === 'train').length > 6) throw new Error('Indexing cycles accept at most six training outcomes; split the batch');
  const cycleId = digest({ scope, evidence: trusted.map(e => digest(e.observation)).sort(), evaluation: input.evaluation ?? null, index: input.index ?? false, maxP95Ms: input.maxP95Ms ?? null });
  const recorded: string[] = [], duplicates: string[] = [], indexed: string[] = [], deferred: string[] = [];
  const phases: string[] = ['admitted'];
  // One atomic batch avoids per-row sync/summary work. Later native failures
  // leave a resumable signed batch, never a claimed indexed outcome.
  check();
  for (const r of trusted.length ? recordLearningBatch(root, trusted, publicKey) : []) {
    (r.duplicate ? duplicates : recorded).push(r.id);
  }
  phases.push('recorded');
  let memory: Awaited<ReturnType<typeof recallLearning>> | undefined;
  if (input.index) {
    const training = trusted.filter(e => e.observation.split === 'train');
    for (const e of training.slice(0, 6)) {
      check(); const r = await indexLearning(root, digest(e.observation), publicKey, authorize); check();
      if (r.indexed) indexed.push(r.id); else deferred.push(r.id);
    }
    phases.push('indexed');
    check(); memory = await recallLearning(root, scope, publicKey, authorize); check();
    phases.push('recalled');
  }
  check(); const recommendation = recommendLearning(root, scope, publicKey, input.maxP95Ms);
  phases.push('recommended');
  check(); const evaluation = input.evaluation ? evaluateLearning(root, { scope, ...input.evaluation }, publicKey) : null;
  if (evaluation) phases.push('evaluated');
  return { cycleId, phases, recorded, duplicates, indexed, deferred, recommendation, evaluation,
    memory: memory ? { available: memory.available, recalled: memory.evidence.length, backend: memory.backend } : null,
    elapsedMs: performance.now() - started, advisory: true, defaultsChanged: false, promotionRequested: false };
}
