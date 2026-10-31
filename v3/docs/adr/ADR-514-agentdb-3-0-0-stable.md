# ADR 514: adopt agentdb 3.0.0, the first stable AgentDB

Status: Accepted (ruflo 3.67.0)

Issue: #4625. Builds on: ADR-513 (stable versions, one dependency tree). Related: #3327 Finding A (ReasoningBank embedder), #4622 (lock reason).

## 1. Context

ruflo's memory layer (`@claude-flow/memory` ControllerRegistry, the CLI memory bridge) runs on `agentdb`. Through the CLI, memory and neural, ruflo declared `^3.0.0-alpha.20`. agentdb had never shipped a stable 3.x.

Four reviews were run on agentdb 3.0.0-alpha.20: security, integration, self-learning and performance. Every finding below is confirmed by a regression test that fails on the base commit.

### 1.1 Bugs that reached ruflo

- **The default vector backend returned nothing.** The factory picks `RuVectorBackend` first. It did not await `VectorDB.search()`, read `distance` where the native result carries `score`, and called `remove`, `count`, `save`, `load` and `setEfSearch`, none of which `VectorDB` has. It passed HNSW options in a shape the library ignores, and shared one `./ruvector.db` across every instance in the cwd. `getController('reflexion'|'skills'|'causalGraph')` therefore searched an index that answered `[]`, with no SQL fallback.
- **Episodes and skills shared one index.** Ids were `"123"` and `"skill:N"`, and SkillLibrary parsed `skill:` off the id, so episode 1 loaded as skill 1.
- **LearningSystem never saved what it learned.** `submitFeedback` built an updated policy and dropped it, so Q-values stayed at 0.
- **ruflo built controllers without an embedder.** The registry constructed LearningSystem, NightlyLearner, ExplainableRecall and the graph transformer's CausalMemoryGraph with only the database. They take `(db, embedder, …)`, so their first call threw on `this.embedder`. This is the #3327 Finding A defect class, previously fixed for ReasoningBank only. That half is fixed in ruflo (`controller-registry.ts`). The test runs against the real agentdb package and fails on the old source.
- **Short-lived processes hung.** `ReasoningBank.getPatternStats()` scheduled a 5-minute cache-expiry `setTimeout` without `unref()`, so `ruflo autopilot learn` printed its answer and then stayed alive for exactly 5 minutes. This was found by the fresh-install gate (§3) and traced with `async_hooks`. Five more library timers had the same shape.
- **Library logs on stdout.** `[AgentDB] …` diagnostics went to stdout. Under a stdio MCP server that is the JSON-RPC stream. ruflo's registry suppressed them during its own init, but any other code path that constructs AgentDB leaked them; the new agentic-flow autopilot service is one.

### 1.2 Security

- **`agentdb_init` deleted arbitrary files** (standalone agentdb MCP server). It called `unlinkSync` on a caller-supplied `db_path`, and the default tool policy allowed every tool. ruflo never starts that server, but direct users do.
- **SQL injection through filter object keys** in `HNSWIndex`, `WASMVectorSearch` and `MetadataFilter`. These are exported APIs; nothing passes attacker input to them today.
- **Model cache in shared `/tmp/agentdb-models` with no ownership check.** On a shared host, another user could plant the embedding model ruflo loads. This is the only finding ruflo itself reached.
- **Smaller findings:**
  - `.rvf` model extraction wrote outside its directory.
  - `LLMRouter` loaded `.env` files implicitly, including a hardcoded `/workspaces/agentic-flow/.env`.
  - The PRAGMA validator checked only the first token.
  - Cypher queries spliced in unchecked numbers.
  - The QUIC CLI bound `0.0.0.0` with a `Math.random` token that it then printed.
  - The OpenTelemetry advisories (`propagator-jaeger` <2.9, `core` <2.8).

## 2. Decision

Publish agentdb **3.0.0** from main with every fix above, as the first stable 3.x. It goes to `latest` only; the `alpha` and `next` dist-tags stay where they are (ADR-513).

- ruflo's existing ranges already admit 3.0.0: `^3.0.0-alpha.20` in the CLI and memory, `^2.0.0 || ^3.0.0-alpha.1` in neural, `>=2.0.0-alpha.1` in aidefence. No leaf needs a range change. aidefence's optional peer now matches the hoisted copy, so the second AgentDB disappears (ADR-513 §1.1).
- Breaking for direct agentdb users, listed in its CHANGELOG:
  - `RuVectorBackend.search()` is async-only (use `searchAsync` or `searchVectors`).
  - `RvfBackend.freeze()` and three `NativeAccelerator` methods return promises.
  - The MCP server's default profile is `learning`; init, delete and clear-cache need `AGENTDB_MCP_PROFILE=admin`.
  - QUIC requires a token and binds loopback.
  - `AgentDB.close()` also closes the vector backend.
  - None of these are called by ruflo: its memory code goes through controllers, which now use `searchVectors()`.
- ruflo now captures the `[AgentDB] Reason:` line from `console.error` as well as `console.log`, because agentdb moves library diagnostics off stdout.

## 3. Verification

**agentdb's own tests.** Every new test fails on the base commit and passes at head. The targeted set is 452/452. agentdb's full suite hangs past 45 minutes on the base commit too, so it is not a usable gate.

**Fresh-install gate.** `npm install ruflo@3.66.2` with root `overrides` pointing at the candidate tarballs:

| check | result |
|---|---|
| `npm ls agentdb --all` | one copy, 3.0.0 (was 3.0.0-alpha.20 + 2.0.0-alpha.3.7 + 1.6.1) |
| `npm audit --omit=dev` | 11 (0 critical / 8 high / 3 moderate), from 70 (1 / 17 / 52) |
| `ruflo doctor` | 29 passed, 0 failed |
| memory store / search | OK |
| `autopilot learn` | exits in 6 s (5 min before the timer fix) |
| stdio MCP `initialize` + `autopilot_learn` + `memory_search` | all answered. Before the logging fix, 2 non-JSON stdout lines appeared. |

**Performance (medians).**
- sql.js vector upsert, 20k rows: 85 → 35 ms.
- db-fallback scan, 40k rows: 45 → 21 ms (5 columns), 130 → 55 ms (16 columns).
- Skill lookup, 300 hits: 0.42 → 0.32 ms.

## 4. Not done

- `@ruvector/core` 0.1.30 HNSW misses results on very small graphs: 14/150 trials at M=8. The SQL fallback covers zero-hit searches, not partial misses. This will be reported upstream to ruvector; the defaults are unchanged.
- There is no pinned SHA-256 manifest for bundled models; only the per-asset hashes inside the `.rvf` are verified.
- `RvfBackend` still defaults its storage path to `./agentdb.rvf`.
- `@ruvector/attention` 2.x (a breaking rewrite) and the `ruvector` 0.3 line are left to a separate migration.
