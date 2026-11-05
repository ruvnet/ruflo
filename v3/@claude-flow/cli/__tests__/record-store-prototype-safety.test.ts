/**
 * Agent, swarm and coordination-node records are looked up by ids that come
 * from MCP tool input. A reserved or inherited name (`__proto__`,
 * `constructor`, `toString`) must never resolve to a shared built-in that a
 * handler then writes into.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentTools } from '../src/mcp-tools/agent-tools.js';
import { swarmTools } from '../src/mcp-tools/swarm-tools.js';
import { coordinationTools } from '../src/mcp-tools/coordination-tools.js';

type Tools = { name: string; handler: (i: Record<string, unknown>) => unknown }[];
const call = (tools: Tools, name: string, input: Record<string, unknown>) =>
  tools.find(t => t.name === name)!.handler(input) as Promise<Record<string, any>>;
const RESERVED = ['__proto__', 'constructor', 'toString'];
const PROBES = ['agents', 'status', 'health', 'taskCount', 'config', 'lastHeartbeat'];

function assertClean(): void {
  for (const k of PROBES) {
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, k)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype.toString, k)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(Object, k)).toBe(false);
  }
}

describe('record stores never resolve reserved ids to built-ins', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-record-proto-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
  });

  afterEach(() => {
    for (const k of PROBES) {
      delete (Object.prototype as any)[k];
      delete (Object.prototype.toString as any)[k];
      delete (Object as any)[k];
    }
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(RESERVED)('agent_spawn with swarmId %s does not write into a built-in', async (swarmId) => {
    await call(swarmTools as Tools, 'swarm_init', { maxAgents: 4 });
    await call(agentTools as Tools, 'agent_spawn', { agentType: 'coder', agentId: 'a1', swarmId });
    assertClean();
  });

  it.each(RESERVED)('agent_update / agent_terminate on agentId %s find nothing and write nothing', async (agentId) => {
    const upd = await call(agentTools as Tools, 'agent_update', {
      agentId, status: 'busy', health: 0.1, taskCount: 9, config: { injected: true },
    });
    expect(upd.success).not.toBe(true);
    const term = await call(agentTools as Tools, 'agent_terminate', { agentId });
    expect(term.success).not.toBe(true);
    assertClean();
    expect(({} as any).config).toBeUndefined();
  });

  it.each(RESERVED)('coordination_node heartbeat on nodeId %s writes nothing', async (nodeId) => {
    await call(coordinationTools as Tools, 'coordination_node', { action: 'add', nodeId: 'n1' });
    await call(coordinationTools as Tools, 'coordination_node', { action: 'heartbeat', nodeId });
    assertClean();
  });

  it('ordinary ids still work end to end', async () => {
    const swarmId = (await call(swarmTools as Tools, 'swarm_init', { maxAgents: 4 })).swarmId;
    expect((await call(agentTools as Tools, 'agent_spawn', { agentType: 'coder', agentId: 'a1', swarmId })).success).toBe(true);
    expect((await call(agentTools as Tools, 'agent_update', { agentId: 'a1', status: 'busy' })).success).toBe(true);
    expect((await call(swarmTools as Tools, 'swarm_status', { swarmId })).agentCount).toBe(1);
    expect((await call(agentTools as Tools, 'agent_terminate', { agentId: 'a1' })).success).toBe(true);
    await call(coordinationTools as Tools, 'coordination_node', { action: 'add', nodeId: 'n1' });
    const hb = await call(coordinationTools as Tools, 'coordination_node', { action: 'heartbeat', nodeId: 'n1' });
    expect(hb.success).toBe(true);
    const list = await call(coordinationTools as Tools, 'coordination_node', { action: 'list' });
    expect(list.nodes.map((n: { id: string }) => n.id)).toContain('n1');
  });
});
