/**
 * Test Intelligence Plugin - Types Tests
 *
 * Tests for Zod schemas and type validation
 */

import { describe, it, expect } from 'vitest';
import {
  SelectPredictiveInputSchema,
  FlakyDetectInputSchema,
  CoverageGapsInputSchema,
  MutationOptimizeInputSchema,
  GenerateSuggestInputSchema,
  DEFAULT_CONFIG,
  TestIntelligenceErrorCodes,
  successResult,
  errorResult,
} from '../src/types.js';

describe('Test Intelligence Types', () => {
  describe('SelectPredictiveInputSchema', () => {
    it('should validate valid predictive selection input', () => {
      const validInput = {
        changes: {
          files: ['src/auth.ts', 'src/user.ts'],
        },
        strategy: 'fast_feedback',
      };

      const result = SelectPredictiveInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.strategy).toBe('fast_feedback');
      }
    });

    it('should use default strategy', () => {
      const input = {
        changes: {
          files: ['src/test.ts'],
        },
      };

      const result = SelectPredictiveInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.strategy).toBe('balanced');
      }
    });

    it('should validate with git diff', () => {
      const input = {
        changes: {
          gitDiff: 'diff --git a/src/test.ts b/src/test.ts\n...',
        },
      };

      const result = SelectPredictiveInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate with git ref', () => {
      const input = {
        changes: {
          gitRef: 'HEAD~5..HEAD',
        },
      };

      const result = SelectPredictiveInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate all strategy types', () => {
      const strategies = ['fast_feedback', 'high_coverage', 'risk_based', 'balanced'] as const;
      for (const strategy of strategies) {
        const input = { changes: { files: ['test.ts'] }, strategy };
        const result = SelectPredictiveInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    it('should validate with budget options', () => {
      const input = {
        changes: { files: ['test.ts'] },
        budget: {
          maxTests: 100,
          maxDuration: 3600,
          confidence: 0.99,
        },
      };

      const result = SelectPredictiveInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should use default confidence in budget', () => {
      const input = {
        changes: { files: ['test.ts'] },
        budget: {
          maxTests: 50,
        },
      };

      const result = SelectPredictiveInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success && result.data.budget) {
        expect(result.data.budget.confidence).toBe(0.95);
      }
    });

    it('should reject too many files', () => {
      const input = {
        changes: {
          files: Array(1001).fill('test.ts'),
        },
      };

      const result = SelectPredictiveInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject git diff exceeding max length', () => {
      const input = {
        changes: {
          gitDiff: 'a'.repeat(1_000_001),
        },
      };

      const result = SelectPredictiveInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject confidence outside valid range', () => {
      const tooLow = {
        changes: { files: ['test.ts'] },
        budget: { confidence: 0.4 },
      };
      const tooHigh = {
        changes: { files: ['test.ts'] },
        budget: { confidence: 1.1 },
      };

      expect(SelectPredictiveInputSchema.safeParse(tooLow).success).toBe(false);
      expect(SelectPredictiveInputSchema.safeParse(tooHigh).success).toBe(false);
    });
  });

  describe('FlakyDetectInputSchema', () => {
    it('should validate valid flaky detection input', () => {
      const validInput = {
        scope: {
          testSuite: 'unit',
          historyDepth: 100,
        },
        threshold: 0.1,
      };

      const result = FlakyDetectInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should use defaults when not provided', () => {
      const input = {};

      const result = FlakyDetectInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.threshold).toBe(0.1);
      }
    });

    it('should validate all analysis types', () => {
      const analysisTypes = [
        'intermittent_failures',
        'timing_sensitive',
        'order_dependent',
        'resource_contention',
        'environment_sensitive',
      ] as const;

      const input = {
        analysis: [...analysisTypes],
      };

      const result = FlakyDetectInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject threshold outside valid range', () => {
      const tooLow = { threshold: 0.005 };
      const tooHigh = { threshold: 0.6 };

      expect(FlakyDetectInputSchema.safeParse(tooLow).success).toBe(false);
      expect(FlakyDetectInputSchema.safeParse(tooHigh).success).toBe(false);
    });

    it('should reject historyDepth outside valid range', () => {
      const tooLow = { scope: { historyDepth: 5 } };
      const tooHigh = { scope: { historyDepth: 10001 } };

      expect(FlakyDetectInputSchema.safeParse(tooLow).success).toBe(false);
      expect(FlakyDetectInputSchema.safeParse(tooHigh).success).toBe(false);
    });
  });

  describe('CoverageGapsInputSchema', () => {
    it('should validate valid coverage gaps input', () => {
      const validInput = {
        targetPaths: ['src/', 'lib/'],
        coverageType: 'semantic',
        minCoverage: 80,
      };

      const result = CoverageGapsInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should use defaults when not provided', () => {
      const input = {};

      const result = CoverageGapsInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.coverageType).toBe('semantic');
        expect(result.data.prioritization).toBe('risk');
        expect(result.data.minCoverage).toBe(80);
      }
    });

    it('should validate all coverage types', () => {
      const types = ['line', 'branch', 'function', 'semantic'] as const;
      for (const coverageType of types) {
        const input = { coverageType };
        const result = CoverageGapsInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    it('should validate all prioritization types', () => {
      const types = ['risk', 'complexity', 'churn', 'recency'] as const;
      for (const prioritization of types) {
        const input = { prioritization };
        const result = CoverageGapsInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    it('should reject minCoverage outside valid range', () => {
      const tooLow = { minCoverage: -1 };
      const tooHigh = { minCoverage: 101 };

      expect(CoverageGapsInputSchema.safeParse(tooLow).success).toBe(false);
      expect(CoverageGapsInputSchema.safeParse(tooHigh).success).toBe(false);
    });

    it('should reject too many target paths', () => {
      const input = {
        targetPaths: Array(101).fill('src/'),
      };

      const result = CoverageGapsInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('MutationOptimizeInputSchema', () => {
    it('should validate valid mutation optimize input', () => {
      const validInput = {
        targetPath: 'src/utils',
        budget: 500,
        strategy: 'ml_guided',
      };

      const result = MutationOptimizeInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should use default strategy', () => {
      const input = {
        targetPath: 'src/',
      };

      const result = MutationOptimizeInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.strategy).toBe('ml_guided');
      }
    });

    it('should validate all mutation types', () => {
      const types = ['arithmetic', 'logical', 'boundary', 'null_check', 'return_value'] as const;
      const input = {
        targetPath: 'src/',
        mutationTypes: [...types],
      };

      const result = MutationOptimizeInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate all strategies', () => {
      const strategies = ['random', 'coverage_guided', 'ml_guided', 'historical'] as const;
      for (const strategy of strategies) {
        const input = { targetPath: 'src/', strategy };
        const result = MutationOptimizeInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    it('should reject budget outside valid range', () => {
      const tooLow = { targetPath: 'src/', budget: 0 };
      const tooHigh = { targetPath: 'src/', budget: 10001 };

      expect(MutationOptimizeInputSchema.safeParse(tooLow).success).toBe(false);
      expect(MutationOptimizeInputSchema.safeParse(tooHigh).success).toBe(false);
    });

    it('should reject target path exceeding max length', () => {
      const input = {
        targetPath: 'a'.repeat(501),
      };

      const result = MutationOptimizeInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('GenerateSuggestInputSchema', () => {
    it('should validate valid generate suggest input', () => {
      const validInput = {
        targetFunction: 'calculateTotal',
        testStyle: 'unit',
        framework: 'vitest',
        edgeCases: true,
      };

      const result = GenerateSuggestInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should use defaults when not provided', () => {
      const input = {
        targetFunction: 'myFunction',
      };

      const result = GenerateSuggestInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.testStyle).toBe('unit');
        expect(result.data.framework).toBe('vitest');
        expect(result.data.edgeCases).toBe(true);
      }
    });

    it('should validate all test styles', () => {
      const styles = ['unit', 'integration', 'property_based', 'snapshot'] as const;
      for (const testStyle of styles) {
        const input = { targetFunction: 'test', testStyle };
        const result = GenerateSuggestInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    it('should validate all frameworks', () => {
      const frameworks = ['jest', 'vitest', 'pytest', 'junit', 'mocha'] as const;
      for (const framework of frameworks) {
        const input = { targetFunction: 'test', framework };
        const result = GenerateSuggestInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    it('should validate all mock strategies', () => {
      const strategies = ['minimal', 'full', 'none'] as const;
      for (const mockStrategy of strategies) {
        const input = { targetFunction: 'test', mockStrategy };
        const result = GenerateSuggestInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    it('should reject target function exceeding max length', () => {
      const input = {
        targetFunction: 'a'.repeat(501),
      };

      const result = GenerateSuggestInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('Default Configuration', () => {
    it('should have valid selection configuration', () => {
      expect(DEFAULT_CONFIG.selection.defaultStrategy).toBe('balanced');
      expect(DEFAULT_CONFIG.selection.defaultConfidence).toBe(0.95);
      expect(DEFAULT_CONFIG.selection.maxTests).toBe(10000);
    });

    it('should have valid flaky configuration', () => {
      expect(DEFAULT_CONFIG.flaky.historyDepth).toBe(100);
      expect(DEFAULT_CONFIG.flaky.threshold).toBe(0.1);
      expect(DEFAULT_CONFIG.flaky.quarantineEnabled).toBe(true);
    });

    it('should have valid coverage configuration', () => {
      expect(DEFAULT_CONFIG.coverage.minCoverage).toBe(80);
      expect(DEFAULT_CONFIG.coverage.prioritization).toBe('risk');
    });

    it('should have valid mutation configuration', () => {
      expect(DEFAULT_CONFIG.mutation.defaultBudget).toBe(1000);
      expect(DEFAULT_CONFIG.mutation.strategy).toBe('ml_guided');
    });
  });

  describe('Error Codes', () => {
    it('should have all expected error codes', () => {
      expect(TestIntelligenceErrorCodes.BRIDGE_NOT_INITIALIZED).toBe('TI_BRIDGE_NOT_INITIALIZED');
      expect(TestIntelligenceErrorCodes.INVALID_INPUT).toBe('TI_INVALID_INPUT');
      expect(TestIntelligenceErrorCodes.NO_TEST_HISTORY).toBe('TI_NO_TEST_HISTORY');
      expect(TestIntelligenceErrorCodes.ANALYSIS_FAILED).toBe('TI_ANALYSIS_FAILED');
      expect(TestIntelligenceErrorCodes.TIMEOUT).toBe('TI_TIMEOUT');
      expect(TestIntelligenceErrorCodes.RATE_LIMITED).toBe('TI_RATE_LIMITED');
    });
  });

  describe('Result Helpers', () => {
    it('should create success result', () => {
      const data = { tests: [], coverage: 0.85 };
      const result = successResult(data);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('"tests"');
    });

    it('should create error result from string', () => {
      const result = errorResult('Test failed');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Test failed');
    });

    it('should create error result from Error object', () => {
      const error = new Error('Something went wrong');
      const result = errorResult(error);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Something went wrong');
    });

    it('should include timestamp in error result', () => {
      const result = errorResult('Error message');
      const parsed = JSON.parse(result.content[0].text!);

      expect(parsed.timestamp).toBeDefined();
      expect(parsed.error).toBe(true);
    });
  });
});
