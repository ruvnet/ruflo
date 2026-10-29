/**
 * Verified-outcome learning loop, CLI half (#4581, ADR-502).
 *
 * The ruflo-mods `learningLoop` option records one trajectory per main-loop
 * turn in `.claude-flow/data/verified-trajectories.jsonl`. A mod may not run
 * processes or call MCP tools, so it can only observe: a turn is
 * `verified-success` or `verified-failure` when a recognised test, build or
 * typecheck command ran after the turn's last edit and its process exit
 * status said so; anything else is `unknown`.
 *
 * This module is the only place those records reach SONA:
 *  - `verified-*` records train SONA (`processTrajectoryOutcome`);
 *  - `unknown` records are counted and never train;
 *  - each record is ingested once (an id ledger, never a rewrite of the
 *    mod's file, which the mod appends to concurrently);
 *  - task text is PII-redacted before it reaches SONA's keyword store.
 *
 * It then writes `.claude-flow/data/learned-lessons.json`: patterns that
 * verified outcomes produced, those at or above the SONA routing gate as
 * lessons, and repeated verified failures as cautions. The mod reads that
 * file and adds at most three cited lessons to a prompt.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const VERIFIED_PATH = join('.claude-flow', 'data', 'verified-trajectories.jsonl');
export const LEDGER_PATH = join('.claude-flow', 'data', 'verified-ingest.json');
export const LESSONS_PATH = join('.claude-flow', 'data', 'learned-lessons.json');

/** The SONA routing gate (sona-optimizer.ts `SONA_ROUTING_GATE`); a lesson below it never influences routing. */
export const LESSON_GATE = 0.6;
/** Ingested ids remembered; the mod keeps at most 500 lines, so this always covers the whole file. */
export const MAX_LEDGER_IDS = 2000;
/** A file past this many bytes is not read (the mod caps its own at far less). */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_LESSONS = 20;
/** Verified failures (and more failures than successes) before a pattern becomes a caution. */
export const CAUTION_MIN_FAILURES = 2;

export type Outcome = 'verified-success' | 'verified-failure' | 'unknown';
export type VerifierKind = 'test' | 'build' | 'typecheck' | 'lint';

export interface VerifiedRecord {
  readonly id: string;
  readonly task: string;
  readonly agent: string;
  readonly outcome: Outcome;
  readonly verifier: { readonly kind: VerifierKind; readonly command: string; readonly passed: boolean } | null;
  readonly steps: ReadonlyArray<{ readonly tool: string; readonly ok: boolean }>;
  readonly edits: number;
  readonly startedAt: number;
  readonly endedAt: number;
}

export interface IngestLedger {
  version: 1;
  ids: string[];
  /** mtime of the jsonl at the last ingest, so a caller can skip an unchanged file cheaply. */
  lastMtimeMs: number;
  totals: { verifiedSuccess: number; verifiedFailure: number; unknown: number; rejected: number };
  /** Pattern keys verified outcomes trained, with the last verifier command that decided them (the lesson's evidence). */
  patterns: Record<string, { evidence: string; at: number }>;
}

export interface Lesson {
  readonly id: string;
  readonly kind: 'lesson' | 'caution';
  readonly agent: string;
  readonly keywords: string[];
  readonly confidence: number;
  readonly successes: number;
  readonly failures: number;
  readonly evidence: string;
}

export interface LessonsFile {
  version: 1;
  gate: number;
  generatedAt: number;
  lessons: Lesson[];
  /** Verified patterns still below the gate, for the cold-start progress line. */
  belowGate: number;
}

export interface IngestResult {
  ingested: { verifiedSuccess: number; verifiedFailure: number; unknown: number; rejected: number };
  trained: number;
  skipped: 'no-file' | 'unchanged' | 'too-large' | null;
  lessons: number;
  cautions: number;
  belowGate: number;
  totals: IngestLedger['totals'];
  sonaAvailable: boolean;
}

/** The SONA surface ingest needs; injectable so tests never touch `.swarm/`. */
export interface SonaLike {
  processTrajectoryOutcome(outcome: {
    trajectoryId: string;
    task: string;
    agent: string;
    success: boolean;
    steps?: Array<{ action: string; result: string; quality: number; timestamp: string }>;
    duration?: number;
    feedback?: string;
  }): { learned: boolean; patternKey: string; confidence: number };
  exportPatterns(): Record<string, { keywords: string[]; agent: string; confidence: number; successCount: number; failureCount: number }>;
}

const OUTCOMES: readonly Outcome[] = ['verified-success', 'verified-failure', 'unknown'];
const KINDS: readonly VerifierKind[] = ['test', 'build', 'typecheck', 'lint'];
const ID = /^vt-[A-Za-z0-9_-]{1,80}$/;
const AGENT = /^[a-z][a-z0-9-]{0,40}$/;
const TOOL = /^[A-Za-z0-9_.:-]{1,80}$/;
/** SONA's agent roles (sona-optimizer.ts AGENT_TYPES); a route agent outside them trains as `coder`. */
const SONA_AGENTS = new Set(['coder', 'tester', 'reviewer', 'architect', 'researcher', 'optimizer', 'debugger', 'documenter', 'security-architect', 'performance-engineer']);

const num = (v: unknown, max = Number.MAX_SAFE_INTEGER) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), max) : 0);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

/** One line of the mod's file, validated; anything malformed is null. Unknown fields never survive. */
export function parseRecord(line: string): VerifiedRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.id !== 'string' || !ID.test(r.id)) return null;
  if (!OUTCOMES.includes(r.outcome as Outcome)) return null;
  const agent = typeof r.agent === 'string' && AGENT.test(r.agent) ? r.agent : 'coder';
  const task = text(r.task, 300);
  if (!task) return null;

  let verifier: VerifiedRecord['verifier'] = null;
  if (r.verifier && typeof r.verifier === 'object') {
    const v = r.verifier as Record<string, unknown>;
    if (KINDS.includes(v.kind as VerifierKind) && typeof v.passed === 'boolean') {
      verifier = { kind: v.kind as VerifierKind, command: text(v.command, 80), passed: v.passed };
    }
  }
  // A verified outcome must carry the verifier that decided it, and agree with it.
  const outcome = r.outcome as Outcome;
  if (outcome !== 'unknown' && (!verifier || verifier.passed !== (outcome === 'verified-success'))) return null;

  const steps = Array.isArray(r.steps)
    ? r.steps
        .slice(0, 64)
        .filter((s): s is { tool: string; ok: unknown } => !!s && typeof s === 'object' && typeof (s as { tool?: unknown }).tool === 'string' && TOOL.test((s as { tool: string }).tool))
        .map(s => ({ tool: s.tool, ok: s.ok === true }))
    : [];

  return { id: r.id, task, agent, outcome, verifier, steps, edits: num(r.edits, 10_000), startedAt: num(r.startedAt), endedAt: num(r.endedAt) };
}

export function emptyLedger(): IngestLedger {
  return { version: 1, ids: [], lastMtimeMs: 0, totals: { verifiedSuccess: 0, verifiedFailure: 0, unknown: 0, rejected: 0 }, patterns: {} };
}

/** A ledger file read back; a corrupt or hostile one starts over (re-ingest is bounded by the mod's 500-line cap). */
export function readLedger(raw: string | null): IngestLedger {
  if (!raw) return emptyLedger();
  try {
    const j = JSON.parse(raw) as Partial<IngestLedger>;
    if (!j || j.version !== 1 || !Array.isArray(j.ids)) return emptyLedger();
    const t = (j.totals ?? {}) as Partial<IngestLedger['totals']>;
    const patterns: IngestLedger['patterns'] = {};
    for (const [k, v] of Object.entries(j.patterns && typeof j.patterns === 'object' ? j.patterns : {})) {
      if (k === '__proto__' || typeof k !== 'string' || k.length > 400 || !v || typeof v !== 'object') continue;
      patterns[k] = { evidence: text((v as { evidence?: unknown }).evidence, 80), at: num((v as { at?: unknown }).at) };
    }
    return {
      version: 1,
      ids: j.ids.filter((id): id is string => typeof id === 'string' && ID.test(id)).slice(-MAX_LEDGER_IDS),
      lastMtimeMs: num(j.lastMtimeMs),
      totals: { verifiedSuccess: num(t.verifiedSuccess), verifiedFailure: num(t.verifiedFailure), unknown: num(t.unknown), rejected: num(t.rejected) },
      patterns,
    };
  } catch {
    return emptyLedger();
  }
}

/** Redacts PII from task text before it reaches SONA's keyword store; never throws. */
async function redact(task: string): Promise<string> {
  try {
    const { detectPII, redactPII } = await import('../transfer/anonymization/index.js');
    return detectPII(task).found ? redactPII(task) : task;
  } catch {
    return task;
  }
}

/** Keywords a lesson may show: SONA keeps any non-separator text, the prompt gets only plain words. */
const SAFE_KEYWORD = /^[a-z0-9][a-z0-9 _./-]{0,40}$/;

/** A lesson's citation: a short hash of the SONA pattern key, so the key's own text never reaches a prompt. */
export const lessonId = (patternKey: string) => `L-${createHash('sha256').update(patternKey).digest('hex').slice(0, 10)}`;

/** Builds the lessons file from SONA's patterns, keeping only the ones verified outcomes trained. */
export function buildLessons(patterns: ReturnType<SonaLike['exportPatterns']>, verified: IngestLedger['patterns'], now: number): LessonsFile {
  const lessons: Lesson[] = [];
  let belowGate = 0;
  for (const [id, p] of Object.entries(patterns)) {
    const v = verified[id];
    if (!v || !p || !Array.isArray(p.keywords)) continue;
    const keywords = p.keywords.filter(k => typeof k === 'string' && SAFE_KEYWORD.test(k)).slice(0, 10);
    if (keywords.length === 0 || !AGENT.test(p.agent)) continue;
    const base = { id: lessonId(id), agent: p.agent, keywords, confidence: Math.round(p.confidence * 1000) / 1000, successes: p.successCount, failures: p.failureCount, evidence: v.evidence };
    if (p.failureCount >= CAUTION_MIN_FAILURES && p.failureCount > p.successCount) lessons.push({ ...base, kind: 'caution' });
    else if (p.confidence >= LESSON_GATE) lessons.push({ ...base, kind: 'lesson' });
    else belowGate++;
  }
  lessons.sort((a, b) => b.confidence - a.confidence || b.successes + b.failures - (a.successes + a.failures));
  return { version: 1, gate: LESSON_GATE, generatedAt: now, lessons: lessons.slice(0, MAX_LESSONS), belowGate };
}

function writeAtomic(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, path);
}

export interface IngestOptions {
  /** Project root; defaults to process.cwd(), where SONA keeps `.swarm/`. */
  root?: string;
  /** Ingest even when the file's mtime matches the last ingest. */
  force?: boolean;
  /** Count only: train nothing and write nothing. */
  dryRun?: boolean;
  /** SONA to train; defaults to the process's optimizer. Null means unavailable. */
  sona?: SonaLike | null;
  now?: number;
}

/**
 * Ingests every not-yet-ingested record. Verified records train SONA; unknown
 * ones are counted. Safe to call often: an unchanged file is one stat.
 */
/** Per-root mtime of the last completed ingest in this process, so a hot caller (hooks_route) skips the ledger read too. */
const lastIngested = new Map<string, { mtimeMs: number; totals: IngestLedger['totals'] }>();

export async function ingestVerifiedOutcomes(options: IngestOptions = {}): Promise<IngestResult> {
  const root = options.root ?? process.cwd();
  const now = options.now ?? Date.now();
  const file = join(root, VERIFIED_PATH);
  if (!options.force && !options.dryRun && options.sona !== null) {
    try {
      const memo = lastIngested.get(root);
      if (memo && memo.mtimeMs === statSync(file).mtimeMs) {
        return { ingested: { verifiedSuccess: 0, verifiedFailure: 0, unknown: 0, rejected: 0 }, trained: 0, skipped: 'unchanged', lessons: 0, cautions: 0, belowGate: 0, totals: { ...memo.totals }, sonaAvailable: true };
      }
    } catch {
      // no file: the full path below reports it
    }
  }
  const ledgerPath = join(root, LEDGER_PATH);
  const ledger = readLedger(existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : null);
  const ingested = { verifiedSuccess: 0, verifiedFailure: 0, unknown: 0, rejected: 0 };
  const done = (skipped: IngestResult['skipped'], sonaAvailable: boolean, lessons?: LessonsFile): IngestResult => ({
    ingested,
    trained: ingested.verifiedSuccess + ingested.verifiedFailure,
    skipped,
    lessons: lessons?.lessons.filter(l => l.kind === 'lesson').length ?? 0,
    cautions: lessons?.lessons.filter(l => l.kind === 'caution').length ?? 0,
    belowGate: lessons?.belowGate ?? 0,
    totals: ledger.totals,
    sonaAvailable,
  });

  if (!existsSync(file)) return done('no-file', options.sona !== null);
  const st = statSync(file);
  if (st.size > MAX_FILE_BYTES) return done('too-large', options.sona !== null);
  if (!options.force && st.mtimeMs === ledger.lastMtimeMs) return done('unchanged', options.sona !== null);

  let sona: SonaLike | null | undefined = options.sona;
  if (sona === undefined) {
    try {
      const { getSONAOptimizer } = await import('./sona-optimizer.js');
      sona = (await getSONAOptimizer()) as unknown as SonaLike;
    } catch {
      sona = null;
    }
  }

  const seen = new Set(ledger.ids);
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const record = parseRecord(line);
    if (!record) {
      ingested.rejected++;
      continue;
    }
    if (seen.has(record.id)) continue;
    // Without SONA nothing verified can train yet: leave it un-ingested for the next call.
    if (record.outcome !== 'unknown' && !sona) continue;
    seen.add(record.id);
    ledger.ids.push(record.id);
    if (record.outcome === 'unknown') {
      ingested.unknown++;
      continue;
    }
    if (options.dryRun) {
      record.outcome === 'verified-success' ? ingested.verifiedSuccess++ : ingested.verifiedFailure++;
      continue;
    }
    const success = record.outcome === 'verified-success';
    const result = sona!.processTrajectoryOutcome({
      trajectoryId: record.id,
      task: await redact(record.task),
      agent: SONA_AGENTS.has(record.agent) ? record.agent : 'coder',
      success,
      steps: record.steps.map(s => ({ action: s.tool, result: s.ok ? 'ok' : 'error', quality: s.ok ? 1 : 0, timestamp: new Date(record.endedAt || now).toISOString() })),
      duration: record.endedAt > record.startedAt ? record.endedAt - record.startedAt : 0,
      feedback: `verified by ${record.verifier!.kind}: ${record.verifier!.command}`,
    });
    if (result.learned && result.patternKey) ledger.patterns[result.patternKey] = { evidence: record.verifier!.command, at: now };
    success ? ingested.verifiedSuccess++ : ingested.verifiedFailure++;
  }

  if (options.dryRun) return done(null, !!sona);

  ledger.ids = ledger.ids.slice(-MAX_LEDGER_IDS);
  // Without SONA, verified records stayed un-ingested: keep the mtime stale so the next call retries them.
  if (sona) {
    ledger.lastMtimeMs = st.mtimeMs;
    lastIngested.set(root, { mtimeMs: st.mtimeMs, totals: { ...ledger.totals } });
  }
  for (const k of Object.keys(ingested) as Array<keyof typeof ingested>) ledger.totals[k] += ingested[k];
  // Keep the verified-pattern map bounded to what SONA still holds.
  const patterns = sona ? sona.exportPatterns() : {};
  if (sona) for (const k of Object.keys(ledger.patterns)) if (!patterns[k]) delete ledger.patterns[k];
  writeAtomic(ledgerPath, JSON.stringify(ledger));

  const lessons = sona ? buildLessons(patterns, ledger.patterns, now) : undefined;
  if (lessons) writeAtomic(join(root, LESSONS_PATH), JSON.stringify(lessons, null, 2));
  return done(null, !!sona, lessons);
}

/**
 * The doctor's view: whether the loop is recording and whether its records
 * reach SONA. Read-only.
 */
export function learningLoopHealth(root = process.cwd()): { status: 'pass' | 'warn'; message: string; fix?: string } {
  const file = join(root, VERIFIED_PATH);
  if (!existsSync(file)) return { status: 'pass', message: 'not recording (ruflo-mods learningLoop option off or no turn yet)' };
  let lines: string[] = [];
  try {
    if (statSync(file).size <= MAX_FILE_BYTES) lines = readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
  } catch {
    return { status: 'warn', message: 'verified-trajectories.jsonl unreadable' };
  }
  const ledgerPath = join(root, LEDGER_PATH);
  const ledger = readLedger(existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : null);
  const seen = new Set(ledger.ids);
  const records = lines.map(parseRecord).filter((r): r is VerifiedRecord => r !== null);
  const waiting = records.filter(r => !seen.has(r.id) && r.outcome !== 'unknown').length;
  const verified = records.filter(r => r.outcome !== 'unknown').length;
  const summary = `${records.length} turn(s) recorded, ${verified} verified; trained so far ${ledger.totals.verifiedSuccess} success / ${ledger.totals.verifiedFailure} failure, ${ledger.totals.unknown} unknown (never trained)`;
  if (waiting > 0) {
    return { status: 'warn', message: `${summary}; ${waiting} verified outcome(s) not yet ingested`, fix: 'ruflo hooks verified-ingest (or any hooks_route / hooks_session-end call ingests them)' };
  }
  return { status: 'pass', message: summary };
}
