/**
 * Regression guard — Ruflo Dream Cycle 2026-10-29 (swarm): `agent_spawn`
 * pushed into `swarm.agents` unconditionally, with zero check against the
 * swarm's own `maxAgents` (set at `swarm_init` time and clamped to 1-50).
 * `team_spawn`'s equivalent roster already refuses once full ("Team ...
 * is full (maxAgents=N)", see `grok-team-bus.mjs`); `agent_spawn` had no
 * analogous guard, so root CLAUDE.md's own anti-drift contract ("Keep
 * maxAgents at 6-8 for tight coordination... smaller team = less drift")
 * was silently unenforced for every swarm created via `swarm_init` +
 * `agent_spawn`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentTools } from '../src/mcp-tools/agent-tools.js';
import { swarmTools } from '../src/mcp-tools/swarm-tools.js';

const agentTool = (name: string) => {
  const t = agentTools.find(t => t.name === name);
  if (!t) throw new Error(`MCP tool not registered: ${name}`);
  return t;
};
const swarmTool = (name: string) => {
  const t = swarmTools.find(t => t.name === name);
  if (!t) throw new Error(`MCP tool not registered: ${name}`);
  return t;
};

type SpawnResult = { success: boolean; agentId?: string; error?: string };
type StatusResult = { agentCount: number; maxAgents: number };

describe('agent_spawn enforces swarm.maxAgents', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-swarm-cap-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  async function initSwarm(maxAgents: number): Promise<string> {
    const init = await swarmTool('swarm_init').handler({ maxAgents }) as { swarmId: string };
    return init.swarmId;
  }

  it('[discriminating] refuses the (N+1)th agent once a swarm is at maxAgents', async () => {
    const swarmId = await initSwarm(2);

    const first = await agentTool('agent_spawn').handler({ agentType: 'coder', swarmId }) as SpawnResult;
    const second = await agentTool('agent_spawn').handler({ agentType: 'tester', swarmId }) as SpawnResult;
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const third = await agentTool('agent_spawn').handler({ agentType: 'reviewer', swarmId }) as SpawnResult;
    expect(third.success).toBe(false);
    expect(third.error).toMatch(/is full/);
    expect(third.error).toContain(`maxAgents=2`);
    expect(third.error).toContain(swarmId);

    const status = await swarmTool('swarm_status').handler({ swarmId }) as StatusResult;
    expect(status.agentCount).toBe(2);
  });

  it('[discriminating] does not register the refused agent in the global agent store either', async () => {
    const swarmId = await initSwarm(1);
    await agentTool('agent_spawn').handler({ agentType: 'coder', swarmId }) as SpawnResult;

    const refused = await agentTool('agent_spawn').handler({ agentType: 'tester', swarmId }) as SpawnResult;
    expect(refused.success).toBe(false);

    const list = await agentTool('agent_list').handler({}) as { agents: Array<{ agentType: string }> };
    expect(list.agents).toHaveLength(1);
    expect(list.agents[0].agentType).toBe('coder');
  });

  it('[control] a retried spawn with the same agentId stays idempotent even at capacity', async () => {
    const swarmId = await initSwarm(1);
    const agentId = 'agent-fixed-retry-id';

    const first = await agentTool('agent_spawn').handler({ agentType: 'coder', agentId, swarmId }) as SpawnResult;
    expect(first.success).toBe(true);

    // Same agentId again (e.g. a client retry after a dropped response) —
    // must stay a no-op success, not be refused as "full".
    const retry = await agentTool('agent_spawn').handler({ agentType: 'coder', agentId, swarmId }) as SpawnResult;
    expect(retry.success).toBe(true);

    const status = await swarmTool('swarm_status').handler({ swarmId }) as StatusResult;
    expect(status.agentCount).toBe(1);
  });

  it('[control] spawning under capacity is unaffected', async () => {
    const swarmId = await initSwarm(5);
    const spawned = await agentTool('agent_spawn').handler({ agentType: 'coder', swarmId }) as SpawnResult;
    expect(spawned.success).toBe(true);

    const status = await swarmTool('swarm_status').handler({ swarmId }) as StatusResult;
    expect(status.agentCount).toBe(1);
  });

  it('[control] spawning with no swarms at all still registers the agent globally', async () => {
    const spawned = await agentTool('agent_spawn').handler({ agentType: 'coder' }) as SpawnResult;
    expect(spawned.success).toBe(true);

    const list = await agentTool('agent_list').handler({}) as { agents: Array<{ agentType: string }> };
    expect(list.agents).toHaveLength(1);
  });

  it('[discriminating] an unrelated swarm at capacity does not block a spawn explicitly targeting a different, non-full swarm', async () => {
    const fullSwarmId = await initSwarm(1);
    await agentTool('agent_spawn').handler({ agentType: 'coder', swarmId: fullSwarmId }) as SpawnResult;

    const otherSwarmId = await initSwarm(5);
    const spawned = await agentTool('agent_spawn').handler({ agentType: 'coder', swarmId: otherSwarmId }) as SpawnResult;
    expect(spawned.success).toBe(true);

    const fullStatus = await swarmTool('swarm_status').handler({ swarmId: fullSwarmId }) as StatusResult;
    const otherStatus = await swarmTool('swarm_status').handler({ swarmId: otherSwarmId }) as StatusResult;
    expect(fullStatus.agentCount).toBe(1);
    expect(otherStatus.agentCount).toBe(1);
  });
});
