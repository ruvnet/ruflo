# Claude Flow MCP - API Reference

## Table of Contents
- [ImplicitLearningEngine](#implicitlearningengine)
- [AdvancedWorkflowEngine](#advancedworkflowengine)
- [AutonomousLifecycleManager](#autonomouslifecyclemanager)
- [RealTimeMonitoringDashboard](#realtimemonitoringdashboard)
- [Task Types](#task-types)
- [Event System](#event-system)
- [Error Handling](#error-handling)

---

## ImplicitLearningEngine

The ImplicitLearningEngine implements transformer-inspired implicit learning dynamics using TensorFlow.js.

### Constructor
```javascript
new ImplicitLearningEngine(options)
```

#### Parameters
- `options` (Object) - Configuration options
  - `contextWindowSize` (number, default: 1000) - Maximum contexts to maintain
  - `embeddingDim` (number, default: 256) - Dimension of context embeddings
  - `convergenceThreshold` (number, default: 0.001) - Convergence criteria
  - `learningRate` (number, default: 0.01) - Learning rate for weight updates
  - `attentionHeads` (number, default: 8) - Number of attention heads

### Methods

#### processContext(context)
Process a context and perform implicit weight updates.

```javascript
const result = await engine.processContext({
  task: 'optimization',
  performance: { success: true, duration: 150 },
  resources: { cpu: 0.45, memory: 0.6 }
});

// Returns:
{
  success: true,
  contextId: "ctx_123",
  metrics: {
    loss: 0.023,
    iterations: 5,
    convergence: true,
    processingTime: 15
  }
}
```

#### learnPattern(patternId, pattern, outcome)
Learn from a pattern-outcome pair.

```javascript
const result = await engine.learnPattern(
  'optimization-pattern',
  { type: 'optimization', config: { algorithm: 'gradient-descent' } },
  { success: true, improvement: 0.25 }
);

// Returns:
{
  success: true,
  patternId: 'optimization-pattern',
  stored: true
}
```

#### applyLearnedPatterns(context)
Apply learned patterns to a new context.

```javascript
const result = await engine.applyLearnedPatterns({
  type: 'optimization',
  config: { algorithm: 'gradient-descent', learningRate: 0.01 }
});

// Returns:
{
  success: true,
  appliedPattern: 'optimization-pattern',
  similarity: 0.89,
  predictions: { expectedImprovement: 0.23 }
}
```

#### exportModel()
Export the learned model.

```javascript
const model = await engine.exportModel();

// Returns:
{
  version: '1.0.0',
  exportedAt: 1234567890,
  weights: { /* TensorFlow.js weights */ },
  patterns: [
    { id: 'pattern1', pattern: {}, outcome: {}, frequency: 5 }
  ],
  metadata: {
    contextWindowSize: 1000,
    embeddingDim: 256,
    totalContexts: 150
  }
}
```

#### importModel(model)
Import a previously exported model.

```javascript
const result = await engine.importModel(exportedModel);

// Returns:
{
  success: true,
  patternsImported: 5,
  weightsRestored: true
}
```

#### generateLearningInsights()
Generate insights about the learning process.

```javascript
const insights = engine.generateLearningInsights();

// Returns:
{
  totalPatterns: 10,
  totalContexts: 150,
  averageLoss: 0.025,
  convergenceRate: 0.92,
  topPatterns: [
    { id: 'pattern1', frequency: 20, avgSimilarity: 0.85 }
  ]
}
```

---

## AdvancedWorkflowEngine

The AdvancedWorkflowEngine provides real workflow orchestration with worker thread pool for parallel execution.

### Constructor
```javascript
new AdvancedWorkflowEngine(options)
```

#### Parameters
- `options` (Object) - Configuration options
  - `maxWorkers` (number, default: 4) - Maximum worker threads
  - `maxConcurrentWorkflows` (number, default: 10) - Maximum concurrent workflows
  - `taskTimeout` (number, default: 30000) - Default task timeout in ms
  - `retryPolicy` (Object) - Default retry policy
    - `attempts` (number, default: 3) - Maximum retry attempts
    - `delay` (number, default: 1000) - Delay between retries
    - `backoff` (number, default: 2) - Backoff multiplier

### Methods

#### createWorkflow(definition)
Create a new workflow.

```javascript
const workflow = await engine.createWorkflow({
  name: 'Data Processing Pipeline',
  description: 'Process and transform data',
  tasks: [
    {
      id: 'fetch',
      name: 'Fetch Data',
      type: 'http',
      params: {
        url: 'https://api.example.com/data',
        method: 'GET'
      }
    },
    {
      id: 'transform',
      name: 'Transform Data',
      type: 'transform',
      params: {
        operations: [
          { type: 'map', fn: 'x => x * 2' },
          { type: 'filter', fn: 'x => x > 10' }
        ]
      },
      dependencies: ['fetch'],
      retryPolicy: { attempts: 5 }
    }
  ],
  metadata: {
    author: 'system',
    tags: ['data-processing']
  }
});

// Returns:
{
  workflowId: 'wf_123',
  workflow: {
    id: 'wf_123',
    name: 'Data Processing Pipeline',
    tasks: Map<taskId, task>,
    dependencies: Map<taskId, deps>,
    createdAt: 1234567890
  }
}
```

#### executeWorkflow(workflowId, context)
Execute a workflow.

```javascript
const result = await engine.executeWorkflow('wf_123', {
  environment: 'production',
  variables: { apiKey: process.env.API_KEY }
});

// Returns:
{
  success: true,
  workflowId: 'wf_123',
  executionId: 'exec_456',
  startTime: 1234567890,
  endTime: 1234567920,
  duration: 30000,
  results: {
    'fetch': { status: 200, data: [...] },
    'transform': [20, 30, 40]
  },
  errors: {}
}
```

#### getWorkflowStatus(workflowId)
Get current workflow status.

```javascript
const status = engine.getWorkflowStatus('wf_123');

// Returns:
{
  workflowId: 'wf_123',
  status: 'running', // 'idle' | 'running' | 'completed' | 'failed'
  executions: [
    {
      executionId: 'exec_456',
      status: 'running',
      startTime: 1234567890,
      progress: {
        total: 5,
        completed: 2,
        running: 1,
        pending: 2
      }
    }
  ]
}
```

#### saveAsTemplate(workflowId, templateId, metadata)
Save workflow as reusable template.

```javascript
const template = engine.saveAsTemplate(
  'wf_123',
  'data-processor-v1',
  {
    name: 'Data Processing Template',
    description: 'Reusable data processing pipeline',
    parameters: ['apiUrl', 'transformFn']
  }
);

// Returns:
{
  id: 'data-processor-v1',
  workflowId: 'wf_123',
  metadata: { /* ... */ },
  createdAt: 1234567890
}
```

#### createFromTemplate(templateId, params)
Create workflow from template.

```javascript
const workflow = await engine.createFromTemplate('data-processor-v1', {
  name: 'Production Data Pipeline',
  taskParams: {
    fetch: {
      url: 'https://api.production.com/data'
    },
    transform: {
      operations: [
        { type: 'map', fn: 'x => x * 3' }
      ]
    }
  }
});
```

#### registerHandler(type, handler)
Register custom task handler.

```javascript
engine.registerHandler('custom-task', async (params, context) => {
  // Custom logic
  const result = await processCustomTask(params);
  return result;
});
```

#### getMetrics()
Get workflow engine metrics.

```javascript
const metrics = engine.getMetrics();

// Returns:
{
  totalWorkflows: 10,
  activeWorkflows: 2,
  completedWorkflows: 7,
  failedWorkflows: 1,
  avgWorkflowDuration: 3500,
  workerStatus: {
    total: 4,
    busy: 2,
    idle: 2
  }
}
```

---

## AutonomousLifecycleManager

Manages complete agent lifecycle from spawn to retirement with autonomous behaviors.

### Constructor
```javascript
new AutonomousLifecycleManager(options)
```

#### Parameters
- `options` (Object) - Configuration options
  - `maxAgents` (number, default: 50) - Maximum number of agents
  - `minAgents` (number, default: 1) - Minimum number of agents
  - `healthCheckInterval` (number, default: 10000) - Health check interval in ms
  - `performanceThreshold` (number, default: 0.8) - Performance threshold
  - `memoryThreshold` (number, default: 0.9) - Memory usage threshold
  - `cpuThreshold` (number, default: 0.9) - CPU usage threshold
  - `agentTTL` (number, default: 3600000) - Agent time-to-live in ms
  - `evolutionInterval` (number, default: 300000) - Evolution check interval
  - `autoScale` (boolean, default: true) - Enable auto-scaling
  - `autoOptimize` (boolean, default: true) - Enable auto-optimization
  - `autoEvolve` (boolean, default: true) - Enable auto-evolution
  - `autoRetire` (boolean, default: true) - Enable auto-retirement

### Methods

#### spawnAgent(specification)
Create and spawn a new agent.

```javascript
const agent = await manager.spawnAgent({
  type: 'worker',
  name: 'Data Processor',
  capabilities: ['data-processing', 'analysis'],
  resources: {
    cpu: 0.5,
    memory: 0.3
  },
  metadata: {
    specialization: 'json-processing'
  }
});

// Returns:
{
  id: 'agent_123',
  type: 'worker',
  name: 'Data Processor',
  capabilities: ['data-processing', 'analysis'],
  state: 'active',
  spawnTime: 1234567890,
  generation: 1,
  performance: {
    tasksCompleted: 0,
    tasksFailed: 0,
    avgResponseTime: 0,
    successRate: 1.0,
    efficiency: 1.0
  },
  resources: {
    cpuUsage: 0,
    memoryUsage: 0,
    activeConnections: 0
  }
}
```

#### updateAgentState(agentId, newState, reason)
Update agent lifecycle state.

```javascript
const agent = await manager.updateAgentState(
  'agent_123',
  'learning',
  'scheduled-learning-cycle'
);
```

Valid states:
- `spawning` - Agent being created
- `initializing` - Agent setting up
- `active` - Agent operational
- `learning` - Agent in learning cycle
- `evolving` - Agent evolving
- `optimizing` - Agent being optimized
- `hibernating` - Agent hibernated
- `retiring` - Agent retiring
- `terminated` - Agent terminated

#### recordActivity(agentId, activity)
Record agent activity for learning and evolution.

```javascript
manager.recordActivity('agent_123', {
  type: 'task-completed',
  duration: 150,
  outcome: 'success',
  learningValue: true,
  learnings: {
    pattern: 'efficient-processing',
    improvement: 0.15
  }
});
```

#### wakeAgent(agentId)
Wake a hibernating agent.

```javascript
const agent = await manager.wakeAgent('agent_123');
```

#### getLifecycleStats()
Get comprehensive lifecycle statistics.

```javascript
const stats = manager.getLifecycleStats();

// Returns:
{
  totalAgents: 10,
  byState: {
    active: 7,
    learning: 1,
    hibernating: 2
  },
  byType: {
    worker: 5,
    analyzer: 3,
    coordinator: 2
  },
  avgGeneration: 2.5,
  avgPerformance: 0.85,
  avgAge: 1800000, // ms
  births: 15,
  retirements: 5,
  evolutions: 8
}
```

---

## RealTimeMonitoringDashboard

Production-ready monitoring system with WebSocket streaming.

### Constructor
```javascript
new RealTimeMonitoringDashboard(options)
```

#### Parameters
- `options` (Object) - Configuration options
  - `port` (number, default: 3456) - Server port
  - `updateInterval` (number, default: 1000) - Update interval in ms
  - `historySize` (number, default: 300) - Metric history size
  - `alertThresholds` (Object) - Alert thresholds
    - `cpu` (number, default: 0.8) - CPU usage threshold
    - `memory` (number, default: 0.85) - Memory usage threshold
    - `errorRate` (number, default: 0.1) - Error rate threshold
    - `responseTime` (number, default: 1000) - Response time threshold

### Methods

#### registerComponent(id, component)
Register a component for monitoring.

```javascript
dashboard.registerComponent('workflow-engine', {
  name: 'Workflow Engine',
  type: 'orchestration',
  getMetrics: async () => ({
    runningWorkflows: 5,
    completedWorkflows: 150,
    failedWorkflows: 2,
    avgWorkflowDuration: 3200,
    queueDepth: 8
  })
});
```

#### unregisterComponent(id)
Unregister a component.

```javascript
dashboard.unregisterComponent('workflow-engine');
```

#### stop()
Stop the monitoring dashboard.

```javascript
await dashboard.stop();
```

### WebSocket API

#### Client → Server Messages

**Subscribe to channels:**
```javascript
{
  type: 'subscribe',
  channels: ['system', 'swarm', 'alerts']
}
```

**Unsubscribe from channels:**
```javascript
{
  type: 'unsubscribe',
  channels: ['alerts']
}
```

**Execute command:**
```javascript
{
  type: 'command',
  command: 'clear-alerts' | 'reset-metrics' | 'snapshot',
  params: {}
}
```

#### Server → Client Messages

**Initialization data:**
```javascript
{
  type: 'init',
  data: {
    status: { /* system status */ },
    metrics: { /* recent metrics */ },
    components: [ /* registered components */ ],
    alerts: [ /* active alerts */ ]
  }
}
```

**System metrics update:**
```javascript
{
  type: 'system-metrics',
  data: {
    cpu: 0.45,
    memory: 0.62,
    timestamp: 1234567890
  }
}
```

**Alert created:**
```javascript
{
  type: 'alert-created',
  data: {
    id: 'high-cpu',
    type: 'high-cpu',
    severity: 'warning',
    message: 'CPU usage is 85% (threshold: 80%)',
    createdAt: 1234567890
  }
}
```

---

## Task Types

Built-in task types for the workflow engine:

### javascript
Execute JavaScript code in sandboxed environment.

```javascript
{
  type: 'javascript',
  params: {
    code: 'return context.data.map(x => x * 2)',
    timeout: 5000
  }
}
```

### http
Make HTTP requests.

```javascript
{
  type: 'http',
  params: {
    url: 'https://api.example.com/data',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { key: 'value' },
    timeout: 30000
  }
}
```

### transform
Transform data with operations.

```javascript
{
  type: 'transform',
  params: {
    input: [1, 2, 3, 4, 5],
    operations: [
      { type: 'filter', fn: 'x => x > 2' },
      { type: 'map', fn: 'x => x * 2' },
      { type: 'reduce', fn: '(acc, x) => acc + x', initial: 0 }
    ]
  }
}
```

### batch
Process items in batches.

```javascript
{
  type: 'batch',
  params: {
    items: [/* large array */],
    processor: '(item) => processItem(item)',
    batchSize: 100,
    concurrency: 5
  }
}
```

### conditional
Conditional execution.

```javascript
{
  type: 'conditional',
  params: {
    condition: '(ctx, prev) => prev.status === 200',
    trueBranch: { type: 'transform', params: { /* ... */ } },
    falseBranch: { type: 'wait', params: { duration: 1000 } }
  }
}
```

### loop
Loop over items.

```javascript
{
  type: 'loop',
  params: {
    items: [1, 2, 3],
    iterator: '(item, ctx, acc) => item * 2',
    accumulator: []
  }
}
```

### aggregate
Aggregate data.

```javascript
{
  type: 'aggregate',
  params: {
    data: [/* array of objects */],
    groupBy: 'category',
    operations: [
      { type: 'count' },
      { type: 'sum', field: 'value' },
      { type: 'avg', field: 'score' }
    ]
  }
}
```

### wait
Wait/delay execution.

```javascript
{
  type: 'wait',
  params: {
    duration: 2000
  }
}
```

### validate
Validate data against schema.

```javascript
{
  type: 'validate',
  params: {
    schema: {
      name: [
        { type: 'required' },
        { type: 'minLength', value: 3 }
      ],
      age: [
        { type: 'type', expected: 'number' },
        { type: 'min', value: 0 }
      ]
    }
  }
}
```

---

## Event System

All components emit events for monitoring and integration.

### ImplicitLearningEngine Events

- `context-processed` - Context successfully processed
- `pattern-learned` - New pattern learned
- `pattern-applied` - Pattern applied to context
- `convergence-achieved` - Model converged
- `model-exported` - Model exported
- `model-imported` - Model imported

### AdvancedWorkflowEngine Events

- `workflow-created` - New workflow created
- `workflow-started` - Workflow execution started
- `workflow-completed` - Workflow completed successfully
- `workflow-failed` - Workflow execution failed
- `task-started` - Individual task started
- `task-completed` - Individual task completed
- `task-failed` - Individual task failed
- `worker-spawned` - New worker thread created
- `worker-terminated` - Worker thread terminated

### AutonomousLifecycleManager Events

- `lifecycle-manager-initialized` - Manager initialized
- `agent-spawned` - New agent created
- `agent-initialized` - Agent initialized successfully
- `agent-state-changed` - Agent state transition
- `agent-activity` - Agent activity recorded
- `agent-learning-completed` - Learning cycle completed
- `agent-evolution-completed` - Evolution completed
- `agent-optimization-completed` - Optimization completed
- `agent-hibernated` - Agent hibernated
- `agent-awakened` - Agent awakened
- `agent-retired` - Agent retired gracefully
- `agent-terminated` - Agent terminated
- `auto-scaled-up` - Agents added via auto-scaling
- `auto-scaled-down` - Agents removed via auto-scaling
- `resource-metrics` - Resource metrics update

### RealTimeMonitoringDashboard Events

- `server-started` - Dashboard server started
- `server-stopped` - Dashboard server stopped
- `component-registered` - Component registered
- `component-unregistered` - Component unregistered
- `alert` - Alert triggered

### Event Usage Example

```javascript
// Listen to events
learningEngine.on('pattern-learned', ({ patternId, pattern }) => {
  console.log(`New pattern learned: ${patternId}`);
});

workflowEngine.on('workflow-completed', ({ workflowId, duration, results }) => {
  console.log(`Workflow ${workflowId} completed in ${duration}ms`);
});

lifecycleManager.on('agent-evolution-completed', ({ agentId, generation, fitness }) => {
  console.log(`Agent ${agentId} evolved to generation ${generation}, fitness: ${fitness}`);
});

dashboard.on('alert', ({ type, severity, message }) => {
  console.log(`Alert [${severity}]: ${message}`);
});
```

---

## Error Handling

### Error Types

#### ValidationError
Thrown when input validation fails.

```javascript
class ValidationError extends Error {
  constructor(message, field, value) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }
}
```

#### WorkflowError
Thrown when workflow execution fails.

```javascript
class WorkflowError extends Error {
  constructor(message, workflowId, taskId, cause) {
    super(message);
    this.name = 'WorkflowError';
    this.workflowId = workflowId;
    this.taskId = taskId;
    this.cause = cause;
  }
}
```

#### ResourceError
Thrown when resource limits are exceeded.

```javascript
class ResourceError extends Error {
  constructor(message, resource, limit, usage) {
    super(message);
    this.name = 'ResourceError';
    this.resource = resource;
    this.limit = limit;
    this.usage = usage;
  }
}
```

### Error Handling Patterns

#### Try-Catch with Context
```javascript
try {
  const result = await workflowEngine.executeWorkflow(workflowId);
  // Process result
} catch (error) {
  if (error instanceof WorkflowError) {
    console.error(`Workflow ${error.workflowId} failed at task ${error.taskId}`);
    // Handle workflow-specific error
  } else if (error instanceof ResourceError) {
    console.error(`Resource limit exceeded: ${error.resource}`);
    // Handle resource error
  } else {
    console.error('Unexpected error:', error);
    // Handle generic error
  }
}
```

#### Retry with Backoff
```javascript
async function executeWithRetry(fn, options = {}) {
  const { attempts = 3, delay = 1000, backoff = 2 } = options;
  
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === attempts - 1) throw error;
      
      const waitTime = delay * Math.pow(backoff, i);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

// Usage
const result = await executeWithRetry(
  () => workflowEngine.executeWorkflow(workflowId),
  { attempts: 5, delay: 2000 }
);
```

#### Circuit Breaker Pattern
```javascript
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.threshold = threshold;
    this.timeout = timeout;
    this.failures = 0;
    this.openedAt = null;
  }
  
  async execute(fn) {
    if (this.isOpen()) {
      throw new Error('Circuit breaker is open');
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  isOpen() {
    if (!this.openedAt) return false;
    return Date.now() - this.openedAt < this.timeout;
  }
  
  onSuccess() {
    this.failures = 0;
    this.openedAt = null;
  }
  
  onFailure() {
    this.failures++;
    if (this.failures >= this.threshold) {
      this.openedAt = Date.now();
    }
  }
}
```

---

## Complete Integration Example

```javascript
import {
  ImplicitLearningEngine,
  AdvancedWorkflowEngine,
  AutonomousLifecycleManager,
  RealTimeMonitoringDashboard
} from 'claude-flow-mcp';

// Initialize all components
const learningEngine = new ImplicitLearningEngine({
  contextWindowSize: 2000,
  embeddingDim: 512
});

const workflowEngine = new AdvancedWorkflowEngine({
  maxWorkers: 8,
  maxConcurrentWorkflows: 20
});

const lifecycleManager = new AutonomousLifecycleManager({
  maxAgents: 100,
  autoScale: true,
  autoEvolve: true
});

const dashboard = new RealTimeMonitoringDashboard({
  port: 3456
});

// Register components with dashboard
dashboard.registerComponent('learning', {
  name: 'Learning Engine',
  type: 'ai',
  getMetrics: async () => ({
    patterns: learningEngine.patterns.size,
    contexts: learningEngine.contextHistory.length,
    avgLoss: learningEngine.getAverageLoss()
  })
});

dashboard.registerComponent('workflow', {
  name: 'Workflow Engine',
  type: 'orchestration',
  getMetrics: () => workflowEngine.getMetrics()
});

dashboard.registerComponent('lifecycle', {
  name: 'Lifecycle Manager',
  type: 'agents',
  getMetrics: () => lifecycleManager.getLifecycleStats()
});

// Create intelligent workflow
const workflow = await workflowEngine.createWorkflow({
  name: 'Intelligent Data Pipeline',
  tasks: [
    {
      id: 'fetch',
      type: 'http',
      params: { url: 'https://api.example.com/data' }
    },
    {
      id: 'process',
      type: 'transform',
      params: {
        operations: [
          { type: 'map', fn: 'x => ({ ...x, processed: true })' }
        ]
      },
      dependencies: ['fetch']
    }
  ]
});

// Spawn specialized agent
const agent = await lifecycleManager.spawnAgent({
  type: 'workflow-executor',
  capabilities: ['workflow-execution', 'learning']
});

// Execute workflow with agent
const startTime = Date.now();
const result = await workflowEngine.executeWorkflow(workflow.workflowId);
const duration = Date.now() - startTime;

// Record agent activity
lifecycleManager.recordActivity(agent.id, {
  type: result.success ? 'task-completed' : 'task-failed',
  duration,
  workflowId: workflow.workflowId,
  learningValue: true
});

// Learn from execution
if (result.success) {
  await learningEngine.learnPattern(
    `workflow-${workflow.workflowId}`,
    {
      type: 'data-pipeline',
      tasks: workflow.tasks.length,
      configuration: workflow
    },
    {
      success: true,
      duration,
      efficiency: duration < 5000 ? 'high' : 'normal'
    }
  );
}

// Monitor everything at http://localhost:3456
console.log('System running. Dashboard: http://localhost:3456');

// Graceful shutdown
process.on('SIGTERM', async () => {
  await dashboard.stop();
  await workflowEngine.cleanup();
  await lifecycleManager.cleanup();
  await learningEngine.cleanup();
  process.exit(0);
});
```

---

*For more examples and use cases, see the `/examples` directory in the repository.*