# AgentDB Getting Started Guide

**Version:** 1.3.9
**Last Updated:** November 12, 2025
**Audience:** Developers new to AgentDB
**Time to Complete:** 15-30 minutes

---

## What is AgentDB?

AgentDB is a **sub-millisecond memory engine** for AI agents that provides:

- 🚀 **150x-12,500x faster** semantic search (HNSW indexing)
- 🧠 **Intelligent memory** that learns from successes AND failures
- 🔄 **Continuous improvement** without retraining
- 💾 **Local-first** architecture (zero network latency, $0 cost)
- 🎯 **Causal reasoning** (discovers what actually causes outcomes)

**Real-World Impact:** 25% → 100% success rate in genomic cancer research, 0.59ms processing per record.

---

## Quick Start (5 Minutes)

### Option 1: Standalone AgentDB

```bash
# Install and test immediately
npx agentdb
```

This launches an interactive demo showing AgentDB capabilities.

### Option 2: With Claude Flow

```bash
# Install claude-flow with AgentDB support
npm install -g claude-flow@alpha

# Initialize
npx claude-flow init --force

# Test vector search
npx claude-flow memory vector-search "authentication patterns" --k 5
```

### Option 3: With Agentic Flow

```bash
# Install agentic-flow framework
npm install -g agentic-flow

# Use AgentDB-powered agents
npx agentic-flow --agent researcher --task "Analyze microservices"
```

---

## Installation Options

### Minimal Installation

```bash
# For testing and development
npm install agentdb

# Or with pnpm (recommended for Windows)
pnpm install agentdb
```

### Production Installation

```bash
# Full installation with native bindings
npm install agentdb better-sqlite3

# Verify installation
npx agentdb --version
```

### As Part of Claude Flow

```bash
# Claude Flow includes AgentDB as optional peer dependency
npm install claude-flow@alpha

# AgentDB auto-initializes on first use
npx claude-flow memory agentdb-info
```

---

## Your First AgentDB Operations

### 1. Initialize Database

```javascript
import { agentdb_init } from 'agentdb';

// Create or open database
const db = agentdb_init('./my-agent.db');

// In-memory mode (for testing)
const memoryDb = agentdb_init(':memory:');
```

### 2. Store Vectors

```javascript
// Generate a 384-dimensional embedding
const embedding = generateEmbedding("User authentication with OAuth2");

// Store with metadata
await agentdb_insert(db, embedding, {
  id: 'auth-001',
  text: 'User authentication with OAuth2',
  metadata: {
    domain: 'backend',
    type: 'authentication',
    confidence: 0.95
  }
});
```

### 3. Semantic Search

```javascript
// Search for similar patterns
const queryEmbedding = generateEmbedding("login system design");

const results = await agentdb_search(db, queryEmbedding, {
  k: 10,              // Return top 10 results
  threshold: 0.7,     // Minimum similarity score
  filter: {
    domain: 'backend' // Filter by metadata
  }
});

console.log(results);
// [
//   { id: 'auth-001', score: 0.89, text: '...', metadata: {...} },
//   { id: 'auth-015', score: 0.82, text: '...', metadata: {...} },
//   ...
// ]
```

### 4. Batch Operations (141x Faster)

```javascript
// Prepare batch data
const vectors = [
  { embedding: vec1, metadata: { id: 'pattern-001', ... } },
  { embedding: vec2, metadata: { id: 'pattern-002', ... } },
  // ... 98 more
];

// Insert all at once (2ms for 100 patterns)
await agentdb_insert_batch(db, vectors);
```

### 5. Delete Patterns

```javascript
// Delete by filter
await agentdb_delete(db, {
  metadata: { domain: 'deprecated' }
});

// Delete specific ID
await agentdb_delete(db, {
  id: 'auth-001'
});
```

---

## Using AgentDB with Claude Flow

### CLI Commands

```bash
# Store pattern with vector
npx claude-flow memory store-vector api_design \
  "REST API with authentication and rate limiting" \
  --namespace backend \
  --metadata '{"version":"v2","priority":"high"}'

# Semantic search
npx claude-flow memory vector-search \
  "user authentication flow" \
  --k 10 \
  --threshold 0.7 \
  --namespace backend

# Check AgentDB status
npx claude-flow memory agentdb-info

# View statistics
npx claude-flow memory stats
```

### Hybrid Mode (Default)

Claude Flow uses **hybrid mode** by default:
- New features → AgentDB (semantic search)
- Existing features → ReasoningBank (pattern matching)
- Automatic fallback if AgentDB unavailable

```javascript
// Hybrid memory adapter
import { AgentDBMemoryAdapter } from 'claude-flow/memory';

const memory = new AgentDBMemoryAdapter({
  mode: 'hybrid',  // 'hybrid', 'agentdb', or 'legacy'
  agentdbPath: '.agentdb/claude-flow.db',
  quantization: 'scalar',
  enableHNSW: true
});

await memory.initialize();
```

---

## Core Concepts

### 1. HNSW Indexing (How It's So Fast)

**HNSW = Hierarchical Navigable Small World**

Think of it like a highway system:
- **Level 0**: Local roads (all vectors)
- **Level 1**: State highways (every 10th vector)
- **Level 2**: Interstates (every 100th vector)

**Search complexity:** O(log n) instead of O(n)

**Performance:**
- Small (<1K vectors): <1ms
- Medium (100K vectors): 17ms (116x faster than linear)
- Large (1M vectors): 8ms (12,500x faster than linear)

### 2. Vector Embeddings

Embeddings convert text into 384-dimensional numbers:

```javascript
"user authentication" → [0.23, -0.41, 0.89, ..., 0.12]
                         ↑
                    384 dimensions
```

**Semantic similarity:**
```
"login system"        → [0.22, -0.39, 0.87, ...]  # 0.91 similar ✓
"authentication flow" → [0.24, -0.42, 0.88, ...]  # 0.89 similar ✓
"weather forecast"    → [-0.81, 0.34, -0.12, ...] # 0.15 similar ✗
```

### 3. Quantization (Memory Reduction)

Reduce storage by compressing vectors:

| Method | Reduction | Use Case |
|--------|-----------|----------|
| **Binary** | 32x | Large scale, speed critical |
| **Scalar** | 4x | Balanced (recommended) |
| **Product** | 8-16x | High accuracy needs |

```javascript
const db = agentdb_init('./my-agent.db', {
  quantization: 'scalar'  // Recommended default
});
```

### 4. Metadata Filtering

Filter searches by metadata tags:

```javascript
await agentdb_search(db, queryVector, {
  k: 10,
  filter: {
    domain: 'backend',
    type: 'authentication',
    version: 'v2'
  }
});
```

---

## Real-World Use Cases

### Use Case 1: Code Pattern Library

**Problem:** Reusing successful code patterns across projects

```javascript
// Store successful patterns
await agentdb_insert(db, embedding, {
  id: 'pattern-rest-auth',
  text: 'REST API authentication with JWT tokens',
  code: `
    export async function authenticate(req, res, next) {
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) return res.status(401).json({ error: 'No token' });
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
      } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
      }
    }
  `,
  metadata: {
    language: 'javascript',
    type: 'authentication',
    framework: 'express',
    success_rate: 0.95
  }
});

// Search for similar patterns
const results = await agentdb_search(db,
  generateEmbedding("API authentication middleware"),
  { k: 5, filter: { type: 'authentication' } }
);
```

### Use Case 2: Research Knowledge Base

**Problem:** Finding relevant research findings quickly

```javascript
// Store research findings
await agentdb_insert_batch(db, [
  {
    embedding: embedPaper("CRISPR gene editing efficiency study"),
    metadata: {
      id: 'paper-001',
      title: 'Improved CRISPR efficiency with modified guides',
      citation: 'Smith et al., Nature 2024',
      topic: 'genomics',
      findings: 'Modified guide RNAs increased efficiency by 40%'
    }
  },
  // ... more papers
]);

// Semantic search for relevant research
const related = await agentdb_search(db,
  generateEmbedding("improving gene editing accuracy"),
  { k: 10, filter: { topic: 'genomics' } }
);
```

### Use Case 3: Customer Support Patterns

**Problem:** Finding solutions to similar customer issues

```javascript
// Store successful support resolutions
await agentdb_insert(db, embedding, {
  id: 'support-042',
  issue: 'User unable to access dashboard after password reset',
  solution: 'Clear browser cache and session storage, then re-login',
  resolution_time: '15 minutes',
  customer_satisfaction: 5,
  metadata: {
    category: 'authentication',
    severity: 'medium',
    platform: 'web'
  }
});

// Find similar issues
const similar = await agentdb_search(db,
  generateEmbedding("login problems after password change"),
  { k: 5, filter: { category: 'authentication' } }
);
```

---

## Performance Optimization Tips

### 1. Use Batch Operations

```javascript
// ❌ Slow (100 sequential inserts = 1 second)
for (const vector of vectors) {
  await agentdb_insert(db, vector.embedding, vector.metadata);
}

// ✅ Fast (100 batch insert = 2ms)
await agentdb_insert_batch(db, vectors);
```

### 2. Enable HNSW Indexing

```javascript
// Always enable HNSW for datasets > 1,000 vectors
const db = agentdb_init('./my-agent.db', {
  enableHNSW: true  // ← Critical for performance
});
```

### 3. Choose Optimal k Value

```javascript
// ❌ Over-retrieval (slow, noisy results)
await agentdb_search(db, query, { k: 100 });

// ✅ Optimal (fast, relevant results)
await agentdb_search(db, query, { k: 10 });  // Sweet spot: 5-10
```

### 4. Use Appropriate Quantization

```javascript
// For large datasets (>100K vectors)
{ quantization: 'binary' }    // 32x reduction, fastest

// For balanced use (10K-100K vectors)
{ quantization: 'scalar' }    // 4x reduction, recommended

// For high accuracy needs (<10K vectors)
{ quantization: 'product' }   // 8-16x reduction, most accurate
```

### 5. Filter Early

```javascript
// ❌ Filter after retrieval (slow)
const all = await agentdb_search(db, query, { k: 100 });
const filtered = all.filter(r => r.metadata.domain === 'backend');

// ✅ Filter during search (fast)
const results = await agentdb_search(db, query, {
  k: 10,
  filter: { domain: 'backend' }
});
```

---

## Common Pitfalls & Solutions

### Pitfall 1: Inconsistent Embedding Dimensions

```javascript
// ❌ Problem: Mixing different embedding dimensions
await agentdb_insert(db, vector384dim, {...});  // 384 dimensions
await agentdb_insert(db, vector512dim, {...});  // 512 dimensions ← ERROR

// ✅ Solution: Use consistent embedding model
const embeddingModel = new EmbeddingModel({ dimensions: 384 });
const vec1 = embeddingModel.encode("text 1");  // Always 384
const vec2 = embeddingModel.encode("text 2");  // Always 384
```

### Pitfall 2: Not Using Metadata Effectively

```javascript
// ❌ Poor metadata (hard to filter)
{ id: 'item1', text: 'some text' }

// ✅ Rich metadata (easy to filter and organize)
{
  id: 'auth-pattern-001',
  text: 'OAuth2 authentication flow',
  domain: 'backend',
  type: 'authentication',
  language: 'javascript',
  framework: 'express',
  created: '2025-11-12',
  confidence: 0.95,
  uses: 42,
  success_rate: 0.89
}
```

### Pitfall 3: Forgetting to Normalize Vectors

```javascript
// ❌ Unnormalized vectors (similarity scores inaccurate)
const vector = [0.5, 1.2, -0.8, ...];

// ✅ Normalized vectors (magnitude = 1.0)
function normalize(vector) {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val*val, 0));
  return vector.map(val => val / magnitude);
}
const normalizedVector = normalize(vector);
```

### Pitfall 4: Ignoring Threshold Values

```javascript
// ❌ No threshold (returns irrelevant results)
const results = await agentdb_search(db, query, { k: 10 });
// Returns: [0.92, 0.87, 0.75, 0.23, 0.15, 0.08, ...]
//                               ↑ not relevant

// ✅ Appropriate threshold (filters noise)
const results = await agentdb_search(db, query, {
  k: 10,
  threshold: 0.7  // Only results with >70% similarity
});
// Returns: [0.92, 0.87, 0.75]  ← All relevant
```

---

## Next Steps

### Beginner Path
1. ✅ Complete this getting started guide
2. → Read: **AgentDB Best Practices Guide**
3. → Try: Build a simple pattern library (code snippets, docs, etc.)
4. → Experiment: Test different k values and thresholds

### Intermediate Path
1. ✅ Complete getting started
2. → Read: **AgentDB Performance Tuning Guide**
3. → Implement: ReasoningBank + AgentDB hybrid system
4. → Build: Production-ready knowledge base

### Advanced Path
1. ✅ Complete getting started
2. → Read: **AgentDB Integration Patterns Guide**
3. → Study: Causal reasoning and reflexion memory
4. → Implement: SAFLA (Self-Adaptive Feedback Loop)

---

## Resources

### Documentation
- **AgentDB Deep Dive:** Technical architecture and LinkedIn claims validation
- **AgentDB Best Practices:** Production patterns and optimization strategies
- **Performance Tuning Guide:** Benchmarking and optimization techniques

### Code Examples
- **GitHub:** https://github.com/ruvnet/agentic-flow/tree/main/packages/agentdb
- **Demo:** Meta Ads optimization with SAFLA (browser-based)
- **Integration:** Claude Flow AgentDB adapter

### Community
- **Issues:** https://github.com/ruvnet/agentic-flow/issues
- **Discussions:** https://github.com/ruvnet/claude-flow/discussions
- **Author:** Reuven Cohen (@ruvnet)

---

## Quick Reference

### Essential Commands

```bash
# Installation
npm install agentdb

# Test
npx agentdb

# With Claude Flow
npx claude-flow memory vector-search "query" --k 10
npx claude-flow memory store-vector key "text" --namespace ns
npx claude-flow memory agentdb-info
```

### Essential API

```javascript
// Initialize
const db = agentdb_init('./db.sqlite');

// Insert
await agentdb_insert(db, vector, metadata);
await agentdb_insert_batch(db, vectors);

// Search
await agentdb_search(db, queryVector, { k: 10, threshold: 0.7 });

// Delete
await agentdb_delete(db, { filter: {...} });
```

### Performance Targets

| Scale | Search Latency | Operation |
|-------|----------------|-----------|
| <1K vectors | <1ms | Single search |
| 100K vectors | 17ms | Single search |
| 1M vectors | 8ms | Single search |
| 100 patterns | 2ms | Batch insert |

---

**Congratulations!** You're now ready to use AgentDB for semantic search and intelligent memory.

**Next:** Read the [AgentDB Best Practices Guide](./agentdb-best-practices.md) to learn production patterns.
