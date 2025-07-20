# Agentic Flow v2.0 - Advanced Workflow Execution Engine

A production-ready workflow execution engine with real agent integration, state persistence, error recovery, and comprehensive monitoring.

## 🚀 Features

### Core Workflow Engine
- **Real Step Execution**: All step types execute actual work, not simulations
- **Agent Integration**: Direct integration with CoordinatorAgent and ExecutorAgent systems
- **State Persistence**: SQLite-based workflow state storage with snapshots
- **Resume Capability**: Resume interrupted workflows from exact point of failure
- **XState Integration**: Robust state machine management for complex workflows

### Step Types Supported
- **🤖 Agent Tasks**: Spawn and execute real AI agents with specific capabilities
- **⚡ Parallel Execution**: Concurrent step execution with configurable concurrency limits
- **🔀 Conditional Logic**: Dynamic branching based on runtime conditions
- **🔄 Loop Execution**: Iterative processing with break conditions
- **🌐 HTTP Requests**: Real HTTP calls with retries and timeout handling
- **📜 Script Execution**: Secure JavaScript execution in sandboxed environment

### Production Features
- **🛡️ Error Handling**: Circuit breakers, retry strategies, and dead letter queues
- **📊 Monitoring**: Real-time metrics collection and performance tracking
- **🚨 Alerting**: Automated alerts for failures and performance issues
- **🔒 Security**: Sandboxed script execution with module restrictions
- **📈 Scalability**: Optimized for high-throughput production workloads

## 📋 Quick Start

### Installation

```bash
npm install
```

### Basic Usage

```typescript
import { WorkflowEngine, WorkflowDefinition } from './workflow-engine';

// Create engine with persistence
const engine = new WorkflowEngine({
  enablePersistence: true,
  dbPath: './workflows.db'
});

// Define a workflow
const workflow: WorkflowDefinition = {
  id: 'my-workflow',
  name: 'Data Processing Pipeline',
  description: 'Process and analyze data',
  version: '1.0.0',
  steps: [
    {
      id: 'fetch-data',
      type: 'http',
      name: 'Fetch Data',
      config: {
        method: 'GET',
        url: 'https://api.example.com/data',
        retries: 3
      },
      next: ['process-data']
    },
    {
      id: 'process-data',
      type: 'agent-task',
      name: 'AI Processing',
      config: {
        agentType: 'executor',
        goal: 'Analyze and transform the fetched data',
        capabilities: ['data-analysis', 'transformation']
      },
      next: ['save-results']
    },
    {
      id: 'save-results',
      type: 'script',
      name: 'Save Results',
      config: {
        script: `
          console.log('Saving results...');
          // Process results from previous steps
          return { saved: true, timestamp: new Date() };
        `
      }
    }
  ],
  variables: {},
  triggers: []
};

// Execute workflow
async function runWorkflow() {
  await engine.createWorkflow(workflow);
  const executionId = await engine.executeWorkflow(workflow.id);
  
  // Monitor completion
  engine.on('workflow:completed', (data) => {
    console.log('Workflow completed:', data.executionId);
  });
}
```

### With Monitoring and Error Handling

```typescript
import { WorkflowMonitor } from './monitoring/workflow-monitor';
import { WorkflowErrorHandler } from './error-handling/workflow-error-handler';

// Set up complete system
const engine = new WorkflowEngine({ enablePersistence: true });
const monitor = new WorkflowMonitor(engine);
const errorHandler = new WorkflowErrorHandler(engine, monitor);

// Start monitoring
monitor.startMonitoring(30000); // Check every 30 seconds

// Configure error recovery
errorHandler.registerRecoveryStrategy('http', {
  type: 'retry',
  maxAttempts: 3,
  retryDelay: 2000
});

errorHandler.registerRecoveryStrategy('agent-task', {
  type: 'escalate',
  escalationHandler: 'manual-intervention'
});

// Get system health
const health = monitor.getHealthStatus();
console.log('System status:', health.status);
```

## 🏗️ Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Workflow Engine                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Step      │  │   Agent     │  │   State     │         │
│  │ Executors   │  │Integration  │  │Persistence  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Monitoring  │  │    Error    │  │   XState    │         │
│  │   System    │  │  Handling   │  │ Integration │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

### Step Execution Flow

1. **Workflow Definition** → Parsed and validated
2. **XState Machine** → Created for state management
3. **Step Execution** → Real executors perform work
4. **State Persistence** → Progress saved to database
5. **Error Handling** → Automatic recovery strategies applied
6. **Monitoring** → Metrics collected and alerts generated

## 📖 Step Type Documentation

### Agent Task Steps

Execute real AI agents with specific capabilities:

```typescript
{
  id: 'ai-analysis',
  type: 'agent-task',
  name: 'AI Data Analysis',
  config: {
    agentType: 'coordinator',          // 'coordinator' | 'executor'
    goal: 'Analyze customer feedback', // Task description
    capabilities: ['nlp', 'sentiment'], // Required capabilities
    timeout: 30000,                    // Execution timeout
    provider: 'openai'                 // Optional LLM provider
  }
}
```

### Parallel Execution Steps

Run multiple steps concurrently:

```typescript
{
  id: 'parallel-processing',
  type: 'parallel',
  name: 'Parallel Data Processing',
  config: {
    steps: ['process-a', 'process-b', 'process-c'], // Steps to run in parallel
    maxConcurrency: 3                               // Max concurrent executions
  }
}
```

### Conditional Steps

Dynamic branching based on runtime conditions:

```typescript
{
  id: 'data-check',
  type: 'condition',
  name: 'Validate Data Quality',
  config: {
    condition: 'results["data-fetch"].quality > 0.8', // JavaScript expression
    trueStep: 'high-quality-processing',              // Step if true
    falseStep: 'data-cleaning'                        // Step if false
  }
}
```

### Loop Steps

Iterative processing with break conditions:

```typescript
{
  id: 'batch-processing',
  type: 'loop',
  name: 'Process Data Batches',
  config: {
    condition: 'variables.batchIndex < variables.totalBatches', // Continue condition
    loopStep: 'process-single-batch',                           // Step to repeat
    maxIterations: 100,                                         // Safety limit
    breakCondition: 'results["process-single-batch"].error'    // Early exit condition
  }
}
```

### HTTP Request Steps

Make external API calls:

```typescript
{
  id: 'api-call',
  type: 'http',
  name: 'External API Call',
  config: {
    method: 'POST',                           // HTTP method
    url: 'https://api.example.com/process',   // URL with template support
    headers: {                                // Request headers
      'Authorization': 'Bearer {{variables.token}}',
      'Content-Type': 'application/json'
    },
    body: {                                   // Request body
      data: '{{results["data-fetch"].data}}'
    },
    timeout: 10000,                          // Request timeout
    retries: 3,                              // Retry attempts
    retryDelay: 1000                         // Delay between retries
  }
}
```

### Script Steps

Execute JavaScript code in secure sandbox:

```typescript
{
  id: 'data-transform',
  type: 'script',
  name: 'Transform Data',
  config: {
    script: `
      // Access workflow context
      const inputData = results["data-fetch"];
      const config = variables.transformConfig;
      
      // Perform transformation
      const transformed = inputData.map(item => ({
        ...item,
        processed: true,
        timestamp: new Date()
      }));
      
      console.log(\`Transformed \${transformed.length} items\`);
      
      return {
        data: transformed,
        count: transformed.length,
        processingTime: Date.now() - startTime
      };
    `,
    language: 'javascript',                  // Language (currently only JS)
    timeout: 30000,                         // Execution timeout
    allowedModules: ['lodash', 'uuid']      // Allowed npm modules
  }
}
```

## 🛡️ Error Handling

### Recovery Strategies

#### Retry Strategy
```typescript
errorHandler.registerRecoveryStrategy('http', {
  type: 'retry',
  maxAttempts: 3,
  retryDelay: 2000  // Exponential backoff
});
```

#### Skip Strategy
```typescript
errorHandler.registerRecoveryStrategy('optional-step', {
  type: 'skip'  // Continue workflow without this step
});
```

#### Alternative Strategy
```typescript
errorHandler.registerRecoveryStrategy('primary-processor', {
  type: 'alternative',
  alternativeStep: 'backup-processor'
});
```

#### Rollback Strategy
```typescript
errorHandler.registerRecoveryStrategy('critical-step', {
  type: 'rollback',
  rollbackSteps: ['step1', 'step2', 'step3']
});
```

#### Escalation Strategy
```typescript
errorHandler.registerRecoveryStrategy('manual-approval', {
  type: 'escalate',
  escalationHandler: 'admin-notification'
});
```

### Circuit Breakers

Automatic protection against cascading failures:

```typescript
// Configure circuit breaker thresholds
errorHandler.circuitBreakerConfig = {
  failureThreshold: 5,    // Open after 5 failures
  timeout: 30000,         // Stay open for 30 seconds
  halfOpenMaxAttempts: 3  // Test with 3 attempts when half-open
};
```

## 📊 Monitoring and Metrics

### Workflow Metrics

```typescript
const metrics = monitor.getWorkflowMetrics();
console.log({
  totalExecutions: metrics.totalExecutions,
  completedExecutions: metrics.completedExecutions,
  averageExecutionTime: metrics.averageExecutionTime,
  errorRate: metrics.errorRate,
  throughput: metrics.throughput
});
```

### Step Performance

```typescript
const stepMetrics = monitor.getStepMetrics();
stepMetrics.forEach(metric => {
  console.log(`${metric.stepType}: ${metric.averageExecutionTime}ms avg`);
});
```

### Health Monitoring

```typescript
const health = monitor.getHealthStatus();
if (health.status === 'critical') {
  console.log('Issues:', health.issues);
  console.log('Recommendations:', health.recommendations);
}
```

### Alerts

```typescript
monitor.on('alert:created', (alert) => {
  if (alert.type === 'error') {
    console.error(`Critical alert: ${alert.message}`);
    // Send to external monitoring system
  }
});
```

## 💾 State Persistence

### Automatic Snapshots

```typescript
// Enable automatic snapshots every minute
await engine.enableAutoSnapshots(executionId, 60000);
```

### Manual Snapshots

```typescript
const stateManager = new WorkflowStateManager(store);
const snapshotId = await stateManager.createSnapshot(executionId, currentState);
```

### Workflow Resume

```typescript
// Resume from last checkpoint
await engine.resumeWorkflow(executionId);
```

### Database Schema

The system uses SQLite with the following tables:
- `workflow_definitions` - Workflow definitions
- `workflow_executions` - Execution instances
- `workflow_snapshots` - State snapshots
- `workflow_logs` - Execution logs

## 🧪 Testing

### Run Integration Tests

```bash
npm test src/workflows/tests/workflow-integration.test.ts
```

### Run Demo

```bash
npm run demo:workflows
```

The demo showcases all features including:
- Linear workflows
- Parallel execution
- Conditional logic
- Loop processing
- Error handling
- Agent integration
- HTTP requests
- Script execution
- State persistence
- Complex multi-step workflows

## 🔧 Configuration

### Engine Options

```typescript
const engine = new WorkflowEngine({
  enablePersistence: true,           // Enable state persistence
  dbPath: './workflows.db',          // Database path
  maxConcurrentWorkflows: 100,       // Max concurrent executions
  snapshotInterval: 60000,           // Auto-snapshot interval
  enableSnapshots: true              // Enable automatic snapshots
});
```

### Monitoring Options

```typescript
const monitor = new WorkflowMonitor(engine);
monitor.updateThresholds({
  maxExecutionTime: 300000,     // 5 minutes
  maxErrorRate: 0.1,            // 10%
  maxStepExecutionTime: 60000,  // 1 minute
  maxQueueSize: 100             // Max running workflows
});
```

## 🚀 Production Deployment

### Scaling Considerations

1. **Database**: Use PostgreSQL for production instead of SQLite
2. **Monitoring**: Integrate with Prometheus/Grafana
3. **Logging**: Use structured logging with correlation IDs
4. **Clustering**: Run multiple engine instances with shared database
5. **Queue Management**: Use Redis for distributed queuing

### Performance Optimization

1. **Batch Operations**: Group database operations
2. **Connection Pooling**: Use connection pools for database access
3. **Caching**: Cache workflow definitions and agent configurations
4. **Indexing**: Add database indexes for query optimization

### Security Best Practices

1. **Script Sandboxing**: Limit script execution capabilities
2. **Input Validation**: Validate all workflow inputs
3. **Access Control**: Implement role-based access control
4. **Audit Logging**: Log all workflow operations
5. **Secret Management**: Use secure secret storage

## 📚 API Reference

### WorkflowEngine

- `createWorkflow(definition)` - Create new workflow
- `executeWorkflow(workflowId, variables)` - Start execution
- `pauseWorkflow(executionId)` - Pause running workflow
- `resumeWorkflow(executionId)` - Resume paused workflow
- `cancelExecution(executionId)` - Cancel execution
- `getExecution(executionId)` - Get execution status
- `listExecutions(filter)` - List executions with filtering

### WorkflowMonitor

- `startMonitoring(interval)` - Start monitoring
- `getWorkflowMetrics()` - Get workflow metrics
- `getStepMetrics()` - Get step performance metrics
- `getHealthStatus()` - Get system health status
- `getAlerts(limit)` - Get recent alerts

### WorkflowErrorHandler

- `registerRecoveryStrategy(stepType, strategy)` - Configure error recovery
- `getErrorStatistics()` - Get error statistics
- `getDeadLetterQueue()` - Get failed executions
- `resolveError(errorId, resolution)` - Manually resolve errors

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

For issues and questions:
1. Check the test suite for usage examples
2. Run the demo for comprehensive feature showcase
3. Review error logs and monitoring alerts
4. Submit GitHub issues for bugs or feature requests

---

**Agentic Flow v2.0** - Production-ready workflow execution with real AI agent integration.