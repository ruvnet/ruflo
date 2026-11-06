---
name: vector-quantization
description: >
  Semantic vector search over ruflo memory, plus 1-bit RaBitQ quantization (@ruvector/rabitq-wasm) for large embedding stores.
  Use when: similarity search over stored patterns, shrinking a large embedding store, diagnosing low recall.
  Skip when: exact key lookups, stores under ~1k entries (search is already exact there).
---

# Vector Quantization Skill

## Purpose
Find stored knowledge by meaning (ONNX MiniLM 384-dim embeddings + HNSW), and compress big stores about 32x with RaBitQ while keeping recall through exact rerank.

## When to Trigger
- you need "something like X" from memory before starting work
- the embedding store is large and search is slow
- recall looks wrong and you need to know why

## When to Skip
- you know the exact key (use `memory retrieve`)
- very small stores

## Commands

### Semantic search
```bash
npx @claude-flow/cli memory search --query "auth token refresh" --limit 10
```

### Store a pattern with its embedding
```bash
npx @claude-flow/cli memory store --key "pattern-auth" --value "JWT with refresh" --namespace patterns
```

### Build and query the RaBitQ index
```bash
npx @claude-flow/cli mcp exec -t embeddings_rabitq_build
npx @claude-flow/cli mcp exec -t embeddings_rabitq_search -p '{"query":"auth token refresh","k":10}'
npx @claude-flow/cli mcp exec -t embeddings_rabitq_status
```

## Recall Facts
- The @claude-flow/memory RVF backend searches through its HNSW index (`hnsw-index.ts`). Stores of 1,000 vectors or fewer are scanned exactly.
- Measured recall@10 on 5,000 random 384-dim vectors: 0.89 (HNSW, ef=200). The index it replaced scored 0.09. Clustered data, like real embeddings, measured 0.99.

## Best Practices
1. Search before building anything new
2. Rebuild the RaBitQ index after bulk imports
3. Use one namespace per concern so results stay relevant
