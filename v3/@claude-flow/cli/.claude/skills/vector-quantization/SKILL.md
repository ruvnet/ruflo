---
name: vector-quantization
description: "Semantic vector search and 1-bit RaBitQ quantization over ruflo memory. Use when the user needs similarity search over stored patterns or embeddings, wants to shrink a large embedding store (~32x smaller), or asks why recall is low. Skip for exact key lookups (use memory_retrieve) or tiny stores (<1k entries), where plain search is already exact."
---

# Vector Search and Quantization

## Which layer to use

| Need | Use | Backed by |
|---|---|---|
| Search stored memories by meaning | `mcp__claude-flow__memory_search` | ONNX all-MiniLM-L6-v2 (384-dim) + HNSW |
| Store a memory with an embedding | `mcp__claude-flow__memory_store` | same |
| Compress a large store, fast approximate search | `mcp__claude-flow__embeddings_rabitq_build` then `mcp__claude-flow__embeddings_rabitq_search` | `@ruvector/rabitq-wasm` (1-bit RaBitQ + exact rerank) |
| Check what the quantized index holds | `mcp__claude-flow__embeddings_rabitq_status` | same |
| A standalone vector DB in your own code | `npm i ruvector` (`new VectorDb({ dimensions })`) | ruvector native/WASM |

## Workflow

1. Search before you build: `memory_search` with `{"query": "...", "limit": 10}`. Scores are cosine similarities; above about 0.7 is a close match for MiniLM.
2. If the store is large (tens of thousands of entries) and search is slow, build the RaBitQ index once (`embeddings_rabitq_build`), then query with `embeddings_rabitq_search`. Rebuild after bulk imports.
3. Store what worked: `memory_store` with a stable `key` and a `namespace` (for example `patterns`).

## Recall facts worth knowing

- The `@claude-flow/memory` RVF backend searches through the HNSW index in `hnsw-index.ts`. Stores of 1,000 vectors or fewer are scanned exactly (recall 1.0).
- Measured recall@10 against exact search, 5,000 random 384-dim vectors: 0.89 with HNSW (ef=200). The index it replaced scored 0.09. Real embeddings cluster, so they reach higher recall (0.99 measured on a clustered set).
- Random vectors are the worst case for any approximate index. Low recall on synthetic data does not mean real data will do as badly.

## CLI equivalents (for shells and Codex)

```bash
npx @claude-flow/cli memory search --query "auth token refresh" --limit 10
npx @claude-flow/cli memory store --key "pattern-auth" --value "JWT with refresh" --namespace patterns
npx @claude-flow/cli mcp exec -t embeddings_rabitq_status
```
