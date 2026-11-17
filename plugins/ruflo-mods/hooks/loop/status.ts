import type { Lesson } from './lessons'
import type { Outcome, Trajectory } from './record'

/** One recorded turn as the post-compaction reload names it (ADR-505): task cut to 80, outcome word, verifier command. */
export type RecentOutcome = { readonly task: string; readonly outcome: Outcome; readonly verifier?: string }

/** Kept for the post-compaction reload (ADR-505): the newest lessons shown and outcomes recorded this session. */
export const MAX_RECENT_LESSONS = 3
export const MAX_RECENT_OUTCOMES = 5

/** The learning loop's per-process state (#4581, ADR-502). */
export type LoopState = {
  enabled: boolean
  /** Whether this session's root is a ruflo project (`.claude-flow/` exists); nothing is recorded or read outside one. */
  project?: boolean
  active?: Trajectory
  /** JSONL lines waiting for the turn-end write. */
  pending: string[]
  recorded: { success: number; failure: number; unknown: number }
  /** Lessons added to prompts this session, and the most recent one's confidence. */
  lessonsShown: number
  lastLesson?: number
  /** Verified patterns still below the gate, as the lessons file last said. */
  belowGate: number
  /** Records dropped because the file could not be written and the queue was full. */
  dropped: number
  counter: number
  /** The newest distinct lessons that matched a prompt this session, newest last (at most 3). */
  recentLessons: Lesson[]
  /** The newest turns recorded this session, newest last (at most 5). */
  recentOutcomes: RecentOutcome[]
  /** This mod process's token, written on every record (ADR-503 §2.4 counts a lesson's independent sessions). */
  session: string
}

export const loopState = (): LoopState => ({ enabled: false, pending: [], recorded: { success: 0, failure: 0, unknown: 0 }, lessonsShown: 0, belowGate: 0, dropped: 0, counter: 0, recentLessons: [], recentOutcomes: [], session: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` })

/** Remembers lessons that reached a prompt: distinct by id, newest last, at most 3. */
export function rememberLessons(s: LoopState, chosen: readonly Lesson[]): void {
  for (const l of chosen) {
    s.recentLessons = s.recentLessons.filter(r => r.id !== l.id)
    s.recentLessons.push(l)
  }
  if (s.recentLessons.length > MAX_RECENT_LESSONS) s.recentLessons.splice(0, s.recentLessons.length - MAX_RECENT_LESSONS)
}

/** Remembers one recorded turn from its JSONL line (already validated by `line`): newest last, at most 5. */
export function rememberOutcome(s: LoopState, json: string): void {
  try {
    const r = JSON.parse(json) as { task?: unknown; outcome?: unknown; verifier?: { command?: unknown } | null }
    const outcome = r.outcome === 'verified-success' || r.outcome === 'verified-failure' ? r.outcome : 'unknown'
    const task = typeof r.task === 'string' ? (r.task.length > 80 ? `${r.task.slice(0, 79)}…` : r.task) : ''
    const verifier = typeof r.verifier?.command === 'string' ? r.verifier.command : undefined
    s.recentOutcomes.push({ task, outcome, ...(verifier ? { verifier } : {}) })
    if (s.recentOutcomes.length > MAX_RECENT_OUTCOMES) s.recentOutcomes.splice(0, s.recentOutcomes.length - MAX_RECENT_OUTCOMES)
  } catch {
    // a line that does not parse is not remembered
  }
}

/** The status-line part: verified passes, failures, unverified turns. */
export function loopSegment(s: LoopState): string | undefined {
  if (!s.enabled || s.project !== true) return undefined
  const { success, failure, unknown } = s.recorded
  if (success + failure + unknown === 0 && s.lessonsShown === 0) return undefined
  return `loop ✓${success} ✗${failure} ?${unknown}${s.lessonsShown ? ` · ${s.lessonsShown} lesson${s.lessonsShown === 1 ? '' : 's'}` : ''}`
}

/** The `/ruflo-mods` row. */
export function loopLine(s: LoopState): string {
  if (!s.enabled) return 'off (set the learningLoop option)'
  if (s.project === false) return 'on, inactive (no .claude-flow/ in this project)'
  const { success, failure, unknown } = s.recorded
  const lesson = s.lastLesson === undefined ? 'none yet' : `last at conf ${s.lastLesson.toFixed(2)} (gate 0.60)`
  return [
    `${success} verified pass, ${failure} verified fail, ${unknown} unverified (never trained); ${s.pending.length} pending write${s.dropped ? `, ${s.dropped} dropped` : ''}`,
    `lessons: ${s.lessonsShown} shown, ${lesson}; ${s.belowGate} verified pattern(s) below the gate`,
  ].join('\n               ')
}
