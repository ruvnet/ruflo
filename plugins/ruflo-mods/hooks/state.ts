import type { BudgetLevel } from './cost/budget'
import type { EditRecord } from './learn/insights'
import type { Ownable } from './ownership'
import type { RouteResult } from './route/route-task'

/**
 * What the mod knows during one process, shared by its features. In memory
 * only: it dies with the process, as the classic handshake variable does. A
 * hot reload re-runs `register` and `session.start`, which rebuild it; the
 * only state that would matter across a reload (pending edit records) is
 * written at every turn end, so a reload loses at most one turn's records.
 */
export type ModState = {
  /** The session's project root, where the classic helpers keep their files. */
  root: string
  owned: ReadonlySet<Ownable>
  /** Whether ruflo's own parts are shown (off where the ruflo statusLine helper runs). */
  statusLine: boolean
  lastRoute?: RouteResult
  routed: number
  tightened: number
  observed: number
  edits: EditRecord[]
  editCount: number
  policy: 'none' | 'legacy' | 'observe' | 'enforce' | 'unreadable'
  /** The research run (marker startedAt) whose first web call was already put to the person. */
  researchAsked?: string
  budget: { level: BudgetLevel; usd?: number; limit?: number }
  /** Other mods' status segments, by id (`$.ruflo.segment`). */
  segments: Map<string, string>
  /**
   * Draws the status line. Installed by the `engine.create` step from the `$`
   * beneath; a refused `ui.status` is swallowed, never failing a hook.
   */
  draw: (text: string | undefined) => void
}

export function createState(): ModState {
  return {
    root: '.',
    owned: new Set(),
    statusLine: false,
    routed: 0,
    tightened: 0,
    observed: 0,
    edits: [],
    editCount: 0,
    policy: 'none',
    budget: { level: 'OK' },
    segments: new Map(),
    draw: () => undefined,
  }
}

/** A path under the session's project root. */
export const under = (s: ModState, relative: string) => `${s.root}/${relative}`

export const MAX_SEGMENTS = 8
export const MAX_SEGMENT_CHARS = 48
const SEGMENT_ID = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Sets or clears one segment. Untrusted input: the id must be a short token,
 * the text loses control and bidi-override characters, collapses whitespace
 * and is cut to 48 characters. Throws (the caller's call rejects) on a bad id
 * or a new id past the cap.
 */
export function setSegment(s: ModState, input: unknown): void {
  const { id, text } = (input ?? {}) as { id?: unknown; text?: unknown }
  if (typeof id !== 'string' || !SEGMENT_ID.test(id)) throw new Error('ruflo.segment: id must be 1-32 of [A-Za-z0-9_-]')
  if (text !== null && typeof text !== 'string') throw new Error('ruflo.segment: text must be a string or null')
  const clean =
    text === null
      ? ''
      : text
          .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
          .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
  if (!clean) {
    s.segments.delete(id)
    return
  }
  if (!s.segments.has(id) && s.segments.size >= MAX_SEGMENTS) throw new Error(`ruflo.segment: at most ${MAX_SEGMENTS} segments`)
  s.segments.set(id, clean.length > MAX_SEGMENT_CHARS ? `${clean.slice(0, MAX_SEGMENT_CHARS - 1)}…` : clean)
}

/** Segments as shown: sorted by id. */
export const sortedSegments = (s: ModState) => [...s.segments].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

/**
 * The one status line: ruflo's own parts (when shown), then segments; or
 * undefined (clears the line) when there is nothing to show. Only measured
 * facts: a route that did not match says so, nothing is estimated.
 */
export function statusText(s: ModState): string | undefined {
  const parts: string[] = []
  if (s.statusLine) {
    if (s.lastRoute) {
      const pct = Math.round(s.lastRoute.confidence * 100)
      parts.push(s.lastRoute.matched ? `${s.lastRoute.agent} ${pct}%` : `no route (${pct}%)`)
    }
    if (s.editCount) parts.push(`${s.editCount} edit${s.editCount === 1 ? '' : 's'}`)
    if (s.policy !== 'none' && s.policy !== 'legacy') parts.push(`policy ${s.policy}`)
    if (s.tightened) parts.push(`${s.tightened} tightened`)
    if (s.budget.limit !== undefined && s.budget.level !== 'OK') parts.push(`budget ${s.budget.level}`)
  }
  for (const [, text] of sortedSegments(s)) parts.push(text)
  return parts.length ? ['ruflo', ...parts].join(' · ') : undefined
}

/** Redraws the status line from the state. */
export const redraw = (s: ModState) => s.draw(statusText(s))

/** What `/ruflo-mods` prints. */
export function report(s: ModState): string {
  const route = s.lastRoute
    ? `${s.lastRoute.agent} (${(s.lastRoute.confidence * 100).toFixed(0)}%, ${s.lastRoute.matched ? 'matched' : 'no match'})`
    : 'none yet'
  const budget =
    s.budget.limit === undefined
      ? 'off (set the costBudgetUsd option)'
      : `${s.budget.level}: $${(s.budget.usd ?? 0).toFixed(2)} of $${s.budget.limit.toFixed(2)}`
  const segments = sortedSegments(s).map(([id]) => id)
  return [
    'ruflo mods (ADR-404)',
    `  owns:        ${[...s.owned].join(', ') || 'nothing (classic hooks keep every event)'}`,
    `  routed:      ${s.routed} prompt(s); last ${route}`,
    `  edits:       ${s.editCount} recorded, ${s.edits.length} pending write`,
    `  policy:      ${s.policy}; ${s.tightened} call(s) tightened, ${s.observed} observed`,
    `  budget:      ${budget}`,
    `  segments:    ${segments.join(', ') || 'none'}`,
  ].join('\n')
}
