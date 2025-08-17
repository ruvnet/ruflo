# Agentic Flow Hook System Documentation

## Overview

The Agentic Flow Hook System provides a comprehensive integration layer between Claude Flow and agentic-flow, enabling advanced features such as:

- **Pre/Post Operation Hooks**: Intercept and modify all LLM calls
- **Memory Persistence**: Cross-provider state management and synchronization
- **Neural Training**: Learn from multi-model responses for continuous improvement
- **Performance Optimization**: Real-time metrics and bottleneck detection
- **Self-Improving Workflows**: Adaptive provider selection and workflow optimization

## Architecture

### Core Components

1. **Hook Manager** (`hook-manager.ts`)
   - Central registry for all hooks
   - Pipeline execution engine
   - Metrics collection and reporting
   - Error handling and recovery

2. **Hook Types** (`types.ts`)
   - Comprehensive type definitions
   - Hook interfaces and payloads
   - Context and state management types

3. **Specialized Hooks**
   - **LLM Hooks** (`llm-hooks.ts`): Provider operations
   - **Memory Hooks** (`memory-hooks.ts`): State persistence
   - **Neural Hooks** (`neural-hooks.ts`): Pattern learning
   - **Performance Hooks** (`performance-hooks.ts`): Optimization
   - **Workflow Hooks** (`workflow-hooks.ts`): Self-improvement

## Quick Start

### Installation

```bash
npm install @claude-flow/agentic-hooks
```

### Basic Usage

```typescript
import { 
  initializeAgenticFlowHooks, 
  createHookContext,
  agenticHookManager 
} from '@claude-flow/agentic-hooks';

// Initialize the hook system
await initializeAgenticFlowHooks();

// Create a context for hook execution
const context = createHookContext()
  .withSession('my-session-id')
  .withMemory('my-namespace', 'redis')
  .withNeural('gpt-optimizer')
  .build();

// Execute hooks for an LLM call
const results = await agenticHookManager.executeHooks(
  'pre-llm-call',
  {
    provider: 'openai',
    model: 'gpt-4',
    operation: 'completion',
    request: {
      messages: [{ role: 'user', content: 'Hello!' }],
      temperature: 0.7,
    },
  },
  context
);
```

## Hook Types

### LLM Hooks

Handle all LLM provider operations with caching, fallback, and optimization.

```typescript
// Pre-LLM Call Hook
agenticHookManager.register({
  id: 'my-pre-llm-hook',
  type: 'pre-llm-call',
  priority: 100,
  handler: async (payload, context) => {
    // Check cache, optimize request, etc.
    return {
      continue: true,
      modified: true,
      payload: optimizedPayload,
    };
  },
});

// Post-LLM Call Hook
agenticHookManager.register({
  id: 'my-post-llm-hook',
  type: 'post-llm-call',
  priority: 100,
  handler: async (payload, context) => {
    // Store response, extract patterns, update metrics
    return {
      continue: true,
      sideEffects: [
        { type: 'memory', action: 'store', data: {...} },
        { type: 'neural', action: 'train', data: {...} },
      ],
    };
  },
});
```

### Memory Hooks

Manage cross-provider memory with compression and synchronization.

```typescript
// Memory Store Hook
agenticHookManager.register({
  id: 'memory-validator',
  type: 'pre-memory-store',
  priority: 100,
  handler: async (payload, context) => {
    // Validate, compress, enrich data
    return {
      continue: true,
      modified: true,
      payload: processedPayload,
    };
  },
});

// Memory Sync Hook
agenticHookManager.register({
  id: 'cross-provider-sync',
  type: 'memory-sync',
  priority: 90,
  handler: async (payload, context) => {
    // Synchronize across providers
    return {
      continue: true,
      sideEffects: syncOperations,
    };
  },
});
```

### Neural Hooks

Enable learning from patterns and continuous improvement.

```typescript
// Neural Training Hook
agenticHookManager.register({
  id: 'pattern-trainer',
  type: 'post-neural-train',
  priority: 100,
  handler: async (payload, context) => {
    // Extract patterns, update models
    return {
      continue: true,
      sideEffects: [
        { type: 'memory', action: 'store', data: patterns },
        { type: 'notification', action: 'emit', data: results },
      ],
    };
  },
});

// Pattern Detection Hook
agenticHookManager.register({
  id: 'pattern-detector',
  type: 'neural-pattern-detected',
  priority: 90,
  handler: async (payload, context) => {
    // Analyze patterns, generate adaptations
    return {
      continue: true,
      sideEffects: adaptationActions,
    };
  },
});
```

### Performance Hooks

Track metrics and optimize performance in real-time.

```typescript
// Performance Metric Hook
agenticHookManager.register({
  id: 'latency-tracker',
  type: 'performance-metric',
  priority: 100,
  handler: async (payload, context) => {
    // Track metrics, detect anomalies
    return {
      continue: true,
      sideEffects: metricActions,
    };
  },
});

// Bottleneck Detection Hook
agenticHookManager.register({
  id: 'bottleneck-analyzer',
  type: 'performance-bottleneck',
  priority: 90,
  handler: async (payload, context) => {
    // Analyze bottlenecks, suggest optimizations
    return {
      continue: true,
      sideEffects: optimizationSuggestions,
    };
  },
});
```

### Workflow Hooks

Create self-improving workflows with adaptive behavior.

```typescript
// Workflow Decision Hook
agenticHookManager.register({
  id: 'decision-optimizer',
  type: 'workflow-decision',
  priority: 90,
  handler: async (payload, context) => {
    // Optimize decisions based on history
    return {
      continue: true,
      modified: true,
      payload: optimizedDecision,
    };
  },
});

// Workflow Complete Hook
agenticHookManager.register({
  id: 'workflow-learner',
  type: 'workflow-complete',
  priority: 100,
  handler: async (payload, context) => {
    // Extract learnings, update strategies
    return {
      continue: true,
      sideEffects: learningActions,
    };
  },
});
```

## Hook Pipelines

Create complex execution flows with pipelines:

```typescript
const pipeline = agenticHookManager.createPipeline({
  name: 'Advanced LLM Pipeline',
  stages: [
    {
      name: 'validation',
      hooks: validationHooks,
      parallel: false,
    },
    {
      name: 'optimization',
      hooks: optimizationHooks,
      parallel: true,
    },
    {
      name: 'execution',
      hooks: executionHooks,
      parallel: false,
    },
    {
      name: 'analysis',
      hooks: analysisHooks,
      parallel: true,
      condition: (ctx) => ctx.metadata.analyze === true,
    },
  ],
  errorStrategy: 'continue',
});

// Execute pipeline
const results = await agenticHookManager.executePipeline(
  pipeline.id,
  initialPayload,
  context
);
```

## Advanced Features

### Hook Filtering

Filter hooks based on various criteria:

```typescript
const filter = {
  providers: ['openai', 'anthropic'],
  models: ['gpt-4', 'claude-3'],
  operations: ['completion'],
  conditions: [
    { field: 'temperature', operator: 'gt', value: 0.5 },
  ],
};

const hooks = agenticHookManager.getHooks('pre-llm-call', filter);
```

### Side Effects

Hooks can trigger various side effects:

```typescript
const sideEffects = [
  // Memory operations
  {
    type: 'memory',
    action: 'store',
    data: { key: 'result', value: data, ttl: 3600 },
  },
  
  // Neural training
  {
    type: 'neural',
    action: 'train',
    data: { patterns: extractedPatterns, modelId: 'optimizer' },
  },
  
  // Metrics
  {
    type: 'metric',
    action: 'update',
    data: { name: 'latency', value: 150 },
  },
  
  // Notifications
  {
    type: 'notification',
    action: 'emit',
    data: { event: 'threshold:exceeded', data: metrics },
  },
  
  // Logging
  {
    type: 'log',
    action: 'write',
    data: { level: 'info', message: 'Operation completed' },
  },
];
```

### Error Handling

Comprehensive error handling strategies:

```typescript
agenticHookManager.register({
  id: 'error-handler',
  type: 'llm-error',
  priority: 100,
  options: {
    retries: 3,
    timeout: 5000,
    fallback: async (payload, context) => {
      // Fallback logic
      return { continue: true };
    },
    errorHandler: (error) => {
      // Custom error handling
      console.error('Hook error:', error);
    },
  },
  handler: async (payload, context) => {
    // Main handler logic
  },
});
```

### Caching

Enable caching for hook results:

```typescript
agenticHookManager.register({
  id: 'cached-hook',
  type: 'pre-llm-call',
  priority: 100,
  options: {
    cache: {
      enabled: true,
      ttl: 3600,
      key: (payload) => `${payload.provider}:${payload.model}:${hash(payload.request)}`,
    },
  },
  handler: async (payload, context) => {
    // This will be cached
    return expensiveOperation(payload);
  },
});
```

## Metrics and Monitoring

The hook system provides comprehensive metrics:

```typescript
const metrics = agenticHookManager.getMetrics();

console.log({
  totalHooks: metrics['hooks.count'],
  executions: metrics['hooks.executions'],
  errors: metrics['hooks.errors'],
  cacheHits: metrics['hooks.cacheHits'],
  avgDuration: metrics['hooks.totalDuration'] / metrics['hooks.executions'],
});

// Subscribe to metrics events
agenticHookManager.on('metrics:collected', (metrics) => {
  // Send to monitoring system
});
```

## Best Practices

### 1. Hook Priority

- **100+**: Critical hooks (validation, security)
- **90-99**: Important hooks (optimization, caching)
- **50-89**: Standard hooks (logging, metrics)
- **0-49**: Low priority hooks (optional features)

### 2. Performance Considerations

```typescript
// Good: Async operations in parallel
const sideEffects = [
  { type: 'memory', action: 'store', data: {...} },
  { type: 'metric', action: 'update', data: {...} },
];

// Bad: Blocking operations
await slowOperation1();
await slowOperation2();
```

### 3. Error Handling

```typescript
// Always handle errors gracefully
handler: async (payload, context) => {
  try {
    const result = await riskyOperation();
    return { continue: true, payload: result };
  } catch (error) {
    // Log but don't break the chain
    logger.error('Hook error:', error);
    return { continue: true };
  }
}
```

### 4. Memory Management

```typescript
// Clean up resources
agenticHookManager.on('hook:executed', ({ hookId }) => {
  if (hookId === 'resource-intensive-hook') {
    cleanupResources();
  }
});
```

## Integration with Claude Flow

The hook system integrates seamlessly with Claude Flow's existing infrastructure:

```typescript
// In your Claude Flow command
import { AgenticFlowHooks } from '@claude-flow/agentic-hooks';

export const myCommand = {
  name: 'my-command',
  action: async (options) => {
    // Initialize hooks for this session
    const hooks = new AgenticFlowHooks(options.sessionId);
    
    // Use hooks throughout your command
    await hooks.executeWithHooks('llm-call', async () => {
      // Your LLM call logic
    });
  },
};
```

## Troubleshooting

### Common Issues

1. **Hooks not executing**
   - Check hook registration and priority
   - Verify hook type matches execution call
   - Ensure context is properly initialized

2. **Performance degradation**
   - Review hook execution times in metrics
   - Check for blocking operations
   - Consider using parallel stages

3. **Memory leaks**
   - Monitor memory metrics
   - Implement proper cleanup in hooks
   - Use TTL for cached data

### Debug Mode

Enable debug logging:

```typescript
import { Logger } from '@claude-flow/core';

Logger.setLevel('debug');

// Hook execution will now log detailed information
```

## API Reference

For complete API documentation, see:
- [Hook Manager API](./api/hook-manager.md)
- [Hook Types Reference](./api/hook-types.md)
- [Context Builder API](./api/context-builder.md)

## Contributing

To contribute to the hook system:

1. Fork the repository
2. Create a feature branch
3. Add tests for new hooks
4. Submit a pull request

See [CONTRIBUTING.md](../CONTRIBUTING.md) for details.