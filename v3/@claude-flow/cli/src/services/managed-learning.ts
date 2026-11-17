/** Verified, advisory workflow learning. Caller labels never establish trust. */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { accept } from './harness-benchmark.js';

export const TASK_TYPES = ['code-review', 'migration', 'research', 'test-generation', 'implementation', 'other'] as const;
export type Observation = {
  v: 1; attemptId: string; taskHash: string; sourceHash: string; artifactHash: string;
  policyHash: string; corpusHash: string; evaluatorHash: string;
  taskType: typeof TASK_TYPES[number]; split: 'train' | 'holdout'; trial: number;
  strategy: { id: string; model: string; workers: number; template: string };
  budgetCents: number; costCents: number | null; durationMs: number | null;
  checks: { acceptance: boolean; safety: boolean; replay: boolean; adversarial: boolean; drift: number; driftThreshold: number; rollbackRate: number };
};
export type Evidence = { observation: Observation; signature?: string };
export type Manifest = { taskHashes: string[]; trials: number[] };
const trusted = new WeakSet<object>();
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9-]{0,39}$/;
const MODEL = /^[a-z][a-z0-9./-]{0,79}$/;
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected an object');
  return v as Record<string, unknown>;
};
function exact(v: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k))) throw new Error('Unknown or missing learning fields');
}
const integer = (v: unknown, min: number, max: number): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const unit = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

export function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(v);
}
export const digest = (v: unknown): string => createHash('sha256').update(canonical(v)).digest('hex');

/** Closed metadata contract: no prompts, arbitrary commands, transcripts or caller trust labels. */
export function observationOf(value: unknown): Observation {
  const v = object(value);
  exact(v, ['v', 'attemptId', 'taskHash', 'sourceHash', 'artifactHash', 'policyHash', 'corpusHash', 'evaluatorHash', 'taskType', 'split', 'trial', 'strategy', 'budgetCents', 'costCents', 'durationMs', 'checks']);
  if (v.v !== 1 || !TASK_TYPES.includes(v.taskType as Observation['taskType']) || !['train', 'holdout'].includes(v.split as string) || !integer(v.trial, 0, 99)) throw new Error('Invalid learning cohort');
  for (const key of ['attemptId', 'taskHash', 'sourceHash', 'artifactHash', 'policyHash', 'corpusHash', 'evaluatorHash']) if (typeof v[key] !== 'string' || !HASH.test(v[key] as string)) throw new Error('Invalid evidence hash');
  const strategy = object(v.strategy);
  exact(strategy, ['id', 'model', 'workers', 'template']);
  if (!ID.test(String(strategy.id)) || !ID.test(String(strategy.template)) || !MODEL.test(String(strategy.model)) || !integer(strategy.workers, 1, 64)) throw new Error('Invalid workflow strategy');
  if (!integer(v.budgetCents, 1, 999_999_999) || (v.costCents !== null && !integer(v.costCents, 0, 999_999_999)) || (v.durationMs !== null && !integer(v.durationMs, 0, 86_400_000))) throw new Error('Invalid measured cost or duration');
  const checks = object(v.checks);
  exact(checks, ['acceptance', 'safety', 'replay', 'adversarial', 'drift', 'driftThreshold', 'rollbackRate']);
  if (['acceptance', 'safety', 'replay', 'adversarial'].some(k => typeof checks[k] !== 'boolean') || !unit(checks.drift) || !unit(checks.driftThreshold) || !unit(checks.rollbackRate)) throw new Error('Invalid verification measurements');
  // Detach caller objects, including nested strategy/checks, before hashing or persistence.
  return JSON.parse(JSON.stringify(v)) as Observation;
}

export function evidenceOf(value: unknown): Evidence {
  const v = object(value);
  if (Object.keys(v).some(k => !['observation', 'signature'].includes(k))) throw new Error('Unknown evidence fields');
  const observation = observationOf(v.observation);
  // Canonical form only: the last base64 character of a 64-byte signature has 4 unused bits that the decoder ignores, so
  // other spellings of the same bytes would verify yet digest differently and be stored as separate records.
  if (v.signature !== undefined && (typeof v.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(v.signature)
    || Buffer.from(v.signature, 'base64').toString('base64') !== v.signature)) throw new Error('Invalid verifier signature');
  return { observation, ...(v.signature ? { signature: v.signature as string } : {}) };
}

/** Public key is configured by the host, never accepted from an MCP argument or stored record. */
export function isVerified(evidence: Evidence, publicKey?: string): boolean {
  if (!publicKey || !evidence.signature) return false;
  try {
    const key = createPublicKey(publicKey);
    return key.asymmetricKeyType === 'ed25519' && verify(null, Buffer.from(canonical(evidence.observation)), key, Buffer.from(evidence.signature, 'base64'));
  } catch { return false; }
}

/** Revalidate every persisted record on each use; a JSON provenance label is not authority. */
export function trustedEvidence(records: unknown[], publicKey?: string): Evidence[] {
  const out: Evidence[] = [];
  const ids = new Map<string, string>();
  for (const raw of records) {
    const e = evidenceOf(raw);
    if (!isVerified(e, publicKey) || e.observation.costCents === null || e.observation.durationMs === null) continue;
    const hash = digest(e.observation);
    const previous = ids.get(e.observation.attemptId);
    if (previous && previous !== hash) throw new Error('Conflicting learning attempt');
    if (previous) continue;
    ids.set(e.observation.attemptId, hash);
    {
      Object.freeze(e.observation.strategy); Object.freeze(e.observation.checks); Object.freeze(e.observation); Object.freeze(e);
      trusted.add(e); out.push(e);
    }
  }
  return out;
}

export function manifestOf(value: unknown): Manifest {
  const m = object(value); exact(m, ['taskHashes', 'trials']);
  if (!Array.isArray(m.taskHashes) || m.taskHashes.length < 2 || m.taskHashes.length > 100 || m.taskHashes.some(h => typeof h !== 'string' || !HASH.test(h)) || new Set(m.taskHashes).size !== m.taskHashes.length) throw new Error('Manifest needs 2 to 100 unique task hashes');
  if (!Array.isArray(m.trials) || m.trials.length < 3 || m.trials.length > 10 || m.trials.some(t => !integer(t, 0, 99)) || new Set(m.trials).size !== m.trials.length) throw new Error('Manifest needs 3 to 10 unique trials');
  return { taskHashes: [...m.taskHashes].sort() as string[], trials: [...m.trials].sort((a, b) => a - b) as number[] };
}

export type Scope = { taskType: Observation['taskType']; policyHash: string; evaluatorHash: string };
export function scopeOf(value: unknown): Scope {
  const s = object(value); exact(s, ['taskType', 'policyHash', 'evaluatorHash']);
  if (!TASK_TYPES.includes(s.taskType as Observation['taskType']) || !HASH.test(String(s.policyHash)) || !HASH.test(String(s.evaluatorHash))) throw new Error('Invalid recommendation scope');
  return { taskType: s.taskType as Scope['taskType'], policyHash: s.policyHash as string, evaluatorHash: s.evaluatorHash as string };
}
const inScope = (o: Observation, s: Scope): boolean => o.taskType === s.taskType && o.policyHash === s.policyHash && o.evaluatorHash === s.evaluatorHash;
const success = (o: Observation): number => o.checks.acceptance && o.checks.safety ? 1 : 0;
const p95 = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * .95) - 1)] ?? 0;

/** Training evidence only; holdout records and unsigned observations cannot influence a pick. */
export function recommend(records: Evidence[], scope: Scope, maxP95Ms = 86_400_000) {
  if (records.some(e => !trusted.has(e))) throw new Error('Host-verified evidence required');
  if (!integer(maxP95Ms, 1, 86_400_000)) throw new Error('Invalid latency constraint');
  const groups = new Map<string, Evidence[]>();
  for (const e of records) {
    if (e.observation.split !== 'train' || !inScope(e.observation, scope)) continue;
    const key = canonical(e.observation.strategy);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const candidates = [...groups.values()].flatMap(rows => {
    if (rows.length < 3 || new Set(rows.map(r => r.observation.taskHash)).size < 3) return [];
    const totalCost = rows.reduce((n, r) => n + (r.observation.costCents ?? 0), 0);
    const latency = p95(rows.map(r => r.observation.durationMs!));
    if (totalCost <= 0 || latency > maxP95Ms || rows.some(r => !r.observation.checks.safety)) return [];
    const successes = rows.reduce((n, r) => n + success(r.observation), 0);
    if (successes === 0) return [];
    return [{ strategy: rows[0]!.observation.strategy, samples: rows.length, successes, successRate: successes / rows.length, successesPerDollar: successes * 100 / totalCost, p95Ms: latency, evidenceIds: rows.map(r => digest(r.observation)).sort() }];
  }).sort((a, b) => b.successesPerDollar - a.successesPerDollar || a.p95Ms - b.p95Ms || canonical(a.strategy).localeCompare(canonical(b.strategy)));
  return { advisory: true, selected: candidates[0] ?? null, candidates, abstained: candidates.length === 0, reason: candidates.length ? 'Ranked by measured training successes per dollar within exact policy/evaluator scope' : 'Insufficient trusted training evidence within scope and latency constraint', defaultsChanged: false };
}

/** Complete paired heldout data, equal admitted budgets, source identity and existing MetaHarness conjunction. */
export function evaluate(records: Evidence[], scope: Scope, manifest: Manifest, baselineId: string, candidateId: string) {
  if (records.some(e => !trusted.has(e))) throw new Error('Host-verified evidence required');
  if (!ID.test(baselineId) || !ID.test(candidateId) || baselineId === candidateId) throw new Error('Distinct strategy IDs required');
  const corpusHash = digest(manifest);
  const relevant = records.filter(e => inScope(e.observation, scope) && [baselineId, candidateId].includes(e.observation.strategy.id));
  const trainingTasks = new Set(records.filter(e => inScope(e.observation, scope) && e.observation.split === 'train').map(e => e.observation.taskHash));
  if (manifest.taskHashes.some(h => trainingTasks.has(h))) throw new Error('Training and heldout tasks overlap');
  const rows = relevant.filter(e => e.observation.split === 'holdout' && e.observation.corpusHash === corpusHash);
  for (const id of [baselineId, candidateId]) if (new Set(rows.filter(r => r.observation.strategy.id === id).map(r => canonical(r.observation.strategy))).size !== 1) throw new Error('Missing or inconsistent strategy configuration');
  const paired: Array<[Observation, Observation]> = [];
  for (const taskHash of manifest.taskHashes) for (const trial of manifest.trials) {
    const pick = (id: string) => rows.filter(e => e.observation.taskHash === taskHash && e.observation.trial === trial && e.observation.strategy.id === id);
    const base = pick(baselineId), candidate = pick(candidateId);
    if (base.length !== 1 || candidate.length !== 1) throw new Error('Missing or duplicate paired heldout result');
    const b = base[0]!.observation, c = candidate[0]!.observation;
    if (b.sourceHash !== c.sourceHash || b.budgetCents !== c.budgetCents) throw new Error('Source identity or admitted budgets differ');
    paired.push([b, c]);
  }
  const base = paired.map(p => p[0]), candidate = paired.map(p => p[1]);
  const efficiency = (rows: Observation[]) => {
    const cost = rows.reduce((n, r) => n + r.costCents!, 0);
    if (cost <= 0) throw new Error('Positive measured cost required');
    return rows.reduce((n, r) => n + success(r), 0) * 100 / cost;
  };
  const baselineEfficiency = efficiency(base), candidateEfficiency = efficiency(candidate);
  if (baselineEfficiency <= 0) throw new Error('Nonzero baseline success required for relative improvement');
  const delta = candidateEfficiency / baselineEfficiency - 1;
  const total = baselineEfficiency + candidateEfficiency;
  const all = [...base, ...candidate];
  const gate = accept({
    heldOutScore: candidateEfficiency / total, baselineHeldOutScore: baselineEfficiency / total,
    redblue: all.every(o => o.checks.adversarial) ? 'PASS' : 'FAIL',
    drift: Math.max(...candidate.map(o => o.checks.drift)), driftThreshold: Math.min(...candidate.map(o => o.checks.driftThreshold)),
    replayDeterministic: all.every(o => o.checks.replay), receiptCoverage: 1,
    canaryRollbackRate: Math.max(...candidate.map(o => o.checks.rollbackRate)), baselineRollbackRate: Math.max(...base.map(o => o.checks.rollbackRate)),
  });
  const noRegression = paired.every(([b, c]) => success(c) >= success(b)) && all.every(o => o.checks.safety);
  const baselineP95Ms = p95(base.map(o => o.durationMs!)), candidateP95Ms = p95(candidate.map(o => o.durationMs!));
  return { advisory: true, eligible: gate.accept && delta >= .10 - Number.EPSILON && noRegression && candidateP95Ms <= baselineP95Ms, baselineP95Ms, candidateP95Ms, delta, baselineEfficiency, candidateEfficiency, pairedResults: paired.length, corpusHash, noRegression, metaharness: gate, defaultsChanged: false, evidenceIds: rows.map(r => digest(r.observation)).sort() };
}
