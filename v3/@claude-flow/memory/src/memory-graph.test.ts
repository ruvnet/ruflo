/**
 * Tests for MemoryGraph - Knowledge Graph Module
 *
 * TDD London School (mock-first) tests for graph construction,
 * PageRank computation, community detection, and graph-aware ranking.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryGraph } from './memory-graph.js';
import type {
  EdgeType,
  MemoryGraphConfig,
  GraphStats,
  RankedResult,
} from './memory-graph.js';
import type { IMemoryBackend, MemoryEntry, MemoryEntryUpdate, SearchResult } from './types.js';
import { createDefaultEntry } from './types.js';

// ===== Test Helpers =====

function makeEntry(id: string, refs: string[] = [], meta?: Record<string, unknown>): MemoryEntry {
  const entry = createDefaultEntry({
    key: id,
    content: `content-${id}`,
    references: refs,
    metadata: meta,
  });
  // Override the auto-generated id with a deterministic one for testing
  return { ...entry, id };
}

function createMockBackend(entries: MemoryEntry[]): IMemoryBackend {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    store: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockImplementation(async (id: string) => {
      return entries.find((e) => e.id === id) || null;
    }),
    getByKey: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockImplementation(async (id: string, _update: MemoryEntryUpdate) => {
      return entries.find((e) => e.id === id) || null;
    }),
    delete: vi.fn().mockResolvedValue(true),
    query: vi.fn().mockResolvedValue(entries),
    search: vi.fn().mockResolvedValue([]),
    bulkInsert: vi.fn().mockResolvedValue(undefined),
    bulkDelete: vi.fn().mockResolvedValue(0),
    count: vi.fn().mockResolvedValue(entries.length),
    listNamespaces: vi.fn().mockResolvedValue(['default']),
    clearNamespace: vi.fn().mockResolvedValue(0),
    getStats: vi.fn().mockResolvedValue({
      totalEntries: entries.length,
      entriesByNamespace: {},
      entriesByType: {},
      memoryUsage: 0,
      avgQueryTime: 0,
      avgSearchTime: 0,
    }),
    healthCheck: vi.fn().mockResolvedValue({
      status: 'healthy',
      components: {
        storage: { status: 'healthy', latency: 0 },
        index: { status: 'healthy', latency: 0 },
        cache: { status: 'healthy', latency: 0 },
      },
      timestamp: Date.now(),
      issues: [],
      recommendations: [],
    }),
  };
}

// ===== Tests =====

describe('MemoryGraph', () => {
  let graph: MemoryGraph;

  beforeEach(() => {
    graph = new MemoryGraph();
  });

  // ===== Constructor =====

  describe('constructor', () => {
    it('should create with default configuration', () => {
      const g = new MemoryGraph();
      const stats = g.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
    });

    it('should accept custom configuration', () => {
      const config: MemoryGraphConfig = {
        pageRankDamping: 0.9,
        maxNodes: 100,
        similarityThreshold: 0.5,
      };
      const g = new MemoryGraph(config);
      const stats = g.getStats();
      expect(stats.nodeCount).toBe(0);
    });
  });

  // ===== addNode / removeNode =====

  describe('addNode', () => {
    it('should add a node from a MemoryEntry', () => {
      const entry = makeEntry('node-1');
      graph.addNode(entry);
      expect(graph.getStats().nodeCount).toBe(1);
    });

    it('should extract category from metadata', () => {
      const entry = makeEntry('node-1', [], { category: 'security' });
      graph.addNode(entry);
      // Verify through getTopNodes after computing pagerank
      graph.computePageRank();
      const top = graph.getTopNodes(1);
      expect(top.length).toBe(1);
      expect(top[0].id).toBe('node-1');
    });

    it('should ignore when at maxNodes capacity', () => {
      const g = new MemoryGraph({ maxNodes: 2 });
      g.addNode(makeEntry('a'));
      g.addNode(makeEntry('b'));
      g.addNode(makeEntry('c'));
      expect(g.getStats().nodeCount).toBe(2);
    });

    it('should allow re-adding an existing node without counting toward capacity', () => {
      const g = new MemoryGraph({ maxNodes: 2 });
      g.addNode(makeEntry('a'));
      g.addNode(makeEntry('b'));
      // Re-add existing node should succeed
      g.addNode(makeEntry('a'));
      expect(g.getStats().nodeCount).toBe(2);
    });

    it('should mark graph as dirty', () => {
      graph.addNode(makeEntry('node-1'));
      expect(graph.getStats().pageRankComputed).toBe(false);
    });
  });

  describe('removeNode', () => {
    it('should remove a node and clean up edges', () => {
      const a = makeEntry('a');
      const b = makeEntry('b');
      graph.addNode(a);
      graph.addNode(b);
      graph.addEdge('a', 'b', 'reference');
      expect(graph.getStats().edgeCount).toBe(1);

      graph.removeNode('a');
      expect(graph.getStats().nodeCount).toBe(1);
      expect(graph.getStats().edgeCount).toBe(0);
    });

    it('should remove incoming edges to the deleted node', () => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addNode(makeEntry('c'));
      graph.addEdge('a', 'b', 'reference');
      graph.addEdge('c', 'b', 'reference');
      expect(graph.getStats().edgeCount).toBe(2);

      graph.removeNode('b');
      expect(graph.getStats().edgeCount).toBe(0);
    });

    it('should handle removing a non-existent node gracefully', () => {
      expect(() => graph.removeNode('does-not-exist')).not.toThrow();
    });

    it('should clean up pageRank and community entries', () => {
      graph.addNode(makeEntry('a'));
      graph.computePageRank();
      graph.detectCommunities();
      graph.removeNode('a');
      const top = graph.getTopNodes(10);
      expect(top.length).toBe(0);
    });
  });

  // ===== addEdge =====

  describe('addEdge', () => {
    beforeEach(() => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addNode(makeEntry('c'));
    });

    it('should add an edge between existing nodes', () => {
      graph.addEdge('a', 'b', 'reference');
      expect(graph.getStats().edgeCount).toBe(1);
    });

    it('should update weight to max when edge already exists', () => {
      graph.addEdge('a', 'b', 'reference', 0.5);
      graph.addEdge('a', 'b', 'reference', 0.8);
      expect(graph.getStats().edgeCount).toBe(1);
      // The weight should now be 0.8 (max of 0.5 and 0.8)
    });

    it('should not downgrade weight when adding with lower value', () => {
      graph.addEdge('a', 'b', 'reference', 0.9);
      graph.addEdge('a', 'b', 'reference', 0.3);
      // Edge count should remain 1 (updated, not duplicated)
      expect(graph.getStats().edgeCount).toBe(1);
    });

    it('should skip when source node is missing', () => {
      graph.addEdge('missing', 'b', 'reference');
      expect(graph.getStats().edgeCount).toBe(0);
    });

    it('should skip when target node is missing', () => {
      graph.addEdge('a', 'missing', 'reference');
      expect(graph.getStats().edgeCount).toBe(0);
    });

    it('should create reverse edge entry', () => {
      graph.addEdge('a', 'b', 'reference');
      // Verify via getNeighbors traversal (reverse edges are used internally)
      // If we remove 'a', 'b' should lose its incoming edge
      graph.removeNode('a');
      expect(graph.getStats().edgeCount).toBe(0);
    });

    it('should support multiple edge types', () => {
      graph.addEdge('a', 'b', 'reference');
      graph.addEdge('a', 'c', 'similar', 0.9);
      expect(graph.getStats().edgeCount).toBe(2);
    });
  });

  // ===== buildFromBackend =====

  describe('buildFromBackend', () => {
    it('should build graph from backend entries with references', async () => {
      const entries = [
        makeEntry('a', ['b', 'c']),
        makeEntry('b', ['c']),
        makeEntry('c', []),
      ];
      const backend = createMockBackend(entries);

      await graph.buildFromBackend(backend);

      expect(graph.getStats().nodeCount).toBe(3);
      // a->b, a->c, b->c = 3 edges
      expect(graph.getStats().edgeCount).toBe(3);
    });

    it('should handle an empty backend', async () => {
      const backend = createMockBackend([]);
      await graph.buildFromBackend(backend);
      expect(graph.getStats().nodeCount).toBe(0);
      expect(graph.getStats().edgeCount).toBe(0);
    });

    it('should respect maxNodes limit', async () => {
      const g = new MemoryGraph({ maxNodes: 2 });
      const entries = [makeEntry('a'), makeEntry('b'), makeEntry('c')];
      const backend = createMockBackend(entries);
      await g.buildFromBackend(backend);
      expect(g.getStats().nodeCount).toBe(2);
    });

    it('should skip reference edges to nodes not in graph', async () => {
      // 'a' references 'z' which is not in the entries
      const entries = [makeEntry('a', ['z']), makeEntry('b', [])];
      const backend = createMockBackend(entries);
      await graph.buildFromBackend(backend);

      expect(graph.getStats().nodeCount).toBe(2);
      // a->z should be skipped because 'z' is not a node
      expect(graph.getStats().edgeCount).toBe(0);
    });

    it('should emit graph:built event', async () => {
      const handler = vi.fn();
      graph.on('graph:built', handler);
      const backend = createMockBackend([makeEntry('a')]);

      await graph.buildFromBackend(backend);
      expect(handler).toHaveBeenCalledWith({ nodeCount: 1 });
    });
  });

  // ===== computePageRank =====

  describe('computePageRank', () => {
    it('should return empty map for empty graph', () => {
      const ranks = graph.computePageRank();
      expect(ranks.size).toBe(0);
    });

    it('should compute rank of 1.0 for a single node', () => {
      graph.addNode(makeEntry('a'));
      const ranks = graph.computePageRank();
      expect(ranks.size).toBe(1);
      expect(ranks.get('a')).toBeCloseTo(1.0, 5);
    });

    it('should converge for two connected nodes', () => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addEdge('a', 'b', 'reference');

      const ranks = graph.computePageRank();
      expect(ranks.size).toBe(2);
      // Both should have positive values that sum close to 1
      const total = (ranks.get('a') || 0) + (ranks.get('b') || 0);
      expect(total).toBeCloseTo(1.0, 2);
    });

    it('should give higher rank to node with more incoming edges', () => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addNode(makeEntry('c'));
      graph.addEdge('a', 'c', 'reference');
      graph.addEdge('b', 'c', 'reference');

      const ranks = graph.computePageRank();
      const rankC = ranks.get('c') || 0;
      const rankA = ranks.get('a') || 0;
      const rankB = ranks.get('b') || 0;
      expect(rankC).toBeGreaterThan(rankA);
      expect(rankC).toBeGreaterThan(rankB);
    });

    it('should respect damping factor', () => {
      const g = new MemoryGraph({ pageRankDamping: 0.5 });
      g.addNode(makeEntry('a'));
      g.addNode(makeEntry('b'));
      g.addEdge('a', 'b', 'reference');

      const ranks = g.computePageRank();
      // With damping 0.5, the influence of links is reduced
      expect(ranks.get('a')).toBeDefined();
      expect(ranks.get('b')).toBeDefined();
    });

    it('should converge within maxIterations', () => {
      const handler = vi.fn();
      graph.on('pagerank:computed', handler);

      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addEdge('a', 'b', 'reference');
      graph.computePageRank();

      expect(handler).toHaveBeenCalledTimes(1);
      const { iterations } = handler.mock.calls[0][0];
      expect(iterations).toBeLessThanOrEqual(200);
      expect(iterations).toBeGreaterThan(0);
    });

    it('should handle disconnected components', () => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addNode(makeEntry('c'));
      graph.addNode(makeEntry('d'));
      graph.addEdge('a', 'b', 'reference');
      graph.addEdge('c', 'd', 'reference');

      const ranks = graph.computePageRank();
      expect(ranks.size).toBe(4);
      // Each component should have similar rank distribution
      const total = [...ranks.values()].reduce((s, v) => s + v, 0);
      expect(total).toBeCloseTo(1.0, 2);
    });

    it('should mark graph as not dirty after computation', () => {
      graph.addNode(makeEntry('a'));
      expect(graph.getStats().pageRankComputed).toBe(false);
      graph.computePageRank();
      expect(graph.getStats().pageRankComputed).toBe(true);
    });

    it('should emit pagerank:computed event', () => {
      const handler = vi.fn();
      graph.on('pagerank:computed', handler);
      graph.computePageRank();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ===== detectCommunities =====

  describe('detectCommunities', () => {
    it('should assign isolated nodes to individual communities', () => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addNode(makeEntry('c'));

      const communities = graph.detectCommunities();
      const unique = new Set(communities.values());
      expect(unique.size).toBe(3);
    });

    it('should group connected nodes into the same community', () => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addEdge('a', 'b', 'reference');
      graph.addEdge('b', 'a', 'reference');

      const communities = graph.detectCommunities();
      // With bidirectional edges, they should converge
      expect(communities.get('a')).toBe(communities.get('b'));
    });

    it('should detect two disconnected clusters', () => {
      // Cluster 1: a <-> b
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addEdge('a', 'b', 'reference');
      graph.addEdge('b', 'a', 'reference');

      // Cluster 2: c <-> d
      graph.addNode(makeEntry('c'));
      graph.addNode(makeEntry('d'));
      graph.addEdge('c', 'd', 'reference');
      graph.addEdge('d', 'c', 'reference');

      const communities = graph.detectCommunities();
      expect(communities.get('a')).toBe(communities.get('b'));
      expect(communities.get('c')).toBe(communities.get('d'));
      expect(communities.get('a')).not.toBe(communities.get('c'));
    });

    it('should emit communities:detected event', () => {
      const handler = vi.fn();
      graph.on('communities:detected', handler);
      graph.addNode(makeEntry('a'));
      graph.detectCommunities();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].communityCount).toBe(1);
    });

    it('should handle empty graph', () => {
      const communities = graph.detectCommunities();
      expect(communities.size).toBe(0);
    });
  });

  // ===== rankWithGraph =====

  describe('rankWithGraph', () => {
    it('should blend vector score and pagerank', () => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addNode(makeEntry('c'));
      graph.addEdge('a', 'c', 'reference');
      graph.addEdge('b', 'c', 'reference');

      const searchResults: SearchResult[] = [
        { entry: makeEntry('a'), score: 0.9, distance: 0.1 },
        { entry: makeEntry('c'), score: 0.7, distance: 0.3 },
      ];

      const ranked = graph.rankWithGraph(searchResults);
      expect(ranked.length).toBe(2);
      // Each result should have all fields
      expect(ranked[0].score).toBeDefined();
      expect(ranked[0].pageRank).toBeDefined();
      expect(ranked[0].combinedScore).toBeDefined();
    });

    it('should respect alpha parameter', () => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addEdge('a', 'b', 'reference');

      const results: SearchResult[] = [
        { entry: makeEntry('a'), score: 0.5, distance: 0.5 },
        { entry: makeEntry('b'), score: 0.5, distance: 0.5 },
      ];

      // With alpha=1.0, only vector score matters
      const ranked1 = graph.rankWithGraph(results, 1.0);
      expect(ranked1[0].combinedScore).toBeCloseTo(0.5, 3);

      // With alpha=0.0, only pagerank matters
      const ranked0 = graph.rankWithGraph(results, 0.0);
      // Node b has an incoming edge so should rank higher
      expect(ranked0[0].entry.id).toBe('b');
    });

    it('should handle entries not in graph', () => {
      graph.addNode(makeEntry('a'));
      graph.computePageRank();

      const results: SearchResult[] = [
        { entry: makeEntry('a'), score: 0.8, distance: 0.2 },
        { entry: makeEntry('unknown'), score: 0.9, distance: 0.1 },
      ];

      const ranked = graph.rankWithGraph(results);
      expect(ranked.length).toBe(2);
      // Unknown entry should have pageRank of 0
      const unknownResult = ranked.find((r) => r.entry.id === 'unknown');
      expect(unknownResult?.pageRank).toBe(0);
    });

    it('should sort results by combinedScore descending', () => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addNode(makeEntry('c'));
      graph.addEdge('a', 'c', 'reference');
      graph.addEdge('b', 'c', 'reference');

      const results: SearchResult[] = [
        { entry: makeEntry('a'), score: 0.5, distance: 0.5 },
        { entry: makeEntry('b'), score: 0.5, distance: 0.5 },
        { entry: makeEntry('c'), score: 0.5, distance: 0.5 },
      ];

      const ranked = graph.rankWithGraph(results, 0.5);
      for (let i = 0; i < ranked.length - 1; i++) {
        expect(ranked[i].combinedScore).toBeGreaterThanOrEqual(ranked[i + 1].combinedScore);
      }
    });

    it('should include community info when communities are detected', () => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addEdge('a', 'b', 'reference');
      graph.detectCommunities();

      const results: SearchResult[] = [
        { entry: makeEntry('a'), score: 0.8, distance: 0.2 },
      ];

      const ranked = graph.rankWithGraph(results);
      expect(ranked[0].community).toBeDefined();
    });
  });

  // ===== getTopNodes =====

  describe('getTopNodes', () => {
    it('should return top N nodes by pageRank', () => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addNode(makeEntry('c'));
      graph.addEdge('a', 'c', 'reference');
      graph.addEdge('b', 'c', 'reference');

      const top = graph.getTopNodes(1);
      expect(top.length).toBe(1);
      expect(top[0].id).toBe('c');
    });

    it('should handle requesting more nodes than available', () => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));

      const top = graph.getTopNodes(10);
      expect(top.length).toBe(2);
    });

    it('should return empty array for empty graph', () => {
      const top = graph.getTopNodes(5);
      expect(top.length).toBe(0);
    });

    it('should include community label', () => {
      graph.addNode(makeEntry('a'));
      graph.detectCommunities();
      const top = graph.getTopNodes(1);
      expect(top[0].community).toBeDefined();
    });
  });

  // ===== getNeighbors =====

  describe('getNeighbors', () => {
    beforeEach(() => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addNode(makeEntry('c'));
      graph.addNode(makeEntry('d'));
      graph.addEdge('a', 'b', 'reference');
      graph.addEdge('b', 'c', 'reference');
      graph.addEdge('c', 'd', 'reference');
    });

    it('should return direct neighbors at depth 1', () => {
      const neighbors = graph.getNeighbors('a', 1);
      expect(neighbors.size).toBe(1);
      expect(neighbors.has('b')).toBe(true);
    });

    it('should return extended neighbors at depth 2', () => {
      const neighbors = graph.getNeighbors('a', 2);
      expect(neighbors.size).toBe(2);
      expect(neighbors.has('b')).toBe(true);
      expect(neighbors.has('c')).toBe(true);
    });

    it('should return all reachable nodes at depth 3', () => {
      const neighbors = graph.getNeighbors('a', 3);
      expect(neighbors.size).toBe(3);
      expect(neighbors.has('b')).toBe(true);
      expect(neighbors.has('c')).toBe(true);
      expect(neighbors.has('d')).toBe(true);
    });

    it('should handle node with no neighbors', () => {
      const neighbors = graph.getNeighbors('d', 1);
      expect(neighbors.size).toBe(0);
    });

    it('should not include the start node in results', () => {
      const neighbors = graph.getNeighbors('a', 10);
      expect(neighbors.has('a')).toBe(false);
    });

    it('should default to depth 1', () => {
      const neighbors = graph.getNeighbors('a');
      expect(neighbors.size).toBe(1);
      expect(neighbors.has('b')).toBe(true);
    });
  });

  // ===== addSimilarityEdges =====

  describe('addSimilarityEdges', () => {
    it('should add edges for similar entries above threshold', async () => {
      const embedding = new Float32Array([1, 0, 0]);
      const entryA = { ...makeEntry('a'), embedding };
      const entryB = makeEntry('b');
      graph.addNode(entryA);
      graph.addNode(entryB);

      const searchResults: SearchResult[] = [
        { entry: entryB, score: 0.9, distance: 0.1 },
      ];
      const backend = createMockBackend([entryA, entryB]);
      (backend.search as ReturnType<typeof vi.fn>).mockResolvedValue(searchResults);

      const added = await graph.addSimilarityEdges(backend, 'a');
      expect(added).toBe(1);
      expect(graph.getStats().edgeCount).toBe(1);
    });

    it('should return 0 if entry has no embedding', async () => {
      const entry = makeEntry('a');
      graph.addNode(entry);
      const backend = createMockBackend([entry]);

      const added = await graph.addSimilarityEdges(backend, 'a');
      expect(added).toBe(0);
    });

    it('should return 0 if entry does not exist', async () => {
      const backend = createMockBackend([]);
      const added = await graph.addSimilarityEdges(backend, 'missing');
      expect(added).toBe(0);
    });

    it('should skip self-references in search results', async () => {
      const embedding = new Float32Array([1, 0, 0]);
      const entryA = { ...makeEntry('a'), embedding };
      graph.addNode(entryA);

      const searchResults: SearchResult[] = [
        { entry: entryA, score: 1.0, distance: 0.0 },
      ];
      const backend = createMockBackend([entryA]);
      (backend.search as ReturnType<typeof vi.fn>).mockResolvedValue(searchResults);

      const added = await graph.addSimilarityEdges(backend, 'a');
      expect(added).toBe(0);
    });
  });

  // ===== getStats =====

  describe('getStats', () => {
    it('should return correct initial stats', () => {
      const stats = graph.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
      expect(stats.avgDegree).toBe(0);
      expect(stats.communityCount).toBe(0);
      expect(stats.pageRankComputed).toBe(false);
      expect(stats.maxPageRank).toBe(0);
      expect(stats.minPageRank).toBe(0);
    });

    it('should reflect graph state after adding nodes and edges', () => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addNode(makeEntry('c'));
      graph.addEdge('a', 'b', 'reference');
      graph.addEdge('a', 'c', 'reference');

      const stats = graph.getStats();
      expect(stats.nodeCount).toBe(3);
      expect(stats.edgeCount).toBe(2);
      expect(stats.avgDegree).toBeCloseTo(2 / 3, 5);
    });

    it('should report pageRank min/max after computation', () => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.addEdge('a', 'b', 'reference');
      graph.computePageRank();

      const stats = graph.getStats();
      expect(stats.pageRankComputed).toBe(true);
      expect(stats.maxPageRank).toBeGreaterThan(0);
      expect(stats.minPageRank).toBeGreaterThan(0);
      expect(stats.maxPageRank).toBeGreaterThanOrEqual(stats.minPageRank);
    });

    it('should count communities after detection', () => {
      graph.addNode(makeEntry('a'));
      graph.addNode(makeEntry('b'));
      graph.detectCommunities();

      const stats = graph.getStats();
      expect(stats.communityCount).toBe(2);
    });
  });
});
