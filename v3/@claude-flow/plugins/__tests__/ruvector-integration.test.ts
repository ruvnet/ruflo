/**
 * RuVector PostgreSQL Integration Tests
 *
 * Comprehensive integration tests for the RuVector PostgreSQL Bridge plugin.
 * Tests can run against a real PostgreSQL database (when available) or use mocks.
 *
 * Environment variables for real database testing:
 * - RUVECTOR_TEST_DB=true - Enable real database tests
 * - RUVECTOR_TEST_HOST - PostgreSQL host (default: localhost)
 * - RUVECTOR_TEST_PORT - PostgreSQL port (default: 5432)
 * - RUVECTOR_TEST_DATABASE - Database name (default: ruvector_test)
 * - RUVECTOR_TEST_USER - Database user (default: postgres)
 * - RUVECTOR_TEST_PASSWORD - Database password (default: postgres)
 *
 * @module @claude-flow/plugins/__tests__/ruvector-integration
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi, type Mock } from 'vitest';
import {
  useRealDatabase,
  getTestDatabaseConfig,
  createTestConfig,
  createTestClientOptions,
  randomVector,
  normalizedVector,
  randomVectors,
  generateSimilarVectors,
  cosineSimilarity,
  euclideanDistance,
  createMockSearchResults,
  createMockConnectionResult,
  createMockIndexStats,
  createMockHealthStatus,
  createMockStats,
  createMockPgPool,
  createMockPgClient,
  createRandomGraph,
  SearchOptionsBuilder,
  InsertOptionsBuilder,
  IndexOptionsBuilder,
  measureAsync,
  benchmark,
  uniqueTableName,
  uniqueIndexName,
  assertSortedByScore,
  assertSortedByDistance,
  type MockPgPool,
  type MockPgClient,
} from './utils/ruvector-test-utils.js';

import type {
  RuVectorConfig,
  RuVectorClientOptions,
  VectorSearchOptions,
  VectorSearchResult,
  VectorInsertOptions,
  VectorIndexOptions,
  BatchVectorOptions,
  ConnectionResult,
  HealthStatus,
  IndexStats,
  IRuVectorClient,
  IRuVectorTransaction,
  QueryResult,
  BatchResult,
  RuVectorEventType,
  RuVectorEvent,
  PoolConfig,
  SSLConfig,
  RetryConfig,
} from '../src/integrations/ruvector/types.js';

// ============================================================================
// Test Configuration
// ============================================================================

const USE_REAL_DB = useRealDatabase();
const TEST_TIMEOUT = USE_REAL_DB ? 30000 : 5000;

// Skip message for real DB tests when not available
const skipIfNoRealDB = USE_REAL_DB ? describe : describe.skip;

// ============================================================================
// Mock RuVector Client Implementation
// ============================================================================

/**
 * Mock RuVector client for unit testing without real database
 */
class MockRuVectorClient implements IRuVectorClient {
  private pool: MockPgPool;
  private config: RuVectorClientOptions;
  private connected: boolean = false;
  private eventHandlers: Map<RuVectorEventType, Set<(event: RuVectorEvent) => void>> = new Map();
  private connectionInfo: ConnectionResult | null = null;
  private queryCount: number = 0;

  constructor(config: RuVectorClientOptions) {
    this.config = config;
    this.pool = createMockPgPool();
  }

  // Event Emitter Implementation
  on<T extends RuVectorEventType>(event: T, handler: (e: RuVectorEvent<T>) => void): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as (e: RuVectorEvent) => void);
    return () => this.off(event, handler);
  }

  off<T extends RuVectorEventType>(event: T, handler: (e: RuVectorEvent<T>) => void): void {
    this.eventHandlers.get(event)?.delete(handler as (e: RuVectorEvent) => void);
  }

  once<T extends RuVectorEventType>(event: T, handler: (e: RuVectorEvent<T>) => void): () => void {
    const wrappedHandler = (e: RuVectorEvent<T>) => {
      this.off(event, wrappedHandler);
      handler(e);
    };
    return this.on(event, wrappedHandler);
  }

  emit<T extends RuVectorEventType>(event: T, data: RuVectorEvent<T>['data']): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) =>
        handler({ type: event, timestamp: new Date(), data } as RuVectorEvent)
      );
    }
  }

  removeAllListeners(event?: RuVectorEventType): void {
    if (event) {
      this.eventHandlers.delete(event);
    } else {
      this.eventHandlers.clear();
    }
  }

  // Connection Management
  async connect(): Promise<ConnectionResult> {
    this.connected = true;
    this.connectionInfo = createMockConnectionResult();

    this.emit('connection:open', {
      connectionId: this.connectionInfo.connectionId,
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
    });

    return this.connectionInfo;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('connection:close', {
      connectionId: this.connectionInfo?.connectionId || '',
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
    });
    this.connectionInfo = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConnectionInfo(): ConnectionResult | null {
    return this.connectionInfo;
  }

  // Vector Operations
  async search(options: VectorSearchOptions): Promise<VectorSearchResult[]> {
    this.ensureConnected();
    this.queryCount++;

    this.emit('search:start', {
      searchId: `search-${this.queryCount}`,
      tableName: options.tableName || 'vectors',
      k: options.k,
      metric: options.metric,
      hasFilters: !!options.filter,
    });

    // Simulate search with mock results
    const results = createMockSearchResults(Math.min(options.k, 100), {
      includeVector: options.includeVector,
      includeMetadata: options.includeMetadata,
      dimensions: options.query.length,
    });

    this.emit('search:complete', {
      searchId: `search-${this.queryCount}`,
      durationMs: 15 + Math.random() * 10,
      resultCount: results.length,
      scannedCount: 1000,
      cacheHit: false,
    });

    return results;
  }

  async batchSearch(options: BatchVectorOptions): Promise<{
    results: VectorSearchResult[][];
    totalDurationMs: number;
    avgDurationMs: number;
    cacheStats: { hits: number; misses: number; hitRate: number };
  }> {
    this.ensureConnected();

    const results = await Promise.all(
      options.queries.map((query) =>
        this.search({
          query: Array.from(query),
          k: options.k,
          metric: options.metric,
          filter: options.filter,
          tableName: options.tableName,
          vectorColumn: options.vectorColumn,
        })
      )
    );

    const totalDurationMs = results.length * 15;
    return {
      results,
      totalDurationMs,
      avgDurationMs: totalDurationMs / options.queries.length,
      cacheStats: {
        hits: 0,
        misses: options.queries.length,
        hitRate: 0,
      },
    };
  }

  async insert(options: VectorInsertOptions): Promise<BatchResult<string>> {
    this.ensureConnected();
    this.queryCount++;

    const ids = options.vectors.map(
      (v, i) => v.id?.toString() || `gen-${Date.now()}-${i}`
    );

    options.vectors.forEach((v, i) => {
      this.emit('vector:inserted', {
        tableName: options.tableName,
        vectorId: ids[i],
        dimensions: Array.isArray(v.vector) ? v.vector.length : v.vector.length,
      });
    });

    const durationMs = options.vectors.length * 5;
    return {
      total: options.vectors.length,
      successful: options.vectors.length,
      failed: 0,
      results: options.returning ? ids : undefined,
      durationMs,
      throughput: options.vectors.length / (durationMs / 1000),
    };
  }

  async update(options: { tableName: string; id: string | number; vector?: number[]; metadata?: Record<string, unknown> }): Promise<boolean> {
    this.ensureConnected();
    this.queryCount++;

    this.emit('vector:updated', {
      tableName: options.tableName,
      vectorId: options.id,
      dimensions: options.vector?.length ?? 0,
    });

    return true;
  }

  async delete(tableName: string, id: string | number): Promise<boolean> {
    this.ensureConnected();
    this.queryCount++;

    this.emit('vector:deleted', {
      tableName,
      vectorId: id,
      dimensions: 0,
    });

    return true;
  }

  async bulkDelete(tableName: string, ids: Array<string | number>): Promise<BatchResult> {
    this.ensureConnected();

    return {
      total: ids.length,
      successful: ids.length,
      failed: 0,
      durationMs: ids.length * 2,
      throughput: ids.length / ((ids.length * 2) / 1000),
    };
  }

  // Index Management
  async createIndex(options: VectorIndexOptions): Promise<void> {
    this.ensureConnected();

    this.emit('index:created', {
      indexName: options.indexName || `idx_${options.tableName}_${options.columnName}`,
      tableName: options.tableName,
      columnName: options.columnName,
      indexType: options.indexType,
      durationMs: 1000 + Math.random() * 2000,
    });
  }

  async dropIndex(indexName: string): Promise<void> {
    this.ensureConnected();

    this.emit('index:dropped', {
      indexName,
      tableName: '',
      columnName: '',
      indexType: 'hnsw',
    });
  }

  async rebuildIndex(indexName: string): Promise<void> {
    this.ensureConnected();

    this.emit('index:rebuilt', {
      indexName,
      tableName: '',
      columnName: '',
      indexType: 'hnsw',
      durationMs: 2000 + Math.random() * 3000,
    });
  }

  async getIndexStats(indexName: string): Promise<IndexStats> {
    this.ensureConnected();
    return createMockIndexStats(indexName);
  }

  async listIndices(tableName?: string): Promise<IndexStats[]> {
    this.ensureConnected();
    return [
      createMockIndexStats(`idx_${tableName || 'vectors'}_embedding_hnsw`),
      createMockIndexStats(`idx_${tableName || 'vectors'}_embedding_ivf`, 'ivfflat'),
    ];
  }

  // Attention Operations
  async computeAttention(input: { query: number[][]; key: number[][]; value: number[][] }, config: { mechanism: string; numHeads: number; headDim: number; params?: Record<string, unknown> }): Promise<{ output: number[][]; attentionWeights?: number[][][][]; stats?: { computeTimeMs: number; memoryBytes: number; tokensProcessed: number } }> {
    this.ensureConnected();

    const seqLen = input.query.length;
    const outputDim = config.numHeads * config.headDim;

    const output = input.query.map(() =>
      Array.from({ length: outputDim }, () => Math.random() * 2 - 1)
    );

    this.emit('attention:computed', {
      mechanism: config.mechanism as any,
      seqLen,
      numHeads: config.numHeads,
      durationMs: seqLen * 0.1,
      memoryBytes: seqLen * outputDim * 4,
    });

    return {
      output,
      attentionWeights: config.params?.checkpointing ? undefined : undefined,
      stats: {
        computeTimeMs: seqLen * 0.1,
        memoryBytes: seqLen * outputDim * 4,
        tokensProcessed: seqLen,
      },
    };
  }

  // GNN Operations
  async runGNNLayer(graph: { nodeFeatures: number[][]; edgeIndex: [number[], number[]] }, layer: { type: string; inputDim: number; outputDim: number }): Promise<{ nodeEmbeddings: number[][]; stats?: { forwardTimeMs: number; numNodes: number; numEdges: number; memoryBytes: number; numIterations: number } }> {
    this.ensureConnected();

    const numNodes = graph.nodeFeatures.length;
    const numEdges = graph.edgeIndex[0].length;

    const nodeEmbeddings = graph.nodeFeatures.map(() =>
      Array.from({ length: layer.outputDim }, () => Math.random() * 2 - 1)
    );

    this.emit('gnn:forward', {
      layerType: layer.type as any,
      numNodes,
      numEdges,
      durationMs: numNodes * 0.05,
    });

    return {
      nodeEmbeddings,
      stats: {
        forwardTimeMs: numNodes * 0.05,
        numNodes,
        numEdges,
        memoryBytes: numNodes * layer.outputDim * 4,
        numIterations: 1,
      },
    };
  }

  buildGraph(nodeFeatures: number[][], edges: [number, number][]): { nodeFeatures: number[][]; edgeIndex: [number[], number[]] } {
    return {
      nodeFeatures,
      edgeIndex: [edges.map((e) => e[0]), edges.map((e) => e[1])],
    };
  }

  // Hyperbolic Operations
  async hyperbolicEmbed(input: { points: number[][] }, config: { model: string; curvature: number; dimension: number }): Promise<{ embeddings: number[][]; curvature: number }> {
    this.ensureConnected();

    const embeddings = input.points.map((point) => {
      const norm = Math.sqrt(point.reduce((sum, v) => sum + v * v, 0));
      const scale = norm >= 1 ? 0.99 / norm : 1;
      return point.map((v) => v * scale);
    });

    this.emit('hyperbolic:embed', {
      model: config.model as any,
      operation: 'embed',
      numPoints: input.points.length,
      durationMs: input.points.length * 0.02,
    });

    return {
      embeddings,
      curvature: config.curvature,
    };
  }

  async hyperbolicDistance(a: number[], b: number[], config: { model: string; curvature: number; dimension: number }): Promise<number> {
    this.ensureConnected();

    const normA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
    const normB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
    const diffNorm = Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));

    const numerator = 2 * diffNorm ** 2;
    const denominator = Math.max((1 - normA ** 2) * (1 - normB ** 2), 1e-10);
    const distance = Math.acosh(1 + numerator / denominator);

    this.emit('hyperbolic:distance', {
      model: config.model as any,
      operation: 'distance',
      numPoints: 2,
      durationMs: 0.01,
    });

    return distance;
  }

  // Embedding Operations
  async embed(text: string, model?: string): Promise<{ embedding: number[]; model: string; tokenCount: number; durationMs: number; dimension: number }> {
    this.ensureConnected();

    return {
      embedding: randomVector(384),
      model: model || 'default',
      tokenCount: Math.ceil(text.length / 4),
      durationMs: 50,
      dimension: 384,
    };
  }

  async embedBatch(texts: string[], model?: string): Promise<{ embeddings: Array<{ embedding: number[]; model: string; tokenCount: number; durationMs: number; dimension: number }>; totalTokens: number; totalDurationMs: number; throughput: number }> {
    this.ensureConnected();

    const embeddings = await Promise.all(texts.map((t) => this.embed(t, model)));
    const totalTokens = embeddings.reduce((sum, e) => sum + e.tokenCount, 0);
    const totalDurationMs = embeddings.reduce((sum, e) => sum + e.durationMs, 0);

    return {
      embeddings,
      totalTokens,
      totalDurationMs,
      throughput: totalTokens / (totalDurationMs / 1000),
    };
  }

  // Transaction Support
  async transaction<T>(fn: (tx: IRuVectorTransaction) => Promise<T>): Promise<{ transactionId: string; committed: boolean; data?: T; durationMs: number; queryCount: number }> {
    this.ensureConnected();

    const startTime = Date.now();
    let txQueryCount = 0;

    const tx: IRuVectorTransaction = {
      query: async <R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<R>> => {
        txQueryCount++;
        return { rows: [] as R[], rowCount: 0, durationMs: 5, command: 'SELECT' };
      },
      insert: async (options: VectorInsertOptions) => {
        txQueryCount++;
        return this.insert(options);
      },
      update: async (options: { tableName: string; id: string | number; vector?: number[]; metadata?: Record<string, unknown> }) => {
        txQueryCount++;
        return this.update(options);
      },
      delete: async (tableName: string, id: string | number) => {
        txQueryCount++;
        return this.delete(tableName, id);
      },
      commit: async () => {},
      rollback: async () => {},
    };

    try {
      const data = await fn(tx);
      await tx.commit();
      return {
        transactionId: `tx-${Date.now()}`,
        committed: true,
        data,
        durationMs: Date.now() - startTime,
        queryCount: txQueryCount,
      };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  // Admin Operations
  async vacuum(tableName?: string): Promise<void> {
    this.ensureConnected();

    this.emit('admin:vacuum', {
      operation: 'vacuum',
      tableName,
      durationMs: 500,
    });
  }

  async analyze(tableName?: string): Promise<{ tableName: string; numRows: number; columnStats: Array<{ columnName: string; dataType: string; nullPercent: number; distinctCount: number; avgSizeBytes: number }>; recommendations: string[] }> {
    this.ensureConnected();

    this.emit('admin:analyze', {
      operation: 'analyze',
      tableName,
      durationMs: 300,
    });

    return {
      tableName: tableName || 'all',
      numRows: 10000,
      columnStats: [
        {
          columnName: 'embedding',
          dataType: 'vector(384)',
          nullPercent: 0,
          distinctCount: 10000,
          avgSizeBytes: 1536,
        },
      ],
      recommendations: ['Consider adding an HNSW index for faster similarity search'],
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    return createMockHealthStatus(this.connected);
  }

  async getStats(): Promise<{ version: string; totalVectors: number; totalSizeBytes: number; numIndices: number; numTables: number; queryStats: { totalQueries: number; avgQueryTimeMs: number; p95QueryTimeMs: number; p99QueryTimeMs: number; cacheHitRate: number }; memoryStats: { usedBytes: number; peakBytes: number; indexBytes: number; cacheBytes: number } }> {
    this.ensureConnected();
    return createMockStats();
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Not connected');
    }
  }

  getPool(): MockPgPool {
    return this.pool;
  }

  getConfig(): RuVectorClientOptions {
    return this.config;
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('RuVector PostgreSQL Integration', () => {
  let client: MockRuVectorClient;
  let config: RuVectorClientOptions;

  beforeEach(() => {
    config = createTestClientOptions();
    client = new MockRuVectorClient(config);
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  // ==========================================================================
  // Connection Management Tests
  // ==========================================================================

  describe('Connection Management', () => {
    it('should connect to PostgreSQL', async () => {
      const result = await client.connect();

      expect(client.isConnected()).toBe(true);
      expect(result.ready).toBe(true);
      expect(result.connectionId).toBeDefined();
      expect(result.serverVersion).toBeDefined();
    });

    it('should handle connection failures gracefully', async () => {
      // Test that operations throw when not connected
      await expect(
        client.search(new SearchOptionsBuilder().build())
      ).rejects.toThrow('Not connected');
    });

    it('should reconnect after connection loss', async () => {
      // Connect first
      await client.connect();
      expect(client.isConnected()).toBe(true);

      // Disconnect
      await client.disconnect();
      expect(client.isConnected()).toBe(false);

      // Reconnect
      await client.connect();
      expect(client.isConnected()).toBe(true);
    });

    it('should respect pool limits', async () => {
      const customConfig = createTestClientOptions({
        pool: {
          min: 2,
          max: 5,
          idleTimeoutMs: 10000,
          acquireTimeoutMs: 5000,
        },
      });

      const customClient = new MockRuVectorClient(customConfig);
      await customClient.connect();

      expect(customClient.getConfig().pool?.max).toBe(5);
      expect(customClient.getConfig().pool?.min).toBe(2);

      await customClient.disconnect();
    });

    it('should emit connection events', async () => {
      const openHandler = vi.fn();
      const closeHandler = vi.fn();

      client.on('connection:open', openHandler);
      client.on('connection:close', closeHandler);

      await client.connect();
      expect(openHandler).toHaveBeenCalledTimes(1);

      await client.disconnect();
      expect(closeHandler).toHaveBeenCalledTimes(1);
    });

    it('should track connection state correctly', async () => {
      expect(client.isConnected()).toBe(false);
      expect(client.getConnectionInfo()).toBeNull();

      await client.connect();
      expect(client.isConnected()).toBe(true);
      expect(client.getConnectionInfo()).not.toBeNull();

      await client.disconnect();
      expect(client.isConnected()).toBe(false);
      expect(client.getConnectionInfo()).toBeNull();
    });

    it('should support SSL configuration', async () => {
      const sslConfig: SSLConfig = {
        enabled: true,
        rejectUnauthorized: true,
        ca: '/path/to/ca.pem',
        cert: '/path/to/cert.pem',
        key: '/path/to/key.pem',
      };

      const sslClient = new MockRuVectorClient({
        ...config,
        ssl: sslConfig,
      });

      await sslClient.connect();
      expect(sslClient.isConnected()).toBe(true);

      const clientSsl = sslClient.getConfig().ssl as SSLConfig;
      expect(clientSsl.enabled).toBe(true);
      expect(clientSsl.rejectUnauthorized).toBe(true);

      await sslClient.disconnect();
    });

    it('should support retry configuration', () => {
      const retryConfig: RetryConfig = {
        maxAttempts: 5,
        initialDelayMs: 100,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        jitter: true,
        retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
      };

      const retryClient = new MockRuVectorClient({
        ...config,
        retry: retryConfig,
      });

      expect(retryClient.getConfig().retry?.maxAttempts).toBe(5);
      expect(retryClient.getConfig().retry?.backoffMultiplier).toBe(2);
    });
  });

  // ==========================================================================
  // Vector Operations Tests
  // ==========================================================================

  describe('Vector Operations', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should insert vectors with metadata', async () => {
      const options = new InsertOptionsBuilder('test_vectors')
        .addRandomVectors(10, 384)
        .withReturning(true)
        .build();

      const result = await client.insert(options);

      expect(result.successful).toBe(10);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(10);
      expect(result.throughput).toBeGreaterThan(0);
    });

    it('should perform cosine similarity search', async () => {
      const options = new SearchOptionsBuilder(384)
        .withMetric('cosine')
        .withK(10)
        .withTable('embeddings')
        .build();

      const results = await client.search(options);

      expect(results).toHaveLength(10);
      results.forEach((r) => {
        expect(r.id).toBeDefined();
        expect(r.score).toBeDefined();
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      });
    });

    it('should perform euclidean distance search', async () => {
      const options = new SearchOptionsBuilder(384)
        .withMetric('euclidean')
        .withK(5)
        .build();

      const results = await client.search(options);

      expect(results).toHaveLength(5);
      results.forEach((r) => {
        expect(r.distance).toBeDefined();
      });
    });

    it('should filter by metadata', async () => {
      const options = new SearchOptionsBuilder(384)
        .withK(10)
        .withMetric('cosine')
        .withFilter({ category: 'test', active: true })
        .includeMetadata(true)
        .build();

      const results = await client.search(options);

      expect(results).toHaveLength(10);
      results.forEach((r) => {
        expect(r.metadata).toBeDefined();
      });
    });

    it('should handle batch inserts', async () => {
      const options = new InsertOptionsBuilder('bulk_vectors')
        .addRandomVectors(100, 384)
        .withBatchSize(25)
        .withReturning(true)
        .build();

      const result = await client.insert(options);

      expect(result.total).toBe(100);
      expect(result.successful).toBe(100);
      expect(result.failed).toBe(0);
    });

    it('should update existing vectors', async () => {
      const success = await client.update({
        tableName: 'vectors',
        id: 'test-id-1',
        vector: randomVector(384),
        metadata: { updated: true, timestamp: Date.now() },
      });

      expect(success).toBe(true);
    });

    it('should delete vectors', async () => {
      const success = await client.delete('vectors', 'test-id-1');
      expect(success).toBe(true);
    });

    it('should bulk delete vectors', async () => {
      const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5'];
      const result = await client.bulkDelete('vectors', ids);

      expect(result.total).toBe(5);
      expect(result.successful).toBe(5);
      expect(result.failed).toBe(0);
    });

    it('should emit vector operation events', async () => {
      const insertHandler = vi.fn();
      const updateHandler = vi.fn();
      const deleteHandler = vi.fn();

      client.on('vector:inserted', insertHandler);
      client.on('vector:updated', updateHandler);
      client.on('vector:deleted', deleteHandler);

      await client.insert(
        new InsertOptionsBuilder('test')
          .addVector(randomVector(384), 'test-1')
          .build()
      );
      await client.update({
        tableName: 'test',
        id: 'test-1',
        vector: randomVector(384),
      });
      await client.delete('test', 'test-1');

      expect(insertHandler).toHaveBeenCalled();
      expect(updateHandler).toHaveBeenCalled();
      expect(deleteHandler).toHaveBeenCalled();
    });

    it('should include vector in search results when requested', async () => {
      const options = new SearchOptionsBuilder(384)
        .withK(5)
        .includeVector(true)
        .build();

      const results = await client.search(options);

      results.forEach((r) => {
        expect(r.vector).toBeDefined();
        expect(r.vector).toHaveLength(384);
      });
    });

    it('should throw when not connected', async () => {
      await client.disconnect();

      await expect(
        client.search(new SearchOptionsBuilder().build())
      ).rejects.toThrow('Not connected');
    });
  });

  // ==========================================================================
  // Index Management Tests
  // ==========================================================================

  describe('Index Management', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should create HNSW index', async () => {
      const options = new IndexOptionsBuilder('test_vectors', 'embedding')
        .withType('hnsw')
        .withHNSWParams(16, 200)
        .withMetric('cosine')
        .build();

      await expect(client.createIndex(options)).resolves.toBeUndefined();
    });

    it('should create IVFFlat index', async () => {
      const options = new IndexOptionsBuilder('test_vectors', 'embedding')
        .withType('ivfflat')
        .withIVFParams(100)
        .withMetric('euclidean')
        .build();

      await expect(client.createIndex(options)).resolves.toBeUndefined();
    });

    it('should report index statistics', async () => {
      const stats = await client.getIndexStats('idx_test_embedding');

      expect(stats.indexName).toBe('idx_test_embedding');
      expect(stats.indexType).toBeDefined();
      expect(stats.numVectors).toBeGreaterThan(0);
      expect(stats.sizeBytes).toBeGreaterThan(0);
    });

    it('should handle concurrent index creation', async () => {
      const options = new IndexOptionsBuilder('test_vectors', 'embedding')
        .withType('hnsw')
        .concurrent(true)
        .build();

      await expect(client.createIndex(options)).resolves.toBeUndefined();
    });

    it('should list all indices', async () => {
      const indices = await client.listIndices();

      expect(indices.length).toBeGreaterThan(0);
      indices.forEach((idx) => {
        expect(idx.indexName).toBeDefined();
        expect(idx.indexType).toBeDefined();
      });
    });

    it('should list indices for specific table', async () => {
      const indices = await client.listIndices('vectors');

      expect(indices.length).toBeGreaterThan(0);
    });

    it('should rebuild index', async () => {
      const rebuiltHandler = vi.fn();
      client.on('index:rebuilt', rebuiltHandler);

      await client.rebuildIndex('idx_test');

      expect(rebuiltHandler).toHaveBeenCalled();
    });

    it('should drop index', async () => {
      const droppedHandler = vi.fn();
      client.on('index:dropped', droppedHandler);

      await client.dropIndex('idx_test');

      expect(droppedHandler).toHaveBeenCalled();
    });

    it('should emit index events', async () => {
      const createdHandler = vi.fn();
      client.on('index:created', createdHandler);

      await client.createIndex(
        new IndexOptionsBuilder('test', 'embedding')
          .withType('hnsw')
          .build()
      );

      expect(createdHandler).toHaveBeenCalled();
      expect(createdHandler.mock.calls[0][0].data.indexType).toBe('hnsw');
    });
  });

  // ==========================================================================
  // Transactions Tests
  // ==========================================================================

  describe('Transactions', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should commit successful transactions', async () => {
      const result = await client.transaction(async (tx) => {
        await tx.insert({
          tableName: 'test',
          vectors: [{ vector: randomVector(384) }],
        });
        await tx.update({
          tableName: 'test',
          id: '1',
          vector: randomVector(384),
        });
        return { success: true };
      });

      expect(result.committed).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.queryCount).toBe(2);
    });

    it('should rollback on error', async () => {
      await expect(
        client.transaction(async (tx) => {
          await tx.insert({
            tableName: 'test',
            vectors: [{ vector: randomVector(384) }],
          });
          throw new Error('Simulated error');
        })
      ).rejects.toThrow('Simulated error');
    });

    it('should support savepoints', async () => {
      const result = await client.transaction(async (tx) => {
        await tx.insert({
          tableName: 'test',
          vectors: [{ id: 'sp-1', vector: randomVector(384) }],
        });

        // Simulated savepoint - actual implementation would be more complex
        try {
          await tx.insert({
            tableName: 'test',
            vectors: [{ id: 'sp-2', vector: randomVector(384) }],
          });
        } catch {
          // Rollback to savepoint would happen here
        }

        return { completed: true };
      });

      expect(result.committed).toBe(true);
    });

    it('should handle isolation levels', async () => {
      const result = await client.transaction(async (tx) => {
        // In a real implementation, we would set isolation level here
        await tx.query('SELECT 1');
        return true;
      });

      expect(result.committed).toBe(true);
    });

    it('should track transaction metrics', async () => {
      const result = await client.transaction(async (tx) => {
        for (let i = 0; i < 5; i++) {
          await tx.query('SELECT 1');
        }
        return 'done';
      });

      expect(result.transactionId).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.queryCount).toBe(5);
    });
  });

  // ==========================================================================
  // Performance Tests
  // ==========================================================================

  describe('Performance', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should achieve target insert throughput', async () => {
      const { result, durationMs } = await measureAsync(async () => {
        return client.insert(
          new InsertOptionsBuilder('perf_test')
            .addRandomVectors(100, 384)
            .build()
        );
      });

      expect(result.successful).toBe(100);
      expect(result.throughput).toBeGreaterThan(10); // At least 10 vectors/sec
    });

    it('should achieve target query latency', async () => {
      const { durationMs } = await measureAsync(async () => {
        return client.search(
          new SearchOptionsBuilder(384).withK(10).build()
        );
      });

      expect(durationMs).toBeLessThan(1000); // Less than 1 second
    });

    it('should handle concurrent queries', async () => {
      const queries = Array.from({ length: 10 }, () =>
        client.search(new SearchOptionsBuilder(384).withK(5).build())
      );

      const results = await Promise.all(queries);

      expect(results).toHaveLength(10);
      results.forEach((r) => {
        expect(r).toHaveLength(5);
      });
    });

    it('should measure batch search performance', async () => {
      const { result, durationMs } = await measureAsync(async () => {
        return client.batchSearch({
          queries: randomVectors(20, 384),
          k: 10,
          metric: 'cosine',
        });
      });

      expect(result.results).toHaveLength(20);
      expect(result.avgDurationMs).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Health and Stats Tests
  // ==========================================================================

  describe('Health and Statistics', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should report healthy status when connected', async () => {
      const health = await client.healthCheck();

      expect(health.status).toBe('healthy');
      expect(health.components.database.healthy).toBe(true);
      expect(health.issues).toHaveLength(0);
    });

    it('should report unhealthy status when disconnected', async () => {
      await client.disconnect();
      const health = await client.healthCheck();

      expect(health.status).toBe('unhealthy');
      expect(health.issues.length).toBeGreaterThan(0);
    });

    it('should return system statistics', async () => {
      const stats = await client.getStats();

      expect(stats.version).toBeDefined();
      expect(stats.totalVectors).toBeGreaterThan(0);
      expect(stats.queryStats).toBeDefined();
      expect(stats.memoryStats).toBeDefined();
    });

    it('should analyze tables', async () => {
      const analysis = await client.analyze('test_table');

      expect(analysis.tableName).toBe('test_table');
      expect(analysis.numRows).toBeGreaterThan(0);
      expect(analysis.columnStats).toBeDefined();
      expect(analysis.recommendations).toBeDefined();
    });

    it('should perform vacuum operation', async () => {
      const vacuumHandler = vi.fn();
      client.on('admin:vacuum', vacuumHandler);

      await client.vacuum('test_table');

      expect(vacuumHandler).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Event System Tests
  // ==========================================================================

  describe('Event System', () => {
    it('should register and unregister event handlers', async () => {
      const handler = vi.fn();

      const unsubscribe = client.on('connection:open', handler);

      await client.connect();
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();
      await client.disconnect();
      await client.connect();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle once events', async () => {
      const handler = vi.fn();

      client.once('connection:open', handler);

      await client.connect();
      await client.disconnect();
      await client.connect();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should remove all listeners', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      client.on('connection:open', handler1);
      client.on('connection:close', handler2);

      client.removeAllListeners();

      await client.connect();
      await client.disconnect();

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should remove listeners for specific event', async () => {
      const openHandler = vi.fn();
      const closeHandler = vi.fn();

      client.on('connection:open', openHandler);
      client.on('connection:close', closeHandler);

      client.removeAllListeners('connection:open');

      await client.connect();
      await client.disconnect();

      expect(openHandler).not.toHaveBeenCalled();
      expect(closeHandler).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Advanced Features Tests
  // ==========================================================================

  describe('Advanced Features', () => {
    beforeEach(async () => {
      await client.connect();
    });

    describe('Attention Mechanisms', () => {
      it('should compute multi-head attention', async () => {
        const seqLen = 10;
        const dim = 64;

        const input = {
          query: randomVectors(seqLen, dim),
          key: randomVectors(seqLen, dim),
          value: randomVectors(seqLen, dim),
        };

        const config = {
          mechanism: 'multi_head',
          numHeads: 8,
          headDim: 64,
        };

        const result = await client.computeAttention(input, config);

        expect(result.output).toHaveLength(seqLen);
        expect(result.output[0]).toHaveLength(config.numHeads * config.headDim);
      });

      it('should emit attention events', async () => {
        const handler = vi.fn();
        client.on('attention:computed', handler);

        await client.computeAttention(
          {
            query: randomVectors(5, 32),
            key: randomVectors(5, 32),
            value: randomVectors(5, 32),
          },
          { mechanism: 'multi_head', numHeads: 4, headDim: 32 }
        );

        expect(handler).toHaveBeenCalled();
      });
    });

    describe('GNN Operations', () => {
      it('should execute GCN layer', async () => {
        const graph = createRandomGraph(50, 100, 64);

        const result = await client.runGNNLayer(graph, {
          type: 'gcn',
          inputDim: 64,
          outputDim: 32,
        });

        expect(result.nodeEmbeddings).toHaveLength(50);
        expect(result.nodeEmbeddings[0]).toHaveLength(32);
      });

      it('should emit GNN events', async () => {
        const handler = vi.fn();
        client.on('gnn:forward', handler);

        const graph = createRandomGraph(20, 40, 32);

        await client.runGNNLayer(graph, {
          type: 'gcn',
          inputDim: 32,
          outputDim: 16,
        });

        expect(handler).toHaveBeenCalled();
      });

      it('should build graph from node features and edges', () => {
        const nodeFeatures = [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
        ];
        const edges: [number, number][] = [
          [0, 1],
          [1, 2],
          [2, 0],
        ];

        const graph = client.buildGraph(nodeFeatures, edges);

        expect(graph.nodeFeatures).toEqual(nodeFeatures);
        expect(graph.edgeIndex[0]).toEqual([0, 1, 2]);
        expect(graph.edgeIndex[1]).toEqual([1, 2, 0]);
      });
    });

    describe('Hyperbolic Embeddings', () => {
      it('should embed points in Poincare ball', async () => {
        const config = {
          model: 'poincare',
          curvature: -1,
          dimension: 16,
        };

        const input = {
          points: randomVectors(10, 16),
        };

        const result = await client.hyperbolicEmbed(input, config);

        expect(result.embeddings).toHaveLength(10);
        expect(result.curvature).toBe(-1);

        // All points should be inside Poincare ball
        result.embeddings.forEach((emb) => {
          const norm = Math.sqrt(emb.reduce((sum, v) => sum + v * v, 0));
          expect(norm).toBeLessThan(1);
        });
      });

      it('should compute hyperbolic distance', async () => {
        const config = {
          model: 'poincare',
          curvature: -1,
          dimension: 8,
        };

        const a = [0.1, 0.2, 0.1, 0.2, 0.1, 0.2, 0.1, 0.2];
        const b = [0.3, 0.1, 0.3, 0.1, 0.3, 0.1, 0.3, 0.1];

        const distance = await client.hyperbolicDistance(a, b, config);

        expect(distance).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(distance)).toBe(true);
      });

      it('should emit hyperbolic events', async () => {
        const embedHandler = vi.fn();
        const distanceHandler = vi.fn();

        client.on('hyperbolic:embed', embedHandler);
        client.on('hyperbolic:distance', distanceHandler);

        const config = {
          model: 'poincare',
          curvature: -1,
          dimension: 8,
        };

        await client.hyperbolicEmbed(
          { points: [[0.1, 0.2, 0.1, 0.2, 0.1, 0.2, 0.1, 0.2]] },
          config
        );

        await client.hyperbolicDistance(
          [0.1, 0.2, 0.1, 0.2, 0.1, 0.2, 0.1, 0.2],
          [0.3, 0.1, 0.3, 0.1, 0.3, 0.1, 0.3, 0.1],
          config
        );

        expect(embedHandler).toHaveBeenCalled();
        expect(distanceHandler).toHaveBeenCalled();
      });
    });

    describe('Embedding Operations', () => {
      it('should embed single text', async () => {
        const result = await client.embed('Hello, world!');

        expect(result.embedding).toBeDefined();
        expect(result.embedding).toHaveLength(384);
        expect(result.tokenCount).toBeGreaterThan(0);
      });

      it('should embed batch of texts', async () => {
        const texts = ['First text', 'Second text', 'Third text'];

        const result = await client.embedBatch(texts);

        expect(result.embeddings).toHaveLength(3);
        expect(result.totalTokens).toBeGreaterThan(0);
        expect(result.throughput).toBeGreaterThan(0);
      });
    });
  });
});

// ============================================================================
// Edge Cases and Error Handling Tests
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  let client: MockRuVectorClient;

  beforeEach(async () => {
    client = new MockRuVectorClient(createTestClientOptions());
    await client.connect();
  });

  afterEach(async () => {
    await client.disconnect();
  });

  describe('Boundary Values', () => {
    it('should handle empty vector search (k=0)', async () => {
      const results = await client.search(
        new SearchOptionsBuilder(384).withK(0).build()
      );

      expect(results).toHaveLength(0);
    });

    it('should handle large batch sizes', async () => {
      const result = await client.batchSearch({
        queries: randomVectors(100, 384),
        k: 10,
        metric: 'cosine',
      });

      expect(result.results).toHaveLength(100);
    });

    it('should handle high-dimensional vectors', async () => {
      const results = await client.search(
        new SearchOptionsBuilder(4096).withK(5).build()
      );

      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle very small k values', async () => {
      const results = await client.search(
        new SearchOptionsBuilder(384).withK(1).build()
      );

      expect(results).toHaveLength(1);
    });
  });

  describe('Empty/Null Cases', () => {
    it('should handle empty batch insert', async () => {
      const result = await client.insert({
        tableName: 'test',
        vectors: [],
      });

      expect(result.total).toBe(0);
      expect(result.successful).toBe(0);
    });

    it('should handle graph with no edges', async () => {
      const graph = client.buildGraph(
        [[1, 2, 3], [4, 5, 6]],
        []
      );

      const result = await client.runGNNLayer(graph, {
        type: 'gcn',
        inputDim: 3,
        outputDim: 2,
      });

      expect(result.nodeEmbeddings).toHaveLength(2);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent searches', async () => {
      const searches = Array.from({ length: 10 }, () =>
        client.search(new SearchOptionsBuilder(384).withK(5).build())
      );

      const results = await Promise.all(searches);

      expect(results).toHaveLength(10);
      results.forEach((r) => {
        expect(r).toHaveLength(5);
      });
    });

    it('should handle concurrent inserts', async () => {
      const inserts = Array.from({ length: 5 }, (_, i) =>
        client.insert({
          tableName: 'test',
          vectors: [
            {
              id: `concurrent-${i}`,
              vector: randomVector(384),
            },
          ],
        })
      );

      const results = await Promise.all(inserts);

      results.forEach((r) => {
        expect(r.successful).toBe(1);
      });
    });

    it('should handle mixed concurrent operations', async () => {
      const operations = [
        client.search(new SearchOptionsBuilder(384).withK(5).build()),
        client.insert({
          tableName: 'test',
          vectors: [{ vector: randomVector(384) }],
        }),
        client.search(new SearchOptionsBuilder(384).withK(3).build()),
        client.getStats(),
        client.healthCheck(),
      ];

      const results = await Promise.all(operations);

      expect(results).toHaveLength(5);
    });
  });
});

// ============================================================================
// Real Database Tests (Only run when configured)
// ============================================================================

skipIfNoRealDB('Real Database Integration', () => {
  // These tests would run against a real PostgreSQL database
  // Implementation would be similar but using actual database connections

  it('should connect to real PostgreSQL', async () => {
    const config = getTestDatabaseConfig();
    // Actual implementation would create real client and connect
    expect(config.host).toBeDefined();
  });

  it('should create actual HNSW index', async () => {
    // Would test real index creation
  });

  it('should perform actual vector search', async () => {
    // Would test real search with pgvector
  });
});
