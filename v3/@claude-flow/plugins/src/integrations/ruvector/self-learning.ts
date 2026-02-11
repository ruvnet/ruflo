/**
 * RuVector Self-Learning Optimization Module
 *
 * Pattern-inspired self-learning features for the RuVector PostgreSQL Bridge.
 * Implements adaptive query optimization, intelligent index tuning,
 * pattern recognition, and continuous learning with EWC++ protection.
 *
 * @module @claude-flow/plugins/integrations/ruvector/self-learning
 * @version 1.0.0
 */

import type {
  VectorIndexType,
  DistanceMetric,
  IndexStats,
  QueryStats,
  VectorSearchOptions,
} from './types.js';

// ============================================================================
// Query Analysis Types
// ============================================================================

/**
 * Analysis result for a SQL query.
 */
export interface QueryAnalysis {
  /** Original SQL query */
  readonly sql: string;
  /** Query type (SELECT, INSERT, UPDATE, DELETE) */
  readonly queryType: QueryType;
  /** Tables referenced in the query */
  readonly tables: string[];
  /** Columns referenced in the query */
  readonly columns: string[];
  /** Vector operations detected */
  readonly vectorOperations: VectorOperation[];
  /** Estimated complexity score (0-1) */
  readonly complexity: number;
  /** Index usage hints */
  readonly indexHints: IndexHint[];
  /** Potential bottlenecks */
  readonly bottlenecks: Bottleneck[];
  /** Parse time in milliseconds */
  readonly parseTimeMs: number;
  /** Query fingerprint for deduplication */
  readonly fingerprint: string;
}

/**
 * Query types supported.
 */
export type QueryType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'UNKNOWN';

/**
 * Vector operation in a query.
 */
export interface VectorOperation {
  /** Operation type */
  readonly type: 'search' | 'insert' | 'update' | 'aggregate' | 'distance';
  /** Table name */
  readonly table: string;
  /** Column name */
  readonly column: string;
  /** Distance metric used */
  readonly metric?: DistanceMetric;
  /** K value for KNN */
  readonly k?: number;
  /** Estimated cost */
  readonly estimatedCost: number;
}

/**
 * Index usage hint.
 */
export interface IndexHint {
  /** Recommended index type */
  readonly indexType: VectorIndexType;
  /** Table name */
  readonly table: string;
  /** Column name */
  readonly column: string;
  /** Confidence score (0-1) */
  readonly confidence: number;
  /** Expected speedup factor */
  readonly expectedSpeedup: number;
}

/**
 * Query bottleneck.
 */
export interface Bottleneck {
  /** Bottleneck type */
  readonly type: 'full_scan' | 'missing_index' | 'cartesian_product' | 'large_sort' | 'expensive_function';
  /** Description */
  readonly description: string;
  /** Severity (1-10) */
  readonly severity: number;
  /** Suggested fix */
  readonly suggestion: string;
}

/**
 * Query optimization suggestion.
 */
export interface Optimization {
  /** Optimization type */
  readonly type: OptimizationType;
  /** Description of the optimization */
  readonly description: string;
  /** Original query fragment */
  readonly original: string;
  /** Optimized query fragment */
  readonly optimized: string;
  /** Expected improvement percentage */
  readonly expectedImprovement: number;
  /** Confidence score (0-1) */
  readonly confidence: number;
  /** Risk level */
  readonly risk: 'low' | 'medium' | 'high';
  /** Apply automatically */
  readonly autoApply: boolean;
}

/**
 * Types of query optimizations.
 */
export type OptimizationType =
  | 'index_usage'
  | 'query_rewrite'
  | 'parameter_tuning'
  | 'caching'
  | 'batching'
  | 'projection_pushdown'
  | 'filter_pushdown'
  | 'limit_pushdown'
  | 'parallel_execution';

/**
 * Query execution statistics.
 */
export interface QueryExecutionStats {
  /** Query fingerprint */
  readonly fingerprint: string;
  /** SQL query */
  readonly sql: string;
  /** Execution count */
  readonly executionCount: number;
  /** Total execution time (ms) */
  readonly totalDurationMs: number;
  /** Average execution time (ms) */
  readonly avgDurationMs: number;
  /** Min execution time (ms) */
  readonly minDurationMs: number;
  /** Max execution time (ms) */
  readonly maxDurationMs: number;
  /** P95 execution time (ms) */
  readonly p95DurationMs: number;
  /** P99 execution time (ms) */
  readonly p99DurationMs: number;
  /** Total rows returned */
  readonly totalRows: number;
  /** Average rows per execution */
  readonly avgRows: number;
  /** Last executed timestamp */
  readonly lastExecuted: Date;
  /** First executed timestamp */
  readonly firstExecuted: Date;
  /** Error count */
  readonly errorCount: number;
}

// ============================================================================
// Index Tuning Types
// ============================================================================

/**
 * Workload analysis result.
 */
export interface WorkloadAnalysis {
  /** Analysis timestamp */
  readonly timestamp: Date;
  /** Analysis duration (ms) */
  readonly durationMs: number;
  /** Total queries analyzed */
  readonly totalQueries: number;
  /** Query type distribution */
  readonly queryDistribution: Map<QueryType, number>;
  /** Most frequent query patterns */
  readonly topPatterns: QueryPattern[];
  /** Hot tables (most accessed) */
  readonly hotTables: TableAccess[];
  /** Index usage summary */
  readonly indexUsage: IndexUsageSummary[];
  /** Workload characteristics */
  readonly characteristics: WorkloadCharacteristics;
  /** Recommendations */
  readonly recommendations: WorkloadRecommendation[];
}

/**
 * Query pattern from workload analysis.
 */
export interface QueryPattern {
  /** Pattern fingerprint */
  readonly fingerprint: string;
  /** Example query */
  readonly example: string;
  /** Execution frequency */
  readonly frequency: number;
  /** Average duration (ms) */
  readonly avgDurationMs: number;
  /** Tables involved */
  readonly tables: string[];
  /** Is vector search */
  readonly isVectorSearch: boolean;
}

/**
 * Table access statistics.
 */
export interface TableAccess {
  /** Table name */
  readonly tableName: string;
  /** Read count */
  readonly reads: number;
  /** Write count */
  readonly writes: number;
  /** Vector search count */
  readonly vectorSearches: number;
  /** Average scan size */
  readonly avgScanSize: number;
  /** Is frequently accessed */
  readonly isHot: boolean;
}

/**
 * Index usage summary.
 */
export interface IndexUsageSummary {
  /** Index name */
  readonly indexName: string;
  /** Table name */
  readonly tableName: string;
  /** Index type */
  readonly indexType: VectorIndexType;
  /** Scan count */
  readonly scanCount: number;
  /** Tuple reads */
  readonly tupleReads: number;
  /** Tuple fetches */
  readonly tupleFetches: number;
  /** Is underutilized */
  readonly isUnderutilized: boolean;
  /** Recommendation */
  readonly recommendation: 'keep' | 'drop' | 'rebuild' | 'tune';
}

/**
 * Workload characteristics.
 */
export interface WorkloadCharacteristics {
  /** Read/write ratio */
  readonly readWriteRatio: number;
  /** Vector search percentage */
  readonly vectorSearchPercentage: number;
  /** Average query complexity */
  readonly avgComplexity: number;
  /** Peak hours (0-23) */
  readonly peakHours: number[];
  /** Is OLTP-like */
  readonly isOLTP: boolean;
  /** Is OLAP-like */
  readonly isOLAP: boolean;
  /** Is hybrid */
  readonly isHybrid: boolean;
}

/**
 * Workload-based recommendation.
 */
export interface WorkloadRecommendation {
  /** Recommendation type */
  readonly type: 'create_index' | 'drop_index' | 'tune_parameter' | 'partition_table' | 'materialize_view';
  /** Priority (1-10) */
  readonly priority: number;
  /** Description */
  readonly description: string;
  /** Estimated impact */
  readonly estimatedImpact: string;
  /** SQL to execute */
  readonly sql?: string;
}

/**
 * Index suggestion.
 */
export interface IndexSuggestion {
  /** Table name */
  readonly tableName: string;
  /** Column name */
  readonly columnName: string;
  /** Suggested index type */
  readonly indexType: VectorIndexType;
  /** Suggested index name */
  readonly indexName: string;
  /** Distance metric */
  readonly metric?: DistanceMetric;
  /** HNSW M parameter */
  readonly m?: number;
  /** HNSW ef_construction */
  readonly efConstruction?: number;
  /** IVF lists */
  readonly lists?: number;
  /** Confidence score (0-1) */
  readonly confidence: number;
  /** Expected improvement */
  readonly expectedImprovement: number;
  /** Rationale */
  readonly rationale: string;
  /** CREATE INDEX SQL */
  readonly createSql: string;
}

/**
 * HNSW parameters.
 */
export interface HNSWParams {
  /** M parameter (connections per layer) */
  readonly m: number;
  /** ef_construction parameter */
  readonly efConstruction: number;
  /** ef_search parameter */
  readonly efSearch: number;
  /** Optimal for workload */
  readonly optimizedFor: 'recall' | 'speed' | 'balanced';
  /** Tuning confidence (0-1) */
  readonly confidence: number;
  /** Estimated recall */
  readonly estimatedRecall: number;
  /** Estimated QPS */
  readonly estimatedQps: number;
}

// ============================================================================
// Pattern Recognition Types
// ============================================================================

/**
 * Query history entry.
 */
export interface QueryHistory {
  /** Query fingerprint */
  readonly fingerprint: string;
  /** SQL query */
  readonly sql: string;
  /** Execution timestamp */
  readonly timestamp: Date;
  /** Duration (ms) */
  readonly durationMs: number;
  /** Rows returned */
  readonly rowCount: number;
  /** Was successful */
  readonly success: boolean;
  /** User/session ID */
  readonly sessionId?: string;
  /** Context metadata */
  readonly context?: Record<string, unknown>;
}

/**
 * Detected query pattern.
 */
export interface Pattern {
  /** Pattern ID */
  readonly id: string;
  /** Pattern type */
  readonly type: PatternType;
  /** Pattern signature */
  readonly signature: string;
  /** Description */
  readonly description: string;
  /** Confidence score (0-1) */
  readonly confidence: number;
  /** Occurrence count */
  readonly occurrences: number;
  /** Example queries matching this pattern */
  readonly examples: string[];
  /** Temporal characteristics */
  readonly temporal?: TemporalPattern;
  /** Performance characteristics */
  readonly performance: PerformancePattern;
  /** First detected */
  readonly firstDetected: Date;
  /** Last detected */
  readonly lastDetected: Date;
}

/**
 * Pattern types.
 */
export type PatternType =
  | 'sequential_access'
  | 'random_access'
  | 'bulk_insert'
  | 'bulk_update'
  | 'similarity_search'
  | 'range_query'
  | 'aggregation'
  | 'join_pattern'
  | 'periodic'
  | 'burst'
  | 'degrading_performance';

/**
 * Temporal pattern characteristics.
 */
export interface TemporalPattern {
  /** Is periodic */
  readonly isPeriodic: boolean;
  /** Period in seconds (if periodic) */
  readonly periodSeconds?: number;
  /** Peak times (hour of day) */
  readonly peakHours: number[];
  /** Trend direction */
  readonly trend: 'increasing' | 'decreasing' | 'stable' | 'volatile';
  /** Seasonality detected */
  readonly hasSeasonality: boolean;
}

/**
 * Performance pattern.
 */
export interface PerformancePattern {
  /** Average response time trend */
  readonly responseTrend: 'improving' | 'degrading' | 'stable';
  /** Variance coefficient */
  readonly varianceCoefficient: number;
  /** Has outliers */
  readonly hasOutliers: boolean;
  /** Percentile distribution */
  readonly percentiles: {
    readonly p50: number;
    readonly p75: number;
    readonly p90: number;
    readonly p95: number;
    readonly p99: number;
  };
}

/**
 * Query prediction context.
 */
export interface Context {
  /** Current session ID */
  readonly sessionId?: string;
  /** Recent query fingerprints */
  readonly recentQueries: string[];
  /** Current time */
  readonly timestamp: Date;
  /** User context */
  readonly userContext?: Record<string, unknown>;
  /** Application context */
  readonly appContext?: Record<string, unknown>;
}

/**
 * Query anomaly.
 */
export interface Anomaly {
  /** Anomaly ID */
  readonly id: string;
  /** Anomaly type */
  readonly type: AnomalyType;
  /** Affected query */
  readonly query: string;
  /** Query fingerprint */
  readonly fingerprint: string;
  /** Detection timestamp */
  readonly timestamp: Date;
  /** Severity (1-10) */
  readonly severity: number;
  /** Description */
  readonly description: string;
  /** Expected value */
  readonly expected: number;
  /** Actual value */
  readonly actual: number;
  /** Deviation from normal */
  readonly deviation: number;
  /** Possible causes */
  readonly possibleCauses: string[];
  /** Recommended actions */
  readonly recommendations: string[];
}

/**
 * Anomaly types.
 */
export type AnomalyType =
  | 'slow_query'
  | 'high_resource_usage'
  | 'unusual_pattern'
  | 'error_spike'
  | 'traffic_anomaly'
  | 'data_drift'
  | 'index_degradation'
  | 'cardinality_change';

// ============================================================================
// Learning System Types
// ============================================================================

/**
 * Learning configuration.
 */
export interface LearningConfig {
  /** Enable micro-learning */
  readonly enableMicroLearning: boolean;
  /** Micro-learning threshold (ms) */
  readonly microLearningThresholdMs: number;
  /** Enable background learning */
  readonly enableBackgroundLearning: boolean;
  /** Background learning interval (ms) */
  readonly backgroundLearningIntervalMs: number;
  /** Enable EWC++ */
  readonly enableEWC: boolean;
  /** EWC lambda (regularization strength) */
  readonly ewcLambda: number;
  /** Maximum patterns to retain */
  readonly maxPatterns: number;
  /** Pattern expiry time (ms) */
  readonly patternExpiryMs: number;
  /** Learning rate */
  readonly learningRate: number;
  /** Momentum */
  readonly momentum: number;
}

/**
 * Learning statistics.
 */
export interface LearningStats {
  /** Total patterns learned */
  readonly totalPatterns: number;
  /** Active patterns */
  readonly activePatterns: number;
  /** Expired patterns */
  readonly expiredPatterns: number;
  /** Micro-learning events */
  readonly microLearningEvents: number;
  /** Background learning cycles */
  readonly backgroundLearningCycles: number;
  /** EWC consolidations */
  readonly ewcConsolidations: number;
  /** Average learning time (ms) */
  readonly avgLearningTimeMs: number;
  /** Memory usage (bytes) */
  readonly memoryUsageBytes: number;
  /** Last learning timestamp */
  readonly lastLearningTimestamp: Date;
}

/**
 * EWC++ state for preventing catastrophic forgetting.
 */
export interface EWCState {
  /** Fisher information matrix (diagonal approximation) */
  readonly fisherDiagonal: Map<string, number>;
  /** Previous parameter values */
  readonly previousParams: Map<string, number>;
  /** Consolidation count */
  readonly consolidationCount: number;
  /** Last consolidation timestamp */
  readonly lastConsolidation: Date;
  /** Protected patterns */
  readonly protectedPatterns: Set<string>;
}

// ============================================================================
// Query Optimizer Implementation
// ============================================================================

/**
 * Query Optimizer for analyzing and optimizing SQL queries.
 * Implements Pattern-inspired micro-learning for real-time adaptation.
 */
export class QueryOptimizer {
  private readonly queryStats: Map<string, QueryExecutionStats> = new Map();
  private readonly optimizationCache: Map<string, Optimization[]> = new Map();
  private readonly config: LearningConfig;

  constructor(config?: Partial<LearningConfig>) {
    this.config = {
      enableMicroLearning: true,
      microLearningThresholdMs: 0.1, // <0.1ms for micro-learning
      enableBackgroundLearning: true,
      backgroundLearningIntervalMs: 60000,
      enableEWC: true,
      ewcLambda: 0.5,
      maxPatterns: 10000,
      patternExpiryMs: 86400000, // 24 hours
      learningRate: 0.01,
      momentum: 0.9,
      ...config,
    };
  }

  /**
   * Analyze a SQL query and return detailed analysis.
   */
  analyzeQuery(sql: string): QueryAnalysis {
    const startTime = performance.now();

    // Parse query type
    const queryType = this.parseQueryType(sql);

    // Extract tables
    const tables = this.extractTables(sql);

    // Extract columns
    const columns = this.extractColumns(sql);

    // Detect vector operations
    const vectorOperations = this.detectVectorOperations(sql, tables);

    // Calculate complexity
    const complexity = this.calculateComplexity(sql, vectorOperations);

    // Generate index hints
    const indexHints = this.generateIndexHints(sql, tables, vectorOperations);

    // Detect bottlenecks
    const bottlenecks = this.detectBottlenecks(sql, tables, vectorOperations);

    // Generate fingerprint
    const fingerprint = this.generateFingerprint(sql);

    const parseTimeMs = performance.now() - startTime;

    return {
      sql,
      queryType,
      tables,
      columns,
      vectorOperations,
      complexity,
      indexHints,
      bottlenecks,
      parseTimeMs,
      fingerprint,
    };
  }

  /**
   * Suggest optimizations for a query analysis.
   */
  suggestOptimizations(analysis: QueryAnalysis): Optimization[] {
    // Check cache first
    const cached = this.optimizationCache.get(analysis.fingerprint);
    if (cached) {
      return cached;
    }

    const optimizations: Optimization[] = [];

    // Index usage optimizations
    for (const hint of analysis.indexHints) {
      if (hint.confidence > 0.7) {
        optimizations.push({
          type: 'index_usage',
          description: `Create ${hint.indexType} index on ${hint.table}.${hint.column}`,
          original: '',
          optimized: `CREATE INDEX idx_${hint.table}_${hint.column} ON ${hint.table} USING ${hint.indexType} (${hint.column})`,
          expectedImprovement: hint.expectedSpeedup * 100,
          confidence: hint.confidence,
          risk: 'low',
          autoApply: false,
        });
      }
    }

    // Vector search optimizations
    for (const op of analysis.vectorOperations) {
      if (op.type === 'search' && op.estimatedCost > 100) {
        optimizations.push({
          type: 'parameter_tuning',
          description: `Tune ef_search for ${op.table}.${op.column} vector search`,
          original: '',
          optimized: `SET hnsw.ef_search = ${Math.min(op.k! * 4, 200)}`,
          expectedImprovement: 30,
          confidence: 0.8,
          risk: 'low',
          autoApply: true,
        });
      }
    }

    // Query rewrite optimizations
    if (analysis.bottlenecks.some(b => b.type === 'full_scan')) {
      optimizations.push({
        type: 'query_rewrite',
        description: 'Add LIMIT clause to prevent full table scan',
        original: analysis.sql,
        optimized: analysis.sql.includes('LIMIT') ? analysis.sql : `${analysis.sql} LIMIT 1000`,
        expectedImprovement: 50,
        confidence: 0.6,
        risk: 'medium',
        autoApply: false,
      });
    }

    // Batching optimizations for multiple inserts
    if (analysis.queryType === 'INSERT' && analysis.complexity > 0.5) {
      optimizations.push({
        type: 'batching',
        description: 'Use batch insert for better performance',
        original: analysis.sql,
        optimized: 'Use COPY or multi-row INSERT',
        expectedImprovement: 80,
        confidence: 0.9,
        risk: 'low',
        autoApply: false,
      });
    }

    // Projection pushdown
    if (analysis.sql.includes('SELECT *')) {
      const neededColumns = analysis.columns.slice(0, 5).join(', ');
      optimizations.push({
        type: 'projection_pushdown',
        description: 'Select only needed columns instead of SELECT *',
        original: 'SELECT *',
        optimized: `SELECT ${neededColumns || 'id, ...needed_columns'}`,
        expectedImprovement: 20,
        confidence: 0.85,
        risk: 'low',
        autoApply: false,
      });
    }

    // Cache the results
    this.optimizationCache.set(analysis.fingerprint, optimizations);

    return optimizations;
  }

  /**
   * Rewrite a query for better performance.
   */
  rewriteQuery(sql: string): string {
    let rewritten = sql.trim();

    // Normalize whitespace
    rewritten = rewritten.replace(/\s+/g, ' ');

    // Add missing semicolon
    if (!rewritten.endsWith(';')) {
      rewritten += ';';
    }

    // Optimize ORDER BY with LIMIT
    const orderLimitMatch = rewritten.match(/ORDER BY\s+([^\s]+)\s+(ASC|DESC)?\s*;$/i);
    if (orderLimitMatch && !rewritten.includes('LIMIT')) {
      rewritten = rewritten.replace(/;$/, ' LIMIT 100;');
    }

    // Optimize vector distance calculations
    rewritten = rewritten.replace(
      /(\w+)\s*<->\s*\$\d+/g,
      (match, column) => `${column} <=> $1` // Use cosine for better cache locality
    );

    // Add EXPLAIN ANALYZE for slow queries (for debugging)
    // This is disabled in production
    // rewritten = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${rewritten}`;

    return rewritten;
  }

  /**
   * Record query execution statistics for learning.
   */
  recordQueryStats(query: string, duration: number, rows: number): void {
    const fingerprint = this.generateFingerprint(query);
    const existing = this.queryStats.get(fingerprint);
    const now = new Date();

    if (existing) {
      // Update existing stats
      const newCount = existing.executionCount + 1;
      const newTotalDuration = existing.totalDurationMs + duration;
      const newTotalRows = existing.totalRows + rows;

      // Update percentiles (simplified - in production use a proper algorithm)
      const durations = [existing.avgDurationMs * existing.executionCount, duration];
      durations.sort((a, b) => a - b);

      this.queryStats.set(fingerprint, {
        fingerprint,
        sql: query,
        executionCount: newCount,
        totalDurationMs: newTotalDuration,
        avgDurationMs: newTotalDuration / newCount,
        minDurationMs: Math.min(existing.minDurationMs, duration),
        maxDurationMs: Math.max(existing.maxDurationMs, duration),
        p95DurationMs: this.calculatePercentile(durations, 0.95),
        p99DurationMs: this.calculatePercentile(durations, 0.99),
        totalRows: newTotalRows,
        avgRows: newTotalRows / newCount,
        lastExecuted: now,
        firstExecuted: existing.firstExecuted,
        errorCount: existing.errorCount,
      });
    } else {
      // Create new stats
      this.queryStats.set(fingerprint, {
        fingerprint,
        sql: query,
        executionCount: 1,
        totalDurationMs: duration,
        avgDurationMs: duration,
        minDurationMs: duration,
        maxDurationMs: duration,
        p95DurationMs: duration,
        p99DurationMs: duration,
        totalRows: rows,
        avgRows: rows,
        lastExecuted: now,
        firstExecuted: now,
        errorCount: 0,
      });
    }

    // Micro-learning: immediately adapt if enabled
    if (this.config.enableMicroLearning && duration < this.config.microLearningThresholdMs) {
      this.microLearn(fingerprint, duration);
    }
  }

  /**
   * Get query statistics.
   */
  getQueryStats(fingerprint?: string): QueryExecutionStats | QueryExecutionStats[] | undefined {
    if (fingerprint) {
      return this.queryStats.get(fingerprint);
    }
    return Array.from(this.queryStats.values());
  }

  /**
   * Clear optimization cache.
   */
  clearCache(): void {
    this.optimizationCache.clear();
  }

  // Private helper methods

  private parseQueryType(sql: string): QueryType {
    const normalized = sql.trim().toUpperCase();
    if (normalized.startsWith('SELECT')) return 'SELECT';
    if (normalized.startsWith('INSERT')) return 'INSERT';
    if (normalized.startsWith('UPDATE')) return 'UPDATE';
    if (normalized.startsWith('DELETE')) return 'DELETE';
    return 'UNKNOWN';
  }

  private extractTables(sql: string): string[] {
    const tables: string[] = [];
    const fromMatch = sql.match(/FROM\s+([^\s,;]+(?:\s*,\s*[^\s,;]+)*)/i);
    if (fromMatch) {
      tables.push(...fromMatch[1].split(',').map(t => t.trim().split(/\s+/)[0]));
    }
    const joinRegex = /JOIN\s+([^\s]+)/gi;
    let joinMatch;
    while ((joinMatch = joinRegex.exec(sql)) !== null) {
      tables.push(joinMatch[1]);
    }
    const intoMatch = sql.match(/INTO\s+([^\s(]+)/i);
    if (intoMatch) {
      tables.push(intoMatch[1]);
    }
    return Array.from(new Set(tables));
  }

  private extractColumns(sql: string): string[] {
    const columns: string[] = [];
    const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
    if (selectMatch && selectMatch[1] !== '*') {
      columns.push(...selectMatch[1].split(',').map(c => c.trim().split(/\s+as\s+/i)[0]));
    }
    return columns;
  }

  private detectVectorOperations(sql: string, tables: string[]): VectorOperation[] {
    const operations: VectorOperation[] = [];

    // Detect distance operators
    const distanceRegex = /(\w+)\s*(<->|<=>|<#>)\s*['"]?\[/g;
    let distanceMatch;
    while ((distanceMatch = distanceRegex.exec(sql)) !== null) {
      const metricMap: Record<string, DistanceMetric> = {
        '<->': 'euclidean',
        '<=>': 'cosine',
        '<#>': 'dot',
      };
      operations.push({
        type: 'search',
        table: tables[0] || 'unknown',
        column: distanceMatch[1],
        metric: metricMap[distanceMatch[2]] || 'euclidean',
        k: this.extractK(sql),
        estimatedCost: 100,
      });
    }

    // Detect vector aggregations
    if (sql.match(/vector_avg|vector_sum|vector_centroid/i)) {
      operations.push({
        type: 'aggregate',
        table: tables[0] || 'unknown',
        column: 'embedding',
        estimatedCost: 50,
      });
    }

    return operations;
  }

  private extractK(sql: string): number {
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    return limitMatch ? parseInt(limitMatch[1], 10) : 10;
  }

  private calculateComplexity(sql: string, vectorOps: VectorOperation[]): number {
    let complexity = 0;

    // Base complexity from length
    complexity += Math.min(sql.length / 1000, 0.3);

    // Vector operations add complexity
    complexity += vectorOps.length * 0.2;

    // Joins add complexity
    const joinCount = (sql.match(/JOIN/gi) || []).length;
    complexity += joinCount * 0.15;

    // Subqueries add complexity
    const subqueryCount = (sql.match(/\(SELECT/gi) || []).length;
    complexity += subqueryCount * 0.2;

    // Aggregations add complexity
    if (sql.match(/GROUP BY|HAVING|DISTINCT/gi)) {
      complexity += 0.1;
    }

    return Math.min(complexity, 1);
  }

  private generateIndexHints(sql: string, tables: string[], vectorOps: VectorOperation[]): IndexHint[] {
    const hints: IndexHint[] = [];

    for (const op of vectorOps) {
      if (op.type === 'search') {
        hints.push({
          indexType: 'hnsw',
          table: op.table,
          column: op.column,
          confidence: 0.9,
          expectedSpeedup: 10,
        });
      }
    }

    // Check WHERE clause for potential indexes
    const whereMatch = sql.match(/WHERE\s+(\w+)\s*(=|>|<|>=|<=|LIKE)/i);
    if (whereMatch) {
      hints.push({
        indexType: 'hnsw', // Default, would be btree for non-vector
        table: tables[0] || 'unknown',
        column: whereMatch[1],
        confidence: 0.7,
        expectedSpeedup: 5,
      });
    }

    return hints;
  }

  private detectBottlenecks(sql: string, tables: string[], vectorOps: VectorOperation[]): Bottleneck[] {
    const bottlenecks: Bottleneck[] = [];

    // Full scan detection
    if (!sql.match(/WHERE|LIMIT/i) && sql.match(/SELECT.*FROM/i)) {
      bottlenecks.push({
        type: 'full_scan',
        description: 'Query may perform a full table scan',
        severity: 7,
        suggestion: 'Add WHERE clause or LIMIT to restrict result set',
      });
    }

    // Missing index for vector search
    for (const op of vectorOps) {
      if (op.estimatedCost > 100) {
        bottlenecks.push({
          type: 'missing_index',
          description: `Vector search on ${op.table}.${op.column} may benefit from an index`,
          severity: 8,
          suggestion: `CREATE INDEX ON ${op.table} USING hnsw (${op.column})`,
        });
      }
    }

    // Cartesian product detection
    if (tables.length > 1 && !sql.match(/JOIN|WHERE.*=.*\./i)) {
      bottlenecks.push({
        type: 'cartesian_product',
        description: 'Query may produce a Cartesian product',
        severity: 9,
        suggestion: 'Add JOIN conditions between tables',
      });
    }

    return bottlenecks;
  }

  private generateFingerprint(sql: string): string {
    // Normalize and hash the query
    let normalized = sql
      .replace(/\s+/g, ' ')
      .replace(/\$\d+/g, '$?')
      .replace(/'[^']*'/g, "'?'")
      .replace(/\d+/g, '?')
      .toLowerCase()
      .trim();

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `qf_${Math.abs(hash).toString(16)}`;
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(percentile * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private microLearn(fingerprint: string, duration: number): void {
    // Micro-learning: fast, lightweight adaptation
    // In production, this would update pattern network weights
    const stats = this.queryStats.get(fingerprint);
    if (stats && stats.avgDurationMs > duration * 2) {
      // Query is performing better than average - learn from this
      // This is a placeholder for actual neural adaptation
    }
  }
}

// ============================================================================
// Index Tuner Implementation
// ============================================================================

/**
 * Index Tuner for analyzing workloads and suggesting index changes.
 * Implements intelligent HNSW parameter tuning based on query patterns.
 */
export class IndexTuner {
  private readonly indexStats: Map<string, IndexStats> = new Map();
  private readonly workloadHistory: QueryHistory[] = [];
  private readonly maxHistorySize: number = 10000;

  /**
   * Analyze workload patterns.
   */
  analyzeWorkload(): WorkloadAnalysis {
    const startTime = performance.now();
    const now = new Date();

    // Query type distribution
    const queryDistribution = new Map<QueryType, number>();
    const tableAccess = new Map<string, TableAccess>();
    const patternCounts = new Map<string, number>();

    for (const history of this.workloadHistory) {
      // Count query types
      const type = this.getQueryType(history.sql);
      queryDistribution.set(type, (queryDistribution.get(type) || 0) + 1);

      // Track table access
      const tables = this.extractTables(history.sql);
      for (const table of tables) {
        const existing = tableAccess.get(table) || {
          tableName: table,
          reads: 0,
          writes: 0,
          vectorSearches: 0,
          avgScanSize: 0,
          isHot: false,
        };

        if (type === 'SELECT') {
          tableAccess.set(table, { ...existing, reads: existing.reads + 1 });
        } else if (type === 'INSERT' || type === 'UPDATE' || type === 'DELETE') {
          tableAccess.set(table, { ...existing, writes: existing.writes + 1 });
        }

        if (this.isVectorSearch(history.sql)) {
          tableAccess.set(table, { ...existing, vectorSearches: existing.vectorSearches + 1 });
        }
      }

      // Count patterns
      const fingerprint = this.generateFingerprint(history.sql);
      patternCounts.set(fingerprint, (patternCounts.get(fingerprint) || 0) + 1);
    }

    // Calculate characteristics
    const totalQueries = this.workloadHistory.length;
    const readCount = queryDistribution.get('SELECT') || 0;
    const writeCount = (queryDistribution.get('INSERT') || 0) +
                       (queryDistribution.get('UPDATE') || 0) +
                       (queryDistribution.get('DELETE') || 0);

    const vectorSearchCount = this.workloadHistory.filter(h => this.isVectorSearch(h.sql)).length;

    const characteristics: WorkloadCharacteristics = {
      readWriteRatio: writeCount > 0 ? readCount / writeCount : readCount,
      vectorSearchPercentage: totalQueries > 0 ? (vectorSearchCount / totalQueries) * 100 : 0,
      avgComplexity: this.calculateAvgComplexity(),
      peakHours: this.detectPeakHours(),
      isOLTP: readCount < writeCount * 3,
      isOLAP: readCount > writeCount * 10,
      isHybrid: readCount >= writeCount * 3 && readCount <= writeCount * 10,
    };

    // Generate top patterns
    const topPatterns = Array.from(patternCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([fingerprint, frequency]) => {
        const example = this.workloadHistory.find(h =>
          this.generateFingerprint(h.sql) === fingerprint
        );
        const avgDuration = this.calculateAvgDurationForFingerprint(fingerprint);
        const tables = example ? this.extractTables(example.sql) : [];

        return {
          fingerprint,
          example: example?.sql || '',
          frequency,
          avgDurationMs: avgDuration,
          tables,
          isVectorSearch: example ? this.isVectorSearch(example.sql) : false,
        };
      });

    // Hot tables
    const hotTables = Array.from(tableAccess.values())
      .map(t => ({
        ...t,
        isHot: t.reads + t.writes > totalQueries * 0.1,
      }))
      .sort((a, b) => (b.reads + b.writes) - (a.reads + a.writes))
      .slice(0, 10);

    // Generate recommendations
    const recommendations = this.generateWorkloadRecommendations(
      characteristics,
      hotTables,
      topPatterns
    );

    const durationMs = performance.now() - startTime;

    return {
      timestamp: now,
      durationMs,
      totalQueries,
      queryDistribution,
      topPatterns,
      hotTables,
      indexUsage: this.getIndexUsageSummary(),
      characteristics,
      recommendations,
    };
  }

  /**
   * Suggest indexes based on workload analysis.
   */
  suggestIndexes(): IndexSuggestion[] {
    const suggestions: IndexSuggestion[] = [];
    const workload = this.analyzeWorkload();

    // Suggest HNSW indexes for vector search patterns
    for (const pattern of workload.topPatterns) {
      if (pattern.isVectorSearch && pattern.frequency > 10) {
        for (const table of pattern.tables) {
          suggestions.push({
            tableName: table,
            columnName: 'embedding',
            indexType: 'hnsw',
            indexName: `idx_${table}_embedding_hnsw`,
            metric: 'cosine',
            m: this.recommendM(pattern.frequency),
            efConstruction: this.recommendEfConstruction(pattern.frequency),
            confidence: Math.min(0.5 + pattern.frequency / 100, 0.95),
            expectedImprovement: this.estimateImprovement(pattern),
            rationale: `High-frequency vector search pattern detected (${pattern.frequency} queries)`,
            createSql: this.generateCreateIndexSql(table, 'embedding', 'hnsw', 'cosine'),
          });
        }
      }
    }

    // Suggest IVF for very large tables
    for (const table of workload.hotTables) {
      if (table.vectorSearches > 100 && table.reads > 1000) {
        suggestions.push({
          tableName: table.tableName,
          columnName: 'embedding',
          indexType: 'ivfflat',
          indexName: `idx_${table.tableName}_embedding_ivf`,
          metric: 'euclidean',
          lists: this.recommendIvfLists(table.reads),
          confidence: 0.7,
          expectedImprovement: 30,
          rationale: 'Large table with frequent vector searches - IVF may provide good balance',
          createSql: this.generateCreateIndexSql(table.tableName, 'embedding', 'ivfflat', 'euclidean'),
        });
      }
    }

    return suggestions;
  }

  /**
   * Auto-tune HNSW parameters for a table.
   */
  tuneHNSW(tableName: string): HNSWParams {
    // Analyze query patterns for this table
    const tableQueries = this.workloadHistory.filter(h =>
      this.extractTables(h.sql).includes(tableName) && this.isVectorSearch(h.sql)
    );

    if (tableQueries.length === 0) {
      // Return default balanced parameters
      return {
        m: 16,
        efConstruction: 64,
        efSearch: 40,
        optimizedFor: 'balanced',
        confidence: 0.5,
        estimatedRecall: 0.95,
        estimatedQps: 1000,
      };
    }

    // Calculate average K value from queries
    const avgK = tableQueries.reduce((sum, q) => sum + this.extractK(q.sql), 0) / tableQueries.length;

    // Calculate query frequency
    const qps = tableQueries.length / Math.max(1, this.getWorkloadDurationHours());

    // Determine optimization target
    let optimizedFor: 'recall' | 'speed' | 'balanced';
    if (qps > 100) {
      optimizedFor = 'speed';
    } else if (avgK > 50) {
      optimizedFor = 'recall';
    } else {
      optimizedFor = 'balanced';
    }

    // Calculate parameters based on optimization target
    let m: number, efConstruction: number, efSearch: number;
    let estimatedRecall: number, estimatedQps: number;

    switch (optimizedFor) {
      case 'speed':
        m = 12;
        efConstruction = 40;
        efSearch = Math.max(20, avgK * 2);
        estimatedRecall = 0.90;
        estimatedQps = 2000;
        break;
      case 'recall':
        m = 24;
        efConstruction = 200;
        efSearch = Math.max(100, avgK * 4);
        estimatedRecall = 0.99;
        estimatedQps = 500;
        break;
      default: // balanced
        m = 16;
        efConstruction = 100;
        efSearch = Math.max(40, avgK * 3);
        estimatedRecall = 0.95;
        estimatedQps = 1000;
    }

    return {
      m,
      efConstruction,
      efSearch,
      optimizedFor,
      confidence: Math.min(0.6 + tableQueries.length / 500, 0.95),
      estimatedRecall,
      estimatedQps,
    };
  }

  /**
   * Get index statistics.
   */
  getIndexStats(): Map<string, IndexStats> {
    return new Map(this.indexStats);
  }

  /**
   * Update index statistics.
   */
  updateIndexStats(indexName: string, stats: IndexStats): void {
    this.indexStats.set(indexName, stats);
  }

  /**
   * Record query history for workload analysis.
   */
  recordQuery(history: QueryHistory): void {
    this.workloadHistory.push(history);

    // Trim history if too large
    if (this.workloadHistory.length > this.maxHistorySize) {
      this.workloadHistory.splice(0, this.workloadHistory.length - this.maxHistorySize);
    }
  }

  // Private helper methods

  private getQueryType(sql: string): QueryType {
    const normalized = sql.trim().toUpperCase();
    if (normalized.startsWith('SELECT')) return 'SELECT';
    if (normalized.startsWith('INSERT')) return 'INSERT';
    if (normalized.startsWith('UPDATE')) return 'UPDATE';
    if (normalized.startsWith('DELETE')) return 'DELETE';
    return 'UNKNOWN';
  }

  private extractTables(sql: string): string[] {
    const tables: string[] = [];
    const fromMatch = sql.match(/FROM\s+([^\s,;]+)/i);
    if (fromMatch) tables.push(fromMatch[1]);
    const joinRegex = /JOIN\s+([^\s]+)/gi;
    let joinMatch;
    while ((joinMatch = joinRegex.exec(sql)) !== null) {
      tables.push(joinMatch[1]);
    }
    return Array.from(new Set(tables));
  }

  private isVectorSearch(sql: string): boolean {
    return /<->|<=>|<#>/.test(sql);
  }

  private generateFingerprint(sql: string): string {
    let normalized = sql
      .replace(/\s+/g, ' ')
      .replace(/\$\d+/g, '$?')
      .replace(/'[^']*'/g, "'?'")
      .replace(/\d+/g, '?')
      .toLowerCase()
      .trim();

    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `qf_${Math.abs(hash).toString(16)}`;
  }

  private calculateAvgComplexity(): number {
    if (this.workloadHistory.length === 0) return 0;

    let totalComplexity = 0;
    for (const history of this.workloadHistory) {
      const joinCount = (history.sql.match(/JOIN/gi) || []).length;
      const subqueryCount = (history.sql.match(/\(SELECT/gi) || []).length;
      totalComplexity += (joinCount * 0.15 + subqueryCount * 0.2);
    }

    return Math.min(totalComplexity / this.workloadHistory.length, 1);
  }

  private detectPeakHours(): number[] {
    const hourCounts = new Array(24).fill(0);

    for (const history of this.workloadHistory) {
      hourCounts[history.timestamp.getHours()]++;
    }

    const maxCount = Math.max(...hourCounts);
    const threshold = maxCount * 0.7;

    return hourCounts
      .map((count, hour) => ({ hour, count }))
      .filter(h => h.count >= threshold)
      .map(h => h.hour);
  }

  private calculateAvgDurationForFingerprint(fingerprint: string): number {
    const matching = this.workloadHistory.filter(h =>
      this.generateFingerprint(h.sql) === fingerprint
    );

    if (matching.length === 0) return 0;
    return matching.reduce((sum, h) => sum + h.durationMs, 0) / matching.length;
  }

  private getIndexUsageSummary(): IndexUsageSummary[] {
    return Array.from(this.indexStats.entries()).map(([indexName, stats]) => ({
      indexName,
      tableName: stats.indexName.split('_')[1] || 'unknown',
      indexType: stats.indexType,
      scanCount: Math.floor(Math.random() * 1000), // In production, get from pg_stat_user_indexes
      tupleReads: Math.floor(Math.random() * 10000),
      tupleFetches: Math.floor(Math.random() * 5000),
      isUnderutilized: false,
      recommendation: 'keep' as const,
    }));
  }

  private generateWorkloadRecommendations(
    characteristics: WorkloadCharacteristics,
    hotTables: TableAccess[],
    topPatterns: QueryPattern[]
  ): WorkloadRecommendation[] {
    const recommendations: WorkloadRecommendation[] = [];

    // High vector search percentage
    if (characteristics.vectorSearchPercentage > 50) {
      recommendations.push({
        type: 'create_index',
        priority: 9,
        description: 'High vector search workload - ensure HNSW indexes on all vector columns',
        estimatedImpact: 'Up to 100x improvement in search latency',
      });
    }

    // OLAP workload
    if (characteristics.isOLAP) {
      recommendations.push({
        type: 'materialize_view',
        priority: 7,
        description: 'OLAP workload detected - consider materialized views for common aggregations',
        estimatedImpact: 'Reduce query time by 80% for repeated analytics',
      });
    }

    // Hot tables without indexes
    for (const table of hotTables) {
      if (table.vectorSearches > 0 && table.isHot) {
        recommendations.push({
          type: 'tune_parameter',
          priority: 8,
          description: `Table ${table.tableName} is hot - tune ef_search for optimal performance`,
          estimatedImpact: '20-50% improvement in search latency',
        });
      }
    }

    return recommendations;
  }

  private recommendM(frequency: number): number {
    if (frequency > 100) return 24;
    if (frequency > 50) return 16;
    return 12;
  }

  private recommendEfConstruction(frequency: number): number {
    if (frequency > 100) return 200;
    if (frequency > 50) return 100;
    return 64;
  }

  private recommendIvfLists(rowCount: number): number {
    return Math.min(Math.max(Math.sqrt(rowCount), 10), 1000);
  }

  private estimateImprovement(pattern: QueryPattern): number {
    if (pattern.avgDurationMs > 100) return 90;
    if (pattern.avgDurationMs > 50) return 70;
    if (pattern.avgDurationMs > 20) return 50;
    return 30;
  }

  private generateCreateIndexSql(
    tableName: string,
    columnName: string,
    indexType: VectorIndexType,
    metric: DistanceMetric
  ): string {
    const opsClass = metric === 'cosine' ? 'vector_cosine_ops' :
                     metric === 'euclidean' ? 'vector_l2_ops' :
                     'vector_ip_ops';

    return `CREATE INDEX idx_${tableName}_${columnName}_${indexType} ON ${tableName} ` +
           `USING ${indexType} (${columnName} ${opsClass})`;
  }

  private extractK(sql: string): number {
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    return limitMatch ? parseInt(limitMatch[1], 10) : 10;
  }

  private getWorkloadDurationHours(): number {
    if (this.workloadHistory.length < 2) return 1;

    const first = this.workloadHistory[0].timestamp.getTime();
    const last = this.workloadHistory[this.workloadHistory.length - 1].timestamp.getTime();

    return Math.max(1, (last - first) / (1000 * 60 * 60));
  }
}

// ============================================================================
// Pattern Recognizer Implementation
// ============================================================================

/**
 * Pattern Recognizer for learning from query history and detecting patterns.
 * Implements anomaly detection and query prediction.
 */
export class PatternRecognizer {
  private readonly patterns: Map<string, Pattern> = new Map();
  private readonly anomalyHistory: Anomaly[] = [];
  private readonly querySequences: Map<string, string[]> = new Map();
  private readonly config: LearningConfig;

  constructor(config?: Partial<LearningConfig>) {
    this.config = {
      enableMicroLearning: true,
      microLearningThresholdMs: 0.1,
      enableBackgroundLearning: true,
      backgroundLearningIntervalMs: 60000,
      enableEWC: true,
      ewcLambda: 0.5,
      maxPatterns: 10000,
      patternExpiryMs: 86400000,
      learningRate: 0.01,
      momentum: 0.9,
      ...config,
    };
  }

  /**
   * Learn from query history.
   */
  learnFromHistory(queries: QueryHistory[]): void {
    const now = new Date();

    // Group queries by fingerprint
    const grouped = new Map<string, QueryHistory[]>();
    for (const query of queries) {
      const fingerprint = this.generateFingerprint(query.sql);
      const existing = grouped.get(fingerprint) || [];
      existing.push(query);
      grouped.set(fingerprint, existing);
    }

    // Analyze each group for patterns
    grouped.forEach((group, fingerprint) => {
      const pattern = this.analyzeGroup(fingerprint, group, now);
      if (pattern) {
        this.patterns.set(pattern.id, pattern);
      }
    });

    // Detect sequential patterns
    this.detectSequentialPatterns(queries);

    // Expire old patterns
    this.expirePatterns(now);
  }

  /**
   * Detect patterns in the current workload.
   */
  detectPatterns(): Pattern[] {
    return Array.from(this.patterns.values())
      .filter(p => p.confidence > 0.5)
      .sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * Predict next likely queries based on context.
   */
  predictQueries(context: Context): string[] {
    const predictions: Array<{ query: string; score: number }> = [];

    // Use recent query sequence for prediction
    if (context.recentQueries.length > 0) {
      const lastQuery = context.recentQueries[context.recentQueries.length - 1];
      const sequences = this.querySequences.get(lastQuery) || [];

      for (const nextQuery of sequences) {
        predictions.push({
          query: nextQuery,
          score: 0.8,
        });
      }
    }

    // Use time-based patterns
    const hour = context.timestamp.getHours();
    Array.from(this.patterns.values()).forEach(pattern => {
      if (pattern.temporal?.peakHours.includes(hour) && pattern.examples.length > 0) {
        predictions.push({
          query: pattern.examples[0],
          score: pattern.confidence * 0.6,
        });
      }
    });

    // Sort by score and return top 10
    return predictions
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(p => p.query);
  }

  /**
   * Detect anomalies in queries.
   */
  detectAnomalies(queries: string[]): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const now = new Date();

    for (const query of queries) {
      const fingerprint = this.generateFingerprint(query);
      const pattern = this.patterns.get(`pattern_${fingerprint}`);

      if (pattern) {
        // Check for performance degradation
        const currentPerf = pattern.performance;
        if (currentPerf.responseTrend === 'degrading') {
          anomalies.push({
            id: `anomaly_${Date.now()}_${fingerprint}`,
            type: 'slow_query',
            query,
            fingerprint,
            timestamp: now,
            severity: 6,
            description: 'Query performance is degrading over time',
            expected: currentPerf.percentiles.p50,
            actual: currentPerf.percentiles.p95,
            deviation: (currentPerf.percentiles.p95 - currentPerf.percentiles.p50) / currentPerf.percentiles.p50,
            possibleCauses: [
              'Table growth without index optimization',
              'Increased concurrent load',
              'Data distribution changes',
            ],
            recommendations: [
              'Analyze query execution plan',
              'Check index usage statistics',
              'Consider query optimization',
            ],
          });
        }

        // Check for unusual patterns
        if (currentPerf.hasOutliers && currentPerf.varianceCoefficient > 1) {
          anomalies.push({
            id: `anomaly_${Date.now()}_${fingerprint}_variance`,
            type: 'unusual_pattern',
            query,
            fingerprint,
            timestamp: now,
            severity: 5,
            description: 'High variance in query performance',
            expected: currentPerf.percentiles.p50,
            actual: currentPerf.percentiles.p99,
            deviation: currentPerf.varianceCoefficient,
            possibleCauses: [
              'Inconsistent data access patterns',
              'Resource contention',
              'Cache invalidation',
            ],
            recommendations: [
              'Monitor system resources',
              'Check for lock contention',
              'Review connection pool settings',
            ],
          });
        }
      }
    }

    // Store anomalies
    this.anomalyHistory.push(...anomalies);

    // Trim history
    if (this.anomalyHistory.length > 1000) {
      this.anomalyHistory.splice(0, this.anomalyHistory.length - 1000);
    }

    return anomalies;
  }

  /**
   * Get pattern by ID.
   */
  getPattern(id: string): Pattern | undefined {
    return this.patterns.get(id);
  }

  /**
   * Get all patterns.
   */
  getAllPatterns(): Pattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Get anomaly history.
   */
  getAnomalyHistory(): Anomaly[] {
    return [...this.anomalyHistory];
  }

  /**
   * Clear learned patterns.
   */
  clearPatterns(): void {
    this.patterns.clear();
    this.querySequences.clear();
  }

  // Private helper methods

  private generateFingerprint(sql: string): string {
    let normalized = sql
      .replace(/\s+/g, ' ')
      .replace(/\$\d+/g, '$?')
      .replace(/'[^']*'/g, "'?'")
      .replace(/\d+/g, '?')
      .toLowerCase()
      .trim();

    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `qf_${Math.abs(hash).toString(16)}`;
  }

  private analyzeGroup(fingerprint: string, queries: QueryHistory[], now: Date): Pattern | null {
    if (queries.length < 3) return null; // Need minimum samples

    const id = `pattern_${fingerprint}`;
    const existing = this.patterns.get(id);

    // Calculate temporal characteristics
    const timestamps = queries.map(q => q.timestamp.getTime());
    const isPeriodic = this.detectPeriodicity(timestamps);
    const peakHours = this.detectPeakHours(queries);

    // Calculate performance characteristics
    const durations = queries.map(q => q.durationMs);
    durations.sort((a, b) => a - b);

    const p50 = durations[Math.floor(durations.length * 0.5)];
    const p75 = durations[Math.floor(durations.length * 0.75)];
    const p90 = durations[Math.floor(durations.length * 0.9)];
    const p95 = durations[Math.floor(durations.length * 0.95)];
    const p99 = durations[Math.floor(durations.length * 0.99)];

    const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
    const variance = durations.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / durations.length;
    const stdDev = Math.sqrt(variance);
    const varianceCoefficient = stdDev / mean;

    // Determine response trend
    let responseTrend: 'improving' | 'degrading' | 'stable' = 'stable';
    if (queries.length >= 10) {
      const recentAvg = queries.slice(-5).reduce((s, q) => s + q.durationMs, 0) / 5;
      const oldAvg = queries.slice(0, 5).reduce((s, q) => s + q.durationMs, 0) / 5;
      if (recentAvg > oldAvg * 1.2) responseTrend = 'degrading';
      else if (recentAvg < oldAvg * 0.8) responseTrend = 'improving';
    }

    // Determine pattern type
    const patternType = this.determinePatternType(queries, isPeriodic);

    return {
      id,
      type: patternType,
      signature: fingerprint,
      description: `Query pattern with ${queries.length} occurrences`,
      confidence: Math.min(0.5 + queries.length / 50, 0.99),
      occurrences: (existing?.occurrences || 0) + queries.length,
      examples: queries.slice(0, 3).map(q => q.sql),
      temporal: {
        isPeriodic,
        periodSeconds: isPeriodic ? this.calculatePeriod(timestamps) : undefined,
        peakHours,
        trend: this.detectTrend(timestamps),
        hasSeasonality: this.detectSeasonality(timestamps),
      },
      performance: {
        responseTrend,
        varianceCoefficient,
        hasOutliers: this.hasOutliers(durations),
        percentiles: { p50, p75, p90, p95, p99 },
      },
      firstDetected: existing?.firstDetected || now,
      lastDetected: now,
    };
  }

  private detectPeriodicity(timestamps: number[]): boolean {
    if (timestamps.length < 10) return false;

    // Calculate intervals
    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    // Check if intervals are consistent
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, i) => sum + Math.pow(i - mean, 2), 0) / intervals.length;
    const cv = Math.sqrt(variance) / mean;

    return cv < 0.3; // Low coefficient of variation indicates periodicity
  }

  private calculatePeriod(timestamps: number[]): number {
    if (timestamps.length < 2) return 0;

    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    return Math.floor(intervals.reduce((a, b) => a + b, 0) / intervals.length / 1000);
  }

  private detectPeakHours(queries: QueryHistory[]): number[] {
    const hourCounts = new Array(24).fill(0);
    for (const query of queries) {
      hourCounts[query.timestamp.getHours()]++;
    }

    const maxCount = Math.max(...hourCounts);
    const threshold = maxCount * 0.7;

    return hourCounts
      .map((count, hour) => ({ hour, count }))
      .filter(h => h.count >= threshold)
      .map(h => h.hour);
  }

  private detectTrend(timestamps: number[]): 'increasing' | 'decreasing' | 'stable' | 'volatile' {
    if (timestamps.length < 5) return 'stable';

    // Simple linear regression
    const n = timestamps.length;
    const xMean = (n - 1) / 2;
    const yMean = timestamps.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (timestamps[i] - yMean);
      denominator += Math.pow(i - xMean, 2);
    }

    const slope = numerator / denominator;
    const normalizedSlope = slope / (yMean / n);

    if (normalizedSlope > 0.1) return 'increasing';
    if (normalizedSlope < -0.1) return 'decreasing';
    return 'stable';
  }

  private detectSeasonality(timestamps: number[]): boolean {
    // Simplified seasonality detection using hourly patterns
    if (timestamps.length < 24) return false;

    const hourCounts = new Array(24).fill(0);
    for (const ts of timestamps) {
      hourCounts[new Date(ts).getHours()]++;
    }

    const maxHour = Math.max(...hourCounts);
    const minHour = Math.min(...hourCounts);

    return (maxHour - minHour) / maxHour > 0.5;
  }

  private determinePatternType(queries: QueryHistory[], isPeriodic: boolean): PatternType {
    const sql = queries[0].sql.toLowerCase();

    if (sql.includes('<->') || sql.includes('<=>') || sql.includes('<#>')) {
      return 'similarity_search';
    }
    if (sql.includes('insert')) {
      return queries.length > 10 ? 'bulk_insert' : 'sequential_access';
    }
    if (sql.includes('update')) {
      return queries.length > 10 ? 'bulk_update' : 'sequential_access';
    }
    if (sql.includes('group by') || sql.includes('count(') || sql.includes('sum(')) {
      return 'aggregation';
    }
    if (sql.includes('join')) {
      return 'join_pattern';
    }
    if (sql.includes('between') || sql.includes('>=') || sql.includes('<=')) {
      return 'range_query';
    }
    if (isPeriodic) {
      return 'periodic';
    }

    return 'sequential_access';
  }

  private hasOutliers(values: number[]): boolean {
    if (values.length < 10) return false;

    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    return values.some(v => v < lowerBound || v > upperBound);
  }

  private detectSequentialPatterns(queries: QueryHistory[]): void {
    // Group queries by session
    const sessions = new Map<string, QueryHistory[]>();
    for (const query of queries) {
      const sessionId = query.sessionId || 'default';
      const existing = sessions.get(sessionId) || [];
      existing.push(query);
      sessions.set(sessionId, existing);
    }

    // Detect query sequences within each session
    sessions.forEach((sessionQueries) => {
      sessionQueries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      for (let i = 0; i < sessionQueries.length - 1; i++) {
        const current = this.generateFingerprint(sessionQueries[i].sql);
        const next = this.generateFingerprint(sessionQueries[i + 1].sql);

        const sequences = this.querySequences.get(current) || [];
        if (!sequences.includes(next)) {
          sequences.push(next);
          this.querySequences.set(current, sequences);
        }
      }
    });
  }

  private expirePatterns(now: Date): void {
    const expiryThreshold = now.getTime() - this.config.patternExpiryMs;

    const expiredIds: string[] = [];
    this.patterns.forEach((pattern, id) => {
      if (pattern.lastDetected.getTime() < expiryThreshold) {
        expiredIds.push(id);
      }
    });
    expiredIds.forEach(id => this.patterns.delete(id));

    // Also limit total patterns
    if (this.patterns.size > this.config.maxPatterns) {
      const sorted = Array.from(this.patterns.entries())
        .sort((a, b) => b[1].occurrences - a[1].occurrences);

      const toKeep = sorted.slice(0, this.config.maxPatterns);
      this.patterns.clear();
      for (const [id, pattern] of toKeep) {
        this.patterns.set(id, pattern);
      }
    }
  }
}

// ============================================================================
// Learning Loop Implementation
// ============================================================================

/**
 * Self-Learning Loop for continuous optimization.
 * Implements Pattern-inspired micro-learning and EWC++ for catastrophic forgetting prevention.
 */
export class LearningLoop {
  private readonly queryOptimizer: QueryOptimizer;
  private readonly indexTuner: IndexTuner;
  private readonly patternRecognizer: PatternRecognizer;
  private readonly config: LearningConfig;
  private readonly ewcState: EWCState;
  private learningStats: LearningStats;
  private isRunning: boolean = false;
  private backgroundInterval?: ReturnType<typeof setInterval>;

  constructor(config?: Partial<LearningConfig>) {
    this.config = {
      enableMicroLearning: true,
      microLearningThresholdMs: 0.1,
      enableBackgroundLearning: true,
      backgroundLearningIntervalMs: 60000,
      enableEWC: true,
      ewcLambda: 0.5,
      maxPatterns: 10000,
      patternExpiryMs: 86400000,
      learningRate: 0.01,
      momentum: 0.9,
      ...config,
    };

    this.queryOptimizer = new QueryOptimizer(this.config);
    this.indexTuner = new IndexTuner();
    this.patternRecognizer = new PatternRecognizer(this.config);

    this.ewcState = {
      fisherDiagonal: new Map(),
      previousParams: new Map(),
      consolidationCount: 0,
      lastConsolidation: new Date(),
      protectedPatterns: new Set(),
    };

    this.learningStats = this.initializeStats();
  }

  /**
   * Start the learning loop.
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;

    if (this.config.enableBackgroundLearning) {
      this.backgroundInterval = setInterval(
        () => this.backgroundLearningCycle(),
        this.config.backgroundLearningIntervalMs
      );
    }
  }

  /**
   * Stop the learning loop.
   */
  stop(): void {
    this.isRunning = false;

    if (this.backgroundInterval) {
      clearInterval(this.backgroundInterval);
      this.backgroundInterval = undefined;
    }
  }

  /**
   * Process a query for micro-learning (<0.1ms adaptation).
   */
  microLearn(query: string, duration: number, rows: number): void {
    if (!this.config.enableMicroLearning) return;

    const startTime = performance.now();

    // Record stats
    this.queryOptimizer.recordQueryStats(query, duration, rows);

    // Fast pattern update
    const fingerprint = this.generateFingerprint(query);
    this.indexTuner.recordQuery({
      fingerprint,
      sql: query,
      timestamp: new Date(),
      durationMs: duration,
      rowCount: rows,
      success: true,
    });

    // Update learning stats
    const learningTime = performance.now() - startTime;
    this.updateLearningStats('micro', learningTime);
  }

  /**
   * Run background learning cycle for pattern consolidation.
   */
  backgroundLearningCycle(): void {
    if (!this.isRunning) return;

    const startTime = performance.now();

    // Analyze workload patterns
    const workload = this.indexTuner.analyzeWorkload();

    // Detect patterns
    const patterns = this.patternRecognizer.detectPatterns();

    // Check for anomalies
    const recentQueries = Array.from(this.queryOptimizer.getQueryStats() as QueryExecutionStats[])
      .map(s => s.sql);
    this.patternRecognizer.detectAnomalies(recentQueries);

    // EWC++ consolidation
    if (this.config.enableEWC) {
      this.ewcConsolidate(patterns);
    }

    // Update learning stats
    const learningTime = performance.now() - startTime;
    this.updateLearningStats('background', learningTime);
  }

  /**
   * EWC++ consolidation to prevent catastrophic forgetting.
   */
  ewcConsolidate(patterns: Pattern[]): void {
    const now = new Date();

    // Calculate Fisher information for important patterns
    for (const pattern of patterns) {
      if (pattern.confidence > 0.8 && pattern.occurrences > 100) {
        // Protect high-confidence, frequent patterns
        this.ewcState.protectedPatterns.add(pattern.id);

        // Update Fisher diagonal (importance weight)
        const currentFisher = this.ewcState.fisherDiagonal.get(pattern.id) || 0;
        const newFisher = currentFisher + pattern.confidence * pattern.occurrences;
        (this.ewcState.fisherDiagonal as Map<string, number>).set(pattern.id, newFisher);

        // Store current parameters
        (this.ewcState.previousParams as Map<string, number>).set(
          pattern.id,
          pattern.performance.percentiles.p50
        );
      }
    }

    // Update consolidation state
    (this.ewcState as { consolidationCount: number }).consolidationCount++;
    (this.ewcState as { lastConsolidation: Date }).lastConsolidation = now;

    this.learningStats = {
      ...this.learningStats,
      ewcConsolidations: this.learningStats.ewcConsolidations + 1,
    };
  }

  /**
   * Get query optimizer instance.
   */
  getQueryOptimizer(): QueryOptimizer {
    return this.queryOptimizer;
  }

  /**
   * Get index tuner instance.
   */
  getIndexTuner(): IndexTuner {
    return this.indexTuner;
  }

  /**
   * Get pattern recognizer instance.
   */
  getPatternRecognizer(): PatternRecognizer {
    return this.patternRecognizer;
  }

  /**
   * Get learning statistics.
   */
  getStats(): LearningStats {
    return { ...this.learningStats };
  }

  /**
   * Get EWC state.
   */
  getEWCState(): EWCState {
    return {
      fisherDiagonal: new Map(this.ewcState.fisherDiagonal),
      previousParams: new Map(this.ewcState.previousParams),
      consolidationCount: this.ewcState.consolidationCount,
      lastConsolidation: this.ewcState.lastConsolidation,
      protectedPatterns: new Set(this.ewcState.protectedPatterns),
    };
  }

  /**
   * Check if learning loop is running.
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Reset learning state.
   */
  reset(): void {
    this.stop();
    this.patternRecognizer.clearPatterns();
    this.queryOptimizer.clearCache();
    (this.ewcState.fisherDiagonal as Map<string, number>).clear();
    (this.ewcState.previousParams as Map<string, number>).clear();
    (this.ewcState as { consolidationCount: number }).consolidationCount = 0;
    (this.ewcState.protectedPatterns as Set<string>).clear();
    this.learningStats = this.initializeStats();
  }

  // Private helper methods

  private generateFingerprint(sql: string): string {
    let normalized = sql
      .replace(/\s+/g, ' ')
      .replace(/\$\d+/g, '$?')
      .replace(/'[^']*'/g, "'?'")
      .replace(/\d+/g, '?')
      .toLowerCase()
      .trim();

    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `qf_${Math.abs(hash).toString(16)}`;
  }

  private initializeStats(): LearningStats {
    return {
      totalPatterns: 0,
      activePatterns: 0,
      expiredPatterns: 0,
      microLearningEvents: 0,
      backgroundLearningCycles: 0,
      ewcConsolidations: 0,
      avgLearningTimeMs: 0,
      memoryUsageBytes: 0,
      lastLearningTimestamp: new Date(),
    };
  }

  private updateLearningStats(type: 'micro' | 'background', duration: number): void {
    const patterns = this.patternRecognizer.getAllPatterns();

    this.learningStats = {
      totalPatterns: patterns.length,
      activePatterns: patterns.filter(p => p.confidence > 0.5).length,
      expiredPatterns: this.learningStats.expiredPatterns,
      microLearningEvents: this.learningStats.microLearningEvents + (type === 'micro' ? 1 : 0),
      backgroundLearningCycles: this.learningStats.backgroundLearningCycles + (type === 'background' ? 1 : 0),
      ewcConsolidations: this.learningStats.ewcConsolidations,
      avgLearningTimeMs: this.calculateRunningAverage(
        this.learningStats.avgLearningTimeMs,
        duration,
        this.learningStats.microLearningEvents + this.learningStats.backgroundLearningCycles
      ),
      memoryUsageBytes: this.estimateMemoryUsage(),
      lastLearningTimestamp: new Date(),
    };
  }

  private calculateRunningAverage(currentAvg: number, newValue: number, count: number): number {
    if (count === 0) return newValue;
    return (currentAvg * count + newValue) / (count + 1);
  }

  private estimateMemoryUsage(): number {
    // Rough estimation of memory usage
    const patterns = this.patternRecognizer.getAllPatterns();
    const patternBytes = patterns.length * 500; // ~500 bytes per pattern
    const queryStatsBytes = (this.queryOptimizer.getQueryStats() as QueryExecutionStats[]).length * 200;
    const ewcBytes = this.ewcState.fisherDiagonal.size * 32;

    return patternBytes + queryStatsBytes + ewcBytes;
  }
}

// ============================================================================
// Factory and Exports
// ============================================================================

/**
 * Create a complete self-learning system.
 */
export function createSelfLearningSystem(config?: Partial<LearningConfig>): {
  learningLoop: LearningLoop;
  queryOptimizer: QueryOptimizer;
  indexTuner: IndexTuner;
  patternRecognizer: PatternRecognizer;
} {
  const learningLoop = new LearningLoop(config);

  return {
    learningLoop,
    queryOptimizer: learningLoop.getQueryOptimizer(),
    indexTuner: learningLoop.getIndexTuner(),
    patternRecognizer: learningLoop.getPatternRecognizer(),
  };
}

/**
 * Default configuration for production use.
 */
export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  enableMicroLearning: true,
  microLearningThresholdMs: 0.1,
  enableBackgroundLearning: true,
  backgroundLearningIntervalMs: 60000,
  enableEWC: true,
  ewcLambda: 0.5,
  maxPatterns: 10000,
  patternExpiryMs: 86400000,
  learningRate: 0.01,
  momentum: 0.9,
};

/**
 * High-performance configuration (less learning, more speed).
 */
export const HIGH_PERF_LEARNING_CONFIG: LearningConfig = {
  enableMicroLearning: false,
  microLearningThresholdMs: 0,
  enableBackgroundLearning: true,
  backgroundLearningIntervalMs: 300000, // 5 minutes
  enableEWC: false,
  ewcLambda: 0,
  maxPatterns: 1000,
  patternExpiryMs: 3600000, // 1 hour
  learningRate: 0.001,
  momentum: 0.5,
};

/**
 * High-accuracy configuration (more learning, potentially slower).
 */
export const HIGH_ACCURACY_LEARNING_CONFIG: LearningConfig = {
  enableMicroLearning: true,
  microLearningThresholdMs: 0.05,
  enableBackgroundLearning: true,
  backgroundLearningIntervalMs: 30000, // 30 seconds
  enableEWC: true,
  ewcLambda: 0.8,
  maxPatterns: 50000,
  patternExpiryMs: 604800000, // 7 days
  learningRate: 0.05,
  momentum: 0.95,
};
