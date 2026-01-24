/**
 * Code Intelligence Plugin - Types Tests
 *
 * Tests for Zod schemas and type validation
 */

import { describe, it, expect } from 'vitest';
import {
  Language,
  LanguageTier,
  SearchType,
  AnalysisType,
  OutputFormat,
  ChangeType,
  SplitStrategy,
  PatternType,
  SemanticSearchInputSchema,
  ArchitectureAnalyzeInputSchema,
  RefactorImpactInputSchema,
  SplitSuggestInputSchema,
  LearnPatternsInputSchema,
  DEFAULT_CONFIG,
  CodeIntelligenceErrorCodes,
  CodeIntelligenceError,
  SECRET_PATTERNS,
  maskSecrets,
} from '../src/types.js';

describe('Code Intelligence Types', () => {
  describe('Language Enum', () => {
    it('should validate all supported languages', () => {
      const validLanguages = [
        'typescript', 'javascript', 'python', 'java', 'go',
        'rust', 'cpp', 'csharp', 'ruby', 'php', 'swift', 'kotlin', 'scala',
      ];

      for (const lang of validLanguages) {
        const result = Language.safeParse(lang);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid languages', () => {
      const result = Language.safeParse('cobol');
      expect(result.success).toBe(false);
    });
  });

  describe('LanguageTier', () => {
    it('should classify TypeScript and JavaScript as tier1', () => {
      expect(LanguageTier.typescript).toBe('tier1');
      expect(LanguageTier.javascript).toBe('tier1');
    });

    it('should classify Python and Java as tier2', () => {
      expect(LanguageTier.python).toBe('tier2');
      expect(LanguageTier.java).toBe('tier2');
    });

    it('should classify Go and Rust as tier3', () => {
      expect(LanguageTier.go).toBe('tier3');
      expect(LanguageTier.rust).toBe('tier3');
    });
  });

  describe('SearchType Enum', () => {
    it('should validate all search types', () => {
      const validTypes = ['semantic', 'structural', 'clone', 'api_usage'];

      for (const type of validTypes) {
        const result = SearchType.safeParse(type);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('AnalysisType Enum', () => {
    it('should validate all analysis types', () => {
      const validTypes = [
        'dependency_graph', 'layer_violations', 'circular_deps',
        'component_coupling', 'module_cohesion', 'dead_code',
        'api_surface', 'architectural_drift',
      ];

      for (const type of validTypes) {
        const result = AnalysisType.safeParse(type);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('OutputFormat Enum', () => {
    it('should validate all output formats', () => {
      const validFormats = ['json', 'graphviz', 'mermaid'];

      for (const format of validFormats) {
        const result = OutputFormat.safeParse(format);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('ChangeType Enum', () => {
    it('should validate all change types', () => {
      const validTypes = ['rename', 'move', 'delete', 'extract', 'inline'];

      for (const type of validTypes) {
        const result = ChangeType.safeParse(type);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('SplitStrategy Enum', () => {
    it('should validate all split strategies', () => {
      const validStrategies = ['minimize_coupling', 'balance_size', 'feature_isolation'];

      for (const strategy of validStrategies) {
        const result = SplitStrategy.safeParse(strategy);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('PatternType Enum', () => {
    it('should validate all pattern types', () => {
      const validTypes = ['bug_patterns', 'refactor_patterns', 'api_patterns', 'test_patterns'];

      for (const type of validTypes) {
        const result = PatternType.safeParse(type);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('SemanticSearchInputSchema', () => {
    it('should validate valid semantic search input', () => {
      const validInput = {
        query: 'authentication middleware',
        searchType: 'semantic',
        topK: 10,
      };

      const result = SemanticSearchInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.topK).toBe(10);
      }
    });

    it('should use defaults when not provided', () => {
      const input = {
        query: 'find user service',
      };

      const result = SemanticSearchInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.searchType).toBe('semantic');
        expect(result.data.topK).toBe(10);
      }
    });

    it('should validate with scope options', () => {
      const input = {
        query: 'database connection',
        scope: {
          paths: ['src/', 'lib/'],
          languages: ['typescript', 'javascript'],
          excludeTests: true,
        },
      };

      const result = SemanticSearchInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject empty query', () => {
      const input = { query: '' };
      const result = SemanticSearchInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject query exceeding max length', () => {
      const input = { query: 'a'.repeat(5001) };
      const result = SemanticSearchInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject topK outside valid range', () => {
      const tooLow = { query: 'test', topK: 0 };
      const tooHigh = { query: 'test', topK: 1001 };

      expect(SemanticSearchInputSchema.safeParse(tooLow).success).toBe(false);
      expect(SemanticSearchInputSchema.safeParse(tooHigh).success).toBe(false);
    });

    it('should validate all search types', () => {
      const types = ['semantic', 'structural', 'clone', 'api_usage'] as const;
      for (const searchType of types) {
        const input = { query: 'test', searchType };
        const result = SemanticSearchInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('ArchitectureAnalyzeInputSchema', () => {
    it('should validate valid architecture analyze input', () => {
      const validInput = {
        rootPath: './src',
        analysis: ['dependency_graph', 'circular_deps'],
      };

      const result = ArchitectureAnalyzeInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should use default root path', () => {
      const input = {};
      const result = ArchitectureAnalyzeInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rootPath).toBe('.');
      }
    });

    it('should validate with layers configuration', () => {
      const input = {
        rootPath: './src',
        layers: {
          presentation: ['src/ui/', 'src/components/'],
          business: ['src/services/', 'src/domain/'],
          data: ['src/repositories/', 'src/database/'],
        },
      };

      const result = ArchitectureAnalyzeInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate with baseline', () => {
      const input = {
        rootPath: './src',
        baseline: 'main',
        outputFormat: 'mermaid',
      };

      const result = ArchitectureAnalyzeInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate all output formats', () => {
      const formats = ['json', 'graphviz', 'mermaid'] as const;
      for (const outputFormat of formats) {
        const input = { outputFormat };
        const result = ArchitectureAnalyzeInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('RefactorImpactInputSchema', () => {
    it('should validate valid refactor impact input', () => {
      const validInput = {
        changes: [
          { file: 'src/service.ts', type: 'rename' },
          { file: 'src/utils.ts', type: 'move' },
        ],
        depth: 3,
      };

      const result = RefactorImpactInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includeTests).toBe(true); // default
      }
    });

    it('should use default depth', () => {
      const input = {
        changes: [{ file: 'src/test.ts', type: 'delete' }],
      };

      const result = RefactorImpactInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.depth).toBe(3);
      }
    });

    it('should reject empty changes array', () => {
      const input = { changes: [] };
      const result = RefactorImpactInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject too many changes', () => {
      const changes = Array(101).fill({ file: 'test.ts', type: 'rename' });
      const input = { changes };
      const result = RefactorImpactInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject depth outside valid range', () => {
      const tooLow = { changes: [{ file: 'test.ts', type: 'rename' }], depth: 0 };
      const tooHigh = { changes: [{ file: 'test.ts', type: 'rename' }], depth: 11 };

      expect(RefactorImpactInputSchema.safeParse(tooLow).success).toBe(false);
      expect(RefactorImpactInputSchema.safeParse(tooHigh).success).toBe(false);
    });

    it('should validate all change types', () => {
      const types = ['rename', 'move', 'delete', 'extract', 'inline'] as const;
      for (const type of types) {
        const input = { changes: [{ file: 'test.ts', type }] };
        const result = RefactorImpactInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('SplitSuggestInputSchema', () => {
    it('should validate valid split suggest input', () => {
      const validInput = {
        targetPath: './src/monolith',
        strategy: 'minimize_coupling',
        targetModules: 5,
      };

      const result = SplitSuggestInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should use default strategy', () => {
      const input = {
        targetPath: './src',
      };

      const result = SplitSuggestInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.strategy).toBe('minimize_coupling');
      }
    });

    it('should validate with constraints', () => {
      const input = {
        targetPath: './src',
        constraints: {
          maxModuleSize: 500,
          minModuleSize: 50,
          preserveBoundaries: ['src/core/', 'src/api/'],
        },
      };

      const result = SplitSuggestInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject targetModules outside valid range', () => {
      const tooLow = { targetPath: './src', targetModules: 1 };
      const tooHigh = { targetPath: './src', targetModules: 51 };

      expect(SplitSuggestInputSchema.safeParse(tooLow).success).toBe(false);
      expect(SplitSuggestInputSchema.safeParse(tooHigh).success).toBe(false);
    });

    it('should validate all strategies', () => {
      const strategies = ['minimize_coupling', 'balance_size', 'feature_isolation'] as const;
      for (const strategy of strategies) {
        const input = { targetPath: './src', strategy };
        const result = SplitSuggestInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('LearnPatternsInputSchema', () => {
    it('should validate valid learn patterns input', () => {
      const validInput = {
        scope: {
          gitRange: 'HEAD~50..HEAD',
          authors: ['john@example.com'],
        },
        patternTypes: ['bug_patterns', 'refactor_patterns'],
        minOccurrences: 5,
      };

      const result = LearnPatternsInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should use default values', () => {
      const input = {};
      const result = LearnPatternsInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.minOccurrences).toBe(3);
      }
    });

    it('should validate with scope paths', () => {
      const input = {
        scope: {
          paths: ['src/', 'lib/'],
        },
      };

      const result = LearnPatternsInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject minOccurrences outside valid range', () => {
      const tooLow = { minOccurrences: 0 };
      const tooHigh = { minOccurrences: 101 };

      expect(LearnPatternsInputSchema.safeParse(tooLow).success).toBe(false);
      expect(LearnPatternsInputSchema.safeParse(tooHigh).success).toBe(false);
    });

    it('should validate all pattern types', () => {
      const types = ['bug_patterns', 'refactor_patterns', 'api_patterns', 'test_patterns'] as const;
      const input = { patternTypes: [...types] };
      const result = LearnPatternsInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('Default Configuration', () => {
    it('should have valid search configuration', () => {
      expect(DEFAULT_CONFIG.search.embeddingDimension).toBe(384);
      expect(DEFAULT_CONFIG.search.defaultTopK).toBe(10);
      expect(DEFAULT_CONFIG.search.similarityThreshold).toBe(0.7);
    });

    it('should have valid architecture configuration', () => {
      expect(DEFAULT_CONFIG.architecture.maxGraphDepth).toBe(10);
      expect(DEFAULT_CONFIG.architecture.includeVendor).toBe(false);
    });

    it('should have valid refactoring configuration', () => {
      expect(DEFAULT_CONFIG.refactoring.defaultDepth).toBe(3);
      expect(DEFAULT_CONFIG.refactoring.includeTests).toBe(true);
    });

    it('should have valid security configuration', () => {
      expect(DEFAULT_CONFIG.security.allowedRoots).toContain('.');
      expect(DEFAULT_CONFIG.security.maskSecrets).toBe(true);
      expect(DEFAULT_CONFIG.security.blockedPatterns.length).toBeGreaterThan(0);
    });
  });

  describe('Error Codes', () => {
    it('should have all expected error codes', () => {
      expect(CodeIntelligenceErrorCodes.PATH_TRAVERSAL).toBe('CODE_PATH_TRAVERSAL');
      expect(CodeIntelligenceErrorCodes.SENSITIVE_FILE).toBe('CODE_SENSITIVE_FILE');
      expect(CodeIntelligenceErrorCodes.GRAPH_TOO_LARGE).toBe('CODE_GRAPH_TOO_LARGE');
      expect(CodeIntelligenceErrorCodes.ANALYSIS_FAILED).toBe('CODE_ANALYSIS_FAILED');
      expect(CodeIntelligenceErrorCodes.PARSER_ERROR).toBe('CODE_PARSER_ERROR');
      expect(CodeIntelligenceErrorCodes.WASM_NOT_INITIALIZED).toBe('CODE_WASM_NOT_INITIALIZED');
      expect(CodeIntelligenceErrorCodes.LANGUAGE_NOT_SUPPORTED).toBe('CODE_LANGUAGE_NOT_SUPPORTED');
      expect(CodeIntelligenceErrorCodes.GIT_ERROR).toBe('CODE_GIT_ERROR');
    });
  });

  describe('CodeIntelligenceError', () => {
    it('should create error with code and message', () => {
      const error = new CodeIntelligenceError(
        CodeIntelligenceErrorCodes.PATH_TRAVERSAL,
        'Path traversal detected'
      );

      expect(error.name).toBe('CodeIntelligenceError');
      expect(error.code).toBe('CODE_PATH_TRAVERSAL');
      expect(error.message).toBe('Path traversal detected');
    });

    it('should create error with details', () => {
      const error = new CodeIntelligenceError(
        CodeIntelligenceErrorCodes.SENSITIVE_FILE,
        'Access denied',
        { filePath: '/etc/passwd' }
      );

      expect(error.details).toEqual({ filePath: '/etc/passwd' });
    });

    it('should be instance of Error', () => {
      const error = new CodeIntelligenceError(
        CodeIntelligenceErrorCodes.ANALYSIS_FAILED,
        'Failed'
      );

      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('Secret Patterns', () => {
    it('should have defined secret patterns', () => {
      expect(SECRET_PATTERNS).toBeDefined();
      expect(SECRET_PATTERNS.length).toBeGreaterThan(0);
    });

    it('should detect API keys in quotes', () => {
      const code = 'const apiKey = "sk_live_abc123xyz"';
      const pattern = SECRET_PATTERNS[0];
      expect(pattern.test(code)).toBe(true);
    });
  });

  describe('maskSecrets', () => {
    it('should mask API keys', () => {
      const code = 'const apiKey = "sk-live-abcdefghijklmnopqrstuvwx"';
      const masked = maskSecrets(code);
      expect(masked).toContain('[REDACTED]');
    });

    it('should mask GitHub tokens', () => {
      const code = 'const token = "ghp_abcdefghijklmnopqrstuvwxyz123456"';
      const masked = maskSecrets(code);
      expect(masked).toContain('[REDACTED]');
    });

    it('should mask AWS keys', () => {
      const code = 'AWS_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE"';
      const masked = maskSecrets(code);
      expect(masked).toContain('[REDACTED]');
    });

    it('should mask private key headers', () => {
      const code = '-----BEGIN RSA PRIVATE KEY-----\nMIIE...';
      const masked = maskSecrets(code);
      expect(masked).toContain('[REDACTED]');
    });

    it('should leave non-secret code unchanged', () => {
      const code = 'const message = "Hello, World!"';
      const masked = maskSecrets(code);
      expect(masked).toBe(code);
    });
  });
});
