# Memory SOTA Report — 2026-11-13

**TL;DR**: In 2026, "causal recall" — retrieval conditioned on a causal/provenance graph, not pure embedding similarity — is a genuine, actively-forming research frontier: two fresh 2026 papers (ActMem, AMA-Agent) build causal-dependency graphs over agent memory, and a 2026 survey names causal-graph-traversal-plus-similarity hybrids as "largely unexplored." No production memory system (Mem0, Letta/MemGPT, Zep/Graphiti, Qdrant, Weaviate, Milvus, LanceDB, Vespa) ships an activated version — Mem0 actually *removed* its graph variant in its 2026 v3 rewrite. Ruflo's own `@claude-flow/memory` already has a correctly-built `CausalRecall` controller — it imports the real `CausalRecall` class from `agentdb` and wraps it with the registry's own ADR-514 embedder adapter — but it was dead code: absent from every level of `ControllerRegistry`'s `INIT_LEVELS`, so `initialize()` never constructed it and `registry.get('causalRecall')` always returned `null`. Disclosed-but-deferred by a 2026-10-28 session ("needs a human call on init-level ordering"). Tonight: verified independently by two fresh subagents (one rebuilt the package from scratch, 93/93 baseline green; one adversarial critic re-derived and re-ran everything), fixed with a one-line `INIT_LEVELS` addition plus two discriminating tests.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| ActMem: causal memory KG refined by counterfactual reasoning + PMI filtering; "utility for action," not recall capacity | [arXiv:2603.00026](https://arxiv.org/html/2603.00026) | B |
| AMA-Agent: explicit "Causality Graph" over interaction history, +11pt claim vs best baseline (ICML 2026) | [arXiv:2602.22769](https://arxiv.org/html/2602.22769v1) | C (author-reported, not cross-checked) |
| Mem0 removed its graph-memory variant (Mem0g) entirely in the April-2026 v3 rewrite — found the graph edge was thin even where it won | [Mem0 2026 blog](https://mem0.ai/blog/state-of-ai-agent-memory-2026); origin paper [arXiv:2504.19413](https://arxiv.org/html/2504.19413v1) | B |
| Zep/Graphiti: the one production system with an explicit bitemporal model (valid/invalid real-world time vs created/expired system time) — closest production analog to disciplined memory lifecycle, but still relationship/time-based, not causal-provenance-based | [arXiv:2501.13956](https://arxiv.org/abs/2501.13956); [Graphiti docs](https://mintlify.com/getzep/graphiti/concepts/temporal-model) | A |
| 2026 survey names "hybrid retrievers combining causal graph traversal with similarity search" as largely unexplored; proposes cheap causal-parent write-time annotation as an approximation | arXiv:2603.07670 | B |
| Qdrant/Weaviate explicitly decouple build-time `ef_construct`/`efConstruction` from query-time `hnsw_ef`/`ef`; official guidance: tune query-time first, touch build-time only if recall plateaus | [Qdrant course](https://qdrant.tech/course/essentials/day-2/what-is-hnsw/); [Weaviate ANN benchmarks](https://weaviate.io/developers/weaviate/benchmarks/ann) | A |

**Why this isn't "None across the board"**: the gap is real but it's a frontier, not abandonment — two 2026 papers and a survey are actively forming the idea, and Mem0's removal of graph memory this year reads as considered scope-narrowing (compute/design overhead vs. its token-cost pitch), not ignorance. Letta/MemGPT's flat pgvector archive looks like a genuine gap, not deliberate avoidance. Qdrant is the clearest "not our layer" case: its own blog frames provenance/causal modeling as the application's job, not the index's.

## Ruflo Current Capability

`v3/@claude-flow/memory/src/controller-registry.ts`'s `ControllerRegistry` declares `'causalRecall'` as a first-class `AgentDBControllerName`, with a correct `createController()` case (dynamic `import('agentdb')`, pulls the real `CausalRecall` export, constructs `new CR(this.agentdb.database, this.agentdbEmbedder(), this.agentdb.vectorBackend ?? undefined)` — the same `agentdbEmbedder()` ADR-514 adapter used by its already-wired siblings `learningSystem`/`explainableRecall`/`nightlyLearner`). It's also included in `isControllerEnabled()`'s "AgentDB-internal controllers" branch, so it reads as enabled whenever `agentdb !== null`. But `initialize()` only calls `createController()` for names it finds while iterating the `INIT_LEVELS` array (7 levels, 0-6), and `causalRecall` was absent from every one of them — so that construction code could never execute. The public `get<T>(name)` accessor's fallback path, for a name with no registry entry, only tries `this.agentdb[name]` (direct property) or `this.agentdb.getController(name)` (the *upstream* `agentdb` package's own method) — neither runs this wrapper's own embedder-adaptation logic. Net effect, confirmed by direct testing: `registry.get('causalRecall')` always returned `null`, silently, with no error.

Third instance in six weeks of the same "declared-but-dead" shape in this package family: `ControllerRegistry.set()` didn't exist, so 9 controllers' post-init activation silently no-op'd (fixed 10-28); `SecurityPolicy.minTrustLevelForWrite/Memory/Spawn` were declared but never read in sibling package `plugin-agent-federation` (fixed 10-31/11-01). Tonight's SCAN found two *more* fresh instances elsewhere (see Next Steps) — recurring enough to warrant a structural fix, not one-off patches.

Zero production call sites in `v3/` currently request `.get('causalRecall')` — unlike the 10-28/10-31 precedents, nobody is live-broken today. Tonight's fix is forward-looking: it makes a correctly-built, research-aligned capability (causal-provenance-conditioned recall — the exact frontier the 2026 literature above calls unexplored) reachable for the first time, removing a trap for the first future caller.

## Competitor Comparison

| Competitor | Mechanism | Causal/provenance-aware? | Lifecycle "declared-but-dead" guard? | Grade |
|---|---|---|---|---|
| LangGraph | Cross-thread `Store` + checkpointing | No — value+namespace, not origin | No plugin system | B |
| AutoGen / MS Agent Framework | Durable memory via 3rd-party (Neo4j, Hindsight) | None in-framework | Unverified | C |
| CrewAI | Unified `Memory` + per-record source tag | Partial — source tag, no causal edges | Unverified | B |
| OpenAI Agents SDK | `Sessions` = history only | None native | N/A | C |
| Mem0 | Mem0g: vector + entity-relation graph (removed 2026) | No — relations, not causality | N/A | B |
| Letta/MemGPT | Flat pgvector archival store | No — no edge typing | Unverified | B |
| Qdrant | Filterable HNSW, shared-attribute edges | No — explicitly app's job | N/A | B |
| Weaviate | `ENABLE_MODULES` module system | No | **Yes** — docs disclose >1 vectorizer disables `Explore` | A |
| Milvus | Vector + BM25 hybrid | None native (3rd-party bolt-ons) | 3rd-party lifecycle hooks only | B |
| LanceDB | Per-mutation versioning, manifest lineage | Lineage yes, causal reasoning no | N/A | B |
| Vespa | Rank profiles + match-features | No — feature-level, not causal | N/A | B |

Weaviate's documented module-interaction guard is the only real external precedent for "declared capability needs an activation guard" — Ruflo's gap was silent, Weaviate's is disclosed.

## Hypothesis

> Given `ControllerRegistry.initialize()`'s level-based controller activation (`INIT_LEVELS`), when `'causalRecall'` is added to Level 4's controller list (alongside its construction-sibling `causalGraph`), then `ControllerRegistry.get('causalRecall')` should return a real, non-null `CausalRecall` instance (built via the existing `createController()` case, with the registry's own ADR-514-adapted embedder) once `initialize()` completes and AgentDB is available — relative to today's baseline where `get('causalRecall')` always returns `null` because `causalRecall` is absent from every `INIT_LEVELS` entry and the public `get()` accessor's fallback path never invokes `createController()` — subject to: zero change to any other controller's level/order, zero regression to the existing `@claude-flow/memory` suite, the returned instance uses the wrapper's adapted embedder (not a mismatched contract), deterministic $0 Vitest evaluation. Frozen before evaluation; not modified after.

## Benchmarks / Evaluation

Real evaluator: Vitest 4.1.8 against `@claude-flow/memory`, built from source in-session. No `.harness/bench.json` corpus exists for this package; the package's own suite is the established "real evaluator" convention here (matches 10-18/10-28). Stash-isolated baseline: the 2 new tests fail exactly as predicted (`toContain('causalRecall')`; `expect(c, 'causalRecall').not.toBeNull()`). Candidate: 94/94 pass across the 4 relevant test files; `tsc --noEmit` clean both ways. Full package suite with candidate applied: 717/718 (1 pre-existing, unrelated, chmod-as-root environmental failure, byte-identical on the stashed baseline). **Independent adversarial critique: CONFIRMED-WITH-CAVEATS** — a fresh-context critic re-derived the bug from source, re-ran stash-isolation and the full suite itself, checked init-order safety (Level 4 runs after `vectorBackend`'s Level 2), grepped for other call sites (zero), and checked for a deliberate-omission reason (none; `agentdb`'s `CausalRecall` export is real). One caveat: the comment overstated `causalRecall` as "same shape as `causalGraph`" — `causalGraph` is actually built via `agentdb`'s own `getController()` switch, a different mechanism. Fixed forward same session; re-verified clean.

## Darwin Results

Skipped — binary level-membership fix (a controller name either sits in an `INIT_LEVELS` array or it doesn't), not a continuous/categorical tunable parameter. Same skip class as nearly every prior ACCEPT of this shape in this repo's history.

## SOTA Proof & Witness

Reward-hack check: clean — diff is additive-only (one array entry, two new tests, one comment correction), no existing test/threshold/gold data touched, independently re-confirmed by the adversarial critic. Security review: not security-sensitive — pure in-process controller-lifecycle wiring, no new I/O/network/filesystem/MCP surface, no credential handling. Flywheel: `.claude-flow/flywheel/` does not exist in this checkout, consistent with every prior night — evidence instead lives in the two discriminating tests, this gist, the issue, and the witness below.

```
Session commit: 002d8c1ac031871fc14220e964f4dbb35b60428f
Candidate commit: 51944eb30cff8226af302119608d61bd6f25de90
Witness stamp: 6d7d059d30431f825c65e67f2bd77b1f8231765dbc859758c2c7c6d0084e266f
```
Verifier: fetch this gist at the candidate commit, replace the three dynamic values above with the literal text `PENDING`, SHA-256 the result, concatenate with the Session commit, SHA-256 again — must equal the Witness stamp.

## Recommended Next Steps

1. **Act on tonight's own pattern elsewhere** — two fresh SCAN instances of the same "declared-but-dead" shape: `v3/plugins/code-intelligence`'s 7 declared config knobs (`defaultTopK`, `similarityThreshold`, `maxGraphDepth`, etc.) are merged by `updateConfig()` but never read by any of its 4 MCP tool handlers (4/5, future `plugins` night); `hooks worker dispatch --priority` is accepted/persisted/documented as priority-jumping but `drainDispatchQueue()` never reads it — plain FIFO regardless (4/5, future `automation` night).
2. Consider one test asserting every `AgentDBControllerName` appears in `INIT_LEVELS.flatMap(controllers)`, to catch this bug class at test time instead of one controller at a time.
3. Now that `causalRecall` is reachable, a future `memory` or `intelligence` night could prototype wiring it into a real retrieval call site — tonight's own SOTA research suggests shipping genuine causal-provenance-conditioned recall would be ahead of every reviewed competitor (none has shipped one).
