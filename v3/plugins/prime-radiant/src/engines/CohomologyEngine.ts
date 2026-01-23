/**
 * Cohomology Engine - Sheaf Laplacian Coherence
 *
 * Implements coherence checking using sheaf cohomology and Laplacian energy.
 * Energy 0 = fully coherent, Energy 1 = fully contradictory.
 *
 * Based on: https://arxiv.org/abs/1808.04718 (Sheaf Laplacian Theory)
 */

import type {
  ICohomologyEngine,
  CoherenceResult,
  CoherenceEnergy,
  Sheaf,
  WasmModule
} from '../types.js';

/**
 * CohomologyEngine - WASM wrapper for sheaf Laplacian coherence checking
 */
export class CohomologyEngine implements ICohomologyEngine {
  private wasmModule: WasmModule | null = null;
  private readonly coherenceThreshold = 0.3;
  private readonly contradictionThreshold = 0.7;

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
   * Check coherence of a set of vectors using Sheaf Laplacian energy
   *
   * @param vectors - Array of embedding vectors to check
   * @returns CoherenceResult with energy and violation details
   */
  async checkCoherence(vectors: Float32Array[]): Promise<CoherenceResult> {
    if (vectors.length === 0) {
      return {
        coherent: true,
        energy: 0,
        violations: [],
        confidence: 1
      };
    }

    if (vectors.length === 1) {
      return {
        coherent: true,
        energy: 0,
        violations: [],
        confidence: 1
      };
    }

    const energy = await this.computeSheafLaplacianEnergy(vectors);
    const violations = await this.detectContradictions(vectors);

    return {
      coherent: energy < this.coherenceThreshold,
      energy,
      violations,
      confidence: 1 - energy
    };
  }

  /**
   * Compute Sheaf Laplacian energy for coherence measurement
   *
   * @param sheaf - Sheaf structure with vertices, edges, and restrictions
   * @returns Energy value [0, 1]
   */
  async computeLaplacianEnergy(sheaf: Sheaf): Promise<number> {
    // Convert sheaf to vector representation
    const vectors: Float32Array[] = [];
    for (const restriction of sheaf.restrictions.values()) {
      vectors.push(restriction);
    }

    if (vectors.length === 0) {
      return 0;
    }

    return this.computeSheafLaplacianEnergy(vectors);
  }

  /**
   * Detect contradictions in a set of vectors
   *
   * @param vectors - Embedding vectors to analyze
   * @returns Array of violation descriptions
   */
  async detectContradictions(vectors: Float32Array[]): Promise<string[]> {
    if (vectors.length < 2) {
      return [];
    }

    const violations: string[] = [];

    if (this.wasmModule) {
      // Use WASM for detection
      const { flattened, dims } = this.flattenVectors(vectors);
      const resultPtr = this.wasmModule.cohomology_detect_contradictions(flattened, dims);

      // Parse WASM result - returns indices of contradicting pairs
      const numPairs = resultPtr[0];
      for (let i = 0; i < numPairs; i++) {
        const idx1 = resultPtr[1 + i * 2];
        const idx2 = resultPtr[2 + i * 2];
        violations.push(`Contradiction between vectors ${idx1} and ${idx2}`);
      }
    } else {
      // Pure JS fallback - pairwise similarity check
      for (let i = 0; i < vectors.length; i++) {
        for (let j = i + 1; j < vectors.length; j++) {
          const vecI = vectors[i];
          const vecJ = vectors[j];
          if (!vecI || !vecJ) continue;
          const similarity = this.cosineSimilarity(vecI, vecJ);

          // Highly dissimilar vectors (negative similarity) indicate contradiction
          if (similarity < -0.5) {
            violations.push(`Contradiction between vectors ${i} and ${j} (similarity: ${similarity.toFixed(3)})`);
          }
        }
      }
    }

    return violations;
  }

  /**
   * Create CoherenceEnergy value object from raw energy
   */
  createCoherenceEnergy(value: number): CoherenceEnergy {
    const clampedValue = Math.max(0, Math.min(1, value));

    let level: 'coherent' | 'warning' | 'contradictory';
    if (clampedValue < this.coherenceThreshold) {
      level = 'coherent';
    } else if (clampedValue < this.contradictionThreshold) {
      level = 'warning';
    } else {
      level = 'contradictory';
    }

    return {
      value: clampedValue,
      coherent: clampedValue < this.coherenceThreshold,
      confidence: 1 - clampedValue,
      level
    };
  }

  /**
   * Internal: Compute Sheaf Laplacian energy from vectors
   */
  private async computeSheafLaplacianEnergy(vectors: Float32Array[]): Promise<number> {
    if (this.wasmModule) {
      // Use WASM module for computation
      const { flattened, dims } = this.flattenVectors(vectors);
      return this.wasmModule.cohomology_compute_energy(flattened, dims);
    }

    // Pure JS fallback implementation
    return this.computeEnergyJS(vectors);
  }

  /**
   * Pure JS implementation of Sheaf Laplacian energy
   * Uses the graph Laplacian approximation
   */
  private computeEnergyJS(vectors: Float32Array[]): number {
    const n = vectors.length;
    if (n < 2) return 0;

    // Build similarity matrix
    const similarities: number[][] = [];
    for (let i = 0; i < n; i++) {
      similarities[i] = [];
      for (let j = 0; j < n; j++) {
        const vecI = vectors[i];
        const vecJ = vectors[j];
        if (!vecI || !vecJ) {
          similarities[i]![j] = 0;
        } else {
          similarities[i]![j] = i === j ? 0 : this.cosineSimilarity(vecI, vecJ);
        }
      }
    }

    // Compute Laplacian energy as sum of squared differences weighted by similarity
    let energy = 0;
    let totalWeight = 0;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const weight = Math.max(0, 1 - similarities[i][j]); // Dissimilarity weight
        const diff = this.vectorDifference(vectors[i], vectors[j]);
        const diffNorm = this.vectorNorm(diff);

        energy += weight * diffNorm * diffNorm;
        totalWeight += weight;
      }
    }

    // Normalize to [0, 1]
    if (totalWeight === 0) return 0;
    const normalizedEnergy = energy / totalWeight;

    // Apply sigmoid to map to [0, 1]
    return 1 / (1 + Math.exp(-normalizedEnergy + 2));
  }

  /**
   * Compute cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  /**
   * Compute difference between two vectors
   */
  private vectorDifference(a: Float32Array, b: Float32Array): Float32Array {
    const result = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) {
      result[i] = a[i] - b[i];
    }
    return result;
  }

  /**
   * Compute L2 norm of a vector
   */
  private vectorNorm(v: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < v.length; i++) {
      sum += v[i] * v[i];
    }
    return Math.sqrt(sum);
  }

  /**
   * Flatten array of vectors for WASM
   */
  private flattenVectors(vectors: Float32Array[]): { flattened: Float32Array; dims: Uint32Array } {
    const dims = new Uint32Array(vectors.length);
    let totalSize = 0;

    for (let i = 0; i < vectors.length; i++) {
      dims[i] = vectors[i].length;
      totalSize += vectors[i].length;
    }

    const flattened = new Float32Array(totalSize);
    let offset = 0;

    for (const vector of vectors) {
      flattened.set(vector, offset);
      offset += vector.length;
    }

    return { flattened, dims };
  }
}
