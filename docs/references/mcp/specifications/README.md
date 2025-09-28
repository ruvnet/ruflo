# MCP Tool Specifications

This document provides detailed specifications for all MCP tools in the Claude-Flow framework, including parameters, return values, dependencies, and usage patterns.

## Tool Specification Format

Each tool specification includes:
- **Purpose**: What the tool does
- **Parameters**: Input parameters with types and descriptions
- **Returns**: Output format and structure
- **Dependencies**: Required tools or services
- **Side Effects**: Changes made to system state
- **Examples**: Usage examples
- **Error Handling**: Common errors and solutions

## Core Coordination Tools

### Swarm Management

#### `swarm_init`
**Purpose**: Initialize coordination topology for multi-agent workflows

**Parameters**:
```typescript
interface SwarmInitParams {
  topology: "mesh" | "hierarchical" | "adaptive" | "collective-intelligence";
  maxAgents: number; // Default: 6, Max: 15
  coordinationPattern?: string;
  memoryConfig?: {
    enabled: boolean;
    persistence: boolean;
    neuralTraining: boolean;
  };
  performanceConfig?: {
    benchmarkEnabled: boolean;
    optimizationEnabled: boolean;
    monitoringEnabled: boolean;
  };
}
```

**Returns**:
```typescript
interface SwarmInitResult {
  swarmId: string;
  topology: string;
  maxAgents: number;
  status: "initialized" | "failed";
  coordinationEndpoints: string[];
  memoryEndpoints: string[];
  performanceEndpoints: string[];
}
```

**Dependencies**: None
**Side Effects**: Creates coordination infrastructure, initializes memory system
**Examples**:
```javascript
// Basic mesh topology
const result = await mcp__claude-flow__swarm_init({
  topology: "mesh",
  maxAgents: 6
});

// Advanced adaptive topology with neural training
const result = await mcp__claude-flow__swarm_init({
  topology: "adaptive",
  maxAgents: 10,
  memoryConfig: {
    enabled: true,
    persistence: true,
    neuralTraining: true
  }
});
```

#### `swarm_scale`
**Purpose**: Dynamically scale swarm size based on workload

**Parameters**:
```typescript
interface SwarmScaleParams {
  swarmId: string;
  targetAgents: number;
  scalingStrategy: "immediate" | "gradual" | "adaptive";
  preserveState?: boolean;
}
```

**Returns**:
```typescript
interface SwarmScaleResult {
  swarmId: string;
  previousAgents: number;
  currentAgents: number;
  scalingStatus: "completed" | "in-progress" | "failed";
  affectedAgents: string[];
}
```

#### `swarm_status`
**Purpose**: Monitor swarm health and operational status

**Parameters**:
```typescript
interface SwarmStatusParams {
  swarmId: string;
  includeMetrics?: boolean;
  includeHealth?: boolean;
  includePerformance?: boolean;
}
```

**Returns**:
```typescript
interface SwarmStatusResult {
  swarmId: string;
  status: "healthy" | "degraded" | "critical" | "unknown";
  agents: {
    total: number;
    active: number;
    idle: number;
    failed: number;
  };
  metrics?: {
    cpuUsage: number;
    memoryUsage: number;
    networkLatency: number;
    taskThroughput: number;
  };
  health?: {
    lastHealthCheck: string;
    issues: string[];
    recommendations: string[];
  };
}
```

### Agent Management

#### `agent_spawn`
**Purpose**: Define and spawn agent types for coordination

**Parameters**:
```typescript
interface AgentSpawnParams {
  type: string; // Agent type identifier
  capabilities: string[]; // Array of capabilities
  memory?: {
    enabled: boolean;
    key: string;
    ttl?: number;
  };
  coordination?: {
    hooks: boolean;
    notifications: boolean;
    metrics: boolean;
  };
  configuration?: Record<string, any>;
}
```

**Returns**:
```typescript
interface AgentSpawnResult {
  agentId: string;
  type: string;
  capabilities: string[];
  status: "spawned" | "failed";
  coordinationEndpoints: string[];
  memoryEndpoints: string[];
}
```

**Dependencies**: `swarm_init`
**Side Effects**: Registers agent type, creates coordination endpoints

#### `agent_list`
**Purpose**: List all active agents in the swarm

**Parameters**:
```typescript
interface AgentListParams {
  swarmId: string;
  filter?: {
    type?: string;
    status?: "active" | "idle" | "failed";
    capabilities?: string[];
  };
  includeMetrics?: boolean;
}
```

**Returns**:
```typescript
interface AgentListResult {
  agents: Array<{
    agentId: string;
    type: string;
    status: string;
    capabilities: string[];
    metrics?: {
      tasksCompleted: number;
      averageExecutionTime: number;
      successRate: number;
    };
  }>;
  total: number;
}
```

### Task Orchestration

#### `task_orchestrate`
**Purpose**: Orchestrate high-level workflows across multiple agents

**Parameters**:
```typescript
interface TaskOrchestrateParams {
  workflow: {
    name: string;
    description: string;
    steps: Array<{
      id: string;
      agentType: string;
      task: string;
      dependencies?: string[];
      timeout?: number;
    }>;
  };
  agents: Array<{
    agentId: string;
    agentType: string;
  }>;
  executionConfig?: {
    parallel: boolean;
    retryPolicy: {
      maxRetries: number;
      backoffStrategy: "linear" | "exponential";
    };
    monitoring: boolean;
  };
}
```

**Returns**:
```typescript
interface TaskOrchestrateResult {
  taskId: string;
  workflow: string;
  status: "created" | "running" | "completed" | "failed";
  executionPlan: Array<{
    stepId: string;
    agentId: string;
    status: string;
    estimatedDuration: number;
  }>;
  monitoringEndpoints: string[];
}
```

**Dependencies**: `agent_spawn`
**Side Effects**: Creates task execution plan, starts workflow execution

## Memory & Neural Tools

### Memory Management

#### `memory_store`
**Purpose**: Store cross-session data for persistence and sharing

**Parameters**:
```typescript
interface MemoryStoreParams {
  key: string; // Memory key (e.g., "swarm/agent/step")
  data: any; // Data to store
  ttl?: number; // Time-to-live in seconds
  metadata?: {
    tags: string[];
    description: string;
    version: string;
  };
}
```

**Returns**:
```typescript
interface MemoryStoreResult {
  key: string;
  stored: boolean;
  size: number; // Bytes stored
  expiresAt?: string; // ISO timestamp
}
```

**Dependencies**: None
**Side Effects**: Persists data across sessions

#### `memory_retrieve`
**Purpose**: Retrieve stored data from memory

**Parameters**:
```typescript
interface MemoryRetrieveParams {
  key: string;
  includeMetadata?: boolean;
}
```

**Returns**:
```typescript
interface MemoryRetrieveResult {
  key: string;
  data: any;
  metadata?: {
    storedAt: string;
    tags: string[];
    description: string;
    version: string;
  };
  found: boolean;
}
```

#### `memory_usage`
**Purpose**: Monitor memory consumption and usage patterns

**Parameters**:
```typescript
interface MemoryUsageParams {
  swarmId?: string;
  includeBreakdown?: boolean;
}
```

**Returns**:
```typescript
interface MemoryUsageResult {
  totalUsage: number; // Bytes
  usageByCategory: {
    coordination: number;
    neural: number;
    session: number;
    cache: number;
  };
  topKeys: Array<{
    key: string;
    size: number;
    accessCount: number;
  }>;
  recommendations: string[];
}
```

### Neural AI Tools

#### `neural_train`
**Purpose**: Train neural patterns from successful executions

**Parameters**:
```typescript
interface NeuralTrainParams {
  patterns: Array<{
    input: any;
    output: any;
    success: boolean;
    context: any;
  }>;
  trainingConfig?: {
    algorithm: "reinforcement" | "supervised" | "unsupervised";
    learningRate: number;
    epochs: number;
    validationSplit: number;
  };
  targetModel?: string;
}
```

**Returns**:
```typescript
interface NeuralTrainResult {
  modelId: string;
  trainingStatus: "completed" | "failed" | "in-progress";
  accuracy: number;
  loss: number;
  epochsCompleted: number;
  patternsProcessed: number;
}
```

**Dependencies**: `memory_store`
**Side Effects**: Updates neural models, stores training data

#### `neural_patterns`
**Purpose**: Access and query learned patterns

**Parameters**:
```typescript
interface NeuralPatternsParams {
  query: any; // Input to match against patterns
  modelId?: string;
  topK?: number; // Number of top patterns to return
  threshold?: number; // Minimum confidence threshold
}
```

**Returns**:
```typescript
interface NeuralPatternsResult {
  patterns: Array<{
    pattern: any;
    confidence: number;
    context: any;
    metadata: any;
  }>;
  modelId: string;
  queryProcessed: boolean;
}
```

## GitHub Integration Tools

### Repository Management

#### `github_repo_analyze`
**Purpose**: Analyze repository structure and characteristics

**Parameters**:
```typescript
interface GitHubRepoAnalyzeParams {
  repo: string; // "owner/repo" format
  analysisType: "structure" | "dependencies" | "patterns" | "comprehensive";
  depth?: number; // Analysis depth (1-5)
  includeMetrics?: boolean;
}
```

**Returns**:
```typescript
interface GitHubRepoAnalyzeResult {
  repo: string;
  analysis: {
    structure: {
      languages: string[];
      frameworks: string[];
      architecture: string;
      complexity: number;
    };
    dependencies?: {
      direct: string[];
      transitive: string[];
      vulnerabilities: string[];
    };
    patterns?: {
      designPatterns: string[];
      antiPatterns: string[];
      codeSmells: string[];
    };
    metrics?: {
      linesOfCode: number;
      cyclomaticComplexity: number;
      testCoverage: number;
      maintainabilityIndex: number;
    };
  };
  recommendations: string[];
}
```

**Dependencies**: GitHub API access
**Side Effects**: None

#### `github_pr_manage`
**Purpose**: Manage pull requests programmatically

**Parameters**:
```typescript
interface GitHubPRManageParams {
  action: "create" | "update" | "merge" | "close" | "review";
  repo: string;
  pr?: number; // PR number for update/merge/close actions
  data?: {
    title: string;
    body: string;
    head: string;
    base: string;
    labels?: string[];
    reviewers?: string[];
  };
}
```

**Returns**:
```typescript
interface GitHubPRManageResult {
  action: string;
  prNumber?: number;
  status: "success" | "failed";
  url?: string;
  message?: string;
}
```

**Dependencies**: GitHub API access
**Side Effects**: Modifies repository state

## System & Performance Tools

### Benchmarking

#### `benchmark_run`
**Purpose**: Execute performance benchmarks

**Parameters**:
```typescript
interface BenchmarkRunParams {
  benchmarkType: "execution" | "memory" | "network" | "comprehensive";
  configuration: {
    iterations: number;
    warmupRounds: number;
    timeout: number;
  };
  target?: {
    swarmId?: string;
    agentType?: string;
    taskType?: string;
  };
}
```

**Returns**:
```typescript
interface BenchmarkRunResult {
  benchmarkId: string;
  type: string;
  results: {
    averageExecutionTime: number;
    memoryUsage: number;
    throughput: number;
    errorRate: number;
  };
  metrics: Array<{
    iteration: number;
    executionTime: number;
    memoryUsage: number;
    success: boolean;
  }>;
  recommendations: string[];
}
```

### Monitoring

#### `system_monitor`
**Purpose**: Monitor system resources and health

**Parameters**:
```typescript
interface SystemMonitorParams {
  metrics: string[]; // ["cpu", "memory", "network", "disk"]
  interval?: number; // Monitoring interval in seconds
  duration?: number; // Total monitoring duration
}
```

**Returns**:
```typescript
interface SystemMonitorResult {
  monitoringId: string;
  metrics: {
    cpu: {
      usage: number;
      load: number[];
    };
    memory: {
      used: number;
      total: number;
      available: number;
    };
    network: {
      bytesIn: number;
      bytesOut: number;
      connections: number;
    };
    disk: {
      used: number;
      total: number;
      iops: number;
    };
  };
  timestamp: string;
}
```

## Error Handling

### Common Error Types

#### `SwarmNotInitializedError`
**Code**: `SWARM_NOT_INITIALIZED`
**Message**: "Swarm must be initialized before performing this operation"
**Solution**: Call `swarm_init` first

#### `AgentNotFoundError`
**Code**: `AGENT_NOT_FOUND`
**Message**: "Agent with ID {agentId} not found"
**Solution**: Verify agent exists with `agent_list`

#### `MemoryKeyNotFoundError`
**Code**: `MEMORY_KEY_NOT_FOUND`
**Message**: "Memory key {key} not found"
**Solution**: Check key exists with `memory_usage`

#### `GitHubAPIError`
**Code**: `GITHUB_API_ERROR`
**Message**: "GitHub API request failed: {message}"
**Solution**: Check authentication and API limits

### Error Response Format

```typescript
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    requestId: string;
  };
}
```

## Usage Patterns

### Basic Workflow Pattern
```javascript
// 1. Initialize swarm
const swarm = await mcp__claude-flow__swarm_init({
  topology: "mesh",
  maxAgents: 6
});

// 2. Spawn agents
const agent1 = await mcp__claude-flow__agent_spawn({
  type: "coder",
  capabilities: ["javascript", "typescript", "react"]
});

const agent2 = await mcp__claude-flow__agent_spawn({
  type: "tester",
  capabilities: ["jest", "testing", "qa"]
});

// 3. Orchestrate tasks
const task = await mcp__claude-flow__task_orchestrate({
  workflow: {
    name: "full-stack-development",
    steps: [
      { id: "code", agentType: "coder", task: "Implement features" },
      { id: "test", agentType: "tester", task: "Write tests", dependencies: ["code"] }
    ]
  },
  agents: [agent1, agent2]
});

// 4. Monitor progress
const status = await mcp__claude-flow__swarm_status({
  swarmId: swarm.swarmId,
  includeMetrics: true
});
```

### Advanced Neural Pattern Pattern
```javascript
// 1. Store successful patterns
await mcp__claude-flow__memory_store({
  key: "successful/patterns/frontend",
  data: {
    patterns: ["component-based", "hooks", "state-management"],
    success: true,
    context: "react-development"
  }
});

// 2. Train neural model
const training = await mcp__claude-flow__neural_train({
  patterns: [
    {
      input: "react-component",
      output: "functional-component-with-hooks",
      success: true,
      context: "modern-react"
    }
  ],
  trainingConfig: {
    algorithm: "reinforcement",
    learningRate: 0.01,
    epochs: 100
  }
});

// 3. Query patterns
const patterns = await mcp__claude-flow__neural_patterns({
  query: "react-component",
  topK: 5,
  threshold: 0.8
});
```