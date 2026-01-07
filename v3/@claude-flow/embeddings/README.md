# @claude-flow/embeddings

[![npm version](https://img.shields.io/npm/v/@claude-flow/embeddings.svg)](https://www.npmjs.com/package/@claude-flow/embeddings)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/embeddings.svg)](https://www.npmjs.com/package/@claude-flow/embeddings)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Performance](https://img.shields.io/badge/Performance-<100ms-brightgreen.svg)](https://github.com/ruvnet/claude-flow)

> High-performance embedding generation module for Claude Flow V3 - multi-provider support with auto-install, LRU caching, batch processing, and similarity computation.

## Features

- **Multiple Providers** - Agentic-Flow (ONNX), OpenAI, Transformers.js, and Mock
- **Auto-Install** - Automatically installs agentic-flow when using `provider: 'auto'`
- **Smart Fallback** - Graceful fallback chain: agentic-flow → transformers → mock
- **LRU Caching** - Intelligent caching with configurable size and hit rate tracking
- **Batch Processing** - Efficient batch embedding with partial cache hits
- **Similarity Functions** - Cosine, Euclidean, and dot product metrics
- **75x Faster** - Agentic-flow ONNX is 75x faster than Transformers.js

## Performance

| Provider | Single Embed | Batch (per-item) | Notes |
|----------|--------------|------------------|-------|
| **agentic-flow** | 3ms | 2ms | ONNX SIMD, fastest |
| **transformers** | 233ms | 78ms | Good quality |
| **openai** | 50-100ms | varies | Best quality |
| **mock** | <1ms | <1ms | Testing only |
| **Cache hit** | <1ms | <1ms | All providers |

## Installation

```bash
npm install @claude-flow/embeddings
```

## Quick Start

```typescript
import { createEmbeddingService, cosineSimilarity } from '@claude-flow/embeddings';

// Create embedding service
const service = createEmbeddingService({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'text-embedding-3-small',
  dimensions: 1536,
});

// Generate embedding
const result = await service.embed('Hello, world!');
console.log(`Embedding dimension: ${result.embedding.length}`);
console.log(`Latency: ${result.latencyMs}ms`);

// Batch embed
const batchResult = await service.embedBatch([
  'First document',
  'Second document',
  'Third document',
]);
console.log(`Processed ${batchResult.embeddings.length} embeddings`);
console.log(`Cache hits: ${batchResult.cacheStats?.hits}`);

// Calculate similarity
const similarity = cosineSimilarity(
  batchResult.embeddings[0],
  batchResult.embeddings[1]
);
console.log(`Similarity: ${similarity.toFixed(4)}`);
```

### Auto Provider (Recommended)

```typescript
import { createEmbeddingServiceAsync, cosineSimilarity } from '@claude-flow/embeddings';

// Auto-select best provider (installs agentic-flow if needed)
const service = await createEmbeddingServiceAsync({
  provider: 'auto',      // Tries: agentic-flow → transformers → mock
  autoInstall: true,     // Auto-install agentic-flow if missing
});

// Generate embeddings (75x faster with agentic-flow)
const result = await service.embed('Hello, world!');
console.log(`Provider: agentic-flow, Latency: ${result.latencyMs}ms`);
```

## API Reference

### Factory Functions

```typescript
import { createEmbeddingService, getEmbedding } from '@claude-flow/embeddings';

// Create a service instance
const service = createEmbeddingService({
  provider: 'openai',
  apiKey: 'your-api-key',
  model: 'text-embedding-3-small',
  cacheSize: 1000,
});

// Quick one-off embedding
const embedding = await getEmbedding('Hello world', {
  provider: 'mock',
  dimensions: 384,
});
```

### OpenAI Provider

```typescript
import { OpenAIEmbeddingService } from '@claude-flow/embeddings';

const service = new OpenAIEmbeddingService({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'text-embedding-3-small',  // or 'text-embedding-3-large'
  dimensions: 1536,                  // Adjustable for v3 models
  baseURL: 'https://api.openai.com/v1/embeddings',
  timeout: 30000,
  maxRetries: 3,
  cacheSize: 1000,
});

const result = await service.embed('Your text here');
console.log('Tokens used:', result.usage?.totalTokens);
```

### Transformers.js Provider (Local)

```typescript
import { TransformersEmbeddingService } from '@claude-flow/embeddings';

const service = new TransformersEmbeddingService({
  provider: 'transformers',
  model: 'Xenova/all-MiniLM-L6-v2',  // Any HuggingFace model
  cacheSize: 1000,
});

// First call downloads the model
const result = await service.embed('Your text here');
console.log(`Local embedding generated in ${result.latencyMs}ms`);
```

### Mock Provider (Testing)

```typescript
import { MockEmbeddingService } from '@claude-flow/embeddings';

const service = new MockEmbeddingService({
  provider: 'mock',
  dimensions: 384,
  simulatedLatency: 10,  // Optional delay
  cacheSize: 100,
});

// Deterministic embeddings based on text hash
const result = await service.embed('Your text here');
```

### Batch Processing

```typescript
const result = await service.embedBatch([
  'Document 1: Introduction to machine learning',
  'Document 2: Deep learning fundamentals',
  'Document 3: Natural language processing',
  'Document 4: Computer vision basics',
]);

console.log('Batch Results:', {
  count: result.embeddings.length,
  totalLatency: `${result.totalLatencyMs}ms`,
  avgLatency: `${result.avgLatencyMs}ms`,
  cacheHits: result.cacheStats?.hits,
  cacheMisses: result.cacheStats?.misses,
  tokensUsed: result.usage?.totalTokens,
});
```

### Similarity Functions

```typescript
import {
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  computeSimilarity,
} from '@claude-flow/embeddings';

// Cosine similarity (most common for embeddings)
const cosine = cosineSimilarity(embedding1, embedding2);
// Returns: 0.0 to 1.0 (higher = more similar)

// Euclidean distance
const distance = euclideanDistance(embedding1, embedding2);
// Returns: 0.0 to infinity (lower = more similar)

// Dot product
const dot = dotProduct(embedding1, embedding2);
// Returns: unbounded (higher = more similar for normalized vectors)

// Generic similarity with metric selection
const result = computeSimilarity(embedding1, embedding2, 'cosine');
// Returns: { score: 0.95, metric: 'cosine' }
```

### Cache Management

```typescript
// Get cache statistics
const stats = service.getCacheStats();
console.log('Cache Stats:', {
  size: stats.size,
  maxSize: stats.maxSize,
  hitRate: `${(stats.hitRate * 100).toFixed(1)}%`,
});

// Clear cache
service.clearCache();

// Shutdown service
await service.shutdown();
```

### Event System

```typescript
// Subscribe to embedding events
service.addEventListener((event) => {
  switch (event.type) {
    case 'embed_start':
      console.log(`Starting: ${event.text.substring(0, 50)}...`);
      break;
    case 'embed_complete':
      console.log(`Completed in ${event.latencyMs}ms`);
      break;
    case 'embed_error':
      console.error(`Error: ${event.error}`);
      break;
    case 'cache_hit':
      console.log('Cache hit!');
      break;
    case 'batch_start':
      console.log(`Batch of ${event.count} started`);
      break;
    case 'batch_complete':
      console.log(`Batch completed in ${event.latencyMs}ms`);
      break;
    case 'cache_eviction':
      console.log(`Cache evicted ${event.size} entries`);
      break;
  }
});

// Remove listener
service.removeEventListener(listener);
```

## Provider Comparison

| Provider | Latency | Quality | Cost | Offline |
|----------|---------|---------|------|---------|
| **OpenAI** | ~50-100ms | Excellent | $0.02-0.13/1M tokens | No |
| **Transformers.js** | ~20-50ms | Good | Free | Yes |
| **Mock** | <1ms | N/A | Free | Yes |

### OpenAI Models

| Model | Dimensions | Max Tokens | Best For |
|-------|------------|------------|----------|
| `text-embedding-3-small` | 1536 | 8191 | General purpose, cost-effective |
| `text-embedding-3-large` | 3072 | 8191 | Highest quality |
| `text-embedding-ada-002` | 1536 | 8191 | Legacy support |

### Transformers.js Models

| Model | Dimensions | Size | Best For |
|-------|------------|------|----------|
| `Xenova/all-MiniLM-L6-v2` | 384 | 23MB | Fast, general purpose |
| `Xenova/all-mpnet-base-v2` | 768 | 110MB | Higher quality |
| `Xenova/bge-small-en-v1.5` | 384 | 33MB | Retrieval optimized |

## TypeScript Types

```typescript
import type {
  // Provider types
  EmbeddingProvider,
  EmbeddingConfig,
  OpenAIEmbeddingConfig,
  TransformersEmbeddingConfig,
  MockEmbeddingConfig,

  // Result types
  EmbeddingResult,
  BatchEmbeddingResult,

  // Service interface
  IEmbeddingService,

  // Event types
  EmbeddingEvent,
  EmbeddingEventListener,

  // Similarity types
  SimilarityMetric,
  SimilarityResult,
} from '@claude-flow/embeddings';
```

## Environment Variables

```bash
# OpenAI configuration
OPENAI_API_KEY=sk-...

# Optional: Custom base URL (for Azure OpenAI, etc.)
OPENAI_BASE_URL=https://your-endpoint.openai.azure.com/
```

## Error Handling

```typescript
try {
  const result = await service.embed('Your text');
} catch (error) {
  if (error instanceof Error) {
    if (error.message.includes('API error')) {
      // Handle API errors (rate limits, auth, etc.)
    } else if (error.message.includes('Failed to initialize')) {
      // Handle model loading errors (Transformers.js)
    }
  }
}
```

## Integration with Memory Module

```typescript
import { createEmbeddingService } from '@claude-flow/embeddings';
import { HNSWIndex } from '@claude-flow/memory';

// Create embedding service
const embeddings = createEmbeddingService({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'text-embedding-3-small',
});

// Create HNSW index
const index = new HNSWIndex({
  dimensions: 1536,
  metric: 'cosine',
});

// Index documents
const documents = ['Doc 1 content', 'Doc 2 content', 'Doc 3 content'];
const { embeddings: vectors } = await embeddings.embedBatch(documents);

vectors.forEach((vector, i) => {
  index.addPoint(`doc-${i}`, new Float32Array(vector));
});

// Search
const queryResult = await embeddings.embed('Search query');
const results = await index.search(new Float32Array(queryResult.embedding), 5);
```

## Related Packages

- [@claude-flow/memory](../memory) - HNSW indexing and vector storage
- [@claude-flow/providers](../providers) - Multi-LLM provider system
- [@claude-flow/neural](../neural) - SONA learning integration

## License

MIT
