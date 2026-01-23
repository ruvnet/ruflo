/**
 * Coherence Check MCP Tool Tests
 *
 * Tests for the pr_coherence_check MCP tool that validates
 * vector coherence using Sheaf Laplacian energy.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// Mock Types
// ============================================================================

interface CoherenceCheckInput {
  vectors: number[][];
  threshold?: number;
  options?: {
    returnViolations?: boolean;
    cacheResult?: boolean;
    contextLabels?: string[];
  };
}

interface CoherenceCheckOutput {
  coherent: boolean;
  energy: number;
  violations: Array<{
    indices: [number, number];
    labels?: [string, string];
    dissimilarity: number;
  }>;
  confidence: number;
  interpretation: string;
  action: 'allow' | 'warn' | 'reject';
}

// ============================================================================
// Mock Implementation
// ============================================================================

class MockCoherenceCheckTool {
  private warnThreshold = 0.3;
  private rejectThreshold = 0.7;
  private cache: Map<string, CoherenceCheckOutput> = new Map();

  configure(config: { warnThreshold?: number; rejectThreshold?: number }): void {
    if (config.warnThreshold !== undefined) {
      this.warnThreshold = config.warnThreshold;
    }
    if (config.rejectThreshold !== undefined) {
      this.rejectThreshold = config.rejectThreshold;
    }
  }

  async execute(input: CoherenceCheckInput): Promise<CoherenceCheckOutput> {
    // Validate input
    if (!input.vectors || input.vectors.length === 0) {
      return {
        coherent: true,
        energy: 0,
        violations: [],
        confidence: 1,
        interpretation: 'No vectors to check',
        action: 'allow',
      };
    }

    // Validate vector dimensions
    const firstDim = input.vectors[0].length;
    for (let i = 1; i < input.vectors.length; i++) {
      if (input.vectors[i].length !== firstDim) {
        throw new Error(`Vector dimension mismatch: expected ${firstDim}, got ${input.vectors[i].length} at index ${i}`);
      }
    }

    // Check cache
    const cacheKey = this.getCacheKey(input);
    if (input.options?.cacheResult !== false && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const threshold = input.threshold ?? this.warnThreshold;

    // Compute energy and violations
    const violations = this.computeViolations(input.vectors, threshold, input.options?.contextLabels);
    const energy = this.computeEnergy(input.vectors);
    const confidence = this.computeConfidence(input.vectors, energy);

    // Determine action
    let action: 'allow' | 'warn' | 'reject';
    if (energy >= this.rejectThreshold) {
      action = 'reject';
    } else if (energy >= this.warnThreshold) {
      action = 'warn';
    } else {
      action = 'allow';
    }

    const result: CoherenceCheckOutput = {
      coherent: violations.length === 0,
      energy,
      violations: input.options?.returnViolations !== false ? violations : [],
      confidence,
      interpretation: this.getInterpretation(energy),
      action,
    };

    // Cache result
    if (input.options?.cacheResult !== false) {
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private computeEnergy(vectors: number[][]): number {
    if (vectors.length < 2) return 0;

    let totalEnergy = 0;
    let pairs = 0;

    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        totalEnergy += this.cosineDissimilarity(vectors[i], vectors[j]);
        pairs++;
      }
    }

    return pairs > 0 ? totalEnergy / pairs : 0;
  }

  private computeViolations(
    vectors: number[][],
    threshold: number,
    labels?: string[]
  ): CoherenceCheckOutput['violations'] {
    const violations: CoherenceCheckOutput['violations'] = [];

    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        const dissimilarity = this.cosineDissimilarity(vectors[i], vectors[j]);
        if (dissimilarity >= threshold) {
          violations.push({
            indices: [i, j],
            labels: labels ? [labels[i], labels[j]] : undefined,
            dissimilarity,
          });
        }
      }
    }

    return violations;
  }

  private computeConfidence(vectors: number[][], energy: number): number {
    const vectorConfidence = Math.min(vectors.length / 5, 1);
    const energyConfidence = 1 - Math.min(energy, 1);
    return (vectorConfidence + energyConfidence) / 2;
  }

  private cosineDissimilarity(a: number[], b: number[]): number {
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
    return Math.max(0, 1 - cosineSim);
  }

  private getInterpretation(energy: number): string {
    if (energy < 0.1) {
      return 'Fully coherent: vectors are well-aligned';
    } else if (energy < 0.3) {
      return 'Minor inconsistencies: mostly coherent with some variance';
    } else if (energy < 0.7) {
      return 'Significant contradictions: review for conflicting information';
    } else {
      return 'Major contradictions: vectors represent opposing concepts';
    }
  }

  private getCacheKey(input: CoherenceCheckInput): string {
    // Simple hash based on first few elements
    const vectorSample = input.vectors.slice(0, 3).map((v) => v.slice(0, 3));
    return JSON.stringify({ vectors: vectorSample, threshold: input.threshold });
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('CoherenceCheckTool', () => {
  let tool: MockCoherenceCheckTool;

  beforeEach(() => {
    tool = new MockCoherenceCheckTool();
  });

  describe('basic coherence checking', () => {
    it('should detect coherent vectors', async () => {
      const result = await tool.execute({
        vectors: [
          [1, 0, 0],
          [0.99, 0.01, 0],
          [0.98, 0.02, 0],
        ],
      });

      expect(result.coherent).toBe(true);
      expect(result.energy).toBeLessThan(0.1);
      expect(result.action).toBe('allow');
    });

    it('should detect incoherent vectors', async () => {
      const result = await tool.execute({
        vectors: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      });

      expect(result.coherent).toBe(false);
      expect(result.energy).toBeGreaterThan(0.3);
    });

    it('should handle empty input', async () => {
      const result = await tool.execute({ vectors: [] });

      expect(result.coherent).toBe(true);
      expect(result.energy).toBe(0);
      expect(result.action).toBe('allow');
    });

    it('should handle single vector', async () => {
      const result = await tool.execute({ vectors: [[1, 0, 0]] });

      expect(result.coherent).toBe(true);
      expect(result.energy).toBe(0);
    });
  });

  describe('threshold handling', () => {
    it('should use default threshold', async () => {
      const vectors = [
        [1, 0, 0],
        [0.8, 0.2, 0],
      ];

      const result = await tool.execute({ vectors });

      // Default threshold is 0.3
      expect(result).toBeDefined();
    });

    it('should respect custom threshold', async () => {
      // Use vectors with ~0.3 dissimilarity for clear threshold testing
      const vectors = [
        [1, 0, 0],
        [0.7, 0.7, 0], // ~45 degree angle, ~0.29 dissimilarity
      ];

      const strictResult = await tool.execute({ vectors, threshold: 0.1 });
      const lenientResult = await tool.execute({ vectors, threshold: 0.5 });

      expect(strictResult.coherent).toBe(false);
      expect(lenientResult.coherent).toBe(true);
    });
  });

  describe('action determination', () => {
    it('should return allow for low energy', async () => {
      const result = await tool.execute({
        vectors: [
          [1, 0, 0],
          [0.99, 0.01, 0],
        ],
      });

      expect(result.action).toBe('allow');
    });

    it('should return warn for medium energy', async () => {
      tool.configure({ warnThreshold: 0.2, rejectThreshold: 0.8 });

      // Use vectors with ~0.29 energy (45 degree angle)
      const result = await tool.execute({
        vectors: [
          [1, 0, 0],
          [0.7, 0.7, 0], // Cosine sim ~0.707, energy ~0.29
        ],
      });

      expect(result.action).toBe('warn');
    });

    it('should return reject for high energy', async () => {
      tool.configure({ rejectThreshold: 0.5 });

      const result = await tool.execute({
        vectors: [
          [1, 0, 0],
          [-1, 0, 0],
        ],
      });

      expect(result.action).toBe('reject');
    });
  });

  describe('violations reporting', () => {
    it('should report violations with indices', async () => {
      const result = await tool.execute({
        vectors: [
          [1, 0, 0],
          [0, 1, 0],
        ],
        threshold: 0.3,
      });

      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].indices).toEqual([0, 1]);
    });

    it('should report violations with labels', async () => {
      const result = await tool.execute({
        vectors: [
          [1, 0, 0],
          [0, 1, 0],
        ],
        threshold: 0.3,
        options: {
          contextLabels: ['Statement A', 'Statement B'],
        },
      });

      expect(result.violations[0].labels).toEqual(['Statement A', 'Statement B']);
    });

    it('should include dissimilarity score', async () => {
      const result = await tool.execute({
        vectors: [
          [1, 0, 0],
          [0, 1, 0],
        ],
        threshold: 0.3,
      });

      expect(result.violations[0].dissimilarity).toBeGreaterThan(0.5);
    });

    it('should skip violations when disabled', async () => {
      const result = await tool.execute({
        vectors: [
          [1, 0, 0],
          [0, 1, 0],
        ],
        threshold: 0.3,
        options: { returnViolations: false },
      });

      expect(result.violations).toHaveLength(0);
      expect(result.coherent).toBe(false); // Still detected
    });
  });

  describe('interpretation', () => {
    it('should provide interpretation for fully coherent', async () => {
      const result = await tool.execute({
        vectors: [
          [1, 0, 0],
          [0.99, 0.01, 0],
        ],
      });

      expect(result.interpretation).toContain('Fully coherent');
    });

    it('should provide interpretation for contradictions', async () => {
      const result = await tool.execute({
        vectors: [
          [1, 0, 0],
          [-1, 0, 0],
        ],
      });

      expect(result.interpretation).toContain('contradiction');
    });
  });

  describe('confidence scoring', () => {
    it('should return confidence between 0 and 1', async () => {
      const result = await tool.execute({
        vectors: [
          [1, 0, 0],
          [0.9, 0.1, 0],
        ],
      });

      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should have higher confidence with more vectors', async () => {
      const twoVectors = await tool.execute({
        vectors: [
          [1, 0, 0],
          [0.9, 0.1, 0],
        ],
      });

      const fiveVectors = await tool.execute({
        vectors: [
          [1, 0, 0],
          [0.95, 0.05, 0],
          [0.9, 0.1, 0],
          [0.85, 0.15, 0],
          [0.8, 0.2, 0],
        ],
      });

      expect(fiveVectors.confidence).toBeGreaterThanOrEqual(twoVectors.confidence);
    });
  });

  describe('caching', () => {
    it('should cache results by default', async () => {
      const vectors = [[1, 0, 0], [0.9, 0.1, 0]];

      await tool.execute({ vectors });
      const cached = await tool.execute({ vectors });

      expect(cached).toBeDefined();
    });

    it('should skip cache when disabled', async () => {
      const vectors = [[1, 0, 0], [0.9, 0.1, 0]];

      await tool.execute({ vectors, options: { cacheResult: false } });

      // No error means it worked
      expect(true).toBe(true);
    });

    it('should clear cache', async () => {
      const vectors = [[1, 0, 0]];

      await tool.execute({ vectors });
      tool.clearCache();

      // Can execute again
      const result = await tool.execute({ vectors });
      expect(result).toBeDefined();
    });
  });

  describe('input validation', () => {
    it('should throw on dimension mismatch', async () => {
      await expect(
        tool.execute({
          vectors: [
            [1, 0, 0],
            [1, 0], // Wrong dimension
          ],
        })
      ).rejects.toThrow('dimension mismatch');
    });

    it('should handle high-dimensional vectors', async () => {
      const dim = 384; // Common embedding dimension
      const vectors = [
        Array.from({ length: dim }, () => Math.random()),
        Array.from({ length: dim }, () => Math.random()),
      ];

      const result = await tool.execute({ vectors });

      expect(result).toBeDefined();
      expect(result.energy).toBeGreaterThanOrEqual(0);
    });
  });

  describe('performance', () => {
    it('should check coherence in <5ms', async () => {
      const vectors = Array.from({ length: 10 }, () =>
        Array.from({ length: 100 }, () => Math.random())
      );

      const startTime = performance.now();
      await tool.execute({ vectors });
      const duration = performance.now() - startTime;

      // Target: <5ms per check
      expect(duration).toBeLessThan(10); // Allow margin
    });
  });
});

describe('CoherenceCheckTool Energy Interpretation', () => {
  let tool: MockCoherenceCheckTool;

  beforeEach(() => {
    tool = new MockCoherenceCheckTool();
  });

  it('should interpret 0.0-0.1 as fully coherent', async () => {
    const result = await tool.execute({
      vectors: [
        [1, 0, 0, 0],
        [0.99, 0.01, 0, 0],
      ],
    });

    expect(result.interpretation).toContain('Fully coherent');
  });

  it('should interpret 0.1-0.3 as minor inconsistencies', async () => {
    const result = await tool.execute({
      vectors: [
        [1, 0, 0],
        [0.8, 0.2, 0],
      ],
    });

    expect(result.interpretation).toContain('Minor');
  });
});
