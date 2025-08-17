# SPARC Memory Bank

A sophisticated persistent memory system for Claude-Flow, providing CRDT-based conflict resolution, hybrid storage backends, advanced indexing, and distributed replication capabilities.

## Features

- **Hybrid Storage Backends**: Choose between SQLite for performance or Markdown for human-readability
- **CRDT Conflict Resolution**: Automatic conflict resolution for distributed scenarios
- **Advanced Caching**: LRU, LFU, and FIFO cache strategies with TTL support
- **Vector Search**: Semantic search capabilities with vector embeddings
- **Namespace Isolation**: Session-based memory isolation with fine-grained permissions
- **Replication Support**: Master-slave and peer-to-peer replication modes
- **Time-Travel Queries**: Query historical states with point-in-time recovery
- **Import/Export**: Multiple formats (JSON, Markdown, CSV) with encryption support

## Installation

```bash
npm install @claude-flow/memory
```

## Quick Start

```typescript
import { MemoryManager } from '@claude-flow/memory';

// Initialize with SQLite backend
const memory = new MemoryManager({
  backend: 'sqlite',
  backendConfig: {
    path: './memory.db'
  },
  cacheConfig: {
    maxSize: 1000,
    ttl: 3600000, // 1 hour
    strategy: 'lru'
  }
});

await memory.initialize();

// Store a memory item
await memory.store({
  category: 'knowledge',
  key: 'important-fact',
  value: { data: 'Claude-Flow is awesome!' },
  metadata: {
    tags: ['important', 'claude-flow'],
    confidence: 0.95
  }
});

// Query memory
const results = await memory.query({
  categories: ['knowledge'],
  tags: ['important']
});

// Close when done
await memory.close();
```

## Architecture

### Core Components

1. **Memory Manager**: Central coordinator for all memory operations
2. **Storage Backends**: Pluggable storage implementations (SQLite, Markdown)
3. **Cache Layer**: High-performance caching with multiple eviction strategies
4. **Indexer**: Fast queries and vector search support
5. **Replication Manager**: Distributed memory synchronization
6. **Namespace Manager**: Multi-tenant memory isolation

### Storage Backends

#### SQLite Backend

Optimized for performance with:
- Full-text search using FTS5
- Efficient indexing on all query fields
- Version history for time-travel queries
- ACID compliance with WAL mode

```typescript
const memory = new MemoryManager({
  backend: 'sqlite',
  backendConfig: {
    path: './memory.db',
    wal: true,
    verbose: true
  }
});
```

#### Markdown Backend

Human-readable storage with:
- Organized directory structure
- YAML frontmatter metadata
- Git-friendly format
- Easy manual editing

```typescript
const memory = new MemoryManager({
  backend: 'markdown',
  backendConfig: {
    rootPath: './memory',
    prettyPrint: true,
    gitIntegration: true
  }
});
```

### Cache Strategies

- **LRU (Least Recently Used)**: Evicts least recently accessed items
- **LFU (Least Frequently Used)**: Evicts least frequently accessed items
- **FIFO (First In, First Out)**: Evicts oldest items first

```typescript
const memory = new MemoryManager({
  cacheConfig: {
    maxSize: 1000,      // Maximum items
    ttl: 3600000,       // Time to live (ms)
    strategy: 'lru',    // or 'lfu', 'fifo'
    onEvict: (key, value) => {
      console.log(`Evicted: ${key}`);
    }
  }
});
```

## Advanced Features

### Vector Search

Enable semantic search with vector embeddings:

```typescript
const memory = new MemoryManager({
  enableIndexing: true
});

// Store with embedding
await memory.store({
  category: 'documents',
  key: 'doc1',
  value: 'Machine learning in production',
  vectorEmbedding: [0.1, 0.2, 0.3, ...] // 384 dimensions
});

// Search semantically
const results = await memory.query({
  vectorSearch: {
    embedding: queryEmbedding,
    topK: 10,
    threshold: 0.8
  }
});
```

### Namespaces

Isolate memory by namespace with permissions:

```typescript
// Create namespace
const namespace = await namespaceManager.createNamespace({
  name: 'Project Alpha',
  permissions: {
    read: ['user1', 'user2'],
    write: ['user1'],
    delete: ['admin'],
    admin: ['admin']
  }
});

// Create session
const sessionId = namespaceManager.createSession(
  namespace.id,
  'user1',
  ['read', 'write']
);

// Store in namespace
await memory.store(item, namespace.id);
```

### Replication

Synchronize memory across multiple nodes:

```typescript
const memory = new MemoryManager({
  replicationConfig: {
    mode: 'peer-to-peer',
    nodes: [
      { id: 'node1', url: 'http://node1:3000' },
      { id: 'node2', url: 'http://node2:3000' }
    ],
    syncInterval: 60000,
    conflictResolution: 'last-write-wins'
  }
});

// Manual sync
await replicationManager.syncWithNode('node1');
```

### Time-Travel Queries

Query historical states:

```typescript
// Query as of 1 hour ago
const historicalItems = await memory.query({
  asOf: Date.now() - 3600000
});

// Query time range
const rangeItems = await memory.query({
  startTime: yesterday,
  endTime: today
});
```

### Import/Export

Export memory for backup or migration:

```typescript
const exportManager = new ImportExportManager();

// Export to JSON
const json = await exportManager.export(items, {
  format: 'json',
  includeMetadata: true,
  compress: true,
  encryption: {
    algorithm: 'aes-256-cbc',
    key: 'your-secret-key'
  }
});

// Import from file
const imported = await exportManager.importFromFile('./backup.json', {
  format: 'json',
  compress: true,
  encryption: { ... }
});
```

## CRDT Conflict Resolution

The memory system uses Conflict-free Replicated Data Types (CRDTs) for automatic conflict resolution:

1. **Last-Write-Wins**: Uses vector clocks to determine the most recent update
2. **Deep Merge**: Merges object values when concurrent updates occur
3. **Version Tracking**: Maintains complete version history

```typescript
// Concurrent updates are automatically resolved
const item1 = { id: 'x', value: { a: 1, b: 2 } };
const item2 = { id: 'x', value: { b: 3, c: 4 } };

// Result: { a: 1, b: 3, c: 4 }
```

## Performance Optimization

### Indexing

Indexes are automatically maintained for:
- Categories
- Keys
- Tags
- Namespaces
- Timestamps
- Vector embeddings

### Query Optimization

```typescript
// Efficient queries with multiple filters
const results = await memory.query({
  categories: ['users', 'accounts'],
  tags: ['active', 'premium'],
  namespace: 'production',
  orderBy: 'timestamp',
  orderDirection: 'desc',
  limit: 100,
  offset: 0
});
```

### Batch Operations

```typescript
// Batch import for better performance
await memory.import({
  version: '1.0',
  items: largeArrayOfItems
}, { merge: true });
```

## Testing

Run the comprehensive test suite:

```bash
npm test                 # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

## Examples

See the [examples](./examples) directory for:
- Basic usage
- Advanced querying
- Vector search
- Replication setup
- Custom backends
- Agent coordination

## API Reference

### MemoryManager

- `store(item, namespace?)`: Store a memory item
- `get(category, key, namespace?)`: Retrieve an item
- `query(query)`: Query items with filters
- `delete(category, key, namespace?)`: Delete an item
- `export(options?)`: Export memory snapshot
- `import(snapshot, options?)`: Import memory snapshot
- `getStats()`: Get memory statistics
- `close()`: Close and cleanup

### Types

```typescript
interface MemoryItem {
  id: string;
  category: string;
  key: string;
  value: any;
  metadata?: MemoryMetadata;
  vectorEmbedding?: number[];
  ttl?: number;
}

interface MemoryQuery {
  categories?: string[];
  keys?: string[];
  tags?: string[];
  namespace?: string;
  startTime?: number;
  endTime?: number;
  asOf?: number;
  limit?: number;
  offset?: number;
  orderBy?: 'timestamp' | 'key' | 'category';
  orderDirection?: 'asc' | 'desc';
  vectorSearch?: VectorSearchOptions;
  filter?: (item: MemoryItem) => boolean;
}
```

## Contributing

Contributions are welcome! Please read the contributing guidelines and submit pull requests.

## License

MIT License - see LICENSE file for details.

---

Created by **rUv** - [github.com/ruvnet](https://github.com/ruvnet)