# ADR-531: Locked atomic JSON stores for MCP claims, tasks, agents and workflows

- **Status**: proposed
- **Date**: 2026-11-13
- **Deciders**:
- **Tags**: mcp, persistence, concurrency, data-integrity
- **Issue**: [#4736](https://github.com/ruvnet/ruflo/issues/4736)

## Context

Four MCP tool families keep their state in one JSON file each under
`.claude-flow/`:

| Store | File | Module |
|---|---|---|
| claims | `.claude-flow/claims/claims.json` | `mcp-tools/claims-tools.ts` |
| tasks | `.claude-flow/tasks/store.json` | `mcp-tools/task-tools.ts` |
| agents | `.claude-flow/agents/store.json` | `mcp-tools/agent-tools.ts` |
| workflows | `.claude-flow/workflows/store.json` | `mcp-tools/workflow-tools.ts` |

Every handler does `load()` → mutate → `writeFileSync()` with no lock and no
atomic replace. Several MCP servers (one per Claude Code session, plus
headless `claude -p` workers) commonly share one project directory, so these
read-modify-write cycles race:

- 4 of 4 concurrent `claims_claim` racers all "won" the same issue in 9 of 10
  rounds. The check that an issue is unclaimed is not atomic with the write.
- 8 concurrent `task_create` calls persisted 1 task. The other 7 were reported
  as created and silently lost.
- A reader can observe a half-written file, which `readPreservedJsonStore`
  (#4737) then correctly refuses as corrupt — turning a race into an outage.

`swarm-tools.ts` already solved this for `swarm-state.json` with an `O_EXCL`
lock file (`openSync(path, 'wx')`, stale-lock takeover) plus a temp-file +
`rename` write. That code is private to the swarm module.

## Decision

1. Add one shared helper module, `mcp-tools/locked-json-store.ts`, that owns:
   - `writeJsonAtomic(path, value)` — write to a unique sibling temp file
     (mode `0o600`), `rename` over the target, unlink the temp on failure.
   - `withJsonStoreLock(path, operation)` — acquire `<path>.lock` with
     `openSync(..., 'wx')` and write a per-acquisition owner token into it,
     retry with a short `Atomics.wait` back-off until a 5 s deadline, and
     release in `finally` only if the lock still holds this call's token (so
     a holder that overran the stale window cannot delete its successor's
     lock). A lock older than the stale threshold is taken over by renaming
     it away first and re-checking the renamed file; a fresh lock renamed by
     mistake is linked back. Only `ENOENT` short-circuits the back-off, so a
     persistent `EACCES`/`EPERM` cannot busy-spin. The lock is never
     refreshed: the threshold assumes the synchronous critical section is far
     shorter than it.
     The operation is **synchronous**: the lock is never held across an
     `await`, so a stalled handler cannot wedge other processes and no
     async re-entrancy is possible.
   - `updateJsonStore(path, read, mutate)` — lock → fresh read → `mutate` →
     atomic write (only when `mutate` reports a change) → unlock, returning
     `mutate`'s result.
2. Each of the four modules routes every read-modify-write through
   `updateJsonStore`. The state the decision depends on is re-read **inside**
   the lock, so check-and-set operations (`claims_claim`, steal, handoff
   accept, `task_assign`, status transitions) are atomic across processes.
3. Handlers that must `await` (e.g. workflow execution, agent spawn side
   effects) split into short locked phases. Each phase re-reads the latest
   store inside its lock and applies only its own delta, instead of writing
   back an object loaded before the `await`.
4. `swarm-tools.ts` keeps its behaviour but may delegate to the shared helper;
   that refactor is optional and not required by this ADR.
5. Pure reads stay lock-free. Atomic rename guarantees a reader sees either
   the old or the new complete file, never a torn one.

## Consequences

### Positive
- No lost updates between concurrent MCP servers or agents in one project.
- `claims_claim` becomes a true atomic check-and-set; two claimants can no
  longer both hold the same issue.
- No torn reads, so the #4737 corrupt-store guard no longer fires on races.
- One tested implementation instead of five ad-hoc ones.

### Negative
- Writers serialize per store. Contention is low (human/agent-paced tool
  calls), and the critical sections are synchronous and short.
- `Atomics.wait` blocks the event loop briefly while waiting for a lock.
  This is bounded by the retry budget and matches the existing swarm lock.
- A crashed process can leave a lock file; it is taken over after the stale
  threshold, during which writers to that store fail with a "busy" error
  rather than proceeding unsafely.

### Neutral
- File formats and paths are unchanged; no migration.
- Stores are rewritten with mode `0600` (previously the umask default,
  usually `0644`), and a symlinked store file is replaced by a regular file.
- Lock files (`*.lock`) and transient `*.tmp` files appear next to the stores.

## Links
- Issue #4736 — lost updates in the claims, tasks, agents and workflows JSON stores
- Issue #4737 — preserve corrupt JSON stores instead of overwriting them (`record-store.ts`)
- `v3/@claude-flow/cli/src/mcp-tools/swarm-tools.ts` — `withSwarmStoreLock` / `saveSwarmStore` (prior art)
