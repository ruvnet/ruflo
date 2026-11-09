// #4876: memory_search_unified (a) reported a timestamp as `searchTime`,
// (b) swallowed per-namespace errors so success:true did not prove coverage,
// and (c) searched namespaces one after another. It now reports elapsed ms,
// returns namespaceErrors with counts, and searches up to 4 namespaces at a
// time while keeping the merged ranking identical to the sequential order.

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
  success: boolean;
  results: Array<{ key: string; namespace: string; score: number }>;
  total: number;
  searchTime: string;
  namespacesSearched: number;
  namespacesFailed: number;
  namespaceErrors: Array<{ namespace: string; error: string }>;
}

type Hit = { key: string; content: string; score: number };

// Fixed fixture with ties across namespaces, so ordering depends on the merge
// order and not only on the scores.
const FIXTURE: Record<string, Hit[]> = {
  ns1: [{ key: 'a', content: 'a', score: 0.9 }, { key: 'tie', content: 't1', score: 0.5 }],
  ns2: [{ key: 'b', content: 'b', score: 0.7 }, { key: 'tie', content: 't2', score: 0.5 }],
  ns3: [{ key: 'c', content: 'c', score: 0.9 }],
  ns4: [{ key: 'tie', content: 't4', score: 0.5 }, { key: 'd', content: 'd', score: 0.1 }],
  ns5: [{ key: 'e', content: 'e', score: 0.7 }],
  ns6: [{ key: 'tie', content: 't6', score: 0.5 }],
};
const NAMESPACES = Object.keys(FIXTURE);

/** The pre-#4876 sequential algorithm, kept as the ordering baseline. */
function sequentialBaseline(namespaces: string[], limit: number) {
  const all: Array<{ key: string; namespace: string; score: number }> = [];
  for (const ns of namespaces) {
    for (const e of FIXTURE[ns] ?? []) all.push({ key: e.key, namespace: ns, score: e.score });
  }
  all.sort((x, y) => y.score - x.score);
  return all.slice(0, limit);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('memory_search_unified namespace fan-out (#4876)', () => {
  let inFlight = 0;
  let maxInFlight = 0;

  beforeEach(() => {
    inFlight = 0;
    maxInFlight = 0;
    searchEntries.mockReset();
    // Later namespaces finish first, so completion order differs from
    // namespace order; the result must still match the sequential baseline.
    searchEntries.mockImplementation(async ({ namespace }: { namespace: string }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const delay = NAMESPACES.length - NAMESPACES.indexOf(namespace);
      for (let i = 0; i < delay; i++) await tick();
      inFlight--;
      if (namespace === 'ns3') throw new Error('namespace backend exploded');
      if (namespace === 'ns5') return { success: false, results: [], searchTime: 0, error: 'Database not found' };
      return {
        success: true,
        results: (FIXTURE[namespace] ?? []).map((e) => ({ ...e, id: e.key, namespace })),
        searchTime: 0,
      };
    });
  });

  it('reports failed namespaces and still returns results from the others', async () => {
    const r = await tool.handler({ query: 'q', namespaces: NAMESPACES, limit: 20 }) as UnifiedResult;

    expect(r.success).toBe(true);
    expect(r.namespacesSearched).toBe(6);
    expect(r.namespacesFailed).toBe(2);
    expect(r.namespaceErrors).toEqual([
      { namespace: 'ns3', error: 'namespace backend exploded' },
      { namespace: 'ns5', error: 'Database not found' },
    ]);
    const namespacesWithResults = new Set(r.results.map((e) => e.namespace));
    expect(namespacesWithResults).toEqual(new Set(['ns1', 'ns2', 'ns4', 'ns6']));
  });

  it('reports elapsed time in ms, not a timestamp', async () => {
    const r = await tool.handler({ query: 'q', namespaces: NAMESPACES }) as UnifiedResult;
    expect(r.searchTime).toMatch(/^\d+\.\d{2}ms$/);
    expect(parseFloat(r.searchTime)).toBeLessThan(60_000);
  });

  it('keeps the sequential ranking and ordering on a fixed fixture', async () => {
    const r = await tool.handler({ query: 'q', namespaces: NAMESPACES, limit: 20 }) as UnifiedResult;
    const ok = NAMESPACES.filter((ns) => ns !== 'ns3' && ns !== 'ns5');
    expect(r.results.map((e) => [e.namespace, e.key, e.score]))
      .toEqual(sequentialBaseline(ok, 20).map((e) => [e.namespace, e.key, e.score]));

    const top3 = await tool.handler({ query: 'q', namespaces: NAMESPACES, limit: 3 }) as UnifiedResult;
    expect(top3.results.map((e) => [e.namespace, e.key]))
      .toEqual(sequentialBaseline(ok, 3).map((e) => [e.namespace, e.key]));
  });

  it('runs namespaces concurrently, at most 4 at a time', async () => {
    await tool.handler({ query: 'q', namespaces: NAMESPACES });
    expect(searchEntries).toHaveBeenCalledTimes(6);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it('fails only when every namespace failed', async () => {
    searchEntries.mockImplementation(async () => { throw new Error('store offline'); });
    const r = await tool.handler({ query: 'q', namespaces: ['x', 'y'] }) as UnifiedResult;
    expect(r.success).toBe(false);
    expect(r.namespacesFailed).toBe(2);
    expect(r.namespaceErrors.map((e) => e.namespace)).toEqual(['x', 'y']);
    expect(r.results).toEqual([]);
  });
});
