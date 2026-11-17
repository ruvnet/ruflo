/** One explicit, bounded event collector per managed session. No background traffic. */
import { isDeepStrictEqual } from 'node:util';
import { eventPage, ManagedProgress, type ManagedEvent } from './managed-workflows.js';

export type ManagedSessionFacts = {
  status?: string;
  budget?: { max_list_cost?: { amount?: string; currency?: string } };
  usage?: { list_cost?: { amount?: string; currency?: string } };
};
export type ManagedCollectorTransport = {
  readEvents: (since?: string) => Promise<ManagedEvent[]>;
  readSession: () => Promise<ManagedSessionFacts>;
};
type Phase = { id: string; name: string; status: string };
type Thread = { id: string; runId: string | null; status: string; phaseId?: string };
export type ManagedRunSnapshot = {
  sessionId: string; status: string; stopReason: string | null; budgetCents: number | null; listCostCents: number | null;
  providerFinished: boolean; workersInspected: false; acceptancePassed: false; verification: 'unverified';
  runs: Array<{ id: string; status: string; result?: string; phases: Phase[] }>;
  threads: Thread[]; threadOffset: number; threadCount: number; threadCounts: { running: number; ended: number; failed: number; idle: number };
  blockedEventIds: string[]; observedFailures: number; updatedMs: number;
};
export type ManagedCollection = { events: ManagedEvent[]; snapshot: ManagedRunSnapshot };
type State = {
  events: Map<string, ManagedEvent>; bytes: number; progress: ManagedProgress; threads: Map<string, Thread>;
  phases: Map<string, Map<string, Phase>>; blocked: Set<string>; session: ManagedSessionFacts;
  flight?: Promise<ManagedCollection>; result?: ManagedCollection; lastRead: number; lastUsed: number;
};
export const COLLECTOR_LIMITS = { sessions: 6, events: 10_000, bytes: 16_000_000, shownThreads: 60, staleMs: 300_000 } as const;
const idOf = (v: unknown): string | undefined => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v) ? v : undefined;
const record = (v: unknown): Record<string, unknown> | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const cents = (v: unknown): number | null => {
  const r = record(v);
  return r && (r.currency === undefined || r.currency === 'USD') && typeof r.amount === 'string' && /^(?:0|[1-9][0-9]{0,8})$/.test(r.amount) ? Number(r.amount) : null;
};
const phaseName = (v: unknown, fallback: string): string => {
  if (typeof v !== 'string') return fallback;
  if (/sk-|ghp_|github_pat_|hf_|npm_|xox|AKIA|AIza|Bearer|PRIVATE KEY|password|secret|credential|[A-Za-z0-9_=-]{24,}|token["']?\s*[:=]/i.test(v)) return '[redacted phase]';
  return v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '').slice(0, 80) || fallback;
};

/** This cache is an observation aid. Cached facts never authorize an action. */
export class ManagedRunCollector {
  private readonly states = new Map<string, State>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  constructor(options: { now?: () => number; ttlMs?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 1000;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs < 0 || this.ttlMs > 60_000) throw new Error('Invalid collector TTL');
  }

  /** Singleflight includes event and session reads; a failed refresh is never cached as success. */
  refresh(sessionId: string, transport: ManagedCollectorTransport): Promise<ManagedCollection> {
    if (!idOf(sessionId)) return Promise.reject(new Error('Invalid managed session ID'));
    let state = this.states.get(sessionId);
    if (!state) {
      if (this.states.size >= COLLECTOR_LIMITS.sessions) {
        const oldest = [...this.states.entries()].filter(([, s]) => !s.flight && (this.now() - s.lastUsed >= COLLECTOR_LIMITS.staleMs || ['idle', 'terminated', 'error'].includes(s.result?.snapshot.status ?? 'unknown'))).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
        if (!oldest) return Promise.reject(new Error('Managed collector session limit reached'));
        this.states.delete(oldest[0]);
      }
      state = { events: new Map(), bytes: 0, progress: new ManagedProgress(), threads: new Map(), phases: new Map(), blocked: new Set(), session: {}, lastRead: -Infinity, lastUsed: this.now() };
      this.states.set(sessionId, state);
    }
    state.lastUsed = this.now();
    if (state.flight) return state.flight.then(clone);
    if (state.result && this.now() - state.lastRead < this.ttlMs) return Promise.resolve(clone(state.result));
    const s = state;
    // Start transport in a microtask so reentrant callers also see the flight.
    s.flight = Promise.resolve().then(async () => {
      const [events, session] = await Promise.all([transport.readEvents(s.progress.watermark()), transport.readSession()]);
      if (!record(session)) throw new Error('Invalid managed session response');
      const validated = eventPage({ data: events }).data;
      const additions: ManagedEvent[] = [];
      let bytes = s.bytes, total = s.events.size;
      const batch = new Map<string, ManagedEvent>();
      for (const input of validated) {
        const e = clone(input), previous = batch.get(e.id) ?? s.events.get(e.id);
        if (previous?.processed_at && !isDeepStrictEqual(previous, e)) throw new Error('Conflicting managed event replay');
        if (previous && isDeepStrictEqual(previous, e)) continue;
        bytes += Buffer.byteLength(JSON.stringify(e)) - (previous ? Buffer.byteLength(JSON.stringify(previous)) : 0);
        if (!previous) total++;
        if (total > COLLECTOR_LIMITS.events || bytes > COLLECTOR_LIMITS.bytes) throw new Error('Managed collector event limit exceeded');
        batch.set(e.id, e);
      }
      for (const e of batch.values()) additions.push(e);
      s.progress.accept(additions);
      s.bytes = bytes;
      for (const e of additions) { s.events.set(e.id, e); if (e.processed_at) this.observe(s, e); }
      s.session = clone(session);
      s.lastRead = this.now();
      const p = s.progress.snapshot();
      const threadCounts = { running: 0, ended: 0, failed: 0, idle: 0 };
      for (const t of s.threads.values()) {
        if (t.status === 'running') threadCounts.running++;
        else if (t.status === 'failed') threadCounts.failed++;
        else if (t.status === 'ended' || t.status === 'terminated') threadCounts.ended++;
        else threadCounts.idle++;
      }
      const snapshot: ManagedRunSnapshot = {
        sessionId, status: ['idle', 'running', 'rescheduling', 'terminated', 'error'].includes(session.status ?? '') ? session.status! : p.status,
        stopReason: p.stopReason === null || ['end_turn', 'budget_reached', 'requires_action'].includes(p.stopReason) ? p.stopReason : 'unknown', budgetCents: cents(session.budget?.max_list_cost), listCostCents: cents(session.usage?.list_cost) ?? cents(p.listCost),
        providerFinished: p.finished && session.status !== 'running' && session.status !== 'rescheduling' && session.status !== 'terminated',
        workersInspected: false, acceptancePassed: false, verification: 'unverified',
        runs: p.workflowRuns.map(r => ({ ...r, phases: [...(s.phases.get(r.id)?.values() ?? [])] })),
        threads: [...s.threads.values()].slice(0, COLLECTOR_LIMITS.shownThreads), threadOffset: 0, threadCount: s.threads.size, threadCounts,
        blockedEventIds: [...s.blocked], observedFailures: Math.max(p.observedFailures, threadCounts.failed), updatedMs: s.lastRead,
      };
      s.result = { events: [...s.events.values()], snapshot };
      return s.result;
    }).finally(() => { s.flight = undefined; });
    return s.flight.then(clone);
  }

  /** Pure observation, suitable for disk snapshot publication. Never invokes a transport. */
  snapshots(): ManagedRunSnapshot[] { return [...this.states.values()].flatMap(s => s.result ? [clone(s.result.snapshot)] : []); }

  /** A local worker page only. Aggregate counts and observation timestamp do not change. */
  page(sessionId: string, threadOffset = 0): ManagedRunSnapshot | undefined {
    if (!Number.isSafeInteger(threadOffset) || threadOffset < 0 || threadOffset >= COLLECTOR_LIMITS.events) throw new Error('Invalid managed thread offset');
    const state = this.states.get(sessionId);
    if (!state?.result) return undefined;
    return { ...clone(state.result.snapshot), threadOffset, threads: clone([...state.threads.values()].slice(threadOffset, threadOffset + COLLECTOR_LIMITS.shownThreads)) };
  }

  /** A collector doing work cannot be forgotten midflight. No remote work is interrupted. */
  forget(sessionId: string): boolean {
    const s = this.states.get(sessionId);
    return s?.flight ? false : this.states.delete(sessionId);
  }

  private observe(s: State, e: ManagedEvent): void {
    const runId = idOf(e.workflow_run_id);
    if (runId && e.type === 'workflow_run.created' && Array.isArray(e.phases)) {
      const phases = new Map<string, Phase>();
      for (const value of e.phases.slice(0, 100)) {
        const phase = record(value), id = idOf(phase?.id);
        if (id) phases.set(id, { id, name: phaseName(phase?.name, id), status: 'queued' });
      }
      s.phases.set(runId, phases);
    }
    if (runId && (e.type === 'workflow_run.phase_started' || e.type === 'workflow_run.phase_ended')) {
      const id = idOf(e.workflow_run_phase_id);
      if (id) {
        const phases = s.phases.get(runId) ?? new Map<string, Phase>();
        if (phases.size < 100 || phases.has(id)) phases.set(id, { id, name: phases.get(id)?.name ?? id, status: e.type.endsWith('started') ? 'running' : 'ended' });
        s.phases.set(runId, phases);
      }
    }
    const threadId = idOf(e.session_thread_id);
    if (threadId && e.type.startsWith('session.thread_')) {
      const t = s.threads.get(threadId) ?? { id: threadId, runId: runId ?? null, status: 'idle' };
      if (runId) t.runId = runId;
      const phaseId = idOf(e.workflow_run_phase_id); if (phaseId) t.phaseId = phaseId;
      if (e.type === 'session.thread_status_running') t.status = 'running';
      else if (e.type === 'session.thread_status_idle') t.status = 'idle';
      else if (e.type === 'session.thread_status_terminated') t.status = e.error || t.status === 'failed' ? 'failed' : 'ended';
      s.threads.set(threadId, t);
    }
    if (threadId && e.type === 'session.error') {
      const t = s.threads.get(threadId) ?? { id: threadId, runId: runId ?? null, status: 'failed' };
      t.status = 'failed'; s.threads.set(threadId, t);
    }
    const permission = typeof e.evaluated_permission === 'string' ? e.evaluated_permission : record(e.evaluated_permission)?.type;
    if (permission === 'ask' || e.type === 'agent.custom_tool_use') s.blocked.add(e.id);
    const answered = idOf(e.tool_use_id) ?? idOf(e.custom_tool_use_id);
    if (answered && ['user.tool_confirmation', 'user.custom_tool_result', 'user.tool_result'].includes(e.type)) s.blocked.delete(answered);
    const stop = record(e.stop_reason);
    if (stop?.type === 'requires_action' && Array.isArray(stop.event_ids)) for (const id of stop.event_ids) if (idOf(id)) s.blocked.add(id as string);
  }
}

export const sharedManagedCollector = new ManagedRunCollector();
