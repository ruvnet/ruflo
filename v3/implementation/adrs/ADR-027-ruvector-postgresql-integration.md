# ADR-027: RuVector PostgreSQL Integration for Claude-Flow v3

**Status:** Proposed
**Date:** 2026-01-16
**Author:** System Architecture Designer
**Version:** 1.0.0

## Context

Claude-Flow v3 currently uses a hybrid memory backend (ADR-009) combining SQLite for structured queries and AgentDB for vector search. While this approach works well for many use cases, production deployments increasingly require:

1. **Scalable Vector Database** - AgentDB (in-memory HNSW) has limitations for datasets exceeding available RAM
2. **Graph Capabilities** - No native support for graph queries, relationship traversal, or GNN-based analysis
3. **Advanced Neural Processing** - Limited attention mechanism support for complex semantic understanding
4. **Hierarchical Data** - Standard Euclidean embeddings poorly represent hierarchical relationships
5. **Self-Learning Optimization** - No query optimization learning from access patterns
6. **Production Reliability** - Need for proven database with ACID guarantees, replication, and backup

The `@ruvector/postgres-cli` package provides a production-grade PostgreSQL extension with:
- **53+ SQL functions** for vector and graph operations
- **39 attention mechanisms** for neural processing
- **GNN layers** for graph-aware queries
- **Hyperbolic embeddings** for hierarchical data (Poincare ball model)
- **Self-learning query optimizer** that improves with usage

This creates an opportunity to offer users a high-performance alternative to the current memory backend.

## Decision

Integrate `@ruvector/postgres-cli` as an **optional plugin bridge** in Claude-Flow v3, following the plugin architecture established in ADR-015-v2. This provides a production-grade vector database option while maintaining backward compatibility with existing AgentDB deployments.

### Design Principles

1. **Plugin-Based** - Follows ADR-015-v2 unified plugin system
2. **Optional Dependency** - PostgreSQL not required; graceful fallback to AgentDB
3. **MCP Tool Exposure** - All vector/graph operations available as MCP tools
4. **Async-First** - All operations async with batching support
5. **Security-First** - Credential management, parameterized queries, resource limits

## Key Features to Support

### 1. Vector Operations (53+ SQL Functions)

| Category | Functions | Description |
|----------|-----------|-------------|
| **Similarity** | `cosine_similarity`, `euclidean_distance`, `dot_product`, `manhattan_distance` | Distance metrics for vector comparison |
| **Aggregation** | `vector_avg`, `vector_sum`, `vector_centroid` | Vector aggregation operations |
| **Transformation** | `vector_normalize`, `vector_quantize`, `vector_project` | Vector transformations |
| **HNSW Index** | `hnsw_search`, `hnsw_insert`, `hnsw_bulk_insert` | High-performance vector indexing |
| **Hyperbolic** | `poincare_distance`, `poincare_centroid`, `lorentz_transform` | Hyperbolic geometry operations |

### 2. Attention Mechanisms (39 Types)

| Mechanism | Use Case |
|-----------|----------|
| **Self-Attention** | Intra-sequence relationships |
| **Multi-Head** | Parallel attention patterns |
| **Cross-Attention** | Query-document matching |
| **Sparse Attention** | Long-sequence efficiency |
| **Linear Attention** | O(n) complexity attention |
| **Flash Attention** | Memory-efficient GPU attention |
| **Rotary Position** | Relative position encoding |
| **ALiBi** | Length extrapolation |
| **Sliding Window** | Local context attention |
| **Gated Attention** | Controlled information flow |

### 3. Graph Neural Network Layers

```sql
-- Example: GNN-enhanced semantic search
SELECT * FROM ruvector.gnn_search(
  query_embedding := $1,
  graph_context := 'code_dependencies',
  layers := ARRAY['GAT', 'GraphSAGE'],
  k := 10,
  depth := 2
);
```

| Layer Type | Description |
|------------|-------------|
| **GCN** | Graph Convolutional Network |
| **GAT** | Graph Attention Network |
| **GraphSAGE** | Inductive node embedding |
| **GIN** | Graph Isomorphism Network |
| **EdgeConv** | Edge-aware convolutions |

### 4. Hyperbolic Embeddings

Hyperbolic space naturally represents hierarchical relationships (code AST, dependency trees, organizational structures) with exponentially more capacity than Euclidean space.

```typescript
interface HyperbolicConfig {
  model: 'poincare' | 'lorentz' | 'klein';
  curvature: number;        // Default: -1.0
  dimensions: number;       // Typically 64-256 (less than Euclidean)
  trainable: boolean;       // Learn curvature from data
}
```

### 5. Self-Learning Query Optimization

The query optimizer learns from access patterns to:
- **Index Selection** - Automatically choose optimal indexes
- **Query Rewriting** - Optimize query plans based on data distribution
- **Cache Warming** - Pre-load frequently accessed vectors
- **Partition Routing** - Direct queries to relevant partitions

```sql
-- Enable self-learning optimizer
SELECT ruvector.enable_learning_optimizer(
  learning_rate := 0.01,
  exploration_factor := 0.1,
  min_samples := 1000
);
```

## Architecture

### Plugin Structure

```
v3/@claude-flow/plugins/src/
├── bridges/
│   └── ruvector-postgres/
│       ├── index.ts                 # Plugin entry point
│       ├── plugin.ts                # IPlugin implementation
│       ├── connection-manager.ts    # PostgreSQL connection pooling
│       ├── query-builder.ts         # SQL query builder
│       ├── embedding-adapter.ts     # Embedding format conversion
│       ├── graph-adapter.ts         # Graph operations adapter
│       ├── attention-adapter.ts     # Attention mechanism adapter
│       ├── migration-helper.ts      # AgentDB migration utilities
│       └── types.ts                 # TypeScript interfaces
├── mcp-tools/
│   └── ruvector-postgres-tools.ts   # MCP tool definitions
└── collections/
    └── storage/
        └── ruvector-postgres.ts     # Collection entry
```

### Plugin Implementation

```typescript
// v3/@claude-flow/plugins/src/bridges/ruvector-postgres/plugin.ts

import { IPlugin, PluginMetadata, PluginContext } from '../../core/plugin-interface.js';
import { ConnectionManager } from './connection-manager.js';
import { QueryBuilder } from './query-builder.js';

export class RuVectorPostgresPlugin implements IPlugin {
  readonly metadata: PluginMetadata = {
    name: 'ruvector-postgres',
    version: '1.0.0',
    description: 'RuVector PostgreSQL integration for high-performance vector/graph operations',
    author: 'Claude Flow Team',
    tags: ['vector', 'graph', 'postgresql', 'storage', 'production'],
    dependencies: [
      { name: 'core-plugin', version: '^3.0.0' }
    ],
    capabilities: ['network', 'memory'],
  };

  private connectionManager: ConnectionManager | null = null;
  private queryBuilder: QueryBuilder | null = null;
  private context: PluginContext | null = null;

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;

    const config = context.config.get<RuVectorPostgresConfig>('ruvector-postgres');
    if (!config) {
      context.logger.warn('RuVector PostgreSQL not configured, plugin disabled');
      return;
    }

    // Initialize connection pool
    this.connectionManager = new ConnectionManager({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl,
      poolSize: config.poolSize ?? 10,
      idleTimeout: config.idleTimeout ?? 30000,
      connectionTimeout: config.connectionTimeout ?? 5000,
    });

    await this.connectionManager.initialize();

    // Initialize query builder
    this.queryBuilder = new QueryBuilder({
      schema: config.schema ?? 'ruvector',
      defaultDimensions: config.dimensions ?? 1536,
      enableLearning: config.enableLearning ?? true,
    });

    // Verify RuVector extension is installed
    await this.verifyExtension();

    context.logger.info('RuVector PostgreSQL plugin initialized');
  }

  async shutdown(): Promise<void> {
    if (this.connectionManager) {
      await this.connectionManager.shutdown();
      this.connectionManager = null;
    }
    this.context?.logger.info('RuVector PostgreSQL plugin shut down');
  }

  getMCPTools(): MCPTool[] {
    return [
      this.createVectorSearchTool(),
      this.createGraphSearchTool(),
      this.createAttentionQueryTool(),
      this.createBulkInsertTool(),
      this.createHyperbolicSearchTool(),
      this.createOptimizeIndexTool(),
    ];
  }

  private async verifyExtension(): Promise<void> {
    const result = await this.connectionManager!.query(
      "SELECT extversion FROM pg_extension WHERE extname = 'ruvector'"
    );
    if (result.rows.length === 0) {
      throw new Error(
        'RuVector PostgreSQL extension not installed. ' +
        'Install with: CREATE EXTENSION ruvector;'
      );
    }
  }

  // Tool implementations...
}
```

### Connection Pooling

```typescript
// v3/@claude-flow/plugins/src/bridges/ruvector-postgres/connection-manager.ts

import { Pool, PoolClient, PoolConfig } from 'pg';

export interface ConnectionManagerConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean | object;
  poolSize: number;
  idleTimeout: number;
  connectionTimeout: number;
}

export class ConnectionManager {
  private pool: Pool | null = null;
  private config: ConnectionManagerConfig;
  private healthCheckInterval: NodeJS.Timer | null = null;
  private stats = {
    totalConnections: 0,
    activeConnections: 0,
    idleConnections: 0,
    waitingClients: 0,
    totalQueries: 0,
    failedQueries: 0,
    avgQueryTime: 0,
  };

  constructor(config: ConnectionManagerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    const poolConfig: PoolConfig = {
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl,
      max: this.config.poolSize,
      idleTimeoutMillis: this.config.idleTimeout,
      connectionTimeoutMillis: this.config.connectionTimeout,
    };

    this.pool = new Pool(poolConfig);

    // Set up event listeners
    this.pool.on('connect', () => {
      this.stats.totalConnections++;
      this.stats.activeConnections++;
    });

    this.pool.on('remove', () => {
      this.stats.activeConnections--;
    });

    this.pool.on('error', (err) => {
      this.stats.failedQueries++;
      console.error('PostgreSQL pool error:', err);
    });

    // Verify connection
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }

    // Start health check
    this.healthCheckInterval = setInterval(
      () => this.performHealthCheck(),
      30000
    );
  }

  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async query<T = unknown>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number }> {
    if (!this.pool) {
      throw new Error('Connection pool not initialized');
    }

    const start = Date.now();
    this.stats.totalQueries++;

    try {
      const result = await this.pool.query(sql, params);
      const duration = Date.now() - start;
      this.updateAvgQueryTime(duration);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    } catch (error) {
      this.stats.failedQueries++;
      throw error;
    }
  }

  async withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    if (!this.pool) {
      throw new Error('Connection pool not initialized');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async batch<T>(
    operations: Array<{ sql: string; params?: unknown[] }>
  ): Promise<T[]> {
    return this.withTransaction(async (client) => {
      const results: T[] = [];
      for (const op of operations) {
        const result = await client.query(op.sql, op.params);
        results.push(result.rows as T);
      }
      return results;
    });
  }

  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  private async performHealthCheck(): Promise<void> {
    try {
      await this.query('SELECT 1');
    } catch (error) {
      console.error('Health check failed:', error);
    }
  }

  private updateAvgQueryTime(duration: number): void {
    const n = this.stats.totalQueries;
    this.stats.avgQueryTime =
      (this.stats.avgQueryTime * (n - 1) + duration) / n;
  }
}
```

### MCP Tool Definitions

```typescript
// v3/@claude-flow/plugins/src/mcp-tools/ruvector-postgres-tools.ts

import type { MCPTool } from '../core/types.js';

export const ruvectorPostgresTools: MCPTool[] = [
  {
    name: 'ruvector-postgres/vector-search',
    description: 'Perform high-performance vector similarity search using PostgreSQL HNSW index',
    category: 'storage',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text query to embed and search'
        },
        embedding: {
          type: 'array',
          items: { type: 'number' },
          description: 'Pre-computed embedding vector (alternative to query)'
        },
        table: {
          type: 'string',
          description: 'Table name to search',
          default: 'embeddings'
        },
        k: {
          type: 'number',
          description: 'Number of results to return',
          default: 10
        },
        metric: {
          type: 'string',
          enum: ['cosine', 'euclidean', 'dot_product', 'manhattan'],
          default: 'cosine'
        },
        threshold: {
          type: 'number',
          description: 'Minimum similarity threshold (0-1)',
          default: 0.7
        },
        filters: {
          type: 'object',
          description: 'Additional SQL WHERE conditions'
        }
      },
      oneOf: [
        { required: ['query'] },
        { required: ['embedding'] }
      ]
    },
    handler: async (input, context) => {
      const plugin = context.services.get<RuVectorPostgresPlugin>('ruvector-postgres');
      return plugin.vectorSearch(input);
    }
  },

  {
    name: 'ruvector-postgres/graph-search',
    description: 'Execute graph-aware semantic search using GNN layers',
    category: 'storage',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text query' },
        graphContext: {
          type: 'string',
          description: 'Graph context name (e.g., "code_dependencies", "knowledge_graph")'
        },
        layers: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['GCN', 'GAT', 'GraphSAGE', 'GIN', 'EdgeConv']
          },
          default: ['GAT']
        },
        depth: {
          type: 'number',
          description: 'Graph traversal depth',
          default: 2
        },
        k: { type: 'number', default: 10 }
      },
      required: ['query', 'graphContext']
    },
    handler: async (input, context) => {
      const plugin = context.services.get<RuVectorPostgresPlugin>('ruvector-postgres');
      return plugin.graphSearch(input);
    }
  },

  {
    name: 'ruvector-postgres/attention-query',
    description: 'Execute attention-weighted semantic query with configurable mechanism',
    category: 'storage',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        documents: {
          type: 'array',
          items: { type: 'string' },
          description: 'Documents to attend over (or table name)'
        },
        mechanism: {
          type: 'string',
          enum: [
            'self', 'multi_head', 'cross', 'sparse', 'linear',
            'flash', 'rotary', 'alibi', 'sliding_window', 'gated'
          ],
          default: 'multi_head'
        },
        heads: { type: 'number', default: 8 },
        contextWindow: { type: 'number', default: 4096 }
      },
      required: ['query']
    },
    handler: async (input, context) => {
      const plugin = context.services.get<RuVectorPostgresPlugin>('ruvector-postgres');
      return plugin.attentionQuery(input);
    }
  },

  {
    name: 'ruvector-postgres/bulk-insert',
    description: 'Bulk insert vectors with automatic batching (52,000+ inserts/sec)',
    category: 'storage',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', default: 'embeddings' },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              embedding: { type: 'array', items: { type: 'number' } },
              metadata: { type: 'object' }
            },
            required: ['id', 'content']
          }
        },
        batchSize: { type: 'number', default: 1000 },
        generateEmbeddings: { type: 'boolean', default: true }
      },
      required: ['entries']
    },
    handler: async (input, context) => {
      const plugin = context.services.get<RuVectorPostgresPlugin>('ruvector-postgres');
      return plugin.bulkInsert(input);
    }
  },

  {
    name: 'ruvector-postgres/hyperbolic-search',
    description: 'Search using hyperbolic embeddings for hierarchical data',
    category: 'storage',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        model: {
          type: 'string',
          enum: ['poincare', 'lorentz', 'klein'],
          default: 'poincare'
        },
        curvature: { type: 'number', default: -1.0 },
        k: { type: 'number', default: 10 },
        includeAncestors: { type: 'boolean', default: false },
        includeDescendants: { type: 'boolean', default: false }
      },
      required: ['query']
    },
    handler: async (input, context) => {
      const plugin = context.services.get<RuVectorPostgresPlugin>('ruvector-postgres');
      return plugin.hyperbolicSearch(input);
    }
  },

  {
    name: 'ruvector-postgres/optimize',
    description: 'Optimize indexes and enable self-learning query optimizer',
    category: 'storage',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        operations: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'rebuild_hnsw', 'analyze', 'vacuum',
              'enable_learning', 'warmup_cache', 'create_partitions'
            ]
          },
          default: ['analyze']
        },
        learningConfig: {
          type: 'object',
          properties: {
            learningRate: { type: 'number', default: 0.01 },
            explorationFactor: { type: 'number', default: 0.1 },
            minSamples: { type: 'number', default: 1000 }
          }
        }
      },
      required: ['table']
    },
    handler: async (input, context) => {
      const plugin = context.services.get<RuVectorPostgresPlugin>('ruvector-postgres');
      return plugin.optimize(input);
    }
  }
];
```

### Async Operations with Batching

```typescript
// v3/@claude-flow/plugins/src/bridges/ruvector-postgres/embedding-adapter.ts

export class EmbeddingAdapter {
  private connectionManager: ConnectionManager;
  private embeddingGenerator: (text: string) => Promise<Float32Array>;
  private batchQueue: BatchItem[] = [];
  private batchTimeout: NodeJS.Timer | null = null;
  private batchSize = 1000;
  private flushInterval = 100; // ms

  constructor(
    connectionManager: ConnectionManager,
    embeddingGenerator: (text: string) => Promise<Float32Array>,
    config?: { batchSize?: number; flushInterval?: number }
  ) {
    this.connectionManager = connectionManager;
    this.embeddingGenerator = embeddingGenerator;
    this.batchSize = config?.batchSize ?? 1000;
    this.flushInterval = config?.flushInterval ?? 100;
  }

  async insert(entry: EmbeddingEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      this.batchQueue.push({ entry, resolve, reject });
      this.scheduleBatchFlush();
    });
  }

  async bulkInsert(
    entries: EmbeddingEntry[],
    options?: { generateEmbeddings?: boolean }
  ): Promise<{ inserted: number; duration: number }> {
    const start = Date.now();

    // Generate embeddings in parallel batches if needed
    if (options?.generateEmbeddings !== false) {
      const embeddingBatches = this.chunk(entries, 100);
      for (const batch of embeddingBatches) {
        await Promise.all(
          batch
            .filter(e => !e.embedding)
            .map(async (entry) => {
              entry.embedding = await this.embeddingGenerator(entry.content);
            })
        );
      }
    }

    // Insert in batches
    const insertBatches = this.chunk(entries, this.batchSize);
    let inserted = 0;

    for (const batch of insertBatches) {
      const values = batch.map((e, i) => {
        const offset = i * 4;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
      }).join(', ');

      const params = batch.flatMap(e => [
        e.id,
        e.content,
        `[${Array.from(e.embedding!).join(',')}]`,
        JSON.stringify(e.metadata ?? {})
      ]);

      const sql = `
        INSERT INTO embeddings (id, content, embedding, metadata)
        VALUES ${values}
        ON CONFLICT (id) DO UPDATE SET
          content = EXCLUDED.content,
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `;

      const result = await this.connectionManager.query(sql, params);
      inserted += result.rowCount;
    }

    return {
      inserted,
      duration: Date.now() - start
    };
  }

  private scheduleBatchFlush(): void {
    if (this.batchQueue.length >= this.batchSize) {
      this.flushBatch();
      return;
    }

    if (!this.batchTimeout) {
      this.batchTimeout = setTimeout(() => {
        this.batchTimeout = null;
        if (this.batchQueue.length > 0) {
          this.flushBatch();
        }
      }, this.flushInterval);
    }
  }

  private async flushBatch(): Promise<void> {
    const batch = this.batchQueue.splice(0, this.batchSize);
    if (batch.length === 0) return;

    try {
      const entries = batch.map(b => b.entry);
      await this.bulkInsert(entries);
      batch.forEach(b => b.resolve());
    } catch (error) {
      batch.forEach(b => b.reject(error));
    }
  }

  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
```

## Performance Targets

| Metric | Target | Comparison to AgentDB |
|--------|--------|----------------------|
| **Bulk Insert Rate** | 52,000+ inserts/second | 10x faster (batched) |
| **Vector Search Latency** | <1ms (p99) | Comparable (HNSW) |
| **Search Speedup** | HNSW-indexed vs linear | Same (HNSW algorithm) |
| **Graph Query Latency** | <10ms (2-hop) | N/A (new capability) |
| **Attention Query** | <50ms (4K context) | N/A (new capability) |
| **Memory Efficiency** | Disk-based + caching | Better for large datasets |
| **Concurrent Queries** | 100+ parallel | Better (connection pool) |
| **Dataset Size** | TB-scale | GB-scale (memory bound) |

### Benchmark Configuration

```typescript
// Expected benchmark results
const benchmarkTargets = {
  bulkInsert: {
    targetOpsPerSec: 52000,
    batchSize: 1000,
    vectorDimensions: 1536
  },
  vectorSearch: {
    targetLatencyP50: 0.5,  // ms
    targetLatencyP99: 1.0,  // ms
    datasetSize: 1_000_000,
    k: 10
  },
  graphSearch: {
    targetLatencyP50: 5,    // ms
    targetLatencyP99: 10,   // ms
    graphNodes: 100_000,
    depth: 2
  },
  attentionQuery: {
    targetLatencyP50: 20,   // ms
    targetLatencyP99: 50,   // ms
    contextLength: 4096,
    heads: 8
  }
};
```

## Security Considerations

### 1. Connection Credential Management

```typescript
// Configuration with secure credential handling
interface RuVectorPostgresConfig {
  // Direct credentials (development only)
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;

  // Secure credential sources (production)
  connectionString?: string;           // From environment variable
  credentialProvider?: CredentialProvider; // AWS Secrets Manager, Vault, etc.
  sslCertPath?: string;                // Client certificate auth

  // SSL/TLS configuration
  ssl?: {
    rejectUnauthorized: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };
}

// Example secure configuration
const secureConfig: RuVectorPostgresConfig = {
  connectionString: process.env.RUVECTOR_DATABASE_URL,
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync('/etc/ssl/certs/rds-ca-2019-root.pem').toString()
  }
};
```

### 2. Query Parameterization

All queries use parameterized statements to prevent SQL injection:

```typescript
// NEVER do this:
// const sql = `SELECT * FROM embeddings WHERE id = '${userInput}'`;

// ALWAYS use parameterized queries:
const sql = 'SELECT * FROM embeddings WHERE id = $1';
const result = await connectionManager.query(sql, [userInput]);

// Vector queries with proper escaping
const vectorSql = `
  SELECT id, content, embedding <=> $1::vector AS distance
  FROM embeddings
  WHERE embedding <=> $1::vector < $2
  ORDER BY distance
  LIMIT $3
`;
const result = await connectionManager.query(vectorSql, [
  `[${embedding.join(',')}]`,
  threshold,
  k
]);
```

### 3. Resource Limits

```typescript
interface ResourceLimits {
  // Connection limits
  maxPoolSize: number;           // Default: 10
  maxIdleConnections: number;    // Default: 5
  connectionTimeout: number;     // Default: 5000ms

  // Query limits
  maxQueryTimeout: number;       // Default: 30000ms
  maxResultRows: number;         // Default: 10000
  maxBatchSize: number;          // Default: 5000

  // Memory limits
  maxVectorDimensions: number;   // Default: 4096
  maxConcurrentEmbeddings: number; // Default: 100

  // Rate limits
  maxQueriesPerMinute: number;   // Default: 1000
  maxInsertsPerMinute: number;   // Default: 100000
}

// Enforcement in query execution
async query(sql: string, params?: unknown[]): Promise<QueryResult> {
  // Check rate limit
  if (!this.rateLimiter.tryAcquire('query')) {
    throw new RateLimitExceededError('Query rate limit exceeded');
  }

  // Set query timeout
  const timeoutSql = `SET statement_timeout = ${this.limits.maxQueryTimeout}`;
  await this.pool.query(timeoutSql);

  // Execute with result limit
  const limitedSql = sql.includes('LIMIT') ? sql : `${sql} LIMIT ${this.limits.maxResultRows}`;
  return this.pool.query(limitedSql, params);
}
```

### 4. Audit Logging

```typescript
interface AuditLog {
  timestamp: Date;
  operation: 'query' | 'insert' | 'update' | 'delete' | 'admin';
  userId?: string;
  query: string;
  parameters?: unknown[];
  duration: number;
  rowsAffected: number;
  success: boolean;
  errorMessage?: string;
}

// Audit middleware
async function withAudit<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    await logAudit({ operation, success: true, duration: Date.now() - start });
    return result;
  } catch (error) {
    await logAudit({ operation, success: false, error, duration: Date.now() - start });
    throw error;
  }
}
```

## Migration Path

### From AgentDB (ADR-009)

The migration provides a backward-compatible layer that allows gradual transition:

```typescript
// v3/@claude-flow/plugins/src/bridges/ruvector-postgres/migration-helper.ts

export class MigrationHelper {
  private agentDB: AgentDBAdapter;
  private postgres: RuVectorPostgresPlugin;

  constructor(agentDB: AgentDBAdapter, postgres: RuVectorPostgresPlugin) {
    this.agentDB = agentDB;
    this.postgres = postgres;
  }

  /**
   * Export all data from AgentDB to PostgreSQL
   */
  async exportToPostgres(options?: {
    batchSize?: number;
    onProgress?: (progress: MigrationProgress) => void;
  }): Promise<MigrationResult> {
    const batchSize = options?.batchSize ?? 1000;
    const stats = { total: 0, migrated: 0, failed: 0, duration: 0 };
    const start = Date.now();

    // Get all namespaces from AgentDB
    const namespaces = await this.agentDB.listNamespaces();

    for (const namespace of namespaces) {
      const entries = await this.agentDB.getAll(namespace);
      stats.total += entries.length;

      // Batch insert into PostgreSQL
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        try {
          await this.postgres.bulkInsert({
            table: `embeddings_${namespace}`,
            entries: batch.map(e => ({
              id: e.id,
              content: e.content,
              embedding: e.embedding,
              metadata: { ...e.metadata, namespace }
            })),
            generateEmbeddings: false // Already have embeddings
          });
          stats.migrated += batch.length;
        } catch (error) {
          stats.failed += batch.length;
          console.error(`Migration batch failed:`, error);
        }

        options?.onProgress?.({
          ...stats,
          percentage: (stats.migrated + stats.failed) / stats.total * 100
        });
      }
    }

    stats.duration = Date.now() - start;
    return stats;
  }

  /**
   * Create a dual-write adapter that writes to both backends
   */
  createDualWriteAdapter(): IMemoryBackend {
    return new DualWriteAdapter(this.agentDB, this.postgres);
  }

  /**
   * Create a read-through adapter that reads from PostgreSQL with AgentDB fallback
   */
  createReadThroughAdapter(): IMemoryBackend {
    return new ReadThroughAdapter(this.postgres, this.agentDB);
  }
}

/**
 * Dual-write adapter for gradual migration
 */
class DualWriteAdapter implements IMemoryBackend {
  constructor(
    private primary: IMemoryBackend,
    private secondary: IMemoryBackend
  ) {}

  async store(entry: MemoryEntry): Promise<void> {
    // Write to both, primary is source of truth
    await Promise.all([
      this.primary.store(entry),
      this.secondary.store(entry).catch(err => {
        console.warn('Secondary write failed:', err);
      })
    ]);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    // Read from primary
    return this.primary.get(id);
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    // Route based on query type
    if (query.type === 'semantic' && this.secondary instanceof RuVectorPostgresPlugin) {
      return this.secondary.search(query);
    }
    return this.primary.search(query);
  }

  // ... other IMemoryBackend methods
}
```

### Migration Steps

1. **Phase 1: Install and Configure**
   ```bash
   # Install PostgreSQL with RuVector extension
   npm install @ruvector/postgres-cli pg

   # Initialize database
   npx ruvector init --connection-string "$DATABASE_URL"
   ```

2. **Phase 2: Enable Dual-Write**
   ```typescript
   // claude-flow.config.ts
   export default {
     memory: {
       backend: 'dual-write',
       primary: 'agentdb',
       secondary: {
         type: 'ruvector-postgres',
         connectionString: process.env.RUVECTOR_DATABASE_URL
       }
     }
   };
   ```

3. **Phase 3: Migrate Existing Data**
   ```bash
   npx claude-flow migrate \
     --from agentdb \
     --to ruvector-postgres \
     --batch-size 5000
   ```

4. **Phase 4: Switch Primary**
   ```typescript
   export default {
     memory: {
       backend: 'ruvector-postgres',
       fallback: 'agentdb'  // Keep AgentDB as fallback
     }
   };
   ```

5. **Phase 5: Deprecate AgentDB**
   ```typescript
   export default {
     memory: {
       backend: 'ruvector-postgres'
       // AgentDB removed
     }
   };
   ```

### Backward Compatibility Layer

```typescript
// Ensure existing code continues to work
const memory = await createMemoryService({
  backend: 'ruvector-postgres',
  // ... config
});

// All existing IMemoryBackend methods work unchanged
await memory.store(entry);
const result = await memory.get(id);
const results = await memory.search({ content: 'query', k: 10 });

// New capabilities available via plugin API
const plugin = memory.getPlugin('ruvector-postgres');
await plugin.graphSearch({ query: 'code dependencies', graphContext: 'ast' });
await plugin.attentionQuery({ query: 'complex reasoning', mechanism: 'multi_head' });
```

## Consequences

### Positive

1. **Production-Grade Storage** - PostgreSQL provides ACID guarantees, replication, backup, and proven reliability at scale
2. **Graph Capabilities** - Native graph queries enable relationship-aware semantic search (code dependencies, knowledge graphs)
3. **Advanced Neural Processing** - 39 attention mechanisms enable sophisticated query understanding
4. **Hierarchical Data Support** - Hyperbolic embeddings naturally represent tree/hierarchy structures
5. **Self-Learning Optimization** - Query optimizer improves performance over time based on access patterns
6. **Scalability** - Disk-based storage supports TB-scale datasets beyond RAM limits
7. **Ecosystem Integration** - PostgreSQL tooling, monitoring, and expertise widely available
8. **Concurrent Access** - Connection pooling supports high-concurrency workloads

### Negative

1. **PostgreSQL Dependency** - Requires PostgreSQL 14+ with RuVector extension installed
2. **Infrastructure Complexity** - Additional database server to manage (unless using managed PostgreSQL)
3. **Network Latency** - Remote database adds network round-trip vs in-process AgentDB
4. **Learning Curve** - New SQL functions and concepts to learn
5. **Cost** - Managed PostgreSQL services incur additional cloud costs

### Neutral

1. **Migration Effort** - Existing AgentDB deployments need migration (mitigated by dual-write adapter)
2. **Configuration Complexity** - More options to configure (mitigated by sensible defaults)
3. **Query Syntax** - Different query interface than AgentDB (mitigated by unified IMemoryBackend interface)

## Implementation Plan

### Phase 1: Core Plugin (Week 1-2)
- [x] Define plugin interface and types
- [ ] Implement ConnectionManager with pooling
- [ ] Implement QueryBuilder with parameterization
- [ ] Basic vector search (HNSW)
- [ ] Unit tests for core functionality

### Phase 2: Advanced Features (Week 3-4)
- [ ] Graph search with GNN layers
- [ ] Attention mechanism queries
- [ ] Hyperbolic embedding support
- [ ] Self-learning optimizer integration
- [ ] Integration tests

### Phase 3: MCP Tools & Migration (Week 5-6)
- [ ] MCP tool definitions
- [ ] Migration helper utilities
- [ ] Dual-write adapter
- [ ] Documentation
- [ ] Performance benchmarks

### Phase 4: Testing & Polish (Week 7-8)
- [ ] End-to-end tests
- [ ] Security audit
- [ ] Performance optimization
- [ ] CLI integration (`claude-flow memory --backend ruvector-postgres`)
- [ ] User documentation

## References

- **ADR-009**: Hybrid Memory Backend (AgentDB + SQLite)
- **ADR-015-v2**: Unified Plugin System
- **ADR-017**: RuVector Integration Architecture
- **ADR-006**: Unified Memory Service
- **@ruvector/postgres-cli**: https://github.com/ruvnet/ruvector-postgres
- **pgvector**: https://github.com/pgvector/pgvector
- **PostgreSQL**: https://www.postgresql.org/docs/

---

## Appendix A: SQL Function Reference

### Vector Operations

```sql
-- Cosine similarity search
SELECT id, content, 1 - (embedding <=> query_vector) AS similarity
FROM embeddings
WHERE embedding <=> query_vector < 0.3
ORDER BY embedding <=> query_vector
LIMIT 10;

-- Euclidean distance
SELECT id, embedding <-> query_vector AS distance FROM embeddings;

-- Inner product (dot product)
SELECT id, embedding <#> query_vector AS score FROM embeddings;

-- Bulk insert with COPY
COPY embeddings (id, content, embedding, metadata)
FROM STDIN WITH (FORMAT binary);
```

### Graph Operations

```sql
-- Create graph relationship
SELECT ruvector.add_edge('code_deps', $1, $2, $3);

-- GNN-enhanced search
SELECT * FROM ruvector.gnn_search(
  query := $1,
  graph := 'code_deps',
  layers := ARRAY['GAT', 'GraphSAGE'],
  k := 10
);

-- Subgraph extraction
SELECT * FROM ruvector.extract_subgraph('code_deps', $1, depth := 2);
```

### Attention Operations

```sql
-- Multi-head attention query
SELECT * FROM ruvector.attention_query(
  query := $1,
  documents := 'embeddings',
  mechanism := 'multi_head',
  heads := 8
);

-- Cross-attention between tables
SELECT * FROM ruvector.cross_attention(
  queries := 'user_queries',
  keys := 'document_embeddings',
  values := 'document_content'
);
```

### Hyperbolic Operations

```sql
-- Poincare ball distance
SELECT ruvector.poincare_distance($1, $2, curvature := -1.0);

-- Hyperbolic centroid
SELECT ruvector.poincare_centroid(ARRAY[emb1, emb2, emb3]);

-- Hierarchical search
SELECT * FROM ruvector.hyperbolic_search(
  query := $1,
  model := 'poincare',
  include_ancestors := true
);
```

---

## Appendix B: Configuration Examples

### Development Configuration

```typescript
const devConfig: RuVectorPostgresConfig = {
  host: 'localhost',
  port: 5432,
  database: 'claude_flow_dev',
  user: 'dev_user',
  password: 'dev_password',
  poolSize: 5,
  enableLearning: false,
  dimensions: 1536
};
```

### Production Configuration (AWS RDS)

```typescript
const prodConfig: RuVectorPostgresConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync('/etc/ssl/certs/rds-combined-ca-bundle.pem').toString()
  },
  poolSize: 20,
  idleTimeout: 60000,
  enableLearning: true,
  learningConfig: {
    learningRate: 0.01,
    explorationFactor: 0.05,
    minSamples: 10000
  }
};
```

### High-Availability Configuration

```typescript
const haConfig: RuVectorPostgresConfig = {
  // Primary for writes
  primary: {
    connectionString: process.env.PRIMARY_DATABASE_URL,
    poolSize: 10
  },
  // Replicas for reads
  replicas: [
    { connectionString: process.env.REPLICA_1_URL, poolSize: 20 },
    { connectionString: process.env.REPLICA_2_URL, poolSize: 20 }
  ],
  loadBalancing: 'round-robin',
  readFromReplicas: true
};
```

---

**Last Updated:** 2026-01-16
**Next Review:** 2026-02-16
