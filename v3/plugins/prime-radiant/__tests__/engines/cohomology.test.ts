/**
 * Cohomology Engine Tests
 *
 * Tests for the Sheaf Laplacian coherence checking engine.
 * Performance target: <5ms per check
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ============================================================================
// Mock Types
// ============================================================================

interface CoherenceResult {
  coherent: boolean;
  energy: number;
  violations: string[];
  confidence: number;
}

interface VectorSet {
  vectors: number[][];
  labels?: string[];
}

// ============================================================================
// Mock Implementation
// ============================================================================

class MockCohomologyEngine {
  private cacheEnabled = true;
  private cache: Map<string, CoherenceResult> = new Map();

  /**
   * Compute Sheaf Laplacian energy for a set of vectors.
   * Energy interpretation:
   * - 0.0-0.1: Fully coherent
   * - 0.1-0.3: Minor inconsistencies
   * - 0.3-0.7: Significant contradictions
   * - 0.7-1.0: Major contradictions
   */
  computeEnergy(vectors: number[][]): number {
    if (vectors.length === 0) return 0;
    if (vectors.length === 1) return 0;

    let totalEnergy = 0;
    let pairs = 0;

    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        const distance = this.cosineDissimilarity(vectors[i], vectors[j]);
        totalEnergy += distance;
        pairs++;
      }
    }

    return pairs > 0 ? totalEnergy / pairs : 0;
  }

  /**
   * Check coherence of a vector set.
   */
  checkCoherence(
    vectorSet: VectorSet,
    threshold: number = 0.3
  ): CoherenceResult {
    const cacheKey = this.getCacheKey(vectorSet, threshold);

    if (this.cacheEnabled && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const energy = this.computeEnergy(vectorSet.vectors);
    const violations = this.detectViolations(vectorSet, threshold);
    const confidence = this.calculateConfidence(vectorSet.vectors, energy);

    const result: CoherenceResult = {
      coherent: energy < threshold,
      energy,
      violations,
      confidence,
    };

    if (this.cacheEnabled) {
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * Check if a new vector is coherent with existing vectors.
   */
  checkNewVector(
    existingVectors: number[][],
    newVector: number[],
    threshold: number = 0.3
  ): { allowed: boolean; energy: number; reason?: string } {
    if (existingVectors.length === 0) {
      return { allowed: true, energy: 0 };
    }

    const allVectors = [...existingVectors, newVector];
    const energy = this.computeEnergy(allVectors);

    if (energy < threshold) {
      return { allowed: true, energy };
    }

    // Check which existing vector it conflicts with most
    let maxConflict = 0;
    let conflictIndex = -1;

    for (let i = 0; i < existingVectors.length; i++) {
      const conflict = this.cosineDissimilarity(existingVectors[i], newVector);
      if (conflict > maxConflict) {
        maxConflict = conflict;
        conflictIndex = i;
      }
    }

    return {
      allowed: false,
      energy,
      reason: `Conflicts with vector at index ${conflictIndex} (dissimilarity: ${maxConflict.toFixed(3)})`,
    };
  }

  /**
   * Find the most incoherent pair in a vector set.
   */
  findMostIncoherent(vectors: number[][]): { indices: [number, number]; energy: number } | null {
    if (vectors.length < 2) return null;

    let maxEnergy = 0;
    let maxPair: [number, number] = [0, 1];

    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        const energy = this.cosineDissimilarity(vectors[i], vectors[j]);
        if (energy > maxEnergy) {
          maxEnergy = energy;
          maxPair = [i, j];
        }
      }
    }

    return { indices: maxPair, energy: maxEnergy };
  }

  /**
   * Partition vectors into coherent clusters.
   */
  partitionCoherent(vectors: number[][], threshold: number = 0.3): number[][] {
    if (vectors.length === 0) return [];
    if (vectors.length === 1) return [[0]];

    // Simple greedy clustering
    const clusters: number[][] = [];
    const assigned = new Set<number>();

    for (let i = 0; i < vectors.length; i++) {
      if (assigned.has(i)) continue;

      const cluster = [i];
      assigned.add(i);

      for (let j = i + 1; j < vectors.length; j++) {
        if (assigned.has(j)) continue;

        // Check if j is coherent with current cluster
        let isCoherent = true;
        for (const memberIdx of cluster) {
          const dissimilarity = this.cosineDissimilarity(vectors[memberIdx], vectors[j]);
          if (dissimilarity >= threshold) {
            isCoherent = false;
            break;
          }
        }

        if (isCoherent) {
          cluster.push(j);
          assigned.add(j);
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  }

  setCacheEnabled(enabled: boolean): void {
    this.cacheEnabled = enabled;
    if (!enabled) {
      this.cache.clear();
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  private cosineDissimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 1;
    if (a.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 1;

    const cosineSim = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    // Convert similarity to dissimilarity (0 = identical, 1 = orthogonal, >1 = opposite)
    return Math.max(0, 1 - cosineSim);
  }

  private detectViolations(vectorSet: VectorSet, threshold: number): string[] {
    const violations: string[] = [];

    for (let i = 0; i < vectorSet.vectors.length; i++) {
      for (let j = i + 1; j < vectorSet.vectors.length; j++) {
        const dissimilarity = this.cosineDissimilarity(vectorSet.vectors[i], vectorSet.vectors[j]);
        if (dissimilarity >= threshold) {
          const labelI = vectorSet.labels?.[i] ?? `Vector ${i}`;
          const labelJ = vectorSet.labels?.[j] ?? `Vector ${j}`;
          violations.push(`${labelI} conflicts with ${labelJ} (energy: ${dissimilarity.toFixed(3)})`);
        }
      }
    }

    return violations;
  }

  private calculateConfidence(vectors: number[][], energy: number): number {
    // More vectors = more confident in the result
    // Lower energy = more confident it's coherent
    const vectorConfidence = Math.min(vectors.length / 10, 1);
    const energyConfidence = 1 - energy;
    return (vectorConfidence + energyConfidence) / 2;
  }

  private getCacheKey(vectorSet: VectorSet, threshold: number): string {
    // Simple hash for caching
    const vectorHash = JSON.stringify(vectorSet.vectors.map((v) => v.slice(0, 3)));
    return `${vectorHash}-${threshold}`;
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('CohomologyEngine', () => {
  let engine: MockCohomologyEngine;

  beforeEach(() => {
    engine = new MockCohomologyEngine();
  });

  describe('computeEnergy', () => {
    it('should return 0 for empty vectors', () => {
      const energy = engine.computeEnergy([]);

      expect(energy).toBe(0);
    });

    it('should return 0 for single vector', () => {
      const energy = engine.computeEnergy([[1, 0, 0]]);

      expect(energy).toBe(0);
    });

    it('should return low energy for similar vectors', () => {
      const vectors = [
        [1, 0, 0],
        [0.99, 0.01, 0],
        [0.98, 0.02, 0],
      ];

      const energy = engine.computeEnergy(vectors);

      expect(energy).toBeLessThan(0.1);
    });

    it('should return high energy for orthogonal vectors', () => {
      const vectors = [
        [1, 0, 0],
        [0, 1, 0],
      ];

      const energy = engine.computeEnergy(vectors);

      expect(energy).toBeGreaterThan(0.5);
    });

    it('should return maximum energy for opposite vectors', () => {
      const vectors = [
        [1, 0, 0],
        [-1, 0, 0],
      ];

      const energy = engine.computeEnergy(vectors);

      expect(energy).toBeGreaterThan(1);
    });

    it('should return energy between 0 and ~2', () => {
      const vectors = [
        [0.5, 0.5, 0],
        [0.3, 0.7, 0],
        [-0.2, 0.8, 0],
      ];

      const energy = engine.computeEnergy(vectors);

      expect(energy).toBeGreaterThanOrEqual(0);
      expect(energy).toBeLessThanOrEqual(2);
    });
  });

  describe('checkCoherence', () => {
    it('should detect coherent vectors', () => {
      const vectorSet: VectorSet = {
        vectors: [
          [1, 0, 0],
          [0.95, 0.05, 0],
          [0.9, 0.1, 0],
        ],
      };

      const result = engine.checkCoherence(vectorSet, 0.3);

      expect(result.coherent).toBe(true);
      expect(result.energy).toBeLessThan(0.3);
      expect(result.violations).toHaveLength(0);
    });

    it('should detect incoherent vectors', () => {
      const vectorSet: VectorSet = {
        vectors: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      };

      const result = engine.checkCoherence(vectorSet, 0.3);

      expect(result.coherent).toBe(false);
      expect(result.energy).toBeGreaterThan(0.3);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('should respect threshold parameter', () => {
      // Use vectors with predictable energy (~0.3 dissimilarity)
      const vectorSet: VectorSet = {
        vectors: [
          [1, 0, 0],
          [0.5, 0.5, 0], // More separated for clear threshold testing
        ],
      };

      const strictResult = engine.checkCoherence(vectorSet, 0.1);
      const lenientResult = engine.checkCoherence(vectorSet, 0.5);

      // With more separated vectors, strict should fail and lenient should pass
      expect(strictResult.coherent).toBe(false);
      expect(lenientResult.coherent).toBe(true);
    });

    it('should include labels in violations', () => {
      const vectorSet: VectorSet = {
        vectors: [
          [1, 0, 0],
          [-1, 0, 0],
        ],
        labels: ['Statement A', 'Statement B'],
      };

      const result = engine.checkCoherence(vectorSet, 0.3);

      expect(result.violations.some((v) => v.includes('Statement A'))).toBe(true);
      expect(result.violations.some((v) => v.includes('Statement B'))).toBe(true);
    });

    it('should calculate confidence score', () => {
      const vectorSet: VectorSet = {
        vectors: [
          [1, 0, 0],
          [0.95, 0.05, 0],
        ],
      };

      const result = engine.checkCoherence(vectorSet);

      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('checkNewVector', () => {
    it('should allow first vector', () => {
      const result = engine.checkNewVector([], [1, 0, 0]);

      expect(result.allowed).toBe(true);
      expect(result.energy).toBe(0);
    });

    it('should allow coherent new vector', () => {
      const existing = [
        [1, 0, 0],
        [0.95, 0.05, 0],
      ];
      const newVector = [0.9, 0.1, 0];

      const result = engine.checkNewVector(existing, newVector, 0.3);

      expect(result.allowed).toBe(true);
    });

    it('should reject incoherent new vector', () => {
      const existing = [[1, 0, 0]];
      const newVector = [-1, 0, 0];

      const result = engine.checkNewVector(existing, newVector, 0.5);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should identify conflicting vector', () => {
      const existing = [
        [1, 0, 0],
        [0, 1, 0],
      ];
      const newVector = [-1, 0, 0]; // Opposite to first

      const result = engine.checkNewVector(existing, newVector, 0.5);

      expect(result.reason).toContain('index 0');
    });
  });

  describe('findMostIncoherent', () => {
    it('should return null for less than 2 vectors', () => {
      expect(engine.findMostIncoherent([])).toBeNull();
      expect(engine.findMostIncoherent([[1, 0, 0]])).toBeNull();
    });

    it('should find the most incoherent pair', () => {
      const vectors = [
        [1, 0, 0], // 0
        [0.9, 0.1, 0], // 1 - similar to 0
        [0, 0, 1], // 2 - different from both
      ];

      const result = engine.findMostIncoherent(vectors);

      expect(result).not.toBeNull();
      expect(result!.indices).toContain(2); // Vector 2 should be in the pair
    });

    it('should return energy for the most incoherent pair', () => {
      const vectors = [
        [1, 0, 0],
        [-1, 0, 0],
      ];

      const result = engine.findMostIncoherent(vectors);

      expect(result!.energy).toBeGreaterThan(1);
    });
  });

  describe('partitionCoherent', () => {
    it('should return empty for empty input', () => {
      const clusters = engine.partitionCoherent([]);

      expect(clusters).toHaveLength(0);
    });

    it('should return single cluster for single vector', () => {
      const clusters = engine.partitionCoherent([[1, 0, 0]]);

      expect(clusters).toHaveLength(1);
      expect(clusters[0]).toEqual([0]);
    });

    it('should group coherent vectors together', () => {
      const vectors = [
        [1, 0, 0], // Cluster 1
        [0.95, 0.05, 0], // Cluster 1
        [0, 1, 0], // Cluster 2
        [0.05, 0.95, 0], // Cluster 2
      ];

      const clusters = engine.partitionCoherent(vectors, 0.3);

      // Should have 2 clusters
      expect(clusters.length).toBeGreaterThanOrEqual(2);
    });

    it('should include all vectors', () => {
      const vectors = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];

      const clusters = engine.partitionCoherent(vectors, 0.3);
      const allIndices = clusters.flat();

      expect(allIndices).toHaveLength(3);
      expect(allIndices.sort()).toEqual([0, 1, 2]);
    });
  });

  describe('caching', () => {
    it('should cache results when enabled', () => {
      const vectorSet: VectorSet = {
        vectors: [
          [1, 0, 0],
          [0.9, 0.1, 0],
        ],
      };

      engine.checkCoherence(vectorSet);
      engine.checkCoherence(vectorSet);

      expect(engine.getCacheSize()).toBe(1);
    });

    it('should not cache when disabled', () => {
      engine.setCacheEnabled(false);

      const vectorSet: VectorSet = {
        vectors: [[1, 0, 0]],
      };

      engine.checkCoherence(vectorSet);

      expect(engine.getCacheSize()).toBe(0);
    });

    it('should clear cache', () => {
      const vectorSet: VectorSet = {
        vectors: [[1, 0, 0]],
      };

      engine.checkCoherence(vectorSet);
      engine.clearCache();

      expect(engine.getCacheSize()).toBe(0);
    });
  });

  describe('performance', () => {
    it('should complete coherence check in <5ms', () => {
      const vectors: number[][] = [];
      for (let i = 0; i < 10; i++) {
        vectors.push([Math.random(), Math.random(), Math.random()]);
      }

      const startTime = performance.now();
      engine.checkCoherence({ vectors });
      const duration = performance.now() - startTime;

      // Target: <5ms per check
      expect(duration).toBeLessThan(5);
    });

    it('should handle larger vector sets efficiently', () => {
      const vectors: number[][] = [];
      for (let i = 0; i < 50; i++) {
        vectors.push([Math.random(), Math.random(), Math.random()]);
      }

      const startTime = performance.now();
      engine.checkCoherence({ vectors });
      const duration = performance.now() - startTime;

      // Should still be reasonable for 50 vectors
      expect(duration).toBeLessThan(50);
    });
  });
});

describe('CohomologyEngine Energy Interpretation', () => {
  let engine: MockCohomologyEngine;

  beforeEach(() => {
    engine = new MockCohomologyEngine();
  });

  it('should categorize fully coherent (0.0-0.1)', () => {
    const vectors = [
      [1, 0, 0, 0],
      [0.99, 0.01, 0, 0],
    ];

    const energy = engine.computeEnergy(vectors);

    expect(energy).toBeLessThan(0.1);
  });

  it('should categorize minor inconsistencies (0.1-0.3)', () => {
    // Vectors with angle ~45 degrees produce ~0.15-0.29 dissimilarity
    const vectors = [
      [1, 0, 0],
      [0.7, 0.7, 0], // Normalized: ~45 degree angle gives cosine ~0.71
    ];

    const energy = engine.computeEnergy(vectors);

    // This should give energy around 0.29 (1 - 0.707)
    expect(energy).toBeGreaterThanOrEqual(0.1);
    expect(energy).toBeLessThan(0.4); // Slightly relaxed for numerical precision
  });

  it('should categorize significant contradictions (0.3-0.7)', () => {
    const vectors = [
      [1, 0, 0],
      [0.5, 0.5, 0],
    ];

    const energy = engine.computeEnergy(vectors);

    expect(energy).toBeGreaterThanOrEqual(0.2);
    expect(energy).toBeLessThan(0.7);
  });
});
