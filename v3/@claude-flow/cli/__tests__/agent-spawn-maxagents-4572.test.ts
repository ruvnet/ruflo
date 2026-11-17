/**
 * Regression guard for ruvnet/ruflo#4572 — agent_spawn never checked the
 * swarm's maxAgents, so a swarm_init cap was stored and then ignored. The
 * handler now refuses a spawn into an active swarm that already holds
 * maxAgents live agents, and leaves spawns with no swarm unchanged.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentTools } from '../src/mcp-tools/agent-tools.js';
import { swarmTools } from '../src/mcp-tools/swarm-tools.js';

const call = (tools: typeof agentTools, name: string, input: Record<string, unknown>) =>
  tools.find(t => t.name === name)!.handler(input) as Promise<Record<string, any>>;
const spawn = (input: Record<string, unknown>) => call(agentTools, 'agent_spawn', { agentType: 'coder', ...input });
const initSwarm = async (maxAgents: number) => (await call(swarmTools, 'swarm_init', { maxAgents })).swarmId as string;

function storedAgents(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, '.claude-flow', 'agents', 'store.json'), 'utf8')).agents;
}

describe('#4572 — agent_spawn enforces swarm.maxAgents', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-4572-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses the spawn past maxAgents with the current and max counts', async () => {
    const swarmId = await initSwarm(2);
    expect((await spawn({ agentId: 'a1' })).success).toBe(true);
    expect((await spawn({ agentId: 'a2', swarmId })).success).toBe(true);

    const refused = await spawn({ agentId: 'a3', swarmId });
    expect(refused.success).toBe(false);
    expect(refused.error).toContain('2/2');
    expect(refused).toMatchObject({ swarmId, agentCount: 2, maxAgents: 2 });
    // Refused before any write: the agent is in neither store.
    expect(storedAgents(dir).a3).toBeUndefined();
    expect((await call(swarmTools, 'swarm_status', { swarmId })).agentCount).toBe(2);
  });

  it('applies the cap of the default (most recent) swarm', async () => {
    await initSwarm(1);
    expect((await spawn({ agentId: 'a1' })).success).toBe(true);
    expect((await spawn({ agentId: 'a2' })).success).toBe(false);
  });

  it('frees the slot when an agent is terminated', async () => {
    const swarmId = await initSwarm(1);
    expect((await spawn({ agentId: 'a1', swarmId })).success).toBe(true);
    expect((await spawn({ agentId: 'a2', swarmId })).success).toBe(false);
    expect((await call(agentTools, 'agent_terminate', { agentId: 'a1' })).success).toBe(true);
    expect((await spawn({ agentId: 'a2', swarmId })).success).toBe(true);
  });

  it('lets a retry of an agent already in a full swarm succeed', async () => {
    const swarmId = await initSwarm(1);
    expect((await spawn({ agentId: 'a1', swarmId })).success).toBe(true);
    expect((await spawn({ agentId: 'a1', swarmId })).success).toBe(true);
  });

  it('does not cap a spawn when there is no swarm', async () => {
    for (const agentId of ['a1', 'a2', 'a3']) {
      expect((await spawn({ agentId })).success).toBe(true);
    }
    expect(Object.keys(storedAgents(dir))).toHaveLength(3);
  });

  it('does not cap a swarm that has been shut down', async () => {
    const swarmId = await initSwarm(1);
    expect((await spawn({ agentId: 'a1', swarmId })).success).toBe(true);
    expect((await call(swarmTools, 'swarm_shutdown', { swarmId })).success).toBe(true);
    expect((await spawn({ agentId: 'a2', swarmId })).success).toBe(true);
  });
});
