/**
 * Flash Attention Implementation for RuVector Intelligence System
 *
 * Implements block-wise attention computation for faster similarity calculations.
 * Achieves O(N) memory instead of O(N^2) through tiling strategy.
 *
 * Key optimizations:
 * - Block-wise computation to fit in L1 cache
 * - Fused softmax-matmul operations
 * - Float32Array for all operations
 * - Online softmax for numerical stability
 *
 * Target: 2-5x speedup on CPU vs naive attention
 *
 * Created with love by ruv.io
 */

// ============================================================================
// Types
// ============================================================================

export interface FlashAttentionConfig {
  /** Block size for tiling (32-64 optimal for CPU L1 cache) */
  blockSize: number;
  /** Number of dimensions in embedding vectors */
  dimensions: number;
  /** Temperature for softmax scaling */
  temperature: number;
  /** Enable numerical stability optimizations */
  useStableMode: boolean;
  /** Use optimized CPU path (default: true) */
  useCPUOptimizations: boolean;
}

export interface AttentionResult {
  /** Output vectors after attention */
  output: Float32Array[];
  /** Attention weights (optional, for debugging) */
  weights?: Float32Array[];
  /** Computation time in milliseconds */
  computeTimeMs: number;
}

export interface BenchmarkResult {
  /** Naive attention time in milliseconds */
  naiveTimeMs: number;
  /** Flash attention time in milliseconds */
  flashTimeMs: number;
  /** Speedup factor (naive / flash) */
  speedup: number;
  /** Number of vectors benchmarked */
  numVectors: number;
  /** Dimensions of vectors */
  dimensions: number;
  /** Memory usage estimate for naive (bytes) */
  naiveMemoryBytes: number;
  /** Memory usage estimate for flash (bytes) */
  flashMemoryBytes: number;
  /** Memory reduction factor */
  memoryReduction: number;
}

// ============================================================================
// Flash Attention Implementation
// ============================================================================

export class FlashAttention {
  private config: FlashAttentionConfig;
  private lastSpeedup: number = 0;
  private benchmarkHistory: BenchmarkResult[] = [];

  constructor(config: Partial<FlashAttentionConfig> = {}) {
    this.config = {
      blockSize: config.blockSize ?? 64,
      dimensions: config.dimensions ?? 384,
      temperature: config.temperature ?? 1.0,
      useStableMode: config.useStableMode ?? true,
    };
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Main attention computation using Flash Attention algorithm
   *
   * @param queries - Query vectors [N x D]
   * @param keys - Key vectors [M x D]
   * @param values - Value vectors [M x D]
   * @returns Attention output [N x D]
   */
  attention(
    queries: Float32Array[],
    keys: Float32Array[],
    values: Float32Array[],
  ): AttentionResult {
    const startTime = performance.now();

    // Validate inputs
    this.validateInputs(queries, keys, values);

    const numQueries = queries.length;
    const numKeys = keys.length;
    const dimensions = queries[0]?.length ?? this.config.dimensions;

    // Use block attention for large inputs, naive for small
    let output: Float32Array[];
    if (numQueries * numKeys > 1024) {
      output = this.blockAttention(queries, keys, values, this.config.blockSize);
    } else {
      output = this.naiveAttention(queries, keys, values);
    }

    const computeTimeMs = performance.now() - startTime;

    return {
      output,
      computeTimeMs,
    };
  }

  /**
   * Block-wise attention computation (Flash Attention core algorithm)
   *
   * Algorithm:
   * For each block of queries Q_b:
   *   For each block of keys K_b:
   *     S_b = Q_b @ K_b.T / sqrt(d)  // Block scores
   *     P_b = softmax(S_b)           // Block attention
   *     O_b += P_b @ V_b             // Accumulate output
   *
   * @param Q - Query vectors
   * @param K - Key vectors
   * @param V - Value vectors
   * @param blockSize - Block size for tiling
   */
  blockAttention(
    Q: Float32Array[],
    K: Float32Array[],
    V: Float32Array[],
    blockSize: number,
  ): Float32Array[] {
    const numQueries = Q.length;
    const numKeys = K.length;
    const dimensions = Q[0]?.length ?? this.config.dimensions;
    const scale = 1.0 / (Math.sqrt(dimensions) * this.config.temperature);

    // Initialize output arrays
    const output: Float32Array[] = new Array(numQueries);
    for (let i = 0; i < numQueries; i++) {
      output[i] = new Float32Array(dimensions);
    }

    // Online softmax state: max values and sum of exp for each query
    const maxScores = new Float32Array(numQueries).fill(-Infinity);
    const sumExp = new Float32Array(numQueries).fill(0);

    // Process in blocks
    for (let kStart = 0; kStart < numKeys; kStart += blockSize) {
      const kEnd = Math.min(kStart + blockSize, numKeys);
      const kBlockSize = kEnd - kStart;

      // Process each query against this key block
      for (let qStart = 0; qStart < numQueries; qStart += blockSize) {
        const qEnd = Math.min(qStart + blockSize, numQueries);

        // Compute attention scores for this block
        const blockScores = this.computeBlockScores(
          Q, K, qStart, qEnd, kStart, kEnd, scale,
        );

        // Apply online softmax and accumulate output
        this.onlineSoftmaxAccumulate(
          blockScores,
          V,
          output,
          maxScores,
          sumExp,
          qStart,
          qEnd,
          kStart,
          kEnd,
        );
      }
    }

    // Normalize outputs by final sum of exponentials
    for (let i = 0; i < numQueries; i++) {
      const normalizer = sumExp[i];
      if (normalizer > 0) {
        for (let d = 0; d < dimensions; d++) {
          output[i][d] /= normalizer;
        }
      }
    }

    return output;
  }

  /**
   * Get the speedup factor from the last benchmark
   */
  getSpeedup(): number {
    return this.lastSpeedup;
  }

  /**
   * Run benchmark comparing naive vs flash attention
   *
   * @param numVectors - Number of vectors to test
   * @param dimensions - Dimensions per vector
   * @param iterations - Number of iterations for averaging
   */
  benchmark(
    numVectors: number = 512,
    dimensions: number = 384,
    iterations: number = 5,
  ): BenchmarkResult {
    // Generate random test data
    const queries = this.generateRandomVectors(numVectors, dimensions);
    const keys = this.generateRandomVectors(numVectors, dimensions);
    const values = this.generateRandomVectors(numVectors, dimensions);

    // Warm up
    this.naiveAttention(queries.slice(0, 10), keys.slice(0, 10), values.slice(0, 10));
    this.blockAttention(queries.slice(0, 10), keys.slice(0, 10), values.slice(0, 10), this.config.blockSize);

    // Benchmark naive attention
    let naiveTotalMs = 0;
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      this.naiveAttention(queries, keys, values);
      naiveTotalMs += performance.now() - start;
    }
    const naiveTimeMs = naiveTotalMs / iterations;

    // Benchmark flash attention
    let flashTotalMs = 0;
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      this.blockAttention(queries, keys, values, this.config.blockSize);
      flashTotalMs += performance.now() - start;
    }
    const flashTimeMs = flashTotalMs / iterations;

    // Calculate metrics
    const speedup = naiveTimeMs / flashTimeMs;
    this.lastSpeedup = speedup;

    // Memory estimates
    // Naive: needs full N x N attention matrix
    const naiveMemoryBytes = numVectors * numVectors * 4; // Float32
    // Flash: only needs block_size x block_size at a time
    const flashMemoryBytes = this.config.blockSize * this.config.blockSize * 4;
    const memoryReduction = naiveMemoryBytes / flashMemoryBytes;

    const result: BenchmarkResult = {
      naiveTimeMs,
      flashTimeMs,
      speedup,
      numVectors,
      dimensions,
      naiveMemoryBytes,
      flashMemoryBytes,
      memoryReduction,
    };

    this.benchmarkHistory.push(result);
    return result;
  }

  /**
   * Get benchmark history
   */
  getBenchmarkHistory(): BenchmarkResult[] {
    return [...this.benchmarkHistory];
  }

  /**
   * Get configuration
   */
  getConfig(): FlashAttentionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<FlashAttentionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Naive O(N^2) attention implementation for comparison
   */
  private naiveAttention(
    queries: Float32Array[],
    keys: Float32Array[],
    values: Float32Array[],
  ): Float32Array[] {
    const numQueries = queries.length;
    const numKeys = keys.length;
    const dimensions = queries[0]?.length ?? this.config.dimensions;
    const scale = 1.0 / (Math.sqrt(dimensions) * this.config.temperature);

    // Compute full attention matrix Q @ K.T
    const scores: Float32Array[] = new Array(numQueries);
    for (let i = 0; i < numQueries; i++) {
      scores[i] = new Float32Array(numKeys);
      for (let j = 0; j < numKeys; j++) {
        scores[i][j] = this.dotProduct(queries[i], keys[j]) * scale;
      }
    }

    // Softmax over each row
    const attentionWeights: Float32Array[] = new Array(numQueries);
    for (let i = 0; i < numQueries; i++) {
      attentionWeights[i] = this.softmax(scores[i]);
    }

    // Compute output: attention @ V
    const output: Float32Array[] = new Array(numQueries);
    for (let i = 0; i < numQueries; i++) {
      output[i] = new Float32Array(dimensions);
      for (let j = 0; j < numKeys; j++) {
        const weight = attentionWeights[i][j];
        for (let d = 0; d < dimensions; d++) {
          output[i][d] += weight * values[j][d];
        }
      }
    }

    return output;
  }

  /**
   * Compute block of attention scores
   */
  private computeBlockScores(
    Q: Float32Array[],
    K: Float32Array[],
    qStart: number,
    qEnd: number,
    kStart: number,
    kEnd: number,
    scale: number,
  ): Float32Array[] {
    const qBlockSize = qEnd - qStart;
    const kBlockSize = kEnd - kStart;

    const scores: Float32Array[] = new Array(qBlockSize);
    for (let qi = 0; qi < qBlockSize; qi++) {
      scores[qi] = new Float32Array(kBlockSize);
      const query = Q[qStart + qi];
      for (let ki = 0; ki < kBlockSize; ki++) {
        scores[qi][ki] = this.dotProduct(query, K[kStart + ki]) * scale;
      }
    }

    return scores;
  }

  /**
   * Online softmax with output accumulation (key to Flash Attention)
   *
   * Uses the online softmax trick to maintain numerical stability
   * while processing blocks incrementally.
   */
  private onlineSoftmaxAccumulate(
    blockScores: Float32Array[],
    V: Float32Array[],
    output: Float32Array[],
    maxScores: Float32Array,
    sumExp: Float32Array,
    qStart: number,
    qEnd: number,
    kStart: number,
    kEnd: number,
  ): void {
    const qBlockSize = qEnd - qStart;
    const kBlockSize = kEnd - kStart;
    const dimensions = output[0]?.length ?? this.config.dimensions;

    for (let qi = 0; qi < qBlockSize; qi++) {
      const globalQi = qStart + qi;
      const rowScores = blockScores[qi];

      // Find max in this block
      let blockMax = -Infinity;
      for (let ki = 0; ki < kBlockSize; ki++) {
        if (rowScores[ki] > blockMax) {
          blockMax = rowScores[ki];
        }
      }

      const oldMax = maxScores[globalQi];
      const newMax = Math.max(oldMax, blockMax);

      // Correction factor for previous outputs
      const correction = oldMax === -Infinity ? 0 : Math.exp(oldMax - newMax);

      // Update sum of exponentials with correction
      let newSumExp = sumExp[globalQi] * correction;

      // Scale existing output by correction factor
      for (let d = 0; d < dimensions; d++) {
        output[globalQi][d] *= correction;
      }

      // Process this block
      for (let ki = 0; ki < kBlockSize; ki++) {
        const expScore = Math.exp(rowScores[ki] - newMax);
        newSumExp += expScore;

        // Accumulate weighted values
        const value = V[kStart + ki];
        for (let d = 0; d < dimensions; d++) {
          output[globalQi][d] += expScore * value[d];
        }
      }

      // Update running statistics
      maxScores[globalQi] = newMax;
      sumExp[globalQi] = newSumExp;
    }
  }

  /**
   * Compute dot product of two vectors
   */
  private dotProduct(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);

    // Unroll loop for performance (4x unroll)
    let i = 0;
    for (; i <= len - 4; i += 4) {
      sum += a[i] * b[i] +
             a[i + 1] * b[i + 1] +
             a[i + 2] * b[i + 2] +
             a[i + 3] * b[i + 3];
    }

    // Handle remaining elements
    for (; i < len; i++) {
      sum += a[i] * b[i];
    }

    return sum;
  }

  /**
   * Stable softmax implementation
   */
  private softmax(scores: Float32Array): Float32Array {
    const result = new Float32Array(scores.length);

    // Find max for numerical stability
    let max = -Infinity;
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] > max) {
        max = scores[i];
      }
    }

    // Compute exp and sum
    let sum = 0;
    for (let i = 0; i < scores.length; i++) {
      result[i] = Math.exp(scores[i] - max);
      sum += result[i];
    }

    // Normalize
    if (sum > 0) {
      for (let i = 0; i < scores.length; i++) {
        result[i] /= sum;
      }
    }

    return result;
  }

  /**
   * Generate random vectors for benchmarking
   */
  private generateRandomVectors(count: number, dimensions: number): Float32Array[] {
    const vectors: Float32Array[] = new Array(count);

    for (let i = 0; i < count; i++) {
      vectors[i] = new Float32Array(dimensions);
      for (let d = 0; d < dimensions; d++) {
        vectors[i][d] = (Math.random() - 0.5) * 2;
      }

      // Normalize
      let norm = 0;
      for (let d = 0; d < dimensions; d++) {
        norm += vectors[i][d] * vectors[i][d];
      }
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let d = 0; d < dimensions; d++) {
          vectors[i][d] /= norm;
        }
      }
    }

    return vectors;
  }

  /**
   * Validate input arrays
   */
  private validateInputs(
    queries: Float32Array[],
    keys: Float32Array[],
    values: Float32Array[],
  ): void {
    if (!queries.length || !keys.length || !values.length) {
      throw new Error('FlashAttention: Empty input arrays');
    }

    if (keys.length !== values.length) {
      throw new Error(
        `FlashAttention: Keys and values must have same count. Got ${keys.length} keys, ${values.length} values`,
      );
    }

    const qDim = queries[0]?.length ?? 0;
    const kDim = keys[0]?.length ?? 0;
    const vDim = values[0]?.length ?? 0;

    if (qDim !== kDim) {
      throw new Error(
        `FlashAttention: Query and key dimensions must match. Got Q=${qDim}, K=${kDim}`,
      );
    }

    if (kDim !== vDim) {
      throw new Error(
        `FlashAttention: Key and value dimensions must match. Got K=${kDim}, V=${vDim}`,
      );
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let flashAttentionInstance: FlashAttention | null = null;

/**
 * Get singleton FlashAttention instance
 *
 * @param config - Optional configuration (only used on first call)
 * @returns FlashAttention instance
 */
export function getFlashAttention(config?: Partial<FlashAttentionConfig>): FlashAttention {
  if (!flashAttentionInstance) {
    flashAttentionInstance = new FlashAttention(config);
  }
  return flashAttentionInstance;
}

/**
 * Reset singleton (for testing)
 */
export function resetFlashAttention(): void {
  flashAttentionInstance = null;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Compute attention using Flash Attention
 */
export function computeAttention(
  queries: Float32Array[],
  keys: Float32Array[],
  values: Float32Array[],
  config?: Partial<FlashAttentionConfig>,
): AttentionResult {
  const fa = config ? new FlashAttention(config) : getFlashAttention();
  return fa.attention(queries, keys, values);
}

/**
 * Run Flash Attention benchmark
 */
export function benchmarkFlashAttention(
  numVectors?: number,
  dimensions?: number,
  iterations?: number,
): BenchmarkResult {
  return getFlashAttention().benchmark(numVectors, dimensions, iterations);
}

/**
 * Get current speedup from last benchmark
 */
export function getFlashAttentionSpeedup(): number {
  return getFlashAttention().getSpeedup();
}
