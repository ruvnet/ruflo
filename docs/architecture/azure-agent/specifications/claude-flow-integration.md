# Azure Agent - Claude Flow Integration

## Overview
This document defines how the Azure Agent integrates with the Claude Flow orchestration system, including hooks, memory management, swarm coordination, and event handling.

## Integration Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Azure Agent                         │
└─────────────────────┬───────────────────────────────┘
                      │
      ┌───────────────┼───────────────┐
      │               │               │
      ▼               ▼               ▼
┌──────────┐   ┌──────────┐   ┌──────────────┐
│  Hooks   │   │  Memory  │   │    Swarm     │
│  System  │   │  Manager │   │ Coordination │
└────┬─────┘   └────┬─────┘   └──────┬───────┘
     │              │                 │
     └──────────────┴─────────────────┘
                    │
     ┌──────────────▼──────────────┐
     │    Claude Flow Platform      │
     │  • Orchestration             │
     │  • State Management          │
     │  • Agent Coordination        │
     └──────────────────────────────┘
```

## Hook Integration

### Available Hooks

The Azure Agent integrates with Claude Flow hooks at key operation points:

```typescript
enum HookType {
  // Pre-operation hooks
  PRE_TASK = 'pre-task',
  PRE_EDIT = 'pre-edit',

  // Post-operation hooks
  POST_TASK = 'post-task',
  POST_EDIT = 'post-edit',

  // Session hooks
  SESSION_RESTORE = 'session-restore',
  SESSION_END = 'session-end',

  // Notification hooks
  NOTIFY = 'notify'
}
```

### Hook Implementation

```typescript
interface ClaudeFlowHookService {
  // Execute a hook
  executeHook(hook: HookType, data: HookData): Promise<HookResult>;

  // Check if hooks are enabled
  isEnabled(): boolean;

  // Configure hook behavior
  configure(config: HookConfig): void;
}

interface HookData {
  // Common fields
  timestamp: Date;
  agentId: string;
  sessionId?: string;

  // Hook-specific data
  [key: string]: any;
}

interface HookResult {
  success: boolean;
  data?: any;
  error?: string;
  duration: number;
}

class ClaudeFlowHookServiceImpl implements ClaudeFlowHookService {
  private config: HookConfig;
  private enabled: boolean;

  constructor(config: HookConfig) {
    this.config = config;
    this.enabled = config.enabled;
  }

  async executeHook(hook: HookType, data: HookData): Promise<HookResult> {
    if (!this.enabled) {
      return { success: true, duration: 0 };
    }

    // Check if specific hook is enabled
    if (!this.isHookEnabled(hook)) {
      return { success: true, duration: 0 };
    }

    const startTime = Date.now();

    try {
      const result = await this.callClaudeFlowCLI(hook, data);

      return {
        success: true,
        data: result,
        duration: Date.now() - startTime
      };
    } catch (error) {
      // Don't fail operations on hook errors
      console.error(`Hook ${hook} failed:`, error);

      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  private async callClaudeFlowCLI(
    hook: HookType,
    data: HookData
  ): Promise<any> {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);

    // Build command based on hook type
    const command = this.buildHookCommand(hook, data);

    // Execute Claude Flow CLI
    const { stdout, stderr } = await execFileAsync(
      'npx',
      ['claude-flow@alpha', ...command],
      { timeout: 30000 }
    );

    if (stderr) {
      console.warn(`Hook warning: ${stderr}`);
    }

    return stdout ? JSON.parse(stdout) : null;
  }

  private buildHookCommand(hook: HookType, data: HookData): string[] {
    const command = ['hooks'];

    switch (hook) {
      case HookType.PRE_TASK:
        command.push('pre-task');
        if (data.description) {
          command.push('--description', data.description);
        }
        break;

      case HookType.POST_TASK:
        command.push('post-task');
        if (data.taskId) {
          command.push('--task-id', data.taskId);
        }
        break;

      case HookType.PRE_EDIT:
        command.push('pre-edit');
        if (data.file) {
          command.push('--file', data.file);
        }
        break;

      case HookType.POST_EDIT:
        command.push('post-edit');
        if (data.file) {
          command.push('--file', data.file);
        }
        if (data.memoryKey) {
          command.push('--memory-key', data.memoryKey);
        }
        break;

      case HookType.SESSION_RESTORE:
        command.push('session-restore');
        if (data.sessionId) {
          command.push('--session-id', data.sessionId);
        }
        break;

      case HookType.SESSION_END:
        command.push('session-end');
        if (data.exportMetrics) {
          command.push('--export-metrics', 'true');
        }
        break;

      case HookType.NOTIFY:
        command.push('notify');
        if (data.message) {
          command.push('--message', data.message);
        }
        break;
    }

    return command;
  }

  private isHookEnabled(hook: HookType): boolean {
    return this.config.hooks?.[hook] !== false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  configure(config: HookConfig): void {
    this.config = { ...this.config, ...config };
    this.enabled = config.enabled;
  }
}
```

### Hook Usage Patterns

#### 1. Operation Lifecycle Hooks

```typescript
class AzureAgent {
  async deploy(config: DeploymentConfig): Promise<DeploymentResult> {
    // Pre-task hook
    await this.hooks.executeHook(HookType.PRE_TASK, {
      description: `Deploy ${config.type} to ${config.location}`,
      operation: 'deploy',
      config
    });

    try {
      // Execute deployment
      const result = await this.executeDeployment(config);

      // Post-task hook on success
      await this.hooks.executeHook(HookType.POST_TASK, {
        taskId: result.deploymentId,
        success: true,
        result
      });

      return result;

    } catch (error) {
      // Post-task hook on failure
      await this.hooks.executeHook(HookType.POST_TASK, {
        taskId: config.name,
        success: false,
        error: error.message
      });

      throw error;
    }
  }
}
```

#### 2. File Operation Hooks

```typescript
class ConfigurationManager {
  async saveConfiguration(file: string, config: any): Promise<void> {
    // Pre-edit hook
    await this.hooks.executeHook(HookType.PRE_EDIT, {
      file,
      operation: 'write'
    });

    // Save file
    await fs.writeFile(file, JSON.stringify(config, null, 2));

    // Post-edit hook with memory storage
    await this.hooks.executeHook(HookType.POST_EDIT, {
      file,
      memoryKey: `swarm/azure-agent/config/${path.basename(file)}`,
      content: config
    });
  }
}
```

#### 3. Session Management Hooks

```typescript
class AgentSession {
  async initialize(sessionId: string): Promise<void> {
    // Restore session from Claude Flow memory
    const restored = await this.hooks.executeHook(
      HookType.SESSION_RESTORE,
      { sessionId }
    );

    if (restored.success && restored.data) {
      this.state = restored.data.state;
      this.context = restored.data.context;
    }
  }

  async terminate(): Promise<void> {
    // Export session metrics
    await this.hooks.executeHook(HookType.SESSION_END, {
      sessionId: this.id,
      exportMetrics: true,
      metrics: this.collectMetrics()
    });
  }
}
```

#### 4. Notification Hooks

```typescript
class OperationNotifier {
  async notifyProgress(message: string, data?: any): Promise<void> {
    await this.hooks.executeHook(HookType.NOTIFY, {
      message,
      data,
      level: 'info'
    });
  }

  async notifyError(error: AgentError): Promise<void> {
    await this.hooks.executeHook(HookType.NOTIFY, {
      message: `Error: ${error.message}`,
      error: {
        code: error.code,
        category: error.category,
        severity: error.severity
      },
      level: 'error'
    });
  }
}
```

## Memory Integration

### Memory Service Interface

```typescript
interface ClaudeFlowMemoryService {
  // Store data
  store(key: string, value: any, options?: MemoryOptions): Promise<void>;

  // Retrieve data
  retrieve<T>(key: string): Promise<T | undefined>;

  // Query data
  query(pattern: string, options?: QueryOptions): Promise<MemoryEntry[]>;

  // Delete data
  delete(key: string): Promise<void>;

  // List namespaces
  listNamespaces(): Promise<string[]>;

  // Clear namespace
  clearNamespace(namespace: string): Promise<void>;

  // Export memory
  export(namespace?: string): Promise<MemoryExport>;
}

interface MemoryOptions {
  namespace?: string;
  ttl?: number; // seconds
  tags?: string[];
}

interface QueryOptions {
  namespace?: string;
  limit?: number;
  offset?: number;
}

interface MemoryEntry {
  key: string;
  value: any;
  namespace: string;
  timestamp: Date;
  ttl?: number;
  tags?: string[];
}

interface MemoryExport {
  namespace: string;
  entries: MemoryEntry[];
  exportedAt: Date;
}
```

### Memory Service Implementation

```typescript
class ClaudeFlowMemoryServiceImpl implements ClaudeFlowMemoryService {
  private namespace: string;

  constructor(namespace: string = 'swarm/azure-agent') {
    this.namespace = namespace;
  }

  async store(
    key: string,
    value: any,
    options?: MemoryOptions
  ): Promise<void> {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);

    const namespace = options?.namespace || this.namespace;
    const valueStr = JSON.stringify(value);

    await execFileAsync('npx', [
      'claude-flow@alpha',
      'memory',
      'store',
      key,
      valueStr,
      '--namespace',
      namespace
    ]);
  }

  async retrieve<T>(key: string): Promise<T | undefined> {
    try {
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      const execFileAsync = promisify(execFile);

      const { stdout } = await execFileAsync('npx', [
        'claude-flow@alpha',
        'memory',
        'query',
        key,
        '--namespace',
        this.namespace
      ]);

      if (!stdout || stdout.includes('No results found')) {
        return undefined;
      }

      // Parse memory output
      const entries = this.parseMemoryOutput(stdout);
      if (entries.length === 0) {
        return undefined;
      }

      return entries[0].value as T;

    } catch (error) {
      console.error(`Failed to retrieve memory key ${key}:`, error);
      return undefined;
    }
  }

  async query(
    pattern: string,
    options?: QueryOptions
  ): Promise<MemoryEntry[]> {
    try {
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      const execFileAsync = promisify(execFile);

      const namespace = options?.namespace || this.namespace;

      const { stdout } = await execFileAsync('npx', [
        'claude-flow@alpha',
        'memory',
        'query',
        pattern,
        '--namespace',
        namespace
      ]);

      if (!stdout || stdout.includes('No results found')) {
        return [];
      }

      return this.parseMemoryOutput(stdout);

    } catch (error) {
      console.error(`Failed to query memory with pattern ${pattern}:`, error);
      return [];
    }
  }

  async delete(key: string): Promise<void> {
    // Implementation depends on Claude Flow CLI support
    // For now, store empty value with very short TTL
    await this.store(key, null, { ttl: 1 });
  }

  async listNamespaces(): Promise<string[]> {
    try {
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      const execFileAsync = promisify(execFile);

      const { stdout } = await execFileAsync('npx', [
        'claude-flow@alpha',
        'memory',
        'list'
      ]);

      // Parse namespace list from output
      return this.parseNamespaceList(stdout);

    } catch (error) {
      console.error('Failed to list namespaces:', error);
      return [];
    }
  }

  async clearNamespace(namespace: string): Promise<void> {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);

    await execFileAsync('npx', [
      'claude-flow@alpha',
      'memory',
      'clear',
      '--namespace',
      namespace
    ]);
  }

  async export(namespace?: string): Promise<MemoryExport> {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);

    const ns = namespace || this.namespace;
    const filename = `memory-export-${Date.now()}.json`;

    await execFileAsync('npx', [
      'claude-flow@alpha',
      'memory',
      'export',
      filename,
      '--namespace',
      ns
    ]);

    // Read exported file
    const fs = require('fs').promises;
    const content = await fs.readFile(filename, 'utf-8');
    const data = JSON.parse(content);

    // Clean up export file
    await fs.unlink(filename);

    return {
      namespace: ns,
      entries: data.entries || [],
      exportedAt: new Date()
    };
  }

  private parseMemoryOutput(output: string): MemoryEntry[] {
    // Parse Claude Flow memory output format
    // This is a placeholder - actual parsing depends on CLI output format
    const entries: MemoryEntry[] = [];

    try {
      // Try parsing as JSON
      const data = JSON.parse(output);
      if (Array.isArray(data)) {
        return data;
      } else if (data.entries) {
        return data.entries;
      }
    } catch {
      // Not JSON, parse text format
      // Implementation depends on actual CLI output format
    }

    return entries;
  }

  private parseNamespaceList(output: string): string[] {
    // Parse namespace list from CLI output
    const namespaces: string[] = [];

    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes(':')) {
        const [namespace] = line.split(':');
        namespaces.push(namespace.trim());
      }
    }

    return namespaces;
  }
}
```

### Memory Usage Patterns

#### 1. Operation Context Storage

```typescript
class OperationContextManager {
  constructor(private memory: ClaudeFlowMemoryService) {}

  async saveContext(operationId: string, context: OperationContext): Promise<void> {
    await this.memory.store(
      `operation/${operationId}`,
      context,
      { ttl: 86400 } // 24 hours
    );
  }

  async loadContext(operationId: string): Promise<OperationContext | undefined> {
    return await this.memory.retrieve(`operation/${operationId}`);
  }
}
```

#### 2. Resource State Caching

```typescript
class ResourceStateCache {
  constructor(private memory: ClaudeFlowMemoryService) {}

  async cacheResourceState(
    resourceId: string,
    state: ResourceState
  ): Promise<void> {
    await this.memory.store(
      `resource/${resourceId}`,
      state,
      { ttl: 300 } // 5 minutes
    );
  }

  async getResourceState(
    resourceId: string
  ): Promise<ResourceState | undefined> {
    return await this.memory.retrieve(`resource/${resourceId}`);
  }
}
```

#### 3. Agent Coordination Data

```typescript
class CoordinationStore {
  constructor(private memory: ClaudeFlowMemoryService) {}

  async publishAgentStatus(agentId: string, status: AgentStatus): Promise<void> {
    await this.memory.store(
      `agent/${agentId}/status`,
      status,
      { ttl: 60 } // 1 minute
    );
  }

  async queryActiveAgents(): Promise<AgentStatus[]> {
    const entries = await this.memory.query('agent/*/status');
    return entries.map(e => e.value);
  }
}
```

#### 4. Workflow State Persistence

```typescript
class WorkflowStateManager {
  constructor(private memory: ClaudeFlowMemoryService) {}

  async saveWorkflowState(
    workflowId: string,
    state: WorkflowState
  ): Promise<void> {
    await this.memory.store(`workflow/${workflowId}`, state);
  }

  async resumeWorkflow(
    workflowId: string
  ): Promise<WorkflowState | undefined> {
    return await this.memory.retrieve(`workflow/${workflowId}`);
  }
}
```

## Swarm Coordination

### Swarm Integration Interface

```typescript
interface ClaudeFlowSwarmService {
  // Initialize swarm
  initialize(topology: SwarmTopology, config: SwarmConfig): Promise<void>;

  // Register agent
  registerAgent(agentId: string, capabilities: AgentCapabilities): Promise<void>;

  // Get agent assignments
  getAssignments(agentId: string): Promise<TaskAssignment[]>;

  // Report task progress
  reportProgress(taskId: string, progress: TaskProgress): Promise<void>;

  // Coordinate with other agents
  coordinate(message: CoordinationMessage): Promise<CoordinationResponse>;

  // Get swarm status
  getStatus(): Promise<SwarmStatus>;
}

type SwarmTopology = 'mesh' | 'hierarchical' | 'adaptive';

interface SwarmConfig {
  maxAgents?: number;
  coordinationPattern?: string;
  memorySharing?: boolean;
}

interface AgentCapabilities {
  operations: string[];
  resourceTypes: string[];
  regions: string[];
}

interface TaskAssignment {
  taskId: string;
  operation: string;
  parameters: any;
  priority: number;
  deadline?: Date;
}

interface TaskProgress {
  taskId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress: number; // 0-100
  message?: string;
}

interface CoordinationMessage {
  from: string;
  to?: string; // undefined = broadcast
  type: 'request' | 'response' | 'notification';
  content: any;
}

interface CoordinationResponse {
  success: boolean;
  data?: any;
  error?: string;
}

interface SwarmStatus {
  topology: SwarmTopology;
  totalAgents: number;
  activeAgents: number;
  pendingTasks: number;
  completedTasks: number;
}
```

### Swarm Coordination Patterns

#### 1. Task Distribution

```typescript
class TaskDistributor {
  constructor(private swarm: ClaudeFlowSwarmService) {}

  async distributeTasks(tasks: Task[]): Promise<DistributionResult> {
    // Get available agents
    const status = await this.swarm.getStatus();

    // Assign tasks based on agent capabilities
    const assignments: TaskAssignment[] = [];

    for (const task of tasks) {
      const assignment = await this.findBestAgent(task);
      assignments.push(assignment);
    }

    return {
      totalTasks: tasks.length,
      assignedTasks: assignments.length,
      assignments
    };
  }

  private async findBestAgent(task: Task): Promise<TaskAssignment> {
    // Logic to find best agent for task
    // Based on capabilities, current load, etc.
    return {
      taskId: task.id,
      operation: task.operation,
      parameters: task.parameters,
      priority: task.priority || 0
    };
  }
}
```

#### 2. Collaborative Operations

```typescript
class CollaborativeDeployment {
  constructor(
    private swarm: ClaudeFlowSwarmService,
    private agentId: string
  ) {}

  async deployMultiRegion(
    spec: MultiRegionSpec
  ): Promise<DeploymentResult> {
    // Coordinate with other agents for multi-region deployment
    const regions = spec.regions;

    // Broadcast deployment plan
    await this.swarm.coordinate({
      from: this.agentId,
      type: 'notification',
      content: {
        operation: 'multi-region-deploy',
        regions,
        spec
      }
    });

    // Each agent handles their assigned region
    const myRegion = await this.getAssignedRegion(regions);

    // Deploy to assigned region
    const result = await this.deployToRegion(myRegion, spec);

    // Report progress
    await this.swarm.reportProgress(spec.deploymentId, {
      taskId: spec.deploymentId,
      status: 'completed',
      progress: 100,
      message: `Deployed to ${myRegion}`
    });

    return result;
  }
}
```

#### 3. Shared Context

```typescript
class SharedContextManager {
  constructor(
    private memory: ClaudeFlowMemoryService,
    private swarm: ClaudeFlowSwarmService
  ) {}

  async shareContext(key: string, value: any): Promise<void> {
    // Store in shared memory
    await this.memory.store(
      `shared/${key}`,
      value,
      { namespace: 'swarm/shared' }
    );

    // Notify other agents
    await this.swarm.coordinate({
      from: 'context-manager',
      type: 'notification',
      content: {
        event: 'context-updated',
        key
      }
    });
  }

  async getSharedContext(key: string): Promise<any> {
    return await this.memory.retrieve(
      `shared/${key}`,
      { namespace: 'swarm/shared' }
    );
  }
}
```

## Event Handling

### Event System

```typescript
interface EventEmitter {
  // Emit event
  emit(event: string, data: any): void;

  // Subscribe to event
  on(event: string, handler: EventHandler): void;

  // Unsubscribe from event
  off(event: string, handler: EventHandler): void;

  // Subscribe once
  once(event: string, handler: EventHandler): void;
}

type EventHandler = (data: any) => void | Promise<void>;

enum AgentEvent {
  // Operation events
  OPERATION_STARTED = 'operation.started',
  OPERATION_COMPLETED = 'operation.completed',
  OPERATION_FAILED = 'operation.failed',

  // Resource events
  RESOURCE_CREATED = 'resource.created',
  RESOURCE_UPDATED = 'resource.updated',
  RESOURCE_DELETED = 'resource.deleted',

  // Error events
  ERROR_OCCURRED = 'error.occurred',
  ERROR_RECOVERED = 'error.recovered',

  // Coordination events
  TASK_ASSIGNED = 'task.assigned',
  TASK_COMPLETED = 'task.completed',
  AGENT_JOINED = 'agent.joined',
  AGENT_LEFT = 'agent.left'
}
```

### Event-Driven Integration

```typescript
class EventBridge {
  constructor(
    private events: EventEmitter,
    private hooks: ClaudeFlowHookService,
    private memory: ClaudeFlowMemoryService
  ) {
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Forward important events to Claude Flow
    this.events.on(AgentEvent.OPERATION_STARTED, async (data) => {
      await this.hooks.executeHook(HookType.PRE_TASK, {
        description: data.operation,
        ...data
      });
    });

    this.events.on(AgentEvent.OPERATION_COMPLETED, async (data) => {
      await this.hooks.executeHook(HookType.POST_TASK, {
        taskId: data.operationId,
        success: true,
        ...data
      });

      // Store result in memory
      await this.memory.store(
        `result/${data.operationId}`,
        data.result
      );
    });

    this.events.on(AgentEvent.ERROR_OCCURRED, async (data) => {
      await this.hooks.executeHook(HookType.NOTIFY, {
        message: `Error: ${data.error.message}`,
        level: 'error',
        ...data
      });
    });

    // Store all events in memory for debugging
    Object.values(AgentEvent).forEach(event => {
      this.events.on(event, async (data) => {
        await this.memory.store(
          `event/${event}/${Date.now()}`,
          data,
          { ttl: 3600 } // 1 hour
        );
      });
    });
  }
}
```

## Integration Configuration

### Configuration Structure

```typescript
interface ClaudeFlowIntegrationConfig {
  // Enable/disable integration
  enabled: boolean;

  // Hooks configuration
  hooks: {
    enabled: boolean;
    preTask: boolean;
    postTask: boolean;
    preEdit: boolean;
    postEdit: boolean;
    sessionRestore: boolean;
    sessionEnd: boolean;
    notify: boolean;
  };

  // Memory configuration
  memory: {
    enabled: boolean;
    namespace: string;
    storeResults: boolean;
    storeErrors: boolean;
    ttl?: number;
  };

  // Swarm configuration
  swarm: {
    enabled: boolean;
    topology?: SwarmTopology;
    role?: string;
    patterns?: string[];
  };

  // Event configuration
  events: {
    enabled: boolean;
    forwardToClaudeFlow: boolean;
    storeInMemory: boolean;
  };
}
```

### Integration Initialization

```typescript
class ClaudeFlowIntegration {
  private hooks: ClaudeFlowHookService;
  private memory: ClaudeFlowMemoryService;
  private swarm?: ClaudeFlowSwarmService;
  private events: EventEmitter;

  async initialize(config: ClaudeFlowIntegrationConfig): Promise<void> {
    if (!config.enabled) {
      return;
    }

    // Initialize hooks
    if (config.hooks.enabled) {
      this.hooks = new ClaudeFlowHookServiceImpl(config.hooks);
    }

    // Initialize memory
    if (config.memory.enabled) {
      this.memory = new ClaudeFlowMemoryServiceImpl(
        config.memory.namespace
      );
    }

    // Initialize swarm coordination
    if (config.swarm.enabled) {
      this.swarm = await this.initializeSwarm(config.swarm);
    }

    // Setup event bridge
    if (config.events.enabled) {
      this.events = new EventEmitter();
      new EventBridge(this.events, this.hooks, this.memory);
    }
  }

  private async initializeSwarm(
    config: any
  ): Promise<ClaudeFlowSwarmService> {
    // Initialize swarm using Claude Flow CLI
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);

    await execFileAsync('npx', [
      'claude-flow@alpha',
      'swarm',
      'init',
      '--topology',
      config.topology || 'mesh'
    ]);

    return new ClaudeFlowSwarmServiceImpl();
  }
}
```

## Best Practices

### 1. Always Use Pre/Post Hooks for Operations
```typescript
async performOperation(): Promise<void> {
  await this.hooks.executeHook(HookType.PRE_TASK, {...});
  try {
    // ... operation ...
    await this.hooks.executeHook(HookType.POST_TASK, { success: true });
  } catch (error) {
    await this.hooks.executeHook(HookType.POST_TASK, { success: false });
    throw error;
  }
}
```

### 2. Store Important State in Memory
```typescript
// Store operation results for other agents
await this.memory.store(`operation/${id}/result`, result);

// Store resource state for caching
await this.memory.store(`resource/${id}/state`, state, { ttl: 300 });
```

### 3. Coordinate Multi-Step Operations
```typescript
// Notify other agents about long-running operations
await this.swarm.coordinate({
  from: this.agentId,
  type: 'notification',
  content: { operation: 'deployment-started' }
});
```

### 4. Handle Hook Failures Gracefully
```typescript
try {
  await this.hooks.executeHook(HookType.NOTIFY, {...});
} catch (error) {
  // Don't fail the main operation on hook errors
  console.warn('Hook failed:', error);
}
```

### 5. Use Namespaces for Memory Organization
```typescript
const memory = new ClaudeFlowMemoryService('swarm/azure-agent/deployments');
await memory.store('latest', deploymentInfo);
```
