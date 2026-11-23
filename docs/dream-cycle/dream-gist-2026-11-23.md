# Memory SOTA Report — 2026-11-23

TL;DR: 2026 agent-memory research keeps converging on one theme — systems that *detect* a problem (a contradicted fact, a stale cache entry, a tombstoned vector) but never *enforce* the fix at read time. Ruflo's own `ReasoningBank` had exactly this bug: `detectContradictions()` flags the lower-quality side of a contradicting memory pair `consolidated = true` with an explicit "to exclude from retrieval" comment, but neither `retrieve()` nor `retrieveByContent()` ever checked that flag — so a memory the system itself judged stale kept being served into every future agent trajectory. Fixed tonight with a 2-line additive filter, independently corroborated by two research roles using different methods (external-literature-driven code review and pure internal code review), both converging on the same bug before either saw the other's output.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| LongMemEval's knowledge-update category checks whether the newest fact is retrieved, not whether a superseded fact is suppressed — exposing exactly this "detected but not enforced" failure class | [arXiv:2606.15903](https://arxiv.org/pdf/2606.15903) | B |
| HNSW has no native delete; production practice is tombstone-then-rebuild or neighbor-relink, both trading recall for delete cost | [arXiv:2512.18060](https://arxiv.org/html/2512.18060v1) + practitioner corroboration | B |
| Tombstoned embeddings can remain reconstructible from an HNSW/FAISS index — a privacy concern distinct from recall degradation | [arXiv:2606.18497](https://arxiv.org/pdf/2606.18497) | C |
| Scalable cache eviction in 2026 practice favors small-state, bounded-recency-window algorithms (SIEVE, S3-FIFO) over full LFU; a learned successor (S4-FIFO, OSDI '26) claims ~26% efficiency gain over S3-FIFO | [SIEVE (NSDI '24)](https://www.pdl.cmu.edu/PDL-FTP/Storage/nsdi24-SIEVE.pdf), [OSDI '26 S4-FIFO](https://www.usenix.org/system/files/osdi26-xia.pdf) | B |
| Weaviate's Engram (GA 2026-06-24) turns a hybrid-search vendor into a direct Mem0/Zep/Letta competitor — the single biggest new 2026 entrant in this space | [weaviate.io/blog/engram-generally-available](https://weaviate.io/blog/engram-generally-available) | B |
| Selective/parametric consolidation and "learned forgetting" remain open challenges for continual agent memory, distinct from TTL-sweep or similarity-dedup | [arXiv:2603.07670](https://arxiv.org/html/2603.07670) survey | B |

No credible reproduction of a "150x–12,500x"-class HNSW speedup, or of any agent-memory architecture beating LongMemEval-S by a wide reproduced margin, turned up in tonight's search — consistent with Ruflo's own docs already walking that number back to the measured ~1.9x–4.7x figure.

## Ruflo Current Capability

`@claude-flow/memory`: `CacheManager` (LRU+TTL, opt-in frequency-weighted eviction since 2026-11-18), `HybridBackend` (SQLite exact/prefix/tag + AgentDB semantic, weighted-RRF fusion), `smart-retrieval.ts` (RRF fan-out → recency decay → MMR diversity with an incrementally-cached max-similarity, not quadratic), `ControllerRegistry` (25+ lifecycle-managed controllers), `TieredMemoryStore` (Zep/Graphiti-style temporal validity), `MemoryConsolidator` (dedup + HNSW compaction). `@claude-flow/neural`'s `ReasoningBank` runs the 4-step RETRIEVE→JUDGE→DISTILL→CONSOLIDATE pipeline with HNSW-via-AgentDB retrieval, success/pitfall distillation (fixed 2026-11-17), and its own independent (older-style) MMR loop — this is where tonight's bug lives.

## Competitor Comparison

| Product | Hybrid fusion | Consolidation/distillation | Temporal/decay/causal-provenance | Confidence + source |
|---|---|---|---|---|
| Mem0 | RRF merging claimed (changelog); graph-memory time-aware pre-filtering | ADD/UPDATE/DELETE/NOOP ops | None documented beyond pre-filtering | B — mem0.ai/changelog |
| Zep | Verified: cosine+BM25+graph BFS+rerank | None (Graphiti keeps facts non-lossy) | Confirmed bi-temporal **invalidation**, not decay | A/B — arXiv:2501.13956 |
| Letta | None (editable context blocks, deliberate scope) | Official async sleep-time consolidation, ~5x less test-time compute claimed | None found | A (sleep-time) / C (reported pivot away from memory focus) |
| Weaviate | **New**: Engram (GA 2026-06-24) — managed memory on native vector+BM25 | Async dedupe/reconcile pipeline | None found; reconciliation ≠ decay | B — weaviate.io/blog |
| Qdrant | Verified: prefetch+RRF (k=60), per-prefetch weights v1.17+ | N/A (infra layer by design) | None | A — official docs |
| CrewAI | Blends semantic+recency+importance at retrieval | 5-op model incl. explicit **forget** primitive — most explicit of any framework surveyed | Recency weighting only | C — not cross-checked vs crewai.com |
| Ruflo (`@claude-flow/memory`+`@claude-flow/neural`) | RRF+MMR (memory) ahead of RRF-only competitors; ReasoningBank's own independent MMR now fixed to actually enforce its contradiction flag | dedup-only (memory); ReasoningBank distills success+pitfall but, until tonight, never enforced its own contradiction exclusion | pure LRU+TTL (opt-in frequency-weighted); TieredMemoryStore does real temporal validity | this report |

**No vendor surveyed — including Ruflo before tonight — ships a native decay-score function**; 2026's "temporal" story industry-wide is still fact-invalidation (Zep) or app-layer bolt-ons.

## Hypothesis

> Given a `ReasoningBank` holding two memories with similar embeddings (cosine > 0.8) and a quality gap > 0.4, where `consolidate()` → `detectContradictions()` has already flagged the lower-quality one `consolidated = true`, when `retrieve()` and `retrieveByContent()` are extended to filter out any `consolidated` entry from their candidate pool before scoring/ranking, then a query matching the flagged memory's content should no longer return it, subject to: byte-identical behavior for any entry never flagged (filter is a pure no-op subtraction, no reordering), zero change to `deduplicateMemories()`'s already-correct deletion path, zero change to `getStats().consolidatedMemories` counting, deterministic $0 Vitest evaluation.

Frozen before evaluation; not modified after; independently reproduced by a fresh-context adversarial critic.

## Benchmarks / Evaluation

Vitest 4.1.8, `@claude-flow/neural`, run against `src/` directly.

- **Baseline** (`git stash` isolating `reasoning-bank.ts`, new test file kept): the 2 discriminating tests fail exactly as predicted (`retrieve()`/`retrieveByContent()` both return the consolidated/contradicted memory); the 1 control test passes (no behavior for the non-flagged common case).
- **Candidate**: 3/3 new tests pass. Full package suite: **184/184** (181 pre-existing + 3 new), `tsc --noEmit -p .` clean.
- Full-suite **baseline**: 182/184 (the 2 predicted failures above), 0 unrelated regressions.
- `metaharness`/`harness mcp-scan` + `harness threat-model`: MEDIUM (3 findings, 0 high) — same 2 risky-bash-allow-rule + 13-unpinned-dep findings as every recent night, byte-identical to baseline (diff touches no `.claude/settings.json` or MCP policy surface).
- Independently reproduced from scratch by a fresh-context adversarial critic (own stash/pop cycle, own full-suite run, own `tsc` run — identical numbers). Critic also confirmed production-reachability by tracing real callers: `@claude-flow/neural/src/index.ts:375,383`, `v3/mcp/tools/hooks-tools.ts:467,566,659,756,846` (live MCP tool handlers), `@claude-flow/hooks/src/daemons/index.ts:458,494,569` (background daemon). Verdict: **CONFIRMED**, 2 non-blocking disclosed limitations — (a) the HNSW path over-fetches `retrieveK*3` candidates *before* the new filter, so if most of that over-fetched set happens to be consolidated, results can come back short of `k` even when enough valid memories exist elsewhere (pre-existing heuristic, not introduced by this fix); (b) `usedHnsw` stats counting happens before the filter, so a HNSW fetch returning only consolidated entries still counts as "used HNSW" with 0 effective candidates (cosmetic, stats-only).

## Darwin Results

**Skipped — binary guard, no tunable parameter**, same precedent as 2026-11-14 (`setMaxListeners(0)` fix). This is an additive correctness filter (apply the exclusion or don't); there is no continuous parameter space for Darwin to sweep.

## SOTA Proof & Witness

```
Session commit:   326687da9b6a442303818249bbd80444a1414cca
Candidate commit: c1401e5bc63c060929ad7994a5c0b3ef7b2c79ac
Gist SHA-256 (pre-witness): c1970e1fbc932ab1f4e2ec6a3f95a85b742975688259bfeaee5f54f5eb3ce73e
Witness stamp:    48c5020b74625b2e4c833eb0d6286a903a576cebdb1be9ad25f41635afe2f936
```
Verifier: fetch this file from the branch, replace the Witness block's three dynamic values (Candidate commit, Gist SHA-256, Witness stamp) with the literal text `PENDING`, SHA-256 the result, concatenate with the Session commit above, SHA-256 again — must equal the Witness stamp.

Evaluation receipt identity: the 3-test file `v3/@claude-flow/neural/__tests__/reasoning-bank-contradiction-exclusion.test.ts` at commit `c1401e5`. Flywheel evidence identity: this issue/PR + the independent adversarial critic's reproduction (§6). No Darwin lineage identity (Darwin skipped, §7).

## Recommended Next Steps

1. **Port the same contradiction-exclusion enforcement check into any other reader of `ReasoningBank.memories`** if one is ever added — tonight's fix covers the two current readers (`retrieve()`, `retrieveByContent()`); confirmed via grep these are the only two.
2. **Consider porting `smart-retrieval.ts`'s incrementally-cached MMR max-similarity** into `ReasoningBank`'s own independent (older-style) MMR loop — flagged by tonight's deep research as a known-good, already-proven-in-this-codebase optimization that never propagated to this sibling implementation (`O(candidates×selected)` repeated-from-scratch per round vs. the incremental cache `smart-retrieval.ts` already has). Not fixed tonight — out of scope for a single-finding night, disclosed as a strong candidate for a future `memory`/`intelligence` night.
3. **`TieredMemoryStore.hydrate()` keeps the oldest N entries per tier on restart, not the newest N** (`tiered-memory.ts`, `ORDER BY ts ASC` + a `MAX_PER_TIER` admission cap) — the opposite bias from the live `store()` eviction path, which evicts oldest-first. Only manifests for a long-running deployment whose semantic tier crosses 5000 persisted rows before a restart. Disclosed, not fixed tonight — a clean, well-isolated candidate for a near-future memory night.
