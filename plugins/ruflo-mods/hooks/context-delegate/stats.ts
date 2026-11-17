/** Per-session counters for automatic context delegation (ADR-522), written to METRICS_PATH. Pure. */
import type { DelegationMode } from './plan'

export const METRICS_PATH = '.claude-flow/metrics/context-delegation.json'
const RECENT = 50

export type DelegationEvent = {
  readonly at: string
  readonly path: string
  readonly outcome: 'delegated' | 'would-delegate' | 'fallback'
  readonly reason: string
  readonly bytesRead: number
  /** What the model saw: the extract when delegated, else the whole file. */
  readonly bytesShown: number
  readonly workerMs?: number
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly cached?: boolean
}

export type ContextDelegateState = {
  mode: DelegationMode
  /** The prompt the current turn answers, as submitted. */
  prompt: string
  /** Paths read or delegated this session: a second read goes straight through. */
  seen: Set<string>
  /** Verified findings by `sha256|prompt` so the same question on the same bytes never pays twice. */
  cache: Map<string, string>
  totals: { reads: number; delegated: number; wouldDelegate: number; fallbacks: Record<string, number>; bytesRead: number; bytesShown: number; workerMs: number; inputTokens: number; outputTokens: number }
  recent: DelegationEvent[]
}

export function createDelegateState(): ContextDelegateState {
  return { mode: 'off', prompt: '', seen: new Set(), cache: new Map(), totals: { reads: 0, delegated: 0, wouldDelegate: 0, fallbacks: {}, bytesRead: 0, bytesShown: 0, workerMs: 0, inputTokens: 0, outputTokens: 0 }, recent: [] }
}

export function record(s: ContextDelegateState, e: DelegationEvent): void {
  const t = s.totals
  t.reads++
  t.bytesRead += e.bytesRead
  t.bytesShown += e.bytesShown
  if (e.outcome === 'delegated') t.delegated++
  else if (e.outcome === 'would-delegate') t.wouldDelegate++
  else t.fallbacks[e.reason] = (t.fallbacks[e.reason] ?? 0) + 1
  t.workerMs += e.workerMs ?? 0
  t.inputTokens += e.inputTokens ?? 0
  t.outputTokens += e.outputTokens ?? 0
  s.recent.push(e)
  if (s.recent.length > RECENT) s.recent.splice(0, s.recent.length - RECENT)
}

export function metricsJson(s: ContextDelegateState): string {
  const t = s.totals
  const savedPct = t.bytesRead > 0 ? Math.round((1 - t.bytesShown / t.bytesRead) * 10_000) / 100 : 0
  return `${JSON.stringify({ schema: 'ruflo.context-delegation/v1', mode: s.mode, totals: { ...t, shownVsReadSavedPct: savedPct }, recent: s.recent }, null, 2)}\n`
}
