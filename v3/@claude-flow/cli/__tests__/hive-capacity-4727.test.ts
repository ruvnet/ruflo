import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { hiveMindTools, getHiveTokenForCli } from '../src/mcp-tools/hive-mind-tools.js';
import { agentTools } from '../src/mcp-tools/agent-tools.js';

// Registration is real; its optional graph mirror is outside this file-store test.
vi.mock('../src/ruvector/graph-backend.js', () => ({ addNode: vi.fn() }));

const run = (name: string, input: Record<string, unknown> = {}, context?: Record<string, unknown>) =>
  hiveMindTools.find(tool => tool.name === name)!.handler(input, context) as Promise<Record<string, any>>;

describe('#4727 hive capacity and registered membership', () => {
  let dir: string;
  let previousCwd: string | undefined;
  let previousAuth: string | undefined;
  const path = (...parts: string[]) => join(dir, '.claude-flow', ...parts);
  const read = (...parts: string[]) => JSON.parse(readFileSync(path(...parts), 'utf8'));
  const write = (parts: string[], value: unknown) => {
    const target = path(...parts);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(value, null, 2));
  };
  const snapshot = () => ['hive-mind/state.json', 'agents.json', 'agents/store.json'].map(file =>
    existsSync(path(file)) ? readFileSync(path(file), 'utf8') : null);
  const register = async (agentId: string) => {
    const result = await agentTools.find(tool => tool.name === 'agent_spawn')!.handler({
      agentId, agentType: 'coder', model: 'sonnet', config: { keep: 'config' },
    }) as Record<string, any>;
    expect(result.success).toBe(true);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-4727-'));
    previousCwd = process.env.CLAUDE_FLOW_CWD;
    previousAuth = process.env.RUFLO_HIVE_REQUIRE_AUTH;
    process.env.CLAUDE_FLOW_CWD = dir;
    delete process.env.RUFLO_HIVE_REQUIRE_AUTH;
  });

  afterEach(() => {
    if (previousCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = previousCwd;
    if (previousAuth === undefined) delete process.env.RUFLO_HIVE_REQUIRE_AUTH;
    else process.env.RUFLO_HIVE_REQUIRE_AUTH = previousAuth;
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects an oversized batch before creating any agents or changing hive data', async () => {
    expect(await run('hive-mind_init', { maxAgents: 2 })).toHaveProperty('success', true);
    await run('hive-mind_memory', { action: 'set', key: 'keep', value: { data: 42 } });
    const before = snapshot();
    const result = await run('hive-mind_spawn', { count: 3 });
    expect(result).toMatchObject({ success: false, maxAgents: 2 });
    expect(result.error).toMatch(/capacity|full|maxAgents/i);
    expect(snapshot()).toEqual(before);
  });

  it('fills exactly to capacity, rejects the next batch in full, and reuses a slot after leave', async () => {
    await run('hive-mind_init', { maxAgents: 2 });
    const first = await run('hive-mind_spawn', { count: 1, role: 'scout' });
    const before = snapshot();
    expect(await run('hive-mind_spawn', { count: 2 })).toHaveProperty('success', false);
    expect(snapshot()).toEqual(before);
    const second = await run('hive-mind_spawn');
    expect(second).toMatchObject({ success: true, spawned: 1, totalWorkers: 2 });
    expect(await run('hive-mind_spawn')).toHaveProperty('success', false);
    expect(read('hive-mind', 'state.json').workers).toEqual([
      first.workers[0].agentId, second.workers[0].agentId,
    ]);
    expect(read('agents.json').agents[first.workers[0].agentId].config).toEqual({ role: 'scout', hiveRole: 'scout' });
    expect(await run('hive-mind_leave', { agentId: first.workers[0].agentId })).toHaveProperty('success', true);
    expect(await run('hive-mind_spawn')).toMatchObject({ success: true, totalWorkers: 2 });
  });

  it('enforces the default capacity for legacy state without maxAgents', async () => {
    await run('hive-mind_init');
    const state = read('hive-mind', 'state.json');
    delete state.maxAgents;
    write(['hive-mind', 'state.json'], state);
    expect(await run('hive-mind_spawn', { count: 15 })).toMatchObject({ success: true, totalWorkers: 15 });
    await register('extra');
    const before = snapshot();
    expect(await run('hive-mind_spawn')).toHaveProperty('success', false);
    expect(await run('hive-mind_join', { agentId: 'extra' })).toHaveProperty('success', false);
    expect(snapshot()).toEqual(before);
  });

  it('joins normally registered agents, persists role, and permits a duplicate at capacity', async () => {
    await run('hive-mind_init', { maxAgents: 1 });
    await register('coder');
    await register('extra');
    const original = read('agents', 'store.json');
    expect(await run('hive-mind_join', { agentId: 'coder', role: 'specialist' })).toMatchObject({
      success: true, role: 'specialist', totalWorkers: 1,
    });
    const stored = read('agents', 'store.json');
    expect(stored).toEqual({ ...original, agents: { ...original.agents, coder: {
      ...original.agents.coder, config: { ...original.agents.coder.config, role: 'specialist', hiveRole: 'specialist' },
    } } });
    expect(existsSync(path('agents.json'))).toBe(false);
    const before = snapshot();
    expect(await run('hive-mind_join', { agentId: 'extra' })).toMatchObject({ success: false, maxAgents: 1 });
    expect(snapshot()).toEqual(before);
    expect(await run('hive-mind_join', { agentId: 'coder', role: 'scout' })).toMatchObject({ success: true, totalWorkers: 1 });
    expect(read('hive-mind', 'state.json').workers).toEqual(['coder']);
    expect(read('agents', 'store.json').agents.coder.config).toMatchObject({ keep: 'config', role: 'scout', hiveRole: 'scout' });
  });

  it('persists the default role on an existing hive-spawned agent without duplicating membership', async () => {
    await run('hive-mind_init', { maxAgents: 1 });
    const spawned = await run('hive-mind_spawn', { role: 'scout' });
    const agentId = spawned.workers[0].agentId;
    expect(await run('hive-mind_join', { agentId })).toMatchObject({ success: true, role: 'worker', totalWorkers: 1 });
    expect(read('agents.json').agents[agentId].config).toEqual({ role: 'worker', hiveRole: 'worker' });
  });

  it('rejects a role outside the schema enum on spawn and join without writing', async () => {
    await run('hive-mind_init', { maxAgents: 4 });
    await register('agent-r');
    const before = snapshot();
    expect(await run('hive-mind_spawn', { count: 1, role: 'queen' })).toMatchObject({ success: false, error: expect.stringMatching(/role must be one of/) });
    expect(await run('hive-mind_join', { agentId: 'agent-r', role: 'queen' })).toMatchObject({ success: false, error: expect.stringMatching(/role must be one of/) });
    expect(snapshot()).toEqual(before);
  });

  it('rejects unknown agents, including with a valid remote token, without writing', async () => {
    await run('hive-mind_init', { maxAgents: 2 });
    const before = snapshot();
    for (const context of [undefined, { sessionId: 'capacity-test', transport: 'http' }]) {
      const result = await run('hive-mind_join', { agentId: 'missing', hiveToken: getHiveTokenForCli() }, context);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found|unknown|not registered/i);
      expect(snapshot()).toEqual(before);
    }
  });

  it('keeps remote authorization ahead of membership and capacity writes', async () => {
    await run('hive-mind_init', { maxAgents: 1 });
    await register('coder');
    const before = snapshot();
    const context = { sessionId: 'capacity-test', transport: 'http' };
    expect(await run('hive-mind_join', { agentId: 'coder' }, context)).toMatchObject({ success: false, error: expect.stringMatching(/hiveToken is required/) });
    expect(await run('hive-mind_spawn', {}, context)).toMatchObject({ success: false, error: expect.stringMatching(/hiveToken is required/) });
    expect(snapshot()).toEqual(before);
    expect(await run('hive-mind_join', { agentId: 'coder', hiveToken: getHiveTokenForCli() }, context)).toHaveProperty('success', true);
  });

  it.each([1.5, -1, 0, NaN, Infinity, '2'])('rejects invalid spawn count %s without writes', async count => {
    await run('hive-mind_init', { maxAgents: 2 });
    const before = snapshot();
    expect(await run('hive-mind_spawn', { count })).toHaveProperty('success', false);
    expect(snapshot()).toEqual(before);
  });

  it.each([
    ['agents.json', false], ['agents/store.json', false],
    ['agents.json', true], ['agents/store.json', true],
  ] as const)('preserves records and metadata when joining from %s (array: %s)', async (file, array) => {
    await run('hive-mind_init', { maxAgents: 2 });
    const original = { version: 'old-version', metadata: { keep: true }, agents: {
      existing: { agentId: 'existing', status: 'idle', config: { custom: [1, 2] }, extra: 'preserved' },
      unrelated: { agentId: 'unrelated', config: { keep: true } },
    } };
    const store = { ...original, agents: array ? Object.values(original.agents) : original.agents };
    write([file], store);
    expect(await run('hive-mind_join', { agentId: 'existing', role: 'scout' })).toHaveProperty('success', true);
    const existing = { ...original.agents.existing, config: { custom: [1, 2], role: 'scout', hiveRole: 'scout' } };
    expect(read(file)).toEqual({ ...store, agents: array
      ? [existing, original.agents.unrelated]
      : { ...original.agents, existing } });
  });

  it('updates both copies of a registered agent while preserving each store', async () => {
    await run('hive-mind_init');
    await register('coder');
    write(['agents.json'], { metadata: 'keep', agents: { coder: { agentId: 'coder', config: { hiveOnly: true } } } });
    expect(await run('hive-mind_join', { agentId: 'coder', role: 'scout' })).toHaveProperty('success', true);
    expect(read('agents', 'store.json').agents.coder.config).toMatchObject({ keep: 'config', role: 'scout', hiveRole: 'scout' });
    expect(read('agents.json')).toEqual({ metadata: 'keep', agents: { coder: {
      agentId: 'coder', config: { hiveOnly: true, role: 'scout', hiveRole: 'scout' },
    } } });
  });

  it('preserves an existing map store and metadata during spawn', async () => {
    await run('hive-mind_init');
    const existing = { agentId: 'existing', config: { keep: 42 }, history: ['keep'] };
    write(['agents.json'], { version: 'legacy', agents: { existing } });
    const result = await run('hive-mind_spawn');
    const stored = read('agents.json');
    expect(result.success).toBe(true);
    expect(stored.version).toBe('legacy');
    expect(Object.keys(stored.agents)).toHaveLength(2);
    expect(stored.agents.existing).toEqual(existing);
    expect(stored.agents[result.workers[0].agentId]).toMatchObject({ agentId: result.workers[0].agentId });
  });

  it('appends to an existing array store without losing records or changing its representation', async () => {
    await run('hive-mind_init', { maxAgents: 2 });
    const original = { version: 'legacy', agents: [{ agentId: 'existing', config: { keep: 42 } }] };
    write(['agents.json'], original);
    const result = await run('hive-mind_spawn');
    expect(result.success).toBe(true);
    expect(read('agents.json')).toMatchObject({ version: 'legacy', agents: [original.agents[0], { agentId: result.workers[0].agentId }] });
    expect(await run('hive-mind_join', { agentId: 'existing', role: 'specialist' })).toHaveProperty('success', true);
    expect(read('agents.json').agents[0].config).toEqual({ keep: 42, role: 'specialist', hiveRole: 'specialist' });
    expect((await run('hive-mind_status')).workers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: result.workers[0].agentId, status: 'idle' }),
    ]));
    await run('hive-mind_leave', { agentId: 'existing' });
    expect(await run('hive-mind_shutdown', { force: true })).toHaveProperty('success', true);
    expect(read('agents.json')).toEqual({ version: 'legacy', agents: [{
      ...original.agents[0], config: { keep: 42, role: 'specialist', hiveRole: 'specialist' },
    }] });
  });

  it('checks both stores before persisting a role or membership', async () => {
    await run('hive-mind_init');
    await register('coder');
    writeFileSync(path('agents.json'), '{ preserve');
    const before = snapshot();
    await expect(run('hive-mind_join', { agentId: 'coder', role: 'scout' })).rejects.toThrow();
    expect(snapshot()).toEqual(before);
  });

  it.each(['raft', 'bft', 'quorum'])('retains authenticated membership and voting boundaries for %s with real registrations', async strategy => {
    await run('hive-mind_init', { maxAgents: 3 });
    const hiveToken = getHiveTokenForCli();
    const context = { sessionId: 'capacity-test', transport: 'http' };
    for (const agentId of ['first', 'second', 'third']) {
      await register(agentId);
      expect(await run('hive-mind_join', { agentId, hiveToken }, context)).toHaveProperty('success', true);
    }
    const proposal = await run('hive-mind_consensus', { action: 'propose', type: 'test', value: 'keep', strategy, hiveToken }, context);
    const before = snapshot();
    for (const voterId of ['unknown-a', 'unknown-b', 'unknown-c']) {
      expect(await run('hive-mind_consensus', {
        action: 'vote', proposalId: proposal.proposalId, voterId, vote: true, hiveToken,
      }, context)).toHaveProperty('error', expect.stringMatching(/not a registered/));
    }
    expect(await run('hive-mind_leave', { agentId: 'first' }, context)).toHaveProperty('success', false);
    expect(await run('hive-mind_shutdown', { force: true }, context)).toHaveProperty('success', false);
    expect(snapshot()).toEqual(before);
    expect(await run('hive-mind_consensus', {
      action: 'vote', proposalId: proposal.proposalId, voterId: 'first', vote: true, hiveToken,
    }, context)).not.toHaveProperty('error');
    expect(read('hive-mind', 'state.json').consensus.pending[0].votes).toEqual({ first: true });
  });

  it.each(['{ "keep":', 'null', '[]', '{"agents":null}', '{"agents":"invalid"}'])('does not overwrite an unreadable or invalid hive agent store: %s', async original => {
    await run('hive-mind_init');
    writeFileSync(path('agents.json'), original);
    const before = snapshot();
    await expect(run('hive-mind_spawn')).rejects.toThrow();
    await expect(run('hive-mind_join', { agentId: 'missing' })).rejects.toThrow();
    expect(snapshot()).toEqual(before);
  });
});
