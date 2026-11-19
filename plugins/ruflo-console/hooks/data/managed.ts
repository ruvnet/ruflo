/** Local managed execution snapshots. Display evidence only, never action authority. */
import { cleanText } from './wf-clean'
import { jsonObject, recordOf } from './parse'
import { readBounded, under, type ReadCache, type ReaderFs } from './files'
import type { WfRun, WfAgent } from './workflows'

export const MANAGED_PATH = '.claude-flow/managed-workflows/snapshot.json'
export const LEARNING_PATH = '.claude-flow/managed-learning/summary.json'
export const MANAGED_MAX_BYTES = 128_000
export const LEARNING_MAX_BYTES = 64_000
export const MANAGED_STALE_MS = 30_000
export const MANAGED_SESSION_CAP = 6
export const MANAGED_THREAD_CAP = 60
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/
const whole = (v: unknown, max = 1_000_000_000): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : null
const label = (v: unknown, max = 80): string => typeof v === 'string' ? cleanText(v).slice(0, max) : ''
const id = (v: unknown): string | null => typeof v === 'string' && ID.test(v) ? v : null

export type ManagedThread = { id: string; runId: string | null; phaseId: string | null; status: string }
export type ManagedSession = {
  sessionId: string; updatedMs: number; status: string; stopReason: string | null; budgetCents: number | null; listCostCents: number | null;
  providerFinished: boolean; workersInspected: boolean; acceptancePassed: boolean; verification: 'unverified';
  runs: { id: string; status: string; result?: string; phases: { id: string; name: string; status: string }[] }[]; threads: ManagedThread[]; threadCount: number; threadOffset: number; partial: boolean;
  blockedEventIds: string[]; observedFailures: number;
  threadCounts: { running: number; ended: number; failed: number; idle: number };
}
export type ManagedFacts = { updatedMs: number; sessions: ManagedSession[]; omittedSessions: number }
export type ManagedLearning = {
  updatedMs: number; observations: number; verified: number; quarantined: number; training: number; holdout: number;
  selected: { id: string; samples: number; successesPerDollar: number | null; p95Ms: number | null; evidenceIds: string[] } | null;
  evaluation: { eligible: boolean; delta: number | null; pairedResults: number; noRegression: boolean } | null;
}

/** Known states stay literal; unknown strings cannot inject labels or status semantics. */
const state = (v: unknown): string => typeof v === 'string' && ['running', 'rescheduling', 'idle', 'terminated', 'ended', 'completed', 'failed', 'error', 'stopped', 'unknown'].includes(v) ? v : 'unknown'

export function parseManaged(text: string | null): ManagedFacts | null {
  if (text === null || text.length > MANAGED_MAX_BYTES) return null
  const value = jsonObject(text)
  if (value?.version !== 1 || whole(value.updatedMs, Number.MAX_SAFE_INTEGER) === null || !Array.isArray(value.sessions) || value.sessions.length > 100) return null
  const sessions: ManagedSession[] = []
  const seen = new Set<string>()
  for (const raw of value.sessions.slice(0, MANAGED_SESSION_CAP)) {
    const s = recordOf(raw), sessionId = id(s?.sessionId)
    if (s === null || sessionId === null || !sessionId.startsWith('sesn_') || seen.has(sessionId) || !Array.isArray(s.runs) || !Array.isArray(s.threads) || s.threads.length > 2000 || s.runs.length > 100 || whole(s.observedFailures, 100_000) === null || !Array.isArray(s.blockedEventIds)) return null
    seen.add(sessionId)
    const threads = new Map<string, ManagedThread>()
    for (const rawThread of s.threads) {
      const t = recordOf(rawThread), threadId = id(t?.id)
      if (t === null || threadId === null) return null
      threads.set(threadId, { id: threadId, runId: id(t.runId), phaseId: id(t.phaseId), status: state(t.status) })
    }
    const visible = [...threads.values()]
    const count = whole(s.threadCount, 100_000) ?? visible.length
    const offset = s.threadOffset === undefined ? 0 : whole(s.threadOffset, 9999)
    if (offset === null) return null
    const c = recordOf(s.threadCounts)
    const measured = c !== null && ['running', 'ended', 'failed', 'idle'].every(k => whole(c[k], 100_000) !== null)
    const threadCounts = measured ? { running: c!.running as number, ended: c!.ended as number, failed: c!.failed as number, idle: c!.idle as number } : {
      running: visible.filter(t => t.status === 'running').length,
      ended: visible.filter(t => ['ended', 'completed', 'terminated', 'stopped'].includes(t.status)).length,
      failed: visible.filter(t => ['failed', 'error'].includes(t.status)).length,
      idle: visible.filter(t => t.status === 'idle').length,
    }
    if (count < offset + visible.length || Object.values(threadCounts).reduce((a, b) => a + b, 0) > count) return null
    const runs = s.runs.map(r => {
      const v = recordOf(r), runId = id(v?.id)
      if (v === null || runId === null || (v.phases !== undefined && (!Array.isArray(v.phases) || v.phases.length > 100))) return null
      const phases = (Array.isArray(v.phases) ? v.phases : []).map(p => { const phase = recordOf(p), phaseId = id(phase?.id); return phase === null || phaseId === null ? null : { id: phaseId, name: label(phase.name) || phaseId, status: state(phase.status) } })
      if (phases.some(p => p === null)) return null
      return { id: runId, status: state(v.status), ...(typeof v.result === 'string' && { result: state(v.result) }), phases }
    })
    if (runs.some(r => r === null)) return null
    sessions.push({
      sessionId, updatedMs: s.updatedMs === undefined ? value.updatedMs as number : whole(s.updatedMs, Number.MAX_SAFE_INTEGER) ?? 0, status: state(s.status), stopReason: ['end_turn', 'budget_reached', 'requires_action'].includes(s.stopReason as string) ? s.stopReason as string : null,
      budgetCents: whole(s.budgetCents), listCostCents: whole(s.listCostCents), providerFinished: s.providerFinished === true,
      // Files are not verifier authority; even a forged true never becomes a verified badge.
      workersInspected: false, acceptancePassed: false, verification: 'unverified', runs: runs as ManagedSession['runs'],
      threads: visible.slice(0, MANAGED_THREAD_CAP), threadCount: count, threadOffset: offset, partial: count > Math.min(visible.length, MANAGED_THREAD_CAP),
      blockedEventIds: Array.isArray(s.blockedEventIds) ? [...new Set(s.blockedEventIds.filter(v => id(v) !== null) as string[])].slice(0, 100) : [],
      observedFailures: whole(s.observedFailures, 100_000) ?? 0, threadCounts,
    })
  }
  return { updatedMs: value.updatedMs as number, sessions, omittedSessions: Math.max(0, value.sessions.length - MANAGED_SESSION_CAP) }
}

export function parseManagedLearning(text: string | null): ManagedLearning | null {
  if (text === null || text.length > LEARNING_MAX_BYTES) return null
  const v = jsonObject(text)
  if (v?.version !== 1 || v.advisory !== true || v.defaultsChanged !== false || whole(v.updatedMs, Number.MAX_SAFE_INTEGER) === null) return null
  if (['observations', 'verified', 'quarantined', 'training', 'holdout'].some(k => whole(v[k], 100_000) === null)) return null
  if ((v.verified as number) + (v.quarantined as number) !== v.observations || (v.training as number) + (v.holdout as number) !== v.verified) return null
  const r = recordOf(v.lastRecommendation), selected = recordOf(r?.selected), strategy = recordOf(selected?.strategy)
  const e = recordOf(v.lastEvaluation)
  const finite = (n: unknown): number | null => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null
  return {
    updatedMs: v.updatedMs as number, observations: v.observations as number, verified: v.verified as number, quarantined: v.quarantined as number, training: v.training as number, holdout: v.holdout as number,
    selected: selected === null || strategy === null || id(strategy.id) === null ? null : { id: label(strategy.id), samples: whole(selected.samples, 100_000) ?? 0, successesPerDollar: finite(selected.successesPerDollar), p95Ms: finite(selected.p95Ms), evidenceIds: Array.isArray(selected.evidenceIds) ? selected.evidenceIds.filter(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)).slice(0, 6) : [] },
    evaluation: e === null ? null : { eligible: e.eligible === true, delta: typeof e.delta === 'number' && Number.isFinite(e.delta) ? e.delta : null, pairedResults: whole(e.pairedResults, 100_000) ?? 0, noRegression: e.noRegression === true },
  }
}

const parsed = new WeakMap<ReadCache, { managedText: string | null; managed: ManagedFacts | null; learningText: string | null; learning: ManagedLearning | null }>()
export async function readManaged(fs: ReaderFs, cache: ReadCache, cwd: string): Promise<{ managed: ManagedFacts | null; learning: ManagedLearning | null }> {
  const [m, l] = await Promise.all([readBounded(fs, cache, under(cwd, MANAGED_PATH), MANAGED_MAX_BYTES, true), readBounded(fs, cache, under(cwd, LEARNING_PATH), LEARNING_MAX_BYTES, true)])
  const mt = m.text, lt = l.text, held = parsed.get(cache)
  const managed = held?.managedText === mt ? held.managed : parseManaged(mt)
  const learning = held?.learningText === lt ? held.learning : parseManagedLearning(lt)
  parsed.set(cache, { managedText: mt, managed, learningText: lt, learning })
  return { managed, learning }
}

/** Managed sessions participate in the same bounded workflow navigation model. */
export function managedRuns(facts: ManagedFacts | null | undefined, nowMs: number): WfRun[] {
  if (!facts) return []
  return facts.sessions.map(s => {
    const stale = nowMs - s.updatedMs > MANAGED_STALE_MS || s.updatedMs > nowMs + 5000
    const phaseNames = new Map(s.runs.flatMap(r => r.phases.map(p => [`${r.id}:${p.id}`, `${r.id} / ${p.name}`] as const)))
    const agents: WfAgent[] = s.threads.map(t => ({ id: t.id, label: t.id, phase: t.runId && t.phaseId ? phaseNames.get(`${t.runId}:${t.phaseId}`) ?? `${t.runId} / ${t.phaseId}` : t.runId ?? 'Primary', state: stale ? 'stale' : t.status === 'running' ? 'running' : ['failed', 'error'].includes(t.status) ? 'failed' : ['ended', 'completed', 'terminated', 'stopped'].includes(t.status) ? 'done' : 'idle', hasWorktree: false, isUnverified: true }))
    const titles = [...new Set([...s.runs.flatMap(r => r.phases.length ? r.phases.map(p => `${r.id} / ${p.name}`) : [r.id]), ...agents.map(a => a.phase)])]
    const phases = titles.map(title => { const list = agents.filter(a => a.phase === title); return { title, detail: 'provider observation; correctness unverified', agents: list, done: list.filter(a => a.state === 'done').length, total: list.length, running: list.filter(a => a.state === 'running').length, failed: list.filter(a => a.state === 'failed').length } })
    return { id: s.sessionId, name: `Managed ${s.sessionId}`, kind: 'managed', state: stale ? 'stalled' : s.observedFailures > 0 ? 'failed' : s.status === 'running' || s.status === 'rescheduling' ? 'running' : s.stopReason === 'budget_reached' || s.stopReason === 'requires_action' || s.blockedEventIds.length > 0 ? 'active' : 'finished', phases,
      running: s.threadCounts.running, done: s.threadCounts.ended, failed: Math.max(s.observedFailures, s.threadCounts.failed), idle: s.threadCounts.idle, total: s.threadCount,
      totalTokens: null, isTokensPartial: true, hasRecord: true, updatedMs: s.updatedMs, isStale: stale, managed: s }
  })
}
