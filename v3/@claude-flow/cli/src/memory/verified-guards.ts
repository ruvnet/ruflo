/**
 * Gaming defences for the verified-outcome learning loop (ADR-503).
 *
 * Every rule here can only downgrade: a tainted record does not train, a
 * pattern that looks gamed is held back from the prompt. Nothing here can
 * turn an `unknown` into a verified outcome.
 *
 *  - §2.1/§2.2 taints: the mod marks a `verified-success` whose turn edited a
 *    test file or a verifier config, or narrowed its check. Ingest never
 *    trains a tainted record unless `.claude-flow/config.json`
 *    `learningLoop.allowTaint` lists every one of its classes.
 *  - §2.3 re-verify settings (the runner lives in verified-reverify.ts).
 *  - §2.4 the anomaly gate on lessons.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Taint = 'edited-tests' | 'edited-verifier-config' | 'narrowed-verifier';
export const TAINTS: readonly Taint[] = ['edited-tests', 'edited-verifier-config', 'narrowed-verifier'];

/** A record's `taint` field, validated: known classes only, each once. Anything else is dropped. */
export function parseTaint(raw: unknown): Taint[] {
  if (!Array.isArray(raw)) return [];
  const out: Taint[] = [];
  for (const t of raw.slice(0, 8)) if (TAINTS.includes(t as Taint) && !out.includes(t as Taint)) out.push(t as Taint);
  return out;
}

export interface LoopConfig {
  /** Taint classes a project lets train (default none). */
  readonly allowTaint: readonly Taint[];
  /** Re-run a verifier at HEAD before a success trains (default off: it runs project code). */
  readonly reverify: boolean;
  readonly reverifyTimeoutMs: number;
}

export const DEFAULT_REVERIFY_TIMEOUT_MS = 300_000;
export const DEFAULT_LOOP_CONFIG: LoopConfig = { allowTaint: [], reverify: false, reverifyTimeoutMs: DEFAULT_REVERIFY_TIMEOUT_MS };

/**
 * `learningLoop` from `.claude-flow/config.json`. A missing, unreadable or
 * malformed file means the defaults: no taint allowed, re-verify off. Only
 * `reverify: true` (the boolean) turns re-verification on.
 */
export function readLoopConfig(root: string): LoopConfig {
  const path = join(root, '.claude-flow', 'config.json');
  try {
    if (!existsSync(path)) return DEFAULT_LOOP_CONFIG;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { learningLoop?: unknown };
    return parseLoopConfig(raw?.learningLoop);
  } catch {
    return DEFAULT_LOOP_CONFIG;
  }
}

export function parseLoopConfig(raw: unknown): LoopConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_LOOP_CONFIG;
  const r = raw as { allowTaint?: unknown; reverify?: unknown; reverifyTimeoutSec?: unknown };
  const sec = typeof r.reverifyTimeoutSec === 'number' && Number.isFinite(r.reverifyTimeoutSec) ? Math.min(Math.max(Math.floor(r.reverifyTimeoutSec), 10), 3600) : DEFAULT_REVERIFY_TIMEOUT_MS / 1000;
  return { allowTaint: parseTaint(r.allowTaint), reverify: r.reverify === true, reverifyTimeoutMs: sec * 1000 };
}

/** The taint classes of a record that its project did not allow; non-empty means it never trains. */
export const blockedTaints = (taint: readonly Taint[], config: LoopConfig): Taint[] => taint.filter(t => !config.allowTaint.includes(t));

/**
 * What ingest knows about a verified pattern, from verified records only
 * (SONA's own counts include other feeders). Sessions are capped: the gate
 * only asks whether there were two.
 */
export interface PatternStats {
  successes: number;
  failures: number;
  /** Successes that carried an allowed taint. */
  tainted: number;
  /** Successes decided by a narrowed command. */
  narrowed: number;
  sessions: string[];
}

export const MAX_PATTERN_SESSIONS = 4;
const SESSION = /^[A-Za-z0-9_-]{1,40}$/;
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1_000_000) : 0);

export const emptyStats = (): PatternStats => ({ successes: 0, failures: 0, tainted: 0, narrowed: 0, sessions: [] });

export function parseStats(raw: unknown): PatternStats {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const sessions = Array.isArray(r.sessions) ? [...new Set(r.sessions.filter((s): s is string => typeof s === 'string' && SESSION.test(s)))].slice(0, MAX_PATTERN_SESSIONS) : [];
  return { successes: count(r.successes), failures: count(r.failures), tainted: count(r.tainted), narrowed: count(r.narrowed), sessions };
}

/** Folds one trained record into its pattern's stats. */
export function addOutcome(stats: PatternStats, success: boolean, taint: readonly Taint[], session: string | null): void {
  if (!success) {
    stats.failures++;
    return;
  }
  stats.successes++;
  if (taint.length > 0) stats.tainted++;
  if (taint.includes('narrowed-verifier')) stats.narrowed++;
  if (session && SESSION.test(session) && !stats.sessions.includes(session) && stats.sessions.length < MAX_PATTERN_SESSIONS) stats.sessions.push(session);
}

export type HoldReason = 'perfect-and-tainted' | 'only-narrowed' | 'one-session';

/** §2.4 case 1: records at or above which a perfect record with half its successes tainted is held. */
export const PERFECT_MIN_RECORDS = 8;

/**
 * Why a would-be lesson is held back from the prompt (ADR-503 §2.4), or null.
 * A held pattern stays in SONA; it only never becomes a prompt lesson.
 *
 * 1. 100% success over 8 or more records, half or more of them tainted (allowed).
 * 2. Every success came from a narrowed command.
 * 3. Every success came from one session: no independent repetition. A pattern
 *    with no recorded sessions (a record from before ADR-503, or one without a
 *    session) counts as one session.
 */
export function holdReason(stats: PatternStats, sonaSuccesses: number): HoldReason | null {
  const s = stats.successes;
  if (s >= PERFECT_MIN_RECORDS && stats.failures === 0 && stats.tainted * 2 >= s) return 'perfect-and-tainted';
  if (s > 0 && stats.narrowed === s) return 'only-narrowed';
  if ((s > 0 || sonaSuccesses > 0) && stats.sessions.length < 2) return 'one-session';
  return null;
}
