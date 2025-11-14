# Claude-Flow Architecture Questions - Quick Reference

**Context**: Real-world usage revealed gaps between documentation and behavior
**Full Analysis**: See `claude-flow-analysis-thesis.md` for complete details

---

## The Core Mystery

**Documentation Claims:**
> "claude-flow wraps ALL swarm and agent orchestration to manage shared memory and hooks"

**Observed Behavior:**
- MCP `agent_spawn` creates records, not working agents
- MCP `task_orchestrate` stores metadata, doesn't execute
- Hooks must be manually called via Bash commands
- No automatic coordination observed

---

## Critical Questions (Prioritized)

### 🔴 HIGH PRIORITY

**Q1: What does `mcp__claude-flow__agent_spawn` actually do?**
- Does it launch a subprocess/agent?
- Is it just metadata registration?
- How does it relate to Claude Code's Task tool?

**Q2: When is MCP setup actually needed?**
- Documentation says "optional" but implies benefits
- When should users use MCP vs just Task tool?
- What capabilities require MCP infrastructure?

**Q3: Are hooks supposed to auto-trigger?**
- Current pattern requires manual `npx claude-flow hooks ...` commands
- Is automatic hook execution planned/possible?
- Or is manual execution the intended design?

### 🟡 MEDIUM PRIORITY

**Q4: Why `"persisted": false` for swarms/agents?**
- Is this a bug or intentional?
- How does session restore work if not persisted?
- What determines if something gets persisted?

**Q5: How do Task-spawned agents access MCP infrastructure?**
- Documentation says agents should "check memory" and "use hooks"
- But there's no automatic discovery mechanism
- Is manual wiring required (via Bash hook commands)?

**Q6: What executes `task_orchestrate` tasks?**
- Tasks remain "pending" indefinitely
- Is there a background worker?
- Or is this just task tracking/planning?

### 🟢 LOW PRIORITY

**Q7: Agent persistence in memory database**
- Memory DB has 19K+ entries but NO `agents` table
- Where are MCP-spawned agents stored?
- Why aren't they in the coordination database?

**Q8: Relationship between swarmId and sessions**
- Hook `session-restore` doesn't find MCP-created swarms
- Are these different concepts?
- How should they integrate?

---

## Test Results Summary

| MCP Tool | Returns Success | Creates Metadata | Executes Work | Persisted |
|----------|----------------|------------------|---------------|-----------|
| `swarm_init` | ✅ | ✅ | ❌ | ❌ |
| `agent_spawn` | ✅ | ✅ | ❌ | ❌ |
| `task_orchestrate` | ✅ | ✅ | ❌ | ✅ |
| Hook commands | ✅ | ✅ | ✅ | ✅ |

**Finding**: MCP tools create infrastructure, but don't trigger execution.

---

## Three Possible Interpretations

### Interpretation A: By Design (Infrastructure-as-a-Service)
- MCP provides coordination scaffolding
- Users wire together with Task tool + manual hooks
- Flexible but requires understanding

**If true**: Documentation should clarify this is opt-in infrastructure

### Interpretation B: Incomplete Implementation
- Vision is turnkey orchestration
- Current version only implements metadata layer
- Auto-execution planned for future

**If true**: Roadmap should clarify planned features

### Interpretation C: Hybrid Approach
- Simple tasks: Use Task tool only
- Complex coordination: Add MCP + hooks
- Progressive enhancement model

**If true**: Documentation needs usage decision tree

---

## Recommended Investigation Files

Based on typical Node.js MCP server structure:

```
src/
├── mcp/
│   ├── server.js              # MCP server implementation
│   └── tools/
│       ├── swarm-init.js      # Q1: What does init actually do?
│       ├── agent-spawn.js     # Q2: Does this launch processes?
│       └── task-orchestrate.js # Q3: Is there an execution engine?
├── hooks/
│   ├── pre-task.js            # Q4: Can these auto-trigger?
│   ├── post-edit.js
│   └── session-restore.js     # Q5: Why no MCP swarm sessions?
├── memory/
│   ├── store.js               # Q6: How do agents access this?
│   └── schema.js              # Q7: Why no agents table?
└── core/
    ├── agent-runtime.js       # Q8: Does this exist?
    └── task-executor.js       # Q9: Is there a worker system?
```

---

## Expected Clarifications Needed

### For Documentation:

1. **Usage Patterns Section**:
   ```markdown
   ## When to Use MCP Tools
   - ✅ Multi-agent coordination with shared state
   - ✅ Session persistence and resume
   - ✅ Cross-agent memory sharing
   - ❌ Single-agent tasks (use Task tool only)
   - ❌ Simple sequential work
   ```

2. **Explicit Hook Execution**:
   ```markdown
   ## Hook Integration (REQUIRED for MCP Benefits)
   Agents spawned by Task tool MUST manually execute hooks:

   Bash("npx claude-flow hooks pre-task ...")
   Bash("npx claude-flow hooks post-edit ...")

   Future: Auto-hook integration planned for v3.0
   ```

3. **Layer Architecture Diagram**:
   ```
   Layer 1: MCP Metadata (swarm, agents, tasks)
            ↓
   Layer 2: Claude Code Task Tool (execution)
            ↓
   Layer 3: Manual Hook Calls (coordination)
   ```

### For Implementation:

1. **Persistence Flag**: Why false? Should it default to true?
2. **Auto-Hook Trigger**: Feasibility of automatic hook execution?
3. **Task Executor**: Is background execution planned?
4. **Agent Discovery**: How should Task agents find MCP infrastructure?

---

## Key Questions for Maintainers

1. Is the current design (metadata-only MCP + manual Task execution + opt-in hooks) intentional?
2. If yes, how should we document this clearly to prevent confusion?
3. If no, what's the roadmap for auto-execution/auto-coordination?
4. Should there be two modes: "simple" (Task-only) vs "advanced" (MCP+Task+Hooks)?

---

## User Impact

**Current Confusion:**
- Users expect MCP `agent_spawn` to spawn working agents
- Users expect `task_orchestrate` to execute tasks
- Users don't understand when MCP provides value

**Needed Clarity:**
- Explicit statement: "MCP creates coordination infrastructure"
- Clear decision tree: When to use MCP setup
- Step-by-step: How Task agents access MCP features

---

## Next Steps

1. **Code Review**: Investigate files listed in "Recommended Investigation Files"
2. **Maintainer Input**: Get design intent clarification
3. **Documentation Update**: Based on findings from #1 and #2
4. **Test Suite**: Validate all three interpretation scenarios
5. **User Guide**: Create clear usage patterns for common scenarios

---

**See Full Analysis**: `claude-flow-analysis-thesis.md` for complete details, test results, and technical deep-dive.
