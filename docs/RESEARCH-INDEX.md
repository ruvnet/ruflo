# AI-Claude-Flow Research - Complete Index

## Document Structure

This research package contains comprehensive documentation on agent spawning and coordination:

### Primary Documents

1. **RESEARCH-AGENT-COORDINATION.md** (1,298 lines)
   - Complete architectural deep-dive
   - All coordination patterns with diagrams
   - Memory system design
   - Agent lifecycle and state machines
   - Full source code snippets
   - Performance characteristics
   - Integration examples

2. **AGENT-COORDINATION-SUMMARY.md** (Quick Reference)
   - 14 key topic areas
   - Tables, diagrams, and flowcharts
   - Integration checklist
   - Scaling considerations
   - Key files and locations

3. **RESEARCH-INDEX.md** (This file)
   - Navigation guide
   - Code location map
   - Key findings summary

---

## Key Research Findings

### 1. Agent Definitions (76 Total)

**Location**: `/home/user/ai-claude-flow/.claude/agents/`

```
.claude/agents/
├── core/                      (5 agents)
│   ├── coder.md              # Implementation specialist
│   ├── researcher.md         # Research and data gathering
│   ├── tester.md             # Quality assurance
│   ├── reviewer.md           # Code review
│   └── planner.md            # Task planning
├── swarm/                     (5 coordinators)
│   ├── hierarchical-coordinator.md    # Queen with teams
│   ├── mesh-coordinator.md           # Peer-to-peer
│   ├── distributed-coordinator.md    # Multiple leaders
│   ├── adaptive-coordinator.md       # Self-optimizing
│   └── collective-intelligence-coordinator.md
├── consensus/                 (7 agents)
│   ├── byzantine-coordinator.md
│   ├── raft-manager.md
│   ├── gossip-coordinator.md
│   ├── quorum-manager.md
│   ├── crdt-synchronizer.md
│   ├── security-manager.md
│   └── performance-benchmarker.md
├── analysis/                  (Code analysis)
├── development/               (Backend, mobile)
├── github/                    (11 GitHub agents)
├── hive-mind/                 (5 HiveMind agents)
├── testing/                   (TDD, validation)
├── optimization/              (Performance)
├── sparc/                     (4 SPARC agents)
└── [8+ more categories]
```

**Agent Definition Format** (Markdown + YAML):

```yaml
---
name: agent_name
type: agent_type
color: "#COLOR"
description: "What this agent does"
capabilities:
  - capability1
  - capability2
priority: high|medium|low|critical
hooks:
  pre: |
    # Pre-execution setup script
  post: |
    # Post-execution cleanup script
---

# Markdown documentation about the agent
# Implementation guidelines
# Integration patterns
# Examples
```

### 2. Agent Discovery System

**Loader**: `src/agents/agent-loader.ts`

```typescript
class AgentLoader {
  // Singleton pattern for single source of truth
  private agentCache: Map<string, AgentDefinition>
  private cacheExpiry = 60000  // 1 minute
  
  async getAvailableAgentTypes(): Promise<string[]>
  async getAgent(name: string): Promise<AgentDefinition>
  async getAgentCategories(): Promise<AgentCategory[]>
  async searchAgents(query: string): Promise<AgentDefinition[]>
  async isValidAgentType(name: string): Promise<boolean>
}
```

**Usage**: 
```typescript
const agents = await agentLoader.getAvailableAgentTypes()
const coder = await agentLoader.getAgent('coder')
const categories = await agentLoader.getAgentCategories()
```

### 3. Task Tool Integration (Claude Code)

**Location**: `src/mcp/claude-code-wrapper.ts`

**Usage Pattern**:
```javascript
// In Claude Code, spawn agents with single command
Task("researcher", "Analyze market trends", "researcher")
Task("coder", "Implement REST API", "coder")
Task("tester", "Write test suite", "tester")
```

**Execution Flow**:
```
Claude Code (Task tool)
    ↓
ClaudeCodeMCPWrapper (MCP Server)
    ├─ Load agent definition
    ├─ Build enhanced SPARC prompt
    ├─ Execute pre-hooks
    ├─ Run agent execution
    ├─ Execute post-hooks
    └─ Return results
```

### 4. Swarm Coordination

**Coordinator**: `src/swarm/coordinator.ts`

**Five Coordination Models**:

1. **Centralized**: Single coordinator controls all agents
2. **Distributed**: Multiple coordinators for different domains
3. **Hierarchical**: Queen with specialized worker teams
4. **Mesh**: Peer-to-peer coordination between all agents
5. **Hybrid**: Different patterns for different phases

**Task Coordination**: `src/task/coordination.ts`

```typescript
class TaskCoordinator {
  async createTaskTodos(objective, context, options)
  async launchParallelAgents(tasks, coordinationContext)
  async coordinateBatchOperations(operations, context)
  async coordinateSwarm(objective, context, agents)
}
```

### 5. Memory Sharing System

**Location**: `src/swarm/memory.ts`

```typescript
class SwarmMemoryManager extends EventEmitter {
  // Three-layer architecture
  async store(key, value, options): Promise<string>
  async retrieve(key, namespace): Promise<any>
  async queryMemory(query: MemoryQuery): Promise<MemoryEntry[]>
  
  // Partitions
  // - knowledge    (shared learning)
  // - state        (agent status)
  // - cache        (temporary data)
  // - logs         (audit trail)
  // - results      (task outputs)
  // - communication (message history)
  // - configuration
  // - metrics
}
```

**Access Control**:
```typescript
type AccessLevel = 'private' | 'team' | 'swarm' | 'public' | 'system'
```

**Communication Patterns**:

1. **Request-Response**: Agent A writes request, Agent B reads & responds
2. **Pub-Sub**: Event emitter for broadcasts
3. **Shared State**: Coordinator maintains state, agents read/write

### 6. Agent Registry & Management

**Registry**: `src/agents/agent-registry.ts`

```typescript
class AgentRegistry {
  async registerAgent(agent, tags)
  async updateAgent(agentId, updates)
  async unregisterAgent(agentId, preserveHistory)
  async getAgent(agentId): Promise<AgentState>
  
  // Queries
  async queryAgents(query): Promise<AgentState[]>
  async getAgentsByType(type): Promise<AgentState[]>
  async getHealthyAgents(threshold): Promise<AgentState[]>
  
  // Selection
  async findBestAgent(taskType, capabilities, preferred)
}
```

**Agent Selection Score** (100 points):
- Health: 0-40 points
- Success Rate: 0-30 points
- Availability: 0-20 points
- Capability Match: 0-10 points

### 7. Type System

**Location**: `src/swarm/types.ts` (1,148 lines)

```typescript
// Core types
interface AgentId { id, swarmId, type, instance }
interface TaskId { id, swarmId, sequence, priority }
interface SwarmId { id, timestamp, namespace }

// Agent state
interface AgentState {
  id: AgentId
  name: string
  type: AgentType
  status: AgentStatus
  capabilities: AgentCapabilities
  metrics: AgentMetrics
  workload: number (0-1)
  health: number (0-1)
  currentTask?: TaskId
  taskHistory: TaskId[]
  errorHistory: AgentError[]
}

// Task definition
interface TaskDefinition {
  id: TaskId
  type: TaskType
  name: string
  description: string
  status: TaskStatus
  requirements: TaskRequirements
  constraints: TaskConstraints
  priority: TaskPriority
  assignedTo?: AgentId
  result?: TaskResult
}

// Swarm objective
interface SwarmObjective {
  id: string
  name: string
  strategy: SwarmStrategy
  mode: SwarmMode
  tasks: TaskDefinition[]
  dependencies: TaskDependency[]
  status: SwarmStatus
  progress: SwarmProgress
  metrics: SwarmMetrics
}

// Memory
interface MemoryEntry {
  id: string
  key: string
  value: any
  type: MemoryType
  tags: string[]
  owner: AgentId
  accessLevel: AccessLevel
  createdAt: Date
  expiresAt?: Date
  version: number
}
```

### 8. Agent Lifecycle

**Base Class**: `src/cli/agents/base-agent.ts`

```typescript
abstract class BaseAgent extends EventEmitter {
  async initialize(): Promise<void>
  async shutdown(): Promise<void>
  
  async assignTask(task: TaskDefinition): Promise<any>
  abstract executeTask(task: TaskDefinition): Promise<any>
  
  // Heartbeat (10 second intervals)
  protected startHeartbeat()
  
  // Metrics (30 second intervals)
  protected async collectMetrics()
  protected async saveState()
}
```

**State Machine**:
```
initializing → idle ↔ busy ↔ paused → terminating → terminated
                      ↓
                    error → recovery
```

### 9. Event System

**Location**: `src/swarm/types.ts`

**Event Types** (22 total):

```typescript
// Agent events
'agent:created' | 'agent:started' | 'agent:stopped' | 
'agent:error' | 'agent:heartbeat'

// Task events
'task:created' | 'task:assigned' | 'task:started' |
'task:completed' | 'task:failed' | 'task:cancelled'

// Coordination events
'coordination:load_balanced' | 'coordination:work_stolen' |
'coordination:dependency_resolved'

// Swarm events
'swarm:created' | 'swarm:started' | 'swarm:completed' |
'swarm:failed' | 'swarm:cancelled'
```

### 10. Task Execution

**Executor**: `src/swarm/executor.ts`

```typescript
class TaskExecutor extends EventEmitter {
  async executeTask(task, agent, options): Promise<ExecutionResult>
  async executeClaudeTask(task, agent, options): Promise<ExecutionResult>
  async stopExecution(sessionId, reason): Promise<void>
  
  getActiveExecutions(): ExecutionSession[]
  getExecutionMetrics(): ExecutionMetrics
}
```

**Execution Result**:
```typescript
interface ExecutionResult {
  success: boolean
  output: string
  error?: string
  exitCode: number
  duration: number
  resourcesUsed: ResourceUsage
  artifacts: Record<string, any>
  metadata: Record<string, any>
}
```

---

## Code Location Reference

### Agent System Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/agents/agent-loader.ts` | Dynamic agent loading | 274 |
| `src/agents/agent-registry.ts` | Agent tracking & registry | 482 |
| `src/cli/agents/base-agent.ts` | Abstract base class | 500 |
| `src/constants/agent-types.ts` | Type definitions | 78 |
| `.claude/agents/` | 76 agent definitions | 3,000+ |

### Coordination Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/swarm/coordinator.ts` | Main orchestrator | 2,000+ |
| `src/task/coordination.ts` | Task coordination | 882 |
| `src/swarm/types.ts` | Type definitions | 1,148 |
| `src/swarm/executor.ts` | Task execution | 500+ |
| `src/swarm/strategies/auto.ts` | Auto decomposition | 300+ |

### Memory Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/swarm/memory.ts` | Distributed memory | 500+ |
| `src/core/AgentRegistry.ts` | Registry impl. | 440 |
| `src/communication/message-bus.ts` | Event system | 200+ |

### MCP Integration

| File | Purpose | Lines |
|------|---------|-------|
| `src/mcp/claude-code-wrapper.ts` | Task tool handler | 841 |
| `src/mcp/claude-flow-tools.ts` | Framework tools | 300+ |
| `src/mcp/swarm-tools.ts` | Swarm tools | 400+ |

---

## Key Constants

```typescript
// From SWARM_CONSTANTS in src/swarm/types.ts

Timeouts:
  DEFAULT_TASK_TIMEOUT = 5 * 60 * 1000        // 5 minutes
  DEFAULT_AGENT_TIMEOUT = 30 * 1000           // 30 seconds
  DEFAULT_HEARTBEAT_INTERVAL = 10 * 1000      // 10 seconds

Limits:
  MAX_AGENTS_PER_SWARM = 100
  MAX_TASKS_PER_AGENT = 10
  MAX_RETRIES = 3

Quality:
  MIN_QUALITY_THRESHOLD = 0.7
  DEFAULT_QUALITY_THRESHOLD = 0.8
  HIGH_QUALITY_THRESHOLD = 0.9

Performance:
  DEFAULT_THROUGHPUT_TARGET = 10        // tasks/minute
  DEFAULT_LATENCY_TARGET = 1000         // milliseconds
  DEFAULT_RELIABILITY_TARGET = 0.95     // 95%

Resources:
  DEFAULT_MEMORY_LIMIT = 512MB
  DEFAULT_CPU_LIMIT = 1.0 cores
  DEFAULT_DISK_LIMIT = 1GB
```

---

## Key Findings Summary

### Strengths
1. **Dynamic agent definitions**: 76 agents in version-controlled markdown
2. **Flexible coordination**: 5 topology patterns for different scenarios
3. **Memory-centric**: True cross-agent state sharing and communication
4. **Type-safe**: Comprehensive TypeScript interfaces (1,148 lines)
5. **Event-driven**: Pub/sub architecture for loose coupling
6. **SPARC integrated**: Every agent follows systematic methodology
7. **Scalable**: Supports 100+ agents with load balancing

### Critical Components
- **Heartbeat System**: 10-second interval for failure detection
- **Memory Consistency**: Eventual consistency with 1-minute cache
- **Task Timeout**: 5-minute default with graceful degradation
- **Resource Limits**: Enforced at agent and system level
- **Success Tracking**: Exponential moving average metrics

### Integration Points
- Claude Code Task tool (sends agent spawn requests)
- MCP tools for memory and swarm operations
- Event emitter for async communication
- Hooks (pre/post) for lifecycle management
- EventBus for internal events

---

## Quick Start References

### For Understanding Agent Definitions
→ See `.claude/agents/core/coder.md` (well-documented example)
→ Review `src/agents/agent-loader.ts` (loading mechanism)

### For Understanding Coordination
→ See `src/swarm/coordinator.ts` (main orchestrator)
→ Review `src/task/coordination.ts` (task breakdown)

### For Understanding Memory
→ See `src/swarm/memory.ts` (distributed system)
→ Review memory sections in research docs

### For Understanding Types
→ See `src/swarm/types.ts` (1,148 comprehensive lines)
→ Review agent creation patterns in `src/cli/agents/base-agent.ts`

### For Integration Examples
→ See agent markdown files (all have MCP tool examples)
→ Review `src/mcp/claude-code-wrapper.ts` (task routing)

---

## Document Navigation

**Read First**: 
- AGENT-COORDINATION-SUMMARY.md (overview)
- This file (location map)

**Read Next**:
- RESEARCH-AGENT-COORDINATION.md (deep dive)

**Reference As Needed**:
- Code files listed above
- Type definitions in src/swarm/types.ts

---

Generated: 2024
Based on ai-claude-flow v2.7.1 codebase analysis
