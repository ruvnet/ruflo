# Memory Architecture Analysis - Complete Overview

## Summary

This analysis provides a comprehensive breakdown of the memory persistence architecture in ai-claude-flow, including storage layer implementation, memory operations, and integration points with hooks, SPARC workflow, swarm coordination, and MCP tools.

## Documents Generated

### 1. MEMORY_ARCHITECTURE_ANALYSIS.md (806 lines)
**Complete Technical Analysis** - Covers:
- Storage Layer Analysis (SharedMemoryStore, MemoryManager, Backends)
- Memory Operations (Cache, Indexing, SwarmMemory)
- Integration Points (Hooks, SPARC, Swarm Coordination)
- MCP Tools & Operations
- ReasoningBank Integration
- Persistence Mechanisms
- Implementation Requirements

**Best for**: Deep technical understanding, architecture decisions, implementation planning

### 2. MEMORY_IMPLEMENTATION_QUICK_REFERENCE.md (293 lines)
**Quick Reference Guide** - Includes:
- Key Files & Locations (14 major components)
- Database Storage Paths
- Key Namespaces (System, SPARC, Custom)
- Default Configuration
- Critical Method Signatures
- Performance Characteristics
- Testing & Verification
- Troubleshooting Guide
- 8-Phase Migration Path

**Best for**: Quick lookups, configuration, testing, troubleshooting

---

## Architecture Highlights

### Storage Layer (23 files analyzed)
```
SharedMemory (primary)
├── SQLite Backend (better-sqlite3)
├── LRU Cache (1000 entries, 50MB default)
├── TTL/Expiration System
├── Compression (>10KB automatic)
└── Multiple Indexes (namespace, access, tags)

MemoryManager (advanced)
├── Backend Abstraction
├── Cache Coordination
├── Index Management
└── Bank Management (per-agent)

Backends
├── SQLiteBackend (structured, ACID)
├── MarkdownBackend (human-readable)
└── HybridBackend (primary + backup)
```

### Memory Operations
```
Caching Strategy
├── LRU Eviction
├── Dirty Flag Tracking
├── Prefix-based Retrieval
└── Hit/Miss Metrics

Indexing Strategy
├── Agent Index (agentId)
├── Session Index (sessionId)
├── Type Index (memory type)
├── Tag Index (searchable tags)
└── Time Index (timestamp ordering)

SwarmMemory Coordination
├── Agent-to-Agent Communication
├── Knowledge Base Management
├── Memory Sharing/Broadcasting
└── Cross-Agent State Coordination
```

### Integration Points
```
Hooks System
├── Pre-Store Hooks (validation, compression)
├── Post-Store Hooks (indexing, sync)
├── Metric Tracking
└── Event Emission

SPARC Workflow
├── Specification Phase (requirements)
├── Pseudocode Phase (algorithms)
├── Architecture Phase (design)
├── Refinement Phase (implementation)
└── Completion Phase (results)

MCP Tools
├── memory_store (MCP operation)
├── memory_retrieve (MCP operation)
├── Tool Registry (discovery)
└── Tool Metrics (tracking)

ReasoningBank Integration
├── Memory ↔ Pattern Mapping
├── Embedding Generation
├── Semantic Search (MMR ranking)
└── Query Caching (100 results, 60s TTL)
```

---

## Key Files Summary

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| **Core** | shared-memory.js | ~790 | Primary implementation |
| | manager.ts | ~472 | Orchestrator |
| **Cache** | cache.ts | ~240 | LRU with pressure handling |
| **Indexing** | indexer.ts | ~236 | Multi-index queries |
| **Backends** | backends/sqlite.ts | ~349 | SQLite implementation |
| | backends/markdown.ts | ~80 | Markdown backup |
| **Swarm** | swarm-memory.ts | ~634 | Agent coordination |
| **Hooks** | memory-hooks.ts | ~150 | Hook integration |
| **Enhanced** | enhanced-memory.js | ~250 | Advanced operations |
| **ReasoningBank** | reasoningbank-adapter.js | ~200 | Semantic search |

---

## Storage Paths

```
.swarm/memory.db              # Swarm-specific SQLite
.hive-mind/memory.db          # Hive-mind SQLite
memory/index.json             # Markdown backup index
```

---

## Namespaces

### System (Swarm Namespaces)
- `swarm:agents` - Agent information
- `swarm:tasks` - Task management
- `swarm:communications` - Inter-agent messages
- `swarm:consensus` - Decision tracking
- `swarm:patterns` - Neural patterns
- `swarm:metrics` - Performance data
- `swarm:coordination` - Coordination state

### SPARC Phases
- `sparc:requirements` - Specification
- `sparc:pseudocode` - Algorithm design
- `sparc:architecture` - System design
- `sparc:refinement` - Implementation
- `sparc:completion` - Results

### Custom
- `sessions` - Session state
- `workflows` - Workflow tracking
- `metrics` - Performance metrics
- `agents` - Agent registration
- `tasks` - Task management

---

## Configuration Defaults

| Setting | Default | Purpose |
|---------|---------|---------|
| `cacheSize` | 1000 | Max cache entries |
| `cacheMemoryMB` | 50 | Max cache memory |
| `compressionThreshold` | 10240 | Compress if >10KB |
| `gcInterval` | 300000 | GC every 5 minutes |
| `syncInterval` | 10000 | Sync every 10 seconds |
| `maxEntries` | 10000 | Max swarm entries |
| `enableWAL` | true | Write-ahead logging |
| `enableVacuum` | true | Auto-vacuum enabled |

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Cache Hit Rate | >80% |
| Query Latency (indexed) | <10ms |
| Store Throughput | >1000 ops/sec |
| Memory Overhead | <100MB (10K entries) |
| Sync Cycle | 5 seconds |
| Cache Eviction | <5ms overhead |

---

## Implementation Roadmap

### Phase 1: Core Storage (SQLiteBackend)
- Basic store/retrieve operations
- CRUD via SQL
- Table creation

### Phase 2: Caching Layer
- LRU cache implementation
- Memory pressure handling
- Dirty flag tracking

### Phase 3: Indexing System
- Multi-index architecture
- Fast query execution
- Index synchronization

### Phase 4: TTL/Expiration
- TTL field support
- Garbage collection
- Expiration cleanup

### Phase 5: Markdown Backend
- File-based storage
- JSON index tracking
- Backup/recovery

### Phase 6: SwarmMemory
- Agent coordination
- Knowledge bases
- Memory sharing

### Phase 7: Hook System
- Pre/post-store hooks
- Validation & compression
- Metric tracking

### Phase 8: ReasoningBank
- Semantic search
- Embedding generation
- MMR ranking

---

## Key Interfaces & Types

### MemoryEntry
```typescript
{
  id: string;
  agentId: string;
  sessionId: string;
  type: 'knowledge'|'result'|'state'|'communication'|'error';
  content: string;
  context: Record<string, any>;
  timestamp: Date;
  tags: string[];
  version: number;
  metadata?: Record<string, any>;
  parentId?: string;
}
```

### MemoryQuery
```typescript
{
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

### SwarmMemoryEntry
```typescript
{
  id: string;
  agentId: string;
  type: 'knowledge'|'result'|'state'|'communication'|'error';
  content: any;
  timestamp: Date;
  metadata: {
    taskId?: string;
    objectiveId?: string;
    tags?: string[];
    priority?: number;
    shareLevel?: 'private'|'team'|'public';
    originalId?: string;
    sharedFrom?: string;
    sharedTo?: string;
    sharedAt?: Date;
  };
}
```

---

## Critical Operations

### Store (with options)
```javascript
await memory.store(key, value, {
  namespace: 'tasks',
  ttl: 3600,              // 1 hour
  tags: ['task', 'important'],
  metadata: { priority: 'high' }
});
```

### Query (indexed)
```javascript
const results = await memory.search({
  namespace: 'tasks',
  tags: ['task'],
  pattern: 'task:*',
  limit: 10
});
```

### SwarmMemory Share
```javascript
await swarm.remember(agentId, 'state', content, {
  taskId: 'task-123',
  shareLevel: 'team',     // 'private'|'team'|'public'
  priority: 5
});
```

---

## Testing Strategy

### Unit Tests
- Backend implementations
- Cache operations
- Index queries
- Hook execution

### Integration Tests
- ReasoningBank semantics
- Cross-component sync
- SPARC phase transitions
- Swarm coordination

### Performance Tests
- Cache hit rates
- Query latency
- Sync overhead
- Memory growth

---

## Troubleshooting Checklist

- [ ] Database not locked (single process)
- [ ] Cache settings appropriate for workload
- [ ] TTL settings cleanup inactive data
- [ ] Indexes created on expected columns
- [ ] Sync interval matches expected latency
- [ ] Disk space available
- [ ] Memory limits not exceeded
- [ ] Hook functions returning properly

---

## Related Documentation

- `/src/memory/README.md` - Module documentation
- `/docs/RESEARCH-AGENT-COORDINATION.md` - Agent coordination
- `/docs/AGENT-COORDINATION-SUMMARY.md` - Coordination summary
- `/src/mcp/swarm-tools.ts` - MCP tool definitions

---

## Analysis Methodology

This analysis was performed by:
1. Scanning 23 memory-related files
2. Examining database schemas
3. Analyzing class/function signatures
4. Documenting integration points
5. Tracing data flow through layers
6. Identifying configuration patterns
7. Measuring code complexity
8. Mapping dependencies

Generated: October 23, 2025
Total Analysis: 1,099 lines of documentation covering ~5,000 lines of implementation code.
