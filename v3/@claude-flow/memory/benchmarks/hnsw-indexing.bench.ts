/**
 * HNSW Indexing Benchmark
 *
 * Target: <10ms for index operations
 *
 * Measures HNSW index construction, updates, and maintenance performance.
 */

import { benchmark, BenchmarkRunner, formatTime, meetsTarget } from '../framework/benchmark.js';

// ============================================================================
// HNSW Implementation
// ============================================================================

interface HNSWConfig {
  dimensions: number;
  maxElements: number;
  M: number;                // Max connections per node
  efConstruction: number;   // Size of dynamic candidate list during construction
  mL: number;               // Level generation parameter
}

interface HNSWNode {
  id: number;
  vector: Float32Array;
  level: number;
  connections: Map<number, number[]>; // level -> neighbors
}

/**
 * HNSW Index implementation for benchmarking
 */
class HNSWIndex {
  private nodes: Map<number, HNSWNode> = new Map();
  private entryPoint: number | null = null;
  private maxLevel = 0;
  private config: HNSWConfig;

  constructor(config: Partial<HNSWConfig> = {}) {
    this.config = {
      dimensions: 384,
      maxElements: 100000,
      M: 16,
      efConstruction: 200,
      mL: 1 / Math.log(16),
      ...config,
    };
  }

  /**
   * Generate random level for new node
   */
  private randomLevel(): number {
    let level = 0;
    while (Math.random() < this.config.mL && level < Math.log2(this.config.maxElements)) {
      level++;
    }
    return level;
  }

  /**
   * Calculate distance between two vectors (using cosine similarity)
   */
  private distance(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
    }
    return 1 - dot; // Convert similarity to distance
  }

  /**
   * Add a vector to the index
   */
  add(id: number, vector: Float32Array): void {
    const level = this.randomLevel();
    const node: HNSWNode = {
      id,
      vector,
      level,
      connections: new Map(),
    };

    for (let l = 0; l <= level; l++) {
      node.connections.set(l, []);
    }

    if (this.entryPoint === null) {
      this.entryPoint = id;
      this.maxLevel = level;
      this.nodes.set(id, node);
      return;
    }

    // Find entry point for this level
    let currentNode = this.nodes.get(this.entryPoint)!;
    let currentLevel = this.maxLevel;

    // Greedy search down to target level
    while (currentLevel > level) {
      const neighbors = currentNode.connections.get(currentLevel) || [];
      let closest = currentNode;
      let closestDist = this.distance(vector, currentNode.vector);

      for (const neighborId of neighbors) {
        const neighbor = this.nodes.get(neighborId)!;
        const dist = this.distance(vector, neighbor.vector);
        if (dist < closestDist) {
          closest = neighbor;
          closestDist = dist;
        }
      }

      if (closest === currentNode) {
        currentLevel--;
      } else {
        currentNode = closest;
      }
    }

    // Insert at each level
    for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
      // Find neighbors at this level (simplified)
      const candidates = this.searchLayer(vector, currentNode.id, l, this.config.efConstruction);
      const neighbors = candidates.slice(0, this.config.M);

      // Connect node to neighbors
      node.connections.set(l, neighbors.map((n) => n.id));

      // Add reverse connections
      for (const { id: neighborId } of neighbors) {
        const neighbor = this.nodes.get(neighborId)!;
        const neighborConnections = neighbor.connections.get(l) || [];
        if (neighborConnections.length < this.config.M) {
          neighborConnections.push(id);
          neighbor.connections.set(l, neighborConnections);
        }
      }
    }

    this.nodes.set(id, node);

    if (level > this.maxLevel) {
      this.maxLevel = level;
      this.entryPoint = id;
    }
  }

  /**
   * Search at a specific layer
   */
  private searchLayer(
    query: Float32Array,
    entryId: number,
    level: number,
    ef: number
  ): Array<{ id: number; distance: number }> {
    const visited = new Set<number>([entryId]);
    const entryNode = this.nodes.get(entryId)!;
    const candidates = [{ id: entryId, distance: this.distance(query, entryNode.vector) }];
    const results = [...candidates];

    while (candidates.length > 0) {
      candidates.sort((a, b) => a.distance - b.distance);
      const current = candidates.shift()!;

      if (results.length >= ef && current.distance > results[results.length - 1]!.distance) {
        break;
      }

      const currentNode = this.nodes.get(current.id)!;
      const neighbors = currentNode.connections.get(level) || [];

      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const neighbor = this.nodes.get(neighborId)!;
        const dist = this.distance(query, neighbor.vector);

        if (results.length < ef || dist < results[results.length - 1]!.distance) {
          results.push({ id: neighborId, distance: dist });
          candidates.push({ id: neighborId, distance: dist });
          results.sort((a, b) => a.distance - b.distance);
          if (results.length > ef) {
            results.pop();
          }
        }
      }
    }

    return results;
  }

  /**
   * Search for k nearest neighbors
   */
  search(query: Float32Array, k: number, ef = 50): Array<{ id: number; distance: number }> {
    if (this.entryPoint === null) return [];

    let currentId = this.entryPoint;
    const currentNode = this.nodes.get(currentId)!;

    // Greedy descent to level 0
    for (let level = this.maxLevel; level > 0; level--) {
      const results = this.searchLayer(query, currentId, level, 1);
      if (results.length > 0) {
        currentId = results[0]!.id;
      }
    }

    // Search at level 0
    const results = this.searchLayer(query, currentId, 0, Math.max(ef, k));
    return results.slice(0, k);
  }

  /**
   * Remove a vector from the index
   */
  remove(id: number): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    // Remove all connections to this node
    for (const [level, neighbors] of node.connections) {
      for (const neighborId of neighbors) {
        const neighbor = this.nodes.get(neighborId);
        if (neighbor) {
          const neighborConns = neighbor.connections.get(level);
          if (neighborConns) {
            const idx = neighborConns.indexOf(id);
            if (idx >= 0) {
              neighborConns.splice(idx, 1);
            }
          }
        }
      }
    }

    this.nodes.delete(id);

    // Update entry point if needed
    if (this.entryPoint === id) {
      this.entryPoint = this.nodes.size > 0 ? this.nodes.keys().next().value : null;
      this.maxLevel = this.entryPoint !== null
        ? this.nodes.get(this.entryPoint)!.level
        : 0;
    }

    return true;
  }

  get size(): number {
    return this.nodes.size;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateVector(dim: number): Float32Array {
  const v = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    v[i] = Math.random() * 2 - 1;
    norm += v[i]! * v[i]!;
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) {
    v[i]! /= norm;
  }
  return v;
}

// ============================================================================
// Benchmark Suite
// ============================================================================

export async function runHNSWIndexingBenchmarks(): Promise<void> {
  const runner = new BenchmarkRunner('HNSW Indexing');

  console.log('\n--- HNSW Indexing Benchmarks ---\n');

  const dimensions = 384;

  // Benchmark 1: Single Vector Insert
  const singleInsertResult = await runner.run(
    'single-vector-insert',
    async () => {
      const index = new HNSWIndex({ dimensions });
      const vector = generateVector(dimensions);
      index.add(0, vector);
    },
    { iterations: 500 }
  );

  console.log(`Single Vector Insert: ${formatTime(singleInsertResult.mean)}`);
  const insertTarget = meetsTarget('hnsw-indexing', singleInsertResult.mean);
  console.log(`  Target (<10ms): ${insertTarget.met ? 'PASS' : 'FAIL'}`);

  // Benchmark 2: Batch Insert (100 vectors)
  const batch100Result = await runner.run(
    'batch-insert-100',
    async () => {
      const index = new HNSWIndex({ dimensions });
      const vectors = Array.from({ length: 100 }, () => generateVector(dimensions));
      for (let i = 0; i < vectors.length; i++) {
        index.add(i, vectors[i]!);
      }
    },
    { iterations: 20 }
  );

  console.log(`Batch Insert (100 vectors): ${formatTime(batch100Result.mean)}`);
  console.log(`  Per vector: ${formatTime(batch100Result.mean / 100)}`);

  // Benchmark 3: Batch Insert (1000 vectors)
  const batch1000Result = await runner.run(
    'batch-insert-1000',
    async () => {
      const index = new HNSWIndex({ dimensions });
      const vectors = Array.from({ length: 1000 }, () => generateVector(dimensions));
      for (let i = 0; i < vectors.length; i++) {
        index.add(i, vectors[i]!);
      }
    },
    { iterations: 5 }
  );

  console.log(`Batch Insert (1000 vectors): ${formatTime(batch1000Result.mean)}`);
  console.log(`  Per vector: ${formatTime(batch1000Result.mean / 1000)}`);

  // Create pre-built index for search benchmarks
  const prebuiltIndex = new HNSWIndex({ dimensions });
  const prebuiltVectors = Array.from({ length: 1000 }, () => generateVector(dimensions));
  for (let i = 0; i < prebuiltVectors.length; i++) {
    prebuiltIndex.add(i, prebuiltVectors[i]!);
  }

  // Benchmark 4: Search on 1000-vector index
  const query = generateVector(dimensions);

  const search1000Result = await runner.run(
    'search-1000-vectors',
    async () => {
      prebuiltIndex.search(query, 10, 50);
    },
    { iterations: 500 }
  );

  console.log(`Search (1000 vectors, k=10): ${formatTime(search1000Result.mean)}`);

  // Benchmark 5: Vector Removal
  const removeResult = await runner.run(
    'vector-removal',
    async () => {
      // Create a small index for removal testing
      const index = new HNSWIndex({ dimensions });
      for (let i = 0; i < 100; i++) {
        index.add(i, generateVector(dimensions));
      }
      // Remove middle element
      index.remove(50);
    },
    { iterations: 100 }
  );

  console.log(`Vector Removal (from 100): ${formatTime(removeResult.mean)}`);

  // Benchmark 6: Index Update (remove + add)
  const updateResult = await runner.run(
    'index-update',
    async () => {
      const index = new HNSWIndex({ dimensions });
      for (let i = 0; i < 100; i++) {
        index.add(i, generateVector(dimensions));
      }
      // Update: remove and re-add
      index.remove(50);
      index.add(50, generateVector(dimensions));
    },
    { iterations: 100 }
  );

  console.log(`Index Update (remove + add): ${formatTime(updateResult.mean)}`);

  // Benchmark 7: Different M values
  const m8Index = new HNSWIndex({ dimensions, M: 8 });
  const m8Vectors = Array.from({ length: 500 }, () => generateVector(dimensions));

  const m8BuildResult = await runner.run(
    'build-m8-500',
    async () => {
      const index = new HNSWIndex({ dimensions, M: 8 });
      for (let i = 0; i < 500; i++) {
        index.add(i, m8Vectors[i]!);
      }
    },
    { iterations: 10 }
  );

  console.log(`Build (M=8, 500 vectors): ${formatTime(m8BuildResult.mean)}`);

  const m32BuildResult = await runner.run(
    'build-m32-500',
    async () => {
      const index = new HNSWIndex({ dimensions, M: 32 });
      for (let i = 0; i < 500; i++) {
        index.add(i, m8Vectors[i]!);
      }
    },
    { iterations: 10 }
  );

  console.log(`Build (M=32, 500 vectors): ${formatTime(m32BuildResult.mean)}`);

  // Benchmark 8: Different ef_construction values
  const ef100Result = await runner.run(
    'build-ef100-500',
    async () => {
      const index = new HNSWIndex({ dimensions, efConstruction: 100 });
      for (let i = 0; i < 500; i++) {
        index.add(i, m8Vectors[i]!);
      }
    },
    { iterations: 10 }
  );

  console.log(`Build (ef=100, 500 vectors): ${formatTime(ef100Result.mean)}`);

  const ef400Result = await runner.run(
    'build-ef400-500',
    async () => {
      const index = new HNSWIndex({ dimensions, efConstruction: 400 });
      for (let i = 0; i < 500; i++) {
        index.add(i, m8Vectors[i]!);
      }
    },
    { iterations: 10 }
  );

  console.log(`Build (ef=400, 500 vectors): ${formatTime(ef400Result.mean)}`);

  // Summary
  console.log('\n--- Summary ---');
  console.log(`Single insert: ${formatTime(singleInsertResult.mean)}`);
  console.log(`Per-vector cost at 1000: ${formatTime(batch1000Result.mean / 1000)}`);
  console.log(`Search (1000 vectors): ${formatTime(search1000Result.mean)}`);
  console.log(`M=8 vs M=32: ${(m32BuildResult.mean / m8BuildResult.mean).toFixed(2)}x slower`);
  console.log(`ef=100 vs ef=400: ${(ef400Result.mean / ef100Result.mean).toFixed(2)}x slower`);

  // Print full results
  runner.printResults();
}

// ============================================================================
// HNSW Indexing Optimization Strategies
// ============================================================================

export const hnswOptimizations = {
  /**
   * Optimal M selection based on dimension
   */
  optimalM: {
    description: 'Choose M based on vector dimensions (M = 2 * log2(dimensions))',
    expectedImprovement: '10-30%',
    implementation: `
      function optimalM(dimensions: number): number {
        return Math.round(2 * Math.log2(dimensions));
      }
      // For 384 dimensions: M = 17
    `,
  },

  /**
   * Parallel index construction
   */
  parallelConstruction: {
    description: 'Build index using multiple worker threads',
    expectedImprovement: '2-4x',
    implementation: `
      async function parallelBuild(vectors: Float32Array[]): Promise<HNSWIndex> {
        const workers = os.cpus().length;
        const chunks = chunkArray(vectors, workers);

        const partialIndices = await Promise.all(
          chunks.map((chunk, i) => buildInWorker(chunk, i))
        );

        return mergeIndices(partialIndices);
      }
    `,
  },

  /**
   * Incremental updates
   */
  incrementalUpdates: {
    description: 'Batch updates and apply incrementally',
    expectedImprovement: '20-50%',
    implementation: `
      class IncrementalHNSW {
        private pendingUpdates: Update[] = [];
        private updateThreshold = 100;

        add(id: number, vector: Float32Array): void {
          this.pendingUpdates.push({ type: 'add', id, vector });
          if (this.pendingUpdates.length >= this.updateThreshold) {
            this.flush();
          }
        }

        private flush(): void {
          // Apply all updates in batch
          for (const update of this.pendingUpdates) {
            this.applyUpdate(update);
          }
          this.pendingUpdates = [];
        }
      }
    `,
  },

  /**
   * Memory-mapped storage
   */
  mmapStorage: {
    description: 'Use memory-mapped files for large indices',
    expectedImprovement: '30-50% memory, 10-20% speed',
    implementation: `
      import mmap from 'mmap-io';

      class MmapHNSW {
        private fd: number;
        private buffer: Buffer;

        constructor(filePath: string, size: number) {
          this.fd = fs.openSync(filePath, 'r+');
          this.buffer = mmap.map(size, mmap.PROT_READ | mmap.PROT_WRITE, mmap.MAP_SHARED, this.fd);
        }
      }
    `,
  },
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runHNSWIndexingBenchmarks().catch(console.error);
}

export default runHNSWIndexingBenchmarks;
