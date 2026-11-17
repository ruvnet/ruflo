/**
 * #4622: memory_list turned a listing that could not read the database into a
 * successful, empty inventory. A failed query must say so.
 */
import { describe, it, expect, vi } from 'vitest';

const listing = vi.hoisted(() => ({
  result: { success: true, entries: [], total: 0 } as Record<string, unknown>,
}));

vi.mock('../src/memory/memory-initializer.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listEntries: vi.fn(async () => listing.result),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true, version: '3.0.0' })),
  initializeMemoryDatabase: vi.fn(async () => ({ success: true })),
  getHNSWStatus: vi.fn(() => ({ algorithm: 'none' })),
}));

import { memoryTools } from '../src/mcp-tools/memory-tools.js';

const memoryList = memoryTools.find((t) => t.name === 'memory_list')!;

describe('memory_list on a failed query (#4622)', () => {
  it('reports the failure instead of an empty inventory', async () => {
    listing.result = { success: false, entries: [], total: 0, error: 'refusing an unsafe sql.js whole-image read' };
    const out = (await memoryList.handler({})) as Record<string, unknown>;
    expect(out.success).toBe(false);
    expect(out.error).toBe('refusing an unsafe sql.js whole-image read');
    expect(out.entries).toEqual([]);
  });

  it('still lists a working store', async () => {
    listing.result = {
      success: true,
      total: 1,
      entries: [{ key: 'k', namespace: 'default', createdAt: 1, updatedAt: 1, accessCount: 0, hasEmbedding: false, size: 1 }],
    };
    const out = (await memoryList.handler({})) as Record<string, unknown>;
    expect(out.success).toBeUndefined();
    expect(out.total).toBe(1);
    expect((out.entries as unknown[]).length).toBe(1);
  });
});
