# API Reference

## Core Classes

### MemoryManager

The main interface for all memory operations.

```typescript
class MemoryManager {
  constructor(config: MemoryConfig)
  
  // Core operations
  async store(item: Partial<MemoryItem>): Promise<MemoryItem>
  async retrieve(id: string): Promise<MemoryItem | null>
  async query(query: MemoryQuery): Promise<MemoryItem[]>
  async update(id: string, updates: Partial<MemoryItem>): Promise<MemoryItem>
  async delete(id: string): Promise<boolean>
  
  // Batch operations
  async storeBatch(items: Partial<MemoryItem>[]): Promise<MemoryItem[]>
  async retrieveBatch(ids: string[]): Promise<(MemoryItem | null)[]>
  async deleteBatch(ids: string[]): Promise<boolean[]>
  
  // Advanced operations
  async vectorSearch(query: VectorQuery): Promise<VectorSearchResult[]>
  async fullTextSearch(query: string, options?: SearchOptions): Promise<MemoryItem[]>
  async getStatistics(): Promise<MemoryStatistics>
  
  // Lifecycle
  async initialize(): Promise<void>
  async close(): Promise<void>
  async backup(options: BackupOptions): Promise<string>
  async restore(backupPath: string): Promise<void>
}
```

#### store(item: Partial<MemoryItem>): Promise<MemoryItem>

Stores a new memory item or updates an existing one.

**Parameters:**
- `item`: Partial memory item with at least `category` and `content`

**Returns:**
- Complete `MemoryItem` with generated ID, timestamps, and metadata

**Example:**
```typescript
const item = await memory.store({
  category: 'task',
  content: 'Implement user authentication',
  tags: ['auth', 'security'],
  metadata: {
    priority: 'high',
    assignee: 'alice'
  }
});

console.log(`Created item: ${item.id}`);
```

#### retrieve(id: string): Promise<MemoryItem | null>

Retrieves a memory item by its unique ID.

**Parameters:**
- `id`: Unique identifier of the memory item

**Returns:**
- `MemoryItem` if found, `null` otherwise

**Example:**
```typescript
const item = await memory.retrieve('item-123');
if (item) {
  console.log(`Found: ${item.content}`);
} else {
  console.log('Item not found');
}
```

#### query(query: MemoryQuery): Promise<MemoryItem[]>

Searches for memory items based on various criteria.

**Parameters:**
- `query`: Search criteria and options

**Returns:**
- Array of matching `MemoryItem`s, sorted by relevance

**Example:**
```typescript
const results = await memory.query({
  category: 'task',
  tags: ['auth'],
  fullText: 'authentication',
  dateRange: {
    start: new Date('2024-01-01'),
    end: new Date('2024-12-31')
  },
  limit: 10,
  sortBy: 'updated',
  sortOrder: 'desc'
});

console.log(`Found ${results.length} items`);
```

#### update(id: string, updates: Partial<MemoryItem>): Promise<MemoryItem>

Updates an existing memory item with conflict resolution.

**Parameters:**
- `id`: Unique identifier of the item to update
- `updates`: Partial updates to apply

**Returns:**
- Updated `MemoryItem` with new version and timestamp

**Example:**
```typescript
const updated = await memory.update('item-123', {
  content: 'Updated implementation notes',
  tags: ['auth', 'security', 'completed'],
  metadata: {
    ...item.metadata,
    status: 'completed',
    completedAt: new Date()
  }
});

console.log(`Updated to version ${updated.version}`);
```

#### delete(id: string): Promise<boolean>

Deletes a memory item permanently.

**Parameters:**
- `id`: Unique identifier of the item to delete

**Returns:**
- `true` if item was deleted, `false` if not found

**Example:**
```typescript
const deleted = await memory.delete('item-123');
if (deleted) {
  console.log('Item deleted successfully');
} else {
  console.log('Item not found');
}
```

#### vectorSearch(query: VectorQuery): Promise<VectorSearchResult[]>

Performs semantic similarity search using vector embeddings.

**Parameters:**
- `query`: Vector search criteria

**Returns:**
- Array of results with similarity scores

**Example:**
```typescript
const results = await memory.vectorSearch({
  text: 'user authentication and security',
  threshold: 0.7,
  limit: 5,
  categories: ['task', 'research']
});

for (const result of results) {
  console.log(`${result.item.content} (${result.similarity})`);
}
```

## Data Types

### MemoryItem

The core data structure representing a stored memory.

```typescript
interface MemoryItem {
  id: string;                           // Unique identifier (UUID)
  category: string;                     // Logical grouping (e.g., 'task', 'research')
  content: string;                      // Main content/description
  tags: string[];                       // Searchable tags
  namespace?: string;                   // Isolation boundary
  metadata?: Record<string, unknown>;   // Additional structured data
  embedding?: number[];                 // Vector representation (1536 dimensions)
  version: number;                      // CRDT version counter
  vectorClock: Record<string, number>;  // Conflict resolution timestamps
  created: Date;                        // Creation timestamp
  updated: Date;                        // Last modification timestamp
  checksum: string;                     // SHA-256 integrity hash
}
```

### MemoryQuery

Search criteria for querying memory items.

```typescript
interface MemoryQuery {
  // Content filters
  category?: string;                    // Exact category match
  categories?: string[];                // Multiple category options
  tags?: string[];                      // Must include all tags (AND)
  tagsAny?: string[];                   // Must include any tag (OR)
  fullText?: string;                    // Full-text search query
  content?: string;                     // Content substring match
  
  // Metadata filters
  namespace?: string;                   // Namespace isolation
  metadata?: Record<string, unknown>;   // Metadata key-value matches
  
  // Time filters
  dateRange?: {
    start?: Date;                       // Items created/updated after
    end?: Date;                         // Items created/updated before
    field?: 'created' | 'updated';     // Which timestamp to use
  };
  
  // Vector search
  similarity?: {
    text?: string;                      // Text to compare against
    embedding?: number[];               // Direct embedding comparison
    threshold?: number;                 // Minimum similarity (0-1)
  };
  
  // Result options
  limit?: number;                       // Maximum results (default: 100)
  offset?: number;                      // Skip first N results
  sortBy?: 'created' | 'updated' | 'category' | 'relevance';
  sortOrder?: 'asc' | 'desc';          // Sort direction
  
  // Performance options
  useCache?: boolean;                   // Use cache for results
  includeEmbeddings?: boolean;          // Include vector data in results
}
```

### VectorQuery

Specialized query for semantic vector search.

```typescript
interface VectorQuery {
  text?: string;                        // Text to find similar items for
  embedding?: number[];                 // Pre-computed embedding vector
  threshold?: number;                   // Minimum similarity score (0-1)
  limit?: number;                       // Maximum results
  categories?: string[];                // Limit to specific categories
  namespaces?: string[];                // Limit to specific namespaces
  excludeIds?: string[];                // Exclude specific item IDs
}
```

### VectorSearchResult

Result from vector similarity search.

```typescript
interface VectorSearchResult {
  item: MemoryItem;                     // The matching memory item
  similarity: number;                   // Cosine similarity score (0-1)
  distance: number;                     // Euclidean distance
  rank: number;                         // Result ranking (1-based)
}
```

### MemoryConfig

Configuration options for the memory system.

```typescript
interface MemoryConfig {
  // Backend configuration
  backend: 'sqlite' | 'markdown';      // Storage backend type
  storage: {
    path: string;                       // Storage path/connection string
    options?: Record<string, unknown>;  // Backend-specific options
  };
  
  // Cache configuration
  cache?: {
    enabled: boolean;                   // Enable caching
    maxSize: number;                    // Maximum cache size in bytes
    strategy: 'lru' | 'lfu' | 'fifo' | 'ttl';  // Eviction strategy
    ttl?: number;                       // Time-to-live in milliseconds
  };
  
  // Indexing configuration
  indexing?: {
    enabled: boolean;                   // Enable advanced indexing
    vectorSearch: boolean;              // Enable vector search
    fullTextSearch: boolean;            // Enable full-text search
    embeddingService?: EmbeddingService; // Custom embedding service
  };
  
  // Namespace configuration
  namespaces?: {
    enabled: boolean;                   // Enable namespace isolation
    defaultNamespace: string;           // Default namespace name
    permissions?: NamespacePermissions; // Access control
  };
  
  // Replication configuration
  replication?: {
    enabled: boolean;                   // Enable replication
    peers: string[];                    // Peer connection strings
    strategy: 'immediate' | 'batched' | 'scheduled';
    conflictResolution: 'lastWrite' | 'merge' | 'manual';
  };
  
  // Security configuration
  security?: {
    encryption: {
      enabled: boolean;                 // Enable encryption at rest
      algorithm: 'aes-256-gcm';         // Encryption algorithm
      keyDerivation: 'pbkdf2';          // Key derivation function
    };
    checksums: boolean;                 // Enable integrity checking
    auditLog: boolean;                  // Enable audit logging
  };
}
```

## Error Types

### MemoryError

Base error class for all memory-related errors.

```typescript
class MemoryError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  )
}
```

### Common Error Codes

- `ITEM_NOT_FOUND`: Requested item does not exist
- `INVALID_QUERY`: Query parameters are invalid
- `STORAGE_ERROR`: Backend storage operation failed
- `CACHE_ERROR`: Cache operation failed
- `INDEX_ERROR`: Indexing operation failed
- `NAMESPACE_ERROR`: Namespace operation failed
- `PERMISSION_DENIED`: Insufficient permissions
- `CONFLICT_ERROR`: CRDT merge conflict
- `VALIDATION_ERROR`: Data validation failed
- `INITIALIZATION_ERROR`: System initialization failed

## Advanced Features

### Batch Operations

Efficient bulk operations for high-throughput scenarios.

```typescript
// Store multiple items efficiently
const items = await memory.storeBatch([
  { category: 'task', content: 'Task 1' },
  { category: 'task', content: 'Task 2' },
  { category: 'research', content: 'Finding 1' }
]);

// Retrieve multiple items by ID
const retrieved = await memory.retrieveBatch(['id1', 'id2', 'id3']);

// Delete multiple items
const deleted = await memory.deleteBatch(['id1', 'id2']);
```

### Statistics and Monitoring

```typescript
interface MemoryStatistics {
  totalItems: number;
  itemsByCategory: Record<string, number>;
  itemsByNamespace: Record<string, number>;
  storageSize: number;
  cacheStats: {
    hitRate: number;
    missRate: number;
    evictions: number;
    size: number;
  };
  indexStats: {
    vectorIndexSize: number;
    fullTextIndexSize: number;
    rebuildCount: number;
  };
  performance: {
    averageQueryTime: number;
    averageStoreTime: number;
    averageRetrieveTime: number;
  };
}

const stats = await memory.getStatistics();
console.log(`Total items: ${stats.totalItems}`);
console.log(`Cache hit rate: ${(stats.cacheStats.hitRate * 100).toFixed(2)}%`);
```

### Backup and Restore

```typescript
// Create backup
const backupPath = await memory.backup({
  format: 'json',
  compression: 'gzip',
  encryption: true,
  includeIndexes: false
});

// Restore from backup
await memory.restore(backupPath);
```

### Event Handling

```typescript
// Listen for memory events
memory.on('itemStored', (item: MemoryItem) => {
  console.log(`Stored: ${item.id}`);
});

memory.on('itemUpdated', (item: MemoryItem, previousVersion: number) => {
  console.log(`Updated: ${item.id} (v${previousVersion} -> v${item.version})`);
});

memory.on('itemDeleted', (id: string) => {
  console.log(`Deleted: ${id}`);
});

memory.on('conflictResolved', (item: MemoryItem, conflicts: MemoryItem[]) => {
  console.log(`Resolved conflict for: ${item.id}`);
});
```