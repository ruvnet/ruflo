# Swarm SOTA Report — 2026-11-24

TL;DR: in 2026, shipped multi-agent frameworks (LangGraph, AutoGen/AG2, CrewAI, OpenAI Agents SDK) still route tasks with a single LLM-as-decider rather than a learned/RL policy — and for good, cited reasons (non-stationarity, reward hacking). Ruflo's own `QLearningRouter` claims a native-accelerated backend it can never actually use: a two-night-deferred finding (2026-10-29, 2026-11-14) turns out to be one level deeper than recorded — the native-engine probe is dead code with zero effect on any routing decision, regardless of which package backs it. Fixed tonight with a 2-file, test-covered removal; the bigger "should Ruflo's router use `@claude-flow/neural`'s RL algorithms at all" design question stays open and disclosed.

## Ruflo Current Capability

`v3/@claude-flow/cli/src/ruvector/q-learning-router.ts`'s `QLearningRouter` routes Task-tool subagent types via tabular Q-learning over a hashed feature-vector state. `initialize()` previously ran `await import('@ruvector/core')` then `(ruvector as any).createQLearning?.(this.config)`, setting `this.ruvectorEngine`/`this.useNative`. Three independent reads tonight (deep research, architecture review, ruvector scan) confirmed: `@ruvector/core` is not a dependency of `@claude-flow/cli` and is not installed anywhere reachable from it; the real published package (checked v0.1.38/v0.1.39, and the actually-installed `ruvector@0.1.100`) exports vector-DB primitives (`VectorEntry`, `SearchQuery`, `HnswConfig`, `VectorDb`) and nothing Q-learning-shaped. Separately, and more importantly: `route()`/`update()` — the only methods that touch Q-values — never read `this.ruvectorEngine` back. The only observable consumer anywhere in the codebase is `src/commands/route.ts`'s `route stats` CLI command (lines 328-355), which cosmetically displays "Native Backend: No" / `backend: 'fallback'`. Swarm's separate `TaskOrchestrator` dispatch (capability-filter + static priority, fixed 2026-10-14), `ByzantineConsensus`/`GossipConsensus` (per-voter weighting since 2026-08-24, `setMaxListeners` guard since 2026-11-14), and `agent_spawn`'s `maxAgents` enforcement (2026-10-29) are unrelated systems and were re-verified stable, no new finding there tonight.

## Competitor Comparison

| Framework | Task routing/dispatch | Topology / consensus | Grade |
|---|---|---|---|
| LangGraph | Supervisor is an LLM call choosing the next node; `handoff` tools transfer control directly. No learned/RL routing. | Hub-and-spoke supervisor, nestable; no voting between agents. | A (official docs) |
| AutoGen / AG2 | `GroupChatManager` selects next speaker, LLM-driven by default, deterministic function as alternative. | Single-decider turn-taking; no consensus protocol. | A (arXiv 2308.08155 + docs) |
| CrewAI | `Process.hierarchical`'s manager allocates by role match, LLM-driven; `allow_delegation` is a static flag. | Pure hierarchical, sequential by default; no peer consensus. | A (official docs) |
| OpenAI Agents SDK | Handoffs exposed to the model as tools; model decides when to transfer. | Flat peer-to-peer handoff graph; no supervisor-of-supervisors. | A (docs) / C (community flakiness reports) |
| Academic RL routers (Router-R1, xRouter, ParetoBandit) | Do use RL/bandit policies for model/agent selection; ParetoBandit targets non-stationary quality drift via geometric forgetting. | N/A — single-decision routing, not multi-agent topology. | C (arXiv preprints, no shipped-product evidence) |

Why every shipped framework's "RL-based dispatch" row reads thin: this is solved-in-research, deliberately-avoided-in-shipped-product, not an overlooked gap. Three converging reasons, each independently cited: (1) agent rosters change at runtime in all four frameworks, and a fixed shipped product can't easily retrain online without also shipping drift-detection — a zero-shot LLM router needs no training pipeline and adapts instantly to a new agent. (2) The Reward Hacking Benchmark (arXiv 2605.02964) found RL post-training *increases* exploit rates in tool-using agents, and RerouteGuard (arXiv 2601.21380) showed routers can be adversarially hijacked toward worse targets — stacking a reward-maximizing router into an already-hackable orchestration layer compounds both risks. (3) All four route via one extra cheap LLM call rather than a trained policy needing logged trajectories and a retraining cadence — favorable cost/complexity trade given (1) and (2). Separately, none of the four implement Raft/Byzantine-style voting between agents at all (single authoritative decider in every case) — a genuine structural gap relative to Ruflo's consensus machinery, not a researched-and-rejected one.

## Hypothesis

> Given `QLearningRouter`'s `initialize()`, `route()`, and `update()` methods, when the dead `@ruvector/core` native-engine probe and its `ruvectorEngine` field are removed (keeping `useNative` as a documented, permanently-false constant), then the source should no longer reference the unreachable package and all routing outputs should remain byte-identical to before, subject to: zero change to `route()`/`update()` decision outputs for any input, zero change to the existing 45-test suite's assertions, and a new discriminating test proving the dead probe is actually gone (not just claimed gone).

Frozen before evaluation; not modified after.

## Benchmarks

Vitest 4.1.8, `@claude-flow/cli`, run against `src/` directly (`@claude-flow/cli-core` built first — pre-existing unbuilt-workspace gap, not evaluation-affecting).

- **Baseline** (`git stash` isolating only the source file, new test file kept): the new discriminating test (`should not dynamically import @ruvector/core (dead probe removed)`) fails exactly as predicted — baseline source still contains the literal import call. 46/47 pass.
- **Candidate**: 47/47 pass. Targeted related suite (`__tests__/ruvector/`, `memory-ruvector-deep`, `single-command-flag-keys`, `bug-cluster-2219-2226`, `q-state-encoder-2239`): candidate 437 passed/52 skipped (489 total) vs. baseline 435 passed/52 skipped (487 total) — the +2 is exactly the 2 new tests, 0 regressions. One unrelated pre-existing file failure (flash-attention/Vite package resolution) reproduces identically on both sides.
- `tsc --noEmit -p .`: 19 pre-existing errors both ways, byte-identical (all `@claude-flow/neural`/`@claude-flow/memory` unbuilt-module errors, none in the 2 changed files).
- `harness mcp-scan`: 3 findings (2 medium risky-bash-allow, 1 low unpinned-deps), 0 high — same as every recent night, diff touches no `.claude/settings.json`/MCP policy surface.
- Independent adversarial critique (fresh context): own stash/pop cycle reproducing the baseline-fails/candidate-passes result independently, own `require.resolve('@ruvector/core')` check (confirmed unreachable), own full targeted-suite run (437 passed/52 skipped, identical to the primary run), own `tsc --noEmit` run (19 pre-existing errors, none in the 2 changed files). Verdict: **CONFIRMED-WITH-CAVEATS** — 1 non-blocking caveat disclosed: the new static source-guard test (regex over the dynamic-import call) is a narrow regression guard, bypassable in principle by a differently-worded reintroduction (`require()`, string concatenation, a re-export elsewhere) — acceptable given `vitest.config.ts`'s `externalize-optional-deps` plugin prevents `vi.mock` from intercepting this specific dynamic import at all, but tracked here rather than left silent.

## Darwin Results

**Skipped — binary guard, no tunable parameter**, same precedent as 2026-11-14/2026-11-23. This is dead-code removal (do the probe or don't); there is no continuous parameter space to sweep.

## SOTA Proof & Witness

```
Session commit:   e2e036c0dbeba3deba99249f2df42f049159b931
Candidate commit: c04ad593edec03cb0c8866c315e1537565538dde
Gist SHA-256 (pre-witness): a8a0f16fa8d74e7f8a728995ca4a173374c3c1a1a4b1abcb9dc72ecbbb270973
Witness stamp:    c87edd850948cafb18eba86c2e8bd386b0a9beb9bb625e8b9690461db112386f
```
Verifier: fetch this file from the branch, replace the Witness block's three dynamic values with the literal text `PENDING`, SHA-256 the result, concatenate with the Session commit above, SHA-256 again — must equal the Witness stamp.

Evaluation receipt identity: `v3/@claude-flow/cli/__tests__/ruvector/q-learning-router.test.ts` at the candidate commit. Flywheel evidence identity: this issue/PR + the independent adversarial critique. No Darwin lineage (skipped, binary guard).

## Recommended Next Steps

1. **Do not re-attempt "point the probe at the right package" as a same-night fix.** Confirmed independently by two research roles tonight: `@claude-flow/neural`'s `createQLearning` (the only real, installed, working Q-learning implementation in this monorepo) uses an incompatible trajectory-batch API (`update(trajectory: Trajectory)`, `Float32Array` states) versus `QLearningRouter`'s string-keyed, per-call `route()`/`update()` API. A real wire-up needs an adapter layer (context→embedding, action-index↔route-name mapping, batch/flush trajectories) — a genuine future-night design candidate, not a swap.
2. **`ByzantineConsensus`'s PBFT commit-message path bypasses its own per-voter weighting** (`byzantine.ts:361-419`, explicit in-code `KNOWN LIMITATION` since 2026-08-24, never closed) — raw `prepareCount`/commit-count quorum ignores `voteWeight` entirely, so a weighted-minority Byzantine cluster could satisfy quorum on message count alone. Directly matches CP-WBFT's (arXiv 2511.10400) confidence-weighted-consensus framing. Scored 4.15/5 tonight (second-highest of 5 candidates) — strong candidate for a near-future `swarm`/security night; not fixed tonight to keep this patch small and reviewable.
3. **`TaskOrchestrator.getNextTask()` has no load/performance-aware tie-break** among capability-matching agents — pure static-priority + FIFO, with no historical-success-rate or latency signal feeding dispatch, unlike 2026 contextual-bandit task routers (TRACE-Router, arXiv 2607.22465; MTRouter, arXiv 2604.23530). Medium patch size, needs a small simulated-workload benchmark to evaluate — disclosed, not attempted tonight (budget: research depth protected over breadth per STEP 0.6 v3.1).
