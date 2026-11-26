/**
 * coordination_load_balance distribute with the weighted algorithm treated a
 * configured weight of zero as the default weight of one, so drained nodes
 * could still receive tasks.
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

beforeEach(() => {
  process.env.CLAUDE_FLOW_CWD = mkdtempSync(join(tmpdir(), 'ruflo-weighted-zero-'));
});
afterEach(() => {
  if (originalProjectCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalProjectCwd;
});

describe('coordination_load_balance weighted zero weights', () => {
  it.each([
    { weights: { 'node-a': 0, 'node-b': 0.5 }, expected: 'node-b' },
    { weights: { 'node-a': 0 }, expected: 'node-b' },
  ])('assigns the task to $expected with weights $weights', async ({ weights, expected }) => {
    for (const nodeId of ['node-a', 'node-b']) {
      await tool('coordination_node', { action: 'add', nodeId });
    }
    await tool('coordination_load_balance', { action: 'set', algorithm: 'weighted', weights });

    const result = await tool('coordination_load_balance', { action: 'distribute', task: 'task-0' });
    expect(result.success).toBe(true);
    expect(result.assignedTo).toBe(expected);
  });
});
