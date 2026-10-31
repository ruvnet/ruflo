/**
 * One turn's trajectory and how its outcome is decided (#4581, ADR-502). Pure.
 *
 * The outcome comes only from verifier runs (see verifier.ts) after the
 * turn's last edit: all passed is `verified-success`, any failed is
 * `verified-failure`, none is `unknown`. `unknown` never trains SONA; the CLI
 * ingest (`ruflo hooks verified-ingest`) only counts it.
 */

import { scan } from '../guidance/screen'
import { isTestPath, isVerifierConfig, shellTouches, type Taint } from './taint'
import type { Verifier, VerifierKind } from './verifier'

export const VERIFIED_PATH = '.claude-flow/data/verified-trajectories.jsonl'
export const LESSONS_PATH = '.claude-flow/data/learned-lessons.json'

/** Lines the file keeps (oldest dropped); the CLI ledger remembers 2000 ids, so it always covers them. */
export const MAX_LINES = 500
export const MAX_STEPS = 64
export const MAX_TASK = 300
/** Records waiting for a write, at most (a file that cannot be written must not grow memory). */
export const MAX_PENDING = 50

export type Outcome = 'verified-success' | 'verified-failure' | 'unknown'

export type Run = { readonly kind: VerifierKind; readonly command: string; readonly passed: boolean; readonly seq: number; readonly narrowed: boolean }

export type Trajectory = {
  readonly id: string
  readonly task: string
  readonly agent: string
  readonly startedAt: number
  /** The mod process that recorded it (ADR-503 §2.4: a lesson needs successes from more than one session). */
  readonly session: string
  steps: { tool: string; ok: boolean }[]
  /** Sequence number of the last edit that ran (0: none). */
  lastEdit: number
  edits: number
  runs: Run[]
  seq: number
  /** Whether a successful edit in the turn touched a test file / a file that changes what a verifier checks (ADR-503 §2.1). */
  editedTests: boolean
  editedConfig: boolean
  /** ADR-511: project files the turn's successful edits changed (source only, screened), for the lesson a success teaches. */
  files: string[]
}

/** Tools whose successful call changes the project. */
export const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

const TOOL = /^[A-Za-z0-9_.:-]{1,80}$/

/**
 * A task as stored: control characters gone, e-mail addresses replaced, cut
 * to 300 characters; a task carrying a secret shape is stored as
 * `[redacted]` (it then teaches nothing). The CLI redacts PII again at ingest.
 */
export function taskText(prompt: string): string {
  const flat = prompt
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g, '[email]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TASK)
  return scan(flat).secrets.length > 0 ? '[redacted]' : flat
}

const SESSION = /^[A-Za-z0-9_-]{1,40}$/

export function start(id: string, prompt: string, agent: string, now: number, session = ''): Trajectory {
  return {
    id,
    task: taskText(prompt),
    agent: /^[a-z][a-z0-9-]{0,40}$/.test(agent) ? agent : 'coder',
    startedAt: now,
    session: SESSION.test(session) ? session : '',
    steps: [],
    lastEdit: 0,
    edits: 0,
    runs: [],
    seq: 0,
    editedTests: false,
    editedConfig: false,
    files: [],
  }
}

/** ADR-511: edited files a lesson may name, at most. */
export const MAX_FILES = 5
const FILE = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,119}$/
/** Names that may hold a secret, whatever their contents: never recorded. */
const SENSITIVE = /(?:^|[._-])(?:env|secrets?|credentials?|passwords?|tokens?|private|id_rsa|id_ed25519)(?:[._-]|$)|\.(?:pem|key|p12|pfx|crt|keystore)$|^(?:npmrc|netrc|pypirc)$/i

/**
 * ADR-511: whether an edited path may be named in a lesson. Project-relative source files only: no absolute path,
 * no `..`, no dot-file or dot-directory (`.env`, `.claude/`, `.git/`), no name that may hold a secret, and no
 * test file or verifier config (a lesson that says "edit the test" would teach gaming, ADR-503).
 */
export function lessonFile(path: string): boolean {
  if (!FILE.test(path)) return false
  const segs = path.split('/')
  if (segs.some(s => s === '' || s === '..' || s.startsWith('.'))) return false
  if (SENSITIVE.test(segs.at(-1)!)) return false
  return !isTestPath(path) && !isVerifierConfig(path)
}

/**
 * Records one finished tool call; `verifier` and `passed` only for a verifier run with a status, `path` only for an
 * edit (project-relative; its class decides the taints, and a screened source path is kept for the lesson, ADR-511), `command` only for Bash: a command that writes,
 * moves or deletes a test file or verifier config taints like an Edit of it, whether or not it succeeded and whether
 * or not it is also a verifier (a taint can only stop a record from training).
 */
export function step(t: Trajectory, tool: string, ok: boolean, verifier: Verifier | null, passed: boolean | null, path?: string, command?: unknown): void {
  t.seq++
  if (t.steps.length < MAX_STEPS && TOOL.test(tool)) t.steps.push({ tool, ok })
  if (tool === 'Bash') {
    const touched = shellTouches(command)
    if (touched.tests) t.editedTests = true
    if (touched.config) t.editedConfig = true
  }
  if (EDIT_TOOLS.has(tool) && ok) {
    t.lastEdit = t.seq
    t.edits++
    if (typeof path === 'string' && path.length > 0 && path.length <= 4096) {
      if (isTestPath(path)) t.editedTests = true
      if (isVerifierConfig(path)) t.editedConfig = true
      if (t.files.length < MAX_FILES && !t.files.includes(path) && lessonFile(path)) t.files.push(path)
    }
  }
  if (verifier && passed !== null) t.runs.push({ kind: verifier.kind, command: verifier.command, passed, seq: t.seq, narrowed: verifier.narrowed === true })
}

/**
 * The outcome and the run that decided it: the first failing run after the last edit, else the last passing one.
 * A turn that changed nothing is unknown: a verifier verifies a change, and "ran the tests" is not a task outcome.
 */
export function decide(t: Trajectory, aborted: boolean): { outcome: Outcome; run: Run | null } {
  if (aborted || t.edits === 0) return { outcome: 'unknown', run: null }
  const after = t.runs.filter(r => r.seq > t.lastEdit)
  if (after.length === 0) return { outcome: 'unknown', run: null }
  const failed = after.find(r => !r.passed)
  return failed ? { outcome: 'verified-failure', run: failed } : { outcome: 'verified-success', run: after[after.length - 1]! }
}

/**
 * The taints a `verified-success` carries (ADR-503 §2.1): what the turn did to its own check. Any other outcome
 * carries none, and a taint never changes the outcome.
 */
export function taints(t: Trajectory, outcome: Outcome, run: Run | null): Taint[] {
  if (outcome !== 'verified-success') return []
  const out: Taint[] = []
  if (t.editedTests) out.push('edited-tests')
  if (t.editedConfig) out.push('edited-verifier-config')
  if (run?.narrowed) out.push('narrowed-verifier')
  return out
}

/** The JSONL line the CLI ingest reads (`parseRecord` in cli/src/memory/verified-outcomes.ts). */
export function line(t: Trajectory, aborted: boolean, now: number): string {
  const { outcome, run } = decide(t, aborted)
  return JSON.stringify({
    v: 1,
    id: t.id,
    task: t.task,
    agent: t.agent,
    outcome,
    verifier: run ? { kind: run.kind, command: run.command, passed: run.passed } : null,
    steps: t.steps,
    edits: t.edits,
    taint: taints(t, outcome, run),
    // ADR-511: a verified turn says which files it edited (the CLI names only a success's in a lesson).
    ...(outcome !== 'unknown' && t.files.length > 0 ? { files: t.files } : {}),
    ...(t.session ? { session: t.session } : {}),
    startedAt: t.startedAt,
    endedAt: now,
  })
}

/** `existing` plus `lines`, capped to the newest MAX_LINES; blank lines dropped. */
export function appendLines(existing: string, lines: readonly string[]): string {
  const all = [...existing.split('\n').filter(l => l.trim()), ...lines]
  return `${all.slice(-MAX_LINES).join('\n')}\n`
}

/** The outcome word a line records, for the session counters. */
export const outcomeOf = (json: string): Outcome => (JSON.parse(json) as { outcome: Outcome }).outcome
