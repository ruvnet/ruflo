/**
 * #4731: coordination_node heartbeat for an unknown nodeId returned
 * { success: true } and left the node list empty. It now refuses with
 * "Node not found" and does not create the node.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalProjectCwd = process.env.CLAUDE_FLOW_CWD;
let scratch: string;

async function nodeTool(input: Record<string, unknown>) {
  const { coordinationTools } = await import('../src/mcp-tools/coordination-tools.js');
  return coordinationTools.find((t) => t.name === 'coordination_node')!.handler(input) as Promise<Record<string, any>>;
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'ruflo-4731-'));
  process.env.CLAUDE_FLOW_CWD = scratch;
});
afterEach(() => {
  if (originalProjectCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalProjectCwd;
});

describe('coordination_node heartbeat (#4731)', () => {
  it('errors for an unknown node and leaves the node list empty', async () => {
    const r = await nodeTool({ action: 'heartbeat', nodeId: 'ghost-node' });
    // Baseline: { success: true, action: 'heartbeat', nodeId: 'ghost-node' }.
    expect(r.success).toBe(false);
    expect(r.error).toBe('Node not found');

    const listed = await nodeTool({ action: 'list' });
    expect(listed.success).toBe(true);
    expect(listed.nodes).toEqual([]);
    expect(listed.total).toBe(0);

    const storePath = join(scratch, '.claude-flow', 'coordination', 'store.json');
    if (existsSync(storePath)) {
      expect(JSON.parse(readFileSync(storePath, 'utf8')).nodes).toEqual({});
    }
  });

  it('refreshes lastHeartbeat for a registered node', async () => {
    await nodeTool({ action: 'add', nodeId: 'node-a' });
    const before = await nodeTool({ action: 'list' });
    const previous = before.nodes[0].lastHeartbeat as string;

    const r = await nodeTool({ action: 'heartbeat', nodeId: 'node-a' });
    expect(r).toMatchObject({ success: true, action: 'heartbeat', nodeId: 'node-a' });
    expect(typeof r.timestamp).toBe('string');

    const after = await nodeTool({ action: 'list' });
    expect(after.total).toBe(1);
    expect(after.nodes[0]).toMatchObject({ id: 'node-a', status: 'active' });
    expect(after.nodes[0].lastHeartbeat >= previous).toBe(true);
  });
});
