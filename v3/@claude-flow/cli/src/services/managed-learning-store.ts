/** Project-local bounded evidence ledger. Local files are revalidated, never trusted by label. */
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeMemoryIndex, nativeMemoryRecall } from './managed-memory-client.js';
import { digest, evidenceOf, evaluate, isVerified, manifestOf, recommend, scopeOf, trustedEvidence, type Evidence } from './managed-learning.js';

export const LEARNING_PATH = '.claude-flow/managed-learning/state.json';
const MAX_BYTES = 2_000_000;
type State = { version: 1; records: Evidence[]; confirmations?: Record<string, string>; recommendationInput?: { scope: unknown; maxP95Ms?: number }; evaluationInput?: { scope: unknown; manifest: unknown; baselineId: string; candidateId: string }; lastRecommendation?: ReturnType<typeof recommend>; lastEvaluation?: ReturnType<typeof evaluate>; updatedMs: number };

function directory(root: string, create = false): string {
  let dir = resolve(root);
  if (!lstatSync(dir).isDirectory()) throw new Error('Learning root must be a directory');
  for (const part of ['.claude-flow', 'managed-learning']) {
    dir = join(dir, part);
    if (!existsSync(dir)) { if (create) mkdirSync(dir, { mode: 0o700 }); else return join(resolve(root), '.claude-flow', 'managed-learning'); }
    if (existsSync(dir) && (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink())) throw new Error('Learning directory must not be a symlink');
  }
  return dir;
}

function read(dir: string): State {
  const path = join(dir, 'state.json');
  if (!existsSync(path)) return { version: 1, records: [], updatedMs: 0 };
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Learning state must be a regular file');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let text: string;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Learning state exceeds read limit');
    // Fixed buffer also bounds a file that grows after fstat.
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const size = readSync(fd, buffer, 0, buffer.length, 0);
    if (size > MAX_BYTES) throw new Error('Learning state exceeds read limit');
    text = buffer.subarray(0, size).toString('utf8');
  } finally { closeSync(fd); }
  const value = JSON.parse(text!) as State;
  if (value.version !== 1 || !Array.isArray(value.records) || value.records.length > 500 || !Number.isFinite(value.updatedMs)) throw new Error('Invalid learning state');
  value.records = value.records.map(evidenceOf);
  // Summaries are display-only; never rehydrate them as routing or promotion authority.
  return value;
}

function syncDirectory(dir: string): void { const fd = openSync(dir, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }

function mutate<T>(root: string, action: (state: State) => T, publicKey?: string): T {
  const dir = directory(root, true);
  const lockPath = join(dir, 'writer.lock');
  const lock = openSync(lockPath, 'wx', 0o600);
  const temporary = join(dir, `${randomUUID()}.tmp`);
  try {
    syncDirectory(dir); // Refuse unsupported durability semantics before changing the ledger.
    const state = read(dir), result = action(state);
    state.updatedMs = Date.now();
    const payload = JSON.stringify(state);
    if (Buffer.byteLength(payload) > MAX_BYTES) throw new Error('Learning ledger is full');
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, payload); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, join(dir, 'state.json'));
    syncDirectory(dir);
    // The console reads only this bounded advisory projection, never the full evidence ledger.
    const summary = summaryOf(state, publicKey);
    const summaryText = JSON.stringify(summary);
    if (Buffer.byteLength(summaryText) > 64_000) throw new Error('Learning summary limit exceeded');
    const summaryFd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(summaryFd, summaryText); fsyncSync(summaryFd); } finally { closeSync(summaryFd); }
    renameSync(temporary, join(dir, 'summary.json'));
    syncDirectory(dir);
    return result;
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
    closeSync(lock); unlinkSync(lockPath);
  }
}

function summaryOf(state: State, publicKey?: string) {
  const verified = trustedEvidence(state.records, publicKey);
  let last: ReturnType<typeof recommend> | null = null;
  let evaluation: ReturnType<typeof evaluate> | null = null;
  try { if (state.recommendationInput) last = recommend(verified, scopeOf(state.recommendationInput.scope), state.recommendationInput.maxP95Ms); } catch { /* invalidated advice */ }
  try { if (state.evaluationInput) { const e = state.evaluationInput; evaluation = evaluate(verified, scopeOf(e.scope), manifestOf(e.manifest), e.baselineId, e.candidateId); } } catch { /* invalidated confirmation */ }
  const compact = (r: NonNullable<typeof last>['candidates'][number]) => ({ ...r, evidenceIds: r.evidenceIds.slice(0, 6) });
  return { version: 1, updatedMs: state.updatedMs, observations: state.records.length, verified: verified.length, quarantined: state.records.length - verified.length, training: verified.filter(e => e.observation.split === 'train').length, holdout: verified.filter(e => e.observation.split === 'holdout').length, verifierConfigured: !!publicKey,
    lastRecommendation: last ? { ...last, selected: last.selected ? compact(last.selected) : null, candidates: last.candidates.slice(0, 6).map(compact) } : null,
    lastEvaluation: evaluation ? { ...evaluation, evidenceIds: evaluation.evidenceIds.slice(0, 6) } : null,
    advisory: true, defaultsChanged: false };
}
export function learningStatus(root: string, publicKey?: string) { return summaryOf(read(directory(root)), publicKey); }

function applyRecord(state: State, evidence: Evidence, publicKey?: string) {
  const verified = isVerified(evidence, publicKey);
  const previous = state.records.find(e => e.observation.attemptId === evidence.observation.attemptId && isVerified(e, publicKey));
  if (previous && verified && digest(previous.observation) !== digest(evidence.observation)) throw new Error('Conflicting learning attempt; immutable verified observations cannot be overwritten');
  const duplicate = state.records.find(e => digest(e) === digest(evidence));
  if (duplicate) return { stored: false, duplicate: true, id: digest(evidence.observation), verified };
  const unsigned = state.records.find(e => !e.signature && digest(e.observation) === digest(evidence.observation));
  if (unsigned && verified) { unsigned.signature = evidence.signature; return { stored: true, duplicate: false, id: digest(evidence.observation), verified: true }; }
  if (!verified && state.records.filter(e => !isVerified(e, publicKey)).length >= 100) throw new Error('Learning quarantine is full');
  if (state.records.length >= 500) throw new Error('Learning ledger is full');
  state.records.push(evidence);
  return { stored: true, duplicate: false, id: digest(evidence.observation), verified };
}

/** Validate all input before acquiring the writer lock; publish the batch atomically. */
export function recordLearningBatch(root: string, inputs: unknown[], publicKey?: string) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 24) throw new Error('Learning batch must contain 1 to 24 records');
  const evidence = inputs.map(evidenceOf);
  if (evidence.some(e => e.signature && !isVerified(e, publicKey))) throw new Error('Untrusted or mismatched verifier receipt');
  return mutate(root, state => evidence.map(e => applyRecord(state, e, publicKey)), publicKey);
}

export function recordLearning(root: string, input: unknown, publicKey?: string) {
  return recordLearningBatch(root, [input], publicKey)[0]!;
}

export function recommendLearning(root: string, scope: unknown, publicKey?: string, maxP95Ms?: number) {
  return mutate(root, state => {
    const result = recommend(trustedEvidence(state.records, publicKey), scopeOf(scope), maxP95Ms);
    state.recommendationInput = { scope: scopeOf(scope), maxP95Ms };
    state.lastRecommendation = result;
    return result;
  }, publicKey);
}

export function evaluateLearning(root: string, input: { scope: unknown; manifest: unknown; baselineId: string; candidateId: string }, publicKey?: string) {
  return mutate(root, state => {
    const result = evaluate(trustedEvidence(state.records, publicKey), scopeOf(input.scope), manifestOf(input.manifest), input.baselineId, input.candidateId);
    const cohort = result.corpusHash, experiment = digest({ scope: scopeOf(input.scope), baselineId: input.baselineId, candidateId: input.candidateId });
    if (state.confirmations?.[cohort] && state.confirmations[cohort] !== experiment) throw new Error('Heldout corpus is already bound to another confirmation experiment');
    state.confirmations = { ...(state.confirmations ?? {}), [cohort]: experiment };
    state.evaluationInput = { ...input, scope: scopeOf(input.scope), manifest: manifestOf(input.manifest) };
    state.lastEvaluation = result;
    return result;
  }, publicKey);
}

/** Export only verified training evidence to native append-only AgentDB/RuVector storage. */
export async function indexLearning(root: string, id: string, publicKey?: string, authorize: () => boolean = () => true) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid evidence ID');
  const evidence = trustedEvidence(read(directory(root)).records, publicKey).find(e => digest(e.observation) === id && e.observation.split === 'train');
  if (!evidence) throw new Error('Verified training evidence required for indexing');
  if (!authorize()) throw new Error('Managed memory policy denied');
  const result = await nativeMemoryIndex(root, { id, value: JSON.stringify(evidence), taskType: evidence.observation.taskType }, authorize);
  if (!authorize()) throw new Error('Managed memory policy changed; admitted write may have completed');
  if (!result.durable) throw new Error('Native evidence index did not confirm durable persistence');
  return { indexed: result.hasEmbedding, durable: true, namespace: 'managed-workflow-evidence', id, hasEmbedding: result.hasEmbedding, advisory: true };
}

/** Memory similarity supplies recall evidence, never authority or a cherry-picked quality denominator. */
export async function recallLearning(root: string, input: unknown, publicKey?: string, authorize: () => boolean = () => true) {
  const scope = scopeOf(input);
  const local = trustedEvidence(read(directory(root)).records, publicKey).filter(e => e.observation.split === 'train' && e.observation.taskType === scope.taskType && e.observation.policyHash === scope.policyHash && e.observation.evaluatorHash === scope.evaluatorHash);
  const allowed = new Set(local.map(e => digest(e.observation)));
  let result: Awaited<ReturnType<typeof nativeMemoryRecall>>;
  if (!authorize()) throw new Error('Managed memory policy denied');
  try {
    result = await nativeMemoryRecall(root, { taskType: scope.taskType, allowedIds: [...allowed] }, authorize);
  }
  catch {
    if (!authorize()) throw new Error('Managed memory policy denied');
    return { available: false, backend: 'ruflo-memory-child', evidence: [], recommendation: recommend(local, scope), advisory: true, similarityIsVerification: false };
  }
  if (!authorize()) throw new Error('Managed memory policy denied');
  if (!result.available) return { available: false, backend: 'ruflo-memory-child', evidence: [], recommendation: recommend(local, scope), advisory: true, similarityIsVerification: false };
  const seen = new Set<string>();
  const evidence: Array<{ id: string; similarity: number; strategy: Evidence['observation']['strategy']; sourceHash: string }> = [];
  for (const hit of result.rows.slice(0, 20)) {
    if (hit.namespace !== 'managed-workflow-evidence' || !allowed.has(hit.key) || seen.has(hit.key) || !Number.isFinite(hit.score)) continue;
    seen.add(hit.key);
    try {
      // The child hydrates exact native rows, not display previews. The MCP
      // parent still authenticates every receipt and joins the local cohort.
      if (typeof hit.content !== 'string' || Buffer.byteLength(hit.content) > 8192) continue;
      const receipt = evidenceOf(JSON.parse(hit.content));
      if (!isVerified(receipt, publicKey) || digest(receipt.observation) !== hit.key) continue;
      evidence.push({ id: hit.key, similarity: hit.score, strategy: receipt.observation.strategy, sourceHash: receipt.observation.sourceHash });
    } catch { /* A missing or malformed row is not verified recall evidence. */ }
  }
  return { available: true, backend: 'ruflo-memory-child', evidence, recommendation: recommend(local, scope), advisory: true, similarityIsVerification: false };
}
