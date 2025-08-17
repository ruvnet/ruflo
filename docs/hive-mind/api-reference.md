# 🔧 Hive Mind API Reference

## Overview

The Hive Mind system provides a comprehensive programmatic API for integrating intelligent multi-agent orchestration into your applications and workflows. This reference covers all classes, methods, and interfaces.

## Installation

```bash
npm install claude-flow@2.0.0
```

## Basic Usage

```javascript
const { HiveMind } = require('claude-flow');

// Initialize Hive Mind
const hiveMind = new HiveMind({
  topology: 'hierarchical',
  maxAgents: 8,
  neural: true
});

// Execute task
const result = await hiveMind.execute({
  task: 'Build REST API with authentication',
  complexity: 'high',
  features: ['auth', 'database', 'api', 'tests']
});
```

## Core Classes

### HiveMind

The main orchestration class.

```javascript
class HiveMind {
  constructor(options?: HiveMindOptions)
  async initialize(): Promise<void>
  async execute(task: TaskDefinition): Promise<TaskResult>
  async spawn(agentType: AgentType, options?: AgentOptions): Promise<Agent>
  async orchestrate(strategy: OrchestrationStrategy): Promise<void>
  async shutdown(): Promise<void>
}
```

#### Constructor Options

```typescript
interface HiveMindOptions {
  topology?: 'hierarchical' | 'mesh' | 'ring' | 'star';
  maxAgents?: number;
  memorySize?: number;
  neural?: boolean;
  persistent?: boolean;
  monitoring?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}
```

#### Methods

##### `initialize()`
Initialize the Hive Mind system.

```javascript
await hiveMind.initialize();
```

##### `execute(task)`
Execute a task with automatic orchestration.

```javascript
const result = await hiveMind.execute({
  task: 'Build e-commerce platform',
  complexity: 'high',
  features: ['auth', 'database', 'api', 'frontend', 'payments'],
  timeline: 'balanced',
  technologies: {
    backend: 'Node.js',
    frontend: 'React',
    database: 'PostgreSQL'
  }
});
```

##### `spawn(agentType, options)`
Manually spawn a specific agent.

```javascript
const architect = await hiveMind.spawn('architect', {
  name: 'SystemDesigner',
  capabilities: ['api-design', 'database-modeling']
});
```

##### `orchestrate(strategy)`
Set orchestration strategy.

```javascript
await hiveMind.orchestrate({
  strategy: 'parallel',
  dependencies: true,
  priority: 'high'
});
```

##### `shutdown()`
Gracefully shutdown the system.

```javascript
await hiveMind.shutdown();
```

### Agent

Individual agent in the hive.

```javascript
class Agent {
  readonly id: string
  readonly type: AgentType
  readonly name: string
  readonly status: AgentStatus
  
  async execute(task: SubTask): Promise<TaskResult>
  async communicate(message: AgentMessage): Promise<void>
  async getMetrics(): Promise<AgentMetrics>
  async stop(): Promise<void>
}
```

#### Agent Types

```typescript
type AgentType = 
  | 'coordinator'
  | 'architect' 
  | 'coder'
  | 'analyst'
  | 'tester'
  | 'researcher'
  | 'reviewer'
  | 'documenter'
  | 'optimizer'
  | 'monitor';
```

#### Agent Methods

##### `execute(task)`
Execute a specific subtask.

```javascript
const result = await agent.execute({
  id: 'task-001',
  type: 'implementation',
  description: 'Implement user authentication',
  dependencies: ['task-000'],
  priority: 'high'
});
```

##### `communicate(message)`
Send message to other agents.

```javascript
await agent.communicate({
  to: 'architect-001',
  type: 'discovery',
  content: {
    finding: 'JWT token expiry should be configurable',
    impact: ['security', 'configuration']
  }
});
```

### Swarm

Swarm coordination manager.

```javascript
class Swarm {
  readonly id: string
  readonly topology: Topology
  readonly agents: Agent[]
  
  async addAgent(agent: Agent): Promise<void>
  async removeAgent(agentId: string): Promise<void>
  async optimize(): Promise<void>
  async getStatus(): Promise<SwarmStatus>
  async sync(): Promise<void>
}
```

### Memory

Shared memory system.

```javascript
class Memory {
  async store(key: string, value: any, options?: MemoryOptions): Promise<void>
  async retrieve(key: string): Promise<any>
  async search(pattern: string, limit?: number): Promise<MemoryEntry[]>
  async delete(key: string): Promise<void>
  async clear(namespace?: string): Promise<void>
  async backup(path: string): Promise<void>
  async restore(path: string): Promise<void>
}
```

#### Memory Options

```typescript
interface MemoryOptions {
  namespace?: string;
  ttl?: number;
  compress?: boolean;
  encrypt?: boolean;
}
```

### Neural

Neural processing system.

```javascript
class Neural {
  async train(data: TrainingData, options?: TrainOptions): Promise<Model>
  async predict(input: any, modelId: string): Promise<Prediction>
  async analyze(pattern: string): Promise<Analysis>
  async saveModel(modelId: string, path: string): Promise<void>
  async loadModel(path: string): Promise<Model>
}
```

## Task Definition

### TaskDefinition Interface

```typescript
interface TaskDefinition {
  task: string;
  complexity?: 'low' | 'medium' | 'high' | 'very-high';
  features?: Feature[];
  timeline?: 'asap' | 'balanced' | 'thorough' | 'learning';
  technologies?: TechnologyStack;
  context?: string;
  constraints?: Constraint[];
}
```

### Feature Type

```typescript
type Feature = 
  | 'auth'
  | 'database'
  | 'api'
  | 'frontend'
  | 'realtime'
  | 'file-upload'
  | 'integration'
  | 'tests'
  | 'docs'
  | 'devops';
```

### TechnologyStack Interface

```typescript
interface TechnologyStack {
  backend?: string;
  frontend?: string;
  database?: string;
  cache?: string;
  queue?: string;
  other?: string[];
}
```

## Task Results

### TaskResult Interface

```typescript
interface TaskResult {
  success: boolean;
  taskId: string;
  duration: number;
  agents: AgentResult[];
  files: FileOutput[];
  metrics: TaskMetrics;
  summary: string;
  nextSteps?: string[];
  errors?: Error[];
}
```

### AgentResult Interface

```typescript
interface AgentResult {
  agentId: string;
  agentType: AgentType;
  tasksCompleted: number;
  duration: number;
  tokensUsed: number;
  discoveries: Discovery[];
}
```

### FileOutput Interface

```typescript
interface FileOutput {
  path: string;
  type: 'created' | 'modified' | 'deleted';
  size: number;
  language?: string;
}
```

## Event System

### Event Types

```typescript
type HiveMindEvent = 
  | 'agent.spawned'
  | 'agent.started'
  | 'agent.completed'
  | 'agent.failed'
  | 'task.started'
  | 'task.progress'
  | 'task.completed'
  | 'discovery.shared'
  | 'coordination.sync'
  | 'memory.updated';
```

### Event Listeners

```javascript
// Listen to specific events
hiveMind.on('agent.spawned', (agent) => {
  console.log(`Agent ${agent.name} spawned`);
});

hiveMind.on('task.progress', (progress) => {
  console.log(`Progress: ${progress.percent}%`);
});

hiveMind.on('discovery.shared', (discovery) => {
  console.log(`Discovery: ${discovery.finding}`);
});
```

## Workflow API

### Creating Workflows

```javascript
const workflow = hiveMind.createWorkflow({
  name: 'full-stack-development',
  steps: [
    {
      id: 'design',
      type: 'architecture',
      agent: 'architect'
    },
    {
      id: 'backend',
      type: 'implementation',
      agent: 'coder',
      dependencies: ['design']
    },
    {
      id: 'frontend',
      type: 'implementation', 
      agent: 'coder',
      dependencies: ['design'],
      parallel: true
    },
    {
      id: 'tests',
      type: 'testing',
      agent: 'tester',
      dependencies: ['backend', 'frontend']
    }
  ]
});

const result = await workflow.execute();
```

### Workflow Interface

```typescript
interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  
  async execute(context?: any): Promise<WorkflowResult>
  async pause(): Promise<void>
  async resume(): Promise<void>
  async cancel(): Promise<void>
  async getStatus(): Promise<WorkflowStatus>
}
```

## Monitoring API

### Real-time Monitoring

```javascript
const monitor = hiveMind.monitor({
  interval: 1000,
  metrics: ['agents', 'memory', 'tasks', 'performance']
});

monitor.on('update', (metrics) => {
  console.log('Active agents:', metrics.agents.active);
  console.log('Memory usage:', metrics.memory.used);
  console.log('Tasks completed:', metrics.tasks.completed);
});

// Stop monitoring
monitor.stop();
```

### Metrics Interface

```typescript
interface Metrics {
  agents: {
    active: number;
    idle: number;
    total: number;
    byType: Record<AgentType, number>;
  };
  memory: {
    used: number;
    total: number;
    entries: number;
  };
  tasks: {
    pending: number;
    active: number;
    completed: number;
    failed: number;
  };
  performance: {
    avgResponseTime: number;
    throughput: number;
    tokenUsage: number;
  };
}
```

## Advanced Features

### Custom Agents

```javascript
class CustomAgent extends Agent {
  constructor(options) {
    super({
      ...options,
      type: 'custom',
      capabilities: ['specialized-task']
    });
  }

  async execute(task) {
    // Custom implementation
    return super.execute(task);
  }
}

// Register custom agent
hiveMind.registerAgentType('ml-engineer', CustomAgent);
```

### Neural Training

```javascript
// Train on successful patterns
const model = await hiveMind.neural.train({
  data: successfulPatterns,
  epochs: 100,
  type: 'coordination',
  validation: 0.2
});

// Use trained model for predictions
const prediction = await hiveMind.neural.predict(
  newTask,
  model.id
);

console.log('Recommended approach:', prediction.approach);
console.log('Estimated time:', prediction.duration);
console.log('Suggested agents:', prediction.agents);
```

### Memory Patterns

```javascript
// Store patterns
await hiveMind.memory.store('patterns/auth', {
  approach: 'JWT with refresh tokens',
  implementation: authCode,
  performance: metrics
}, {
  namespace: 'solutions',
  compress: true
});

// Search patterns
const authPatterns = await hiveMind.memory.search('patterns/auth*');

// Apply patterns
const pattern = authPatterns[0];
await hiveMind.applyPattern(pattern, currentTask);
```

## Integration Examples

### Express.js Integration

```javascript
const express = require('express');
const { HiveMind } = require('claude-flow');

const app = express();
const hiveMind = new HiveMind();

app.post('/api/generate', async (req, res) => {
  try {
    const result = await hiveMind.execute({
      task: req.body.task,
      complexity: req.body.complexity,
      features: req.body.features
    });
    
    res.json({
      success: true,
      result: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
```

### GitHub Actions Integration

```yaml
name: Generate Code with Hive Mind

on:
  issues:
    types: [labeled]

jobs:
  generate:
    if: github.event.label.name == 'hive-mind'
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '20'
    
    - name: Run Hive Mind
      run: |
        npx claude-flow@2.0.0 hive-mind \
          --task "${{ github.event.issue.title }}" \
          --complexity high \
          --non-interactive
    
    - name: Create PR
      uses: peter-evans/create-pull-request@v5
      with:
        title: "Hive Mind: ${{ github.event.issue.title }}"
        branch: hive-mind-${{ github.event.issue.number }}
```

### VS Code Extension

```javascript
const vscode = require('vscode');
const { HiveMind } = require('claude-flow');

function activate(context) {
  const hiveMind = new HiveMind();
  
  const disposable = vscode.commands.registerCommand(
    'hivemind.generate',
    async () => {
      const task = await vscode.window.showInputBox({
        prompt: 'What would you like to build?'
      });
      
      if (task) {
        const result = await hiveMind.execute({
          task: task,
          complexity: 'medium'
        });
        
        vscode.window.showInformationMessage(
          `Hive Mind completed: ${result.files.length} files created`
        );
      }
    }
  );
  
  context.subscriptions.push(disposable);
}
```

## Error Handling

### Error Types

```typescript
class HiveMindError extends Error {
  code: string;
  details: any;
}

class AgentError extends HiveMindError {
  agentId: string;
  task: string;
}

class CoordinationError extends HiveMindError {
  agents: string[];
  conflict: string;
}

class MemoryError extends HiveMindError {
  operation: string;
  key: string;
}
```

### Error Handling Example

```javascript
try {
  const result = await hiveMind.execute(task);
} catch (error) {
  if (error instanceof AgentError) {
    console.error(`Agent ${error.agentId} failed:`, error.message);
    // Retry with different agent
  } else if (error instanceof CoordinationError) {
    console.error('Coordination conflict:', error.conflict);
    // Resolve conflict
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Performance Optimization

### Batch Operations

```javascript
// Batch multiple tasks
const results = await hiveMind.executeBatch([
  { task: 'Create user service', complexity: 'medium' },
  { task: 'Create order service', complexity: 'medium' },
  { task: 'Create payment service', complexity: 'high' }
], {
  parallel: true,
  shareMemory: true
});
```

### Resource Limits

```javascript
// Set resource limits
hiveMind.setLimits({
  maxConcurrentAgents: 6,
  maxMemoryMB: 128,
  maxTokensPerAgent: 10000,
  timeout: 600000 // 10 minutes
});
```

### Caching

```javascript
// Enable caching
hiveMind.enableCache({
  ttl: 3600, // 1 hour
  maxSize: 100, // MB
  strategy: 'lru'
});
```

## Testing

### Unit Testing

```javascript
const { HiveMind, MockAgent } = require('claude-flow/testing');

describe('HiveMind', () => {
  it('should execute simple task', async () => {
    const hiveMind = new HiveMind({ mock: true });
    
    const result = await hiveMind.execute({
      task: 'Create REST endpoint',
      complexity: 'low'
    });
    
    expect(result.success).toBe(true);
    expect(result.files).toHaveLength(3);
  });
});
```

### Integration Testing

```javascript
const { TestHarness } = require('claude-flow/testing');

const harness = new TestHarness();

beforeEach(async () => {
  await harness.setup();
});

afterEach(async () => {
  await harness.teardown();
});

test('full workflow', async () => {
  const result = await harness.runWorkflow('full-stack');
  expect(result.success).toBe(true);
});
```

## Migration from v1

```javascript
// v1 code
const result = await claudeFlow.coordinate(task);

// v2 code
const hiveMind = new HiveMind();
const result = await hiveMind.execute(task);
```

## Best Practices

1. **Initialize Once**: Create one HiveMind instance per application
2. **Use Events**: Monitor progress with event listeners
3. **Handle Errors**: Implement proper error handling
4. **Set Limits**: Configure resource limits for production
5. **Enable Monitoring**: Use monitoring API for insights
6. **Cache Results**: Enable caching for repeated tasks
7. **Clean Shutdown**: Always call shutdown() when done

## Support

- GitHub Issues: https://github.com/ruvnet/claude-flow/issues
- Documentation: https://github.com/ruvnet/claude-flow/docs
- Examples: https://github.com/ruvnet/claude-flow/examples