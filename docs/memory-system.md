# Memory System

Comprehensive guide to Claude-Flow's advanced memory management system, featuring persistent storage, vector search, and intelligent conflict resolution.

## Overview

The Claude-Flow memory system provides sophisticated, persistent memory capabilities for AI agents, enabling them to:

- **Store and Retrieve Information**: Persistent storage across sessions
- **Semantic Search**: Vector-based similarity search for contextual retrieval
- **Collaborative Memory**: Shared memory spaces with conflict resolution
- **Structured Storage**: Organized by categories, namespaces, and metadata
- **Intelligent Caching**: Multi-layer caching for optimal performance

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Memory Manager                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Query Layer   │  │   Cache Layer   │  │   Index Layer   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ CRDT Sync Layer │  │ Vector Search   │  │ Full-text Search│ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│              Storage Backends (SQLite/Markdown)                │
└─────────────────────────────────────────────────────────────────┘
```

## Storage Backends

### SQLite Backend

High-performance relational storage with ACID compliance:

```json
{
  "memory": {
    "backend": "sqlite",
    "backends": {
      "sqlite": {
        "path": "./data/memory.db",
        "options": {
          "journalMode": "WAL",
          "synchronous": "NORMAL",
          "cacheSize": 10000,
          "maxConnections": 20,
          "enableFTS": true,
          "enableVector": true
        }
      }
    }
  }
}
```

**Features:**
- ACID transactions
- Full-text search (FTS5)
- Vector storage support
- Connection pooling
- WAL mode for concurrency

### Markdown Backend

Human-readable storage with git integration:

```json
{
  "memory": {
    "backend": "markdown",
    "backends": {
      "markdown": {
        "path": "./data/memory-docs",
        "options": {
          "useNamespaceDirectories": true,
          "useCategoryDirectories": true,
          "gitEnabled": true,
          "gitAutoCommit": true,
          "fileNaming": "timestamp"
        }
      }
    }
  }
}
```

**Features:**
- Human-readable files
- Git version control
- Hierarchical organization
- YAML frontmatter
- Collaborative editing

### Hybrid Backend

Combines both backends for optimal performance and flexibility:

```json
{
  "memory": {
    "backend": "hybrid",
    "hybridStrategy": {
      "primary": "sqlite",
      "secondary": "markdown",
      "syncStrategy": "bidirectional",
      "syncInterval": 30000
    }
  }
}
```

## Memory Operations

### Storing Information

Store memories with rich metadata:

```bash
# Simple memory storage
claude-flow memory store \
  --category "research" \
  --content "Claude-3 shows significant improvements in reasoning capabilities" \
  --tags "ai,claude,reasoning"

# Advanced storage with metadata
claude-flow memory store \
  --category "implementation" \
  --content "Implemented OAuth2 authentication with PKCE flow" \
  --tags "auth,oauth,security" \
  --namespace "project-alpha" \
  --metadata '{"assignee":"alice","priority":"high","sprint":"3"}'
```

**Programmatic API:**

```typescript
import { MemoryManager } from 'claude-flow';

const memory = new MemoryManager(config);

// Store a memory
const item = await memory.store({
  category: 'research',
  content: 'Deep learning models benefit from attention mechanisms',
  tags: ['deep-learning', 'attention', 'transformers'],
  namespace: 'ai-research',
  metadata: {
    source: 'research-paper',
    confidence: 0.95,
    author: 'research-agent'
  }
});

console.log('Stored memory:', item.id);
```

### Retrieving Information

Multiple retrieval methods for different use cases:

```bash
# Retrieve by ID
claude-flow memory get memory_1704123456789

# Query by criteria
claude-flow memory query \
  --category research \
  --tags "ai,claude" \
  --since "2024-01-01" \
  --limit 10

# Semantic search
claude-flow memory search \
  --text "machine learning optimization techniques" \
  --similarity-threshold 0.7 \
  --limit 5
```

**Programmatic API:**

```typescript
// Direct retrieval
const item = await memory.retrieve('memory_1704123456789');

// Query with filters
const researchItems = await memory.query({
  category: 'research',
  tags: ['ai', 'claude'],
  dateRange: {
    start: new Date('2024-01-01'),
    field: 'created'
  },
  limit: 10
});

// Vector similarity search
const similarItems = await memory.vectorSearch({
  text: 'natural language processing techniques',
  threshold: 0.7,
  limit: 5,
  namespace: 'ai-research'
});
```

### Advanced Querying

The memory system supports sophisticated queries:

```typescript
// Complex query with multiple criteria
const results = await memory.query({
  categories: ['research', 'analysis'],
  tags: ['ai'],
  fullText: 'machine learning',
  dateRange: {
    start: new Date('2024-01-01'),
    end: new Date('2024-12-31'),
    field: 'updated'
  },
  metadata: {
    priority: 'high',
    status: 'completed'
  },
  sortBy: 'updated',
  sortOrder: 'desc',
  limit: 20
});

// Faceted search
const facets = await memory.getFacets({
  categories: true,
  tags: true,
  metadata: ['priority', 'status'],
  timeRanges: true
});
```

## Vector Search

### Semantic Similarity

Claude-Flow uses vector embeddings for semantic search:

```json
{
  "memory": {
    "indexing": {
      "vectorSearch": {
        "enabled": true,
        "dimensions": 1536,
        "algorithm": "hnsw",
        "embeddingService": {
          "provider": "openai",
          "model": "text-embedding-ada-002",
          "apiKey": "${OPENAI_API_KEY}",
          "batchSize": 100,
          "timeout": 30000
        },
        "similarity": {
          "metric": "cosine",
          "threshold": 0.7
        }
      }
    }
  }
}
```

### Embedding Generation

Automatic embedding generation for all stored content:

```bash
# Generate embeddings for existing memories
claude-flow memory embed --regenerate --batch-size 50

# Check embedding status
claude-flow memory stats --embeddings
```

### Similarity Search Examples

```typescript
// Find similar content
const similar = await memory.vectorSearch({
  text: 'neural network architecture optimization',
  threshold: 0.8,
  limit: 10,
  includeScores: true
});

// Use existing memory as query
const relatedMemories = await memory.vectorSearch({
  referenceId: 'memory_1704123456789',
  threshold: 0.75,
  excludeReference: true
});

// Search within specific context
const contextualResults = await memory.vectorSearch({
  text: 'database optimization',
  context: {
    category: 'implementation',
    namespace: 'backend-services',
    tags: ['performance']
  },
  limit: 5
});
```

## Namespace Management

### Namespace Isolation

Organize memories into isolated namespaces:

```json
{
  "memory": {
    "namespaces": {
      "enabled": true,
      "defaultNamespace": "default",
      "isolation": "strict",
      "permissions": {
        "project-alpha": {
          "read": ["agent-1", "agent-2"],
          "write": ["agent-1"],
          "admin": ["coordinator"]
        },
        "research": {
          "read": ["*"],
          "write": ["research-agents"],
          "public": true
        }
      },
      "quotas": {
        "project-alpha": {
          "maxItems": 10000,
          "maxSizeMB": 100
        },
        "research": {
          "maxItems": 50000,
          "maxSizeMB": 500
        }
      }
    }
  }
}
```

### Namespace Operations

```bash
# List namespaces
claude-flow memory namespace list

# Create namespace
claude-flow memory namespace create research-2024 \
  --description "Research memories for 2024" \
  --quota-items 20000 \
  --quota-size 200

# Set permissions
claude-flow memory namespace permissions research-2024 \
  --read "research-team" \
  --write "senior-researchers" \
  --admin "research-lead"

# Query specific namespace
claude-flow memory query --namespace research-2024 --category findings
```

## Conflict Resolution

### CRDT-Based Synchronization

Claude-Flow uses Conflict-free Replicated Data Types (CRDTs) for automatic conflict resolution:

```json
{
  "memory": {
    "sync": {
      "enabled": true,
      "conflictResolution": "crdt",
      "strategy": "last-writer-wins-with-merge",
      "vectorClock": true,
      "merkleTree": true
    }
  }
}
```

### Conflict Resolution Strategies

1. **Last Writer Wins (LWW)**: Simple timestamp-based resolution
2. **CRDT Merge**: Intelligent merging based on vector clocks
3. **Manual Resolution**: Human intervention for complex conflicts
4. **Custom Rules**: User-defined resolution logic

```typescript
// Handle conflicts manually
memory.onConflict(async (local, remote, metadata) => {
  if (metadata.priority === 'high') {
    // Always prefer high-priority updates
    return remote;
  }
  
  if (local.updated > remote.updated) {
    return local;
  }
  
  // Merge content intelligently
  return {
    ...remote,
    content: mergeContent(local.content, remote.content),
    tags: [...new Set([...local.tags, ...remote.tags])],
    metadata: { ...local.metadata, ...remote.metadata }
  };
});
```

## Caching System

### Multi-Layer Caching

Intelligent caching for optimal performance:

```json
{
  "memory": {
    "cache": {
      "enabled": true,
      "layers": {
        "l1": {
          "type": "memory",
          "maxSizeMB": 50,
          "strategy": "lru",
          "ttl": 300000
        },
        "l2": {
          "type": "disk",
          "maxSizeMB": 200,
          "strategy": "lfu",
          "ttl": 3600000,
          "compression": true
        }
      },
      "strategies": {
        "adaptive": {
          "enabled": true,
          "learningRate": 0.1,
          "performanceThreshold": 100
        },
        "prefetching": {
          "enabled": true,
          "patterns": ["sequential", "categorical"],
          "lookahead": 5
        }
      }
    }
  }
}
```

### Cache Management

```bash
# View cache statistics
claude-flow memory cache stats

# Clear cache
claude-flow memory cache clear --layer l1

# Optimize cache
claude-flow memory cache optimize

# Preload cache
claude-flow memory cache preload --category research --namespace project-alpha
```

## Full-Text Search

### Advanced Text Search

Powerful full-text search capabilities:

```json
{
  "memory": {
    "indexing": {
      "fullTextSearch": {
        "enabled": true,
        "language": "english",
        "features": {
          "stemming": true,
          "stopWords": true,
          "fuzzySearch": true,
          "highlighting": true,
          "ranking": "bm25"
        },
        "customDictionary": "./dictionaries/technical-terms.txt"
      }
    }
  }
}
```

### Search Examples

```bash
# Basic text search
claude-flow memory search --text "machine learning algorithms"

# Advanced search with operators
claude-flow memory search --text "neural AND network NOT simple" --fuzzy

# Search with filters
claude-flow memory search \
  --text "optimization techniques" \
  --category "implementation" \
  --tags "performance" \
  --highlight
```

```typescript
// Programmatic text search
const results = await memory.fullTextSearch('deep learning', {
  categories: ['research', 'analysis'],
  fuzzy: true,
  highlight: true,
  limit: 20,
  minScore: 0.5
});

// Advanced search with ranking
const rankedResults = await memory.fullTextSearch({
  query: 'machine learning optimization',
  fields: ['content', 'tags'],
  boost: {
    content: 1.0,
    tags: 2.0,
    title: 1.5
  },
  filters: {
    category: 'research',
    metadata: {
      verified: true
    }
  }
});
```

## Memory Analytics

### Usage Statistics

Comprehensive analytics and insights:

```bash
# Memory usage statistics
claude-flow memory stats

# Detailed analytics
claude-flow memory analytics \
  --breakdown category,namespace \
  --timerange "last-30-days" \
  --format json

# Growth analysis
claude-flow memory growth \
  --period daily \
  --start "2024-01-01" \
  --metrics items,size,categories
```

### Performance Monitoring

```typescript
// Monitor memory performance
const monitor = new MemoryMonitor(memory);

monitor.on('slowQuery', (query, duration) => {
  console.log(`Slow query detected: ${duration}ms`, query);
});

monitor.on('cacheHitRate', (rate) => {
  if (rate < 0.8) {
    console.log(`Low cache hit rate: ${rate}`);
  }
});

// Performance metrics
const metrics = await memory.getPerformanceMetrics();
console.log({
  averageQueryTime: metrics.averageQueryTime,
  cacheHitRate: metrics.cacheHitRate,
  throughput: metrics.operationsPerSecond
});
```

## Data Import/Export

### Backup and Restore

```bash
# Export memories
claude-flow memory export backup.json \
  --format json \
  --include-vectors \
  --compress

# Export specific data
claude-flow memory export research-backup.json \
  --category research \
  --namespace project-alpha \
  --since "2024-01-01"

# Import memories
claude-flow memory import backup.json \
  --format json \
  --merge-strategy "update" \
  --validate

# Restore from backup
claude-flow memory restore backup.json \
  --namespace project-alpha \
  --overwrite
```

### Migration Between Backends

```bash
# Migrate from SQLite to Markdown
claude-flow memory migrate \
  --from sqlite \
  --to markdown \
  --preserve-ids \
  --include-vectors

# Validate migration
claude-flow memory migrate-verify \
  --source ./data/memory.db \
  --target ./data/memory-docs
```

## Advanced Features

### Custom Indexing

Define custom indexes for specific query patterns:

```json
{
  "memory": {
    "indexing": {
      "customIndexes": [
        {
          "name": "priority_status_index",
          "fields": ["metadata.priority", "metadata.status"],
          "type": "composite"
        },
        {
          "name": "content_vector_index",
          "fields": ["content"],
          "type": "vector",
          "algorithm": "hnsw"
        }
      ]
    }
  }
}
```

### Memory Plugins

Extend functionality with plugins:

```typescript
// Custom memory plugin
class SemanticEnhancementPlugin implements MemoryPlugin {
  async beforeStore(item: MemoryItem): Promise<MemoryItem> {
    // Enhance content with semantic annotations
    item.metadata.semanticEntities = await this.extractEntities(item.content);
    item.metadata.sentiment = await this.analyzeSentiment(item.content);
    return item;
  }
  
  async afterStore(item: MemoryItem): Promise<void> {
    // Update knowledge graph
    await this.updateKnowledgeGraph(item);
  }
}

// Register plugin
memory.addPlugin(new SemanticEnhancementPlugin());
```

### Memory Workflows

Automate memory operations with workflows:

```json
{
  "memory": {
    "workflows": {
      "researchProcess": {
        "triggers": ["category:research"],
        "steps": [
          {
            "action": "generateSummary",
            "conditions": ["content.length > 1000"]
          },
          {
            "action": "extractKeywords",
            "parameters": {"maxKeywords": 10}
          },
          {
            "action": "linkRelated",
            "parameters": {"threshold": 0.8}
          }
        ]
      }
    }
  }
}
```

## Best Practices

### Performance Optimization

1. **Use Appropriate Backends**: SQLite for performance, Markdown for collaboration
2. **Configure Caching**: Tune cache sizes based on available memory
3. **Index Strategy**: Create indexes for frequent query patterns
4. **Batch Operations**: Use batch operations for bulk data
5. **Query Optimization**: Use specific filters to reduce result sets

### Data Organization

1. **Consistent Categories**: Use standardized category names
2. **Meaningful Tags**: Create descriptive, searchable tags
3. **Structured Metadata**: Keep metadata flat and queryable
4. **Namespace Design**: Plan namespace hierarchy carefully
5. **Content Quality**: Store high-quality, relevant information

### Security Considerations

1. **Access Control**: Use namespace permissions effectively
2. **Data Encryption**: Enable encryption for sensitive data
3. **Audit Logging**: Track access and modifications
4. **Backup Security**: Secure backup storage and transmission
5. **Input Validation**: Validate all stored content

### Troubleshooting

Common issues and solutions:

```bash
# Check memory system health
claude-flow memory health

# Repair corrupted data
claude-flow memory repair --fix-checksums --rebuild-indexes

# Optimize performance
claude-flow memory optimize --vacuum --reindex

# Debug query performance
claude-flow memory debug-query --explain --profile
```

This comprehensive memory system guide covers all aspects of Claude-Flow's advanced memory capabilities, from basic storage to sophisticated semantic search and collaborative memory management.