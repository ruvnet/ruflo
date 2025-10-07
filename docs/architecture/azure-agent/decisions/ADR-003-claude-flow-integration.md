# ADR-003: Claude Flow Integration Approach

## Status
Proposed

## Context
The Azure Agent needs to integrate with Claude Flow for orchestration, memory management, and swarm coordination. Claude Flow provides hooks, memory storage, and multi-agent coordination capabilities. We need to decide:
1. Which Claude Flow features to use
2. How to integrate hooks into the agent lifecycle
3. How to use memory for state persistence
4. How to coordinate with other agents

## Decision
We will implement deep integration with Claude Flow using:

### 1. Hooks Integration
Execute Claude Flow hooks at key operation boundaries:

**Pre-Operation Hooks:**
- `pre-task`: Before starting any operation
- `pre-edit`: Before modifying configuration files

**Post-Operation Hooks:**
- `post-task`: After operation completion (success or failure)
- `post-edit`: After file modifications, with memory storage

**Session Hooks:**
- `session-restore`: Restore context at agent startup
- `session-end`: Export metrics at agent shutdown

**Notification Hooks:**
- `notify`: Real-time notifications for important events

**Hook Execution Policy:**
- Execute hooks asynchronously
- Don't fail operations on hook errors
- Log hook failures for debugging
- Timeout hooks after 30 seconds

### 2. Memory Integration
Use Claude Flow memory for:

**Operation Context:**
- Store operation results for 24 hours
- Store error details for debugging
- Cache resource state for 5 minutes

**Agent Coordination:**
- Publish agent status (TTL: 1 minute)
- Share deployment plans (TTL: 1 hour)
- Coordinate multi-step operations (TTL: 6 hours)

**Workflow State:**
- Persist workflow state for resumption
- Store checkpoints for rollback
- Track task progress

**Memory Namespace Structure:**
```
swarm/
  azure-agent/
    operations/
      {operation-id}/
        context
        result
        error
    resources/
      {resource-id}/
        state
        metadata
    workflows/
      {workflow-id}/
        state
        checkpoints
    agents/
      {agent-id}/
        status
        capabilities
    shared/
      deployment-plans
      coordination-data
```

### 3. Swarm Coordination
Support multiple coordination topologies:

**Mesh Topology** (Default):
- Peer-to-peer coordination
- Each agent has equal authority
- Best for: Multi-region deployments

**Hierarchical Topology**:
- Coordinator agent + worker agents
- Coordinator assigns tasks
- Best for: Complex workflows with dependencies

**Adaptive Topology**:
- Dynamic topology based on workload
- Automatic load balancing
- Best for: Variable workloads

**Coordination Patterns:**
- Task distribution
- Shared context
- Progress reporting
- Resource locking
- Conflict resolution

### 4. Event System
Bridge agent events to Claude Flow:

**Operation Events:**
- operation.started
- operation.completed
- operation.failed

**Resource Events:**
- resource.created
- resource.updated
- resource.deleted

**Error Events:**
- error.occurred
- error.recovered

**Coordination Events:**
- task.assigned
- task.completed
- agent.joined
- agent.left

## Rationale

### Hooks Benefits
1. **Observability**: Track all operations in Claude Flow
2. **Automation**: Enable pre/post operation workflows
3. **Integration**: Connect with other Claude Flow features
4. **Debugging**: Operation history for troubleshooting

### Memory Benefits
1. **Context Preservation**: Maintain state across sessions
2. **Agent Coordination**: Share data between agents
3. **Caching**: Improve performance with shared cache
4. **Recovery**: Resume operations after failures

### Swarm Benefits
1. **Scalability**: Distribute work across multiple agents
2. **Reliability**: Continue operations if one agent fails
3. **Performance**: Parallel execution of independent tasks
4. **Geographic**: Deploy across multiple regions

### Event System Benefits
1. **Real-time Monitoring**: Live operation tracking
2. **Alerting**: Immediate notification of issues
3. **Analytics**: Understand usage patterns
4. **Integration**: Connect with external systems

## Consequences

### Positive
1. **Unified Platform**: All agents use same orchestration
2. **Shared Context**: Agents can build on each other's work
3. **Observability**: Complete operation visibility
4. **Scalability**: Easy to add more agents
5. **Reliability**: Built-in coordination and recovery

### Negative
1. **Dependency**: Requires Claude Flow to be running
2. **Network**: Additional network calls for hooks/memory
3. **Complexity**: Coordination logic adds complexity
4. **Latency**: Hooks add overhead to operations

### Mitigation Strategies
1. **Graceful Degradation**: Continue without Claude Flow if unavailable
2. **Async Execution**: Don't block on hook execution
3. **Caching**: Minimize memory access
4. **Configuration**: Make integration optional

## Integration Patterns

### Pattern 1: Simple Operation with Hooks
```typescript
async deployWebApp(config: WebAppConfig): Promise<Result> {
  // Pre-task hook
  await this.hooks.executeHook('pre-task', {
    description: `Deploy web app to ${config.location}`
  });

  try {
    // Execute deployment
    const result = await this.execute(config);

    // Post-task hook (success)
    await this.hooks.executeHook('post-task', {
      taskId: result.id,
      success: true,
      result
    });

    return result;
  } catch (error) {
    // Post-task hook (failure)
    await this.hooks.executeHook('post-task', {
      taskId: config.name,
      success: false,
      error: error.message
    });

    throw error;
  }
}
```

### Pattern 2: Multi-Agent Coordination
```typescript
async deployMultiRegion(spec: MultiRegionSpec): Promise<Result> {
  // Initialize swarm
  await this.swarm.initialize('mesh', {
    maxAgents: spec.regions.length
  });

  // Publish deployment plan to memory
  await this.memory.store('shared/deployment-plan', spec, {
    namespace: 'swarm/azure-agent',
    ttl: 3600
  });

  // Coordinate with other agents
  await this.swarm.coordinate({
    from: this.agentId,
    type: 'notification',
    content: {
      operation: 'multi-region-deploy',
      regions: spec.regions
    }
  });

  // Execute assigned region
  const myRegion = await this.getAssignedRegion();
  const result = await this.deployToRegion(myRegion, spec);

  // Report progress
  await this.swarm.reportProgress(spec.deploymentId, {
    taskId: spec.deploymentId,
    status: 'completed',
    progress: 100
  });

  return result;
}
```

### Pattern 3: Stateful Workflow
```typescript
async executeWorkflow(workflow: Workflow): Promise<Result> {
  // Restore workflow state if exists
  const state = await this.memory.retrieve(
    `workflow/${workflow.id}`
  );

  if (state) {
    // Resume from checkpoint
    return await this.resumeWorkflow(workflow, state);
  }

  // Execute workflow with checkpoints
  for (const step of workflow.steps) {
    const result = await this.executeStep(step);

    // Save checkpoint
    await this.memory.store(
      `workflow/${workflow.id}`,
      {
        currentStep: step.id,
        results: this.results,
        timestamp: new Date()
      }
    );

    // Post-edit hook with memory key
    await this.hooks.executeHook('post-edit', {
      file: `workflow-${workflow.id}.json`,
      memoryKey: `swarm/azure-agent/workflow/${workflow.id}`
    });
  }

  return this.aggregateResults();
}
```

## Configuration

### Minimal Configuration (Hooks Only)
```yaml
integration:
  claudeFlow:
    enabled: true
    hooks:
      enabled: true
      preTask: true
      postTask: true
    memory:
      enabled: false
    swarm:
      enabled: false
```

### Full Integration Configuration
```yaml
integration:
  claudeFlow:
    enabled: true
    hooks:
      enabled: true
      preTask: true
      postTask: true
      preEdit: true
      postEdit: true
      sessionRestore: true
      sessionEnd: true
      notify: true
    memory:
      enabled: true
      namespace: swarm/azure-agent
      storeResults: true
      storeErrors: true
      ttl: 86400  # 24 hours
    swarm:
      enabled: true
      topology: mesh
      role: worker
      patterns:
        - task-distribution
        - shared-context
    events:
      enabled: true
      forwardToClaudeFlow: true
      storeInMemory: true
```

## Performance Considerations

### Hook Execution
- Execute hooks asynchronously
- Use Promise.allSettled for non-critical hooks
- Timeout after 30 seconds
- Cache hook results when possible

### Memory Access
- Batch read operations
- Use TTL to control storage size
- Implement local cache for frequently accessed data
- Clean up expired entries

### Swarm Coordination
- Minimize coordination messages
- Use broadcast for announcements
- Direct messages for specific coordination
- Rate limit coordination calls

## Testing Strategy

### Unit Tests
- Mock Claude Flow hooks
- Test hook failure scenarios
- Test memory operations
- Test swarm coordination

### Integration Tests
- Test with real Claude Flow instance
- Verify hook execution
- Verify memory persistence
- Test multi-agent scenarios

### Performance Tests
- Measure hook overhead
- Test with high memory access
- Test swarm coordination latency
- Measure event throughput

## Migration Path

### Phase 1: Hooks Only (Week 1)
- Implement hook service
- Add pre/post task hooks
- Test with Claude Flow

### Phase 2: Memory Integration (Week 2)
- Implement memory service
- Add state persistence
- Add caching

### Phase 3: Swarm Coordination (Week 3)
- Implement swarm service
- Add mesh topology support
- Add hierarchical topology

### Phase 4: Events (Week 4)
- Implement event bridge
- Add event forwarding
- Add event storage

## References
- [Claude Flow Documentation](https://github.com/ruvnet/claude-flow)
- [Claude Flow Hooks](https://github.com/ruvnet/claude-flow#hooks)
- [Claude Flow Memory](https://github.com/ruvnet/claude-flow#memory)
- [Claude Flow Swarm](https://github.com/ruvnet/claude-flow#swarm)

## Related ADRs
- ADR-001: Architecture Overview
- ADR-004: Configuration Management
- ADR-006: Observability Strategy
