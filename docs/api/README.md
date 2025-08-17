# API Reference

Comprehensive programmatic API documentation for Claude-Flow's multi-agent orchestration system.

## Overview

Claude-Flow provides a rich TypeScript/JavaScript API for programmatic control of the multi-agent system. This API enables deep integration with existing applications and custom workflow automation.

## Installation and Setup

### Package Installation

```bash
# Install Claude-Flow as a dependency
npm install claude-flow

# Or for Deno
import { ClaudeFlow } from 'https://deno.land/x/claude_flow@latest/mod.ts';
```

### Basic Initialization

```typescript
import { ClaudeFlow, ClaudeFlowConfig } from 'claude-flow';

// Basic configuration
const config: ClaudeFlowConfig = {
  orchestrator: {
    maxConcurrentAgents: 10,
    taskQueueSize: 100
  },
  memory: {
    backend: 'sqlite',
    cacheSizeMB: 100
  },
  terminal: {
    type: 'auto',
    poolSize: 5
  }
};

// Create and start Claude-Flow instance
const claudeFlow = new ClaudeFlow(config);
await claudeFlow.initialize();
```

## Core API Classes

### ClaudeFlow (Main Orchestrator)

The primary class for orchestrating the multi-agent system.

```typescript
class ClaudeFlow {
  constructor(config?: ClaudeFlowConfig)
  
  // Lifecycle management
  async initialize(): Promise<void>
  async start(): Promise<void>
  async stop(graceful?: boolean): Promise<void>
  async restart(): Promise<void>
  
  // Agent management
  async spawnAgent(config: AgentConfig): Promise<Agent>
  async getAgent(id: string): Promise<Agent | null>
  async listAgents(filter?: AgentFilter): Promise<Agent[]>
  async terminateAgent(id: string, force?: boolean): Promise<boolean>
  
  // Task management
  async createTask(config: TaskConfig): Promise<Task>
  async getTask(id: string): Promise<Task | null>
  async listTasks(filter?: TaskFilter): Promise<Task[]>
  async cancelTask(id: string): Promise<boolean>
  async waitForCompletion(taskId: string, timeout?: number): Promise<TaskResult>
  
  // Workflow management
  async executeWorkflow(workflow: WorkflowDefinition): Promise<WorkflowExecution>
  async getWorkflow(id: string): Promise<WorkflowExecution | null>
  async listWorkflows(filter?: WorkflowFilter): Promise<WorkflowExecution[]>
  
  // Memory operations
  async storeMemory(item: MemoryItem): Promise<string>
  async retrieveMemory(id: string): Promise<MemoryItem | null>
  async queryMemory(query: MemoryQuery): Promise<MemoryItem[]>
  async searchMemory(text: string, options?: SearchOptions): Promise<SearchResult[]>
  
  // System operations
  async getStatus(): Promise<SystemStatus>
  async getMetrics(): Promise<SystemMetrics>
  async exportDiagnostics(): Promise<DiagnosticReport>
}
```

### Agent Management API

```typescript
interface AgentConfig {
  type: 'researcher' | 'analyst' | 'implementer' | 'coordinator' | 'custom';
  name: string;
  description?: string;
  capabilities?: string[];
  memoryNamespace?: string;
  maxConcurrentTasks?: number;
  timeout?: number;
  config?: Record<string, any>;
}

interface Agent {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly status: AgentStatus;
  readonly capabilities: string[];
  readonly currentTasks: Task[];
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  
  // Agent operations
  async assignTask(task: Task): Promise<void>
  async executeTask(task: Task): Promise<TaskResult>
  async getMemory(query?: MemoryQuery): Promise<MemoryItem[]>
  async storeMemory(item: MemoryItem): Promise<string>
  async sendMessage(targetAgentId: string, message: Message): Promise<void>
  async getMetrics(): Promise<AgentMetrics>
  async terminate(force?: boolean): Promise<void>
}

type AgentStatus = 'initializing' | 'idle' | 'busy' | 'overloaded' | 'error' | 'terminated';

interface AgentMetrics {
  tasksCompleted: number;
  tasksSuccessful: number;
  tasksFailed: number;
  averageTaskTime: number;
  memoryUsage: number;
  cpuUsage: number;
  uptime: number;
}
```

### Task Management API

```typescript
interface TaskConfig {
  type: string;
  description: string;
  assignTo?: string;
  priority?: TaskPriority;
  timeout?: number;
  retryCount?: number;
  dependencies?: string[];
  metadata?: Record<string, any>;
  input?: any;
  outputDir?: string;
}

type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

interface Task {
  readonly id: string;
  readonly type: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly assignedTo?: string;
  readonly dependencies: string[];
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly result?: TaskResult;
  
  // Task operations
  async cancel(): Promise<boolean>
  async retry(): Promise<void>
  async updatePriority(priority: TaskPriority): Promise<void>
  async addDependency(taskId: string): Promise<void>
  async removeDependency(taskId: string): Promise<void>
  async getProgress(): Promise<TaskProgress>
  async waitForCompletion(timeout?: number): Promise<TaskResult>
}

type TaskStatus = 'pending' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled';

interface TaskResult {
  success: boolean;
  data?: any;
  error?: Error;
  metadata: {
    executionTime: number;
    agentId: string;
    timestamp: Date;
  };
}
```

### Memory System API

```typescript
interface MemoryManager {
  // Storage operations
  async store(item: Partial<MemoryItem>): Promise<MemoryItem>
  async retrieve(id: string): Promise<MemoryItem | null>
  async update(id: string, updates: Partial<MemoryItem>): Promise<MemoryItem>
  async delete(id: string): Promise<boolean>
  
  // Query operations
  async query(query: MemoryQuery): Promise<MemoryItem[]>
  async fullTextSearch(text: string, options?: SearchOptions): Promise<MemoryItem[]>
  async vectorSearch(options: VectorSearchOptions): Promise<SimilarityResult[]>
  
  // Batch operations
  async storeBatch(items: Partial<MemoryItem>[]): Promise<MemoryItem[]>
  async retrieveBatch(ids: string[]): Promise<(MemoryItem | null)[]>
  async deleteBatch(ids: string[]): Promise<boolean[]>
  
  // Management operations
  async getStatistics(): Promise<MemoryStatistics>
  async optimize(): Promise<void>
  async backup(destination: string): Promise<void>
  async restore(source: string): Promise<void>
}

interface MemoryItem {
  id: string;
  category: string;
  content: string;
  tags: string[];
  namespace?: string;
  metadata?: Record<string, any>;
  embedding?: number[];
  version: number;
  vectorClock: VectorClock;
  created: number;
  updated: number;
  checksum: string;
}

interface MemoryQuery {
  categories?: string[];
  tags?: string[];
  tagsAny?: string[];
  fullText?: string;
  namespace?: string;
  namespaces?: string[];
  dateRange?: {
    start?: Date;
    end?: Date;
    field: 'created' | 'updated';
  };
  metadata?: Record<string, any>;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
```

### Terminal Integration API

```typescript
interface TerminalManager {
  // Terminal creation and management
  async createTerminal(config?: TerminalConfig): Promise<Terminal>
  async getTerminal(id: string): Promise<Terminal | null>
  async listTerminals(): Promise<Terminal[]>
  async destroyTerminal(id: string): Promise<boolean>
  
  // Pool management
  async getPoolStatus(): Promise<PoolStatus>
  async resizePool(size: number): Promise<void>
  async optimizePool(): Promise<void>
  
  // Session management
  async createSession(name: string, config?: SessionConfig): Promise<Session>
  async getSession(name: string): Promise<Session | null>
  async listSessions(): Promise<Session[]>
  async saveSession(name: string): Promise<void>
  async restoreSession(name: string): Promise<void>
}

interface Terminal {
  readonly id: string;
  readonly type: TerminalType;
  readonly status: TerminalStatus;
  readonly shell: string;
  readonly workingDirectory: string;
  readonly environment: Record<string, string>;
  
  // Command execution
  async execute(command: string, options?: ExecutionOptions): Promise<ExecutionResult>
  async executeBatch(commands: string[], options?: BatchOptions): Promise<ExecutionResult[]>
  async executeStream(command: string, options?: StreamOptions): Promise<ExecutionStream>
  
  // State management
  async getWorkingDirectory(): Promise<string>
  async changeDirectory(path: string): Promise<void>
  async setEnvironment(env: Record<string, string>): Promise<void>
  async getHistory(): Promise<string[]>
  
  // Lifecycle
  async reset(): Promise<void>
  async dispose(): Promise<void>
}

type TerminalType = 'vscode' | 'native' | 'ssh' | 'container';
type TerminalStatus = 'initializing' | 'ready' | 'busy' | 'error' | 'disposed';
```

### MCP Integration API

```typescript
interface MCPServer {
  // Server management
  async start(): Promise<void>
  async stop(): Promise<void>
  async restart(): Promise<void>
  async getStatus(): Promise<MCPStatus>
  
  // Tool management
  async registerTool(tool: Tool): Promise<void>
  async unregisterTool(name: string): Promise<boolean>
  async listTools(): Promise<ToolInfo[]>
  async getTool(name: string): Promise<Tool | null>
  
  // Tool execution
  async executeTool(name: string, input: any, options?: ToolOptions): Promise<ToolResult>
  async executeToolAsync(name: string, input: any): Promise<string>
  async getExecutionResult(executionId: string): Promise<ToolResult>
  async getExecutionStatus(executionId: string): Promise<ExecutionStatus>
  
  // Client management
  async listClients(): Promise<MCPClient[]>
  async authenticateClient(credentials: any): Promise<string>
  async revokeClient(clientId: string): Promise<boolean>
}

interface Tool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  
  execute(input: any, context?: ToolContext): Promise<ToolResult>;
}

interface ToolResult {
  success: boolean;
  data?: any;
  error?: ToolError;
  metadata?: Record<string, any>;
}
```

## Event System API

### Event Subscription

```typescript
interface EventEmitter {
  // Event subscription
  on<T = any>(event: string, listener: (data: T) => void): void
  once<T = any>(event: string, listener: (data: T) => void): void
  off(event: string, listener?: Function): void
  
  // Event emission
  emit<T = any>(event: string, data?: T): void
  
  // Event utilities
  listenerCount(event: string): number
  eventNames(): string[]
}

// System events
interface SystemEvents {
  'system.started': { timestamp: Date };
  'system.stopped': { timestamp: Date, reason?: string };
  'system.error': { error: Error, component: string };
  
  'agent.spawned': { agent: Agent };
  'agent.terminated': { agentId: string, reason?: string };
  'agent.error': { agentId: string, error: Error };
  
  'task.created': { task: Task };
  'task.assigned': { taskId: string, agentId: string };
  'task.started': { taskId: string, agentId: string };
  'task.completed': { taskId: string, result: TaskResult };
  'task.failed': { taskId: string, error: Error };
  'task.cancelled': { taskId: string, reason?: string };
  
  'memory.stored': { item: MemoryItem };
  'memory.updated': { itemId: string, changes: Partial<MemoryItem> };
  'memory.deleted': { itemId: string };
  
  'terminal.created': { terminal: Terminal };
  'terminal.command.executed': { terminalId: string, command: string, result: ExecutionResult };
  'terminal.error': { terminalId: string, error: Error };
}
```

### Event Usage Examples

```typescript
// Subscribe to system events
claudeFlow.on('agent.spawned', (event) => {
  console.log(`New agent spawned: ${event.agent.name}`);
});

claudeFlow.on('task.completed', (event) => {
  console.log(`Task ${event.taskId} completed successfully`);
  // Process task results
});

claudeFlow.on('system.error', (event) => {
  console.error(`System error in ${event.component}:`, event.error);
  // Handle system errors
});

// One-time event subscription
claudeFlow.once('system.started', () => {
  console.log('Claude-Flow system is ready');
});
```

## Workflow API

### Workflow Definition

```typescript
interface WorkflowDefinition {
  name: string;
  description?: string;
  version?: string;
  parameters?: Record<string, ParameterDefinition>;
  tasks: TaskDefinition[];
  completion?: CompletionCriteria;
  errorHandling?: ErrorHandlingStrategy;
}

interface TaskDefinition {
  id: string;
  type: string;
  description: string;
  dependencies?: string[];
  assignTo?: string;
  timeout?: number;
  retry?: RetryConfig;
  conditions?: ConditionalConfig[];
  parallel?: boolean;
  parameters?: Record<string, any>;
}

interface WorkflowExecution {
  readonly id: string;
  readonly definition: WorkflowDefinition;
  readonly status: WorkflowStatus;
  readonly progress: number;
  readonly currentTasks: string[];
  readonly completedTasks: string[];
  readonly failedTasks: string[];
  readonly results: TaskResult[];
  readonly startedAt: Date;
  readonly completedAt?: Date;
  
  // Workflow control
  async pause(): Promise<void>
  async resume(): Promise<void>
  async cancel(): Promise<void>
  async getProgress(): Promise<WorkflowProgress>
  async waitForCompletion(timeout?: number): Promise<WorkflowResult>
}

type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
```

## Configuration API

### Configuration Management

```typescript
interface ConfigManager {
  // Configuration loading
  async load(path?: string): Promise<ClaudeFlowConfig>
  async loadFromString(config: string): Promise<ClaudeFlowConfig>
  async loadDefault(): Promise<ClaudeFlowConfig>
  
  // Configuration manipulation
  get<T = any>(path: string): T
  set<T = any>(path: string, value: T): void
  merge(config: Partial<ClaudeFlowConfig>): void
  
  // Configuration persistence
  async save(path?: string): Promise<void>
  async export(format?: 'json' | 'yaml'): Promise<string>
  
  // Configuration validation
  async validate(): Promise<ValidationResult>
  async validateSection(section: string): Promise<ValidationResult>
  
  // Profile management
  async loadProfile(name: string): Promise<void>
  async saveProfile(name: string): Promise<void>
  async listProfiles(): Promise<string[]>
}

interface ClaudeFlowConfig {
  orchestrator?: OrchestratorConfig;
  agents?: AgentsConfig;
  tasks?: TasksConfig;
  memory?: MemoryConfig;
  terminal?: TerminalConfig;
  mcp?: MCPConfig;
  security?: SecurityConfig;
  logging?: LoggingConfig;
  monitoring?: MonitoringConfig;
}
```

## Monitoring and Metrics API

### Performance Monitoring

```typescript
interface MetricsCollector {
  // Metrics collection
  async collect(): Promise<SystemMetrics>
  async getAgentMetrics(agentId?: string): Promise<AgentMetrics | AgentMetrics[]>
  async getTaskMetrics(timeframe?: TimeFrame): Promise<TaskMetrics>
  async getMemoryMetrics(): Promise<MemoryMetrics>
  async getTerminalMetrics(): Promise<TerminalMetrics>
  
  // Historical data
  async getHistoricalMetrics(timeframe: TimeFrame): Promise<HistoricalMetrics>
  async exportMetrics(format: 'json' | 'csv' | 'prometheus'): Promise<string>
  
  // Alerting
  async setAlert(name: string, condition: AlertCondition): Promise<void>
  async removeAlert(name: string): Promise<boolean>
  async listAlerts(): Promise<Alert[]>
}

interface SystemMetrics {
  timestamp: Date;
  system: {
    uptime: number;
    memoryUsage: MemoryUsage;
    cpuUsage: number;
    loadAverage: number[];
  };
  orchestrator: {
    totalAgents: number;
    activeAgents: number;
    totalTasks: number;
    queuedTasks: number;
    completedTasks: number;
    failedTasks: number;
  };
  performance: {
    averageTaskTime: number;
    tasksPerSecond: number;
    memoryThroughput: number;
    terminalUtilization: number;
  };
}
```

## Error Handling API

### Exception Types

```typescript
class ClaudeFlowError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: any,
    public readonly cause?: Error
  )
}

class AgentError extends ClaudeFlowError {
  constructor(
    message: string,
    public readonly agentId: string,
    code?: string,
    details?: any
  )
}

class TaskError extends ClaudeFlowError {
  constructor(
    message: string,
    public readonly taskId: string,
    code?: string,
    details?: any
  )
}

class MemoryError extends ClaudeFlowError {
  constructor(
    message: string,
    public readonly operation: string,
    code?: string,
    details?: any
  )
}

class TerminalError extends ClaudeFlowError {
  constructor(
    message: string,
    public readonly terminalId: string,
    code?: string,
    details?: any
  )
}
```

## Testing Utilities

### Test Helpers

```typescript
interface TestingUtils {
  // Mock implementations
  createMockAgent(config?: Partial<AgentConfig>): MockAgent
  createMockTask(config?: Partial<TaskConfig>): MockTask
  createMockTerminal(config?: Partial<TerminalConfig>): MockTerminal
  
  // Test data generation
  generateTestData(type: 'agents' | 'tasks' | 'memory', count: number): any[]
  createTestWorkflow(complexity?: 'simple' | 'medium' | 'complex'): WorkflowDefinition
  
  // Assertions
  assertAgentState(agent: Agent, expectedState: AgentStatus): void
  assertTaskCompletion(task: Task, timeout?: number): Promise<void>
  assertMemoryConsistency(items: MemoryItem[]): void
  
  // Environment setup
  async setupTestEnvironment(config?: Partial<ClaudeFlowConfig>): Promise<ClaudeFlow>
  async cleanupTestEnvironment(instance: ClaudeFlow): Promise<void>
}
```

## Integration Examples

### Express.js Integration

```typescript
import express from 'express';
import { ClaudeFlow } from 'claude-flow';

const app = express();
const claudeFlow = new ClaudeFlow();

// Middleware to inject Claude-Flow instance
app.use((req, res, next) => {
  req.claudeFlow = claudeFlow;
  next();
});

// API endpoints
app.post('/api/tasks', async (req, res) => {
  try {
    const task = await req.claudeFlow.createTask(req.body);
    res.json({ success: true, taskId: task.id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/tasks/:id', async (req, res) => {
  const task = await req.claudeFlow.getTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  res.json(task);
});

await claudeFlow.start();
app.listen(3000);
```

### React Integration

```typescript
import React, { useEffect, useState } from 'react';
import { ClaudeFlow } from 'claude-flow';

export const ClaudeFlowProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [claudeFlow, setClaudeFlow] = useState<ClaudeFlow | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const initializeClaudeFlow = async () => {
      const instance = new ClaudeFlow({
        // Configuration
      });
      
      await instance.start();
      setClaudeFlow(instance);
      setIsReady(true);
    };

    initializeClaudeFlow();

    return () => {
      claudeFlow?.stop();
    };
  }, []);

  if (!isReady) {
    return <div>Initializing Claude-Flow...</div>;
  }

  return (
    <ClaudeFlowContext.Provider value={claudeFlow}>
      {children}
    </ClaudeFlowContext.Provider>
  );
};

export const useClaudeFlow = () => {
  const context = useContext(ClaudeFlowContext);
  if (!context) {
    throw new Error('useClaudeFlow must be used within ClaudeFlowProvider');
  }
  return context;
};
```

This comprehensive API reference provides complete documentation for programmatic integration with Claude-Flow, enabling developers to build sophisticated multi-agent applications and custom workflows.