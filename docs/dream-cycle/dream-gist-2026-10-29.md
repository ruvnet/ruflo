# Swarm SOTA Report — 2026-10-29

**TL;DR**: 2026 multi-agent frameworks (LangGraph, AutoGen→MS Agent Framework, CrewAI, OpenAI Agents SDK) still have no analogue to real distributed-systems consensus for agent coordination — a genuine, still-open Ruflo differentiator. A UC Berkeley NeurIPS 2025 study of 1,642 multi-agent traces found 41–86.7% failure rates, mostly coordination/design bugs not model errors — exactly the failure class five straight swarm-surface nights have hardened one bug at a time. Tonight: `agent_spawn` never enforced `swarm.maxAgents` — root CLAUDE.md's own anti-drift cap ("Keep maxAgents at 6-8... smaller team = less drift") was silently unenforceable for every real swarm. Fixed with a 45-line patch mirroring the sibling `team_spawn` tool's existing refusal.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| AdaptOrch: dynamically selects among 4 canonical topologies per task-dependency-graph; argues topology now matters more than model choice | arXiv 2602.16873 (Feb 2026) | B |
| Agent Q-Mix: frames topology selection as cooperative MARL (QMIX value factorization) over per-round communication graphs | arXiv 2604.00344 (2026) | B |
| DynaSwarm: RL-discovered per-instance agent connection patterns, controller selects graph topology per task instance | arXiv 2507.23261 (2025) | B |
| UC Berkeley study (NeurIPS 2025, via Splunk 2025 writeup): 1,642 multi-agent traces across 7 frameworks, 41–86.7% failure rates, mostly coordination/design bugs not model errors | NeurIPS 2025 / Splunk | B |
| RAFT security analysis covers message-replay/forgery, not quorum-arithmetic/vote-counting correctness (the bug class fixed 2026-10-24) | arXiv 2601.00273 (Jan 2026) | B |

No 2026 paper targets vote-quorum arithmetic specifically — a genuinely thin result, not a gap: standard Raft texts already specify ceiling-based majority, so getting the arithmetic right isn't paper-worthy. Ruflo's 10-24 fix already matches what the literature treats as a non-issue.

## Ruflo Current Capability

`v3/@claude-flow/swarm/` has real, previously-hardened coordination machinery: `RaftConsensus` (quorum fixed 10-24), `MessageBus` (busy-poll fixed 09-30), `UnifiedSwarmCoordinator` (busy-poll fixed 09-20), `TopologyManager` (leader-promotion fixed 10-19). Root CLAUDE.md documents `byzantine`/`raft`/`gossip`/`crdt`/`quorum` strategies and an "Anti-Drift Coding Swarm" contract capping `maxAgents` at 6-8. Tonight found the one piece of that contract never enforced at runtime: `swarm_init`'s `maxAgents` was stored but never checked by `agent_spawn`.

## Competitor Comparison

| Competitor | Mechanism | Fault-tolerant consensus (Raft/Byzantine/gossip)? | Grade |
|---|---|---|---|
| LangGraph | Single supervisor routes to specialist subagents over shared graph state | None — supervisor is an explicit single point of coordination | B |
| AutoGen → MS Agent Framework | GroupChat conversational agreement; Agent Framework 1.0 GA (Apr 2026) adds checkpointing/pause-resume, no distributed protocol | None — "consensus" means LLM-agent agreement, not a distributed-systems protocol | B |
| CrewAI | Role-based Crews + Flow hierarchical structuring | None found | C |
| OpenAI Agents SDK | Explicit handoffs; durability delegated to an external engine (e.g. Temporal) | None — recommended pattern is an external durable-execution engine | B |

**Why every row reads "none"**: genuine architectural gap, not deliberate avoidance. These frameworks target a single orchestrator process (or single durable workflow) calling LLM APIs — the failure mode they design against is that process dying, not a cluster of independent nodes needing to agree on shared state under partition/Byzantine conditions. None of the big four model multiple independent orchestrator nodes, so Raft/BFT/gossip-style agreement doesn't arise as a problem for them yet. Nothing in the last 12 months closes this gap — still a real Ruflo differentiator, not a stale claim.

## Hypothesis

> Given a swarm created via `swarm_init` with `maxAgents=N` (clamped 1-50), when `agent_spawn` is called to add an (N+1)th agent to that swarm (explicit `swarmId`, no `agentId` collision), then the call should be refused with `success:false` and an `"is full (maxAgents=N)"` error — mirroring `team_spawn`'s existing refusal in `grok-team-bus.mjs` — instead of baseline's unconditional `swarm.agents.push()`, subject to: idempotent retries of an already-registered `agentId` still succeed, spawning with no swarmId / no existing swarms is unaffected, spawning into a different, non-full swarm is unaffected, zero regression to the existing `agent_spawn`/`agent_list`/`swarm_status` test suites, deterministic $0 Vitest evaluation. Frozen before evaluation; not modified after.

## Benchmarks

No agent-task benchmark corpus applies — this is a correctness/capacity-enforcement fix to an MCP tool handler, evaluated via discriminating Vitest tests (stash-isolated baseline-fails/candidate-passes), consistent with this repo's convention for non-routing/non-topology fixes. `.harness/bench.json` does not exist in this checkout.

## Evaluation

**evaluated: accepted — ACCEPT.** Real evaluator: Vitest 4.1.8, package `@claude-flow/cli` (required building the sibling `@claude-flow/cli-core` workspace package first — `dist/` was missing, confirmed pre-existing/environmental, not caused by this change).

`v3/@claude-flow/cli/src/mcp-tools/agent-tools.ts`'s `agent_spawn` handler hoists the swarm-roster resolution (same explicit-`swarmId`-or-latest-swarm logic that already existed for the best-effort roster push) to *before* any store write, and refuses the call when the resolved swarm's `agents.length >= maxAgents` and the `agentId` isn't already a member. The later roster push reuses the same already-loaded store object (no second load, no new race window beyond what already existed).

6 new tests in `agent-spawn-maxagents-cap.test.ts` (2 discriminating, 4 controls). Stash-isolated baseline (`agent-tools.ts` reverted via `git stash`): the 2 discriminating tests fail exactly as predicted (3rd agent into a `maxAgents=2` swarm succeeds on baseline instead of being refused); all 4 controls pass on baseline too, confirming the test file itself isn't just broken outright. Candidate: 6/6 pass.

Wider related-suite run (agent-spawn/agent-registry/agent-provider, 30 tests/6 files): 30/30 pass unaffected. 3 other files fail identically baseline vs. candidate (confirmed via a second stash cycle) — all unbuilt-sibling-package resolution errors (`@claude-flow/neural`, `@claude-flow/aidefence`, the CLI's own unbuilt `dist/`), the same documented environmental class noted by several prior nights, unrelated to this diff. `tsc --noEmit`: 27 pre-existing errors, none referencing `agent-tools.ts`/`swarm-tools.ts`.

**Independent adversarial critique** (fresh context, no authoring trust, own stash/pop reproduction): **CONFIRMED-WITH-CAVEATS, no blocking issues.** Two non-blocking findings, both disclosed rather than fixed:
1. **Pre-existing, not introduced by this fix**: `src/commands/agent.ts`'s `agent spawn` CLI handler never checks `result.success` before printing a result table — on refusal it prints a table with `undefined` fields instead of a clean error. This already affected every other `agent_spawn` failure path (bad `agentType`, bad `name`, etc.); this fix adds one more way to trigger it but doesn't introduce the gap. Future-night candidate for `agent.ts`, out of scope here.
2. **TOCTOU race, not new**: the load-check-write sequence on the swarm store isn't atomic — two concurrent `agent_spawn` calls could both pass the capacity check against the same stale snapshot and both write, overshooting `maxAgents` by more than one. No file-locking/CAS guarantee exists anywhere in this file for the swarm store (unlike the global agent store, which has its own concurrency tests). Disclosed in-source as a KNOWN LIMITATION comment. Going from "never enforced" to "enforced except under rare concurrent overshoot" is still a strict improvement, not a regression.

Also confirmed: no existing test combined `agent_spawn` with `swarm_init`/`swarmId` (consistent with the bug going unnoticed), and the "default to latest swarm" ambiguity predates this fix — the only behavior change is a full "latest" swarm now correctly refusing instead of silently overshooting.

## Darwin Results

Skipped — binary capacity-refusal fix (a check either exists or doesn't), not a continuous/categorical parameter Darwin's interface can search over. Same skip class as nearly every ACCEPT here that wasn't a routing/topology weight.

## SOTA Proof & Witness

Session commit:   89b0cd02dd99ea1f63437fde6c05992ec53cc22b
Candidate commit: 531d0a3f790d518140d109a7b02a599fe208f87c
Gist SHA-256 (pre-witness, this block held to the literal text `PENDING`): f6cbcff0533b87f961d371d9ce614040a267e94cf483952699937814b512963d
Witness stamp:    1725917a3bcea1d7bd3b676b35ada5794a8b586fed73c75851a910d46535aca9

Verifier: fetch this file, replace this block's four filled-in values with the literal text `PENDING` (as it was before this computation), SHA-256 the result, concatenate with the Session commit above, SHA-256 again — must equal the Witness stamp.

Evaluation receipt identity: 6 new tests in `agent-spawn-maxagents-cap.test.ts` (2 discriminating, 4 controls), stash-isolated 2/2-fail-baseline → 6/6-pass-candidate, independently reproduced by a fresh-context adversarial critic via its own stash/pop cycle. Flywheel evidence identity: none (`.claude-flow/flywheel/` doesn't exist in this repo, confirmed, same as every prior night). Darwin lineage identity: none (skipped — binary correctness fix).

## Recommended Next Steps

1. **Carried-forward candidate (scored 3.95/5, deferred tonight)**: `v3/@claude-flow/cli/src/ruvector/q-learning-router.ts`'s `createQLearning()` probe targets `@ruvector/core` (a real but wrong-domain vector-DB package that has never exported `createQLearning`, and isn't even a declared dependency) — `useNative` can never be `true`. A real, correct, unused `createQLearning()` already exists in-repo at `v3/@claude-flow/neural/src/algorithms/q-learning.ts:331`. Either wire it in or delete the dead probe; strong candidate for a future night.
2. **Doc/governance correction, not a code fix**: 10-24's ledger entry characterized `v3/@claude-flow/security/src/policy/product-plane.ts` (ruview-integration) as "fully orphaned" — tonight's scan confirmed zero in-repo call sites but found ADR-326 explicitly designs it as a cross-repository claim-federation schema for external Cognitum/Comms/AgentBBS/RuView-edge consumers that don't exist in production yet. The real gap is "no production federation PEP exists anywhere" (ADR-326's own table), a cross-repo question, not orphaned Ruflo code. Future nights should use the corrected framing.
3. **`graph-analyzer.ts`'s dead `hooks_graph_mincut`/`hooks_graph_cluster` checks remain unresolved** (5th consecutive night to note this: 10-09, 10-10, 10-14, 10-24, now 10-29) — real `ruvector@0.2.27` exports are `minCut`/`louvainCommunities`/`buildGraph` (camelCase, no prefix). STEP 1.1 duplicate-direction rule applied: NOT selected tonight, and 10-15 already showed wiring it in has no perf upside (plain JS, not native) — lowest-scored candidate tonight (2.30/5). Future nights should treat this as closed REJECT-with-evidence, not a fresh finding.
4. **`TopologyManager.updatePartitions()` ignores `config.partitionStrategy`** (`hash`/`range`/`round-robin` declared, threaded through 3 call sites, never read — line ~450 is pure round-robin-by-count regardless) — scored 3.75/5, a smaller/cleaner candidate than tonight's winner; good next-swarm-night pick if nothing higher-value surfaces first.
