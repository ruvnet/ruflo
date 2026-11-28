# Memory SOTA Report — 2026-11-28

TL;DR: In 2026, mainstream agent-memory stacks (Qdrant, Weaviate's new Engram, LangGraph, AutoGen, CrewAI) still treat eviction as a storage-layer TTL concern and contradiction/consolidation as either an application concern or an unsolved problem — nobody ships frequency-weighted eviction or causal/provenance-aware recall as a first-class primitive, which is exactly the direction Ruflo's `@claude-flow/memory` moved in on 2026-11-13/11-18. Tonight's DEEP=memory research surfaced a concrete, dated correctness gap in Ruflo's own `ReasoningBank.detectContradictions()` (cosine-similarity-plus-quality-gap cannot reliably separate a contradiction from a near-duplicate, per arXiv:2606.26511, Jun 2026) as the strongest *new* research-driven candidate — but tonight's actual shipped patch is a smaller, cross-confirmed-by-two-independent-roles fix: `CacheManager.clear()`'s `previousSize` event field, disclosed and left unfixed across four prior nights (2026-10-27, 11-02, 11-16, and reconfirmed tonight).

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Per-query adaptive HNSW `ef` (vs. one static value) cuts query latency up to 4x | SIGMOD 2026 ("Ada-ef") | A |
| Quantization + re-ranking gets 2.5–3.3x QPS over SOTA HNSW at >98% recall | DAC 2026 (AQR-HNSW, arXiv preprint) | A |
| Cosine similarity cannot reliably distinguish a semantic contradiction from a near-duplicate (a single value-flip is a minimal embedding edit) | arXiv:2606.26511, Jun 2026 | B |
| SOLAR: a cache policy for agent retrieval buffers with constant competitive ratio ≤3 vs. Ω(K) for FIFO | arXiv:2607.00394, Jul 2026 | B |
| Weaviate's "Engram" managed agent-memory service (hard + soft multi-tenant isolation scopes) reached GA | Weaviate GA materials, 2026-06-24 | B |
| OpenAI retired the Assistants API in favor of Responses + a standalone Conversations object; still ships no native cross-session semantic memory | OpenAI developer docs, 2026-08-26 | B |
| CrewAI collapsed its legacy 4-type memory model into one LLM-scored `Memory` class with hierarchical scopes | docs.crewai.com (current) | B |

## Ruflo Current Capability

`@claude-flow/memory`'s `CacheManager` is a pure LRU+TTL+memory-pressure cache with an opt-in frequency-weighted eviction blend added 2026-11-18 (default off, byte-identical to pure LRU). `controller-registry.ts` wired a previously-dead `causalRecall` controller on 2026-11-13; it still has zero production call sites. `@claude-flow/neural`'s `ReasoningBank` runs an O(n²) cosine-similarity scan for both deduplication (`>0.95`) and contradiction detection (`cosine>0.8 AND |quality gap|>0.4`) over an in-process `Map` of raw `Float32Array` embeddings — it never reuses the mature `Quantizer`/HNSW machinery that already exists one package over. `hnsw-index.ts`'s query-time `ef` is a single static value, no per-query adaptivity.

Tonight's shipped fix: `CacheManager.clear()` (`cache-manager.ts:218-224`) called `this.cache.clear()` and only then read `this.cache.size` for the `cache:cleared` event's `previousSize` field — always `0`. No listener currently consumes this event in-tree, so the bug was real but inert; it is nonetheless the kind of "declared-but-wrong" metric this ledger has flagged as worth closing once it recurs 3+ times without action.

## Competitor Comparison

| System | Memory/caching/consolidation feature | Grade |
|---|---|---|
| Qdrant | Explicitly scopes contradiction/conflict handling to the application, not the index — a stated design choice | B |
| Weaviate | "Engram" managed memory service, GA 2026-06-24, hard+soft multi-tenant scopes; disk-resident `HFresh` index for low-memory billion-scale recall (v1.38, 2026-06-25) | B |
| Milvus | Collection-level TTL, per-entity TTL in 3.0 (3.0 "lake-native" claim single-source, unconfirmed) | B/C |
| LangGraph | Cross-thread `Store` + checkpointing; no native conflict/contradiction logic, left to app code | B |
| AutoGen | `Teachability`/typed `Memory` protocol stores vector "memos"; no native contradiction handling found | B |
| CrewAI | Unified LLM-scored `Memory` class (replaced the old 4-type model), LanceDB-backed per vendor comparison | B |
| OpenAI Agents SDK | `Sessions` = history only; memory explicitly out of scope, third parties (Mem0) fill the gap | B |

No competitor in this set ships a documented frequency-weighted eviction policy or a causal/provenance-aware recall primitive — this reads as a genuine, narrow, unexplored-as-a-product-feature gap (the underlying patterns exist in practitioner blog posts, not as a first-class API in any reviewed framework or vector DB), not something deliberately avoided for a stated failure mode.

## Hypothesis

Given a workload that calls `CacheManager.clear()` and listens for its `cache:cleared` event, when `clear()` is fixed to capture `this.cache.size` before calling `Map.clear()`, then the emitted `previousSize` field should report the actual pre-clear size instead of an always-0 value, subject to: no change to `clear()`'s synchronous emptying behavior or field/event ordering elsewhere in the file, no regression in `@claude-flow/memory`'s existing suite, and the fix must be structurally a no-op for every other method.

## Benchmarks

Not applicable in the synthetic-corpus sense — this is a pure correctness fix with no tunable numeric parameter and no quality/latency/cost metric to benchmark. The real evaluator is `@claude-flow/memory`'s own vitest suite (stash-isolated baseline vs. candidate), consistent with several recent correctness-only Dream Cycle nights (11-14, 11-23, 11-24, 11-26) that also skipped a synthetic `.harness/bench-*.json` corpus for this class of change.

## Evaluation

3 new tests (1 discriminating, 2 controls) in `cache-manager-clear-event.test.ts`. Stash-isolated baseline: 1/3 fail exactly as predicted (`previousSize` reports `0` instead of `3`). Candidate: 3/3 pass. Full `@claude-flow/memory` suite: 748/749 baseline → 751/752 candidate (exactly +3, 0 regressions), same 1 pre-existing environmental chmod-as-root failure (root can write "read-only" files) byte-identical both ways. `tsc --noEmit` clean both ways.

## Darwin Results

Skipped — binary correctness guard, no tunable parameter to evolve (consistent precedent: 11-14/11-23/11-24/11-25/11-26/11-27).

## SOTA Proof & Witness

See Witness section in the linked issue/PR for the session-commit-bound witness stamp, computed from this gist's final SHA256.

## Recommended Next Steps

1. Pick up `ReasoningBank.detectContradictions()`'s cosine-similarity-cannot-distinguish-contradiction-from-duplicate gap (arXiv:2606.26511) on a future memory night — externally grounded, real correctness gap, not yet touched by 11-13 or 11-18's memory work. Scored 3.85 tonight, second-highest of 5 scored candidates.
2. Wire `LearningBridge.decayConfidences()` into `AutoMemoryBridge`'s existing periodic sync tick (or correct the README's claim that it runs) — fully implemented and tested but has zero production callers today, so documented confidence-decay behavior silently never happens. Flagged by tonight's architecture reviewer, not fixed tonight (behavior change, deserves its own review cycle).
3. A SCAN=plugins finding tonight scored higher (4.3) than this DEEP candidate on the same rubric: `code-intelligence` plugin's `validatePath()` containment check is a no-op under its own shipped default config (`allowedRoots: ['.']` defeats the check for any absolute path), giving 4 of its MCP tool handlers effectively unrestricted file-read. Not promoted over tonight's memory DEEP (it's a non-bundled optional plugin, not core/security-bundled surface, and overriding DEEP would under-deliver on tonight's rotation) — flagged explicitly here so it is not buried; strong candidate for a security or plugins-focused night.
