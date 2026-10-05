# Performance SOTA Report — 2026-10-05

TL;DR: Tonight's `performance` deep-dive fixes an O(limit² × N) → O(limit × N) complexity bug in `mmrRerank()` (`v3/@claude-flow/memory/src/smart-retrieval.ts`), the MMR diversity-reranking step used by `smartSearch()`/`applyMMR()`. For every outer round, the function rescanned the *entire* already-selected set from scratch to find each remaining candidate's max similarity-to-selected. Research confirmed this is the same inefficiency shipped in LangChain core's `maximal_marginal_relevance` and Elastic's published MMR reference implementation (direct source inspection, both recompute from scratch). The fix caches a running max-similarity-to-selected per remaining candidate, updated each round only against the newest selected item — mathematically exact, since `max` over a monotonically growing set equals `max(running_max, sim_to_newest)` regardless of sign. Measured speedup: 2.2x at N=40/limit=25, growing to 28.6x at N=300/limit=150, and 16.1x at N=200/limit=100 (362.6ms → 22.6ms) — the *growing ratio* is the complexity-class proof, not just a constant-factor win.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| LangChain core's `maximal_marginal_relevance` (`libs/core/langchain_core/vectorstores/utils.py`) recomputes similarity-to-selected from scratch every round — same O(k²N) shape as Ruflo's pre-fix code | Direct GitHub source read, `langchain-ai/langchain` | A |
| Elastic's own published reference MMR implementation uses the identical recompute-from-scratch pattern; their stated mitigation is capping candidate-pool depth, not caching | Elastic Search Labs blog, "Diversifying search results with Maximum Marginal Relevance" | B |
| `pyversity` (standalone diversification library) explicitly advertises O(k·n·d) complexity for its MMR strategy — the optimized bound an incremental cache achieves, consistent with (though not confirmed at the source level to use) a running-max-style technique | pyversity project README | B |
| Weaviate 1.37–1.39's native `Diversity.MMR` reranker and Qdrant's native MMR query describe MMR's *behavior* but don't disclose their internal loop structure | Weaviate/Qdrant docs | C |
| No SIGIR/SIGMOD/VLDB/NeurIPS paper specifically analyzes MMR's O(k²N)-vs-O(kN) *implementation* cost — Carbonell & Goldstein's original 1998 SIGIR paper defines the MMR criterion but not its computational complexity; a 2024 complexity paper (arXiv:2407.04573) proves the underlying joint similarity+diversity optimization problem is NP-complete, but that's about the heuristic's approximation quality, not this engineering-level optimization of the greedy heuristic itself | arXiv:2407.04573 (2024); Carbonell & Goldstein, SIGIR '98 | A |

This is a genuine, if narrow, finding: production MMR implementations in the wild (at least two major reference ones, LangChain and Elastic) ship the *naive* quadratic-in-limit form. Ruflo's own code had the same gap. Fixing it is not "catching up to the field" — it's closing a gap the field itself mostly hasn't closed, per Dream Cycle research's direct-source verification.

## Ruflo Current Capability

`mmrRerank()` lives in `v3/@claude-flow/memory/src/smart-retrieval.ts`, called from `applyMMR()` (public, used by the CLI's `hybridSearch` controller per ADR-125 Phase 5) and internally from `smartSearch()`'s diversity stage. Two prior Dream Cycle nights touched this function without fixing this: 2026-09-03 (#3169, merged) wired embedding-cosine through as the preferred similarity path; 2026-09-10 (#3265/#3266, merged) made token-Jaccard-fallback tokenization lazy/cached. Neither touched the outer-loop's O(limit² × N) rescan shape. Independently re-confirmed unfixed by the 2026-09-22 gist's recommendation #3 ("`mmrRerank()` redundant cosine recomputation... no running-max cache... good `memory`/`performance`-night candidate") and re-verified against current code tonight (git log: function body untouched since 2026-10-02, comment-only changes).

## Competitor Comparison

| Framework | Incremental cache or recompute-from-scratch? | Source | Grade |
|---|---|---|---|
| **Ruflo (pre-fix)** | Recompute from scratch every round | this repo | A |
| **LangChain core** | Recompute from scratch every round | GitHub source, direct read | A |
| **Elastic** (reference MMR impl) | Recompute from scratch; mitigates via pool-size capping, not caching | Elastic Search Labs blog | B |
| **pyversity** | Advertises O(k·n·d) — the optimized bound | README | B |
| **Weaviate / Qdrant / LlamaIndex** | Undisclosed at source level | vendor docs | C |

## Hypothesis

Given a corpus of N scored search candidates passed through `mmrRerank(scored, lambda, limit)`, when the per-remaining-candidate max-similarity-to-selected is cached and incrementally updated against only the newest selected item each round (instead of rescanning the full selected set), then wall-clock latency should decrease, with the *speedup ratio itself growing* as N/limit grow (proving a complexity-class change, not a constant-factor win), subject to: (1) selection order and scores byte-identical to the original algorithm across all-embedded/Jaccard-fallback/mixed/lambda-extreme/negative-cosine scenarios; (2) the existing 18-doc/6-topic quality benchmark's recall@k/nDCG@k/diversity/duplicate-rate metrics unchanged; (3) all existing tests green; (4) deterministic, $0 evaluation, zero LLM calls. Frozen before evaluation; not modified after.

## Benchmarks

Reused the existing committed corpus `v3/@claude-flow/memory/src/mmr-benchmark.test.ts` (18 docs / 6 topics, built 2026-09-03 for a *different* hypothesis — embedding-cosine vs. token-Jaccard quality — making it an independently-authored, non-self-serving fairness check for tonight's complexity-only candidate) plus the existing `mmr-rerank-perf.test.ts` (2026-09-10, tokenize-call-count). Added a new file, `mmr-rerank-complexity.test.ts`: 3 correctness-parity tests (byte-identical output vs. a frozen copy of the old recompute-from-scratch algorithm, across negative-cosine, lambda-extreme, and small-corpus-edge-case scenarios) plus 2 wall-clock scaling tests (384-dim embeddings, matching this repo's production embedding size).

## Evaluation

**evaluated: accepted.** Real evaluator: Vitest 4.1.8, deterministic, $0, zero LLM calls.

- Correctness suite: 37/37 green (`mmr-rerank-complexity.test.ts`, `mmr-rerank-perf.test.ts`, `mmr-benchmark.test.ts`, `smart-retrieval.test.ts`, `smart-retrieval-scores.test.ts`). The 2026-09-03 quality benchmark's recall@k/nDCG@k/diversity/duplicate-rate are byte-identical between its "baseline"/"candidate" labels (e.g. λ=0.9: recall 1.0/1.0, nDCG 0.7774/0.7774 — zero behavior change, only the internal path differs).
- Full `@claude-flow/memory` suite: 558/559; 1 pre-existing failure (`auto-memory-bridge.test.ts`, a chmod-read-only test that fails because this environment runs as root — unrelated file, no reference to `smart-retrieval.ts`).
- `tsc --noEmit`: clean.
- Wall-clock (384-dim embeddings, 5-run means, 3-run warmup): N=40/limit=25 → 2.23x; N=300/limit=150 → 28.60x; N=200/limit=100 → 362.6ms→22.6ms (16.06x). The *growing* ratio is the complexity-class evidence — a constant-factor win would hold it flat.
- Baseline-fails/candidate-passes: reverting just the algorithm body (keeping the `cosineSimilarity` export, isolating the behavioral diff from the import) makes the wall-clock assertions genuinely fail — measured ~0.35x-0.6x "speedup" (noise-level, no real speedup) against `expect(...).toBeGreaterThan(1)`.

## Darwin Results

Skipped: this is a binary, correctness-preserving algorithmic rewrite with no continuous tunable parameter (unlike e.g. `mmrLambda` or `fisherDecayRate` in prior nights) — there is nothing for Darwin to mutate (routing weights, topology, prompt/memory/tool/tier/context/coordination parameters all inapplicable here). Same skip class as #3110/#3160/#3184/#3221/#3243/#3266/#3302/#3330/#3378/#3385/#3395. Confirmed Darwin tooling itself IS reachable tonight (`ruvector harness darwin <config> --execute`, ADR-256, requires an explicit JSON config and `--execute` flag) — noted for completeness, not invoked, since there's no parameter space this candidate exposes.

## SOTA Proof & Witness

**Reward hack check** (manual checklist — `ruvector harness` exposes `status`/`doctor`/`route`/`flywheel verify`/`flywheel gate`/`darwin` but no standalone reward-hack primitive): test weakening — none; gold-data tampering — N/A, reused an independently-authored corpus untouched; cherry-picking — none, tested across embedded/Jaccard-fallback/mixed/lambda-extreme/negative-cosine/small-corpus scenarios; evaluator exploitation — none; cost hiding — none, $0 deterministic; undocumented-cache correctness — re-derived by research (max-over-growing-set identity) before implementation, not merely asserted.

**Adversarial critique**: independent critic (separate context) hand-traced a 4-candidate example, verified `maxSim`/`remaining` index alignment across every `splice()`, verified the floor-at-zero behavior holds with no explicit re-floor on update (provably monotonic once floored at seed), ran the 37-test suite itself, and independently reproduced the baseline-fails/candidate-passes proof via its own temporary revert (measured 0.64x/784ms against the old algorithm, vs. assertions requiring >1x/<90ms) — then restored the file, verified via md5sum match plus a clean 37/37 re-run. **Verdict: CONFIRMED, no blocking issues.** Minor non-blocking note: the wall-clock assertions are timing-based and could in principle flake on a loaded CI runner, though observed margins (2.2x-28.6x) leave headroom.

**Security review**: no security-sensitive surface — internal arithmetic/control-flow only, no input boundary, no auth/filesystem/network scope change.

**Promotion gate** (advisory only): evaluation_complete ✓, effect_positive ✓ (2.2x-28.6x), significance_sufficient ✓ (growing-ratio proof), no_material_regression ✓ (byte-identical quality metrics, 558/559 both ways, `tsc` clean), tests_green ✓, reward_hack_clear ✓, critic_clear ✓, witness_valid ✓ (below), receipt_reproducible ✓. **VERDICT: ACCEPT** — recommended for human review, not self-promoted. `ruvector harness flywheel gate` exists but expects a signed-evidence-bundle schema not producible tonight; the checklist above substitutes manual advisory judgment, as most merged prior nights have done.

## Recommended Next Steps

1. **This fix**: human review and merge of the linked draft PR — small diff (34 insertions / 12 deletions in one source file, one new test file), one conceptual change, zero behavior change, zero regressions.
2. **HNSW binary/scalar quantization dispatch** (`v3/@claude-flow/memory/src/hnsw-index.ts`'s `distance()`, flagged unfixed by the 2026-09-22 gist): product quantization is wired (fixed 2026-08-25, #3093/#3094), but binary/scalar quantization types still fall through to generic cosine/euclidean on packed vectors — good future `performance`/`memory`-night candidate.
3. **hiveToken persisted world-readable on disk** (`v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:239-243`, tonight's `security` scan): `saveHiveState()`/`ensureHiveDir()` write `.claude-flow/hive-mind/state.json` (containing the plaintext capability bearer token added by #3290/#3291) at default umask permissions, with no `chmod`/`mode` anywhere in the file — any other local account on a shared host can read the token and fully defeat the capability-token model. Small patch (<30 lines): `{ mode: 0o600 }` on the write, `{ mode: 0o700 }` on the directory, plus a `chmodSync` fallback for pre-existing files.
4. **Hive-mind consensus quorum denominator not frozen at proposal time** (`v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:620`, tonight's `hive-mind` scan): `totalNodes = state.workers.length` is recomputed live on every `propose`/`vote`/`status` call rather than frozen when a proposal is created; membership churn (join/leave) during an open vote can satisfy a now-lower quorum without `tryResolveProposal()` ever being re-invoked, wedging the proposal in `pending` indefinitely (worse for raft: blocks term progression). Medium severity, small-to-medium patch (<150 lines): store `requiredVotes`/`totalNodesAtProposal` on `ConsensusProposal` at propose time; call `tryResolveProposal` from `join`/`leave` too.

## Witness

Note on provenance: STEP 0's `SESSION_COMMIT` was captured as `cae05bd1c3d334cd1efc6bdbc00d458638cf7f50` at the start of this run. Before committing, the working tree's `main` was discovered to have diverged significantly from `origin/main` (a force-push upstream), so the `dream/2026-10-05-performance` branch was rebased onto fresh `origin/main` (`6c7b6e8859...`) and the candidate diff reapplied cleanly (no conflicts, file untouched by the intervening commits) before committing — recorded here for reproducibility, not hidden. Witness is bound to `SESSION_COMMIT` per the literal STEP 16 formula; the actual candidate content lives at the commit below.

| Field | Value |
|---|---|
| Candidate commit | `b915aa5176aae72b076db6bc530cf6fbb92547b8` |
| Session commit (STEP 0) | `cae05bd1c3d334cd1efc6bdbc00d458638cf7f50` |
| Gist SHA-256 (pre-witness content) | `44589a7c8455c980be33e3577e321cfb1e0f0e689bdf3b0587816f74dba2ea28` |
| Witness stamp | `fa99fd80fcbbb35b68a10707aacd00cdd477f47f32e8f7ad33c462adbe0595c0` |

Verifier: fetch this gist, strip this table's filled values back to `PENDING`, SHA-256 the file, concatenate with the session commit, SHA-256 again — must equal the stamp.
