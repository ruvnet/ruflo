import { describe, expect, it, vi } from 'vitest';
import { COLLECTOR_LIMITS, ManagedRunCollector, type ManagedCollectorTransport } from '../src/services/managed-run-collector.js';
import type { ManagedEvent } from '../src/services/managed-workflows.js';

const event = (id: string, type: string, more: Record<string, unknown> = {}): ManagedEvent => ({ id, type, processed_at: '2026-10-24T00:00:00Z', ...more });
const idle = (id: string, reason = 'end_turn') => event(id, 'session.status_idle', { stop_reason: { type: reason } });
const transport = (events: ManagedEvent[] = [], status = 'idle') => ({ readEvents: vi.fn(async (_since?: string) => events), readSession: vi.fn(async () => ({ status })) });

describe('one explicit collector per session', () => {
  it('deduplicates simultaneous readers and caches only successful results', async () => {
    const collector = new ManagedRunCollector();
    let finish!: (events: ManagedEvent[]) => void;
    const t = transport(); t.readEvents.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const a = collector.refresh('sesn_a', t), b = collector.refresh('sesn_a', t);
    await Promise.resolve();
    expect(t.readEvents).toHaveBeenCalledTimes(1); expect(t.readSession).toHaveBeenCalledTimes(1);
    finish([idle('done')]);
    const [one, two] = await Promise.all([a, b]);
    expect(one).toEqual(two); expect(one).not.toBe(two);
    one.snapshot.status = 'tampered'; one.events.length = 0;
    expect((await collector.refresh('sesn_a', t)).snapshot.status).toBe('idle');
    expect(t.readEvents).toHaveBeenCalledTimes(1);
  });
  it('performs zero background work or snapshot-triggered provider reads', async () => {
    const timer = vi.spyOn(globalThis, 'setTimeout');
    try {
      let now = 0; const collector = new ManagedRunCollector({ now: () => now }), t = transport();
      await collector.refresh('sesn_a', t);
      now = 1_000_000; collector.snapshots(); collector.snapshots();
      expect(t.readEvents).toHaveBeenCalledTimes(1); expect(t.readSession).toHaveBeenCalledTimes(1);
      expect(timer).not.toHaveBeenCalled();
    } finally { timer.mockRestore(); }
  });
  it('uses inclusive watermark after TTL and handles processed queued events', async () => {
    let now = 0; const c = new ManagedRunCollector({ now: () => now }), t = transport([event('q', 'user.message', { processed_at: null })]);
    expect((await c.refresh('sesn_a', t)).events).toHaveLength(1);
    now = 1001; t.readEvents.mockResolvedValueOnce([event('q', 'user.message'), idle('done')]);
    const result = await c.refresh('sesn_a', t);
    expect(result.snapshot.providerFinished).toBe(true); expect(result.events).toHaveLength(2);
    now = 2002; t.readEvents.mockResolvedValueOnce([event('q', 'user.message'), idle('done')]); await c.refresh('sesn_a', t);
    expect(t.readEvents.mock.calls[2]?.[0]).toBe('2026-10-24T00:00:00Z');
  });
  it('retries failed singleflights and never invents an empty success', async () => {
    const c = new ManagedRunCollector(), t = transport();
    t.readEvents.mockRejectedValueOnce(Error('provider unavailable'));
    await expect(Promise.all([c.refresh('sesn_a', t), c.refresh('sesn_a', t)])).rejects.toThrow('unavailable');
    expect(c.snapshots()).toEqual([]);
    expect((await c.refresh('sesn_a', t)).snapshot.status).toBe('idle');
    expect(t.readEvents).toHaveBeenCalledTimes(2);
  });
  it('does not forget a running refresh', async () => {
    const c = new ManagedRunCollector(); let finish!: () => void;
    const t = transport(); t.readEvents.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve([]); }));
    const pending = c.refresh('sesn_a', t); await Promise.resolve();
    expect(c.forget('sesn_a')).toBe(false); finish(); await pending;
    expect(c.forget('sesn_a')).toBe(true); expect(c.snapshots()).toEqual([]);
  });
});

describe('provider progress is distinct from verification', () => {
  it('replays 1,000 workers with duplicate reconnects, budget pause and failures', async () => {
    let now = 0; const c = new ManagedRunCollector({ now: () => now });
    const events: ManagedEvent[] = [event('run', 'workflow_run.created', { workflow_run_id: 'wrun_a', phases: [{ id: 'phase_a', name: 'Review' }] }), event('phase', 'workflow_run.phase_started', { workflow_run_id: 'wrun_a', workflow_run_phase_id: 'phase_a' })];
    for (let i = 0; i < 1000; i++) {
      const thread = { session_thread_id: `thread_${i}`, workflow_run_id: 'wrun_a', workflow_run_phase_id: 'phase_a' };
      events.push(event(`create_${i}`, 'session.thread_created', thread));
      events.push(event(`working_${i}`, 'session.thread_status_running', thread));
      events.push(event(`end_${i}`, 'session.thread_status_terminated', { ...thread, ...(i < 7 ? { error: { type: 'worker_failure' } } : {}) }));
    }
    events.push(event('ask', 'agent.mcp_tool_use', { evaluated_permission: 'ask' }), idle('pause', 'budget_reached'));
    const t = transport([...events, ...events]);
    t.readSession.mockResolvedValue({ status: 'idle', budget: { max_list_cost: { amount: '2500', currency: 'USD' } }, usage: { list_cost: { amount: '2503', currency: 'USD' } } } as any);
    const first = await c.refresh('sesn_a', t);
    expect(first.snapshot).toMatchObject({ threadCount: 1000, threadCounts: { ended: 993, failed: 7, idle: 0, running: 0 }, stopReason: 'budget_reached', providerFinished: false, workersInspected: false, acceptancePassed: false, verification: 'unverified', budgetCents: 2500, listCostCents: 2503, observedFailures: 7, blockedEventIds: ['ask'] });
    expect(first.snapshot.threads).toHaveLength(60); expect(first.events).toHaveLength(events.length);
    const nextPage = c.page('sesn_a', 60)!;
    expect(nextPage.threadOffset).toBe(60); expect(nextPage.threads[0]?.id).toBe('thread_60');
    expect(nextPage.threadCount).toBe(1000); expect(nextPage.threadCounts).toEqual(first.snapshot.threadCounts);
    expect(nextPage.updatedMs).toBe(first.snapshot.updatedMs); expect(t.readEvents).toHaveBeenCalledTimes(1);
    now = 1001; const replay = await c.refresh('sesn_a', t);
    expect(replay.snapshot.threadCounts).toEqual(first.snapshot.threadCounts);
    expect(replay.events).toHaveLength(first.events.length);
    expect(replay.snapshot.runs[0]?.phases).toEqual([{ id: 'phase_a', name: 'Review', status: 'running' }]);
    now = 2002;
    t.readEvents.mockResolvedValueOnce([event('confirm', 'user.tool_confirmation', { tool_use_id: 'ask', result: 'deny' }), event('phaseDone', 'workflow_run.phase_ended', { workflow_run_id: 'wrun_a', workflow_run_phase_id: 'phase_a' }), event('runDone', 'workflow_run.status_ended', { workflow_run_id: 'wrun_a', result: { type: 'completed' } })]);
    const ended = await c.refresh('sesn_a', t);
    expect(ended.snapshot.providerFinished).toBe(false); expect(ended.snapshot.blockedEventIds).toEqual([]);
    now = 3003; t.readEvents.mockResolvedValueOnce([idle('final')]);
    const done = await c.refresh('sesn_a', t);
    expect(done.snapshot.providerFinished).toBe(true); expect(done.snapshot.acceptancePassed).toBe(false); expect(done.snapshot.verification).toBe('unverified');
  });
  it('never reports interrupted work as provider completion', async () => {
    const c = new ManagedRunCollector();
    const result = await c.refresh('sesn_a', transport([event('int', 'user.interrupt'), idle('done')]));
    expect(result.snapshot.providerFinished).toBe(false);
  });
  it('current provider state prevents stale history claiming finished', async () => {
    const result = await new ManagedRunCollector().refresh('sesn_a', transport([idle('old')], 'running'));
    expect(result.snapshot.providerFinished).toBe(false);
  });
  it('tracks custom approvals and clears replies without exposing tool inputs', async () => {
    const c = new ManagedRunCollector({ ttlMs: 0 }), t = transport([event('call', 'agent.custom_tool_use', { input: { token: 'not-for-snapshot' } }), idle('wait', 'requires_action')]);
    const blocked = await c.refresh('sesn_a', t);
    expect(blocked.snapshot.blockedEventIds).toEqual(['call']); expect(JSON.stringify(blocked.snapshot)).not.toContain('not-for-snapshot');
    t.readEvents.mockResolvedValueOnce([event('reply', 'user.custom_tool_result', { custom_tool_use_id: 'call' })]);
    expect((await c.refresh('sesn_a', t)).snapshot.blockedEventIds).toEqual([]);
  });
});

describe('resource and integrity bounds', () => {
  it('refuses excess live sessions but evicts an inactive session', async () => {
    const c = new ManagedRunCollector();
    for (let i = 0; i < 6; i++) await c.refresh(`sesn_${i}`, transport([], 'running'));
    await expect(c.refresh('sesn_more', transport())).rejects.toThrow('limit');
    expect(c.forget('sesn_0')).toBe(true);
    await c.refresh('sesn_idle', transport());
    await c.refresh('sesn_more', transport());
    expect(c.snapshots()).toHaveLength(6);
  });
  it('rejects conflicting processed event IDs without changing the snapshot', async () => {
    const c = new ManagedRunCollector({ ttlMs: 0 }), t = transport([idle('same')]);
    const first = await c.refresh('sesn_a', t);
    t.readEvents.mockResolvedValueOnce([event('same', 'session.status_running')]);
    await expect(c.refresh('sesn_a', t)).rejects.toThrow('Conflicting');
    expect(c.snapshots()[0]).toEqual(first.snapshot);
  });
  it('enforces event and byte bounds before retaining partial batches', async () => {
    const c = new ManagedRunCollector();
    await expect(c.refresh('sesn_events', transport(Array.from({ length: COLLECTOR_LIMITS.events + 1 }, (_, i) => event(`e_${i}`, 'agent.thinking'))))).rejects.toThrow('limit');
    expect(c.snapshots()).toEqual([]);
    const huge = event('big', 'agent.thinking', { data: 'x'.repeat(COLLECTOR_LIMITS.bytes + 1) });
    await expect(c.refresh('sesn_bytes', transport([huge]))).rejects.toThrow('limit');
    expect(c.snapshots()).toEqual([]);
  });
  it.each(['', '../session', 'a'.repeat(129)])('refuses malformed session ID %s', async id => {
    const t = transport(); await expect(new ManagedRunCollector().refresh(id, t)).rejects.toThrow('Invalid');
    expect(t.readEvents).not.toHaveBeenCalled();
  });
  it('worker pages never trigger reads and reject invalid offsets', () => {
    const c = new ManagedRunCollector();
    expect(c.page('sesn_missing', 0)).toBeUndefined();
    for (const offset of [-1, 0.5, 10_000, Infinity]) expect(() => c.page('sesn_missing', offset)).toThrow('offset');
  });
});

it('deduplicates semantically identical event replay despite JSON property order', async () => {
  const c = new ManagedRunCollector({ ttlMs: 0 });
  const original = event('same', 'agent.tool_use', { input: { first: 1, second: 2 } });
  const t = transport([original]); await c.refresh('sesn_a', t);
  t.readEvents.mockResolvedValueOnce([{ input: { second: 2, first: 1 }, processed_at: original.processed_at, type: original.type, id: original.id }]);
  expect((await c.refresh('sesn_a', t)).events).toHaveLength(1);
});
