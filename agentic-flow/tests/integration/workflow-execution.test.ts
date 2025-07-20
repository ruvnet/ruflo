/**
 * Workflow Execution Integration Tests
 * Tests complete workflow execution with real agent integration and state management
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { IntegrationTestFramework, IntegrationTestContext, waitForEvent, measureTime, TestDataFactory } from './test-infrastructure';
import { WorkflowEngine } from '../../src/workflows/engine/workflow-engine';
import { WorkflowDefinition, WorkflowStatus } from '../../src/workflows/types';

describe('Workflow Execution Integration Tests', () => {
  let framework: IntegrationTestFramework;
  let testContext: IntegrationTestContext;

  beforeAll(async () => {
    framework = new IntegrationTestFramework();
  });

  afterAll(async () => {
    await framework.cleanup();
  });

  beforeEach(async () => {
    testContext = await framework.createTestContext({
      name: 'Workflow Execution Test',
      agents: {
        count: 4,
        types: ['researcher', 'coder', 'analyst', 'reviewer']
      },
      providers: {
        anthropic: { apiKey: process.env.ANTHROPIC_API_KEY || 'test-key' }
      },
      enableRealProviders: process.env.RUN_REAL_API_TESTS === 'true',
      enablePersistence: true,
      timeout: 90000
    });
  });

  afterEach(async () => {
    await testContext.cleanup();
  });

  describe('Simple Workflow Execution', () => {
    it('should execute a simple linear workflow successfully', async () => {
      const workflowEngine = testContext.workflowEngine;
      const workflowDef = TestDataFactory.createWorkflowDefinition('Simple Linear Workflow', 'simple');
      
      // Add workflow execution tracking
      const executionEvents: any[] = [];
      workflowEngine.on('workflow:started', (event) => executionEvents.push({ type: 'started', ...event }));
      workflowEngine.on('workflow:step-completed', (event) => executionEvents.push({ type: 'step-completed', ...event }));
      workflowEngine.on('workflow:completed', (event) => executionEvents.push({ type: 'completed', ...event }));

      const { result: instanceId, duration: startDuration } = await measureTime(async () => {
        return await workflowEngine.startWorkflow(workflowDef, {
          input: 'Test workflow execution input',
          timestamp: Date.now()
        });
      });

      expect(instanceId).toBeDefined();
      framework.recordMetric(testContext.id, 'workflow_start_duration', startDuration);

      // Wait for workflow completion
      const completionResult = await waitForEvent(workflowEngine, 'workflow:completed', 30000);
      expect(completionResult.instanceId).toBe(instanceId);
      expect(completionResult.status).toBe('completed');

      // Verify execution flow
      const startedEvents = executionEvents.filter(e => e.type === 'started');
      const stepEvents = executionEvents.filter(e => e.type === 'step-completed');
      const completedEvents = executionEvents.filter(e => e.type === 'completed');

      expect(startedEvents.length).toBe(1);
      expect(stepEvents.length).toBeGreaterThan(0);
      expect(completedEvents.length).toBe(1);

      framework.recordMetric(testContext.id, 'simple_workflow_steps', stepEvents.length);
      framework.recordMetric(testContext.id, 'simple_workflow_success', true);
    });

    it('should handle workflow inputs and outputs correctly', async () => {
      const workflowEngine = testContext.workflowEngine;
      const workflowDef = TestDataFactory.createWorkflowDefinition('Input-Output Test Workflow', 'simple');
      
      const testInputs = {
        userInput: 'Process this data: [1, 2, 3, 4, 5]',
        options: { processType: 'analysis', format: 'json' },
        metadata: { requestId: 'test-123', userId: 'test-user' }
      };

      const instanceId = await workflowEngine.startWorkflow(workflowDef, testInputs);
      
      // Wait for completion
      await waitForEvent(workflowEngine, 'workflow:completed', 20000);
      
      // Get workflow instance and check outputs
      const instance = await workflowEngine.getWorkflowInstance(instanceId);
      expect(instance).toBeDefined();
      expect(instance.context.inputs).toEqual(testInputs);
      expect(instance.context.outputs).toBeDefined();
      expect(instance.status).toBe('completed');

      framework.recordMetric(testContext.id, 'workflow_io_success', true);
      framework.recordMetric(testContext.id, 'workflow_input_size', JSON.stringify(testInputs).length);
    });

    it('should persist workflow state correctly', async () => {
      const workflowEngine = testContext.workflowEngine;
      const workflowDef = TestDataFactory.createWorkflowDefinition('Persistence Test Workflow', 'medium');
      
      const instanceId = await workflowEngine.startWorkflow(workflowDef, { test: 'persistence' });
      
      // Pause workflow mid-execution
      await new Promise(resolve => setTimeout(resolve, 1000));
      await workflowEngine.pauseWorkflow(instanceId);
      
      // Verify persisted state
      const pausedInstance = await workflowEngine.getWorkflowInstance(instanceId);
      expect(pausedInstance.status).toBe('paused');
      
      // Resume and complete
      await workflowEngine.resumeWorkflow(instanceId);
      await waitForEvent(workflowEngine, 'workflow:completed', 20000);
      
      const completedInstance = await workflowEngine.getWorkflowInstance(instanceId);
      expect(completedInstance.status).toBe('completed');

      framework.recordMetric(testContext.id, 'workflow_persistence_success', true);
    });
  });

  describe('Complex Workflow Execution', () => {
    it('should execute workflows with parallel branches', async () => {
      const workflowEngine = testContext.workflowEngine;
      const complexWorkflow = TestDataFactory.createWorkflowDefinition('Parallel Workflow', 'complex');
      
      const branchCompletions: any[] = [];
      workflowEngine.on('workflow:step-completed', (event) => {
        if (event.stepType === 'agent-task') {
          branchCompletions.push({
            stepId: event.stepId,
            timestamp: Date.now(),
            result: event.result
          });
        }
      });

      const { result: instanceId, duration } = await measureTime(async () => {
        return await workflowEngine.startWorkflow(complexWorkflow, {
          parallelInput: 'Data for parallel processing',
          branchCount: 3
        });
      });

      // Wait for completion of parallel workflow
      await waitForEvent(workflowEngine, 'workflow:completed', 45000);
      
      // Verify parallel execution
      expect(branchCompletions.length).toBeGreaterThanOrEqual(3);
      
      // Check that parallel branches executed concurrently (within reasonable time window)
      if (branchCompletions.length >= 3) {
        const timestamps = branchCompletions.slice(0, 3).map(b => b.timestamp);
        const timeSpread = Math.max(...timestamps) - Math.min(...timestamps);
        expect(timeSpread).toBeLessThan(10000); // Should complete within 10 seconds of each other
      }

      framework.recordMetric(testContext.id, 'parallel_workflow_duration', duration);
      framework.recordMetric(testContext.id, 'parallel_branches_completed', branchCompletions.length);
    });

    it('should handle conditional workflow branches', async () => {
      const workflowEngine = testContext.workflowEngine;
      
      // Create workflow with decision point
      const conditionalWorkflow: WorkflowDefinition = {
        id: 'conditional-test',
        name: 'Conditional Branch Test',
        version: '1.0.0',
        description: 'Tests conditional workflow execution',
        nodes: [
          { id: 'start', type: 'start', name: 'Start' },
          { id: 'analysis', type: 'agent-task', name: 'Initial Analysis' },
          { id: 'decision', type: 'decision', name: 'Quality Check' },
          { id: 'approve', type: 'agent-task', name: 'Approve Path' },
          { id: 'reject', type: 'agent-task', name: 'Reject Path' },
          { id: 'end', type: 'end', name: 'End' }
        ],
        edges: [
          { from: 'start', to: 'analysis' },
          { from: 'analysis', to: 'decision' },
          { from: 'decision', to: 'approve', condition: 'quality_score >= 0.8' },
          { from: 'decision', to: 'reject', condition: 'quality_score < 0.8' },
          { from: 'approve', to: 'end' },
          { from: 'reject', to: 'end' }
        ],
        variables: {
          quality_score: 0.9 // Should trigger approve path
        },
        triggers: []
      };

      const pathTaken: string[] = [];
      workflowEngine.on('workflow:step-completed', (event) => {
        pathTaken.push(event.stepId);
      });

      await workflowEngine.startWorkflow(conditionalWorkflow, { quality_threshold: 0.8 });
      await waitForEvent(workflowEngine, 'workflow:completed', 30000);

      // Should have taken the approve path
      expect(pathTaken).toContain('approve');
      expect(pathTaken).not.toContain('reject');

      framework.recordMetric(testContext.id, 'conditional_workflow_success', true);
      framework.recordMetric(testContext.id, 'workflow_path_length', pathTaken.length);
    });

    it('should handle human-in-the-loop tasks', async () => {
      const workflowEngine = testContext.workflowEngine;
      
      const humanWorkflow: WorkflowDefinition = {
        id: 'human-loop-test',
        name: 'Human-in-the-Loop Test',
        version: '1.0.0',
        description: 'Tests human task integration',
        nodes: [
          { id: 'start', type: 'start', name: 'Start' },
          { id: 'prepare', type: 'agent-task', name: 'Prepare Data' },
          { id: 'human_review', type: 'human-task', name: 'Human Review' },
          { id: 'finalize', type: 'agent-task', name: 'Finalize' },
          { id: 'end', type: 'end', name: 'End' }
        ],
        edges: [
          { from: 'start', to: 'prepare' },
          { from: 'prepare', to: 'human_review' },
          { from: 'human_review', to: 'finalize' },
          { from: 'finalize', to: 'end' }
        ],
        variables: {},
        triggers: []
      };

      let humanTaskCreated = false;
      workflowEngine.on('human-task:created', (event) => {
        humanTaskCreated = true;
        
        // Simulate human response after delay
        setTimeout(async () => {
          await workflowEngine.completeHumanTask(event.taskId, {
            approved: true,
            feedback: 'Looks good to proceed',
            reviewer: 'test-reviewer'
          });
        }, 500);
      });

      const instanceId = await workflowEngine.startWorkflow(humanWorkflow, { review_required: true });
      await waitForEvent(workflowEngine, 'workflow:completed', 30000);

      expect(humanTaskCreated).toBe(true);
      
      const instance = await workflowEngine.getWorkflowInstance(instanceId);
      expect(instance.status).toBe('completed');

      framework.recordMetric(testContext.id, 'human_loop_workflow_success', true);
    });
  });

  describe('Workflow Error Handling and Recovery', () => {
    it('should handle step failures and retry logic', async () => {
      const workflowEngine = testContext.workflowEngine;
      
      const failureWorkflow: WorkflowDefinition = {
        id: 'failure-test',
        name: 'Failure Handling Test',
        version: '1.0.0',
        description: 'Tests error handling and recovery',
        nodes: [
          { id: 'start', type: 'start', name: 'Start' },
          { id: 'unstable_task', type: 'agent-task', name: 'Unstable Task', 
            config: { maxRetries: 3, retryDelay: 100 } },
          { id: 'recovery_task', type: 'agent-task', name: 'Recovery Task' },
          { id: 'end', type: 'end', name: 'End' }
        ],
        edges: [
          { from: 'start', to: 'unstable_task' },
          { from: 'unstable_task', to: 'recovery_task', condition: 'success' },
          { from: 'unstable_task', to: 'recovery_task', condition: 'failure' },
          { from: 'recovery_task', to: 'end' }
        ],
        variables: {},
        triggers: []
      };

      let retryCount = 0;
      let failureHandled = false;

      workflowEngine.on('workflow:step-retry', (event) => {
        retryCount++;
      });

      workflowEngine.on('workflow:step-failed', (event) => {
        failureHandled = true;
      });

      // Simulate task failure initially, then success
      let attemptCount = 0;
      const originalExecuteStep = workflowEngine.executeStep.bind(workflowEngine);
      workflowEngine.executeStep = async function(stepId, context) {
        if (stepId === 'unstable_task') {
          attemptCount++;
          if (attemptCount <= 2) {
            throw new Error('Simulated task failure');
          }
        }
        return originalExecuteStep(stepId, context);
      };

      const instanceId = await workflowEngine.startWorkflow(failureWorkflow, { test: 'failure-handling' });
      await waitForEvent(workflowEngine, 'workflow:completed', 30000);

      const instance = await workflowEngine.getWorkflowInstance(instanceId);
      expect(instance.status).toBe('completed');
      expect(retryCount).toBeGreaterThan(0);

      framework.recordMetric(testContext.id, 'workflow_retry_count', retryCount);
      framework.recordMetric(testContext.id, 'workflow_failure_recovery_success', true);
    });

    it('should handle workflow cancellation gracefully', async () => {
      const workflowEngine = testContext.workflowEngine;
      const longRunningWorkflow = TestDataFactory.createWorkflowDefinition('Long Running Workflow', 'complex');
      
      let cancellationHandled = false;
      workflowEngine.on('workflow:cancelled', (event) => {
        cancellationHandled = true;
      });

      const instanceId = await workflowEngine.startWorkflow(longRunningWorkflow, { 
        duration: 'long',
        steps: 10 
      });
      
      // Cancel after short delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      await workflowEngine.cancelWorkflow(instanceId, 'Test cancellation');
      
      // Wait for cancellation to complete
      await waitForEvent(workflowEngine, 'workflow:cancelled', 10000);
      
      const instance = await workflowEngine.getWorkflowInstance(instanceId);
      expect(instance.status).toBe('cancelled');
      expect(cancellationHandled).toBe(true);

      framework.recordMetric(testContext.id, 'workflow_cancellation_success', true);
    });

    it('should handle resource constraints and queuing', async () => {
      const workflowEngine = testContext.workflowEngine;
      
      // Create multiple workflows that exceed capacity
      const workflowCount = 15; // More than maxConcurrentWorkflows (10)
      const workflows = Array.from({ length: workflowCount }, (_, i) => 
        TestDataFactory.createWorkflowDefinition(`Resource Test Workflow ${i}`, 'simple')
      );

      const startTimes: number[] = [];
      const completeTimes: number[] = [];
      let queuedCount = 0;

      workflowEngine.on('workflow:queued', () => {
        queuedCount++;
      });

      workflowEngine.on('workflow:started', () => {
        startTimes.push(Date.now());
      });

      workflowEngine.on('workflow:completed', () => {
        completeTimes.push(Date.now());
      });

      // Start all workflows
      const startPromises = workflows.map(workflow => 
        workflowEngine.startWorkflow(workflow, { test: 'resource-constraints' })
      );

      const instanceIds = await Promise.all(startPromises);
      expect(instanceIds.length).toBe(workflowCount);

      // Wait for all to complete
      while (completeTimes.length < workflowCount) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      expect(queuedCount).toBeGreaterThan(0); // Some should have been queued
      expect(completeTimes.length).toBe(workflowCount);

      framework.recordMetric(testContext.id, 'workflows_queued', queuedCount);
      framework.recordMetric(testContext.id, 'resource_constraint_handling_success', true);
    });
  });

  describe('Workflow Performance and Monitoring', () => {
    it('should track detailed workflow execution metrics', async () => {
      const workflowEngine = testContext.workflowEngine;
      const workflowDef = TestDataFactory.createWorkflowDefinition('Metrics Test Workflow', 'medium');
      
      const metrics = {
        stepDurations: new Map<string, number>(),
        stepStartTimes: new Map<string, number>(),
        memoryUsage: [] as number[],
        agentUtilization: new Map<string, number>()
      };

      workflowEngine.on('workflow:step-started', (event) => {
        metrics.stepStartTimes.set(event.stepId, Date.now());
        metrics.memoryUsage.push(process.memoryUsage().heapUsed);
      });

      workflowEngine.on('workflow:step-completed', (event) => {
        const startTime = metrics.stepStartTimes.get(event.stepId);
        if (startTime) {
          metrics.stepDurations.set(event.stepId, Date.now() - startTime);
        }
      });

      const { result: instanceId, duration: totalDuration } = await measureTime(async () => {
        const id = await workflowEngine.startWorkflow(workflowDef, { 
          track_metrics: true,
          complexity: 'medium'
        });
        
        await waitForEvent(workflowEngine, 'workflow:completed', 30000);
        return id;
      });

      // Analyze metrics
      const stepDurationsArray = Array.from(metrics.stepDurations.values());
      const avgStepDuration = stepDurationsArray.reduce((a, b) => a + b, 0) / stepDurationsArray.length;
      const maxStepDuration = Math.max(...stepDurationsArray);
      
      const memoryPeak = Math.max(...metrics.memoryUsage);
      const memoryAvg = metrics.memoryUsage.reduce((a, b) => a + b, 0) / metrics.memoryUsage.length;

      framework.recordMetric(testContext.id, 'workflow_total_duration', totalDuration);
      framework.recordMetric(testContext.id, 'workflow_avg_step_duration', avgStepDuration);
      framework.recordMetric(testContext.id, 'workflow_max_step_duration', maxStepDuration);
      framework.recordMetric(testContext.id, 'workflow_memory_peak', memoryPeak);
      framework.recordMetric(testContext.id, 'workflow_memory_avg', memoryAvg);
      framework.recordMetric(testContext.id, 'workflow_steps_tracked', stepDurationsArray.length);

      expect(stepDurationsArray.length).toBeGreaterThan(0);
      expect(avgStepDuration).toBeGreaterThan(0);
      expect(memoryPeak).toBeGreaterThan(0);
    });

    it('should monitor workflow throughput under load', async () => {
      const workflowEngine = testContext.workflowEngine;
      const concurrentWorkflows = 8;
      
      const throughputMetrics = {
        startTimes: [] as number[],
        completionTimes: [] as number[],
        activeCount: 0,
        maxActive: 0
      };

      workflowEngine.on('workflow:started', () => {
        throughputMetrics.startTimes.push(Date.now());
        throughputMetrics.activeCount++;
        throughputMetrics.maxActive = Math.max(throughputMetrics.maxActive, throughputMetrics.activeCount);
      });

      workflowEngine.on('workflow:completed', () => {
        throughputMetrics.completionTimes.push(Date.now());
        throughputMetrics.activeCount--;
      });

      const { duration: totalDuration } = await measureTime(async () => {
        // Start concurrent workflows
        const workflows = Array.from({ length: concurrentWorkflows }, (_, i) => 
          TestDataFactory.createWorkflowDefinition(`Throughput Test ${i}`, 'simple')
        );

        const promises = workflows.map(workflow => 
          workflowEngine.startWorkflow(workflow, { test: 'throughput' })
        );

        await Promise.all(promises);

        // Wait for all completions
        while (throughputMetrics.completionTimes.length < concurrentWorkflows) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      });

      const throughput = concurrentWorkflows / (totalDuration / 1000); // workflows per second
      const avgLatency = totalDuration / concurrentWorkflows;

      framework.recordMetric(testContext.id, 'workflow_throughput', throughput);
      framework.recordMetric(testContext.id, 'workflow_avg_latency', avgLatency);
      framework.recordMetric(testContext.id, 'workflow_max_concurrent', throughputMetrics.maxActive);
      framework.recordMetric(testContext.id, 'workflow_load_test_duration', totalDuration);

      expect(throughput).toBeGreaterThan(0);
      expect(throughputMetrics.maxActive).toBeLessThanOrEqual(10); // Should respect maxConcurrentWorkflows
    });

    it('should provide workflow health and status monitoring', async () => {
      const workflowEngine = testContext.workflowEngine;
      
      // Start multiple workflows in different states
      const workflows = [
        { def: TestDataFactory.createWorkflowDefinition('Health Test 1', 'simple'), shouldPause: false },
        { def: TestDataFactory.createWorkflowDefinition('Health Test 2', 'simple'), shouldPause: true },
        { def: TestDataFactory.createWorkflowDefinition('Health Test 3', 'medium'), shouldPause: false }
      ];

      const instanceIds: string[] = [];
      
      for (const { def, shouldPause } of workflows) {
        const instanceId = await workflowEngine.startWorkflow(def, { health_test: true });
        instanceIds.push(instanceId);
        
        if (shouldPause) {
          await new Promise(resolve => setTimeout(resolve, 500));
          await workflowEngine.pauseWorkflow(instanceId);
        }
      }

      // Check health status
      const healthStatus = await workflowEngine.getHealthStatus();
      expect(healthStatus).toBeDefined();
      expect(healthStatus.activeWorkflows).toBeGreaterThan(0);
      expect(healthStatus.queuedWorkflows).toBeGreaterThanOrEqual(0);
      
      // Check individual workflow statuses
      const statuses = await Promise.all(
        instanceIds.map(id => workflowEngine.getWorkflowStatus(id))
      );

      const runningCount = statuses.filter(s => s === 'running').length;
      const pausedCount = statuses.filter(s => s === 'paused').length;
      
      expect(runningCount).toBeGreaterThan(0);
      expect(pausedCount).toBeGreaterThan(0);

      framework.recordMetric(testContext.id, 'workflow_health_check_success', true);
      framework.recordMetric(testContext.id, 'workflow_running_count', runningCount);
      framework.recordMetric(testContext.id, 'workflow_paused_count', pausedCount);

      // Cleanup
      for (const instanceId of instanceIds) {
        try {
          await workflowEngine.cancelWorkflow(instanceId, 'Test cleanup');
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('Workflow Integration Metrics', () => {
    it('should report comprehensive workflow execution metrics', () => {
      const metrics = framework.getMetrics(testContext.id);
      const stats = framework.getPerformanceStats(testContext.id);
      
      expect(metrics).toBeDefined();
      expect(stats).toBeDefined();
      
      console.log('\n=== Workflow Execution Integration Test Metrics ===');
      console.log('Total Requests:', stats?.requests || 0);
      console.log('Success Rate:', stats?.successRate?.toFixed(2) + '%' || 'N/A');
      console.log('Average Latency:', stats?.latency?.avg?.toFixed(2) + 'ms' || 'N/A');
      console.log('P95 Latency:', stats?.latency?.p95?.toFixed(2) + 'ms' || 'N/A');
      console.log('Test Duration:', stats?.duration?.toFixed(2) + 'ms' || 'N/A');
      console.log('Memory Usage:', (stats?.resourceUsage?.memory / 1024 / 1024)?.toFixed(2) + 'MB' || 'N/A');
      
      if (metrics?.customMetrics) {
        console.log('\nWorkflow-Specific Metrics:');
        metrics.customMetrics.forEach((value, key) => {
          if (typeof value === 'number') {
            console.log(`  ${key}: ${value.toFixed(2)}`);
          } else {
            console.log(`  ${key}: ${value}`);
          }
        });
      }
      console.log('=================================================\n');
    });
  });
});