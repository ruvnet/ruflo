# AgentDB Best Practices Guide

**Version:** 1.3.9
**Last Updated:** November 12, 2025
**Audience:** Developers building production AgentDB systems
**Prerequisites:** Complete the Getting Started Guide

---

## Table of Contents

1. [Architecture Patterns](#architecture-patterns)
2. [Data Modeling](#data-modeling)
3. [Search Optimization](#search-optimization)
4. [Memory Management](#memory-management)
5. [Production Deployment](#production-deployment)
6. [Integration with ReasoningBank](#integration-with-reasoningbank)
7. [Advanced Features](#advanced-features)
8. [Monitoring & Debugging](#monitoring--debugging)
9. [Security & Privacy](#security--privacy)
10. [Common Anti-Patterns](#common-anti-patterns)

---

## Architecture Patterns

### Pattern 1: Hybrid Memory System (Recommended)

**Use Case:** Production systems needing both semantic search AND pattern matching

```javascript
import { AgentDBMemoryAdapter } from 'claude-flow/memory';

const memory = new AgentDBMemoryAdapter({
  mode: 'hybrid',  // ← Recommended for production

  // AgentDB config (semantic search)
  agentdbPath: '.agentdb/production.db',
  quantization: 'scalar',
  enableHNSW: true,

  // ReasoningBank config (pattern matching)
  reasoningbankPath: '.swarm/memory.db',

  // Fallback behavior
  gracefulDegradation: true
});

await memory.initialize();
```

**When to use:**
- ✅ Production systems with diverse query patterns
- ✅ Migration from legacy to AgentDB
- ✅ Need 100% uptime (fallback to ReasoningBank)
- ✅ Different query types (semantic + exact match)

**Architecture:**
```
User Query
    ↓
Hybrid Router
    ├──→ Semantic query? → AgentDB (HNSW search)
    └──→ Exact match?   → ReasoningBank (SQL)
```

---

### Pattern 2: Pure AgentDB (High Performance)

**Use Case:** New projects focused on semantic search

```javascript
const memory = new AgentDBMemoryAdapter({
  mode: 'agentdb',  // ← Pure mode, no fallback
  agentdbPath: '.agentdb/production.db',
  quantization: 'scalar',
  enableHNSW: true,

  // Performance tuning
  cacheSize: 1024,      // MB for cache
  maxConnections: 10,   // Connection pool
  writeAheadLog: true   // WAL mode
});
```

**When to use:**
- ✅ New projects (no legacy data)
- ✅ Pure semantic search use cases
- ✅ Maximum performance requirements
- ✅ Willing to handle AgentDB-specific issues

---

### Pattern 3: Namespace Isolation

**Use Case:** Multi-tenant or multi-project systems

```javascript
class NamespacedMemory {
  constructor(baseMemory) {
    this.memory = baseMemory;
  }

  async store(namespace, key, value, embedding) {
    return this.memory.storeWithEmbedding(
      `${namespace}:${key}`,
      value,
      {
        embedding,
        metadata: { namespace, key, ...metadata }
      }
    );
  }

  async search(namespace, query, options = {}) {
    return this.memory.vectorSearch(query, {
      ...options,
      filter: { namespace }  // ← Isolate by namespace
    });
  }
}

// Usage
const memory = new NamespacedMemory(agentdb);
await memory.store('project-a', 'auth', data, embedding);
await memory.search('project-a', queryVec, { k: 10 });
```

**Namespace Strategy:**
```
project-a:auth:pattern-001
project-a:api:endpoint-042
project-b:auth:pattern-015
project-b:frontend:component-099
└─────┬─────┘└─┬─┘└──────┬──────┘
   namespace  type     id
```

---

## Data Modeling

### Best Practice 1: Rich Metadata Structure

**❌ Minimal Metadata (Hard to Query)**
```javascript
{
  id: 'item1',
  text: 'some code pattern'
}
```

**✅ Rich Metadata (Easy to Query & Filter)**
```javascript
{
  // Identity
  id: 'auth-oauth2-express-001',
  created: '2025-11-12T10:30:00Z',
  updated: '2025-11-12T15:45:00Z',
  version: 'v2.1.0',

  // Content
  text: 'OAuth2 authentication middleware for Express.js',
  code: '... implementation ...',
  documentation: '... usage guide ...',

  // Classification
  domain: 'backend',
  type: 'authentication',
  category: 'middleware',
  language: 'javascript',
  framework: 'express',

  // Quality metrics
  confidence: 0.95,
  success_rate: 0.89,
  usage_count: 42,
  test_coverage: 0.85,

  // Context
  tags: ['oauth2', 'jwt', 'security', 'api'],
  dependencies: ['jsonwebtoken', 'express'],
  complexity: 'medium',

  // Lifecycle
  status: 'production',
  deprecated: false,
  replacement_id: null
}
```

### Best Practice 2: Consistent ID Naming

```javascript
// Good ID patterns:
'domain-type-tech-sequence'
'backend-auth-oauth2-001'
'frontend-component-button-042'
'data-pipeline-transform-json-015'

// Benefits:
// - Self-documenting
// - Easy to search
// - Sortable
// - Hierarchical organization
```

### Best Practice 3: Versioning Strategy

```javascript
{
  id: 'api-auth-jwt-001',
  version: 'v2.1.0',
  version_history: [
    { version: 'v1.0.0', date: '2025-01-15', changes: 'Initial' },
    { version: 'v2.0.0', date: '2025-06-20', changes: 'Rewrite for performance' },
    { version: 'v2.1.0', date: '2025-11-12', changes: 'Add refresh token support' }
  ],
  supersedes: 'api-auth-jwt-v1',
  deprecated: false
}
```

---

## Search Optimization

### Best Practice 1: Optimal k Values

```javascript
// ❌ Too small (miss relevant results)
await agentdb_search(db, query, { k: 3 });

// ❌ Too large (slow, noisy results)
await agentdb_search(db, query, { k: 100 });

// ✅ Sweet spot for most use cases
await agentdb_search(db, query, { k: 10 });  // Recommended: 5-15

// ✅ For reranking pipelines
await agentdb_search(db, query, { k: 50 });  // Get candidates
const reranked = utilityBasedRerank(results);
const topResults = reranked.slice(0, 10);    // Final results
```

**Rule of Thumb:**
- **Quick lookup:** k=5
- **General search:** k=10 (recommended)
- **Comprehensive search:** k=20
- **Reranking pipeline:** k=50-100

### Best Practice 2: Threshold Tuning

```javascript
// Threshold determines minimum similarity
const results = await agentdb_search(db, query, {
  k: 10,
  threshold: 0.7  // Only return if >70% similar
});

// Threshold guidelines:
// 0.9-1.0: Nearly identical (very strict)
// 0.8-0.9: Highly similar (strict)
// 0.7-0.8: Similar (recommended default)
// 0.6-0.7: Somewhat similar (loose)
// <0.6:    Potentially irrelevant (too loose)
```

**Adaptive Thresholds:**
```javascript
function getAdaptiveThreshold(queryType, dataSize) {
  if (queryType === 'exact_match') return 0.9;
  if (queryType === 'similar_concepts') return 0.7;
  if (queryType === 'exploratory') return 0.6;

  // Lower threshold for small datasets
  if (dataSize < 100) return 0.6;

  return 0.7;  // Default
}
```

### Best Practice 3: Metadata Filtering

```javascript
// ✅ Filter early (fast - filtering happens in DB)
const results = await agentdb_search(db, query, {
  k: 10,
  filter: {
    domain: 'backend',
    language: 'javascript',
    status: 'production'
  }
});

// ❌ Filter late (slow - retrieves unnecessary data)
const all = await agentdb_search(db, query, { k: 100 });
const filtered = all.filter(r =>
  r.metadata.domain === 'backend' &&
  r.metadata.language === 'javascript' &&
  r.metadata.status === 'production'
);
```

### Best Practice 4: Query Expansion

```javascript
// Expand queries for better coverage
async function expandedSearch(db, query, options = {}) {
  const queries = [
    query,                                    // Original
    generateSynonyms(query),                  // Synonyms
    generateRelatedConcepts(query),           // Related
    generateTechnicalVariants(query)          // Tech variants
  ];

  const allResults = await Promise.all(
    queries.map(q => agentdb_search(db, embed(q), options))
  );

  // Deduplicate and merge
  return deduplicateAndScore(allResults);
}

// Example:
// Query: "authentication"
// Expanded: ["authentication", "auth", "login", "identity", "access control"]
```

---

## Memory Management

### Best Practice 1: Quantization Strategy

```javascript
// Choose based on dataset size and accuracy needs

// Small datasets (<10K vectors) - High accuracy
const db = agentdb_init('./db.sqlite', {
  quantization: 'product',  // 8-16x reduction, best accuracy
  enableHNSW: true
});

// Medium datasets (10K-100K) - Balanced
const db = agentdb_init('./db.sqlite', {
  quantization: 'scalar',   // 4x reduction, recommended default
  enableHNSW: true
});

// Large datasets (>100K) - Maximum compression
const db = agentdb_init('./db.sqlite', {
  quantization: 'binary',   // 32x reduction, fastest search
  enableHNSW: true
});
```

**Quantization Comparison:**

| Method | Reduction | Accuracy | Speed | Use Case |
|--------|-----------|----------|-------|----------|
| None | 1x | 100% | Baseline | <1K vectors |
| Product | 8-16x | ~98% | Fast | High accuracy needs |
| Scalar | 4x | ~95% | Faster | **Recommended default** |
| Binary | 32x | ~85% | Fastest | Scale >100K vectors |

### Best Practice 2: Batch Operations

```javascript
// ✅ Best: Use batch operations (141x faster)
const patterns = Array(1000).fill(null).map((_, i) => ({
  embedding: generateEmbedding(`Pattern ${i}`),
  metadata: { id: `pattern-${i}`, ... }
}));

await agentdb_insert_batch(db, patterns);
// ~7ms for 1000 inserts

// ❌ Avoid: Sequential inserts
for (const pattern of patterns) {
  await agentdb_insert(db, pattern.embedding, pattern.metadata);
}
// ~1000ms for 1000 inserts
```

### Best Practice 3: Database Maintenance

```javascript
// Periodic maintenance for optimal performance
class AgentDBMaintenance {
  constructor(db) {
    this.db = db;
  }

  // Run daily
  async dailyMaintenance() {
    await this.vacuum();         // Reclaim space
    await this.analyze();        // Update statistics
    await this.optimizeIndex();  // Rebuild HNSW if needed
  }

  // Run weekly
  async weeklyMaintenance() {
    await this.removeDeprecated();
    await this.deduplicateVectors();
    await this.updateMetadata();
  }

  async vacuum() {
    // SQLite VACUUM to reclaim space
    await this.db.execute('VACUUM');
  }

  async removeDeprecated() {
    await agentdb_delete(this.db, {
      filter: { deprecated: true, age: '>90days' }
    });
  }
}
```

### Best Practice 4: Memory Budget

```javascript
// Calculate memory requirements
function calculateMemoryBudget(numVectors, dimensions = 384, quantization = 'scalar') {
  const bytesPerFloat = 4;
  const uncompressedSize = numVectors * dimensions * bytesPerFloat;

  const compressionFactors = {
    'none': 1,
    'product': 12,
    'scalar': 4,
    'binary': 32
  };

  const compressedSize = uncompressedSize / compressionFactors[quantization];
  const indexOverhead = compressedSize * 0.1;  // HNSW ~10% overhead

  return {
    vectors: compressedSize,
    index: indexOverhead,
    total: compressedSize + indexOverhead,
    formatted: formatBytes(compressedSize + indexOverhead)
  };
}

// Example:
calculateMemoryBudget(100000, 384, 'scalar');
// {
//   vectors: 38.4 MB,
//   index: 3.84 MB,
//   total: 42.24 MB,
//   formatted: "42.2 MB"
// }
```

---

## Production Deployment

### Best Practice 1: Configuration Management

```javascript
// config/production.js
export const agentdbConfig = {
  // Database
  dbPath: process.env.AGENTDB_PATH || '.agentdb/production.db',

  // Performance
  quantization: process.env.AGENTDB_QUANTIZATION || 'scalar',
  enableHNSW: true,
  cacheSize: parseInt(process.env.AGENTDB_CACHE_MB) || 1024,

  // Reliability
  mode: 'hybrid',  // Fallback to ReasoningBank
  gracefulDegradation: true,
  maxRetries: 3,
  timeout: 5000,

  // Monitoring
  enableMetrics: true,
  metricsPort: 9090,
  logLevel: process.env.LOG_LEVEL || 'info',

  // Maintenance
  autoVacuum: true,
  vacuumInterval: '1d',
  backupEnabled: true,
  backupInterval: '6h',
  backupRetention: 7  // days
};
```

### Best Practice 2: Health Checks

```javascript
class AgentDBHealthCheck {
  constructor(db) {
    this.db = db;
  }

  async checkHealth() {
    const checks = {
      database: await this.checkDatabase(),
      performance: await this.checkPerformance(),
      storage: await this.checkStorage(),
      index: await this.checkIndex()
    };

    const healthy = Object.values(checks).every(c => c.status === 'ok');

    return {
      status: healthy ? 'healthy' : 'degraded',
      checks,
      timestamp: new Date().toISOString()
    };
  }

  async checkDatabase() {
    try {
      await this.db.execute('SELECT 1');
      return { status: 'ok', latency: '<1ms' };
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }

  async checkPerformance() {
    const start = Date.now();
    await agentdb_search(this.db, testVector, { k: 1 });
    const latency = Date.now() - start;

    return {
      status: latency < 100 ? 'ok' : 'degraded',
      latency: `${latency}ms`,
      threshold: '100ms'
    };
  }

  async checkStorage() {
    const stats = await this.db.stats();
    const usagePercent = (stats.size / stats.maxSize) * 100;

    return {
      status: usagePercent < 80 ? 'ok' : 'warning',
      usage: `${usagePercent.toFixed(1)}%`,
      size: formatBytes(stats.size)
    };
  }
}
```

### Best Practice 3: Backup Strategy

```javascript
// Automated backup system
class AgentDBBackup {
  constructor(db, config) {
    this.db = db;
    this.config = config;
  }

  async startBackupSchedule() {
    setInterval(() => this.performBackup(),
      this.config.backupInterval);
  }

  async performBackup() {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const backupPath = `${this.config.backupDir}/backup-${timestamp}.db`;

    try {
      // SQLite backup
      await this.db.backup(backupPath);

      // Verify backup
      await this.verifyBackup(backupPath);

      // Compress
      await this.compressBackup(backupPath);

      // Upload to cloud (optional)
      if (this.config.cloudBackup) {
        await this.uploadToCloud(backupPath);
      }

      // Cleanup old backups
      await this.cleanupOldBackups();

      console.log(`Backup completed: ${backupPath}`);
    } catch (error) {
      console.error('Backup failed:', error);
      // Alert monitoring system
    }
  }

  async verifyBackup(path) {
    const testDb = agentdb_init(path);
    await testDb.execute('SELECT COUNT(*) FROM vectors');
    // Backup is readable
  }

  async cleanupOldBackups() {
    const retention = this.config.backupRetention * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - retention;

    const backups = await fs.readdir(this.config.backupDir);
    for (const backup of backups) {
      const stat = await fs.stat(`${this.config.backupDir}/${backup}`);
      if (stat.mtime < cutoff) {
        await fs.unlink(`${this.config.backupDir}/${backup}`);
      }
    }
  }
}
```

### Best Practice 4: Error Handling

```javascript
class AgentDBWithRetry {
  constructor(db, config = {}) {
    this.db = db;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;
  }

  async search(query, options = {}) {
    let lastError;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await agentdb_search(this.db, query, options);
      } catch (error) {
        lastError = error;
        console.warn(`Search attempt ${attempt} failed:`, error.message);

        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelay * attempt);  // Exponential backoff
        }
      }
    }

    // All retries failed
    throw new Error(`AgentDB search failed after ${this.maxRetries} attempts: ${lastError.message}`);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

---

## Integration with ReasoningBank

### Best Practice 1: Hybrid Query Router

```javascript
class HybridMemoryRouter {
  constructor(agentdb, reasoningbank) {
    this.agentdb = agentdb;
    this.reasoningbank = reasoningbank;
  }

  async query(input, options = {}) {
    const queryType = this.detectQueryType(input);

    switch (queryType) {
      case 'semantic':
        // Use AgentDB for semantic similarity
        return this.agentdb.search(input, options);

      case 'exact':
        // Use ReasoningBank for exact pattern matching
        return this.reasoningbank.query(input, options);

      case 'hybrid':
        // Use both and merge results
        return this.mergeResults(
          await this.agentdb.search(input, options),
          await this.reasoningbank.query(input, options)
        );

      default:
        return this.agentdb.search(input, options);
    }
  }

  detectQueryType(input) {
    // Semantic queries: natural language, concepts
    if (input.match(/how|what|why|when/i)) return 'semantic';

    // Exact queries: IDs, specific names
    if (input.match(/^[a-z0-9-]+$/)) return 'exact';

    // Default to semantic
    return 'semantic';
  }

  mergeResults(agentdbResults, reasoningbankResults) {
    // Combine and deduplicate
    const combined = [...agentdbResults, ...reasoningbankResults];
    const deduplicated = this.deduplicateById(combined);

    // Re-rank by utility score
    return this.utilityBasedRerank(deduplicated);
  }

  utilityBasedRerank(results) {
    // U = α·similarity + β·uplift − γ·latency
    const α = 0.5, β = 0.3, γ = 0.2;

    return results.map(r => ({
      ...r,
      utilityScore: α * r.similarity + β * r.uplift - γ * r.latency
    })).sort((a, b) => b.utilityScore - a.utilityScore);
  }
}
```

### Best Practice 2: Data Synchronization

```javascript
// Keep AgentDB and ReasoningBank in sync
class SyncManager {
  async syncPattern(pattern) {
    // Store in both systems
    await Promise.all([
      this.storeInAgentDB(pattern),
      this.storeInReasoningBank(pattern)
    ]);
  }

  async storeInAgentDB(pattern) {
    const embedding = await this.generateEmbedding(pattern.text);
    await agentdb_insert(this.agentdb, embedding, pattern.metadata);
  }

  async storeInReasoningBank(pattern) {
    await this.reasoningbank.store(
      pattern.key,
      pattern.description,
      pattern.metadata
    );
  }

  async validateSync() {
    const agentdbCount = await this.agentdb.count();
    const reasoningbankCount = await this.reasoningbank.count();

    if (agentdbCount !== reasoningbankCount) {
      console.warn('Sync mismatch detected!');
      await this.reconcile();
    }
  }
}
```

---

## Advanced Features

### Best Practice 1: Causal Reasoning Integration

```javascript
// Store causal relationships
async function storeCausalEdge(db, action, outcome, confidence) {
  const edge = {
    id: `causal-${Date.now()}`,
    action: action,
    outcome: outcome,
    confidence: confidence,
    timestamp: new Date().toISOString()
  };

  const embedding = await generateEmbedding(
    `${action} causes ${outcome}`
  );

  await agentdb_insert(db, embedding, {
    ...edge,
    type: 'causal_edge',
    domain: 'causality'
  });
}

// Query causal relationships
async function findCauses(db, outcome) {
  const query = await generateEmbedding(`what causes ${outcome}`);

  const results = await agentdb_search(db, query, {
    k: 10,
    filter: { type: 'causal_edge' },
    threshold: 0.7
  });

  return results.map(r => ({
    action: r.metadata.action,
    confidence: r.metadata.confidence,
    similarity: r.score
  }));
}
```

### Best Practice 2: Reflexion Memory

```javascript
// Store episodes with self-critique
async function storeReflexionEpisode(db, episode) {
  const episodeData = {
    id: `episode-${Date.now()}`,
    input: episode.input,
    output: episode.output,
    reward: episode.reward,
    critique: episode.selfCritique,
    timestamp: new Date().toISOString(),
    type: 'reflexion_episode'
  };

  // Create embedding from episode context
  const embedding = await generateEmbedding(
    `${episode.input} resulted in ${episode.output}. ${episode.selfCritique}`
  );

  await agentdb_insert(db, embedding, episodeData);

  // Update confidence if pattern exists
  if (episode.reward > 0) {
    await updatePatternConfidence(db, episode.pattern_id, episode.reward);
  }
}

// Learn from past episodes
async function retrieveRelevantEpisodes(db, currentTask) {
  const query = await generateEmbedding(currentTask);

  const episodes = await agentdb_search(db, query, {
    k: 5,
    filter: { type: 'reflexion_episode' },
    threshold: 0.75
  });

  // Analyze success patterns
  const successful = episodes.filter(e => e.metadata.reward > 0);
  const failed = episodes.filter(e => e.metadata.reward <= 0);

  return {
    successful_patterns: successful,
    failures_to_avoid: failed,
    confidence: successful.length / episodes.length
  };
}
```

### Best Practice 3: Skill Library

```javascript
// Auto-consolidate successful patterns into skills
class SkillLibrary {
  constructor(db) {
    this.db = db;
  }

  async addSkill(name, implementation, metadata = {}) {
    const skill = {
      id: `skill-${Date.now()}`,
      name: name,
      implementation: implementation,
      usage_count: 0,
      success_count: 0,
      success_rate: 0,
      created: new Date().toISOString(),
      type: 'skill',
      ...metadata
    };

    const embedding = await generateEmbedding(
      `${name}: ${implementation}`
    );

    await agentdb_insert(this.db, embedding, skill);
  }

  async findSkill(task) {
    const query = await generateEmbedding(task);

    const skills = await agentdb_search(this.db, query, {
      k: 5,
      filter: { type: 'skill', success_rate: '>0.7' },
      threshold: 0.75
    });

    return skills[0];  // Best matching skill
  }

  async recordSkillUsage(skillId, success) {
    // Update usage statistics
    const skill = await this.getSkill(skillId);

    skill.usage_count++;
    if (success) skill.success_count++;
    skill.success_rate = skill.success_count / skill.usage_count;

    await this.updateSkill(skill);
  }

  async getTopSkills(limit = 10) {
    // Get most successful skills
    const allSkills = await agentdb_search(this.db, null, {
      filter: { type: 'skill' },
      k: 1000
    });

    return allSkills
      .sort((a, b) => b.metadata.success_rate - a.metadata.success_rate)
      .slice(0, limit);
  }
}
```

---

## Monitoring & Debugging

### Best Practice 1: Performance Metrics

```javascript
class AgentDBMetrics {
  constructor(db) {
    this.db = db;
    this.metrics = {
      searches: [],
      inserts: [],
      errors: []
    };
  }

  async recordSearch(query, options, duration, resultCount) {
    this.metrics.searches.push({
      timestamp: Date.now(),
      duration,
      resultCount,
      k: options.k,
      threshold: options.threshold,
      filtered: !!options.filter
    });
  }

  getAverageSearchLatency() {
    const searches = this.metrics.searches;
    if (searches.length === 0) return 0;

    const total = searches.reduce((sum, s) => sum + s.duration, 0);
    return total / searches.length;
  }

  getP95SearchLatency() {
    const searches = this.metrics.searches
      .map(s => s.duration)
      .sort((a, b) => a - b);

    const p95Index = Math.floor(searches.length * 0.95);
    return searches[p95Index] || 0;
  }

  getMetricsSummary() {
    return {
      totalSearches: this.metrics.searches.length,
      avgLatency: this.getAverageSearchLatency(),
      p95Latency: this.getP95SearchLatency(),
      errorRate: this.metrics.errors.length / this.metrics.searches.length,
      avgResultCount: this.getAverageResultCount()
    };
  }
}
```

### Best Practice 2: Debugging Tools

```javascript
// Debug wrapper for AgentDB
class AgentDBDebug {
  constructor(db, options = {}) {
    this.db = db;
    this.verbose = options.verbose || false;
    this.logFile = options.logFile;
  }

  async search(query, options = {}) {
    const start = Date.now();

    this.log('SEARCH', {
      query: query.slice(0, 10),  // First 10 dims
      options
    });

    try {
      const results = await agentdb_search(this.db, query, options);
      const duration = Date.now() - start;

      this.log('SEARCH_RESULT', {
        duration: `${duration}ms`,
        resultCount: results.length,
        topScores: results.slice(0, 3).map(r => r.score)
      });

      return results;
    } catch (error) {
      this.log('SEARCH_ERROR', { error: error.message });
      throw error;
    }
  }

  log(event, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      data
    };

    if (this.verbose) {
      console.log(JSON.stringify(entry, null, 2));
    }

    if (this.logFile) {
      fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
    }
  }
}
```

---

## Security & Privacy

### Best Practice 1: Access Control

```javascript
class SecureAgentDB {
  constructor(db, accessControl) {
    this.db = db;
    this.accessControl = accessControl;
  }

  async search(user, query, options = {}) {
    // Check permissions
    if (!this.accessControl.canRead(user, options.namespace)) {
      throw new Error('Access denied');
    }

    // Filter by accessible namespaces
    const accessibleNamespaces = this.accessControl.getAccessibleNamespaces(user);
    options.filter = {
      ...options.filter,
      namespace: { $in: accessibleNamespaces }
    };

    return agentdb_search(this.db, query, options);
  }

  async insert(user, embedding, metadata) {
    if (!this.accessControl.canWrite(user, metadata.namespace)) {
      throw new Error('Access denied');
    }

    // Add audit trail
    metadata.created_by = user.id;
    metadata.created_at = new Date().toISOString();

    return agentdb_insert(this.db, embedding, metadata);
  }
}
```

### Best Practice 2: Data Encryption

```javascript
// Encrypt sensitive data before storage
class EncryptedAgentDB {
  constructor(db, encryptionKey) {
    this.db = db;
    this.cipher = createCipher(encryptionKey);
  }

  async insert(embedding, metadata) {
    // Encrypt sensitive fields
    if (metadata.sensitive_data) {
      metadata.sensitive_data = this.cipher.encrypt(metadata.sensitive_data);
      metadata.encrypted = true;
    }

    return agentdb_insert(this.db, embedding, metadata);
  }

  async search(query, options = {}) {
    const results = await agentdb_search(this.db, query, options);

    // Decrypt sensitive fields
    return results.map(r => {
      if (r.metadata.encrypted) {
        r.metadata.sensitive_data = this.cipher.decrypt(r.metadata.sensitive_data);
      }
      return r;
    });
  }
}
```

---

## Common Anti-Patterns

### Anti-Pattern 1: Over-Reliance on Defaults

```javascript
// ❌ Not configuring for your use case
const db = agentdb_init('./db.sqlite');

// ✅ Configure appropriately
const db = agentdb_init('./db.sqlite', {
  quantization: 'scalar',           // For your dataset size
  enableHNSW: true,                 // For performance
  cacheSize: calculateOptimalCache(), // Based on available memory
  writeAheadLog: true               // For reliability
});
```

### Anti-Pattern 2: Ignoring Metadata

```javascript
// ❌ Minimal metadata (hard to query later)
await agentdb_insert(db, embedding, { id: 'item1' });

// ✅ Rich metadata (flexible querying)
await agentdb_insert(db, embedding, {
  id: 'auth-pattern-001',
  domain: 'backend',
  type: 'authentication',
  tags: ['oauth2', 'jwt'],
  created: new Date().toISOString(),
  confidence: 0.95
});
```

### Anti-Pattern 3: No Error Handling

```javascript
// ❌ No error handling
const results = await agentdb_search(db, query, { k: 10 });

// ✅ Proper error handling
try {
  const results = await agentdb_search(db, query, { k: 10 });
  return results;
} catch (error) {
  console.error('Search failed:', error);

  // Fallback strategy
  if (this.reasoningbank) {
    return this.reasoningbank.query(pattern);
  }

  return [];
}
```

### Anti-Pattern 4: Not Using Batches

```javascript
// ❌ Sequential inserts (1000ms for 1000 items)
for (const item of items) {
  await agentdb_insert(db, item.embedding, item.metadata);
}

// ✅ Batch insert (7ms for 1000 items)
await agentdb_insert_batch(db, items);
```

### Anti-Pattern 5: No Maintenance

```javascript
// ❌ Never maintaining database
// Database grows, performance degrades, space wasted

// ✅ Regular maintenance
setInterval(async () => {
  await db.vacuum();              // Daily
  await db.analyze();             // Daily
  await db.removeDeprecated();    // Weekly
}, 24 * 60 * 60 * 1000);          // Every 24 hours
```

---

## Checklist: Production Readiness

### Configuration
- [ ] Appropriate quantization selected
- [ ] HNSW indexing enabled
- [ ] Cache size configured
- [ ] Timeouts set appropriately
- [ ] Error handling implemented
- [ ] Retry logic added

### Data Quality
- [ ] Rich metadata structure defined
- [ ] ID naming convention established
- [ ] Versioning strategy implemented
- [ ] Data validation rules created
- [ ] Deduplication strategy in place

### Performance
- [ ] Batch operations used
- [ ] Optimal k values tested
- [ ] Thresholds tuned for use case
- [ ] Metadata filtering implemented
- [ ] Performance metrics collected

### Reliability
- [ ] Health checks implemented
- [ ] Backup strategy configured
- [ ] Disaster recovery tested
- [ ] Graceful degradation enabled
- [ ] Monitoring alerts configured

### Security
- [ ] Access control implemented
- [ ] Sensitive data encrypted
- [ ] Audit logging enabled
- [ ] API rate limiting added
- [ ] Security review completed

---

## Next Steps

- ✅ You've mastered AgentDB best practices
- → Read: **AgentDB Performance Tuning Guide**
- → Explore: **AgentDB Integration Patterns**
- → Implement: Production deployment checklist
- → Share: Your patterns with the community

---

**Questions? Feedback?**
- GitHub Issues: https://github.com/ruvnet/agentic-flow/issues
- Author: Reuven Cohen (@ruvnet)

---

Last Updated: November 12, 2025
