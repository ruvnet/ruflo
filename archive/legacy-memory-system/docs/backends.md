# Storage Backends

SPARC Memory Bank supports multiple storage backends, each optimized for different use cases and requirements.

## SQLite Backend

The SQLite backend provides high-performance, ACID-compliant storage with advanced indexing and full-text search capabilities.

### Features

- **ACID Transactions**: Full transaction support with rollback capabilities
- **WAL Mode**: Write-Ahead Logging for better concurrent access
- **FTS5 Search**: Full-text search with ranking and highlighting
- **Vector Storage**: Efficient storage and retrieval of embeddings
- **Connection Pooling**: Multiple concurrent connections
- **Automatic Optimization**: VACUUM and ANALYZE operations

### Configuration

```typescript
const sqliteConfig = {
  backend: 'sqlite',
  storage: {
    path: './memory.db',
    options: {
      // SQLite-specific options
      journalMode: 'WAL',           // WAL, DELETE, TRUNCATE, PERSIST, MEMORY, OFF
      synchronous: 'NORMAL',        // OFF, NORMAL, FULL, EXTRA
      cacheSize: 2000,              // Number of pages in cache
      tempStore: 'MEMORY',          // MEMORY, FILE, DEFAULT
      mmapSize: 268435456,          // Memory-mapped I/O size (256MB)
      pageSize: 4096,               // Database page size
      autoVacuum: 'INCREMENTAL',    // NONE, FULL, INCREMENTAL
      foreignKeys: true,            // Enable foreign key constraints
      
      // Connection pool settings
      maxConnections: 10,           // Maximum concurrent connections
      idleTimeout: 60000,           // Idle connection timeout (ms)
      busyTimeout: 30000,           // Busy timeout (ms)
      
      // Full-text search settings
      ftsTokenizer: 'unicode61',    // Tokenizer for FTS5
      ftsRankFunction: 'bm25',      // Ranking function
      
      // Performance tuning
      enableWalCheckpoint: true,    // Automatic WAL checkpointing
      walCheckpointInterval: 300000, // Checkpoint interval (5 minutes)
      pragmaOptimize: true,         // Run PRAGMA optimize periodically
    }
  }
};
```

### Schema Design

The SQLite backend uses an optimized schema for memory storage:

```sql
-- Main table for memory items
CREATE TABLE memory_items (
    id TEXT PRIMARY KEY NOT NULL,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT NOT NULL, -- JSON array
    namespace TEXT,
    metadata TEXT, -- JSON object
    embedding BLOB, -- Vector data as binary
    version INTEGER NOT NULL DEFAULT 1,
    vector_clock TEXT NOT NULL, -- JSON object
    created INTEGER NOT NULL, -- Unix timestamp
    updated INTEGER NOT NULL, -- Unix timestamp
    checksum TEXT NOT NULL,
    
    -- Constraints
    CHECK (version > 0),
    CHECK (created > 0),
    CHECK (updated >= created),
    CHECK (length(checksum) = 64) -- SHA-256 hex
);

-- Indexes for optimal query performance
CREATE INDEX idx_memory_category ON memory_items(category);
CREATE INDEX idx_memory_namespace ON memory_items(namespace);
CREATE INDEX idx_memory_created ON memory_items(created DESC);
CREATE INDEX idx_memory_updated ON memory_items(updated DESC);
CREATE INDEX idx_memory_version ON memory_items(version);
CREATE INDEX idx_memory_category_namespace ON memory_items(category, namespace);

-- JSON indexes for metadata queries (SQLite 3.45+)
CREATE INDEX idx_memory_metadata_status ON memory_items(json_extract(metadata, '$.status'));
CREATE INDEX idx_memory_metadata_priority ON memory_items(json_extract(metadata, '$.priority'));

-- Full-text search virtual table
CREATE VIRTUAL TABLE memory_fts USING fts5(
    content,
    tags,
    category,
    
    -- Configuration
    content='memory_items',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
);

-- Triggers to maintain FTS index
CREATE TRIGGER memory_fts_insert AFTER INSERT ON memory_items
BEGIN
    INSERT INTO memory_fts(rowid, content, tags, category)
    VALUES (NEW.rowid, NEW.content, NEW.tags, NEW.category);
END;

CREATE TRIGGER memory_fts_update AFTER UPDATE ON memory_items
BEGIN
    UPDATE memory_fts
    SET content = NEW.content, tags = NEW.tags, category = NEW.category
    WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER memory_fts_delete AFTER DELETE ON memory_items
BEGIN
    DELETE FROM memory_fts WHERE rowid = OLD.rowid;
END;

-- Vector similarity functions (requires sqlite-vss extension)
CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors USING vss0(
    embedding(1536), -- OpenAI embedding dimensions
    metadata TEXT
);
```

### Performance Characteristics

| Operation | Time Complexity | Notes |
|-----------|----------------|-------|
| Store | O(log n) | Index updates |
| Retrieve by ID | O(1) | Primary key lookup |
| Query by category | O(log n) | Index scan |
| Full-text search | O(k log n) | FTS5 with ranking |
| Vector search | O(k log n) | With vss extension |
| Batch operations | O(n log n) | Transaction batching |

### Optimization Tips

```typescript
// Enable performance monitoring
const memory = new MemoryManager({
  backend: 'sqlite',
  storage: {
    path: './optimized.db',
    options: {
      // Optimize for read-heavy workloads
      journalMode: 'WAL',
      synchronous: 'NORMAL',
      cacheSize: 10000, // Larger cache
      mmapSize: 1073741824, // 1GB memory mapping
      
      // Connection pooling for concurrent access
      maxConnections: 20,
      
      // Regular maintenance
      pragmaOptimize: true,
      enableWalCheckpoint: true,
      walCheckpointInterval: 60000 // More frequent checkpoints
    }
  }
});

// Monitor query performance
const stats = await memory.getStatistics();
if (stats.performance.averageQueryTime > 50) {
  console.warn('Consider adding indexes or optimizing queries');
}
```

## Markdown Backend

The Markdown backend provides human-readable storage with git integration for version control and collaboration.

### Features

- **Human-Readable**: Files can be edited directly in any text editor
- **Git Integration**: Full version control with git repositories
- **Hierarchical Organization**: Directory structure mirrors data organization
- **YAML Frontmatter**: Structured metadata in standard format
- **Cross-Platform**: Works on any filesystem
- **Backup-Friendly**: Easy to backup and restore

### Configuration

```typescript
const markdownConfig = {
  backend: 'markdown',
  storage: {
    path: './memory',
    options: {
      // Directory structure
      useNamespaceDirectories: true,    // Create dirs for namespaces
      useCategoryDirectories: true,     // Create dirs for categories
      useTimeBasedDirectories: true,    // Create YYYY/MM dirs
      
      // File naming
      fileNaming: 'timestamp',          // 'id', 'timestamp', 'slug'
      slugify: true,                    // Create URL-friendly filenames
      maxFilenameLength: 100,           // Truncate long filenames
      
      // Content formatting
      frontmatterFormat: 'yaml',        // 'yaml', 'toml', 'json'
      contentFormat: 'markdown',        // 'markdown', 'text', 'html'
      includeTableOfContents: false,    // Generate TOC
      
      // Git integration
      gitEnabled: true,                 // Enable git operations
      gitAutoCommit: true,              // Auto-commit changes
      gitCommitMessage: 'Update memory: {id}', // Commit message template
      gitBranch: 'main',                // Target branch
      
      // Performance
      cacheDirectory: './.cache',       // Cache parsed files
      watchForChanges: true,            // Watch for external changes
      rebuildIndexInterval: 300000,     // Rebuild index every 5 minutes
      
      // Cleanup
      enableGarbageCollection: true,    // Remove orphaned files
      garbageCollectionInterval: 86400000, // Daily cleanup
    }
  }
};
```

### Directory Structure

The Markdown backend organizes files in a hierarchical structure:

```
memory/
├── namespaces/
│   ├── default/
│   │   ├── task/
│   │   │   ├── 2024/
│   │   │   │   ├── 01/
│   │   │   │   │   ├── implement-auth-system-20240115-143022.md
│   │   │   │   │   └── design-database-schema-20240116-091455.md
│   │   │   │   └── 02/
│   │   │   └── index.json
│   │   ├── research/
│   │   │   ├── 2024/
│   │   │   │   ├── 01/
│   │   │   │   │   └── auth-patterns-analysis-20240115-102033.md
│   │   │   │   └── index.json
│   │   │   └── index.json
│   │   └── implementation/
│   ├── project-alpha/
│   │   ├── task/
│   │   └── progress/
│   └── project-beta/
├── .meta/
│   ├── vector_clock.json
│   ├── checksums.json
│   ├── indexes/
│   │   ├── category.json
│   │   ├── tags.json
│   │   ├── namespace.json
│   │   └── embeddings.bin
│   └── config.json
├── .cache/
│   ├── parsed/
│   └── indexes/
├── .gitignore
└── README.md
```

### File Format

Each memory item is stored as a Markdown file with YAML frontmatter:

```markdown
---
id: "item_1705329022456_7x8k9n2m"
category: "implementation"
tags:
  - "auth"
  - "jwt"
  - "security"
  - "middleware"
namespace: "project-alpha"
version: 3
vectorClock:
  agent-alice: 2
  agent-bob: 1
created: "2024-01-15T14:30:22.456Z"
updated: "2024-01-15T16:45:33.789Z"
checksum: "sha256:a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456"
metadata:
  assignee: "alice@company.com"
  priority: "high"
  estimatedHours: 8
  status: "completed"
  codeReviewUrl: "https://github.com/company/project/pull/123"
  testCoverage: 0.85
embedding:
  dimensions: 1536
  model: "text-embedding-ada-002"
  checksum: "md5:1a2b3c4d5e6f7890"
---

# JWT Authentication Middleware Implementation

Implemented a robust JWT authentication middleware for the Express.js application with the following features:

## Features Implemented

- **Token Validation**: Validates JWT tokens using RS256 algorithm
- **Expiration Checking**: Automatically rejects expired tokens
- **Role-Based Access**: Supports role-based authorization
- **Refresh Token Support**: Implements secure token refresh mechanism

## Code Structure

```typescript
interface JWTPayload {
  userId: string;
  email: string;
  roles: string[];
  iat: number;
  exp: number;
}

class AuthMiddleware {
  async validateToken(token: string): Promise<JWTPayload> {
    // Implementation details...
  }
}
```

## Testing

- ✅ Unit tests for token validation
- ✅ Integration tests with Express routes
- ✅ Security penetration testing
- ✅ Performance benchmarking

## Performance Metrics

- Token validation: ~2ms average
- Memory usage: <1MB per 1000 concurrent requests
- CPU usage: <0.1% under normal load

## Next Steps

- [ ] Add support for multiple JWT issuers
- [ ] Implement token blacklisting
- [ ] Add metrics and monitoring
```

### Git Integration

The Markdown backend can automatically manage git operations:

```typescript
// Enable git integration
const gitMemory = new MemoryManager({
  backend: 'markdown',
  storage: {
    path: './memory-repo',
    options: {
      gitEnabled: true,
      gitAutoCommit: true,
      gitCommitMessage: 'Memory update: {category} - {id}',
      gitBranch: 'main'
    }
  }
});

// Operations automatically create git commits
const item = await gitMemory.store({
  category: 'task',
  content: 'New task created'
});
// Creates git commit: "Memory update: task - item_1705329022456_7x8k9n2m"

// Manual git operations
const backend = gitMemory.getBackend();
await backend.gitCommit('Custom commit message');
await backend.gitPush('origin', 'main');
await backend.gitPull('origin', 'main');

// Branch management
await backend.gitCreateBranch('feature/new-memory-structure');
await backend.gitCheckout('feature/new-memory-structure');
await backend.gitMerge('main');
```

### Performance Characteristics

| Operation | Time Complexity | Notes |
|-----------|----------------|-------|
| Store | O(1) | File write + index update |
| Retrieve by ID | O(1) | Direct file read |
| Query by category | O(n) | Directory scan + filtering |
| Full-text search | O(n) | Grep-like text search |
| Vector search | O(n) | Linear search through embeddings |
| Git operations | O(m) | Where m = number of changed files |

### Optimization Tips

```typescript
// Optimize for large datasets
const optimizedMarkdown = new MemoryManager({
  backend: 'markdown',
  storage: {
    path: './large-memory',
    options: {
      // Use time-based directories to avoid large flat structures
      useTimeBasedDirectories: true,
      useCategoryDirectories: true,
      
      // Enable caching for better read performance
      cacheDirectory: './.cache',
      watchForChanges: false, // Disable if no external edits
      
      // Optimize git operations
      gitAutoCommit: false, // Manual commits for batching
      enableGarbageCollection: true,
      
      // Index optimization
      rebuildIndexInterval: 600000, // 10 minutes
    }
  },
  cache: {
    enabled: true,
    maxSize: 100 * 1024 * 1024, // 100MB cache
    strategy: 'lru'
  }
});

// Manual batching for better git performance
const items = [
  { category: 'task', content: 'Task 1' },
  { category: 'task', content: 'Task 2' },
  { category: 'task', content: 'Task 3' }
];

await optimizedMarkdown.storeBatch(items);
await optimizedMarkdown.getBackend().gitCommit('Batch update: 3 new tasks');
```

## Backend Comparison

| Feature | SQLite | Markdown |
|---------|--------|----------|
| **Performance** |
| Read speed | Excellent | Good |
| Write speed | Excellent | Good |
| Query speed | Excellent | Fair |
| Full-text search | Excellent (FTS5) | Good (grep) |
| Vector search | Excellent (with ext) | Fair (linear) |
| **Scalability** |
| Max items | 281 TB | Filesystem limit |
| Concurrent users | Excellent | Good |
| **Features** |
| ACID transactions | Yes | No |
| Human readable | No | Yes |
| Git integration | No | Yes |
| Direct editing | No | Yes |
| **Operational** |
| Backup complexity | Medium | Simple |
| Migration | Medium | Simple |
| Debugging | Medium | Easy |
| Monitoring | Good | Basic |

## Choosing a Backend

### Use SQLite When:

- **Performance is critical**: High-throughput applications
- **Complex queries**: Advanced search and filtering requirements
- **Large datasets**: Millions of memory items
- **Concurrent access**: Multiple agents accessing simultaneously
- **Transactional integrity**: ACID compliance required

### Use Markdown When:

- **Human collaboration**: Teams need to read/edit memories directly
- **Version control**: Git-based workflows and history
- **Transparency**: Auditable, human-readable storage
- **Simple deployment**: No database setup required
- **Documentation**: Memories serve as living documentation

## Hybrid Approach

For some use cases, you might want to use both backends:

```typescript
// Primary storage with SQLite for performance
const primaryMemory = new MemoryManager({
  backend: 'sqlite',
  storage: { path: './primary.db' }
});

// Secondary storage with Markdown for collaboration
const secondaryMemory = new MemoryManager({
  backend: 'markdown',
  storage: { path: './docs' }
});

// Sync important items to both
const importantItem = await primaryMemory.store({
  category: 'architecture-decision',
  content: 'Decision to use microservices architecture',
  tags: ['architecture', 'decision', 'microservices']
});

// Also store in markdown for documentation
await secondaryMemory.store(importantItem);
```

## Custom Backends

You can implement custom backends by implementing the `MemoryBackend` interface:

```typescript
interface MemoryBackend {
  initialize(): Promise<void>;
  close(): Promise<void>;
  store(item: MemoryItem): Promise<void>;
  retrieve(id: string): Promise<MemoryItem | null>;
  query(query: MemoryQuery): Promise<MemoryItem[]>;
  update(id: string, item: MemoryItem): Promise<void>;
  delete(id: string): Promise<boolean>;
  getStatistics(): Promise<BackendStatistics>;
}

// Example: Redis backend for distributed caching
class RedisBackend implements MemoryBackend {
  // Implementation...
}

// Use custom backend
const redisMemory = new MemoryManager({
  backend: new RedisBackend({
    host: 'localhost',
    port: 6379,
    password: 'secret'
  })
});
```