/**
 * Hyperbolic Hypergraph Cache Intelligence
 *
 * Uses Poincaré ball embeddings and hypergraph structures to:
 * 1. Model hierarchical cache relationships (system_prompt → derived content)
 * 2. Capture multi-way relationships (entry ↔ files ↔ tools ↔ sessions)
 * 3. Learn from historical cache patterns to prevent drift
 * 4. Predict optimal eviction using geometric distance from origin
 */

import type { CacheEntry, CacheEntryType } from '../types.js';

// ============================================================================
// Hyperbolic Geometry (Poincaré Ball Model)
// ============================================================================

/**
 * Point in Poincaré ball (hyperbolic space)
 * Curvature c = -1 by default
 */
export interface PoincaréPoint {
  coords: number[];  // Coordinates in ball (|x| < 1)
  curvature: number; // Negative curvature (default -1)
}

/**
 * Hyperbolic operations in Poincaré ball
 */
export class PoincaréBall {
  private curvature: number;
  private dims: number;

  constructor(dims: number = 64, curvature: number = -1) {
    this.dims = dims;
    this.curvature = curvature;
  }

  /**
   * Möbius addition in Poincaré ball
   * x ⊕ y = ((1 + 2c⟨x,y⟩ + c|y|²)x + (1 - c|x|²)y) / (1 + 2c⟨x,y⟩ + c²|x|²|y|²)
   */
  mobiusAdd(x: number[], y: number[]): number[] {
    const c = Math.abs(this.curvature);
    const xNorm = this.norm(x);
    const yNorm = this.norm(y);
    const xy = this.dot(x, y);

    const num1 = 1 + 2 * c * xy + c * yNorm * yNorm;
    const num2 = 1 - c * xNorm * xNorm;
    const denom = 1 + 2 * c * xy + c * c * xNorm * xNorm * yNorm * yNorm;

    return x.map((xi, i) => (num1 * xi + num2 * y[i]) / denom);
  }

  /**
   * Poincaré distance: d(x,y) = (2/√|c|) arctanh(√|c| ||-x ⊕ y||)
   */
  distance(x: number[], y: number[]): number {
    const c = Math.abs(this.curvature);
    const negX = x.map(xi => -xi);
    const diff = this.mobiusAdd(negX, y);
    const diffNorm = this.norm(diff);

    // Clamp to avoid numerical issues
    const arg = Math.min(Math.sqrt(c) * diffNorm, 0.999999);
    return (2 / Math.sqrt(c)) * Math.atanh(arg);
  }

  /**
   * Distance from origin (represents "staleness" or hierarchy depth)
   */
  distanceFromOrigin(x: number[]): number {
    const c = Math.abs(this.curvature);
    const xNorm = this.norm(x);
    const arg = Math.min(Math.sqrt(c) * xNorm, 0.999999);
    return (2 / Math.sqrt(c)) * Math.atanh(arg);
  }

  /**
   * Exponential map: project from tangent space to Poincaré ball
   * exp_x(v) = x ⊕ (tanh(√|c| λ_x |v| / 2) * v / (√|c| |v|))
   */
  expMap(x: number[], v: number[]): number[] {
    const c = Math.abs(this.curvature);
    const vNorm = this.norm(v);
    if (vNorm < 1e-10) return x;

    const lambda = this.conformalFactor(x);
    const t = Math.tanh(Math.sqrt(c) * lambda * vNorm / 2);
    const scaled = v.map(vi => (t * vi) / (Math.sqrt(c) * vNorm));

    return this.mobiusAdd(x, scaled);
  }

  /**
   * Logarithmic map: project from Poincaré ball to tangent space
   */
  logMap(x: number[], y: number[]): number[] {
    const c = Math.abs(this.curvature);
    const negX = x.map(xi => -xi);
    const diff = this.mobiusAdd(negX, y);
    const diffNorm = this.norm(diff);

    if (diffNorm < 1e-10) return new Array(this.dims).fill(0);

    const lambda = this.conformalFactor(x);
    const arg = Math.min(Math.sqrt(c) * diffNorm, 0.999999);
    const scale = (2 / (Math.sqrt(c) * lambda)) * Math.atanh(arg);

    return diff.map(di => (scale * di) / diffNorm);
  }

  /**
   * Conformal factor λ_x = 2 / (1 - c|x|²)
   */
  private conformalFactor(x: number[]): number {
    const c = Math.abs(this.curvature);
    return 2 / (1 - c * this.norm(x) ** 2);
  }

  /**
   * Project to ball (clamp norm to < 1)
   */
  project(x: number[]): number[] {
    const norm = this.norm(x);
    const maxNorm = 0.999;
    if (norm > maxNorm) {
      return x.map(xi => (xi / norm) * maxNorm);
    }
    return x;
  }

  /**
   * Create origin point
   */
  origin(): number[] {
    return new Array(this.dims).fill(0);
  }

  /**
   * Create random point near origin
   */
  randomNearOrigin(radius: number = 0.1): number[] {
    const point = Array.from({ length: this.dims }, () => (Math.random() - 0.5) * 2 * radius);
    return this.project(point);
  }

  private dot(x: number[], y: number[]): number {
    return x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  }

  private norm(x: number[]): number {
    return Math.sqrt(this.dot(x, x));
  }
}

// ============================================================================
// Hypergraph Structure
// ============================================================================

/**
 * Hyperedge connecting multiple cache entries
 * Captures complex relationships (entry ↔ files ↔ tools ↔ sessions)
 */
export interface Hyperedge {
  id: string;
  vertices: string[];     // Entry IDs connected by this edge
  type: HyperedgeType;
  weight: number;         // Relationship strength
  metadata: {
    files?: string[];
    tools?: string[];
    session?: string;
    timestamp: number;
  };
}

export type HyperedgeType =
  | 'file_group'      // Entries related to same file(s)
  | 'tool_chain'      // Entries from sequential tool uses
  | 'session_context' // Entries in same session window
  | 'semantic_cluster'// Semantically similar entries
  | 'temporal_window' // Entries created close in time
  | 'causal_chain';   // Entries with causal dependencies

/**
 * Hypergraph structure for cache entries
 */
export class CacheHypergraph {
  private edges: Map<string, Hyperedge> = new Map();
  private vertexToEdges: Map<string, Set<string>> = new Map();

  /**
   * Add a hyperedge connecting multiple entries
   */
  addEdge(edge: Hyperedge): void {
    this.edges.set(edge.id, edge);

    for (const vertex of edge.vertices) {
      if (!this.vertexToEdges.has(vertex)) {
        this.vertexToEdges.set(vertex, new Set());
      }
      this.vertexToEdges.get(vertex)!.add(edge.id);
    }
  }

  /**
   * Get all edges containing a vertex
   */
  getEdgesForVertex(vertexId: string): Hyperedge[] {
    const edgeIds = this.vertexToEdges.get(vertexId) || new Set();
    return Array.from(edgeIds).map(id => this.edges.get(id)!).filter(Boolean);
  }

  /**
   * Get vertices connected to a vertex via hyperedges
   */
  getConnectedVertices(vertexId: string): Map<string, number> {
    const connections = new Map<string, number>();
    const edges = this.getEdgesForVertex(vertexId);

    for (const edge of edges) {
      for (const vertex of edge.vertices) {
        if (vertex !== vertexId) {
          const current = connections.get(vertex) || 0;
          connections.set(vertex, current + edge.weight);
        }
      }
    }

    return connections;
  }

  /**
   * Remove a vertex and update edges
   */
  removeVertex(vertexId: string): void {
    const edgeIds = this.vertexToEdges.get(vertexId) || new Set();

    for (const edgeId of edgeIds) {
      const edge = this.edges.get(edgeId);
      if (edge) {
        edge.vertices = edge.vertices.filter(v => v !== vertexId);
        if (edge.vertices.length < 2) {
          this.edges.delete(edgeId);
        }
      }
    }

    this.vertexToEdges.delete(vertexId);
  }

  /**
   * Get hypergraph statistics
   */
  getStats(): { vertices: number; edges: number; avgDegree: number } {
    const vertices = this.vertexToEdges.size;
    const edges = this.edges.size;
    let totalDegree = 0;

    for (const edgeSet of this.vertexToEdges.values()) {
      totalDegree += edgeSet.size;
    }

    return {
      vertices,
      edges,
      avgDegree: vertices > 0 ? totalDegree / vertices : 0,
    };
  }
}

// ============================================================================
// Historical Pattern Learning
// ============================================================================

/**
 * Historical cache pattern for drift detection
 */
export interface HistoricalPattern {
  id: string;
  embedding: number[];          // Poincaré embedding of pattern
  entryTypes: CacheEntryType[]; // Types involved
  utilizationRange: [number, number]; // Typical utilization
  successMetrics: {
    hitRate: number;
    compressionRatio: number;
    evictionAccuracy: number;   // How often evicted entries weren't needed
  };
  timestamp: number;
  sessionCount: number;         // How many sessions this pattern appeared in
}

/**
 * Drift detector using historical patterns
 */
export class DriftDetector {
  private patterns: Map<string, HistoricalPattern> = new Map();
  private poincare: PoincaréBall;
  private driftThreshold: number;

  constructor(dims: number = 64, driftThreshold: number = 0.5) {
    this.poincare = new PoincaréBall(dims);
    this.driftThreshold = driftThreshold;
  }

  /**
   * Add a successful historical pattern
   */
  addPattern(pattern: HistoricalPattern): void {
    this.patterns.set(pattern.id, pattern);
  }

  /**
   * Compute current cache embedding
   */
  computeCacheEmbedding(entries: CacheEntry[]): number[] {
    if (entries.length === 0) {
      return this.poincare.origin();
    }

    // Aggregate entry features into embedding
    const dims = 64;
    const embedding = new Array(dims).fill(0);

    for (const entry of entries) {
      // Type encoding (first 16 dims)
      const typeIndex = this.getTypeIndex(entry.type);
      embedding[typeIndex] += 1 / entries.length;

      // Tier encoding (dims 16-19)
      const tierIndex = 16 + this.getTierIndex(entry.tier);
      embedding[tierIndex] += 1 / entries.length;

      // Relevance encoding (dims 20-35)
      embedding[20] += entry.relevance.overall / entries.length;
      embedding[21] += entry.relevance.components.recency / entries.length;
      embedding[22] += entry.relevance.components.semantic / entries.length;
      embedding[23] += entry.relevance.components.attention / entries.length;

      // Age encoding (dims 36-40)
      const age = Date.now() - entry.timestamp;
      const ageNorm = Math.min(age / (60 * 60 * 1000), 1); // Normalize to 1 hour
      embedding[36] += ageNorm / entries.length;

      // Access pattern encoding (dims 40-50)
      const accessRate = entry.accessCount / Math.max(1, (Date.now() - entry.createdAt) / 60000);
      embedding[40] += Math.min(accessRate, 1) / entries.length;

      // Token distribution (dims 50-64)
      const tokenRatio = entry.tokens / 1000; // Normalize to 1000 tokens
      embedding[50] += Math.min(tokenRatio, 1) / entries.length;
    }

    // Project to Poincaré ball
    return this.poincare.project(embedding);
  }

  /**
   * Detect drift from historical patterns
   */
  detectDrift(currentEmbedding: number[]): {
    isDrifting: boolean;
    driftMagnitude: number;
    nearestPattern: HistoricalPattern | null;
    recommendation: string;
  } {
    if (this.patterns.size === 0) {
      return {
        isDrifting: false,
        driftMagnitude: 0,
        nearestPattern: null,
        recommendation: 'No historical patterns available for comparison',
      };
    }

    // Find nearest historical pattern
    let nearestPattern: HistoricalPattern | null = null;
    let minDistance = Infinity;

    for (const pattern of this.patterns.values()) {
      const distance = this.poincare.distance(currentEmbedding, pattern.embedding);
      if (distance < minDistance) {
        minDistance = distance;
        nearestPattern = pattern;
      }
    }

    const isDrifting = minDistance > this.driftThreshold;
    let recommendation = '';

    if (isDrifting) {
      // Analyze what's different
      const originDist = this.poincare.distanceFromOrigin(currentEmbedding);
      const patternOriginDist = nearestPattern
        ? this.poincare.distanceFromOrigin(nearestPattern.embedding)
        : 0;

      if (originDist > patternOriginDist) {
        recommendation = 'Cache is drifting toward periphery (more stale content). Consider more aggressive pruning.';
      } else {
        recommendation = 'Cache structure differs from historical patterns. Review entry type distribution.';
      }
    } else {
      recommendation = 'Cache aligns with successful historical patterns.';
    }

    return {
      isDrifting,
      driftMagnitude: minDistance,
      nearestPattern,
      recommendation,
    };
  }

  /**
   * Get optimal pruning targets based on historical patterns
   */
  getOptimalPruningTargets(
    entries: CacheEntry[],
    targetUtilization: number
  ): { toPrune: string[]; toCompress: string[]; confidence: number } {
    // Embed each entry individually
    const entryEmbeddings = new Map<string, number[]>();
    for (const entry of entries) {
      entryEmbeddings.set(entry.id, this.embedEntry(entry));
    }

    // Calculate "prunability score" based on distance from origin
    // Entries further from origin (more peripheral) are more prunable
    const prunabilityScores: Array<{ id: string; score: number; entry: CacheEntry }> = [];

    for (const entry of entries) {
      const embedding = entryEmbeddings.get(entry.id)!;
      const distFromOrigin = this.poincare.distanceFromOrigin(embedding);

      // Higher distance = more prunable
      // Also factor in connections (well-connected entries less prunable)
      const score = distFromOrigin * (1 - entry.relevance.overall);
      prunabilityScores.push({ id: entry.id, score, entry });
    }

    // Sort by prunability (highest first)
    prunabilityScores.sort((a, b) => b.score - a.score);

    const toPrune: string[] = [];
    const toCompress: string[] = [];
    let currentTokens = entries.reduce((sum, e) => sum + e.tokens, 0);
    const targetTokens = targetUtilization * currentTokens;

    for (const { id, score, entry } of prunabilityScores) {
      if (currentTokens <= targetTokens) break;

      if (score > 0.7) {
        // High prunability - remove
        toPrune.push(id);
        currentTokens -= entry.tokens;
      } else if (score > 0.4 && entry.tier !== 'cold') {
        // Medium prunability - compress
        toCompress.push(id);
        currentTokens -= entry.tokens * 0.75; // Assume 75% compression
      }
    }

    // Confidence based on historical pattern alignment
    const confidence = this.patterns.size > 0 ? 0.8 : 0.5;

    return { toPrune, toCompress, confidence };
  }

  /**
   * Record successful cache state as pattern
   */
  recordSuccessfulPattern(
    entries: CacheEntry[],
    metrics: { hitRate: number; compressionRatio: number; evictionAccuracy: number }
  ): string {
    const embedding = this.computeCacheEmbedding(entries);
    const id = `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const pattern: HistoricalPattern = {
      id,
      embedding,
      entryTypes: [...new Set(entries.map(e => e.type))],
      utilizationRange: [0, 1], // Will be refined with more data
      successMetrics: metrics,
      timestamp: Date.now(),
      sessionCount: 1,
    };

    this.addPattern(pattern);
    return id;
  }

  private embedEntry(entry: CacheEntry): number[] {
    const dims = 64;
    const embedding = new Array(dims).fill(0);

    // Type
    embedding[this.getTypeIndex(entry.type)] = 1;

    // Tier
    embedding[16 + this.getTierIndex(entry.tier)] = 1;

    // Relevance scores
    embedding[20] = entry.relevance.overall;
    embedding[21] = entry.relevance.temporal;
    embedding[22] = entry.relevance.semantic;
    embedding[23] = entry.relevance.contextual;

    // Age (normalized)
    const age = Date.now() - entry.createdAt;
    embedding[36] = Math.min(age / (60 * 60 * 1000), 1);

    // Access pattern
    embedding[40] = Math.min(entry.accessCount / 10, 1);

    // Token size
    embedding[50] = Math.min(entry.tokens / 1000, 1);

    return this.poincare.project(embedding);
  }

  private getTypeIndex(type: CacheEntryType): number {
    const types: CacheEntryType[] = [
      'system_prompt', 'claude_md', 'file_read', 'file_write',
      'tool_result', 'bash_output', 'user_message', 'assistant_message',
      'search_result', 'context_summary', 'agent_state', 'memory_snapshot',
      'compressed_history', 'semantic_index', 'embedding_cache', 'other',
    ];
    return types.indexOf(type) % 16;
  }

  private getTierIndex(tier: string): number {
    const tiers = ['hot', 'warm', 'cold', 'archived'];
    return tiers.indexOf(tier) % 4;
  }

  /**
   * Export patterns for persistence
   */
  exportPatterns(): HistoricalPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Import patterns from persistence
   */
  importPatterns(patterns: HistoricalPattern[]): void {
    for (const pattern of patterns) {
      this.patterns.set(pattern.id, pattern);
    }
  }
}

// ============================================================================
// Hyperbolic Cache Intelligence (Main Class)
// ============================================================================

export interface HyperbolicCacheConfig {
  dims: number;
  curvature: number;
  driftThreshold: number;
  enableHypergraph: boolean;
  enableDriftDetection: boolean;
  patternPersistencePath?: string;
}

const DEFAULT_HYPERBOLIC_CONFIG: HyperbolicCacheConfig = {
  dims: 64,
  curvature: -1,
  driftThreshold: 0.5,
  enableHypergraph: true,
  enableDriftDetection: true,
};

/**
 * Main hyperbolic cache intelligence class
 * Combines Poincaré embeddings, hypergraph structure, and drift detection
 */
export class HyperbolicCacheIntelligence {
  private config: HyperbolicCacheConfig;
  private poincare: PoincaréBall;
  private hypergraph: CacheHypergraph;
  private driftDetector: DriftDetector;
  private entryEmbeddings: Map<string, number[]> = new Map();

  constructor(config: Partial<HyperbolicCacheConfig> = {}) {
    this.config = { ...DEFAULT_HYPERBOLIC_CONFIG, ...config };
    this.poincare = new PoincaréBall(this.config.dims, this.config.curvature);
    this.hypergraph = new CacheHypergraph();
    this.driftDetector = new DriftDetector(this.config.dims, this.config.driftThreshold);
  }

  /**
   * Embed a new cache entry in hyperbolic space
   */
  embedEntry(entry: CacheEntry): number[] {
    // Create embedding based on entry properties
    const embedding = this.createEntryEmbedding(entry);
    this.entryEmbeddings.set(entry.id, embedding);
    return embedding;
  }

  /**
   * Add hyperedge connecting entries
   */
  addRelationship(
    entryIds: string[],
    type: HyperedgeType,
    metadata: Hyperedge['metadata']
  ): void {
    if (!this.config.enableHypergraph) return;

    const edge: Hyperedge = {
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      vertices: entryIds,
      type,
      weight: 1.0,
      metadata,
    };

    this.hypergraph.addEdge(edge);
  }

  /**
   * Get optimized relevance score using hyperbolic geometry
   */
  getHyperbolicRelevance(entry: CacheEntry): number {
    const embedding = this.entryEmbeddings.get(entry.id);
    if (!embedding) {
      return entry.relevance.overall;
    }

    // Base relevance from distance to origin
    // Closer to origin = more central/important
    const distFromOrigin = this.poincare.distanceFromOrigin(embedding);
    const geometricRelevance = Math.exp(-distFromOrigin);

    // Boost from hypergraph connectivity
    let connectivityBoost = 0;
    if (this.config.enableHypergraph) {
      const connections = this.hypergraph.getConnectedVertices(entry.id);
      connectivityBoost = Math.min(connections.size / 10, 0.3); // Max 30% boost
    }

    // Combine with original relevance
    const combined = 0.4 * entry.relevance.overall +
                     0.4 * geometricRelevance +
                     0.2 * (entry.relevance.overall + connectivityBoost);

    return Math.min(combined, 1);
  }

  /**
   * Detect and report cache drift
   */
  analyzeDrift(entries: CacheEntry[]): ReturnType<DriftDetector['detectDrift']> {
    if (!this.config.enableDriftDetection) {
      return {
        isDrifting: false,
        driftMagnitude: 0,
        nearestPattern: null,
        recommendation: 'Drift detection disabled',
      };
    }

    const currentEmbedding = this.driftDetector.computeCacheEmbedding(entries);
    return this.driftDetector.detectDrift(currentEmbedding);
  }

  /**
   * Get optimal pruning decisions using hyperbolic geometry
   */
  getOptimalPruningDecision(
    entries: CacheEntry[],
    targetUtilization: number
  ): {
    toPrune: string[];
    toCompress: string[];
    confidence: number;
    driftAnalysis: ReturnType<DriftDetector['detectDrift']>;
  } {
    // Ensure all entries have embeddings
    for (const entry of entries) {
      if (!this.entryEmbeddings.has(entry.id)) {
        this.embedEntry(entry);
      }
    }

    // Get pruning targets based on geometric analysis
    const { toPrune, toCompress, confidence } = this.driftDetector.getOptimalPruningTargets(
      entries,
      targetUtilization
    );

    // Analyze drift
    const driftAnalysis = this.analyzeDrift(entries);

    // If drifting, be more aggressive
    if (driftAnalysis.isDrifting) {
      // Sort remaining entries by hyperbolic distance and add more to prune
      const remaining = entries.filter(e => !toPrune.includes(e.id) && !toCompress.includes(e.id));
      const sorted = remaining.sort((a, b) => {
        const distA = this.poincare.distanceFromOrigin(this.entryEmbeddings.get(a.id)!);
        const distB = this.poincare.distanceFromOrigin(this.entryEmbeddings.get(b.id)!);
        return distB - distA; // Furthest first
      });

      // Add more entries to compress to correct drift
      for (const entry of sorted.slice(0, 3)) {
        if (entry.tier !== 'cold') {
          toCompress.push(entry.id);
        }
      }
    }

    return { toPrune, toCompress, confidence, driftAnalysis };
  }

  /**
   * Record successful cache state for future reference
   */
  recordSuccess(
    entries: CacheEntry[],
    metrics: { hitRate: number; compressionRatio: number; evictionAccuracy: number }
  ): string {
    return this.driftDetector.recordSuccessfulPattern(entries, metrics);
  }

  /**
   * Remove entry from hyperbolic space
   */
  removeEntry(entryId: string): void {
    this.entryEmbeddings.delete(entryId);
    this.hypergraph.removeVertex(entryId);
  }

  /**
   * Get statistics
   */
  getStats(): {
    embeddedEntries: number;
    hypergraph: { vertices: number; edges: number; avgDegree: number };
    historicalPatterns: number;
  } {
    return {
      embeddedEntries: this.entryEmbeddings.size,
      hypergraph: this.hypergraph.getStats(),
      historicalPatterns: this.driftDetector.exportPatterns().length,
    };
  }

  /**
   * Export state for persistence
   */
  exportState(): {
    embeddings: Array<[string, number[]]>;
    patterns: HistoricalPattern[];
  } {
    return {
      embeddings: Array.from(this.entryEmbeddings.entries()),
      patterns: this.driftDetector.exportPatterns(),
    };
  }

  /**
   * Import state from persistence
   */
  importState(state: ReturnType<typeof this.exportState>): void {
    this.entryEmbeddings = new Map(state.embeddings);
    this.driftDetector.importPatterns(state.patterns);
  }

  private createEntryEmbedding(entry: CacheEntry): number[] {
    const dims = this.config.dims;
    const embedding = new Array(dims).fill(0);

    // Type encoding (hierarchical - system_prompt at center)
    const typeWeights: Record<CacheEntryType, number> = {
      system_prompt: 0.05,   // Very close to origin (central)
      claude_md: 0.1,
      user_message: 0.2,
      assistant_message: 0.25,
      file_read: 0.3,
      file_write: 0.35,
      tool_result: 0.4,
      bash_output: 0.45,
      search_result: 0.5,
      context_summary: 0.55,
      agent_state: 0.6,
      memory_snapshot: 0.65,
      compressed_history: 0.7,
      semantic_index: 0.75,
      embedding_cache: 0.8,
      other: 0.9,            // Far from origin (peripheral)
    };

    const typeRadius = typeWeights[entry.type] || 0.5;

    // Age pushes entry toward periphery
    const age = Date.now() - entry.createdAt;
    const ageRadius = Math.min(age / (60 * 60 * 1000), 0.3); // Max 0.3 from age

    // Low relevance pushes toward periphery
    const relevanceRadius = (1 - entry.relevance.overall) * 0.2;

    // Total radius from origin
    const totalRadius = Math.min(typeRadius + ageRadius + relevanceRadius, 0.95);

    // Create directional embedding based on entry features
    // Use different dimensions for different features
    const hash = this.hashString(entry.id);
    for (let i = 0; i < dims; i++) {
      const angle = (hash * (i + 1) * 2 * Math.PI) / dims;
      embedding[i] = totalRadius * Math.cos(angle + i * 0.1) / Math.sqrt(dims);
    }

    return this.poincare.project(embedding);
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash) / 2147483647; // Normalize to 0-1
  }
}
