# ADR-050: Intelligence Loop (Close the Memory Gap)

**Status**: Accepted
**Date**: 2026-02-09
**Authors**: Claude Flow Team

## Context

The memory system has three powerful modules — AutoMemoryBridge (storage), MemoryGraph (PageRank + community detection), LearningBridge (confidence tracking) — all shipped and tested (219 tests, published as `@claude-flow/memory@3.0.0-alpha.8`). But they are not wired into the hook system that runs during Claude Code sessions.

The result is a gap:

```
Record insight -> Store in AgentDB -> [GAP] -> Retrieve at right moment -> Better output
```

No active process builds graph edges, ranks knowledge by importance, injects ranked context into prompts, or feeds success/failure signals back. Hooks fire at exactly the right moments (session-restore, route, post-edit, session-end) but only do simple routing and metric counting.

## Decision

Add a CJS intelligence layer (`intelligence.js`) to the hook system with file-based graph persistence. This module is loaded by `hook-handler.cjs` via `safeRequire()` and provides five functions wired to existing hook events:

| Function | Hook | Budget | Purpose |
|----------|------|--------|---------|
| `init()` | session-restore | <200ms | Build graph, compute PageRank, write caches |
| `getContext(prompt)` | route | <15ms | Match prompt to ranked entries, return top-5 |
| `recordEdit(file)` | post-edit | <2ms | Append to pending-insights.jsonl |
| `feedback(success)` | post-task | <10ms | Boost/decay confidence for matched patterns |
| `consolidate()` | session-end | <500ms | Process insights, rebuild edges, recompute PageRank |

### Data Files

All under `.claude-flow/data/`:

- `auto-memory-store.json` (existing) — written by auto-memory-hook.mjs
- `graph-state.json` (new) — serialized graph: nodes + edges + pageRanks
- `ranked-context.json` (new) — pre-computed ranked entries for fast lookup
- `pending-insights.jsonl` (new) — append-only edit/task log

### Algorithms

Self-contained CJS implementations (~60 lines each):

- **PageRank**: Power iteration, damping=0.85, max 30 iterations
- **Jaccard similarity**: Word-trigram overlap with stop-word removal
- **Edge building**: Category grouping (temporal edges for same sourceFile), within-category Jaccard (similar edges if score > 0.3)

## Rationale

### Why CJS, not ESM?

Hooks are short-lived Node.js processes invoked by Claude Code. `hook-handler.cjs` uses `require()`. ESM dynamic `import()` is async and adds ~50ms overhead per invocation. The memory package (`@claude-flow/memory`) is ESM-only. The intelligence layer must be CJS for synchronous, fast loading.

### Why file-based persistence?

Each hook invocation is a separate process. There is no long-running daemon to hold state in memory. JSON files provide simple, atomic persistence between invocations. The graph state (~50KB for 100 entries) loads in <5ms.

### Why not extend auto-memory-hook.mjs?

`auto-memory-hook.mjs` is a separate ESM process called by SessionStart/SessionEnd hooks. It handles import/sync of the full memory package. The intelligence layer runs inside `hook-handler.cjs` for every hook event (route, post-edit, etc.) and must be CJS.

### Why not a daemon?

A daemon would require process management, health checking, and IPC complexity. The file-based approach is simpler, more reliable, and stays within the performance budget.

## Alternatives Considered

1. **Daemon-based intelligence** — Long-running process with in-memory graph. Rejected: too much operational complexity for the hook system.
2. **ESM import of @claude-flow/memory** — Use the full memory package in hooks. Rejected: CJS hooks can't synchronously import ESM.
3. **Extend auto-memory-hook.mjs** — Add graph/ranking to the existing ESM hook. Rejected: separate process, only runs at session start/end.

## Consequences

### Positive

- Ranked context injected into every prompt via `[INTELLIGENCE]` output
- Confidence evolves over sessions (boost on access, decay on neglect)
- Graph persists across sessions via JSON files
- Zero new dependencies — pure CJS with built-in Node.js modules
- All intelligence calls are try/catch wrapped — non-fatal failures

### Negative

- Duplicate PageRank implementation (also in memory-graph.ts)
- File I/O on every hook invocation (mitigated by caching)
- No vector search — trigram Jaccard is approximate

### Performance Impact

| Hook | Baseline | + Intelligence | Total |
|------|----------|---------------|-------|
| session-restore | 28ms | +150ms (one-time) | 178ms |
| route | 28ms | +10ms (cached read) | 38ms |
| post-edit | 28ms | +1ms (append) | 29ms |
| session-end | 28ms | +300ms (recompute) | 328ms |

All within existing hook timeouts (10-15s).

## Files Changed

| Action | File | Lines |
|--------|------|-------|
| CREATE | `cli/.claude/helpers/intelligence.cjs` | ~560 |
| CREATE | `v3/implementation/adrs/ADR-050-intelligence-loop.md` | ~150 |
| MODIFY | `cli/.claude/helpers/hook-handler.cjs` | +30 |
| MODIFY | `cli/.claude/helpers/session.js` | +6 |
| MODIFY | `cli/src/init/executor.ts` | +1 |
