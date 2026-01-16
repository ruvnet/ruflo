/**
 * RuVector PostgreSQL Bridge - Streaming and Transaction Support
 *
 * Provides streaming capabilities for large result sets and batch operations,
 * enhanced transaction handling with savepoints and isolation levels,
 * and efficient batch processing with backpressure handling.
 *
 * @module @claude-flow/plugins/integrations/ruvector/streaming
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import type {
  VectorSearchOptions,
  VectorSearchResult,
  VectorInsertOptions,
  VectorUpdateOptions,
  BatchResult,
  DistanceMetric,
  QueryResult,
} from './types.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * PostgreSQL PoolClient interface (from pg package).
 */
export interface PoolClient {
  query<T = unknown>(text: string, values?: unknown[]): Promise<PgQueryResult<T>>;
  release(err?: Error): void;
}

/**
 * PostgreSQL query result interface.
 */
interface PgQueryResult<T> {
  rows: T[];
  rowCount: number | null;
  command: string;
  fields?: Array<{ name: string; dataTypeID: number }>;
}

/**
 * Pool interface for connection management.
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

/**
 * Extended search options for streaming operations.
 */
export interface StreamSearchOptions extends VectorSearchOptions {
  /** Number of results per batch (default: 1000) */
  batchSize?: number;
  /** Cursor name for server-side cursor */
  cursorName?: string;
  /** Query timeout in milliseconds */
  timeout?: number;
  /** Whether to use a server-side cursor */
  useServerCursor?: boolean;
  /** Fetch direction for cursor */
  fetchDirection?: 'forward' | 'backward';
}

/**
 * Insert result for streaming operations.
 */
export interface InsertResult {
  /** ID of the inserted vector */
  id: string | number;
  /** Whether the insert was successful */
  success: boolean;
  /** Error message if insert failed */
  error?: string;
  /** Batch index */
  batchIndex: number;
  /** Item index within batch */
  itemIndex: number;
}

/**
 * Vector entry for streaming inserts.
 */
export interface VectorEntry {
  /** Optional ID (auto-generated if not provided) */
  id?: string | number;
  /** Vector data */
  vector: number[] | Float32Array;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Transaction isolation levels.
 */
export type IsolationLevel = 'read_committed' | 'repeatable_read' | 'serializable';

/**
 * Batch processing options.
 */
export interface BatchOptions {
  /** Batch size for processing */
  batchSize?: number;
  /** Maximum concurrent batches */
  concurrency?: number;
  /** Retry failed operations */
  retryOnFailure?: boolean;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Enable transaction mode */
  useTransaction?: boolean;
}

/**
 * Pool events interface.
 */
export interface PoolEvents {
  'pool:connect': (client: PoolClient) => void;
  'pool:acquire': (client: PoolClient) => void;
  'pool:release': (client: PoolClient) => void;
  'pool:remove': (client: PoolClient) => void;
  'pool:error': (error: Error, client?: PoolClient) => void;
}

/**
 * Stream state for backpressure handling.
 */
interface StreamState {
  paused: boolean;
  buffer: unknown[];
  bufferSize: number;
  highWaterMark: number;
  drainPromise: Promise<void> | null;
  drainResolve: (() => void) | null;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_HIGH_WATER_MARK = 16384;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_CURSOR_PREFIX = 'ruvector_cursor_';

// Distance operators mapping
const DISTANCE_OPERATORS: Record<DistanceMetric, string> = {
  cosine: '<=>',
  euclidean: '<->',
  dot: '<#>',
  hamming: '<~>',
  manhattan: '<+>',
  chebyshev: '<+>',
  jaccard: '<~>',
  minkowski: '<->',
  bray_curtis: '<->',
  canberra: '<->',
  mahalanobis: '<->',
  correlation: '<=>',
};

// ============================================================================
// RuVectorStream Class
// ============================================================================

/**
 * Streaming support for RuVector operations.
 *
 * Provides async generators for streaming large result sets and batch inserts
 * with backpressure handling.
 *
 * @example
 * ```typescript
 * const stream = new RuVectorStream(pool, config);
 *
 * // Stream search results
 * for await (const result of stream.streamSearch({ query: vector, k: 10000 })) {
 *   console.log(result);
 * }
 *
 * // Stream inserts
 * async function* vectorGenerator() {
 *   for (let i = 0; i < 100000; i++) {
 *     yield { vector: generateVector(), metadata: { index: i } };
 *   }
 * }
 *
 * for await (const result of stream.streamInsert(vectorGenerator())) {
 *   console.log(`Inserted: ${result.id}`);
 * }
 * ```
 */
export class RuVectorStream extends EventEmitter {
  private readonly pool: Pool;
  private readonly schema?: string;
  private readonly defaultTableName: string;
  private readonly state: StreamState;
  private activeClient: PoolClient | null = null;
  private activeCursors: Set<string> = new Set();

  constructor(
    pool: Pool,
    options: {
      schema?: string;
      defaultTableName?: string;
      highWaterMark?: number;
    } = {}
  ) {
    super();
    this.pool = pool;
    this.schema = options.schema;
    this.defaultTableName = options.defaultTableName ?? 'vectors';
    this.state = {
      paused: false,
      buffer: [],
      bufferSize: 0,
      highWaterMark: options.highWaterMark ?? DEFAULT_HIGH_WATER_MARK,
      drainPromise: null,
      drainResolve: null,
    };
  }

  // ===========================================================================
  // Stream Search
  // ===========================================================================

  /**
   * Stream large result sets using server-side cursors.
   *
   * @param options - Search options with streaming configuration
   * @yields {VectorSearchResult} Individual search results
   */
  async *streamSearch(options: StreamSearchOptions): AsyncGenerator<VectorSearchResult, void, undefined> {
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const cursorName = options.cursorName ?? `${DEFAULT_CURSOR_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const useServerCursor = options.useServerCursor ?? true;

    const client = await this.pool.connect();
    this.activeClient = client;
    this.activeCursors.add(cursorName);

    try {
      // Set statement timeout
      await client.query(`SET LOCAL statement_timeout = ${timeout}`);

      if (useServerCursor) {
        // Use server-side cursor for memory efficiency
        yield* this.streamWithCursor(client, options, cursorName, batchSize);
      } else {
        // Use OFFSET/LIMIT pagination (less efficient but simpler)
        yield* this.streamWithPagination(client, options, batchSize);
      }
    } finally {
      // Cleanup
      if (this.activeCursors.has(cursorName)) {
        try {
          await client.query(`CLOSE ${this.escapeIdentifier(cursorName)}`);
        } catch {
          // Cursor may already be closed
        }
        this.activeCursors.delete(cursorName);
      }
      client.release();
      this.activeClient = null;
    }
  }

  /**
   * Stream results using a server-side cursor.
   */
  private async *streamWithCursor(
    client: PoolClient,
    options: StreamSearchOptions,
    cursorName: string,
    batchSize: number
  ): AsyncGenerator<VectorSearchResult, void, undefined> {
    const { sql, params } = this.buildSearchQuery(options);
    const escapedCursor = this.escapeIdentifier(cursorName);

    // Begin transaction for cursor
    await client.query('BEGIN');

    try {
      // Declare cursor
      await client.query(
        `DECLARE ${escapedCursor} CURSOR WITH HOLD FOR ${sql}`,
        params
      );

      let rank = 0;
      let hasMore = true;

      while (hasMore) {
        // Wait if paused (backpressure)
        await this.waitIfPaused();

        // Fetch batch
        const fetchResult = await client.query<{
          id: string | number;
          distance: number;
          [key: string]: unknown;
        }>(
          `FETCH ${batchSize} FROM ${escapedCursor}`
        );

        if (fetchResult.rows.length === 0) {
          hasMore = false;
          break;
        }

        // Yield individual results
        for (const row of fetchResult.rows) {
          rank++;
          const result = this.transformSearchResult(row, options, rank);
          yield result;

          this.emit('result', result);
        }

        // Check if we've received less than batch size (end of results)
        if (fetchResult.rows.length < batchSize) {
          hasMore = false;
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  /**
   * Stream results using OFFSET/LIMIT pagination.
   */
  private async *streamWithPagination(
    client: PoolClient,
    options: StreamSearchOptions,
    batchSize: number
  ): AsyncGenerator<VectorSearchResult, void, undefined> {
    const { sql: baseSql, params } = this.buildSearchQuery(options, true);

    let offset = 0;
    let rank = 0;
    let hasMore = true;

    while (hasMore) {
      // Wait if paused (backpressure)
      await this.waitIfPaused();

      const sql = `${baseSql} LIMIT ${batchSize} OFFSET ${offset}`;
      const result = await client.query<{
        id: string | number;
        distance: number;
        [key: string]: unknown;
      }>(sql, params);

      if (result.rows.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of result.rows) {
        rank++;
        const searchResult = this.transformSearchResult(row, options, rank);
        yield searchResult;

        this.emit('result', searchResult);
      }

      offset += batchSize;

      if (result.rows.length < batchSize) {
        hasMore = false;
      }
    }
  }

  /**
   * Build the search query SQL.
   */
  private buildSearchQuery(
    options: StreamSearchOptions,
    forPagination = false
  ): { sql: string; params: unknown[] } {
    const tableName = options.tableName ?? this.defaultTableName;
    const vectorColumn = options.vectorColumn ?? 'embedding';
    const metric = options.metric ?? 'cosine';
    const operator = DISTANCE_OPERATORS[metric] ?? '<=>';

    const queryVector = this.formatVector(options.query);
    const schemaPrefix = this.schema ? `${this.escapeIdentifier(this.schema)}.` : '';

    // Build SELECT columns
    const selectColumns = options.selectColumns ?? ['id'];
    const columnList = [...selectColumns];

    if (options.includeVector) {
      columnList.push(vectorColumn);
    }
    if (options.includeMetadata) {
      columnList.push('metadata');
    }

    const distanceExpr = `${this.escapeIdentifier(vectorColumn)} ${operator} '${queryVector}'::vector`;
    columnList.push(`(${distanceExpr}) as distance`);

    // Build WHERE clause
    const whereClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options.threshold !== undefined) {
      if (metric === 'cosine' || metric === 'dot') {
        whereClauses.push(`(1 - (${distanceExpr})) >= $${paramIndex++}`);
        params.push(options.threshold);
      } else {
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
          whereClauses.push(`metadata @> $${paramIndex++}::jsonb`);
          params.push(JSON.stringify(value));
        } else {
          whereClauses.push(`${this.escapeIdentifier(key)} = $${paramIndex++}`);
          params.push(value);
        }
      }
    }

    // Build query
    let sql = `SELECT ${columnList.join(', ')} FROM ${schemaPrefix}${this.escapeIdentifier(tableName)}`;

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    sql += ` ORDER BY ${distanceExpr} ASC`;

    // For cursor-based streaming, don't add LIMIT (cursor handles it)
    // For pagination, LIMIT/OFFSET will be added by the caller
    if (!forPagination && options.k) {
      sql += ` LIMIT ${options.k}`;
    }

    return { sql, params };
  }

  /**
   * Transform a database row into a VectorSearchResult.
   */
  private transformSearchResult(
    row: { id: string | number; distance: number; [key: string]: unknown },
    options: StreamSearchOptions,
    rank: number
  ): VectorSearchResult {
    const metric = options.metric ?? 'cosine';
    const score = metric === 'cosine' || metric === 'dot'
      ? 1 - row.distance
      : 1 / (1 + row.distance);

    const result: VectorSearchResult = {
      id: row.id,
      score,
      distance: row.distance,
      rank,
      retrievedAt: new Date(),
    };

    if (options.includeVector && row[options.vectorColumn ?? 'embedding']) {
      (result as { vector?: number[] }).vector = this.parseVector(
        row[options.vectorColumn ?? 'embedding'] as string
      );
    }

    if (options.includeMetadata && row.metadata) {
      (result as { metadata?: Record<string, unknown> }).metadata =
        row.metadata as Record<string, unknown>;
    }

    return result;
  }

  // ===========================================================================
  // Stream Insert
  // ===========================================================================

  /**
   * Stream batch inserts for large datasets.
   *
   * @param vectors - Async iterable of vector entries
   * @param options - Insert configuration options
   * @yields {InsertResult} Individual insert results
   */
  async *streamInsert(
    vectors: AsyncIterable<VectorEntry>,
    options: {
      tableName?: string;
      vectorColumn?: string;
      batchSize?: number;
      upsert?: boolean;
      conflictColumns?: string[];
    } = {}
  ): AsyncGenerator<InsertResult, void, undefined> {
    const tableName = options.tableName ?? this.defaultTableName;
    const vectorColumn = options.vectorColumn ?? 'embedding';
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const schemaPrefix = this.schema ? `${this.escapeIdentifier(this.schema)}.` : '';

    let batch: VectorEntry[] = [];
    let batchIndex = 0;
    let totalProcessed = 0;

    const client = await this.pool.connect();
    this.activeClient = client;

    try {
      // Process vectors in batches
      for await (const entry of vectors) {
        // Wait if paused (backpressure)
        await this.waitIfPaused();

        batch.push(entry);

        if (batch.length >= batchSize) {
          // Process batch
          const results = await this.insertBatch(
            client,
            batch,
            tableName,
            vectorColumn,
            schemaPrefix,
            batchIndex,
            options.upsert,
            options.conflictColumns
          );

          for (const result of results) {
            yield result;
            totalProcessed++;
            this.emit('insert', result);
          }

          batch = [];
          batchIndex++;
        }
      }

      // Process remaining items
      if (batch.length > 0) {
        const results = await this.insertBatch(
          client,
          batch,
          tableName,
          vectorColumn,
          schemaPrefix,
          batchIndex,
          options.upsert,
          options.conflictColumns
        );

        for (const result of results) {
          yield result;
          totalProcessed++;
          this.emit('insert', result);
        }
      }

      this.emit('complete', { totalProcessed, batches: batchIndex + 1 });
    } finally {
      client.release();
      this.activeClient = null;
    }
  }

  /**
   * Insert a batch of vectors.
   */
  private async insertBatch(
    client: PoolClient,
    batch: VectorEntry[],
    tableName: string,
    vectorColumn: string,
    schemaPrefix: string,
    batchIndex: number,
    upsert?: boolean,
    conflictColumns?: string[]
  ): Promise<InsertResult[]> {
    const results: InsertResult[] = [];

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

    if (upsert) {
      const conflictCols = conflictColumns ?? ['id'];
      sql += ` ON CONFLICT (${conflictCols.join(', ')}) DO UPDATE SET `;
      sql += `${this.escapeIdentifier(vectorColumn)} = EXCLUDED.${this.escapeIdentifier(vectorColumn)}, `;
      sql += `metadata = EXCLUDED.metadata`;
    }

    sql += ' RETURNING id';

    try {
      const result = await client.query<{ id: string | number }>(sql, params);

      for (let i = 0; i < result.rows.length; i++) {
        results.push({
          id: result.rows[i].id,
          success: true,
          batchIndex,
          itemIndex: i,
        });
      }
    } catch (error) {
      // On batch failure, try individual inserts
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        try {
          const vector = this.formatVector(item.vector);
          const metadata = item.metadata ? JSON.stringify(item.metadata) : null;

          const singleSql = `INSERT INTO ${schemaPrefix}${this.escapeIdentifier(tableName)} ` +
            `(id, ${this.escapeIdentifier(vectorColumn)}, metadata) VALUES ` +
            `($1, '${vector}'::vector, $2::jsonb) RETURNING id`;

          const singleResult = await client.query<{ id: string | number }>(
            singleSql,
            [item.id ?? null, metadata]
          );

          results.push({
            id: singleResult.rows[0]?.id ?? item.id ?? 'unknown',
            success: true,
            batchIndex,
            itemIndex: i,
          });
        } catch (itemError) {
          results.push({
            id: item.id ?? 'unknown',
            success: false,
            error: (itemError as Error).message,
            batchIndex,
            itemIndex: i,
          });
        }
      }
    }

    return results;
  }

  // ===========================================================================
  // Backpressure Handling
  // ===========================================================================

  /**
   * Pause the stream (backpressure).
   */
  pause(): void {
    this.state.paused = true;
    this.emit('pause');
  }

  /**
   * Resume the stream.
   */
  resume(): void {
    this.state.paused = false;
    if (this.state.drainResolve) {
      this.state.drainResolve();
      this.state.drainResolve = null;
      this.state.drainPromise = null;
    }
    this.emit('resume');
  }

  /**
   * Check if stream is paused.
   */
  isPaused(): boolean {
    return this.state.paused;
  }

  /**
   * Wait if the stream is paused.
   */
  private async waitIfPaused(): Promise<void> {
    if (!this.state.paused) {
      return;
    }

    if (!this.state.drainPromise) {
      this.state.drainPromise = new Promise<void>(resolve => {
        this.state.drainResolve = resolve;
      });
    }

    await this.state.drainPromise;
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Abort all active operations.
   */
  async abort(): Promise<void> {
    // Close all active cursors
    if (this.activeClient) {
      const cursors = Array.from(this.activeCursors);
      for (let i = 0; i < cursors.length; i++) {
        const cursorName = cursors[i];
        try {
          await this.activeClient.query(`CLOSE ${this.escapeIdentifier(cursorName)}`);
        } catch {
          // Ignore errors
        }
      }
      this.activeCursors.clear();
    }

    this.emit('abort');
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

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
    const cleaned = vectorStr.replace(/[\[\]{}]/g, '');
    return cleaned.split(',').map(Number);
  }

  /**
   * Escape SQL identifier.
   */
  private escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }
}

// ============================================================================
// RuVectorTransaction Class
// ============================================================================

/**
 * Enhanced transaction support for RuVector operations.
 *
 * Provides transaction management with:
 * - Isolation levels (read_committed, repeatable_read, serializable)
 * - Savepoints for partial rollback
 * - Vector operations within transaction context
 *
 * @example
 * ```typescript
 * const tx = new RuVectorTransaction(client);
 * await tx.begin('serializable');
 *
 * try {
 *   await tx.savepoint('before_insert');
 *   await tx.insert({ tableName: 'vectors', vectors: [...] });
 *
 *   const results = await tx.search({ query: vector, k: 10 });
 *
 *   if (results.length === 0) {
 *     await tx.rollbackToSavepoint('before_insert');
 *   }
 *
 *   await tx.commit();
 * } catch (error) {
 *   await tx.rollback();
 *   throw error;
 * }
 * ```
 */
export class RuVectorTransaction extends EventEmitter {
  private readonly client: PoolClient;
  private readonly schema?: string;
  private readonly defaultTableName: string;
  private transactionId: string | null = null;
  private isActive = false;
  private savepoints: Set<string> = new Set();
  private queryCount = 0;
  private startTime: number | null = null;

  constructor(
    client: PoolClient,
    options: {
      schema?: string;
      defaultTableName?: string;
    } = {}
  ) {
    super();
    this.client = client;
    this.schema = options.schema;
    this.defaultTableName = options.defaultTableName ?? 'vectors';
  }

  // ===========================================================================
  // Transaction Control
  // ===========================================================================

  /**
   * Begin a transaction with optional isolation level.
   *
   * @param isolation - Transaction isolation level
   */
  async begin(isolation?: IsolationLevel): Promise<void> {
    if (this.isActive) {
      throw new Error('Transaction already active');
    }

    this.transactionId = `tx_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.startTime = Date.now();

    let sql = 'BEGIN';
    if (isolation) {
      sql += ` ISOLATION LEVEL ${isolation.replace('_', ' ').toUpperCase()}`;
    }

    await this.client.query(sql);
    this.isActive = true;
    this.queryCount = 1;

    this.emit('begin', { transactionId: this.transactionId, isolation });
  }

  /**
   * Create a savepoint within the transaction.
   *
   * @param name - Savepoint name
   */
  async savepoint(name: string): Promise<void> {
    this.ensureActive();

    const escapedName = this.escapeIdentifier(name);
    await this.client.query(`SAVEPOINT ${escapedName}`);
    this.savepoints.add(name);
    this.queryCount++;

    this.emit('savepoint', { transactionId: this.transactionId, name });
  }

  /**
   * Rollback to a savepoint.
   *
   * @param name - Savepoint name
   */
  async rollbackToSavepoint(name: string): Promise<void> {
    this.ensureActive();

    if (!this.savepoints.has(name)) {
      throw new Error(`Savepoint '${name}' does not exist`);
    }

    const escapedName = this.escapeIdentifier(name);
    await this.client.query(`ROLLBACK TO SAVEPOINT ${escapedName}`);
    this.queryCount++;

    this.emit('rollback_to_savepoint', { transactionId: this.transactionId, name });
  }

  /**
   * Release a savepoint.
   *
   * @param name - Savepoint name
   */
  async releaseSavepoint(name: string): Promise<void> {
    this.ensureActive();

    if (!this.savepoints.has(name)) {
      throw new Error(`Savepoint '${name}' does not exist`);
    }

    const escapedName = this.escapeIdentifier(name);
    await this.client.query(`RELEASE SAVEPOINT ${escapedName}`);
    this.savepoints.delete(name);
    this.queryCount++;

    this.emit('release_savepoint', { transactionId: this.transactionId, name });
  }

  /**
   * Commit the transaction.
   */
  async commit(): Promise<void> {
    this.ensureActive();

    await this.client.query('COMMIT');
    const durationMs = this.startTime ? Date.now() - this.startTime : 0;

    this.emit('commit', {
      transactionId: this.transactionId,
      queryCount: this.queryCount,
      durationMs,
    });

    this.cleanup();
  }

  /**
   * Rollback the transaction.
   */
  async rollback(): Promise<void> {
    if (!this.isActive) {
      return; // Already rolled back or not started
    }

    await this.client.query('ROLLBACK');
    const durationMs = this.startTime ? Date.now() - this.startTime : 0;

    this.emit('rollback', {
      transactionId: this.transactionId,
      queryCount: this.queryCount,
      durationMs,
    });

    this.cleanup();
  }

  // ===========================================================================
  // Vector Operations within Transaction
  // ===========================================================================

  /**
   * Perform vector search within the transaction.
   */
  async search(options: VectorSearchOptions): Promise<VectorSearchResult[]> {
    this.ensureActive();

    const { sql, params } = this.buildSearchQuery(options);
    const result = await this.client.query<{
      id: string | number;
      distance: number;
      [key: string]: unknown;
    }>(sql, params);

    this.queryCount++;

    const metric = options.metric ?? 'cosine';
    return result.rows.map((row, index) => {
      const score = metric === 'cosine' || metric === 'dot'
        ? 1 - row.distance
        : 1 / (1 + row.distance);

      const searchResult: VectorSearchResult = {
        id: row.id,
        score,
        distance: row.distance,
        rank: index + 1,
        retrievedAt: new Date(),
      };

      if (options.includeVector && row[options.vectorColumn ?? 'embedding']) {
        (searchResult as { vector?: number[] }).vector = this.parseVector(
          row[options.vectorColumn ?? 'embedding'] as string
        );
      }

      if (options.includeMetadata && row.metadata) {
        (searchResult as { metadata?: Record<string, unknown> }).metadata =
          row.metadata as Record<string, unknown>;
      }

      return searchResult;
    });
  }

  /**
   * Insert vectors within the transaction.
   */
  async insert(options: VectorInsertOptions): Promise<BatchResult<string>> {
    this.ensureActive();

    const startTime = Date.now();
    const tableName = options.tableName ?? this.defaultTableName;
    const vectorColumn = options.vectorColumn ?? 'embedding';
    const schemaPrefix = this.schema ? `${this.escapeIdentifier(this.schema)}.` : '';

    const successful: string[] = [];
    const errors: Array<{ index: number; message: string; input?: unknown }> = [];

    // Build multi-row INSERT
    const values: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    for (const item of options.vectors) {
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

    sql += ' RETURNING id';

    try {
      const result = await this.client.query<{ id: string }>(sql, params);
      this.queryCount++;

      if (result.rows) {
        successful.push(...result.rows.map(r => String(r.id)));
      }
    } catch (error) {
      errors.push({
        index: 0,
        message: (error as Error).message,
      });
    }

    const durationMs = Date.now() - startTime;
    const insertedCount = successful.length;

    return {
      total: options.vectors.length,
      successful: insertedCount,
      failed: options.vectors.length - insertedCount,
      results: successful,
      errors: errors.length > 0 ? errors : undefined,
      durationMs,
      throughput: insertedCount / (durationMs / 1000),
    };
  }

  /**
   * Update a vector within the transaction.
   */
  async update(options: VectorUpdateOptions): Promise<boolean> {
    this.ensureActive();

    const tableName = options.tableName ?? this.defaultTableName;
    const vectorColumn = options.vectorColumn ?? 'embedding';
    const schemaPrefix = this.schema ? `${this.escapeIdentifier(this.schema)}.` : '';

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

    const result = await this.client.query(sql, params);
    this.queryCount++;

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Delete vectors within the transaction.
   *
   * @param ids - IDs to delete
   * @param tableName - Table name (optional)
   * @returns Number of deleted rows
   */
  async delete(ids: (string | number)[], tableName?: string): Promise<number> {
    this.ensureActive();

    const table = tableName ?? this.defaultTableName;
    const schemaPrefix = this.schema ? `${this.escapeIdentifier(this.schema)}.` : '';

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `DELETE FROM ${schemaPrefix}${this.escapeIdentifier(table)} WHERE id IN (${placeholders})`;

    const result = await this.client.query(sql, ids);
    this.queryCount++;

    return result.rowCount ?? 0;
  }

  /**
   * Execute a raw query within the transaction.
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    this.ensureActive();

    const startTime = Date.now();
    const result = await this.client.query<T>(sql, params);
    this.queryCount++;

    return {
      rows: result.rows,
      rowCount: result.rowCount ?? 0,
      durationMs: Date.now() - startTime,
      command: result.command,
    };
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Get transaction status.
   */
  getStatus(): {
    transactionId: string | null;
    isActive: boolean;
    savepoints: string[];
    queryCount: number;
    durationMs: number;
  } {
    return {
      transactionId: this.transactionId,
      isActive: this.isActive,
      savepoints: Array.from(this.savepoints),
      queryCount: this.queryCount,
      durationMs: this.startTime ? Date.now() - this.startTime : 0,
    };
  }

  /**
   * Ensure transaction is active.
   */
  private ensureActive(): void {
    if (!this.isActive) {
      throw new Error('Transaction is not active. Call begin() first.');
    }
  }

  /**
   * Build search query SQL.
   */
  private buildSearchQuery(options: VectorSearchOptions): { sql: string; params: unknown[] } {
    const tableName = options.tableName ?? this.defaultTableName;
    const vectorColumn = options.vectorColumn ?? 'embedding';
    const metric = options.metric ?? 'cosine';
    const operator = DISTANCE_OPERATORS[metric] ?? '<=>';

    const queryVector = this.formatVector(options.query);
    const schemaPrefix = this.schema ? `${this.escapeIdentifier(this.schema)}.` : '';

    const selectColumns = options.selectColumns ?? ['id'];
    const columnList = [...selectColumns];

    if (options.includeVector) {
      columnList.push(vectorColumn);
    }
    if (options.includeMetadata) {
      columnList.push('metadata');
    }

    const distanceExpr = `${this.escapeIdentifier(vectorColumn)} ${operator} '${queryVector}'::vector`;
    columnList.push(`(${distanceExpr}) as distance`);

    const whereClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options.filter) {
      for (const [key, value] of Object.entries(options.filter)) {
        if (key === 'metadata') {
          whereClauses.push(`metadata @> $${paramIndex++}::jsonb`);
          params.push(JSON.stringify(value));
        } else {
          whereClauses.push(`${this.escapeIdentifier(key)} = $${paramIndex++}`);
          params.push(value);
        }
      }
    }

    let sql = `SELECT ${columnList.join(', ')} FROM ${schemaPrefix}${this.escapeIdentifier(tableName)}`;

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    sql += ` ORDER BY ${distanceExpr} ASC`;
    sql += ` LIMIT ${options.k}`;

    return { sql, params };
  }

  /**
   * Cleanup transaction state.
   */
  private cleanup(): void {
    this.isActive = false;
    this.savepoints.clear();
    this.transactionId = null;
    this.startTime = null;
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
    const cleaned = vectorStr.replace(/[\[\]{}]/g, '');
    return cleaned.split(',').map(Number);
  }

  /**
   * Escape SQL identifier.
   */
  private escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }
}

// ============================================================================
// BatchProcessor Class
// ============================================================================

/**
 * Batch processor for large dataset operations.
 *
 * Provides efficient processing of large datasets with configurable
 * batch sizes, concurrency, and error handling.
 *
 * @example
 * ```typescript
 * const processor = new BatchProcessor(bridge, { batchSize: 500, concurrency: 4 });
 *
 * async function* loadData() {
 *   for (const item of massiveDataset) {
 *     yield item;
 *   }
 * }
 *
 * for await (const result of processor.processBatch(loadData(), async (batch) => {
 *   return batch.map(item => processItem(item));
 * })) {
 *   console.log(result);
 * }
 * ```
 */
export class BatchProcessor extends EventEmitter {
  private readonly pool: Pool;
  private readonly options: Required<BatchOptions>;
  private readonly schema?: string;

  constructor(
    pool: Pool,
    options: BatchOptions & { schema?: string } = {}
  ) {
    super();
    this.pool = pool;
    this.schema = options.schema;
    this.options = {
      batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
      concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
      retryOnFailure: options.retryOnFailure ?? true,
      maxRetries: options.maxRetries ?? 3,
      useTransaction: options.useTransaction ?? false,
    };
  }

  /**
   * Process items in batches with custom processor function.
   *
   * @param items - Async iterable of items to process
   * @param processor - Batch processing function
   * @param options - Processing options
   * @yields Processed results
   */
  async *processBatch<T, R>(
    items: AsyncIterable<T>,
    processor: (batch: T[]) => Promise<R[]>,
    options?: {
      batchSize?: number;
      concurrency?: number;
      onBatchComplete?: (batchIndex: number, results: R[]) => void;
    }
  ): AsyncGenerator<R, void, undefined> {
    const batchSize = options?.batchSize ?? this.options.batchSize;
    const concurrency = options?.concurrency ?? this.options.concurrency;

    let batch: T[] = [];
    let batchIndex = 0;
    const pendingBatches: Promise<{ index: number; results: R[] }>[] = [];

    // Process items and accumulate into batches
    for await (const item of items) {
      batch.push(item);

      if (batch.length >= batchSize) {
        const currentBatch = batch;
        const currentIndex = batchIndex;
        batch = [];
        batchIndex++;

        // Add batch to processing queue
        const batchPromise = this.processSingleBatch(
          currentBatch,
          processor,
          currentIndex
        ).then(results => {
          options?.onBatchComplete?.(currentIndex, results);
          return { index: currentIndex, results };
        });

        pendingBatches.push(batchPromise);

        // Yield results when we have enough pending batches
        if (pendingBatches.length >= concurrency) {
          const completed = await Promise.race(
            pendingBatches.map((p, i) => p.then(r => ({ ...r, promiseIndex: i })))
          );

          // Remove completed batch from pending
          pendingBatches.splice(completed.promiseIndex, 1);

          for (const result of completed.results) {
            yield result;
          }
        }
      }
    }

    // Process remaining batch
    if (batch.length > 0) {
      const results = await this.processSingleBatch(batch, processor, batchIndex);
      options?.onBatchComplete?.(batchIndex, results);
      for (const result of results) {
        yield result;
      }
    }

    // Wait for remaining pending batches
    const remainingResults = await Promise.all(pendingBatches);
    for (const { results } of remainingResults.sort((a, b) => a.index - b.index)) {
      for (const result of results) {
        yield result;
      }
    }
  }

  /**
   * Perform parallel search across multiple queries.
   *
   * @param queries - Array of query vectors
   * @param options - Search options
   * @returns Array of search results for each query
   */
  async parallelSearch(
    queries: number[][],
    options: Omit<VectorSearchOptions, 'query'>
  ): Promise<VectorSearchResult[][]> {
    const concurrency = this.options.concurrency;
    const results: VectorSearchResult[][] = new Array(queries.length);

    // Process queries in parallel batches
    for (let i = 0; i < queries.length; i += concurrency) {
      const batchQueries = queries.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batchQueries.map((query, j) =>
          this.executeSingleSearch({ ...options, query } as VectorSearchOptions)
            .then(r => ({ index: i + j, results: r }))
        )
      );

      for (const { index, results: searchResults } of batchResults) {
        results[index] = searchResults;
      }

      this.emit('batch_search_complete', {
        batchStart: i,
        batchEnd: Math.min(i + concurrency, queries.length),
        total: queries.length,
      });
    }

    return results;
  }

  /**
   * Process a single batch with retry support.
   */
  private async processSingleBatch<T, R>(
    batch: T[],
    processor: (batch: T[]) => Promise<R[]>,
    batchIndex: number
  ): Promise<R[]> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.options.maxRetries) {
      attempt++;
      try {
        const results = await processor(batch);
        this.emit('batch_complete', { batchIndex, attempt, success: true });
        return results;
      } catch (error) {
        lastError = error as Error;
        this.emit('batch_error', { batchIndex, attempt, error: lastError });

        if (!this.options.retryOnFailure || attempt >= this.options.maxRetries) {
          break;
        }

        // Exponential backoff
        await this.sleep(Math.min(1000 * Math.pow(2, attempt - 1), 10000));
      }
    }

    throw new Error(`Batch ${batchIndex} failed after ${attempt} attempts: ${lastError?.message}`);
  }

  /**
   * Execute a single search query.
   */
  private async executeSingleSearch(
    options: VectorSearchOptions
  ): Promise<VectorSearchResult[]> {
    const client = await this.pool.connect();
    try {
      const { sql, params } = this.buildSearchQuery(options);
      const result = await client.query<{
        id: string | number;
        distance: number;
        [key: string]: unknown;
      }>(sql, params);

      const metric = options.metric ?? 'cosine';
      return result.rows.map((row, index) => {
        const score = metric === 'cosine' || metric === 'dot'
          ? 1 - row.distance
          : 1 / (1 + row.distance);

        return {
          id: row.id,
          score,
          distance: row.distance,
          rank: index + 1,
          retrievedAt: new Date(),
        };
      });
    } finally {
      client.release();
    }
  }

  /**
   * Build search query SQL.
   */
  private buildSearchQuery(options: VectorSearchOptions): { sql: string; params: unknown[] } {
    const tableName = options.tableName ?? 'vectors';
    const vectorColumn = options.vectorColumn ?? 'embedding';
    const metric = options.metric ?? 'cosine';
    const operator = DISTANCE_OPERATORS[metric] ?? '<=>';

    const queryVector = this.formatVector(options.query);
    const schemaPrefix = this.schema ? `"${this.schema}".` : '';

    const selectColumns = options.selectColumns ?? ['id'];
    const distanceExpr = `"${vectorColumn}" ${operator} '${queryVector}'::vector`;

    let sql = `SELECT ${selectColumns.join(', ')}, (${distanceExpr}) as distance ` +
      `FROM ${schemaPrefix}"${tableName}" ` +
      `ORDER BY ${distanceExpr} ASC ` +
      `LIMIT ${options.k}`;

    return { sql, params: [] };
  }

  /**
   * Format vector for SQL.
   */
  private formatVector(vector: number[] | Float32Array): string {
    const arr = Array.isArray(vector) ? vector : Array.from(vector);
    return `[${arr.join(',')}]`;
  }

  /**
   * Sleep utility.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// PoolEventEmitter Class
// ============================================================================

/**
 * Event emitter for connection pool lifecycle events.
 *
 * Provides typed event handling for pool operations.
 *
 * @example
 * ```typescript
 * const poolEvents = new PoolEventEmitter(pool);
 *
 * poolEvents.on('pool:connect', (client) => {
 *   console.log('Client connected');
 * });
 *
 * poolEvents.on('pool:error', (error, client) => {
 *   console.error('Pool error:', error);
 * });
 * ```
 */
export class PoolEventEmitter extends EventEmitter {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    super();
    this.pool = pool;
    this.setupListeners();
  }

  /**
   * Add typed event listener.
   */
  on<K extends keyof PoolEvents>(event: K, listener: PoolEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Add one-time typed event listener.
   */
  once<K extends keyof PoolEvents>(event: K, listener: PoolEvents[K]): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Remove typed event listener.
   */
  off<K extends keyof PoolEvents>(event: K, listener: PoolEvents[K]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Emit typed event.
   */
  emit<K extends keyof PoolEvents>(
    event: K,
    ...args: Parameters<PoolEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Get current pool statistics.
   */
  getStats(): {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  } {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }

  /**
   * Setup pool event listeners.
   */
  private setupListeners(): void {
    this.pool.on('connect', (...args: unknown[]) => {
      const client = args[0] as PoolClient;
      this.emit('pool:connect', client);
    });

    this.pool.on('acquire', (...args: unknown[]) => {
      const client = args[0] as PoolClient;
      this.emit('pool:acquire', client);
    });

    this.pool.on('release', (...args: unknown[]) => {
      const client = args[0] as PoolClient;
      this.emit('pool:release', client);
    });

    this.pool.on('remove', (...args: unknown[]) => {
      const client = args[0] as PoolClient;
      this.emit('pool:remove', client);
    });

    this.pool.on('error', (...args: unknown[]) => {
      const error = args[0] as Error;
      const client = args[1] as PoolClient | undefined;
      this.emit('pool:error', error, client);
    });
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new RuVectorStream instance.
 */
export function createRuVectorStream(
  pool: Pool,
  options?: {
    schema?: string;
    defaultTableName?: string;
    highWaterMark?: number;
  }
): RuVectorStream {
  return new RuVectorStream(pool, options);
}

/**
 * Create a new RuVectorTransaction instance.
 */
export function createRuVectorTransaction(
  client: PoolClient,
  options?: {
    schema?: string;
    defaultTableName?: string;
  }
): RuVectorTransaction {
  return new RuVectorTransaction(client, options);
}

/**
 * Create a new BatchProcessor instance.
 */
export function createBatchProcessor(
  pool: Pool,
  options?: BatchOptions & { schema?: string }
): BatchProcessor {
  return new BatchProcessor(pool, options);
}

/**
 * Create a new PoolEventEmitter instance.
 */
export function createPoolEventEmitter(pool: Pool): PoolEventEmitter {
  return new PoolEventEmitter(pool);
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  RuVectorStream,
  RuVectorTransaction,
  BatchProcessor,
  PoolEventEmitter,
  createRuVectorStream,
  createRuVectorTransaction,
  createBatchProcessor,
  createPoolEventEmitter,
};
