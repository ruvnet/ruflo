# @claude-flow/plugin-test-intelligence

<!-- adr-356:quickstart:start -->
**@claude-flow/plugin-test-intelligence** — A Ruflo plugin that gives agents MCP tools for predictive test selection, flaky test detection, coverage gaps, mutation testing optimization and test suggestions.

**Supported environments:** Node.js 18+ · ESM

## Quickstart

```bash
npm install @claude-flow/plugin-test-intelligence
```

```js
import { testIntelligenceTools, CoverageGapsInputSchema } from '@claude-flow/plugin-test-intelligence';

console.log('tools:', testIntelligenceTools.map((t) => t.name).join(', '));
const check = CoverageGapsInputSchema.safeParse({ targetPaths: ['src/'] });
console.log('valid input:', check.success);
```

Expected output:

```text
tools: test/select-predictive, test/flaky-detect, test/coverage-gaps, test/mutation-optimize, test/generate-suggest
valid input: true
```

Install it into a Ruflo project with [`@claude-flow/cli`](https://www.npmjs.com/package/@claude-flow/cli): `npx @claude-flow/cli@latest plugins install -n @claude-flow/plugin-test-intelligence`.
<!-- adr-356:quickstart:end -->

[![npm version](https://img.shields.io/npm/v/@claude-flow/plugin-test-intelligence.svg)](https://www.npmjs.com/package/@claude-flow/plugin-test-intelligence)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/plugin-test-intelligence.svg)](https://www.npmjs.com/package/@claude-flow/plugin-test-intelligence)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A comprehensive test intelligence plugin combining reinforcement learning for optimal test selection with graph neural networks for code-to-test mapping. The plugin enables predictive test selection (run only tests likely to fail), flaky test detection, mutation testing optimization, and test coverage gap identification while integrating seamlessly with popular testing frameworks.

## Features

- **Predictive Test Selection**: Select tests most likely to fail based on code changes using RL
- **Flaky Test Detection**: Identify and analyze flaky tests with root cause classification
- **Coverage Gap Analysis**: Identify test coverage gaps using code-test graph analysis
- **Mutation Testing Optimization**: Optimize mutation testing for efficiency within time budgets
- **Test Generation Suggestions**: Suggest test cases for uncovered code paths

## Installation

### npm

```bash
npm install @claude-flow/plugin-test-intelligence
```

### CLI

```bash
npx claude-flow plugins install --name @claude-flow/plugin-test-intelligence
```

## Quick Start

```typescript
import { TestIntelligencePlugin } from '@claude-flow/plugin-test-intelligence';

// Initialize the plugin
const testIntel = new TestIntelligencePlugin({
  historyPath: './data/test-history',
  framework: 'vitest',
  projectPath: './'
});

// Predictive test selection
const selectedTests = await testIntel.selectPredictive({
  changes: {
    files: ['src/auth/login.ts', 'src/utils/validation.ts'],
    gitRef: 'HEAD'
  },
  strategy: 'balanced',
  budget: { maxTests: 50, confidence: 0.95 }
});

// Detect flaky tests
const flakyTests = await testIntel.flakyDetect({
  scope: { historyDepth: 100 },
  analysis: ['intermittent_failures', 'timing_sensitive'],
  threshold: 0.1
});

// Identify coverage gaps
const gaps = await testIntel.coverageGaps({
  targetPaths: ['src/'],
  coverageType: 'semantic',
  prioritization: 'risk'
});
```

## MCP Tools

### 1. `test/select-predictive`

Select tests most likely to fail based on code changes.

```typescript
const result = await mcp.invoke('test/select-predictive', {
  changes: {
    files: ['src/services/UserService.ts', 'src/models/User.ts'],
    gitDiff: '...diff content...',
    gitRef: 'feature-branch'
  },
  strategy: 'fast_feedback',
  budget: {
    maxTests: 30,
    maxDuration: 300,  // 5 minutes
    confidence: 0.95
  }
});

// Returns:
// {
//   selectedTests: [
//     { name: 'UserService.createUser', file: 'tests/UserService.test.ts', priority: 1, failureProbability: 0.82 },
//     { name: 'User.validate', file: 'tests/User.test.ts', priority: 2, failureProbability: 0.75 },
//     ...
//   ],
//   estimatedDuration: 45,
//   coverageEstimate: 0.89,
//   skippedTests: 120,
//   timeSaved: '4m 30s'
// }
```

### 2. `test/flaky-detect`

Identify and analyze flaky tests.

```typescript
const result = await mcp.invoke('test/flaky-detect', {
  scope: {
    testSuite: 'integration',
    historyDepth: 200
  },
  analysis: [
    'intermittent_failures',
    'timing_sensitive',
    'order_dependent',
    'resource_contention'
  ],
  threshold: 0.1
});

// Returns:
// {
//   flakyTests: [
//     {
//       name: 'API.rateLimit.test',
//       flakinessScore: 0.23,
//       failureRate: 0.15,
//       rootCause: 'timing_sensitive',
//       details: 'Relies on 100ms timeout that occasionally exceeds',
//       recommendation: 'Use fake timers or increase timeout margin',
//       lastFailed: '2024-01-14T10:30:00Z'
//     },
//     {
//       name: 'Database.concurrent.test',
//       flakinessScore: 0.18,
//       failureRate: 0.08,
//       rootCause: 'resource_contention',
//       details: 'Competes for database connections with other tests',
//       recommendation: 'Isolate test database or use connection pooling'
//     }
//   ],
//   summary: {
//     totalFlakyTests: 8,
//     quarantineSuggested: 3,
//     estimatedCITimeSaved: '12 minutes per run'
//   }
// }
```

### 3. `test/coverage-gaps`

Identify test coverage gaps.

```typescript
const result = await mcp.invoke('test/coverage-gaps', {
  targetPaths: ['src/services/', 'src/controllers/'],
  coverageType: 'semantic',
  prioritization: 'risk',
  minCoverage: 80
});

// Returns:
// {
//   gaps: [
//     {
//       file: 'src/services/PaymentService.ts',
//       function: 'processRefund',
//       currentCoverage: 45,
//       riskScore: 0.85,
//       complexity: 'high',
//       recommendation: 'Add tests for error handling paths',
//       suggestedTestCases: [
//         'should handle partial refund',
//         'should reject refund exceeding original amount',
//         'should handle payment provider timeout'
//       ]
//     },
//     ...
//   ],
//   summary: {
//     averageCoverage: 72,
//     highRiskUncovered: 5,
//     estimatedTestsNeeded: 15
//   }
// }
```

### 4. `test/mutation-optimize`

Optimize mutation testing for efficiency.

```typescript
const result = await mcp.invoke('test/mutation-optimize', {
  targetPath: 'src/utils/validation.ts',
  budget: 100,  // Max mutations to run
  strategy: 'ml_guided',
  mutationTypes: ['arithmetic', 'logical', 'boundary', 'null_check']
});

// Returns:
// {
//   selectedMutations: [
//     {
//       location: { line: 45, column: 12 },
//       type: 'boundary',
//       original: 'age >= 18',
//       mutated: 'age > 18',
//       killedBy: ['validateAge.boundary.test'],
//       priority: 1
//     },
//     ...
//   ],
//   mutationScore: 0.82,
//   survivingMutants: 18,
//   testGaps: [
//     { mutation: 'null_check at line 67', reason: 'No test covers null input' }
//   ],
//   timeSpent: '45s',
//   timeVsFullRun: '12x faster'
// }
```

### 5. `test/generate-suggest`

Suggest test cases for uncovered code.

```typescript
const result = await mcp.invoke('test/generate-suggest', {
  targetFunction: 'src/auth/validateToken.ts:validateJWT',
  testStyle: 'unit',
  framework: 'vitest',
  edgeCases: true,
  mockStrategy: 'minimal'
});

// Returns:
// {
//   suggestedTests: [
//     {
//       name: 'should validate a valid JWT token',
//       type: 'happy_path',
//       code: `
// test('should validate a valid JWT token', () => {
//   const token = createTestToken({ userId: '123', exp: Date.now() + 3600000 });
//   const result = validateJWT(token);
//   expect(result.valid).toBe(true);
//   expect(result.payload.userId).toBe('123');
// });`
//     },
//     {
//       name: 'should reject expired token',
//       type: 'edge_case',
//       code: `
// test('should reject expired token', () => {
//   const token = createTestToken({ userId: '123', exp: Date.now() - 1000 });
//   const result = validateJWT(token);
//   expect(result.valid).toBe(false);
//   expect(result.error).toBe('TOKEN_EXPIRED');
// });`
//     },
//     ...
//   ],
//   requiredMocks: ['jsonwebtoken.verify'],
//   setupCode: '...'
// }
```

## Configuration Options

```typescript
interface TestIntelligenceConfig {
  // Data paths
  historyPath: string;            // Path to test history storage
  projectPath: string;            // Project root path

  // Framework
  framework: 'jest' | 'vitest' | 'pytest' | 'junit' | 'mocha';
  testPattern: string;            // Glob pattern for test files

  // Performance
  maxMemoryMB: number;            // WASM memory limit (default: 512)
  maxCpuTimeSeconds: number;      // Operation timeout (default: 60)

  // Learning
  learningEnabled: boolean;       // Enable continuous learning (default: true)
  minHistoryDepth: number;        // Minimum runs before predictions (default: 50)
}
```

## Framework Support

| Framework | Language | Support Level |
|-----------|----------|---------------|
| Jest | JavaScript/TypeScript | Full |
| Vitest | JavaScript/TypeScript | Full |
| pytest | Python | Full |
| JUnit | Java | Partial |
| Mocha | JavaScript | Partial |
| RSpec | Ruby | Basic |

## Security Considerations

### Test Execution Safety

This plugin analyzes tests but does NOT execute them directly:
- Returns test selection lists only
- User runs tests via their own CI/CD pipeline
- No arbitrary code execution in WASM

### WASM Security Constraints

| Constraint | Value | Rationale |
|------------|-------|-----------|
| Memory Limit | 512MB max | Sufficient for test analysis |
| CPU Time Limit | 60 seconds | Prevent runaway analysis |
| No Test Execution | Analysis only | Prevent arbitrary code execution |
| No Network Access | Enforced | Prevent data exfiltration |
| Sandboxed History | Per-project | Prevent cross-project leakage |

### Input Validation

All inputs are validated using Zod schemas:
```typescript
// All inputs validated:
- Git diffs: Maximum 1MB
- File lists: Maximum 1000 files
- History depth: 10-10000 runs
- Max duration: 1-86400 seconds (24 hours)
- Confidence level: 0.5-1.0
- Test names: Alphanumeric with standard punctuation, max 500 characters
- Framework: Enum validated against supported frameworks
```

### Rate Limiting

```typescript
const rateLimits = {
  'test/select-predictive': { requestsPerMinute: 60, maxConcurrent: 5 },
  'test/flaky-detect': { requestsPerMinute: 10, maxConcurrent: 2 },
  'test/coverage-gaps': { requestsPerMinute: 30, maxConcurrent: 3 },
  'test/mutation-optimize': { requestsPerMinute: 5, maxConcurrent: 1 },
  'test/generate-suggest': { requestsPerMinute: 30, maxConcurrent: 3 }
};
```

## Performance

| Metric | Target |
|--------|--------|
| Test selection | <1s for 10K tests |
| Flaky detection | <5s for 1000 test runs |
| Coverage gap analysis | <10s for 100K LOC |
| Mutation optimization | 80% mutation score in 20% time |
| CI time reduction | 60-80% |

## Learning Pipeline

The plugin continuously learns from test execution history:

```
Execution History --> SONA Learning --> RL Policy
      |                    |                |
      v                    v                v
[fail rates]       [pattern bank]    [selection model]
[timings]          [failure modes]   [prioritization]
[coverage]         [correlations]    [budget allocation]
```

## Dependencies

- `micro-hnsw-wasm`: Fast code-to-test similarity matching
- `ruvector-learning-wasm`: RL-based test selection and prioritization
- `ruvector-gnn-wasm`: Code-test dependency graphs for impact analysis
- `ruvector-sparse-inference-wasm`: Efficient flaky test pattern detection
- `sona`: Continuous learning from test execution history
- `istanbul-lib-coverage`: Coverage report parsing

## Related Plugins

| Plugin | Description | Use Case |
|--------|-------------|----------|
| [@claude-flow/plugin-code-intelligence](../code-intelligence) | Code analysis | Impact analysis for test prioritization |
| [@claude-flow/plugin-perf-optimizer](../perf-optimizer) | Performance optimization | Test performance profiling |
| [@claude-flow/plugin-financial-risk](../financial-risk) | Risk analysis | Test risk scoring for critical paths |

## License

MIT License

Copyright (c) 2026 Claude Flow

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

<!-- adr-356:footer:start -->
---

Built by [rUv](https://ruv.io) · [ruv.io](https://ruv.io) · [Source](https://github.com/ruvnet/ruflo/tree/main/v3/plugins/test-intelligence)
<!-- adr-356:footer:end -->
