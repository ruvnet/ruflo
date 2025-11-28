/**
 * Tests for MCP Tool Improvements
 *
 * Tests the new features based on Anthropic's Advanced Tool Use patterns:
 * - Deferred loading configuration
 * - Tool examples
 * - Batch operations
 * - Enhanced search with regex and relevance scoring
 */

import {
  CORE_TOOLS,
  DEFERRED_TOOLS,
  calculateTokenSavings,
  shouldLoadImmediately,
  shouldDefer,
  getToolConfig,
  shouldLoadForContext,
} from '../../src/mcp/schemas/deferred-loading.js';

import {
  TOOL_EXAMPLES,
  getToolExamples,
  hasExamples,
  getExampleByComplexity,
  validateExamples,
  ToolExample,
} from '../../src/mcp/schemas/tool-examples.js';

describe('Deferred Loading Configuration', () => {
  describe('CORE_TOOLS', () => {
    test('should have tools/search as critical priority', () => {
      const searchTool = CORE_TOOLS.find(t => t.name === 'tools/search');
      expect(searchTool).toBeDefined();
      expect(searchTool?.defer_loading).toBe(false);
      expect(searchTool?.priority).toBe('critical');
    });

    test('should have all core tools with defer_loading: false', () => {
      for (const tool of CORE_TOOLS) {
        expect(tool.defer_loading).toBe(false);
      }
    });

    test('should have agents/spawn and agents/list as core tools', () => {
      const spawn = CORE_TOOLS.find(t => t.name === 'agents/spawn');
      const list = CORE_TOOLS.find(t => t.name === 'agents/list');
      expect(spawn).toBeDefined();
      expect(list).toBeDefined();
    });
  });

  describe('DEFERRED_TOOLS', () => {
    test('should have all deferred tools with defer_loading: true', () => {
      for (const tool of DEFERRED_TOOLS) {
        expect(tool.defer_loading).toBe(true);
      }
    });

    test('should have memory tools as deferred', () => {
      const memoryQuery = DEFERRED_TOOLS.find(t => t.name === 'memory/query');
      expect(memoryQuery).toBeDefined();
      expect(memoryQuery?.defer_loading).toBe(true);
    });

    test('should have load conditions for context-aware loading', () => {
      const memoryQuery = DEFERRED_TOOLS.find(t => t.name === 'memory/query');
      expect(memoryQuery?.loadConditions).toBeDefined();
      expect(memoryQuery?.loadConditions?.contextKeywords).toContain('memory');
    });
  });

  describe('calculateTokenSavings', () => {
    test('should return valid savings statistics', () => {
      const savings = calculateTokenSavings();

      expect(savings.coreToolCount).toBe(CORE_TOOLS.length);
      expect(savings.deferredToolCount).toBe(DEFERRED_TOOLS.length);
      expect(savings.totalTools).toBe(CORE_TOOLS.length + DEFERRED_TOOLS.length);
      expect(savings.estimatedSavings).toBeGreaterThan(0);
      expect(savings.savingsPercent).toMatch(/^\d+\.\d+%$/);
    });

    test('should estimate >80% token savings', () => {
      const savings = calculateTokenSavings();
      const percent = parseFloat(savings.savingsPercent);
      expect(percent).toBeGreaterThan(80);
    });
  });

  describe('shouldLoadImmediately', () => {
    test('should return true for core tools', () => {
      expect(shouldLoadImmediately('tools/search')).toBe(true);
      expect(shouldLoadImmediately('system/status')).toBe(true);
      expect(shouldLoadImmediately('agents/spawn')).toBe(true);
    });

    test('should return false for deferred tools', () => {
      expect(shouldLoadImmediately('memory/query')).toBe(false);
      expect(shouldLoadImmediately('workflow/execute')).toBe(false);
    });
  });

  describe('shouldDefer', () => {
    test('should return false for core tools', () => {
      expect(shouldDefer('tools/search')).toBe(false);
    });

    test('should return true for deferred tools', () => {
      expect(shouldDefer('memory/query')).toBe(true);
    });

    test('should return true for unknown tools (default behavior)', () => {
      expect(shouldDefer('unknown/tool')).toBe(true);
    });
  });

  describe('shouldLoadForContext', () => {
    test('should return true when context contains keywords', () => {
      expect(shouldLoadForContext('memory/query', 'I need to check the memory for previous decisions')).toBe(true);
    });

    test('should return false when context does not contain keywords', () => {
      expect(shouldLoadForContext('memory/query', 'Spawn an agent to work on this')).toBe(false);
    });
  });
});

describe('Tool Examples', () => {
  describe('TOOL_EXAMPLES', () => {
    test('should have examples for agents/spawn', () => {
      expect(TOOL_EXAMPLES['agents/spawn']).toBeDefined();
      expect(TOOL_EXAMPLES['agents/spawn'].length).toBeGreaterThanOrEqual(2);
    });

    test('should have examples for tasks/create', () => {
      expect(TOOL_EXAMPLES['tasks/create']).toBeDefined();
      expect(TOOL_EXAMPLES['tasks/create'].length).toBeGreaterThanOrEqual(2);
    });

    test('should have examples for memory/query', () => {
      expect(TOOL_EXAMPLES['memory/query']).toBeDefined();
    });
  });

  describe('getToolExamples', () => {
    test('should return examples for known tools', () => {
      const examples = getToolExamples('agents/spawn');
      expect(examples.length).toBeGreaterThan(0);
    });

    test('should return empty array for unknown tools', () => {
      const examples = getToolExamples('unknown/tool');
      expect(examples).toEqual([]);
    });
  });

  describe('hasExamples', () => {
    test('should return true for tools with examples', () => {
      expect(hasExamples('agents/spawn')).toBe(true);
    });

    test('should return false for tools without examples', () => {
      expect(hasExamples('unknown/tool')).toBe(false);
    });
  });

  describe('getExampleByComplexity', () => {
    test('should return minimal complexity example', () => {
      const example = getExampleByComplexity('agents/spawn', 'minimal');
      expect(example).toBeDefined();
      expect(example?.complexity).toBe('minimal');
    });

    test('should return advanced complexity example', () => {
      const example = getExampleByComplexity('agents/spawn', 'advanced');
      expect(example).toBeDefined();
      expect(example?.complexity).toBe('advanced');
    });
  });

  describe('example structure', () => {
    test('all examples should have required fields', () => {
      for (const [toolName, examples] of Object.entries(TOOL_EXAMPLES)) {
        for (const example of examples) {
          expect(example.description).toBeDefined();
          expect(typeof example.description).toBe('string');
          expect(example.input).toBeDefined();
          expect(typeof example.input).toBe('object');
          expect(example.complexity).toBeDefined();
          expect(['minimal', 'typical', 'advanced']).toContain(example.complexity);
        }
      }
    });

    test('agents/spawn examples should have valid inputs', () => {
      const examples = TOOL_EXAMPLES['agents/spawn'];
      for (const example of examples) {
        expect(example.input.type).toBeDefined();
        expect(example.input.name).toBeDefined();
      }
    });
  });
});

describe('Integration', () => {
  test('core tools should have examples', () => {
    const coreToolsWithExamples = CORE_TOOLS.filter(t => hasExamples(t.name));
    // At least some core tools should have examples
    expect(coreToolsWithExamples.length).toBeGreaterThanOrEqual(1);
  });

  test('high-priority deferred tools should have examples', () => {
    const highPriorityDeferred = DEFERRED_TOOLS.filter(
      t => t.priority === 'medium' || t.priority === 'high'
    );
    const withExamples = highPriorityDeferred.filter(t => hasExamples(t.name));
    // At least some should have examples
    expect(withExamples.length).toBeGreaterThanOrEqual(1);
  });
});
