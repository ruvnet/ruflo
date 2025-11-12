# AgentDB Performance Tuning Guide

**Version:** 1.3.9
**Last Updated:** November 12, 2025
**Target:** Optimize AgentDB for production workloads

---

## Performance Overview

**AgentDB Performance Claims (LinkedIn Post):**
- 150x-12,500x faster searches (vs. linear scan)
- 0.59ms per record processing
- 52% execution time reduction
- 18% token usage reduction
- 0.36 KB memory per iteration

**This guide shows you how to achieve these results.**

---

## Quick Wins (Immediate 10-100x Improvements)

### 1. Enable HNSW Indexing

```javascript
// ❌ Without HNSW (linear scan)
const db = agentdb_init('./db.sqlite');

// ✅ With HNSW (150x-12,500x faster)
const db = agentdb_init('./db.sqlite', {
  enableHNSW: true  // ← Critical for performance
});
```

**Impact:**
- 1K vectors: 15ms → <1ms (150x)
- 100K vectors: 2s → 17ms (116x)
- 1M vectors: 100s → 8ms (12,500x)

---

### 2. Use Batch Operations

```javascript
// ❌ Sequential inserts (1000ms for 100 items)
for (const item of items) {
  await agentdb_insert(db, item.embedding, item.metadata);
}

// ✅ Batch insert (2ms for 100 items = 500x faster)
await agentdb_insert_batch(db, items);
```

**Impact:** 141x-500x faster inserts

---

### 3. Apply Quantization

```javascript
// ❌ No quantization (1.5 KB per vector)
const db = agentdb_init('./db.sqlite');

// ✅ Scalar quantization (0.375 KB per vector = 4x reduction)
const db = agentdb_init('./db.sqlite', {
  quantization: 'scalar'
});
```

**Impact:**
- 4-32x memory reduction
- Faster loading times
- Lower storage costs

---

## Benchmarking Your System

### Setup Benchmark Environment

```javascript
import { agentdb_init, agentdb_insert, agentdb_search } from 'agentdb';

class AgentDBBenchmark {
  constructor(config) {
    this.config = config;
    this.results = [];
  }

  async runBenchmark() {
    console.log('🚀 Starting AgentDB Benchmark...\n');

    await this.benchmarkInserts();
    await this.benchmarkSearches();
    await this.benchmarkBatchOperations();
    await this.printResults();
  }

  async benchmarkInserts() {
    const db = agentdb_init(':memory:', this.config);
    const sizes = [100, 1000, 10000];

    for (const size of sizes) {
      const vectors = this.generateVectors(size);
      const start = Date.now();

      for (const v of vectors) {
        await agentdb_insert(db, v.embedding, v.metadata);
      }

      const duration = Date.now() - start;
      this.results.push({
        operation: 'Sequential Insert',
        size,
        duration: `${duration}ms`,
        perItem: `${(duration / size).toFixed(2)}ms`
      });
    }
  }

  async benchmarkSearches() {
    const db = agentdb_init(':memory:', this.config);
    const sizes = [1000, 10000, 100000];

    for (const size of sizes) {
      // Populate database
      const vectors = this.generateVectors(size);
      await agentdb_insert_batch(db, vectors);

      // Benchmark search
      const query = this.generateVector();
      const start = Date.now();

      await agentdb_search(db, query, { k: 10 });

      const duration = Date.now() - start;
      this.results.push({
        operation: 'Search',
        size,
        duration: `${duration}ms`,
        config: JSON.stringify(this.config)
      });
    }
  }

  async benchmarkBatchOperations() {
    const db = agentdb_init(':memory:', this.config);
    const sizes = [100, 1000, 10000];

    for (const size of sizes) {
      const vectors = this.generateVectors(size);
      const start = Date.now();

      await agentdb_insert_batch(db, vectors);

      const duration = Date.now() - start;
      this.results.push({
        operation: 'Batch Insert',
        size,
        duration: `${duration}ms`,
        perItem: `${(duration / size).toFixed(3)}ms`
      });
    }
  }

  generateVector(dimensions = 384) {
    return Array(dimensions).fill(0).map(() => Math.random() * 2 - 1);
  }

  generateVectors(count, dimensions = 384) {
    return Array(count).fill(0).map((_, i) => ({
      embedding: this.generateVector(dimensions),
      metadata: { id: `vec-${i}`, index: i }
    }));
  }

  printResults() {
    console.table(this.results);
  }
}

// Run benchmark
const benchmark = new AgentDBBenchmark({
  enableHNSW: true,
  quantization: 'scalar'
});

await benchmark.runBenchmark();
```

---

## Performance Tuning Matrix

### Quantization Selection

| Dataset Size | Accuracy Need | Recommended | Memory | Speed |
|--------------|---------------|-------------|--------|-------|
| <1K | High | None | 1x | Baseline |
| 1K-10K | High | Product | 8-16x | Fast |
| 10K-100K | Balanced | **Scalar** | 4x | Faster |
| >100K | Scale priority | Binary | 32x | Fastest |

**Configuration:**

```javascript
// Small, high accuracy
{ quantization: 'product', enableHNSW: true }

// Medium, balanced (RECOMMENDED)
{ quantization: 'scalar', enableHNSW: true }

// Large, maximum speed
{ quantization: 'binary', enableHNSW: true }
```

---

### k Value Optimization

| Use Case | k Value | Reasoning |
|----------|---------|-----------|
| Quick lookup | 5 | Fast, focused results |
| General search | 10 | **Recommended default** |
| Comprehensive | 20 | Broader coverage |
| Reranking pipeline | 50-100 | Get candidates for reranking |

**Test Optimal k:**

```javascript
async function findOptimalK(db, testQueries) {
  const kValues = [5, 10, 15, 20, 30, 50];
  const results = {};

  for (const k of kValues) {
    const start = Date.now();
    const relevance = [];

    for (const query of testQueries) {
      const results = await agentdb_search(db, query.vector, { k });
      relevance.push(calculateRelevance(results, query.expected));
    }

    results[k] = {
      avgLatency: (Date.now() - start) / testQueries.length,
      avgRelevance: average(relevance)
    };
  }

  // Find sweet spot: high relevance, low latency
  return findOptimalTradeoff(results);
}
```

---

### Threshold Tuning

**Methodology:**

```javascript
async function tuneThreshold(db, validationSet) {
  const thresholds = [0.5, 0.6, 0.7, 0.8, 0.9];
  const metrics = {};

  for (const threshold of thresholds) {
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;

    for (const item of validationSet) {
      const results = await agentdb_search(db, item.query, {
        k: 20,
        threshold
      });

      const resultIds = new Set(results.map(r => r.id));
      const expectedIds = new Set(item.expectedResults);

      truePositives += intersection(resultIds, expectedIds).size;
      falsePositives += difference(resultIds, expectedIds).size;
      falseNegatives += difference(expectedIds, resultIds).size;
    }

    metrics[threshold] = {
      precision: truePositives / (truePositives + falsePositives),
      recall: truePositives / (truePositives + falseNegatives),
      f1: calculateF1(precision, recall)
    };
  }

  // Return threshold with highest F1 score
  return findBestThreshold(metrics);
}
```

**Typical Results:**

| Threshold | Precision | Recall | F1 | Use Case |
|-----------|-----------|--------|-----|----------|
| 0.5 | 0.65 | 0.95 | 0.77 | Exploratory |
| 0.6 | 0.75 | 0.88 | 0.81 | Broad search |
| 0.7 | 0.85 | 0.78 | 0.81 | **Balanced (recommended)** |
| 0.8 | 0.92 | 0.65 | 0.76 | High precision |
| 0.9 | 0.98 | 0.45 | 0.62 | Near-exact match |

---

## Advanced Optimizations

### 1. Connection Pooling

```javascript
class AgentDBPool {
  constructor(config, poolSize = 5) {
    this.config = config;
    this.pool = [];
    this.available = [];

    for (let i = 0; i < poolSize; i++) {
      const conn = agentdb_init(config.dbPath, config);
      this.pool.push(conn);
      this.available.push(conn);
    }
  }

  async acquire() {
    while (this.available.length === 0) {
      await this.sleep(10);  // Wait for available connection
    }
    return this.available.pop();
  }

  release(conn) {
    this.available.push(conn);
  }

  async withConnection(fn) {
    const conn = await this.acquire();
    try {
      return await fn(conn);
    } finally {
      this.release(conn);
    }
  }
}

// Usage
const pool = new AgentDBPool({ dbPath: './db.sqlite' }, 5);

await pool.withConnection(async (db) => {
  return await agentdb_search(db, query, { k: 10 });
});
```

**Impact:** 2-5x throughput improvement for concurrent requests

---

### 2. Result Caching

```javascript
class CachedAgentDB {
  constructor(db, cacheSize = 1000) {
    this.db = db;
    this.cache = new LRUCache(cacheSize);
  }

  async search(query, options = {}) {
    const cacheKey = this.getCacheKey(query, options);

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);  // Cache hit
    }

    const results = await agentdb_search(this.db, query, options);
    this.cache.set(cacheKey, results);
    return results;
  }

  getCacheKey(query, options) {
    // Create deterministic cache key
    return hash(JSON.stringify({ query: query.slice(0, 10), options }));
  }
}
```

**Impact:** Near-instant response for repeated queries

---

### 3. Parallel Searches

```javascript
async function parallelSearch(db, queries) {
  // Execute searches in parallel
  const results = await Promise.all(
    queries.map(q => agentdb_search(db, q.vector, q.options))
  );

  return results;
}

// Example: Multi-query expansion
const expandedQueries = [
  { vector: mainQuery, options: { k: 10 } },
  { vector: synonymQuery, options: { k: 10 } },
  { vector: relatedQuery, options: { k: 10 } }
];

const allResults = await parallelSearch(db, expandedQueries);
const merged = deduplicateAndMerge(allResults);
```

**Impact:** 3x throughput for multiple queries

---

### 4. WAL Mode (Write-Ahead Logging)

```javascript
const db = agentdb_init('./db.sqlite', {
  enableHNSW: true,
  quantization: 'scalar',
  writeAheadLog: true  // ← Enable WAL mode
});
```

**Benefits:**
- Concurrent readers while writing
- Better write performance
- Crash recovery
- Recommended for production

---

## Memory Optimization

### Calculate Optimal Memory Budget

```javascript
function calculateMemoryRequirements(config) {
  const {
    numVectors = 100000,
    dimensions = 384,
    quantization = 'scalar'
  } = config;

  const bytesPerFloat = 4;
  const uncompressed = numVectors * dimensions * bytesPerFloat;

  const compressionFactors = {
    'none': 1,
    'product': 12,
    'scalar': 4,
    'binary': 32
  };

  const compressed = uncompressed / compressionFactors[quantization];
  const indexOverhead = compressed * 0.1;  // HNSW ~10%
  const cacheOverhead = 100 * 1024 * 1024;  // 100MB cache

  const total = compressed + indexOverhead + cacheOverhead;

  return {
    vectors: formatBytes(compressed),
    index: formatBytes(indexOverhead),
    cache: formatBytes(cacheOverhead),
    total: formatBytes(total),
    recommended: formatBytes(total * 1.5)  // 50% buffer
  };
}

// Example:
console.log(calculateMemoryRequirements({
  numVectors: 100000,
  dimensions: 384,
  quantization: 'scalar'
}));

// Output:
// {
//   vectors: "36.6 MB",
//   index: "3.7 MB",
//   cache: "100 MB",
//   total: "140.3 MB",
//   recommended: "210.5 MB"
// }
```

---

## Production Performance Targets

### Latency Targets

| Operation | Target | Acceptable | Alert |
|-----------|--------|------------|-------|
| Single search (<1K vectors) | <1ms | <5ms | >10ms |
| Single search (100K vectors) | <20ms | <50ms | >100ms |
| Single search (1M vectors) | <10ms | <30ms | >50ms |
| Batch insert (100 items) | <5ms | <20ms | >50ms |
| Batch insert (1000 items) | <50ms | <200ms | >500ms |

### Throughput Targets

| Configuration | Searches/sec | Inserts/sec |
|---------------|--------------|-------------|
| Small (1K vectors) | 10,000+ | 5,000+ |
| Medium (100K vectors) | 1,000+ | 1,000+ |
| Large (1M vectors) | 500+ | 500+ |

---

## Monitoring & Profiling

### Performance Monitoring

```javascript
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      searches: [],
      inserts: [],
      errors: []
    };
  }

  async monitorSearch(db, query, options) {
    const start = performance.now();
    const memBefore = process.memoryUsage().heapUsed;

    try {
      const results = await agentdb_search(db, query, options);
      const duration = performance.now() - start;
      const memAfter = process.memoryUsage().heapUsed;

      this.metrics.searches.push({
        timestamp: Date.now(),
        duration,
        resultCount: results.length,
        memoryDelta: memAfter - memBefore,
        k: options.k
      });

      return results;
    } catch (error) {
      this.metrics.errors.push({
        timestamp: Date.now(),
        operation: 'search',
        error: error.message
      });
      throw error;
    }
  }

  getReport() {
    const searches = this.metrics.searches;

    return {
      totalSearches: searches.length,
      avgLatency: average(searches.map(s => s.duration)),
      p50Latency: percentile(searches.map(s => s.duration), 0.5),
      p95Latency: percentile(searches.map(s => s.duration), 0.95),
      p99Latency: percentile(searches.map(s => s.duration), 0.99),
      avgMemoryDelta: average(searches.map(s => s.memoryDelta)),
      errorRate: this.metrics.errors.length / searches.length
    };
  }
}
```

---

## Troubleshooting Performance Issues

### Issue 1: Slow Searches

**Symptoms:** Search latency >100ms

**Diagnosis:**
```javascript
// Check if HNSW is enabled
const config = db.getConfig();
console.log('HNSW enabled:', config.enableHNSW);  // Should be true

// Check database size
const stats = await db.stats();
console.log('Vector count:', stats.vectorCount);
console.log('Database size:', formatBytes(stats.size));

// Profile search
const start = Date.now();
const results = await agentdb_search(db, query, { k: 10 });
console.log('Search time:', Date.now() - start, 'ms');
```

**Solutions:**
1. Enable HNSW indexing: `{ enableHNSW: true }`
2. Apply quantization: `{ quantization: 'scalar' }`
3. Reduce k value if too high
4. Run VACUUM to optimize database
5. Check for filter complexity

---

### Issue 2: High Memory Usage

**Symptoms:** Memory usage >2GB

**Diagnosis:**
```javascript
const memory = process.memoryUsage();
console.log('Heap used:', formatBytes(memory.heapUsed));
console.log('Heap total:', formatBytes(memory.heapTotal));
console.log('External:', formatBytes(memory.external));

const dbSize = calculateMemoryRequirements({
  numVectors: stats.vectorCount,
  quantization: config.quantization
});
console.log('Expected:', dbSize.total);
```

**Solutions:**
1. Apply quantization: `{ quantization: 'binary' }` for 32x reduction
2. Reduce cache size: `{ cacheSize: 512 }`
3. Use connection pooling
4. Clear old vectors: `await agentdb_delete(db, { filter: { deprecated: true } })`

---

### Issue 3: Slow Inserts

**Symptoms:** Insert latency >100ms per item

**Solution:**
```javascript
// ❌ Don't do this
for (const item of items) {
  await agentdb_insert(db, item.embedding, item.metadata);
}

// ✅ Do this instead
await agentdb_insert_batch(db, items);  // 141x faster
```

---

## Performance Checklist

### Configuration
- [ ] HNSW indexing enabled
- [ ] Appropriate quantization selected
- [ ] WAL mode enabled for production
- [ ] Cache size configured
- [ ] Connection pooling implemented

### Operations
- [ ] Batch operations used for bulk inserts
- [ ] Optimal k values tested and configured
- [ ] Threshold tuned for use case
- [ ] Metadata filtering implemented
- [ ] Parallel searches for multiple queries

### Monitoring
- [ ] Performance metrics collected
- [ ] Latency targets defined
- [ ] Alerts configured for degradation
- [ ] Regular profiling scheduled
- [ ] Error tracking implemented

### Optimization
- [ ] Result caching for repeated queries
- [ ] Memory budget calculated and monitored
- [ ] Regular maintenance scheduled (VACUUM, ANALYZE)
- [ ] Deprecated data removed
- [ ] Index rebuilt when needed

---

## Expected Performance Results

After applying this guide, you should achieve:

✅ **Search Latency:**
- Small datasets (<1K): <1ms
- Medium datasets (100K): <20ms
- Large datasets (1M): <10ms

✅ **Memory Efficiency:**
- 4-32x reduction with quantization
- 0.36 KB per iteration target achievable

✅ **Throughput:**
- 1000+ searches/second (medium datasets)
- 500+ inserts/second (batch operations)

✅ **Reliability:**
- <1% error rate
- Graceful degradation under load
- Zero data loss

---

## Next Steps

- ✅ Performance tuning complete
- → Read: **AgentDB Integration Patterns**
- → Implement: Production monitoring
- → Test: Performance under production load
- → Optimize: Based on real-world metrics

---

**Questions? Issues?**
- GitHub: https://github.com/ruvnet/agentic-flow/issues
- Author: Reuven Cohen (@ruvnet)

---

Last Updated: November 12, 2025
