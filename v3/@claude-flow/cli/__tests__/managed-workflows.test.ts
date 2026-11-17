import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { managedAgentTools } from '../src/mcp-tools/managed-agent-tools.js';
import { dynamicConfig, ManagedProgress, readManagedEvents, type ManagedEvent } from '../src/services/managed-workflows.js';

const event = (id: string, type: string, extra = {}): ManagedEvent => ({ id, type, processed_at: '2026-10-24T12:00:00Z', ...extra });
const idle = (id: string, reason = 'end_turn') => event(id, 'session.status_idle', { stop_reason: { type: reason } });
const call = (name: string, input: Record<string, unknown> = {}) => managedAgentTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let testRoot = '';
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'managed-api-'));
  vi.stubEnv('CLAUDE_FLOW_CWD', testRoot);
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-do-not-log');
  vi.stubEnv('RUFLO_MANAGED_AGENTS_BASE_URL', 'https://api.anthropic.com');
  fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { rmSync(testRoot, { recursive: true, force: true }); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('dynamic workflow admission', () => {
  it('keeps legacy create unchanged and dynamic off', () => {
    expect(dynamicConfig({})).toMatchObject({ enabled: false, networking: { type: 'unrestricted' } });
  });
  it.each([undefined, '', '0', '01', '-1', '25.00', '1e3', 2500, '1000000000'])('rejects invalid cents %s before side effects', async budgetCents => {
    expect((await call('managed_agent_create', { dynamicWorkflows: true, budgetCents })).success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('builds explicit bounded workflow config with restricted agents', () => {
    expect(dynamicConfig({ dynamicWorkflows: true, budgetCents: '2500', predefinedAgents: ['agent_abc'] })).toMatchObject({
      budget: { type: 'limit', max_list_cost: { amount: '2500', currency: 'USD' } },
      multiagent: { type: 'multiagent_20261001', subagents: { type: 'disabled' }, workflows: { inline_agents: { type: 'disabled' }, predefined_agents: ['agent_abc'] } },
      networking: { type: 'limited', allowed_hosts: [] },
    });
  });
  it.each([{ networking: 'unrestricted' }, { allowedHosts: ['*'] }, { allowedHosts: ['https://example.com'] }, { predefinedAgents: [] }, { predefinedAgents: ['../../x'] }, { dynamicWorkflows: 'true' }])('rejects malformed policy %j', async bad => {
    expect((await call('managed_agent_create', { dynamicWorkflows: true, budgetCents: '2500', ...bad })).success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('attaches budget at session creation and multiagent to agent', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'agent_a' })).mockResolvedValueOnce(json({ id: 'env_a' })).mockResolvedValueOnce(json({ id: 'sesn_a' }));
    const result = await call('managed_agent_create', { dynamicWorkflows: true, budgetCents: '2500', allowedHosts: ['github.com'] });
    expect(result.success).toBe(true);
    const bodies = fetchMock.mock.calls.map(c => JSON.parse(c[1].body));
    expect(bodies[0].multiagent.type).toBe('multiagent_20261001');
    expect(bodies[1].config.networking).toEqual({ type: 'limited', allowed_hosts: ['github.com'] });
    expect(bodies[2].budget.max_list_cost.amount).toBe('2500');
  });
});

describe('provider lifecycle evidence', () => {
  it('does not mistake an open workflow for completion', () => {
    const p = new ManagedProgress();
    p.accept([event('r', 'workflow_run.created', { workflow_run_id: 'w' }), idle('i')]);
    expect(p.snapshot()).toMatchObject({ finished: false, openRuns: 1, verification: 'unverified' });
    p.accept([event('end', 'workflow_run.status_ended', { workflow_run_id: 'w', result: { type: 'completed' } })]);
    expect(p.snapshot()).toMatchObject({ finished: false, needsThreadInspection: true, verification: 'unverified' });
    p.accept([idle('final')]);
    expect(p.snapshot().finished).toBe(true);
  });
  it.each(['budget_reached', 'requires_action'])('returns pause distinctly: %s', reason => {
    const p = new ManagedProgress(); p.accept([idle('i', reason)]);
    expect(p.snapshot()).toMatchObject({ blocked: true, finished: false });
  });
  it('does not erase an observed worker error when workflow completes', () => {
    const p = new ManagedProgress();
    p.accept([event('err', 'session.error'), event('e', 'workflow_run.status_ended', { workflow_run_id: 'w', result: { type: 'completed' } }), idle('i')]);
    expect(p.snapshot()).toMatchObject({ observedFailures: 1, verification: 'unverified' });
  });
  it('does not accept an interrupt idle as completion', () => {
    const p = new ManagedProgress(); p.accept([event('int', 'user.interrupt'), idle('i')]);
    expect(p.snapshot()).toMatchObject({ finished: false, interrupted: true });
    p.accept([event('next', 'user.message'), idle('nextIdle')]);
    expect(p.snapshot()).toMatchObject({ finished: true, interrupted: false });
  });
  it('deduplicates inclusive watermark replay and tracks usage', () => {
    const p = new ManagedProgress(); const events = [event('a', 'agent.message', { content: [{ type: 'text', text: 'hello' }] }), event('u', 'session.usage', { usage: { list_cost: { amount: '42', currency: 'USD' }, active_seconds: 10 } })];
    p.accept(events); p.accept(events);
    expect(p.snapshot()).toMatchObject({ assistantText: 'hello', eventCount: 2, listCost: { amount: '42' } });
  });
  it('handles queued user events when they later process', () => {
    const p = new ManagedProgress(); p.accept([event('q', 'user.message', { processed_at: null })]);
    expect(p.snapshot().eventCount).toBe(0);
    p.accept([event('q', 'user.message')]); expect(p.snapshot().eventCount).toBe(1);
  });
});

describe('pagination and observation', () => {
  it('follows opaque next_page with URL encoding and deduplicates', async () => {
    const read = vi.fn().mockResolvedValueOnce({ data: [idle('a')], next_page: 'opaque&x=y' }).mockResolvedValueOnce({ data: [idle('a'), idle('b')] });
    expect((await readManagedEvents(read)).map(e => e.id)).toEqual(['a', 'b']);
    expect(new URLSearchParams(read.mock.calls[1][0]).get('page')).toBe('opaque&x=y');
  });
  it('rejects cursor cycles', async () => {
    await expect(readManagedEvents(async () => ({ data: [], next_page: 'same' }))).rejects.toThrow('Repeated');
  });
  it.each([null, {}, { data: [null] }, { data: [{}] }, { data: [], next_page: 5 }])('fails closed on malformed pages %j', async value => {
    await expect(readManagedEvents(async () => value)).rejects.toThrow('Invalid');
  });
  it('propagates event HTTP failure without echoing upstream secrets', async () => {
    fetchMock.mockImplementation(() => json({ error: { message: 'test-key-do-not-log' } }, 403));
    const result = await call('managed_agent_events', { sessionId: 'sesn_a' });
    expect(result.success).toBe(false); expect(result.error).toContain('403'); expect(JSON.stringify(result)).not.toContain('test-key');
  });
  it('ignores historical idle before the acknowledged current message', async () => {
    vi.useFakeTimers();
    const initial = [idle('old'), event('current', 'user.message'), event('running', 'session.status_running')];
    fetchMock.mockResolvedValueOnce(json({ data: [event('current', 'user.message', { processed_at: null })] }))
      .mockResolvedValueOnce(json({ data: initial }))
      .mockResolvedValueOnce(json({ id: 'sesn_a', status: 'running' }))
      .mockResolvedValueOnce(json({ data: [...initial, event('text', 'agent.message', { content: [{ type: 'text', text: 'new answer' }] }), idle('new')] }))
      .mockResolvedValueOnce(json({ id: 'sesn_a', status: 'idle' }));
    const pending = call('managed_agent_prompt', { sessionId: 'sesn_a', message: 'run', maxWaitMs: 5000 });
    await vi.advanceTimersByTimeAsync(1500);
    const result = await pending;
    expect(result).toMatchObject({ finished: true, assistantText: 'new answer', verification: 'unverified' });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(new URL(fetchMock.mock.calls[3][0]).searchParams.has('created_at[gte]')).toBe(true);
  });
  it('does not report the previous turn as the answer on a later poll while the new turn is still running', async () => {
    vi.useFakeTimers();
    // The provider returns the whole session history on every read. Pre-boundary events (the old turn's text and
    // its end_turn idle) were never fed to the tracker, so a later poll must keep ignoring them.
    const old = [event('oldText', 'agent.message', { content: [{ type: 'text', text: 'OLD ANSWER' }] }), idle('old')];
    const head = [...old, event('current', 'user.message'), event('running', 'session.status_running')];
    const partial = event('partial', 'agent.message', { content: [{ type: 'text', text: 'partial' }] });
    let eventReads = 0;
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return json({ data: [event('current', 'user.message', { processed_at: null })] });
      if (url.includes('/events')) return json({ data: ++eventReads === 1 ? head : [...head, partial] });
      return json({ id: 'sesn_a', status: 'running' });
    });
    const pending = call('managed_agent_prompt', { sessionId: 'sesn_a', message: 'run', maxWaitMs: 4000 });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;
    expect(eventReads).toBeGreaterThan(2);
    expect(result.finished).toBe(false);
    expect(result.assistantText).toBe('partial');
    expect(result.assistantText).not.toContain('OLD ANSWER');
  });
  it('rejects concurrent local prompts without sending twice', async () => {
    let release!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const first = call('managed_agent_prompt', { sessionId: 'sesn_a', message: 'one' });
    expect((await call('managed_agent_prompt', { sessionId: 'sesn_a', message: 'two' })).success).toBe(false);
    release(json({ data: [] })); await first;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('reads worker thread events through an encoded path', async () => {
    fetchMock.mockImplementation(() => json({ data: [event('err', 'session.error')] }));
    const result = await call('managed_agent_events', { sessionId: 'sesn_a', threadId: 'thread_a', raw: true });
    expect(fetchMock.mock.calls[0][0]).toContain('/threads/thread_a/events?limit=100');
    expect(result.observedFailures).toBe(1);
  });
  it('accepts legitimate tool confirmation result strings', async () => {
    fetchMock.mockImplementation(() => json({ data: [event('confirm', 'user.tool_confirmation', { result: 'allow' }), event('run', 'session.status_running'), idle('done')] }));
    expect((await call('managed_agent_events', { sessionId: 'sesn_a' })).finished).toBe(true);
  });
  it('rejects workflow lifecycle events without a run ID', async () => {
    fetchMock.mockImplementation(() => json({ data: [event('broken', 'workflow_run.created'), idle('done')] }));
    expect((await call('managed_agent_events', { sessionId: 'sesn_a' })).success).toBe(false);
  });
  it('does not contaminate a new prompt with old failed runs', async () => {
    const events = [event('oldErr', 'workflow_run.error', { workflow_run_id: 'old' }), event('oldEnd', 'workflow_run.status_ended', { workflow_run_id: 'old', result: { type: 'error' } }), idle('oldIdle'), event('current', 'user.message'), idle('done')];
    fetchMock.mockResolvedValueOnce(json({ data: [event('current', 'user.message')] })).mockResolvedValueOnce(json({ data: events })).mockResolvedValueOnce(json({ id: 'sesn_a', status: 'idle' }));
    expect(await call('managed_agent_prompt', { sessionId: 'sesn_a', message: 'new task' })).toMatchObject({ success: true, finished: true, observedFailures: 0 });
  });
});

describe('transport and cleanup security', () => {
  it('marks ambiguous initial agent creation for inspection without blind cleanup', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network outcome unknown'));
    expect(await call('managed_agent_create')).toMatchObject({ success: false, stage: 'agent', cleanupRequired: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(json({ id: 'unexpected' }));
    expect(await call('managed_agent_create')).toMatchObject({ success: false, stage: 'agent', cleanupRequired: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('does not reuse a generic model proxy or follow redirects', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://wrong.example');
    fetchMock.mockImplementation(() => json({ id: 'sesn_a' }));
    await call('managed_agent_status', { sessionId: 'sesn_a' });
    expect(fetchMock.mock.calls[0][0]).toContain('https://api.anthropic.com/');
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
    expect(fetchMock.mock.calls[0][1].headers['anthropic-beta']).toBe('managed-agents-2026-04-01');
  });
  it.each(['http://api.anthropic.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?token=x'])('rejects unsafe endpoint %s', async base => {
    vi.stubEnv('RUFLO_MANAGED_AGENTS_BASE_URL', base);
    expect((await call('managed_agent_status', { sessionId: 'sesn_a' })).error).toContain('transport');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('cleans up created resources after definite session rejection', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'agent_a' })).mockResolvedValueOnce(json({ id: 'env_a' }))
      .mockResolvedValueOnce(json({}, 400)).mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await call('managed_agent_create', { dynamicWorkflows: true, budgetCents: '100' });
    expect(result).toMatchObject({ success: false, stage: 'session', environmentDeleted: true, agentDeleted: true });
  });
  it('preserves resources after ambiguous session creation failure', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'agent_a' })).mockResolvedValueOnce(json({ id: 'env_a' })).mockRejectedValueOnce(new Error('socket closed'));
    const result = await call('managed_agent_create', { dynamicWorkflows: true, budgetCents: '100' });
    expect(result).toMatchObject({ success: false, stage: 'session', cleanupRequired: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('does not delete an environment if session deletion failed', async () => {
    fetchMock.mockImplementation(() => json({}, 500));
    expect((await call('managed_agent_terminate', { sessionId: 'sesn_a', environmentId: 'env_a' })).success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('reports environment cleanup failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(json({}, 409));
    expect((await call('managed_agent_terminate', { sessionId: 'sesn_a', environmentId: 'env_a' })).success).toBe(false);
  });
  it('never calls a queued interrupt confirmed cancellation', async () => {
    vi.stubEnv('RUFLO_MANAGED_CONTROL', '1'); vi.stubEnv('RUFLO_MANAGED_CONTROL_SESSIONS', 'sesn_a');
    fetchMock.mockImplementation(() => json({ id: 'sesn_a', status: 'running', data: [] }));
    expect(await call('managed_agent_interrupt', { sessionId: 'sesn_a' })).toMatchObject({ interruptRequested: true, cancellationConfirmed: false });
  });
});

describe('resource ids cannot walk the API path', () => {
  // encodeURIComponent('..') is '..', so an id of '..' would send GET /v1/sessions/.. which normalises to /v1/.
  it.each([
    ['managed_agent_status', { sessionId: '..' }],
    ['managed_agent_status', { sessionId: '.' }],
    ['managed_agent_events', { sessionId: '..' }],
    ['managed_agent_events', { sessionId: 'sesn_a', threadId: '..' }],
    ['managed_agent_prompt', { sessionId: '..', message: 'x' }],
    ['managed_agent_terminate', { sessionId: '..' }],
  ])('%s %j sends nothing', async (tool, input) => {
    const result = await call(tool, input);
    expect(Boolean(result.error) || result.success === false).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('terminate will not delete an environment named ..', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await call('managed_agent_terminate', { sessionId: 'sesn_a', environmentId: '..' });
    expect(result.environmentDeleted).toBe(false);
    expect(fetchMock.mock.calls.every(c => !String(c[0]).includes('/environments'))).toBe(true);
  });
  it('ordinary ids are still sent', async () => {
    fetchMock.mockImplementation(() => json({ id: 'sesn_a', status: 'idle' }));
    expect(await call('managed_agent_status', { sessionId: 'sesn_a' })).toMatchObject({ sessionId: 'sesn_a', status: 'idle' });
  });
});

describe('failures after a prompt was already sent', () => {
  it('reports the message id so a retry does not send a duplicate', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [event('sent', 'user.message', { processed_at: null })] })).mockImplementation(() => json({}, 500));
    const result = await call('managed_agent_prompt', { sessionId: 'sesn_a', message: 'run', maxWaitMs: 2000 });
    expect(result.success).toBe(false);
    expect(result.messageId).toBe('sent');
    expect(String(result.note)).toMatch(/already sent/i);
  });
  it('a failed send reports no message id', async () => {
    fetchMock.mockImplementation(() => json({}, 500));
    const result = await call('managed_agent_prompt', { sessionId: 'sesn_a', message: 'run' });
    expect(result.success).toBe(false);
    expect(result.messageId).toBeUndefined();
  });
});

describe('the governed control plane covers its sibling tools', () => {
  const governed = (sessions: string) => { vi.stubEnv('RUFLO_MANAGED_CONTROL', '1'); vi.stubEnv('RUFLO_MANAGED_CONTROL_SESSIONS', sessions); };
  it('managed_agent_interrupt is refused by default and sends nothing to the provider', async () => {
    const result = await call('managed_agent_interrupt', { sessionId: 'sesn_a' });
    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('managed_agent_interrupt is refused for a session outside the host allowlist', async () => {
    governed('sesn_a');
    expect((await call('managed_agent_interrupt', { sessionId: 'sesn_other' })).success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('managed_agent_terminate keeps its default behaviour while the control plane is off', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect((await call('managed_agent_terminate', { sessionId: 'sesn_whatever' })).success).toBe(true);
  });
  it('managed_agent_terminate honours the allowlist once the host enabled the control plane', async () => {
    governed('sesn_a');
    const result = await call('managed_agent_terminate', { sessionId: 'sesn_other', environmentId: 'env_x' });
    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('managed_agent_terminate will not delete an environment that is not the session\'s own', async () => {
    governed('sesn_a');
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return json({ id: 'sesn_a', status: 'running', environment_id: 'env_a' });
    });
    const result = await call('managed_agent_terminate', { sessionId: 'sesn_a', environmentId: 'env_other' });
    expect(result).toMatchObject({ sessionDeleted: true, environmentDeleted: false, success: false });
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/environments/'))).toBe(false);
  });
  it('managed_agent_terminate still removes the session\'s own environment under governance', async () => {
    governed('sesn_a');
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return json({ id: 'sesn_a', status: 'running', environment_id: 'env_a' });
    });
    expect(await call('managed_agent_terminate', { sessionId: 'sesn_a', environmentId: 'env_a' })).toMatchObject({ sessionDeleted: true, environmentDeleted: true, success: true });
  });
});

it('discards an observation when host credentials rotate during provider reads', async () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/events?')) {
      process.env.ANTHROPIC_API_KEY = 'rotated-host-key';
      return json({ data: [idle('done')] });
    }
    return json({ id: 'sesn_a', status: 'idle' });
  });
  const result = await call('managed_agent_events', { sessionId: 'sesn_a' });
  expect(result.success).toBe(false);
  expect(result.error).toContain('scope changed');
});
