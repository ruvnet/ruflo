/**
 * RuVector PostgreSQL Bridge - Self-Learning Example
 *
 * This example demonstrates:
 * - Enabling the self-optimization learning loop
 * - Monitoring query patterns and performance
 * - Auto-tuning HNSW index parameters
 * - Pattern recognition and anomaly detection
 *
 * Run with: npx ts-node examples/ruvector/self-learning.ts
 *
 * @module @claude-flow/plugins/examples/ruvector/self-learning
 */

import {
  createRuVectorBridge,
  type RuVectorBridge,
} from '../../src/integrations/ruvector/index.js';

import {
  createSelfLearningSystem,
  LearningLoop,
  QueryOptimizer,
  IndexTuner,
  PatternRecognizer,
  DEFAULT_LEARNING_CONFIG,
  HIGH_ACCURACY_LEARNING_CONFIG,
  type LearningConfig,
  type QueryHistory,
  type Pattern,
  type WorkloadAnalysis,
} from '../../src/integrations/ruvector/self-learning.js';

// ============================================================================
// Configuration
// ============================================================================

const config = {
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'vectors',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
  },
  dimensions: 384,
  learningEnabled: true,
};

// ============================================================================
// Simulated Query Workload
// ============================================================================

/**
 * Simulated queries representing a realistic workload.
 */
const workloadQueries = [
  // Vector similarity searches (frequent)
  "SELECT id, embedding <-> $1 as distance FROM documents ORDER BY distance LIMIT 10",
  "SELECT id, embedding <=> $1 as distance FROM documents WHERE category = 'tech' ORDER BY distance LIMIT 5",
  "SELECT id, metadata FROM documents WHERE embedding <-> $1 < 0.5 LIMIT 20",

  // Analytical queries
  "SELECT category, COUNT(*) FROM documents GROUP BY category",
  "SELECT DATE(created_at), COUNT(*) FROM documents GROUP BY DATE(created_at)",

  // CRUD operations
  "INSERT INTO documents (id, embedding, metadata) VALUES ($1, $2, $3)",
  "UPDATE documents SET metadata = $1 WHERE id = $2",
  "DELETE FROM documents WHERE created_at < $1",

  // Complex joins
  "SELECT d.id, d.metadata, c.name FROM documents d JOIN categories c ON d.category_id = c.id WHERE d.embedding <-> $1 < 0.3",
];

/**
 * Generate realistic query history.
 */
function generateQueryHistory(queries: string[], count: number): QueryHistory[] {
  const history: QueryHistory[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const query = queries[Math.floor(Math.random() * queries.length)];
    const isVectorSearch = query.includes('<->') || query.includes('<=>');

    // Simulate realistic durations
    let baseDuration = isVectorSearch ? 50 : 10;
    if (query.includes('GROUP BY')) baseDuration = 100;
    if (query.includes('JOIN')) baseDuration = 150;

    // Add some variance
    const duration = baseDuration * (0.5 + Math.random());

    // Simulate periodic pattern (business hours)
    const hour = Math.floor((i / count) * 24);
    const isPeakHour = hour >= 9 && hour <= 17;
    const timestamp = new Date(now - (count - i) * 60000 + (isPeakHour ? 0 : Math.random() * 300000));

    history.push({
      fingerprint: `qf_${Math.abs(hashCode(query)).toString(16)}`,
      sql: query,
      timestamp,
      durationMs: duration,
      rowCount: Math.floor(Math.random() * 100) + 1,
      success: Math.random() > 0.02, // 2% error rate
      sessionId: `session_${i % 10}`,
    });
  }

  return history;
}

/**
 * Simple hash function for query fingerprinting.
 */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

/**
 * Print workload analysis summary.
 */
function printWorkloadAnalysis(analysis: WorkloadAnalysis): void {
  console.log('\n   Workload Analysis Summary');
  console.log('   ' + '-'.repeat(50));
  console.log(`   Total queries analyzed: ${analysis.totalQueries}`);
  console.log(`   Analysis duration: ${analysis.durationMs.toFixed(2)}ms`);

  console.log('\n   Query type distribution:');
  analysis.queryDistribution.forEach((count, type) => {
    const pct = ((count / analysis.totalQueries) * 100).toFixed(1);
    console.log(`     ${type}: ${count} (${pct}%)`);
  });

  console.log('\n   Workload characteristics:');
  console.log(`     Read/Write ratio: ${analysis.characteristics.readWriteRatio.toFixed(2)}`);
  console.log(`     Vector search %: ${analysis.characteristics.vectorSearchPercentage.toFixed(1)}%`);
  console.log(`     Avg complexity: ${analysis.characteristics.avgComplexity.toFixed(3)}`);
  console.log(`     Type: ${analysis.characteristics.isOLTP ? 'OLTP' : analysis.characteristics.isOLAP ? 'OLAP' : 'Hybrid'}`);

  console.log('\n   Top query patterns:');
  analysis.topPatterns.slice(0, 5).forEach((pattern, i) => {
    console.log(`     ${i + 1}. Frequency: ${pattern.frequency}, Avg: ${pattern.avgDurationMs.toFixed(2)}ms`);
    console.log(`        ${pattern.example.slice(0, 60)}...`);
  });

  console.log('\n   Hot tables:');
  analysis.hotTables.slice(0, 3).forEach(table => {
    console.log(`     ${table.tableName}: reads=${table.reads}, writes=${table.writes}, vector=${table.vectorSearches}`);
  });

  console.log('\n   Recommendations:');
  analysis.recommendations.forEach(rec => {
    console.log(`     [P${rec.priority}] ${rec.description}`);
    console.log(`         Impact: ${rec.estimatedImpact}`);
  });
}

// ============================================================================
// Main Example
// ============================================================================

async function main(): Promise<void> {
  console.log('RuVector PostgreSQL Bridge - Self-Learning Example');
  console.log('====================================================\n');

  const bridge: RuVectorBridge = createRuVectorBridge({
    connectionString: `postgresql://${config.connection.user}:${config.connection.password}@${config.connection.host}:${config.connection.port}/${config.connection.database}`,
  });

  // Create self-learning system with custom configuration
  const learningConfig: Partial<LearningConfig> = {
    enableMicroLearning: true,
    microLearningThresholdMs: 0.1,
    enableBackgroundLearning: true,
    backgroundLearningIntervalMs: 5000, // 5 seconds for demo
    enableEWC: true,
    ewcLambda: 0.5,
    maxPatterns: 1000,
    patternExpiryMs: 3600000, // 1 hour
  };

  const { learningLoop, queryOptimizer, indexTuner, patternRecognizer } =
    createSelfLearningSystem(learningConfig);

  try {
    await bridge.connect();
    console.log('Connected to PostgreSQL');

    // ========================================================================
    // 1. Enable Learning Loop
    // ========================================================================
    console.log('\n1. Starting Self-Learning Loop');
    console.log('   ' + '-'.repeat(50));

    learningLoop.start();
    console.log('   Learning loop started');
    console.log(`   Configuration:`);
    console.log(`     - Micro-learning: ${learningConfig.enableMicroLearning ? 'enabled' : 'disabled'}`);
    console.log(`     - Background learning interval: ${learningConfig.backgroundLearningIntervalMs}ms`);
    console.log(`     - EWC protection: ${learningConfig.enableEWC ? 'enabled' : 'disabled'}`);
    console.log(`     - Max patterns: ${learningConfig.maxPatterns}`);

    // ========================================================================
    // 2. Simulate Query Workload
    // ========================================================================
    console.log('\n2. Simulating Query Workload');
    console.log('   ' + '-'.repeat(50));

    const queryHistory = generateQueryHistory(workloadQueries, 500);
    console.log(`   Generated ${queryHistory.length} simulated queries`);

    // Feed queries to the learning system
    console.log('   Processing queries through micro-learning...');
    const startProcess = performance.now();

    for (const history of queryHistory) {
      // Micro-learning: process each query
      learningLoop.microLearn(history.sql, history.durationMs, history.rowCount);

      // Record in index tuner
      indexTuner.recordQuery(history);
    }

    const processTime = performance.now() - startProcess;
    console.log(`   Processed ${queryHistory.length} queries in ${processTime.toFixed(2)}ms`);
    console.log(`   Throughput: ${(queryHistory.length / (processTime / 1000)).toFixed(0)} queries/second`);

    // ========================================================================
    // 3. Analyze Workload Patterns
    // ========================================================================
    console.log('\n3. Analyzing Workload Patterns');
    console.log('   ' + '-'.repeat(50));

    const workloadAnalysis = indexTuner.analyzeWorkload();
    printWorkloadAnalysis(workloadAnalysis);

    // ========================================================================
    // 4. Query Optimization Suggestions
    // ========================================================================
    console.log('\n4. Query Optimization Suggestions');
    console.log('   ' + '-'.repeat(50));

    // Analyze a slow query
    const slowQuery = "SELECT * FROM documents WHERE embedding <-> $1 < 0.5";
    console.log(`\n   Analyzing: "${slowQuery}"`);

    const analysis = queryOptimizer.analyzeQuery(slowQuery);
    console.log(`\n   Analysis results:`);
    console.log(`     Query type: ${analysis.queryType}`);
    console.log(`     Complexity: ${(analysis.complexity * 100).toFixed(1)}%`);
    console.log(`     Parse time: ${analysis.parseTimeMs.toFixed(3)}ms`);

    console.log('\n   Vector operations:');
    analysis.vectorOperations.forEach(op => {
      console.log(`     - ${op.type} on ${op.table}.${op.column} (metric: ${op.metric})`);
    });

    console.log('\n   Bottlenecks:');
    analysis.bottlenecks.forEach(b => {
      console.log(`     - [${b.type}] ${b.description} (severity: ${b.severity})`);
      console.log(`       Suggestion: ${b.suggestion}`);
    });

    const optimizations = queryOptimizer.suggestOptimizations(analysis);
    console.log('\n   Suggested optimizations:');
    optimizations.forEach(opt => {
      console.log(`     - [${opt.type}] ${opt.description}`);
      console.log(`       Expected improvement: ${opt.expectedImprovement}%`);
      console.log(`       Confidence: ${(opt.confidence * 100).toFixed(0)}%, Risk: ${opt.risk}`);
    });

    // ========================================================================
    // 5. Auto-Tune HNSW Parameters
    // ========================================================================
    console.log('\n5. Auto-Tuning HNSW Index Parameters');
    console.log('   ' + '-'.repeat(50));

    const hnswParams = indexTuner.tuneHNSW('documents');
    console.log('   Recommended HNSW parameters for "documents" table:');
    console.log(`     M: ${hnswParams.m}`);
    console.log(`     ef_construction: ${hnswParams.efConstruction}`);
    console.log(`     ef_search: ${hnswParams.efSearch}`);
    console.log(`     Optimized for: ${hnswParams.optimizedFor}`);
    console.log(`     Confidence: ${(hnswParams.confidence * 100).toFixed(1)}%`);
    console.log(`     Estimated recall: ${(hnswParams.estimatedRecall * 100).toFixed(1)}%`);
    console.log(`     Estimated QPS: ${hnswParams.estimatedQps}`);

    // Get index suggestions
    const indexSuggestions = indexTuner.suggestIndexes();
    console.log('\n   Index suggestions:');
    indexSuggestions.slice(0, 3).forEach(suggestion => {
      console.log(`     - ${suggestion.tableName}.${suggestion.columnName}`);
      console.log(`       Type: ${suggestion.indexType}, Metric: ${suggestion.metric}`);
      console.log(`       Confidence: ${(suggestion.confidence * 100).toFixed(1)}%`);
      console.log(`       SQL: ${suggestion.createSql}`);
    });

    // ========================================================================
    // 6. Pattern Recognition
    // ========================================================================
    console.log('\n6. Pattern Recognition');
    console.log('   ' + '-'.repeat(50));

    // Learn patterns from history
    patternRecognizer.learnFromHistory(queryHistory);

    const patterns = patternRecognizer.detectPatterns();
    console.log(`   Detected ${patterns.length} patterns`);

    console.log('\n   Top patterns by occurrence:');
    patterns.slice(0, 5).forEach((pattern, i) => {
      console.log(`     ${i + 1}. ${pattern.type} (${pattern.occurrences} occurrences)`);
      console.log(`        Confidence: ${(pattern.confidence * 100).toFixed(1)}%`);
      if (pattern.temporal) {
        console.log(`        Periodic: ${pattern.temporal.isPeriodic}`);
        console.log(`        Peak hours: ${pattern.temporal.peakHours.join(', ')}`);
      }
      console.log(`        Performance trend: ${pattern.performance.responseTrend}`);
    });

    // ========================================================================
    // 7. Anomaly Detection
    // ========================================================================
    console.log('\n7. Anomaly Detection');
    console.log('   ' + '-'.repeat(50));

    // Simulate some anomalous queries
    const anomalousQueries = [
      "SELECT * FROM documents", // No limit - potential full scan
      "SELECT * FROM documents d1, documents d2", // Cartesian product
    ];

    const anomalies = patternRecognizer.detectAnomalies(anomalousQueries);

    if (anomalies.length > 0) {
      console.log(`   Detected ${anomalies.length} anomalies:`);
      anomalies.forEach((anomaly, i) => {
        console.log(`\n     ${i + 1}. ${anomaly.type}`);
        console.log(`        Query: ${anomaly.query.slice(0, 50)}...`);
        console.log(`        Severity: ${anomaly.severity}/10`);
        console.log(`        Description: ${anomaly.description}`);
        console.log(`        Possible causes:`);
        anomaly.possibleCauses.forEach(cause => console.log(`          - ${cause}`));
        console.log(`        Recommendations:`);
        anomaly.recommendations.forEach(rec => console.log(`          - ${rec}`));
      });
    } else {
      console.log('   No anomalies detected in the analyzed queries');
    }

    // ========================================================================
    // 8. Learning Statistics
    // ========================================================================
    console.log('\n8. Learning Statistics');
    console.log('   ' + '-'.repeat(50));

    const stats = learningLoop.getStats();
    console.log('   Current learning state:');
    console.log(`     Total patterns: ${stats.totalPatterns}`);
    console.log(`     Active patterns: ${stats.activePatterns}`);
    console.log(`     Micro-learning events: ${stats.microLearningEvents}`);
    console.log(`     Background learning cycles: ${stats.backgroundLearningCycles}`);
    console.log(`     EWC consolidations: ${stats.ewcConsolidations}`);
    console.log(`     Avg learning time: ${stats.avgLearningTimeMs.toFixed(3)}ms`);
    console.log(`     Memory usage: ${(stats.memoryUsageBytes / 1024).toFixed(2)} KB`);
    console.log(`     Last learning: ${stats.lastLearningTimestamp.toISOString()}`);

    // EWC state
    const ewcState = learningLoop.getEWCState();
    console.log('\n   EWC++ Protection State:');
    console.log(`     Protected patterns: ${ewcState.protectedPatterns.size}`);
    console.log(`     Consolidation count: ${ewcState.consolidationCount}`);
    console.log(`     Fisher matrix entries: ${ewcState.fisherDiagonal.size}`);

    // ========================================================================
    // 9. Query Statistics
    // ========================================================================
    console.log('\n9. Query Statistics');
    console.log('   ' + '-'.repeat(50));

    const queryStats = queryOptimizer.getQueryStats() as Array<{
      fingerprint: string;
      sql: string;
      executionCount: number;
      avgDurationMs: number;
      p95DurationMs: number;
    }>;

    if (Array.isArray(queryStats) && queryStats.length > 0) {
      console.log(`   Tracked ${queryStats.length} unique query patterns`);

      // Sort by execution count
      const topQueries = queryStats
        .sort((a, b) => b.executionCount - a.executionCount)
        .slice(0, 5);

      console.log('\n   Top queries by frequency:');
      topQueries.forEach((stat, i) => {
        console.log(`     ${i + 1}. ${stat.sql.slice(0, 50)}...`);
        console.log(`        Executions: ${stat.executionCount}`);
        console.log(`        Avg duration: ${stat.avgDurationMs.toFixed(2)}ms`);
        console.log(`        P95 duration: ${stat.p95DurationMs.toFixed(2)}ms`);
      });
    }

    // ========================================================================
    // 10. Stop Learning Loop
    // ========================================================================
    console.log('\n10. Stopping Learning Loop');
    console.log('   ' + '-'.repeat(50));

    learningLoop.stop();
    console.log('   Learning loop stopped');
    console.log(`   Final stats:`);
    console.log(`     - Total patterns learned: ${learningLoop.getStats().totalPatterns}`);
    console.log(`     - Total micro-learning events: ${learningLoop.getStats().microLearningEvents}`);

    // ========================================================================
    // Done
    // ========================================================================
    console.log('\n' + '='.repeat(55));
    console.log('Self-learning example completed!');
    console.log('='.repeat(55));

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    // Ensure learning loop is stopped
    if (learningLoop.isActive()) {
      learningLoop.stop();
    }

    await bridge.disconnect();
    console.log('\nDisconnected from PostgreSQL.');
  }
}

main().catch(console.error);
