# Memory Module

Unified memory persistence module for ruv-swarm, providing both generic SharedMemory and MCP-specific SwarmMemory implementations.

## Features

### SharedMemory

- **SQLite Backend**: Robust persistence with better-sqlite3
- **High-Performance Caching**: LRU cache with memory pressure handling
- **Migration Support**: Schema evolution with versioned migrations
- **TTL Support**: Automatic expiration of temporary data
- **Tagging & Search**: Flexible data organization and retrieval
- **Compression**: Automatic compression for large entries
- **Metrics**: Performance tracking and statistics

### SwarmMemory (extends SharedMemory)

- **Agent Management**: Store and track swarm agents
- **Task Coordination**: Persistent task state and assignment
- **Communication History**: Inter-agent message logging
- **Consensus Tracking**: Decision-making history
- **Neural Patterns**: Store and retrieve learned patterns
- **Performance Metrics**: Swarm-specific analytics

## Installation

The memory module is included with ruv-swarm. To use it in your project:

```javascript
import { SharedMemory, SwarmMemory } from './memory/index.js';
```

## Usage

### Basic SharedMemory Usage

```javascript
import { SharedMemory } from './memory/shared-memory.js';

// Initialize
const memory = new SharedMemory({
  directory: '.hive-mind', // Storage directory
  filename: 'memory.db', // Database filename
  cacheSize: 1000, // Max cache entries
  cacheMemoryMB: 50, // Max cache memory in MB
  gcInterval: 300000, // Garbage collection interval (5 min)
});

await memory.initialize();

// Store data
await memory.store(
  'user:123',
  {
    name: 'John Doe',
    preferences: { theme: 'dark' },
  },
  {
    namespace: 'users',
    ttl: 3600, // Expires in 1 hour
    tags: ['active', 'premium'],
    metadata: { source: 'api' },
  },
);

// Retrieve data
const user = await memory.retrieve('user:123', 'users');

// Search by pattern
const results = await memory.search({
  pattern: 'user:*',
  namespace: 'users',
  tags: ['active'],
  limit: 10,
});

// Get statistics
const stats = await memory.getStats();

// Close when done
await memory.close();
```

### SwarmMemory for MCP

```javascript
import { SwarmMemory } from './memory/swarm-memory.js';

const swarm = new SwarmMemory({
  swarmId: 'my-swarm',
  directory: '.swarm',
});

await swarm.initialize();

// Manage agents
await swarm.storeAgent('agent-1', {
  id: 'agent-1',
  name: 'Code Analyzer',
  type: 'analyzer',
  status: 'active',
  capabilities: ['code-review', 'pattern-detection'],
});

// Track tasks
await swarm.storeTask('task-1', {
  id: 'task-1',
  description: 'Analyze codebase',
  priority: 'high',
  status: 'pending',
  assignedAgents: ['agent-1'],
});

// Update task progress
await swarm.updateTaskStatus('task-1', 'in_progress', {
  progress: 25,
  currentFile: 'src/index.js',
});

// Store learned patterns
await swarm.storePattern('pattern-1', {
  id: 'pattern-1',
  type: 'optimization',
  confidence: 0.92,
  data: {
    name: 'parallel-processing',
    conditions: ['large-dataset', 'cpu-intensive'],
    strategy: 'worker-threads',
  },
});

// Find best patterns for context
const patterns = await swarm.findBestPatterns(
  {
    tags: ['optimization', 'performance'],
  },
  5,
);

// Get comprehensive stats
const stats = await swarm.getSwarmStats();
```

## Migration from Old System

To migrate from the old CollectiveMemory or hive-mind database:

```javascript
import { MemoryMigration } from './memory/migration.js';

const migration = new MemoryMigration({
  dryRun: false, // Set to true to preview
  verbose: true, // Show detailed progress
});

const result = await migration.migrate();
console.log('Migration result:', result);
```

## API Reference

### SharedMemory

#### Core Methods

- `initialize()` - Initialize the database and caching system
- `store(key, value, options)` - Store a value with optional namespace, TTL, tags
- `retrieve(key, namespace)` - Get a value by key and namespace
- `list(namespace, options)` - List entries in a namespace
- `delete(key, namespace)` - Delete a specific entry
- `clear(namespace)` - Clear all entries in a namespace
- `search(options)` - Search entries by pattern, tags, or namespace
- `getStats()` - Get memory statistics
- `backup(filepath)` - Backup the database
- `close()` - Close database connection

#### Events

- `initialized` - Database initialized
- `stored` - Data stored successfully
- `deleted` - Data deleted
- `error` - Error occurred
- `gc` - Garbage collection completed

### SwarmMemory

#### Additional Methods

- `storeAgent(agentId, data)` - Store agent information
- `getAgent(agentId)` - Retrieve agent data
- `listAgents(filter)` - List agents with optional filtering
- `storeTask(taskId, data)` - Store task information
- `updateTaskStatus(taskId, status, result)` - Update task progress
- `getTask(taskId)` - Retrieve task data
- `storeCommunication(from, to, message)` - Log agent communication
- `storeConsensus(id, decision)` - Store consensus decision
- `storePattern(id, pattern)` - Store neural pattern
- `updatePatternMetrics(id, success)` - Update pattern performance
- `findBestPatterns(context, limit)` - Find relevant patterns
- `getSwarmStats()` - Get swarm-specific statistics
- `exportSwarmState()` - Export complete swarm state
- `importSwarmState(state)` - Import swarm state

## Configuration Options

### SharedMemory Options

```javascript
{
  directory: '.hive-mind',      // Storage directory
  filename: 'memory.db',        // Database file
  cacheSize: 1000,             // Max cached entries
  cacheMemoryMB: 50,           // Max cache memory
  compressionThreshold: 10240,  // Compress if larger (bytes)
  gcInterval: 300000,          // GC interval (ms)
  enableWAL: true,             // Use Write-Ahead Logging
  enableVacuum: true           // Auto-vacuum database
}
```

### SwarmMemory Options

Inherits all SharedMemory options plus:

```javascript
{
  swarmId: 'my-swarm',         // Swarm identifier
  mcpMode: true                // Enable MCP features
}
```

## Performance Considerations

1. **Caching**: Frequently accessed data is cached in memory
2. **Indexing**: Key database fields are indexed for fast queries
3. **Compression**: Large entries are automatically compressed
4. **Garbage Collection**: Expired entries are cleaned periodically
5. **Connection Pooling**: Prepared statements reduce overhead
6. **Memory Management**: LRU eviction prevents unbounded growth

## Schema

### memory_store table

- `id` - Auto-incrementing primary key
- `key` - Unique key within namespace
- `namespace` - Data namespace
- `value` - Stored value (JSON or string)
- `type` - Value type (json/string)
- `metadata` - Additional metadata (JSON)
- `tags` - Search tags (JSON array)
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp
- `accessed_at` - Last access timestamp
- `access_count` - Number of accesses
- `ttl` - Time to live in seconds
- `expires_at` - Expiration timestamp
- `compressed` - Compression flag
- `size` - Data size in bytes

## Best Practices

1. **Use Namespaces**: Organize data logically
2. **Set TTLs**: Use expiration for temporary data
3. **Tag Data**: Enable efficient searching
4. **Monitor Stats**: Track performance metrics
5. **Regular Backups**: Backup important data
6. **Close Properly**: Always close connections

## Troubleshooting

### Common Issues

1. **Database Locked**: Ensure only one process accesses the database
2. **Memory Growth**: Check cache settings and TTLs
3. **Slow Queries**: Review indexes and search patterns
4. **Migration Errors**: Run with `dryRun: true` first

### Debug Mode

Enable verbose logging:

```javascript
memory.on('error', console.error);
memory.on('stored', console.log);
memory.on('gc', console.log);
```

## License

Part of the ruv-swarm project. See main LICENSE file.
