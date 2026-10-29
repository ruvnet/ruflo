/**
 * One turn's trajectory and how its outcome is decided (#4581, ADR-502). Pure.
 *
 * The outcome comes only from verifier runs (see verifier.ts) after the
 * turn's last edit: all passed is `verified-success`, any failed is
 * `verified-failure`, none is `unknown`. `unknown` never trains SONA; the CLI
 * ingest (`ruflo hooks verified-ingest`) only counts it.
 */

import { scan } from '../guidance/screen'
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

export type Run = { readonly kind: VerifierKind; readonly command: string; readonly passed: boolean; readonly seq: number }

export type Trajectory = {
  readonly id: string
  readonly task: string
  readonly agent: string
  readonly startedAt: number
  steps: { tool: string; ok: boolean }[]
  /** Sequence number of the last edit that ran (0: none). */
  lastEdit: number
  edits: number
  runs: Run[]
  seq: number
}

/** Tools whose successful call changes the project. */
export const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

const TOOL = /^[A-Za-z0-9_.:-]{1,80}$/

/**
 * A task as stored: control characters gone, cut to 300 characters; a task
 * carrying a secret shape is stored as `[redacted]` (it then teaches nothing).
 */
export function taskText(prompt: string): string {
  const flat = prompt.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TASK)
  return scan(flat).secrets.length > 0 ? '[redacted]' : flat
}

export function start(id: string, prompt: string, agent: string, now: number): Trajectory {
  return { id, task: taskText(prompt), agent: /^[a-z][a-z0-9-]{0,40}$/.test(agent) ? agent : 'coder', startedAt: now, steps: [], lastEdit: 0, edits: 0, runs: [], seq: 0 }
}

/** Records one finished tool call; `verifier` and `passed` only for a verifier run with a status. */
export function step(t: Trajectory, tool: string, ok: boolean, verifier: Verifier | null, passed: boolean | null): void {
  t.seq++
  if (t.steps.length < MAX_STEPS && TOOL.test(tool)) t.steps.push({ tool, ok })
  if (EDIT_TOOLS.has(tool) && ok) {
    t.lastEdit = t.seq
    t.edits++
  }
  if (verifier && passed !== null) t.runs.push({ kind: verifier.kind, command: verifier.command, passed, seq: t.seq })
}

/** The outcome and the run that decided it: the first failing run after the last edit, else the last passing one. */
export function decide(t: Trajectory, aborted: boolean): { outcome: Outcome; run: Run | null } {
  if (aborted) return { outcome: 'unknown', run: null }
  const after = t.runs.filter(r => r.seq > t.lastEdit)
  if (after.length === 0) return { outcome: 'unknown', run: null }
  const failed = after.find(r => !r.passed)
  return failed ? { outcome: 'verified-failure', run: failed } : { outcome: 'verified-success', run: after[after.length - 1]! }
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
