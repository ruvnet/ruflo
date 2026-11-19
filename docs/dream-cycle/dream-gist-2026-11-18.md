# Memory SOTA Report — 2026-11-18

TL;DR: a Feb-2026 paper (HTM-EAR, arXiv:2603.10032) shows pure-LRU eviction catastrophically drops high-value, high-frequency entries under skewed access. Ruflo's `@claude-flow/memory` `CacheManager` is pure LRU+TTL with no importance/frequency signal, even though `CachedEntry.accessCount` already tracks exactly the data needed. Tonight ships an opt-in, Darwin-tuned frequency-aware eviction blend (`frequencyWeight`, default 0 = byte-identical to today) with a real evaluation receipt and a 3-generation parameter sweep.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| LongMemEval-V2 extends long-term memory eval to agentic/web tasks; best system 72.5% vs. 48.5% RAG baseline, oracle ceiling 86-90% | arXiv preprint + public leaderboard, May 2026 | B |
| Naive/frequent memory consolidation degrades utility *below* a no-memory baseline (GPT-5.4 failed 54% of ARC-AGI problems it solved without memory, after consolidating) | arXiv:2605.12978, May/Aug 2026 | B |
| **HTM-EAR**: importance+usage-weighted eviction vs. LRU — LRU permanently discarded 2,416 "essential" facts of 15K on a BGL log corpus; MRR 0.069 (LRU) vs 0.336 (HTM-EAR) | arXiv:2603.10032, Feb 2026 | B |
| MemX: hybrid dense+sparse fusion via RRF (not MMR); Hit@5 51.6%, temporal reasoning still weak | arXiv:2603.16171, ~Mar 2026 | B |
| Provenance/lineage becoming a required trust layer for memory writes/reads, not just an audit afterthought | arXiv:2606.04990 (survey) + MAP-Graph, Jun 2026 | B |
| FadeMem: per-layer exponential decay forgetting, claims 45% storage reduction | arXiv:2601.18642, Jan 2026 | **C** — baseline for the 45% figure unstated; not used to justify tonight's candidate |

No numeric claim above came from training-data recall; all are from the cited 2026 sources. Ruflo's own internal "150x-12,500x HNSW speedup" figure (CLAUDE.md) could not be found in any external 2026 source and should continue to be treated as unverified/internal-only, consistent with the repo's own audit doc.

## Ruflo Current Capability

`@claude-flow/memory`'s hot paths (hybrid-RRF+MMR fusion, controller lifecycle, LRU cache mechanics) are heavily hardened from many prior nightly passes — dense with changelog-style comments documenting NaN/negative-weight guards, deterministic tie-breaks, embedding-cosine MMR, etc. `CacheManager` specifically: pure LRU+TTL, zero importance/frequency signal in eviction despite `CachedEntry.accessCount`/`lastAccessedAt` already being tracked on every entry — exactly the gap HTM-EAR documents.

## Competitor Comparison

| Product | Hybrid fusion | Consolidation/distillation | Temporal/decay | Provenance/audit |
|---|---|---|---|---|
| Mem0 | unverified (no RRF doc found) | ADD/UPDATE/DELETE/NOOP ops (verified) | unverified (LRU/time-decay claimed by secondary source only) | None found |
| Zep | verified — cosine+BM25+graph BFS+rerank | None (entity/community summarization, not strategy distillation) | bi-temporal **invalidation**, not decay (deliberate design choice) | partial (bi-temporal ingestion timestamps) |
| Letta | None found | background consolidation (official) | None found | unofficial only (community-documented edit log) |
| ReasoningBank | N/A (not a retrieval system) | core strength — LLM-judge success/failure distillation (ICLR 2026) | None found | None found |
| Qdrant | verified — prefetch+RRF, version-gated weights | N/A (infra layer, by design) | unverified (payload-timestamp filtering only, no decay score) | None found |
| Ruflo (`@claude-flow/memory`) | **ahead of MemX** — RRF+MMR diversity together (`smart-retrieval.ts`) | dedup-only (embedding-cosine near-dup, ≥0.95) — no decay/gated consolidation | **gap** — pure LRU+TTL only (tonight's candidate) | `source:` tags for rerank provenance, not a trust/audit layer |

None of the scanned products publish a benchmark combining weighted hybrid fusion *and* MMR diversity *and* provenance together — a real, not solved-and-hidden, differentiation gap worth a future deep-research pass.

## Hypothesis

> Given a `CacheManager` under size/memory pressure with a skewed access pattern (an entry accessed many times historically but not most-recently, sitting near the LRU tail while rarely-touched entries occupy more recent positions), when eviction is extended with an opt-in, continuous `frequencyWeight` (0-1, default 0) blending recency-rank with normalized `accessCount` over a bounded scan window (`evictionScanWindow`, default 32) — falling back to the exact original tail-eviction when `frequencyWeight` is 0/unset — then a high-access-count entry should survive eviction under `frequencyWeight>0` where pure LRU would evict it, subject to: byte-identical default behavior, zero change to TTL/`maxMemory` accounting, deterministic $0 Vitest evaluation.

Frozen before evaluation; not modified after.

## Benchmarks

New corpus `.harness/bench-memory-eviction-2026-11-18.json` (6 synthetic Zipfian-skewed-access tasks, seeded/deterministic, 3 skew levels) + driver `scripts/bench-cache-eviction.mts`. Metric: fraction of the true top-decile most-accessed keys ("golden") still resident after a trace replay, plus ops/sec. **Corpus-fairness caveat (disclosed, not resolved tonight):** this corpus was authored tonight by the same session evaluating tonight's candidate, and has not yet been run against an unrelated weak candidate to prove it has teeth — flagged for a future night, not blocking since the unit-test-level evidence below is independent of this corpus.

## Evaluation

Real Vitest evaluator, stash-isolated. Baseline: 718/719 pass (1 pre-existing unrelated environmental chmod-as-root failure, consistent with every prior night). Candidate: 722/723 (718 + 4 new discriminating tests), same 1 pre-existing failure, `tsc --noEmit` clean both ways. Baseline fails exactly 1 of the 4 new tests as predicted (the one requiring non-LRU behavior); the other 3 pass vacuously on baseline since it ignores the new config. Independently reproduced by a fresh-context adversarial critic (separate stash/pop cycle), verdict **CONFIRMED**, no blocking issues.

## Darwin Results

Repository-local bounded sweep (native `metaharness evolve --bench` unavailable — unbuilt `@claude-flow/swarm` dist, pre-existing on main). 3 generations × 4 candidates, fitness = 0.35·quality + 0.20·success_rate + 0.15·latency + 0.10·cost_efficiency + 0.10·reproducibility + 0.10·safety (frozen before the sweep ran). Baseline fitness 0.825. Winner: **`frequencyWeight=0.85, evictionScanWindow=32`**, fitness 0.851, mean essential-key retention +19.4pp over baseline, 0/6 tasks regressed, ~5% throughput overhead. Notably `frequencyWeight=1.0` (full HTM-EAR-style, no recency at all) *underperforms* the baseline (fitness 0.794, regresses 1/6 tasks) — a genuine interior optimum, not a monotonic "more is better" result. This is evidence for operators who opt in; **the shipped default stays 0 (unchanged behavior)** — no autonomous promotion of a new default. Lineage persisted at `.harness/darwin-lineage-2026-11-18.json`.

## SOTA Proof & Witness

See issue and PR for the full receipt.

```
Session commit:   edf7ddb3fefa15bca87986225b5a5ef7d4d059e5
Candidate commit: 7466cb8cc358bd91be56f10e7ff73c3f97d8a93a
Gist SHA-256 (pre-witness): b0776589b040ffd5d7ac8a5df306c1196fdf3b05690170a91257dccf94a979fb
Witness stamp:    8e6a4d8e961e20331a1540bb8c82cd354e3e7ca15d2805396b1de0e9774656ed
```
Verifier: fetch this file from the branch, replace the Witness block's three dynamic values (Candidate commit, Gist SHA-256, Witness stamp) with the literal text `PENDING`, SHA-256 the result, concatenate with the Session commit above, SHA-256 again — must equal the Witness stamp.

## Recommended Next Steps

1. If an operator wants frequency-aware eviction in production, set `frequencyWeight: 0.85` (or close to it) on the relevant `CacheManager`/`TieredCacheManager` config — validated by tonight's sweep, not yet a default.
2. A future DEEP=automation night should audit *every* worker type (`map`, `optimize`, `consolidate`, `testgaps`, `benchmark`) for the "claims work with no executor" anti-pattern — 3 confirmed+fixed instances across 2 prior nights (MCP dispatch tool, worker-detect, daemon audit worker) suggest a systemic class, not isolated bugs.
3. A future deep-research pass should explore whether Ruflo's RRF+MMR fusion can be paired with a provenance/audit layer (MAP-Graph-style lineage gating) — no scanned competitor ships that combination, a genuine open differentiation gap rather than a solved-and-hidden one.

## SCAN: plugins

- `PluginStoreConfig` security defaults (`requireSecurityAudit`, `minTrustLevel`, `trustedAuthors`, `blockedPlugins`, `allowedPermissions`, `requirePermissionPrompt`) still never read anywhere outside their declaration/default sites (confirmed unfixed since 2026-10-13).
- `SecurityPolicy.minTrustLevelForSpawn` — **fixed** 2026-10-31 via PR #4619 (merged); one disclosed caveat (`claim-event`/`agent-handoff` message types still unreachable under default `allowedMessageTypes`) remains open, not new.
- `code-intelligence` dead config knobs (`search.defaultTopK/similarityThreshold`, `architecture.maxGraphDepth/includeVendor`, `refactoring.defaultDepth`) — confirmed still unfixed.
- **New**: `@claude-flow/plugins` security SDK's `ResourceLimits` (`src/security/index.ts:497-550`) declares/defaults/accepts overrides for 5 fields, but `check()` only ever evaluates `maxMemoryMB` — `maxCPUPercent`, `maxFileSize`, `maxOpenFiles` are dead. Zero in-repo callers today, but it's a public SDK export (`Security` namespace) — live-but-broken for any external plugin author who adopts the documented contract. Deferred.

## SCAN: automation

- The "worker claims completed/scanned work it never performed" anti-pattern (3 instances across 2026-10-13 and 2026-10-28, two different components) is now **fully fixed** with regression tests (#4196, #4549×2) — confirmed by direct source inspection tonight.
- `hooks worker dispatch --priority` remains a confirmed **dead flag**: accepted end-to-end (CLI → MCP tool → queue JSON) but `drainDispatchQueue()` never reads it and iterates queue files in raw `readdirSync` order. Still unfixed since 2026-11-13. Deferred — same root cause class as the fixed findings above, recommended as a future candidate.

## Ledger note

`docs/dream-cycle/LEDGER.md` has no rows for 2026-11-12/13/14/16/17 even though real branches/issues/PRs exist for all five nights (#4973, #4983, #4989, #5004, #5012 — all open drafts, STEP 25 just wasn't reached or merged to main). This is a backfill gap, not a pipeline failure — direct evidence (branches + PRs) confirms the pipeline ran every one of those nights. Tonight's row is appended on top; backfilling the gap is left for a future, lower-stakes pass since it's cosmetic, not a trust issue.
