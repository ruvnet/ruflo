# AI-Claude-Flow Memory Architecture Analysis

Complete breakdown of the memory persistence, operations, and integration architecture in ai-claude-flow.

## 1. STORAGE LAYER ANALYSIS

### Directory Structure
```
/home/user/ai-claude-flow/src/memory/
├── index.js                           # Main export (SharedMemory, SwarmMemory)
├── manager.ts                         # MemoryManager - Core orchestrator
├── shared-memory.js                   # SharedMemory class (primary implementation)
├── swarm-memory.ts                    # SwarmMemory - Swarm-specific operations
├── swarm-memory.js                    # SwarmMemory.js (alternative)
├── cache.ts                           # LRU Cache implementation
├── indexer.ts                         # Memory indexing for fast queries
├── sqlite-store.js                    # SQLite store (alternative)
├── sqlite-wrapper.js                  # SQLite wrapper utilities
├── in-memory-store.js                 # In-memory fallback store
├── fallback-store.js                  # Fallback mechanism
├── unified-memory-manager.js          # Unified memory operations
├── advanced-memory-manager.ts         # Advanced operations
├── enhanced-memory.js                 # Enhanced operations (sessions, workflows)
├── advanced-serializer.js             # Advanced serialization
├── enhanced-session-serializer.js     # Session persistence
├── migration.js                       # Schema migration utilities
├── distributed-memory.ts              # Distributed operations
├── backends/
│   ├── base.ts                        # IMemoryBackend interface
│   ├── sqlite.ts                      # SQLiteBackend implementation
│   └── markdown.ts                    # MarkdownBackend implementation
├── enhanced-schema.sql                # Advanced schema definitions
└── README.md                          # Module documentation
```

### SharedMemoryStore Implementation

**File**: `/home/user/ai-claude-flow/src/memory/shared-memory.js`

**Core Features**:
- **Backend**: SQLite via better-sqlite3
- **Caching**: LRU cache (default 1000 entries, 50MB)
- **Persistence**: Two-level persistence (cache → database)
- **TTL Support**: Automatic expiration of entries
- **Compression**: Automatic compression for large values (>10KB)
- **Indexing**: Multiple indexes for fast queries

**Database Schema**:
```sql
CREATE TABLE memory_store (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'default',
  value TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'json',
  metadata TEXT,
  tags TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  accessed_at INTEGER DEFAULT (strftime('%s', 'now')),
  access_count INTEGER DEFAULT 0,
  ttl INTEGER,
  expires_at INTEGER,
  compressed INTEGER DEFAULT 0,
  size INTEGER DEFAULT 0,
  UNIQUE(key, namespace)
);

-- Indexes for performance
CREATE INDEX idx_memory_namespace ON memory_store(namespace);
CREATE INDEX idx_memory_expires ON memory_store(expires_at);
CREATE INDEX idx_memory_accessed ON memory_store(accessed_at);
CREATE INDEX idx_memory_key_namespace ON memory_store(key, namespace);
CREATE INDEX idx_memory_tags ON memory_store(tags);
```

**Key Methods**:

```typescript
// Core operations
async initialize()           // Initialize database and run migrations
async store(key, value, options)  // Store with namespace, TTL, tags, metadata
async retrieve(key, namespace)    // Get value from cache or database
async list(namespace, options)    // List entries in namespace with pagination
async delete(key, namespace)      // Delete entry
async clear(namespace)            // Clear entire namespace

// Advanced operations
async search(options)             // Search by pattern, namespace, tags
async backup(filepath)            // Backup database
async getStats()                  // Get performance statistics
async close()                     // Close database connection
```

**Caching Strategy** (LRU - Least Recently Used):

```javascript
class LRUCache {
  constructor(maxSize = 1000, maxMemoryMB = 50)
  
  get(key)          // Return cached value (hits/misses tracked)
  set(key, data)    // Store with memory pressure handling
  delete(key)       // Remove entry
  getStats()        // Cache metrics (size, hit rate, evictions)
}
```

**Metrics Tracked**:
- Cache hit/miss rate
- Database query performance
- Compression statistics
- TTL expiration tracking
- Access patterns

### MemoryManager (Advanced Implementation)

**File**: `/home/user/ai-claude-flow/src/memory/manager.ts`

**Architecture**:
```typescript
class MemoryManager implements IMemoryManager {
  private backend: IMemoryBackend      // Pluggable backend (SQLite/Markdown/Hybrid)
  private cache: MemoryCache           // L1 cache
  private indexer: MemoryIndexer       // Fast query indexing
  private banks: Map<string, MemoryBank>  // Agent-specific memory banks
  
  async initialize()                   // Initialize all components
  async store(entry: MemoryEntry)     // Store with metadata
  async retrieve(id: string)          // Get from cache → backend
  async query(query: MemoryQuery)     // Fast querying via indexer
  async update(id, updates)           // Update with versioning
  async delete(id)                    // Delete from all layers
  async performMaintenance()          // Cleanup + optimization
}
```

**Backend Abstraction** (IMemoryBackend Interface):

```typescript
interface IMemoryBackend {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  store(entry: MemoryEntry): Promise<void>;
  retrieve(id: string): Promise<MemoryEntry | undefined>;
  update(id: string, entry: MemoryEntry): Promise<void>;
  delete(id: string): Promise<void>;
  query(query: MemoryQuery): Promise<MemoryEntry[]>;
  getAllEntries(): Promise<MemoryEntry[]>;
  getHealthStatus(): Promise<HealthStatus>;
  performMaintenance?(): Promise<void>;
}
```

**Available Backends**:

1. **SQLiteBackend** (`/src/memory/backends/sqlite.ts`)
   - Structured data storage
   - Fast queries via indexes
   - ACID compliance
   - Best for structured memory

2. **MarkdownBackend** (`/src/memory/backends/markdown.ts`)
   - Human-readable storage
   - File-based organization
   - Index tracking
   - Best for documentation/backup

3. **HybridBackend** (in manager.ts)
   - Primary: SQLite (performance)
   - Secondary: Markdown (backup/readability)
   - Automatic sync
   - Best for reliability

**Memory Entry Structure**:

```typescript
interface MemoryEntry {
  id: string;                    // Unique ID
  agentId: string;              // Agent owner
  sessionId: string;            // Session context
  type: 'knowledge'|'result'|'state'|'communication'|'error';
  content: string;              // Main content
  context: Record<string, any>; // Additional context
  timestamp: Date;              // Creation time
  tags: string[];              // Search tags
  version: number;             // Entry version
  metadata?: Record<string, any>; // Custom metadata
  parentId?: string;           // Parent entry reference
}
```

---

## 2. MEMORY OPERATIONS

### MemoryCache Implementation

**File**: `/home/user/ai-claude-flow/src/memory/cache.ts`

**LRU Cache with Memory Pressure Handling**:

```typescript
class MemoryCache {
  private cache: Map<string, CacheEntry>;
  private currentSize: number = 0;
  private hits: number = 0;
  private misses: number = 0;
  
  get(id: string): MemoryEntry | undefined
  set(id: string, data: MemoryEntry, dirty = true): void
  delete(id: string): void
  getByPrefix(prefix: string): MemoryEntry[]
  getDirtyEntries(): MemoryEntry[]
  markClean(ids: string[]): void
  getMetrics(): CacheMetrics
}
```

**Features**:
- LRU eviction when size/memory limits exceeded
- Dirty flag tracking for sync
- Prefix-based retrieval (namespace:key)
- Metrics: size, entries, hitRate, maxSize
- Memory estimation (UTF-16 character count)

### MemoryIndexer Implementation

**File**: `/home/user/ai-claude-flow/src/memory/indexer.ts`

**Multi-Index Query Engine**:

```typescript
class MemoryIndexer {
  private entries: Map<string, MemoryEntry>;
  private agentIndex: SimpleIndex<string>;    // By agentId
  private sessionIndex: SimpleIndex<string>;  // By sessionId
  private typeIndex: SimpleIndex<string>;     // By type
  private tagIndex: SimpleIndex<string>;      // By tags
  private timeIndex: Map<string, number>;     // By timestamp
  
  async buildIndex(entries: MemoryEntry[]): Promise<void>;
  addEntry(entry: MemoryEntry): void;
  updateEntry(entry: MemoryEntry): void;
  removeEntry(id: string): void;
  search(query: MemoryQuery): MemoryEntry[];
  getMetrics(): IndexMetrics;
}
```

**Query Operations**:

```typescript
interface MemoryQuery {
  agentId?: string;
  sessionId?: string;
  type?: 'knowledge'|'result'|'state'|'communication'|'error';
  tags?: string[];
  search?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
}
```

**Indexing Strategy**:
- Agent Index: Fast per-agent queries
- Session Index: Session-scoped retrieval
- Type Index: Type-specific searches
- Tag Index: Multi-tag queries (union)
- Time Index: Time-range filtering
- Set intersection/union for complex queries

### SwarmMemory Operations

**File**: `/home/user/ai-claude-flow/src/memory/swarm-memory.ts`

**Specialized Memory for Swarm Coordination**:

```typescript
class SwarmMemoryManager extends EventEmitter {
  private baseMemory: MemoryManager;
  private entries: Map<string, SwarmMemoryEntry>;
  private knowledgeBases: Map<string, SwarmKnowledgeBase>;
  private agentMemories: Map<string, Set<string>>;
  
  // Agent operations
  async remember(agentId, type, content, metadata): Promise<string>;
  async recall(query: SwarmMemoryQuery): Promise<SwarmMemoryEntry[]>;
  async shareMemory(entryId, targetAgentId): Promise<void>;
  async broadcastMemory(entryId, agentIds?): Promise<void>;
  
  // Knowledge base operations
  async createKnowledgeBase(name, description, domain, expertise): Promise<string>;
  async updateKnowledgeBase(entry): Promise<void>;
  async searchKnowledge(query, domain?, expertise?): Promise<SwarmMemoryEntry[]>;
  
  // State management
  async getAgentMemorySnapshot(agentId): Promise<MemorySnapshot>;
  async exportMemory(agentId?): Promise<ExportedMemory>;
  async clearMemory(agentId?): Promise<void>;
}
```

**SwarmMemoryEntry**:

```typescript
interface SwarmMemoryEntry {
  id: string;
  agentId: string;
  type: 'knowledge'|'result'|'state'|'communication'|'error';
  content: any;
  timestamp: Date;
  metadata: {
    taskId?: string;
    objectiveId?: string;
    tags?: string[];
    priority?: number;  // 1-5
    shareLevel?: 'private'|'team'|'public';
    originalId?: string;
    sharedFrom?: string;
    sharedTo?: string;
    sharedAt?: Date;
  };
}
```

**Share Levels**:
- **private**: Only owner can access
- **team**: Team members can access
- **public**: All agents can access

---

## 3. INTEGRATION POINTS

### Hooks Integration

**File**: `/home/user/ai-claude-flow/src/services/agentic-flow-hooks/memory-hooks.ts`

**Pre-Memory Store Hook**:

```typescript
export const preMemoryStoreHook = {
  id: 'agentic-pre-memory-store',
  type: 'pre-memory-store',
  priority: 100,
  
  handler: async (
    payload: MemoryHookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult> => {
    // Validation
    const validation = await validateMemoryStore(namespace, key, value, context);
    
    // Compression for large values
    let processedValue = value;
    if (shouldCompress(value)) {
      processedValue = await compressValue(value);
    }
    
    // Metadata enrichment
    const enrichedValue = {
      data: processedValue,
      metadata: {
        stored: Date.now(),
        provider,
        sessionId: context.sessionId,
        compressed: processedValue !== value,
        size: getValueSize(processedValue),
      },
    };
    
    // Track memory usage
    return {
      continue: true,
      modified: true,
      payload: {
        ...payload,
        value: enrichedValue,
      },
      sideEffects: [
        { type: 'metric', action: 'update', data: {...} }
      ],
    };
  }
};
```

**Post-Memory Store Hook**:

```typescript
export const postMemoryStoreHook = {
  id: 'agentic-post-memory-store',
  type: 'post-memory-store',
  priority: 100,
  
  handler: async (
    payload: MemoryHookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult> => {
    // Cross-provider synchronization
    if (payload.crossProvider && payload.syncTargets) {
      for (const target of payload.syncTargets) {
        sideEffects.push({
          type: 'memory',
          action: 'sync',
          data: { source: payload.provider, target, ... }
        });
      }
    }
    
    // Update memory index
    await updateMemoryIndex(namespace, key, value, context);
    
    // Neural pattern detection
    const patterns = await detectMemoryPatterns(...);
    
    // Emit events
    return { continue: true, sideEffects: [...] };
  }
};
```

**Hook Operations**:
1. **Pre-Store**: Validation, compression, enrichment
2. **Post-Store**: Indexing, cross-sync, pattern detection
3. **Metrics**: Track usage patterns
4. **Events**: Emit memory change notifications

### SPARC Workflow Integration

**Memory Role in SPARC**:

1. **Specification Phase**: Store requirements
   - Namespace: `sparc:requirements`
   - Tags: ['requirement', 'phase:spec']

2. **Pseudocode Phase**: Store algorithm design
   - Namespace: `sparc:pseudocode`
   - Tags: ['algorithm', 'phase:pseudocode']

3. **Architecture Phase**: Store design decisions
   - Namespace: `sparc:architecture`
   - Tags: ['design', 'phase:architecture']

4. **Refinement Phase**: Store implementation details
   - Namespace: `sparc:refinement`
   - Tags: ['implementation', 'phase:refinement']

5. **Completion Phase**: Store results
   - Namespace: `sparc:completion`
   - Tags: ['result', 'phase:completion']

**Cross-Phase Recall**:
```javascript
// Get all decision history
const decisions = await memory.recall({
  tags: ['design', 'decision'],
  since: projectStart,
  limit: 100
});

// Get phase-specific memory
const specRequirements = await memory.recall({
  namespace: 'sparc:requirements',
  type: 'knowledge'
});
```

### Swarm Coordination via Memory

**Agent-to-Agent Communication**:

```javascript
// Agent 1 stores state
await swarm.remember('agent-1', 'state', {
  status: 'analyzing',
  currentFile: 'src/index.js',
  progress: 45
}, {
  taskId: 'task-123',
  shareLevel: 'team'
});

// Agent 2 retrieves shared state
const sharedState = await swarm.recall({
  agentId: 'agent-1',
  type: 'state',
  shareLevel: 'team'
});
```

**Task Coordination**:

```javascript
// Coordinator stores task
await memory.store('task:123', {
  description: 'Code review',
  status: 'assigned',
  assignee: 'agent-1',
  priority: 'high'
}, {
  namespace: 'tasks',
  tags: ['task', 'code-review']
});

// Agent queries tasks
const myTasks = await memory.search({
  pattern: 'task:*',
  namespace: 'tasks',
  tags: ['code-review'],
  limit: 10
});
```

---

## 4. MCP TOOLS & OPERATIONS

### Memory-Related MCP Tools

**Files**:
- `/src/mcp/swarm-tools.ts`
- `/src/mcp/ruv-swarm-tools.ts`
- `/src/mcp/tools.ts`

**Available Memory Operations**:

```typescript
// From swarm-tools.ts
export const swarmTools = [
  memoryStoreTool,      // Store memory via MCP
  memoryRetrieveTool,   // Retrieve memory via MCP
  dispatchAgentTool,
  swarmStatusTool
];
```

**Memory Store Tool**:

```typescript
{
  name: 'memory_store',
  description: 'Store data in shared memory system',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Memory key' },
      value: { type: 'any', description: 'Data to store' },
      namespace: { type: 'string', description: 'Memory namespace' },
      ttl: { type: 'number', description: 'TTL in seconds (optional)' },
      tags: { type: 'array', items: { type: 'string' } },
      metadata: { type: 'object' }
    },
    required: ['key', 'value']
  },
  handler: async (input, context) => {
    const result = await memoryManager.store(
      input.key,
      input.value,
      {
        namespace: input.namespace || 'default',
        ttl: input.ttl,
        tags: input.tags,
        metadata: input.metadata
      }
    );
    return { success: true, result };
  }
}
```

**Memory Retrieve Tool**:

```typescript
{
  name: 'memory_retrieve',
  description: 'Retrieve data from shared memory',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string' },
      namespace: { type: 'string', default: 'default' }
    },
    required: ['key']
  },
  handler: async (input, context) => {
    const value = await memoryManager.retrieve(
      input.key,
      input.namespace
    );
    return { success: true, value };
  }
}
```

### Tool Registry & Discovery

**File**: `/src/mcp/tools.ts`

```typescript
class ToolRegistry extends EventEmitter {
  private tools: Map<string, MCPTool>;
  private capabilities: Map<string, ToolCapability>;
  private metrics: Map<string, ToolMetrics>;
  
  register(tool: MCPTool, capability?: ToolCapability): void;
  getTool(name: string): MCPTool | undefined;
  listTools(): Array<{ name: string; description: string }>;
  
  async executeTool(
    name: string,
    input: unknown,
    context?: any
  ): Promise<unknown>;
  
  discoverTools(query: ToolDiscoveryQuery): MCPTool[];
  getToolMetrics(name: string): ToolMetrics;
}
```

---

## 5. REASONINGBANK INTEGRATION

**File**: `/home/user/ai-claude-flow/src/reasoningbank/reasoningbank-adapter.js`

**Integration Pattern**:

```javascript
// Memory model mapping
const memory = {
  id: memoryId,
  type: 'reasoning_memory',
  pattern_data: {
    title: key,           // Memory key → title
    content: value,       // Memory value → content
    domain: namespace,    // Namespace → domain
    agent: agentId,
    task_type: type,      // Memory type
    original_key: key,
    original_value: value,
    namespace: namespace
  },
  confidence: options.confidence || 0.8,
  usage_count: 0
};

// Store with SQLite backend
await ReasoningBank.db.upsertMemory(memory);

// Generate embedding for semantic search
const embedding = await ReasoningBank.computeEmbedding(value);
await ReasoningBank.db.upsertEmbedding({
  id: memoryId,
  model: 'text-embedding-3-small',
  dims: embedding.length,
  vector: embedding
});
```

**Semantic Search**:

```javascript
// Query with semantic search via ReasoningBank
const results = await ReasoningBank.retrieveMemories(searchQuery, {
  domain: namespace,
  agent: agentId,
  k: limit,
  minConfidence: minConfidence
});

// Results include MMR ranking
// { id, title, content, description, score, components }
```

---

## 6. PERSISTENCE MECHANISMS

### Directory Organization

**Local Storage Paths**:

```
Project Root
├── .swarm/                    # Swarm-specific memory
│   ├── memory.db             # SQLite database
│   ├── entries.json          # Serialized entries
│   └── knowledge-bases.json  # Knowledge base index
│
├── .hive-mind/               # Hive-mind memory
│   ├── memory.db             # SQLite database
│   ├── sessions/             # Session files
│   └── agents/               # Agent memory files
│
└── memory/                    # Backup/markdown memory
    ├── index.json            # Entry index
    ├── agents/               # Agent-specific files
    └── sessions/             # Session-specific files
```

### Serialization Strategy

**Enhanced Session Serializer**:

```javascript
class EnhancedSessionSerializer {
  serialize(data: any): string    // JSON + compression
  deserialize(data: string): any  // Decompression + parsing
  
  // Handles:
  // - Circular references
  // - Date serialization
  // - Symbol handling
  // - Large data compression
}
```

### Sync Strategy

**Cache ↔ Database Sync**:

```javascript
// Periodic sync (default 5s interval)
private async syncCache(): Promise<void> {
  const dirtyEntries = this.cache.getDirtyEntries();
  
  for (const entry of dirtyEntries) {
    await this.backend.store(entry);
  }
  
  this.cache.markClean(dirtyEntries.map(e => e.id));
  this.eventBus.emit('memory:synced', { entries: dirtyEntries });
}

// Final flush on close
private async flushCache(): Promise<void> {
  const allEntries = this.cache.getAllEntries();
  
  for (const entry of allEntries) {
    await this.backend.store(entry);
  }
}
```

---

## 7. IMPLEMENTATION REQUIREMENTS FOR REIMPLEMENTATION

### Core Components to Reimplement

1. **SharedMemoryStore**
   - SQLite database with better-sqlite3
   - LRU cache with memory pressure handling
   - TTL/expiration mechanism
   - Migration system (versions 1-2)

2. **MemoryManager**
   - Backend abstraction (interface)
   - Cache layer coordination
   - Index management
   - Bank management for agents

3. **Backends**
   - SQLiteBackend (primary)
   - MarkdownBackend (secondary)
   - HybridBackend (combination)

4. **Indexing System**
   - Multi-index architecture (agent, session, type, tags, time)
   - Fast query execution
   - Index synchronization

5. **SwarmMemory**
   - Memory sharing/broadcasting
   - Knowledge base management
   - Agent-specific memory banks
   - Cross-agent state coordination

6. **Hook System**
   - Pre-store validation/compression
   - Post-store indexing/sync
   - Metric tracking
   - Event emission

### Key Features to Preserve

- **Namespacing**: Logical organization of data
- **TTL Support**: Automatic expiration
- **Tags & Search**: Flexible retrieval
- **Compression**: Large value handling
- **Metrics**: Performance tracking
- **Cross-Agent Sharing**: With permission levels
- **Knowledge Bases**: Domain-specific memory
- **Session Persistence**: State recovery

### Performance Targets

- Cache hit rate: >80% for active workloads
- Query latency: <10ms for indexed queries
- Write throughput: >1000 ops/sec
- Memory overhead: <100MB for 10K entries
- Sync interval: 5-second intervals

