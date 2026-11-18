import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { swarmTools } from '../src/mcp-tools/swarm-tools.js';
import { agentTools } from '../src/mcp-tools/agent-tools.js';

let workspace: string;
const call = (name: string, input: Record<string, unknown> = {}) =>
  swarmTools.find(tool => tool.name === name)!.handler(input);
const agentStatus = (agentId: string) =>
  agentTools.find(tool => tool.name === 'agent_status')!.handler({ agentId });

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'swarm-member-lifecycle-'));
  vi.stubEnv('CLAUDE_FLOW_CWD', workspace);
  const now = new Date().toISOString();
  mkdirSync(join(workspace, '.claude-flow', 'swarm'), { recursive: true });
  mkdirSync(join(workspace, '.claude-flow', 'agents'), { recursive: true });
  writeFileSync(join(workspace, '.claude-flow', 'swarm', 'swarm-state.json'), JSON.stringify({
    version: '3.0.0', swarms: {
      first: { swarmId: 'first', topology: 'mesh', maxAgents: 8, status: 'running',
        agents: ['idle', 'busy', 'terminated', 'missing', 'idle'], tasks: [], config: {},
        createdAt: now, updatedAt: now, pid: process.pid },
      second: { swarmId: 'second', topology: 'mesh', maxAgents: 8, status: 'running',
        agents: ['other'], tasks: [], config: {},
        createdAt: now, updatedAt: new Date(Date.now() - 1000).toISOString(), pid: process.pid },
    },
  }));
  const agents = Object.fromEntries(['idle', 'busy', 'terminated', 'other'].map(id => [id, {
    agentId: id, agentType: 'coder', status: id === 'other' ? 'idle' : id,
    health: 100, taskCount: 0, config: {}, createdAt: now,
  }]));
  writeFileSync(join(workspace, '.claude-flow', 'agents', 'store.json'), JSON.stringify({ version: '3.0.0', agents }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(workspace, { recursive: true, force: true });
});

describe('swarm member lifecycle', () => {
  it.each([{ swarmId: 'first' }, {}])('counts only live members for %j', async input => {
    expect(await call('swarm_status', input)).toMatchObject({ swarmId: 'first', agentCount: 2 });
  });

  it('does not substitute the latest swarm for an unknown explicit status ID', async () => {
    expect(await call('swarm_status', { swarmId: 'missing' })).toEqual({
      success: false, error: 'Swarm missing not found',
    });
  });

  it.each([{ swarmId: 'first' }, {}])('terminates only live members for %j', async input => {
    const terminate = agentTools.find(tool => tool.name === 'agent_terminate')!;
    const handler = vi.spyOn(terminate, 'handler');
    expect(await call('swarm_shutdown', input)).toMatchObject({
      success: true, swarmId: 'first', agentsTerminated: 2,
    });
    expect(handler.mock.calls.map(([args]) => args.agentId)).toEqual(['idle', 'busy']);
    expect(await agentStatus('idle')).toMatchObject({ status: 'terminated' });
    expect(await agentStatus('busy')).toMatchObject({ status: 'terminated' });
    expect(await agentStatus('other')).toMatchObject({ status: 'idle' });
    expect(await call('swarm_status', { swarmId: 'first' })).toMatchObject({ status: 'terminated', agentCount: 0 });
    expect(await call('swarm_shutdown', { swarmId: 'first' })).toMatchObject({ success: false, error: 'Swarm already terminated' });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('does not shut down a different swarm for an unknown explicit ID', async () => {
    const file = join(workspace, '.claude-flow', 'swarm', 'swarm-state.json');
    const before = readFileSync(file, 'utf8');
    expect(await call('swarm_shutdown', { swarmId: 'missing' })).toMatchObject({ success: false });
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(await agentStatus('idle')).toMatchObject({ status: 'idle' });
  });

  it('does not report success when member termination fails', async () => {
    const terminate = agentTools.find(tool => tool.name === 'agent_terminate')!;
    vi.spyOn(terminate, 'handler').mockResolvedValue({ success: false, error: 'registry unavailable' });
    expect(await call('swarm_shutdown', { swarmId: 'first' })).toMatchObject({
      success: false, agentsTerminated: 0, error: 'registry unavailable',
    });
    expect(await call('swarm_status', { swarmId: 'first' })).toMatchObject({ status: 'running', agentCount: 2 });
  });
});
