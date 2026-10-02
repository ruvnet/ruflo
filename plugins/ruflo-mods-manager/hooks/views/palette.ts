import type { Verdict } from '../model/data'

/**
 * Colours by the names of Claude Code's own theme, so they follow a dark or a light theme (as ruflo-swarm does). Every
 * colour has a word or glyph beside it: colour is never the only cue.
 */
export const HEAD = 'suggestion'
export const GOOD = 'success'
export const BAD = 'error'
export const WARN = 'warning'
export const ACCENT = 'claude'

export const VERDICT_COLORS: Record<Verdict, string | undefined> = {
  gate: HEAD,
  'no-gate': undefined,
  off: undefined,
  allowed: GOOD,
  clean: GOOD,
  observed: WARN,
  refused: BAD,
  unknown: undefined,
}

export const STATUS_GLYPHS = { pass: '✓', warn: '!', fail: '✗', unknown: '?' } as const
export const STATUS_COLORS = { pass: GOOD, warn: WARN, fail: BAD, unknown: undefined } as const

/** yes / no / not known, as one glyph each. */
export const mark = (v: boolean | null): string => (v === null ? '?' : v ? '●' : '○')
