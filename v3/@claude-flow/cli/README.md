# @claude-flow/cli

[![npm version](https://img.shields.io/npm/v/@claude-flow/cli.svg)](https://www.npmjs.com/package/@claude-flow/cli)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/cli.svg)](https://www.npmjs.com/package/@claude-flow/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Commands](https://img.shields.io/badge/Commands-24-orange.svg)](https://github.com/ruvnet/claude-flow)
[![Subcommands](https://img.shields.io/badge/Subcommands-130+-purple.svg)](https://github.com/ruvnet/claude-flow)

> Modern CLI module for Claude Flow V3 - comprehensive command-line interface with 24 commands, 130+ subcommands, interactive prompts, self-learning hooks, background workers, hive-mind coordination, and beautiful output formatting.

## Features

### Core Capabilities
- **24 Main Commands** - Complete CLI coverage for all Claude Flow operations
- **130+ Subcommands** - Fine-grained control over every aspect of the system
- **Advanced Argument Parsing** - Full support for flags, options, subcommands, and positional arguments
- **Interactive Prompts** - Rich interactive mode with confirmations, selections, and input validation
- **Beautiful Output** - Colored output, tables, progress bars, spinners, and multiple formats (text, JSON, table)

### V3-Specific Features
- **Self-Learning Hooks** - 17 hook subcommands + 12 background workers with pattern learning and neural integration
- **Hive-Mind Coordination** - Queen-led Byzantine fault-tolerant multi-agent consensus
- **15-Agent Swarm** - V3 hierarchical mesh coordination with domain specialization
- **AgentDB Integration** - 150x-12,500x faster vector search with HNSW indexing
- **SONA Learning** - Sub-0.05ms adaptation with Mixture of Experts routing

### Developer Experience
- **Type-Safe** - Full TypeScript support with comprehensive type definitions
- **Global Options** - Built-in `--help`, `--version`, `--verbose`, `--quiet`, `--format`
- **Auto-Completion** - Shell completion support for commands and options
- **Migration Tools** - Built-in V2 to V3 migration with rollback support

## Installation

```bash
npm install @claude-flow/cli
```

Or use globally:

```bash
npm install -g @claude-flow/cli
claude-flow --version
```

## Quick Start

```bash
# Initialize a new project
claude-flow init --wizard

# Start MCP server
claude-flow mcp start

# Spawn an agent
claude-flow agent spawn -t coder --name my-coder

# Initialize a swarm
claude-flow swarm init --v3-mode

# Search memory
claude-flow memory search -q "authentication patterns"

# Check system status
claude-flow status --watch
```

## Complete Command Reference

### Overview

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `init` | 4 | Project initialization with wizard, presets, and configuration |
| `agent` | 8 | Agent lifecycle management (spawn, list, status, stop, metrics, pool, health, logs) |
| `swarm` | 6 | Multi-agent swarm coordination and orchestration |
| `memory` | 11 | AgentDB memory operations with vector search |
| `mcp` | 9 | MCP server management and tool execution |
| `task` | 6 | Task creation, assignment, and lifecycle management |
| `session` | 7 | Session state management and persistence |
| `config` | 7 | Configuration management and provider setup |
| `status` | 3 | System status monitoring with watch mode |
| `start` | 3 | Service startup and quick launch |
| `workflow` | 6 | Workflow execution and template management |
| `hooks` | 17 | Self-learning hooks with neural pattern recognition + 12 background workers |
| `hive-mind` | 6 | Queen-led consensus-based multi-agent coordination |
| `migrate` | 5 | V2 to V3 migration with rollback support |

---

### `init` - Project Initialization

Initialize Claude Flow V3 with interactive wizard or presets.

```bash
claude-flow init [subcommand] [options]
```

#### Subcommands

| Subcommand | Description |
|------------|-------------|
| `wizard` | Interactive setup wizard with step-by-step configuration |
| `check` | Validate current configuration and environment |
| `skills` | List and manage available skills |
| `hooks` | Configure and validate hooks integration |

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--preset` | `-p` | Configuration preset (minimal, default, full, custom) | `default` |
| `--force` | `-f` | Overwrite existing configuration | `false` |
| `--skip-deps` | | Skip dependency installation | `false` |
| `--topology` | `-t` | Swarm topology (hierarchical, mesh, hybrid) | `hierarchical` |
| `--max-agents` | `-m` | Maximum concurrent agents | `15` |
| `--memory-backend` | | Memory backend (agentdb, sqlite, hybrid) | `hybrid` |
| `--enable-hnsw` | | Enable HNSW indexing (150x faster) | `true` |
| `--enable-neural` | | Enable SONA neural learning | `true` |

#### Examples

```bash
# Interactive wizard
claude-flow init --wizard

# Quick setup with defaults
claude-flow init --preset default

# Full V3 setup with all features
claude-flow init --preset full --enable-hnsw --enable-neural

# Validate configuration
claude-flow init check
```

---

### `agent` - Agent Management

Spawn, manage, and monitor AI agents with various specializations.

```bash
claude-flow agent <subcommand> [options]
```

#### Subcommands

| Subcommand | Aliases | Description |
|------------|---------|-------------|
| `spawn` | | Spawn a new agent with specified type and configuration |
| `list` | `ls` | List all active agents with filtering options |
| `status` | | Show detailed status and metrics for an agent |
| `stop` | `kill` | Stop a running agent (graceful or forced) |
| `metrics` | | Show agent performance metrics over time |
| `pool` | | Manage agent pool for auto-scaling |
| `health` | | Show agent health and resource metrics |
| `logs` | | View agent activity logs with filtering |

#### Agent Types

| Type | Description | Capabilities |
|------|-------------|--------------|
| `coder` | Code development with neural patterns | code-generation, refactoring, debugging, testing |
| `researcher` | Research with web access and data analysis | web-search, data-analysis, summarization, citation |
| `tester` | Comprehensive testing with automation | unit-testing, integration-testing, coverage-analysis |
| `reviewer` | Code review with security and quality checks | code-review, security-audit, quality-check |
| `architect` | System design with enterprise patterns | system-design, pattern-analysis, scalability |
| `coordinator` | Multi-agent orchestration and workflow | task-orchestration, agent-management, workflow-control |
| `security-architect` | Security architecture and threat modeling | threat-modeling, security-patterns, compliance |
| `security-auditor` | CVE remediation and security testing | vulnerability-scan, penetration-testing |
| `memory-specialist` | AgentDB unification (150x-12,500x faster) | vector-search, agentdb, caching, optimization |
| `performance-engineer` | 2.49x-7.47x optimization targets | benchmarking, profiling, optimization |

#### Spawn Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--type` | `-t` | Agent type to spawn | required |
| `--name` | `-n` | Agent name/identifier | auto-generated |
| `--provider` | `-p` | LLM provider (anthropic, openrouter, ollama) | `anthropic` |
| `--model` | `-m` | Model to use | provider default |
| `--task` | | Initial task for the agent | none |
| `--timeout` | | Agent timeout in seconds | `300` |
| `--auto-tools` | | Enable automatic tool usage | `true` |

#### Examples

```bash
# Spawn a coder agent
claude-flow agent spawn -t coder --name my-coder

# Spawn researcher with initial task
claude-flow agent spawn -t researcher --task "Research React 19 features"

# List all active agents
claude-flow agent list

# List agents by type
claude-flow agent list -t coder

# Get detailed agent status
claude-flow agent status agent-001

# Show agent metrics for 24 hours
claude-flow agent metrics -p 24h

# View agent logs
claude-flow agent logs -i agent-001 -f

# Configure agent pool
claude-flow agent pool --size 5 --min 2 --max 15 --auto-scale

# Health check with detailed metrics
claude-flow agent health -d

# Stop agent gracefully
claude-flow agent stop agent-001

# Force stop
claude-flow agent stop agent-001 -f
```

---

### `swarm` - Swarm Coordination

Multi-agent swarm initialization, coordination, and management.

```bash
claude-flow swarm <subcommand> [options]
```

#### Subcommands

| Subcommand | Description |
|------------|-------------|
| `init` | Initialize a new swarm with specified topology |
| `start` | Start swarm execution with objective and strategy |
| `status` | Show swarm status, progress, and metrics |
| `stop` | Stop swarm execution (with state save option) |
| `scale` | Scale swarm agent count up or down |
| `coordinate` | Execute V3 15-agent hierarchical mesh coordination |

#### Topologies

| Topology | Description | Best For |
|----------|-------------|----------|
| `hierarchical` | Queen-led coordination with worker agents | Structured tasks, clear authority |
| `mesh` | Fully connected peer-to-peer network | Collaborative work, redundancy |
| `ring` | Circular communication pattern | Sequential processing |
| `star` | Central coordinator with spoke agents | Centralized control |
| `hybrid` | Hierarchical mesh for maximum flexibility | Complex multi-domain tasks |

#### Strategies

| Strategy | Description | Agent Distribution |
|----------|-------------|-------------------|
| `research` | Distributed research and analysis | 1 coordinator, 4 researchers, 2 analysts |
| `development` | Collaborative code development | 1 coordinator, 1 architect, 3 coders, 2 testers, 1 reviewer |
| `testing` | Comprehensive test coverage | 1 test lead, 2 unit testers, 2 integration testers, 1 QA |
| `optimization` | Performance optimization | 1 performance lead, 2 profilers, 2 optimizers |
| `maintenance` | Codebase maintenance and refactoring | 1 coordinator, 2 refactorers, 1 documenter |
| `analysis` | Code analysis and documentation | 1 analyst lead, 2 code analysts, 1 security analyst |

#### Examples

```bash
# Initialize V3 swarm (recommended)
claude-flow swarm init --v3-mode

# Initialize with specific topology
claude-flow swarm init -t mesh --max-agents 10

# Start development swarm
claude-flow swarm start -o "Build REST API with authentication" -s development

# Parallel analysis swarm
claude-flow swarm start -o "Analyze codebase for performance issues" --parallel

# Check swarm status
claude-flow swarm status swarm-123

# Scale swarm
claude-flow swarm scale swarm-123 --agents 20

# V3 15-agent coordination
claude-flow swarm coordinate --agents 15

# Stop with state save
claude-flow swarm stop swarm-123 --save-state
```

---

### `memory` - Memory Management

AgentDB memory operations with vector search, caching, and optimization.

```bash
claude-flow memory <subcommand> [options]
```

#### Subcommands

| Subcommand | Aliases | Description |
|------------|---------|-------------|
| `store` | | Store data in memory with optional vector embedding |
| `retrieve` | `get` | Retrieve data from memory by key |
| `search` | | Semantic/vector search with HNSW indexing |
| `list` | `ls` | List memory entries with filtering |
| `delete` | `rm` | Delete memory entry |
| `stats` | | Show memory statistics and performance |
| `configure` | `config` | Configure memory backend and HNSW parameters |
| `cleanup` | | Clean up stale and expired entries |
| `compress` | | Compress and optimize memory storage |
| `export` | | Export memory to file (JSON, CSV, binary) |
| `import` | | Import memory from file |

#### Memory Backends

| Backend | Description | Performance |
|---------|-------------|-------------|
| `agentdb` | Vector database with HNSW indexing | 150x-12,500x faster search |
| `sqlite` | Lightweight local storage | Good for small datasets |
| `hybrid` | SQLite + AgentDB (recommended) | Best of both worlds |
| `memory` | In-memory (non-persistent) | Fastest, no persistence |

#### Search Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--query` | `-q` | Search query | required |
| `--namespace` | `-n` | Memory namespace | all |
| `--limit` | `-l` | Maximum results | `10` |
| `--threshold` | | Similarity threshold (0-1) | `0.7` |
| `--type` | `-t` | Search type (semantic, keyword, hybrid) | `semantic` |

#### Examples

```bash
# Store text data
claude-flow memory store -k "api/auth" -v "JWT implementation with refresh tokens"

# Store as vector embedding
claude-flow memory store -k "pattern/singleton" -v "Singleton pattern description" --vector

# Semantic search
claude-flow memory search -q "authentication patterns"

# Keyword search
claude-flow memory search -q "JWT" -t keyword

# Hybrid search with threshold
claude-flow memory search -q "security best practices" -t hybrid --threshold 0.8

# List entries by namespace
claude-flow memory list -n patterns

# Show memory statistics
claude-flow memory stats

# Configure HNSW parameters
claude-flow memory configure -b hybrid --hnsw-m 16 --hnsw-ef 200

# Cleanup old entries
claude-flow memory cleanup --older-than 30d

# Cleanup expired TTL entries
claude-flow memory cleanup --expired-only

# Compress with quantization (32x memory reduction)
claude-flow memory compress --quantize --bits 4

# Export memory
claude-flow memory export -o ./backup.json -f json

# Import memory
claude-flow memory import -i ./backup.json --merge
```

---

### `mcp` - MCP Server Management

Model Context Protocol server control and tool execution.

```bash
claude-flow mcp <subcommand> [options]
```

#### Subcommands

| Subcommand | Description |
|------------|-------------|
| `start` | Start MCP server with specified transport |
| `stop` | Stop MCP server (graceful or forced) |
| `status` | Show MCP server status and metrics |
| `health` | Check MCP server health |
| `restart` | Restart MCP server |
| `tools` | List available MCP tools by category |
| `toggle` | Enable or disable specific tools |
| `exec` | Execute an MCP tool directly |
| `logs` | Show MCP server logs |

#### Transport Types

| Transport | Description | Use Case |
|-----------|-------------|----------|
| `stdio` | Standard I/O (default) | Claude Code integration |
| `http` | HTTP REST API | Web integrations, remote access |
| `websocket` | WebSocket connection | Real-time bidirectional |

#### Tool Categories

| Category | Description | Tool Count |
|----------|-------------|------------|
| `agent` | Agent lifecycle management | 4 |
| `swarm` | Swarm coordination | 3 |
| `memory` | Memory operations | 3 |
| `config` | Configuration | 3 |
| `hooks` | Hook execution | 9 |
| `system` | System operations | 3 |

#### Examples

```bash
# Start with stdio (default)
claude-flow mcp start

# Start HTTP server on port 8080
claude-flow mcp start -t http -p 8080

# Start as background daemon
claude-flow mcp start -d

# Check server status
claude-flow mcp status

# Health check
claude-flow mcp health

# List all tools
claude-flow mcp tools

# List tools by category
claude-flow mcp tools -c memory

# Execute a tool
claude-flow mcp exec -t swarm/init -p '{"topology":"mesh"}'

# View logs
claude-flow mcp logs -n 50 -f

# Restart server
claude-flow mcp restart

# Stop server
claude-flow mcp stop
```

---

### `task` - Task Management

Create, assign, and manage tasks across agents.

```bash
claude-flow task <subcommand> [options]
```

#### Subcommands

| Subcommand | Description |
|------------|-------------|
| `create` | Create a new task with priority and dependencies |
| `list` | List tasks with status filtering |
| `status` | Show detailed task status |
| `cancel` | Cancel a pending or running task |
| `assign` | Assign task to specific agent |
| `retry` | Retry a failed task |

#### Examples

```bash
# Create a task
claude-flow task create "Implement user authentication" -p high

# Create task with dependencies
claude-flow task create "Write tests" --depends-on task-001

# List all tasks
claude-flow task list

# List pending tasks
claude-flow task list -s pending

# Get task status
claude-flow task status task-001

# Assign to agent
claude-flow task assign task-001 --agent coder-001

# Cancel task
claude-flow task cancel task-001

# Retry failed task
claude-flow task retry task-001
```

---

### `session` - Session Management

Manage session state, persistence, and restoration.

```bash
claude-flow session <subcommand> [options]
```

#### Subcommands

| Subcommand | Description |
|------------|-------------|
| `list` | List all sessions |
| `save` | Save current session state |
| `restore` | Restore a previous session |
| `delete` | Delete a session |
| `export` | Export session to file |
| `import` | Import session from file |
| `current` | Show current session info |

#### Examples

```bash
# List all sessions
claude-flow session list

# Save current session
claude-flow session save --name "feature-auth"

# Restore session
claude-flow session restore session-123

# Export session
claude-flow session export -o ./session-backup.json

# Import session
claude-flow session import -i ./session-backup.json

# Show current session
claude-flow session current

# Delete old session
claude-flow session delete session-123
```

---

### `config` - Configuration Management

Manage configuration, providers, and settings.

```bash
claude-flow config <subcommand> [options]
```

#### Subcommands

| Subcommand | Description |
|------------|-------------|
| `init` | Initialize configuration file |
| `get` | Get configuration value |
| `set` | Set configuration value |
| `providers` | Manage LLM provider configurations |
| `reset` | Reset configuration to defaults |
| `export` | Export configuration |
| `import` | Import configuration |

#### Examples

```bash
# Initialize config
claude-flow config init

# Get a value
claude-flow config get memory.backend

# Set a value
claude-flow config set swarm.topology mesh

# Configure providers
claude-flow config providers --add anthropic --api-key $ANTHROPIC_API_KEY

# Reset to defaults
claude-flow config reset --confirm

# Export config
claude-flow config export -o ./config-backup.json

# Import config
claude-flow config import -i ./config.json
```

---

### `status` - System Status

Monitor system status with real-time updates.

```bash
claude-flow status [subcommand] [options]
```

#### Subcommands

| Subcommand | Description |
|------------|-------------|
| `agents` | Show status of all agents |
| `tasks` | Show status of all tasks |
| `memory` | Show memory system status |

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--watch` | `-w` | Watch mode with auto-refresh | `false` |
| `--interval` | `-i` | Refresh interval in seconds | `5` |

#### Examples

```bash
# Show all status
claude-flow status

# Watch mode with 2s refresh
claude-flow status --watch -i 2

# Agent status only
claude-flow status agents

# Task status
claude-flow status tasks

# Memory status
claude-flow status memory
```

---

### `workflow` - Workflow Management

Execute and manage automated workflows.

```bash
claude-flow workflow <subcommand> [options]
```

#### Subcommands

| Subcommand | Description |
|------------|-------------|
| `run` | Execute a workflow |
| `validate` | Validate workflow definition |
| `list` | List available workflows |
| `status` | Show workflow execution status |
| `stop` | Stop running workflow |
| `template` | Manage workflow templates (list, show, create) |

#### Examples

```bash
# Run a workflow
claude-flow workflow run ./workflows/deploy.yaml

# Validate workflow
claude-flow workflow validate ./workflows/deploy.yaml

# List workflows
claude-flow workflow list

# Check workflow status
claude-flow workflow status workflow-123

# Stop workflow
claude-flow workflow stop workflow-123

# List templates
claude-flow workflow template list

# Create from template
claude-flow workflow template create --from deploy-standard
```

---

### `hooks` - Self-Learning Hooks

Advanced self-learning hooks with 17 subcommands for neural pattern recognition and background worker management.

```bash
claude-flow hooks <subcommand> [options]
```

#### Subcommands

| Subcommand | Description |
|------------|-------------|
| `pre-edit` | Execute before file edit (get context, agent suggestions) |
| `post-edit` | Execute after file edit (record outcome for learning) |
| `pre-command` | Execute before command (risk assessment) |
| `post-command` | Execute after command (record outcome) |
| `pre-task` | Execute before task (setup, validation) |
| `post-task` | Execute after task (cleanup, learning) |
| `session-end` | Execute on session end (save state) |
| `session-restore` | Execute on session restore (load state) |
| `route` | Route task to optimal agent using learned patterns |
| `explain` | Explain routing decision with transparency |
| `pretrain` | Bootstrap intelligence from repository |
| `build-agents` | Generate optimized agent configs from pretrain data |
| `metrics` | View learning metrics dashboard |
| `transfer` | Transfer patterns from another project |
| `list` | List all registered hooks |
| `intelligence` | RuVector intelligence (SONA, MoE, HNSW) |
| `worker` | Background worker management (12 workers) |

#### Learning Pipeline

The hooks system implements a 4-step learning pipeline:

1. **RETRIEVE** - Top-k memory injection with MMR diversity
2. **JUDGE** - LLM-as-judge trajectory evaluation
3. **DISTILL** - Extract strategy memories from trajectories
4. **CONSOLIDATE** - Dedup, detect contradictions, prune old patterns

#### Examples

```bash
# Pre-edit hook (get context and suggestions)
claude-flow hooks pre-edit ./src/auth/login.ts

# Post-edit hook (record success for learning)
claude-flow hooks post-edit ./src/auth/login.ts --success true

# Pre-command risk assessment
claude-flow hooks pre-command "rm -rf ./node_modules"

# Route task to optimal agent
claude-flow hooks route "Implement OAuth2 authentication"

# Explain routing decision
claude-flow hooks explain "Implement OAuth2 authentication"

# Bootstrap from repository
claude-flow hooks pretrain

# Build optimized agent configs
claude-flow hooks build-agents --focus "security"

# View learning metrics
claude-flow hooks metrics

# Transfer patterns from another project
claude-flow hooks transfer ../other-project

# View intelligence status (SONA, MoE, HNSW)
claude-flow hooks intelligence
```

#### Worker Subcommands

The `hooks worker` command manages 12 background workers for analysis and optimization tasks.

| Worker | Priority | Est. Time | Description |
|--------|----------|-----------|-------------|
| `ultralearn` | normal | 60s | Deep knowledge acquisition and learning |
| `optimize` | high | 30s | Performance optimization and tuning |
| `consolidate` | low | 20s | Memory consolidation and cleanup |
| `predict` | normal | 15s | Predictive preloading and anticipation |
| `audit` | critical | 45s | Security analysis and vulnerability scanning |
| `map` | normal | 30s | Codebase mapping and architecture analysis |
| `preload` | low | 10s | Resource preloading and cache warming |
| `deepdive` | normal | 60s | Deep code analysis and examination |
| `document` | normal | 45s | Auto-documentation generation |
| `refactor` | normal | 30s | Code refactoring suggestions |
| `benchmark` | normal | 60s | Performance benchmarking |
| `testgaps` | normal | 30s | Test coverage analysis |

##### Worker Commands

```bash
# List all available workers
claude-flow hooks worker list

# Detect triggers from prompt text
claude-flow hooks worker detect --prompt "optimize performance"

# Auto-dispatch workers when triggers match (min confidence 0.6)
claude-flow hooks worker detect --prompt "deep dive into auth" --auto-dispatch --min-confidence 0.6

# Manually dispatch a worker
claude-flow hooks worker dispatch --trigger refactor --context "auth module"

# Check worker status
claude-flow hooks worker status

# Cancel a running worker
claude-flow hooks worker cancel --id worker_refactor_1_abc123
```

##### Performance Targets

| Metric | Target |
|--------|--------|
| Trigger detection | <5ms |
| Worker spawn | <50ms |
| Max concurrent | 10 |

##### UserPromptSubmit Integration

Workers are automatically triggered via the `UserPromptSubmit` hook when prompt patterns match worker triggers with confidence ≥0.6.

---

### `hive-mind` - Consensus Coordination

Queen-led Byzantine fault-tolerant multi-agent coordination.

```bash
claude-flow hive-mind <subcommand> [options]
```

#### Subcommands

| Subcommand | Description |
|------------|-------------|
| `init` | Initialize hive-mind with topology and consensus strategy |
| `spawn` | Spawn agents in the hive (queen, worker, specialist) |
| `status` | Show hive-mind status with consensus health |
| `task` | Submit task to hive-mind for collaborative execution |
| `optimize-memory` | Optimize collective memory (distill, compress) |
| `shutdown` | Gracefully shutdown hive-mind |

#### Topologies

| Topology | Description |
|----------|-------------|
| `hierarchical` | Queen controls workers directly |
| `mesh` | Fully connected peer network |
| `hierarchical-mesh` | Hybrid: Queen + mesh workers |
| `adaptive` | Dynamic topology based on load |

#### Consensus Strategies

| Strategy | Description | Fault Tolerance |
|----------|-------------|-----------------|
| `byzantine` | Byzantine fault-tolerant (BFT) | Tolerates f < n/3 faulty nodes |
| `raft` | Leader-based consensus | Tolerates f < n/2 failures |
| `gossip` | Epidemic protocol for eventual consistency | High partition tolerance |
| `crdt` | Conflict-free replicated data types | Strong eventual consistency |
| `quorum` | Configurable quorum-based | Flexible fault tolerance |

#### Examples

```bash
# Initialize with defaults
claude-flow hive-mind init

# Initialize with Byzantine consensus
claude-flow hive-mind init -t hierarchical-mesh -c byzantine --agents 15

# Spawn queen
claude-flow hive-mind spawn --role queen --name hive-queen

# Spawn workers
claude-flow hive-mind spawn --role worker --count 5

# Spawn specialist
claude-flow hive-mind spawn --role specialist --specialty security

# Submit task for collaborative execution
claude-flow hive-mind task "Implement secure API endpoints" --consensus-required

# Check hive status
claude-flow hive-mind status --detailed

# Optimize collective memory
claude-flow hive-mind optimize-memory --distill --compress

# Graceful shutdown
claude-flow hive-mind shutdown --save-state
```

---

### `migrate` - V2 to V3 Migration

Migration tools for transitioning from V2 to V3.

```bash
claude-flow migrate <subcommand> [options]
```

#### Subcommands

| Subcommand | Description |
|------------|-------------|
| `status` | Check migration status and pending items |
| `run` | Execute migration (with dry-run option) |
| `verify` | Verify migration integrity |
| `rollback` | Rollback to previous version |
| `breaking` | Show V3 breaking changes |

#### Migration Targets

| Target | Description |
|--------|-------------|
| `config` | Migrate configuration files |
| `memory` | Migrate memory/database content |
| `agents` | Migrate agent configurations |
| `hooks` | Migrate hook definitions |
| `workflows` | Migrate workflow definitions |
| `all` | Full migration |

#### Examples

```bash
# Check migration status
claude-flow migrate status

# Preview migration (dry run)
claude-flow migrate run --dry-run

# Run full migration with backup
claude-flow migrate run -t all --backup

# Migrate specific component
claude-flow migrate run -t memory

# Verify migration
claude-flow migrate verify

# Auto-fix issues
claude-flow migrate verify --fix

# Show breaking changes
claude-flow migrate breaking

# Rollback
claude-flow migrate rollback --backup-id backup-1704369600
```

---

## Global Options

All commands support these global options:

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--help` | `-h` | Show help information | |
| `--version` | `-V` | Show version number | |
| `--verbose` | `-v` | Enable verbose output | `false` |
| `--quiet` | `-q` | Suppress non-essential output | `false` |
| `--config` | `-c` | Path to configuration file | `./claude-flow.config.json` |
| `--format` | `-f` | Output format (text, json, table) | `text` |
| `--no-color` | | Disable colored output | `false` |
| `--interactive` | `-i` | Enable interactive mode | `true` (if TTY) |

## Programmatic API

### CommandParser

```typescript
import { CommandParser, OutputFormatter } from '@claude-flow/cli';

// Create a parser instance
const parser = new CommandParser();

// Register a command
parser.registerCommand({
  name: 'mycommand',
  description: 'My custom command',
  options: [
    {
      name: 'type',
      short: 't',
      description: 'Operation type',
      type: 'string',
      choices: ['a', 'b', 'c'],
      default: 'a'
    }
  ],
  subcommands: [
    { name: 'sub1', description: 'First subcommand' },
    { name: 'sub2', description: 'Second subcommand' }
  ],
  action: async (ctx) => {
    // Command implementation
    return { success: true };
  }
});

// Parse arguments
const result = parser.parse(process.argv.slice(2));

// Validate flags
const errors = parser.validateFlags(result.flags, result.command);

// Get all registered commands
const commands = parser.getAllCommands();
```

### Output Formatting

```typescript
import { OutputFormatter, output, Progress, Spinner } from '@claude-flow/cli';

// Use the singleton instance
output.printSuccess('Operation completed');
output.printError('Something went wrong');
output.printWarning('Proceed with caution');
output.printInfo('FYI: This is informational');

// Or create a custom formatter
const formatter = new OutputFormatter({ color: true });

// Color methods
formatter.success('Green text');
formatter.error('Red text');
formatter.warning('Yellow text');
formatter.bold('Bold text');
formatter.dim('Dimmed text');
formatter.highlight('Highlighted text');

// Structured output
output.printTable({
  columns: [
    { key: 'name', header: 'Name', width: 20 },
    { key: 'status', header: 'Status', width: 10, align: 'right' }
  ],
  data: [
    { name: 'Agent 1', status: 'active' },
    { name: 'Agent 2', status: 'idle' }
  ]
});

output.printJson({ key: 'value' });
output.printList(['Item 1', 'Item 2', 'Item 3']);
output.printBox('Content here', 'Title');
output.progressBar(50, 100, 40); // 50% of 100, width 40

// Progress indication
const spinner = new Spinner('Loading...');
spinner.start();
// ... do work
spinner.succeed('Completed');

const progress = new Progress({ total: 100 });
progress.update(50); // 50%
progress.finish();
```

### Interactive Prompts

```typescript
import { text, select, confirm, input, multiSelect } from '@claude-flow/cli';

// Text input
const name = await text('Enter your name:');

// Selection
const choice = await select({
  message: 'Choose option:',
  options: [
    { label: 'Option A', value: 'A', hint: 'First option' },
    { label: 'Option B', value: 'B', hint: 'Second option' },
  ],
  default: 'A'
});

// Confirmation
const confirmed = await confirm({
  message: 'Continue?',
  default: false
});

// Input with validation
const email = await input({
  message: 'Enter email:',
  validate: (v) => v.includes('@') || 'Invalid email'
});

// Multi-select
const features = await multiSelect({
  message: 'Select features:',
  options: [
    { label: 'Feature A', value: 'a' },
    { label: 'Feature B', value: 'b' },
    { label: 'Feature C', value: 'c' },
  ]
});
```

## TypeScript Types

```typescript
import type {
  // Command types
  Command,
  CommandOption,
  CommandContext,
  CommandResult,

  // Parser types
  ParseResult,
  ParsedFlags,
  ParserOptions,

  // Config types
  V3Config,
  ProviderConfig,
  SwarmConfig,
  MemoryConfig,

  // Output types
  TableColumn,
  TableOptions,
  SpinnerOptions,
  ProgressOptions,

  // Prompt types
  SelectOption,
  InputOptions,
  ConfirmOptions,
} from '@claude-flow/cli';
```

## Environment Variables

```bash
# Configuration
CLAUDE_FLOW_CONFIG=./claude-flow.config.json
CLAUDE_FLOW_LOG_LEVEL=info

# Provider API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...

# MCP Server
CLAUDE_FLOW_MCP_PORT=3000
CLAUDE_FLOW_MCP_HOST=localhost
CLAUDE_FLOW_MCP_TRANSPORT=stdio

# Memory
CLAUDE_FLOW_MEMORY_BACKEND=hybrid
CLAUDE_FLOW_MEMORY_PATH=./data/memory
```

## Performance Targets

The CLI is optimized for V3 performance targets:

| Metric | Target | Description |
|--------|--------|-------------|
| Startup | <500ms | CLI initialization time |
| Command parsing | <5ms | Argument parsing time |
| MCP tool execution | <100ms | Tool call overhead |
| Memory search | 150x-12,500x faster | With HNSW indexing |
| SONA adaptation | <0.05ms | Neural learning overhead |

## Related Packages

- [@claude-flow/shared](../shared) - Shared types and utilities
- [@claude-flow/swarm](../swarm) - Swarm coordination module
- [@claude-flow/memory](../memory) - AgentDB memory system
- [@claude-flow/mcp](../mcp) - MCP server implementation
- [@claude-flow/hooks](../hooks) - Self-learning hooks system
- [@claude-flow/neural](../neural) - SONA neural learning

## License

MIT
