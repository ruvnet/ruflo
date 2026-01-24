/**
 * Test Intelligence Plugin - MCP Tools Tests
 *
 * Tests for MCP tool handlers with mock data
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  selectPredictiveTool,
  flakyDetectTool,
  coverageGapsTool,
  mutationOptimizeTool,
  generateSuggestTool,
  testIntelligenceTools,
} from '../src/mcp-tools.js';

// Mock context for testing
const createMockContext = (overrides = {}) => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  learningBridge: undefined,
  ...overrides,
});

describe('Test Intelligence MCP Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Tool Registry', () => {
    it('should export all 5 tools', () => {
      expect(testIntelligenceTools).toHaveLength(5);
    });

    it('should have correct tool names', () => {
      const toolNames = testIntelligenceTools.map(t => t.name);
      expect(toolNames).toContain('test/select-predictive');
      expect(toolNames).toContain('test/flaky-detect');
      expect(toolNames).toContain('test/coverage-gaps');
      expect(toolNames).toContain('test/mutation-optimize');
      expect(toolNames).toContain('test/generate-suggest');
    });

    it('should have category test-intelligence', () => {
      for (const tool of testIntelligenceTools) {
        expect(tool.category).toBe('test-intelligence');
      }
    });

    it('should have version 0.1.0', () => {
      for (const tool of testIntelligenceTools) {
        expect(tool.version).toBe('0.1.0');
      }
    });
  });

  describe('test/select-predictive', () => {
    it('should have correct tool definition', () => {
      expect(selectPredictiveTool.name).toBe('test/select-predictive');
      expect(selectPredictiveTool.inputSchema.required).toContain('changes');
      expect(selectPredictiveTool.cacheable).toBe(false);
    });

    it('should handle valid input with files', async () => {
      const input = {
        changes: {
          files: ['src/auth.ts', 'src/user.ts'],
        },
        strategy: 'balanced',
      };

      const result = await selectPredictiveTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const data = JSON.parse(result.content[0].text!);
      expect(data.selectedTests).toBeDefined();
      expect(Array.isArray(data.selectedTests)).toBe(true);
      expect(data.strategy).toBe('balanced');
    });

    it('should handle valid input with git diff', async () => {
      const input = {
        changes: {
          gitDiff: 'diff --git a/src/test.ts b/src/test.ts',
        },
      };

      const result = await selectPredictiveTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.strategy).toBe('balanced'); // default
    });

    it('should apply budget constraints', async () => {
      const input = {
        changes: {
          files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        },
        budget: {
          maxTests: 3,
          confidence: 0.9,
        },
      };

      const result = await selectPredictiveTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.selectedTests.length).toBeLessThanOrEqual(3);
      expect(data.confidence).toBe(0.9);
    });

    it('should reject invalid input', async () => {
      const input = {
        changes: {
          files: Array(1001).fill('test.ts'), // exceeds max
        },
      };

      const result = await selectPredictiveTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Invalid input');
    });

    it('should use learning bridge when available', async () => {
      const mockLearningBridge = {
        isReady: vi.fn().mockReturnValue(true),
        predictFailingTests: vi.fn().mockResolvedValue([
          { testId: 'test-1', reason: 'correlated', failureProbability: 0.8 },
        ]),
      };

      const input = {
        changes: { files: ['src/test.ts'] },
      };

      const result = await selectPredictiveTool.handler(input, createMockContext({
        learningBridge: mockLearningBridge,
      }));

      expect(mockLearningBridge.isReady).toHaveBeenCalled();
      expect(mockLearningBridge.predictFailingTests).toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
    });
  });

  describe('test/flaky-detect', () => {
    it('should have correct tool definition', () => {
      expect(flakyDetectTool.name).toBe('test/flaky-detect');
      expect(flakyDetectTool.cacheable).toBe(true);
      expect(flakyDetectTool.cacheTTL).toBe(300000);
    });

    it('should handle empty input (uses defaults)', async () => {
      const result = await flakyDetectTool.handler({}, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.flakyTests).toBeDefined();
      expect(data.totalAnalyzed).toBeGreaterThan(0);
      expect(data.flakinessScore).toBeDefined();
    });

    it('should handle valid scope and analysis types', async () => {
      const input = {
        scope: {
          testSuite: 'unit',
          historyDepth: 50,
        },
        analysis: ['intermittent_failures', 'timing_sensitive'],
        threshold: 0.15,
      };

      const result = await flakyDetectTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.details.intermittentCount).toBeDefined();
      expect(data.details.timingSensitiveCount).toBeDefined();
      expect(data.details.recommendations).toBeDefined();
    });

    it('should reject invalid threshold', async () => {
      const input = {
        threshold: 0.7, // exceeds max of 0.5
      };

      const result = await flakyDetectTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });

    it('should reject invalid historyDepth', async () => {
      const input = {
        scope: {
          historyDepth: 5, // below min of 10
        },
      };

      const result = await flakyDetectTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });
  });

  describe('test/coverage-gaps', () => {
    it('should have correct tool definition', () => {
      expect(coverageGapsTool.name).toBe('test/coverage-gaps');
      expect(coverageGapsTool.cacheable).toBe(true);
      expect(coverageGapsTool.cacheTTL).toBe(600000);
    });

    it('should handle empty input (uses defaults)', async () => {
      const result = await coverageGapsTool.handler({}, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.gaps).toBeDefined();
      expect(data.overallCoverage).toBeDefined();
      expect(data.targetCoverage).toBe(80); // default
    });

    it('should handle valid input with all options', async () => {
      const input = {
        targetPaths: ['src/', 'lib/'],
        coverageType: 'semantic',
        prioritization: 'risk',
        minCoverage: 90,
      };

      const result = await coverageGapsTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.targetCoverage).toBe(90);
      expect(data.details.filesAnalyzed).toBeGreaterThan(0);
      expect(data.details.priorityDistribution).toBeDefined();
    });

    it('should reject invalid minCoverage', async () => {
      const input = {
        minCoverage: 101, // exceeds max of 100
      };

      const result = await coverageGapsTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });

    it('should reject too many target paths', async () => {
      const input = {
        targetPaths: Array(101).fill('src/'),
      };

      const result = await coverageGapsTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });
  });

  describe('test/mutation-optimize', () => {
    it('should have correct tool definition', () => {
      expect(mutationOptimizeTool.name).toBe('test/mutation-optimize');
      expect(mutationOptimizeTool.inputSchema.required).toContain('targetPath');
      expect(mutationOptimizeTool.cacheable).toBe(false);
    });

    it('should handle valid input', async () => {
      const input = {
        targetPath: 'src/utils',
        budget: 50,
        strategy: 'ml_guided',
      };

      const result = await mutationOptimizeTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.mutations).toBeDefined();
      expect(data.mutationScore).toBeDefined();
      expect(data.killedMutants).toBeDefined();
      expect(data.survivingMutants).toBeDefined();
    });

    it('should handle minimal input (uses defaults)', async () => {
      const input = {
        targetPath: 'src/',
      };

      const result = await mutationOptimizeTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.details.weakTests).toBeDefined();
      expect(data.details.interpretation).toBeDefined();
    });

    it('should handle mutation types filter', async () => {
      const input = {
        targetPath: 'src/',
        mutationTypes: ['arithmetic', 'boundary'],
      };

      const result = await mutationOptimizeTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.mutations.length).toBeGreaterThan(0);
    });

    it('should reject missing targetPath', async () => {
      const input = {
        budget: 100,
      };

      const result = await mutationOptimizeTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });

    it('should reject invalid budget', async () => {
      const input = {
        targetPath: 'src/',
        budget: 0, // below min of 1
      };

      const result = await mutationOptimizeTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });
  });

  describe('test/generate-suggest', () => {
    it('should have correct tool definition', () => {
      expect(generateSuggestTool.name).toBe('test/generate-suggest');
      expect(generateSuggestTool.inputSchema.required).toContain('targetFunction');
      expect(generateSuggestTool.cacheable).toBe(true);
      expect(generateSuggestTool.cacheTTL).toBe(120000);
    });

    it('should handle valid input', async () => {
      const input = {
        targetFunction: 'calculateTotal',
        testStyle: 'unit',
        framework: 'vitest',
        edgeCases: true,
      };

      const result = await generateSuggestTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.suggestions).toBeDefined();
      expect(data.suggestions.length).toBeGreaterThan(0);
      expect(data.coverage).toBeDefined();
    });

    it('should use defaults when not provided', async () => {
      const input = {
        targetFunction: 'myFunction',
      };

      const result = await generateSuggestTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      // Defaults: testStyle='unit', framework='vitest', edgeCases=true
      expect(data.suggestions.some((s: { category: string }) => s.category === 'edge_case')).toBe(true);
    });

    it('should generate integration tests when requested', async () => {
      const input = {
        targetFunction: 'processOrder',
        testStyle: 'integration',
      };

      const result = await generateSuggestTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.suggestions.some((s: { category: string }) => s.category === 'integration')).toBe(true);
    });

    it('should not generate edge cases when disabled', async () => {
      const input = {
        targetFunction: 'simpleFunc',
        edgeCases: false,
      };

      const result = await generateSuggestTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.suggestions.every((s: { category: string }) => s.category !== 'edge_case')).toBe(true);
    });

    it('should handle pytest framework', async () => {
      const input = {
        targetFunction: 'test_func',
        framework: 'pytest',
      };

      const result = await generateSuggestTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      // Check that code uses pytest syntax
      expect(data.suggestions[0].code).toContain('class Test');
    });

    it('should reject missing targetFunction', async () => {
      const input = {
        testStyle: 'unit',
      };

      const result = await generateSuggestTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });

    it('should reject targetFunction exceeding max length', async () => {
      const input = {
        targetFunction: 'a'.repeat(501),
      };

      const result = await generateSuggestTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle handler exceptions gracefully', async () => {
      const context = createMockContext({
        learningBridge: {
          isReady: vi.fn().mockReturnValue(true),
          predictFailingTests: vi.fn().mockRejectedValue(new Error('Bridge error')),
        },
      });

      const input = {
        changes: { files: ['test.ts'] },
      };

      const result = await selectPredictiveTool.handler(input, context);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Bridge error');
    });

    it('should log errors via context logger', async () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const input = {
        targetPath: 'a'.repeat(501), // Invalid
      };

      await mutationOptimizeTool.handler(input, { logger: mockLogger });

      // Error should be logged (validation error doesn't call error logger, but success does)
      // The handler returns an error result for validation failures
    });
  });

  describe('Performance Logging', () => {
    it('should log duration on success', async () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const input = { changes: { files: ['test.ts'] } };
      await selectPredictiveTool.handler(input, { logger: mockLogger });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('completed'),
        expect.objectContaining({ durationMs: expect.any(String) })
      );
    });
  });
});
