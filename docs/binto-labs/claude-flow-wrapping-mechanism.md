# How Claude-Flow Actually "Wraps" Claude Code

**TL;DR**: Claude-flow doesn't "wrap" Claude Code - it **spawns it as a subprocess with a pre-written prompt**.

---

## 🎯 The Core Mechanism

When you run:
```bash
npx claude-flow swarm "Build REST API" --claude
```

Here's **exactly** what happens:

### Step 1: Build a Massive Prompt String

**File**: `src/cli/simple-commands/swarm.js` (lines 381-799)

Claude-flow constructs a **giant prompt string** containing:
- Your objective
- Configuration (strategy, mode, max agents)
- MCP tool descriptions
- Workflow instructions
- SPARC methodology (if enabled)
- Coordination patterns
- Example tool usage

**Example prompt structure**:
```javascript
const swarmPrompt = `You are orchestrating a Claude Flow Swarm using Claude Code's Task tool for agent execution.

🚨 CRITICAL INSTRUCTION: Use Claude Code's Task Tool for ALL Agent Spawning!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Claude Code's Task tool = Spawns agents that DO the actual work
❌ MCP tools = Only for coordination setup, NOT for execution
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 OBJECTIVE: Build REST API

🐝 SWARM CONFIGURATION:
- Strategy: development
- Mode: mesh
- Max Agents: 8
- Parallel Execution: MANDATORY

[... 500+ more lines of instructions ...]
`;
```

### Step 2: Spawn Claude Code CLI with the Prompt

**File**: `src/cli/simple-commands/swarm.js` (lines 843-847)

```javascript
const claudeProcess = spawn('claude', claudeArgs, {
  stdio: 'inherit',
  shell: false,
  env: claudeEnv
});
```

**What this does:**
- Runs `claude` command (Claude Code CLI binary)
- Passes the giant prompt as first argument
- Adds `--dangerously-skip-permissions` flag (by default)
- Inherits stdio (so you see Claude's output in your terminal)

**Equivalent command**:
```bash
claude --dangerously-skip-permissions "You are orchestrating a Claude Flow Swarm using Claude Code's Task tool for agent execution.

🚨 CRITICAL INSTRUCTION: Use Claude Code's Task Tool for ALL Agent Spawning!
[... entire 800-line prompt ...]"
```

### Step 3: Claude Code Starts, I (Claude) Receive the Prompt

When Claude Code CLI receives this prompt:
1. I load CLAUDE.md (from current directory)
2. I receive the giant swarm prompt as the **user's first message**
3. I have access to MCP tools (claude-flow MCP server)
4. I start executing based on the prompt instructions

---

## 🔍 The Key Insight: It's Just a Subprocess Call

**There is NO special integration or wrapping mechanism.**

```
User Terminal
     ↓
npx claude-flow swarm "objective" --claude
     ↓
claude-flow/src/cli/simple-commands/swarm.js
     ↓
Constructs giant prompt string (800+ lines)
     ↓
spawn('claude', [prompt])  ← Just a Node.js child_process!
     ↓
Claude Code CLI starts
     ↓
Claude (me) receives prompt as first message
     ↓
Claude executes using Task tool + MCP tools
```

---

## 📝 What the Prompt Contains

### 1. Objective and Configuration
```
🎯 OBJECTIVE: ${objective}

🐝 SWARM CONFIGURATION:
- Strategy: ${strategy}
- Mode: ${mode}
- Max Agents: ${maxAgents}
```

### 2. Critical Instructions
```
🚨 CRITICAL INSTRUCTION: Use Claude Code's Task Tool for ALL Agent Spawning!
✅ Claude Code's Task tool = Spawns agents that DO the actual work
❌ MCP tools = Only for coordination setup, NOT for execution
```

### 3. MCP Tool Reference
```
🔧 AVAILABLE MCP TOOLS FOR SWARM COORDINATION:

📊 MONITORING & STATUS:
- mcp__claude-flow__swarm_status - Check current swarm status
- mcp__claude-flow__swarm_monitor - Real-time monitoring

🧠 MEMORY & KNOWLEDGE:
- mcp__claude-flow__memory_store - Store knowledge
- mcp__claude-flow__memory_retrieve - Retrieve shared knowledge
```

### 4. Execution Workflow (SPARC)
```
S - Specification Phase (Single BatchTool):
[BatchTool]:
  mcp__claude-flow__memory_store { key: "specs/requirements", value: {...} }
  mcp__claude-flow__task_create { name: "Requirement 1" }

P - Pseudocode Phase (Single BatchTool):
[...]
```

### 5. Strategy-Specific Guidance
```javascript
const strategyGuidance = getStrategyGuidance(strategy, objective);
// Returns different instructions based on strategy type
```

---

## 🤔 So What Does "Wrapping" Mean?

### What People Think "Wrapping" Means:
- ❌ Claude-flow intercepts Claude Code API calls
- ❌ Claude-flow modifies Claude Code behavior
- ❌ Claude-flow adds new capabilities to Claude Code
- ❌ Claude-flow runs "inside" Claude Code

### What "Wrapping" Actually Means:
- ✅ Claude-flow generates a comprehensive prompt
- ✅ Claude-flow spawns Claude Code as subprocess
- ✅ Claude-flow passes the prompt to Claude Code
- ✅ Claude-flow sets up environment (MCP tools available)

**It's "wrapping" in the sense of:**
> "I'm wrapping your simple request in detailed instructions before handing it to Claude Code"

---

## 🛠️ The Two Execution Paths

### Path 1: `--claude` Flag (Spawns Claude Code)

```bash
npx claude-flow swarm "objective" --claude
```

**What happens:**
1. Build giant prompt with instructions
2. `spawn('claude', [prompt])`
3. Claude Code runs interactively
4. You see Claude's output in terminal
5. Claude uses Task tool to spawn agents
6. Agents do the actual work

**Code location**: Lines 800-893

### Path 2: `--executor` Flag (Built-in Executor)

```bash
npx claude-flow swarm "objective" --executor
```

**What happens:**
1. Skip Claude Code entirely
2. Use built-in autonomous-executor.js
3. Spawns Node.js child processes directly
4. Each agent is a separate process
5. Uses `child_process.spawn()` for agents

**Code location**: Lines 360-361 (continues with old executor)

### Path 3: No Flags (Default - Also Spawns Claude Code)

```bash
npx claude-flow swarm "objective"
```

**What happens:**
1. Same as `--claude` but checks if `claude` command exists
2. If found: spawns Claude Code with prompt
3. If not found: Shows error message suggesting flags

**Code location**: Lines 896-949

---

## 🔑 Key Code Locations

### Prompt Building
**File**: `src/cli/simple-commands/swarm.js`
- **Lines 381-799**: Constructs the giant swarm prompt
- **Lines 368-375**: Gets configuration and guidance

### Claude Code Spawning
**File**: `src/cli/simple-commands/swarm.js`
- **Lines 820-831**: Builds `claudeArgs` array
- **Lines 843-847**: `spawn('claude', claudeArgs)`
- **Lines 873-891**: Handle exit and errors

### Environment Setup
**File**: `src/cli/simple-commands/swarm.js`
- **Lines 836-841**: Configure environment variables
- **Line 844**: `stdio: 'inherit'` (so you see output)

---

## 💡 The Memory Protocol Injection

**Lines 796-807**: Special feature

```javascript
try {
  const { injectMemoryProtocol, enhanceSwarmPrompt } =
    await import('../../utils/memory-protocol-injector.js');

  await injectMemoryProtocol();
  swarmPrompt = enhanceSwarmPrompt(swarmPrompt, maxAgents);
} catch (err) {
  console.log('⚠️  Memory protocol injection not available');
}
```

**What this does:**
- Modifies `CLAUDE.md` temporarily
- Adds memory coordination instructions
- Enhances the prompt with agent-specific guidance
- Falls back gracefully if not available

---

## 🎭 The Actual "Wrapper" Analogy

Think of claude-flow as a **personal assistant** who:

1. **Listens** to your request ("Build REST API")
2. **Writes detailed instructions** (800-line prompt)
3. **Calls Claude** and hands over the instructions
4. **Steps back** and lets Claude do the work

**It's NOT:**
- A proxy that intercepts calls
- A plugin that extends Claude Code
- A middleware that modifies behavior

**It IS:**
- A prompt generator
- A subprocess spawner
- An environment configurator

---

## 🚀 The Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│ Terminal: npx claude-flow swarm "Build API" --claude   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ swarm.js: Build giant prompt (800 lines)               │
│  - Add objective: "Build API"                           │
│  - Add config: strategy=development, mode=mesh          │
│  - Add MCP tool reference                               │
│  - Add SPARC workflow                                   │
│  - Add coordination patterns                            │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ swarm.js: spawn('claude', [prompt])                    │
│  - Spawn Claude Code CLI as subprocess                  │
│  - Pass prompt as first argument                        │
│  - Inherit stdio (see output)                           │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ Claude Code CLI starts                                  │
│  - Loads CLAUDE.md from current directory               │
│  - Connects to MCP servers (claude-flow)                │
│  - Receives giant prompt as user message                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ Claude (me) executes the prompt                         │
│  - Read instructions (use Task tool for agents)         │
│  - Use MCP tools for coordination                       │
│  - Spawn agents via Task tool                           │
│  - Coordinate via memory/hooks                          │
└─────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ Agents do the actual work                               │
│  - Each agent is a Claude Code Task tool instance       │
│  - Agents MANUALLY call hooks via Bash for coordination│
│  - Shared memory via .swarm/memory.db (SQLite)          │
│  - Results returned to coordinator (me)                 │
└─────────────────────────────────────────────────────────┘
```

**Important Hook Detail:**

The coordinator (spawned by `--claude`) has automatic hooks configured in `.claude/settings.json` (if using `npx claude-flow init`), but each Task tool agent does NOT inherit these hooks. That's why the prompt explicitly instructs agents to manually call hooks via Bash commands.

---

## 🪝 The Two Hook Systems

### **1. Automatic Hooks (Single Claude Instance)**

When you run `npx claude-flow init`, it creates `.claude/settings.json` with:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "command": "npx claude-flow hooks pre-edit --file '{}'"
      }]
    }],
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "command": "npx claude-flow hooks post-edit --file '{}' --format true"
      }]
    }]
  }
}
```

**How it works:**
- Claude Code's built-in hook system intercepts tool calls
- Automatically runs `npx claude-flow hooks ...` commands
- No manual intervention needed for single instance
- Updates `.swarm/memory.db` automatically

### **2. Manual Hooks (Swarm Agents)**

When agents are spawned via Task tool:
- Each agent is a NEW Claude Code process
- They DON'T inherit parent's `.claude/settings.json`
- Prompt explicitly instructs them to call hooks manually

**Example from 800-line prompt:**
```
Every agent MUST coordinate via hooks:

Before work:
  npx claude-flow hooks pre-task --description "your task"

After edits:
  npx claude-flow hooks post-edit --file "path/to/file"

When done:
  npx claude-flow hooks post-task --task-id "task-123"
```

**Why manual?**
- Enables cross-agent coordination via shared `.swarm/memory.db`
- Allows agents to see each other's progress
- Updates metrics for the entire swarm

---

## 🎓 Key Takeaways

1. **No Magic**: Claude-flow is just a subprocess spawner with a fancy prompt generator
2. **Prompt is Everything**: The 800-line prompt IS the "wrapping"
3. **Two Hook Systems**: Automatic (via settings.json) + Manual (via prompt instructions)
4. **MCP for Coordination**: MCP tools provide the coordination infrastructure
5. **Task Tool for Execution**: Claude Code's Task tool spawns the actual working agents
6. **Environment Setup**: Claude-flow just makes sure CLAUDE.md, hooks, and MCP are ready

---

## 🔧 What You Can Control

### Via Flags:
- `--strategy` - Changes the guidance in the prompt
- `--mode` - Changes the coordination topology instructions
- `--max-agents` - Limits agent count in instructions
- `--sparc` / `--no-sparc` - Includes/excludes SPARC methodology
- `--analysis` - Adds read-only mode constraints to prompt

### Via Files:
- `CLAUDE.md` - I read this at startup (my base instructions)
- `.claude/CLAUDE-FLOW-GUIDE.md` - I can Read this for reference
- `package.json` - MCP server configuration

### What You CAN'T Control:
- ❌ The core prompt structure (hardcoded in swarm.js)
- ❌ The MCP tool names (defined in MCP server)
- ❌ How Claude Code spawns Task tool agents (internal to Claude Code)

---

## 🤝 The Relationship Summary

**Claude-Flow and Claude Code are NOT:**
- Parent/child (architecturally)
- Plugin/host
- Wrapper/core
- Framework/library

**They ARE:**
- Separate programs
- Connected via subprocess spawn
- Coordinated via prompts
- Integrated via MCP protocol

**Best analogy:**
> Claude-flow is like a sophisticated **command generator** that writes complex prompts and passes them to Claude Code via the command line.

---

**The "wrapping" is literally just:**
```javascript
spawn('claude', [`<giant-800-line-prompt-here>`])
```

That's it! 🎉
