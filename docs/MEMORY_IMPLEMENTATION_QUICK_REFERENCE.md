# Memory Architecture - Quick Reference Guide

## Key Files & Their Purpose

### Core Storage Layer
- **`/src/memory/shared-memory.js`** - Primary SharedMemoryStore implementation
  - SQLite database with better-sqlite3
  - LRU caching with memory pressure handling
  - TTL/expiration support
  - ~790 lines

- **`/src/memory/manager.ts`** - MemoryManager orchestrator
  - Backend abstraction and coordination
  - Cache synchronization (5-second intervals)
  - Bank management for agents
  - ~472 lines

- **`/src/memory/sqlite-store.js`** - SQLite alternative implementation
  - Simpler SQLite wrapper
  - Compatible with .swarm directory
  - ~200+ lines

### Caching & Indexing
- **`/src/memory/cache.ts`** - LRU Cache implementation
  - Memory pressure handling
  - Dirty flag tracking for sync
  - Hit/miss metrics
  - ~240 lines

- **`/src/memory/indexer.ts`** - Multi-index query engine
  - Agent, session, type, tag, and time indexes
  - Fast set-based queries
  - Index metrics
  - ~236 lines

### Backend Implementations
- **`/src/memory/backends/base.ts`** - IMemoryBackend interface (abstract)
  - Defines contract for all backends
  - ~22 lines

- **`/src/memory/backends/sqlite.ts`** - SQLiteBackend class
  - CRUD operations via SQL
  - Health status monitoring
  - Index creation
  - ~349 lines

- **`/src/memory/backends/markdown.ts`** - MarkdownBackend class
  - Human-readable file storage
  - JSON index tracking
  - Good for backup
  - ~80+ lines

### Swarm-Specific Memory
- **`/src/memory/swarm-memory.ts`** - SwarmMemoryManager
  - Agent-to-agent communication
  - Knowledge base management
  - Memory sharing/broadcasting
  - Cross-agent coordination
  - ~634 lines

### Integration Points
- **`/src/services/agentic-flow-hooks/memory-hooks.ts`** - Hook system
  - Pre-store: validation, compression, enrichment
  - Post-store: indexing, sync, pattern detection
  - Metric tracking and event emission
  - ~150+ lines

### Enhanced Features
- **`/src/memory/enhanced-memory.js`** - Advanced operations
  - Session state management
  - Workflow tracking
  - Metrics collection
  - Agent registration
  - ~250+ lines

- **`/src/memory/enhanced-session-serializer.js`** - Session persistence
  - Serialize/deserialize with compression
  - Handle circular references
  - Symbol and Date handling

### Integration & ReasoningBank
- **`/src/reasoningbank/reasoningbank-adapter.js`** - ReasoningBank integration
  - Memory ↔ ReasoningBank mapping
  - Embedding generation
  - Semantic search via MMR ranking
  - Query caching (100 results, 60s TTL)
  - ~200+ lines

- **`/src/mcp/swarm-tools.ts`** - MCP tool definitions
  - `memoryStoreTool` - Store in memory
  - `memoryRetrieveTool` - Retrieve from memory
  - ~200+ lines

### Configuration & Utilities
- **`/src/memory/index.js`** - Module exports
  - SharedMemory, SwarmMemory, SWARM_NAMESPACES
  - createMemory factory function

- **`/src/memory/migration.js`** - Schema migrations
  - Version 1: Initial schema
  - Version 2: Tags and search capabilities

- **`/src/memory/README.md`** - Complete documentation
  - API reference
  - Usage examples
  - Configuration options

---

## Database Storage Paths

### Development
```
.swarm/memory.db              # Swarm-specific memory (SQLite)
.hive-mind/memory.db          # Hive-mind memory (SQLite)
memory/index.json             # Markdown backup index
```

### Environment Variables
```
CLAUDE_MEMORY_DIR=.hive-mind
CLAUDE_MEMORY_DB=memory.db
CLAUDE_SWARM_DIR=.swarm
```

---

## Key Namespaces

```javascript
// System namespaces
SWARM_NAMESPACES = {
  AGENTS: 'swarm:agents',
  TASKS: 'swarm:tasks',
  COMMUNICATIONS: 'swarm:communications',
  CONSENSUS: 'swarm:consensus',
  PATTERNS: 'swarm:patterns',
  METRICS: 'swarm:metrics',
  COORDINATION: 'swarm:coordination'
}

// SPARC workflow namespaces
sparc:requirements          // Specification phase
sparc:pseudocode            // Algorithm design phase
sparc:architecture          // System design phase
sparc:refinement            // Implementation phase
sparc:completion            // Results phase

// Custom namespaces
sessions                    // Session state
workflows                   // Workflow tracking
metrics                     // Performance metrics
agents                      // Agent registration
tasks                       // Task management
```

---

## Default Configuration

```javascript
{
  // Directory & Database
  directory: '.hive-mind',
  filename: 'memory.db',

  // Caching
  cacheSize: 1000,              // Max entries
  cacheMemoryMB: 50,            // Max memory

  // Persistence
  compressionThreshold: 10240,  // 10KB
  gcInterval: 300000,           // 5 minutes
  enableWAL: true,              // Write-ahead logging
  enableVacuum: true,           // Auto-vacuum
  
  // SwarmMemory
  namespace: 'swarm',
  enableDistribution: true,
  enableReplication: true,
  syncInterval: 10000,          // 10 seconds
  maxEntries: 10000,
  enableKnowledgeBase: true,
  enableCrossAgentSharing: true,
  persistencePath: './swarm-memory'
}
```

---

## Critical Methods & Signatures

### SharedMemory
```javascript
store(key, value, options)      // options: {namespace, ttl, tags, metadata}
retrieve(key, namespace)        // Returns value or null
list(namespace, options)        // options: {limit, offset}
search(options)                 // options: {pattern, namespace, tags, limit, offset}
delete(key, namespace)          // Returns boolean
clear(namespace)                // Clears entire namespace
backup(filepath)                // Creates database backup
getStats()                      // Returns performance statistics
close()                         // Closes database connection
```

### MemoryManager
```typescript
store(entry: MemoryEntry): Promise<void>
retrieve(id: string): Promise<MemoryEntry | undefined>
query(query: MemoryQuery): Promise<MemoryEntry[]>
update(id: string, updates: Partial<MemoryEntry>): Promise<void>
delete(id: string): Promise<void>
performMaintenance(): Promise<void>
getHealthStatus(): Promise<HealthStatus>
```

### SwarmMemory
```typescript
remember(agentId, type, content, metadata): Promise<string>
recall(query: SwarmMemoryQuery): Promise<SwarmMemoryEntry[]>
shareMemory(entryId, targetAgentId): Promise<void>
broadcastMemory(entryId, agentIds?): Promise<void>
createKnowledgeBase(name, description, domain, expertise): Promise<string>
searchKnowledge(query, domain?, expertise?): Promise<SwarmMemoryEntry[]>
getAgentMemorySnapshot(agentId): Promise<MemorySnapshot>
```

---

## Performance Characteristics

| Operation | Latency | Throughput |
|-----------|---------|-----------|
| Cache hit | <1ms | N/A |
| Cache miss + DB | 5-10ms | N/A |
| Indexed query | <10ms | N/A |
| Store operation | 1-5ms | >1000 ops/sec |
| Sync cycle | varies | ~500 entries/5s |

---

## Testing & Verification

### Key Test Files
- `/tests/unit/memory/memory-backends.test.ts` - Backend tests
- `/tests/integration/reasoningbank-integration.test.js` - ReasoningBank tests

### Running Tests
```bash
npm run test -- memory
npm run test -- reasoningbank-integration
```

---

## Troubleshooting

### Database Locked
- Ensure single process access
- Check for orphaned connections
- Clear `.swarm` and `.hive-mind` if corrupted

### High Memory Usage
- Check cache settings (`cacheMemoryMB`)
- Review TTL settings for cleanup
- Monitor index sizes

### Slow Queries
- Verify indexes exist (check schema)
- Check memory compression settings
- Review query complexity

### Sync Issues
- Check `syncInterval` configuration
- Verify backend connectivity
- Review disk space availability

---

## Migration Path

For reimplementation, follow this order:

1. **Phase 1**: SQLiteBackend + basic store/retrieve
2. **Phase 2**: LRU Cache implementation
3. **Phase 3**: Indexer for fast queries
4. **Phase 4**: TTL/expiration mechanism
5. **Phase 5**: MarkdownBackend (backup)
6. **Phase 6**: SwarmMemory (agent coordination)
7. **Phase 7**: Hook system integration
8. **Phase 8**: ReasoningBank integration

Each phase should have >90% test coverage before proceeding.
