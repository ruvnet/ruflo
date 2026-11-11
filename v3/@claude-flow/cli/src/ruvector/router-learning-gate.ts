/**
 * router-learning-gate.ts — evidence, gate, receipt and explicit promotion for
 * locally learned router candidates (ADR-529).
 *
 * Evidence is mapped onto the frozen @metaharness/flywheel promotion rule:
 *   primary    = accuracy on this project's holdout rows (its own traffic)
 *   anchor     = accuracy on the shipped guard set (ADR-391 test split); the
 *                rule's anti-Goodhart clause forbids any regression there
 *   noopRate   = 0 for both: the argmax router never abstains, so the rule's
 *                floor clause then requires a strict primary gain
 *   costPerWin = dot products per query / primary (measured compute per hit)
 *   regressed  = the candidate failed the ruv-FANN self-routing invariants
 * When the optional flywheel package is absent the same conjunctive clauses
 * run locally and the receipt says so.
 *
 * The flywheel rule alone promotes any strict gain, however small. A second,
 * conjunctive clause requires paired evidence on the holdout: the in-tree
 * anytime-valid e-process (flywheel-sequential-evidence.ts) with the k-th
 * proposal in this project spending alpha_k = 0.05·6/(π²k²). Re-running
 * `propose` after every harvest therefore cannot shop for a lucky split. At
 * k = 1 a candidate needs 9 net holdout wins with no losses.
 *
 * Receipts are integrity-checked (artifact hash) but NOT signed: they detect
 * accidental edits, not tampering by someone with write access to the project.
 *
 * Proposing never changes routing. Promotion copies an accepted candidate to
 * .claude-flow/router/centroids.json only with explicit confirmation; the
 * router reads it only when CLAUDE_FLOW_ROUTER_CENTROID_PATH points at it.
 *
 * @module router-learning-gate
 */

import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateArtifact, type CentroidArtifact } from './centroid-router.js';
import { sequentialEvidenceVerdict, minInformativePairsToClear, type SequentialEvidenceVerdict } from '../services/flywheel-sequential-evidence.js';
import {
  DEFAULT_RECIPE, accuracy, buildCandidate, decodeVec, isHoldout,
  type GuardSet, type Ledger,
} from './router-learning.js';

export const RECEIPT_SCHEMA = 'ruflo.router-candidate-receipt/1';
/** Fewer holdout rows than this and no candidate is evaluated. */
export const MIN_HOLDOUT_ROWS = 10;

export interface Score { primary: number; noopRate: number; costPerWin: number; regressed: boolean }
export interface Evidence { baseline: Score; candidate: Score; anchor: { baseline: number; candidate: number } }
export interface Decision { promote: boolean; reasons: string[] }
export type PromotionRule = (e: Evidence) => Decision;

export interface CandidateReceipt {
  schema: typeof RECEIPT_SCHEMA;
  id: string;
  createdAt: string;
  recipe: { weight: number; capPerLabel: number };
  hashes: { base: string; candidate: string; ledger: string; guardCorpus: string };
  used: Record<string, number>;
  holdout: { rows: number; baselineCorrect: number; candidateCorrect: number };
  guard: { rows: number; baselineCorrect: number; candidateCorrect: number };
  invariants: { status: 'passed' | 'failed' | 'skipped'; detail: string };
  evidence: Evidence;
  sequential: SequentialEvidenceVerdict & { candidateWins: number; baselineWins: number };
  gate: { rule: 'flywheel' | 'local-fallback'; fingerprint: string | null };
  decision: Decision;
  artifact: CentroidArtifact;
}

const sha = (x: unknown): string => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');

/** Same clauses as flywheel's meetsPromotionRule, for installs without the optional package. */
export const localPromotionRule: PromotionRule = (e) => {
  const reasons: string[] = [];
  const ok = (s: Score) => [s.primary, s.noopRate, s.costPerWin].every(Number.isFinite) && s.noopRate >= 0 && s.noopRate <= 1 && s.costPerWin >= 0;
  if (!ok(e.baseline) || !ok(e.candidate) || ![e.anchor.baseline, e.anchor.candidate].every(Number.isFinite)) return { promote: false, reasons: ['invalid_score_evidence'] };
  if (e.candidate.primary < e.baseline.primary) reasons.push('primary_regressed');
  const atFloor = e.baseline.noopRate <= 0 && e.candidate.noopRate <= 0;
  if (!atFloor && !(e.candidate.noopRate < e.baseline.noopRate)) reasons.push('noop_rate_not_improved');
  if (atFloor && !(e.candidate.primary > e.baseline.primary || e.candidate.costPerWin < e.baseline.costPerWin)) reasons.push('no_improvement_at_noop_floor');
  if (e.candidate.costPerWin > e.baseline.costPerWin) reasons.push('cost_per_win_worsened');
  if (e.candidate.regressed) reasons.push('safety_regression');
  if (e.anchor.candidate < e.anchor.baseline) reasons.push('anchor_regressed');
  return { promote: reasons.length === 0, reasons };
};

export type FlywheelImporter = () => Promise<Record<string, any>>;
const defaultFlywheel: FlywheelImporter = () => import('@metaharness/flywheel' as string);

/** The frozen flywheel rule when installed; otherwise the local copy. Never throws. */
export async function loadPromotionRule(importer: FlywheelImporter = defaultFlywheel): Promise<{ rule: PromotionRule; name: 'flywheel' | 'local-fallback'; fingerprint: string | null }> {
  try {
    const m = await importer();
    if (typeof m.meetsPromotionRule === 'function') {
      const fp = typeof m.gateFingerprint === 'function' ? String(m.gateFingerprint(m.meetsPromotionRule)) : null;
      return { rule: m.meetsPromotionRule as PromotionRule, name: 'flywheel', fingerprint: fp };
    }
  } catch { /* optional dependency missing or broken: fall back */ }
  return { rule: localPromotionRule, name: 'local-fallback', fingerprint: sha(localPromotionRule.toString()).slice(0, 16) };
}

export type InvariantCheck = (a: CentroidArtifact) => Promise<{ status: 'passed' | 'failed' | 'skipped'; detail: string }>;

export interface ProposeInput {
  base: CentroidArtifact;
  ledger: Ledger;
  guard: GuardSet;
  invariants: InvariantCheck;
  rule: Awaited<ReturnType<typeof loadPromotionRule>>;
  recipe?: { weight: number; capPerLabel: number };
  /** 1-based index of this proposal in the project's stream (spent whether or not it promotes). */
  testIndex: number;
  now?: Date;
}

/** Build, evaluate and gate one candidate. Pure apart from the injected checks. */
export async function proposeCandidate(input: ProposeInput): Promise<CandidateReceipt | { refused: string }> {
  const { base, ledger, guard } = input;
  if (guard.model !== base.model || guard.dim !== base.dim) return { refused: `guard set was built with ${guard.model}/${guard.dim}; the router uses ${base.model}/${base.dim}` };
  const holdout = ledger.rows.filter((r) => isHoldout(r.g) && base.labels.includes(r.label)).map((r) => ({ label: r.label, v: decodeVec(r.q, base.dim) }));
  const need = Math.max(MIN_HOLDOUT_ROWS, minInformativePairsToClear(input.testIndex));
  // Refuse before spending alpha: below this even a clean sweep cannot clear the e-process.
  if (holdout.length < need) return { refused: `only ${holdout.length} local holdout rows (1 in 5 sessions); proposal #${input.testIndex} needs at least ${need}. Harvest more sessions first.` };
  const recipe = input.recipe ?? { ...DEFAULT_RECIPE };
  const { artifact, used } = buildCandidate(base, ledger, recipe);
  validateArtifact(artifact);
  const guardRows = guard.rows.map((r) => ({ label: r.label, v: decodeVec(r.q, guard.dim) }));
  const hb = accuracy(base, holdout), hc = accuracy(artifact, holdout);
  const gb = accuracy(base, guardRows), gc = accuracy(artifact, guardRows);
  const inv = await input.invariants(artifact);
  const score = (a: CentroidArtifact, acc: number, regressed: boolean): Score => ({
    primary: acc, noopRate: 0, costPerWin: a.labels.length / Math.max(acc, 1e-9), regressed,
  });
  const evidence: Evidence = {
    baseline: score(base, hb.correct / hb.total, false),
    candidate: score(artifact, hc.correct / hc.total, inv.status === 'failed'),
    anchor: { baseline: gb.correct / gb.total, candidate: gc.correct / gc.total },
  };
  const paired = hb.hits.map((b, i) => ({ taskId: String(i), baselineScore: b ? 1 : 0, candidateScore: hc.hits[i] ? 1 : 0 }));
  const seq = sequentialEvidenceVerdict(paired, input.testIndex);
  const candidateWins = paired.filter((o) => o.candidateScore > o.baselineScore).length;
  const baselineWins = paired.filter((o) => o.candidateScore < o.baselineScore).length;
  const ruled = input.rule.rule({ ...evidence, pairedOutcomes: paired.map((o) => ({ candidateWon: o.candidateScore > o.baselineScore, baselineWon: o.candidateScore < o.baselineScore })) } as Evidence);
  const reasons = Array.isArray(ruled.reasons) ? ruled.reasons.map(String) : [];
  if (!seq.significant) reasons.push(`insufficient_paired_evidence(${candidateWins}-${baselineWins}, e=${seq.eValue.toFixed(2)} < ${seq.threshold.toFixed(1)}; needs >= ${minInformativePairsToClear(input.testIndex)} net wins)`);
  const decision = { promote: ruled.promote === true && seq.significant, reasons };
  return {
    schema: RECEIPT_SCHEMA,
    id: `rc-${(input.now ?? new Date()).toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`,
    createdAt: (input.now ?? new Date()).toISOString(),
    recipe,
    hashes: { base: sha(base), candidate: sha(artifact), ledger: sha(ledger.rows), guardCorpus: guard.corpusSha256 },
    used,
    holdout: { rows: hb.total, baselineCorrect: hb.correct, candidateCorrect: hc.correct },
    guard: { rows: gb.total, baselineCorrect: gb.correct, candidateCorrect: gc.correct },
    invariants: inv,
    evidence,
    sequential: { ...seq, candidateWins, baselineWins },
    gate: { rule: input.rule.name, fingerprint: input.rule.fingerprint },
    decision,
    artifact,
  };
}

const candidatesDir = (root: string) => join(root, '.claude-flow', 'router', 'candidates');
export const promotedPath = (root: string) => join(root, '.claude-flow', 'router', 'centroids.json');

export function writeReceipt(root: string, r: CandidateReceipt): string {
  const dir = candidatesDir(root);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${r.id}.json`);
  writeFileSync(p, JSON.stringify(r) + '\n', { mode: 0o600, flag: 'wx' });
  return p;
}

export function readReceipt(root: string, id: string): CandidateReceipt {
  if (!/^rc-\d{14}-[0-9a-f]{8}$/.test(id)) throw new Error(`'${id}' is not a candidate id`);
  const p = join(candidatesDir(root), `${id}.json`);
  if (!existsSync(p)) throw new Error(`no candidate ${id}`);
  const r = JSON.parse(readFileSync(p, 'utf8')) as CandidateReceipt;
  if (r?.schema !== RECEIPT_SCHEMA || r.id !== id) throw new Error(`${p} is not a ${RECEIPT_SCHEMA} receipt`);
  return r;
}

/**
 * Copy an accepted candidate to .claude-flow/router/centroids.json. Refuses
 * without `confirm`, when the gate rejected it, or when the stored artifact no
 * longer matches its receipt hash. The previous file is kept as centroids.prev.json.
 */
export function promoteCandidate(root: string, id: string, opts: { confirm: boolean }): { path: string; previous: string | null } {
  const r = readReceipt(root, id);
  if (!r.decision.promote) throw new Error(`candidate ${id} was rejected by the gate (${r.decision.reasons.join(', ') || 'no reason recorded'})`);
  if (sha(r.artifact) !== r.hashes.candidate) throw new Error(`candidate ${id} does not match its receipt hash`);
  validateArtifact(r.artifact);
  if (!opts.confirm) throw new Error('promotion changes which router file is available; pass --confirm');
  const p = promotedPath(root);
  mkdirSync(join(root, '.claude-flow', 'router'), { recursive: true });
  let previous: string | null = null;
  if (existsSync(p)) { previous = p.replace(/\.json$/, '.prev.json'); copyFileSync(p, previous); }
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...r.artifact, promotedFrom: id }) + '\n', { mode: 0o644 });
  renameSync(tmp, p);
  return { path: p, previous };
}

/** Receipts already written in this project: the alpha-spending index of the next proposal is this + 1. */
export function countReceipts(root: string): number {
  const dir = candidatesDir(root);
  return existsSync(dir) ? readdirSync(dir).filter((n) => /^rc-\d{14}-[0-9a-f]{8}\.json$/.test(n)).length : 0;
}
