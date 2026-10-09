# Memory SOTA Report — 2026-10-08

TL;DR: In 2026, the "unreachable points phenomenon" — HNSW recall degrading under repeated delete-without-repair (arXiv 2407.07871) — is real and well-established, and Ruflo's `MemoryConsolidator.dedup()` has exactly the shape that should trigger it: it calls `HNSWIndex.removePoint()` (never repairs edges) eagerly, mid-loop, inside a search-dependent multi-round algorithm. Tonight built and ran the direct test, not just the analogy — twice. The "obvious" fix (defer removal, tombstone-and-filter like Qdrant/Weaviate) breaks `dedup()`'s own correctness: REJECT, solid and reproducible. The underlying recall-degradation hypothesis itself is **INCONCLUSIVE**, corrected mid-pipeline by an independent adversarial critic after the first pass wrongly reported a clean REJECT off only 10 lucky single-trial re-runs: a 24-trial-per-run statistical remeasurement (reruns in this report; critic independently ran ~46 single trials) shows mean background recall is flat-to-slightly-improved, but individual trials occasionally degrade and the critic observed one full collapse to recall=0 — a real, intermittent tail risk tied to `HNSWIndex`'s unseeded graph-construction randomness, not reliably reproducible either way. Tonight ships the corrected, honest measurement as a committed test, plus one small, genuinely-ACCEPT bug found during the same architecture read: `bridgeSessionEnd()`'s nightly-consolidation trigger has silently never fired, on either backend, since introduction, because it checks for a method (`.consolidate()`) neither implementation has.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| FreshDiskANN: repeated delete/reinsert churn degrades HNSW recall over cycles even on a static dataset; tombstone-and-filter alone can actually beat periodic rebuild on recall (at a query-speed cost) | arXiv 2105.09613 | A |
| "Enhancing HNSW Index for Real-Time Updates" names the exact failure mode — deleted nodes' neighbors lose edges with no replacement ("unreachable points phenomenon") — and proposes MN-RU repair | arXiv 2407.07871 | A |
| VecOps-Bench: 3.4–9.7% recall loss after 10% random churn across tested HNSW implementations | github.com/debu-sinha/vecops-bench | B |
| Qdrant/Weaviate/Milvus/LanceDB all use some form of deferred, batched physical removal (vacuum optimizer / async cleanup / compaction) — none mutate the live search graph eagerly inside a multi-round loop the way Ruflo's `dedup()` does | official docs, cross-checked | A |
| Optimal repair-scheduling policy (signal-triggered vs. fixed-cadence) is still genuinely contested in 2026 — a July 2026 arXiv paper (2607.00728) self-corrected its own v1 headline claim after finding its baseline was never actually run at the claimed budget | arXiv 2607.00728 v2 | A |

## Ruflo Current Capability

`MemoryConsolidator.dedup()` (`v3/@claude-flow/memory/src/consolidator.ts`) runs a hash-dedup pass, then a `do { ... } while (roundMerged > 0)` embedding-near-duplicate pass: each round calls `index.search()`, groups near-dup hits, and `mergeGroup()` calls `index.removePoint()` immediately for every dropped entry. `HNSWIndex.removePoint()` (`hnsw-index.ts:412-455`) strips bidirectional edges correctly but does zero repair — `pruneConnections()` (:971-998), the file's only degree-management code, only ever removes excess edges on insert, never on delete. `compactHnsw()` only runs once, at the end of `runAll()` — never between `dedup()`'s own rounds. Exactly the literature's "unreachable points" shape; the open question was whether it's measurably real here, and fixable without breaking something else.

## Competitor Comparison

| System | Deletion mechanism | Grade |
|---|---|---|
| Qdrant | Lazy tombstone + query-time filter; physical removal only via scheduled Vacuum/Merge Optimizer | A |
| Weaviate | Soft-delete flag, graph stays connected; async rate-limited cleanup goroutine does edge reassignment + removal | A |
| Milvus | Append-only delta segment (soft delete); `compact()` merges + rebuilds the index, not edge-patched | B |
| LanceDB | Per-fragment deletion file (soft, versioned); physical removal only on explicit `compact_files()` | B |
| Mem0 / LangGraph Store / CrewAI / AutoGen | None run a bulk, multi-round, vector-threshold dedup sweep against their own live index at all — Mem0 explicitly rejected that design (per-write LLM-mediated merge instead); the others push consolidation to the caller or leave it unpublished | B/C |

Why "None" for the agent-memory row: no agent-framework precedent exists for Ruflo's exact problem (bulk live-index dedup) — only raw vector-DB practice, where "defer physical removal, keep the search graph untouched during the decision window" is standard, and Ruflo's `dedup()` only half-implements it.

## Hypothesis (frozen before evaluation)

Given `MemoryConsolidator.dedup()`'s pass-2 loop, when `HNSWIndex.removePoint()` is called eagerly per dropped entry inside that loop, then HNSW `search()` recall@10 for unrelated background vectors should measurably degrade relative to a freshly rebuilt index, subject to: deterministic $0 evaluation, no modification of gold/ground-truth data, reproducible across repeated runs.

## Benchmarks / Evaluation

**Candidate 1 (the fix): REJECT.** Deferring `removePoint()` to a single batch after `dedup()` converges — collecting dropped ids in `ctx.pendingIndexRemovals` and flushing once at the end — was implemented in full in `consolidator.ts`, then broke a real pre-existing regression test: `consolidator.test.ts`'s "fully converges a near-duplicate cluster larger than the search neighborhood in one call" (n=15 identical vectors) dropped from `merged=14` to `merged=7`. Root cause, confirmed by tracing the algorithm: for pairwise-identical vectors, deferring removal means `index.search()` returns the *same* top-K result set every round (nothing shrinks; ties resolve deterministically by graph order), so once those K ids land in a round's `consumed` set, the rest of the cluster is never resurfaced. Eager removal is load-bearing for this round-based algorithm's completeness, not incidental bookkeeping. The diff was reverted — not shipped.

**Hypothesis itself: INCONCLUSIVE (corrected mid-pipeline).** First pass asserted "no degradation" from only 10 single-trial manual re-runs, all of which happened to pass — an independent adversarial critic (STEP 10) then ran the same single-trial probe ~46 times and found a genuine ~10% failure rate at M=16 itself (the real production default, not a contrived sparse config), including one full recall collapse to 0 — exactly the "unreachable points" signature the hypothesis predicts. Root cause: `HNSWIndex.getRandomLevel()` uses real, unseeded `Math.random()`, so each index build samples different graph topology even with identical seeded vector content; the original test measured one random draw, not a stable property. Corrected: `dedup-eager-removal-recall-probe.test.ts` now runs 24 independent trials per invocation (fresh index + fresh random topology each time) and reports the full distribution. Five re-runs tonight (120 trials total): mean recall delta consistently positive (+0.10 to +0.14 — duplicates were occupying some true top-10 slots ahead of real neighbors; removing them frees those slots), but 1 of 24 trials degraded (>0.05 drop) in 3 of the 5 runs, worst single-trial drop -0.12. No catastrophic (recall-to-0) collapse in these 120 trials, but the critic's independent larger sweep found one. Net: degradation is real and intermittent, not a stable effect either way — a single experiment could not reliably distinguish "it happens" from "it doesn't," which is INCONCLUSIVE by definition, not a safe REJECT.

**Secondary fix (ACCEPT): `bridgeSessionEnd()`'s nightlyLearner wiring.** Found while reading `controller-registry.ts` during the architecture review. `memory-bridge.ts`'s session-end handler gated nightly consolidation on `typeof nightlyLearner.consolidate === 'function'` — neither backend has ever had that method: the legacy `agentdb` `NightlyLearner` class exposes `run()`/`discover()`/`consolidateEpisodes()`; the ADR-125 Phase 4 `MemoryConsolidator` wrapper exposes `run`/`runAll`/`sweepExpired`/`dedup`/`compactHnsw`. No bare `consolidate` on either — the guard has been unconditionally false since introduction; session-end consolidation has never actually run, on either backend. Fixed to check/call `.run()` (the real shared entry point, no arguments — dropped the stale `{sessionId}` pass-through). New test (3 cases) proves baseline-fails/candidate-passes. 565/566 full `@claude-flow/memory` suite (1 pre-existing unrelated environmental failure, same as prior nights e.g. #3650); relevant `@claude-flow/cli` tests pass; tsc shows the same pre-existing unbuilt-sibling-package errors as before, none in touched files.

## Darwin Results

Skipped for both. The rejected candidate has no continuous tunable parameter (it was a correctness-class algorithm change, now reverted). The accepted fix is a method-name correction with no fitness gradient to search over. Same skip class as nearly every correctness-fix dream-cycle night (#3110/#3160/.../#3754).

## SOTA Proof & Witness

See issue/PR for the full reward-hack checklist, adversarial critique, and security review. Witness stamp at the end of this file.

## Recommended Next Steps

1. **Do not revisit "defer `removePoint()` in `dedup()`"** without first reading `dedup-eager-removal-recall-probe.test.ts` — committed specifically so this direction isn't silently retried.
2. **If eager-removal is ever revisited**, any fix must preserve the round algorithm's reliance on index shrinkage to resurface undiscovered cluster members — e.g. `HNSWIndex`'s existing `searchFiltered()`/over-fetch pattern to exclude already-matched ids from search candidates themselves, not just post-hoc filter hits.
3. **Seed `HNSWIndex.getRandomLevel()`'s `Math.random()` call** (behind a constructor param) — the single biggest blocker to resolving tonight's INCONCLUSIVE verdict. With a seedable RNG, a future night could run a controlled sweep and determine exactly which graph-topology conditions trigger the occasional severe collapse, rather than treating it as unexplained noise.
4. (Capabilities scan) Plugin registry's `permissions`/`exports` metadata is never enforced at runtime — zero `import()`/`require()` call sites exist anywhere in `v3/@claude-flow/cli/src/plugins/`. A real trust-policy gate decides what to "register" vs. "withhold," but since nothing ever loads plugin code, that decision has no runtime effect either way. Candidate for a future `capabilities` night.
5. (Automation scan) The ledger-append step (STEP 25) has been silently missing for 7 consecutive nights (10-01 through 10-07; real branches/PRs confirmed for all but a genuine 10-04 no-run gap) — a previously-elevated, still-unaddressed gap with zero CI-level guard. Worth a dedicated `automation` night.

## Scan Findings: plugins

See item 4. `v3/@claude-flow/cli/src/plugins/manager.ts` only shells to `npm` and reads/writes a JSON manifest — no dynamic module loading anywhere. `trust-policy.ts`'s withhold/register decision on `hooks`/`commands` is bookkeeping with no execution-time effect, trusted or not. Testable tonight as a $0 static-grep CI check; a real sandboxed loader is separate, larger design work.

## Scan Findings: automation

See item 5. `LEDGER.md` has no row past 09-30, but `git ls-remote --heads origin "dream/*"` and GitHub PR search confirm the pipeline ran 10-01, 10-02, 10-03, 10-05, 10-06, 10-07 (10-04 is a genuine no-run gap). No `.github/workflows/*.yml` references "dream", `LEDGER.md`, or the external trigger id — the schedule lives outside this repo's version control, with nothing asserting a ledger row was appended. Same gap the ledger already elevated to "high-priority" after its 3rd occurrence in August; now recurring a 4th+ time, unaddressed.

## Competitors Reviewed

Qdrant, Weaviate, Milvus, LanceDB, Vespa, pgvector/pgvectorscale (vector-DB deletion mechanics); Mem0, LangGraph Store, CrewAI, AutoGen (agent-memory consolidation behavior).

## Witness

```
Session commit (STEP 0): 6051f6702b610e1101e727ccffd5f379f75ea6fc
Candidate commit:        this branch's tip commit (see PR/branch head; omitted here to avoid circularity with this file's own hash)
Gist SHA-256 (pre-witness, this block's filled values stripped to PENDING): 0e578f58305ad7c37301c678acc89095a8c34e323d6316533dd3c754c8ec6012
Witness stamp:           c1edadf7b1f435fc188b4b179f958844b93f861f69e79eb83d480e9b60ea6fe7
```

Verifier: fetch this file from the branch, strip this block's filled values back to `PENDING`, SHA-256 the file, concatenate with the session commit above, SHA-256 again — must equal the witness stamp.
