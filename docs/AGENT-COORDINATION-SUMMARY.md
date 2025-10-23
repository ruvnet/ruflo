# AI-Claude-Flow Agent Coordination Architecture - Summary

## Quick Reference

### 1. Agent Definitions (76 Total)
| Category | Count | Examples |
|----------|-------|----------|
| Core Agents | 5 | coder, researcher, tester, reviewer, planner |
| Swarm Coordinators | 5 | hierarchical, mesh, distributed, adaptive, collective-intelligence |
| Consensus Agents | 7 | byzantine, raft, gossip, quorum, crdt, security |
| Analysis | 3 | code-analyzer, code-review |
| Development | 3 | backend, mobile, ml-developer |
| GitHub Integration | 11 | pr-manager, issue-tracker, multi-repo-swarm, etc. |
| HiveMind | 5 | queen, worker, scout, coordinator, memory-manager |
| SPARC Agents | 4 | specification, pseudocode, architecture, refinement |
| Other Categories | 32+ | DevOps, optimization, testing, flow-nexus, etc. |

### 2. Agent Discovery & Loading Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. Agent Definition Loading                             │
│                                                         │
│ .claude/agents/*.md (Markdown + YAML frontmatter)       │
│         │                                               │
│         ├─ Parse YAML frontmatter                       │
│         ├─ Extract agent properties                     │
│         └─ Load markdown content                        │
│         │                                               │
│         ▼                                               │
│ ┌─────────────────────────────────────────────┐        │
│ │ AgentLoader (src/agents/agent-loader.ts)    │        │
│ │ - Cache agent definitions                   │        │
│ │ - 1-minute cache expiry                     │        │
│ │ - Support legacy mapping                    │        │
│ └─────────────────────────────────────────────┘        │
│         │                                               │
│         ▼                                               │
│ ┌─────────────────────────────────────────────┐        │
│ │ Singleton Instance (agentLoader)            │        │
│ │ - getAvailableAgentTypes()                  │        │
│ │ - getAgent(name)                            │        │
│ │ - getAgentCategories()                      │        │
│ └─────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────┘
```

### 3. Task Tool Integration Pipeline

**Usage Pattern in Claude Code:**
```javascript
// Single message, parallel execution
Task("agent_type", "objective", "execution_mode")
```

**Execution Flow:**
```
Claude Code                Claude-Flow MCP Server              Agent Execution
    │                              │                               │
    │ Task("coder", "...")         │                               │
    ├─────────────────────────────→│                               │
    │                              │ 1. Load agent definition       │
    │                              ├──────────────────────────────→│
    │                              │                               │
    │                              │ 2. Build enhanced prompt      │
    │                              │    (SPARC methodology)        │
    │                              │                               │
    │                              │ 3. Inject pre-hooks           │
    │                              │    (setup/validation)         │
    │                              │                               │
    │                              │ 4. Execute main task          │
    │                              │    (agent-specific logic)     │
    │                              │                               │
    │                              │ 5. Inject post-hooks          │
    │                              │    (cleanup/reporting)        │
    │                              │                               │
    │                    Result ←──┤                               │
    │←──────────────────────────────┤                               │
    │                              │                               │
```

### 4. Swarm Coordination Models Comparison

| Model | Topology | Scalability | Bottleneck | Use Case |
|-------|----------|-------------|-----------|----------|
| **Centralized** | Star | Medium | Central coordinator | Simple, small teams |
| **Distributed** | Multiple stars | High | Load spread | Medium complexity |
| **Hierarchical** | Tree | Very High | Team leads | Large orgs, specialization |
| **Mesh** | Fully connected | Very High | None | Peer-to-peer, resilient |
| **Hybrid** | Mixed phases | High | Phase-dependent | Complex multi-phase tasks |

### 5. Memory Coordination Architecture

**Three-Layer Model:**

```
┌────────────────────────────────────────┐
│ Layer 1: Distributed Memory System     │
│ - Persistent storage (optional)        │
│ - TTL support (auto-expire)            │
│ - Partitioning by namespace            │
│ - Full-text search indexing            │
└────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│ Layer 2: Memory Partitions             │
│ - knowledge (shared learning)          │
│ - state (agent status)                 │
│ - results (task outputs)               │
│ - logs (audit trail)                   │
│ - metrics (performance)                │
└────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│ Layer 3: Access Control                │
│ - private (owner only)                 │
│ - team (team members)                  │
│ - swarm (all agents)                   │
│ - public (external)                    │
│ - system (framework)                   │
└────────────────────────────────────────┘
```

**Cross-Agent Communication Patterns:**

```
Pattern 1: Request-Response (Task-based)
  Agent A: write("swarm/requests/123", task)
  Agent B: read("swarm/requests/123") → execute
  Agent B: write("swarm/responses/123", result)
  Agent A: read("swarm/responses/123")

Pattern 2: Pub-Sub (Event-based)
  Agent A: emit("progress:changed", data)
  Agent B: on("progress:changed", handler)

Pattern 3: Shared State (Coordination)
  Coordinator: write("swarm/shared/state", {...})
  All Agents: read("swarm/shared/state") when needed
```

### 6. Agent Lifecycle State Machine

```
[initializing]
    │
    ├──→ initialize()
    │
    ▼
[idle] ←─ task completes
    │
    ├──→ assignTask()
    │
    ▼
[busy]
    │
    ├──→ pause() ──→ [paused]
    │                  │
    │                  ├──→ resume() ──→ [busy]
    │                  │
    │                  └──→ shutdown() ──→ [terminating] ──→ [terminated]
    │
    ├──→ error ──→ [error] ──→ recovery attempt ──→ [idle or busy]
    │
    └──→ shutdown() ──→ [terminating] ──→ [terminated]
```

### 7. Agent Selection Scoring Algorithm

**Score Calculation (100 points total):**

```
Total Score = Health(40) + SuccessRate(30) + Availability(20) + Capability(10)

Health Score (0-40 points):
  - Current agent health from 0.0 to 1.0
  - Direct multiplier: health * 40

Success Rate Score (0-30 points):
  - Ratio of tasks completed to total tasks
  - Direct multiplier: success_rate * 30

Availability Score (0-20 points):
  - Based on current workload
  - availability = 1 - current_workload
  - Multiplier: availability * 20

Capability Match Score (0-10 points):
  - Matches required capabilities for task
  - (matching_caps / total_required_caps) * 10
```

**Selection Process:**
1. Filter by health threshold (>= 0.5)
2. Filter by required capabilities
3. Filter by availability (idle + workload < 0.8)
4. Score all candidates
5. Return highest scoring agent

### 8. Task Execution Lifecycle

```
assignTask(task)
    │
    ├─ 1. Validate
    │    ├─ Check capabilities match
    │    └─ Check concurrency limits
    │
    ├─ 2. Update Status
    │    ├─ Status: idle → busy
    │    ├─ currentTasks += 1
    │    └─ workload = currentTasks / maxConcurrent
    │
    ├─ 3. Execute [try/catch]
    │    │
    │    ├─ Success Path:
    │    │  ├─ tasksCompleted++
    │    │  ├─ averageExecutionTime (weighted)
    │    │  ├─ Remove from currentTasks
    │    │  ├─ Add to taskHistory
    │    │  └─ Status: busy → idle
    │    │
    │    └─ Failure Path:
    │       ├─ tasksFailed++
    │       ├─ Record error with context
    │       ├─ health -= (0.01 to 0.2) based on severity
    │       ├─ Remove from currentTasks
    │       └─ Status: busy → idle
    │
    └─ 4. Store State
       └─ Save to memory (async)
```

### 9. Heartbeat & Monitoring

**Two Intervals:**

```
Every 10 seconds:
  - Send heartbeat to eventBus
  - Report current metrics
  - Detect stale agents

Every 30 seconds:
  - Collect and update metrics
  - Recalculate success rate
  - Store metrics in memory
  - Update activity timestamp
```

### 10. Communication & Event System

**Event Taxonomy:**

```
Agent Events:
  ├─ agent:created
  ├─ agent:started
  ├─ agent:stopped
  ├─ agent:error
  ├─ agent:heartbeat
  ├─ agent:health-changed
  ├─ agent:status-changed
  └─ agent:task-[assigned|started|completed|failed]

Task Events:
  ├─ task:created
  ├─ task:assigned
  ├─ task:started
  ├─ task:paused
  ├─ task:resumed
  ├─ task:completed
  ├─ task:failed
  ├─ task:cancelled
  └─ task:retried

Coordination Events:
  ├─ coordination:load_balanced
  ├─ coordination:work_stolen
  ├─ coordination:agent_selected
  └─ coordination:dependency_resolved

Swarm Events:
  ├─ swarm:created
  ├─ swarm:started
  ├─ swarm:paused
  ├─ swarm:resumed
  ├─ swarm:completed
  ├─ swarm:failed
  └─ swarm:cancelled

Memory Events:
  ├─ memory:stored
  ├─ memory:retrieved
  ├─ memory:updated
  ├─ memory:deleted
  └─ memory:initialized
```

**Hook Execution:**

```
pre-hook (Agent Spawn)
    │
    ├─ Set up environment variables
    ├─ Validate dependencies
    ├─ Prepare resources
    └─ Initialize logging
    │
    ▼
[AGENT EXECUTION]
    │
    ├─ Main task logic
    ├─ Call specialized executeTask()
    └─ Track metrics
    │
    ▼
post-hook (Completion)
    ├─ Generate reports
    ├─ Clean up resources
    ├─ Run validation tests
    └─ Store results in memory
```

### 11. Performance Characteristics

**Constants (from SWARM_CONSTANTS):**

```
Timeouts:
  - Task timeout: 5 minutes
  - Agent timeout: 30 seconds
  - Heartbeat interval: 10 seconds

Limits:
  - Max agents per swarm: 100
  - Max tasks per agent: 10
  - Max retries: 3
  - Error history limit: 50 entries

Quality:
  - Min threshold: 0.7
  - Default threshold: 0.8
  - High threshold: 0.9

Performance:
  - Target throughput: 10 tasks/minute
  - Target latency: 1000ms
  - Target reliability: 95%

Resources:
  - Memory limit: 512MB per agent
  - CPU limit: 1 core per agent
  - Disk limit: 1GB per agent
```

### 12. Key Files & Locations

```
Agent System:
  ├─ .claude/agents/ (76 markdown definitions)
  ├─ src/agents/agent-loader.ts (Dynamic loading)
  ├─ src/agents/agent-registry.ts (Memory-backed registry)
  └─ src/cli/agents/base-agent.ts (Abstract base class)

Coordination:
  ├─ src/swarm/coordinator.ts (Main orchestrator)
  ├─ src/task/coordination.ts (Task coordination)
  ├─ src/swarm/executor.ts (Task execution)
  └─ src/swarm/executor-sdk.ts (SDK wrapper)

Memory:
  ├─ src/swarm/memory.ts (Distributed memory system)
  ├─ src/swarm/types.ts (Type definitions)
  └─ src/core/AgentRegistry.ts (Registry implementation)

MCP Integration:
  ├─ src/mcp/claude-code-wrapper.ts (Task tool handler)
  ├─ src/mcp/claude-flow-tools.ts (Framework tools)
  └─ src/mcp/swarm-tools.ts (Swarm management)

Types & Interfaces:
  ├─ src/swarm/types.ts (1148 lines - comprehensive)
  ├─ src/types/interfaces.ts (Core interfaces)
  └─ src/constants/agent-types.ts (Agent type definitions)
```

### 13. Integration Checklist for New Components

- [ ] Extend BaseAgent for specialized behavior
- [ ] Define agent in .claude/agents/ with YAML frontmatter
- [ ] Register agent in AgentRegistry
- [ ] Implement executeTask() method
- [ ] Set up memory coordination keys
- [ ] Define pre/post hooks for lifecycle
- [ ] Add capability tags
- [ ] Implement metrics collection
- [ ] Set up event handlers
- [ ] Test with swarm coordination
- [ ] Validate with different topologies
- [ ] Document in agent markdown file

### 14. Scaling Considerations

**Horizontal Scaling:**
- Increase MAX_AGENTS_PER_SWARM limit
- Use distributed/mesh coordination modes
- Implement load balancing per agent
- Add coordinator nodes for distributed mode

**Vertical Scaling:**
- Increase memory/CPU resource limits
- Optimize hot paths (memory queries)
- Enable caching layers
- Use connection pooling for I/O

**Memory Optimization:**
- Set TTL on memory entries
- Partition by namespace
- Enable compression
- Archive old entries

---

## References

- Complete research document: `docs/RESEARCH-AGENT-COORDINATION.md` (1,298 lines)
- Agent definitions: `.claude/agents/` (76 markdown files)
- Type system: `src/swarm/types.ts` (1,148 lines of comprehensive types)
- Core coordinator: `src/swarm/coordinator.ts`
- Memory system: `src/swarm/memory.ts`
- Task coordination: `src/task/coordination.ts`

