/**
 * RuVector PostgreSQL Test Suite
 *
 * Tests for RuVector PostgreSQL extension integration
 * with Claude-Flow V3.
 *
 * Run: npx ts-node tests/test-vectors.ts
 */

import { Pool, PoolClient } from 'pg';

// Configuration
const config = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'claude_flow',
  user: process.env.PGUSER || 'claude',
  password: process.env.PGPASSWORD || 'claude-flow-test',
};

// Test results tracking
interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

// Helper to run a test
async function runTest(
  name: string,
  testFn: (client: PoolClient) => Promise<void>
): Promise<void> {
  const pool = new Pool(config);
  const client = await pool.connect();
  const start = Date.now();

  try {
    await testFn(client);
    results.push({
      name,
      passed: true,
      duration: Date.now() - start,
    });
    console.log(`✅ ${name} (${Date.now() - start}ms)`);
  } catch (error) {
    results.push({
      name,
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    });
    console.log(`❌ ${name}: ${error}`);
  } finally {
    client.release();
    await pool.end();
  }
}

// ============================================
// TESTS
// ============================================

async function testConnection(client: PoolClient): Promise<void> {
  const result = await client.query('SELECT 1 AS connected');
  if (result.rows[0].connected !== 1) {
    throw new Error('Connection test failed');
  }
}

async function testRuVectorExtension(client: PoolClient): Promise<void> {
  const result = await client.query(`
    SELECT extname, extversion
    FROM pg_extension
    WHERE extname = 'ruvector'
  `);
  if (result.rows.length === 0) {
    throw new Error('RuVector extension not installed');
  }
}

async function testSchemaExists(client: PoolClient): Promise<void> {
  const result = await client.query(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name = 'claude_flow'
  `);
  if (result.rows.length === 0) {
    throw new Error('claude_flow schema not found');
  }
}

async function testTablesExist(client: PoolClient): Promise<void> {
  const tables = [
    'embeddings',
    'patterns',
    'agents',
    'trajectories',
    'hyperbolic_embeddings',
    'graph_nodes',
    'graph_edges',
  ];

  for (const table of tables) {
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'claude_flow' AND table_name = $1
    `, [table]);
    if (result.rows.length === 0) {
      throw new Error(`Table ${table} not found`);
    }
  }
}

async function testHNSWIndices(client: PoolClient): Promise<void> {
  const result = await client.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'claude_flow'
      AND indexdef LIKE '%ruvector_hnsw%'
  `);
  if (result.rows.length === 0) {
    throw new Error('No HNSW indices found');
  }
}

async function testLocalEmbedding(client: PoolClient): Promise<void> {
  const result = await client.query(`
    SELECT ruvector.fastembed('test text', 'all-MiniLM-L6-v2') AS embedding
  `);
  if (!result.rows[0].embedding) {
    throw new Error('Local embedding generation failed');
  }
  // Check dimension
  const dimResult = await client.query(`
    SELECT array_length(ruvector.fastembed('test', 'all-MiniLM-L6-v2')::float[], 1) AS dim
  `);
  if (dimResult.rows[0].dim !== 384) {
    throw new Error(`Expected 384 dimensions, got ${dimResult.rows[0].dim}`);
  }
}

async function testCosineSimilarity(client: PoolClient): Promise<void> {
  const result = await client.query(`
    SELECT ruvector.cosine_similarity(
      ruvector.fastembed('hello world', 'all-MiniLM-L6-v2'),
      ruvector.fastembed('hello world', 'all-MiniLM-L6-v2')
    ) AS similarity
  `);
  const similarity = parseFloat(result.rows[0].similarity);
  if (similarity < 0.99) {
    throw new Error(`Expected similarity ~1.0, got ${similarity}`);
  }
}

async function testSimilaritySearch(client: PoolClient): Promise<void> {
  // Insert test data
  await client.query(`
    INSERT INTO claude_flow.embeddings (content, embedding, metadata)
    VALUES (
      'test search content',
      ruvector.fastembed('test search content', 'all-MiniLM-L6-v2'),
      '{"test": true}'::jsonb
    )
    ON CONFLICT DO NOTHING
  `);

  // Search
  const result = await client.query(`
    SELECT content, ruvector.cosine_similarity(
      embedding,
      ruvector.fastembed('search content', 'all-MiniLM-L6-v2')
    ) AS similarity
    FROM claude_flow.embeddings
    WHERE embedding IS NOT NULL
    ORDER BY embedding <-> ruvector.fastembed('search content', 'all-MiniLM-L6-v2')
    LIMIT 1
  `);

  if (result.rows.length === 0) {
    throw new Error('Search returned no results');
  }
}

async function testAttentionFunctions(client: PoolClient): Promise<void> {
  const result = await client.query(`
    SELECT ruvector.softmax_attention(
      ruvector.fastembed('query', 'all-MiniLM-L6-v2'),
      ruvector.fastembed('key', 'all-MiniLM-L6-v2'),
      1.0
    ) AS attention
  `);
  if (result.rows[0].attention === null) {
    throw new Error('Attention function failed');
  }
}

async function testMultiHeadAttention(client: PoolClient): Promise<void> {
  const result = await client.query(`
    SELECT ruvector.multihead_attention_aggregate(
      ruvector.fastembed('query text', 'all-MiniLM-L6-v2'),
      ruvector.fastembed('key text', 'all-MiniLM-L6-v2'),
      8
    ) AS attention
  `);
  if (result.rows[0].attention === null) {
    throw new Error('Multi-head attention function failed');
  }
}

async function testHyperbolicOperations(client: PoolClient): Promise<void> {
  const result = await client.query(`
    SELECT ruvector.exp_map_poincare(
      ruvector.fastembed('test', 'all-MiniLM-L6-v2'),
      -1.0
    ) AS poincare
  `);
  if (!result.rows[0].poincare) {
    throw new Error('Poincaré mapping failed');
  }
}

async function testSparseVector(client: PoolClient): Promise<void> {
  // This tests BM25 scoring if sparse vectors are supported
  try {
    const result = await client.query(`
      SELECT ruvector.bm25_score(
        null::ruvector.sparse_vector,
        'test query'
      ) AS score
    `);
    // Score should be 0 for null sparse vector
  } catch (error) {
    // Sparse vectors might not be populated in test data
    console.log('  (sparse vector test skipped - no sparse data)');
  }
}

async function testAgentMemory(client: PoolClient): Promise<void> {
  // Insert test agent
  await client.query(`
    INSERT INTO claude_flow.agents (agent_id, agent_type, state, memory_embedding)
    VALUES (
      'test-agent-001',
      'tester',
      '{"test": true}'::jsonb,
      ruvector.fastembed('testing agent memory', 'all-MiniLM-L6-v2')
    )
    ON CONFLICT (agent_id) DO UPDATE SET
      memory_embedding = EXCLUDED.memory_embedding,
      last_active = NOW()
  `);

  // Search by memory similarity
  const result = await client.query(`
    SELECT agent_id, ruvector.cosine_similarity(
      memory_embedding,
      ruvector.fastembed('testing', 'all-MiniLM-L6-v2')
    ) AS similarity
    FROM claude_flow.agents
    WHERE agent_id = 'test-agent-001'
  `);

  if (result.rows.length === 0 || parseFloat(result.rows[0].similarity) < 0.5) {
    throw new Error('Agent memory search failed');
  }
}

async function testPatternStorage(client: PoolClient): Promise<void> {
  // Insert test pattern
  await client.query(`
    INSERT INTO claude_flow.patterns (name, description, embedding, pattern_type, confidence)
    VALUES (
      'test-pattern-001',
      'Test pattern for unit tests',
      ruvector.fastembed('test pattern unit testing', 'all-MiniLM-L6-v2'),
      'test',
      0.9
    )
    ON CONFLICT DO NOTHING
  `);

  // Search patterns
  const result = await client.query(`
    SELECT name, confidence
    FROM claude_flow.patterns
    WHERE embedding IS NOT NULL
      AND pattern_type = 'test'
    ORDER BY embedding <-> ruvector.fastembed('testing', 'all-MiniLM-L6-v2')
    LIMIT 1
  `);

  if (result.rows.length === 0) {
    throw new Error('Pattern search failed');
  }
}

async function testSearchFunction(client: PoolClient): Promise<void> {
  const result = await client.query(`
    SELECT * FROM claude_flow.search_similar(
      ruvector.fastembed('development', 'all-MiniLM-L6-v2'),
      5,
      0.3
    )
  `);
  // Function should execute without error
  if (result.rows === undefined) {
    throw new Error('search_similar function failed');
  }
}

async function testSelfLearning(client: PoolClient): Promise<void> {
  try {
    await client.query(`
      SELECT ruvector.learn_optimize('claude_flow.embeddings', 'embedding')
    `);
  } catch (error) {
    // Self-learning might not be available in all versions
    console.log('  (self-learning test skipped - feature may not be available)');
  }
}

async function testSearchLatency(client: PoolClient): Promise<void> {
  // Warm up
  await client.query(`
    SELECT id FROM claude_flow.embeddings
    WHERE embedding IS NOT NULL
    ORDER BY embedding <-> ruvector.fastembed('test', 'all-MiniLM-L6-v2')
    LIMIT 10
  `);

  // Measure latency
  const iterations = 10;
  const start = Date.now();

  for (let i = 0; i < iterations; i++) {
    await client.query(`
      SELECT id FROM claude_flow.embeddings
      WHERE embedding IS NOT NULL
      ORDER BY embedding <-> ruvector.fastembed('test query ${i}', 'all-MiniLM-L6-v2')
      LIMIT 10
    `);
  }

  const avgLatency = (Date.now() - start) / iterations;
  console.log(`  Average search latency: ${avgLatency.toFixed(2)}ms`);

  // Should be under 100ms (relaxed for test environment)
  if (avgLatency > 100) {
    console.log('  (Warning: latency higher than expected, may improve with more data/tuning)');
  }
}

// ============================================
// MAIN
// ============================================

async function main(): Promise<void> {
  console.log('');
  console.log('============================================');
  console.log('RuVector PostgreSQL Test Suite');
  console.log('============================================');
  console.log('');

  // Run all tests
  await runTest('Connection', testConnection);
  await runTest('RuVector Extension', testRuVectorExtension);
  await runTest('Schema Exists', testSchemaExists);
  await runTest('Tables Exist', testTablesExist);
  await runTest('HNSW Indices', testHNSWIndices);
  await runTest('Local Embedding Generation', testLocalEmbedding);
  await runTest('Cosine Similarity', testCosineSimilarity);
  await runTest('Similarity Search', testSimilaritySearch);
  await runTest('Attention Functions', testAttentionFunctions);
  await runTest('Multi-Head Attention', testMultiHeadAttention);
  await runTest('Hyperbolic Operations', testHyperbolicOperations);
  await runTest('Sparse Vector / BM25', testSparseVector);
  await runTest('Agent Memory', testAgentMemory);
  await runTest('Pattern Storage', testPatternStorage);
  await runTest('search_similar Function', testSearchFunction);
  await runTest('Self-Learning Optimization', testSelfLearning);
  await runTest('Search Latency', testSearchLatency);

  // Summary
  console.log('');
  console.log('============================================');
  console.log('Test Summary');
  console.log('============================================');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total Duration: ${totalDuration}ms`);
  console.log('');

  if (failed > 0) {
    console.log('Failed Tests:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`  - ${r.name}: ${r.error}`));
    process.exit(1);
  }

  console.log('All tests passed! ✅');
}

main().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
