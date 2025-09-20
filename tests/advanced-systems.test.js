/**
 * Comprehensive tests for advanced Claude Flow MCP systems
 * 
 * Tests real implementations of:
 * - Implicit Learning Engine
 * - Advanced Workflow Engine
 * - Autonomous Lifecycle Manager
 */

import { jest } from '@jest/globals';
import { ImplicitLearningEngine } from '../src/orchestration/implicit-learning-engine.js';
import { AdvancedWorkflowEngine } from '../src/orchestration/advanced-workflow-engine.js';
import { AutonomousLifecycleManager } from '../src/agents/autonomous-lifecycle-manager.js';

describe('Advanced Systems Integration Tests', () => {
  
  describe('Implicit Learning Engine', () => {
    let learningEngine;
    
    beforeEach(() => {
      learningEngine = new ImplicitLearningEngine({
        contextWindowSize: 100,
        embeddingDim: 128,
        convergenceThreshold: 0.01
      });
    });
    
    afterEach(async () => {
      await learningEngine.cleanup();
    });
    
    test('should process context and perform implicit weight updates', async () => {
      const context = {
        task: 'optimization',
        performance: { success: true, duration: 150 },
        resources: { cpu: 0.45, memory: 0.6 }
      };
      
      const result = await learningEngine.processContext(context);
      
      expect(result.success).toBe(true);
      expect(result.metrics).toBeDefined();
      expect(result.metrics.iterations).toBeGreaterThan(0);
    });
    
    test('should learn patterns from successful orchestrations', async () => {
      const pattern1 = {
        task: 'data-processing',
        strategy: 'parallel',
        resources: { workers: 4 }
      };
      
      const outcome1 = {
        success: true,
        performance: { duration: 200, efficiency: 0.9 }
      };
      
      const result = await learningEngine.learnPattern('pattern-1', pattern1, outcome1);
      
      expect(result.success).toBe(true);
      expect(result.patternId).toBe('pattern-1');
      
      // Verify pattern was stored
      const insights = learningEngine.generateLearningInsights();
      expect(insights.totalPatterns).toBe(1);
    });
    
    test('should apply learned patterns to similar contexts', async () => {
      // First, learn a pattern
      await learningEngine.learnPattern('optimization-pattern', {
        type: 'optimization',
        config: { algorithm: 'gradient-descent' }
      }, {
        success: true,
        improvement: 0.25
      });
      
      // Apply to similar context
      const similarContext = {
        type: 'optimization',
        config: { algorithm: 'gradient-descent', learningRate: 0.01 }
      };
      
      const result = await learningEngine.applyLearnedPatterns(similarContext);
      
      expect(result.success).toBe(true);
      expect(result.appliedPattern).toBe('optimization-pattern');
      expect(result.similarity).toBeGreaterThan(0.7);
    });
    
    test('should converge with increasing context', async () => {
      const contexts = Array(20).fill(null).map((_, i) => ({
        iteration: i,
        value: Math.random()
      }));
      
      let lastLoss = Infinity;
      
      for (const context of contexts) {
        const result = await learningEngine.processContext(context);
        
        if (result.metrics.loss < lastLoss) {
          lastLoss = result.metrics.loss;
        }
      }
      
      // Loss should decrease over time
      expect(lastLoss).toBeLessThan(learningEngine.config.convergenceThreshold * 10);
    });
    
    test('should export and import models', async () => {
      // Learn some patterns
      await learningEngine.learnPattern('test-pattern', 
        { type: 'test' }, 
        { success: true }
      );
      
      // Export model
      const model = await learningEngine.exportModel();
      
      expect(model.patterns).toHaveLength(1);
      expect(model.version).toBe('1.0.0');
      
      // Create new engine and import
      const newEngine = new ImplicitLearningEngine();
      const importResult = await newEngine.importModel(model);
      
      expect(importResult.success).toBe(true);
      
      // Verify imported data
      const insights = newEngine.generateLearningInsights();
      expect(insights.totalPatterns).toBe(1);
      
      await newEngine.cleanup();
    });
  });
  
  describe('Advanced Workflow Engine', () => {
    let workflowEngine;
    
    beforeEach(() => {
      workflowEngine = new AdvancedWorkflowEngine({
        maxWorkers: 2,
        maxConcurrentWorkflows: 5
      });
    });
    
    afterEach(async () => {
      await workflowEngine.cleanup();
    });
    
    test('should create and execute simple workflow', async () => {
      const workflow = await workflowEngine.createWorkflow({
        name: 'Test Workflow',
        tasks: [
          {
            id: 'task1',
            name: 'Wait Task',
            type: 'wait',
            params: { duration: 100 }
          },
          {
            id: 'task2',
            name: 'Transform Task',
            type: 'transform',
            params: {
              input: [1, 2, 3],
              operations: [
                { type: 'map', fn: 'x => x * 2' }
              ]
            },
            dependencies: ['task1']
          }
        ]
      });
      
      expect(workflow.workflowId).toBeDefined();
      expect(workflow.workflow.tasks.size).toBe(2);
      
      // Execute workflow
      const result = await workflowEngine.executeWorkflow(workflow.workflowId);
      
      expect(result.success).toBe(true);
      expect(result.results.task2).toEqual([2, 4, 6]);
    });
    
    test('should handle parallel task execution', async () => {
      const workflow = await workflowEngine.createWorkflow({
        name: 'Parallel Workflow',
        tasks: [
          {
            id: 'parallel1',
            name: 'Parallel Task 1',
            type: 'wait',
            params: { duration: 100 }
          },
          {
            id: 'parallel2',
            name: 'Parallel Task 2',
            type: 'wait',
            params: { duration: 100 }
          },
          {
            id: 'final',
            name: 'Final Task',
            type: 'conditional',
            params: {
              condition: '() => true',
              trueBranch: { success: true }
            },
            dependencies: ['parallel1', 'parallel2']
          }
        ]
      });
      
      const startTime = Date.now();
      const result = await workflowEngine.executeWorkflow(workflow.workflowId);
      const duration = Date.now() - startTime;
      
      expect(result.success).toBe(true);
      // Should execute in parallel, so duration should be ~100ms, not 200ms
      expect(duration).toBeLessThan(150);
    });
    
    test('should handle workflow templates', async () => {
      // Create workflow
      const workflow = await workflowEngine.createWorkflow({
        name: 'Template Source',
        tasks: [
          {
            id: 'process',
            name: 'Process Data',
            type: 'transform',
            params: {
              input: '{{input}}',
              operations: [
                { type: 'map', fn: '{{transformer}}' }
              ]
            }
          }
        ]
      });
      
      // Save as template
      const template = workflowEngine.saveAsTemplate(
        workflow.workflowId,
        'data-processor',
        { name: 'Data Processing Template' }
      );
      
      expect(template.id).toBe('data-processor');
      
      // Create from template
      const newWorkflow = await workflowEngine.createFromTemplate('data-processor', {
        name: 'Instance from Template',
        taskParams: {
          process: {
            input: [1, 2, 3],
            transformer: 'x => x * 3'
          }
        }
      });
      
      expect(newWorkflow.workflow.name).toBe('Instance from Template');
    });
    
    test('should handle task retries on failure', async () => {
      let attempts = 0;
      
      // Register custom handler that fails first time
      workflowEngine.registerHandler('flaky', async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Temporary failure');
        }
        return { success: true, attempts };
      });
      
      const workflow = await workflowEngine.createWorkflow({
        name: 'Retry Workflow',
        tasks: [
          {
            id: 'flaky-task',
            name: 'Flaky Task',
            type: 'flaky',
            retryPolicy: { attempts: 3 }
          }
        ]
      });
      
      const result = await workflowEngine.executeWorkflow(workflow.workflowId);
      
      expect(result.success).toBe(true);
      expect(result.results['flaky-task'].attempts).toBe(2);
    });
    
    test('should track workflow progress', async () => {
      const workflow = await workflowEngine.createWorkflow({
        name: 'Progress Workflow',
        tasks: Array(5).fill(null).map((_, i) => ({
          id: `task${i}`,
          name: `Task ${i}`,
          type: 'wait',
          params: { duration: 50 },
          dependencies: i > 0 ? [`task${i-1}`] : []
        }))
      });
      
      // Start execution
      const executionPromise = workflowEngine.executeWorkflow(workflow.workflowId);
      
      // Check progress while running
      await new Promise(resolve => setTimeout(resolve, 100));
      const status = workflowEngine.getWorkflowStatus(workflow.workflowId);
      
      expect(status.status).toBe('running');
      expect(status.progress.completed).toBeGreaterThan(0);
      expect(status.progress.completed).toBeLessThan(5);
      
      // Wait for completion
      await executionPromise;
      
      const finalStatus = workflowEngine.getWorkflowStatus(workflow.workflowId);
      expect(finalStatus.status).toBe('completed');
      expect(finalStatus.progress.completed).toBe(5);
    });
  });
  
  describe('Autonomous Lifecycle Manager', () => {
    let lifecycleManager;
    
    beforeEach(() => {
      lifecycleManager = new AutonomousLifecycleManager({
        maxAgents: 10,
        minAgents: 1,
        healthCheckInterval: 1000,
        evolutionInterval: 5000
      });
    });
    
    afterEach(async () => {
      await lifecycleManager.cleanup();
    });
    
    test('should spawn and initialize agents', async () => {
      const agent = await lifecycleManager.spawnAgent({
        type: 'worker',
        name: 'Test Worker',
        capabilities: ['processing', 'analysis']
      });
      
      expect(agent.id).toBeDefined();
      expect(agent.state).toBe('active');
      expect(agent.capabilities).toContain('processing');
      expect(agent.generation).toBe(1);
    });
    
    test('should track agent activity and performance', async () => {
      const agent = await lifecycleManager.spawnAgent({
        type: 'analyzer',
        capabilities: ['data-analysis']
      });
      
      // Record successful activity
      lifecycleManager.recordActivity(agent.id, {
        type: 'task-completed',
        duration: 150,
        outcome: 'success'
      });
      
      // Record failed activity
      lifecycleManager.recordActivity(agent.id, {
        type: 'task-failed',
        reason: 'timeout'
      });
      
      const updatedAgent = lifecycleManager.agents.get(agent.id);
      expect(updatedAgent.performance.tasksCompleted).toBe(1);
      expect(updatedAgent.performance.tasksFailed).toBe(1);
      expect(updatedAgent.performance.avgResponseTime).toBe(150);
      expect(updatedAgent.performance.successRate).toBe(0.5);
    });
    
    test('should handle agent state transitions', async () => {
      const agent = await lifecycleManager.spawnAgent({
        type: 'learner',
        capabilities: ['learning']
      });
      
      // Transition to learning state
      await lifecycleManager.updateAgentState(
        agent.id,
        'learning',
        'scheduled-learning'
      );
      
      // Wait for learning to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const updatedAgent = lifecycleManager.agents.get(agent.id);
      expect(updatedAgent.state).toBe('active'); // Should return to active after learning
    });
    
    test('should hibernate and wake agents', async () => {
      const agent = await lifecycleManager.spawnAgent({
        type: 'hibernator',
        capabilities: ['hibernation-test']
      });
      
      // Hibernate agent
      await lifecycleManager.updateAgentState(
        agent.id,
        'hibernating',
        'resource-conservation'
      );
      
      expect(agent.state).toBe('hibernating');
      expect(agent.hibernation).toBeDefined();
      
      // Wake agent
      const wakenAgent = await lifecycleManager.wakeAgent(agent.id);
      
      expect(wakenAgent.state).toBe('active');
      expect(wakenAgent.hibernation).toBeUndefined();
    });
    
    test('should calculate lifecycle statistics', async () => {
      // Spawn multiple agents
      await lifecycleManager.spawnAgent({ type: 'worker', capabilities: ['work'] });
      await lifecycleManager.spawnAgent({ type: 'analyzer', capabilities: ['analyze'] });
      await lifecycleManager.spawnAgent({ type: 'worker', capabilities: ['work'] });
      
      const stats = lifecycleManager.getLifecycleStats();
      
      expect(stats.totalAgents).toBe(3);
      expect(stats.byType.worker).toBe(2);
      expect(stats.byType.analyzer).toBe(1);
      expect(stats.byState.active).toBe(3);
      expect(stats.avgGeneration).toBe(1);
    });
    
    test('should handle agent evolution', async () => {
      const agent = await lifecycleManager.spawnAgent({
        type: 'evolver',
        capabilities: ['evolution']
      });
      
      // Add experiences to trigger evolution
      for (let i = 0; i < 15; i++) {
        lifecycleManager.recordActivity(agent.id, {
          type: 'task-completed',
          duration: 100,
          learningValue: true,
          outcome: 'success',
          learnings: { pattern: `pattern-${i}` }
        });
      }
      
      // Force evolution
      await lifecycleManager.updateAgentState(
        agent.id,
        'evolving',
        'performance-triggered'
      );
      
      // Wait for evolution
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const evolvedAgent = lifecycleManager.agents.get(agent.id);
      expect(evolvedAgent.generation).toBe(2);
      expect(evolvedAgent.evolution.mutations.length).toBeGreaterThan(0);
    });
  });
  
  describe('System Integration', () => {
    test('should integrate learning with workflow execution', async () => {
      const learningEngine = new ImplicitLearningEngine();
      const workflowEngine = new AdvancedWorkflowEngine();
      
      // Create workflow
      const workflow = await workflowEngine.createWorkflow({
        name: 'Learning Workflow',
        tasks: [
          {
            id: 'process',
            type: 'transform',
            params: {
              input: [1, 2, 3, 4, 5],
              operations: [
                { type: 'filter', fn: 'x => x > 2' },
                { type: 'map', fn: 'x => x * 2' }
              ]
            }
          }
        ]
      });
      
      // Execute and learn
      const result = await workflowEngine.executeWorkflow(workflow.workflowId);
      
      if (result.success) {
        await learningEngine.learnPattern(
          'transform-workflow',
          { workflowId: workflow.workflowId, type: 'transform' },
          { success: true, result: result.results }
        );
      }
      
      const insights = learningEngine.generateLearningInsights();
      expect(insights.totalPatterns).toBe(1);
      
      await learningEngine.cleanup();
      await workflowEngine.cleanup();
    });
    
    test('should integrate lifecycle management with workflow execution', async () => {
      const lifecycleManager = new AutonomousLifecycleManager();
      const workflowEngine = new AdvancedWorkflowEngine();
      
      // Spawn workflow executor agent
      const agent = await lifecycleManager.spawnAgent({
        type: 'workflow-executor',
        capabilities: ['workflow-execution']
      });
      
      // Create and execute workflow
      const workflow = await workflowEngine.createWorkflow({
        name: 'Agent Workflow',
        tasks: [
          { id: 'task1', type: 'wait', params: { duration: 50 } }
        ]
      });
      
      const startTime = Date.now();
      const result = await workflowEngine.executeWorkflow(workflow.workflowId);
      const duration = Date.now() - startTime;
      
      // Record agent activity
      lifecycleManager.recordActivity(agent.id, {
        type: result.success ? 'task-completed' : 'task-failed',
        duration,
        workflowId: workflow.workflowId
      });
      
      const agentStats = lifecycleManager.agents.get(agent.id);
      expect(agentStats.performance.tasksCompleted).toBe(1);
      
      await lifecycleManager.cleanup();
      await workflowEngine.cleanup();
    });
  });
});

// Performance benchmarks
describe('Performance Benchmarks', () => {
  test('Implicit Learning Engine performance', async () => {
    const engine = new ImplicitLearningEngine({
      contextWindowSize: 1000,
      embeddingDim: 256
    });
    
    const startTime = Date.now();
    const contexts = 100;
    
    for (let i = 0; i < contexts; i++) {
      await engine.processContext({
        id: i,
        data: Array(100).fill(Math.random())
      });
    }
    
    const duration = Date.now() - startTime;
    const avgTime = duration / contexts;
    
    console.log(`Implicit Learning: ${avgTime.toFixed(2)}ms per context`);
    expect(avgTime).toBeLessThan(50); // Should process each context in < 50ms
    
    await engine.cleanup();
  });
  
  test('Workflow Engine performance', async () => {
    const engine = new AdvancedWorkflowEngine({ maxWorkers: 4 });
    
    // Create complex workflow
    const workflow = await engine.createWorkflow({
      name: 'Performance Test',
      tasks: Array(20).fill(null).map((_, i) => ({
        id: `task${i}`,
        type: 'transform',
        params: {
          input: Array(100).fill(i),
          operations: [
            { type: 'map', fn: 'x => x * 2' },
            { type: 'filter', fn: 'x => x > 10' }
          ]
        },
        dependencies: i > 0 && i % 4 !== 0 ? [`task${i-1}`] : []
      }))
    });
    
    const startTime = Date.now();
    const result = await engine.executeWorkflow(workflow.workflowId);
    const duration = Date.now() - startTime;
    
    console.log(`Workflow execution (20 tasks): ${duration}ms`);
    expect(result.success).toBe(true);
    expect(duration).toBeLessThan(5000); // Should complete in < 5 seconds
    
    await engine.cleanup();
  });
  
  test('Lifecycle Manager performance', async () => {
    const manager = new AutonomousLifecycleManager({ maxAgents: 20 });
    
    const startTime = Date.now();
    
    // Spawn multiple agents
    const promises = Array(10).fill(null).map((_, i) => 
      manager.spawnAgent({
        type: 'performance-test',
        capabilities: [`capability-${i}`]
      })
    );
    
    await Promise.all(promises);
    
    const spawnDuration = Date.now() - startTime;
    console.log(`Agent spawning (10 agents): ${spawnDuration}ms`);
    
    // Record activities
    const activityStart = Date.now();
    
    for (const agent of manager.agents.values()) {
      for (let i = 0; i < 10; i++) {
        manager.recordActivity(agent.id, {
          type: 'task-completed',
          duration: Math.random() * 100
        });
      }
    }
    
    const activityDuration = Date.now() - activityStart;
    console.log(`Activity recording (100 activities): ${activityDuration}ms`);
    
    expect(spawnDuration).toBeLessThan(1000); // < 100ms per agent
    expect(activityDuration).toBeLessThan(100); // < 1ms per activity
    
    await manager.cleanup();
  });
});