/**
 * AgentDB Backend Example
 *
 * Demonstrates agentdb@2.0.0-alpha.3.4 integration with V3 memory system
 */

import { AgentDBBackend, HybridBackend, createDefaultEntry } from '../src/index.js';

// ===== Example 1: Basic AgentDBBackend Usage =====

async function basicExample() {
  console.log('\n=== Basic AgentDBBackend Example ===\n');

  // Initialize backend
  const backend = new AgentDBBackend({
    dbPath: ':memory:',
    namespace: 'demo',
    vectorDimension: 384, // Using MiniLM embeddings
    hnswM: 16,
    hnswEfConstruction: 200,
  });

  await backend.initialize();

  // Check if AgentDB is available
  if (backend.isAvailable()) {
    console.log('✓ AgentDB available with HNSW indexing');
  } else {
    console.log('⚠ AgentDB not available, using fallback');
  }

  // Store some entries
  const entries = [
    createDefaultEntry({
      key: 'auth-oauth',
      content: 'OAuth 2.0 authentication flow with refresh tokens',
      tags: ['auth', 'oauth', 'security'],
    }),
    createDefaultEntry({
      key: 'auth-jwt',
      content: 'JWT token-based authentication for REST APIs',
      tags: ['auth', 'jwt', 'api'],
    }),
    createDefaultEntry({
      key: 'auth-session',
      content: 'Session-based authentication with cookies',
      tags: ['auth', 'session', 'cookies'],
    }),
  ];

  console.log('Storing entries...');
  for (const entry of entries) {
    await backend.store(entry);
  }

  // Query by exact key
  console.log('\n--- Exact Key Query ---');
  const oauth = await backend.getByKey('demo', 'auth-oauth');
  console.log('Found:', oauth?.content);

  // Query by prefix
  console.log('\n--- Prefix Query ---');
  const authEntries = await backend.query({
    type: 'prefix',
    keyPrefix: 'auth-',
    limit: 10,
  });
  console.log(`Found ${authEntries.length} entries with prefix 'auth-'`);

  // Query by tags
  console.log('\n--- Tag Query ---');
  const jwtEntries = await backend.query({
    type: 'tag',
    tags: ['jwt'],
    limit: 10,
  });
  console.log(`Found ${jwtEntries.length} entries with tag 'jwt'`);

  // Get statistics
  console.log('\n--- Statistics ---');
  const stats = await backend.getStats();
  console.log('Total entries:', stats.totalEntries);
  console.log('Avg query time:', stats.avgQueryTime.toFixed(2), 'ms');
  console.log('Memory usage:', (stats.memoryUsage / 1024).toFixed(2), 'KB');

  if (stats.hnswStats) {
    console.log('HNSW vectors:', stats.hnswStats.vectorCount);
    console.log('HNSW avg search:', stats.hnswStats.avgSearchTime.toFixed(2), 'ms');
  }

  // Health check
  console.log('\n--- Health Check ---');
  const health = await backend.healthCheck();
  console.log('Status:', health.status);
  console.log('Storage:', health.components.storage.status);
  console.log('Index:', health.components.index.status);

  await backend.shutdown();
  console.log('\n✓ Backend shutdown complete');
}

// ===== Example 2: Hybrid Backend (SQLite + AgentDB) =====

async function hybridExample() {
  console.log('\n=== Hybrid Backend Example ===\n');

  // Simulated embedding function (normally would use real embeddings)
  const mockEmbedding = async (text: string): Promise<Float32Array> => {
    const hash = Array.from(text).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const dim = 384;
    const result = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      result[i] = Math.sin((hash + i) * 0.1);
    }
    return result;
  };

  const hybrid = new HybridBackend({
    sqlite: {
      dbPath: ':memory:',
    },
    agentdb: {
      dbPath: ':memory:',
      vectorDimension: 384,
      hnswM: 16,
    },
    embeddingGenerator: mockEmbedding,
    dualWrite: true,
  });

  await hybrid.initialize();

  console.log('✓ Hybrid backend initialized (SQLite + AgentDB)');

  // Store entries with embeddings
  console.log('\nStoring entries with embeddings...');
  const techEntries = [
    createDefaultEntry({
      key: 'pattern-singleton',
      content: 'Singleton design pattern ensures only one instance exists',
      namespace: 'patterns',
      tags: ['design-pattern', 'creational'],
    }),
    createDefaultEntry({
      key: 'pattern-factory',
      content: 'Factory pattern creates objects without specifying exact classes',
      namespace: 'patterns',
      tags: ['design-pattern', 'creational'],
    }),
    createDefaultEntry({
      key: 'pattern-observer',
      content: 'Observer pattern defines one-to-many dependency between objects',
      namespace: 'patterns',
      tags: ['design-pattern', 'behavioral'],
    }),
  ];

  for (const entry of techEntries) {
    await hybrid.store(entry);
  }

  // Structured query (goes to SQLite)
  console.log('\n--- Structured Query (SQLite) ---');
  const structured = await hybrid.queryStructured({
    namespace: 'patterns',
    type: 'episodic',
    limit: 10,
  });
  console.log(`Found ${structured.length} entries in 'patterns' namespace`);

  // Semantic query (goes to AgentDB)
  console.log('\n--- Semantic Query (AgentDB HNSW) ---');
  const semantic = await hybrid.querySemantic({
    content: 'object creation patterns',
    k: 5,
    threshold: 0.5,
  });
  console.log(`Found ${semantic.length} semantically similar entries`);
  semantic.forEach((entry, i) => {
    console.log(`  ${i + 1}. ${entry.key}: ${entry.content.substring(0, 60)}...`);
  });

  // Hybrid query (combines both)
  console.log('\n--- Hybrid Query (Both Backends) ---');
  const hybridResults = await hybrid.queryHybrid({
    semantic: {
      content: 'design patterns for object creation',
      k: 10,
      threshold: 0.3,
    },
    structured: {
      namespace: 'patterns',
    },
    combineStrategy: 'semantic-first',
  });
  console.log(`Found ${hybridResults.length} entries (hybrid query)`);

  // Statistics from both backends
  console.log('\n--- Hybrid Statistics ---');
  const hybridStats = await hybrid.getStats();
  console.log('Total entries:', hybridStats.totalEntries);
  console.log('Entries by namespace:', hybridStats.entriesByNamespace);
  console.log('SQLite queries:', (hybrid as any).stats.sqliteQueries);
  console.log('AgentDB queries:', (hybrid as any).stats.agentdbQueries);
  console.log('Hybrid queries:', (hybrid as any).stats.hybridQueries);

  await hybrid.shutdown();
  console.log('\n✓ Hybrid backend shutdown complete');
}

// ===== Example 3: Vector Search Performance =====

async function vectorSearchExample() {
  console.log('\n=== Vector Search Performance Example ===\n');

  const backend = new AgentDBBackend({
    dbPath: ':memory:',
    vectorDimension: 128, // Smaller for demo
    hnswM: 16,
    hnswEfConstruction: 100,
    hnswEfSearch: 50,
  });

  await backend.initialize();

  // Generate mock embeddings
  const generateEmbedding = (seed: number): Float32Array => {
    const embedding = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      embedding[i] = Math.sin((seed + i) * 0.1) * Math.cos(seed * 0.05);
    }
    return embedding;
  };

  // Insert many vectors
  console.log('Inserting 1000 vectors...');
  const startInsert = performance.now();

  for (let i = 0; i < 1000; i++) {
    const entry = createDefaultEntry({
      key: `vector-${i}`,
      content: `Content for vector ${i}`,
      namespace: 'vectors',
    });
    entry.embedding = generateEmbedding(i);
    await backend.store(entry);
  }

  const insertTime = performance.now() - startInsert;
  console.log(`Inserted 1000 vectors in ${insertTime.toFixed(2)}ms`);

  // Perform searches
  console.log('\nPerforming 100 searches...');
  const queryEmbedding = generateEmbedding(42);

  const startSearch = performance.now();

  for (let i = 0; i < 100; i++) {
    await backend.search(queryEmbedding, { k: 10 });
  }

  const searchTime = performance.now() - startSearch;
  console.log(`100 searches in ${searchTime.toFixed(2)}ms`);
  console.log(`Avg per search: ${(searchTime / 100).toFixed(2)}ms`);

  // Get final statistics
  const stats = await backend.getStats();
  console.log('\n--- Final Statistics ---');
  console.log('Total searches:', stats.avgSearchTime > 0 ? 'Yes' : 'No');
  console.log('Memory usage:', (stats.memoryUsage / 1024 / 1024).toFixed(2), 'MB');

  await backend.shutdown();
  console.log('\n✓ Performance test complete');
}

// ===== Example 4: Graceful Degradation =====

async function gracefulDegradationExample() {
  console.log('\n=== Graceful Degradation Example ===\n');

  // Create backend that might not have agentdb
  const backend = new AgentDBBackend({
    dbPath: ':memory:',
  });

  await backend.initialize();

  // Check availability
  if (backend.isAvailable()) {
    console.log('✓ AgentDB available - using HNSW indexing');
  } else {
    console.log('⚠ AgentDB not available - using fallback in-memory storage');
    console.log('  (Install: npm install agentdb@2.0.0-alpha.3.4)');
  }

  // Store entries (works either way)
  const entry = createDefaultEntry({
    key: 'test',
    content: 'Test content',
  });
  entry.embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

  await backend.store(entry);

  // Search (falls back to brute-force if needed)
  const results = await backend.search(new Float32Array([0.1, 0.2, 0.3, 0.4]), {
    k: 5,
  });

  console.log(`Search found ${results.length} results`);
  console.log('Fallback behavior: ', backend.isAvailable() ? 'HNSW' : 'Brute-force');

  await backend.shutdown();
  console.log('\n✓ Graceful degradation demonstrated');
}

// ===== Run All Examples =====

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  AgentDB Integration Examples                             ║');
  console.log('║  V3 Memory Module with agentdb@2.0.0-alpha.3.4            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  try {
    await basicExample();
    await hybridExample();
    await vectorSearchExample();
    await gracefulDegradationExample();

    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║  All examples completed successfully!                     ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
  } catch (error) {
    console.error('\n❌ Error running examples:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { basicExample, hybridExample, vectorSearchExample, gracefulDegradationExample };
