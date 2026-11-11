/**
 * ADR-529 — governed self-improvement for the centroid router.
 *
 * Synthetic 2-d artifacts make every outcome exact: a holdout row of label `a`
 * at [0.6, 0.8] is misrouted to `b` by the base and fixed by a candidate that
 * adds ten [0, 1] rows to `a`. Groups starting `0000` are holdout, `0001` train.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  encodeVec, decodeVec, mergeLedger, harvestTranscripts, buildCandidate, isHoldout,
  LEDGER_CAP_PER_LABEL, type Ledger, type LedgerRow, type GuardSet,
} from '../src/ruvector/router-learning.js';
import {
  proposeCandidate, localPromotionRule, loadPromotionRule, writeReceipt, promoteCandidate,
  countReceipts, type CandidateReceipt, type Evidence,
} from '../src/ruvector/router-learning-gate.js';
import { minInformativePairsToClear } from '../src/services/flywheel-sequential-evidence.js';
import type { CentroidArtifact } from '../src/ruvector/centroid-router.js';

const base: CentroidArtifact = {
  schema: 'ruflo.agent-centroids/1', embedder: 'minilm', model: 'm', dim: 2, margin: 0,
  split: 'dev', labels: ['a', 'b'], support: [1, 1], centroids: [[1, 0], [0, 1]],
} as CentroidArtifact;
const HOLD = '0000000000000000', TRAIN = '0001000000000000';
let n = 0;
const row = (label: string, v: number[], g: string): LedgerRow => ({ h: (n++).toString(16).padStart(16, '0'), g, label, src: 'transcript', q: encodeVec(v), t: n });
const guard: GuardSet = { schema: 'ruflo.agent-router-guard/1', model: 'm', dim: 2, corpusSha256: 'x', rows: [
  { label: 'a', trap: false, q: encodeVec([1, 0]) }, { label: 'b', trap: false, q: encodeVec([0, 1]) },
] };
const passed = async () => ({ status: 'passed' as const, detail: 'stub' });
const local = { rule: localPromotionRule, name: 'local-fallback' as const, fingerprint: 'x' };

function ledgerWith(discordant: number, concordant: number): Ledger {
  const rows = [
    ...Array.from({ length: 10 }, () => row('a', [0, 1], TRAIN)),
    ...Array.from({ length: discordant }, () => row('a', [0.6, 0.8], HOLD)),
    ...Array.from({ length: concordant }, () => row('a', [1, 0], HOLD)),
  ];
  return { schema: 'ruflo.router-ledger/1', model: 'm', dim: 2, rows };
}

describe('ADR-529 ledger primitives', () => {
  it('round-trips int8 unit vectors', () => {
    const v = decodeVec(encodeVec([3, 4]), 2);
    expect(v[0]).toBeCloseTo(0.6, 2);
    expect(v[1]).toBeCloseTo(0.8, 2);
    expect(() => decodeVec(encodeVec([1, 0, 0]), 2)).toThrow(/3-d/);
  });

  it('dedupes by text hash and caps rows per label', () => {
    const empty: Ledger = { schema: 'ruflo.router-ledger/1', model: 'm', dim: 2, rows: [] };
    const r = row('a', [1, 0], TRAIN);
    expect(mergeLedger(empty, [r, { ...r }]).added).toBe(1);
    const many = Array.from({ length: LEDGER_CAP_PER_LABEL + 5 }, () => row('a', [1, 0], TRAIN));
    expect(mergeLedger(empty, many).ledger.rows).toHaveLength(LEDGER_CAP_PER_LABEL);
  });

  it('buckets holdout by session, not text', () => {
    expect(isHoldout(HOLD)).toBe(true);
    expect(isHoldout(TRAIN)).toBe(false);
  });
});

describe('ADR-529 transcript harvest', () => {
  it('reads Agent/Task delegations recursively, maps labels, skips unlabelled and symlinks', () => {
    const d = mkdtempSync(join(tmpdir(), 'adr529-'));
    const call = (type: string | undefined, description: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: type, description, prompt: 'SECRET PROMPT BODY' } }] } });
    writeFileSync(join(d, 's1.jsonl'), [call('coder', 'Fix the parser'), call('general-purpose', 'Look around'), call(undefined, 'No type'), '{not json'].join('\n'));
    mkdirSync(join(d, 's1', 'subagents'), { recursive: true });
    writeFileSync(join(d, 's1', 'subagents', 'x.jsonl'), call('security-auditor', 'Audit auth'));
    const outside = mkdtempSync(join(tmpdir(), 'adr529-out-'));
    writeFileSync(join(outside, 'o.jsonl'), call('tester', 'Should not be read'));
    symlinkSync(join(outside, 'o.jsonl'), join(d, 'link.jsonl'));
    const h = harvestTranscripts(d);
    expect(h.items.map((i) => [i.label, i.text]).sort()).toEqual([['coder', 'Fix the parser'], ['security-architect', 'Audit auth']]);
    expect(h.skipped).toBe(2);
    expect(JSON.stringify(h.items)).not.toContain('SECRET');
    expect(new Set(h.items.map((i) => i.group)).size).toBe(2);
  });

  it('returns nothing for a missing directory', () => {
    expect(harvestTranscripts('/nonexistent/adr529').items).toEqual([]);
  });
});

describe('ADR-529 candidate build', () => {
  it('never learns from holdout rows and is deterministic', () => {
    const l = ledgerWith(9, 1);
    const a = buildCandidate(base, l), b = buildCandidate(base, l);
    expect(a.used).toEqual({ a: 10 });
    expect(a.artifact.centroids).toEqual(b.artifact.centroids);
    const holdOnly: Ledger = { ...l, rows: l.rows.filter((r) => r.g === HOLD) };
    expect(buildCandidate(base, holdOnly).artifact.centroids).toEqual(base.centroids);
  });

  it('rejects out-of-range recipes', () => {
    expect(() => buildCandidate(base, ledgerWith(0, 0), { weight: 0, capPerLabel: 10 })).toThrow(RangeError);
    expect(() => buildCandidate(base, ledgerWith(0, 0), { weight: 1, capPerLabel: 0 })).toThrow(RangeError);
  });
});

describe('ADR-529 gate', () => {
  it('needs 9 clean wins at proposal #1 (e-process boundary)', async () => {
    expect(minInformativePairsToClear(1)).toBe(9);
    const win = await proposeCandidate({ base, ledger: ledgerWith(9, 1), guard, invariants: passed, rule: local, testIndex: 1 });
    const lose = await proposeCandidate({ base, ledger: ledgerWith(8, 2), guard, invariants: passed, rule: local, testIndex: 1 });
    if ('refused' in win || 'refused' in lose) throw new Error('unexpected refusal');
    expect(win.decision).toEqual({ promote: true, reasons: [] });
    expect(lose.decision.promote).toBe(false);
    expect(lose.decision.reasons.join()).toMatch(/insufficient_paired_evidence\(8-0/);
  });

  it('a later proposal needs more evidence (alpha spending)', async () => {
    const r = await proposeCandidate({ base, ledger: ledgerWith(12, 1), guard, invariants: passed, rule: local, testIndex: 2 });
    expect(minInformativePairsToClear(2)).toBe(13);
    if ('refused' in r) throw new Error('unexpected refusal');
    expect(r.decision.promote).toBe(false);
  });

  it('refuses before spending alpha when the holdout is too small', async () => {
    const r = await proposeCandidate({ base, ledger: ledgerWith(5, 0), guard, invariants: passed, rule: local, testIndex: 1 });
    expect(r).toHaveProperty('refused');
  });

  it('blocks on a failed invariant check and on a guard regression', async () => {
    const failed = await proposeCandidate({ base, ledger: ledgerWith(9, 1), guard, invariants: async () => ({ status: 'failed', detail: 'x' }), rule: local, testIndex: 1 });
    if ('refused' in failed) throw new Error('unexpected refusal');
    expect(failed.decision.reasons).toContain('safety_regression');
    const tight: GuardSet = { ...guard, rows: [...guard.rows, { label: 'b', trap: false, q: encodeVec([0.3, 1]) }] };
    const regressed = await proposeCandidate({ base, ledger: ledgerWith(9, 1), guard: tight, invariants: passed, rule: local, testIndex: 1 });
    if ('refused' in regressed) throw new Error('unexpected refusal');
    expect(regressed.decision.reasons).toContain('anchor_regressed');
  });

  it('the real flywheel rule (when installed) enforces the anchor in the shape we pass', async () => {
    const r = await loadPromotionRule();
    const s = (p: number) => ({ primary: p, noopRate: 0, costPerWin: 2 / p, regressed: false });
    const e: Evidence = { baseline: s(0.5), candidate: s(0.6), anchor: { baseline: 0.7, candidate: 0.6 } };
    expect(r.rule(e).promote).toBe(false);
    expect(localPromotionRule(e).reasons).toContain('anchor_regressed');
  });

  it('falls back to the local rule when flywheel is missing', async () => {
    const r = await loadPromotionRule(async () => { throw Object.assign(new Error('nope'), { code: 'MODULE_NOT_FOUND' }); });
    expect(r.name).toBe('local-fallback');
  });
});

describe('ADR-529 receipts and promotion', () => {
  async function accepted(root: string): Promise<CandidateReceipt> {
    const r = await proposeCandidate({ base, ledger: ledgerWith(9, 1), guard, invariants: passed, rule: local, testIndex: countReceipts(root) + 1 });
    if ('refused' in r) throw new Error('unexpected refusal');
    writeReceipt(root, r);
    return r;
  }

  it('requires --confirm, then writes the promoted file and keeps the previous one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adr529-root-'));
    const r = await accepted(root);
    expect(() => promoteCandidate(root, r.id, { confirm: false })).toThrow(/--confirm/);
    const out = promoteCandidate(root, r.id, { confirm: true });
    expect(JSON.parse(readFileSync(out.path, 'utf8')).promotedFrom).toBe(r.id);
    expect(out.previous).toBeNull();
    expect(promoteCandidate(root, r.id, { confirm: true }).previous).not.toBeNull();
  });

  it('refuses rejected, edited or malformed candidates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adr529-root-'));
    const r = await accepted(root);
    const p = join(root, '.claude-flow', 'router', 'candidates', `${r.id}.json`);
    const edited = JSON.parse(readFileSync(p, 'utf8'));
    edited.artifact.centroids[0][0] = 0.5;
    writeFileSync(p, JSON.stringify(edited));
    expect(() => promoteCandidate(root, r.id, { confirm: true })).toThrow(/receipt hash/);
    writeFileSync(p, JSON.stringify({ ...r, decision: { promote: false, reasons: ['x'] } }));
    expect(() => promoteCandidate(root, r.id, { confirm: true })).toThrow(/rejected/);
    expect(() => promoteCandidate(root, '../../etc/passwd', { confirm: true })).toThrow(/not a candidate id/);
    expect(existsSync(join(root, '.claude-flow', 'router', 'centroids.json'))).toBe(false);
  });
});
