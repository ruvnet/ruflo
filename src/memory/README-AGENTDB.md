# AgentDB Integration - v1.3.9

## Overview

This implementation integrates AgentDB v1.3.9 vector database with claude-flow's existing memory system, providing **100% backward compatibility** while adding powerful semantic search capabilities.

## Architecture

### Components

1. **AgentDBMemoryAdapter** (`agentdb-adapter.js`)
   - Extends `EnhancedMemory` class
   - Provides hybrid mode (AgentDB + legacy fallback)
   - Maintains all existing EnhancedMemory methods unchanged
   - Adds new vector search methods

2. **AgentDBBackend** (`backends/agentdb.js`)
   - Direct AgentDB v1.3.9 integration
   - Vector storage with embeddings
   - HNSW search (150x faster than brute force)
   - Quantization support (scalar, binary, product)

3. **LegacyDataBridge** (`migration/legacy-bridge.js`)
   - Safe migration utilities
   - Automatic backups before migration
   - Validation and rollback capabilities
   - Progress tracking

## Usage

### Basic Usage (100% Backward Compatible)

```javascript
import { createMemory } from './src/memory/index.js';

// Default mode - works exactly like before
const memory = createMemory();
await memory.initialize();

// Use all existing methods - unchanged
await memory.store('key', 'value');
const value = await memory.retrieve('key');
```

### AgentDB Enhanced Mode

```javascript
import { AgentDBMemoryAdapter } from './src/memory/index.js';

// Create AgentDB-enhanced memory
const memory = new AgentDBMemoryAdapter({
  mode: 'hybrid', // 'hybrid', 'agentdb', or 'legacy'
  agentdbPath: '.agentdb/claude-flow.db',
  quantization: 'scalar', // 'scalar', 'binary', or 'product'
  enableHNSW: true, // 150x faster search
});

await memory.initialize();

// Store with embedding for semantic search
const embedding = [0.1, 0.2, 0.3, ...]; // 384-dim vector
await memory.storeWithEmbedding('doc1', 'Important document', {
  embedding,
  namespace: 'knowledge',
  metadata: { type: 'documentation' },
});

// Semantic vector search
const results = await memory.vectorSearch(queryEmbedding, {
  k: 10,
  namespace: 'knowledge',
});

// Legacy search still works
const legacyResults = await memory.search('pattern*');
```

### Migration from Legacy

```javascript
import { LegacyDataBridge } from './src/memory/migration/legacy-bridge.js';
import { EnhancedMemory } from './src/memory/enhanced-memory.js';
import { AgentDBMemoryAdapter } from './src/memory/agentdb-adapter.js';

// Create bridge
const bridge = new LegacyDataBridge({ verbose: true });

// Source: legacy memory
const legacyMemory = new EnhancedMemory();
await legacyMemory.initialize();

// Target: AgentDB-enhanced memory
const agentdbMemory = new AgentDBMemoryAdapter({ mode: 'hybrid' });
await agentdbMemory.initialize();

// Migrate with automatic backup
const results = await bridge.migrateToAgentDB(legacyMemory, agentdbMemory, {
  generateEmbedding: async (value) => {
    // Your embedding function here
    return generateEmbedding(value);
  },
  skipEmbedding: ['metrics', 'performance'],
  embedNamespaces: ['knowledge', 'learning', 'sessions'],
  stopOnError: false,
  strictValidation: true,
});

console.log(bridge.generateReport(results));

// Rollback if needed
if (!results.success) {
  await bridge.rollback(results.backupPath, legacyMemory);
}
```

## Operational Modes

### Hybrid Mode (Recommended)

```javascript
const memory = new AgentDBMemoryAdapter({ mode: 'hybrid' });
```

- Uses AgentDB for new vector features
- Falls back to legacy for standard operations
- Graceful degradation on errors
- **Best for production**: safe migration path

### AgentDB-Only Mode

```javascript
const memory = new AgentDBMemoryAdapter({ mode: 'agentdb' });
```

- Requires AgentDB to be available
- Fails if AgentDB initialization fails
- Maximum performance for vector operations
- **Best for**: new deployments, vector-heavy workloads

### Legacy Mode

```javascript
const memory = new AgentDBMemoryAdapter({ mode: 'legacy' });
```

- Disables AgentDB completely
- Uses only legacy memory system
- **Best for**: testing, debugging, rollback scenarios

## Features

### Vector Search with HNSW

```javascript
// Store vectors
await memory.storeWithEmbedding('doc1', content, {
  embedding: vector,
  namespace: 'knowledge',
});

// Search with HNSW (150x faster)
const results = await memory.vectorSearch(queryVector, {
  k: 10,
  namespace: 'knowledge',
});
```

### Quantization Options

```javascript
// Scalar quantization (default) - good balance
const memory = new AgentDBMemoryAdapter({ quantization: 'scalar' });

// Binary quantization - 32x memory reduction
const memory = new AgentDBMemoryAdapter({ quantization: 'binary' });

// Product quantization - 4-32x memory reduction
const memory = new AgentDBMemoryAdapter({ quantization: 'product' });
```

### Knowledge Management

```javascript
// Store knowledge with embedding
await memory.storeKnowledgeWithEmbedding(
  'api-design',
  'rest-principles',
  'REST API design guidelines...',
  { category: 'architecture' },
  embedding
);

// Semantic knowledge search
const results = await memory.searchKnowledgeSemantic(
  'api-design',
  queryEmbedding,
  { limit: 20 }
);
```

### Statistics & Monitoring

```javascript
// Get AgentDB statistics
const stats = await memory.getAgentDBStats();
console.log('Vectors:', stats.vectorCount);
console.log('Index:', stats.indexType);
console.log('Quantization:', stats.quantization);

// Optimize indices
await memory.optimizeAgentDB();
```

## Backward Compatibility

### All Existing Methods Work Unchanged

```javascript
// Session Management
await memory.saveSessionState(sessionId, state);
await memory.resumeSession(sessionId);

// Workflow Tracking
await memory.trackWorkflow(workflowId, data);
await memory.getWorkflowStatus(workflowId);

// Metrics Collection
await memory.recordMetric('taskDuration', 1500);
await memory.getMetrics('taskDuration');

// Agent Coordination
await memory.registerAgent(agentId, config);
await memory.updateAgentStatus(agentId, 'active');

// Knowledge Management (legacy)
await memory.storeKnowledge('domain', 'key', value);
await memory.retrieveKnowledge('domain', 'key');

// Performance Tracking
await memory.trackPerformance('operation', duration);
await memory.getPerformanceStats('operation');
```

### New Methods (Non-Breaking)

```javascript
// Vector operations
memory.storeWithEmbedding(key, value, { embedding });
memory.vectorSearch(query, options);
memory.semanticRetrieve(query, options);

// Enhanced knowledge
memory.storeKnowledgeWithEmbedding(domain, key, value, metadata, embedding);
memory.searchKnowledgeSemantic(domain, queryEmbedding, options);

// Management
memory.isAgentDBAvailable();
memory.getAgentDBStats();
memory.optimizeAgentDB();
memory.exportDataWithVectors();
memory.cleanupAll();
```

## Error Handling

### Graceful Degradation

```javascript
// In hybrid mode, errors are logged but don't fail operations
await memory.storeWithEmbedding('key', 'value', { embedding });
// If AgentDB fails:
// 1. Error is logged
// 2. Data is still stored in legacy system
// 3. Operation succeeds

// In agentdb mode, errors fail fast
const memory = new AgentDBMemoryAdapter({ mode: 'agentdb' });
// If AgentDB fails: throws error immediately
```

### Fallback Behavior

```javascript
// Vector search falls back to pattern search
const results = await memory.vectorSearch(query);
// If AgentDB unavailable:
// 1. Falls back to legacy search
// 2. Warning logged
// 3. Returns legacy results
```

## Performance

### Benchmarks

- **HNSW Search**: 150x faster than brute force
- **Scalar Quantization**: Minimal accuracy loss, 2-4x speedup
- **Binary Quantization**: 32x memory reduction
- **Product Quantization**: 4-32x memory reduction

### Optimization Tips

1. Enable HNSW for large datasets (>10k vectors)
2. Use scalar quantization for best accuracy/performance
3. Use binary quantization for memory-constrained environments
4. Run periodic optimization: `memory.optimizeAgentDB()`

## Testing

```bash
# Run memory tests
npm run test:unit -- src/memory/__tests__/

# Test AgentDB integration
npm run test:integration -- agentdb

# Verify backward compatibility
npm run test -- memory
```

## Troubleshooting

### AgentDB initialization fails

**Solution**: Check that agentdb@1.3.9 is installed:
```bash
npm install agentdb@1.3.9 --legacy-peer-deps
```

### Migration fails

**Solution**: Check backup file exists:
```javascript
const results = await bridge.migrateToAgentDB(source, target);
if (!results.success) {
  console.log('Backup:', results.backupPath);
  await bridge.rollback(results.backupPath, source);
}
```

### Vector search returns unexpected results

**Solution**: Verify embedding dimensions match:
```javascript
const stats = await memory.getAgentDBStats();
console.log('Expected dimensions:', stats.dimensions);
```

## Migration Checklist

- [ ] Install AgentDB v1.3.9
- [ ] Create AgentDBMemoryAdapter instance in hybrid mode
- [ ] Test existing functionality (backward compatibility)
- [ ] Create backup with LegacyDataBridge
- [ ] Migrate data with embedding generation
- [ ] Validate migration
- [ ] Test vector search functionality
- [ ] Monitor performance improvements
- [ ] Switch to agentdb mode if needed

## References

- [AgentDB Documentation](https://github.com/ruvnet/agentdb)
- [HNSW Algorithm](https://github.com/nmslib/hnswlib)
- [Vector Quantization](https://en.wikipedia.org/wiki/Vector_quantization)
- [claude-flow Memory System](./README.md)
