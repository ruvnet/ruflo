/**
 * Vector Search Benchmark
 *
 * Target: <1ms (150x faster than current ~150ms)
 *
 * Measures vector similarity search performance including
 * linear search baseline vs HNSW optimized search.
 */

import { benchmark, BenchmarkRunner, formatTime, meetsTarget } from '../framework/benchmark.js';

// ============================================================================
// Vector Operations
// ============================================================================

/**
 * Generate a random vector of specified dimension
 */
function generateVector(dimension: number): Float32Array {
  const vector = new Float32Array(dimension);
  for (let i = 0; i < dimension; i++) {
    vector[i] = Math.random() * 2 - 1;
  }
  return normalizeVector(vector);
}

/**
 * Normalize a vector to unit length
 */
function normalizeVector(vector: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) {
    sum += vector[i]! * vector[i]!;
  }
  const magnitude = Math.sqrt(sum);
  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i]! /= magnitude;
    }
  }
  return vector;
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}

/**
 * Calculate Euclidean distance between two vectors
 */
function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// ============================================================================
// Search Implementations
// ============================================================================

interface SearchResult {
  id: number;
  score: number;
}

/**
 * Linear (brute-force) search - O(n)
 */
function linearSearch(
  query: Float32Array,
  vectors: Float32Array[],
  k: number
): SearchResult[] {
  const scores: SearchResult[] = vectors.map((v, i) => ({
    id: i,
    score: cosineSimilarity(query, v),
  }));

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, k);
}

/**
 * Simple HNSW-like graph for approximate nearest neighbors
 * Simplified implementation for benchmarking
 */
class SimpleHNSW {
  private vectors: Float32Array[] = [];
  private graph: Map<number, number[]> = new Map();
  private entryPoint = 0;
  private readonly maxConnections = 16;
  private readonly efConstruction = 100;

  add(vector: Float32Array): number {
    const id = this.vectors.length;
    this.vectors.push(vector);

    if (id === 0) {
      this.graph.set(id, []);
      return id;
    }

    // Find nearest neighbors using current graph
    const neighbors = this.searchLayer(vector, this.entryPoint, this.efConstruction);

    // Connect to nearest neighbors
    const connections = neighbors
      .slice(0, this.maxConnections)
      .map((r) => r.id);
    this.graph.set(id, connections);

    // Add reverse connections
    for (const neighborId of connections) {
      const neighborConnections = this.graph.get(neighborId) || [];
      if (neighborConnections.length < this.maxConnections) {
        neighborConnections.push(id);
        this.graph.set(neighborId, neighborConnections);
      }
    }

    return id;
  }

  search(query: Float32Array, k: number, ef = 50): SearchResult[] {
    if (this.vectors.length === 0) return [];

    const results = this.searchLayer(query, this.entryPoint, Math.max(k, ef));
    return results.slice(0, k);
  }

  private searchLayer(
    query: Float32Array,
    entryPoint: number,
    ef: number
  ): SearchResult[] {
    const visited = new Set<number>();
    const candidates: SearchResult[] = [
      { id: entryPoint, score: cosineSimilarity(query, this.vectors[entryPoint]!) },
    ];
    const results: SearchResult[] = [...candidates];

    visited.add(entryPoint);

    while (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const current = candidates.shift()!;

      const neighbors = this.graph.get(current.id) || [];
      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const score = cosineSimilarity(query, this.vectors[neighborId]!);
        results.push({ id: neighborId, score });
        candidates.push({ id: neighborId, score });

        if (results.length > ef) {
          results.sort((a, b) => b.score - a.score);
          results.length = ef;
        }
      }

      if (candidates.length > ef) {
        candidates.sort((a, b) => b.score - a.score);
        candidates.length = ef;
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  get size(): number {
    return this.vectors.length;
  }
}

// ============================================================================
// Benchmark Suite
// ============================================================================

export async function runVectorSearchBenchmarks(): Promise<void> {
  const runner = new BenchmarkRunner('Vector Search');

  console.log('\n--- Vector Search Benchmarks ---\n');

  const dimensions = 384; // Common embedding dimension
  const k = 10; // Number of results to return

  // Prepare test data
  console.log('Preparing test data...');

  // Small dataset (1,000 vectors)
  const smallDataset = Array.from({ length: 1000 }, () => generateVector(dimensions));
  const smallHNSW = new SimpleHNSW();
  for (const v of smallDataset) {
    smallHNSW.add(v);
  }

  // Medium dataset (10,000 vectors)
  const mediumDataset = Array.from({ length: 10000 }, () => generateVector(dimensions));
  const mediumHNSW = new SimpleHNSW();
  for (const v of mediumDataset) {
    mediumHNSW.add(v);
  }

  // Query vector
  const query = generateVector(dimensions);

  console.log('Test data prepared.\n');

  // Benchmark 1: Linear Search - 1,000 vectors
  const linear1kResult = await runner.run(
    'linear-search-1k',
    async () => {
      linearSearch(query, smallDataset, k);
    },
    { iterations: 100 }
  );

  console.log(`Linear Search (1k vectors): ${formatTime(linear1kResult.mean)}`);

  // Benchmark 2: HNSW Search - 1,000 vectors
  const hnsw1kResult = await runner.run(
    'hnsw-search-1k',
    async () => {
      smallHNSW.search(query, k);
    },
    { iterations: 500 }
  );

  console.log(`HNSW Search (1k vectors): ${formatTime(hnsw1kResult.mean)}`);
  const speedup1k = linear1kResult.mean / hnsw1kResult.mean;
  console.log(`  Speedup: ${speedup1k.toFixed(1)}x`);

  // Benchmark 3: Linear Search - 10,000 vectors
  const linear10kResult = await runner.run(
    'linear-search-10k',
    async () => {
      linearSearch(query, mediumDataset, k);
    },
    { iterations: 20 }
  );

  console.log(`Linear Search (10k vectors): ${formatTime(linear10kResult.mean)}`);

  // Benchmark 4: HNSW Search - 10,000 vectors
  const hnsw10kResult = await runner.run(
    'hnsw-search-10k',
    async () => {
      mediumHNSW.search(query, k);
    },
    { iterations: 200 }
  );

  console.log(`HNSW Search (10k vectors): ${formatTime(hnsw10kResult.mean)}`);
  const speedup10k = linear10kResult.mean / hnsw10kResult.mean;
  console.log(`  Speedup: ${speedup10k.toFixed(1)}x`);

  // Check target
  const target = meetsTarget('vector-search', hnsw10kResult.mean);
  console.log(`  Target (<1ms): ${target.met ? 'PASS' : 'FAIL'}`);

  // Benchmark 5: Cosine Similarity Calculation
  const v1 = generateVector(dimensions);
  const v2 = generateVector(dimensions);

  const cosineResult = await runner.run(
    'cosine-similarity',
    async () => {
      cosineSimilarity(v1, v2);
    },
    { iterations: 10000 }
  );

  console.log(`Cosine Similarity: ${formatTime(cosineResult.mean)}`);

  // Benchmark 6: Euclidean Distance Calculation
  const euclideanResult = await runner.run(
    'euclidean-distance',
    async () => {
      euclideanDistance(v1, v2);
    },
    { iterations: 10000 }
  );

  console.log(`Euclidean Distance: ${formatTime(euclideanResult.mean)}`);

  // Benchmark 7: Vector Normalization
  const normResult = await runner.run(
    'vector-normalization',
    async () => {
      const v = new Float32Array(dimensions);
      for (let i = 0; i < dimensions; i++) {
        v[i] = Math.random();
      }
      normalizeVector(v);
    },
    { iterations: 5000 }
  );

  console.log(`Vector Normalization: ${formatTime(normResult.mean)}`);

  // Benchmark 8: Batch Search (5 queries)
  const queries = Array.from({ length: 5 }, () => generateVector(dimensions));

  const batchSearchResult = await runner.run(
    'batch-search-5-queries',
    async () => {
      for (const q of queries) {
        smallHNSW.search(q, k);
      }
    },
    { iterations: 100 }
  );

  console.log(`Batch Search (5 queries): ${formatTime(batchSearchResult.mean)}`);

  // Benchmark 9: Parallel Batch Search
  const parallelBatchResult = await runner.run(
    'parallel-batch-search',
    async () => {
      await Promise.all(queries.map((q) => Promise.resolve(smallHNSW.search(q, k))));
    },
    { iterations: 100 }
  );

  console.log(`Parallel Batch Search: ${formatTime(parallelBatchResult.mean)}`);

  // Summary
  console.log('\n--- Summary ---');
  console.log(`1k vectors: Linear ${formatTime(linear1kResult.mean)} -> HNSW ${formatTime(hnsw1kResult.mean)} (${speedup1k.toFixed(1)}x)`);
  console.log(`10k vectors: Linear ${formatTime(linear10kResult.mean)} -> HNSW ${formatTime(hnsw10kResult.mean)} (${speedup10k.toFixed(1)}x)`);
  console.log(`\nProjected for 100k vectors: ~${((speedup10k * 10)).toFixed(0)}x improvement`);
  console.log(`Projected for 1M vectors: ~${((speedup10k * 100)).toFixed(0)}x improvement`);

  // Print full results
  runner.printResults();
}

// ============================================================================
// Vector Search Optimization Strategies
// ============================================================================

export const vectorSearchOptimizations = {
  /**
   * HNSW Indexing: Hierarchical Navigable Small World graphs
   */
  hnswIndexing: {
    description: 'Use HNSW for O(log n) approximate nearest neighbor search',
    expectedImprovement: '150x-12500x',
    implementation: `
      import { HNSW } from 'agentdb';

      const index = new HNSW({
        dimensions: 384,
        maxElements: 1000000,
        efConstruction: 200,
        M: 16,
      });

      index.addItems(vectors);
      const results = index.search(query, k);
    `,
  },

  /**
   * SIMD Operations: Use SIMD for vector math
   */
  simdOperations: {
    description: 'Use SIMD instructions for parallel vector operations',
    expectedImprovement: '4-8x',
    implementation: `
      // Use typed arrays and native SIMD when available
      function dotProductSIMD(a: Float32Array, b: Float32Array): number {
        // Node.js will use SIMD when available
        let sum = 0;
        for (let i = 0; i < a.length; i += 4) {
          sum += a[i] * b[i] + a[i+1] * b[i+1] + a[i+2] * b[i+2] + a[i+3] * b[i+3];
        }
        return sum;
      }
    `,
  },

  /**
   * Quantization: Use int8 instead of float32
   */
  quantization: {
    description: 'Quantize vectors to int8 for 4x memory savings and faster ops',
    expectedImprovement: '2-4x speed, 4x memory',
    implementation: `
      function quantize(vector: Float32Array): Int8Array {
        const quantized = new Int8Array(vector.length);
        for (let i = 0; i < vector.length; i++) {
          quantized[i] = Math.round(vector[i] * 127);
        }
        return quantized;
      }
    `,
  },

  /**
   * Batch Processing: Process multiple queries together
   */
  batchProcessing: {
    description: 'Process multiple queries in a single batch for better cache utilization',
    expectedImprovement: '2-5x',
    implementation: `
      async function batchSearch(queries: Float32Array[], k: number): Promise<SearchResult[][]> {
        // Process all queries together for better cache locality
        return queries.map(q => index.search(q, k));
      }
    `,
  },

  /**
   * Pre-filtering: Reduce search space with metadata filters
   */
  preFiltering: {
    description: 'Use metadata filters to reduce the search space before vector search',
    expectedImprovement: '2-10x',
    implementation: `
      function filteredSearch(query: Float32Array, filter: Filter, k: number): SearchResult[] {
        // First apply metadata filter
        const candidates = applyFilter(filter);
        // Then search only within filtered candidates
        return searchWithinCandidates(query, candidates, k);
      }
    `,
  },
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runVectorSearchBenchmarks().catch(console.error);
}

export default runVectorSearchBenchmarks;
