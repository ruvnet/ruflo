# Claude-Flow MCP Tools Investigation: Definitive Findings

**Date**: 2025-11-13
**Investigator**: Claude Code (systematic code analysis)
**Context**: Response to user's analysis thesis and questions
**Source Code Version**: v2.7.34

---

## Executive Summary

**FINDING**: Your hypothesis is **100% correct**. Claude-Flow MCP tools create **metadata only** - they do NOT spawn working agents or execute tasks. This is **by design**, not a bug.

### The Three-Layer Architecture (CONFIRMED)

```
Layer 1: MCP Tools (Metadata Registry)
         ├─ swarm_init      → Creates swarm metadata record
         ├─ agent_spawn     → Creates agent metadata record
         ├─ task_orchestrate → Creates task metadata record
         └─ memory_usage    → Stores/retrieves coordination data

Layer 2: Claude Code Task Tool (Actual Execution)
         └─ Task("agent", "instructions", "type") → Spawns REAL working agent

Layer 3: Hook System (Manual Coordination)
         └─ npx claude-flow hooks <command> → Manual CLI execution required
```

---

## Critical Code Evidence

### Evidence #1: swarm_init - Metadata Only

**File**: `/workspaces/claude-flow/src/mcp/mcp-server.js:1170-1226`

```javascript
case 'swarm_init':
  const swarmId = `swarm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Track swarm creation (in-memory tracker)
  if (global.agentTracker) {
    global.agentTracker.trackSwarm(swarmId, {
      topology: args.topology || 'mesh',
      maxAgents: args.maxAgents || 5,
      strategy: args.strategy || 'balanced',
    });
  }

  // Create metadata object
  const swarmData = {
    id: swarmId,
    name: `Swarm-${new Date().toISOString().split('T')[0]}`,
    topology: args.topology || 'hierarchical',
    queenMode: 'collaborative',
    maxAgents: args.maxAgents || 8,
    consensusThreshold: 0.7,
    memoryTTL: 86400,
    config: JSON.stringify({ strategy: args.strategy || 'auto' })
  };

  // Store in memory
  await this.memoryStore.store(`swarm:${swarmId}`, JSON.stringify(swarmData), {
    namespace: 'swarms',
    metadata: { type: 'swarm_data', sessionId: this.sessionId }
  });

  return {
    success: true,
    swarmId: swarmId,
    topology: swarmData.topology,
    maxAgents: swarmData.maxAgents,
    strategy: args.strategy || 'auto',
    status: 'initialized',  // ⚠️ Just a status label
    persisted: !!this.databaseManager, // ⚠️ Often false
    timestamp: new Date().toISOString()
  };
```

**What This Does**:
- ✅ Generates a unique swarm ID
- ✅ Creates a JSON metadata object
- ✅ Stores metadata in memory
- ❌ Does NOT initialize any coordination infrastructure
- ❌ Does NOT create any message buses
- ❌ Does NOT start any background processes
- ❌ Does NOT set up agent pools

**Result**: Returns `success: true` with metadata. Nothing is "running".

---

### Evidence #2: agent_spawn - No Subprocess Spawning

**File**: `/workspaces/claude-flow/src/mcp/mcp-server.js:1228-1287`

```javascript
case 'agent_spawn':
  const agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const resolvedType = resolveLegacyAgentType(args.type); // Just resolves string

  // Create metadata object
  const agentData = {
    id: agentId,
    swarmId: args.swarmId || (await this.getActiveSwarmId()),
    name: args.name || `${resolvedType}-${Date.now()}`,
    type: resolvedType,
    status: 'active',  // ⚠️ Just a string label
    capabilities: JSON.stringify(args.capabilities || []),
    metadata: JSON.stringify({
      sessionId: this.sessionId,
      createdBy: 'mcp-server',
      spawnedAt: new Date().toISOString()
    })
  };

  // Store in memory
  await this.memoryStore.store(`agent:${swarmId}:${agentId}`, JSON.stringify(agentData), {
    namespace: 'agents',
    metadata: { type: 'agent_data', swarmId: swarmId }
  });

  // Track in global registry (just another map)
  if (global.agentTracker) {
    global.agentTracker.trackAgent(agentId, {
      ...agentData,
      capabilities: args.capabilities || []
    });
  }

  return {
    success: true,
    agentId: agentId,
    type: args.type,
    name: agentData.name,
    status: 'active',  // ⚠️ Fake status
    capabilities: args.capabilities || [],
    persisted: !!this.databaseManager,
    timestamp: new Date().toISOString()
  };
```

**What This Does**:
- ✅ Generates a unique agent ID
- ✅ Creates a JSON metadata object with type/capabilities
- ✅ Stores metadata in memory store
- ✅ Adds entry to in-memory tracker (`global.agentTracker`)
- ❌ Does NOT call `child_process.spawn()` or `fork()`
- ❌ Does NOT create a subprocess
- ❌ Does NOT integrate with Claude Code's Task tool
- ❌ Does NOT initialize LLM connection
- ❌ Returns `status: 'active'` but nothing is running!

**Result**: Returns `success: true` with metadata. No actual agent process exists.

---

### Evidence #3: task_orchestrate - No Execution Engine

**File**: `/workspaces/claude-flow/src/mcp/mcp-server.js:2060-2124`

```javascript
case 'task_orchestrate':
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Track task creation (in-memory map)
  if (global.agentTracker) {
    global.agentTracker.trackTask(taskId, {
      task: args.task,
      strategy: args.strategy || 'parallel',
      priority: args.priority || 'medium',
      status: 'pending',  // ⚠️ Stays pending forever
      swarmId: args.swarmId
    });
  }

  // Create metadata object
  const taskData = {
    id: taskId,
    swarmId: swarmIdForTask,
    description: args.task,
    priority: args.priority || 'medium',
    strategy: args.strategy || 'auto',
    status: 'pending',  // ⚠️ Never changes
    dependencies: JSON.stringify(args.dependencies || []),
    assignedAgents: JSON.stringify([]),  // ⚠️ Empty array
    requireConsensus: false,
    maxAgents: 5,
    requiredCapabilities: JSON.stringify([]),
    metadata: JSON.stringify({
      sessionId: this.sessionId,
      createdBy: 'mcp-server',
      orchestratedAt: new Date().toISOString()
    })
  };

  // Store in memory
  await this.memoryStore.store(`task:${swarmIdForTask}:${taskId}`, JSON.stringify(taskData), {
    namespace: 'tasks',
    metadata: { type: 'task_data', swarmId: swarmIdForTask }
  });

  return {
    success: true,
    taskId: taskId,
    task: args.task,
    strategy: taskData.strategy,
    priority: taskData.priority,
    status: 'pending',  // ⚠️ Will stay pending indefinitely
    persisted: true,
    timestamp: new Date().toISOString()
  };
```

**What This Does**:
- ✅ Generates a unique task ID
- ✅ Creates a JSON metadata object describing the task
- ✅ Stores metadata in memory
- ✅ Returns `status: 'pending'`
- ❌ Does NOT queue the task for execution
- ❌ Does NOT assign the task to any agent
- ❌ Does NOT trigger any background worker
- ❌ Does NOT call Claude Code's Task tool
- ❌ Does NOT spawn any agents to execute the task
- ❌ Task metadata sits in memory forever with `status: 'pending'`

**Result**: Task is registered but **nothing executes it**. No worker system exists.

---

### Evidence #4: agent-tracker.js - Just an In-Memory Map

**File**: `/workspaces/claude-flow/src/mcp/implementations/agent-tracker.js:1-147`

```javascript
class AgentTracker {
  constructor() {
    this.agents = new Map();    // ⚠️ Just a JavaScript Map
    this.swarms = new Map();    // ⚠️ Just a JavaScript Map
    this.tasks = new Map();     // ⚠️ Just a JavaScript Map
  }

  trackAgent(agentId, agentData) {
    this.agents.set(agentId, {
      ...agentData,
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString()
    });
    // ⚠️ Just stores in Map - doesn't spawn anything
  }

  trackSwarm(swarmId, swarmData) {
    this.swarms.set(swarmId, {
      ...swarmData,
      agentCount: 0,
      activeAgents: 0,
      taskCount: 0,
      createdAt: new Date().toISOString()
    });
    // ⚠️ Just stores in Map - doesn't initialize anything
  }

  trackTask(taskId, taskData) {
    this.tasks.set(taskId, {
      ...taskData,
      createdAt: new Date().toISOString(),
      status: taskData.status || 'pending'  // ⚠️ Never updated
    });
    // ⚠️ Just stores in Map - doesn't execute anything
  }
}

// Singleton instance - just a global Map holder
const tracker = new AgentTracker();
```

**What This Is**:
- A simple in-memory registry (3 JavaScript Maps)
- No execution logic
- No subprocess management
- No task execution engine
- Just stores metadata that MCP tools create

**Purpose**: Allows `agent_list` and `swarm_status` MCP tools to return the metadata that was stored by `agent_spawn` and `swarm_init`.

---

### Evidence #5: Hook System - Manual CLI Execution Required

**File**: `/workspaces/claude-flow/src/hooks/index.ts:1-221`

```typescript
/**
 * Legacy Hook System - Migration Notice
 *
 * This hook system has been consolidated with the more advanced
 * agentic-flow-hooks system.
 * All functionality is now available through the modern implementation at:
 * src/services/agentic-flow-hooks/
 *
 * This file provides backward compatibility redirects while we
 * complete the migration.
 */

// Re-export the modern agentic-flow-hooks system
export {
  agenticHookManager,
  initializeAgenticFlowHooks,
} from '../services/agentic-flow-hooks/index.js';

console.info(`
🔄 MIGRATION NOTICE: Hook System Consolidation

The legacy hook system in src/hooks/ has been consolidated with the advanced
agentic-flow-hooks system for better performance and functionality.

✅ New System Features:
  - Advanced pipeline management
  - Neural pattern learning
  - Performance optimization
  - Memory coordination hooks
  - LLM integration hooks
  - Comprehensive verification system

🚀 Get Started:
  import { agenticHookManager, initializeAgenticFlowHooks }
         from '../services/agentic-flow-hooks/'
  await initializeAgenticFlowHooks()
  agenticHookManager.register({ ... })
`);
```

**What This Reveals**:
- Hooks are CLI commands: `npx claude-flow hooks pre-task`, etc.
- Hooks must be **manually called** via Bash
- No automatic triggering mechanism in MCP
- Hook system is separate from MCP tool execution
- Legacy system redirects to agentic-flow-hooks
- Modern system requires explicit initialization

---

## Answering Your Critical Questions

### Q1: What does `agent_spawn` actually do?

**Answer**: **Option A - Metadata Registry**

`agent_spawn` does the following:
1. Generates a unique agent ID
2. Creates a JSON object with agent metadata (type, capabilities, name)
3. Stores the JSON in the memory store
4. Adds an entry to `global.agentTracker` (just a Map)
5. Returns `{ success: true, agentId, status: 'active' }`

**It does NOT**:
- Spawn a subprocess
- Create an LLM instance
- Integrate with Claude Code's Task tool
- Initialize any runtime
- Start any execution

**Evidence**: No calls to `child_process.spawn()`, `fork()`, `Worker`, or Task tool anywhere in the handler.

---

### Q2: When is MCP setup actually needed?

**Answer**: **MCP is infrastructure-as-a-service for complex multi-agent coordination**

**Use MCP when**:
- You need shared memory across multiple agents
- You want persistent coordination metadata
- You're building complex multi-agent systems
- You need session restoration capabilities
- You want memory namespacing and TTL

**Skip MCP when**:
- You have a single-agent task
- Simple sequential work
- Quick one-off tasks
- No need for cross-agent coordination

**Key Insight**: MCP doesn't spawn agents - it creates a **registry** that agents (spawned by Claude Code's Task tool) can **optionally** query and coordinate through.

---

### Q3: Are hooks supposed to auto-trigger?

**Answer**: **No. Hooks must be manually executed via Bash commands.**

**Current Design** (from code evidence):
- Hooks are CLI commands: `npx claude-flow hooks pre-task ...`
- Agents must manually call hooks via Bash
- No event bus auto-triggering observed in code
- Legacy system has been migrated to agentic-flow-hooks

**From CLAUDE.md documentation**:
```markdown
### Every Agent Spawned via Task Tool MUST:

**1️⃣ BEFORE Work:**
npx claude-flow@alpha hooks pre-task --description "[task]"

**2️⃣ DURING Work:**
npx claude-flow@alpha hooks post-edit --file "[file]"

**3️⃣ AFTER Work:**
npx claude-flow@alpha hooks post-task --task-id "[task]"
```

This is **opt-in coordination**, not automatic.

---

### Q4: Why `"persisted": false` for swarms/agents?

**Answer**: **This flag indicates if a database manager is initialized, not if metadata was stored.**

**Code Evidence** (mcp-server.js:1224, 1285):
```javascript
persisted: !!this.databaseManager
```

**What This Means**:
- `persisted: false` → No `databaseManager` instance exists
- Metadata **is** stored in `memoryStore` (the in-memory/SQLite fallback)
- Flag is misleading - metadata IS persisted to memory store
- Flag should probably be renamed to `databaseAvailable` or `usingSQLite`

**Why False**:
- MCP server may be running without full database initialization
- Falls back to in-memory storage
- Metadata is still accessible via memory store

---

### Q5: How do Task-spawned agents access MCP infrastructure?

**Answer**: **Manual integration via Bash hook commands**

**The Pattern**:
1. User calls `mcp__claude-flow__swarm_init` → Creates swarm metadata
2. User calls `mcp__claude-flow__agent_spawn` → Creates agent metadata
3. User calls Claude Code's `Task` tool → Spawns REAL working agent
4. Agent manually executes: `npx claude-flow hooks pre-task`
5. Hook CLI reads from shared memory store
6. Hook CLI writes coordination data back to memory store
7. Other agents can read this data via their own hook calls

**No Automatic Discovery**:
- Agents don't automatically "join" MCP swarms
- No environment variable injection
- No SDK auto-initialization
- Manual wiring required

---

### Q6: What executes `task_orchestrate` tasks?

**Answer**: **Nothing. Task metadata sits pending indefinitely.**

**Code Evidence**:
- `task_orchestrate` creates task metadata with `status: 'pending'`
- No code updates task status
- No worker system observed
- No task queue processor
- No background job scheduler

**What the user must do**:
1. Call `task_orchestrate` to register task metadata
2. Manually call Task tool to spawn agents
3. Pass task description to agents explicitly
4. Agents do the work
5. Optionally update task metadata via hooks or memory store

**Interpretation**: `task_orchestrate` is a **planning/tracking** tool, not an execution engine.

---

## The Correct Mental Model

### What MCP Tools Actually Provide

**MCP Tools = Coordination Scaffolding (Metadata Registry + Memory Store)**

```
┌─────────────────────────────────────────────────────┐
│           Claude-Flow MCP Server                    │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │  Tool Handlers (metadata creators)           │  │
│  │  • swarm_init     → JSON metadata           │  │
│  │  • agent_spawn    → JSON metadata           │  │
│  │  • task_orchestrate → JSON metadata         │  │
│  │  • memory_usage   → Store/retrieve          │  │
│  └─────────────────┬────────────────────────────┘  │
│                    │                                │
│                    ▼                                │
│  ┌──────────────────────────────────────────────┐  │
│  │  Shared Memory Store (SQLite or in-memory)   │  │
│  │  • swarms/    → Swarm metadata              │  │
│  │  • agents/    → Agent metadata              │  │
│  │  • tasks/     → Task metadata               │  │
│  │  • patterns/  → Neural patterns             │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │  Global Tracker (in-memory Maps)             │  │
│  │  • agents Map                                │  │
│  │  • swarms Map                                │  │
│  │  • tasks Map                                 │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘

NO execution happens here!
```

### What Actually Executes Work

**Claude Code Task Tool = Actual Agent Execution**

```
Claude Code Task Tool
  │
  ├─ Task("researcher", "Analyze patterns", "researcher")
  │   └─→ Spawns REAL subprocess running Claude LLM
  │       └─→ Agent can optionally read MCP metadata
  │           └─→ npx claude-flow hooks pre-task (manual)
  │
  ├─ Task("coder", "Write code", "coder")
  │   └─→ Spawns REAL subprocess running Claude LLM
  │       └─→ Agent can optionally write to MCP memory
  │           └─→ npx claude-flow hooks post-edit (manual)
  │
  └─ Task("tester", "Run tests", "tester")
      └─→ Spawns REAL subprocess running Claude LLM
          └─→ Agent can optionally coordinate via hooks
              └─→ npx claude-flow hooks post-task (manual)
```

---

## Recommended Usage Patterns

### Pattern A: Simple Tasks (No MCP Needed)

```javascript
// For simple, single-agent tasks - skip MCP entirely

Task("Coder", "Write a hello world function", "coder")
Task("Tester", "Test the function", "tester")
Task("Reviewer", "Review the code", "reviewer")

// Agents work independently, no coordination needed
```

**When to Use**:
- Single-agent or simple multi-agent tasks
- No shared state needed
- Sequential work
- Quick tasks

---

### Pattern B: Complex Coordination (Full MCP Stack)

```javascript
// Step 1: Set up MCP coordination infrastructure
mcp__claude-flow__swarm_init({
  topology: "mesh",
  maxAgents: 5
})

// Step 2: Register agent types (metadata only)
mcp__claude-flow__agent_spawn({
  type: "researcher",
  capabilities: ["analysis", "data-gathering"]
})

mcp__claude-flow__agent_spawn({
  type: "coder",
  capabilities: ["implementation", "refactoring"]
})

// Step 3: Register task (metadata only)
mcp__claude-flow__task_orchestrate({
  task: "Build recommendation engine",
  strategy: "adaptive",
  priority: "high"
})

// Step 4: Spawn REAL agents via Claude Code Task tool
Task("Researcher", `
  Research ML recommendation algorithms.

  COORDINATION (required):
  1. Before work: npx claude-flow hooks pre-task --description "ML research"
  2. Store findings: npx claude-flow hooks post-edit --file "research.md"
  3. After work: npx claude-flow hooks post-task
`, "researcher")

Task("Coder", `
  Implement recommendation engine.

  COORDINATION (required):
  1. Before work: npx claude-flow hooks pre-task --description "Implementation"
  2. Read researcher findings from memory
  3. Store progress: npx claude-flow hooks post-edit --file "engine.py"
  4. After work: npx claude-flow hooks post-task
`, "coder")

// Agents manually coordinate via hooks + shared memory
```

**When to Use**:
- Complex multi-agent workflows
- Agents need to share findings
- Session persistence needed
- Cross-agent coordination required

---

## Documentation Updates Needed

### For CLAUDE.md

#### ❌ Current (Misleading)
```markdown
### MCP Tools ONLY COORDINATE:
- Swarm initialization (topology setup)
- Agent type definitions (coordination patterns)
- Task orchestration (high-level planning)
```

#### ✅ Corrected
```markdown
### MCP Tools Create Coordination Metadata (Infrastructure):
- `swarm_init`: Creates swarm metadata record (does NOT initialize infrastructure)
- `agent_spawn`: Creates agent metadata record (does NOT spawn working agent)
- `task_orchestrate`: Creates task metadata record (does NOT execute task)
- `memory_usage`: Stores/retrieves coordination data in shared memory

### Claude Code Task Tool Does Actual Work:
- `Task(type, prompt, agentType)`: Spawns REAL working agent subprocess
- Agents must manually execute hooks for coordination
- MCP metadata is optional reading material for agents
```

### New Decision Tree Section Needed

```markdown
## When to Use MCP vs Task-Only

### Use Task Tool Only (Skip MCP) When:
✅ Single-agent tasks
✅ Simple sequential work
✅ No shared state needed
✅ Quick one-off operations

### Use MCP + Task + Hooks When:
✅ Multi-agent coordination required
✅ Agents need to share findings
✅ Session persistence needed
✅ Complex workflow orchestration
✅ Memory namespacing required

### Example: Task-Only Pattern
Task("Coder", "Write hello.js", "coder")  // Simple, no MCP needed

### Example: MCP + Task Pattern
1. mcp__claude-flow__swarm_init({ topology: "mesh" })
2. mcp__claude-flow__agent_spawn({ type: "researcher" })
3. Task("Researcher", "Research + run hooks manually", "researcher")
4. Agent executes: npx claude-flow hooks pre-task
5. Agent reads MCP memory for coordination
```

---

## Persistence Model Clarification

### What Gets Persisted

**Memory Store (Persistent)**:
- Swarm metadata (`swarms/` namespace)
- Agent metadata (`agents/` namespace)
- Task metadata (`tasks/` namespace)
- Neural patterns (`patterns/` namespace)
- User data (various namespaces)

**Agent Tracker (Volatile)**:
- In-memory Maps (lost on server restart)
- Used for quick lookups within session

### The `persisted` Flag Confusion

```javascript
// In swarm_init handler:
return {
  persisted: !!this.databaseManager  // ⚠️ Misleading
}
```

**What This Actually Means**:
- `true` → Full database manager initialized (rare)
- `false` → Using fallback memory store (common)

**But Metadata IS Stored Regardless**:
- Even when `persisted: false`, metadata goes to `memoryStore`
- `memoryStore` uses SQLite or in-memory fallback
- Data persists across calls within session
- Flag should be renamed for clarity

---

## Final Recommendations

### 1. For Users

**✅ DO**:
- Use Task tool for all actual agent execution
- Use MCP for coordination metadata when needed
- Manually call hooks for cross-agent coordination
- Read memory store for shared state
- Understand that `agent_spawn` is just metadata

**❌ DON'T**:
- Expect MCP `agent_spawn` to create working agents
- Expect `task_orchestrate` to execute tasks
- Expect hooks to auto-trigger
- Expect MCP-spawned agents to auto-coordinate
- Rely on `persisted` flag for storage confirmation

### 2. For Documentation

**Add These Sections**:
1. "MCP Tools: What They Actually Do" (metadata vs execution)
2. "Decision Tree: When to Use MCP" (use cases)
3. "Hook Execution Requirements" (manual vs automatic)
4. "Three-Layer Architecture Diagram" (MCP → Task → Hooks)
5. "Common Misconceptions" (list of things MCP doesn't do)

**Fix These Claims**:
- "wrapping ALL orchestration" → "provides coordination metadata"
- "agent spawn" → "agent metadata registration"
- "task orchestrate" → "task metadata creation and tracking"
- "optional MCP setup" → clarify when it's actually useful

### 3. For Future Development

**Consider**:
- Auto-hook integration (event-driven)
- Background task executor for `task_orchestrate`
- Agent pool management in MCP
- Clearer separation of metadata vs execution layers
- Better flag naming (`persisted` → `usingDatabase`)

---

## Conclusion

**Your Analysis Was Correct**

The documentation overstates capabilities. MCP tools are **coordination infrastructure** (metadata + memory), not **automatic orchestration** (execution engines).

**The System Works If You Understand It**:
- MCP creates metadata registry
- Task tool spawns real agents
- Hooks coordinate manually
- Memory store shares state

**It's Not Broken - It's Flexible**:
- Simple tasks: Skip MCP
- Complex tasks: MCP + Task + Hooks
- User choice at every layer

**Documentation Needs Clarity**:
- Explicit: "MCP creates metadata, doesn't execute"
- Clear decision tree for when to use what
- Honest about manual hook execution requirements
- Architecture diagram showing all three layers

Your practical guide request is warranted - the system is powerful but underdocumented.
