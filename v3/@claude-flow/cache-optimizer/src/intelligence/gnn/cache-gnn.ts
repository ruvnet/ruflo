/**
 * @claude-flow/cache-optimizer - GNN-Based Cache Intelligence
 *
 * Graph Neural Network for learning cache entry relationships,
 * access patterns, and semantic dependencies.
 *
 * Implements:
 * - GCN (Graph Convolutional Networks) for dependency propagation
 * - GAT (Graph Attention Networks) for learned attention weights
 * - Message Passing for multi-hop relationship inference
 */

import type { CacheEntry, CacheEntryType } from '../../types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Graph node representing a cache entry
 */
export interface CacheNode {
  /** Node ID (cache entry ID) */
  id: string;
  /** Feature vector */
  features: number[];
  /** Entry type */
  type: CacheEntryType;
  /** Access count */
  accessCount: number;
  /** Last access timestamp */
  lastAccess: number;
  /** Creation timestamp */
  createdAt: number;
  /** Metadata for context */
  metadata: {
    filePath?: string;
    toolName?: string;
    sessionId: string;
    tags: string[];
  };
}

/**
 * Edge representing relationship between cache entries
 */
export interface CacheEdge {
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Edge type */
  type: EdgeType;
  /** Edge weight (strength of relationship) */
  weight: number;
  /** Creation timestamp */
  createdAt: number;
}

/**
 * Types of relationships between cache entries
 */
export type EdgeType =
  | 'sequential'      // Accessed in sequence
  | 'co_access'       // Frequently accessed together
  | 'same_file'       // Same file path
  | 'same_session'    // Same session
  | 'same_tool'       // Same tool
  | 'semantic'        // Semantic similarity
  | 'dependency';     // Code dependency

/**
 * GNN layer configuration
 */
export interface GNNLayerConfig {
  inputDim: number;
  outputDim: number;
  numHeads?: number;
  dropout?: number;
  aggregation?: 'mean' | 'sum' | 'max' | 'attention';
  activation?: 'relu' | 'gelu' | 'tanh' | 'none';
}

/**
 * Cache relationship graph
 */
export interface CacheGraph {
  nodes: Map<string, CacheNode>;
  edges: CacheEdge[];
  nodeFeatures: Map<string, number[]>;
  adjacency: Map<string, Set<string>>;
}

/**
 * GNN prediction result
 */
export interface GNNPrediction {
  /** Predicted relevance scores */
  relevanceScores: Map<string, number>;
  /** Predicted access probability */
  accessProbability: Map<string, number>;
  /** Cluster assignments */
  clusters: Map<string, number>;
  /** Node embeddings */
  embeddings: Map<string, number[]>;
  /** Inference time (ms) */
  inferenceTimeMs: number;
}

/**
 * GNN-specific learning metrics
 */
export interface GNNLearningMetrics {
  /** Total edges in graph */
  totalEdges: number;
  /** Total nodes in graph */
  totalNodes: number;
  /** Average node degree */
  avgDegree: number;
  /** Graph density */
  density: number;
  /** Number of clusters */
  numClusters: number;
  /** Learning iterations */
  iterations: number;
  /** Convergence status */
  converged: boolean;
  /** Last update timestamp */
  lastUpdate: number;
}

// ============================================================================
// Feature Extraction
// ============================================================================

/**
 * Extract feature vector from cache entry
 */
export function extractNodeFeatures(entry: CacheEntry): number[] {
  const features: number[] = [];
  const now = Date.now();

  // Type encoding (one-hot, 9 types)
  const typeIndex = getTypeIndex(entry.type);
  for (let i = 0; i < 9; i++) {
    features.push(i === typeIndex ? 1 : 0);
  }

  // Temporal features
  const ageMs = now - entry.timestamp;
  const lastAccessMs = now - entry.lastAccessedAt;
  features.push(Math.exp(-ageMs / (30 * 60 * 1000)));        // Age decay (30 min half-life)
  features.push(Math.exp(-lastAccessMs / (10 * 60 * 1000))); // Recency decay (10 min)

  // Access patterns
  features.push(Math.log10(entry.accessCount + 1) / 3);      // Normalized access count

  // Token size (normalized)
  features.push(Math.min(entry.tokens / 10000, 1));

  // Tier encoding (one-hot, 4 tiers)
  const tierIndex = getTierIndex(entry.tier);
  for (let i = 0; i < 4; i++) {
    features.push(i === tierIndex ? 1 : 0);
  }

  // Relevance score components
  if (entry.relevance) {
    features.push(entry.relevance.overall);
    features.push(entry.relevance.components.recency);
    features.push(entry.relevance.components.frequency);
    features.push(entry.relevance.components.semantic);
    features.push(entry.relevance.components.attention);
    features.push(entry.relevance.confidence);
  } else {
    features.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5);
  }

  // Metadata features
  features.push(entry.metadata.filePath ? 1 : 0);
  features.push(entry.metadata.toolName ? 1 : 0);
  features.push(Math.min(entry.metadata.tags.length / 5, 1));
  features.push(entry.metadata.priorityBoost ? Math.min(entry.metadata.priorityBoost / 10, 1) : 0);

  // Compression status
  features.push(entry.compressed ? 1 : 0);
  features.push(entry.compressed ? entry.compressed.ratio : 1);

  // Embedding presence
  features.push(entry.embedding ? 1 : 0);

  return features;
}

function getTypeIndex(type: CacheEntryType): number {
  const types: CacheEntryType[] = [
    'system_prompt', 'claude_md', 'file_read', 'file_write',
    'tool_result', 'bash_output', 'user_message', 'assistant_message', 'mcp_context'
  ];
  return types.indexOf(type);
}

function getTierIndex(tier: string): number {
  const tiers = ['hot', 'warm', 'cold', 'archived'];
  return tiers.indexOf(tier);
}

// ============================================================================
// CacheGNN Class
// ============================================================================

/**
 * Graph Neural Network for cache relationship learning
 */
export class CacheGNN {
  private graph: CacheGraph;
  private config: GNNLayerConfig;
  /** Learning rate for gradient updates */
  public learningRate: number;
  private metrics: GNNLearningMetrics;
  private weights: Map<string, number[][]>;

  // Access pattern tracking
  private accessSequence: string[] = [];
  private coAccessWindow: number = 60000; // 1 minute window
  private maxSequenceLength: number = 1000;

  constructor(config: Partial<GNNLayerConfig> = {}) {
    this.config = {
      inputDim: config.inputDim ?? 32,
      outputDim: config.outputDim ?? 16,
      numHeads: config.numHeads ?? 4,
      dropout: config.dropout ?? 0.1,
      aggregation: config.aggregation ?? 'attention',
      activation: config.activation ?? 'gelu',
    };

    this._learningRate = 0.01;
    this.graph = {
      nodes: new Map(),
      edges: [],
      nodeFeatures: new Map(),
      adjacency: new Map(),
    };

    this.metrics = {
      totalEdges: 0,
      totalNodes: 0,
      avgDegree: 0,
      density: 0,
      numClusters: 0,
      iterations: 0,
      converged: false,
      lastUpdate: Date.now(),
    };

    this.weights = new Map();
    this.initializeWeights();
  }

  /**
   * Initialize network weights
   */
  private initializeWeights(): void {
    // Xavier initialization for GCN layer
    const gcnWeights = this.xavierInit(this.config.inputDim, this.config.outputDim);
    this.weights.set('gcn', gcnWeights);

    // Attention weights for each head
    for (let h = 0; h < (this.config.numHeads ?? 1); h++) {
      const attentionWeights = this.xavierInit(this.config.outputDim * 2, 1);
      this.weights.set(`attention_${h}`, attentionWeights);
    }

    // Output projection
    const outputWeights = this.xavierInit(
      this.config.outputDim * (this.config.numHeads ?? 1),
      this.config.outputDim
    );
    this.weights.set('output', outputWeights);
  }

  private xavierInit(inputDim: number, outputDim: number): number[][] {
    const scale = Math.sqrt(2 / (inputDim + outputDim));
    const weights: number[][] = [];
    for (let i = 0; i < inputDim; i++) {
      const row: number[] = [];
      for (let j = 0; j < outputDim; j++) {
        row.push((Math.random() * 2 - 1) * scale);
      }
      weights.push(row);
    }
    return weights;
  }

  /**
   * Add a cache entry to the graph
   */
  addNode(entry: CacheEntry): void {
    const features = extractNodeFeatures(entry);

    const node: CacheNode = {
      id: entry.id,
      features,
      type: entry.type,
      accessCount: entry.accessCount,
      lastAccess: entry.lastAccessedAt,
      createdAt: entry.timestamp,
      metadata: {
        filePath: entry.metadata.filePath,
        toolName: entry.metadata.toolName,
        sessionId: entry.metadata.sessionId,
        tags: entry.metadata.tags,
      },
    };

    this.graph.nodes.set(entry.id, node);
    this.graph.nodeFeatures.set(entry.id, features);

    if (!this.graph.adjacency.has(entry.id)) {
      this.graph.adjacency.set(entry.id, new Set());
    }

    // Track access sequence for temporal edges
    this.trackAccess(entry.id);

    // Discover relationships with existing nodes
    this.discoverRelationships(entry);

    this.updateMetrics();
  }

  /**
   * Track access for sequential pattern learning
   */
  private trackAccess(nodeId: string): void {
    this.accessSequence.push(nodeId);

    // Limit sequence length
    if (this.accessSequence.length > this.maxSequenceLength) {
      this.accessSequence = this.accessSequence.slice(-this.maxSequenceLength);
    }

    // Create sequential edge to previous node
    if (this.accessSequence.length > 1) {
      const prevId = this.accessSequence[this.accessSequence.length - 2];
      if (prevId !== nodeId) {
        this.addEdge(prevId, nodeId, 'sequential', 0.5);
      }
    }
  }

  /**
   * Discover relationships between new node and existing nodes
   */
  private discoverRelationships(entry: CacheEntry): void {
    const _now = Date.now();

    for (const [otherId, otherNode] of this.graph.nodes) {
      if (otherId === entry.id) continue;

      // Same file path
      if (entry.metadata.filePath && otherNode.metadata.filePath === entry.metadata.filePath) {
        this.addEdge(entry.id, otherId, 'same_file', 0.8);
      }

      // Same session
      if (entry.metadata.sessionId === otherNode.metadata.sessionId) {
        this.addEdge(entry.id, otherId, 'same_session', 0.3);
      }

      // Same tool
      if (entry.metadata.toolName && otherNode.metadata.toolName === entry.metadata.toolName) {
        this.addEdge(entry.id, otherId, 'same_tool', 0.5);
      }

      // Co-access (accessed within time window)
      const timeDiff = Math.abs(entry.lastAccessedAt - otherNode.lastAccess);
      if (timeDiff < this.coAccessWindow) {
        const weight = Math.exp(-timeDiff / this.coAccessWindow);
        this.addEdge(entry.id, otherId, 'co_access', weight);
      }

      // Semantic similarity (if embeddings available)
      if (entry.embedding && this.graph.nodes.get(otherId)) {
        const otherEntry = this.graph.nodes.get(otherId);
        if (otherEntry && entry.embedding) {
          const similarity = this.cosineSimilarity(
            Array.from(entry.embedding),
            otherEntry.features.slice(0, entry.embedding.length)
          );
          if (similarity > 0.7) {
            this.addEdge(entry.id, otherId, 'semantic', similarity);
          }
        }
      }
    }
  }

  /**
   * Add or update an edge
   */
  addEdge(source: string, target: string, type: EdgeType, weight: number): void {
    // Check if edge exists
    const existingIdx = this.graph.edges.findIndex(
      e => e.source === source && e.target === target && e.type === type
    );

    if (existingIdx >= 0) {
      // Update weight (exponential moving average)
      this.graph.edges[existingIdx] = {
        ...this.graph.edges[existingIdx],
        weight: 0.7 * this.graph.edges[existingIdx].weight + 0.3 * weight,
      };
    } else {
      // Add new edge
      this.graph.edges.push({
        source,
        target,
        type,
        weight,
        createdAt: Date.now(),
      });

      // Update adjacency
      if (!this.graph.adjacency.has(source)) {
        this.graph.adjacency.set(source, new Set());
      }
      if (!this.graph.adjacency.has(target)) {
        this.graph.adjacency.set(target, new Set());
      }
      this.graph.adjacency.get(source)!.add(target);
      this.graph.adjacency.get(target)!.add(source);
    }
  }

  /**
   * Remove a node from the graph
   */
  removeNode(nodeId: string): void {
    this.graph.nodes.delete(nodeId);
    this.graph.nodeFeatures.delete(nodeId);

    // Remove edges involving this node
    this.graph.edges = this.graph.edges.filter(
      e => e.source !== nodeId && e.target !== nodeId
    );

    // Update adjacency
    this.graph.adjacency.delete(nodeId);
    for (const neighbors of this.graph.adjacency.values()) {
      neighbors.delete(nodeId);
    }

    this.updateMetrics();
  }

  /**
   * Forward pass through GNN
   */
  async forward(): Promise<GNNPrediction> {
    const startTime = Date.now();

    if (this.graph.nodes.size === 0) {
      return {
        relevanceScores: new Map(),
        accessProbability: new Map(),
        clusters: new Map(),
        embeddings: new Map(),
        inferenceTimeMs: 0,
      };
    }

    // Build node feature matrix
    const nodeIds = Array.from(this.graph.nodes.keys());
    const features = nodeIds.map(id => this.graph.nodeFeatures.get(id) ?? []);

    // Pad features to input dimension
    const paddedFeatures = features.map(f => {
      if (f.length < this.config.inputDim) {
        return [...f, ...new Array(this.config.inputDim - f.length).fill(0)];
      }
      return f.slice(0, this.config.inputDim);
    });

    // GCN layer: aggregate neighbor features
    const gcnOutput = this.gcnLayer(paddedFeatures, nodeIds);

    // GAT layer: attention-weighted aggregation
    const gatOutput = this.gatLayer(gcnOutput, nodeIds);

    // Output projection
    const embeddings = this.projectOutput(gatOutput);

    // Compute predictions from embeddings
    const relevanceScores = new Map<string, number>();
    const accessProbability = new Map<string, number>();
    const embeddingsMap = new Map<string, number[]>();

    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i];
      const embedding = embeddings[i];

      embeddingsMap.set(nodeId, embedding);

      // Relevance score: L2 norm of embedding
      const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
      relevanceScores.set(nodeId, Math.min(norm / 2, 1));

      // Access probability: sigmoid of first embedding component
      const prob = 1 / (1 + Math.exp(-embedding[0]));
      accessProbability.set(nodeId, prob);
    }

    // Simple clustering based on embedding similarity
    const clusters = this.clusterNodes(embeddingsMap);

    return {
      relevanceScores,
      accessProbability,
      clusters,
      embeddings: embeddingsMap,
      inferenceTimeMs: Date.now() - startTime,
    };
  }

  /**
   * GCN layer: graph convolution
   */
  private gcnLayer(features: number[][], nodeIds: string[]): number[][] {
    const output: number[][] = [];
    const weights = this.weights.get('gcn') ?? [];

    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i];
      const neighbors = this.graph.adjacency.get(nodeId) ?? new Set();

      // Self feature
      let aggregated = [...features[i]];

      // Aggregate neighbor features
      if (neighbors.size > 0) {
        const neighborFeatures = Array.from(neighbors)
          .map(nId => {
            const idx = nodeIds.indexOf(nId);
            return idx >= 0 ? features[idx] : null;
          })
          .filter((f): f is number[] => f !== null);

        if (neighborFeatures.length > 0) {
          // Mean aggregation
          const meanNeighbor = this.meanPool(neighborFeatures);
          // Combine with self
          aggregated = aggregated.map((v, j) => 0.5 * v + 0.5 * (meanNeighbor[j] ?? 0));
        }
      }

      // Apply weights and activation
      const projected = this.matmul(aggregated, weights);
      const activated = projected.map(v => this.applyActivation(v));

      output.push(activated);
    }

    return output;
  }

  /**
   * GAT layer: graph attention
   */
  private gatLayer(features: number[][], nodeIds: string[]): number[][] {
    const numHeads = this.config.numHeads ?? 1;
    const headOutputs: number[][][] = [];

    for (let h = 0; h < numHeads; h++) {
      const attentionWeights = this.weights.get(`attention_${h}`) ?? [];
      const headOutput: number[][] = [];

      for (let i = 0; i < nodeIds.length; i++) {
        const nodeId = nodeIds[i];
        const neighbors = this.graph.adjacency.get(nodeId) ?? new Set();
        const selfFeatures = features[i];

        if (neighbors.size === 0) {
          headOutput.push(selfFeatures);
          continue;
        }

        // Compute attention scores
        const neighborList = Array.from(neighbors);
        const attentionScores: number[] = [];
        const neighborFeaturesList: number[][] = [];

        for (const neighborId of neighborList) {
          const neighborIdx = nodeIds.indexOf(neighborId);
          if (neighborIdx < 0) continue;

          const neighborFeatures = features[neighborIdx];
          neighborFeaturesList.push(neighborFeatures);

          // Concatenate features and compute attention
          const concat = [...selfFeatures, ...neighborFeatures];
          const score = this.matmul(concat, attentionWeights)[0] ?? 0;
          attentionScores.push(score);
        }

        // Softmax over attention scores
        const softmaxScores = this.softmax(attentionScores);

        // Weighted sum of neighbor features
        const aggregated = new Array(selfFeatures.length).fill(0);
        for (let j = 0; j < neighborFeaturesList.length; j++) {
          const weight = softmaxScores[j];
          for (let k = 0; k < selfFeatures.length; k++) {
            aggregated[k] += weight * (neighborFeaturesList[j][k] ?? 0);
          }
        }

        // Combine with self
        const combined = selfFeatures.map((v, k) => 0.3 * v + 0.7 * aggregated[k]);
        headOutput.push(combined);
      }

      headOutputs.push(headOutput);
    }

    // Concatenate head outputs
    const output: number[][] = [];
    for (let i = 0; i < nodeIds.length; i++) {
      const concatenated: number[] = [];
      for (let h = 0; h < numHeads; h++) {
        concatenated.push(...headOutputs[h][i]);
      }
      output.push(concatenated);
    }

    return output;
  }

  /**
   * Project to output dimension
   */
  private projectOutput(features: number[][]): number[][] {
    const weights = this.weights.get('output') ?? [];
    return features.map(f => {
      const projected = this.matmul(f, weights);
      return projected.map(v => this.applyActivation(v));
    });
  }

  /**
   * Cluster nodes based on embedding similarity
   */
  private clusterNodes(embeddings: Map<string, number[]>): Map<string, number> {
    const clusters = new Map<string, number>();
    const nodeIds = Array.from(embeddings.keys());

    if (nodeIds.length === 0) return clusters;

    // Simple k-means clustering (k = sqrt(n))
    const k = Math.max(2, Math.floor(Math.sqrt(nodeIds.length)));

    // Initialize centroids randomly
    const centroids: number[][] = [];
    const shuffled = [...nodeIds].sort(() => Math.random() - 0.5);
    for (let i = 0; i < k && i < shuffled.length; i++) {
      centroids.push(embeddings.get(shuffled[i]) ?? []);
    }

    // Assign nodes to nearest centroid
    for (const nodeId of nodeIds) {
      const embedding = embeddings.get(nodeId) ?? [];
      let minDist = Infinity;
      let cluster = 0;

      for (let c = 0; c < centroids.length; c++) {
        const dist = this.euclideanDistance(embedding, centroids[c]);
        if (dist < minDist) {
          minDist = dist;
          cluster = c;
        }
      }

      clusters.set(nodeId, cluster);
    }

    this.metrics.numClusters = centroids.length;
    return clusters;
  }

  // ============================================================================
  // Utility Functions
  // ============================================================================

  private meanPool(vectors: number[][]): number[] {
    if (vectors.length === 0) return [];
    const dim = vectors[0].length;
    const result = new Array(dim).fill(0);
    for (const vec of vectors) {
      for (let i = 0; i < dim; i++) {
        result[i] += (vec[i] ?? 0) / vectors.length;
      }
    }
    return result;
  }

  private matmul(vector: number[], matrix: number[][]): number[] {
    if (matrix.length === 0) return vector;
    const outputDim = matrix[0]?.length ?? 0;
    const result = new Array(outputDim).fill(0);

    for (let j = 0; j < outputDim; j++) {
      for (let i = 0; i < vector.length && i < matrix.length; i++) {
        result[j] += vector[i] * (matrix[i]?.[j] ?? 0);
      }
    }

    return result;
  }

  private softmax(values: number[]): number[] {
    if (values.length === 0) return [];
    const max = Math.max(...values);
    const exps = values.map(v => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sum);
  }

  private applyActivation(x: number): number {
    switch (this.config.activation) {
      case 'relu':
        return Math.max(0, x);
      case 'gelu':
        return 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * Math.pow(x, 3))));
      case 'tanh':
        return Math.tanh(x);
      case 'none':
      default:
        return x;
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(a.length, b.length);

    for (let i = 0; i < len; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dotProduct / denom : 0;
  }

  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      sum += Math.pow(a[i] - b[i], 2);
    }
    return Math.sqrt(sum);
  }

  private updateMetrics(): void {
    this.metrics.totalNodes = this.graph.nodes.size;
    this.metrics.totalEdges = this.graph.edges.length;

    // Average degree
    let totalDegree = 0;
    for (const neighbors of this.graph.adjacency.values()) {
      totalDegree += neighbors.size;
    }
    this.metrics.avgDegree = this.metrics.totalNodes > 0
      ? totalDegree / this.metrics.totalNodes
      : 0;

    // Graph density
    const maxEdges = this.metrics.totalNodes * (this.metrics.totalNodes - 1) / 2;
    this.metrics.density = maxEdges > 0
      ? this.metrics.totalEdges / maxEdges
      : 0;

    this.metrics.lastUpdate = Date.now();
    this.metrics.iterations++;
  }

  /**
   * Get learning metrics
   */
  getMetrics(): GNNLearningMetrics {
    return { ...this.metrics };
  }

  /**
   * Get graph summary
   */
  getGraphSummary(): {
    nodes: number;
    edges: number;
    edgesByType: Record<EdgeType, number>;
    avgDegree: number;
  } {
    const edgesByType: Record<EdgeType, number> = {
      sequential: 0,
      co_access: 0,
      same_file: 0,
      same_session: 0,
      same_tool: 0,
      semantic: 0,
      dependency: 0,
    };

    for (const edge of this.graph.edges) {
      edgesByType[edge.type]++;
    }

    return {
      nodes: this.graph.nodes.size,
      edges: this.graph.edges.length,
      edgesByType,
      avgDegree: this.metrics.avgDegree,
    };
  }

  /**
   * Prune old edges
   */
  pruneOldEdges(maxAgeMs: number = 30 * 60 * 1000): number {
    const now = Date.now();
    const initialCount = this.graph.edges.length;

    this.graph.edges = this.graph.edges.filter(edge => {
      return now - edge.createdAt < maxAgeMs;
    });

    // Rebuild adjacency
    this.graph.adjacency.clear();
    for (const nodeId of this.graph.nodes.keys()) {
      this.graph.adjacency.set(nodeId, new Set());
    }
    for (const edge of this.graph.edges) {
      this.graph.adjacency.get(edge.source)?.add(edge.target);
      this.graph.adjacency.get(edge.target)?.add(edge.source);
    }

    this.updateMetrics();
    return initialCount - this.graph.edges.length;
  }

  /**
   * Export graph for persistence
   */
  exportGraph(): {
    nodes: Array<[string, CacheNode]>;
    edges: CacheEdge[];
    metrics: GNNLearningMetrics;
  } {
    return {
      nodes: Array.from(this.graph.nodes.entries()),
      edges: this.graph.edges,
      metrics: this.metrics,
    };
  }

  /**
   * Import graph from persistence
   */
  importGraph(data: {
    nodes: Array<[string, CacheNode]>;
    edges: CacheEdge[];
    metrics?: GNNLearningMetrics;
  }): void {
    this.graph.nodes = new Map(data.nodes);
    this.graph.edges = data.edges;

    // Rebuild nodeFeatures and adjacency
    this.graph.nodeFeatures.clear();
    this.graph.adjacency.clear();

    for (const [id, node] of this.graph.nodes) {
      this.graph.nodeFeatures.set(id, node.features);
      this.graph.adjacency.set(id, new Set());
    }

    for (const edge of this.graph.edges) {
      this.graph.adjacency.get(edge.source)?.add(edge.target);
      this.graph.adjacency.get(edge.target)?.add(edge.source);
    }

    if (data.metrics) {
      this.metrics = data.metrics;
    } else {
      this.updateMetrics();
    }
  }
}

/**
 * Create a new CacheGNN instance
 */
export function createCacheGNN(config?: Partial<GNNLayerConfig>): CacheGNN {
  return new CacheGNN(config);
}
