# Claude Code Configuration - Claude Flow V3

## 🚨 AUTOMATIC SWARM ORCHESTRATION

**When starting work on complex tasks, Claude Code MUST automatically:**

1. **Initialize the swarm** using MCP tools
2. **Spawn concurrent agents** using Claude Code's Task tool
3. **Coordinate via hooks** and memory

### 🚨 CRITICAL: MCP + Task Tool in SAME Message

**When user says "spawn swarm" or requests complex work, Claude Code MUST in ONE message:**
1. Call MCP tools to initialize coordination
2. **IMMEDIATELY** call Task tool to spawn REAL working agents
3. Both MCP and Task calls must be in the SAME response

**MCP alone does NOT execute work - Task tool agents do the actual work!**

### 🛡️ Anti-Drift Coding Swarm (PREFERRED DEFAULT)

**To prevent goal drift, context drift, and agent desynchronization, ALWAYS use this configuration for coding swarms:**

```javascript
mcp__ruv-swarm__swarm_init({
  topology: "hierarchical",  // Single coordinator enforces alignment
  maxAgents: 8,              // Smaller team = less drift surface
  strategy: "specialized"    // Clear roles reduce ambiguity
})
```

**Why This Prevents Drift:**
| Choice | Anti-Drift Benefit |
|--------|-------------------|
| **hierarchical** | Coordinator validates each output against goal, catches divergence early |
| **maxAgents: 6-8** | Fewer agents = less coordination overhead, easier alignment |
| **specialized** | Clear boundaries - each agent knows exactly what to do, no overlap |

**Consensus for Hive-Mind:** Use `raft` (leader maintains authoritative state)

**Additional Anti-Drift Measures:**
- Frequent checkpoints via `post-task` hooks
- Shared memory namespace for all agents
- Short task cycles with verification gates

---

### 🔄 Auto-Start Swarm Protocol

When the user requests a complex task (multi-file changes, feature implementation, refactoring), **immediately execute this pattern in a SINGLE message:**

```javascript
// STEP 1: Initialize swarm coordination via MCP (in parallel with agent spawning)
// USE ANTI-DRIFT CONFIG: hierarchical + specialized + small team
mcp__ruv-swarm__swarm_init({
  topology: "hierarchical",
  maxAgents: 8,
  strategy: "specialized"
})

// STEP 2: Spawn agents concurrently using Claude Code's Task tool
// ALL Task calls MUST be in the SAME message for parallel execution
Task("Coordinator", "You are the swarm coordinator. Initialize session, coordinate other agents via memory. Run: npx claude-flow@v3alpha hooks session-start", "hierarchical-coordinator")
Task("Researcher", "Analyze requirements and existing code patterns. Store findings in memory via hooks.", "researcher")
Task("Architect", "Design implementation approach based on research. Document decisions in memory.", "system-architect")
Task("Coder", "Implement the solution following architect's design. Coordinate via hooks.", "coder")
Task("Tester", "Write tests for the implementation. Report coverage via hooks.", "tester")
Task("Reviewer", "Review code quality and security. Document findings.", "reviewer")

// STEP 3: Batch all todos
TodoWrite({ todos: [
  {content: "Initialize swarm coordination", status: "in_progress", activeForm: "Initializing swarm"},
  {content: "Research and analyze requirements", status: "in_progress", activeForm: "Researching requirements"},
  {content: "Design architecture", status: "pending", activeForm: "Designing architecture"},
  {content: "Implement solution", status: "pending", activeForm: "Implementing solution"},
  {content: "Write tests", status: "pending", activeForm: "Writing tests"},
  {content: "Review and finalize", status: "pending", activeForm: "Reviewing code"}
]})

// STEP 4: Store swarm state in memory
mcp__claude-flow__memory_usage({
  action: "store",
  namespace: "swarm",
  key: "current-session",
  value: JSON.stringify({task: "[user's task]", agents: 6, startedAt: new Date().toISOString()})
})
```

### 📋 Agent Routing by Task Type (Anti-Drift Optimized)

| Task Type | Required Agents | Topology | Strategy |
|-----------|-----------------|----------|----------|
| Bug Fix | coordinator, researcher, coder, tester | hierarchical | specialized |
| New Feature | coordinator, architect, coder, tester, reviewer | hierarchical | specialized |
| Refactoring | coordinator, architect, coder, reviewer | hierarchical | specialized |
| Performance | coordinator, researcher, performance-engineer, coder | hierarchical | specialized |
| Security Audit | coordinator, security-architect, security-auditor, reviewer | hierarchical | specialized |
| Memory Optimization | coordinator, memory-specialist, performance-engineer | hierarchical | specialized |
| Documentation | researcher, api-docs | mesh | balanced |

**Note:** All coding tasks use hierarchical + specialized to prevent drift. Mesh is only for read-only/research tasks.

### 🎯 Task Complexity Detection

**AUTO-INVOKE SWARM when task involves:**
- Multiple files (3+)
- New feature implementation
- Refactoring across modules
- API changes with tests
- Security-related changes
- Performance optimization
- Database schema changes

**SKIP SWARM for:**
- Single file edits
- Simple bug fixes (1-2 lines)
- Documentation updates
- Configuration changes
- Quick questions/exploration

## 🚨 CRITICAL: CONCURRENT EXECUTION & FILE MANAGEMENT

**ABSOLUTE RULES**:
1. ALL operations MUST be concurrent/parallel in a single message
2. **NEVER save working files, text/mds and tests to the root folder**
3. ALWAYS organize files in appropriate subdirectories
4. **USE CLAUDE CODE'S TASK TOOL** for spawning agents concurrently, not just MCP

### ⚡ GOLDEN RULE: "1 MESSAGE = ALL RELATED OPERATIONS"

**MANDATORY PATTERNS:**
- **TodoWrite**: ALWAYS batch ALL todos in ONE call (5-10+ todos minimum)
- **Task tool (Claude Code)**: ALWAYS spawn ALL agents in ONE message with full instructions
- **File operations**: ALWAYS batch ALL reads/writes/edits in ONE message
- **Bash commands**: ALWAYS batch ALL terminal operations in ONE message
- **Memory operations**: ALWAYS batch ALL memory store/retrieve in ONE message

### 📁 File Organization Rules

**NEVER save to root folder. Use these directories:**
- `/src` - Source code files
- `/tests` - Test files
- `/docs` - Documentation and markdown files
- `/config` - Configuration files
- `/scripts` - Utility scripts
- `/examples` - Example code

## Project Configuration

This project is configured with Claude Flow V3 (Anti-Drift Defaults):
- **Topology**: hierarchical (prevents drift via central coordination)
- **Max Agents**: 8 (smaller team = less drift)
- **Strategy**: specialized (clear roles, no overlap)
- **Consensus**: raft (leader maintains authoritative state)
- **Memory Backend**: hybrid (SQLite + AgentDB)
- **HNSW Indexing**: Enabled (150x-12,500x faster)
- **Neural Learning**: Enabled (SONA)

## 🚀 V3 CLI Commands (26 Commands, 140+ Subcommands)

### Core Commands

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `init` | 4 | Project initialization with wizard, presets, skills, hooks |
| `agent` | 8 | Agent lifecycle (spawn, list, status, stop, metrics, pool, health, logs) |
| `swarm` | 6 | Multi-agent swarm coordination and orchestration |
| `memory` | 11 | AgentDB memory with vector search (150x-12,500x faster) |
| `mcp` | 9 | MCP server management and tool execution |
| `task` | 6 | Task creation, assignment, and lifecycle |
| `session` | 7 | Session state management and persistence |
| `config` | 7 | Configuration management and provider setup |
| `status` | 3 | System status monitoring with watch mode |
| `start` | 3 | Service startup and quick launch |
| `workflow` | 6 | Workflow execution and template management |
| `hooks` | 17 | Self-learning hooks + 12 background workers |
| `hive-mind` | 6 | Queen-led Byzantine fault-tolerant consensus |

### Advanced Commands

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `daemon` | 5 | Background worker daemon (start, stop, status, trigger, enable) |
| `neural` | 5 | Neural pattern training (train, status, patterns, predict, optimize) |
| `security` | 6 | Security scanning (scan, audit, cve, threats, validate, report) |
| `performance` | 5 | Performance profiling (benchmark, profile, metrics, optimize, report) |
| `providers` | 5 | AI providers (list, add, remove, test, configure) |
| `plugins` | 5 | Plugin management (list, install, uninstall, enable, disable) |
| `deployment` | 5 | Deployment management (deploy, rollback, status, environments, release) |
| `embeddings` | 4 | Vector embeddings (embed, batch, search, init) - 75x faster with agentic-flow |
| `claims` | 4 | Claims-based authorization (check, grant, revoke, list) |
| `migrate` | 5 | V2 to V3 migration with rollback support |
| `process` | 4 | Background process management |
| `doctor` | 1 | System diagnostics with health checks |
| `completions` | 4 | Shell completions (bash, zsh, fish, powershell) |

### Quick CLI Examples

```bash
# Initialize project
npx claude-flow@v3alpha init --wizard

# Start daemon with background workers
npx claude-flow@v3alpha daemon start

# Spawn an agent
npx claude-flow@v3alpha agent spawn -t coder --name my-coder

# Initialize swarm
npx claude-flow@v3alpha swarm init --v3-mode

# Search memory (HNSW-indexed)
npx claude-flow@v3alpha memory search -q "authentication patterns"

# System diagnostics
npx claude-flow@v3alpha doctor --fix

# Security scan
npx claude-flow@v3alpha security scan --depth full

# Performance benchmark
npx claude-flow@v3alpha performance benchmark --suite all
```

## 🚀 Available Agents (60+ Types)

### Core Development
`coder`, `reviewer`, `tester`, `planner`, `researcher`

### V3 Specialized Agents
`security-architect`, `security-auditor`, `memory-specialist`, `performance-engineer`

### Swarm Coordination
`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`, `collective-intelligence-coordinator`, `swarm-memory-manager`

### Consensus & Distributed
`byzantine-coordinator`, `raft-manager`, `gossip-coordinator`, `consensus-builder`, `crdt-synchronizer`, `quorum-manager`, `security-manager`

### Performance & Optimization
`perf-analyzer`, `performance-benchmarker`, `task-orchestrator`, `memory-coordinator`, `smart-agent`

### GitHub & Repository
`github-modes`, `pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`, `workflow-automation`, `project-board-sync`, `repo-architect`, `multi-repo-swarm`

### SPARC Methodology
`sparc-coord`, `sparc-coder`, `specification`, `pseudocode`, `architecture`, `refinement`

### Specialized Development
`backend-dev`, `mobile-dev`, `ml-developer`, `cicd-engineer`, `api-docs`, `system-architect`, `code-analyzer`, `base-template-generator`

### Testing & Validation
`tdd-london-swarm`, `production-validator`

## 🪝 V3 Hooks System (17 Hooks + 12 Workers)

### Hook Categories

| Category | Hooks | Purpose |
|----------|-------|---------|
| **Core** | `pre-edit`, `post-edit`, `pre-command`, `post-command`, `pre-task`, `post-task` | Tool lifecycle |
| **Session** | `session-start`, `session-end`, `session-restore`, `notify` | Context management |
| **Intelligence** | `route`, `explain`, `pretrain`, `build-agents`, `transfer` | Neural learning |
| **Learning** | `intelligence` (trajectory-start/step/end, pattern-store/search, stats, attention) | Reinforcement |

### 12 Background Workers

| Worker | Priority | Description |
|--------|----------|-------------|
| `ultralearn` | normal | Deep knowledge acquisition |
| `optimize` | high | Performance optimization |
| `consolidate` | low | Memory consolidation |
| `predict` | normal | Predictive preloading |
| `audit` | critical | Security analysis |
| `map` | normal | Codebase mapping |
| `preload` | low | Resource preloading |
| `deepdive` | normal | Deep code analysis |
| `document` | normal | Auto-documentation |
| `refactor` | normal | Refactoring suggestions |
| `benchmark` | normal | Performance benchmarking |
| `testgaps` | normal | Test coverage analysis |

### Essential Hook Commands

```bash
# Core hooks
npx claude-flow@v3alpha hooks pre-task --description "[task]"
npx claude-flow@v3alpha hooks post-task --task-id "[id]" --success true
npx claude-flow@v3alpha hooks post-edit --file "[file]" --train-patterns

# Session management
npx claude-flow@v3alpha hooks session-start --session-id "[id]"
npx claude-flow@v3alpha hooks session-end --export-metrics true
npx claude-flow@v3alpha hooks session-restore --session-id "[id]"

# Intelligence routing
npx claude-flow@v3alpha hooks route --task "[task]"
npx claude-flow@v3alpha hooks explain --topic "[topic]"

# Neural learning
npx claude-flow@v3alpha hooks pretrain --model-type moe --epochs 10
npx claude-flow@v3alpha hooks build-agents --agent-types coder,tester

# Background workers
npx claude-flow@v3alpha hooks worker list
npx claude-flow@v3alpha hooks worker dispatch --trigger audit
npx claude-flow@v3alpha hooks worker status
```

## 🧠 Intelligence System (RuVector)

V3 includes the RuVector Intelligence System:
- **SONA**: Self-Optimizing Neural Architecture (<0.05ms adaptation)
- **MoE**: Mixture of Experts for specialized routing
- **HNSW**: 150x-12,500x faster pattern search
- **EWC++**: Elastic Weight Consolidation (prevents forgetting)
- **Flash Attention**: 2.49x-7.47x speedup

The 4-step intelligence pipeline:
1. **RETRIEVE** - Fetch relevant patterns via HNSW
2. **JUDGE** - Evaluate with verdicts (success/failure)
3. **DISTILL** - Extract key learnings via LoRA
4. **CONSOLIDATE** - Prevent catastrophic forgetting via EWC++

## 📦 Embeddings Package (v3.0.0-alpha.12)

Features:
- **sql.js**: Cross-platform SQLite persistent cache (WASM, no native compilation)
- **Document chunking**: Configurable overlap and size
- **Normalization**: L2, L1, min-max, z-score
- **Hyperbolic embeddings**: Poincaré ball model for hierarchical data
- **75x faster**: With agentic-flow ONNX integration
- **Neural substrate**: Integration with RuVector

## 🐝 Hive-Mind Consensus

### Topologies
- `hierarchical` - Queen controls workers directly
- `mesh` - Fully connected peer network
- `hierarchical-mesh` - Hybrid (recommended)
- `adaptive` - Dynamic based on load

### Consensus Strategies
- `byzantine` - BFT (tolerates f < n/3 faulty)
- `raft` - Leader-based (tolerates f < n/2)
- `gossip` - Epidemic for eventual consistency
- `crdt` - Conflict-free replicated data types
- `quorum` - Configurable quorum-based

## V3 Performance Targets

| Metric | Target |
|--------|--------|
| Flash Attention | 2.49x-7.47x speedup |
| HNSW Search | 150x-12,500x faster |
| Memory Reduction | 50-75% with quantization |
| MCP Response | <100ms |
| CLI Startup | <500ms |
| SONA Adaptation | <0.05ms |

## 🔧 Environment Variables

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

## 🔍 Doctor Health Checks

Run `npx claude-flow@v3alpha doctor` to check:
- Node.js version (20+)
- npm version (9+)
- Git installation
- Config file validity
- Daemon status
- Memory database
- API keys
- MCP servers
- Disk space
- TypeScript installation

## 🚀 Quick Setup

```bash
# Add MCP servers
claude mcp add claude-flow npx claude-flow@v3alpha mcp start
claude mcp add ruv-swarm npx ruv-swarm mcp start  # Optional
claude mcp add flow-nexus npx flow-nexus@latest mcp start  # Optional

# Start daemon
npx claude-flow@v3alpha daemon start

# Run doctor
npx claude-flow@v3alpha doctor --fix
```

## 🎯 Claude Code vs MCP Tools

### Claude Code Handles ALL EXECUTION:
- **Task tool**: Spawn and run agents concurrently
- File operations (Read, Write, Edit, MultiEdit, Glob, Grep)
- Code generation and programming
- Bash commands and system operations
- TodoWrite and task management
- Git operations

### MCP Tools ONLY COORDINATE:
- Swarm initialization (topology setup)
- Agent type definitions
- Task orchestration
- Memory management
- Neural features
- Performance tracking

**KEY**: MCP coordinates the strategy, Claude Code's Task tool executes with real agents.

## Support

- Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues

---

Remember: **Claude Flow coordinates, Claude Code creates!**

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
Never save working files, text/mds and tests to the root folder.
After spawning a swarm, wait, don't continuously check status.
