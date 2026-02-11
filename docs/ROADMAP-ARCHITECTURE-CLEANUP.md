# Architecture Cleanup Roadmap

## Thesis

claude-flow has a solid core: CLI with lazy-loading, MCP server with multiple transports, hybrid memory backend with HNSW search, and typed agent coordination. What's hurting it is 1.5MB of context overhead (115 agent files, 41 skill directories, 37KB CLAUDE.md), 22 packages that should be 6, a 130MB dead V2 directory, and naming that promises distributed systems / neural networks when the code implements pattern caching and in-process voting.

This roadmap strips it down to what's real, consolidates what's fragmented, and makes the good parts excellent.

---

## The Numbers

| What | Current | Target | Why |
|------|---------|--------|-----|
| CLAUDE.md | 37KB (1,034 lines) | ~7KB (~200 lines) | Every agent spawn pays this token cost |
| Agent definitions | 115 files, 912KB | ~10 files, ~40KB | Most are identical prompts with different names |
| Skill definitions | 41 dirs, 593KB | ~12 dirs, ~80KB | 150+ skill entries in system prompt per session |
| V3 packages | 22 | 6 | Build/dependency overhead, version alignment pain |
| Agent types (code) | 10 real, 60+ claimed | 10 real, 10 documented | Honest surface area |
| V2 directory | 130MB, 434 files | 0 (archived) | Dead weight in every clone |
| Consensus naming | "Byzantine Fault Tolerant" | "Coordination Protocol" | Matches what the code does |
| Neural naming | "SONA Neural Architecture" | "Pattern Learning Cache" | No gradient computation exists |

---

## Phase 1: Context Diet (Week 1-2)

**Goal:** Cut per-session token overhead by 70%+. This is the highest-ROI change because it saves money and improves quality on every single interaction.

### 1.1 Rewrite CLAUDE.md (37KB -> ~7KB)

Keep only:
- Behavioral rules (the "do what's asked, nothing more" section) — ~20 lines
- File organization rules — ~10 lines
- Key packages table (6 rows, not 22) — ~15 lines
- Agent type table (the real 10, not 60+) — ~15 lines
- Concurrency rules — ~10 lines
- Git/environment config — ~15 lines
- Quick CLI examples (5 commands, not 30) — ~10 lines

Delete entirely:
- Swarm protocol templates (move to `/docs/swarm-protocols.md`)
- Dual-mode Codex collaboration (move to `/docs/dual-mode.md`)
- Publishing instructions (move to `/docs/publishing.md`)
- Plugin registry maintenance (move to `/docs/plugin-registry.md`)
- Hook system details (move to `/docs/hooks.md`)
- Intelligence system description (move to `/docs/intelligence.md`)
- Performance targets table (move to `/docs/performance.md`)
- Agent Teams documentation (move to `/docs/agent-teams.md`)
- V3 CLI command tables (already in `--help`)
- Headless background instances docs (move to `/docs/headless.md`)
- Environment variables (move to `/docs/configuration.md`)

**Principle:** CLAUDE.md should contain only rules that apply to EVERY interaction. Reference docs should be in `/docs/` where agents can read them on-demand.

### 1.2 Consolidate Agent Definitions (115 files -> ~10)

Current state: 35 top-level directories/files in `.claude/agents/`, expanding to 115 files. Most define agents that differ only in their system prompt prefix.

Keep (genuinely distinct capabilities):
1. `coder` — writes code
2. `reviewer` — reviews code for quality/security
3. `tester` — writes and runs tests
4. `researcher` — explores codebase, gathers information
5. `architect` — designs systems, makes structural decisions
6. `coordinator` — orchestrates other agents
7. `security` — security-specific analysis
8. `performance` — profiling and optimization
9. `devops` — CI/CD, deployment, infrastructure
10. `custom` — user-defined with inline prompt

Delete everything else. "byzantine-coordinator", "gossip-coordinator", "mesh-coordinator", "adaptive-coordinator", "hierarchical-coordinator", "collective-intelligence-coordinator", "swarm-memory-manager" — these are all "coordinator" with different prompts. Same for the 5+ testing variants, 4+ security variants, etc.

### 1.3 Consolidate Skills (41 dirs -> ~12)

Keep:
1. `sparc` — SPARC methodology (merge all sparc:* sub-skills into one)
2. `swarm` — swarm orchestration (merge swarm:*, coordination:*, hive-mind:*)
3. `github` — GitHub operations (merge all github:* sub-skills)
4. `memory` — memory operations (merge memory:*, agentdb-*)
5. `testing` — test workflows
6. `analysis` — performance/token analysis (merge analysis:*, performance-*)
7. `hooks` — hook management (merge hooks:*)
8. `pair` — pair programming
9. `monitoring` — system monitoring (merge monitoring:*)
10. `flow-nexus` — Flow Nexus platform (merge all flow-nexus:*)
11. `training` — neural/pattern training (merge training:*, reasoningbank-*)
12. `automation` — workflow automation (merge automation:*, optimization:*)

Delete: `agentic-jujutsu`, `stream-chain`, `verification-quality`, `skill-builder`, `worker-benchmarks`, `worker-integration`, `dual-mode`

**Merge pattern:** Each consolidated skill gets one entry file with subcommands, not 8 separate skill registrations that each burn a line in the system prompt.

### 1.4 Archive V2

```bash
git rm -r v2/
# Or if you want to keep history accessible:
git subtree split -P v2/ -b v2-archive
git rm -r v2/
```

This removes 130MB and 434 files from every clone. Anyone who needs V2 can check out the archive branch.

---

## Phase 2: Honest Naming (Week 2-3)

**Goal:** Make the code describe what it actually does, not what it aspires to be.

### 2.1 Consensus -> Coordination

| Current | Rename To | Reason |
|---------|-----------|--------|
| `ByzantineConsensus` | `QuorumCoordinator` | No network, no crash recovery, no partitions |
| `RaftConsensus` | `LeaderElectionCoordinator` | No log replication, no snapshotting |
| `GossipConsensus` | `EventualSyncCoordinator` | No epidemic protocol, just fan-out |
| `src/consensus/` | `src/coordination/` | Directory rename |

The implementations are fine for what they do — in-process agent voting and task routing. The names just shouldn't claim to be distributed systems primitives.

### 2.2 Neural -> Pattern Learning

| Current | Rename To | Reason |
|---------|-----------|--------|
| `SONAManager` | `PatternLearningManager` | No neural weights, no gradient descent |
| `RealTimeMode` | `FastCacheMode` | It's a pattern cache with Float32Array similarity |
| `BalancedMode` | `StandardMode` | Config variant, not a different architecture |
| `ResearchMode` | `ThoroughMode` | Runs more iterations, not a different algorithm |
| `@claude-flow/neural` | `@claude-flow/patterns` | Package rename |

### 2.3 Remove Unmeasured Performance Claims

Delete from all docs and comments:
- "150x-12,500x faster" (no benchmark exists)
- "2200 ops/sec" (comment target, not measurement)
- "<0.05ms adaptation" (aspirational)
- "2.49x-7.47x Flash Attention speedup" (not implemented)

Replace with: actual benchmarks, or nothing. Add a `/benchmarks` directory with real measurements. If you can't measure it, don't claim it.

---

## Phase 3: Package Consolidation (Week 3-5)

**Goal:** 22 packages -> 6. Less build overhead, simpler dependency graph, easier to maintain.

### Target Structure

```
v3/
  @claude-flow/
    core/           # shared + claims + security + providers + aidefence
    cli/            # keep as-is (it's the entry point)
    agents/         # swarm + patterns(neural) + hooks + coordination
    memory/         # memory + embeddings
    integrations/   # codex + mcp + browser + deployment
    plugins/        # plugins + guidance + testing framework
```

### Migration Strategy

For each merge:
1. Move source files into the target package's `src/` under a subdirectory
2. Update internal imports (find/replace package names)
3. Re-export public API from the target package's `index.ts`
4. Add path aliases in `tsconfig.json` for backwards compatibility during transition
5. Delete the old package directory
6. Update root `package.json` workspaces

### Specific Merges

**`@claude-flow/core`** absorbs:
- `shared/` (types, interfaces, utilities) -> `core/src/types/`
- `claims/` (authorization) -> `core/src/auth/`
- `security/` (validation, CVE) -> `core/src/security/`
- `providers/` (AI provider management) -> `core/src/providers/`
- `aidefence/` (defense layer) -> `core/src/security/defence/`

**`@claude-flow/agents`** absorbs:
- `swarm/` (coordination) -> `agents/src/swarm/`
- `neural/` -> renamed `agents/src/patterns/`
- `hooks/` (lifecycle hooks) -> `agents/src/hooks/`

**`@claude-flow/memory`** absorbs:
- `embeddings/` -> `memory/src/embeddings/`

**`@claude-flow/integrations`** absorbs:
- `codex/` -> `integrations/src/codex/`
- `mcp/` -> `integrations/src/mcp/`
- `browser/` -> `integrations/src/browser/`
- `deployment/` -> `integrations/src/deployment/`

**`@claude-flow/plugins`** absorbs:
- `guidance/` -> `plugins/src/guidance/`
- `testing/` -> `plugins/src/testing/`

### What NOT to Merge

`@claude-flow/cli` stays separate. It's the entry point, has its own binary, and has the largest codebase. Merging it would make everything worse.

---

## Phase 4: Depth Over Breadth (Week 5-8)

**Goal:** Make 4 things excellent instead of 20 things mediocre.

### 4.1 Memory System — Make It Best-in-Class

The hybrid SQLite + AgentDB backend with HNSW is the most genuinely useful and differentiated feature. Invest here:

- **Add real benchmarks:** Measure actual search latency across dataset sizes (100, 1K, 10K, 100K entries). Put results in `/benchmarks/memory/`.
- **Add persistence reliability tests:** Crash recovery, concurrent writes, data integrity under load.
- **Add a migration path:** Users upgrading from v2 need automatic data migration.
- **Document the API properly:** The memory module deserves real API docs with examples, not marketing copy.
- **Add TTL/expiry:** Agent memories should have configurable lifetimes.

### 4.2 MCP Server — Production Harden

The MCP server is the integration point with Claude Code and other tools. It needs to be bulletproof:

- **Add connection lifecycle tests:** What happens when a client disconnects mid-operation?
- **Add rate limiting:** Prevent runaway agents from overwhelming the server.
- **Add health checks:** The server should expose a health endpoint.
- **Add structured logging:** JSON logs with correlation IDs for debugging multi-agent sessions.
- **Test with real Claude Code sessions:** Automated integration tests, not just unit tests.

### 4.3 Agent Coordination — Simple and Reliable

Strip the coordination to its essence: spawn agents, assign tasks, collect results, handle failures.

- **Remove consensus complexity:** One coordination protocol (leader-based, since that's what "hierarchical" already is). Delete Byzantine, Gossip, CRDT, Quorum as separate implementations.
- **Add retry/timeout handling:** What happens when an agent hangs? Currently unclear.
- **Add resource limits:** Memory and CPU caps per agent to prevent runaway processes.
- **Add observability:** Structured events for agent lifecycle (spawned, started, completed, failed, timed out).

### 4.4 CLI — Polish the UX

The lazy-loading architecture is good. Now make it pleasant to use:

- **Cut commands from 26 to ~15:** Merge overlapping commands (e.g., `neural` into `memory`, `process` into `daemon`, `claims` into `config`).
- **Add `--dry-run` everywhere:** Let users preview what a command will do before doing it.
- **Improve error messages:** Specific, actionable errors with fix suggestions.
- **Add shell completions that work:** Test on bash, zsh, fish with real scenarios.

---

## Phase 5: Testing Reality Check (Week 6-8, parallel with Phase 4)

### 5.1 Audit Existing Tests

181 test files exist, but the question is: do they test behavior or just structure?

- Run the full test suite. How many pass? How many are skipped?
- Measure actual code coverage with `vitest --coverage`.
- Identify tests that test implementation details vs. tests that test behavior.
- Delete tests that just assert "constructor doesn't throw" or "method exists".

### 5.2 Add Integration Tests

The biggest gap is likely integration testing — does the CLI actually work end-to-end?

Priority integration tests:
1. `claude-flow init` -> creates a working project
2. `claude-flow agent spawn` -> agent runs and produces output
3. `claude-flow memory store` + `memory search` -> round-trip works
4. `claude-flow mcp start` -> server accepts connections
5. `claude-flow swarm init` + agent coordination -> multi-agent task completes

### 5.3 Add Performance Tests

If you're going to keep any performance claims, measure them:
- Memory search latency at various dataset sizes
- CLI startup time (cold and warm)
- MCP server response time under load
- Agent spawn time

---

## What To Skip / Not Build

Things in the current codebase that I'd explicitly NOT invest in:

| Feature | Why Skip |
|---------|----------|
| Flash Attention integration | You're orchestrating LLM API calls, not running inference. Attention optimization is irrelevant. |
| EWC++ (Elastic Weight Consolidation) | No weights to consolidate. The pattern cache doesn't need catastrophic forgetting prevention. |
| LoRA fine-tuning | Not running local models. If you add this later, it belongs in a separate package. |
| SONA <0.05ms adaptation | The bottleneck is LLM API latency (seconds), not local computation (microseconds). |
| Dual-mode Codex collaboration | OpenAI Codex is discontinued. This is dead code. |
| Plugin IPFS registry | Interesting idea, but premature. Use npm for distribution until you have >50 community plugins. |
| Byzantine fault tolerance | Your agents aren't malicious. Leader-based coordination is sufficient. |
| CRDT synchronization | No distributed state to synchronize. Agents share memory through a central store. |
| Gossip protocol | No network partition to handle. Everything runs in one process or one machine. |
| 20 optional plugins (healthcare, legal, financial) | Zero implementations behind the registry entries. Focus on core before verticals. |
| Hyperbolic embeddings | Interesting math, no practical benefit over cosine similarity for this use case. |

---

## Is It Worth Building?

**Yes, with conditions.**

The core loop — "I tell Claude to do a complex task, it spawns specialized sub-agents that coordinate through shared memory and report back" — is genuinely useful. No one else does this well. The MCP integration means it plugs into the Claude Code ecosystem natively.

What makes it worth building:
1. **Real problem:** Multi-agent coordination for software engineering tasks is unsolved and valuable.
2. **Right platform:** MCP + Claude Code is where the ecosystem is going. Being a native orchestration layer here is a strong position.
3. **Working foundation:** The CLI, MCP server, and memory system aren't stubs — they're functional and reasonably well-typed.

What makes it NOT worth building if you don't clean up:
1. **Context tax:** 1.5MB of definitions means every interaction is slower and more expensive than it needs to be. Agents get worse because they're drowning in irrelevant context.
2. **Credibility gap:** Claiming Byzantine fault tolerance and neural network training when you have in-process voting and a pattern cache will lose you technical users the moment they read the source.
3. **Maintenance burden:** 22 packages, 115 agent files, 41 skill directories — this is impossible for one person to maintain and test properly.

**The path:** Do Phases 1-2 first (2-3 weeks). That's the context diet and honest naming. If the project feels better to work with after that — and it will — continue to Phases 3-5. If not, you've at least made it honest and usable.

---

## Execution Order (Summary)

```
Week 1:  Rewrite CLAUDE.md (biggest single improvement)
Week 1:  Archive V2 directory
Week 2:  Consolidate agents (115 -> 10) and skills (41 -> 12)
Week 2:  Rename consensus -> coordination
Week 3:  Rename neural -> patterns, remove false claims
Week 3:  Start package consolidation (pick 2 merges)
Week 4:  Continue package consolidation
Week 5:  Finish package consolidation, fix all imports
Week 5:  Run full test suite, establish coverage baseline
Week 6:  Memory system depth work
Week 7:  MCP server hardening
Week 8:  Agent coordination simplification + CLI polish
```

Each week produces a shippable state. No big-bang rewrite.
