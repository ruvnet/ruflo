# Claude Code Configuration - SPARC Development Environment

## 🚨 CRITICAL: Concurrent Execution Rules

**ABSOLUTE RULE**: ALL operations MUST be concurrent/parallel in ONE message:

### 🔴 Mandatory Patterns:
- **TodoWrite**: ALWAYS batch ALL todos in ONE call (5-10+ minimum)
- **Task tool**: ALWAYS spawn ALL agents in ONE message
- **File operations**: ALWAYS batch ALL reads/writes/edits
- **Bash commands**: ALWAYS batch ALL terminal operations
- **Memory operations**: ALWAYS batch ALL store/retrieve

### ⚡ Golden Rule: "1 MESSAGE = ALL RELATED OPERATIONS"

✅ **CORRECT**: Everything in ONE message
```javascript
[Single Message]:
  - TodoWrite { todos: [10+ todos] }
  - Task("Agent 1"), Task("Agent 2"), Task("Agent 3")
  - Read("file1.js"), Read("file2.js")
  - Write("output1.js"), Write("output2.js")
  - Bash("npm install"), Bash("npm test")
```

❌ **WRONG**: Multiple messages (6x slower!)

## 🎯 Claude Code vs MCP Tools

### Claude Code Handles ALL:
- File operations (Read/Write/Edit/Glob/Grep)
- Code generation & programming
- Bash commands & system operations
- TodoWrite & task management
- Git operations & package management
- Testing, debugging & implementation

### MCP Tools ONLY:
- Coordination & planning
- Memory management
- Performance tracking
- Swarm orchestration
- GitHub integration

**Key**: MCP coordinates, Claude Code executes!

## 📦 SPARC Commands

### Core:
- `npx claude-flow sparc modes` - List modes
- `npx claude-flow sparc run <mode> "<task>"` - Execute mode
- `npx claude-flow sparc tdd "<feature>"` - TDD workflow
- `npx claude-flow sparc batch <modes> "<task>"` - Parallel modes
- `npx claude-flow sparc pipeline "<task>"` - Full pipeline

### Build:
- `npm run build/test/lint/typecheck`

## 🤖 Agent Reference (54 Total)

### Core Development
| Agent | Purpose |
|-------|---------|
| coder | Implementation |
| reviewer | Code quality |
| tester | Test creation |
| planner | Strategic planning |
| researcher | Information gathering |

### Swarm Coordination
| Agent | Purpose |
|-------|---------|
| hierarchical-coordinator | Queen-led |
| mesh-coordinator | Peer-to-peer |
| adaptive-coordinator | Dynamic topology |
| collective-intelligence-coordinator | Hive-mind |
| swarm-memory-manager | Distributed memory |

### Specialized
| Agent | Purpose |
|-------|---------|
| backend-dev | API development |
| mobile-dev | React Native |
| ml-developer | Machine learning |
| system-architect | High-level design |
| sparc-coder | TDD implementation |
| production-validator | Real validation |

### GitHub Integration
| Agent | Purpose |
|-------|---------|
| github-modes | Comprehensive integration |
| pr-manager | Pull requests |
| code-review-swarm | Multi-agent review |
| issue-tracker | Issue management |
| release-manager | Release coordination |

### Performance & Consensus
| Agent | Purpose |
|-------|---------|
| perf-analyzer | Bottleneck identification |
| performance-benchmarker | Performance testing |
| byzantine-coordinator | Fault tolerance |
| raft-manager | Leader election |
| consensus-builder | Decision-making |

## 🚀 Swarm Patterns

### Full-Stack Swarm (8 agents)
```bash
Task("Architecture", "...", "system-architect")
Task("Backend", "...", "backend-dev")
Task("Frontend", "...", "mobile-dev")
Task("Database", "...", "coder")
Task("API Docs", "...", "api-docs")
Task("CI/CD", "...", "cicd-engineer")
Task("Testing", "...", "performance-benchmarker")
Task("Validation", "...", "production-validator")
```

### Agent Count Rules
1. **CLI Args First**: `npx claude-flow@alpha --agents 5`
2. **Auto-Decide**: Simple (3-4), Medium (5-7), Complex (8-12)

## 📋 Agent Coordination Protocol

### Every Agent MUST:

**1️⃣ START:**
```bash
npx claude-flow@alpha hooks pre-task --description "[task]"
npx claude-flow@alpha hooks session-restore --session-id "swarm-[id]"
```

**2️⃣ DURING (After EVERY step):**
```bash
npx claude-flow@alpha hooks post-edit --file "[file]" --memory-key "swarm/[agent]/[step]"
npx claude-flow@alpha hooks notify --message "[decision]"
```

**3️⃣ END:**
```bash
npx claude-flow@alpha hooks post-task --task-id "[task]" --analyze-performance true
npx claude-flow@alpha hooks session-end --export-metrics true
```

## 🛠️ MCP Setup

```bash
# Add MCP server
claude mcp add claude-flow npx claude-flow@alpha mcp start
```

### Key MCP Tools:
- `mcp__claude-flow__swarm_init` - Setup topology
- `mcp__claude-flow__agent_spawn` - Create agents
- `mcp__claude-flow__task_orchestrate` - Coordinate tasks
- `mcp__claude-flow__memory_usage` - Persistent memory
- `mcp__claude-flow__swarm_status` - Monitor progress

## 📊 Progress Format

```
📊 Progress Overview
├── Total: X | ✅ Complete: X | 🔄 Active: X | ⭕ Todo: X
└── Priority: 🔴 HIGH | 🟡 MEDIUM | 🟢 LOW
```

## 🎯 Performance Tips

1. **Batch Everything** - Multiple operations = 1 message
2. **Parallel First** - Think concurrent execution
3. **Memory is Key** - Cross-agent coordination
4. **Monitor Progress** - Real-time tracking
5. **Enable Hooks** - Automated coordination

## ⚡ Quick Examples

### Research Task
```javascript
// Single message with all operations
mcp__claude-flow__swarm_init { topology: "mesh", maxAgents: 5 }
mcp__claude-flow__agent_spawn { type: "researcher" }
mcp__claude-flow__agent_spawn { type: "code-analyzer" }
mcp__claude-flow__task_orchestrate { task: "Research patterns" }
```

### Development Task
```javascript
// All todos in ONE call
TodoWrite { todos: [
  { id: "1", content: "Design API", status: "in_progress", priority: "high" },
  { id: "2", content: "Implement auth", status: "pending", priority: "high" },
  { id: "3", content: "Write tests", status: "pending", priority: "medium" },
  { id: "4", content: "Documentation", status: "pending", priority: "low" }
]}
```

## 🔗 Resources

- Docs: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues
- SPARC: https://github.com/ruvnet/claude-flow/docs/sparc.md

---

**Remember**: Claude Flow coordinates, Claude Code creates!
- Never save working files, text/mds and tests to the root folder. 