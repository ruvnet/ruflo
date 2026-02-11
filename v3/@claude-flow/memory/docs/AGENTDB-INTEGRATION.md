# AgentDB Integration Guide

## Overview

The V3 memory module now integrates with **agentdb@2.0.0-alpha.3.4** to provide high-performance vector search capabilities with HNSW indexing (optimized than brute-force approaches).

## Features

### AgentDBBackend

The `AgentDBBackend` class provides:

- **HNSW Vector Search**: Approximate nearest neighbor search with sub-millisecond query times
- **Graceful Fallback**: Works without native dependencies (hnswlib-node)
- **Optional Dependency Handling**: Automatically falls back to pure JavaScript/WASM if native bindings unavailable
- **Hybrid Integration**: Seamlessly works with `HybridBackend` for combined SQLite + AgentDB queries

### Performance Targets

Based on ADR-006 and ADR-009:

- **HNSW-indexed** faster vector search compared to brute-force
- **Sub-millisecond** query latency for k-NN search
- **Automatic backend selection**: Native hnswlib → ruvector → WASM fallback

## Installation

```bash
# Core package (required)
npm install agentdb@2.0.0-alpha.3.4

# Optional native dependencies for maximum performance
npm install hnswlib-node@^3.0.0 better-sqlite3@^11.0.0
```

## Usage

### Basic Setup

```typescript
import { AgentDBBackend } from '@claude-flow/memory';

const backend = new AgentDBBackend({
  dbPath: './data/memory.db',
  namespace: 'default',
  vectorDimension: 1536, // For OpenAI embeddings
  hnswM: 16,
  hnswEfConstruction: 200,
  hnswEfSearch: 100,
  embeddingGenerator: async (text) => {
    // Your embedding function
    return embeddings.embed(text);
  },
});

await backend.initialize();
```

### Hybrid Backend (Recommended)

Per ADR-009, the recommended approach is to use `HybridBackend`:

```typescript
import { HybridBackend } from '@claude-flow/memory';

const memory = new HybridBackend({
  // SQLite for structured queries
  sqlite: {
    dbPath: './data/memory-sqlite.db',
  },

  // AgentDB for vector search
  agentdb: {
    dbPath: './data/memory-agentdb.db',
    vectorDimension: 1536,
    hnswM: 16,
    hnswEfConstruction: 200,
  },

  embeddingGenerator: embedFn,
  dualWrite: true, // Write to both backends
});

await memory.initialize();

// Structured queries go to SQLite
const user = await memory.getByKey('users', 'john@example.com');

// Semantic queries go to AgentDB (150x faster)
const similar = await memory.querySemantic({
  content: 'authentication patterns',
  k: 10,
  threshold: 0.7,
});

// Hybrid queries combine both
const results = await memory.queryHybrid({
  semantic: { content: 'security vulnerabilities', k: 20 },
  structured: { namespace: 'security', createdAfter: Date.now() - 86400000 },
  combineStrategy: 'intersection',
});
```

### Semantic Search

```typescript
// Store entries with embeddings
await backend.store({
  id: 'entry-1',
  key: 'auth-patterns',
  content: 'OAuth 2.0 implementation patterns for secure authentication',
  embedding: await embedFn('OAuth 2.0 implementation patterns...'),
  // ... other fields
});

// Semantic search by content
const results = await backend.query({
  type: 'semantic',
  content: 'user authentication best practices',
  limit: 10,
  threshold: 0.8,
});

// Or search with pre-computed embedding
const results = await backend.search(
  queryEmbedding,
  { k: 10, threshold: 0.7 }
);
```

### Query Routing

The `HybridBackend` automatically routes queries to the optimal backend:

```typescript
// Exact match → SQLite
await memory.query({ type: 'exact', namespace: 'users', key: 'john@example.com' });

// Prefix search → SQLite (indexed)
await memory.query({ type: 'prefix', keyPrefix: 'auth-' });

// Semantic search → AgentDB (HNSW)
await memory.query({ type: 'semantic', content: 'security patterns', limit: 10 });

// Hybrid → Both backends with intelligent merging
await memory.query({ type: 'hybrid', content: 'patterns', namespace: 'security' });
```

## Configuration Options

### AgentDBBackendConfig

```typescript
interface AgentDBBackendConfig {
  /** Database path (default: ':memory:') */
  dbPath?: string;

  /** Namespace for memory organization */
  namespace?: string;

  /** Force WASM backend (skip native hnswlib) */
  forceWasm?: boolean;

  /** Vector backend: 'auto', 'ruvector', 'hnswlib' */
  vectorBackend?: 'auto' | 'ruvector' | 'hnswlib';

  /** Vector dimensions (default: 1536) */
  vectorDimension?: number;

  /** HNSW M parameter (connections per layer, default: 16) */
  hnswM?: number;

  /** HNSW efConstruction (build quality, default: 200) */
  hnswEfConstruction?: number;

  /** HNSW efSearch (search quality, default: 100) */
  hnswEfSearch?: number;

  /** Enable caching */
  cacheEnabled?: boolean;

  /** Embedding generator function */
  embeddingGenerator?: EmbeddingGenerator;

  /** Maximum entries */
  maxEntries?: number;
}
```

### HNSW Tuning

- **M (16-64)**: Higher = better recall, more memory
  - 16: Fast, less memory (recommended for most cases)
  - 32: Balanced
  - 64: High recall, more memory

- **efConstruction (100-400)**: Build time vs. quality
  - 100: Fast build, lower quality
  - 200: Balanced (recommended)
  - 400: Slow build, high quality

- **efSearch (50-200)**: Search time vs. recall
  - 50: Fast search, lower recall
  - 100: Balanced (recommended)
  - 200: Slower search, high recall

## Graceful Degradation

The backend handles missing dependencies gracefully:

```typescript
// 1. Try native hnswlib (fastest)
// 2. Fallback to ruvector (fast, pure JS)
// 3. Fallback to WASM (compatible)
// 4. Fallback to in-memory brute-force (always works)

const backend = new AgentDBBackend();
await backend.initialize();

// Check availability
if (backend.isAvailable()) {
  console.log('Using AgentDB with HNSW');
} else {
  console.log('Using fallback in-memory storage');
}
```

## Performance Metrics

### Benchmarks (from agentdb@2.0.0-alpha.3.4)

| Operation | Brute Force | HNSW (hnswlib) | Speedup |
|-----------|-------------|----------------|---------|
| 10k vectors, k=10 | 150ms | 1ms | 150x |
| 100k vectors, k=10 | 1500ms | 2ms | 750x |
| 1M vectors, k=10 | 15000ms | 3ms | 5000x |

### Memory Usage

- **No quantization**: ~4 bytes per dimension per vector
- **8-bit quantization**: ~1 byte per dimension (4x reduction)
- **4-bit quantization**: ~0.5 bytes per dimension (8x reduction)

## Advanced Features

### Vector Quantization

```typescript
const backend = new AgentDBBackend({
  // Enable quantization for 50-75% memory reduction
  quantization: {
    type: 'scalar',
    bits: 8, // 4, 8, or 16
  },
});
```

### Custom Distance Metrics

```typescript
const backend = new AgentDBBackend({
  vectorBackend: 'hnswlib',
  distanceMetric: 'cosine', // 'cosine', 'euclidean', 'dot'
});
```

### Health Monitoring

```typescript
const health = await backend.healthCheck();

console.log(health.status); // 'healthy' | 'degraded' | 'unhealthy'
console.log(health.components.index); // HNSW index health

if (health.status === 'degraded') {
  console.log('Issues:', health.issues);
  console.log('Recommendations:', health.recommendations);
}
```

### Statistics

```typescript
const stats = await backend.getStats();

console.log('Total entries:', stats.totalEntries);
console.log('Avg query time:', stats.avgQueryTime, 'ms');
console.log('Avg search time:', stats.avgSearchTime, 'ms');

if (stats.hnswStats) {
  console.log('HNSW vectors:', stats.hnswStats.vectorCount);
  console.log('HNSW build time:', stats.hnswStats.buildTime, 'ms');
}
```

## Migration from Legacy Systems

The memory module includes migration support for legacy systems:

```typescript
import { MemoryMigrator } from '@claude-flow/memory';

const migrator = new MemoryMigrator(
  backend,
  {
    source: 'memory-manager',
    sourcePath: './old-memory.json',
    batchSize: 1000,
  },
  embeddingGenerator
);

const result = await migrator.migrate();

console.log('Migrated:', result.totalMigrated);
console.log('Failed:', result.totalFailed);
```

## Troubleshooting

### AgentDB not available

```
AgentDB not available. Install agentdb@2.0.0-alpha.3.4 for vector search support.
```

**Solution**: Install agentdb:
```bash
npm install agentdb@2.0.0-alpha.3.4
```

### Native bindings failed

```
Failed to load hnswlib-node, falling back to WASM
```

**Solution**: This is normal. The system automatically falls back to WASM. For maximum performance, install build tools:

```bash
# Ubuntu/Debian
sudo apt-get install build-essential python3

# macOS
xcode-select --install

# Then reinstall
npm install hnswlib-node@^3.0.0
```

### Force WASM backend

```typescript
const backend = new AgentDBBackend({
  forceWasm: true, // Skip native bindings
});
```

## Testing

```bash
# Run AgentDB backend tests
npm test -- agentdb-backend.test.ts

# Run all memory tests
npm test

# Run benchmarks
npm run bench
```

## Architecture Decision Records

This integration implements:

- **ADR-006**: Unified Memory Service with AgentDB
- **ADR-009**: Hybrid Memory Backend (SQLite + AgentDB) as default

## Related Documentation

- [AgentDB GitHub](https://github.com/ruvnet/agentic-flow/tree/main/packages/agentdb)
- [HNSW Algorithm Paper](https://arxiv.org/abs/1603.09320)
- [V3 Memory Architecture](./README.md)
- [HybridBackend Documentation](./docs/hybrid-backend.md)

## License

MIT
