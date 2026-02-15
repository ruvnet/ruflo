# Claude-Flow v3

<div align="center">

![Claude-Flow Banner](https://repository-images.githubusercontent.com/995029641/b9acbe16-0f49-420d-804f-468ba2a73ace)

[![Star on GitHub](https://img.shields.io/github/stars/ruvnet/claude-flow?style=for-the-badge&logo=github&color=gold)](https://github.com/ruvnet/claude-flow)
[![Monthly Downloads](https://img.shields.io/npm/dm/claude-flow?style=for-the-badge&logo=npm&color=blue&label=Monthly%20Downloads)](https://www.npmjs.com/package/claude-flow)
[![Total Downloads](https://img.shields.io/npm/dt/claude-flow?style=for-the-badge&logo=npm&color=cyan&label=Total%20Downloads)](https://www.npmjs.com/package/claude-flow)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge&logo=opensourceinitiative)](https://opensource.org/licenses/MIT)

---

[![Follow @ruv](https://img.shields.io/badge/Follow%20%40ruv-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/ruv)
[![Agentics Foundation](https://img.shields.io/badge/Agentics-Foundation-crimson?style=for-the-badge&logo=openai)](https://discord.com/invite/dfxmpwkG2D)
[![ruv.io](https://img.shields.io/badge/ruv.io-AI%20Platform-green?style=for-the-badge)](https://ruv.io)

**Multi-agent AI orchestration for Claude Code.**

Coordinate specialized agents in swarms with vector memory, self-learning, and MCP integration.

</div>

## What is Claude-Flow?

Claude-Flow turns Claude Code into a multi-agent platform. Instead of working with a single AI assistant, you orchestrate teams of specialized agents -- coders, reviewers, testers, architects -- that coordinate through swarms, share memory, and learn from their work.

```
User --> Claude-Flow (CLI / MCP) --> Swarm --> Agents --> Memory
                  ^                              |
                  +-------- Learning Loop -------+
```

## Quick Start

```bash
# Initialize in your project
npx claude-flow@v3alpha init --wizard

# Or initialize with defaults
npx claude-flow@v3alpha init
```

This sets up your MCP configuration, CLAUDE.md, and project settings. Once initialized, Claude Code can use Claude-Flow's tools directly.

### Spawn an Agent

```bash
# Spawn a coder agent
npx claude-flow@v3alpha agent spawn -t coder

# Spawn with a specific provider
npx claude-flow@v3alpha agent spawn -t reviewer -p openrouter
```

### Run a Swarm

```bash
# Initialize a swarm
npx claude-flow@v3alpha swarm init --v3-mode

# Start a coordinated swarm
npx claude-flow@v3alpha start
```

### Search Memory

```bash
# Semantic search across agent memory
npx claude-flow@v3alpha memory search -q "authentication patterns"

# Store knowledge
npx claude-flow@v3alpha memory store -k "auth-flow" --value "JWT with refresh tokens"
```

### Start the MCP Server

```bash
# Start as MCP server for Claude Code integration
npx claude-flow@v3alpha mcp start
```

## Agent Types

| Agent | Purpose |
|-------|---------|
| `coder` | Code development with pattern learning |
| `researcher` | Research with web access and data analysis |
| `tester` | Automated testing and test generation |
| `reviewer` | Code review with security and quality checks |
| `architect` | System design with enterprise patterns |
| `coordinator` | Multi-agent orchestration and workflow |
| `optimizer` | Performance optimization and bottleneck analysis |
| `security-architect` | Security architecture and threat modeling |
| `security-auditor` | CVE remediation and security testing |
| `memory-specialist` | AgentDB and vector search optimization |
| `swarm-specialist` | Swarm coordination tuning |
| `performance-engineer` | CPU-level optimization |
| `core-architect` | Domain-driven design |
| `test-architect` | TDD London School methodology |

## Architecture

Claude-Flow is organized as a monorepo with six packages:

| Package | Description |
|---------|-------------|
| `@claude-flow/core` | Shared types, security, auth, providers, AI defence |
| `@claude-flow/cli` | CLI entry point and command handlers |
| `@claude-flow/agents` | Swarm coordination, pattern learning, lifecycle hooks |
| `@claude-flow/memory` | AgentDB + HNSW vector search + embeddings |
| `@claude-flow/integrations` | Codex, MCP server, browser automation, deployment |
| `@claude-flow/plugins` | Plugin SDK, guidance, testing framework |

### How It Works

1. **CLI / MCP Entry** -- Commands come in via the CLI or through MCP tools when Claude Code calls them directly.
2. **Swarm Coordination** -- Agents are organized into swarms with configurable topologies (mesh, hierarchical, ring, star).
3. **Agent Execution** -- Each agent has a specialization and works on tasks within the swarm.
4. **Vector Memory** -- AgentDB with HNSW indexing provides semantic search across agent knowledge. A hybrid SQLite + AgentDB backend is the default.
5. **Learning Loop** -- Patterns are extracted from agent work, consolidated with EWC++ (to prevent catastrophic forgetting), and fed back into routing decisions.

## CLI Reference

### Primary Commands

```
init          Initialize Claude-Flow in a project
start         Start coordinated agents
status        Show system and agent status
agent         Manage agents (spawn, list, stop)
swarm         Swarm coordination and management
memory        Memory operations (store, search, clear)
task          Task management
session       Session management
mcp           MCP server control
hooks         Hook management (pre-task, post-task, workers)
```

### Advanced Commands

```
security      Security scanning and audit
performance   Performance profiling and benchmarks
embeddings    Embedding generation and management
hive-mind     Distributed multi-instance coordination
ruvector      RuVector intelligence layer management
guidance      Guidance control plane
```

### Utility Commands

```
config        Configuration management
doctor        Diagnostics and auto-fix
daemon        Background daemon control
completions   Shell completions (bash, zsh, fish)
migrate       Migrate from v2 to v3
workflow      Workflow management
```

### Analysis & Management

```
analyze       Code and system analysis
route         Q-Learning routing inspection
progress      Progress tracking
providers     LLM provider management
plugins       Plugin management
deployment    Deployment operations
issues        Issue claims coordination
update        Auto-update management
```

Run `claude-flow <command> --help` for detailed usage on any command.

## Memory System

Claude-Flow uses a hybrid memory backend by default:

- **AgentDB** -- Vector database with HNSW indexing for semantic search
- **SQLite** -- Lightweight local storage for structured data
- **Embeddings** -- Generated via `@xenova/transformers` for local, private vector search
- **Flash Attention** -- CPU-optimized batch similarity search

```bash
# Search memory semantically
npx claude-flow@v3alpha memory search -q "error handling patterns"

# Generate embeddings
npx claude-flow@v3alpha embeddings generate --input "your text here"

# Check memory status
npx claude-flow@v3alpha memory status
```

## MCP Integration

Claude-Flow implements the [Model Context Protocol](https://modelcontextprotocol.io/) and exposes its full API as MCP tools. When you run `claude-flow init`, it configures Claude Code to use Claude-Flow as an MCP server.

This means Claude Code can directly:
- Spawn and manage agents
- Coordinate swarms
- Search and store in vector memory
- Run security audits
- Manage tasks and sessions

The MCP server auto-detects when stdin is piped and switches to stdio transport mode.

## Plugin System

Build plugins with the `@claude-flow/plugins` SDK:

- **Workers** -- Background processes for continuous operations
- **Hooks** -- Pre/post task hooks for automation
- **Providers** -- Custom LLM provider integrations
- **Guidance** -- Constrained generation control

```bash
# List installed plugins
npx claude-flow@v3alpha plugins list

# Install a plugin
npx claude-flow@v3alpha plugins install <plugin-name>
```

## Swarm Topologies

Configure how agents coordinate:

| Topology | Description |
|----------|-------------|
| **Hierarchical** | Tree structure with coordinator at the top (default) |
| **Mesh** | Every agent connects to every other agent |
| **Ring** | Agents pass work in a circular chain |
| **Star** | Central coordinator with spoke agents |

Consensus mechanisms: Raft, BFT, Gossip, CRDT.

## Configuration

After `claude-flow init`, your project gets a `claude-flow.config.json`:

```bash
# View current config
npx claude-flow@v3alpha config show

# Set a value
npx claude-flow@v3alpha config set memory.backend hybrid

# Run diagnostics
npx claude-flow@v3alpha doctor --fix
```

Environment variables:

```bash
CLAUDE_FLOW_CONFIG=./claude-flow.config.json
CLAUDE_FLOW_LOG_LEVEL=info
CLAUDE_FLOW_MEMORY_BACKEND=hybrid
CLAUDE_FLOW_MEMORY_PATH=./data/memory
CLAUDE_FLOW_MCP_PORT=3000
CLAUDE_FLOW_MCP_TRANSPORT=stdio
```

## Requirements

- Node.js >= 20.0.0
- npm or npx

## Project Structure

```
v3/@claude-flow/
  core/           # Shared types, security, auth, providers
  cli/            # CLI commands and MCP server
  agents/         # Swarm coordination and patterns
  memory/         # AgentDB, HNSW, embeddings
  integrations/   # Codex, MCP, browser, deployment
  plugins/        # Plugin SDK and testing
docs/             # Reference documentation
tests/            # Test suite
scripts/          # Utility scripts
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run security tests
npm run test:security

# Lint
npm run lint
```

## License

MIT -- see [LICENSE](./LICENSE).

## Links

- [GitHub](https://github.com/ruvnet/claude-flow)
- [npm](https://www.npmjs.com/package/claude-flow)
- [Issues](https://github.com/ruvnet/claude-flow/issues)
- [Agentics Foundation Discord](https://discord.com/invite/dfxmpwkG2D)

---

Created by [RuvNet](https://ruv.io)
