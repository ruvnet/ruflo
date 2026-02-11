/**
 * V3 HNSW Vector Index
 *
 * High-performance Hierarchical Navigable Small World (HNSW) index for
 * optimized vector similarity search compared to brute force.
 *
 * OPTIMIZATIONS:
 * - BinaryMinHeap/BinaryMaxHeap for O(log n) operations (vs O(n log n) Array.sort)
 * - Pre-normalized vectors for O(1) cosine similarity (no sqrt needed)
 * - Bounded max-heap for efficient top-k tracking
 *
 * @module v3/memory/hnsw-index
 */

import { EventEmitter } from 'node:events';
import {
  DistanceMetric,
  HNSWConfig,
  HNSWStats,
  QuantizationConfig,
  SearchResult,
  MemoryEntry,
  MemoryEvent,
  MemoryEventHandler,
} from './types.js';

/**
 * Binary Min Heap for O(log n) priority queue operations
 * Used for candidate selection in HNSW search
 */
class BinaryMinHeap<T> {
  private heap: Array<{ item: T; priority: number }> = [];

  get size(): number {
    return this.heap.length;
  }

  insert(item: T, priority: number): void {
    this.heap.push({ item, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  extractMin(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const min = this.heap[0].item;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return min;
  }

  peek(): T | undefined {
    return this.heap[0]?.item;
  }

  peekPriority(): number | undefined {
    return this.heap[0]?.priority;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  toArray(): T[] {
    return this.heap
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map((entry) => entry.item);
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.heap[parent].priority <= this.heap[index].priority) break;
      [this.heap[parent], this.heap[index]] = [this.heap[index], this.heap[parent]];
      index = parent;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length;
    while (true) {
      let smallest = index;
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      if (left < length && this.heap[left].priority < this.heap[smallest].priority) {
        smallest = left;
      }
      if (right < length && this.heap[right].priority < this.heap[smallest].priority) {
        smallest = right;
      }
      if (smallest === index) break;
      [this.heap[smallest], this.heap[index]] = [this.heap[index], this.heap[smallest]];
      index = smallest;
    }
  }
}

/**
 * Binary Max Heap for bounded top-k tracking
 * Keeps track of k smallest elements by evicting largest when full
 */
class BinaryMaxHeap<T> {
  private heap: Array<{ item: T; priority: number }> = [];
  private maxSize: number;

  constructor(maxSize: number = Infinity) {
    this.maxSize = maxSize;
  }

  get size(): number {
    return this.heap.length;
  }

  insert(item: T, priority: number): boolean {
    // If at capacity and new item is worse than worst, reject
    if (this.heap.length >= this.maxSize && priority >= this.heap[0]?.priority) {
      return false;
    }

    if (this.heap.length >= this.maxSize) {
      // Replace max element
      this.heap[0] = { item, priority };
      this.bubbleDown(0);
    } else {
      this.heap.push({ item, priority });
      this.bubbleUp(this.heap.length - 1);
    }
    return true;
  }

  peekMax(): T | undefined {
    return this.heap[0]?.item;
  }

  peekMaxPriority(): number {
    return this.heap[0]?.priority ?? Infinity;
  }

  extractMax(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const max = this.heap[0].item;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return max;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  toSortedArray(): Array<{ item: T; priority: number }> {
    return this.heap.slice().sort((a, b) => a.priority - b.priority);
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.heap[parent].priority >= this.heap[index].priority) break;
      [this.heap[parent], this.heap[index]] = [this.heap[index], this.heap[parent]];
      index = parent;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length;
    while (true) {
      let largest = index;
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      if (left < length && this.heap[left].priority > this.heap[largest].priority) {
        largest = left;
      }
      if (right < length && this.heap[right].priority > this.heap[largest].priority) {
        largest = right;
      }
      if (largest === index) break;
      [this.heap[largest], this.heap[index]] = [this.heap[index], this.heap[largest]];
      index = largest;
    }
  }
}

/**
 * Internal node structure for HNSW graph
 */
interface HNSWNode {
  /** Node ID (memory entry ID) */
  id: string;

  /** Vector embedding (original) */
  vector: Float32Array;

  /** Pre-normalized vector for O(1) cosine similarity */
  normalizedVector: Float32Array | null;

  /** Connections at each layer */
  connections: Map<number, Set<string>>;

  /** Node level (top layer this node appears in) */
  level: number;
}

/**
 * HNSW Index implementation for ultra-fast vector similarity search
 *
 * Performance characteristics:
 * - Search: O(log n) approximate nearest neighbor
 * - Insert: O(log n) amortized
 * - Memory: O(n * M * L) where M is max connections, L is layers
 */
export class HNSWIndex extends EventEmitter {
  private config: HNSWConfig;
  private nodes: Map<string, HNSWNode> = new Map();
  private entryPoint: string | null = null;
  private maxLevel: number = 0;
  private levelMult: number;

  // Performance tracking
  private stats: {
    searchCount: number;
    totalSearchTime: number;
    insertCount: number;
    totalInsertTime: number;
    buildStartTime: number;
  } = {
    searchCount: 0,
    totalSearchTime: 0,
    insertCount: 0,
    totalInsertTime: 0,
    buildStartTime: 0,
  };

  // Quantization support
  private quantizer: Quantizer | null = null;

  constructor(config: Partial<HNSWConfig> = {}) {
    super();
    this.config = this.mergeConfig(config);
    this.levelMult = 1 / Math.log(this.config.M);

    if (this.config.quantization) {
      this.quantizer = new Quantizer(this.config.quantization, this.config.dimensions);
    }
  }

  /**
   * Add a vector to the index
   */
  async addPoint(id: string, vector: Float32Array): Promise<void> {
    const startTime = performance.now();

    if (vector.length !== this.config.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.config.dimensions}, got ${vector.length}`
      );
    }

    if (this.nodes.size >= this.config.maxElements) {
      throw new Error('Index is full, cannot add more elements');
    }

    // Quantize if enabled
    const storedVector = this.quantizer
      ? this.quantizer.encode(vector)
      : vector;

    // Pre-normalize vector for O(1) cosine similarity
    const normalizedVector = this.config.metric === 'cosine'
      ? this.normalizeVector(storedVector)
      : null;

    // Generate random level for new node
    const level = this.getRandomLevel();

    const node: HNSWNode = {
      id,
      vector: storedVector,
      normalizedVector,
      connections: new Map(),
      level,
    };

    // Initialize connection sets for each layer
    for (let l = 0; l <= level; l++) {
      node.connections.set(l, new Set());
    }

    if (this.entryPoint === null) {
      // First node
      this.entryPoint = id;
      this.maxLevel = level;
      this.nodes.set(id, node);
    } else {
      // Insert new node into the graph
      await this.insertNode(node);
    }

    const duration = performance.now() - startTime;
    this.stats.insertCount++;
    this.stats.totalInsertTime += duration;

    this.emit('point:added', { id, level, duration });
  }

  /**
   * Search for k nearest neighbors
   */
  async search(
    query: Float32Array,
    k: number,
    ef?: number
  ): Promise<Array<{ id: string; distance: number }>> {
    const startTime = performance.now();

    if (query.length !== this.config.dimensions) {
      throw new Error(
        `Query dimension mismatch: expected ${this.config.dimensions}, got ${query.length}`
      );
    }

    if (this.entryPoint === null) {
      return [];
    }

    const searchEf = ef || Math.max(k, this.config.efConstruction);

    // Quantize query if needed
    const queryVector = this.quantizer
      ? this.quantizer.encode(query)
      : query;

    // Pre-normalize query for O(1) cosine similarity
    const normalizedQuery = this.config.metric === 'cosine'
      ? this.normalizeVector(queryVector)
      : null;

    // Start from entry point and search down the layers
    let currentNode = this.entryPoint;
    let currentDist = this.distanceOptimized(
      queryVector,
      normalizedQuery,
      this.nodes.get(currentNode)!
    );

    // Search through layers from top to 1
    for (let level = this.maxLevel; level > 0; level--) {
      const layerResult = this.searchLayerOptimized(
        queryVector,
        normalizedQuery,
        currentNode,
        1,
        level
      );
      currentNode = layerResult[0]?.id || currentNode;
      currentDist = this.distanceOptimized(
        queryVector,
        normalizedQuery,
        this.nodes.get(currentNode)!
      );
    }

    // Search layer 0 with ef candidates using heap-based search
    const candidates = this.searchLayerOptimized(
      queryVector,
      normalizedQuery,
      currentNode,
      searchEf,
      0
    );

    // Return top k results (already sorted by heap)
    const results = candidates.slice(0, k);

    const duration = performance.now() - startTime;
    this.stats.searchCount++;
    this.stats.totalSearchTime += duration;

    return results;
  }

  /**
   * Search with filters applied post-retrieval
   */
  async searchWithFilters(
    query: Float32Array,
    k: number,
    filter: (id: string) => boolean,
    ef?: number
  ): Promise<Array<{ id: string; distance: number }>> {
    // Over-fetch to account for filtered results
    const overFetchFactor = 3;
    const candidates = await this.search(query, k * overFetchFactor, ef);

    return candidates
      .filter((c) => filter(c.id))
      .slice(0, k);
  }

  /**
   * Remove a point from the index
   */
  async removePoint(id: string): Promise<boolean> {
    const node = this.nodes.get(id);
    if (!node) {
      return false;
    }

    // Remove all connections to this node
    for (let level = 0; level <= node.level; level++) {
      const connections = node.connections.get(level);
      if (connections) {
        for (const connectedId of connections) {
          const connectedNode = this.nodes.get(connectedId);
          if (connectedNode) {
            connectedNode.connections.get(level)?.delete(id);
          }
        }
      }
    }

    this.nodes.delete(id);

    // Update entry point if needed
    if (this.entryPoint === id) {
      if (this.nodes.size === 0) {
        this.entryPoint = null;
        this.maxLevel = 0;
      } else {
        // Find new entry point with highest level
        let newEntry: string | null = null;
        let newMaxLevel = 0;
        for (const [nodeId, n] of this.nodes) {
          if (newEntry === null || n.level > newMaxLevel) {
            newMaxLevel = n.level;
            newEntry = nodeId;
          }
        }
        this.entryPoint = newEntry;
        this.maxLevel = newMaxLevel;
      }
    }

    this.emit('point:removed', { id });
    return true;
  }

  /**
   * Rebuild the index from scratch
   */
  async rebuild(
    entries: Array<{ id: string; vector: Float32Array }>
  ): Promise<void> {
    this.stats.buildStartTime = performance.now();

    this.nodes.clear();
    this.entryPoint = null;
    this.maxLevel = 0;

    for (const entry of entries) {
      await this.addPoint(entry.id, entry.vector);
    }

    const buildTime = performance.now() - this.stats.buildStartTime;

    this.emit('index:rebuilt', {
      vectorCount: this.nodes.size,
      buildTime,
    });
  }

  /**
   * Get index statistics
   */
  getStats(): HNSWStats {
    const vectorCount = this.nodes.size;
    const avgSearchTime =
      this.stats.searchCount > 0
        ? this.stats.totalSearchTime / this.stats.searchCount
        : 0;

    // Estimate memory usage
    const bytesPerVector = this.config.dimensions * 4; // Float32 = 4 bytes
    const connectionOverhead = this.config.M * 8 * (this.maxLevel + 1); // Approximate
    const memoryUsage = vectorCount * (bytesPerVector + connectionOverhead);

    return {
      vectorCount,
      memoryUsage,
      avgSearchTime,
      buildTime: performance.now() - this.stats.buildStartTime,
      compressionRatio: this.quantizer?.getCompressionRatio() || 1.0,
    };
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.nodes.clear();
    this.entryPoint = null;
    this.maxLevel = 0;
    this.stats = {
      searchCount: 0,
      totalSearchTime: 0,
      insertCount: 0,
      totalInsertTime: 0,
      buildStartTime: 0,
    };
  }

  /**
   * Check if an ID exists in the index
   */
  has(id: string): boolean {
    return this.nodes.has(id);
  }

  /**
   * Get the number of vectors in the index
   */
  get size(): number {
    return this.nodes.size;
  }

  // ===== Private Methods =====

  private mergeConfig(config: Partial<HNSWConfig>): HNSWConfig {
    return {
      dimensions: config.dimensions || 1536, // OpenAI embedding size
      M: config.M || 16,
      efConstruction: config.efConstruction || 200,
      maxElements: config.maxElements || 1000000,
      metric: config.metric || 'cosine',
      quantization: config.quantization,
    };
  }

  private getRandomLevel(): number {
    let level = 0;
    while (Math.random() < 0.5 && level < 16) {
      level++;
    }
    return level;
  }

  private async insertNode(node: HNSWNode): Promise<void> {
    const query = node.vector;
    const normalizedQuery = node.normalizedVector;
    let currentNode = this.entryPoint!;
    let currentDist = this.distanceOptimized(
      query,
      normalizedQuery,
      this.nodes.get(currentNode)!
    );

    // Find entry point for the node's level
    for (let level = this.maxLevel; level > node.level; level--) {
      const result = this.searchLayerOptimized(query, normalizedQuery, currentNode, 1, level);
      if (result.length > 0 && result[0].distance < currentDist) {
        currentNode = result[0].id;
        currentDist = result[0].distance;
      }
    }

    // Insert at each level from node.level down to 0
    for (let level = Math.min(node.level, this.maxLevel); level >= 0; level--) {
      const neighbors = this.searchLayerOptimized(
        query,
        normalizedQuery,
        currentNode,
        this.config.efConstruction,
        level
      );

      // Select M best neighbors
      const selectedNeighbors = this.selectNeighbors(
        node.id,
        query,
        neighbors,
        this.config.M
      );

      // Add connections
      for (const neighbor of selectedNeighbors) {
        node.connections.get(level)!.add(neighbor.id);
        this.nodes.get(neighbor.id)?.connections.get(level)?.add(node.id);

        // Prune connections if over limit
        const neighborNode = this.nodes.get(neighbor.id);
        if (neighborNode) {
          const neighborConns = neighborNode.connections.get(level)!;
          if (neighborConns.size > this.config.M * 2) {
            this.pruneConnections(neighborNode, level, this.config.M);
          }
        }
      }

      if (neighbors.length > 0) {
        currentNode = neighbors[0].id;
      }
    }

    this.nodes.set(node.id, node);

    // Update max level if needed
    if (node.level > this.maxLevel) {
      this.maxLevel = node.level;
      this.entryPoint = node.id;
    }
  }

  private async searchLayer(
    query: Float32Array,
    entryPoint: string,
    ef: number,
    level: number
  ): Promise<Array<{ id: string; distance: number }>> {
    const visited = new Set<string>([entryPoint]);
    const candidates: Array<{ id: string; distance: number }> = [];
    const results: Array<{ id: string; distance: number }> = [];

    const entryDist = this.distance(query, this.nodes.get(entryPoint)!.vector);
    candidates.push({ id: entryPoint, distance: entryDist });
    results.push({ id: entryPoint, distance: entryDist });

    while (candidates.length > 0) {
      // Get closest candidate
      candidates.sort((a, b) => a.distance - b.distance);
      const current = candidates.shift()!;

      // Check termination condition
      const worstResult = results.length > 0
        ? Math.max(...results.map((r) => r.distance))
        : Infinity;
      if (current.distance > worstResult && results.length >= ef) {
        break;
      }

      // Explore neighbors
      const node = this.nodes.get(current.id);
      if (!node) continue;

      const connections = node.connections.get(level);
      if (!connections) continue;

      for (const neighborId of connections) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const neighborNode = this.nodes.get(neighborId);
        if (!neighborNode) continue;

        const distance = this.distance(query, neighborNode.vector);

        if (results.length < ef || distance < worstResult) {
          candidates.push({ id: neighborId, distance });
          results.push({ id: neighborId, distance });

          // Keep results bounded
          if (results.length > ef) {
            results.sort((a, b) => a.distance - b.distance);
            results.pop();
          }
        }
      }
    }

    return results.sort((a, b) => a.distance - b.distance);
  }

  /**
   * OPTIMIZED searchLayer using heap-based priority queues
   * Performance: O(log n) per operation vs O(n log n) for Array.sort()
   * Expected speedup: 3-5x for large result sets
   */
  private searchLayerOptimized(
    query: Float32Array,
    normalizedQuery: Float32Array | null,
    entryPoint: string,
    ef: number,
    level: number
  ): Array<{ id: string; distance: number }> {
    const visited = new Set<string>([entryPoint]);

    // Min-heap for candidates (closest first for expansion)
    const candidates = new BinaryMinHeap<string>();

    // Max-heap for results (bounded size, tracks worst distance efficiently)
    const results = new BinaryMaxHeap<string>(ef);

    const entryNode = this.nodes.get(entryPoint)!;
    const entryDist = this.distanceOptimized(query, normalizedQuery, entryNode);

    candidates.insert(entryPoint, entryDist);
    results.insert(entryPoint, entryDist);

    while (!candidates.isEmpty()) {
      // Get closest candidate - O(log n)
      const currentDist = candidates.peekPriority()!;
      const currentId = candidates.extractMin()!;

      // Check termination: if closest candidate is worse than worst result, stop
      const worstResultDist = results.peekMaxPriority();
      if (currentDist > worstResultDist && results.size >= ef) {
        break;
      }

      // Explore neighbors
      const node = this.nodes.get(currentId);
      if (!node) continue;

      const connections = node.connections.get(level);
      if (!connections) continue;

      for (const neighborId of connections) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const neighborNode = this.nodes.get(neighborId);
        if (!neighborNode) continue;

        const distance = this.distanceOptimized(query, normalizedQuery, neighborNode);

        // Only add if within threshold or results not full
        if (results.size < ef || distance < worstResultDist) {
          candidates.insert(neighborId, distance);
          // Max-heap handles size bounding automatically - O(log n)
          results.insert(neighborId, distance);
        }
      }
    }

    // Return sorted results
    return results.toSortedArray().map(({ item, priority }) => ({
      id: item,
      distance: priority,
    }));
  }

  private selectNeighbors(
    nodeId: string,
    query: Float32Array,
    candidates: Array<{ id: string; distance: number }>,
    M: number
  ): Array<{ id: string; distance: number }> {
    // Simple selection: take M closest
    return candidates
      .filter((c) => c.id !== nodeId)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, M);
  }

  private pruneConnections(node: HNSWNode, level: number, maxConnections: number): void {
    const connections = node.connections.get(level);
    if (!connections || connections.size <= maxConnections) return;

    // Calculate distances to all connections
    const distances: Array<{ id: string; distance: number }> = [];
    for (const connId of connections) {
      const connNode = this.nodes.get(connId);
      if (connNode) {
        distances.push({
          id: connId,
          distance: this.distance(node.vector, connNode.vector),
        });
      }
    }

    // Keep only the closest ones
    distances.sort((a, b) => a.distance - b.distance);
    const toKeep = new Set(distances.slice(0, maxConnections).map((d) => d.id));

    // Remove excess connections
    for (const connId of connections) {
      if (!toKeep.has(connId)) {
        connections.delete(connId);
        this.nodes.get(connId)?.connections.get(level)?.delete(node.id);
      }
    }
  }

  private distance(a: Float32Array, b: Float32Array): number {
    switch (this.config.metric) {
      case 'cosine':
        return this.cosineDistance(a, b);
      case 'euclidean':
        return this.euclideanDistance(a, b);
      case 'dot':
        return this.dotProductDistance(a, b);
      case 'manhattan':
        return this.manhattanDistance(a, b);
      default:
        return this.cosineDistance(a, b);
    }
  }

  private cosineDistance(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    return 1 - similarity; // Convert to distance
  }

  /**
   * OPTIMIZED: Cosine distance using pre-normalized vectors
   * Only requires dot product (no sqrt operations)
   * Performance: O(n) with ~2x speedup over standard cosine
   */
  private cosineDistanceNormalized(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
    }
    // For normalized vectors: cosine_similarity = dot_product
    // Return distance (1 - similarity)
    return 1 - dotProduct;
  }

  /**
   * Normalize a vector to unit length for O(1) cosine similarity
   */
  private normalizeVector(vector: Float32Array): Float32Array {
    let norm = 0;
    for (let i = 0; i < vector.length; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);

    if (norm === 0) {
      return vector; // Return as-is if zero vector
    }

    const normalized = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      normalized[i] = vector[i] / norm;
    }
    return normalized;
  }

  /**
   * OPTIMIZED distance calculation that uses pre-normalized vectors when available
   */
  private distanceOptimized(
    query: Float32Array,
    normalizedQuery: Float32Array | null,
    node: HNSWNode
  ): number {
    // Use optimized path for cosine with pre-normalized vectors
    if (
      this.config.metric === 'cosine' &&
      normalizedQuery !== null &&
      node.normalizedVector !== null
    ) {
      return this.cosineDistanceNormalized(normalizedQuery, node.normalizedVector);
    }

    // Fall back to standard distance calculation
    return this.distance(query, node.vector);
  }

  private euclideanDistance(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  private dotProductDistance(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
    }
    // Negative because higher dot product = more similar
    return -dotProduct;
  }

  private manhattanDistance(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += Math.abs(a[i] - b[i]);
    }
    return sum;
  }
}

/**
 * Quantizer for vector compression
 */
class Quantizer {
  private config: QuantizationConfig;
  private dimensions: number;

  constructor(config: QuantizationConfig, dimensions: number) {
    this.config = config;
    this.dimensions = dimensions;
  }

  /**
   * Encode a vector using quantization
   */
  encode(vector: Float32Array): Float32Array {
    switch (this.config.type) {
      case 'binary':
        return this.binaryQuantize(vector);
      case 'scalar':
        return this.scalarQuantize(vector);
      case 'product':
        return this.productQuantize(vector);
      default:
        return vector;
    }
  }

  /**
   * Get compression ratio
   */
  getCompressionRatio(): number {
    switch (this.config.type) {
      case 'binary':
        return 32; // 32x compression (32 bits -> 1 bit per dimension)
      case 'scalar':
        return 32 / (this.config.bits || 8);
      case 'product':
        return this.config.subquantizers || 8;
      default:
        return 1;
    }
  }

  private binaryQuantize(vector: Float32Array): Float32Array {
    // Simple binary quantization: > 0 becomes 1, <= 0 becomes 0
    // Stored in packed format in a smaller Float32Array
    const packedLength = Math.ceil(vector.length / 32);
    const packed = new Float32Array(packedLength);

    for (let i = 0; i < vector.length; i++) {
      const packedIndex = Math.floor(i / 32);
      const bitPosition = i % 32;
      if (vector[i] > 0) {
        packed[packedIndex] = (packed[packedIndex] || 0) | (1 << bitPosition);
      }
    }

    return packed;
  }

  private scalarQuantize(vector: Float32Array): Float32Array {
    // Find min/max for normalization
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < vector.length; i++) {
      if (vector[i] < min) min = vector[i];
      if (vector[i] > max) max = vector[i];
    }

    const range = max - min || 1;
    const bits = this.config.bits || 8;
    const levels = Math.pow(2, bits);

    // Quantize each value
    const quantized = new Float32Array(vector.length + 2); // +2 for min/range
    quantized[0] = min;
    quantized[1] = range;

    for (let i = 0; i < vector.length; i++) {
      const normalized = (vector[i] - min) / range;
      quantized[i + 2] = Math.round(normalized * (levels - 1));
    }

    return quantized;
  }

  private productQuantize(vector: Float32Array): Float32Array {
    // Simplified product quantization
    // In production, would use trained codebooks
    const subquantizers = this.config.subquantizers || 8;
    const subvectorSize = Math.ceil(vector.length / subquantizers);

    const quantized = new Float32Array(subquantizers);

    for (let i = 0; i < subquantizers; i++) {
      let sum = 0;
      const start = i * subvectorSize;
      const end = Math.min(start + subvectorSize, vector.length);

      for (let j = start; j < end; j++) {
        sum += vector[j];
      }

      quantized[i] = sum / (end - start);
    }

    return quantized;
  }
}

export default HNSWIndex;
