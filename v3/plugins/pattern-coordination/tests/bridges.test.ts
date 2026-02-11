/**
 * Pattern Coordination Plugin - Bridges Tests
 *
 * Tests for Attention and Nervous System bridge initialization and lifecycle
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AttentionBridge, createAttentionBridge } from '../src/bridges/attention-bridge.js';
import { NervousSystemBridge, createNervousSystemBridge } from '../src/bridges/nervous-system-bridge.js';
import type { Agent } from '../src/types.js';

describe('AttentionBridge', () => {
  let bridge: AttentionBridge;

  beforeEach(() => {
    bridge = createAttentionBridge();
  });

  afterEach(async () => {
    await bridge.destroy();
  });

  describe('initialization', () => {
    it('should start in unloaded state', () => {
      expect(bridge.status).toBe('unloaded');
      expect(bridge.initialized).toBe(false);
    });

    it('should have correct name and version', () => {
      expect(bridge.name).toBe('ruvector-attention-wasm');
      expect(bridge.version).toBe('0.1.0');
    });

    it('should initialize successfully', async () => {
      await bridge.init();
      expect(bridge.status).toBe('ready');
      expect(bridge.initialized).toBe(true);
    });

    it('should be idempotent for multiple init calls', async () => {
      await bridge.init();
      await bridge.init();
      expect(bridge.status).toBe('ready');
    });

    it('should cleanup on destroy', async () => {
      await bridge.init();
      expect(bridge.status).toBe('ready');

      await bridge.destroy();
      expect(bridge.status).toBe('unloaded');
      expect(bridge.initialized).toBe(false);
    });
  });

  describe('flashAttention', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should compute flash attention', () => {
      const seqLen = 4;
      const headDim = 8;
      const query = new Float32Array(seqLen * headDim).fill(0.1);
      const key = new Float32Array(seqLen * headDim).fill(0.1);
      const value = new Float32Array(seqLen * headDim).fill(0.2);

      const result = bridge.flashAttention(query, key, value, {
        seqLength: seqLen,
        headDim: headDim,
      });

      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(seqLen * headDim);
    });

    it('should throw when not initialized', () => {
      const newBridge = createAttentionBridge();
      const query = new Float32Array(16);
      const key = new Float32Array(16);
      const value = new Float32Array(16);

      expect(() => newBridge.flashAttention(query, key, value)).toThrow();
    });

    it('should respect causal masking', () => {
      const seqLen = 4;
      const headDim = 4;
      const query = new Float32Array(seqLen * headDim).map(() => Math.random());
      const key = new Float32Array(seqLen * headDim).map(() => Math.random());
      const value = new Float32Array(seqLen * headDim).map(() => Math.random());

      const resultCausal = bridge.flashAttention(query, key, value, {
        seqLength: seqLen,
        headDim: headDim,
        causal: true,
      });

      const resultNonCausal = bridge.flashAttention(query, key, value, {
        seqLength: seqLen,
        headDim: headDim,
        causal: false,
      });

      // Results should differ when causal masking is applied
      expect(resultCausal).not.toEqual(resultNonCausal);
    });
  });

  describe('multiHeadAttention', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should compute multi-head attention', () => {
      const query = new Float32Array(32).fill(0.1);
      const key = new Float32Array(32).fill(0.1);
      const value = new Float32Array(32).fill(0.2);

      const result = bridge.multiHeadAttention(query, key, value);

      expect(result).toBeInstanceOf(Float32Array);
    });
  });

  describe('selfAttention', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should compute self attention', () => {
      const input = new Float32Array(64).map(() => Math.random());

      const result = bridge.selfAttention(input);

      expect(result).toBeInstanceOf(Float32Array);
    });
  });

  describe('computeWeights', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should compute attention weights', () => {
      const query = new Float32Array([1, 0, 0, 0]);
      const keys = [
        new Float32Array([1, 0, 0, 0]),  // Similar to query
        new Float32Array([0, 1, 0, 0]),  // Different
        new Float32Array([0, 0, 1, 0]),  // Different
      ];

      const weights = bridge.computeWeights(query, keys);

      expect(weights).toHaveLength(3);
      // First weight should be highest (most similar to query)
      expect(weights[0]).toBeGreaterThan(weights[1]);
      expect(weights[0]).toBeGreaterThan(weights[2]);
      // Weights should sum to approximately 1
      const sum = weights.reduce((s, w) => s + w, 0);
      expect(sum).toBeCloseTo(1, 5);
    });

    it('should return empty array for empty keys', () => {
      const query = new Float32Array([1, 0, 0, 0]);
      const weights = bridge.computeWeights(query, []);
      expect(weights).toEqual([]);
    });
  });

  describe('aggregateWithAttention', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should aggregate agent states with attention', () => {
      const query = new Float32Array([1, 0, 0, 0]);
      const agentStates = [
        new Float32Array([1, 0, 0, 0]),
        new Float32Array([0, 1, 0, 0]),
      ];
      const agentValues = [
        new Float32Array([1, 2, 3, 4]),
        new Float32Array([5, 6, 7, 8]),
      ];

      const result = bridge.aggregateWithAttention(query, agentStates, agentValues);

      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(4);
    });

    it('should return empty array for empty inputs', () => {
      const query = new Float32Array([1, 0, 0, 0]);
      const result = bridge.aggregateWithAttention(query, [], []);
      expect(result.length).toBe(0);
    });
  });

  describe('findMostRelevant', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should find top-k most relevant agents', () => {
      const query = new Float32Array([1, 0, 0, 0]);
      const agentStates = [
        new Float32Array([1, 0, 0, 0]),  // Most similar
        new Float32Array([0.5, 0.5, 0, 0]),
        new Float32Array([0, 1, 0, 0]),
        new Float32Array([0, 0, 1, 0]),  // Least similar
      ];

      const topK = bridge.findMostRelevant(query, agentStates, 2);

      expect(topK).toHaveLength(2);
      expect(topK[0].index).toBe(0);  // First state is most similar
      expect(topK[0].weight).toBeGreaterThan(topK[1].weight);
    });
  });

  describe('factory function', () => {
    it('should create bridge with default config', () => {
      const b = createAttentionBridge();
      expect(b).toBeInstanceOf(AttentionBridge);
    });

    it('should create bridge with custom config', () => {
      const b = createAttentionBridge({
        headDim: 128,
        numHeads: 16,
      });
      expect(b).toBeInstanceOf(AttentionBridge);
    });
  });
});

describe('NervousSystemBridge', () => {
  let bridge: NervousSystemBridge;

  beforeEach(() => {
    bridge = createNervousSystemBridge();
  });

  afterEach(async () => {
    await bridge.destroy();
  });

  describe('initialization', () => {
    it('should start in unloaded state', () => {
      expect(bridge.status).toBe('unloaded');
      expect(bridge.initialized).toBe(false);
    });

    it('should have correct name and version', () => {
      expect(bridge.name).toBe('ruvector-nervous-system-wasm');
      expect(bridge.version).toBe('0.1.0');
    });

    it('should initialize successfully', async () => {
      await bridge.init();
      expect(bridge.status).toBe('ready');
      expect(bridge.initialized).toBe(true);
    });

    it('should be idempotent for multiple init calls', async () => {
      await bridge.init();
      await bridge.init();
      expect(bridge.status).toBe('ready');
    });

    it('should cleanup on destroy', async () => {
      await bridge.init();
      await bridge.destroy();
      expect(bridge.status).toBe('unloaded');
    });
  });

  describe('propagate', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should propagate signals through network', async () => {
      const signals = [
        new Float32Array([1.0, 0.5, 0.3]),
        new Float32Array([0.2, 0.8, 0.1]),
      ];

      const result = await bridge.propagate(signals);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(Float32Array);
      expect(result[1]).toBeInstanceOf(Float32Array);
    });

    it('should apply decay to signals', async () => {
      const signals = [new Float32Array([1.0, 1.0, 1.0])];

      const result = await bridge.propagate(signals);

      // Signal strength should be reduced due to decay
      for (let i = 0; i < result[0].length; i++) {
        expect(result[0][i]).toBeLessThan(1.0);
      }
    });

    it('should throw when not initialized', async () => {
      const newBridge = createNervousSystemBridge();
      await expect(newBridge.propagate([])).rejects.toThrow();
    });
  });

  describe('synchronize', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should synchronize agent states', async () => {
      const states = [
        new Float32Array([1.0, 0.0, 0.0]),
        new Float32Array([0.0, 1.0, 0.0]),
        new Float32Array([0.0, 0.0, 1.0]),
      ];

      const result = await bridge.synchronize(states);

      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(3);
    });

    it('should return empty array for empty states', async () => {
      const result = await bridge.synchronize([]);
      expect(result.length).toBe(0);
    });

    it('should compute weighted average', async () => {
      const states = [
        new Float32Array([2.0, 0.0]),
        new Float32Array([0.0, 2.0]),
      ];

      const result = await bridge.synchronize(states);

      // Average should be [1.0, 1.0]
      expect(result[0]).toBeCloseTo(1.0, 5);
      expect(result[1]).toBeCloseTo(1.0, 5);
    });
  });

  describe('coordinate', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should coordinate agents for task assignment', async () => {
      const agents: Agent[] = [
        { id: 'agent-1', capabilities: ['code', 'test'] },
        { id: 'agent-2', capabilities: ['review', 'document'] },
        { id: 'agent-3', capabilities: ['code', 'deploy'] },
      ];

      const result = await bridge.coordinate(agents);

      expect(result.success).toBe(true);
      expect(result.assignments).toBeInstanceOf(Map);
      expect(result.synchronizationLevel).toBeGreaterThanOrEqual(0);
      expect(result.synchronizationLevel).toBeLessThanOrEqual(1);
      expect(result.convergenceRounds).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty agents list', async () => {
      const result = await bridge.coordinate([]);

      expect(result.success).toBe(true);
      expect(result.assignments.size).toBe(0);
      expect(result.synchronizationLevel).toBe(1);
    });

    it('should assign agents based on capabilities', async () => {
      const agents: Agent[] = [
        { id: 'coder', capabilities: ['code'] },
        { id: 'tester', capabilities: ['test'] },
      ];

      const result = await bridge.coordinate(agents);

      expect(result.assignments.size).toBeGreaterThan(0);
    });

    it('should throw when not initialized', async () => {
      const newBridge = createNervousSystemBridge();
      await expect(newBridge.coordinate([])).rejects.toThrow();
    });
  });

  describe('factory function', () => {
    it('should create bridge with default config', () => {
      const b = createNervousSystemBridge();
      expect(b).toBeInstanceOf(NervousSystemBridge);
    });

    it('should create bridge with custom config', () => {
      const b = createNervousSystemBridge({
        neuronCount: 2000,
        propagationSpeed: 0.9,
        decayRate: 0.05,
      });
      expect(b).toBeInstanceOf(NervousSystemBridge);
    });
  });
});
