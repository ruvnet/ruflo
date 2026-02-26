/**
 * RuVector PostgreSQL Bridge Plugin
 *
 * Production-ready plugin for RuVector PostgreSQL integration providing:
 * - Connection management with pooling
 * - Vector similarity search (HNSW, IVF)
 * - Batch operations
 * - Index management
 * - MCP tool integration
 * - Event emission and metrics
 *
 * @module @claude-flow/plugins/integrations/ruvector
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import { BasePlugin } from '../../core/base-plugin.js';
import type { MCPToolDefinition, MCPToolResult, HealthCheckResult } from '../../types/index.js';
import type {
  RuVectorConfig,
  VectorSearchOptions,
  VectorSearchResult,
  VectorInsertOptions,
  VectorUpdateOptions,
  VectorIndexOptions,
  BatchVectorOptions,
  DistanceMetric,
  VectorIndexType,
  IndexStats,
  QueryResult,
  BatchResult,
  RuVectorEventType,
  ConnectionResult,
  PoolConfig,
  RetryConfig,
  BulkSearchResult,
  HealthStatus,
  RuVectorStats,
} from './types.js';

// ============================================================================
// Type Definitions for pg (node-postgres)
// ============================================================================

/**
 * PostgreSQL Pool interface (from pg package).
 * Using interface to avoid direct dependency issues.
 */
interface Pool {
  connect(): Promise<PoolClient>;
  query<T = unknown>(text: string, values?: unknown[]): Promise<PgQueryResult<T>>;
  end(): Promise<void>;
  on(event: string, callback: (...args: unknown[]) => void): this;
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

interface PoolClient {
  query<T = unknown>(text: string, values?: unknown[]): Promise<PgQueryResult<T>>;
  release(err?: Error): void;
}

interface PgQueryResult<T> {
  rows: T[];
  rowCount: number | null;
  command: string;
  fields?: Array<{ name: string; dataTypeID: number }>;
}

interface PoolFactory {
  Pool: new (config: PgPoolConfig) => Pool;
}

interface PgPoolConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean | { rejectUnauthorized?: boolean };
  min?: number;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  application_name?: string;
}

// ============================================================================
// Constants
// ============================================================================

const PLUGIN_NAME = 'ruvector-postgres';
const PLUGIN_VERSION = '1.0.0';
const DEFAULT_POOL_MIN = 2;
const DEFAULT_POOL_MAX = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 30000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;
const DEFAULT_QUERY_TIMEOUT_MS = 30000;
const DEFAULT_VECTOR_COLUMN = 'embedding';
const DEFAULT_DIMENSIONS = 1536;
const SLOW_QUERY_THRESHOLD_MS = 1000;

/**
 * Distance metric to pgvector operator mapping.
 */
const DISTANCE_OPERATORS: Record<DistanceMetric, string> = {
  cosine: '<=>',
  euclidean: '<->',
  dot: '<#>',
  hamming: '<~>',
  manhattan: '<+>',
  chebyshev: '<+>', // Not directly supported, fallback
  jaccard: '<~>',   // Binary similarity
  minkowski: '<->',  // Fallback to L2
  bray_curtis: '<->', // Fallback
  canberra: '<->',    // Fallback
  mahalanobis: '<->', // Fallback
  correlation: '<=>',  // Similar to cosine
};

/**
 * Index type to SQL mapping.
 */
const INDEX_TYPE_SQL: Record<VectorIndexType, string> = {
  hnsw: 'hnsw',
  ivfflat: 'ivfflat',
  ivfpq: 'ivfflat',  // IVF with PQ uses similar syntax
  flat: '',          // No index (brute force)
  diskann: 'hnsw',   // Fallback to HNSW
};

// ============================================================================
// Metrics Interface
// ============================================================================

/**
 * Metrics collected by the RuVector Bridge.
 */
interface RuVectorMetrics {
  queriesTotal: number;
  queriesSucceeded: number;
  queriesFailed: number;
  slowQueries: number;
  avgQueryTimeMs: number;
  vectorsInserted: number;
  vectorsUpdated: number;
  vectorsDeleted: number;
  searchesPerformed: number;
  cacheHits: number;
  cacheMisses: number;
  connectionAcquires: number;
  connectionReleases: number;
  connectionErrors: number;
  lastQueryTime: number;
  uptime: number;
}

// ============================================================================
// Connection Manager
// ============================================================================

/**
 * Manages PostgreSQL connection pooling with automatic retry and health monitoring.
 */
class ConnectionManager extends EventEmitter {
  private pool: Pool | null = null;
  private readonly config: RuVectorConfig;
  private readonly retryConfig: RetryConfig;
  private connectionId = 0;
  private isConnected = false;
  private lastHealthCheck: Date | null = null;

  constructor(config: RuVectorConfig) {
    super();
    this.config = config;
    this.retryConfig = config.retry ?? {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      jitter: true,
    };
  }

  /**
   * Initialize the connection pool.
   */
  async initialize(): Promise<ConnectionResult> {
    if (this.pool) {
      throw new Error('Connection pool already initialized');
    }

    const poolConfig = this.buildPoolConfig();

    try {
      // Dynamically import pg to avoid bundling issues
      const pg = await this.loadPg();
      this.pool = new pg.Pool(poolConfig);

      // Set up event handlers
      this.pool.on('connect', () => {
        this.connectionId++;
        this.emit('connection:open', {
          connectionId: `conn-${this.connectionId}`,
          host: this.config.host,
          port: this.config.port,
          database: this.config.database,
        });
      });

      this.pool.on('error', (...args: unknown[]) => {
        const err = args[0] as Error;
        this.emit('connection:error', {
          error: err,
          code: (err as { code?: string }).code,
        });
      });

      // Test connection
      const client = await this.pool.connect();
      const result = await client.query<{ version: string; ruvector_version?: string }>(
        "SELECT version() as version, COALESCE(ruvector.version(), 'N/A') as ruvector_version"
      );
      client.release();

      this.isConnected = true;
      this.lastHealthCheck = new Date();

      const connectionResult: ConnectionResult = {
        connectionId: `conn-${this.connectionId}`,
        ready: true,
        serverVersion: result.rows[0]?.version ?? 'unknown',
        ruVectorVersion: result.rows[0]?.ruvector_version ?? 'N/A',
        parameters: {
          host: this.config.host,
          port: String(this.config.port),
          database: this.config.database,
          ssl: String(!!this.config.ssl),
        },
      };

      return connectionResult;
    } catch (error) {
      this.isConnected = false;
      throw new Error(`Failed to initialize connection pool: ${(error as Error).message}`);
    }
  }

  /**
   * Load pg module dynamically.
   */
  private async loadPg(): Promise<PoolFactory> {
    try {
      // Try to import pg
      const pg: any = await import('pg');
      return pg.default ?? pg;
    } catch {
      throw new Error(
        'pg (node-postgres) package not found. Install it with: npm install pg'
      );
    }
  }

  /**
   * Build pool configuration from RuVector config.
   */
  private buildPoolConfig(): PgPoolConfig {
    const poolSettings = (this.config.pool ?? {}) as Partial<PoolConfig>;

    return {
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl
        ? typeof this.config.ssl === 'boolean'
          ? { rejectUnauthorized: false }
          : { rejectUnauthorized: this.config.ssl.rejectUnauthorized ?? true }
        : undefined,
      min: poolSettings.min ?? DEFAULT_POOL_MIN,
      max: poolSettings.max ?? this.config.poolSize ?? DEFAULT_POOL_MAX,
      idleTimeoutMillis: poolSettings.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: this.config.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
      application_name: this.config.applicationName ?? 'claude-flow-ruvector',
    };
  }

  /**
   * Execute a query with timeout and retry logic.
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
    timeoutMs?: number
  ): Promise<QueryResult<T>> {
    if (!this.pool) {
      throw new Error('Connection pool not initialized');
    }

    const startTime = Date.now();
    const queryId = `query-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const timeout = timeoutMs ?? this.config.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;

    this.emit('query:start', { queryId, sql, params });

    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt < this.retryConfig.maxAttempts) {
      attempt++;

      try {
        const result = await this.executeWithTimeout<T>(sql, params, timeout);
        const durationMs = Date.now() - startTime;

        const queryResult: QueryResult<T> = {
          rows: result.rows,
          rowCount: result.rowCount ?? 0,
          affectedRows: result.rowCount ?? undefined,
          durationMs,
          command: result.command,
        };

        this.emit('query:complete', {
          queryId,
          durationMs,
          rowCount: queryResult.rowCount,
        });

        if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
          this.emit('query:slow', {
            queryId,
            durationMs,
            rowCount: queryResult.rowCount,
            threshold: SLOW_QUERY_THRESHOLD_MS,
          });
        }

        return queryResult;
      } catch (error) {
        lastError = error as Error;
        const isRetryable = this.isRetryableError(lastError);

        if (!isRetryable || attempt >= this.retryConfig.maxAttempts) {
          break;
        }

        // Calculate delay with exponential backoff and optional jitter
        let delay = this.retryConfig.initialDelayMs * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1);
        delay = Math.min(delay, this.retryConfig.maxDelayMs);

        if (this.retryConfig.jitter) {
          delay = delay * (0.5 + Math.random());
        }

        await this.sleep(delay);
      }
    }

    const durationMs = Date.now() - startTime;
    this.emit('query:error', {
      queryId,
      sql,
      params,
      error: lastError!,
      durationMs,
    });

    throw lastError!;
  }

  /**
   * Execute query with timeout.
   */
  private async executeWithTimeout<T>(
    sql: string,
    params: unknown[] | undefined,
    timeoutMs: number
  ): Promise<PgQueryResult<T>> {
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Query timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        const result = await this.pool!.query<T>(sql, params);
        clearTimeout(timer);
        resolve(result);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Check if error is retryable.
   */
  private isRetryableError(error: Error): boolean {
    const code = (error as { code?: string }).code;
    const retryableCodes = this.retryConfig.retryableErrors ?? [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      '57P01', // admin_shutdown
      '57P02', // crash_shutdown
      '57P03', // cannot_connect_now
      '40001', // serialization_failure
      '40P01', // deadlock_detected
    ];
    return code !== undefined && retryableCodes.includes(code);
  }

  /**
   * Get a client from the pool.
   */
  async getClient(): Promise<PoolClient> {
    if (!this.pool) {
      throw new Error('Connection pool not initialized');
    }

    this.emit('connection:pool_acquired', this.getPoolStats());
    return this.pool.connect();
  }

  /**
   * Release a client back to the pool.
   */
  releaseClient(client: PoolClient, error?: Error): void {
    client.release(error);
    this.emit('connection:pool_released', this.getPoolStats());
  }

  /**
   * Get pool statistics.
   */
  getPoolStats(): {
    connectionId: string;
    poolSize: number;
    availableConnections: number;
    waitingClients: number;
  } {
    return {
      connectionId: `pool-${this.connectionId}`,
      poolSize: this.pool?.totalCount ?? 0,
      availableConnections: this.pool?.idleCount ?? 0,
      waitingClients: this.pool?.waitingCount ?? 0,
    };
  }

  /**
   * Check if connected.
   */
  isHealthy(): boolean {
    return this.isConnected && this.pool !== null;
  }

  /**
   * Shutdown the connection pool.
   */
  async shutdown(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.isConnected = false;
      this.emit('connection:close', {
        connectionId: `conn-${this.connectionId}`,
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
      });
    }
  }

  /**
   * Sleep utility.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Vector Operations
// ============================================================================

/**
 * Provides vector operation methods for search, insert, update, and delete.
 */
class VectorOps {
  private readonly connectionManager: ConnectionManager;
  private readonly config: RuVectorConfig;

  constructor(connectionManager: ConnectionManager, config: RuVectorConfig) {
    this.connectionManager = connectionManager;
    this.config = config;
  }

  /**
   * Perform vector similarity search.
   */
  async search(options: VectorSearchOptions): Promise<VectorSearchResult[]> {
    const tableName = options.tableName ?? 'vectors';
    const vectorColumn = options.vectorColumn ?? DEFAULT_VECTOR_COLUMN;
    const metric = options.metric ?? 'cosine';
    const operator = DISTANCE_OPERATORS[metric] ?? '<=>';

    // Build query vector string
    const queryVector = this.formatVector(options.query);

    // Set HNSW parameters if specified
    if (options.efSearch) {
      await this.connectionManager.query(
        `SET LOCAL hnsw.ef_search = ${options.efSearch}`
      );
    }

    // Set IVF probes if specified
    if (options.probes) {
      await this.connectionManager.query(
        `SET LOCAL ivfflat.probes = ${options.probes}`
      );
    }

    // Build SELECT clause
    const selectColumns = options.selectColumns ?? ['id'];
    const columnList = [...selectColumns];

    if (options.includeVector) {
      columnList.push(vectorColumn);
    }
    if (options.includeMetadata) {
      columnList.push('metadata');
    }

    // Add distance/similarity calculation
    const distanceExpr = `${vectorColumn} ${operator} '${queryVector}'::vector`;
    columnList.push(`(${distanceExpr}) as distance`);

    // Build WHERE clause
    const whereClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options.threshold !== undefined) {
      if (metric === 'cosine' || metric === 'dot') {
        // For similarity metrics, higher is better
        whereClauses.push(`(1 - (${distanceExpr})) >= $${paramIndex++}`);
        params.push(options.threshold);
      } else {
        // For distance metrics, lower is better
        whereClauses.push(`(${distanceExpr}) <= $${paramIndex++}`);
        params.push(options.threshold);
      }
    }

    if (options.maxDistance !== undefined) {
      whereClauses.push(`(${distanceExpr}) <= $${paramIndex++}`);
      params.push(options.maxDistance);
    }

    if (options.filter) {
      for (const [key, value] of Object.entries(options.filter)) {
        if (key === 'metadata') {
          // JSONB containment
          whereClauses.push(`metadata @> $${paramIndex++}::jsonb`);
          params.push(JSON.stringify(value));
        } else {
          whereClauses.push(`${this.escapeIdentifier(key)} = $${paramIndex++}`);
          params.push(value);
        }
      }
    }

    if (options.whereClause) {
      whereClauses.push(`(${options.whereClause})`);
      if (options.whereParams) {
        // Re-index parameters in the custom WHERE clause
        const reindexed = options.whereParams.map(() => `$${paramIndex++}`);
        params.push(...options.whereParams);
      }
    }

    // Build final query
    const schemaPrefix = this.config.schema ? `${this.escapeIdentifier(this.config.schema)}.` : '';
    let sql = `SELECT ${columnList.join(', ')} FROM ${schemaPrefix}${this.escapeIdentifier(tableName)}`;

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    sql += ` ORDER BY ${distanceExpr} ASC`;
    sql += ` LIMIT ${options.k}`;

    const result = await this.connectionManager.query<{
      id: string | number;
      distance: number;
      [key: string]: unknown;
    }>(sql, params, options.timeoutMs);

    // Transform results
    return result.rows.map((row, index) => {
      const score = metric === 'cosine' || metric === 'dot'
        ? 1 - (row.distance as number)
        : 1 / (1 + (row.distance as number));

      const searchResult: VectorSearchResult = {
        id: row.id,
        score,
        distance: row.distance as number,
        rank: index + 1,
        retrievedAt: new Date(),
      };

      if (options.includeVector && row[vectorColumn]) {
        (searchResult as { vector?: number[] }).vector = this.parseVector(row[vectorColumn] as string);
      }

      if (options.includeMetadata && row.metadata) {
        (searchResult as { metadata?: Record<string, unknown> }).metadata = row.metadata as Record<string, unknown>;
      }

      return searchResult;
    });
  }

  /**
   * Perform batch vector search.
   */
  async batchSearch(options: BatchVectorOptions): Promise<BulkSearchResult> {
    const startTime = Date.now();
    const results: VectorSearchResult[][] = [];
    let cacheHits = 0;
    let cacheMisses = 0;

    const concurrency = options.concurrency ?? 4;
    const queries = options.queries;

    // Process queries in parallel batches
    for (let i = 0; i < queries.length; i += concurrency) {
      const batch = queries.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(query =>
          this.search({
            query,
            k: options.k,
            metric: options.metric,
            filter: options.filter,
            tableName: options.tableName,
            vectorColumn: options.vectorColumn,
          })
        )
      );
      results.push(...batchResults);
      cacheMisses += batch.length; // No caching implemented yet
    }

    const totalDurationMs = Date.now() - startTime;

    return {
      results,
      totalDurationMs,
      avgDurationMs: totalDurationMs / queries.length,
      cacheStats: {
        hits: cacheHits,
        misses: cacheMisses,
        hitRate: cacheHits / (cacheHits + cacheMisses) || 0,
      },
    };
  }

  /**
   * Insert vectors.
   */
  async insert(options: VectorInsertOptions): Promise<BatchResult<string>> {
    const startTime = Date.now();
    const tableName = options.tableName;
    const vectorColumn = options.vectorColumn ?? DEFAULT_VECTOR_COLUMN;
    const batchSize = options.batchSize ?? 100;

    const successful: string[] = [];
    const errors: Array<{ index: number; message: string; input?: unknown }> = [];
    let insertedCount = 0;

    const schemaPrefix = this.config.schema ? `${this.escapeIdentifier(this.config.schema)}.` : '';

    // Process in batches
    for (let i = 0; i < options.vectors.length; i += batchSize) {
      const batch = options.vectors.slice(i, i + batchSize);

      try {
        // Build multi-row INSERT
        const values: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        for (const item of batch) {
          const vector = this.formatVector(item.vector);
          const metadata = item.metadata ? JSON.stringify(item.metadata) : null;

          if (item.id !== undefined) {
            values.push(`($${paramIndex++}, '${vector}'::vector, $${paramIndex++}::jsonb)`);
            params.push(item.id, metadata);
          } else {
            values.push(`(gen_random_uuid(), '${vector}'::vector, $${paramIndex++}::jsonb)`);
            params.push(metadata);
          }
        }

        let sql = `INSERT INTO ${schemaPrefix}${this.escapeIdentifier(tableName)} `;
        sql += `(id, ${this.escapeIdentifier(vectorColumn)}, metadata) VALUES ${values.join(', ')}`;

        if (options.upsert) {
          const conflictCols = options.conflictColumns ?? ['id'];
          sql += ` ON CONFLICT (${conflictCols.join(', ')}) DO UPDATE SET `;
          sql += `${this.escapeIdentifier(vectorColumn)} = EXCLUDED.${this.escapeIdentifier(vectorColumn)}, `;
          sql += `metadata = EXCLUDED.metadata`;
        }

        if (options.returning) {
          sql += ' RETURNING id';
        }

        const result = await this.connectionManager.query<{ id: string }>(sql, params);

        if (options.returning && result.rows) {
          successful.push(...result.rows.map(r => String(r.id)));
        }

        insertedCount += batch.length;
      } catch (error) {
        if (options.skipInvalid) {
          // Try inserting individually
          for (let j = 0; j < batch.length; j++) {
            try {
              const item = batch[j];
              const vector = this.formatVector(item.vector);
              const metadata = item.metadata ? JSON.stringify(item.metadata) : null;

              const sql = `INSERT INTO ${schemaPrefix}${this.escapeIdentifier(tableName)} ` +
                `(id, ${this.escapeIdentifier(vectorColumn)}, metadata) VALUES ` +
                `($1, '${vector}'::vector, $2::jsonb)` +
                (options.returning ? ' RETURNING id' : '');

              const result = await this.connectionManager.query<{ id: string }>(
                sql,
                [item.id ?? null, metadata]
              );

              if (options.returning && result.rows.length > 0) {
                successful.push(String(result.rows[0].id));
              }
              insertedCount++;
            } catch (itemError) {
              errors.push({
                index: i + j,
                message: (itemError as Error).message,
                input: batch[j],
              });
            }
          }
        } else {
          errors.push({
            index: i,
            message: (error as Error).message,
          });
          break;
        }
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      total: options.vectors.length,
      successful: insertedCount,
      failed: options.vectors.length - insertedCount,
      results: options.returning ? successful : undefined,
      errors: errors.length > 0 ? errors : undefined,
      durationMs,
      throughput: insertedCount / (durationMs / 1000),
    };
  }

  /**
   * Update a vector.
   */
  async update(options: VectorUpdateOptions): Promise<boolean> {
    const tableName = options.tableName;
    const vectorColumn = options.vectorColumn ?? DEFAULT_VECTOR_COLUMN;
    const schemaPrefix = this.config.schema ? `${this.escapeIdentifier(this.config.schema)}.` : '';

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options.vector) {
      const vector = this.formatVector(options.vector);
      setClauses.push(`${this.escapeIdentifier(vectorColumn)} = '${vector}'::vector`);
    }

    if (options.metadata) {
      if (options.mergeMetadata) {
        setClauses.push(`metadata = metadata || $${paramIndex++}::jsonb`);
      } else {
        setClauses.push(`metadata = $${paramIndex++}::jsonb`);
      }
      params.push(JSON.stringify(options.metadata));
    }

    if (setClauses.length === 0) {
      return false;
    }

    params.push(options.id);
    const sql = `UPDATE ${schemaPrefix}${this.escapeIdentifier(tableName)} ` +
      `SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`;

    const result = await this.connectionManager.query(sql, params);
    return (result.affectedRows ?? 0) > 0;
  }

  /**
   * Delete a vector.
   */
  async delete(tableName: string, id: string | number): Promise<boolean> {
    const schemaPrefix = this.config.schema ? `${this.escapeIdentifier(this.config.schema)}.` : '';
    const sql = `DELETE FROM ${schemaPrefix}${this.escapeIdentifier(tableName)} WHERE id = $1`;
    const result = await this.connectionManager.query(sql, [id]);
    return (result.affectedRows ?? 0) > 0;
  }

  /**
   * Bulk delete vectors.
   */
  async bulkDelete(tableName: string, ids: Array<string | number>): Promise<BatchResult> {
    const startTime = Date.now();
    const schemaPrefix = this.config.schema ? `${this.escapeIdentifier(this.config.schema)}.` : '';

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `DELETE FROM ${schemaPrefix}${this.escapeIdentifier(tableName)} WHERE id IN (${placeholders})`;

    const result = await this.connectionManager.query(sql, ids);
    const durationMs = Date.now() - startTime;
    const deleted = result.affectedRows ?? 0;

    return {
      total: ids.length,
      successful: deleted,
      failed: ids.length - deleted,
      durationMs,
      throughput: deleted / (durationMs / 1000),
    };
  }

  /**
   * Create a vector index.
   */
  async createIndex(options: VectorIndexOptions): Promise<void> {
    const indexType = INDEX_TYPE_SQL[options.indexType];
    if (!indexType && options.indexType !== 'flat') {
      throw new Error(`Unsupported index type: ${options.indexType}`);
    }

    const indexName = options.indexName ??
      `idx_${options.tableName}_${options.columnName}_${options.indexType}`;
    const schemaPrefix = this.config.schema ? `${this.escapeIdentifier(this.config.schema)}.` : '';

    if (options.replace) {
      await this.connectionManager.query(
        `DROP INDEX IF EXISTS ${schemaPrefix}${this.escapeIdentifier(indexName)}`
      );
    }

    if (options.indexType === 'flat') {
      return; // No index needed for brute force
    }

    // Build operator class based on metric
    const opClass = this.getOperatorClass(options.metric ?? 'cosine', options.indexType);

    // Build WITH clause for index parameters
    const withParams: string[] = [];
    if (options.m !== undefined) {
      withParams.push(`m = ${options.m}`);
    }
    if (options.efConstruction !== undefined) {
      withParams.push(`ef_construction = ${options.efConstruction}`);
    }
    if (options.lists !== undefined) {
      withParams.push(`lists = ${options.lists}`);
    }

    const withClause = withParams.length > 0 ? ` WITH (${withParams.join(', ')})` : '';
    const concurrent = options.concurrent ? 'CONCURRENTLY ' : '';

    const sql = `CREATE INDEX ${concurrent}${this.escapeIdentifier(indexName)} ` +
      `ON ${schemaPrefix}${this.escapeIdentifier(options.tableName)} ` +
      `USING ${indexType} (${this.escapeIdentifier(options.columnName)} ${opClass})${withClause}`;

    await this.connectionManager.query(sql);
  }

  /**
   * Drop an index.
   */
  async dropIndex(indexName: string): Promise<void> {
    const schemaPrefix = this.config.schema ? `${this.escapeIdentifier(this.config.schema)}.` : '';
    await this.connectionManager.query(
      `DROP INDEX IF EXISTS ${schemaPrefix}${this.escapeIdentifier(indexName)}`
    );
  }

  /**
   * Rebuild an index.
   */
  async rebuildIndex(indexName: string): Promise<void> {
    await this.connectionManager.query(`REINDEX INDEX ${this.escapeIdentifier(indexName)}`);
  }

  /**
   * Get index statistics.
   */
  async getIndexStats(indexName: string): Promise<IndexStats> {
    const result = await this.connectionManager.query<{
      indexrelname: string;
      idx_scan: number;
      idx_tup_read: number;
      idx_tup_fetch: number;
      pg_relation_size: number;
    }>(
      `SELECT
        indexrelname,
        idx_scan,
        idx_tup_read,
        idx_tup_fetch,
        pg_relation_size(indexrelid) as pg_relation_size
      FROM pg_stat_user_indexes
      WHERE indexrelname = $1`,
      [indexName]
    );

    if (result.rows.length === 0) {
      throw new Error(`Index ${indexName} not found`);
    }

    const row = result.rows[0];
    return {
      indexName: row.indexrelname,
      indexType: 'hnsw', // Would need additional query to determine
      numVectors: row.idx_tup_read,
      sizeBytes: row.pg_relation_size,
      buildTimeMs: 0, // Not available from stats
      lastRebuild: new Date(),
      params: {
        scans: row.idx_scan,
        tuplesRead: row.idx_tup_read,
        tuplesFetched: row.idx_tup_fetch,
      },
    };
  }

  /**
   * List all indices for a table.
   */
  async listIndices(tableName?: string): Promise<IndexStats[]> {
    let sql = `SELECT
      indexrelname,
      idx_scan,
      idx_tup_read,
      idx_tup_fetch,
      pg_relation_size(indexrelid) as pg_relation_size
    FROM pg_stat_user_indexes`;

    const params: unknown[] = [];
    if (tableName) {
      sql += ` WHERE relname = $1`;
      params.push(tableName);
    }

    const result = await this.connectionManager.query<{
      indexrelname: string;
      idx_scan: number;
      idx_tup_read: number;
      idx_tup_fetch: number;
      pg_relation_size: number;
    }>(sql, params);

    return result.rows.map(row => ({
      indexName: row.indexrelname,
      indexType: 'hnsw' as VectorIndexType,
      numVectors: row.idx_tup_read,
      sizeBytes: row.pg_relation_size,
      buildTimeMs: 0,
      lastRebuild: new Date(),
      params: {
        scans: row.idx_scan,
        tuplesRead: row.idx_tup_read,
        tuplesFetched: row.idx_tup_fetch,
      },
    }));
  }

  /**
   * Get operator class for index creation.
   */
  private getOperatorClass(metric: DistanceMetric, indexType: VectorIndexType): string {
    const opClasses: Record<string, Record<string, string>> = {
      hnsw: {
        cosine: 'vector_cosine_ops',
        euclidean: 'vector_l2_ops',
        dot: 'vector_ip_ops',
      },
      ivfflat: {
        cosine: 'vector_cosine_ops',
        euclidean: 'vector_l2_ops',
        dot: 'vector_ip_ops',
      },
    };

    return opClasses[indexType]?.[metric] ?? 'vector_cosine_ops';
  }

  /**
   * Format vector for SQL.
   */
  private formatVector(vector: number[] | Float32Array): string {
    const arr = Array.isArray(vector) ? vector : Array.from(vector);
    return `[${arr.join(',')}]`;
  }

  /**
   * Parse vector from SQL result.
   */
  private parseVector(vectorStr: string): number[] {
    // Handle pgvector format: [1,2,3] or {1,2,3}
    const cleaned = vectorStr.replace(/[\[\]{}]/g, '');
    return cleaned.split(',').map(Number);
  }

  /**
   * Escape SQL identifier.
   */
  private escapeIdentifier(identifier: string): string {
    // Basic SQL injection prevention
    return `"${identifier.replace(/"/g, '""')}"`;
  }
}

// ============================================================================
// RuVector Bridge Plugin
// ============================================================================

/**
 * RuVector PostgreSQL Bridge Plugin for Claude-Flow v3.
 *
 * Provides comprehensive vector database integration with:
 * - Connection pooling and management
 * - Vector similarity search (HNSW, IVF)
 * - Batch operations for high throughput
 * - Index creation and management
 * - MCP tool integration
 * - Event-driven architecture
 * - Production-ready error handling and metrics
 *
 * @example
 * ```typescript
 * const bridge = new RuVectorBridge({
 *   host: 'localhost',
 *   port: 5432,
 *   database: 'vectors',
 *   user: 'postgres',
 *   password: 'password',
 *   poolSize: 10,
 * });
 *
 * await bridge.initialize(context);
 *
 * const results = await bridge.vectorSearch({
 *   query: [0.1, 0.2, 0.3, ...],
 *   k: 10,
 *   metric: 'cosine',
 *   tableName: 'embeddings',
 * });
 * ```
 */
export class RuVectorBridge extends BasePlugin {
  private readonly ruVectorConfig: RuVectorConfig;
  private connectionManager: ConnectionManager | null = null;
  private vectorOps: VectorOps | null = null;
  private metrics: RuVectorMetrics;
  private initTime: Date | null = null;

  constructor(config: RuVectorConfig) {
    super({
      name: PLUGIN_NAME,
      version: PLUGIN_VERSION,
      description: 'RuVector PostgreSQL Bridge for Claude-Flow v3 - Advanced vector database integration',
      tags: ['database', 'vector', 'postgresql', 'search', 'embeddings'],
    });

    this.ruVectorConfig = config;
    this.metrics = this.createInitialMetrics();
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Initialize the plugin and establish database connection.
   */
  protected async onInitialize(): Promise<void> {
    this.logger.info('Initializing RuVector PostgreSQL Bridge...');
    this.initTime = new Date();

    // Create connection manager
    this.connectionManager = new ConnectionManager(this.ruVectorConfig);

    // Forward connection events
    this.forwardConnectionEvents();

    // Initialize connection pool
    try {
      const connectionResult = await this.connectionManager.initialize();
      this.logger.info(`Connected to PostgreSQL: ${connectionResult.serverVersion}`);
      this.logger.info(`RuVector extension version: ${connectionResult.ruVectorVersion}`);

      // Initialize vector operations
      this.vectorOps = new VectorOps(this.connectionManager, this.ruVectorConfig);

      // Ensure pgvector extension is available
      await this.ensureExtension();

      this.eventBus.emit('ruvector:initialized', {
        connectionResult,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error('Failed to initialize RuVector Bridge', error);
      throw error;
    }
  }

  /**
   * Shutdown the plugin and close database connections.
   */
  protected async onShutdown(): Promise<void> {
    this.logger.info('Shutting down RuVector PostgreSQL Bridge...');

    if (this.connectionManager) {
      await this.connectionManager.shutdown();
      this.connectionManager = null;
    }

    this.vectorOps = null;

    this.eventBus.emit('ruvector:shutdown', {
      uptime: this.getUptime(),
      metrics: this.metrics,
      timestamp: new Date(),
    });
  }

  /**
   * Perform health check.
   */
  protected async onHealthCheck(): Promise<Record<string, { healthy: boolean; message?: string; latencyMs?: number }>> {
    const checks: Record<string, { healthy: boolean; message?: string; latencyMs?: number }> = {};

    // Check connection pool
    if (this.connectionManager?.isHealthy()) {
      const poolStats = this.connectionManager.getPoolStats();
      checks['connection_pool'] = {
        healthy: true,
        message: `Pool size: ${poolStats.poolSize}, available: ${poolStats.availableConnections}`,
      };
    } else {
      checks['connection_pool'] = {
        healthy: false,
        message: 'Connection pool not initialized or unhealthy',
      };
    }

    // Check database connectivity with a simple query
    if (this.connectionManager) {
      const startTime = Date.now();
      try {
        await this.connectionManager.query('SELECT 1');
        checks['database'] = {
          healthy: true,
          message: 'Database responding',
          latencyMs: Date.now() - startTime,
        };
      } catch (error) {
        checks['database'] = {
          healthy: false,
          message: `Database error: ${(error as Error).message}`,
          latencyMs: Date.now() - startTime,
        };
      }
    }

    // Check pgvector extension
    if (this.connectionManager) {
      try {
        const result = await this.connectionManager.query<{ extversion: string }>(
          "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
        );
        checks['pgvector'] = {
          healthy: result.rows.length > 0,
          message: result.rows.length > 0
            ? `pgvector version: ${result.rows[0].extversion}`
            : 'pgvector extension not found',
        };
      } catch (error) {
        checks['pgvector'] = {
          healthy: false,
          message: `Error checking pgvector: ${(error as Error).message}`,
        };
      }
    }

    return checks;
  }

  // ===========================================================================
  // MCP Tools Registration
  // ===========================================================================

  /**
   * Register MCP tools for vector operations.
   */
  override registerMCPTools(): MCPToolDefinition[] {
    return [
      // Vector Search Tool
      {
        name: 'ruvector_search',
        description: 'Search for similar vectors using HNSW or IVF indexing. Supports cosine, euclidean, and dot product distance metrics.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'array',
              items: { type: 'number' },
              description: 'Query vector for similarity search',
            },
            k: {
              type: 'number',
              description: 'Number of nearest neighbors to return',
              default: 10,
            },
            metric: {
              type: 'string',
              enum: ['cosine', 'euclidean', 'dot'],
              description: 'Distance metric to use',
              default: 'cosine',
            },
            tableName: {
              type: 'string',
              description: 'Table to search in',
              default: 'vectors',
            },
            filter: {
              type: 'object',
              description: 'Metadata filters',
            },
            threshold: {
              type: 'number',
              description: 'Minimum similarity threshold',
            },
            includeMetadata: {
              type: 'boolean',
              description: 'Include metadata in results',
              default: true,
            },
          },
          required: ['query', 'k'],
        },
        handler: async (input): Promise<MCPToolResult> => {
          try {
            const results = await this.vectorSearch(input as unknown as VectorSearchOptions);
            this.metrics.searchesPerformed++;
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ success: true, results, count: results.length }, null, 2),
              }],
            };
          } catch (error) {
            return this.createErrorResult(error as Error);
          }
        },
      },

      // Vector Insert Tool
      {
        name: 'ruvector_insert',
        description: 'Insert vectors into a table. Supports batch insertion and upsert.',
        inputSchema: {
          type: 'object',
          properties: {
            tableName: {
              type: 'string',
              description: 'Target table name',
            },
            vectors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  vector: { type: 'array', items: { type: 'number' } },
                  metadata: { type: 'object' },
                },
                required: ['vector'],
              },
              description: 'Vectors to insert',
            },
            upsert: {
              type: 'boolean',
              description: 'Update on conflict',
              default: false,
            },
          },
          required: ['tableName', 'vectors'],
        },
        handler: async (input): Promise<MCPToolResult> => {
          try {
            const result = await this.vectorInsert(input as unknown as VectorInsertOptions);
            this.metrics.vectorsInserted += result.successful;
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ success: true, ...result }, null, 2),
              }],
            };
          } catch (error) {
            return this.createErrorResult(error as Error);
          }
        },
      },

      // Vector Update Tool
      {
        name: 'ruvector_update',
        description: 'Update an existing vector and/or its metadata.',
        inputSchema: {
          type: 'object',
          properties: {
            tableName: {
              type: 'string',
              description: 'Table name',
            },
            id: {
              oneOf: [{ type: 'string' }, { type: 'number' }],
              description: 'Vector ID to update',
            },
            vector: {
              type: 'array',
              items: { type: 'number' },
              description: 'New vector value',
            },
            metadata: {
              type: 'object',
              description: 'New or updated metadata',
            },
            mergeMetadata: {
              type: 'boolean',
              description: 'Merge with existing metadata',
              default: false,
            },
          },
          required: ['tableName', 'id'],
        },
        handler: async (input): Promise<MCPToolResult> => {
          try {
            const updated = await this.vectorUpdate(input as unknown as VectorUpdateOptions);
            if (updated) this.metrics.vectorsUpdated++;
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ success: true, updated }, null, 2),
              }],
            };
          } catch (error) {
            return this.createErrorResult(error as Error);
          }
        },
      },

      // Vector Delete Tool
      {
        name: 'ruvector_delete',
        description: 'Delete vectors by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            tableName: {
              type: 'string',
              description: 'Table name',
            },
            id: {
              oneOf: [{ type: 'string' }, { type: 'number' }],
              description: 'Vector ID to delete',
            },
            ids: {
              type: 'array',
              items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
              description: 'Multiple vector IDs to delete',
            },
          },
          required: ['tableName'],
        },
        handler: async (input): Promise<MCPToolResult> => {
          try {
            const { tableName, id, ids } = input as { tableName: string; id?: string | number; ids?: Array<string | number> };

            if (ids && ids.length > 0) {
              const result = await this.vectorBulkDelete(tableName, ids);
              this.metrics.vectorsDeleted += result.successful;
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({ success: true, ...result }, null, 2),
                }],
              };
            } else if (id !== undefined) {
              const deleted = await this.vectorDelete(tableName, id);
              if (deleted) this.metrics.vectorsDeleted++;
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({ success: true, deleted }, null, 2),
                }],
              };
            } else {
              return this.createErrorResult(new Error('Either id or ids must be provided'));
            }
          } catch (error) {
            return this.createErrorResult(error as Error);
          }
        },
      },

      // Index Create Tool
      {
        name: 'ruvector_create_index',
        description: 'Create a vector index (HNSW or IVF) for faster similarity search.',
        inputSchema: {
          type: 'object',
          properties: {
            tableName: {
              type: 'string',
              description: 'Table name',
            },
            columnName: {
              type: 'string',
              description: 'Vector column name',
              default: 'embedding',
            },
            indexType: {
              type: 'string',
              enum: ['hnsw', 'ivfflat'],
              description: 'Index type',
              default: 'hnsw',
            },
            metric: {
              type: 'string',
              enum: ['cosine', 'euclidean', 'dot'],
              description: 'Distance metric',
              default: 'cosine',
            },
            m: {
              type: 'number',
              description: 'HNSW M parameter (max connections per layer)',
              default: 16,
            },
            efConstruction: {
              type: 'number',
              description: 'HNSW ef_construction parameter',
              default: 200,
            },
            lists: {
              type: 'number',
              description: 'IVF lists parameter',
            },
            concurrent: {
              type: 'boolean',
              description: 'Create index concurrently (non-blocking)',
              default: true,
            },
          },
          required: ['tableName', 'columnName', 'indexType'],
        },
        handler: async (input): Promise<MCPToolResult> => {
          try {
            await this.createIndex(input as unknown as VectorIndexOptions);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ success: true, message: 'Index created successfully' }, null, 2),
              }],
            };
          } catch (error) {
            return this.createErrorResult(error as Error);
          }
        },
      },

      // Index Stats Tool
      {
        name: 'ruvector_index_stats',
        description: 'Get statistics for vector indices.',
        inputSchema: {
          type: 'object',
          properties: {
            indexName: {
              type: 'string',
              description: 'Specific index name (optional)',
            },
            tableName: {
              type: 'string',
              description: 'Filter by table name (optional)',
            },
          },
        },
        handler: async (input): Promise<MCPToolResult> => {
          try {
            const { indexName, tableName } = input as { indexName?: string; tableName?: string };

            if (indexName) {
              const stats = await this.getIndexStats(indexName);
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({ success: true, stats }, null, 2),
                }],
              };
            } else {
              const indices = await this.listIndices(tableName);
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({ success: true, indices, count: indices.length }, null, 2),
                }],
              };
            }
          } catch (error) {
            return this.createErrorResult(error as Error);
          }
        },
      },

      // Health Check Tool
      {
        name: 'ruvector_health',
        description: 'Check the health status of the RuVector connection and database.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: async (): Promise<MCPToolResult> => {
          try {
            const health = await this.healthCheck();
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ success: true, health }, null, 2),
              }],
            };
          } catch (error) {
            return this.createErrorResult(error as Error);
          }
        },
      },

      // Metrics Tool
      {
        name: 'ruvector_metrics',
        description: 'Get performance metrics and statistics.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: async (): Promise<MCPToolResult> => {
          try {
            const stats = await this.getStats();
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ success: true, metrics: this.metrics, stats }, null, 2),
              }],
            };
          } catch (error) {
            return this.createErrorResult(error as Error);
          }
        },
      },
    ];
  }

  // ===========================================================================
  // Public Vector Operation Methods
  // ===========================================================================

  /**
   * Perform vector similarity search.
   */
  async vectorSearch(options: VectorSearchOptions): Promise<VectorSearchResult[]> {
    this.ensureInitialized();
    const startTime = Date.now();

    try {
      const results = await this.vectorOps!.search(options);
      this.updateQueryMetrics(true, Date.now() - startTime);

      this.emit('search:complete', {
        searchId: `search-${Date.now()}`,
        durationMs: Date.now() - startTime,
        resultCount: results.length,
        scannedCount: results.length,
        cacheHit: false,
      });

      return results;
    } catch (error) {
      this.updateQueryMetrics(false, Date.now() - startTime);
      throw error;
    }
  }

  /**
   * Perform batch vector search.
   */
  async vectorBatchSearch(options: BatchVectorOptions): Promise<BulkSearchResult> {
    this.ensureInitialized();
    return this.vectorOps!.batchSearch(options);
  }

  /**
   * Insert vectors.
   */
  async vectorInsert(options: VectorInsertOptions): Promise<BatchResult<string>> {
    this.ensureInitialized();
    const result = await this.vectorOps!.insert(options);

    this.emit('vector:batch_complete', {
      tableName: options.tableName,
      count: result.total,
      durationMs: result.durationMs,
      successCount: result.successful,
      failedCount: result.failed,
    });

    return result;
  }

  /**
   * Update a vector.
   */
  async vectorUpdate(options: VectorUpdateOptions): Promise<boolean> {
    this.ensureInitialized();
    const updated = await this.vectorOps!.update(options);

    if (updated) {
      this.emit('vector:updated', {
        tableName: options.tableName,
        vectorId: options.id,
        dimensions: options.vector?.length ?? 0,
      });
    }

    return updated;
  }

  /**
   * Delete a vector.
   */
  async vectorDelete(tableName: string, id: string | number): Promise<boolean> {
    this.ensureInitialized();
    const deleted = await this.vectorOps!.delete(tableName, id);

    if (deleted) {
      this.emit('vector:deleted', {
        tableName,
        vectorId: id,
        dimensions: 0,
      });
    }

    return deleted;
  }

  /**
   * Bulk delete vectors.
   */
  async vectorBulkDelete(tableName: string, ids: Array<string | number>): Promise<BatchResult> {
    this.ensureInitialized();
    return this.vectorOps!.bulkDelete(tableName, ids);
  }

  /**
   * Create a vector index.
   */
  async createIndex(options: VectorIndexOptions): Promise<void> {
    this.ensureInitialized();
    await this.vectorOps!.createIndex(options);

    this.emit('index:created', {
      indexName: options.indexName ?? `idx_${options.tableName}_${options.columnName}`,
      tableName: options.tableName,
      columnName: options.columnName,
      indexType: options.indexType,
    });
  }

  /**
   * Drop an index.
   */
  async dropIndex(indexName: string): Promise<void> {
    this.ensureInitialized();
    await this.vectorOps!.dropIndex(indexName);

    this.emit('index:dropped', {
      indexName,
      tableName: '',
      columnName: '',
      indexType: 'hnsw' as VectorIndexType,
    });
  }

  /**
   * Rebuild an index.
   */
  async rebuildIndex(indexName: string): Promise<void> {
    this.ensureInitialized();
    await this.vectorOps!.rebuildIndex(indexName);

    this.emit('index:rebuilt', {
      indexName,
      tableName: '',
      columnName: '',
      indexType: 'hnsw' as VectorIndexType,
    });
  }

  /**
   * Get index statistics.
   */
  async getIndexStats(indexName: string): Promise<IndexStats> {
    this.ensureInitialized();
    return this.vectorOps!.getIndexStats(indexName);
  }

  /**
   * List all indices.
   */
  async listIndices(tableName?: string): Promise<IndexStats[]> {
    this.ensureInitialized();
    return this.vectorOps!.listIndices(tableName);
  }

  /**
   * Get RuVector statistics.
   */
  async getStats(): Promise<RuVectorStats> {
    this.ensureInitialized();

    const poolStats = this.connectionManager!.getPoolStats();

    // Query for vector statistics
    const result = await this.connectionManager!.query<{
      table_count: number;
      total_vectors: number;
      total_size: number;
      index_count: number;
    }>(`
      SELECT
        COUNT(DISTINCT c.relname) as table_count,
        COALESCE(SUM(c.reltuples), 0)::bigint as total_vectors,
        COALESCE(SUM(pg_total_relation_size(c.oid)), 0)::bigint as total_size,
        COUNT(DISTINCT i.indexrelid) as index_count
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid
      LEFT JOIN pg_index i ON i.indrelid = c.oid
      WHERE a.atttypid = 'vector'::regtype
        AND c.relkind = 'r'
    `);

    const stats = result.rows[0] ?? {
      table_count: 0,
      total_vectors: 0,
      total_size: 0,
      index_count: 0,
    };

    return {
      version: PLUGIN_VERSION,
      totalVectors: Number(stats.total_vectors),
      totalSizeBytes: Number(stats.total_size),
      numIndices: Number(stats.index_count),
      numTables: Number(stats.table_count),
      queryStats: {
        totalQueries: this.metrics.queriesTotal,
        avgQueryTimeMs: this.metrics.avgQueryTimeMs,
        p95QueryTimeMs: this.metrics.avgQueryTimeMs * 1.5, // Approximation
        p99QueryTimeMs: this.metrics.avgQueryTimeMs * 2,   // Approximation
        cacheHitRate: this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses) || 0,
      },
      memoryStats: {
        usedBytes: 0, // Would need OS-level access
        peakBytes: 0,
        indexBytes: Number(stats.total_size),
        cacheBytes: 0,
      },
    };
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Ensure the plugin is initialized.
   */
  private ensureInitialized(): void {
    if (!this.vectorOps || !this.connectionManager) {
      throw new Error('RuVector Bridge not initialized. Call initialize() first.');
    }
  }

  /**
   * Ensure pgvector extension is installed.
   */
  private async ensureExtension(): Promise<void> {
    try {
      await this.connectionManager!.query("CREATE EXTENSION IF NOT EXISTS vector");
      this.logger.debug('pgvector extension ensured');
    } catch (error) {
      this.logger.warn('Could not create pgvector extension (may require superuser privileges)', error);
    }
  }

  /**
   * Forward connection manager events to plugin event bus.
   */
  private forwardConnectionEvents(): void {
    const events: RuVectorEventType[] = [
      'connection:open',
      'connection:close',
      'connection:error',
      'connection:pool_acquired',
      'connection:pool_released',
      'query:start',
      'query:complete',
      'query:error',
      'query:slow',
    ];

    for (const event of events) {
      this.connectionManager!.on(event, (data) => {
        this.eventBus.emit(`ruvector:${event}`, data);
        this.emit(event, data);
        this.updateMetricsFromEvent(event, data);
      });
    }
  }

  /**
   * Update metrics from events.
   */
  private updateMetricsFromEvent(event: string, _data: unknown): void {
    switch (event) {
      case 'connection:pool_acquired':
        this.metrics.connectionAcquires++;
        break;
      case 'connection:pool_released':
        this.metrics.connectionReleases++;
        break;
      case 'connection:error':
        this.metrics.connectionErrors++;
        break;
      case 'query:slow':
        this.metrics.slowQueries++;
        break;
    }
  }

  /**
   * Update query metrics.
   */
  private updateQueryMetrics(success: boolean, durationMs: number): void {
    this.metrics.queriesTotal++;
    if (success) {
      this.metrics.queriesSucceeded++;
    } else {
      this.metrics.queriesFailed++;
    }

    // Update running average
    const prevAvg = this.metrics.avgQueryTimeMs;
    const n = this.metrics.queriesTotal;
    this.metrics.avgQueryTimeMs = prevAvg + (durationMs - prevAvg) / n;
    this.metrics.lastQueryTime = durationMs;

    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      this.metrics.slowQueries++;
    }
  }

  /**
   * Create initial metrics object.
   */
  private createInitialMetrics(): RuVectorMetrics {
    return {
      queriesTotal: 0,
      queriesSucceeded: 0,
      queriesFailed: 0,
      slowQueries: 0,
      avgQueryTimeMs: 0,
      vectorsInserted: 0,
      vectorsUpdated: 0,
      vectorsDeleted: 0,
      searchesPerformed: 0,
      cacheHits: 0,
      cacheMisses: 0,
      connectionAcquires: 0,
      connectionReleases: 0,
      connectionErrors: 0,
      lastQueryTime: 0,
      uptime: 0,
    };
  }

  /**
   * Create error result for MCP tools.
   */
  private createErrorResult(error: Error): MCPToolResult {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error.message,
          code: (error as { code?: string }).code,
        }, null, 2),
      }],
      isError: true,
    };
  }

  /**
   * Get plugin uptime.
   */
  override getUptime(): number {
    if (!this.initTime) return 0;
    return Date.now() - this.initTime.getTime();
  }

  /**
   * Get current metrics.
   */
  getMetrics(): RuVectorMetrics {
    return {
      ...this.metrics,
      uptime: this.getUptime(),
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new RuVector Bridge plugin instance.
 *
 * @example
 * ```typescript
 * const bridge = createRuVectorBridge({
 *   host: 'localhost',
 *   port: 5432,
 *   database: 'vectors',
 *   user: 'postgres',
 *   password: 'password',
 * });
 * ```
 */
export function createRuVectorBridge(config: RuVectorConfig): RuVectorBridge {
  return new RuVectorBridge(config);
}

// ============================================================================
// Default Export
// ============================================================================

export default RuVectorBridge;
