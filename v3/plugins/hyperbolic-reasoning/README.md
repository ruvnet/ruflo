# @claude-flow/plugin-hyperbolic-reasoning

[![npm version](https://img.shields.io/npm/v/@claude-flow/plugin-hyperbolic-reasoning.svg)](https://www.npmjs.com/package/@claude-flow/plugin-hyperbolic-reasoning)
[![license](https://img.shields.io/npm/l/@claude-flow/plugin-hyperbolic-reasoning.svg)](https://github.com/ruvnet/claude-flow/blob/main/LICENSE)
[![downloads](https://img.shields.io/npm/dm/@claude-flow/plugin-hyperbolic-reasoning.svg)](https://www.npmjs.com/package/@claude-flow/plugin-hyperbolic-reasoning)

An exotic reasoning plugin implementing hyperbolic neural networks for superior hierarchical understanding. The plugin enables efficient representation of tree structures, taxonomic reasoning, and hierarchical entailment using Poincare ball embeddings with Mobius operations. Applications include improved ontology navigation, hierarchical code understanding, and organizational relationship modeling.

## Installation

### npm

```bash
npm install @claude-flow/plugin-hyperbolic-reasoning
```

### CLI

```bash
npx claude-flow plugins install --name @claude-flow/plugin-hyperbolic-reasoning
```

## Quick Start

```typescript
import { HyperbolicReasoningPlugin } from '@claude-flow/plugin-hyperbolic-reasoning';

// Initialize the plugin
const plugin = new HyperbolicReasoningPlugin();
await plugin.initialize();

// Embed a file system hierarchy in hyperbolic space
const embedding = await plugin.embedHierarchy({
  hierarchy: {
    nodes: [
      { id: 'src', parent: null, features: { type: 'directory' } },
      { id: 'src/components', parent: 'src', features: { type: 'directory' } },
      { id: 'src/components/Button.tsx', parent: 'src/components', features: { type: 'file' } },
      { id: 'src/components/Modal.tsx', parent: 'src/components', features: { type: 'file' } },
      { id: 'src/utils', parent: 'src', features: { type: 'directory' } }
    ]
  },
  model: 'poincare_ball',
  parameters: {
    dimensions: 32,
    curvature: -1.0,
    learnCurvature: true
  }
});

console.log('Hierarchy embedded in hyperbolic space');
```

## Available MCP Tools

### 1. `hyperbolic/embed-hierarchy`

Embed hierarchical data in hyperbolic space (Poincare ball).

```typescript
const result = await mcp.call('hyperbolic/embed-hierarchy', {
  hierarchy: {
    nodes: [
      { id: 'Animal', parent: null, features: {} },
      { id: 'Mammal', parent: 'Animal', features: {} },
      { id: 'Dog', parent: 'Mammal', features: {} },
      { id: 'Cat', parent: 'Mammal', features: {} },
      { id: 'Bird', parent: 'Animal', features: {} }
    ],
    edges: []
  },
  model: 'poincare_ball',
  parameters: {
    dimensions: 32,
    curvature: -1.0,
    learnCurvature: true
  }
});
```

**Models:** `poincare_ball`, `lorentz`, `klein`, `half_plane`

**Returns:** Hyperbolic embeddings with learned curvature and embedding quality metrics.

### 2. `hyperbolic/taxonomic-reason`

Perform taxonomic reasoning using hyperbolic entailment.

```typescript
const result = await mcp.call('hyperbolic/taxonomic-reason', {
  query: {
    type: 'is_a',
    subject: 'Dog',
    object: 'Mammal'
  },
  taxonomy: 'animal-taxonomy',
  inference: {
    transitive: true,
    fuzzy: false,
    confidence: 0.8
  }
});
```

**Query Types:** `is_a`, `subsumption`, `lowest_common_ancestor`, `path`, `similarity`

**Returns:** Reasoning result with confidence score and inference path.

### 3. `hyperbolic/semantic-search`

Hierarchically-aware semantic search in hyperbolic space.

```typescript
const result = await mcp.call('hyperbolic/semantic-search', {
  query: 'authentication middleware',
  index: 'codebase-hierarchy',
  searchMode: 'subtree',
  constraints: {
    maxDepth: 5,
    minDepth: 0,
    subtreeRoot: 'src/middleware'
  },
  topK: 10
});
```

**Search Modes:** `nearest`, `subtree`, `ancestors`, `siblings`, `cone`

**Returns:** Ranked results with hierarchical context and similarity scores.

### 4. `hyperbolic/hierarchy-compare`

Compare hierarchical structures using hyperbolic alignment.

```typescript
const result = await mcp.call('hyperbolic/hierarchy-compare', {
  source: sourceHierarchy,
  target: targetHierarchy,
  alignment: 'gromov_wasserstein',
  metrics: ['structural_similarity', 'semantic_similarity', 'coverage']
});
```

**Alignments:** `wasserstein`, `gromov_wasserstein`, `tree_edit`, `subtree_isomorphism`

**Returns:** Alignment mapping with similarity metrics and structural correspondences.

### 5. `hyperbolic/entailment-graph`

Build and query entailment graphs using hyperbolic embeddings.

```typescript
const result = await mcp.call('hyperbolic/entailment-graph', {
  action: 'build',
  concepts: [
    { id: 'error', text: 'An error occurred', type: 'event' },
    { id: 'network_error', text: 'Network connection failed', type: 'event' },
    { id: 'timeout', text: 'Request timed out', type: 'event' }
  ],
  entailmentThreshold: 0.7,
  transitiveClosure: true,
  pruneStrategy: 'transitive_reduction'
});
```

**Actions:** `build`, `query`, `expand`, `prune`

**Returns:** Entailment graph with directed edges indicating semantic entailment relationships.

## Configuration Options

```typescript
interface HyperbolicReasoningConfig {
  // Maximum nodes in hierarchy (default: 1000000)
  maxNodes: number;

  // Maximum edges (default: 10000000)
  maxEdges: number;

  // Embedding dimensions (default: 32)
  dimensions: number;

  // Default curvature (default: -1.0)
  curvature: number;

  // Memory limit in bytes (default: 2GB)
  memoryLimit: number;

  // CPU time limit for embedding (default: 300s)
  embeddingTimeout: number;

  // Numerical stability epsilon (default: 1e-10)
  boundaryEpsilon: number;
}
```

## Hyperbolic Geometry Benefits

| Property | Euclidean | Hyperbolic |
|----------|-----------|------------|
| Tree capacity | O(n^d) | O(exp(d)) |
| Hierarchy distortion | High | Low |
| Dimensions needed | Many | Few |
| Parent-child relationship | No natural representation | Radial distance |
| Sibling relationship | No natural representation | Angular distance |

**Dimension Efficiency:** 32-dim hyperbolic embeddings match the quality of 512-dim Euclidean embeddings for hierarchical data (16x memory reduction).

## Performance Targets

| Metric | Target | Improvement vs Euclidean |
|--------|--------|-------------------------|
| Embedding (10K nodes) | <10s | 3x faster |
| Hyperbolic search (1M embeddings) | <5ms | 10x faster |
| Taxonomic query | <10ms | 10x faster than graph traversal |
| Hierarchy comparison (10K nodes) | <1s | 30x faster than tree edit distance |
| Entailment graph (100K concepts) | <30s | 20x faster than pairwise |
| Memory efficiency | 32-dim | 16x less than 512-dim Euclidean |

## Security Considerations

- **Numerical Stability**: Vectors are clipped to stay within Poincare ball boundary (1 - epsilon)
- **Input Validation**: All inputs validated with Zod schemas; hierarchies validated for cycles, excessive depth (max 100), and excessive branching
- **Output Validation**: All hyperbolic outputs validated for numerical sanity (finite values, within ball)
- **DoS Prevention**: Limits on node count (1M), edge count (10M), and embedding timeout (300s)
- **Curvature Bounds**: Curvature restricted to range [-10, -0.01] to prevent numerical issues
- **Cycle Detection**: DAG validation prevents infinite loops in hierarchy traversal

### WASM Security Constraints

| Constraint | Value | Rationale |
|------------|-------|-----------|
| Memory Limit | 2GB max | Handle large hierarchies |
| CPU Time Limit | 300 seconds | Allow complex embedding operations |
| No Network Access | Enforced | Prevent data exfiltration |
| Numerical Epsilon | 1e-10 | Prevent boundary violations |
| Output Validation | All vectors checked | Ensure numerical stability |

### Input Limits

| Constraint | Limit |
|------------|-------|
| Max nodes | 1,000,000 |
| Max edges | 10,000,000 |
| Max dimensions | 512 |
| Max hierarchy depth | 100 |
| Max branching factor | 10,000 |
| CPU time for embedding | 300 seconds |
| Memory limit | 2GB |

### Rate Limits

| Tool | Requests/Minute | Max Concurrent |
|------|-----------------|----------------|
| `embed-hierarchy` | 5 | 1 |
| `taxonomic-reason` | 60 | 5 |
| `semantic-search` | 60 | 5 |
| `hierarchy-compare` | 10 | 2 |
| `entailment-graph` | 10 | 2 |

## Dependencies

- `ruvector-hyperbolic-hnsw-wasm` - Hyperbolic nearest neighbor search
- `ruvector-attention-wasm` - Hyperbolic attention mechanisms
- `ruvector-gnn-wasm` - Hyperbolic graph neural networks
- `micro-hnsw-wasm` - Tangent space approximation search
- `sona` - Adaptive curvature learning

## Mobius Operations

The plugin implements core Mobius operations for the Poincare ball:

```typescript
// Mobius addition: x + y in hyperbolic space
mobius_add(x: Vector, y: Vector, c: number): Vector

// Mobius scalar multiplication
mobius_scalar(r: number, x: Vector, c: number): Vector

// Exponential map: tangent space -> hyperbolic
exp_map(v: Vector, c: number): Vector

// Logarithmic map: hyperbolic -> tangent space
log_map(x: Vector, c: number): Vector

// Hyperbolic distance
hyperbolic_distance(x: Vector, y: Vector, c: number): number
```

## Curvature Learning

The plugin supports learning optimal curvature per hierarchy:

| Hierarchy Type | Typical Curvature |
|----------------|-------------------|
| Flat hierarchy (organization chart) | Low curvature (-0.1) |
| Deep hierarchy (taxonomy) | High curvature (-2.0) |
| Mixed hierarchy | Adaptive via SONA |

## Use Cases

1. **Ontology Navigation**: Efficiently traverse and query large knowledge graphs
2. **Code Hierarchy Understanding**: Model inheritance, module structure, and dependencies
3. **Organizational Analysis**: Understand reporting structures and influence networks
4. **Taxonomic Classification**: Improved classification with hierarchical awareness
5. **Concept Entailment**: Determine semantic relationships between concepts

## Related Plugins

| Plugin | Description | Synergy |
|--------|-------------|---------|
| [@claude-flow/plugin-neural-coordination](https://www.npmjs.com/package/@claude-flow/plugin-neural-coordination) | Multi-agent coordination | Hierarchical embeddings enable efficient agent organization structures |
| [@claude-flow/plugin-cognitive-kernel](https://www.npmjs.com/package/@claude-flow/plugin-cognitive-kernel) | Cognitive augmentation | Hyperbolic memory organization for improved episodic retrieval |
| [@claude-flow/plugin-quantum-optimizer](https://www.npmjs.com/package/@claude-flow/plugin-quantum-optimizer) | Quantum-inspired optimization | Optimizes hierarchical constraint satisfaction and tree operations |

## License

MIT
