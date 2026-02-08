import { describe, it, expect, vi } from 'vitest';
import { MemoryGraph } from './memory-graph.js';
import { LearningBridge } from './learning-bridge.js';
import { AutoMemoryBridge } from './auto-memory-bridge.js';
import { resolveAgentMemoryDir, transferKnowledge } from './agent-memory-scope.js';
import { createDefaultEntry, type IMemoryBackend, type MemoryEntry } from './types.js';

function createMockBackend(entries: MemoryEntry[] = []): IMemoryBackend {
  const stored = new Map<string, MemoryEntry>();
  entries.forEach(e => stored.set(e.id, e));
  return {
    initialize: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    store: vi.fn(async (e: MemoryEntry) => { stored.set(e.id, e); }),
    get: vi.fn(async (id: string) => stored.get(id) ?? null),
    getByKey: vi.fn(async () => null),
    update: vi.fn(async (id: string, u: any) => { const e = stored.get(id); if (e) { Object.assign(e.metadata, u.metadata || {}); return e; } return null; }),
    delete: vi.fn(async (id: string) => stored.delete(id)),
    query: vi.fn(async () => [...stored.values()]),
    search: vi.fn(async () => []),
    bulkInsert: vi.fn(async (es: MemoryEntry[]) => es.forEach(e => stored.set(e.id, e))),
    bulkDelete: vi.fn(async (ids: string[]) => { ids.forEach(id => stored.delete(id)); return ids.length; }),
    count: vi.fn(async () => stored.size),
    listNamespaces: vi.fn(async () => ['default']),
    clearNamespace: vi.fn(async () => 0),
    getStats: vi.fn(async () => ({ totalEntries: stored.size, entriesByNamespace: {}, entriesByType: {}, memoryUsage: 0, avgQueryTime: 0, avgSearchTime: 0 })),
    healthCheck: vi.fn(async () => ({ status: 'healthy' as const, components: { storage: { status: 'healthy' as const, latency: 0 }, index: { status: 'healthy' as const, latency: 0 }, cache: { status: 'healthy' as const, latency: 0 } }, timestamp: Date.now(), issues: [], recommendations: [] })),
  };
}

function makeEntry(id: string, refs: string[] = []): MemoryEntry {
  return { ...createDefaultEntry({ key: id, content: `Content for ${id}`, references: refs, metadata: { confidence: 0.7 + Math.random() * 0.3 } }), id };
}

function createMockNeural() {
  let trajId = 0;
  return {
    initialize: async () => {},
    beginTask: () => `traj-${++trajId}`,
    recordStep: () => {},
    completeTask: async () => {},
    findPatterns: async () => [],
    retrieveMemories: async () => [],
    triggerLearning: async () => {},
    getStats: () => ({}),
    cleanup: async () => {},
    getSONAManager: () => ({ getMode: () => 'balanced' }),
    getReasoningBank: () => ({ consolidate: async () => ({}) }),
    getPatternLearner: () => ({}),
  };
}

describe('ADR-049 Performance Benchmarks', () => {
  const targets: Array<{name: string; actual: number; target: number; unit: string}> = [];

  function buildGraphEntries(n: number): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    for (let i = 0; i < n; i++) {
      const refs: string[] = [];
      for (let j = 0; j < 3; j++) {
        const r = Math.floor(Math.random() * n);
        if (r !== i) refs.push(`entry-${r}`);
      }
      entries.push(makeEntry(`entry-${i}`, refs));
    }
    return entries;
  }

  function buildGraph(entries: MemoryEntry[], maxNodes: number): MemoryGraph {
    const g = new MemoryGraph({ maxNodes });
    for (const e of entries) g.addNode(e);
    for (const e of entries) {
      for (const r of e.references) g.addEdge(e.id, r, 'reference');
    }
    return g;
  }

  it('MemoryGraph: build 100 nodes', () => {
    const entries = buildGraphEntries(100);
    const t0 = performance.now();
    buildGraph(entries, 200);
    const dt = performance.now() - t0;
    console.log(`  Graph build (100):  ${dt.toFixed(2)}ms`);
    expect(dt).toBeLessThan(50);
  });

  it('MemoryGraph: build 1000 nodes', () => {
    const entries = buildGraphEntries(1000);
    const t0 = performance.now();
    buildGraph(entries, 1100);
    const dt = performance.now() - t0;
    console.log(`  Graph build (1k):   ${dt.toFixed(2)}ms  [target: <200ms]`);
    targets.push({ name: 'Graph build (1k nodes)', actual: dt, target: 200, unit: 'ms' });
    expect(dt).toBeLessThan(200);
  });

  it('MemoryGraph: build 2000 nodes', () => {
    const entries = buildGraphEntries(2000);
    const t0 = performance.now();
    buildGraph(entries, 2100);
    const dt = performance.now() - t0;
    console.log(`  Graph build (2k):   ${dt.toFixed(2)}ms`);
    expect(dt).toBeLessThan(500);
  });

  it('MemoryGraph: PageRank 1000 nodes', () => {
    const entries = buildGraphEntries(1000);
    const g = buildGraph(entries, 1100);
    const t0 = performance.now();
    g.computePageRank();
    const dt = performance.now() - t0;
    console.log(`  PageRank (1k):      ${dt.toFixed(2)}ms  [target: <100ms]`);
    targets.push({ name: 'PageRank (1k nodes)', actual: dt, target: 100, unit: 'ms' });
    expect(dt).toBeLessThan(100);
  });

  it('MemoryGraph: PageRank 2000 nodes', () => {
    const entries = buildGraphEntries(2000);
    const g = buildGraph(entries, 2100);
    const t0 = performance.now();
    g.computePageRank();
    const dt = performance.now() - t0;
    console.log(`  PageRank (2k):      ${dt.toFixed(2)}ms`);
    expect(dt).toBeLessThan(300);
  });

  it('MemoryGraph: community detection 1000 nodes', () => {
    const entries = buildGraphEntries(1000);
    const g = buildGraph(entries, 1100);
    g.computePageRank();
    const t0 = performance.now();
    g.detectCommunities();
    const dt = performance.now() - t0;
    const stats = g.getStats();
    console.log(`  Communities (1k):   ${dt.toFixed(2)}ms  (${stats.communityCount} found)`);
    expect(dt).toBeLessThan(200);
  });

  it('MemoryGraph: rankWithGraph 10 results', () => {
    const entries = buildGraphEntries(1000);
    const g = buildGraph(entries, 1100);
    g.computePageRank();
    const fakeResults = entries.slice(0, 10).map(e => ({ entry: e, score: Math.random(), distance: Math.random() }));
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) g.rankWithGraph(fakeResults);
    const dt = (performance.now() - t0) / 100;
    console.log(`  rankWithGraph(10):  ${dt.toFixed(3)}ms  (avg of 100 runs)`);
    expect(dt).toBeLessThan(1);
  });

  it('MemoryGraph: getTopNodes(20)', () => {
    const entries = buildGraphEntries(1000);
    const g = buildGraph(entries, 1100);
    g.computePageRank();
    g.detectCommunities();
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) g.getTopNodes(20);
    const dt = (performance.now() - t0) / 100;
    console.log(`  getTopNodes(20):    ${dt.toFixed(3)}ms  (avg of 100 runs)`);
    expect(dt).toBeLessThan(5);
  });

  it('MemoryGraph: getNeighbors depth=2', () => {
    const entries = buildGraphEntries(1000);
    const g = buildGraph(entries, 1100);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) g.getNeighbors(entries[i % entries.length].id, 2);
    const dt = (performance.now() - t0) / 100;
    console.log(`  getNeighbors(d=2):  ${dt.toFixed(3)}ms  (avg of 100 runs)`);
    expect(dt).toBeLessThan(5);
  });

  it('LearningBridge: record 1000 insights', async () => {
    const mockNeural = createMockNeural();
    const backend = createMockBackend();
    const lb = new LearningBridge(backend, { neuralLoader: async () => mockNeural, consolidationThreshold: 99999 });
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      await lb.onInsightRecorded({ category: 'debugging', summary: `Insight ${i}`, source: 'bench', confidence: 0.8 }, `entry-${i}`);
    }
    const dt = performance.now() - t0;
    const per = dt / 1000;
    console.log(`  Record 1000:        ${dt.toFixed(2)}ms  (${per.toFixed(3)}ms/each)  [target: <5ms/each]`);
    targets.push({ name: 'Insight recording', actual: per, target: 5, unit: 'ms/each' });
    expect(per).toBeLessThan(5);
    lb.destroy();
  });

  it('LearningBridge: access 1000 insights', async () => {
    const mockNeural = createMockNeural();
    const entries: MemoryEntry[] = [];
    for (let i = 0; i < 1000; i++) { const e = makeEntry(`entry-${i}`); e.metadata.confidence = 0.5; entries.push(e); }
    const backend = createMockBackend(entries);
    const lb = new LearningBridge(backend, { neuralLoader: async () => mockNeural, consolidationThreshold: 99999 });
    // warm up trajectories
    for (let i = 0; i < 1000; i++) {
      await lb.onInsightRecorded({ category: 'debugging', summary: `I-${i}`, source: 'bench', confidence: 0.8 }, `entry-${i}`);
    }
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) await lb.onInsightAccessed(`entry-${i}`);
    const dt = performance.now() - t0;
    console.log(`  Access 1000:        ${dt.toFixed(2)}ms  (${(dt/1000).toFixed(3)}ms/each)`);
    expect(dt / 1000).toBeLessThan(5);
    lb.destroy();
  });

  it('LearningBridge: consolidation', async () => {
    const mockNeural = createMockNeural();
    const backend = createMockBackend();
    const lb = new LearningBridge(backend, { neuralLoader: async () => mockNeural, consolidationThreshold: 1 });
    for (let i = 0; i < 100; i++) {
      await lb.onInsightRecorded({ category: 'debugging', summary: `I-${i}`, source: 'bench', confidence: 0.8 }, `entry-${i}`);
    }
    const t0 = performance.now();
    const result = await lb.consolidate();
    const dt = performance.now() - t0;
    console.log(`  Consolidation:      ${dt.toFixed(2)}ms  (${result.trajectoriesCompleted} trajectories)  [target: <500ms]`);
    targets.push({ name: 'Consolidation', actual: dt, target: 500, unit: 'ms' });
    expect(dt).toBeLessThan(500);
    lb.destroy();
  });

  it('LearningBridge: decay 1000 entries', async () => {
    const mockNeural = createMockNeural();
    const entries: MemoryEntry[] = [];
    for (let i = 0; i < 1000; i++) { const e = makeEntry(`decay-${i}`); e.metadata.confidence = 0.9; e.lastAccessedAt = Date.now() - 7200000; entries.push(e); }
    const backend = createMockBackend(entries);
    const lb = new LearningBridge(backend, { neuralLoader: async () => mockNeural });
    const t0 = performance.now();
    const decayed = await lb.decayConfidences('default');
    const dt = performance.now() - t0;
    console.log(`  Decay 1k entries:   ${dt.toFixed(2)}ms  (${decayed} decayed)  [target: <50ms]`);
    targets.push({ name: 'Confidence decay (1k)', actual: dt, target: 50, unit: 'ms' });
    expect(dt).toBeLessThan(50);
    lb.destroy();
  });

  it('AgentMemoryScope: resolve 10k paths', () => {
    const scopes: Array<'project' | 'local' | 'user'> = ['project', 'local', 'user'];
    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) resolveAgentMemoryDir(`agent-${i % 100}`, scopes[i % 3]);
    const dt = performance.now() - t0;
    console.log(`  Resolve 10k paths:  ${dt.toFixed(2)}ms  (${(dt/10).toFixed(1)}us/each)`);
    expect(dt).toBeLessThan(200); // Not an ADR-049 target; relaxed for CI variance
  });

  it('AgentMemoryScope: transfer knowledge', async () => {
    const sourceEntries: MemoryEntry[] = [];
    for (let i = 0; i < 50; i++) {
      const e = makeEntry(`src-${i}`, [], );
      e.tags = ['debugging'];
      e.metadata.confidence = 0.5 + Math.random() * 0.5;
      e.namespace = 'learnings';
      sourceEntries.push(e);
    }
    const sourceBackend = createMockBackend(sourceEntries);
    const targetBackend = createMockBackend();
    const targetBridge = new AutoMemoryBridge(targetBackend, { memoryDir: '/tmp/bench-target' });
    const t0 = performance.now();
    const result = await transferKnowledge(sourceBackend, targetBridge, { sourceNamespace: 'learnings', minConfidence: 0.8, maxEntries: 20 });
    const dt = performance.now() - t0;
    console.log(`  Transfer knowledge: ${dt.toFixed(2)}ms  (${result.transferred} transferred)  [target: <100ms]`);
    targets.push({ name: 'Knowledge transfer', actual: dt, target: 100, unit: 'ms' });
    expect(dt).toBeLessThan(100);
  });

  it('SUMMARY: all targets met', () => {
    console.log('\n=== ADR-049 Performance Summary ===\n');
    for (const t of targets) {
      const pass = t.actual <= t.target;
      const ratio = (t.target / t.actual).toFixed(1);
      console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${t.name.padEnd(28)} ${t.actual.toFixed(2).padStart(8)} ${t.unit.padEnd(8)}  target: <${t.target}${t.unit}  (${ratio}x headroom)`);
    }
    console.log('');
    const allPass = targets.every(t => t.actual <= t.target);
    expect(allPass).toBe(true);
  });
});
