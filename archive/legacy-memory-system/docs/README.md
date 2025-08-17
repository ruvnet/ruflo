# SPARC Memory Bank System

## Overview

The SPARC Memory Bank is a sophisticated, distributed memory management system designed for multi-agent collaborative development environments. It provides persistent, searchable, and conflict-resistant storage with advanced features including CRDT-based synchronization, vector search, namespace isolation, and multiple storage backends.

## Key Features

- **Dual Storage Backends**: SQLite for performance, Markdown for human-readability and git integration
- **Advanced Caching**: Multiple eviction strategies with TTL support and performance metrics
- **Vector Search**: Semantic similarity search with embeddings and indexing
- **CRDT Conflict Resolution**: Automatic conflict resolution for concurrent updates
- **Namespace Isolation**: Multi-tenant support with permissions and access control
- **Replication**: Distributed synchronization across multiple instances
- **Import/Export**: Multiple formats with compression and encryption
- **Full-Text Search**: Integrated FTS5 search for SQLite backend

## Quick Start

```typescript
import { MemoryManager } from '@sparc/memory-bank';

// Initialize with SQLite backend
const memory = new MemoryManager({
  backend: 'sqlite',
  storage: { path: './memory.db' },
  cache: { enabled: true, maxSize: 100 * 1024 * 1024 }, // 100MB
  indexing: { vectorSearch: true }
});

// Store a memory item
const item = await memory.store({
  id: 'task-001',
  category: 'implementation',
  content: 'Implemented user authentication system',
  tags: ['auth', 'security', 'backend'],
  metadata: {
    assignee: 'alice',
    priority: 'high',
    completion: 0.8
  }
});

// Query memories
const results = await memory.query({
  category: 'implementation',
  tags: ['auth'],
  fullText: 'authentication',
  limit: 10
});
```

## Documentation Structure

- [Architecture Overview](./architecture.md) - System design and component interactions
- [API Reference](./api.md) - Complete API documentation
- [Usage Guide](./usage.md) - Practical examples and best practices
- [Backends](./backends.md) - Storage backend configuration and capabilities
- [Configuration](./configuration.md) - Complete configuration reference
- [Performance](./performance.md) - Optimization and monitoring
- [Security](./security.md) - Security features and best practices
- [Deployment](./deployment.md) - Production deployment guide
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions

## Installation

```bash
# Using npm
npm install @sparc/memory-bank

# Using deno
import { MemoryManager } from 'https://deno.land/x/sparc_memory@latest/mod.ts';
```

## Core Concepts

### Memory Items

Memory items are the fundamental unit of storage in the SPARC Memory Bank:

```typescript
interface MemoryItem {
  id: string;                           // Unique identifier
  category: string;                     // Logical grouping
  content: string;                      // Main content
  tags: string[];                       // Searchable tags
  namespace?: string;                   // Isolation boundary
  metadata?: Record<string, unknown>;   // Additional data
  embedding?: number[];                 // Vector representation
  version: number;                      // CRDT version
  vectorClock: Record<string, number>;  // Conflict resolution
  created: Date;                        // Creation timestamp
  updated: Date;                        // Last modification
  checksum: string;                     // Integrity verification
}
```

### Backends

**SQLite Backend**: Optimized for performance with FTS5 search, WAL mode, and proper indexing.

**Markdown Backend**: Human-readable storage with git integration for version control and collaboration.

### Caching

Intelligent caching layer with multiple eviction strategies:
- **LRU**: Least Recently Used (default)
- **LFU**: Least Frequently Used
- **FIFO**: First In, First Out
- **TTL**: Time To Live based expiration

### Vector Search

Semantic similarity search using vector embeddings:
- Automatic embedding generation
- Cosine similarity matching
- Configurable similarity thresholds
- Integration with external embedding services

## System Requirements

- **Runtime**: Node.js 18+ or Deno 1.30+
- **Storage**: SQLite 3.38+ (for SQLite backend)
- **Memory**: Minimum 512MB RAM (varies with cache size)
- **Disk**: Variable (depends on data volume and caching)

## License

MIT License - see [LICENSE](../LICENSE) for details.

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development setup and guidelines.

## Support

- **Documentation**: [GitHub Wiki](https://github.com/sparc/memory-bank/wiki)
- **Issues**: [GitHub Issues](https://github.com/sparc/memory-bank/issues)
- **Discussions**: [GitHub Discussions](https://github.com/sparc/memory-bank/discussions)