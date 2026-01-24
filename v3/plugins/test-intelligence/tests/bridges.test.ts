/**
 * Test Intelligence Plugin - Bridge Tests
 *
 * Tests for TestLearningBridge initialization, lifecycle, and methods
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestLearningBridge } from '../src/bridges/learning-bridge.js';

// Mock WASM module
vi.mock('../src/bridges/learning-wasm.js', () => ({
  initWasm: vi.fn().mockResolvedValue(undefined),
  wasmAvailable: vi.fn().mockReturnValue(false),
}));

describe('TestLearningBridge', () => {
  let bridge: TestLearningBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    bridge = new TestLearningBridge();
  });

  afterEach(async () => {
    if (bridge.isReady()) {
      await bridge.destroy();
    }
  });

  describe('Initialization', () => {
    it('should create bridge instance', () => {
      expect(bridge).toBeInstanceOf(TestLearningBridge);
    });

    it('should not be ready before init', () => {
      expect(bridge.isReady()).toBe(false);
    });

    it('should initialize successfully', async () => {
      await bridge.init();
      expect(bridge.isReady()).toBe(true);
    });

    it('should initialize with custom config', async () => {
      await bridge.init({
        algorithm: 'ppo',
        learningRate: 0.001,
        gamma: 0.95,
        epsilon: 0.2,
      });
      expect(bridge.isReady()).toBe(true);
    });

    it('should initialize with q-learning algorithm', async () => {
      await bridge.init({
        algorithm: 'q-learning',
        learningRate: 0.1,
        gamma: 0.99,
      });
      expect(bridge.isReady()).toBe(true);
    });

    it('should initialize with decision-transformer algorithm', async () => {
      await bridge.init({
        algorithm: 'decision-transformer',
        contextLength: 20,
        embeddingDim: 128,
      });
      expect(bridge.isReady()).toBe(true);
    });

    it('should handle double initialization gracefully', async () => {
      await bridge.init();
      await bridge.init(); // Should not throw
      expect(bridge.isReady()).toBe(true);
    });
  });

  describe('Lifecycle', () => {
    it('should destroy successfully', async () => {
      await bridge.init();
      await bridge.destroy();
      expect(bridge.isReady()).toBe(false);
    });

    it('should handle destroy when not initialized', async () => {
      await expect(bridge.destroy()).resolves.not.toThrow();
    });

    it('should reinitialize after destroy', async () => {
      await bridge.init();
      await bridge.destroy();
      await bridge.init();
      expect(bridge.isReady()).toBe(true);
    });
  });

  describe('trainOnHistory', () => {
    beforeEach(async () => {
      await bridge.init();
    });

    it('should train on test history', async () => {
      const history = [
        {
          testId: 'test-1',
          testName: 'test_auth',
          file: 'auth.test.ts',
          failureRate: 0.1,
          avgDuration: 150,
          affectedFiles: ['src/auth.ts'],
          results: [
            { status: 'passed', duration: 150 },
            { status: 'failed', duration: 200 },
          ],
        },
        {
          testId: 'test-2',
          testName: 'test_login',
          file: 'login.test.ts',
          failureRate: 0.3,
          avgDuration: 200,
          affectedFiles: ['src/auth.ts', 'src/login.ts'],
          results: [
            { status: 'failed', duration: 200 },
            { status: 'passed', duration: 180 },
          ],
        },
      ];

      const result = await bridge.trainOnHistory(history);

      // Returns the average loss
      expect(typeof result).toBe('number');
    });

    it('should handle empty history', async () => {
      const result = await bridge.trainOnHistory([]);

      // Returns 0 for empty history
      expect(result).toBe(0);
    });

    it('should handle large history batches', async () => {
      const history = Array(100).fill(null).map((_, i) => ({
        testId: `test-${i}`,
        testName: `test_${i}`,
        file: `test${i}.test.ts`,
        failureRate: Math.random(),
        avgDuration: Math.floor(Math.random() * 500),
        affectedFiles: [`src/file${i % 10}.ts`],
        results: [
          { status: Math.random() > 0.2 ? 'passed' : 'failed', duration: 100 },
          { status: Math.random() > 0.2 ? 'passed' : 'failed', duration: 150 },
        ],
      }));

      const result = await bridge.trainOnHistory(history);

      expect(typeof result).toBe('number');
    });

    it('should throw when not initialized', async () => {
      await bridge.destroy();
      const history = [{
        testId: 'test-1',
        testName: 'test',
        file: 'test.ts',
        failureRate: 0,
        avgDuration: 100,
        affectedFiles: [],
        results: [],
      }];

      await expect(bridge.trainOnHistory(history)).rejects.toThrow('Learning bridge not initialized');
    });
  });

  describe('predictFailingTests', () => {
    beforeEach(async () => {
      await bridge.init();
      // Train with some history first
      await bridge.trainOnHistory([
        {
          testId: 'test-auth',
          testName: 'test_auth',
          file: 'auth.test.ts',
          failureRate: 0.5,
          avgDuration: 150,
          affectedFiles: ['src/auth.ts'],
          results: [
            { status: 'failed', duration: 150 },
            { status: 'passed', duration: 140 },
          ],
        },
        {
          testId: 'test-user',
          testName: 'test_user',
          file: 'user.test.ts',
          failureRate: 0.1,
          avgDuration: 100,
          affectedFiles: ['src/user.ts'],
          results: [
            { status: 'passed', duration: 100 },
            { status: 'passed', duration: 95 },
          ],
        },
      ]);
    });

    it('should predict failing tests for changed files', async () => {
      const changes = [
        { file: 'src/auth.ts', type: 'modified' as const, linesAdded: 10, linesRemoved: 2 },
      ];

      const predictions = await bridge.predictFailingTests(changes, 10);

      expect(Array.isArray(predictions)).toBe(true);
      // May or may not have predictions depending on training
    });

    it('should return empty array for unknown files', async () => {
      const changes = [
        { file: 'src/completely-new-file.ts', type: 'added' as const, linesAdded: 50, linesRemoved: 0 },
      ];

      const predictions = await bridge.predictFailingTests(changes, 10);

      expect(Array.isArray(predictions)).toBe(true);
      // Should return empty for files with no test mapping
      expect(predictions.length).toBe(0);
    });

    it('should sort predictions by failure probability', async () => {
      const changes = [
        { file: 'src/auth.ts', type: 'modified' as const, linesAdded: 5, linesRemoved: 2 },
        { file: 'src/user.ts', type: 'modified' as const, linesAdded: 3, linesRemoved: 1 },
      ];

      const predictions = await bridge.predictFailingTests(changes, 10);

      if (predictions.length >= 2) {
        for (let i = 1; i < predictions.length; i++) {
          expect(predictions[i - 1].failureProbability).toBeGreaterThanOrEqual(
            predictions[i].failureProbability
          );
        }
      }
    });

    it('should throw when not initialized', async () => {
      await bridge.destroy();
      const changes = [{ file: 'test.ts', type: 'modified' as const, linesAdded: 1, linesRemoved: 0 }];

      await expect(bridge.predictFailingTests(changes, 10)).rejects.toThrow('Learning bridge not initialized');
    });
  });

  describe('updatePolicyWithFeedback', () => {
    beforeEach(async () => {
      await bridge.init();
      // First train with some history to have embeddings
      await bridge.trainOnHistory([
        {
          testId: 'test-auth',
          testName: 'test_auth',
          file: 'auth.test.ts',
          failureRate: 0.5,
          avgDuration: 150,
          affectedFiles: ['src/auth.ts'],
          results: [
            { status: 'passed', duration: 150 },
            { status: 'failed', duration: 200 },
          ],
        },
      ]);
    });

    it('should update policy with feedback', async () => {
      const feedback = {
        predictions: [
          { testId: 'test-auth', failureProbability: 0.8, confidence: 0.7, reason: 'test' },
        ],
        actualResults: [
          { testId: 'test-auth', status: 'failed' },
        ],
      };

      // Should not throw
      await expect(bridge.updatePolicyWithFeedback(feedback)).resolves.not.toThrow();
    });

    it('should throw when not initialized', async () => {
      await bridge.destroy();

      await expect(
        bridge.updatePolicyWithFeedback({
          predictions: [],
          actualResults: [],
        })
      ).rejects.toThrow('Learning bridge not initialized');
    });
  });

  describe('isReady', () => {
    it('should return false before init', () => {
      expect(bridge.isReady()).toBe(false);
    });

    it('should return true after init', async () => {
      await bridge.init();
      expect(bridge.isReady()).toBe(true);
    });

    it('should return false after destroy', async () => {
      await bridge.init();
      await bridge.destroy();
      expect(bridge.isReady()).toBe(false);
    });
  });

  describe('JavaScript Fallback', () => {
    it('should work without WASM', async () => {
      // WASM is mocked to be unavailable
      const fallbackBridge = new TestLearningBridge();
      await fallbackBridge.init();

      expect(fallbackBridge.isReady()).toBe(true);

      const predictions = await fallbackBridge.predictFailingTests({ files: ['test.ts'] });
      expect(Array.isArray(predictions)).toBe(true);

      await fallbackBridge.destroy();
    });

    it('should provide consistent results in fallback mode', async () => {
      const bridge1 = new TestLearningBridge();
      const bridge2 = new TestLearningBridge();

      await bridge1.init({ algorithm: 'q-learning' });
      await bridge2.init({ algorithm: 'q-learning' });

      const history = [
        { testId: 'test-1', name: 'test', file: 'test.ts', passed: true, duration: 100, changedFiles: ['src/a.ts'] },
      ];

      await bridge1.trainOnHistory(history);
      await bridge2.trainOnHistory(history);

      const pred1 = await bridge1.predictFailingTests({ files: ['src/a.ts'] });
      const pred2 = await bridge2.predictFailingTests({ files: ['src/a.ts'] });

      // Both should produce predictions (deterministic with same seed)
      expect(pred1.length).toBe(pred2.length);

      await bridge1.destroy();
      await bridge2.destroy();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid algorithm gracefully', async () => {
      await expect(
        bridge.init({
          algorithm: 'invalid-algorithm' as any,
        })
      ).rejects.toThrow();
    });

    it('should handle corrupted history data', async () => {
      await bridge.init();

      const corruptedHistory = [
        { testId: null, name: undefined, file: '', passed: 'not-boolean', duration: 'abc', changedFiles: 'not-array' },
      ] as any;

      // Should either handle gracefully or throw a clear error
      try {
        await bridge.trainOnHistory(corruptedHistory);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle concurrent operations', async () => {
      await bridge.init();

      const operations = [
        bridge.trainOnHistory([{ testId: 't1', name: 't', file: 't.ts', passed: true, duration: 1, changedFiles: [] }]),
        bridge.predictFailingTests({ files: ['a.ts'] }),
        bridge.updatePolicyWithFeedback({ testId: 't1', predicted: true, actual: true, context: {} }),
      ];

      await expect(Promise.all(operations)).resolves.toBeDefined();
    });
  });

  describe('Memory Management', () => {
    it('should release resources on destroy', async () => {
      await bridge.init();

      // Train with substantial data
      const largeHistory = Array(500).fill(null).map((_, i) => ({
        testId: `test-${i}`,
        name: `test_${i}`,
        file: `test${i}.test.ts`,
        passed: Math.random() > 0.3,
        duration: Math.floor(Math.random() * 1000),
        changedFiles: Array(5).fill(null).map((_, j) => `src/file${j}.ts`),
      }));

      await bridge.trainOnHistory(largeHistory);
      await bridge.destroy();

      // Bridge should be reset
      expect(bridge.isReady()).toBe(false);
    });

    it('should handle multiple init/destroy cycles', async () => {
      for (let i = 0; i < 5; i++) {
        await bridge.init();
        expect(bridge.isReady()).toBe(true);
        await bridge.destroy();
        expect(bridge.isReady()).toBe(false);
      }
    });
  });
});
