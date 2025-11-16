# Claude Code + Claude Flow Swarm Integration Guide

## Overview

This guide explains how to execute swarms **from inside Claude Code**, using the hybrid three-layer approach that combines MCP coordination, Claude Code's Task tool for execution, and hooks for agent coordination.

**Key Insight**: Claude Flow provides the coordination infrastructure and hooks system, but **Claude Code's Task tool spawns the actual working agents** that write code, run tests, and modify files.

## Three-Layer Architecture

### Layer 1: MCP Coordination Infrastructure

MCP tools set up the swarm topology, initialize shared memory, and configure the hooks system:

```javascript
// Initialize swarm coordination
mcp__claude-flow__swarm_init({
  topology: "hierarchical",  // or "mesh", "ring", "star"
  maxAgents: 8,
  strategy: "balanced"
})

// Define agent types for coordination metadata
mcp__claude-flow__agent_spawn({ type: "coder", name: "backend-viz" })
mcp__claude-flow__agent_spawn({ type: "coder", name: "frontend-viz" })
mcp__claude-flow__agent_spawn({ type: "tester", name: "qa-specialist" })

// Initialize shared memory for coordination
mcp__claude-flow__memory_usage({
  action: "store",
  namespace: "swarm/phase-2b",
  key: "plan",
  value: JSON.stringify({
    objective: "Phase 2B implementation",
    features: ["visualization", "caching", "pii-masking", "streaming"]
  })
})
```

**What this does**:
- Creates swarm metadata for monitoring
- Sets up hooks infrastructure (enabled by `--claude` flag)
- Initializes shared memory namespaces
- Configures coordination topology

**What this does NOT do**:
- Does NOT spawn actual working agents
- Does NOT execute code or modify files
- Does NOT run tests or build projects

### Layer 2: Claude Code Task Tool (Actual Execution)

Claude Code's Task tool spawns real working agents with full tool access:

```javascript
// Spawn ACTUAL working agents that execute tasks
Task("Backend Visualization Specialist",
  `You are backend-viz agent for Phase 2B.

  🔧 COORDINATION PROTOCOL (CRITICAL):

  1. BEFORE starting work:
     npx claude-flow@alpha hooks pre-task --description "Backend visualization implementation"
     npx claude-flow@alpha hooks session-restore --session-id "swarm-phase-2b"

  2. READ context from swarm memory:
     npx claude-flow@alpha memory read --namespace "swarm/phase-2b" --key "plan"
     npx claude-flow@alpha memory read --namespace "swarm/phase-2b" --key "api-contracts"

  3. YOUR TASKS:
     - Implement VisualizationService in api/src/services/visualization_service.py
     - Support Plotly.js chart types (scatter, bar, line, heatmap, histogram)
     - Generate JSON configurations for frontend
     - Write comprehensive unit tests (90%+ coverage)

  4. AFTER each file edit:
     npx claude-flow@alpha hooks post-edit \\
       --file "api/src/services/visualization_service.py" \\
       --memory-key "swarm/phase-2b/backend-viz/progress"

  5. PUBLISH your work to memory:
     npx claude-flow@alpha memory store \\
       --namespace "swarm/phase-2b/backend-viz" \\
       --key "chart-api-contract" \\
       --value "$(cat api/docs/CHART_API_CONTRACT.md)"

  6. AFTER completing all tasks:
     npx claude-flow@alpha hooks post-task --task-id "backend-viz-week1"
     npx claude-flow@alpha hooks session-end --export-metrics true`,
  "backend-dev"
)

Task("Frontend Visualization Specialist",
  `You are frontend-viz agent for Phase 2B.

  🔧 COORDINATION PROTOCOL (CRITICAL):

  1. BEFORE starting work:
     npx claude-flow@alpha hooks pre-task --description "Frontend visualization implementation"
     npx claude-flow@alpha hooks session-restore --session-id "swarm-phase-2b"

  2. WAIT for backend API contract:
     # Poll memory until backend publishes chart API contract
     while ! npx claude-flow@alpha memory read \\
       --namespace "swarm/phase-2b/backend-viz" \\
       --key "chart-api-contract"; do
       echo "Waiting for backend API contract..."
       sleep 10
     done

  3. READ backend's published contract:
     npx claude-flow@alpha memory read \\
       --namespace "swarm/phase-2b/backend-viz" \\
       --key "chart-api-contract" > /tmp/chart-api.md

  4. YOUR TASKS:
     - Implement React chart components using Plotly.js
     - Consume backend JSON chart configurations
     - Build interactive dashboard UI
     - Write Jest tests for all components

  5. AFTER each file edit:
     npx claude-flow@alpha hooks post-edit \\
       --file "ui/src/components/ChartVisualization.jsx" \\
       --memory-key "swarm/phase-2b/frontend-viz/progress"

  6. AFTER completing all tasks:
     npx claude-flow@alpha hooks post-task --task-id "frontend-viz-week2"`,
  "coder"
)
```

**What Task tool does**:
- Spawns real agents with access to Read, Write, Edit, Bash tools
- Agents can execute code, run tests, modify files
- Agents work in parallel (multiple agents running simultaneously)
- Each agent is a full Claude Code instance with complete tool access

### Layer 3: Hooks Integration (Agent Coordination)

Hooks infrastructure is **set up** by `--claude` flag, but agents **execute** hooks manually via Bash commands:

**Pre-Task Hook** (before starting work):
```bash
npx claude-flow hooks pre-task --description "Backend visualization implementation"
npx claude-flow hooks session-restore --session-id "swarm-phase-2b"
```

**What this does**:
- Validates agent can proceed
- Restores session context from previous swarm runs
- Loads shared memory into agent's context
- Auto-assigns agent based on file type (optional)

**Post-Edit Hook** (after modifying files):
```bash
npx claude-flow hooks post-edit \
  --file "api/src/services/visualization_service.py" \
  --memory-key "swarm/phase-2b/backend-viz/progress"
```

**What this does**:
- Auto-formats code (Black, Prettier)
- Stores file changes in memory
- Trains neural patterns from edits
- Updates progress metrics

**Post-Task Hook** (after completing work):
```bash
npx claude-flow hooks post-task --task-id "backend-viz-week1"
npx claude-flow hooks session-end --export-metrics true
```

**What this does**:
- Publishes completion status to memory
- Exports performance metrics
- Generates session summary
- Triggers dependent tasks (if configured)

## Memory Coordination Pattern

Agents use shared memory to coordinate without direct communication:

### Backend Agent Publishes API Contract

```bash
# Backend agent stores API contract in memory
npx claude-flow memory store \
  --namespace "swarm/phase-2b/backend-viz" \
  --key "chart-api-contract" \
  --value "$(cat api/docs/CHART_API_CONTRACT.md)"
```

### Frontend Agent Waits and Consumes

```bash
# Frontend agent waits for contract to be published
while ! npx claude-flow memory read \
  --namespace "swarm/phase-2b/backend-viz" \
  --key "chart-api-contract" > /tmp/chart-api.md; do
  echo "Waiting for backend API contract..."
  sleep 10
done

# Now frontend can implement against the contract
cat /tmp/chart-api.md  # Read the contract
# Implement React components based on API contract
```

### QA Agent Monitors Both

```bash
# QA agent reads both agents' progress
npx claude-flow memory read \
  --namespace "swarm/phase-2b/backend-viz" \
  --key "progress"

npx claude-flow memory read \
  --namespace "swarm/phase-2b/frontend-viz" \
  --key "progress"

# Decide what to test based on completion status
```

## Complete Execution Flow Example

Here's how to execute a Phase 2B swarm from inside Claude Code:

### Step 1: Initialize MCP Coordination (Optional but Recommended)

```javascript
[Single Message - MCP Coordination Setup]:
  mcp__claude-flow__swarm_init({
    topology: "hierarchical",
    maxAgents: 8
  })

  mcp__claude-flow__agent_spawn({ type: "coder", name: "backend-viz" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "frontend-viz" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "qa-specialist" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "backend-cache" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "backend-pii" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "backend-stream" })
  mcp__claude-flow__agent_spawn({ type: "reviewer", name: "code-reviewer" })

  mcp__claude-flow__memory_usage({
    action: "store",
    namespace: "swarm/phase-2b",
    key: "plan",
    value: JSON.stringify({
      objective: "Phase 2B: Advanced Features",
      features: ["visualization", "caching", "pii-masking", "streaming"],
      timeline: "6 weeks",
      quality_bar: "90% test coverage, 0 mypy errors, 0 lint violations"
    })
  })
```

### Step 2: Spawn Actual Working Agents via Task Tool

```javascript
[Single Message - Parallel Agent Execution]:

  // All todos batched together
  TodoWrite { todos: [
    {content: "Backend visualization service", status: "in_progress", activeForm: "Implementing backend visualization service"},
    {content: "Frontend chart components", status: "pending", activeForm: "Implementing frontend chart components"},
    {content: "Backend caching layer", status: "pending", activeForm: "Implementing backend caching layer"},
    {content: "PII masking service", status: "pending", activeForm: "Implementing PII masking service"},
    {content: "Streaming responses", status: "pending", activeForm: "Implementing streaming responses"},
    {content: "Integration testing", status: "pending", activeForm: "Writing integration tests"},
    {content: "Code review and refinement", status: "pending", activeForm: "Performing code review and refinement"},
    {content: "Documentation updates", status: "pending", activeForm: "Updating documentation"}
  ]}

  // Spawn all agents in parallel (single message, multiple Task calls)
  Task("Backend Visualization Specialist",
    `[Complete instructions with hooks as shown above]`,
    "backend-dev"
  )

  Task("Frontend Visualization Specialist",
    `[Complete instructions with hooks as shown above]`,
    "coder"
  )

  Task("Backend Caching Specialist",
    `You are backend-cache agent.

    🔧 COORDINATION PROTOCOL:
    1. BEFORE: npx claude-flow hooks pre-task --description "Caching implementation"
    2. READ plan: npx claude-flow memory read --namespace "swarm/phase-2b" --key "plan"
    3. TASKS:
       - Implement Redis caching layer
       - Cache CSV metadata and analysis results
       - Add cache invalidation logic
       - Write comprehensive tests
    4. AFTER edits: npx claude-flow hooks post-edit --file [file]
    5. PUBLISH: Store cache API contract in memory
    6. COMPLETE: npx claude-flow hooks post-task --task-id "cache-week3"`,
    "backend-dev"
  )

  Task("PII Masking Specialist",
    `You are backend-pii agent.

    🔧 COORDINATION PROTOCOL:
    1. BEFORE: npx claude-flow hooks pre-task --description "PII masking implementation"
    2. TASKS:
       - Implement PII detection (regex + NER)
       - Auto-mask email, phone, SSN, credit cards
       - Add configurable privacy levels
       - Write security tests
    4. AFTER edits: npx claude-flow hooks post-edit --file [file]
    5. COMPLETE: npx claude-flow hooks post-task --task-id "pii-week4"`,
    "backend-dev"
  )

  Task("Streaming Specialist",
    `You are backend-stream agent.

    🔧 COORDINATION PROTOCOL:
    1. BEFORE: npx claude-flow hooks pre-task --description "Streaming implementation"
    2. WAIT for chart API: Poll memory for backend-viz chart-api-contract
    3. TASKS:
       - Implement Server-Sent Events (SSE) endpoint
       - Stream chart data progressively
       - Add frontend EventSource integration
       - Write streaming tests
    4. AFTER edits: npx claude-flow hooks post-edit --file [file]
    5. COMPLETE: npx claude-flow hooks post-task --task-id "stream-week5"`,
    "backend-dev"
  )

  Task("QA Integration Specialist",
    `You are qa-integration agent.

    🔧 COORDINATION PROTOCOL:
    1. BEFORE: npx claude-flow hooks pre-task --description "Integration testing"
    2. MONITOR progress: Read all agents' memory namespaces
    3. WAIT for completion: Poll memory until all agents publish "done"
    4. TASKS:
       - Write end-to-end integration tests
       - Test visualization + caching + PII + streaming together
       - Verify 90%+ coverage maintained
       - Run full test suite
    5. AFTER edits: npx claude-flow hooks post-edit --file [file]
    6. COMPLETE: npx claude-flow hooks post-task --task-id "qa-week6"`,
    "tester"
  )

  Task("Code Review Specialist",
    `You are code-review agent.

    🔧 COORDINATION PROTOCOL:
    1. BEFORE: npx claude-flow hooks pre-task --description "Code review"
    2. WAIT for QA: Poll memory for qa-integration completion
    3. TASKS:
       - Review all Phase 2B code for quality
       - Check type safety (mypy), linting (ruff), formatting (black)
       - Verify no hardcoded values
       - Ensure London School TDD patterns followed
       - Document any tech debt
    4. AFTER edits: npx claude-flow hooks post-edit --file [file]
    5. COMPLETE: npx claude-flow hooks post-task --task-id "review-week6"`,
    "reviewer"
  )
```

### Step 3: Monitor Swarm Progress (While Agents Work)

```javascript
// Check swarm status
mcp__claude-flow__swarm_status({ verbose: true })

// Check agent metrics
mcp__claude-flow__agent_metrics({ metric: "all" })

// Check task progress
mcp__claude-flow__task_status({ detailed: true })

// Read memory to see what agents have published
mcp__claude-flow__memory_usage({
  action: "search",
  namespace: "swarm/phase-2b",
  pattern: "*"
})
```

### Step 4: Collect Results

```javascript
// Get task results
mcp__claude-flow__task_results({ taskId: "backend-viz-week1", format: "detailed" })
mcp__claude-flow__task_results({ taskId: "frontend-viz-week2", format: "detailed" })
mcp__claude-flow__task_results({ taskId: "qa-week6", format: "detailed" })

// Generate performance report
mcp__claude-flow__performance_report({ format: "detailed", timeframe: "24h" })
```

## Key Patterns and Best Practices

### 1. Batch Everything in Single Messages

**❌ WRONG** (Multiple messages):
```javascript
Message 1: Task("agent1", "...", "coder")
Message 2: Task("agent2", "...", "tester")
Message 3: TodoWrite { todos: [...] }
```

**✅ CORRECT** (Single message):
```javascript
[Single Message]:
  TodoWrite { todos: [8-10 todos] }
  Task("agent1", "...", "coder")
  Task("agent2", "...", "tester")
  Task("agent3", "...", "reviewer")
```

### 2. Always Include Hook Commands in Agent Instructions

Every agent instruction must include:
- `pre-task` hook at start
- `session-restore` to load context
- `post-edit` after file modifications
- `memory store` to publish work
- `post-task` at completion

### 3. Use Memory for Coordination, Not Direct Communication

Agents don't communicate directly. Instead:
- Backend publishes API contracts to memory
- Frontend waits for contracts via polling
- QA monitors all namespaces for progress
- Reviewer waits for QA completion

### 4. Dependency Waiting Pattern

```bash
# Agent waits for dependency
while ! npx claude-flow memory read \
  --namespace "swarm/upstream-agent" \
  --key "completion-signal"; do
  echo "Waiting for upstream-agent to finish..."
  sleep 10
done

# Dependency satisfied, proceed with work
```

### 5. Progress Publishing Pattern

```bash
# After completing milestone, publish progress
npx claude-flow memory store \
  --namespace "swarm/my-agent" \
  --key "milestone-1-done" \
  --value "Completed VisualizationService with 30 tests passing"

# Other agents can read this to know you're done
```

## Why This Hybrid Approach Works

### MCP Alone (Without Task Tool)
- ❌ Creates coordination metadata but no actual work
- ❌ Agents have no tools (can't Read, Write, Edit files)
- ❌ No parallel execution
- ❌ No real code generation

### Task Tool Alone (Without MCP/Hooks)
- ❌ Agents work in isolation
- ❌ No shared memory for coordination
- ❌ No dependency management
- ❌ No progress tracking
- ❌ Duplicate work or conflicts

### Hybrid Approach (MCP + Task + Hooks)
- ✅ MCP provides coordination infrastructure
- ✅ Task tool spawns real working agents
- ✅ Hooks enable memory sharing and progress tracking
- ✅ Agents coordinate via memory without conflicts
- ✅ Full parallel execution (2.8-4.4x faster)
- ✅ Complete tool access (Read, Write, Edit, Bash)
- ✅ Neural pattern training from successful workflows

## Performance Benefits

Based on Claude Flow benchmarks:

- **84.8% SWE-Bench solve rate** (vs 49% baseline)
- **32.3% token reduction** (memory reuse, no repeated context)
- **2.8-4.4x speed improvement** (parallel execution)
- **90%+ test coverage** (TDD-first approach)
- **Self-healing workflows** (hooks detect and fix issues)

## Example: Phase 2B Full Execution

See `/docs/PHASE_2B_SWARM_PROMPT.md` for complete Phase 2B swarm prompt with:
- 8 agents (1 Queen + 7 specialists)
- 6-week timeline
- Complete agent instructions with embedded hooks
- Memory coordination patterns
- Dependency waiting examples

## Summary

**Three-Layer Architecture**:
1. **MCP Layer**: Coordination infrastructure (topology, memory, hooks setup)
2. **Task Layer**: Actual execution (Claude Code agents with full tools)
3. **Hooks Layer**: Agent coordination (memory sharing, progress tracking)

**Key Insight**: MCP coordinates the strategy, Task tool executes with real agents, hooks enable coordination via memory.

**The Golden Rule**: Claude Flow provides coordination infrastructure, Claude Code's Task tool does the actual work.
