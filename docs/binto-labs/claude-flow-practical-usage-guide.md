# Claude-Flow Practical Usage Guide
**For Effective Multi-Agent Orchestration**

**Version**: 1.0
**Date**: 2025-11-13
**Based On**: Code analysis of v2.7.34

---

## Quick Start: The Truth About Claude-Flow

### What You Need to Know Immediately

1. **MCP tools DON'T spawn working agents** - they create metadata
2. **Claude Code's Task tool DOES spawn working agents** - it's the real executor
3. **Hooks must be manually called** - via `npx claude-flow hooks <command>`
4. **MCP is optional infrastructure** - use it for complex coordination, skip it for simple tasks

### The Three-Layer Reality

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: MCP Tools (Coordination Metadata)             │
│   • Creates swarm/agent/task records                   │
│   • Manages shared memory store                        │
│   • Provides metadata for coordination                 │
│   • DOES NOT execute anything                          │
└─────────────────────────────────────────────────────────┘
                        ↓ (optional reading)
┌─────────────────────────────────────────────────────────┐
│ Layer 2: Claude Code Task Tool (Actual Execution)      │
│   • Task("name", "instructions", "type")               │
│   • Spawns REAL working agent subprocesses             │
│   • Connects to Claude LLM                             │
│   • Does the actual work                               │
└─────────────────────────────────────────────────────────┘
                        ↓ (manual coordination)
┌─────────────────────────────────────────────────────────┐
│ Layer 3: Hook System (Manual Coordination)             │
│   • npx claude-flow hooks pre-task                     │
│   • npx claude-flow hooks post-edit                    │
│   • npx claude-flow hooks post-task                    │
│   • Must be explicitly called by agents                │
└─────────────────────────────────────────────────────────┘
```

---

## Decision Tree: Which Pattern Should I Use?

### Start Here

```
Do you need multiple agents to share findings or coordinate?
│
├─ NO → Use Pattern A (Task-Only)
│        Simple, fast, no overhead
│
└─ YES → Do you need session persistence or memory namespacing?
          │
          ├─ NO → Use Pattern A with Shared Files
          │        Agents coordinate via filesystem
          │
          └─ YES → Use Pattern B (MCP + Task + Hooks)
                   Full coordination infrastructure
```

---

## Pattern A: Simple Task Execution (No MCP)

**Use When**:
- Single-agent tasks
- Multiple independent agents
- No shared state needed
- Quick operations
- Sequential work

### Example 1: Simple Sequential Work

```javascript
// No MCP setup needed - just spawn agents directly

Task("Researcher", `
  Research best practices for REST API design.
  Create a document in docs/api-research.md
`, "researcher")

Task("Coder", `
  Read docs/api-research.md
  Implement REST API based on those findings
  Create src/api/server.js
`, "coder")

Task("Tester", `
  Read src/api/server.js
  Write comprehensive tests
  Create tests/api.test.js
`, "tester")
```

**How It Works**:
- Each agent is independent
- Agents share via filesystem (recommended pattern)
- No MCP overhead
- No manual hook execution needed

### Example 2: Parallel Independent Work

```javascript
// Spawn multiple agents in parallel - no coordination needed

Task("Backend Developer", "Build Express REST API in src/backend/", "backend-dev")
Task("Frontend Developer", "Build React UI in src/frontend/", "coder")
Task("Database Architect", "Design PostgreSQL schema in docs/schema.sql", "code-analyzer")
Task("DevOps Engineer", "Setup Docker configuration", "cicd-engineer")

// All agents work independently in parallel
// Coordinate via file outputs
```

---

## Pattern B: Complex Coordination (MCP + Task + Hooks)

**Use When**:
- Multi-agent workflows with dependencies
- Agents need to share findings dynamically
- Session persistence required
- Memory namespacing needed
- Complex orchestration

### Example: Full-Stack Application with Coordination

```javascript
// Step 1: Initialize MCP coordination infrastructure (metadata only)
mcp__claude-flow__swarm_init({
  topology: "mesh",
  maxAgents: 6,
  strategy: "balanced"
})

// Step 2: Register agent types (metadata registry)
mcp__claude-flow__agent_spawn({
  type: "researcher",
  capabilities: ["requirements-analysis", "api-research"]
})

mcp__claude-flow__agent_spawn({
  type: "coder",
  capabilities: ["backend", "frontend"]
})

mcp__claude-flow__agent_spawn({
  type: "code-analyzer",
  capabilities: ["architecture", "database-design"]
})

// Step 3: Register task (planning/tracking metadata)
mcp__claude-flow__task_orchestrate({
  task: "Build e-commerce platform with user auth, product catalog, and checkout",
  strategy: "adaptive",
  priority: "high"
})

// Step 4: Spawn REAL agents with coordination instructions
Task("Requirements Researcher", `
# Task: Research requirements for e-commerce platform

## Work Instructions
1. Research best practices for:
   - User authentication
   - Product catalog design
   - Checkout flow
   - Payment integration

2. Create detailed requirements document

## COORDINATION PROTOCOL (REQUIRED)

### Before Starting
npx claude-flow@alpha hooks pre-task \\
  --description "E-commerce requirements research"

### During Work
For each major finding:
mcp__claude-flow__memory_usage({
  action: "store",
  namespace: "swarm/research",
  key: "requirements/<topic>",
  value: "<your findings>"
})

### After Completion
npx claude-flow@alpha hooks post-task \\
  --task-id "research-phase"

Output: docs/requirements.md
`, "researcher")

Task("Database Architect", `
# Task: Design database schema

## Work Instructions
1. Wait for requirements (check memory store)
2. Design PostgreSQL schema
3. Create migration scripts

## COORDINATION PROTOCOL (REQUIRED)

### Before Starting
npx claude-flow@alpha hooks pre-task \\
  --description "Database schema design"

### Check Requirements
mcp__claude-flow__memory_usage({
  action: "retrieve",
  namespace: "swarm/research",
  key: "requirements/*"
})

### Store Your Design
mcp__claude-flow__memory_usage({
  action: "store",
  namespace: "swarm/architecture",
  key: "database/schema",
  value: "<your schema design>"
})

### After Completion
npx claude-flow@alpha hooks post-task \\
  --task-id "database-design"

Output: database/schema.sql, database/migrations/
`, "code-analyzer")

Task("Backend Developer", `
# Task: Implement REST API

## Work Instructions
1. Read requirements and schema from memory
2. Implement Express REST API
3. Integrate authentication
4. Create API documentation

## COORDINATION PROTOCOL (REQUIRED)

### Before Starting
npx claude-flow@alpha hooks pre-task \\
  --description "Backend API implementation"

### Read Coordination Data
mcp__claude-flow__memory_usage({
  action: "retrieve",
  namespace: "swarm/research",
  key: "requirements/*"
})

mcp__claude-flow__memory_usage({
  action: "retrieve",
  namespace: "swarm/architecture",
  key: "database/schema"
})

### Store API Contract
mcp__claude-flow__memory_usage({
  action: "store",
  namespace: "swarm/api",
  key: "endpoints",
  value: "<OpenAPI spec>"
})

### During Development
For each file created/modified:
npx claude-flow@alpha hooks post-edit \\
  --file "src/api/<filename>"

### After Completion
npx claude-flow@alpha hooks post-task \\
  --task-id "backend-implementation"

Output: src/api/, docs/API.md
`, "backend-dev")

Task("Frontend Developer", `
# Task: Build React frontend

## Work Instructions
1. Read API contract from memory
2. Build React UI components
3. Integrate with backend API

## COORDINATION PROTOCOL (REQUIRED)

### Before Starting
npx claude-flow@alpha hooks pre-task \\
  --description "Frontend implementation"

### Read API Contract
mcp__claude-flow__memory_usage({
  action: "retrieve",
  namespace: "swarm/api",
  key: "endpoints"
})

### During Development
For each component created:
npx claude-flow@alpha hooks post-edit \\
  --file "src/components/<ComponentName>.jsx"

### After Completion
npx claude-flow@alpha hooks post-task \\
  --task-id "frontend-implementation"

Output: src/components/, src/pages/
`, "coder")

Task("Integration Tester", `
# Task: Integration testing

## Work Instructions
1. Wait for backend and frontend completion
2. Write integration tests
3. Test full user flows

## COORDINATION PROTOCOL (REQUIRED)

### Before Starting
npx claude-flow@alpha hooks pre-task \\
  --description "Integration testing"

### Check Completion Status
mcp__claude-flow__memory_usage({
  action: "search",
  pattern: "swarm/*",
  namespace: "default",
  limit: 50
})

### Store Test Results
mcp__claude-flow__memory_usage({
  action: "store",
  namespace: "swarm/testing",
  key: "integration-results",
  value: "<test results>"
})

### After Completion
npx claude-flow@alpha hooks post-task \\
  --task-id "integration-testing"

Output: tests/integration/, test-results.json
`, "tester")

Task("Code Reviewer", `
# Task: Final code review

## Work Instructions
1. Review all code and coordination data
2. Check for issues
3. Provide recommendations

## COORDINATION PROTOCOL (REQUIRED)

### Before Starting
npx claude-flow@alpha hooks pre-task \\
  --description "Code review"

### Read All Coordination Data
mcp__claude-flow__memory_usage({
  action: "list",
  namespace: "swarm"
})

### Store Review Results
mcp__claude-flow__memory_usage({
  action: "store",
  namespace: "swarm/review",
  key: "final-review",
  value: "<review findings>"
})

### After Completion
npx claude-flow@alpha hooks post-task \\
  --task-id "code-review"

Output: docs/code-review.md
`, "reviewer")
```

**Key Points**:
1. MCP tools set up metadata infrastructure first
2. Task tool spawns REAL working agents
3. Each agent manually executes hooks for coordination
4. Agents read/write to shared memory for state
5. Coordination is explicit, not automatic

---

## Common Patterns

### Pattern: Sequential Dependency Chain

```javascript
// Agent 1: Creates something
Task("Creator", `
  Create feature X
  Store metadata in memory:
  npx claude-flow hooks post-edit --file "output.js"

  mcp__claude-flow__memory_usage({
    action: "store",
    key: "feature-x-complete",
    value: "true"
  })
`, "coder")

// Agent 2: Waits for Agent 1
Task("Consumer", `
  Wait for feature X:

  result = mcp__claude-flow__memory_usage({
    action: "retrieve",
    key: "feature-x-complete"
  })

  if (result !== "true") {
    throw "Feature X not ready yet"
  }

  Use feature X...
`, "coder")
```

### Pattern: Parallel with Final Aggregation

```javascript
// Multiple agents work in parallel
Task("Worker 1", "Do task 1, store results in memory", "researcher")
Task("Worker 2", "Do task 2, store results in memory", "researcher")
Task("Worker 3", "Do task 3, store results in memory", "researcher")

// Aggregator waits for all
Task("Aggregator", `
  Read all worker results from memory:

  results = mcp__claude-flow__memory_usage({
    action: "search",
    pattern: "worker-*-results"
  })

  Combine and analyze all results...
`, "analyst")
```

### Pattern: Iterative Refinement

```javascript
// Agent 1: Initial attempt
Task("Developer", `
  Implement feature
  Store result in memory as "attempt-1"
`, "coder")

// Agent 2: Review and suggest improvements
Task("Reviewer", `
  Read "attempt-1" from memory
  Analyze and suggest improvements
  Store suggestions as "improvements-1"
`, "reviewer")

// Agent 1: Refine based on feedback
Task("Developer", `
  Read "improvements-1" from memory
  Refine implementation
  Store result as "attempt-2"
`, "coder")
```

---

## Memory Usage Best Practices

### Namespace Organization

```javascript
// Recommended namespace structure
mcp__claude-flow__memory_usage({
  action: "store",
  namespace: "swarm/<category>",
  key: "<specific-key>",
  value: "<data>"
})

// Examples:
// swarm/research/*         - Research findings
// swarm/architecture/*     - Design decisions
// swarm/api/*              - API contracts
// swarm/testing/*          - Test results
// swarm/review/*           - Review findings
```

### TTL (Time-To-Live) Strategy

```javascript
// Short-lived data (session only)
mcp__claude-flow__memory_usage({
  action: "store",
  key: "temp-calculation",
  value: result,
  ttl: 3600  // 1 hour
})

// Long-lived data (persistent across sessions)
mcp__claude-flow__memory_usage({
  action: "store",
  key: "project-requirements",
  value: requirements,
  ttl: 2592000  // 30 days
})
```

### Search Patterns

```javascript
// Find all keys matching pattern
mcp__claude-flow__memory_usage({
  action: "search",
  pattern: "swarm/api/*",  // All API-related data
  limit: 100
})

// List all keys in namespace
mcp__claude-flow__memory_usage({
  action: "list",
  namespace: "swarm"
})
```

---

## Hook Usage Patterns

### Pre-Task Hook (Context Setup)

```javascript
// Before starting work
npx claude-flow@alpha hooks pre-task \\
  --description "Detailed description of what you're about to do" \\
  --task-id "optional-task-id"

// Purpose:
// - Initialize task context
// - Set up memory namespace
// - Log task start
// - Prepare resources
```

### Post-Edit Hook (File Change Tracking)

```javascript
// After creating/modifying a file
npx claude-flow@alpha hooks post-edit \\
  --file "path/to/file.js" \\
  --memory-key "swarm/codebase/file-manifest"

// Purpose:
// - Track file changes
// - Update codebase manifest
// - Notify other agents
// - Store file metadata
```

### Post-Task Hook (Completion Tracking)

```javascript
// After completing work
npx claude-flow@alpha hooks post-task \\
  --task-id "task-identifier" \\
  --export-metrics true

// Purpose:
// - Mark task complete
// - Store results
// - Export performance metrics
// - Clean up resources
```

### Session Restore Hook (Context Recovery)

```javascript
// Restore previous session context
npx claude-flow@alpha hooks session-restore \\
  --session-id "swarm-id-from-mcp-init"

// Purpose:
// - Load previous state
// - Restore memory context
// - Continue interrupted work
```

---

## Troubleshooting Common Issues

### Issue 1: "Agent isn't doing anything"

**Symptom**: Called `agent_spawn` but no work is happening

**Cause**: `agent_spawn` only creates metadata, doesn't spawn agent

**Solution**: Use Task tool to spawn real agent:
```javascript
// ❌ This creates metadata only
mcp__claude-flow__agent_spawn({ type: "coder" })

// ✅ This spawns real working agent
Task("Coder", "Write code here", "coder")
```

---

### Issue 2: "Task stays pending forever"

**Symptom**: `task_orchestrate` returns pending status, nothing executes

**Cause**: `task_orchestrate` only creates task metadata, doesn't execute

**Solution**: Spawn agents manually with Task tool:
```javascript
// Step 1: Register task (optional)
mcp__claude-flow__task_orchestrate({
  task: "Build feature X"
})

// Step 2: Actually execute by spawning agent
Task("Developer", "Build feature X", "coder")
```

---

### Issue 3: "Agents can't see each other's work"

**Symptom**: Agents working in isolation, not coordinating

**Cause**: No shared memory usage or hooks being executed

**Solution**: Add manual coordination:
```javascript
Task("Agent 1", `
  Do work...

  // Store results for others
  mcp__claude-flow__memory_usage({
    action: "store",
    key: "agent1-results",
    value: myResults
  })
`, "coder")

Task("Agent 2", `
  // Read Agent 1's results
  results = mcp__claude-flow__memory_usage({
    action: "retrieve",
    key: "agent1-results"
  })

  Use results...
`, "coder")
```

---

### Issue 4: "Hooks not working"

**Symptom**: Hook commands fail or do nothing

**Cause**: Hooks are CLI commands, need explicit Bash execution

**Solution**: Execute hooks via Bash in agent prompts:
```javascript
Task("Agent", `
  // Execute hook command
  Bash("npx claude-flow@alpha hooks pre-task --description 'My task'")

  Do work...

  Bash("npx claude-flow@alpha hooks post-task")
`, "coder")
```

---

### Issue 5: "Session restore not finding swarm"

**Symptom**: `session-restore` hook reports "No session found"

**Cause**: Hook expects specific session format, not swarm ID

**Solution**: Session IDs are different from swarm IDs. If using MCP:
```javascript
// Get the actual session ID
const sessionId = process.env.CLAUDE_FLOW_SESSION_ID || "default"

// Use that for restore
npx claude-flow@alpha hooks session-restore --session-id "${sessionId}"
```

---

## Performance Tips

### 1. Parallel Agent Spawning (10-20x Faster)

```javascript
// ❌ Slow: Sequential spawning
Task("Agent 1", "...", "coder")
Task("Agent 2", "...", "coder")
Task("Agent 3", "...", "coder")
// Takes 3x the time

// ✅ Fast: Single message with multiple tasks
[Single Message]:
Task("Agent 1", "...", "coder")
Task("Agent 2", "...", "coder")
Task("Agent 3", "...", "coder")
// Spawns all in parallel
```

### 2. Batch Memory Operations

```javascript
// ❌ Slow: Multiple individual stores
mcp__claude-flow__memory_usage({ action: "store", key: "a", value: "1" })
mcp__claude-flow__memory_usage({ action: "store", key: "b", value: "2" })
mcp__claude-flow__memory_usage({ action: "store", key: "c", value: "3" })

// ✅ Fast: Batch all operations in single message
[Single Message]:
mcp__claude-flow__memory_usage({ action: "store", key: "a", value: "1" })
mcp__claude-flow__memory_usage({ action: "store", key: "b", value: "2" })
mcp__claude-flow__memory_usage({ action: "store", key: "c", value: "3" })
```

### 3. Use Namespaces for Organization

```javascript
// ✅ Good: Organized namespaces
namespace: "swarm/research"
namespace: "swarm/architecture"
namespace: "swarm/implementation"

// ❌ Bad: Flat structure
key: "research-finding-1"
key: "research-finding-2"
key: "architecture-decision-1"
// Hard to search and manage
```

---

## Complete Example: Real-World Project

### Scenario: Build a Blog API with Tests

```javascript
// ============================================
// Option A: Simple Approach (No MCP)
// ============================================

Task("Backend Dev", `
  Create Express REST API for blog:
  - POST /api/posts (create post)
  - GET /api/posts (list posts)
  - GET /api/posts/:id (get post)
  - PUT /api/posts/:id (update post)
  - DELETE /api/posts/:id (delete post)

  Output: src/api/blog.js
`, "backend-dev")

Task("Tester", `
  Read src/api/blog.js
  Write comprehensive tests

  Output: tests/blog.test.js
`, "tester")

Task("Documenter", `
  Read src/api/blog.js
  Create OpenAPI spec

  Output: docs/api-spec.yaml
`, "api-docs")

// ============================================
// Option B: Coordinated Approach (With MCP)
// ============================================

// Setup
mcp__claude-flow__swarm_init({ topology: "mesh", maxAgents: 4 })
mcp__claude-flow__agent_spawn({ type: "backend-dev" })
mcp__claude-flow__agent_spawn({ type: "tester" })
mcp__claude-flow__agent_spawn({ type: "api-docs" })

// Execution
Task("Backend Dev", `
  # Coordination hooks
  Bash("npx claude-flow@alpha hooks pre-task --description 'Blog API'")

  Create Express REST API for blog:
  - POST /api/posts
  - GET /api/posts
  - GET /api/posts/:id
  - PUT /api/posts/:id
  - DELETE /api/posts/:id

  # Store API contract for other agents
  mcp__claude-flow__memory_usage({
    action: "store",
    namespace: "swarm/api",
    key: "blog-endpoints",
    value: JSON.stringify({
      endpoints: [
        { method: "POST", path: "/api/posts", desc: "Create post" },
        { method: "GET", path: "/api/posts", desc: "List posts" },
        // ... etc
      ],
      schemas: { /* data schemas */ }
    })
  })

  Bash("npx claude-flow@alpha hooks post-edit --file 'src/api/blog.js'")
  Bash("npx claude-flow@alpha hooks post-task")

  Output: src/api/blog.js
`, "backend-dev")

Task("Tester", `
  # Coordination hooks
  Bash("npx claude-flow@alpha hooks pre-task --description 'Blog API tests'")

  # Read API contract
  contract = mcp__claude-flow__memory_usage({
    action: "retrieve",
    namespace: "swarm/api",
    key: "blog-endpoints"
  })

  Write tests for all endpoints in contract

  # Store test results
  mcp__claude-flow__memory_usage({
    action: "store",
    namespace: "swarm/testing",
    key: "blog-test-results",
    value: JSON.stringify({
      passed: 15,
      failed: 0,
      coverage: "95%"
    })
  })

  Bash("npx claude-flow@alpha hooks post-task")

  Output: tests/blog.test.js
`, "tester")

Task("Documenter", `
  # Coordination hooks
  Bash("npx claude-flow@alpha hooks pre-task --description 'API documentation'")

  # Read API contract
  contract = mcp__claude-flow__memory_usage({
    action: "retrieve",
    namespace: "swarm/api",
    key: "blog-endpoints"
  })

  # Read test results
  testResults = mcp__claude-flow__memory_usage({
    action: "retrieve",
    namespace: "swarm/testing",
    key: "blog-test-results"
  })

  Create comprehensive OpenAPI spec with:
  - All endpoints from contract
  - Request/response schemas
  - Test coverage from results

  Bash("npx claude-flow@alpha hooks post-task")

  Output: docs/api-spec.yaml
`, "api-docs")
```

**When to Use Which**:
- **Option A (Simple)**: Blog API is straightforward, file-based coordination works fine
- **Option B (Coordinated)**: You want persistent session, memory namespacing, or session resume

---

## Summary Checklist

### For Every Project

- [ ] Decide: Simple (Task-only) or Complex (MCP + Task + Hooks)?
- [ ] If Simple: Use Task tool only, coordinate via files
- [ ] If Complex: Initialize MCP first, then spawn agents
- [ ] Remember: `agent_spawn` is metadata, Task tool is execution
- [ ] Remember: Hooks are manual Bash commands
- [ ] Remember: Agents coordinate via explicit memory operations
- [ ] Use parallel spawning (single message with multiple tasks)
- [ ] Organize memory with namespaces
- [ ] Set appropriate TTLs for data

### For Each Agent

- [ ] Spawn with Task tool (not agent_spawn)
- [ ] Include coordination instructions if using MCP
- [ ] Execute pre-task hook if coordinating
- [ ] Read from memory if depending on others
- [ ] Write to memory if others depend on you
- [ ] Execute post-edit hooks for file changes
- [ ] Execute post-task hook when done

---

## Getting Help

### If Something Doesn't Work

1. **Check your mental model**: MCP is metadata, Task is execution
2. **Verify hook execution**: Are agents actually running Bash hook commands?
3. **Check memory namespaces**: Are agents reading/writing to correct locations?
4. **Review agent prompts**: Are coordination instructions clear?
5. **Test simple first**: Try Task-only pattern to isolate issue

### Resources

- **Full Investigation**: See `claude-flow-investigation-findings.md`
- **Your Analysis**: See `claude-flow-analysis-thesis.md`
- **Source Code**: `/workspaces/claude-flow/src/mcp/mcp-server.js`
- **Hook System**: `/workspaces/claude-flow/src/hooks/`

---

**Remember**: Claude-Flow is powerful when you understand the layers. MCP provides coordination infrastructure, Task tool does execution, and hooks enable manual coordination. Choose the right pattern for your needs!
