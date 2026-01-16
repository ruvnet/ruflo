# RuVector PostgreSQL Bridge Examples

Comprehensive examples demonstrating the RuVector PostgreSQL Bridge plugin features.

## Prerequisites

- Node.js 18+
- Docker and Docker Compose
- TypeScript / ts-node

## Quick Start

### 1. Start PostgreSQL with pgvector

```bash
cd examples/ruvector
docker compose up -d
```

This starts:
- PostgreSQL 16 with pgvector extension on port 5432
- Adminer (database UI) on port 8080

### 2. Install Dependencies

```bash
# From the plugins root directory
npm install
npm run build
```

### 3. Run Examples

```bash
# Basic vector operations
npx ts-node examples/ruvector/basic-usage.ts

# Semantic code search
npx ts-node examples/ruvector/semantic-search.ts

# Attention mechanisms
npx ts-node examples/ruvector/attention-patterns.ts

# Graph neural networks
npx ts-node examples/ruvector/gnn-analysis.ts

# Hyperbolic embeddings
npx ts-node examples/ruvector/hyperbolic-hierarchies.ts

# Self-learning optimization
npx ts-node examples/ruvector/self-learning.ts

# Large-scale streaming
npx ts-node examples/ruvector/streaming-large-data.ts

# Quantization methods
npx ts-node examples/ruvector/quantization.ts

# Transaction patterns
npx ts-node examples/ruvector/transactions.ts
```

## Examples Overview

### 1. basic-usage.ts

Getting started with RuVector PostgreSQL Bridge:
- Connecting to PostgreSQL
- Creating collections with HNSW indexes
- Inserting and searching vectors
- Batch operations
- Update and delete operations

**Expected output:**
```
RuVector PostgreSQL Bridge - Basic Usage Example
================================================

1. Connecting to PostgreSQL...
   Connected successfully!

2. Creating collection "documents"...
   Collection created!

3. Inserting vectors...
   Inserted: doc-1
   ...
```

### 2. semantic-search.ts

Semantic code search implementation:
- Embedding code snippets
- Natural language queries
- Hybrid search (semantic + keyword)
- Relevance feedback / re-ranking

**Key concepts:**
- Code embeddings capture semantic meaning
- Natural language queries find relevant code
- Hybrid scoring combines multiple signals

### 3. attention-patterns.ts

Using attention mechanisms:
- Multi-head attention
- Self-attention
- Cross-attention (encoder-decoder)
- Causal attention (autoregressive)
- Flash attention simulation
- KV cache for inference

**Key concepts:**
- Different attention patterns for different use cases
- Memory and compute optimizations
- SQL generation for PostgreSQL execution

### 4. gnn-analysis.ts

Graph Neural Network analysis:
- Building code dependency graphs
- GCN (Graph Convolutional Network)
- GAT (Graph Attention Network)
- GraphSAGE for inductive learning
- Finding structurally similar modules

**Key concepts:**
- Code structure as a graph
- Learning from dependencies
- Structural similarity detection

### 5. hyperbolic-hierarchies.ts

Hyperbolic embeddings for hierarchies:
- File tree embeddings
- Class inheritance hierarchies
- Poincare ball model
- Hierarchy-aware distances

**Key concepts:**
- Hyperbolic space captures hierarchies better
- Nodes closer to origin = higher in hierarchy
- Distance reflects tree structure

### 6. self-learning.ts

Self-optimization features:
- Enabling the learning loop
- Query pattern recognition
- Auto-tuning HNSW parameters
- Anomaly detection
- EWC++ for preventing forgetting

**Key concepts:**
- Continuous learning from query patterns
- Automatic index optimization
- Pattern-based query prediction

### 7. streaming-large-data.ts

Handling large datasets:
- Streaming millions of vectors
- Backpressure handling
- Progress monitoring
- Memory-efficient processing

**Key concepts:**
- Async generators for streaming
- Semaphore-based backpressure
- Concurrent batch processing

### 8. quantization.ts

Memory optimization:
- Int8 scalar quantization (4x compression)
- Int4 scalar quantization (8x compression)
- Binary quantization (32x compression)
- Product Quantization (PQ)
- Recall vs compression trade-offs

**Key concepts:**
- Quantization reduces memory significantly
- Trade-off between compression and recall
- Different methods for different use cases

### 9. transactions.ts

ACID operations:
- Multi-vector atomic updates
- Savepoint usage
- Error recovery patterns
- Optimistic locking

**Key concepts:**
- Transactions ensure consistency
- Savepoints for partial rollbacks
- Retry with exponential backoff

## Configuration

### Environment Variables

```bash
# PostgreSQL connection
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_DB=vectors
export POSTGRES_USER=postgres
export POSTGRES_PASSWORD=postgres
```

### Docker Compose Services

| Service | Port | Description |
|---------|------|-------------|
| postgres | 5432 | PostgreSQL 16 with pgvector |
| adminer | 8080 | Database management UI |

Access Adminer at http://localhost:8080:
- System: PostgreSQL
- Server: postgres
- Username: postgres
- Password: postgres
- Database: vectors

## Troubleshooting

### Connection Refused

Ensure PostgreSQL is running:
```bash
docker compose ps
docker compose logs postgres
```

### Extension Not Found

The pgvector extension should be auto-created. Verify:
```sql
SELECT * FROM pg_extension WHERE extname = 'vector';
```

### Out of Memory

For large datasets, adjust PostgreSQL memory settings in docker-compose.yml:
```yaml
command: >
  postgres
  -c shared_buffers=512MB
  -c work_mem=32MB
```

### Slow Searches

Ensure HNSW index exists:
```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'your_table';
```

Tune search parameters:
```sql
SET hnsw.ef_search = 100;  -- Increase for better recall
```

## Performance Tips

1. **Batch inserts** for bulk loading (1000+ vectors at a time)
2. **Use HNSW indexes** for approximate nearest neighbor search
3. **Tune ef_search** based on recall requirements
4. **Consider quantization** for large datasets
5. **Use connection pooling** for concurrent access

## Cleanup

Stop and remove containers:
```bash
docker compose down

# Remove data volumes too:
docker compose down -v
```

## Resources

- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [RuVector Plugin Documentation](../../src/integrations/ruvector/README.md)
- [HNSW Algorithm Paper](https://arxiv.org/abs/1603.09320)
- [Poincare Embeddings Paper](https://arxiv.org/abs/1705.08039)
