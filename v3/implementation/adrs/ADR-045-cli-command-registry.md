# ADR-045: Complete CLI Command Registry with Categorization

**Status:** Implemented
**Date:** 2026-01-26
**Issue:** #1023

## Context

The CLI help output was only showing 18 of 32 available commands because:
1. Commands were split between synchronous and lazy-loaded imports
2. Only synchronously loaded commands appeared in the help output
3. No categorization made it difficult to understand command purposes

**Missing from help:**
- `config`, `workflow`, `migrate`, `providers`, `plugins`, `deployment`
- `claims`, `completions`, `analyze`, `route`, `progress`, `issues`, `update`, `process`

## Decision

**Implement complete command registry with categorized help output.**

### Command Categories (DDD Alignment)

| Category | Commands | DDD Context |
|----------|----------|-------------|
| **Primary** | init, start, status, agent, swarm, memory, task, session, mcp, hooks | Core bounded contexts |
| **Advanced** | neural, security, performance, embeddings, hive-mind, ruvector | Specialized features |
| **Utility** | config, doctor, daemon, completions, migrate, workflow | System tools |
| **Analysis** | analyze, route, progress | Intelligence/routing |
| **Management** | providers, plugins, deployment, claims, issues, update, process | Operations |

### Implementation

1. **New Module**: `commands/categories.ts`
   - Defines `CommandCategory` interface
   - Exports category constants
   - Helper functions for formatting

2. **Updated**: `commands/index.ts`
   - All 32 commands loaded synchronously
   - `commandsByCategory` export for organized access
   - Backwards-compatible `commands` array

3. **Updated**: `index.ts` (CLI main)
   - `showHelp()` displays commands by category
   - Clear visual hierarchy in output

## Rationale

**Benefits:**
- All commands visible in help (32 total)
- Categories align with DDD bounded contexts (ADR-002)
- Easier to find relevant commands
- Consistent startup (no lazy-load surprises)

**Trade-offs:**
- Slightly larger initial bundle
- ~50ms slower cold start (acceptable, still <500ms)

## Help Output Format

```
PRIMARY COMMANDS:
  init         Initialize Claude Flow in the current directory
  start        Start the Claude Flow orchestration system
  status       Show system status
  agent        Agent management commands
  swarm        Swarm coordination commands
  memory       Memory management commands
  task         Task management commands
  session      Session management commands
  mcp          MCP server management
  hooks        Self-learning hooks system

ADVANCED COMMANDS:
  neural       Neural pattern training
  security     Security scanning, CVE detection
  performance  Performance profiling
  embeddings   Vector embeddings
  hive-mind    Queen-led consensus coordination
  ruvector     RuVector PostgreSQL Bridge

UTILITY COMMANDS:
  config       Configuration management
  doctor       System diagnostics
  daemon       Background worker daemon
  completions  Shell completions
  migrate      V2 to V3 migration
  workflow     Workflow execution

ANALYSIS COMMANDS:
  analyze      Code analysis (AST, diff, coverage)
  route        Q-Learning agent routing
  progress     Progress tracking

MANAGEMENT COMMANDS:
  providers    AI provider management
  plugins      Plugin management
  deployment   Deployment management
  claims       Claims-based authorization
  issues       Issue claims
  update       Auto-update system
  process      Background processes
```

## Success Criteria

- [x] All 32 commands appear in `--help`
- [x] Commands organized into 5 categories
- [x] CLI builds without errors
- [x] Startup time <500ms
- [x] Backwards compatible (old imports work)

## Files Changed

- `v3/@claude-flow/cli/src/commands/categories.ts` (NEW)
- `v3/@claude-flow/cli/src/commands/index.ts` (UPDATED)
- `v3/@claude-flow/cli/src/index.ts` (UPDATED)

## References

- ADR-002: DDD Structure
- ADR-004: Plugin Architecture
- GitHub Issue: #1023

---

**Implementation Date:** 2026-01-26
**Status:** ✅ Complete
