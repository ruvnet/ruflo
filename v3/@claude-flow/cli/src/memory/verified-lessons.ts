/**
 * The lessons file the learning loop writes (#4581 ADR-502, ADR-511): SONA patterns that verified outcomes trained,
 * at or above the routing gate as lessons, repeated verified failures as cautions.
 *
 * ADR-511 adds what a lesson can act on: the project files the passing fixes edited, counted per pattern in the
 * ingest ledger and named (at most three, most often first) in the lesson. A path reaches the file only if it passes
 * `lessonFile`, the same screen the mod applies when it records and again when it reads.
 */

import { createHash } from 'node:crypto';
import { emptyStats, holdReason, type HoldReason, type PatternStats } from './verified-guards.js';

/** The SONA routing gate (sona-optimizer.ts `SONA_ROUTING_GATE`); a lesson below it never influences routing. */
export const LESSON_GATE = 0.6;
export const MAX_LESSONS = 20;
/** Verified failures (and more failures than successes) before a pattern becomes a caution. */
export const CAUTION_MIN_FAILURES = 2;
/** ADR-511: files a record may carry, files a pattern counts, and files a lesson names. */
export const MAX_RECORD_FILES = 5;
export const MAX_PATTERN_FILES = 20;
export const MAX_LESSON_FILES = 3;

export interface Lesson {
  readonly id: string;
  readonly kind: 'lesson' | 'caution';
  readonly agent: string;
  readonly keywords: string[];
  readonly confidence: number;
  readonly successes: number;
  readonly failures: number;
  readonly evidence: string;
  /** ADR-511: files the passing fixes edited, most often first (a lesson only). */
  readonly files?: string[];
}

export interface LessonsFile {
  version: 1;
  gate: number;
  generatedAt: number;
  lessons: Lesson[];
  /** Verified patterns still below the gate, for the cold-start progress line. */
  belowGate: number;
  /** Patterns at or above the gate that the anomaly gate kept out of the prompt (ADR-503 §2.4). */
  held: Array<{ id: string; reason: HoldReason }>;
}

/** What `SonaLike.exportPatterns()` returns. */
export type PatternExport = Record<string, { keywords: string[]; agent: string; confidence: number; successCount: number; failureCount: number }>;

/** The ledger's view of one verified pattern that buildLessons reads. */
export interface VerifiedPattern {
  evidence: string;
  at: number;
  stats?: PatternStats;
  /** ADR-511: edited file → verified successes that edited it. */
  files?: Record<string, number>;
}

const AGENT = /^[a-z][a-z0-9-]{0,40}$/;
/** Keywords a lesson may show: SONA keeps any non-separator text, the prompt gets only plain words. */
const SAFE_KEYWORD = /^[a-z0-9][a-z0-9 _./-]{0,40}$/;

const FILE = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,119}$/;
/** Names that may hold a secret, whatever their contents. */
const SENSITIVE = /(?:^|[._-])(?:env|secrets?|credentials?|passwords?|tokens?|private|id_rsa|id_ed25519)(?:[._-]|$)|\.(?:pem|key|p12|pfx|crt|keystore)$|^(?:npmrc|netrc|pypirc)$/i;
/** Test files and verifier config (taint.ts in the mod): a lesson that says "edit the test" would teach gaming. */
const TEST_FILE = /(?:\.(?:test|spec)\.[A-Za-z0-9]+|^test_[^/]*\.py|_test\.(?:go|rs))$/;
const TEST_DIRS = new Set(['__tests__', 'tests', 'test']);
const VERIFIER_CONFIG = /^(?:package\.json|vitest\.config\.[^/]+|jest\.config\.[^/]+|pytest\.ini|pyproject\.toml|setup\.cfg|tox\.ini|Cargo\.toml|go\.mod|tsconfig[^/]*\.json|eslint\.config\.[^/]+|Makefile)$/;

/**
 * ADR-511: whether a path may be named in a lesson. Project-relative source files only: no absolute path, no `..`,
 * no dot-file or dot-directory, no name that may hold a secret, no test file and no verifier config.
 */
export function lessonFile(path: unknown): path is string {
  if (typeof path !== 'string' || !FILE.test(path)) return false;
  const segs = path.split('/');
  if (segs.some(s => s === '' || s === '..' || s.startsWith('.'))) return false;
  const base = segs[segs.length - 1]!;
  if (SENSITIVE.test(base) || TEST_FILE.test(base) || VERIFIER_CONFIG.test(base)) return false;
  return !segs.slice(0, -1).some(d => TEST_DIRS.has(d));
}

/** A record's `files`, screened. */
export const recordFiles = (raw: unknown): string[] =>
  Array.isArray(raw) ? [...new Set(raw.filter(lessonFile))].slice(0, MAX_RECORD_FILES) : [];

/** A ledger pattern's file counts, screened; a hostile ledger keeps nothing it should not. */
export function parseFileCounts(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [f, n] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_PATTERN_FILES)) {
    if (lessonFile(f) && typeof n === 'number' && Number.isFinite(n) && n >= 1) out[f] = Math.min(Math.floor(n), 1_000_000);
  }
  return out;
}

/** Counts one verified success's files; past the cap, the least-counted file makes room. */
export function addFiles(counts: Record<string, number>, files: readonly string[]): void {
  for (const f of files) {
    if (counts[f] !== undefined) counts[f]++;
    else counts[f] = 1;
  }
  const keys = Object.keys(counts);
  if (keys.length > MAX_PATTERN_FILES) {
    for (const k of keys.sort((a, b) => counts[a]! - counts[b]! || a.localeCompare(b)).slice(0, keys.length - MAX_PATTERN_FILES)) delete counts[k];
  }
}

/** The files a lesson names: most often first, ties by name, at most three. */
export const topFiles = (counts: Record<string, number> | undefined): string[] =>
  Object.entries(counts ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_LESSON_FILES)
    .map(([f]) => f);

/** A lesson's citation: a short hash of the SONA pattern key, so the key's own text never reaches a prompt. */
export const lessonId = (patternKey: string) => `L-${createHash('sha256').update(patternKey).digest('hex').slice(0, 10)}`;

/**
 * Builds the lessons file from SONA's patterns, keeping only the ones verified outcomes trained. A would-be lesson the
 * anomaly gate holds (ADR-503 §2.4) is listed under `held` instead: it stays in SONA, never in a prompt.
 */
export function buildLessons(patterns: PatternExport, verified: Record<string, VerifiedPattern>, now: number): LessonsFile {
  const lessons: Lesson[] = [];
  const held: LessonsFile['held'] = [];
  let belowGate = 0;
  for (const [id, p] of Object.entries(patterns)) {
    const v = verified[id];
    if (!v || !p || !Array.isArray(p.keywords)) continue;
    const keywords = p.keywords.filter(k => typeof k === 'string' && SAFE_KEYWORD.test(k)).slice(0, 10);
    if (keywords.length === 0 || !AGENT.test(p.agent)) continue;
    const base = { id: lessonId(id), agent: p.agent, keywords, confidence: Math.round(p.confidence * 1000) / 1000, successes: p.successCount, failures: p.failureCount, evidence: v.evidence };
    if (p.failureCount >= CAUTION_MIN_FAILURES && p.failureCount > p.successCount) lessons.push({ ...base, kind: 'caution' });
    else if (p.confidence >= LESSON_GATE) {
      const reason = holdReason(v.stats ?? emptyStats(), p.successCount);
      if (reason) held.push({ id: base.id, reason });
      else {
        const files = topFiles(v.files);
        lessons.push({ ...base, kind: 'lesson', ...(files.length ? { files } : {}) });
      }
    } else belowGate++;
  }
  lessons.sort((a, b) => b.confidence - a.confidence || b.successes + b.failures - (a.successes + a.failures));
  held.sort((a, b) => a.id.localeCompare(b.id));
  return { version: 1, gate: LESSON_GATE, generatedAt: now, lessons: lessons.slice(0, MAX_LESSONS), belowGate, held: held.slice(0, MAX_LESSONS) };
}
