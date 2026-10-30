# Performance SOTA Report — 2026-10-30

TL;DR: Closed a twice-deferred (2026-10-20, 2026-10-25) finding. `AttentionCoordinator.getOrCreateEmbedding()` rebuilt a synthetic content-hash embedding from scratch on every pairwise call instead of once per `AgentOutput`, paying an O(n²)/O(numHeads·n²) redundant-build cost in every coordination mechanism. Memoized it with an identity-keyed `WeakMap`. Measured median-latency wins of ~24x–39x on a multi-head coordination microbenchmark (n=20/50/100), growing with n as expected for removing a quadratic-multiplier term. 5-role parallel research fan-out ran first; 2026 SOTA and competitor findings below.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| RelayCaching: cross-stage KV reuse in multi-agent pipelines, up to 4.7x lower TTFT | [arXiv 2603.13289](https://arxiv.org/abs/2603.13289) (ICML 2026) | B |
| Cross-vendor prompt-caching study: caching only static/system blocks beats full-context caching, 41–80% cost cut | [arXiv 2601.06007](https://arxiv.org/html/2601.06007) | A |
| Anthropic prompt-cache pricing mechanics (1.25x/2x write, 0.1x read, 5-min default TTL) | [Anthropic docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) | A |
| Context Window Lifecycle: deterministic token-budget eviction beats blocking LLM summarization for long-horizon agents | [arXiv 2606.11213](https://arxiv.org/pdf/2606.11213) | B |
| Upfront confidence-based model routing beats sequential cascades on 4/5 datasets | [arXiv 2605.06350](https://arxiv.org/abs/2605.06350) | B |
| HNSW's layered hierarchy may be unnecessary on high-dimensional data (hub effects); flat graphs comparable | [arXiv 2412.01940](https://arxiv.org/pdf/2412.01940v2.pdf) (ICML 2025 workshop) | B |

Explicitly thin result, not padded: no rigorous 2025–26 controlled study was found comparing event-driven vs. polling coordination for multi-agent systems specifically (only unrelated-domain vendor blogs) — flagged as searched-and-not-found.

## Ruflo Current Capability

3-tier model routing (ADR-026/143), HNSW ANN memory search (measured 1.9x–4.7x vs. brute force depending on N, not the historically-claimed 150x–12,500x), and an `AttentionCoordinator` offering 6 coordination mechanisms (flash/multi-head/linear/hyperbolic/moe/graph-rope) for swarm consensus. The embedding-memoization gap fixed tonight affected every mechanism except `linear` and `moe` (neither calls `getOrCreateEmbedding`).

## Competitor Comparison

| Competitor | Performance mechanism | vs. Ruflo | Grade |
|---|---|---|---|
| LangGraph | Explicit graph control flow, no LLM-mediated negotiation overhead | Benchmarks conflict across sources (2x faster than CrewAI in one test, slowest of 5 frameworks in another) — no shared methodology exists yet | C |
| Microsoft Agent Framework (ex-AutoGen) | v0.4+ event-driven async runtime; opt-in prompt-cache flag added 1.12.1, vendor ran no live-model cost benchmark | No deterministic $0 tier equivalent to Ruflo's Tier-1 codemods; native caching still "planned" per MS's own migration guide | C |
| CrewAI | Agent/crew abstraction, no first-party result caching | ~3x the token footprint of LangChain/LangGraph/AutoGen on simple tasks (independent 2,000-run benchmark); Ruflo's tiered routing directly targets this failure mode | B |
| OpenAI Agents SDK | Platform-level automatic prefix caching (5-min idle TTL), no app-level tier router | Ruflo's ADR-026 tiering is explicit/inspectable; OpenAI's caching is implicit and TTL-fragile for agent loops with idle gaps | C |
| Qdrant / Milvus / Weaviate (HNSW ANN) | Vendor-claimed sub-100ms @ 100M vectors; one same-hardware 3rd-party test shows Milvus ~3ms p95 vs. Qdrant ~5.3ms p95 | Ruflo's own disclosed numbers (1.9x–4.7x, recall@10 ~0.99) are modest but self-measured — more conservative than any vendor claim, a credibility strength not a speed one | B/C |

None of LangGraph/CrewAI/AutoGen/OpenAI SDK implement formal consensus (Raft/Byzantine/gossip) — a genuine architectural gap, not deliberate avoidance of a solved problem: these frameworks assume a single orchestrator/durable-workflow engine with crash-only retry, and the literature (SwarmRaft, arXiv 2508.00622) argues BFT is "unnecessary complexity" outside adversarial settings. This remains a real Ruflo differentiator, validated by a UC Berkeley NeurIPS 2025 study finding 41–86.7% multi-agent failure rates attributable to coordination/design issues — the exact bug class this repo's trailing swarm-surface nights have been hardening one at a time.

## Hypothesis

> Given a swarm-coordination workload calling `AttentionCoordinator`'s flash/multi-head/hyperbolic/graph-rope mechanisms over N agent outputs without pre-supplied embeddings, when `getOrCreateEmbedding()` is memoized per-`AgentOutput` via an identity-keyed `WeakMap` instead of rebuilding a fresh `Float32Array` via full content-hash on every pairwise call, then the number of embedding-build operations drops from O(n²)/O(numHeads·n²) to O(n), subject to: (1) attention weights/scores byte-identical to baseline; (2) no cache-key collision between different outputs; (3) zero regression in the `@claude-flow/swarm` suite; (4) `tsc --noEmit` byte-identical. Frozen before evaluation; not modified after.

## Candidate

`v3/@claude-flow/swarm/src/attention-coordinator.ts` — added a `private readonly syntheticEmbeddingCache = new WeakMap<AgentOutput, Float32Array>()` instance field; `getOrCreateEmbedding()` now checks it before the content-hash build and populates it after. Pre-supplied `output.embedding` still bypasses the cache entirely (unchanged fast path). 8 lines changed in 1 production file. New test file `attention-coordinator-embedding-cache.test.ts` (6 tests: 2 discriminating identity/wiring checks, 4 controls for collision-safety, embedding-bypass, and output-stability across mechanisms).

## Benchmarks / Evaluation

**evaluated: accepted.** Real evaluator: Vitest 4.1.8 (`pnpm install --filter @claude-flow/swarm...` this session; sibling packages' unbuilt `dist/` is a pre-existing environmental gap unrelated to this change).

Stash-isolated baseline (`git stash` on just `attention-coordinator.ts`): 3/6 new tests fail exactly as predicted (no `syntheticEmbeddingCache` field exists pre-fix); the 3 non-cache controls pass on baseline too. Candidate: 6/6 pass. Full `@claude-flow/swarm` suite: 367/367 (361 pre-existing + 6 new), 0 regressions. `tsc --noEmit`: 0 errors both ways (byte-identical).

Standalone wall-clock probe (multi-head mechanism, 5-trial median, no pre-supplied embeddings):

| n | Baseline | Candidate | Speedup |
|---|---|---|---|
| 20 | 25.927ms | 1.070ms | ~24.2x |
| 50 | 158.119ms | 4.655ms | ~34.0x |
| 100 | 652.951ms | 16.550ms | ~39.5x |

Growing speedup with n is the expected signature of removing a quadratic-multiplier term (the O(n²) cosine-similarity/consensus steps themselves are untouched and still scale accordingly — this fix only removes the redundant O(content.length) hash rebuild inside each of those O(n²)/O(8n²) calls).

## Darwin Results

Skipped — binary memoization fix (a cache either exists or doesn't), no continuous/categorical parameter for Darwin's bounded-evolution interface (`npx ruvector harness darwin <config> --execute`, confirmed available via `npx ruvector harness status --json`, 14/15 primitives live) to search over. Same skip class as nearly every ACCEPT in this repo's history that wasn't a routing/topology weight.

## SOTA Proof & Witness

No `.claude-flow/flywheel/` state exists in this repo (confirmed by direct inspection — only `data/`, `logs/`, `metrics/`, `neural/` under `.claude-flow/`). Evidence retained as: the 6 new tests, the stash-isolated comparison (session + independent adversarial critic), the standalone wall-clock probe, issue and PR below, and the witness block below.

```
Session commit:   PENDING
Candidate commit: PENDING
Gist SHA-256 (pre-witness, witness block stripped to PENDING): PENDING
Witness stamp:    PENDING
```

## Recommended Next Steps

1. **8x redundant multi-head computation** (`computeAttentionScore`'s `head` parameter is declared but never read in its body — `attention-coordinator.ts:729-757`, called from an 8-iteration loop at `435-481`): all 8 "heads" compute byte-identical scores; collapsing the loop (or wiring real per-head projections) is a ~5-8 line, output-preserving fix. Scored 4.60/5, deferred tonight to keep this patch to one conceptual change.
2. **AgentDB backend always dispatches to native HNSW with no size-based brute-force bypass** below this repo's own measured crossover (N≈5k-20k) — `v3/@claude-flow/memory/src/agentdb-backend.ts:237-245,450-477,852-864`. Scored 4.60/5, medium patch/risk (threshold choice is a judgment call).
3. **Anthropic provider never captures `cache_creation_input_tokens`/`cache_read_input_tokens`** from the API response (`v3/@claude-flow/providers/src/anthropic-provider.ts:52-55,330-353,389`), so cost accounting charges full base rate even on cache hits and there is zero visibility into whether Ruflo's own deployed `cache_control` strategy is working. Scored 5.00/5 on the candidate rubric (highest of the night) but deferred as a telemetry/accounting fix rather than a benchmarkable throughput change — strong next-night pick given this cycle's A-grade external evidence that caching strategy must be measured, not assumed.

**Security/hive-mind scan (not implemented tonight, disclosed for the issue/PR):** `http_fetch`'s SSRF allowlist never resolves hostnames before the private/public decision, so a DNS-rebind to a loopback/metadata IP bypasses it entirely (`http-fetch-tools.ts`, `validateUrl`/`isPrivateOrLoopback`). Raft's legacy no-transport path (the one `ConsensusEngine`'s factory actually wires into production) skips vote-once-per-term and log-up-to-date checks that exist correctly in two other unreachable code paths in the same file (`v3/@claude-flow/swarm/src/consensus/raft.ts`).

No `gh gist create`/gist-equivalent MCP tool reachable this session (`gh` CLI's `GH_TOKEN` is invalid; no gist-creation MCP tool exists even though other GitHub MCP tools work fine) — same disclosed gist-only gap noted by every night since 2026-09-30. This report is committed in-repo at `docs/dream-cycle/dream-gist-2026-10-30.md` on this branch instead, and embedded in full in the issue.
