/**
 * daa_knowledge_share keyed entries by `knowledge-${Date.now()}`, so a second
 * share in the same millisecond overwrote the first in store.knowledge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/memory/memory-bridge.js', () => ({
  bridgeStoreEntry: vi.fn(async () => { throw new Error('AgentDB not available'); }),
}));

const originalProjectCwd = process.env.CLAUDE_FLOW_CWD;

beforeEach(() => {
  process.env.CLAUDE_FLOW_CWD = mkdtempSync(join(tmpdir(), 'ruflo-daa-knowledge-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  if (originalProjectCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalProjectCwd;
});

describe('daa_knowledge_share ids', () => {
  it('keeps both entries when two shares happen in the same millisecond', async () => {
    const { daaTools } = await import('../src/mcp-tools/daa-tools.js');
    const get = (name: string) => daaTools.find((t) => t.name === name)!;
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    const a = await get('daa_knowledge_share').handler({ sourceAgentId: 'a', targetAgentIds: ['b'], knowledgeDomain: 'one' }) as Record<string, any>;
    const b = await get('daa_knowledge_share').handler({ sourceAgentId: 'a', targetAgentIds: ['b'], knowledgeDomain: 'two' }) as Record<string, any>;

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect(a.knowledgeId).not.toBe(b.knowledgeId);
    const status = await get('daa_performance_metrics').handler({ category: 'learning' }) as Record<string, any>;
    expect(status.metrics.knowledgeItems).toBe(2);
  });
});
