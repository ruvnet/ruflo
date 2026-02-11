/**
 * Cognitive Kernel Plugin - Bridges Tests
 *
 * Tests for Cognitive and Pattern bridge initialization and lifecycle
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CognitiveBridge, createCognitiveBridge } from '../src/bridges/cognitive-bridge.js';
import { SonaBridge, createSonaBridge } from '../src/bridges/sona-bridge.js';
import type { CognitiveItem, SonaPattern } from '../src/types.js';

describe('CognitiveBridge', () => {
  let bridge: CognitiveBridge;

  beforeEach(() => {
    bridge = createCognitiveBridge();
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
      expect(bridge.name).toBe('cognitum-gate-kernel');
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

  describe('store', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should store cognitive item', () => {
      const item: CognitiveItem = {
        id: 'item-1',
        content: new Float32Array([0.1, 0.2, 0.3]),
        salience: 0.8,
        decay: 0.1,
        associations: ['related-1', 'related-2'],
      };

      const result = bridge.store(item);
      expect(result).toBe(true);
    });

    it('should throw when not initialized', () => {
      const newBridge = createCognitiveBridge();
      const item: CognitiveItem = {
        id: 'item-1',
        content: new Float32Array([0.1]),
        salience: 0.5,
        decay: 0.1,
        associations: [],
      };

      expect(() => newBridge.store(item)).toThrow();
    });
  });

  describe('retrieve', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should retrieve stored item', () => {
      const item: CognitiveItem = {
        id: 'item-1',
        content: new Float32Array([0.1, 0.2, 0.3]),
        salience: 0.8,
        decay: 0.1,
        associations: [],
      };

      bridge.store(item);
      const retrieved = bridge.retrieve('item-1');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('item-1');
      expect(retrieved?.salience).toBe(0.8);
    });

    it('should return null for non-existent item', () => {
      const result = bridge.retrieve('non-existent');
      expect(result).toBeNull();
    });

    it('should update salience on access', () => {
      const item: CognitiveItem = {
        id: 'item-1',
        content: new Float32Array([0.1]),
        salience: 0.5,
        decay: 0.1,
        associations: [],
      };

      bridge.store(item);
      const retrieved = bridge.retrieve('item-1');

      // Salience should increase on access
      expect(retrieved?.salience).toBeGreaterThan(0.5);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should search for similar items', () => {
      // Store some items
      bridge.store({
        id: 'item-1',
        content: new Float32Array([1, 0, 0]),
        salience: 0.8,
        decay: 0.1,
        associations: [],
      });
      bridge.store({
        id: 'item-2',
        content: new Float32Array([0, 1, 0]),
        salience: 0.6,
        decay: 0.1,
        associations: [],
      });

      const query = new Float32Array([1, 0, 0]);
      const results = bridge.search(query, 2);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('item-1');  // Most similar
    });

    it('should return empty array when no items stored', () => {
      const query = new Float32Array([1, 0, 0]);
      const results = bridge.search(query, 5);
      expect(results).toEqual([]);
    });
  });

  describe('decay', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should apply decay to stored items', () => {
      const item: CognitiveItem = {
        id: 'item-1',
        content: new Float32Array([0.1]),
        salience: 0.8,
        decay: 0.1,
        associations: [],
      };

      bridge.store(item);
      bridge.decay(1000);  // 1 second

      const retrieved = bridge.retrieve('item-1');
      expect(retrieved?.salience).toBeLessThan(0.8);
    });

    it('should remove items below salience threshold', () => {
      const item: CognitiveItem = {
        id: 'weak-item',
        content: new Float32Array([0.1]),
        salience: 0.05,
        decay: 0.9,  // High decay
        associations: [],
      };

      bridge.store(item);
      bridge.decay(10000);  // Large time delta

      const retrieved = bridge.retrieve('weak-item');
      expect(retrieved).toBeNull();
    });
  });

  describe('consolidate', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should consolidate memory without throwing', () => {
      bridge.store({
        id: 'item-1',
        content: new Float32Array([0.1]),
        salience: 0.8,
        decay: 0.1,
        associations: [],
      });

      expect(() => bridge.consolidate()).not.toThrow();
    });
  });

  describe('focus', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should focus on specified items', () => {
      bridge.store({
        id: 'item-1',
        content: new Float32Array([0.1]),
        salience: 0.5,
        decay: 0.1,
        associations: [],
      });
      bridge.store({
        id: 'item-2',
        content: new Float32Array([0.2]),
        salience: 0.3,
        decay: 0.1,
        associations: [],
      });

      const state = bridge.focus(['item-1', 'item-2']);

      expect(state.focus).toContain('item-1');
      expect(state.focus).toContain('item-2');
      expect(state.breadth).toBeGreaterThan(0);
      expect(state.intensity).toBeGreaterThan(0);
    });

    it('should handle focus on non-existent items', () => {
      const state = bridge.focus(['non-existent']);
      expect(state.focus).not.toContain('non-existent');
    });
  });

  describe('assess', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should assess metacognitive state', () => {
      bridge.store({
        id: 'item-1',
        content: new Float32Array([0.1]),
        salience: 0.8,
        decay: 0.1,
        associations: [],
      });

      const assessment = bridge.assess();

      expect(assessment.confidence).toBeGreaterThanOrEqual(0);
      expect(assessment.confidence).toBeLessThanOrEqual(1);
      expect(assessment.uncertainty).toBeGreaterThanOrEqual(0);
      expect(assessment.coherence).toBeGreaterThanOrEqual(0);
      expect(assessment.cognitiveLoad).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(assessment.knowledgeGaps)).toBe(true);
      expect(Array.isArray(assessment.suggestedStrategies)).toBe(true);
    });
  });

  describe('scaffold', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should generate scaffold steps', () => {
      const steps = bridge.scaffold('Implement binary search', 0.6);

      expect(Array.isArray(steps)).toBe(true);
      expect(steps.length).toBeGreaterThan(0);
    });

    it('should generate more steps for higher difficulty', () => {
      const easySteps = bridge.scaffold('Simple task', 0.2);
      const hardSteps = bridge.scaffold('Complex task', 0.9);

      expect(hardSteps.length).toBeGreaterThanOrEqual(easySteps.length);
    });
  });

  describe('factory function', () => {
    it('should create bridge with default config', () => {
      const b = createCognitiveBridge();
      expect(b).toBeInstanceOf(CognitiveBridge);
    });

    it('should create bridge with custom config', () => {
      const b = createCognitiveBridge({
        capacity: 10,
        decayRate: 0.05,
      });
      expect(b).toBeInstanceOf(CognitiveBridge);
    });
  });
});

describe('SonaBridge', () => {
  let bridge: SonaBridge;

  beforeEach(() => {
    bridge = createSonaBridge();
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
      expect(bridge.name).toBe('sona');
      expect(bridge.version).toBe('0.1.0');
    });

    it('should initialize successfully', async () => {
      await bridge.init();
      expect(bridge.status).toBe('ready');
      expect(bridge.initialized).toBe(true);
    });

    it('should cleanup on destroy', async () => {
      await bridge.init();
      await bridge.destroy();
      expect(bridge.status).toBe('unloaded');
    });
  });

  describe('learn', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should learn from trajectories', () => {
      const trajectories = [
        {
          id: 'traj-1',
          domain: 'coding',
          steps: [
            {
              stateBefore: new Float32Array([0.1, 0.2]),
              action: 'write-code',
              stateAfter: new Float32Array([0.3, 0.4]),
              reward: 0.8,
              timestamp: Date.now(),
            },
          ],
          qualityScore: 0.9,
        },
      ];

      const improvement = bridge.learn(trajectories);
      expect(improvement).toBeGreaterThanOrEqual(0);
      expect(improvement).toBeLessThanOrEqual(1);
    });

    it('should return 0 for empty trajectories', () => {
      const improvement = bridge.learn([]);
      expect(improvement).toBe(0);
    });

    it('should throw when not initialized', () => {
      const newBridge = createSonaBridge();
      expect(() => newBridge.learn([])).toThrow();
    });
  });

  describe('predict', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should predict action from state', () => {
      const state = new Float32Array([0.5, 0.3, 0.2]);
      const prediction = bridge.predict(state);

      expect(prediction).toHaveProperty('action');
      expect(prediction).toHaveProperty('confidence');
      expect(prediction.confidence).toBeGreaterThanOrEqual(0);
      expect(prediction.confidence).toBeLessThanOrEqual(1);
    });

    it('should return explore action for unknown states', () => {
      const state = new Float32Array([0, 0, 0, 0]);
      const prediction = bridge.predict(state);

      expect(prediction.action).toBe('explore');
    });
  });

  describe('pattern management', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should store pattern', () => {
      const pattern: SonaPattern = {
        id: 'pattern-1',
        embedding: new Float32Array([0.1, 0.2, 0.3]),
        successRate: 0.8,
        usageCount: 5,
        domain: 'testing',
      };

      expect(() => bridge.storePattern(pattern)).not.toThrow();
    });

    it('should find similar patterns', () => {
      // Store patterns
      bridge.storePattern({
        id: 'pattern-1',
        embedding: new Float32Array([1, 0, 0]),
        successRate: 0.9,
        usageCount: 10,
        domain: 'coding',
      });
      bridge.storePattern({
        id: 'pattern-2',
        embedding: new Float32Array([0, 1, 0]),
        successRate: 0.7,
        usageCount: 5,
        domain: 'testing',
      });

      const query = new Float32Array([1, 0, 0]);
      const patterns = bridge.findPatterns(query, 2);

      expect(patterns).toHaveLength(2);
      expect(patterns[0].id).toBe('pattern-1');  // Most similar
    });

    it('should update pattern success rate', () => {
      bridge.storePattern({
        id: 'pattern-1',
        embedding: new Float32Array([0.5, 0.5]),
        successRate: 0.5,
        usageCount: 1,
        domain: 'test',
      });

      bridge.updatePatternSuccess('pattern-1', true);

      const patterns = bridge.findPatterns(new Float32Array([0.5, 0.5]), 1);
      expect(patterns[0].successRate).toBeGreaterThan(0.5);
    });
  });

  describe('LoRA operations', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should apply LoRA transformation', () => {
      const input = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const weights = {
        A: new Map([['default', new Float32Array([0.1, 0.2, 0.3, 0.4])]]),
        B: new Map([['default', new Float32Array([0.1, 0.2, 0.3, 0.4])]]),
        rank: 4,
        alpha: 0.1,
      };

      const result = bridge.applyLoRA(input, weights);

      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(input.length);
    });

    it('should update LoRA weights', () => {
      const gradients = new Float32Array([0.01, 0.02, 0.03, 0.04]);
      const weights = bridge.updateLoRA(gradients);

      expect(weights).toHaveProperty('A');
      expect(weights).toHaveProperty('B');
      expect(weights).toHaveProperty('rank');
      expect(weights).toHaveProperty('alpha');
    });
  });

  describe('EWC operations', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should compute Fisher information', () => {
      const trajectories = [
        {
          id: 'traj-1',
          domain: 'test',
          steps: [
            {
              stateBefore: new Float32Array([0.1]),
              action: 'action',
              stateAfter: new Float32Array([0.2]),
              reward: 1.0,
              timestamp: Date.now(),
            },
          ],
          qualityScore: 0.8,
        },
      ];

      const fisher = bridge.computeFisher(trajectories);

      expect(fisher).toBeInstanceOf(Map);
    });

    it('should consolidate without throwing', () => {
      const ewcState = {
        fisher: new Map([['test', new Float32Array([0.1])]]),
        means: new Map([['test', new Float32Array([0.5])]]),
        lambda: 100,
      };

      expect(() => bridge.consolidate(ewcState)).not.toThrow();
    });
  });

  describe('mode management', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should set and get mode', () => {
      bridge.setMode('research');
      expect(bridge.getMode()).toBe('research');

      bridge.setMode('edge');
      expect(bridge.getMode()).toBe('edge');
    });
  });

  describe('factory function', () => {
    it('should create bridge with default config', () => {
      const b = createSonaBridge();
      expect(b).toBeInstanceOf(SonaBridge);
    });

    it('should create bridge with custom config', () => {
      const b = createSonaBridge({
        mode: 'research',
        loraRank: 8,
        learningRate: 0.0005,
      });
      expect(b).toBeInstanceOf(SonaBridge);
    });
  });
});
