/**
 * Validation Script for MCP Tool Improvements
 *
 * Validates the implementations without requiring Jest.
 */

import {
  CORE_TOOLS,
  DEFERRED_TOOLS,
  calculateTokenSavings,
  shouldLoadImmediately,
  shouldDefer,
  getToolConfig,
  shouldLoadForContext,
  getAllToolConfigs,
} from '../../src/mcp/schemas/deferred-loading.js';

import {
  TOOL_EXAMPLES,
  getToolExamples,
  hasExamples,
  getExampleByComplexity,
  ToolExample,
} from '../../src/mcp/schemas/tool-examples.js';

interface TestResult {
  name: string;
  passed: boolean;
  message?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({
      name,
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected} but got ${actual}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error(`Expected value to be defined but got undefined`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toBeGreaterThanOrEqual(expected: number) {
      if (actual < expected) {
        throw new Error(`Expected ${actual} to be >= ${expected}`);
      }
    },
    toContain(expected: any) {
      if (!actual.includes(expected)) {
        throw new Error(`Expected array to contain ${expected}`);
      }
    },
    toMatch(pattern: RegExp) {
      if (!pattern.test(actual)) {
        throw new Error(`Expected "${actual}" to match ${pattern}`);
      }
    },
    toEqual(expected: any) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
  };
}

console.log('='.repeat(60));
console.log('MCP Tool Improvements Validation');
console.log('='.repeat(60));
console.log();

// Deferred Loading Tests
console.log('🧪 Testing Deferred Loading Configuration...');

test('CORE_TOOLS has tools/search as critical priority', () => {
  const searchTool = CORE_TOOLS.find(t => t.name === 'tools/search');
  expect(searchTool).toBeDefined();
  expect(searchTool?.defer_loading).toBe(false);
  expect(searchTool?.priority).toBe('critical');
});

test('All core tools have defer_loading: false', () => {
  for (const tool of CORE_TOOLS) {
    expect(tool.defer_loading).toBe(false);
  }
});

test('agents/spawn and agents/list are core tools', () => {
  const spawn = CORE_TOOLS.find(t => t.name === 'agents/spawn');
  const list = CORE_TOOLS.find(t => t.name === 'agents/list');
  expect(spawn).toBeDefined();
  expect(list).toBeDefined();
});

test('All deferred tools have defer_loading: true', () => {
  for (const tool of DEFERRED_TOOLS) {
    expect(tool.defer_loading).toBe(true);
  }
});

test('memory/query is a deferred tool', () => {
  const memoryQuery = DEFERRED_TOOLS.find(t => t.name === 'memory/query');
  expect(memoryQuery).toBeDefined();
  expect(memoryQuery?.defer_loading).toBe(true);
});

test('memory/query has load conditions', () => {
  const memoryQuery = DEFERRED_TOOLS.find(t => t.name === 'memory/query');
  expect(memoryQuery?.loadConditions).toBeDefined();
  expect(memoryQuery?.loadConditions?.contextKeywords).toContain('memory');
});

test('calculateTokenSavings returns valid statistics', () => {
  const savings = calculateTokenSavings();
  expect(savings.coreToolCount).toBe(CORE_TOOLS.length);
  expect(savings.deferredToolCount).toBe(DEFERRED_TOOLS.length);
  expect(savings.totalTools).toBe(CORE_TOOLS.length + DEFERRED_TOOLS.length);
  expect(savings.estimatedSavings).toBeGreaterThan(0);
  expect(savings.savingsPercent).toMatch(/^\d+\.\d+%$/);
});

test('Token savings exceeds 80%', () => {
  const savings = calculateTokenSavings();
  const percent = parseFloat(savings.savingsPercent);
  expect(percent).toBeGreaterThan(80);
});

test('shouldLoadImmediately returns true for core tools', () => {
  expect(shouldLoadImmediately('tools/search')).toBe(true);
  expect(shouldLoadImmediately('system/status')).toBe(true);
  expect(shouldLoadImmediately('agents/spawn')).toBe(true);
});

test('shouldLoadImmediately returns false for deferred tools', () => {
  expect(shouldLoadImmediately('memory/query')).toBe(false);
  expect(shouldLoadImmediately('workflow/execute')).toBe(false);
});

test('shouldDefer returns true for unknown tools', () => {
  expect(shouldDefer('unknown/tool')).toBe(true);
});

test('shouldLoadForContext detects keywords', () => {
  expect(shouldLoadForContext('memory/query', 'check the memory')).toBe(true);
  expect(shouldLoadForContext('memory/query', 'spawn an agent')).toBe(false);
});

// Tool Examples Tests
console.log();
console.log('🧪 Testing Tool Examples...');

test('TOOL_EXAMPLES has examples for agents/spawn', () => {
  expect(TOOL_EXAMPLES['agents/spawn']).toBeDefined();
  expect(TOOL_EXAMPLES['agents/spawn'].length).toBeGreaterThanOrEqual(2);
});

test('TOOL_EXAMPLES has examples for tasks/create', () => {
  expect(TOOL_EXAMPLES['tasks/create']).toBeDefined();
  expect(TOOL_EXAMPLES['tasks/create'].length).toBeGreaterThanOrEqual(2);
});

test('TOOL_EXAMPLES has examples for memory/query', () => {
  expect(TOOL_EXAMPLES['memory/query']).toBeDefined();
});

test('getToolExamples returns examples for known tools', () => {
  const examples = getToolExamples('agents/spawn');
  expect(examples.length).toBeGreaterThan(0);
});

test('getToolExamples returns empty array for unknown tools', () => {
  const examples = getToolExamples('unknown/tool');
  expect(examples.length).toBe(0);
});

test('hasExamples returns true for tools with examples', () => {
  expect(hasExamples('agents/spawn')).toBe(true);
});

test('hasExamples returns false for tools without examples', () => {
  expect(hasExamples('unknown/tool')).toBe(false);
});

test('getExampleByComplexity returns correct complexity', () => {
  const minimal = getExampleByComplexity('agents/spawn', 'minimal');
  expect(minimal).toBeDefined();
  expect(minimal?.complexity).toBe('minimal');

  const advanced = getExampleByComplexity('agents/spawn', 'advanced');
  expect(advanced).toBeDefined();
  expect(advanced?.complexity).toBe('advanced');
});

test('All examples have required fields', () => {
  for (const [toolName, examples] of Object.entries(TOOL_EXAMPLES)) {
    for (const example of examples) {
      expect(example.description).toBeDefined();
      expect(example.input).toBeDefined();
      expect(example.complexity).toBeDefined();
      expect(['minimal', 'typical', 'advanced']).toContain(example.complexity);
    }
  }
});

test('agents/spawn examples have valid inputs', () => {
  const examples = TOOL_EXAMPLES['agents/spawn'];
  for (const example of examples) {
    expect(example.input.type).toBeDefined();
    expect(example.input.name).toBeDefined();
  }
});

// Integration Tests
console.log();
console.log('🧪 Testing Integration...');

test('At least some core tools have examples', () => {
  const coreToolsWithExamples = CORE_TOOLS.filter(t => hasExamples(t.name));
  expect(coreToolsWithExamples.length).toBeGreaterThanOrEqual(1);
});

test('High-priority deferred tools have examples', () => {
  const highPriorityDeferred = DEFERRED_TOOLS.filter(
    t => t.priority === 'medium' || t.priority === 'high'
  );
  const withExamples = highPriorityDeferred.filter(t => hasExamples(t.name));
  expect(withExamples.length).toBeGreaterThanOrEqual(1);
});

// Summary
console.log();
console.log('='.repeat(60));
console.log('VALIDATION SUMMARY');
console.log('='.repeat(60));

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

for (const result of results) {
  const icon = result.passed ? '✅' : '❌';
  console.log(`${icon} ${result.name}`);
  if (!result.passed && result.message) {
    console.log(`   Error: ${result.message}`);
  }
}

console.log();
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}
