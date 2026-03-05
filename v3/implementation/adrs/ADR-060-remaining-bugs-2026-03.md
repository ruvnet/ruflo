# ADR-060: Remaining Bug & Wiring Fixes — March 2026

**Status:** Accepted
**Date:** 2026-03-05
**Author:** claude-flow
**Supersedes:** Remaining items from ADR-059

## Context

ADR-059 triaged 30 open issues and 11 were fixed in v3.5.3 (PR #1297, #1298). This ADR covers the 19 remaining open issues plus 5 additional issues discovered during the fix cycle that were not in the original triage. Total: 24 open items.

## Priority Levels

| Level | Meaning | SLA |
|-------|---------|-----|
| **P0 — Critical** | Security risk, data loss, or blocks all users | Fix within 24h |
| **P1 — High** | Core functionality broken for a platform or major feature | Fix within 1 week |
| **P2 — Medium** | Incorrect behavior, cosmetic UX bugs, missing config | Fix within 2 weeks |
| **P3 — Low** | Enhancements, polish, feature requests | Next release cycle |

---

## P0 — Critical

### 1. Windows: daemon and memory init silently fail (#1282)
- **Impact:** `init --start-all` reports success but creates nothing on Windows. Zero functionality for Windows users.
- **Root cause:** `child_process.spawn` uses POSIX-only flags (`detached`, `stdio: 'ignore'`). Windows needs `shell: true` and `windowsHide: true`.
- **Fix:** Audit all spawn calls for platform-specific flags; add Windows CI matrix.
- **Effort:** Medium — requires platform detection in daemon.ts, memory-initializer.ts, and process manager.

---

## P1 — High

### 2. hook-handler.cjs ignores stdin — all hook data silently lost (#1211)
- **Impact:** Every Claude Code hook sends structured JSON via stdin, but hook-handler.cjs never reads it. The entire learning, routing, and intelligence pipeline receives no input data.
- **Root cause:** The handler reads `process.argv` but never `process.stdin`.
- **Fix:** Add stdin buffering: `let data = ''; process.stdin.on('data', c => data += c); process.stdin.on('end', () => { /* parse JSON, dispatch */ })`.
- **Effort:** Small — single file fix with high leverage.
- **Note:** This is the single highest-leverage fix remaining. Without it, all hooks are effectively no-ops.

### 3. macOS: daemon dies immediately after start (#1283)
- **Impact:** Daemon always shows STOPPED on macOS. Background workers, learning hooks, and neural training are all non-functional.
- **Root cause:** Likely PID file race condition or signal handling (SIGHUP on terminal close).
- **Fix:** Add `nohup` wrapper or launchd plist support. Write PID file after fork, not before.
- **Effort:** Medium.

### 4. auto-memory-hook.mjs fails to resolve @claude-flow/memory (#1287)
- **Impact:** Auto-memory import fails when installed as nested dependency (npx, monorepos). Memory persistence across sessions is broken.
- **Root cause:** ES module import resolution doesn't traverse node_modules correctly from hook context.
- **Fix:** Use `createRequire(import.meta.url)` for CommonJS-style resolution, or bundle the memory module inline.
- **Effort:** Small.

### 5. Settings-generator missing 13 hooks, 9 env vars, memory config (#1291)
- **Impact:** Fresh installs get incomplete configuration. 13 hooks never fire, 9 env vars undocumented.
- **Fix:** Reconcile `settings-generator.ts` against the actual hooks registry in `hooks.ts`. Add missing hook entries and env var documentation.
- **Effort:** Medium — requires careful audit of all hook types vs generated settings.

### 6. recordFeedback() exposed by AgentDB v3 has zero callers (#1209)
- **Impact:** AgentDB's feedback/reinforcement learning API exists but is never invoked. The learning loop (RETRIEVE → JUDGE → DISTILL → CONSOLIDATE) has no JUDGE step at runtime.
- **Fix:** Wire `recordFeedback()` calls into `post-task` and `post-edit` hooks when `--success` flag is provided.
- **Effort:** Small — add calls in hook handlers.

### 7. MemoryGraph class exported but never instantiated (#1214)
- **Impact:** Graph-based relationship tracking (agent→task, file→pattern) is dead code. Semantic search misses relationship context.
- **Fix:** Instantiate MemoryGraph in memory-initializer alongside ControllerRegistry.
- **Effort:** Small.

---

## P2 — Medium

### 8. `workflow run` and `task assign` call missing MCP tools (#1281)
- **Impact:** CLI references `workflow_run` and `task_assign` MCP tools that aren't registered.
- **Fix:** Register the missing tools in the MCP server, or remove the dead references.
- **Effort:** Small.

### 9. CacheManager setInterval missing .unref() prevents process exit (#1256)
- **Impact:** CLI process hangs after completion. Users must Ctrl+C to exit.
- **Fix:** Add `.unref()` to all `setInterval` timers in CacheManager.
- **Effort:** Trivial.

### 10. Zero swarms always: `ruflo spawn hive-mind --claude` (#1279)
- **Impact:** Hive-mind spawning returns zero agents. Multi-agent feature is non-functional via CLI.
- **Fix:** Debug agent spawn path — likely missing topology init or agent pool connection.
- **Effort:** Medium.

### 11. MCP server status reports 'Stopped' in stdio mode (#1289)
- **Impact:** `status` command shows STOPPED for a correctly-running stdio-mode MCP server.
- **Fix:** Detect stdio transport mode and report status accordingly.
- **Effort:** Small.

### 12. doctor: disk space check reports wrong capacity percentage (#1288)
- **Impact:** Misleading health check output (bytes vs KB mismatch).
- **Fix:** Fix arithmetic in disk space calculation.
- **Effort:** Trivial.

### 13. SonaTrajectoryService does not use native @ruvector/sona API (#1243)
- **Impact:** SONA neural learning uses a stub. Learning is no-op.
- **Fix:** Wire to actual `@ruvector/sona` package methods.
- **Effort:** Medium.

### 14. Wire AgentMemoryScope 3-scope isolation (#1227)
- **Impact:** Memory operations don't enforce agent/session/global scope isolation.
- **Fix:** Add scope parameter to memory store/retrieve operations.
- **Effort:** Medium.

### 15. Wire SolverBandit Thompson Sampling into hooks_route (#1217)
- **Impact:** Agent selection uses random/round-robin instead of learned multi-armed bandit.
- **Fix:** Integrate SolverBandit into the route hook's agent selection logic.
- **Effort:** Medium.

### 16. npm ECOMPROMISED cache corruption (#1231)
- **Impact:** Some users get ECOMPROMISED errors on `npx ruflo`. Related to the removed preinstall script.
- **Fix:** Document cache clear workaround: `npm cache clean --force`. The preinstall removal in v3.5.3 should prevent new occurrences.
- **Effort:** Trivial — documentation only.

### 17. AgentDB v2 → v3 upgrade (#1207)
- **Impact:** RVF backend migration path not documented for existing users.
- **Fix:** Add migration guide and automatic detection in `init`.
- **Effort:** Medium.

---

## P3 — Low (Next Release Cycle)

### 18. ruvi MCP server: Edge Functions failing (#1276)
- **Impact:** Supabase Edge Functions intermittently fail (cloud-only).
- **Fix:** Add retry logic and auth token refresh.

### 19. Rollback incident templates (#1238, #1262, #1267, #1268)
- **Impact:** Four empty stubs cluttering the issue tracker.
- **Fix:** Close all four. Create a proper incident template if needed.

### 20. Context Optimization Engine — 95-98% compression (#1273)
- **Type:** Feature request.

### 21. Multilingual embedding model support (#1272)
- **Type:** Feature request for Chinese embeddings.

### 22. Ship `dsp` as bin entry (#1236)
- **Type:** Feature request for convenience alias.

### 23. ADR-058: Self-Contained ruflo.rvf Appliance (#1245)
- **Type:** Enhancement. Phase 3-4 implementation exists.

### 24. ADR-057: Replace sql.js with RVF native storage (#1242)
- **Type:** Enhancement. Architectural improvement.

---

## Summary Matrix

| Priority | Count | Key Themes |
|----------|-------|------------|
| **P0** | 1 | Windows platform support |
| **P1** | 6 | Hook stdin, macOS daemon, memory resolution, settings completeness, learning loop wiring |
| **P2** | 10 | CLI UX, MCP tools, neural wiring, memory scoping, cache fix |
| **P3** | 7 | Feature requests, enhancements, housekeeping |
| **Total** | **24** | |

## Recommended Fix Order

### Sprint 1 (This Week) — Unblock Intelligence Pipeline
1. **#1211** hook-handler.cjs stdin — highest leverage, unblocks all learning
2. **#1209** recordFeedback() wiring — completes the JUDGE step
3. **#1214** MemoryGraph instantiation — enables relationship tracking
4. **#1287** auto-memory-hook resolution — fixes memory persistence
5. **#1256** CacheManager .unref() — trivial, fixes UX annoyance

### Sprint 2 (Next Week) — Platform & Configuration
6. **#1282** Windows daemon/memory — unblocks Windows users
7. **#1283** macOS daemon — unblocks macOS users
8. **#1291** Settings-generator completeness — fixes fresh installs
9. **#1281** Missing MCP tools — removes dead references
10. **#1289** MCP stdio status — fixes confusing UX

### Sprint 3 (Following Week) — Neural & Advanced Wiring
11. **#1243** SONA wiring — enables real neural learning
12. **#1227** AgentMemoryScope — enables scope isolation
13. **#1217** SolverBandit — enables learned agent routing
14. **#1279** Hive-mind zero swarms — fixes multi-agent CLI
15. **#1288** Doctor disk space — trivial arithmetic fix

### Backlog
- #1231 (document cache workaround)
- #1207 (migration guide)
- P3 feature requests and housekeeping

## Decision

1. **Immediately** fix #1211 (hook stdin) — this single fix unblocks the entire intelligence pipeline.
2. **Sprint 1** targets the learning loop: stdin → feedback → memory graph → memory resolution.
3. **Sprint 2** targets platform parity (Windows, macOS) and configuration completeness.
4. **Sprint 3** wires the advanced neural and routing features.
5. **P3** items go to backlog for roadmap planning.

## Consequences

- Sprint 1 fixes should ship as **v3.5.4** (patch — learning pipeline).
- Sprint 2 fixes should ship as **v3.6.0** (minor — platform support, new CI matrix).
- Sprint 3 fixes should ship as **v3.7.0** (minor — neural features).
- The 4 rollback incident stubs (#1238, #1262, #1267, #1268) should be closed immediately as housekeeping.
