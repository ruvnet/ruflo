# Claude-Flow Complete Workflow Explained

**A concise, accurate description of how claude-flow swarms work from start to finish.**

---

MV DRAFT
```
> so I've attempted to write out the highlevel workflow as I would like it to be described. please review and provide an accurate, but equally 
concise version as an md file.   1) user asks claude to write a prompt describing in detail, outcomes, requirements, inputs etc as well as the swarm 
configuration 2) claude creates file 3) user instructs claude to create the swarm as per the prompt file 4) claude a) calls the claude-flow mcp 
commands to cnfigure the claude-flow memory with details about the swarm b) spawns the swarm, agent-by-agent with each agent having specific 
instructions and configuration, (including hook configuration?) 5) the agents run independantly of the 'current' (the users cli instance) of claude 
but provied updates to the claude cli through (how?) - the agents call pre and post hooks to update the memory and (what else?) 6) the calude cli 
instance waits for all agents to finish and then presents a summary to the user 
```

## 🎯 The Complete Workflow

### **Step 1: User Creates Detailed Prompt**

**User asks Claude to create a comprehensive prompt file:**

```
User: "Create a detailed prompt for building a REST API with authentication.
       Include outcomes, requirements, inputs, and swarm configuration."
```

**Claude creates a file** (e.g., `docs/tasks/build-api.md`) containing:
- Detailed task description
- Expected outcomes and deliverables
- Technical requirements and constraints
- Input data/resources needed
- Swarm configuration (topology, agent count, strategy)

---

### **Step 2: User Instructs Claude to Execute**

```
User: "Execute the swarm as per that prompt file"
```

---

### **Step 3: Claude Configures Swarm Metadata**

**Claude calls MCP tools to set up coordination infrastructure:**

```javascript
// Store swarm configuration in .swarm/memory.db
mcp__claude-flow__swarm_init({
  topology: "mesh",
  maxAgents: 4,
  strategy: "development"
})

// Register agent metadata (NOT spawning yet - just database entries)
mcp__claude-flow__agent_spawn({ type: "researcher", name: "Requirements Analyst" })
mcp__claude-flow__agent_spawn({ type: "coder", name: "Backend Developer" })
mcp__claude-flow__agent_spawn({ type: "tester", name: "QA Engineer" })
mcp__claude-flow__agent_spawn({ type: "reviewer", name: "Code Reviewer" })
```

**What happens:**
- ✅ Swarm metadata stored in `.swarm/memory.db` (SQLite database)
- ✅ Agent metadata registered (ID, type, capabilities)
- ❌ NO agents actually spawned yet (just database entries)

---

### **Step 4: Claude Spawns Real Agents**

**Claude uses Task tool to spawn actual working agents:**

```javascript
// Each Task() call spawns a REAL Claude Code subprocess
Task("Requirements Analyst", `
Analyze API requirements from prompt file.

COORDINATION PROTOCOL:
1. Before starting:
   npx claude-flow hooks pre-task --description "Analyze requirements"

2. After creating each file:
   npx claude-flow hooks post-edit --file "path/to/file"

3. When complete:
   npx claude-flow hooks post-task --task-id "requirements-analysis"

Read the prompt file and extract all requirements.
Store findings in memory for other agents.
`, "researcher")

Task("Backend Developer", `
Build REST API based on requirements in memory.

COORDINATION PROTOCOL:
[Same hook instructions...]

Check memory for requirements before starting.
Coordinate with other agents via shared memory.
`, "coder")

Task("QA Engineer", "Write tests. Use hooks for coordination.", "tester")
Task("Code Reviewer", "Review code. Use hooks for coordination.", "reviewer")
```

**What happens:**
- ✅ Each `Task()` spawns a **separate Claude Code process** (real OS process)
- ✅ Each agent has **full instructions** including hook commands
- ✅ Agents run **independently** from the parent Claude CLI instance
- ✅ Each agent can use all tools (Read, Write, Edit, Bash, etc.)

**Hook Configuration:**
- Hooks are NOT automatically configured for agents
- Each agent must **manually call hooks via Bash commands**
- Hook commands are **included in the agent's instructions**
- This is why you see `npx claude-flow hooks ...` in the prompts

---

### **Step 5: Agents Execute Independently**

**Each agent runs in its own process and:**

#### **A) Manual Hook Calls for Coordination**

```javascript
// Agent starts:
Bash("npx claude-flow hooks pre-task --description 'Build REST API'")
  → Writes task metadata to .swarm/memory.db
  → Other agents can now see this task is in progress

// Agent works:
Write("server.js", "const express = require('express')...")

// Agent records the change:
Bash("npx claude-flow hooks post-edit --file 'server.js'")
  → Stores file change in .swarm/memory.db
  → Updates metrics and patterns
  → Other agents can see this file was created

// Agent finishes:
Bash("npx claude-flow hooks post-task --task-id 'rest-api'")
  → Marks task complete in database
  → Trains neural patterns from the experience
```

#### **B) Communication Back to Parent**

**How the parent Claude CLI sees agent progress:**

The parent Claude instance sees agent activity through:

1. **Claude Code's Built-in UI Updates:**
   - Shows flashing dots (●) for active agents
   - Displays tool calls in real-time
   - Updates when agents complete

2. **Task Tool Return Values:**
   - When agent finishes, Task tool returns:
   ```json
   {
     "result": "Agent's final summary",
     "usage": { "input_tokens": 1234, "output_tokens": 567 },
     "total_cost_usd": 0.05,
     "duration_ms": 45000
   }
   ```

3. **Shared Memory Database:**
   - Parent can query `.swarm/memory.db` for status
   - MCP tools like `mcp__claude-flow__task_status()` read from same DB
   - Parent sees updates as agents write to shared memory

**What agents update in memory:**
- Task status (pending → in_progress → completed)
- File changes and edits
- Error messages and issues encountered
- Results and findings
- Performance metrics
- Neural training patterns

---

### **Step 6: Parent Waits and Summarizes**

**The parent Claude instance:**

```javascript
// Waits for all Task() calls to complete
// (Task tool is blocking - waits for agent to finish)

// When all agents done, parent:
// 1. Receives results from each Task() call
const analyst_result = await Task("Analyst", ...)
const developer_result = await Task("Developer", ...)
const tester_result = await Task("Tester", ...)
const reviewer_result = await Task("Reviewer", ...)

// 2. Queries shared memory for additional info
mcp__claude-flow__task_status({ taskId: "all" })
mcp__claude-flow__performance_report({ format: "summary" })

// 3. Presents comprehensive summary to user:
```

**Summary includes:**
- Individual agent results
- Files created/modified
- Tests run and results
- Issues encountered and resolved
- Performance metrics (tokens used, time taken, costs)
- Overall success/failure status

---

## 🔑 Key Technical Details

### **The Two Hook Systems**

1. **Parent Claude (Automatic Hooks):**
   - Has `.claude/settings.json` configured by `npx claude-flow init`
   - PreToolUse/PostToolUse hooks trigger automatically
   - Calls `npx claude-flow hooks ...` automatically on Write/Edit/Bash

2. **Agent Processes (Manual Hooks):**
   - Each agent is a NEW Claude Code process
   - They don't inherit parent's `.claude/settings.json`
   - Must manually call hooks via Bash commands
   - Instructions explicitly tell them to call hooks

### **The Shared Database**

All coordination happens via `.swarm/memory.db` (SQLite):
- MCP tools write to it (`mcp__claude-flow__agent_spawn`)
- Hook commands write to it (`npx claude-flow hooks pre-task`)
- Agents read from it (to see other agents' progress)
- Parent reads from it (to monitor overall status)

### **No Central Coordinator Process**

- There is NO claude-flow daemon/process running in background
- Coordination is **fully decentralized** via shared database
- Each hook call is a one-off command that runs and exits
- Agents discover each other through database queries

---

## 📊 Visual Flow Diagram

```
┌─────────────────────────────────────────────────┐
│ Step 1: User creates prompt file               │
│ (via parent Claude CLI)                        │
└──────────────┬──────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────┐
│ Step 3: Parent Claude calls MCP tools           │
│ mcp__claude-flow__swarm_init(...)              │
│ mcp__claude-flow__agent_spawn(...) x4          │
│ → Writes metadata to .swarm/memory.db          │
└──────────────┬──────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────┐
│ Step 4: Parent spawns agents via Task tool     │
│ Task("Agent 1", "instructions + hooks", "type")│
│ Task("Agent 2", "instructions + hooks", "type")│
│ → 4 separate Claude Code processes start       │
└──────────────┬──────────────────────────────────┘
               ▼
     ┌─────────┴─────────────┬──────────┬─────────┐
     ▼                       ▼          ▼         ▼
┌──────────┐  ┌──────────┐  ┌────────┐  ┌────────┐
│ Agent 1  │  │ Agent 2  │  │ Agent 3│  │ Agent 4│
│ (Process)│  │ (Process)│  │(Process)│  │(Process)│
└────┬─────┘  └────┬─────┘  └───┬────┘  └───┬────┘
     │             │             │            │
     │ Step 5: Each agent independently:     │
     │ - Calls hooks via Bash                │
     │ - Writes to .swarm/memory.db          │
     │ - Reads other agents' updates         │
     │ - Does actual work (Write files, etc) │
     │                                        │
     └─────────────┬─────────────┴────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│     .swarm/memory.db (Shared SQLite)            │
│                                                 │
│ - Task statuses                                 │
│ - File changes                                  │
│ - Agent coordination data                       │
│ - Metrics and patterns                          │
└──────────────┬──────────────────────────────────┘
               │
               │ (All agents write here)
               │ (Parent reads from here)
               │
               ▼
┌─────────────────────────────────────────────────┐
│ Step 6: Parent waits for all agents to finish  │
│ - Receives Task() return values                │
│ - Queries .swarm/memory.db for final status    │
│ - Presents summary to user                     │
└─────────────────────────────────────────────────┘
```

---

## 🎓 Common Misconceptions Clarified

| Misconception | Reality |
|--------------|---------|
| MCP tools spawn agents | MCP tools only create database entries |
| Hooks run automatically for agents | Agents must manually call hooks via Bash |
| Claude-flow runs as a coordinator | No central process - coordination via shared DB |
| Agents communicate via messages | Agents coordinate via shared SQLite database |
| Parent monitors agents in real-time | Parent sees updates through Task tool UI + DB queries |

---

## ✅ Summary: The Six Steps

1. **User** creates detailed prompt file (via Claude)
2. **User** instructs Claude to execute the swarm
3. **Claude** calls MCP tools to set up metadata in `.swarm/memory.db`
4. **Claude** spawns real agents via Task tool with hook instructions
5. **Agents** run independently, manually calling hooks to update shared DB
6. **Claude** waits for completion, queries DB, presents summary

**The secret sauce:** Shared SQLite database (`.swarm/memory.db`) + Manual hook calls = Decentralized coordination! 🎯
