---
name: loop-worker
description: Run Ruflo background workers using Claude Code native /loop scheduling
argument-hint: "<worker-name>"
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch mcp__plugin_ruflo-core_ruflo__hooks_worker-status ScheduleWakeup
---
Use `/loop` for in-session periodic workers. Cache-aware delays keep prompt cache warm:
- Delay formula: `min(270, cache_ttl * 0.9)` -- default 270s

Dispatch a worker via MCP: `mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch({ trigger: "WORKER_NAME" })`

Then schedule the next iteration: `ScheduleWakeup({ delaySeconds: 270, reason: "next WORKER_NAME iteration" })`

### Available Workers (12, per ADR-0001 and `/ruflo-loop`)

| Worker | Priority | Interval | Description |
|--------|----------|----------|-------------|
| audit | critical | 270s | Security analysis |
| optimize | high | 270s | Performance optimization |
| predict | normal | 270s | Predictive preloading |
| testgaps | normal | 270s | Test coverage analysis |
| ultralearn | normal | 600s | Deep knowledge acquisition |
| deepdive | normal | 600s | Deep code analysis |
| map | normal | 600s | Codebase mapping |
| document | normal | 600s | Auto-documentation |
| refactor | normal | 600s | Refactoring suggestions |
| benchmark | normal | 600s | Performance benchmarking |
| consolidate | low | 600s | Memory consolidation |
| preload | low | 270s | Resource preloading |

The intervals are suggested cadences, not enforced by the dispatcher: 270s keeps the prompt cache warm, and the heavier analysis workers run at 600s because one iteration rarely finishes sooner.

Work you start in the background (a build, a long job) finishes with its own completion notification. Do not poll it with short `ScheduleWakeup` calls; use a long fallback delay (1200s or more) so the loop survives a hung job.

MCP tool responses include `[LOOP_SUGGESTION]` and `[CRON_SUGGESTION]` hints -- follow them.
