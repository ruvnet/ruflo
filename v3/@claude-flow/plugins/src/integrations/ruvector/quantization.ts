/**
 * RuVector PostgreSQL Bridge - Vector Quantization Module
 *
 * Comprehensive vector quantization for memory reduction:
 * - Scalar Quantization (Int8): 4x memory reduction
 * - Binary Quantization: 32x memory reduction
 * - Product Quantization (PQ): High compression with codebooks
 * - Optimized Product Quantization (OPQ): PQ with learned rotation
 *
 * @module @claude-flow/plugins/integrations/ruvector/quantization
 * @version 1.0.0
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Quantization type options.
 */
export type QuantizationType = 'scalar' | 'binary' | 'pq' | 'opq';

/**
 * Base interface for all quantizers.
 */
export interface IQuantizer {
  /** Quantization type */
  readonly type: QuantizationType;
  /** Original vector dimensions */
  readonly dimensions: number;
  /** Quantize a batch of vectors */
  quantize(vectors: number[][]): Uint8Array[] | Int8Array[];
  /** Dequantize back to float vectors (lossy) */
  dequantize(quantized: Uint8Array[] | Int8Array[]): number[][];
  /** Get compression ratio */
  getCompressionRatio(): number;
  /** Get memory reduction string (e.g., "4x") */
  getMemoryReduction(): string;
}

/**
 * Options for scalar quantization.
 */
export interface ScalarQuantizationOptions {
  /** Vector dimensions */
  dimensions: number;
  /** Minimum value for calibration (auto-computed if not provided) */
  minValue?: number;
  /** Maximum value for calibration (auto-computed if not provided) */
  maxValue?: number;
  /** Use symmetric quantization around zero */
  symmetric?: boolean;
  /** Number of bits for quantization (default: 8) */
  bits?: number;
}

/**
 * Options for binary quantization.
 */
export interface BinaryQuantizationOptions {
  /** Vector dimensions */
  dimensions: number;
  /** Threshold for binarization (default: 0, use sign) */
  threshold?: number;
  /** Use learned thresholds per dimension */
  learnedThresholds?: number[];
}

/**
 * Options for product quantization.
 */
export interface ProductQuantizationOptions {
  /** Vector dimensions */
  dimensions: number;
  /** Number of subvectors (M) - must divide dimensions evenly */
  numSubvectors: number;
  /** Number of centroids per subvector (K) - typically 256 */
  numCentroids: number;
  /** Maximum iterations for k-means training */
  maxIterations?: number;
  /** Convergence tolerance */
  tolerance?: number;
  /** Random seed for reproducibility */
  seed?: number;
}

/**
 * Options for optimized product quantization.
 */
export interface OptimizedProductQuantizationOptions extends ProductQuantizationOptions {
  /** Number of OPQ iterations */
  opqIterations?: number;
  /** Learning rate for rotation optimization */
  learningRate?: number;
}

/**
 * General quantization options union type.
 */
export type QuantizationOptions =
  | ScalarQuantizationOptions
  | BinaryQuantizationOptions
  | ProductQuantizationOptions
  | OptimizedProductQuantizationOptions;

/**
 * Statistics from quantization operations.
 */
export interface QuantizationStats {
  /** Compression ratio (original size / compressed size) */
  compressionRatio: number;
  /** Memory reduction string (e.g., "4x", "32x") */
  memoryReduction: string;
  /** Recall@10 for approximate search (0-1) */
  recallAt10: number;
  /** Search speedup compared to exact search */
  searchSpeedup: number;
  /** Mean squared error from quantization */
  mse?: number;
  /** Training time in milliseconds */
  trainingTimeMs?: number;
}

/**
 * Calibration data for scalar quantization.
 */
interface CalibrationData {
  minValue: number;
  maxValue: number;
  scale: number;
  zeroPoint: number;
}

/**
 * Codebook for product quantization.
 */
interface Codebook {
  /** Centroids [numCentroids, subvectorDim] */
  centroids: number[][];
  /** Assignment counts for statistics */
  counts: number[];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Computes the Euclidean distance between two vectors.
 */
function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Computes the squared Euclidean distance.
 */
function squaredEuclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return sum;
}

/**
 * Computes the dot product of two vectors.
 */
function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Computes the norm of a vector.
 */
function norm(v: number[]): number {
  return Math.sqrt(dot(v, v));
}

/**
 * Normalizes a vector to unit length.
 */
function normalize(v: number[]): number[] {
  const n = norm(v);
  if (n < 1e-10) return v.map(() => 0);
  return v.map(x => x / n);
}

/**
 * Creates a zero-filled matrix.
 */
function zerosMatrix(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

/**
 * Creates an identity matrix.
 */
function identityMatrix(n: number): number[][] {
  const result = zerosMatrix(n, n);
  for (let i = 0; i < n; i++) {
    result[i][i] = 1;
  }
  return result;
}

/**
 * Matrix-vector multiplication.
 */
function matVec(matrix: number[][], vec: number[]): number[] {
  return matrix.map(row => dot(row, vec));
}

/**
 * Matrix-matrix multiplication.
 */
function matMul(a: number[][], b: number[][]): number[][] {
  const rows = a.length;
  const cols = b[0].length;
  const inner = b.length;

  const result = zerosMatrix(rows, cols);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let sum = 0;
      for (let k = 0; k < inner; k++) {
        sum += a[i][k] * b[k][j];
      }
      result[i][j] = sum;
    }
  }
  return result;
}

/**
 * Matrix transpose.
 */
function transpose(matrix: number[][]): number[][] {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const result = zerosMatrix(cols, rows);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[j][i] = matrix[i][j];
    }
  }
  return result;
}

/**
 * Simple seeded random number generator (Mulberry32).
 */
function createRng(seed: number): () => number {
  return function() {
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ============================================================================
// Scalar Quantization
// ============================================================================

/**
 * ScalarQuantizer implements per-dimension scalar quantization.
 *
 * Quantizes float32 vectors to int8 for 4x memory reduction.
 * Supports symmetric and asymmetric quantization schemes.
 *
 * @example
 * ```typescript
 * const quantizer = new ScalarQuantizer({ dimensions: 128 });
 * quantizer.calibrate(trainingVectors);
 * const quantized = quantizer.quantize(vectors);
 * const reconstructed = quantizer.dequantize(quantized);
 * ```
 */
export class ScalarQuantizer implements IQuantizer {
  readonly type: QuantizationType = 'scalar';
  readonly dimensions: number;

  private calibration: CalibrationData;
  private readonly symmetric: boolean;
  private readonly bits: number;
  private readonly qmin: number;
  private readonly qmax: number;
  private isCalibrated: boolean = false;

  constructor(options: ScalarQuantizationOptions) {
    this.dimensions = options.dimensions;
    this.symmetric = options.symmetric ?? false;
    this.bits = options.bits ?? 8;

    // Compute quantization range based on bits
    this.qmin = -(1 << (this.bits - 1));
    this.qmax = (1 << (this.bits - 1)) - 1;

    // Initialize with default calibration
    this.calibration = {
      minValue: options.minValue ?? -1,
      maxValue: options.maxValue ?? 1,
      scale: 1,
      zeroPoint: 0,
    };

    if (options.minValue !== undefined && options.maxValue !== undefined) {
      this.computeCalibration(options.minValue, options.maxValue);
      this.isCalibrated = true;
    }
  }

  /**
   * Calibrates the quantizer using sample vectors.
   *
   * @param samples - Representative vectors for calibration
   */
  calibrate(samples: number[][]): void {
    if (samples.length === 0) {
      throw new Error('Cannot calibrate with empty samples');
    }

    // Find min and max across all dimensions and samples
    let minValue = Infinity;
    let maxValue = -Infinity;

    for (const sample of samples) {
      for (let i = 0; i < sample.length; i++) {
        minValue = Math.min(minValue, sample[i]);
        maxValue = Math.max(maxValue, sample[i]);
      }
    }

    // Add small margin for numerical stability
    const range = maxValue - minValue;
    minValue -= range * 0.01;
    maxValue += range * 0.01;

    this.computeCalibration(minValue, maxValue);
    this.isCalibrated = true;
  }

  private computeCalibration(minValue: number, maxValue: number): void {
    if (this.symmetric) {
      // Symmetric quantization: use same scale for positive and negative
      const absMax = Math.max(Math.abs(minValue), Math.abs(maxValue));
      this.calibration = {
        minValue: -absMax,
        maxValue: absMax,
        scale: (2 * absMax) / (this.qmax - this.qmin),
        zeroPoint: 0,
      };
    } else {
      // Asymmetric quantization: full range utilization
      this.calibration = {
        minValue,
        maxValue,
        scale: (maxValue - minValue) / (this.qmax - this.qmin),
        zeroPoint: Math.round(this.qmin - minValue / ((maxValue - minValue) / (this.qmax - this.qmin))),
      };
    }
  }

  /**
   * Quantizes float32 vectors to int8.
   *
   * @param vectors - Input vectors
   * @returns Quantized int8 arrays
   */
  quantize(vectors: number[][]): Int8Array[] {
    if (!this.isCalibrated) {
      // Auto-calibrate if not done
      this.calibrate(vectors);
    }

    const { scale, zeroPoint } = this.calibration;

    return vectors.map((vec) => {
      const quantized = new Int8Array(vec.length);
      for (let i = 0; i < vec.length; i++) {
        const q = Math.round(vec[i] / scale) + zeroPoint;
        quantized[i] = Math.max(this.qmin, Math.min(this.qmax, q));
      }
      return quantized;
    });
  }

  /**
   * Dequantizes int8 arrays back to float32 vectors.
   *
   * @param quantized - Quantized int8 arrays
   * @returns Reconstructed float vectors (lossy)
   */
  dequantize(quantized: Int8Array[]): number[][] {
    const { scale, zeroPoint } = this.calibration;

    return quantized.map((q) => {
      const vec = new Array(q.length);
      for (let i = 0; i < q.length; i++) {
        vec[i] = (q[i] - zeroPoint) * scale;
      }
      return vec;
    });
  }

  /**
   * Computes approximate distance using quantized vectors.
   *
   * @param a - First quantized vector
   * @param b - Second quantized vector
   * @returns Approximate Euclidean distance
   */
  quantizedDistance(a: Int8Array, b: Int8Array): number {
    const { scale } = this.calibration;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum) * scale;
  }

  getCompressionRatio(): number {
    // float32 (4 bytes) -> int8 (1 byte) = 4x
    return 4;
  }

  getMemoryReduction(): string {
    return '4x';
  }

  /**
   * Gets the current calibration data.
   */
  getCalibration(): CalibrationData {
    return { ...this.calibration };
  }

  /**
   * Sets calibration data directly.
   */
  setCalibration(calibration: CalibrationData): void {
    this.calibration = { ...calibration };
    this.isCalibrated = true;
  }
}

// ============================================================================
// Binary Quantization
// ============================================================================

/**
 * BinaryQuantizer implements binary quantization for extreme compression.
 *
 * Quantizes float32 vectors to binary (1 bit per dimension) for 32x memory reduction.
 * Uses Hamming distance for fast comparison.
 *
 * @example
 * ```typescript
 * const quantizer = new BinaryQuantizer({ dimensions: 128 });
 * const quantized = quantizer.quantize(vectors);
 * const distance = quantizer.hammingDistance(quantized[0], quantized[1]);
 * ```
 */
export class BinaryQuantizer implements IQuantizer {
  readonly type: QuantizationType = 'binary';
  readonly dimensions: number;

  private threshold: number;
  private learnedThresholds: number[] | null;
  private readonly bytesPerVector: number;

  constructor(options: BinaryQuantizationOptions) {
    this.dimensions = options.dimensions;
    this.threshold = options.threshold ?? 0;
    this.learnedThresholds = options.learnedThresholds ?? null;

    // Calculate bytes needed (ceil(dimensions / 8))
    this.bytesPerVector = Math.ceil(this.dimensions / 8);
  }

  /**
   * Learns optimal thresholds per dimension from training data.
   *
   * @param samples - Training vectors
   */
  learnThresholds(samples: number[][]): void {
    if (samples.length === 0) {
      throw new Error('Cannot learn thresholds from empty samples');
    }

    // Compute median per dimension as threshold
    this.learnedThresholds = new Array(this.dimensions);

    for (let d = 0; d < this.dimensions; d++) {
      const values = samples.map(s => s[d]).sort((a, b) => a - b);
      const mid = Math.floor(values.length / 2);
      this.learnedThresholds[d] = values.length % 2 === 0
        ? (values[mid - 1] + values[mid]) / 2
        : values[mid];
    }
  }

  /**
   * Quantizes float32 vectors to binary.
   *
   * @param vectors - Input vectors
   * @returns Binary quantized arrays (packed bits)
   */
  quantize(vectors: number[][]): Uint8Array[] {
    return vectors.map((vec) => {
      const binary = new Uint8Array(this.bytesPerVector);

      for (let i = 0; i < this.dimensions; i++) {
        const threshold = this.learnedThresholds
          ? this.learnedThresholds[i]
          : this.threshold;

        if (vec[i] > threshold) {
          const byteIdx = Math.floor(i / 8);
          const bitIdx = i % 8;
          binary[byteIdx] |= (1 << bitIdx);
        }
      }

      return binary;
    });
  }

  /**
   * Dequantizes binary arrays back to float vectors.
   * Note: This is highly lossy and mainly for debugging.
   *
   * @param quantized - Binary quantized arrays
   * @returns Reconstructed vectors (-1 or +1 per dimension)
   */
  dequantize(quantized: Uint8Array[]): number[][] {
    return quantized.map((binary) => {
      const vec = new Array(this.dimensions);

      for (let i = 0; i < this.dimensions; i++) {
        const byteIdx = Math.floor(i / 8);
        const bitIdx = i % 8;
        const bit = (binary[byteIdx] >> bitIdx) & 1;
        vec[i] = bit === 1 ? 1 : -1;
      }

      return vec;
    });
  }

  /**
   * Computes Hamming distance between two binary vectors.
   *
   * @param a - First binary vector
   * @param b - Second binary vector
   * @returns Hamming distance (number of differing bits)
   */
  hammingDistance(a: Uint8Array, b: Uint8Array): number {
    let distance = 0;
    for (let i = 0; i < a.length; i++) {
      const xor = a[i] ^ b[i];
      // Count bits using Brian Kernighan's algorithm
      let bits = xor;
      while (bits) {
        distance++;
        bits &= bits - 1;
      }
    }
    return distance;
  }

  /**
   * Two-stage search: binary filter + rerank with exact distances.
   *
   * @param query - Query vector (float)
   * @param candidates - Candidate vectors (float)
   * @param k - Number of results to return
   * @param filterRatio - Ratio of candidates to keep after binary filter (default: 10)
   * @returns Indices of top-k candidates after reranking
   */
  searchWithRerank(
    query: number[],
    candidates: number[][],
    k: number,
    filterRatio: number = 10
  ): number[] {
    // Step 1: Quantize query and all candidates
    const queryBinary = this.quantize([query])[0];
    const candidatesBinary = this.quantize(candidates);

    // Step 2: Compute Hamming distances
    const distances: Array<{ index: number; hamming: number }> = [];
    for (let i = 0; i < candidatesBinary.length; i++) {
      distances.push({
        index: i,
        hamming: this.hammingDistance(queryBinary, candidatesBinary[i]),
      });
    }

    // Step 3: Filter top candidates by Hamming distance
    distances.sort((a, b) => a.hamming - b.hamming);
    const numCandidates = Math.min(k * filterRatio, candidates.length);
    const filtered = distances.slice(0, numCandidates);

    // Step 4: Rerank filtered candidates with exact Euclidean distance
    const reranked: Array<{ index: number; distance: number }> = [];
    for (const { index } of filtered) {
      reranked.push({
        index,
        distance: euclideanDistance(query, candidates[index]),
      });
    }

    // Step 5: Sort by exact distance and return top-k
    reranked.sort((a, b) => a.distance - b.distance);
    return reranked.slice(0, k).map(r => r.index);
  }

  /**
   * Batch Hamming distance computation.
   *
   * @param query - Query binary vector
   * @param candidates - Candidate binary vectors
   * @returns Array of Hamming distances
   */
  batchHammingDistance(query: Uint8Array, candidates: Uint8Array[]): number[] {
    return candidates.map(c => this.hammingDistance(query, c));
  }

  getCompressionRatio(): number {
    // float32 (32 bits) -> binary (1 bit) = 32x
    return 32;
  }

  getMemoryReduction(): string {
    return '32x';
  }
}

// ============================================================================
// Product Quantization
// ============================================================================

/**
 * ProductQuantizer implements product quantization for high compression.
 *
 * Splits vectors into M subvectors and quantizes each to K centroids.
 * Memory: M * ceil(log2(K)) bits per vector (e.g., M=8, K=256 = 8 bytes)
 *
 * @example
 * ```typescript
 * const pq = new ProductQuantizer({
 *   dimensions: 128,
 *   numSubvectors: 8,
 *   numCentroids: 256
 * });
 * await pq.train(trainingVectors);
 * const codes = pq.encode(vectors);
 * const distances = pq.computeDistances(query, codes);
 * ```
 */
export class ProductQuantizer implements IQuantizer {
  readonly type: QuantizationType = 'pq';
  readonly dimensions: number;
  readonly numSubvectors: number;
  readonly numCentroids: number;
  readonly subvectorDim: number;

  protected codebooks: Codebook[] = [];
  protected isTrained: boolean = false;
  protected readonly maxIterations: number;
  protected readonly tolerance: number;
  protected readonly rng: () => number;

  constructor(options: ProductQuantizationOptions) {
    this.dimensions = options.dimensions;
    this.numSubvectors = options.numSubvectors;
    this.numCentroids = options.numCentroids;

    // Validate dimensions divisibility
    if (options.dimensions % options.numSubvectors !== 0) {
      throw new Error(
        `Dimensions (${options.dimensions}) must be divisible by numSubvectors (${options.numSubvectors})`
      );
    }

    this.subvectorDim = options.dimensions / options.numSubvectors;
    this.maxIterations = options.maxIterations ?? 100;
    this.tolerance = options.tolerance ?? 1e-6;
    this.rng = createRng(options.seed ?? 42);
  }

  /**
   * Trains codebooks from training data using k-means clustering.
   *
   * @param vectors - Training vectors
   */
  async train(vectors: number[][]): Promise<void> {
    if (vectors.length < this.numCentroids) {
      throw new Error(
        `Need at least ${this.numCentroids} training vectors, got ${vectors.length}`
      );
    }

    this.codebooks = [];

    // Train a codebook for each subvector
    for (let m = 0; m < this.numSubvectors; m++) {
      // Extract subvectors
      const subvectors = this.extractSubvectors(vectors, m);

      // Train codebook using k-means
      const codebook = await this.trainCodebook(subvectors);
      this.codebooks.push(codebook);
    }

    this.isTrained = true;
  }

  /**
   * Extracts the m-th subvector from all vectors.
   */
  protected extractSubvectors(vectors: number[][], m: number): number[][] {
    const start = m * this.subvectorDim;
    return vectors.map(v => v.slice(start, start + this.subvectorDim));
  }

  /**
   * Trains a single codebook using k-means clustering.
   */
  protected async trainCodebook(subvectors: number[][]): Promise<Codebook> {
    const k = this.numCentroids;
    const dim = this.subvectorDim;

    // Initialize centroids using k-means++ initialization
    const centroids = this.kmeansppInit(subvectors, k);
    const counts = new Array(k).fill(0);

    // K-means iterations
    for (let iter = 0; iter < this.maxIterations; iter++) {
      // Assignment step
      const assignments: number[][] = Array.from({ length: k }, () => []);

      for (let i = 0; i < subvectors.length; i++) {
        const nearestIdx = this.findNearestCentroid(subvectors[i], centroids);
        assignments[nearestIdx].push(i);
      }

      // Update step
      let maxShift = 0;
      for (let c = 0; c < k; c++) {
        if (assignments[c].length === 0) {
          // Reinitialize empty centroid
          const randomIdx = Math.floor(this.rng() * subvectors.length);
          centroids[c] = [...subvectors[randomIdx]];
          continue;
        }

        const newCentroid = new Array(dim).fill(0);
        for (const idx of assignments[c]) {
          for (let d = 0; d < dim; d++) {
            newCentroid[d] += subvectors[idx][d];
          }
        }
        for (let d = 0; d < dim; d++) {
          newCentroid[d] /= assignments[c].length;
        }

        const shift = squaredEuclideanDistance(centroids[c], newCentroid);
        maxShift = Math.max(maxShift, shift);
        centroids[c] = newCentroid;
        counts[c] = assignments[c].length;
      }

      // Check convergence
      if (maxShift < this.tolerance) {
        break;
      }

      // Yield to event loop periodically
      if (iter % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    return { centroids, counts };
  }

  /**
   * K-means++ initialization for better centroid selection.
   */
  protected kmeansppInit(subvectors: number[][], k: number): number[][] {
    const centroids: number[][] = [];

    // First centroid: random
    const firstIdx = Math.floor(this.rng() * subvectors.length);
    centroids.push([...subvectors[firstIdx]]);

    // Remaining centroids: proportional to squared distance
    for (let c = 1; c < k; c++) {
      const distances = subvectors.map(v => {
        let minDist = Infinity;
        for (const centroid of centroids) {
          const dist = squaredEuclideanDistance(v, centroid);
          minDist = Math.min(minDist, dist);
        }
        return minDist;
      });

      const totalDist = distances.reduce((a, b) => a + b, 0);
      let threshold = this.rng() * totalDist;

      for (let i = 0; i < subvectors.length; i++) {
        threshold -= distances[i];
        if (threshold <= 0) {
          centroids.push([...subvectors[i]]);
          break;
        }
      }

      // Fallback if we didn't select (numerical issues)
      if (centroids.length <= c) {
        const fallbackIdx = Math.floor(this.rng() * subvectors.length);
        centroids.push([...subvectors[fallbackIdx]]);
      }
    }

    return centroids;
  }

  /**
   * Finds the nearest centroid index for a subvector.
   */
  protected findNearestCentroid(subvector: number[], centroids: number[][]): number {
    let minDist = Infinity;
    let minIdx = 0;

    for (let i = 0; i < centroids.length; i++) {
      const dist = squaredEuclideanDistance(subvector, centroids[i]);
      if (dist < minDist) {
        minDist = dist;
        minIdx = i;
      }
    }

    return minIdx;
  }

  /**
   * Encodes vectors to PQ codes.
   *
   * @param vectors - Input vectors
   * @returns PQ codes (one byte per subvector, assuming K=256)
   */
  encode(vectors: number[][]): Uint8Array[] {
    if (!this.isTrained) {
      throw new Error('ProductQuantizer must be trained before encoding');
    }

    return vectors.map((vec) => {
      const codes = new Uint8Array(this.numSubvectors);

      for (let m = 0; m < this.numSubvectors; m++) {
        const start = m * this.subvectorDim;
        const subvector = vec.slice(start, start + this.subvectorDim);
        codes[m] = this.findNearestCentroid(subvector, this.codebooks[m].centroids);
      }

      return codes;
    });
  }

  /**
   * Implements IQuantizer interface - encodes vectors.
   */
  quantize(vectors: number[][]): Uint8Array[] {
    return this.encode(vectors);
  }

  /**
   * Decodes PQ codes back to approximate vectors.
   *
   * @param codes - PQ codes
   * @returns Reconstructed vectors
   */
  decode(codes: Uint8Array[]): number[][] {
    if (!this.isTrained) {
      throw new Error('ProductQuantizer must be trained before decoding');
    }

    return codes.map((code) => {
      const vec = new Array(this.dimensions);

      for (let m = 0; m < this.numSubvectors; m++) {
        const centroid = this.codebooks[m].centroids[code[m]];
        const start = m * this.subvectorDim;
        for (let d = 0; d < this.subvectorDim; d++) {
          vec[start + d] = centroid[d];
        }
      }

      return vec;
    });
  }

  /**
   * Implements IQuantizer interface - decodes vectors.
   */
  dequantize(quantized: Uint8Array[]): number[][] {
    return this.decode(quantized);
  }

  /**
   * Computes asymmetric distances from a query to encoded vectors.
   *
   * Asymmetric distance computation (ADC):
   * - Query is NOT quantized (exact)
   * - Database vectors are quantized (codes)
   * - Distance is computed using lookup tables
   *
   * @param query - Query vector (float)
   * @param codes - Database PQ codes
   * @returns Array of distances
   */
  computeDistances(query: number[], codes: Uint8Array[]): number[] {
    if (!this.isTrained) {
      throw new Error('ProductQuantizer must be trained before computing distances');
    }

    // Build distance lookup tables
    const distanceTables = this.buildDistanceTables(query);

    // Compute distances using tables
    return codes.map((code) => {
      let distance = 0;
      for (let m = 0; m < this.numSubvectors; m++) {
        distance += distanceTables[m][code[m]];
      }
      return Math.sqrt(distance);
    });
  }

  /**
   * Builds distance lookup tables for asymmetric distance computation.
   */
  protected buildDistanceTables(query: number[]): number[][] {
    const tables: number[][] = [];

    for (let m = 0; m < this.numSubvectors; m++) {
      const start = m * this.subvectorDim;
      const querySubvector = query.slice(start, start + this.subvectorDim);

      const table = new Array(this.numCentroids);
      for (let c = 0; c < this.numCentroids; c++) {
        table[c] = squaredEuclideanDistance(
          querySubvector,
          this.codebooks[m].centroids[c]
        );
      }
      tables.push(table);
    }

    return tables;
  }

  /**
   * Computes symmetric distances between two sets of codes.
   *
   * @param codesA - First set of PQ codes
   * @param codesB - Second set of PQ codes
   * @returns Distance matrix
   */
  computeSymmetricDistances(codesA: Uint8Array[], codesB: Uint8Array[]): number[][] {
    if (!this.isTrained) {
      throw new Error('ProductQuantizer must be trained before computing distances');
    }

    // Precompute inter-centroid distances for each subvector
    const centroidDists: number[][][] = [];
    for (let m = 0; m < this.numSubvectors; m++) {
      const dists = zerosMatrix(this.numCentroids, this.numCentroids);
      for (let i = 0; i < this.numCentroids; i++) {
        for (let j = i; j < this.numCentroids; j++) {
          const d = squaredEuclideanDistance(
            this.codebooks[m].centroids[i],
            this.codebooks[m].centroids[j]
          );
          dists[i][j] = d;
          dists[j][i] = d;
        }
      }
      centroidDists.push(dists);
    }

    // Compute distance matrix
    const result = zerosMatrix(codesA.length, codesB.length);
    for (let i = 0; i < codesA.length; i++) {
      for (let j = 0; j < codesB.length; j++) {
        let dist = 0;
        for (let m = 0; m < this.numSubvectors; m++) {
          dist += centroidDists[m][codesA[i][m]][codesB[j][m]];
        }
        result[i][j] = Math.sqrt(dist);
      }
    }

    return result;
  }

  getCompressionRatio(): number {
    // float32 * dimensions -> numSubvectors bytes (for K=256)
    // = (4 * dimensions) / numSubvectors
    return (4 * this.dimensions) / this.numSubvectors;
  }

  getMemoryReduction(): string {
    const ratio = this.getCompressionRatio();
    return `${ratio.toFixed(1)}x`;
  }

  /**
   * Gets the trained codebooks.
   */
  getCodebooks(): Codebook[] {
    return this.codebooks.map(cb => ({
      centroids: cb.centroids.map(c => [...c]),
      counts: [...cb.counts],
    }));
  }

  /**
   * Sets codebooks directly (for loading pretrained).
   */
  setCodebooks(codebooks: Codebook[]): void {
    if (codebooks.length !== this.numSubvectors) {
      throw new Error(`Expected ${this.numSubvectors} codebooks, got ${codebooks.length}`);
    }
    this.codebooks = codebooks;
    this.isTrained = true;
  }

  /**
   * Checks if the quantizer is trained.
   */
  get trained(): boolean {
    return this.isTrained;
  }
}

// ============================================================================
// Optimized Product Quantization (OPQ)
// ============================================================================

/**
 * OptimizedProductQuantizer extends PQ with learned rotation.
 *
 * Learns an orthogonal rotation matrix to minimize quantization error.
 * The rotation decorrelates dimensions and distributes variance evenly.
 *
 * @example
 * ```typescript
 * const opq = new OptimizedProductQuantizer({
 *   dimensions: 128,
 *   numSubvectors: 8,
 *   numCentroids: 256,
 *   opqIterations: 10
 * });
 * await opq.trainWithRotation(trainingVectors);
 * const codes = opq.encode(vectors);
 * ```
 */
export class OptimizedProductQuantizer extends ProductQuantizer {
  override readonly type: QuantizationType = 'opq';

  private rotationMatrix: number[][] | null = null;
  private readonly opqIterations: number;
  private readonly learningRate: number;

  constructor(options: OptimizedProductQuantizationOptions) {
    super(options);
    this.opqIterations = options.opqIterations ?? 10;
    this.learningRate = options.learningRate ?? 0.01;
  }

  /**
   * Trains the quantizer with rotation matrix optimization.
   *
   * @param vectors - Training vectors
   */
  async trainWithRotation(vectors: number[][]): Promise<void> {
    // Initialize rotation matrix as identity
    this.rotationMatrix = identityMatrix(this.dimensions);

    for (let opqIter = 0; opqIter < this.opqIterations; opqIter++) {
      // Step 1: Rotate vectors
      const rotatedVectors = this.rotateVectors(vectors);

      // Step 2: Train PQ on rotated vectors
      await super.train(rotatedVectors);

      // Step 3: Update rotation matrix using Procrustes analysis
      this.updateRotation(vectors);

      // Yield to event loop
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Final PQ training with final rotation
    const finalRotated = this.rotateVectors(vectors);
    await super.train(finalRotated);
  }

  /**
   * Rotates vectors using the learned rotation matrix.
   */
  private rotateVectors(vectors: number[][]): number[][] {
    if (!this.rotationMatrix) {
      return vectors;
    }
    return vectors.map(v => matVec(this.rotationMatrix!, v));
  }

  /**
   * Updates the rotation matrix using Procrustes analysis.
   * Minimizes ||X - R * decode(encode(R^T * X))||^2
   */
  private updateRotation(vectors: number[][]): void {
    if (!this.rotationMatrix) return;

    // Get reconstructed vectors
    const rotated = this.rotateVectors(vectors);
    const codes = this.encode(rotated);
    const reconstructed = this.decode(codes);

    // Compute X^T * Y for Procrustes
    const xty = zerosMatrix(this.dimensions, this.dimensions);
    for (let i = 0; i < vectors.length; i++) {
      for (let j = 0; j < this.dimensions; j++) {
        for (let k = 0; k < this.dimensions; k++) {
          xty[j][k] += vectors[i][j] * reconstructed[i][k];
        }
      }
    }

    // SVD approximation using power iteration
    // For simplicity, we use gradient descent on the rotation
    const gradientUpdate = this.computeRotationGradient(vectors, reconstructed);

    // Update rotation matrix
    for (let i = 0; i < this.dimensions; i++) {
      for (let j = 0; j < this.dimensions; j++) {
        this.rotationMatrix![i][j] -= this.learningRate * gradientUpdate[i][j];
      }
    }

    // Orthogonalize using Gram-Schmidt
    this.orthogonalize();
  }

  /**
   * Computes gradient for rotation update.
   */
  private computeRotationGradient(
    original: number[][],
    reconstructed: number[][]
  ): number[][] {
    const gradient = zerosMatrix(this.dimensions, this.dimensions);

    for (let i = 0; i < original.length; i++) {
      const rotatedOrig = matVec(this.rotationMatrix!, original[i]);
      const error = rotatedOrig.map((v, j) => v - reconstructed[i][j]);

      for (let j = 0; j < this.dimensions; j++) {
        for (let k = 0; k < this.dimensions; k++) {
          gradient[j][k] += error[j] * original[i][k];
        }
      }
    }

    // Normalize
    const scale = 1 / original.length;
    for (let i = 0; i < this.dimensions; i++) {
      for (let j = 0; j < this.dimensions; j++) {
        gradient[i][j] *= scale;
      }
    }

    return gradient;
  }

  /**
   * Orthogonalizes the rotation matrix using modified Gram-Schmidt.
   */
  private orthogonalize(): void {
    if (!this.rotationMatrix) return;

    for (let i = 0; i < this.dimensions; i++) {
      // Normalize column i
      let n = 0;
      for (let j = 0; j < this.dimensions; j++) {
        n += this.rotationMatrix[j][i] * this.rotationMatrix[j][i];
      }
      n = Math.sqrt(n);
      if (n > 1e-10) {
        for (let j = 0; j < this.dimensions; j++) {
          this.rotationMatrix[j][i] /= n;
        }
      }

      // Remove component from remaining columns
      for (let k = i + 1; k < this.dimensions; k++) {
        let projection = 0;
        for (let j = 0; j < this.dimensions; j++) {
          projection += this.rotationMatrix[j][i] * this.rotationMatrix[j][k];
        }
        for (let j = 0; j < this.dimensions; j++) {
          this.rotationMatrix[j][k] -= projection * this.rotationMatrix[j][i];
        }
      }
    }
  }

  /**
   * Encodes vectors with rotation.
   */
  override encode(vectors: number[][]): Uint8Array[] {
    const rotated = this.rotateVectors(vectors);
    return super.encode(rotated);
  }

  /**
   * Decodes codes and applies inverse rotation.
   */
  override decode(codes: Uint8Array[]): number[][] {
    const decoded = super.decode(codes);
    if (!this.rotationMatrix) {
      return decoded;
    }
    // Apply inverse rotation (transpose for orthogonal matrix)
    const invRotation = transpose(this.rotationMatrix);
    return decoded.map(v => matVec(invRotation, v));
  }

  /**
   * Computes distances with rotation applied to query.
   */
  override computeDistances(query: number[], codes: Uint8Array[]): number[] {
    const rotatedQuery = this.rotationMatrix
      ? matVec(this.rotationMatrix, query)
      : query;
    return super.computeDistances(rotatedQuery, codes);
  }

  /**
   * Gets the rotation matrix.
   */
  getRotationMatrix(): number[][] | null {
    return this.rotationMatrix ? this.rotationMatrix.map(r => [...r]) : null;
  }

  /**
   * Sets the rotation matrix directly.
   */
  setRotationMatrix(matrix: number[][]): void {
    if (matrix.length !== this.dimensions || matrix[0].length !== this.dimensions) {
      throw new Error(`Expected ${this.dimensions}x${this.dimensions} matrix`);
    }
    this.rotationMatrix = matrix.map(r => [...r]);
  }
}

// ============================================================================
// SQL Integration
// ============================================================================

/**
 * QuantizationSQL generates SQL for quantized vector operations.
 *
 * Provides SQL statements for:
 * - Creating quantized storage tables
 * - Inserting quantized vectors
 * - Searching with quantized distances
 */
export class QuantizationSQL {
  /**
   * Generates SQL for creating a table with quantized vector storage.
   *
   * @param tableName - Table name
   * @param type - Quantization type
   * @param options - Quantization options
   * @returns CREATE TABLE SQL statement
   */
  static createQuantizedTable(
    tableName: string,
    type: QuantizationType,
    options?: {
      dimensions?: number;
      numSubvectors?: number;
      idType?: 'SERIAL' | 'BIGSERIAL' | 'UUID';
      additionalColumns?: string;
    }
  ): string {
    const {
      dimensions = 128,
      numSubvectors = 8,
      idType = 'BIGSERIAL',
      additionalColumns = '',
    } = options ?? {};

    let vectorColumn: string;
    let comment: string;

    switch (type) {
      case 'scalar':
        vectorColumn = `quantized_vector BYTEA NOT NULL`;
        comment = `Scalar quantized vectors (int8, ${dimensions} dims, 4x compression)`;
        break;

      case 'binary':
        const binaryBytes = Math.ceil(dimensions / 8);
        vectorColumn = `binary_vector BIT(${dimensions})`;
        comment = `Binary quantized vectors (${dimensions} dims, ${binaryBytes} bytes, 32x compression)`;
        break;

      case 'pq':
      case 'opq':
        vectorColumn = `pq_codes BYTEA NOT NULL`;
        comment = `${type === 'opq' ? 'Optimized ' : ''}Product quantized vectors (M=${numSubvectors}, K=256)`;
        break;

      default:
        throw new Error(`Unknown quantization type: ${type}`);
    }

    const extraCols = additionalColumns ? `\n  ${additionalColumns},` : '';

    return `
-- Table for ${comment}
CREATE TABLE IF NOT EXISTS ${tableName} (
  id ${idType} PRIMARY KEY,${extraCols}
  original_vector vector(${dimensions}),  -- Optional: keep original for reranking
  ${vectorColumn},
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Index for quantized search
CREATE INDEX IF NOT EXISTS idx_${tableName}_quantized ON ${tableName} (quantized_vector);

COMMENT ON TABLE ${tableName} IS '${comment}';
    `.trim();
  }

  /**
   * Generates SQL for inserting a quantized vector.
   *
   * @param tableName - Table name
   * @param type - Quantization type
   * @returns INSERT SQL template with placeholders
   */
  static insertQuantizedSQL(tableName: string, type: QuantizationType): string {
    const column = type === 'binary' ? 'binary_vector' :
                   (type === 'pq' || type === 'opq') ? 'pq_codes' : 'quantized_vector';

    return `
INSERT INTO ${tableName} (original_vector, ${column}, metadata)
VALUES ($1::vector, $2, $3::jsonb)
RETURNING id;
    `.trim();
  }

  /**
   * Generates SQL for batch insert of quantized vectors.
   *
   * @param tableName - Table name
   * @param type - Quantization type
   * @param count - Number of vectors
   * @returns Batch INSERT SQL
   */
  static batchInsertSQL(
    tableName: string,
    type: QuantizationType,
    count: number
  ): string {
    const column = type === 'binary' ? 'binary_vector' :
                   (type === 'pq' || type === 'opq') ? 'pq_codes' : 'quantized_vector';

    const values = Array.from({ length: count }, (_, i) => {
      const offset = i * 3;
      return `($${offset + 1}::vector, $${offset + 2}, $${offset + 3}::jsonb)`;
    }).join(',\n  ');

    return `
INSERT INTO ${tableName} (original_vector, ${column}, metadata)
VALUES
  ${values}
RETURNING id;
    `.trim();
  }

  /**
   * Generates SQL for scalar quantized search.
   *
   * @param tableName - Table name
   * @param k - Number of results
   * @param useReranking - Whether to rerank with original vectors
   * @returns Search SQL template
   */
  static scalarSearchSQL(
    tableName: string,
    k: number,
    useReranking: boolean = true
  ): string {
    if (useReranking) {
      // Two-stage search: filter with quantized, rerank with original
      const filterK = k * 10;
      return `
WITH candidates AS (
  SELECT id, original_vector, metadata,
         ruvector_scalar_distance(quantized_vector, $1::bytea) AS approx_dist
  FROM ${tableName}
  ORDER BY approx_dist ASC
  LIMIT ${filterK}
)
SELECT id, metadata,
       original_vector <-> $2::vector AS exact_dist
FROM candidates
ORDER BY exact_dist ASC
LIMIT ${k};
      `.trim();
    }

    return `
SELECT id, metadata,
       ruvector_scalar_distance(quantized_vector, $1::bytea) AS distance
FROM ${tableName}
ORDER BY distance ASC
LIMIT ${k};
    `.trim();
  }

  /**
   * Generates SQL for binary quantized search with Hamming distance.
   *
   * @param tableName - Table name
   * @param k - Number of results
   * @param useReranking - Whether to rerank with original vectors
   * @returns Search SQL template
   */
  static binarySearchSQL(
    tableName: string,
    k: number,
    useReranking: boolean = true
  ): string {
    if (useReranking) {
      const filterK = k * 10;
      return `
WITH candidates AS (
  SELECT id, original_vector, metadata,
         bit_count(binary_vector # $1::bit) AS hamming_dist
  FROM ${tableName}
  ORDER BY hamming_dist ASC
  LIMIT ${filterK}
)
SELECT id, metadata,
       original_vector <-> $2::vector AS exact_dist
FROM candidates
ORDER BY exact_dist ASC
LIMIT ${k};
      `.trim();
    }

    return `
SELECT id, metadata,
       bit_count(binary_vector # $1::bit) AS hamming_distance
FROM ${tableName}
ORDER BY hamming_distance ASC
LIMIT ${k};
    `.trim();
  }

  /**
   * Generates SQL for PQ search using distance lookup tables.
   *
   * @param tableName - Table name
   * @param k - Number of results
   * @param numSubvectors - Number of PQ subvectors
   * @param useReranking - Whether to rerank
   * @returns Search SQL template
   */
  static pqSearchSQL(
    tableName: string,
    k: number,
    numSubvectors: number = 8,
    useReranking: boolean = true
  ): string {
    // Generate SQL for lookup table based distance computation
    const distanceTerms = Array.from(
      { length: numSubvectors },
      (_, m) => `ruvector_pq_subvector_dist($1, ${m}, get_byte(pq_codes, ${m}))`
    ).join(' + ');

    if (useReranking) {
      const filterK = k * 10;
      return `
WITH candidates AS (
  SELECT id, original_vector, metadata,
         sqrt(${distanceTerms}) AS approx_dist
  FROM ${tableName}
  ORDER BY approx_dist ASC
  LIMIT ${filterK}
)
SELECT id, metadata,
       original_vector <-> $2::vector AS exact_dist
FROM candidates
ORDER BY exact_dist ASC
LIMIT ${k};
      `.trim();
    }

    return `
SELECT id, metadata,
       sqrt(${distanceTerms}) AS distance
FROM ${tableName}
ORDER BY distance ASC
LIMIT ${k};
    `.trim();
  }

  /**
   * Generates SQL for creating PQ lookup tables.
   *
   * @param tableName - Lookup table name
   * @param numSubvectors - Number of subvectors (M)
   * @param numCentroids - Number of centroids (K)
   * @returns CREATE TABLE SQL for lookup tables
   */
  static createPQLookupTables(
    tableName: string,
    numSubvectors: number = 8,
    numCentroids: number = 256
  ): string {
    return `
-- PQ codebooks storage
CREATE TABLE IF NOT EXISTS ${tableName}_codebooks (
  subvector_id INTEGER NOT NULL,
  centroid_id INTEGER NOT NULL,
  centroid vector NOT NULL,
  PRIMARY KEY (subvector_id, centroid_id)
);

-- Precomputed distance lookup (for specific queries)
CREATE TABLE IF NOT EXISTS ${tableName}_distance_lookup (
  query_id BIGINT NOT NULL,
  subvector_id INTEGER NOT NULL,
  centroid_id INTEGER NOT NULL,
  squared_distance REAL NOT NULL,
  PRIMARY KEY (query_id, subvector_id, centroid_id)
);

CREATE INDEX IF NOT EXISTS idx_${tableName}_lookup_query
ON ${tableName}_distance_lookup (query_id, subvector_id);

COMMENT ON TABLE ${tableName}_codebooks IS 'PQ codebooks: M=${numSubvectors}, K=${numCentroids}';
    `.trim();
  }

  /**
   * Generates SQL for inserting PQ codebooks.
   *
   * @param tableName - Base table name
   * @param codebooks - Trained codebooks
   * @returns INSERT SQL for codebooks
   */
  static insertCodebooksSQL(
    tableName: string,
    codebooks: Array<{ centroids: number[][] }>
  ): string {
    const values: string[] = [];

    for (let m = 0; m < codebooks.length; m++) {
      for (let k = 0; k < codebooks[m].centroids.length; k++) {
        const centroidStr = `'[${codebooks[m].centroids[k].join(',')}]'`;
        values.push(`(${m}, ${k}, ${centroidStr}::vector)`);
      }
    }

    return `
INSERT INTO ${tableName}_codebooks (subvector_id, centroid_id, centroid)
VALUES
  ${values.join(',\n  ')}
ON CONFLICT (subvector_id, centroid_id) DO UPDATE
SET centroid = EXCLUDED.centroid;
    `.trim();
  }

  /**
   * Generates SQL function for computing PQ distance.
   *
   * @param functionName - Function name
   * @param numSubvectors - Number of subvectors
   * @returns CREATE FUNCTION SQL
   */
  static createPQDistanceFunction(
    functionName: string = 'pq_asymmetric_distance',
    numSubvectors: number = 8
  ): string {
    return `
CREATE OR REPLACE FUNCTION ${functionName}(
  query_vector vector,
  pq_codes bytea,
  codebook_table text
)
RETURNS real AS $$
DECLARE
  total_distance real := 0;
  m integer;
  code integer;
  subvector_dim integer;
  query_subvector vector;
  centroid vector;
BEGIN
  subvector_dim := vector_dims(query_vector) / ${numSubvectors};

  FOR m IN 0..${numSubvectors - 1} LOOP
    code := get_byte(pq_codes, m);

    -- Extract query subvector
    query_subvector := vector_slice(query_vector, m * subvector_dim, (m + 1) * subvector_dim);

    -- Get centroid from codebook
    EXECUTE format('SELECT centroid FROM %I WHERE subvector_id = $1 AND centroid_id = $2',
                   codebook_table || '_codebooks')
    INTO centroid
    USING m, code;

    -- Add squared distance
    total_distance := total_distance + (query_subvector <-> centroid)^2;
  END LOOP;

  RETURN sqrt(total_distance);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
    `.trim();
  }

  /**
   * Generates SQL for OPQ with rotation.
   *
   * @param tableName - Table name
   * @param dimensions - Vector dimensions
   * @returns SQL for rotation matrix storage
   */
  static createOPQRotationTable(tableName: string, dimensions: number): string {
    return `
-- OPQ rotation matrix storage
CREATE TABLE IF NOT EXISTS ${tableName}_rotation (
  row_id INTEGER NOT NULL,
  col_id INTEGER NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (row_id, col_id)
);

-- Function to apply rotation
CREATE OR REPLACE FUNCTION ${tableName}_rotate_vector(v vector)
RETURNS vector AS $$
DECLARE
  result float8[];
  i integer;
  sum float8;
  j integer;
BEGIN
  result := array_fill(0::float8, ARRAY[${dimensions}]);

  FOR i IN 0..${dimensions - 1} LOOP
    sum := 0;
    FOR j IN 0..${dimensions - 1} LOOP
      SELECT sum + r.value * v[j+1]
      INTO sum
      FROM ${tableName}_rotation r
      WHERE r.row_id = i AND r.col_id = j;
    END LOOP;
    result[i+1] := sum;
  END LOOP;

  RETURN result::vector;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON TABLE ${tableName}_rotation IS 'OPQ rotation matrix (${dimensions}x${dimensions})';
    `.trim();
  }

  /**
   * Generates SQL for quantization statistics view.
   *
   * @param tableName - Base table name
   * @returns CREATE VIEW SQL
   */
  static createStatsView(tableName: string): string {
    return `
CREATE OR REPLACE VIEW ${tableName}_quantization_stats AS
SELECT
  pg_total_relation_size('${tableName}'::regclass) AS total_size_bytes,
  pg_relation_size('${tableName}'::regclass) AS table_size_bytes,
  pg_indexes_size('${tableName}'::regclass) AS index_size_bytes,
  (SELECT count(*) FROM ${tableName}) AS row_count,
  CASE
    WHEN (SELECT count(*) FROM ${tableName}) > 0
    THEN pg_relation_size('${tableName}'::regclass)::float / (SELECT count(*) FROM ${tableName})
    ELSE 0
  END AS avg_bytes_per_row;
    `.trim();
  }
}

// ============================================================================
// Factory and Utilities
// ============================================================================

/**
 * Creates a quantizer based on the specified type.
 *
 * @param type - Quantization type
 * @param options - Type-specific options
 * @returns Configured quantizer instance
 *
 * @example
 * ```typescript
 * const scalar = createQuantizer('scalar', { dimensions: 128 });
 * const binary = createQuantizer('binary', { dimensions: 128 });
 * const pq = createQuantizer('pq', { dimensions: 128, numSubvectors: 8, numCentroids: 256 });
 * ```
 */
export function createQuantizer(
  type: 'scalar',
  options: ScalarQuantizationOptions
): ScalarQuantizer;
export function createQuantizer(
  type: 'binary',
  options: BinaryQuantizationOptions
): BinaryQuantizer;
export function createQuantizer(
  type: 'pq',
  options: ProductQuantizationOptions
): ProductQuantizer;
export function createQuantizer(
  type: 'opq',
  options: OptimizedProductQuantizationOptions
): OptimizedProductQuantizer;
export function createQuantizer(
  type: QuantizationType,
  options?: QuantizationOptions
): IQuantizer;
export function createQuantizer(
  type: QuantizationType,
  options?: QuantizationOptions
): IQuantizer {
  switch (type) {
    case 'scalar':
      return new ScalarQuantizer(options as ScalarQuantizationOptions);
    case 'binary':
      return new BinaryQuantizer(options as BinaryQuantizationOptions);
    case 'pq':
      return new ProductQuantizer(options as ProductQuantizationOptions);
    case 'opq':
      return new OptimizedProductQuantizer(options as OptimizedProductQuantizationOptions);
    default:
      throw new Error(`Unknown quantization type: ${type}`);
  }
}

/**
 * Computes quantization statistics by comparing original and reconstructed vectors.
 *
 * @param original - Original vectors
 * @param reconstructed - Reconstructed vectors after quantization
 * @param quantizer - The quantizer used
 * @returns Quantization statistics
 */
export function computeQuantizationStats(
  original: number[][],
  reconstructed: number[][],
  quantizer: IQuantizer
): QuantizationStats {
  if (original.length !== reconstructed.length) {
    throw new Error('Original and reconstructed arrays must have same length');
  }

  // Compute MSE
  let mse = 0;
  for (let i = 0; i < original.length; i++) {
    mse += squaredEuclideanDistance(original[i], reconstructed[i]);
  }
  mse /= original.length;

  // Estimate recall@10 by comparing rankings
  // (simplified - real evaluation would use a test set)
  const recallAt10 = estimateRecall(original, reconstructed, 10);

  return {
    compressionRatio: quantizer.getCompressionRatio(),
    memoryReduction: quantizer.getMemoryReduction(),
    recallAt10,
    searchSpeedup: quantizer.getCompressionRatio() * 0.8, // Approximate
    mse,
  };
}

/**
 * Estimates recall@k by comparing original and reconstructed rankings.
 */
function estimateRecall(
  original: number[][],
  reconstructed: number[][],
  k: number
): number {
  if (original.length < k + 1) {
    return 1.0; // Not enough data to evaluate
  }

  let totalRecall = 0;
  const numQueries = Math.min(100, original.length);

  for (let q = 0; q < numQueries; q++) {
    const query = original[q];

    // Get true top-k using original vectors
    const trueDistances: Array<{ idx: number; dist: number }> = [];
    for (let i = 0; i < original.length; i++) {
      if (i !== q) {
        trueDistances.push({
          idx: i,
          dist: euclideanDistance(query, original[i]),
        });
      }
    }
    trueDistances.sort((a, b) => a.dist - b.dist);
    const trueTopK = new Set(trueDistances.slice(0, k).map(d => d.idx));

    // Get approx top-k using reconstructed vectors
    const approxDistances: Array<{ idx: number; dist: number }> = [];
    for (let i = 0; i < reconstructed.length; i++) {
      if (i !== q) {
        approxDistances.push({
          idx: i,
          dist: euclideanDistance(query, reconstructed[i]),
        });
      }
    }
    approxDistances.sort((a, b) => a.dist - b.dist);
    const approxTopK = approxDistances.slice(0, k).map(d => d.idx);

    // Count intersection
    let hits = 0;
    for (const idx of approxTopK) {
      if (trueTopK.has(idx)) {
        hits++;
      }
    }

    totalRecall += hits / k;
  }

  return totalRecall / numQueries;
}

/**
 * Serializes a quantizer to JSON for persistence.
 *
 * @param quantizer - Quantizer to serialize
 * @returns JSON-serializable object
 */
export function serializeQuantizer(quantizer: IQuantizer): Record<string, unknown> {
  const base = {
    type: quantizer.type,
    dimensions: quantizer.dimensions,
  };

  if (quantizer instanceof ScalarQuantizer) {
    return {
      ...base,
      calibration: quantizer.getCalibration(),
    };
  }

  if (quantizer instanceof OptimizedProductQuantizer) {
    return {
      ...base,
      numSubvectors: quantizer.numSubvectors,
      numCentroids: quantizer.numCentroids,
      codebooks: quantizer.getCodebooks(),
      rotationMatrix: quantizer.getRotationMatrix(),
    };
  }

  if (quantizer instanceof ProductQuantizer) {
    return {
      ...base,
      numSubvectors: quantizer.numSubvectors,
      numCentroids: quantizer.numCentroids,
      codebooks: quantizer.getCodebooks(),
    };
  }

  if (quantizer instanceof BinaryQuantizer) {
    return base;
  }

  return base;
}

/**
 * Deserializes a quantizer from JSON.
 *
 * @param data - Serialized quantizer data
 * @returns Restored quantizer instance
 */
export function deserializeQuantizer(data: Record<string, unknown>): IQuantizer {
  const type = data.type as QuantizationType;
  const dimensions = data.dimensions as number;

  switch (type) {
    case 'scalar': {
      const quantizer = new ScalarQuantizer({ dimensions });
      if (data.calibration) {
        quantizer.setCalibration(data.calibration as CalibrationData);
      }
      return quantizer;
    }

    case 'binary': {
      return new BinaryQuantizer({ dimensions });
    }

    case 'pq': {
      const quantizer = new ProductQuantizer({
        dimensions,
        numSubvectors: data.numSubvectors as number,
        numCentroids: data.numCentroids as number,
      });
      if (data.codebooks) {
        quantizer.setCodebooks(data.codebooks as Codebook[]);
      }
      return quantizer;
    }

    case 'opq': {
      const quantizer = new OptimizedProductQuantizer({
        dimensions,
        numSubvectors: data.numSubvectors as number,
        numCentroids: data.numCentroids as number,
      });
      if (data.codebooks) {
        quantizer.setCodebooks(data.codebooks as Codebook[]);
      }
      if (data.rotationMatrix) {
        quantizer.setRotationMatrix(data.rotationMatrix as number[][]);
      }
      return quantizer;
    }

    default:
      throw new Error(`Unknown quantization type: ${type}`);
  }
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default configurations for different use cases.
 */
export const QUANTIZATION_PRESETS = {
  /** Fast search with good accuracy (scalar int8) */
  balanced: {
    type: 'scalar' as const,
    options: {
      dimensions: 128,
      symmetric: true,
    },
  },

  /** Maximum compression (binary) */
  maxCompression: {
    type: 'binary' as const,
    options: {
      dimensions: 128,
      threshold: 0,
    },
  },

  /** High accuracy with compression (PQ) */
  highAccuracy: {
    type: 'pq' as const,
    options: {
      dimensions: 128,
      numSubvectors: 16,
      numCentroids: 256,
    },
  },

  /** Best accuracy (OPQ) */
  bestAccuracy: {
    type: 'opq' as const,
    options: {
      dimensions: 128,
      numSubvectors: 16,
      numCentroids: 256,
      opqIterations: 10,
    },
  },
} as const;

/**
 * Memory reduction factors for each quantization type.
 */
export const MEMORY_REDUCTION = {
  scalar: 4,    // float32 -> int8
  binary: 32,   // float32 -> 1 bit
  pq: 16,       // Typical for M=8, K=256
  opq: 16,      // Same as PQ
} as const;
