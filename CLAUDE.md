# Claude Code Configuration - SPARC Development Environment

> **Claude-Flow v2.7.34** - Enterprise AI Orchestration Platform
>
> Latest Release: MCP 2025-11 Compliance & Progressive Disclosure
> Repository: https://github.com/ruvnet/claude-flow

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

### 🎯 CRITICAL: Claude Code Task Tool for Agent Execution

**Claude Code's Task tool is the PRIMARY way to spawn agents:**
```javascript
// ✅ CORRECT: Use Claude Code's Task tool for parallel agent execution
[Single Message]:
  Task("Research agent", "Analyze requirements and patterns...", "researcher")
  Task("Coder agent", "Implement core features...", "coder")
  Task("Tester agent", "Create comprehensive tests...", "tester")
  Task("Reviewer agent", "Review code quality...", "reviewer")
  Task("Architect agent", "Design system architecture...", "system-architect")
```

**MCP tools are ONLY for coordination setup:**
- `mcp__claude-flow__swarm_init` - Initialize coordination topology
- `mcp__claude-flow__agent_spawn` - Define agent types for coordination
- `mcp__claude-flow__task_orchestrate` - Orchestrate high-level workflows

### 📁 File Organization Rules

**NEVER save to root folder. Use these directories:**
- `/src` - Source code files
- `/tests` - Test files
- `/docs` - Documentation and markdown files
- `/config` - Configuration files
- `/scripts` - Utility scripts
- `/examples` - Example code

## Project Overview

**Claude-Flow v2.7.34** is an enterprise-grade AI orchestration platform combining:
- **SPARC Methodology** - Systematic Test-Driven Development workflow
- **Hive-Mind Intelligence** - Queen-led AI coordination with specialized agents
- **AgentDB v1.6.1** - 150x faster vector search with HNSW indexing
- **Agentic-Flow v1.9.4** - Enterprise features with provider fallback
- **MCP 2025-11 Compliance** - Latest MCP specification with async job management
- **Progressive Disclosure** - 98.7% token reduction (150k→2k tokens)
- **25 Claude Skills** - Natural language-activated development tools
- **100+ MCP Tools** - Comprehensive swarm orchestration capabilities

## SPARC Commands

### Core Commands
- `npx claude-flow sparc modes` - List available modes
- `npx claude-flow sparc run <mode> "<task>"` - Execute specific mode
- `npx claude-flow sparc tdd "<feature>"` - Run complete TDD workflow
- `npx claude-flow sparc info <mode>` - Get mode details

### Batchtools Commands
- `npx claude-flow sparc batch <modes> "<task>"` - Parallel execution
- `npx claude-flow sparc pipeline "<task>"` - Full pipeline processing
- `npx claude-flow sparc concurrent <mode> "<tasks-file>"` - Multi-task processing

### Build Commands
- `npm run build` - Build project
- `npm run test` - Run tests
- `npm run lint` - Linting
- `npm run typecheck` - Type checking

## SPARC Workflow Phases

1. **Specification** - Requirements analysis (`sparc run spec-pseudocode`)
2. **Pseudocode** - Algorithm design (`sparc run spec-pseudocode`)
3. **Architecture** - System design (`sparc run architect`)
4. **Refinement** - TDD implementation (`sparc tdd`)
5. **Completion** - Integration (`sparc run integration`)

## Code Style & Best Practices

- **Modular Design**: Files under 500 lines
- **Environment Safety**: Never hardcode secrets
- **Test-First**: Write tests before implementation
- **Clean Architecture**: Separate concerns
- **Documentation**: Keep updated

## 🎨 Claude Skills (25 Total)

Natural language-activated skills - no commands to memorize!

### Development & Methodology (3)
- `sparc-methodology` - SPARC development workflow orchestration
- `pair-programming` - AI-assisted pair programming with role switching
- `skill-builder` - Create custom Claude Code skills

### Intelligence & Memory (6)
- `agentdb-vector-search` - Semantic vector search (150x faster)
- `agentdb-memory-patterns` - Persistent memory patterns for agents
- `agentdb-optimization` - Performance optimization (4-32x memory reduction)
- `agentdb-learning` - 9 reinforcement learning algorithms
- `agentdb-advanced` - QUIC sync, multi-DB, hybrid search
- `reasoningbank-agentdb` - Adaptive learning with trajectory tracking

### Swarm Coordination (3)
- `swarm-orchestration` - Multi-agent swarm coordination
- `swarm-advanced` - Advanced distributed workflows
- `hive-mind-advanced` - Queen-led collective intelligence

### GitHub Integration (5)
- `github-code-review` - AI-powered comprehensive code reviews
- `github-workflow-automation` - CI/CD pipeline automation
- `github-release-management` - Automated versioning and deployment
- `github-project-management` - Issue tracking and sprint planning
- `github-multi-repo` - Cross-repository coordination

### Automation & Quality (4)
- `hooks-automation` - Pre/post task hooks with MCP integration
- `verification-quality` - Truth scoring with 0.95 accuracy threshold
- `performance-analysis` - Bottleneck detection and optimization
- `stream-chain` - Multi-agent pipeline data transformation

### Flow Nexus Platform (3)
- `flow-nexus-swarm` - Cloud-based AI swarm deployment
- `flow-nexus-neural` - Distributed neural network training
- `flow-nexus-platform` - Comprehensive platform management

### Intelligence Systems (1)
- `reasoningbank-intelligence` - Pattern recognition and strategy optimization

## 🚀 Available Agents (54+ Total)

### Core Development
`coder`, `reviewer`, `tester`, `planner`, `researcher`, `analyst`

### Swarm Coordination
`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`, `collective-intelligence-coordinator`, `swarm-memory-manager`, `queen-coordinator`

### Consensus & Distributed
`byzantine-coordinator`, `raft-manager`, `gossip-coordinator`, `crdt-synchronizer`, `quorum-manager`, `security-manager`

### Performance & Optimization
`perf-analyzer`, `performance-benchmarker`, `task-orchestrator`, `memory-coordinator`, `smart-agent`, `topology-optimizer`, `resource-allocator`, `load-balancing-coordinator`

### GitHub & Repository
`github-modes`, `pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`, `workflow-automation`, `project-board-sync`, `repo-architect`, `multi-repo-swarm`, `sync-coordinator`

### SPARC Methodology
`sparc-coord`, `sparc-coder`, `specification`, `pseudocode`, `architecture`, `refinement`

### Specialized Development
`backend-dev`, `mobile-dev`, `ml-developer`, `cicd-engineer`, `api-docs`, `system-architect`, `code-analyzer`, `base-template-generator`

### Testing & Validation
`tdd-london-swarm`, `production-validator`

### Planning & Migration
`migration-planner`, `swarm-init`, `code-goal-planner`, `goal-planner`, `sublinear-goal-planner`

### Hive Mind & Intelligence
`scout-explorer`, `worker-specialist`, `swarm-memory-manager`

## 🎯 Claude Code vs MCP Tools

### Claude Code Handles ALL EXECUTION:
- **Task tool**: Spawn and run agents concurrently for actual work
- File operations (Read, Write, Edit, MultiEdit, Glob, Grep)
- Code generation and programming
- Bash commands and system operations
- Implementation work
- Project navigation and analysis
- TodoWrite and task management
- Git operations
- Package management
- Testing and debugging

### MCP Tools ONLY COORDINATE:
- Swarm initialization (topology setup)
- Agent type definitions (coordination patterns)
- Task orchestration (high-level planning)
- Memory management
- Neural features
- Performance tracking
- GitHub integration

**KEY**: MCP coordinates the strategy, Claude Code's Task tool executes with real agents.

## 🚀 Quick Setup

```bash
# Add MCP servers (Claude Flow required, others optional)
claude mcp add claude-flow npx claude-flow@alpha mcp start
claude mcp add ruv-swarm npx ruv-swarm mcp start  # Optional: Enhanced coordination
claude mcp add flow-nexus npx flow-nexus@latest mcp start  # Optional: Cloud features
```

## MCP Tool Categories

### Coordination
`swarm_init`, `agent_spawn`, `task_orchestrate`

### Monitoring
`swarm_status`, `agent_list`, `agent_metrics`, `task_status`, `task_results`

### Memory & Neural
`memory_usage`, `neural_status`, `neural_train`, `neural_patterns`

### GitHub Integration
`github_swarm`, `repo_analyze`, `pr_enhance`, `issue_triage`, `code_review`

### System
`benchmark_run`, `features_detect`, `swarm_monitor`

### Flow-Nexus MCP Tools (Optional Advanced Features)
Flow-Nexus extends MCP capabilities with 70+ cloud-based orchestration tools:

**Key MCP Tool Categories:**
- **Swarm & Agents**: `swarm_init`, `swarm_scale`, `agent_spawn`, `task_orchestrate`
- **Sandboxes**: `sandbox_create`, `sandbox_execute`, `sandbox_upload` (cloud execution)
- **Templates**: `template_list`, `template_deploy` (pre-built project templates)
- **Neural AI**: `neural_train`, `neural_patterns`, `seraphina_chat` (AI assistant)
- **GitHub**: `github_repo_analyze`, `github_pr_manage` (repository management)
- **Real-time**: `execution_stream_subscribe`, `realtime_subscribe` (live monitoring)
- **Storage**: `storage_upload`, `storage_list` (cloud file management)

**Authentication Required:**
- Register: `mcp__flow-nexus__user_register` or `npx flow-nexus@latest register`
- Login: `mcp__flow-nexus__user_login` or `npx flow-nexus@latest login`
- Access 70+ specialized MCP tools for advanced orchestration

## 🚀 Agent Execution Flow with Claude Code

### The Correct Pattern:

1. **Optional**: Use MCP tools to set up coordination topology
2. **REQUIRED**: Use Claude Code's Task tool to spawn agents that do actual work
3. **REQUIRED**: Each agent runs hooks for coordination
4. **REQUIRED**: Batch all operations in single messages

### Example Full-Stack Development:

```javascript
// Single message with all agent spawning via Claude Code's Task tool
[Parallel Agent Execution]:
  Task("Backend Developer", "Build REST API with Express. Use hooks for coordination.", "backend-dev")
  Task("Frontend Developer", "Create React UI. Coordinate with backend via memory.", "coder")
  Task("Database Architect", "Design PostgreSQL schema. Store schema in memory.", "code-analyzer")
  Task("Test Engineer", "Write Jest tests. Check memory for API contracts.", "tester")
  Task("DevOps Engineer", "Setup Docker and CI/CD. Document in memory.", "cicd-engineer")
  Task("Security Auditor", "Review authentication. Report findings via hooks.", "reviewer")
  
  // All todos batched together
  TodoWrite { todos: [...8-10 todos...] }
  
  // All file operations together
  Write "backend/server.js"
  Write "frontend/App.jsx"
  Write "database/schema.sql"
```

## 📋 Agent Coordination Protocol

### Every Agent Spawned via Task Tool MUST:

**1️⃣ BEFORE Work:**
```bash
npx claude-flow@alpha hooks pre-task --description "[task]"
npx claude-flow@alpha hooks session-restore --session-id "swarm-[id]"
```

**2️⃣ DURING Work:**
```bash
npx claude-flow@alpha hooks post-edit --file "[file]" --memory-key "swarm/[agent]/[step]"
npx claude-flow@alpha hooks notify --message "[what was done]"
```

**3️⃣ AFTER Work:**
```bash
npx claude-flow@alpha hooks post-task --task-id "[task]"
npx claude-flow@alpha hooks session-end --export-metrics true
```

## 🎯 Concurrent Execution Examples

### ✅ CORRECT WORKFLOW: MCP Coordinates, Claude Code Executes

```javascript
// Step 1: MCP tools set up coordination (optional, for complex tasks)
[Single Message - Coordination Setup]:
  mcp__claude-flow__swarm_init { topology: "mesh", maxAgents: 6 }
  mcp__claude-flow__agent_spawn { type: "researcher" }
  mcp__claude-flow__agent_spawn { type: "coder" }
  mcp__claude-flow__agent_spawn { type: "tester" }

// Step 2: Claude Code Task tool spawns ACTUAL agents that do the work
[Single Message - Parallel Agent Execution]:
  // Claude Code's Task tool spawns real agents concurrently
  Task("Research agent", "Analyze API requirements and best practices. Check memory for prior decisions.", "researcher")
  Task("Coder agent", "Implement REST endpoints with authentication. Coordinate via hooks.", "coder")
  Task("Database agent", "Design and implement database schema. Store decisions in memory.", "code-analyzer")
  Task("Tester agent", "Create comprehensive test suite with 90% coverage.", "tester")
  Task("Reviewer agent", "Review code quality and security. Document findings.", "reviewer")
  
  // Batch ALL todos in ONE call
  TodoWrite { todos: [
    {id: "1", content: "Research API patterns", status: "in_progress", priority: "high"},
    {id: "2", content: "Design database schema", status: "in_progress", priority: "high"},
    {id: "3", content: "Implement authentication", status: "pending", priority: "high"},
    {id: "4", content: "Build REST endpoints", status: "pending", priority: "high"},
    {id: "5", content: "Write unit tests", status: "pending", priority: "medium"},
    {id: "6", content: "Integration tests", status: "pending", priority: "medium"},
    {id: "7", content: "API documentation", status: "pending", priority: "low"},
    {id: "8", content: "Performance optimization", status: "pending", priority: "low"}
  ]}
  
  // Parallel file operations
  Bash "mkdir -p app/{src,tests,docs,config}"
  Write "app/package.json"
  Write "app/src/server.js"
  Write "app/tests/server.test.js"
  Write "app/docs/API.md"
```

### ❌ WRONG (Multiple Messages):
```javascript
Message 1: mcp__claude-flow__swarm_init
Message 2: Task("agent 1")
Message 3: TodoWrite { todos: [single todo] }
Message 4: Write "file.js"
// This breaks parallel coordination!
```

## Performance Benefits

- **98.7% token reduction** - Progressive disclosure (150k→2k tokens)
- **10x faster startup** - Lazy loading (500-1000ms → 50-100ms)
- **150x faster vector search** - HNSW indexing in AgentDB
- **90% memory reduction** - Efficient resource management (~50MB → ~5MB)
- **56% memory efficiency** - Optimized AgentDB storage
- **2.8-4.4x speed improvement** - Parallel execution
- **84.8% SWE-Bench solve rate** - Enterprise-grade reliability
- **27+ neural models** - Advanced pattern recognition

## Hooks Integration

### Pre-Operation
- Auto-assign agents by file type
- Validate commands for safety
- Prepare resources automatically
- Optimize topology by complexity
- Cache searches

### Post-Operation
- Auto-format code
- Train neural patterns
- Update memory
- Analyze performance
- Track token usage

### Session Management
- Generate summaries
- Persist state
- Track metrics
- Restore context
- Export workflows

## Advanced Features (v2.7.34)

### 🆕 Latest Features
- **MCP 2025-11 Compliance** - Version negotiation, async job management, MCP Registry
- **Progressive Disclosure** - 98.7% token reduction (150k→2k), 10x faster startup
- **AgentDB v1.6.1** - 150x faster vector search, 56% memory reduction
- **Agentic-Flow v1.9.4** - Provider fallback, circuit breaker, Supabase integration
- **25 Claude Skills** - Natural language-activated development tools

### 🚀 Core Capabilities
- **Automatic Topology Selection** - Mesh, hierarchical, or adaptive coordination
- **Parallel Execution** - 2.8-4.4x speed improvement
- **Neural Training** - 27+ neural models with pattern recognition
- **Bottleneck Analysis** - Automated performance optimization
- **Smart Auto-Spawning** - Context-aware agent deployment
- **Self-Healing Workflows** - Automatic recovery from failures
- **Cross-Session Memory** - Persistent state with AgentDB/ReasoningBank
- **GitHub Integration** - 6 specialized modes for repository management
- **WASM-Powered Memory** - ReasoningBank with semantic understanding
- **HNSW Indexing** - O(log n) vector search performance

## Integration Tips

1. Start with basic swarm init
2. Scale agents gradually
3. Use memory for context
4. Monitor progress regularly
5. Train patterns from success
6. Enable hooks automation
7. Use GitHub tools first

## 📁 Repository Structure

```
claude-flow/
├── src/                          # Source code (44 directories)
│   ├── agents/                   # Agent definitions and logic
│   ├── automation/               # Workflow automation
│   ├── cli/                      # CLI commands and interface
│   ├── coordination/             # Swarm coordination
│   ├── consciousness-symphony/   # Advanced AI coordination
│   ├── core/                     # Core functionality
│   ├── db/                       # Database integration
│   ├── enterprise/               # Enterprise features
│   ├── hive-mind/                # Hive-mind intelligence
│   ├── hooks/                    # Pre/post operation hooks
│   ├── mcp/                      # MCP server integration
│   ├── memory/                   # Memory management (AgentDB/ReasoningBank)
│   ├── neural/                   # Neural network integration
│   ├── reasoningbank/            # ReasoningBank WASM memory
│   ├── swarm/                    # Swarm orchestration
│   ├── verification/             # Truth scoring & quality verification
│   └── workflows/                # Workflow management
├── .claude/                      # Claude Code configuration
│   ├── agents/                   # 21+ agent type definitions
│   ├── commands/                 # 15+ slash commands
│   ├── skills/                   # 25 natural language skills
│   ├── checkpoints/              # Session checkpoints
│   └── templates/                # Project templates
├── tests/                        # Comprehensive test suite
│   ├── unit/                     # Unit tests
│   ├── integration/              # Integration tests
│   ├── e2e/                      # End-to-end tests
│   ├── performance/              # Performance benchmarks
│   └── security/                 # Security tests
├── docs/                         # 212+ documentation files
├── examples/                     # 32+ usage examples
├── bin/                          # Executable binaries
└── scripts/                      # Build and utility scripts
```

## 🧪 Testing Infrastructure

**Test Categories:**
- **Unit Tests** - Component-level testing (`npm run test:unit`)
- **Integration Tests** - System integration (`npm run test:integration`)
- **E2E Tests** - End-to-end workflows (`npm run test:e2e`)
- **Performance Tests** - Benchmarking (`npm run test:performance`)
- **Security Tests** - Vulnerability scanning
- **CLI Tests** - Command-line interface (`npm run test:cli`)

**Test Coverage:**
```bash
npm run test:coverage              # Full coverage report
npm run test:coverage:unit         # Unit test coverage
npm run test:coverage:integration  # Integration coverage
npm run test:coverage:e2e          # E2E coverage
```

**Specialized Tests:**
```bash
npm run test:comprehensive         # Comprehensive test suite
npm run test:health               # Health check tests
npm run test:swarm                # Swarm coordination tests
npm run test:benchmark            # Performance benchmarks
npm run test:load                 # Load testing
npm run test:docker               # Docker integration tests
```

## 📦 Key Dependencies

**Core:**
- `agentic-flow@^1.9.4` - Enterprise AI orchestration
- `agentdb@^1.6.1` - Vector database (150x faster search)
- `@anthropic-ai/claude-code@^2.0.1` - Claude Code SDK
- `@modelcontextprotocol/sdk@^1.0.4` - MCP SDK

**Enhanced Capabilities:**
- `ruv-swarm@^1.0.14` - Enhanced swarm coordination
- `flow-nexus@^0.1.128` - Cloud platform integration (optional)

**Recent Updates (v2.7.34):**
- AgentDB v1.6.1 - 150x faster vector search, 56% memory reduction
- Agentic-Flow v1.9.4 - Provider fallback, circuit breaker, Supabase
- MCP SDK v1.0.4 - MCP 2025-11 specification compliance

## 🆕 What's New in v2.7.34

**MCP 2025-11 Compliance:**
- ✅ Version negotiation with YYYY-MM format (e.g., '2025-11')
- ✅ Async job management with poll/resume semantics
- ✅ MCP Registry integration for server discovery
- ✅ JSON Schema 1.1 validation (Draft 2020-12)
- ✅ Enable with: `npx claude-flow mcp start --mcp2025`

**Progressive Disclosure:**
- ✅ 98.7% token reduction (150k→2k tokens)
- ✅ Filesystem-based tool discovery with lazy loading
- ✅ 10x faster startup (500-1000ms → 50-100ms)
- ✅ 90% memory reduction (~50MB → ~5MB)
- ✅ Scalability: 50 tools → 1000+ tools supported

**AgentDB Integration:**
- ✅ 150x faster vector search with HNSW indexing
- ✅ 56% memory reduction with optimized storage
- ✅ ReasoningBank integration for semantic memory
- ✅ SQLite backend (.swarm/memory.db) with JSON fallback

**Enterprise Features (via Agentic-Flow):**
- ✅ Provider fallback: Gemini→Claude→OpenRouter→ONNX
- ✅ Circuit breaker for cascading failure prevention
- ✅ Supabase cloud integration
- ✅ Checkpointing for crash recovery

## 🔧 Development Workflow

**1. Setup Development Environment:**
```bash
# Install dependencies
npm install

# Run type checking
npm run typecheck

# Start development mode
npm run dev
```

**2. Build & Test:**
```bash
# Clean build
npm run clean
npm run build

# Run tests
npm test
npm run test:coverage

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:e2e
```

**3. Code Quality:**
```bash
# Linting
npm run lint

# Format code
npm run format

# Type checking
npm run typecheck
npm run typecheck:watch
```

**4. Diagnostics:**
```bash
# System diagnostics
npm run diagnostics

# Health check
npm run health-check

# Memory stats
npx claude-flow memory stats
```

## 🎯 Best Practices for AI Assistants

**When Working with Claude-Flow:**
1. **Always batch operations** - Use single messages for related operations
2. **Leverage skills** - Use natural language to activate appropriate skills
3. **Use proper directories** - Never save working files to root
4. **Spawn agents concurrently** - Use Claude Code's Task tool in parallel
5. **Check memory** - Use AgentDB/ReasoningBank for persistent context
6. **Run hooks** - Use pre/post hooks for coordination
7. **Verify quality** - Enable truth scoring for critical operations
8. **Monitor performance** - Use built-in benchmarking tools

**Common Workflows:**
```bash
# Full-stack development with swarms
Just say: "Create a swarm to build a REST API with React frontend"
→ Activates: swarm-orchestration, backend-dev, coder skills

# Code review with quality verification
Just say: "Review this PR for security issues with quality verification"
→ Activates: github-code-review, verification-quality skills

# Performance optimization
Just say: "Analyze and optimize database query performance"
→ Activates: performance-analysis, code-analyzer skills

# Memory-based context retrieval
Just say: "Find similar code using vector search"
→ Activates: agentdb-vector-search skill
```

## 🔗 Support & Resources

- **Documentation**: https://github.com/ruvnet/claude-flow (212+ docs)
- **Issues**: https://github.com/ruvnet/claude-flow/issues
- **NPM Package**: https://www.npmjs.com/package/claude-flow
- **Flow-Nexus Platform**: https://flow-nexus.ruv.io (cloud features)
- **Agentics Foundation**: https://discord.com/invite/dfxmpwkG2D

---

Remember: **Claude Flow coordinates, Claude Code creates!**

## Version Information

- **Current Version**: v2.7.34
- **Release Date**: 2025-11-12
- **Node.js**: >=20.0.0
- **npm**: >=9.0.0

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
Never save working files, text/mds and tests to the root folder.
