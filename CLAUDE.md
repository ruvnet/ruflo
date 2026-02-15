# Claude Code Configuration - Claude Flow

## Behavioral Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER proactively create documentation files (*.md) unless explicitly requested
- NEVER save files to the root folder
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- Never continuously check status after spawning a swarm — wait for results

## File Organization

- `/v3` — V3 monorepo packages (the active codebase)
- `/tests` — test files
- `/docs` — documentation (reference docs for swarm protocols, publishing, hooks, etc.)
- `/scripts` — utility scripts

## Project Architecture

- Domain-Driven Design with bounded contexts
- Files under 500 lines
- Typed interfaces for all public APIs
- TDD London School (mock-first) for new code
- Input validation at system boundaries

### Key Packages (6 consolidated)

| Package | Path | Purpose |
|---------|------|---------|
| `@claude-flow/core` | `v3/@claude-flow/core/` | Shared types, security, auth, providers, AI defence |
| `@claude-flow/cli` | `v3/@claude-flow/cli/` | CLI entry point |
| `@claude-flow/agents` | `v3/@claude-flow/agents/` | Swarm coordination, patterns, lifecycle hooks |
| `@claude-flow/memory` | `v3/@claude-flow/memory/` | AgentDB + HNSW search + embeddings |
| `@claude-flow/integrations` | `v3/@claude-flow/integrations/` | Codex, MCP server, browser, deployment |
| `@claude-flow/plugins` | `v3/@claude-flow/plugins/` | Plugin SDK, guidance, testing framework |

## Agent Types

| Agent | Use For |
|-------|---------|
| `coder` | Writing and modifying code |
| `reviewer` | Code review, quality, security |
| `tester` | Writing and running tests |
| `researcher` | Codebase exploration, information gathering |
| `planner` | Architecture decisions, system design |
| `coordinator` | Orchestrating other agents |
| `security` | Security-specific analysis |
| `performance` | Profiling and optimization |
| `devops` | CI/CD, deployment, infrastructure |

## Concurrency Rules

- All related operations MUST be concurrent/parallel in a single message
- Batch ALL todos in ONE TodoWrite call
- Spawn ALL agents in ONE message via Task tool
- Batch ALL file reads/writes/edits in ONE message

## Swarm Defaults

- **Topology**: hierarchical
- **Max Agents**: 8
- **Strategy**: specialized
- **Memory Backend**: hybrid (SQLite + AgentDB)

Use swarms for multi-file changes, feature implementation, refactoring. Skip for single file edits, simple fixes, config changes.

## Quick Reference

```bash
npx claude-flow@v3alpha init --wizard        # Initialize project
npx claude-flow@v3alpha agent spawn -t coder  # Spawn agent
npx claude-flow@v3alpha memory search -q "x"  # Search memory
npx claude-flow@v3alpha doctor --fix           # Diagnostics
npx claude-flow@v3alpha daemon start           # Start daemon
```

For detailed docs on swarm protocols, publishing, hooks, plugins, and headless instances, see `/docs/`.
