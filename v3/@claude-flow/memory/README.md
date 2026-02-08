# @claude-flow/memory

[![npm version](https://img.shields.io/npm/v/@claude-flow/memory.svg)](https://www.npmjs.com/package/@claude-flow/memory)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/memory.svg)](https://www.npmjs.com/package/@claude-flow/memory)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Performance](https://img.shields.io/badge/Performance-150x--12500x%20Faster-brightgreen.svg)](https://github.com/ruvnet/claude-flow)

> High-performance memory module for Claude Flow V3 - AgentDB unification, HNSW indexing, vector search, self-learning knowledge graph, and hybrid SQLite+AgentDB backend (ADR-009).

## Features

- **150x-12,500x Faster Search** - HNSW (Hierarchical Navigable Small World) vector index for ultra-fast similarity search
- **Hybrid Backend** - SQLite for structured data + AgentDB for vectors (ADR-009)
- **Auto Memory Bridge** - Bidirectional sync between Claude Code auto memory and AgentDB (ADR-048)
- **Self-Learning** - LearningBridge connects insights to SONA/ReasoningBank neural pipeline (ADR-049)
- **Knowledge Graph** - PageRank + label propagation community detection over memory entries (ADR-049)
- **Agent-Scoped Memory** - 3-scope agent memory (project/local/user) with cross-agent knowledge transfer (ADR-049)
- **Vector Quantization** - Binary, scalar, and product quantization for 4-32x memory reduction
- **Multiple Distance Metrics** - Cosine, Euclidean, dot product, and Manhattan distance
- **Query Builder** - Fluent API for building complex memory queries
- **Cache Manager** - LRU caching with configurable size and TTL
- **Migration Tools** - Seamless migration from V2 memory systems

## Installation

```bash
npm install @claude-flow/memory
```

## Quick Start

```typescript
import { HNSWIndex, AgentDBAdapter, CacheManager } from '@claude-flow/memory';

// Create HNSW index for vector search
const index = new HNSWIndex({
  dimensions: 1536,  // OpenAI embedding size
  M: 16,             // Max connections per node
  efConstruction: 200,
  metric: 'cosine'
});

// Add vectors
await index.addPoint('memory-1', new Float32Array(embedding));
await index.addPoint('memory-2', new Float32Array(embedding2));

// Search for similar vectors
const results = await index.search(queryVector, 10);
// [{ id: 'memory-1', distance: 0.05 }, { id: 'memory-2', distance: 0.12 }]
```

## API Reference

### HNSW Index

```typescript
import { HNSWIndex } from '@claude-flow/memory';

const index = new HNSWIndex({
  dimensions: 1536,
  M: 16,                    // Max connections per layer
  efConstruction: 200,      // Construction-time search depth
  maxElements: 1000000,     // Max vectors
  metric: 'cosine',         // 'cosine' | 'euclidean' | 'dot' | 'manhattan'
  quantization: {           // Optional quantization
    type: 'scalar',         // 'binary' | 'scalar' | 'product'
    bits: 8
  }
});

// Add vectors
await index.addPoint(id: string, vector: Float32Array);

// Search
const results = await index.search(
  query: Float32Array,
  k: number,
  ef?: number  // Search-time depth (higher = more accurate)
);

// Search with filters
const filtered = await index.searchWithFilters(
  query,
  k,
  (id) => id.startsWith('session-')
);

// Remove vectors
await index.removePoint(id);

// Get statistics
const stats = index.getStats();
// { vectorCount, memoryUsage, avgSearchTime, compressionRatio }
```

### AgentDB Adapter

```typescript
import { AgentDBAdapter } from '@claude-flow/memory';

const adapter = new AgentDBAdapter({
  dimension: 1536,
  indexType: 'hnsw',
  metric: 'cosine',
  hnswM: 16,
  hnswEfConstruction: 200,
  enableCache: true,
  cacheSizeMb: 256
});

await adapter.initialize();

// Store memory
await adapter.store({
  id: 'mem-123',
  content: 'User prefers dark mode',
  embedding: vector,
  metadata: { type: 'preference', agentId: 'agent-1' }
});

// Semantic search
const memories = await adapter.search(queryVector, {
  limit: 10,
  threshold: 0.7,
  filter: { type: 'preference' }
});

// Cross-agent memory sharing
await adapter.enableCrossAgentSharing({
  shareTypes: ['patterns', 'preferences'],
  excludeTypes: ['secrets']
});
```

### Cache Manager

```typescript
import { CacheManager } from '@claude-flow/memory';

const cache = new CacheManager({
  maxSize: 1000,
  ttlMs: 3600000,  // 1 hour
  strategy: 'lru'
});

// Cache operations
cache.set('key', value);
const value = cache.get('key');
const exists = cache.has('key');
cache.delete('key');
cache.clear();

// Statistics
const stats = cache.getStats();
// { size, hits, misses, hitRate }
```

### Query Builder

```typescript
import { QueryBuilder } from '@claude-flow/memory';

const results = await new QueryBuilder()
  .semantic(queryVector)
  .where('agentId', '=', 'agent-1')
  .where('type', 'in', ['pattern', 'strategy'])
  .where('createdAt', '>', Date.now() - 86400000)
  .orderBy('relevance', 'desc')
  .limit(20)
  .execute();
```

### Migration

```typescript
import { MemoryMigration } from '@claude-flow/memory';

const migration = new MemoryMigration({
  source: './data/v2-memory.db',
  destination: './data/v3-memory.db'
});

// Dry run
const preview = await migration.preview();
console.log(`Will migrate ${preview.recordCount} records`);

// Execute migration
await migration.execute({
  batchSize: 1000,
  onProgress: (progress) => console.log(`${progress.percent}%`)
});
```

## Quantization Options

```typescript
// Binary quantization (32x compression)
const binaryIndex = new HNSWIndex({
  dimensions: 1536,
  quantization: { type: 'binary' }
});

// Scalar quantization (4x compression)
const scalarIndex = new HNSWIndex({
  dimensions: 1536,
  quantization: { type: 'scalar', bits: 8 }
});

// Product quantization (8x compression)
const productIndex = new HNSWIndex({
  dimensions: 1536,
  quantization: { type: 'product', subquantizers: 8 }
});
```

## Auto Memory Bridge (ADR-048)

Bidirectional sync between Claude Code's [auto memory](https://code.claude.com/docs/en/memory) files and AgentDB. Auto memory is a persistent directory (`~/.claude/projects/<project>/memory/`) where Claude writes learnings as markdown. `MEMORY.md` (first 200 lines) is loaded into the system prompt; topic files are read on demand.

### Quick Start

```typescript
import { AutoMemoryBridge } from '@claude-flow/memory';

const bridge = new AutoMemoryBridge(memoryBackend, {
  workingDir: '/workspaces/my-project',
  syncMode: 'on-session-end', // 'on-write' | 'on-session-end' | 'periodic'
  pruneStrategy: 'confidence-weighted', // 'confidence-weighted' | 'fifo' | 'lru'
});

// Record an insight (stores in AgentDB + optionally writes to files)
await bridge.recordInsight({
  category: 'debugging',
  summary: 'HNSW index requires initialization before search',
  source: 'agent:tester',
  confidence: 0.95,
});

// Sync buffered insights to auto memory files
const syncResult = await bridge.syncToAutoMemory();

// Import existing auto memory files into AgentDB (on session start)
const importResult = await bridge.importFromAutoMemory();

// Curate MEMORY.md index (stays under 200-line limit)
await bridge.curateIndex();

// Check status
const status = bridge.getStatus();
```

### Sync Modes

| Mode | Behavior |
|------|----------|
| `on-write` | Writes to files immediately on `recordInsight()` |
| `on-session-end` | Buffers insights, flushes on `syncToAutoMemory()` |
| `periodic` | Auto-syncs on a configurable interval |

### Insight Categories

| Category | Topic File | Description |
|----------|-----------|-------------|
| `project-patterns` | `patterns.md` | Code patterns and conventions |
| `debugging` | `debugging.md` | Bug fixes and debugging insights |
| `architecture` | `architecture.md` | Design decisions and module relationships |
| `performance` | `performance.md` | Benchmarks and optimization results |
| `security` | `security.md` | Security findings and CVE notes |
| `preferences` | `preferences.md` | User and project preferences |
| `swarm-results` | `swarm-results.md` | Multi-agent swarm outcomes |

### Key Optimizations

- **Batch import** - `bulkInsert()` instead of individual `store()` calls
- **Pre-fetched hashes** - Single query for content-hash dedup during import
- **Async I/O** - `node:fs/promises` for non-blocking writes
- **Exact dedup** - `hasSummaryLine()` uses bullet-prefix matching, not substring
- **O(1) sync tracking** - `syncedInsightKeys` Set prevents double-write race
- **Prune-before-build** - Avoids O(n^2) index rebuild loop

### Utility Functions

```typescript
import {
  resolveAutoMemoryDir,  // Derive auto memory path from working dir
  findGitRoot,           // Walk up to find .git root
  parseMarkdownEntries,  // Parse ## headings into structured entries
  extractSummaries,      // Extract bullet summaries, strip metadata
  formatInsightLine,     // Format insight as markdown bullet
  hashContent,           // SHA-256 truncated to 16 hex chars
  pruneTopicFile,        // Keep topic files under line limit
  hasSummaryLine,        // Exact bullet-prefix dedup check
} from '@claude-flow/memory';
```

### Types

```typescript
import type {
  AutoMemoryBridgeConfig,
  MemoryInsight,
  InsightCategory,
  SyncDirection,
  SyncMode,
  PruneStrategy,
  SyncResult,
  ImportResult,
} from '@claude-flow/memory';
```

## Self-Learning Bridge (ADR-049)

Connects insights to the `@claude-flow/neural` learning pipeline. When neural is unavailable, all operations degrade to no-ops.

### Quick Start

```typescript
import { AutoMemoryBridge, LearningBridge } from '@claude-flow/memory';

const bridge = new AutoMemoryBridge(backend, {
  workingDir: '/workspaces/my-project',
  learning: {
    sonaMode: 'balanced',
    confidenceDecayRate: 0.005,   // Per-hour decay
    accessBoostAmount: 0.03,      // Boost per access
    consolidationThreshold: 10,   // Min insights before consolidation
  },
});

// Insights now trigger learning trajectories automatically
await bridge.recordInsight({
  category: 'debugging',
  summary: 'Connection pool exhaustion on high load',
  source: 'agent:tester',
  confidence: 0.9,
});

// Consolidation runs JUDGE/DISTILL/CONSOLIDATE pipeline
await bridge.syncToAutoMemory(); // Calls consolidate() first
```

### Standalone Usage

```typescript
import { LearningBridge } from '@claude-flow/memory';

const lb = new LearningBridge(backend, {
  // Optional: inject neural loader for custom setups
  neuralLoader: async () => {
    const { NeuralLearningSystem } = await import('@claude-flow/neural');
    return new NeuralLearningSystem();
  },
});

// Boost confidence when insight is accessed
await lb.onInsightAccessed('entry-123'); // +0.03 confidence

// Apply time-based decay
const decayed = await lb.decayConfidences('default'); // -0.005/hour

// Find similar patterns via ReasoningBank
const patterns = await lb.findSimilarPatterns('connection pooling');

// Get learning statistics
const stats = lb.getStats();
// { totalTrajectories, activeTrajectories, completedTrajectories,
//   totalConsolidations, accessBoosts, ... }
```

### Confidence Lifecycle

| Event | Effect | Range |
|-------|--------|-------|
| Insight recorded | Initial confidence from source | 0.1 - 1.0 |
| Insight accessed | +0.03 per access | Capped at 1.0 |
| Time decay | -0.005 per hour since last access | Floored at 0.1 |
| Consolidation | Neural pipeline may adjust | 0.1 - 1.0 |

## Knowledge Graph (ADR-049)

Pure TypeScript knowledge graph with PageRank and community detection. No external graph libraries required.

### Quick Start

```typescript
import { AutoMemoryBridge, MemoryGraph } from '@claude-flow/memory';

const bridge = new AutoMemoryBridge(backend, {
  workingDir: '/workspaces/my-project',
  graph: {
    similarityThreshold: 0.8,
    pageRankDamping: 0.85,
    maxNodes: 5000,
  },
});

// Graph builds automatically on import
await bridge.importFromAutoMemory();

// Curation uses PageRank to prioritize influential insights
await bridge.curateIndex();
```

### Standalone Usage

```typescript
import { MemoryGraph } from '@claude-flow/memory';

const graph = new MemoryGraph({
  pageRankDamping: 0.85,
  pageRankIterations: 50,
  pageRankConvergence: 1e-6,
  maxNodes: 5000,
});

// Build from backend entries
await graph.buildFromBackend(backend, 'my-namespace');

// Or build manually
graph.addNode(entry);
graph.addEdge('entry-1', 'entry-2', 'reference', 1.0);
graph.addEdge('entry-1', 'entry-3', 'similar', 0.9);

// Compute PageRank (power iteration)
const ranks = graph.computePageRank();

// Detect communities (label propagation)
const communities = graph.detectCommunities();

// Graph-aware ranking: blend vector score + PageRank
const ranked = graph.rankWithGraph(searchResults, 0.7);
// alpha=0.7 means 70% vector score + 30% PageRank

// Get most influential insights for MEMORY.md
const topNodes = graph.getTopNodes(20);

// BFS traversal for related insights
const neighbors = graph.getNeighbors('entry-1', 2); // depth=2
```

### Edge Types

| Type | Source | Description |
|------|--------|-------------|
| `reference` | `MemoryEntry.references` | Explicit cross-references between entries |
| `similar` | HNSW search | Auto-created when similarity > threshold |
| `temporal` | Timestamps | Entries created in same time window |
| `co-accessed` | Access patterns | Entries frequently accessed together |
| `causal` | Learning pipeline | Cause-effect relationships |

### Performance

| Operation | Result | Target |
|-----------|--------|--------|
| Graph build (1k nodes) | 2.78 ms | <200 ms |
| PageRank (1k nodes) | 12.21 ms | <100 ms |
| Community detection (1k) | 19.62 ms | — |
| `rankWithGraph(10)` | 0.006 ms | — |
| `getTopNodes(20)` | 0.308 ms | — |
| `getNeighbors(d=2)` | 0.005 ms | — |

## Agent-Scoped Memory (ADR-049)

Maps Claude Code's 3-scope agent memory directories for per-agent knowledge isolation and cross-agent transfer.

### Quick Start

```typescript
import { createAgentBridge, transferKnowledge } from '@claude-flow/memory';

// Create a bridge for a specific agent scope
const agentBridge = createAgentBridge(backend, {
  agentName: 'my-coder',
  scope: 'project', // 'project' | 'local' | 'user'
  workingDir: '/workspaces/my-project',
});

// Record insights scoped to this agent
await agentBridge.recordInsight({
  category: 'debugging',
  summary: 'Use connection pooling for DB calls',
  source: 'agent:my-coder',
  confidence: 0.95,
});

// Transfer high-confidence insights between agents
const result = await transferKnowledge(sourceBackend, targetBridge, {
  sourceNamespace: 'learnings',
  minConfidence: 0.8,   // Only transfer confident insights
  maxEntries: 20,
  categories: ['debugging', 'architecture'],
});
// { transferred: 15, skipped: 5 }
```

### Scope Paths

| Scope | Directory | Use Case |
|-------|-----------|----------|
| `project` | `<gitRoot>/.claude/agent-memory/<agent>/` | Project-specific learnings |
| `local` | `<gitRoot>/.claude/agent-memory-local/<agent>/` | Machine-local data |
| `user` | `~/.claude/agent-memory/<agent>/` | Cross-project user knowledge |

### Utilities

```typescript
import {
  resolveAgentMemoryDir,  // Get scope directory path
  createAgentBridge,       // Create scoped AutoMemoryBridge
  transferKnowledge,       // Cross-agent knowledge sharing
  listAgentScopes,         // Discover existing agent scopes
} from '@claude-flow/memory';

// Resolve path for an agent scope
const dir = resolveAgentMemoryDir('my-agent', 'project');
// → /workspaces/my-project/.claude/agent-memory/my-agent/

// List all agent scopes in a directory
const scopes = await listAgentScopes('/workspaces/my-project');
// [{ agentName: 'coder', scope: 'project', path: '...' }, ...]
```

## Performance Benchmarks

| Operation | V2 Performance | V3 Performance | Improvement |
|-----------|---------------|----------------|-------------|
| Vector Search | 150ms | <1ms | **150x** |
| Bulk Insert | 500ms | 5ms | **100x** |
| Memory Write | 50ms | <5ms | **10x** |
| Cache Hit | 5ms | <0.1ms | **50x** |
| Index Build | 10s | 800ms | **12.5x** |

### ADR-049 Benchmarks

| Operation | Actual | Target | Headroom |
|-----------|--------|--------|----------|
| Graph build (1k nodes) | 2.78 ms | <200 ms | **71.9x** |
| PageRank (1k nodes) | 12.21 ms | <100 ms | **8.2x** |
| Insight recording | 0.12 ms/each | <5 ms/each | **41.0x** |
| Consolidation | 0.26 ms | <500 ms | **1,955x** |
| Confidence decay (1k) | 0.23 ms | <50 ms | **215x** |
| Knowledge transfer | 1.25 ms | <100 ms | **80.0x** |

## TypeScript Types

```typescript
import type {
  // Core
  HNSWConfig, HNSWStats, SearchResult, MemoryEntry,
  QuantizationConfig, DistanceMetric,

  // Auto Memory Bridge (ADR-048)
  AutoMemoryBridgeConfig, MemoryInsight, InsightCategory,
  SyncDirection, SyncMode, PruneStrategy,
  SyncResult, ImportResult,

  // Learning Bridge (ADR-049)
  LearningBridgeConfig, LearningStats,
  ConsolidateResult, PatternMatch,

  // Knowledge Graph (ADR-049)
  MemoryGraphConfig, GraphNode, GraphEdge,
  GraphStats, RankedResult, EdgeType,

  // Agent Scope (ADR-049)
  AgentMemoryScope, AgentScopedConfig,
  TransferOptions, TransferResult,
} from '@claude-flow/memory';
```

## Dependencies

- `agentdb` - Vector database engine
- `better-sqlite3` - SQLite driver (native)
- `sql.js` - SQLite driver (WASM fallback)
- `@claude-flow/neural` - **Optional peer dependency** for self-learning (graceful fallback when unavailable)

## Related Packages

- [@claude-flow/neural](../neural) - Neural learning integration (SONA, ReasoningBank, EWC++)
- [@claude-flow/shared](../shared) - Shared types and utilities
- [@claude-flow/hooks](../hooks) - Session lifecycle hooks for auto memory sync

## License

MIT
