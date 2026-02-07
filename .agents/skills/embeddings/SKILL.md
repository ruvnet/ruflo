---
name: embeddings
description: >
  Vector embeddings with HNSW indexing, sql.js persistence, and hyperbolic support. 75x faster with agentic-flow integration.
  Use when: semantic search, pattern matching, similarity queries, knowledge retrieval.
  Skip when: exact text matching, simple lookups, no semantic understanding needed.
---

# Embeddings Skill

## Purpose
Vector embeddings for semantic search and pattern matching with HNSW indexing.

## Features

| Feature | Description |
|---------|-------------|
| **sql.js** | Cross-platform SQLite persistent cache (WASM) |
| **HNSW** | 150x-12,500x faster search |
| **Hyperbolic** | Poincare ball model for hierarchical data |
| **Normalization** | L2, L1, min-max, z-score |
| **Chunking** | Configurable overlap and size |
| **75x faster** | With agentic-flow ONNX integration |

## Commands

### Initialize Embeddings
```bash
npx claude-flow embeddings init --backend sqlite
```

### Embed Text
```bash
npx claude-flow embeddings embed --text "authentication patterns"
```

### Batch Embed
```bash
npx claude-flow embeddings batch --file documents.json
```

### Semantic Search
```bash
npx claude-flow embeddings search --query "security best practices" --top-k 5
```

## Memory Integration

```bash
# Store with embeddings
npx claude-flow memory store --key "pattern-1" --value "description" --embed

# Search with embeddings
npx claude-flow memory search --query "related patterns" --semantic
```

## Quantization

| Type | Memory Reduction | Speed |
|------|-----------------|-------|
| Int8 | 3.92x | Fast |
| Int4 | 7.84x | Faster |
| Binary | 32x | Fastest |

## Best Practices
1. Use HNSW for large pattern databases
2. Enable quantization for memory efficiency
3. Use hyperbolic for hierarchical relationships
4. Normalize embeddings for consistency
