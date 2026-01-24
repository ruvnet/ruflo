# @claude-flow/plugin-code-intelligence

[![npm version](https://img.shields.io/npm/v/@claude-flow/plugin-code-intelligence.svg)](https://www.npmjs.com/package/@claude-flow/plugin-code-intelligence)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/plugin-code-intelligence.svg)](https://www.npmjs.com/package/@claude-flow/plugin-code-intelligence)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A comprehensive code intelligence plugin combining graph neural networks for code structure analysis with ultra-fast vector search for semantic code similarity. The plugin enables dead code detection, API surface analysis, refactoring impact prediction, and architectural drift monitoring while integrating seamlessly with existing IDE workflows.

## Features

- **Semantic Code Search**: Find semantically similar code across the codebase using natural language or code snippets
- **Architecture Analysis**: Analyze dependency graphs, detect layer violations, circular dependencies, and architectural drift
- **Refactoring Impact Prediction**: Predict the impact of proposed code changes using GNN analysis
- **Module Splitting**: Suggest optimal module boundaries using MinCut algorithms
- **Pattern Learning**: Learn recurring patterns from code changes using SONA (Self-Optimizing Neural Architecture)

## Installation

### npm

```bash
npm install @claude-flow/plugin-code-intelligence
```

### CLI

```bash
npx @claude-flow/cli plugins install code-intelligence
```

## Quick Start

```typescript
import { CodeIntelligencePlugin } from '@claude-flow/plugin-code-intelligence';

// Initialize the plugin
const codeIntel = new CodeIntelligencePlugin({
  indexPath: './data/code-index',
  repoPath: './',
  languages: ['typescript', 'javascript']
});

// Semantic code search
const results = await codeIntel.semanticSearch({
  query: 'function that validates user email',
  scope: { paths: ['src/'], excludeTests: true },
  searchType: 'semantic',
  topK: 10
});

// Analyze architecture
const architecture = await codeIntel.architectureAnalyze({
  rootPath: './src',
  analysis: ['dependency_graph', 'circular_deps', 'dead_code'],
  outputFormat: 'mermaid'
});

// Predict refactoring impact
const impact = await codeIntel.refactorImpact({
  changes: [
    { file: 'src/utils/auth.ts', type: 'rename', details: { newName: 'authentication.ts' } }
  ],
  depth: 3,
  includeTests: true
});
```

## MCP Tools

### 1. `code/semantic-search`

Find semantically similar code across the codebase.

```typescript
const result = await mcp.invoke('code/semantic-search', {
  query: 'handle authentication token refresh',
  scope: {
    paths: ['src/'],
    languages: ['typescript'],
    excludeTests: false
  },
  searchType: 'semantic',
  topK: 10
});

// Returns:
// {
//   results: [
//     {
//       file: 'src/auth/tokenManager.ts',
//       function: 'refreshAccessToken',
//       snippet: 'async function refreshAccessToken(refreshToken: string)...',
//       similarity: 0.94,
//       lineRange: [45, 72]
//     },
//     ...
//   ]
// }
```

### 2. `code/architecture-analyze`

Analyze codebase architecture using graph algorithms.

```typescript
const result = await mcp.invoke('code/architecture-analyze', {
  rootPath: './src',
  analysis: [
    'dependency_graph',
    'layer_violations',
    'circular_deps',
    'component_coupling',
    'dead_code'
  ],
  baseline: 'main',  // Git ref for drift comparison
  outputFormat: 'mermaid'
});

// Returns:
// {
//   dependencyGraph: '...mermaid diagram...',
//   layerViolations: [
//     { from: 'presentation/UserForm', to: 'data/UserRepository', rule: 'no-direct-data-access' }
//   ],
//   circularDeps: [
//     ['moduleA', 'moduleB', 'moduleC', 'moduleA']
//   ],
//   deadCode: [
//     { file: 'src/utils/legacy.ts', reason: 'no-references', confidence: 0.95 }
//   ],
//   architecturalDrift: {
//     newDependencies: 5,
//     removedDependencies: 2,
//     couplingChange: +0.03
//   }
// }
```

### 3. `code/refactor-impact`

Predict impact of proposed refactoring.

```typescript
const result = await mcp.invoke('code/refactor-impact', {
  changes: [
    { file: 'src/services/UserService.ts', type: 'extract', details: { method: 'validateUser' } },
    { file: 'src/models/User.ts', type: 'rename', details: { property: 'name', to: 'fullName' } }
  ],
  depth: 3,
  includeTests: true
});

// Returns:
// {
//   impactedFiles: [
//     { file: 'src/controllers/AuthController.ts', changes: ['import path', 'method call'] },
//     { file: 'src/services/AdminService.ts', changes: ['method call'] },
//     { file: 'tests/UserService.test.ts', changes: ['test assertions'] }
//   ],
//   totalFilesAffected: 12,
//   riskScore: 0.35,
//   breakingChanges: [
//     { type: 'property-rename', description: 'User.name -> User.fullName', usages: 45 }
//   ],
//   suggestedMigrationSteps: [...]
// }
```

### 4. `code/split-suggest`

Suggest optimal module boundaries using MinCut.

```typescript
const result = await mcp.invoke('code/split-suggest', {
  targetPath: './src/monolith',
  strategy: 'minimize_coupling',
  constraints: {
    maxModuleSize: 5000,  // LOC
    minModuleSize: 500,
    preserveBoundaries: ['src/monolith/core']
  },
  targetModules: 4
});

// Returns:
// {
//   suggestedModules: [
//     {
//       name: 'user-management',
//       files: ['User.ts', 'UserService.ts', 'UserRepository.ts'],
//       loc: 2340,
//       externalDependencies: 3
//     },
//     {
//       name: 'order-processing',
//       files: ['Order.ts', 'OrderService.ts', 'PaymentHandler.ts'],
//       loc: 3120,
//       externalDependencies: 5
//     },
//     ...
//   ],
//   couplingReduction: '45%',
//   migrationComplexity: 'medium'
// }
```

### 5. `code/learn-patterns`

Learn code patterns from repository history.

```typescript
const result = await mcp.invoke('code/learn-patterns', {
  scope: {
    gitRange: 'HEAD~100..HEAD',
    authors: [],  // All authors
    paths: ['src/']
  },
  patternTypes: ['bug_patterns', 'refactor_patterns'],
  minOccurrences: 3
});

// Returns:
// {
//   patterns: [
//     {
//       type: 'bug_pattern',
//       name: 'null-check-before-access',
//       occurrences: 12,
//       description: 'Adding null checks before property access',
//       example: { before: 'user.name', after: 'user?.name' }
//     },
//     {
//       type: 'refactor_pattern',
//       name: 'async-await-migration',
//       occurrences: 8,
//       description: 'Converting Promise.then chains to async/await'
//     }
//   ]
// }
```

## Configuration Options

```typescript
interface CodeIntelligenceConfig {
  // Indexing
  indexPath: string;              // Path to code index storage
  repoPath: string;               // Repository root path

  // Language support
  languages: string[];            // Languages to index
  excludePaths: string[];         // Paths to exclude

  // Performance
  maxMemoryMB: number;            // WASM memory limit (default: 1024)
  maxCpuTimeSeconds: number;      // Operation timeout (default: 300)
  incrementalIndexing: boolean;   // Enable incremental updates (default: true)

  // Security
  blockSensitiveFiles: boolean;   // Block .env, credentials, etc. (default: true)
  maskSecrets: boolean;           // Mask detected secrets in results (default: true)
}
```

## Supported Languages

| Tier | Languages | Support Level |
|------|-----------|---------------|
| Tier 1 (Full) | TypeScript, JavaScript, React, Vue, Angular | Complete AST analysis |
| Tier 2 (Partial) | Python, Java, Ruby, PHP | Core analysis features |
| Tier 3 (Basic) | Rust, Go, C++, Swift, Kotlin | Dependency and search |

## Security Considerations

### Path Traversal Prevention

All file paths are validated to prevent directory traversal:
- Paths normalized and resolved against allowed root
- Blocked patterns: `.env`, `.git/config`, credentials, secrets, private keys

### Secret Detection and Masking

Secrets are automatically detected and masked in search results:
- API keys and tokens
- Private keys and certificates
- Password strings
- Cloud provider credentials (AWS, GCP, Azure)

### WASM Security Constraints

| Constraint | Value | Rationale |
|------------|-------|-----------|
| Memory Limit | 1GB max | Handle large codebases |
| CPU Time Limit | 300 seconds | Allow full repo analysis |
| No Network Access | Enforced | Prevent code exfiltration |
| No Shell Execution | Enforced | Prevent command injection |
| Read-Only Mode | Enforced | Prevent code modification |

### Input Validation

```typescript
// All inputs validated:
- Query strings: 1-5000 characters
- File paths: Maximum 500 characters, max 100 paths per request
- Languages: Maximum 20 languages per request
- topK: 1-1000 results
```

## Performance

| Metric | Target |
|--------|--------|
| Semantic code search | <100ms for 1M LOC |
| Architecture analysis | <10s for 100K LOC |
| Refactor impact | <5s for single change |
| Module splitting | <30s for 50K LOC |
| Pattern learning | <2min for 1000 commits |

## IDE Integration

- **VS Code Extension**: Real-time analysis and suggestions
- **JetBrains Plugin**: IntelliJ, WebStorm, PyCharm support
- **CLI**: CI/CD pipeline integration
- **MCP**: Direct Claude Code integration

## Dependencies

- `micro-hnsw-wasm`: Semantic code search and clone detection (150x faster)
- `ruvector-gnn-wasm`: Code dependency graphs, call graphs, and control flow analysis
- `ruvector-mincut-wasm`: Module boundary detection and optimal code splitting
- `sona`: Self-optimizing learning from code review patterns
- `ruvector-dag-wasm`: Build dependency analysis and incremental compilation
- `@babel/parser`: JavaScript/TypeScript AST parsing
- `typescript`: TypeScript compiler API

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
