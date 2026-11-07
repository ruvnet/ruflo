// memory_search_unified fans out one search per namespace and merges the
// results. Entries are identified by (namespace, key) (see #2271), so two
// entries that share a key in different namespaces must both survive the
// merge instead of the lower-scored one being dropped as a duplicate.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false), mkdirSync: vi.fn(), readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(() => '{}'), statSync: vi.fn(), unlinkSync: vi.fn(), writeFileSync: vi.fn(),
}));

const { searchEntries } = vi.hoisted(() => ({ searchEntries: vi.fn() }));
vi.mock('../src/memory/memory-initializer.js', () => ({
  searchEntries,
  storeEntry: vi.fn(), listEntries: vi.fn(), getEntry: vi.fn(), deleteEntry: vi.fn(),
  initializeMemoryDatabase: vi.fn(),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true })),
}));

import { memoryTools } from '../src/mcp-tools/memory-tools.js';

const tool = memoryTools.find((t) => t.name === 'memory_search_unified')!;

interface UnifiedResult {
  results: Array<{ key: string; namespace: string; score: number }>;
  total: number;
}

describe('memory_search_unified merge', () => {
  beforeEach(() => {
    searchEntries.mockReset();
    searchEntries.mockImplementation(async ({ namespace }: { namespace: string }) => ({
      success: true,
      results: namespace === 'project-a'
        ? [{ key: 'config', content: 'a config', score: 0.9, namespace }]
        : [{ key: 'config', content: 'b config', score: 0.7, namespace }],
    }));
  });

  it('keeps entries that share a key in different namespaces', async () => {
    const r = await tool.handler({
      query: 'config',
      namespaces: ['project-a', 'project-b'],
    }) as UnifiedResult;

    expect(r.results.map((e) => [e.namespace, e.key])).toEqual([
      ['project-a', 'config'],
      ['project-b', 'config'],
    ]);
    expect(r.total).toBe(2);
  });

  it('still returns a key once when it appears once per namespace', async () => {
    const r = await tool.handler({ query: 'config', namespace: 'project-a' }) as UnifiedResult;
    expect(r.results.map((e) => [e.namespace, e.key])).toEqual([['project-a', 'config']]);
  });

  it('reports namespace failures and elapsed search time instead of a false complete', async () => {
    searchEntries.mockImplementation(async ({ namespace }: { namespace: string }) => {
      if (namespace === 'throws') throw new Error('namespace offline');
      if (namespace === 'denied') return { success: false, error: 'access denied', results: [] };
      return {
        success: true,
        results: [{ key: 'config', content: 'ok config', score: 0.9, namespace }],
      };
    });

    const r = await tool.handler({
      query: 'config',
      namespaces: ['good', 'throws', 'denied'],
    }) as UnifiedResult & {
      complete: boolean;
      namespaceErrors: Array<{ namespace: string; error: string }>;
      searchTime: number;
    };

    expect(r.results.map((e) => e.key)).toEqual(['config']);
    expect(r.complete).toBe(false);
    expect(r.namespaceErrors).toEqual([
      { namespace: 'throws', error: 'namespace offline' },
      { namespace: 'denied', error: 'access denied' },
    ]);
    expect(typeof r.searchTime).toBe('number');
    expect(r.searchTime).toBeLessThan(10_000);
  });
});
