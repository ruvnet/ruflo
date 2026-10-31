/**
 * coordination_load_balance distribute with the round-robin algorithm always
 * picked the first active node ("just pick first active"), so every task went
 * to the same node. It now moves on to the next active node on each call and
 * wraps around.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalProjectCwd = process.env.CLAUDE_FLOW_CWD;

async function tool(name: string, input: Record<string, unknown>) {
  const { coordinationTools } = await import('../src/mcp-tools/coordination-tools.js');
  return coordinationTools.find((t) => t.name === name)!.handler(input) as Promise<Record<string, any>>;
}

async function distribute(times: number): Promise<string[]> {
  const assigned: string[] = [];
  for (let i = 0; i < times; i++) {
    const r = await tool('coordination_load_balance', { action: 'distribute', task: `task-${i}` });
    expect(r.success).toBe(true);
    assigned.push(r.assignedTo);
  }
  return assigned;
}

beforeEach(() => {
  process.env.CLAUDE_FLOW_CWD = mkdtempSync(join(tmpdir(), 'ruflo-rr-'));
});
afterEach(() => {
  if (originalProjectCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalProjectCwd;
});

describe('coordination_load_balance round-robin', () => {
  it('cycles through the active nodes instead of always picking the first', async () => {
    for (const nodeId of ['node-a', 'node-b', 'node-c']) {
      await tool('coordination_node', { action: 'add', nodeId });
    }
    await tool('coordination_load_balance', { action: 'set', algorithm: 'round-robin' });

    // Baseline: ['node-a', 'node-a', 'node-a', 'node-a', 'node-a'].
    expect(await distribute(5)).toEqual(['node-a', 'node-b', 'node-c', 'node-a', 'node-b']);
  });

  it('carries on with the remaining nodes when the last one assigned is removed', async () => {
    for (const nodeId of ['node-a', 'node-b', 'node-c']) {
      await tool('coordination_node', { action: 'add', nodeId });
    }
    await tool('coordination_load_balance', { action: 'set', algorithm: 'round-robin' });
    expect(await distribute(2)).toEqual(['node-a', 'node-b']);

    await tool('coordination_node', { action: 'remove', nodeId: 'node-b' });
    expect(await distribute(3)).toEqual(['node-a', 'node-c', 'node-a']);
  });

  it('leaves least-connections picking the least loaded node', async () => {
    for (const nodeId of ['node-a', 'node-b']) {
      await tool('coordination_node', { action: 'add', nodeId });
    }
    await tool('coordination_load_balance', { action: 'set', algorithm: 'least-connections' });
    expect(await distribute(4)).toEqual(['node-a', 'node-b', 'node-a', 'node-b']);
  });
});
