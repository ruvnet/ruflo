import { describe, expect, it, vi } from 'vitest';
import { readOptions } from '../../../../plugins/ruflo-agent/hooks/options';
import { managedCapabilities, managedVerdict, MANAGED_TOOLS } from '../../../../plugins/ruflo-agent/hooks/managed';
import { register } from '../../../../plugins/ruflo-agent/hooks/register';
import { newStats, statusText } from '../../../../plugins/ruflo-agent/hooks/status';
import { parseModStatus } from '../../../../plugins/ruflo-console/hooks/data/mods';
import { answer as workflowAnswer } from '../../../../plugins/ruflo-workflows/hooks/command';
import { managedAgentTools } from '../src/mcp-tools/managed-agent-tools.js';

const create = 'mcp__plugin_ruflo-core_ruflo__managed_agent_create';
const valid = { dynamicWorkflows: true, budgetCents: '2500', predefinedAgents: ['agent_abc'] };
const enabled = readOptions({ managedWorkflows: 'on' });

describe('mod admission', () => {
  it('disables dynamic cloud creation by default', () => {
    expect(managedVerdict(create, valid, readOptions(undefined))).toContain('off');
  });
  it('keeps the dynamic gate with secret guard off', () => {
    expect(managedVerdict(create, valid, readOptions({ guard: 'off' }))).toContain('off');
  });
  it('allows only explicitly enabled bounded creation', () => {
    expect(managedVerdict(create, valid, enabled)).toBeUndefined();
    expect(managedVerdict(create, { ...valid, budgetCents: '2501' }, enabled)).toContain('budget');
  });
  it.each([undefined, '', '0', '01', '25.00', '1e3', 2500, '9999999999'])('rejects malformed budget %s', budgetCents => {
    expect(managedVerdict(create, { ...valid, budgetCents }, enabled)).toContain('budget');
  });
  it.each(['nope', '0', '-1', '1.00', 500])('invalid configured cap fails closed: %s', maxBudgetCents => {
    const opts = readOptions({ managedWorkflows: 'on', maxBudgetCents } as any);
    expect(opts.maxBudgetCents).toBe(0);
    expect(managedVerdict(create, valid, opts)).toContain('budget');
  });
  it('requires predefined agents unless inline use was explicitly enabled', () => {
    const input = { dynamicWorkflows: true, budgetCents: '100' };
    expect(managedVerdict(create, input, enabled)).toContain('predefined');
    expect(managedVerdict(create, input, readOptions({ managedWorkflows: 'on', allowInlineAgents: 'on' }))).toBeUndefined();
  });
  it.each(['tool_input', 'params', 'args', 'parameters'])('applies the policy to arguments wrapped as %s instead of letting them through', wrapper => {
    // An unrecognised wrapper used to be read as a flat envelope with no dynamicWorkflows field, so the call was allowed.
    expect(managedVerdict(create, { [wrapper]: { ...valid, budgetCents: '2501' } }, enabled)).toContain('budget');
    expect(managedVerdict(create, { [wrapper]: valid }, enabled)).toBeUndefined();
    expect(managedVerdict(create, { [wrapper]: valid }, readOptions(undefined))).toContain('off');
  });
  it('denies a wrapper that is not an object, and two competing wrappers', () => {
    expect(managedVerdict(create, { tool_input: 'dynamicWorkflows' }, enabled)).toContain('malformed');
    expect(managedVerdict(create, { tool_input: valid, params: { ...valid, budgetCents: '1' } }, enabled)).toContain('malformed');
  });
  it('reads flat and nested envelopes and rejects ambiguous input', () => {
    expect(managedVerdict(create, { input: valid }, enabled)).toBeUndefined();
    expect(managedVerdict(create, { arguments: valid }, enabled)).toBeUndefined();
    expect(managedVerdict(create, { input: {}, ...valid }, enabled)).toContain('malformed');
    expect(managedVerdict(create, { input: 'invalid' }, enabled)).toContain('malformed');
  });
  it('does not alter legacy creation or unrelated tools', () => {
    expect(managedVerdict(create, {}, readOptions(undefined))).toBeUndefined();
    expect(managedVerdict('unrelated', valid, readOptions(undefined))).toBeUndefined();
  });
  it('rejects unrestricted networking and malformed workflow opt-in', () => {
    expect(managedVerdict(create, { ...valid, networking: 'unrestricted' }, enabled)).toContain('network');
    expect(managedVerdict(create, { ...valid, dynamicWorkflows: 'true' }, enabled)).toContain('boolean');
  });
});

describe('capability discovery and console contract', () => {
  it('keeps plugin capability inventory aligned with actual MCP registration', () => {
    expect([...MANAGED_TOOLS].sort()).toEqual(managedAgentTools.map(t => t.name).sort());
  });
  it('reports runtime configuration without provider calls or key requirement', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    try {
      const caps = await managedAgentTools.find(t => t.name === 'managed_agent_capabilities')!.handler({});
      expect(caps).toMatchObject({ networkCalled: false, betaAccess: 'unknown', remoteHealth: 'unknown' });
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('reports actual full registry names without claiming readiness', () => {
    const caps = managedCapabilities([create], enabled);
    expect(caps).toContain(create); expect(caps).toContain('Missing:');
    expect(caps).toContain('not authorization');
  });
  it('writes policy metadata that the existing console parser can read', () => {
    const row = parseModStatus('agent-mod', statusText({ ...newStats(), lastDenied: 'policy', blocked: 1 }, enabled, 1000));
    expect(row).toMatchObject({ modVersion: '0.4.0', lastDenied: 'policy', blocked: 1 });
    expect(row?.summary).toContain('budget 2500 cents');
    expect(row?.summary?.length).toBeLessThanOrEqual(120);
  });
  it('workflow mod distinguishes missing, registered and unavailable discovery', async () => {
    const deps = { opts: { guard: true }, stats: { checked: 0, blocked: 0, seen: {} } } as any;
    expect(await workflowAnswer('managed', { ...deps, tools: async () => [] })).toContain('not registered');
    expect(await workflowAnswer('managed', { ...deps, tools: async () => ['managed_agent_capabilities'] })).toContain('does not establish authorization');
    expect(await workflowAnswer('managed', { ...deps, tools: async () => { throw Error('private'); } })).toContain('unknown');
  });
});

describe('registered hook execution', () => {
  function harness(options: object = {}) {
    const hooks = new Map<string, any>();
    const files = new Map<string, string>();
    const list = vi.fn().mockResolvedValue([]);
    (register as any)((name: string, ...args: any[]) => hooks.set(name, args.at(-1)), options);
    const $ = { fs: { write: async (p: string, t: string) => { files.set(p, t); } }, session: { root: async () => '/work' }, clock: { now: async () => 1000 }, command: { register: vi.fn() }, tool: { list } };
    return { hooks, $, files };
  }
  it('denies before dispatch, persists counters and never escalates a downstream deny', async () => {
    const h = harness({ guard: 'off' });
    await h.hooks.get('session.start')(h.$, {}, async () => ({}));
    const next = vi.fn();
    expect(await h.hooks.get('tool.call')(h.$, { tool: create, ...valid }, next)).toHaveProperty('deny');
    expect(next).not.toHaveBeenCalled();
    expect(JSON.parse(h.files.get('/work/.claude-flow/agent-mod/status.json')!)).toMatchObject({ blocked: 1, calls: 1 });
    const h2 = harness({ managedWorkflows: 'on' });
    expect(await h2.hooks.get('tool.call')(h2.$, { tool: create, ...valid }, async () => ({ deny: 'host policy' }))).toEqual({ deny: 'host policy' });
  });
  it('refreshes discovery locally and distinguishes registry failure', async () => {
    const h = harness(); const command = h.hooks.get('command.run');
    expect((await command(h.$, { args: 'capabilities' })).text).toContain('none');
    h.$.tool.list.mockResolvedValueOnce([{ name: create }]);
    expect((await command(h.$, { args: 'capabilities' })).text).toContain(create);
    h.$.tool.list.mockRejectedValueOnce(Error('secret error body'));
    expect((await command(h.$, { args: 'capabilities' })).text).toBe('Tool discovery unavailable; managed runtime readiness is unknown.');
  });
});
