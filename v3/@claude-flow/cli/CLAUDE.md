# Claude Flow V3 — CLI Package

## Behavioral Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER proactively create documentation files (*.md) unless explicitly requested
- NEVER save files to the root folder
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files

## File Organization

- `/src` — source code
- `/tests` — test files
- `/docs` — documentation
- `/config` — configuration files
- `/scripts` — utility scripts
- `/examples` — example code

## Concurrency Rules

ALL related operations MUST be concurrent/parallel in a single message:
- **TodoWrite**: Batch ALL todos in ONE call
- **Task tool**: Spawn ALL agents in ONE message
- **File operations**: Batch ALL reads/writes/edits in ONE message
- **Bash commands**: Batch ALL terminal operations in ONE message

## Swarm Execution

When spawning agents for complex tasks:
1. Use `run_in_background: true` for all agent Task calls
2. Put ALL agent Task calls in ONE message for parallel execution
3. Tell the user what each agent is doing
4. **STOP and WAIT** — do not poll status or add more tool calls
5. When agent results arrive, review ALL results before proceeding

Never continuously check swarm status — wait for results.

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
| `custom` | User-defined with inline prompt |

## Key Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@claude-flow/cli` | `v3/@claude-flow/cli/` | CLI entry point |
| `@claude-flow/hooks` | `v3/@claude-flow/hooks/` | Lifecycle hooks + workers |
| `@claude-flow/memory` | `v3/@claude-flow/memory/` | AgentDB + HNSW search |
| `@claude-flow/security` | `v3/@claude-flow/security/` | Input validation |
| `@claude-flow/patterns` | `v3/@claude-flow/patterns/` | Pattern learning + cache |
| `@claude-flow/swarm` | `v3/@claude-flow/swarm/` | Agent coordination |

## Swarm Defaults

- **Topology**: hierarchical
- **Max Agents**: 8
- **Strategy**: specialized
- **Voting**: raft
- **Memory Backend**: hybrid (SQLite + AgentDB)

## Quick Reference

```bash
npx @claude-flow/cli@latest init --wizard          # Initialize project
npx @claude-flow/cli@latest agent spawn -t coder    # Spawn agent
npx @claude-flow/cli@latest swarm init --v3-mode    # Init swarm
npx @claude-flow/cli@latest memory search --query x  # Search memory
npx @claude-flow/cli@latest doctor --fix             # Diagnostics
npx @claude-flow/cli@latest daemon start             # Start daemon
```

## Memory Commands

```bash
# Store (--key and --value required, --namespace optional)
npx @claude-flow/cli@latest memory store --key "pattern-auth" --value "JWT with refresh" --namespace patterns

# Search (--query required, use full flag not -q)
npx @claude-flow/cli@latest memory search --query "authentication patterns"

# List and retrieve
npx @claude-flow/cli@latest memory list --namespace patterns
npx @claude-flow/cli@latest memory retrieve --key "pattern-auth"
```

## Reference Docs

For detailed docs on hooks, swarm protocols, routing, intelligence, and configuration, see `/docs/reference/`.
