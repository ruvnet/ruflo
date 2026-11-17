/**
 * Knowledge Graph Module for @claude-flow/memory
 *
 * Builds a graph from MemoryEntry.references, computes PageRank,
 * detects communities via label propagation, and provides
 * graph-aware ranking for search results.
 *
 * PageRank uses the optional @ruvnet/sublinear-core when installed and an
 * in-tree implementation otherwise (./pagerank.ts).
 * @module v3/memory/memory-graph
 */
import { EventEmitter } from 'node:events';
import type { IMemoryBackend, MemoryEntry, SearchResult } from './types.js';
import { computePageRankScores } from './pagerank.js';

// ===== Types =====

export type EdgeType = 'reference' | 'similar' | 'temporal' | 'co-accessed' | 'causal';

export interface MemoryGraphConfig {
  similarityThreshold?: number;   // Auto-edge threshold (default: 0.8)
  pageRankDamping?: number;       // Damping factor (default: 0.85)
  pageRankIterations?: number;    // Max iterations (default: 200)
  pageRankConvergence?: number;   // L1 change between iterates to stop at (default: 1e-10)
  maxNodes?: number;              // Cap graph size (default: 5000)
  enableAutoEdges?: boolean;      // Auto-create edges from similarity (default: true)
  communityAlgorithm?: 'louvain' | 'label-propagation';  // default: label-propagation
}

export interface GraphNode {
  id: string;
  category: string;
  confidence: number;
  accessCount: number;
  createdAt: number;
}

export interface GraphEdge {
  targetId: string;
  type: EdgeType;
  weight: number;
}

export interface RankedResult {
  entry: MemoryEntry;
  score: number;
  pageRank: number;
  combinedScore: number;
  community?: string;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  avgDegree: number;
  communityCount: number;
  pageRankComputed: boolean;
  maxPageRank: number;
  minPageRank: number;
}

const DEFAULT_CONFIG: Required<MemoryGraphConfig> = {
  similarityThreshold: 0.8,
  pageRankDamping: 0.85,
  pageRankIterations: 200,
  pageRankConvergence: 1e-10,
  maxNodes: 5000,
  enableAutoEdges: true,
  communityAlgorithm: 'label-propagation',
};

/**
 * Knowledge graph built from memory entry references.
 * Supports PageRank, community detection (label propagation),
 * and graph-aware result ranking blending vector similarity with structural importance.
 */
export class MemoryGraph extends EventEmitter {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge[]> = new Map();
  private reverseEdges: Map<string, Set<string>> = new Map();
  private pageRanks: Map<string, number> = new Map();
  private communities: Map<string, string> = new Map();
  private config: Required<MemoryGraphConfig>;
  private dirty: boolean = true;

  constructor(config?: MemoryGraphConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Build graph from all entries in a backend. Creates nodes and reference edges. */
  async buildFromBackend(backend: IMemoryBackend, namespace?: string): Promise<void> {
    const entries = await backend.query({
      type: 'hybrid',
      namespace,
      limit: this.config.maxNodes,
    });
    for (const entry of entries) {
      this.addNode(entry);
    }
    for (const entry of entries) {
      for (const refId of entry.references) {
        this.addEdge(entry.id, refId, 'reference');
      }
    }
    this.dirty = true;
    this.emit('graph:built', { nodeCount: this.nodes.size });
  }

  /** Add a node from a MemoryEntry. Skips silently at maxNodes capacity. */
  addNode(entry: MemoryEntry): void {
    if (this.nodes.size >= this.config.maxNodes && !this.nodes.has(entry.id)) {
      return;
    }
    this.nodes.set(entry.id, {
      id: entry.id,
      category: (entry.metadata?.category as string) || 'general',
      confidence: (entry.metadata?.confidence as number) || 0.5,
      accessCount: entry.accessCount,
      createdAt: entry.createdAt,
    });
    if (!this.edges.has(entry.id)) this.edges.set(entry.id, []);
    if (!this.reverseEdges.has(entry.id)) this.reverseEdges.set(entry.id, new Set());
    this.dirty = true;
  }

  /** Add a directed edge. Skips if either node missing. Updates weight to max if exists. */
  addEdge(sourceId: string, targetId: string, type: EdgeType, weight: number = 1.0): void {
    if (!this.nodes.has(sourceId) || !this.nodes.has(targetId)) return;

    const edgeList = this.edges.get(sourceId) || [];
    if (!this.edges.has(sourceId)) this.edges.set(sourceId, edgeList);

    const existing = edgeList.find((e) => e.targetId === targetId);
    if (existing) {
      existing.weight = Math.max(existing.weight, weight);
    } else {
      edgeList.push({ targetId, type, weight });
    }

    if (!this.reverseEdges.has(targetId)) this.reverseEdges.set(targetId, new Set());
    this.reverseEdges.get(targetId)!.add(sourceId);
    this.dirty = true;
  }

  /** Remove a node and all associated edges (both directions). */
  removeNode(id: string): void {
    if (!this.nodes.has(id)) return;

    // Remove outgoing edges and their reverse entries
    for (const edge of this.edges.get(id) || []) {
      this.reverseEdges.get(edge.targetId)?.delete(id);
    }
    this.edges.delete(id);

    // Remove incoming edges pointing to this node
    const incoming = this.reverseEdges.get(id);
    if (incoming) {
      for (const sourceId of incoming) {
        const srcEdges = this.edges.get(sourceId);
        if (srcEdges) this.edges.set(sourceId, srcEdges.filter((e) => e.targetId !== id));
      }
    }
    this.reverseEdges.delete(id);
    this.nodes.delete(id);
    this.pageRanks.delete(id);
    this.communities.delete(id);
    this.dirty = true;
  }

  /** Add similarity edges by searching backend. Returns count of edges added. */
  async addSimilarityEdges(backend: IMemoryBackend, entryId: string): Promise<number> {
    const entry = await backend.get(entryId);
    if (!entry || !entry.embedding) return 0;

    const results = await backend.search(entry.embedding, {
      k: 20,
      threshold: this.config.similarityThreshold,
    });

    let added = 0;
    for (const result of results) {
      if (result.entry.id === entryId) continue;
      if (result.score >= this.config.similarityThreshold) {
        const hadEdge = this.hasEdge(entryId, result.entry.id);
        this.addEdge(entryId, result.entry.id, 'similar', result.score);
        if (!hadEdge) added++;
      }
    }
    return added;
  }

  /**
   * Compute PageRank (power iteration, dangling mass redistributed uniformly).
   * Uses @ruvnet/sublinear-core when installed, else the in-tree solver in
   * ./pagerank.ts. Stops when the L1 change between iterates is <=
   * pageRankConvergence. Returns map of node ID to PageRank score (sums to 1).
   */
  computePageRank(): Map<string, number> {
    const ids = [...this.nodes.keys()];
    const N = ids.length;
    if (N === 0) {
      this.dirty = false;
      this.emit('pagerank:computed', { iterations: 0 });
      return new Map();
    }

    const index = new Map<string, number>();
    ids.forEach((id, i) => index.set(id, i));
    const edges: Array<[number, number]> = [];
    for (const [sourceId, out] of this.edges) {
      const s = index.get(sourceId);
      if (s === undefined) continue;
      for (const edge of out) {
        const t = index.get(edge.targetId);
        if (t !== undefined) edges.push([s, t]);
      }
    }

    const run = computePageRankScores(N, edges, {
      damping: this.config.pageRankDamping,
      tolerance: this.config.pageRankConvergence,
      maxIterations: this.config.pageRankIterations,
    });
    this.pageRanks = new Map();
    ids.forEach((id, i) => this.pageRanks.set(id, run.scores[i]));

    this.dirty = false;
    this.emit('pagerank:computed', {
      iterations: run.iterations,
      converged: run.converged,
      delta: run.delta,
      backend: run.backend,
    });
    return new Map(this.pageRanks);
  }

  /** Detect communities using label propagation. Returns map of nodeId to communityId. */
  detectCommunities(): Map<string, string> {
    const labels = new Map<string, string>();
    for (const nodeId of this.nodes.keys()) labels.set(nodeId, nodeId);

    for (let iter = 0; iter < 20; iter++) {
      let changed = false;
      const nodeIds = this.shuffleArray([...this.nodes.keys()]);

      for (const nodeId of nodeIds) {
        const labelCounts = new Map<string, number>();

        for (const edge of this.edges.get(nodeId) || []) {
          const lbl = labels.get(edge.targetId);
          if (lbl !== undefined) labelCounts.set(lbl, (labelCounts.get(lbl) || 0) + edge.weight);
        }
        const incoming = this.reverseEdges.get(nodeId);
        if (incoming) {
          for (const sourceId of incoming) {
            const lbl = labels.get(sourceId);
            if (lbl !== undefined) labelCounts.set(lbl, (labelCounts.get(lbl) || 0) + 1);
          }
        }

        if (labelCounts.size > 0) {
          let maxLabel = labels.get(nodeId)!;
          let maxCount = 0;
          for (const [label, count] of labelCounts) {
            if (count > maxCount) { maxCount = count; maxLabel = label; }
          }
          if (maxLabel !== labels.get(nodeId)) {
            labels.set(nodeId, maxLabel);
            changed = true;
          }
        }
      }
      if (!changed) break;
    }

    this.communities = labels;
    this.emit('communities:detected', { communityCount: new Set(labels.values()).size });
    return new Map(this.communities);
  }

  /**
   * Rank search results blending vector similarity and PageRank.
   * @param alpha - Weight for vector score (default 0.7). PageRank weight is (1 - alpha).
   */
  rankWithGraph(searchResults: SearchResult[], alpha: number = 0.7): RankedResult[] {
    if (this.dirty) this.computePageRank();
    const N = this.nodes.size || 1;

    return searchResults
      .map((result) => {
        const pageRank = this.pageRanks.get(result.entry.id) || 0;
        return {
          entry: result.entry,
          score: result.score,
          pageRank,
          combinedScore: alpha * result.score + (1 - alpha) * (pageRank * N),
          community: this.communities.get(result.entry.id),
        };
      })
      .sort((a, b) => b.combinedScore - a.combinedScore);
  }

  /** Get top N nodes by PageRank score. */
  getTopNodes(n: number): Array<{ id: string; pageRank: number; community: string }> {
    if (this.dirty) this.computePageRank();
    return [...this.pageRanks.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([id, pageRank]) => ({
        id,
        pageRank,
        community: this.communities.get(id) || id,
      }));
  }

  /** BFS neighbors from a node up to given depth. Excludes the start node. */
  getNeighbors(id: string, depth: number = 1): Set<string> {
    const visited = new Set<string>();
    let frontier = new Set<string>([id]);

    for (let d = 0; d < depth; d++) {
      const nextFrontier = new Set<string>();
      for (const nodeId of frontier) {
        for (const edge of this.edges.get(nodeId) || []) {
          if (!visited.has(edge.targetId) && edge.targetId !== id) {
            visited.add(edge.targetId);
            nextFrontier.add(edge.targetId);
          }
        }
      }
      frontier = nextFrontier;
      if (frontier.size === 0) break;
    }
    return visited;
  }

  /** Get statistics about the current graph state. */
  getStats(): GraphStats {
    let totalEdges = 0;
    for (const edgeList of this.edges.values()) totalEdges += edgeList.length;

    const nodeCount = this.nodes.size;
    let maxPageRank = 0;
    let minPageRank = Infinity;
    if (this.pageRanks.size > 0) {
      for (const rank of this.pageRanks.values()) {
        if (rank > maxPageRank) maxPageRank = rank;
        if (rank < minPageRank) minPageRank = rank;
      }
    } else {
      minPageRank = 0;
    }

    return {
      nodeCount,
      edgeCount: totalEdges,
      avgDegree: nodeCount > 0 ? totalEdges / nodeCount : 0,
      communityCount: new Set(this.communities.values()).size,
      pageRankComputed: !this.dirty,
      maxPageRank,
      minPageRank,
    };
  }

  // ===== Internal Helpers =====

  private hasEdge(sourceId: string, targetId: string): boolean {
    const edgeList = this.edges.get(sourceId);
    return edgeList ? edgeList.some((e) => e.targetId === targetId) : false;
  }

  private shuffleArray<T>(arr: T[]): T[] {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}
