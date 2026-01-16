/**
 * RuVector Test Utilities
 *
 * Shared utilities for RuVector integration tests including:
 * - Random vector generation
 * - Mock data factories
 * - Test database helpers
 * - Performance measurement utilities
 *
 * @module @claude-flow/plugins/__tests__/utils/ruvector-test-utils
 */

import { vi, type Mock } from 'vitest';
import type {
  RuVectorConfig,
  RuVectorClientOptions,
  VectorSearchOptions,
  VectorSearchResult,
  VectorInsertOptions,
  VectorUpdateOptions,
  VectorIndexOptions,
  BatchVectorOptions,
  GraphData,
  GNNLayer,
  AttentionConfig,
  AttentionInput,
  HyperbolicEmbedding,
  HyperbolicInput,
  DistanceMetric,
  VectorIndexType,
  IndexStats,
  QueryResult,
  BatchResult,
  ConnectionResult,
  HealthStatus,
  RuVectorStats,
  AnalysisResult,
  MigrationResult,
} from '../../src/integrations/ruvector/types.js';

// ============================================================================
// Environment Detection
// ============================================================================

/**
 * Check if real database tests should be run
 */
export function useRealDatabase(): boolean {
  return process.env.RUVECTOR_TEST_DB === 'true';
}

/**
 * Get test database configuration from environment
 */
export function getTestDatabaseConfig(): RuVectorConfig {
  return {
    host: process.env.RUVECTOR_TEST_HOST ?? 'localhost',
    port: parseInt(process.env.RUVECTOR_TEST_PORT ?? '5432', 10),
    database: process.env.RUVECTOR_TEST_DATABASE ?? 'ruvector_test',
    user: process.env.RUVECTOR_TEST_USER ?? 'postgres',
    password: process.env.RUVECTOR_TEST_PASSWORD ?? 'postgres',
    poolSize: 5,
    connectionTimeoutMs: 5000,
    queryTimeoutMs: 30000,
  };
}

// ============================================================================
// Vector Generation Utilities
// ============================================================================

/**
 * Generate a random vector with specified dimensions
 */
export function randomVector(dimensions: number = 384): number[] {
  return Array.from({ length: dimensions }, () => Math.random() * 2 - 1);
}

/**
 * Generate a normalized random vector (unit length)
 */
export function normalizedVector(dimensions: number = 384): number[] {
  const vec = randomVector(dimensions);
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map(v => v / magnitude);
}

/**
 * Generate a vector within Poincare ball (norm < 1)
 */
export function poincareVector(dimensions: number = 32): number[] {
  const vec = randomVector(dimensions);
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  const scale = Math.random() * 0.95 / Math.max(magnitude, 0.001);
  return vec.map(v => v * scale);
}

/**
 * Generate multiple random vectors
 */
export function randomVectors(count: number, dimensions: number = 384): number[][] {
  return Array.from({ length: count }, () => randomVector(dimensions));
}

/**
 * Generate vectors with known similarities for testing search accuracy
 */
export function generateSimilarVectors(
  base: number[],
  count: number,
  noise: number = 0.1
): number[][] {
  return Array.from({ length: count }, () =>
    base.map(v => v + (Math.random() - 0.5) * noise * 2)
  );
}

/**
 * Generate orthogonal vectors for testing
 */
export function orthogonalVectors(dimensions: number, count: number): number[][] {
  // Simple Gram-Schmidt orthogonalization
  const vectors: number[][] = [];

  for (let i = 0; i < count; i++) {
    let v = randomVector(dimensions);

    // Subtract projections onto previous vectors
    for (const u of vectors) {
      const dot = v.reduce((sum, val, idx) => sum + val * u[idx], 0);
      v = v.map((val, idx) => val - dot * u[idx]);
    }

    // Normalize
    const mag = Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
    if (mag > 0.001) {
      vectors.push(v.map(val => val / mag));
    }
  }

  return vectors;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  return dot / (magA * magB);
}

/**
 * Calculate Euclidean distance between two vectors
 */
export function euclideanDistance(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));
}

/**
 * Calculate Poincare distance in hyperbolic space
 */
export function poincareDistance(a: number[], b: number[]): number {
  const normA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const normB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  const diffNorm = Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));

  const numerator = 2 * diffNorm ** 2;
  const denominator = (1 - normA ** 2) * (1 - normB ** 2);

  return Math.acosh(1 + numerator / Math.max(denominator, 1e-10));
}

// ============================================================================
// Mock Data Factories
// ============================================================================

/**
 * Create a test configuration with optional overrides
 */
export function createTestConfig(overrides: Partial<RuVectorConfig> = {}): RuVectorConfig {
  return {
    host: 'localhost',
    port: 5432,
    database: 'test_db',
    user: 'test_user',
    password: 'test_password',
    poolSize: 10,
    connectionTimeoutMs: 5000,
    queryTimeoutMs: 30000,
    schema: 'public',
    ...overrides,
  };
}

/**
 * Create test client options
 */
export function createTestClientOptions(
  overrides: Partial<RuVectorClientOptions> = {}
): RuVectorClientOptions {
  return {
    ...createTestConfig(),
    autoReconnect: true,
    maxReconnectAttempts: 3,
    ...overrides,
  };
}

/**
 * Create mock search results
 */
export function createMockSearchResults(
  count: number,
  options: { includeVector?: boolean; includeMetadata?: boolean; dimensions?: number } = {}
): VectorSearchResult[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `result-${i}`,
    score: 1 - i * (1 / count),
    distance: i * (1 / count),
    rank: i + 1,
    retrievedAt: new Date(),
    ...(options.includeVector && { vector: randomVector(options.dimensions ?? 384) }),
    ...(options.includeMetadata && { metadata: { index: i, label: `item-${i}` } }),
  }));
}

/**
 * Create mock connection result
 */
export function createMockConnectionResult(): ConnectionResult {
  return {
    connectionId: `conn-${Date.now()}`,
    ready: true,
    serverVersion: 'PostgreSQL 15.0',
    ruVectorVersion: '1.0.0',
    parameters: {
      server_encoding: 'UTF8',
      client_encoding: 'UTF8',
      server_version: '15.0',
    },
  };
}

/**
 * Create mock index stats
 */
export function createMockIndexStats(
  indexName: string,
  indexType: VectorIndexType = 'hnsw'
): IndexStats {
  return {
    indexName,
    indexType,
    numVectors: 10000 + Math.floor(Math.random() * 90000),
    sizeBytes: 1024 * 1024 * (50 + Math.floor(Math.random() * 200)),
    buildTimeMs: 5000 + Math.floor(Math.random() * 10000),
    lastRebuild: new Date(),
    params: {
      m: 16,
      efConstruction: 200,
      ef_search: 100,
    },
  };
}

/**
 * Create mock health status
 */
export function createMockHealthStatus(healthy: boolean = true): HealthStatus {
  return {
    status: healthy ? 'healthy' : 'unhealthy',
    components: {
      database: {
        name: 'PostgreSQL',
        healthy,
        latencyMs: healthy ? 5 : undefined,
        error: healthy ? undefined : 'Connection failed',
      },
      ruvector: {
        name: 'RuVector Extension',
        healthy,
        latencyMs: healthy ? 1 : undefined,
      },
      pool: {
        name: 'Connection Pool',
        healthy: true,
        latencyMs: 0,
      },
    },
    lastCheck: new Date(),
    issues: healthy ? [] : ['Database connection failed'],
  };
}

/**
 * Create mock stats
 */
export function createMockStats(): RuVectorStats {
  return {
    version: '1.0.0',
    totalVectors: 100000,
    totalSizeBytes: 1024 * 1024 * 500,
    numIndices: 3,
    numTables: 5,
    queryStats: {
      totalQueries: 50000,
      avgQueryTimeMs: 15,
      p95QueryTimeMs: 50,
      p99QueryTimeMs: 100,
      cacheHitRate: 0.85,
    },
    memoryStats: {
      usedBytes: 1024 * 1024 * 256,
      peakBytes: 1024 * 1024 * 512,
      indexBytes: 1024 * 1024 * 150,
      cacheBytes: 1024 * 1024 * 50,
    },
  };
}

/**
 * Create mock analysis result
 */
export function createMockAnalysisResult(tableName: string = 'vectors'): AnalysisResult {
  return {
    tableName,
    numRows: 10000,
    columnStats: [
      {
        columnName: 'id',
        dataType: 'uuid',
        nullPercent: 0,
        distinctCount: 10000,
        avgSizeBytes: 16,
      },
      {
        columnName: 'embedding',
        dataType: 'vector(384)',
        nullPercent: 0,
        distinctCount: 10000,
        avgSizeBytes: 1536,
      },
      {
        columnName: 'metadata',
        dataType: 'jsonb',
        nullPercent: 5,
        distinctCount: 9500,
        avgSizeBytes: 256,
      },
    ],
    recommendations: [
      'Consider adding an HNSW index for faster similarity search',
      'Metadata column could benefit from a GIN index',
    ],
  };
}

/**
 * Create mock migration result
 */
export function createMockMigrationResult(
  name: string,
  direction: 'up' | 'down' = 'up',
  success: boolean = true
): MigrationResult {
  return {
    name,
    success,
    direction,
    durationMs: 500 + Math.floor(Math.random() * 2000),
    affectedTables: ['vectors', 'vector_indices'],
    error: success ? undefined : 'Migration failed: table already exists',
  };
}

// ============================================================================
// Graph Data Factories
// ============================================================================

/**
 * Create a random graph for GNN testing
 */
export function createRandomGraph(
  numNodes: number,
  numEdges: number,
  featureDim: number
): GraphData {
  const nodeFeatures = randomVectors(numNodes, featureDim);
  const edges: [number[], number[]] = [[], []];

  for (let i = 0; i < numEdges; i++) {
    const source = Math.floor(Math.random() * numNodes);
    const target = Math.floor(Math.random() * numNodes);
    edges[0].push(source);
    edges[1].push(target);
  }

  return {
    nodeFeatures,
    edgeIndex: edges,
  };
}

/**
 * Create a complete graph (all nodes connected)
 */
export function createCompleteGraph(numNodes: number, featureDim: number): GraphData {
  const nodeFeatures = randomVectors(numNodes, featureDim);
  const edges: [number[], number[]] = [[], []];

  for (let i = 0; i < numNodes; i++) {
    for (let j = 0; j < numNodes; j++) {
      if (i !== j) {
        edges[0].push(i);
        edges[1].push(j);
      }
    }
  }

  return {
    nodeFeatures,
    edgeIndex: edges,
  };
}

/**
 * Create a chain graph (linear sequence)
 */
export function createChainGraph(numNodes: number, featureDim: number): GraphData {
  const nodeFeatures = randomVectors(numNodes, featureDim);
  const edges: [number[], number[]] = [[], []];

  for (let i = 0; i < numNodes - 1; i++) {
    edges[0].push(i);
    edges[1].push(i + 1);
    // Bidirectional
    edges[0].push(i + 1);
    edges[1].push(i);
  }

  return {
    nodeFeatures,
    edgeIndex: edges,
  };
}

// ============================================================================
// Mock Database Interfaces
// ============================================================================

/**
 * Mock PostgreSQL client interface
 */
export interface MockPgClient {
  connect: Mock;
  query: Mock;
  release: Mock;
  end: Mock;
  on: Mock;
  off: Mock;
}

/**
 * Mock PostgreSQL pool interface
 */
export interface MockPgPool {
  connect: Mock;
  query: Mock;
  end: Mock;
  on: Mock;
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

/**
 * Create a mock PostgreSQL client
 */
export function createMockPgClient(): MockPgClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  };
}

/**
 * Create a mock PostgreSQL pool
 */
export function createMockPgPool(): MockPgPool {
  const mockClient = createMockPgClient();
  return {
    connect: vi.fn().mockResolvedValue(mockClient),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    totalCount: 10,
    idleCount: 5,
    waitingCount: 0,
  };
}

// ============================================================================
// Performance Testing Utilities
// ============================================================================

/**
 * Measure execution time of an async function
 */
export async function measureAsync<T>(
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

/**
 * Run a function multiple times and return statistics
 */
export async function benchmark<T>(
  fn: () => Promise<T>,
  iterations: number = 100
): Promise<{
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  p99Ms: number;
}> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const { durationMs } = await measureAsync(fn);
    times.push(durationMs);
  }

  times.sort((a, b) => a - b);

  return {
    iterations,
    totalMs: times.reduce((sum, t) => sum + t, 0),
    avgMs: times.reduce((sum, t) => sum + t, 0) / iterations,
    minMs: times[0],
    maxMs: times[times.length - 1],
    p95Ms: times[Math.floor(iterations * 0.95)],
    p99Ms: times[Math.floor(iterations * 0.99)],
  };
}

/**
 * Generate test data for throughput testing
 */
export function generateBulkInsertData(
  count: number,
  dimensions: number = 384
): VectorInsertOptions['vectors'] {
  return Array.from({ length: count }, (_, i) => ({
    id: `bulk-${Date.now()}-${i}`,
    vector: randomVector(dimensions),
    metadata: {
      index: i,
      timestamp: Date.now(),
      batch: Math.floor(i / 100),
    },
  }));
}

// ============================================================================
// Test Data Builders
// ============================================================================

/**
 * Builder for VectorSearchOptions
 */
export class SearchOptionsBuilder {
  private options: VectorSearchOptions;

  constructor(dimensions: number = 384) {
    this.options = {
      query: randomVector(dimensions),
      k: 10,
      metric: 'cosine',
    };
  }

  withQuery(query: number[]): this {
    this.options = { ...this.options, query };
    return this;
  }

  withK(k: number): this {
    this.options = { ...this.options, k };
    return this;
  }

  withMetric(metric: DistanceMetric): this {
    this.options = { ...this.options, metric };
    return this;
  }

  withFilter(filter: Record<string, unknown>): this {
    this.options = { ...this.options, filter };
    return this;
  }

  withThreshold(threshold: number): this {
    this.options = { ...this.options, threshold };
    return this;
  }

  withTable(tableName: string): this {
    this.options = { ...this.options, tableName };
    return this;
  }

  includeVector(include: boolean = true): this {
    this.options = { ...this.options, includeVector: include };
    return this;
  }

  includeMetadata(include: boolean = true): this {
    this.options = { ...this.options, includeMetadata: include };
    return this;
  }

  build(): VectorSearchOptions {
    return { ...this.options };
  }
}

/**
 * Builder for VectorInsertOptions
 */
export class InsertOptionsBuilder {
  private options: VectorInsertOptions;

  constructor(tableName: string = 'vectors') {
    this.options = {
      tableName,
      vectors: [],
    };
  }

  addVector(
    vector: number[],
    id?: string,
    metadata?: Record<string, unknown>
  ): this {
    this.options = {
      ...this.options,
      vectors: [...this.options.vectors, { id, vector, metadata }],
    };
    return this;
  }

  addRandomVectors(count: number, dimensions: number = 384): this {
    const vectors = Array.from({ length: count }, (_, i) => ({
      id: `gen-${Date.now()}-${i}`,
      vector: randomVector(dimensions),
      metadata: { generated: true, index: i },
    }));
    this.options = {
      ...this.options,
      vectors: [...this.options.vectors, ...vectors],
    };
    return this;
  }

  withUpsert(upsert: boolean = true): this {
    this.options = { ...this.options, upsert };
    return this;
  }

  withBatchSize(batchSize: number): this {
    this.options = { ...this.options, batchSize };
    return this;
  }

  withReturning(returning: boolean = true): this {
    this.options = { ...this.options, returning };
    return this;
  }

  build(): VectorInsertOptions {
    return { ...this.options };
  }
}

/**
 * Builder for VectorIndexOptions
 */
export class IndexOptionsBuilder {
  private options: VectorIndexOptions;

  constructor(tableName: string, columnName: string = 'embedding') {
    this.options = {
      tableName,
      columnName,
      indexType: 'hnsw',
    };
  }

  withType(indexType: VectorIndexType): this {
    this.options = { ...this.options, indexType };
    return this;
  }

  withName(indexName: string): this {
    this.options = { ...this.options, indexName };
    return this;
  }

  withMetric(metric: DistanceMetric): this {
    this.options = { ...this.options, metric };
    return this;
  }

  withHNSWParams(m: number, efConstruction: number): this {
    this.options = { ...this.options, m, efConstruction };
    return this;
  }

  withIVFParams(lists: number): this {
    this.options = { ...this.options, lists };
    return this;
  }

  concurrent(concurrent: boolean = true): this {
    this.options = { ...this.options, concurrent };
    return this;
  }

  replace(replace: boolean = true): this {
    this.options = { ...this.options, replace };
    return this;
  }

  build(): VectorIndexOptions {
    return { ...this.options };
  }
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that results are sorted by score descending
 */
export function assertSortedByScore(results: VectorSearchResult[]): void {
  for (let i = 1; i < results.length; i++) {
    if (results[i].score > results[i - 1].score) {
      throw new Error(
        `Results not sorted by score: ${results[i - 1].score} > ${results[i].score}`
      );
    }
  }
}

/**
 * Assert that results are sorted by distance ascending
 */
export function assertSortedByDistance(results: VectorSearchResult[]): void {
  for (let i = 1; i < results.length; i++) {
    if (
      results[i].distance !== undefined &&
      results[i - 1].distance !== undefined &&
      results[i].distance! < results[i - 1].distance!
    ) {
      throw new Error(
        `Results not sorted by distance: ${results[i - 1].distance} < ${results[i].distance}`
      );
    }
  }
}

/**
 * Assert that all vectors are normalized (unit length)
 */
export function assertNormalized(vectors: number[][], tolerance: number = 0.001): void {
  for (const vec of vectors) {
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (Math.abs(magnitude - 1) > tolerance) {
      throw new Error(`Vector not normalized: magnitude = ${magnitude}`);
    }
  }
}

/**
 * Assert that all vectors are inside Poincare ball
 */
export function assertInPoincareBall(
  vectors: number[][],
  maxNorm: number = 0.99
): void {
  for (const vec of vectors) {
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (norm >= maxNorm) {
      throw new Error(`Vector outside Poincare ball: norm = ${norm}`);
    }
  }
}

// ============================================================================
// Cleanup Utilities
// ============================================================================

/**
 * Generate unique table name for tests
 */
export function uniqueTableName(prefix: string = 'test'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate unique index name for tests
 */
export function uniqueIndexName(tableName: string, columnName: string = 'embedding'): string {
  return `idx_${tableName}_${columnName}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// Type Exports
// ============================================================================

export type {
  RuVectorConfig,
  RuVectorClientOptions,
  VectorSearchOptions,
  VectorSearchResult,
  VectorInsertOptions,
  VectorUpdateOptions,
  VectorIndexOptions,
  BatchVectorOptions,
  GraphData,
  GNNLayer,
  AttentionConfig,
  AttentionInput,
  HyperbolicEmbedding,
  HyperbolicInput,
  DistanceMetric,
  VectorIndexType,
  IndexStats,
  QueryResult,
  BatchResult,
  ConnectionResult,
  HealthStatus,
  RuVectorStats,
  AnalysisResult,
  MigrationResult,
};
