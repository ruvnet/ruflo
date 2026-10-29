import type { Trajectory } from './record'

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
}

export const loopState = (): LoopState => ({ enabled: false, pending: [], recorded: { success: 0, failure: 0, unknown: 0 }, lessonsShown: 0, belowGate: 0, dropped: 0, counter: 0 })

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
