# Usage Guide

## Getting Started

### Installation

```bash
# Using npm
npm install @sparc/memory-bank

# Using deno
import { MemoryManager } from 'https://deno.land/x/sparc_memory@latest/mod.ts';
```

### Basic Setup

```typescript
import { MemoryManager } from '@sparc/memory-bank';

// Create memory manager with SQLite backend
const memory = new MemoryManager({
  backend: 'sqlite',
  storage: {
    path: './data/memory.db'
  },
  cache: {
    enabled: true,
    maxSize: 100 * 1024 * 1024, // 100MB
    strategy: 'lru'
  },
  indexing: {
    enabled: true,
    vectorSearch: true,
    fullTextSearch: true
  }
});

// Initialize the system
await memory.initialize();

// Use the memory system
const item = await memory.store({
  category: 'task',
  content: 'Implement user authentication system',
  tags: ['auth', 'security', 'backend']
});

console.log(`Stored item: ${item.id}`);
```

## Core Operations

### Storing Information

```typescript
// Simple storage
const task = await memory.store({
  category: 'task',
  content: 'Design database schema for user management',
  tags: ['database', 'users', 'schema']
});

// Storage with metadata
const research = await memory.store({
  category: 'research',
  content: 'Analysis of authentication patterns in modern web applications',
  tags: ['auth', 'web', 'security', 'patterns'],
  metadata: {
    source: 'IEEE Computer Society',
    author: 'Dr. Smith',
    confidence: 0.9,
    relevance: 'high',
    dateAnalyzed: new Date('2024-01-15')
  }
});

// Storage with namespace isolation
const projectItem = await memory.store({
  category: 'implementation',
  content: 'Implemented OAuth 2.0 flow with PKCE',
  tags: ['oauth', 'security', 'implementation'],
  namespace: 'project-alpha',
  metadata: {
    project: 'project-alpha',
    sprint: 'sprint-3',
    story: 'US-123',
    assignee: 'alice@company.com'
  }
});
```

### Retrieving Information

```typescript
// Retrieve by ID
const item = await memory.retrieve('item-12345');
if (item) {
  console.log(item.content);
}

// Batch retrieval
const items = await memory.retrieveBatch(['id1', 'id2', 'id3']);
const validItems = items.filter(item => item !== null);
```

### Querying and Search

#### Basic Queries

```typescript
// Find all tasks
const tasks = await memory.query({
  category: 'task'
});

// Find items with specific tags
const authItems = await memory.query({
  tags: ['auth', 'security'] // Must have ALL tags
});

// Find items with any of the specified tags
const webItems = await memory.query({
  tagsAny: ['web', 'mobile', 'api'] // Must have ANY tag
});
```

#### Advanced Queries

```typescript
// Complex query with multiple criteria
const results = await memory.query({
  categories: ['task', 'implementation'],
  tags: ['auth'],
  fullText: 'OAuth authentication',
  dateRange: {
    start: new Date('2024-01-01'),
    end: new Date('2024-12-31'),
    field: 'updated'
  },
  metadata: {
    priority: 'high',
    status: 'completed'
  },
  limit: 20,
  sortBy: 'updated',
  sortOrder: 'desc'
});

console.log(`Found ${results.length} matching items`);
```

#### Full-Text Search

```typescript
// Simple full-text search
const searchResults = await memory.fullTextSearch('authentication security');

// Advanced full-text search with options
const advancedResults = await memory.fullTextSearch('user management', {
  categories: ['task', 'research'],
  highlight: true,
  stemming: true,
  fuzzy: true,
  limit: 10
});
```

#### Vector Similarity Search

```typescript
// Semantic similarity search
const similarItems = await memory.vectorSearch({
  text: 'user authentication and security protocols',
  threshold: 0.7,
  limit: 5,
  categories: ['research', 'implementation']
});

for (const result of similarItems) {
  console.log(`${result.item.content} (similarity: ${result.similarity.toFixed(3)})`);
}

// Search using existing item as reference
const referenceItem = await memory.retrieve('existing-item-id');
if (referenceItem?.embedding) {
  const relatedItems = await memory.vectorSearch({
    embedding: referenceItem.embedding,
    threshold: 0.6,
    excludeIds: [referenceItem.id] // Exclude the reference item itself
  });
}
```

### Updating Information

```typescript
// Simple update
const updatedItem = await memory.update('item-123', {
  content: 'Updated implementation notes for OAuth 2.0',
  tags: ['oauth', 'security', 'completed']
});

// Update with metadata changes
const taskUpdate = await memory.update('task-456', {
  metadata: {
    ...existingItem.metadata,
    status: 'completed',
    completedAt: new Date(),
    reviewer: 'bob@company.com'
  }
});

// Conditional update (only if version matches)
try {
  const updated = await memory.update('item-789', {
    content: 'New content',
    expectedVersion: currentItem.version // Prevents lost updates
  });
} catch (error) {
  if (error.code === 'VERSION_CONFLICT') {
    // Handle conflict - reload and retry
    const latest = await memory.retrieve('item-789');
    // Merge changes and retry...
  }
}
```

### Deleting Information

```typescript
// Delete single item
const deleted = await memory.delete('item-123');
if (deleted) {
  console.log('Item deleted successfully');
}

// Batch deletion
const deletedItems = await memory.deleteBatch(['id1', 'id2', 'id3']);
const successCount = deletedItems.filter(success => success).length;
console.log(`Deleted ${successCount} items`);

// Conditional deletion with query
const oldItems = await memory.query({
  dateRange: {
    end: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    field: 'updated'
  },
  metadata: {
    status: 'archived'
  }
});

for (const item of oldItems) {
  await memory.delete(item.id);
}
```

## Advanced Usage Patterns

### Multi-Agent Collaboration

```typescript
// Agent A stores information
const agentA = new MemoryManager({
  backend: 'sqlite',
  storage: { path: './shared-memory.db' },
  replication: {
    enabled: true,
    agentId: 'agent-a',
    peers: ['agent-b', 'agent-c']
  }
});

const taskFromA = await agentA.store({
  category: 'task',
  content: 'Research authentication best practices',
  tags: ['research', 'auth'],
  metadata: {
    assignedBy: 'agent-a',
    priority: 'high'
  }
});

// Agent B retrieves and updates
const agentB = new MemoryManager({
  backend: 'sqlite',
  storage: { path: './shared-memory.db' },
  replication: {
    enabled: true,
    agentId: 'agent-b',
    peers: ['agent-a', 'agent-c']
  }
});

const task = await agentB.retrieve(taskFromA.id);
if (task) {
  const updated = await agentB.update(task.id, {
    content: task.content + '\n\nCompleted literature review of OAuth 2.1 specifications.',
    metadata: {
      ...task.metadata,
      status: 'in-progress',
      lastWorkedBy: 'agent-b',
      progress: 0.3
    }
  });
}
```

### Namespace Isolation

```typescript
// Setup memory manager with namespace support
const memory = new MemoryManager({
  backend: 'sqlite',
  storage: { path: './multi-tenant.db' },
  namespaces: {
    enabled: true,
    defaultNamespace: 'default',
    permissions: {
      'project-a': {
        read: ['agent-1', 'agent-2'],
        write: ['agent-1'],
        admin: ['agent-1']
      },
      'project-b': {
        read: ['agent-2', 'agent-3'],
        write: ['agent-2', 'agent-3'],
        admin: ['agent-2']
      }
    }
  }
});

// Store in specific namespace
const projectATask = await memory.store({
  category: 'task',
  content: 'Implement user registration',
  tags: ['registration', 'users'],
  namespace: 'project-a'
});

// Query within namespace
const projectATasks = await memory.query({
  category: 'task',
  namespace: 'project-a'
});

// Cross-namespace search (if permissions allow)
const allTasks = await memory.query({
  category: 'task',
  namespaces: ['project-a', 'project-b'] // Search across multiple namespaces
});
```

### Knowledge Graphs and Relationships

```typescript
// Store related items with references
const parentTask = await memory.store({
  category: 'epic',
  content: 'User Management System',
  tags: ['epic', 'users', 'system'],
  metadata: {
    type: 'epic',
    estimatedEffort: '4 weeks',
    priority: 'high'
  }
});

const subtask1 = await memory.store({
  category: 'task',
  content: 'Design user database schema',
  tags: ['database', 'schema', 'users'],
  metadata: {
    type: 'task',
    parentId: parentTask.id,
    estimatedHours: 8,
    status: 'todo'
  }
});

const subtask2 = await memory.store({
  category: 'task',
  content: 'Implement user registration API',
  tags: ['api', 'registration', 'backend'],
  metadata: {
    type: 'task',
    parentId: parentTask.id,
    dependsOn: [subtask1.id],
    estimatedHours: 16,
    status: 'todo'
  }
});

// Query related items
const subtasks = await memory.query({
  metadata: {
    parentId: parentTask.id
  }
});

// Find dependency chain
const dependencies = await memory.query({
  metadata: {
    dependsOn: subtask1.id
  }
});
```

### Temporal Queries and History

```typescript
// Track progress over time
const progressUpdates = await memory.query({
  category: 'progress-update',
  metadata: {
    taskId: 'task-123'
  },
  sortBy: 'created',
  sortOrder: 'asc'
});

// Find recent activity
const recentActivity = await memory.query({
  dateRange: {
    start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
    field: 'created'
  },
  sortBy: 'created',
  sortOrder: 'desc',
  limit: 50
});

// Track changes to specific items
const itemHistory = await memory.query({
  metadata: {
    originalId: 'task-456', // Track versions of the same logical item
    type: 'version'
  },
  sortBy: 'created',
  sortOrder: 'asc'
});
```

### Performance Optimization

#### Batch Operations

```typescript
// Efficient bulk storage
const itemsToStore = [
  { category: 'task', content: 'Task 1', tags: ['tag1'] },
  { category: 'task', content: 'Task 2', tags: ['tag2'] },
  { category: 'research', content: 'Finding 1', tags: ['research'] }
];

const storedItems = await memory.storeBatch(itemsToStore);
console.log(`Stored ${storedItems.length} items in batch`);
```

#### Caching Strategies

```typescript
// Configure cache for different access patterns
const readHeavyMemory = new MemoryManager({
  backend: 'sqlite',
  storage: { path: './read-heavy.db' },
  cache: {
    enabled: true,
    maxSize: 500 * 1024 * 1024, // 500MB cache
    strategy: 'lru', // Good for read-heavy workloads
    ttl: 60 * 60 * 1000 // 1 hour TTL
  }
});

// Query with cache hint
const cachedResults = await memory.query({
  category: 'frequently-accessed',
  useCache: true, // Prefer cached results
  limit: 100
});
```

#### Index Optimization

```typescript
// Optimize for specific query patterns
const optimizedMemory = new MemoryManager({
  backend: 'sqlite',
  storage: { path: './optimized.db' },
  indexing: {
    enabled: true,
    vectorSearch: true,
    fullTextSearch: true,
    customIndexes: [
      'category', // Index frequently queried fields
      'metadata.status',
      'metadata.priority',
      'created'
    ]
  }
});
```

## Error Handling

```typescript
import { MemoryError } from '@sparc/memory-bank';

try {
  const item = await memory.store({
    category: 'task',
    content: 'Some content'
  });
} catch (error) {
  if (error instanceof MemoryError) {
    switch (error.code) {
      case 'VALIDATION_ERROR':
        console.error('Invalid data:', error.details);
        break;
      case 'STORAGE_ERROR':
        console.error('Storage backend error:', error.message);
        break;
      case 'PERMISSION_DENIED':
        console.error('Access denied:', error.details);
        break;
      default:
        console.error('Memory operation failed:', error.message);
    }
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Best Practices

### Data Design

1. **Use meaningful categories**: Choose descriptive, consistent category names
2. **Tag strategically**: Use tags for faceted search, avoid over-tagging
3. **Structure metadata**: Keep metadata flat and searchable
4. **Consistent naming**: Use consistent naming conventions across agents

```typescript
// Good: Structured and consistent
const goodItem = await memory.store({
  category: 'implementation', // Clear category
  content: 'Implemented JWT token validation middleware',
  tags: ['jwt', 'middleware', 'auth', 'validation'], // Specific, searchable tags
  metadata: {
    component: 'auth-service',
    language: 'typescript',
    complexity: 'medium',
    testCoverage: 0.85,
    codeReviewStatus: 'approved',
    deployedVersion: '1.2.3'
  }
});

// Avoid: Vague and inconsistent
const badItem = await memory.store({
  category: 'stuff', // Too vague
  content: 'did some work', // Not descriptive
  tags: ['work', 'done', 'tuesday'], // Not useful for search
  metadata: {
    misc: 'random data',
    nested: {
      deep: {
        data: 'hard to query' // Deeply nested data
      }
    }
  }
});
```

### Performance

1. **Use batch operations** for bulk data
2. **Configure cache** appropriately for your access patterns
3. **Limit query results** to avoid memory issues
4. **Use vector search** for semantic queries
5. **Monitor performance** with statistics

```typescript
// Monitor and optimize
const stats = await memory.getStatistics();
if (stats.cacheStats.hitRate < 0.8) {
  console.warn('Consider increasing cache size or adjusting strategy');
}

if (stats.performance.averageQueryTime > 100) {
  console.warn('Queries are slow, consider adding indexes');
}
```

### Security

1. **Use namespaces** for multi-tenant scenarios
2. **Enable encryption** for sensitive data
3. **Validate inputs** before storing
4. **Monitor access** with audit logs

```typescript
// Secure configuration
const secureMemory = new MemoryManager({
  backend: 'sqlite',
  storage: { path: './secure.db' },
  security: {
    encryption: {
      enabled: true,
      algorithm: 'aes-256-gcm',
      keyDerivation: 'pbkdf2'
    },
    checksums: true,
    auditLog: true
  },
  namespaces: {
    enabled: true,
    permissions: {
      'sensitive': {
        read: ['admin-agent'],
        write: ['admin-agent'],
        admin: ['admin-agent']
      }
    }
  }
});
```