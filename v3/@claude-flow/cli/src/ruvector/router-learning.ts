/**
 * router-learning.ts — local, governed self-improvement for the ADR-527
 * centroid router (ADR-529).
 *
 * Learning signal: the agent a Claude Code lead actually delegated to (Agent /
 * Task tool calls in this project's transcripts) and explicit corrections
 * ("this task belonged to <agent>"). Each signal becomes one labelled MiniLM
 * vector in a local ledger. Prompt text is not stored: a row is a label, a
 * text hash, a session hash, a source and an int8-quantised unit vector. That
 * is not anonymous (an embedding can be matched against guessed text), so the
 * ledger stays local, mode 0600, under the gitignored .claude-flow/.
 *
 * A candidate router is the shipped centroids plus a capped, down-weighted sum
 * of ledger vectors per label (weight 1.0 on unit vectors against
 * centroid × support, at most 10 rows per label: chosen on ADR-391 dev
 * cross-validation in exactly this form, ADR-529). Rows whose SESSION hash
 * falls in the holdout bucket never feed a candidate; they are what the
 * candidate is scored on. Bucketing by session, not text, keeps near-duplicate
 * descriptions from one session on one side.
 *
 * Nothing here changes routing. Gating, receipts and promotion live in
 * router-learning-gate.ts.
 *
 * @module router-learning
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CentroidArtifact } from './centroid-router.js';

export const LEDGER_SCHEMA = 'ruflo.router-ledger/1';
export const GUARD_SCHEMA = 'ruflo.agent-router-guard/1';
/** Rows kept per label in the ledger (newest win). */
export const LEDGER_CAP_PER_LABEL = 200;
/** Candidate recipe, fixed by ADR-529 (dev CV; never tuned on the guard or holdout). */
export const DEFAULT_RECIPE = { weight: 1, capPerLabel: 10 } as const;
/** Max transcript bytes read per file and files scanned per harvest. */
export const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
export const MAX_TRANSCRIPT_FILES = 2000;

/**
 * Claude Code / ruflo agent types → router labels. Types not listed
 * (general-purpose, fork, Plan-less helpers) carry no routing label and are skipped.
 */
export const AGENT_LABEL_MAP: Readonly<Record<string, string>> = Object.freeze({
  coder: 'coder', 'backend-dev': 'coder', 'sparc-coder': 'coder', 'ruflo-core:coder': 'coder',
  tester: 'tester', 'production-validator': 'tester', 'tdd-london-swarm': 'tester', 'ruflo-testgen:tester': 'tester',
  reviewer: 'reviewer', 'ruflo-core:reviewer': 'reviewer', 'code-analyzer': 'reviewer', analyst: 'reviewer',
  researcher: 'researcher', Explore: 'researcher', 'ruflo-core:researcher': 'researcher', 'ruflo-goals:deep-researcher': 'researcher',
  architect: 'architect', 'system-architect': 'architect', Plan: 'architect', 'ruflo-swarm:architect': 'architect',
  'security-architect': 'security-architect', 'security-auditor': 'security-architect', 'ruflo-security-audit:security-auditor': 'security-architect',
  'performance-engineer': 'performance-engineer', 'perf-analyzer': 'performance-engineer',
  devops: 'devops', 'cicd-engineer': 'devops', 'release-manager': 'devops', 'release-swarm': 'devops',
  'swarm-specialist': 'swarm-specialist', 'hierarchical-coordinator': 'swarm-specialist', 'mesh-coordinator': 'swarm-specialist',
  'memory-specialist': 'memory-specialist', 'ruflo-agentdb:agentdb-specialist': 'memory-specialist',
});

export interface LedgerRow {
  /** First 16 hex chars of sha256(text). Identity and holdout bucket. */
  h: string;
  /** First 16 hex chars of sha256(session id). Holdout bucket. */
  g: string;
  label: string;
  src: 'transcript' | 'feedback';
  /** base64 int8 of the unit vector × 127. */
  q: string;
  t: number;
}
export interface Ledger {
  schema: typeof LEDGER_SCHEMA;
  model: string;
  dim: number;
  rows: LedgerRow[];
}
export interface GuardSet {
  schema: typeof GUARD_SCHEMA;
  model: string;
  dim: number;
  corpusSha256: string;
  rows: Array<{ label: string; trap: boolean; q: string }>;
}
export interface LabelledText { label: string; text: string; src: LedgerRow['src']; group: string }

export const textHash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);
/** 1 in 5 sessions, by session hash: scored, never learned from. */
export const isHoldout = (g: string): boolean => parseInt(g.slice(0, 4), 16) % 5 === 0;

export function encodeVec(v: ArrayLike<number>): string {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round((v[i] / n) * 127)));
  return Buffer.from(q.buffer).toString('base64');
}
export function decodeVec(q: string, dim: number): Float64Array {
  const b = Buffer.from(q, 'base64');
  if (b.length !== dim) throw new Error(`vector is ${b.length}-d, expected ${dim}`);
  const out = new Float64Array(dim);
  for (let i = 0; i < dim; i++) out[i] = ((b[i] << 24) >> 24) / 127;
  return out;
}

export function ledgerPath(root: string): string {
  return join(root, '.claude-flow', 'router', 'ledger.json');
}

export function loadLedger(root: string, model: string, dim: number): Ledger {
  const p = ledgerPath(root);
  if (!existsSync(p)) return { schema: LEDGER_SCHEMA, model, dim, rows: [] };
  const x = JSON.parse(readFileSync(p, 'utf8')) as Ledger;
  if (x?.schema !== LEDGER_SCHEMA || !Array.isArray(x.rows)) throw new Error(`${p} is not a ${LEDGER_SCHEMA} ledger`);
  if (x.model !== model || x.dim !== dim) throw new Error(`${p} was built with ${x.model}/${x.dim}; the router uses ${model}/${dim}`);
  return x;
}

export function saveLedger(root: string, ledger: Ledger): void {
  const p = ledgerPath(root);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(ledger) + '\n', { mode: 0o600 });
  renameSync(tmp, p);
}

/** Add rows, dropping duplicates by hash and keeping the newest LEDGER_CAP_PER_LABEL per label. */
export function mergeLedger(ledger: Ledger, add: LedgerRow[]): { ledger: Ledger; added: number } {
  const seen = new Set(ledger.rows.map((r) => r.h));
  const fresh = add.filter((r) => !seen.has(r.h) && (seen.add(r.h), true));
  const all = [...ledger.rows, ...fresh].sort((a, b) => a.t - b.t);
  const byLabel = new Map<string, LedgerRow[]>();
  for (const r of all) (byLabel.get(r.label) ?? byLabel.set(r.label, []).get(r.label)!).push(r);
  const rows = [...byLabel.values()].flatMap((rs) => rs.slice(-LEDGER_CAP_PER_LABEL));
  return { ledger: { ...ledger, rows }, added: fresh.filter((r) => rows.includes(r)).length };
}

/** ~/.claude/projects/<cwd with every non-alphanumeric as '-'> */
export function projectTranscriptDir(cwd: string, home = homedir()): string {
  return join(home, '.claude', 'projects', resolvePath(cwd).replace(/[^A-Za-z0-9]/g, '-'));
}

/**
 * Labelled task descriptions from Agent/Task tool calls in a transcript dir.
 * Reads regular `.jsonl` files up to three directories deep (subagent transcripts included; symlinks never followed), each capped in size. The
 * short `description` is used, not the full prompt: on dev CV it routed
 * better and carries less private detail.
 */
export function harvestTranscripts(dir: string, maxFiles = MAX_TRANSCRIPT_FILES): { items: LabelledText[]; files: number; calls: number; skipped: number } {
  const items: LabelledText[] = [];
  let files = 0, calls = 0, skipped = 0;
  if (!existsSync(dir)) return { items, files, calls, skipped };
  const paths: string[] = [];
  const walk = (d: string, depth: number) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n), st = lstatSync(p);
      if (st.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (st.isFile() && n.endsWith('.jsonl')) paths.push(p);
    }
  };
  walk(dir, 0);
  for (const p of paths.slice(0, maxFiles)) {
    const st = lstatSync(p);
    if (!st.isFile() || st.size > MAX_TRANSCRIPT_BYTES) continue;
    files++;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line.includes('"tool_use"') || !(line.includes('"Agent"') || line.includes('"Task"'))) continue;
      let entry: any;
      try { entry = JSON.parse(line); } catch { continue; }
      const content = entry?.type === 'assistant' ? entry?.message?.content : null;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c?.type !== 'tool_use' || (c.name !== 'Agent' && c.name !== 'Task')) continue;
        calls++;
        const type = typeof c.input?.subagent_type === 'string' ? c.input.subagent_type : 'general-purpose';
        const label = Object.prototype.hasOwnProperty.call(AGENT_LABEL_MAP, type) ? AGENT_LABEL_MAP[type] : undefined;
        const text = typeof c.input?.description === 'string' ? c.input.description.trim().slice(0, 200) : '';
        if (!label || text.length < 3) { skipped++; continue; }
        items.push({ label, text, src: 'transcript', group: p });
      }
    }
  }
  return { items, files, calls, skipped };
}

export function loadGuard(path?: string): GuardSet {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = path ? [path] : [
    resolvePath(here, '..', '..', 'assets', 'agent-router', 'guard.minilm.json'),
    resolvePath(here, '..', '..', '..', 'assets', 'agent-router', 'guard.minilm.json'),
  ];
  const p = candidates.find(existsSync);
  if (!p) throw new Error('router guard set (assets/agent-router/guard.minilm.json) not found');
  const g = JSON.parse(readFileSync(p, 'utf8')) as GuardSet;
  if (g?.schema !== GUARD_SCHEMA || !Array.isArray(g.rows)) throw new Error(`${p} is not a ${GUARD_SCHEMA} file`);
  return g;
}

/**
 * Shipped centroids plus `weight` × the first `capPerLabel` non-holdout ledger
 * rows per label (ordered by hash, so the result is deterministic).
 */
export function buildCandidate(base: CentroidArtifact, ledger: Ledger, recipe: { weight: number; capPerLabel: number } = DEFAULT_RECIPE): { artifact: CentroidArtifact; used: Record<string, number> } {
  if (!(recipe.weight > 0 && recipe.weight <= 1)) throw new RangeError('weight must be in (0, 1]');
  if (!(Number.isInteger(recipe.capPerLabel) && recipe.capPerLabel >= 1 && recipe.capPerLabel <= LEDGER_CAP_PER_LABEL)) throw new RangeError('capPerLabel out of range');
  const used: Record<string, number> = {};
  const sums = base.centroids.map((c, k) => c.map((x) => x * Math.max(1, base.support[k])));
  const rows = ledger.rows.filter((r) => !isHoldout(r.g)).sort((a, b) => (a.h < b.h ? -1 : 1));
  for (const r of rows) {
    const k = base.labels.indexOf(r.label);
    if (k < 0 || (used[r.label] ?? 0) >= recipe.capPerLabel) continue;
    const v = decodeVec(r.q, base.dim);
    for (let j = 0; j < base.dim; j++) sums[k][j] += recipe.weight * v[j];
    used[r.label] = (used[r.label] ?? 0) + 1;
  }
  const centroids = sums.map((s) => { const n = Math.hypot(...s) || 1; return s.map((x) => Math.round((x / n) * 1e6) / 1e6); });
  const support = base.support.map((n, k) => n + (used[base.labels[k]] ?? 0));
  return { artifact: { ...base, split: `${base.split}+local`, support, centroids }, used };
}

/** Argmax accuracy (no margin, no fallback) over labelled vectors. */
export function accuracy(a: CentroidArtifact, rows: Array<{ label: string; v: ArrayLike<number> }>): { correct: number; total: number; hits: boolean[] } {
  const hits = rows.map((r) => {
    let best = -Infinity, bl = '';
    a.centroids.forEach((c, k) => { let s = 0; for (let j = 0; j < a.dim; j++) s += c[j] * r.v[j]; if (s > best) { best = s; bl = a.labels[k]; } });
    return bl === r.label;
  });
  return { correct: hits.filter(Boolean).length, total: rows.length, hits };
}
