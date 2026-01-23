/**
 * Spectral Engine - Stability Analysis
 *
 * Implements spectral graph theory analysis for system stability.
 * Uses eigenvalue decomposition to detect clustering, connectivity,
 * and stability issues in multi-agent systems.
 */

import type {
  ISpectralEngine,
  SpectralResult,
  SpectralGap,
  WasmModule
} from '../types.js';

/**
 * SpectralEngine - WASM wrapper for spectral stability analysis
 */
export class SpectralEngine implements ISpectralEngine {
  private wasmModule: WasmModule | null = null;
  private readonly stabilityThreshold = 0.1;

  constructor(wasmModule?: WasmModule) {
    this.wasmModule = wasmModule ?? null;
  }

  /**
   * Set the WASM module after initialization
   */
  setWasmModule(module: WasmModule): void {
    this.wasmModule = module;
  }

  /**
   * Analyze stability of a system represented as adjacency matrix
   *
   * @param matrix - Adjacency matrix (2D array)
   * @returns SpectralResult with stability metrics
   */
  async analyzeStability(matrix: number[][]): Promise<SpectralResult> {
    const n = matrix.length;
    if (n === 0) {
      return {
        stable: true,
        eigenvalues: [],
        spectralGap: 1,
        stabilityIndex: 1
      };
    }

    // Flatten matrix for WASM
    const flat = new Float32Array(n * n);
    for (let i = 0; i < n; i++) {
      const row = matrix[i];
      if (!row) continue;
      for (let j = 0; j < n; j++) {
        flat[i * n + j] = row[j] ?? 0;
      }
    }

    const eigenvalues = await this.computeEigenvalues(flat);
    const spectralGap = this.computeSpectralGap(eigenvalues);
    const stabilityIndex = this.computeStabilityIndex(eigenvalues);

    return {
      stable: spectralGap > this.stabilityThreshold,
      eigenvalues,
      spectralGap,
      stabilityIndex
    };
  }

  /**
   * Compute eigenvalues of a matrix
   *
   * @param matrix - Square matrix (2D array or flattened Float32Array)
   * @returns Sorted eigenvalues (descending)
   */
  async computeEigenvalues(matrix: number[][] | Float32Array): Promise<number[]> {
    let flat: Float32Array;
    let n: number;

    if (matrix instanceof Float32Array) {
      flat = matrix;
      n = Math.sqrt(matrix.length);
      if (n !== Math.floor(n)) {
        throw new Error('Matrix must be square');
      }
    } else {
      n = matrix.length;
      flat = new Float32Array(n * n);
      for (let i = 0; i < n; i++) {
        const row = matrix[i];
        if (!row) continue;
        for (let j = 0; j < n; j++) {
          flat[i * n + j] = row[j] ?? 0;
        }
      }
    }

    if (n === 0) return [];
    if (n === 1) return [flat[0] ?? 0];

    if (this.wasmModule) {
      // Use WASM for eigenvalue computation
      const result = this.wasmModule.spectral_compute_eigenvalues(flat, n);
      return Array.from(result).sort((a, b) => b - a);
    }

    // Pure JS fallback - power iteration for top eigenvalues
    return this.computeEigenvaluesJS(flat, n);
  }

  /**
   * Compute spectral gap (difference between first and second eigenvalues)
   *
   * @param eigenvalues - Array of eigenvalues
   * @returns Spectral gap value
   */
  computeSpectralGap(eigenvalues: number[]): number {
    if (eigenvalues.length < 2) {
      return 1; // Trivially stable
    }

    const sorted = [...eigenvalues].sort((a, b) => b - a);
    const first = sorted[0] ?? 0;
    const second = sorted[1] ?? 0;
    return Math.abs(first - second);
  }

  /**
   * Compute stability index from eigenvalues
   *
   * @param eigenvalues - Array of eigenvalues
   * @returns Stability index [0, 1]
   */
  computeStabilityIndex(eigenvalues: number[]): number {
    if (eigenvalues.length === 0) return 1;

    if (this.wasmModule) {
      const eigArray = new Float32Array(eigenvalues);
      return this.wasmModule.spectral_stability_index(eigArray);
    }

    // Pure JS implementation
    // Stability index based on eigenvalue distribution
    const sorted = [...eigenvalues].sort((a, b) => b - a);
    const spectralGap = this.computeSpectralGap(sorted);
    const maxEig = Math.abs(sorted[0]);

    if (maxEig === 0) return 1;

    // Combine spectral gap with eigenvalue concentration
    const gapRatio = spectralGap / maxEig;

    // Check for negative eigenvalues (instability indicator)
    const negativeCount = sorted.filter(e => e < 0).length;
    const negativePenalty = negativeCount / eigenvalues.length;

    // Stability index: higher is more stable
    const rawIndex = gapRatio * (1 - negativePenalty * 0.5);

    // Normalize to [0, 1]
    return Math.max(0, Math.min(1, rawIndex));
  }

  /**
   * Create SpectralGap value object
   */
  createSpectralGap(eigenvalues: number[]): SpectralGap {
    const value = this.computeSpectralGap(eigenvalues);

    let stabilityLevel: 'stable' | 'marginal' | 'unstable';
    if (value > 0.2) {
      stabilityLevel = 'stable';
    } else if (value > 0.05) {
      stabilityLevel = 'marginal';
    } else {
      stabilityLevel = 'unstable';
    }

    return {
      value,
      stable: value > this.stabilityThreshold,
      stabilityLevel
    };
  }

  /**
   * Build Laplacian matrix from adjacency matrix
   */
  buildLaplacian(adjacency: Float32Array, n: number): Float32Array {
    const laplacian = new Float32Array(n * n);

    // Compute degree matrix and subtract adjacency
    for (let i = 0; i < n; i++) {
      let degree = 0;
      for (let j = 0; j < n; j++) {
        degree += adjacency[i * n + j];
        laplacian[i * n + j] = -adjacency[i * n + j];
      }
      laplacian[i * n + i] = degree;
    }

    return laplacian;
  }

  /**
   * Pure JS eigenvalue computation using power iteration
   */
  private computeEigenvaluesJS(matrix: Float32Array, n: number): number[] {
    const eigenvalues: number[] = [];
    const workingMatrix = new Float32Array(matrix);
    const maxIterations = 100;
    const tolerance = 1e-6;

    // Compute top k eigenvalues using deflation
    const k = Math.min(n, 10); // Top 10 eigenvalues

    for (let eigenIndex = 0; eigenIndex < k; eigenIndex++) {
      // Power iteration for dominant eigenvalue
      let v = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        v[i] = Math.random();
      }
      v = this.normalizeVector(v);

      let eigenvalue = 0;
      for (let iter = 0; iter < maxIterations; iter++) {
        // Multiply matrix by vector
        const Av = this.matrixVectorMultiply(workingMatrix, v, n);

        // Compute Rayleigh quotient
        const newEigenvalue = this.dotProduct(v, Av);

        // Normalize
        v = this.normalizeVector(Av);

        // Check convergence
        if (Math.abs(newEigenvalue - eigenvalue) < tolerance) {
          eigenvalue = newEigenvalue;
          break;
        }
        eigenvalue = newEigenvalue;
      }

      eigenvalues.push(eigenvalue);

      // Deflate matrix: A' = A - lambda * v * v^T
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          workingMatrix[i * n + j] -= eigenvalue * v[i] * v[j];
        }
      }
    }

    return eigenvalues.sort((a, b) => b - a);
  }

  /**
   * Matrix-vector multiplication
   */
  private matrixVectorMultiply(matrix: Float32Array, vector: Float32Array, n: number): Float32Array {
    const result = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sum += matrix[i * n + j] * vector[j];
      }
      result[i] = sum;
    }
    return result;
  }

  /**
   * Normalize vector to unit length
   */
  private normalizeVector(v: Float32Array): Float32Array {
    let norm = 0;
    for (let i = 0; i < v.length; i++) {
      norm += v[i] * v[i];
    }
    norm = Math.sqrt(norm);

    if (norm === 0) return v;

    const result = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) {
      result[i] = v[i] / norm;
    }
    return result;
  }

  /**
   * Dot product of two vectors
   */
  private dotProduct(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }
}
