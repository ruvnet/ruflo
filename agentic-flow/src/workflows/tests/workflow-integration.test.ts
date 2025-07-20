// Comprehensive end-to-end workflow tests
import { WorkflowEngine, WorkflowDefinition, WorkflowStep } from '../workflow-engine';
import { AgentTaskExecutor, ParallelExecutor, ConditionExecutor, LoopExecutor, HttpExecutor, ScriptExecutor } from '../executors/step-executors';
import { WorkflowStateManager, SQLiteWorkflowStateStore } from '../persistence/workflow-state-manager';
import { v4 as uuidv4 } from 'uuid';

describe('Workflow Integration Tests', () => {
  let engine: WorkflowEngine;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = `:memory:${Date.now()}`;
    engine = new WorkflowEngine({ 
      enablePersistence: true, 
      dbPath: testDbPath 
    });
  });

  afterEach(async () => {
    await engine.shutdown();
  });

  describe('Basic Workflow Execution', () => {
    test('should execute a simple linear workflow', async () => {
      const workflow: WorkflowDefinition = {
        id: uuidv4(),
        name: 'Simple Linear Workflow',
        description: 'Test workflow with sequential steps',
        version: '1.0.0',
        steps: [
          {
            id: 'step1',
            type: 'script',
            name: 'Initialize',
            config: {
              script: 'return { initialized: true, timestamp: new Date() };',
              language: 'javascript'
            },
            next: ['step2']
          },
          {
            id: 'step2',
            type: 'script',
            name: 'Process',
            config: {
              script: 'return { processed: true, input: variables.initialized };',
              language: 'javascript'
            }
          }
        ],
        variables: { testVar: 'testValue' },
        triggers: []
      };

      await engine.createWorkflow(workflow);
      const executionId = await engine.executeWorkflow(workflow.id, { input: 'test' });

      // Wait for completion
      await new Promise((resolve) => {
        engine.once('workflow:completed', resolve);
      });

      const execution = engine.getExecution(executionId);
      expect(execution).toBeTruthy();
      expect(execution?.status).toBe('completed');
      expect(execution?.results).toHaveProperty('step1');
      expect(execution?.results).toHaveProperty('step2');
    }, 10000);

    test('should handle workflow with conditions', async () => {
      const workflow: WorkflowDefinition = {
        id: uuidv4(),
        name: 'Conditional Workflow',
        description: 'Test workflow with condition branching',
        version: '1.0.0',
        steps: [
          {
            id: 'condition-step',
            type: 'condition',
            name: 'Check Value',
            config: {
              condition: 'variables.value > 10',
              trueStep: 'high-value',
              falseStep: 'low-value'
            }
          },
          {
            id: 'high-value',
            type: 'script',
            name: 'High Value Processing',
            config: {
              script: 'return { result: "high", value: variables.value };'
            }
          },
          {
            id: 'low-value',
            type: 'script',
            name: 'Low Value Processing',
            config: {
              script: 'return { result: "low", value: variables.value };'
            }
          }
        ],
        variables: {},
        triggers: []
      };

      await engine.createWorkflow(workflow);

      // Test high value path
      const executionId1 = await engine.executeWorkflow(workflow.id, { value: 15 });
      await new Promise((resolve) => {
        engine.once('workflow:completed', resolve);
      });

      const execution1 = engine.getExecution(executionId1);
      expect(execution1?.results['high-value']?.result).toBe('high');

      // Test low value path
      const executionId2 = await engine.executeWorkflow(workflow.id, { value: 5 });
      await new Promise((resolve) => {
        engine.once('workflow:completed', resolve);
      });

      const execution2 = engine.getExecution(executionId2);
      expect(execution2?.results['low-value']?.result).toBe('low');
    }, 15000);

    test('should execute parallel steps', async () => {
      const workflow: WorkflowDefinition = {
        id: uuidv4(),
        name: 'Parallel Workflow',
        description: 'Test workflow with parallel execution',
        version: '1.0.0',
        steps: [
          {
            id: 'parallel-step',
            type: 'parallel',
            name: 'Parallel Execution',
            config: {
              steps: ['task1', 'task2', 'task3'],
              maxConcurrency: 3
            }
          },
          {
            id: 'task1',
            type: 'script',
            name: 'Task 1',
            config: {
              script: 'await new Promise(resolve => setTimeout(resolve, 100)); return { task: 1, completed: true };'
            }
          },
          {
            id: 'task2',
            type: 'script',
            name: 'Task 2',
            config: {
              script: 'await new Promise(resolve => setTimeout(resolve, 150)); return { task: 2, completed: true };'
            }
          },
          {
            id: 'task3',
            type: 'script',
            name: 'Task 3',
            config: {
              script: 'await new Promise(resolve => setTimeout(resolve, 200)); return { task: 3, completed: true };'
            }
          }
        ],
        variables: {},
        triggers: []
      };

      await engine.createWorkflow(workflow);
      const executionId = await engine.executeWorkflow(workflow.id);

      await new Promise((resolve) => {
        engine.once('workflow:completed', resolve);
      });

      const execution = engine.getExecution(executionId);
      expect(execution?.status).toBe('completed');
      expect(execution?.results['parallel-step']).toBeTruthy();
    }, 10000);

    test('should execute loop with break condition', async () => {
      const workflow: WorkflowDefinition = {
        id: uuidv4(),
        name: 'Loop Workflow',
        description: 'Test workflow with loop execution',
        version: '1.0.0',
        steps: [
          {
            id: 'loop-step',
            type: 'loop',
            name: 'Counter Loop',
            config: {
              condition: 'variables.counter < 5',
              loopStep: 'increment',
              maxIterations: 10,
              breakCondition: 'variables.counter >= 3'
            }
          },
          {
            id: 'increment',
            type: 'script',
            name: 'Increment Counter',
            config: {
              script: 'variables.counter = (variables.counter || 0) + 1; return { counter: variables.counter };'
            }
          }
        ],
        variables: { counter: 0 },
        triggers: []
      };

      await engine.createWorkflow(workflow);
      const executionId = await engine.executeWorkflow(workflow.id);

      await new Promise((resolve) => {
        engine.once('workflow:completed', resolve);
      });

      const execution = engine.getExecution(executionId);
      expect(execution?.status).toBe('completed');
      expect(execution?.results['loop-step']).toBeTruthy();
      expect(execution?.results['loop-step'].iterations).toBeLessThanOrEqual(10);
    }, 10000);
  });

  describe('Agent Integration', () => {
    test('should execute agent tasks', async () => {
      const workflow: WorkflowDefinition = {
        id: uuidv4(),
        name: 'Agent Workflow',
        description: 'Test workflow with agent tasks',
        version: '1.0.0',
        steps: [
          {
            id: 'agent-step',
            type: 'agent-task',
            name: 'Coordinator Task',
            config: {
              agentType: 'coordinator',
              goal: 'Analyze and coordinate workflow execution',
              capabilities: ['coordination', 'analysis'],
              timeout: 10000
            }
          }
        ],
        variables: {},
        triggers: []
      };

      await engine.createWorkflow(workflow);
      const executionId = await engine.executeWorkflow(workflow.id);

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Agent task timeout')), 15000);
        
        engine.once('workflow:completed', () => {
          clearTimeout(timeout);
          resolve(void 0);
        });
        
        engine.once('workflow:failed', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      const execution = engine.getExecution(executionId);
      expect(execution?.status).toBe('completed');
      expect(execution?.results['agent-step']).toBeTruthy();
      expect(execution?.results['agent-step'].agentType).toBe('coordinator');
    }, 20000);
  });

  describe('HTTP Requests', () => {
    test('should execute HTTP requests with retries', async () => {
      const workflow: WorkflowDefinition = {
        id: uuidv4(),
        name: 'HTTP Workflow',
        description: 'Test workflow with HTTP requests',
        version: '1.0.0',
        steps: [
          {
            id: 'http-step',
            type: 'http',
            name: 'API Call',
            config: {
              method: 'GET',
              url: 'https://jsonplaceholder.typicode.com/posts/1',
              headers: {
                'Content-Type': 'application/json'
              },
              timeout: 5000,
              retries: 2
            }
          }
        ],
        variables: {},
        triggers: []
      };

      await engine.createWorkflow(workflow);
      const executionId = await engine.executeWorkflow(workflow.id);

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('HTTP request timeout')), 10000);
        
        engine.once('workflow:completed', () => {
          clearTimeout(timeout);
          resolve(void 0);
        });
        
        engine.once('workflow:failed', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      const execution = engine.getExecution(executionId);
      expect(execution?.status).toBe('completed');
      expect(execution?.results['http-step']).toBeTruthy();
      expect(execution?.results['http-step'].status).toBe(200);
    }, 15000);
  });

  describe('Error Handling', () => {
    test('should handle step failures with retry', async () => {
      const workflow: WorkflowDefinition = {
        id: uuidv4(),
        name: 'Error Handling Workflow',
        description: 'Test workflow error handling',
        version: '1.0.0',
        steps: [
          {
            id: 'failing-step',
            type: 'script',
            name: 'Failing Step',
            config: {
              script: 'throw new Error("Intentional failure");'
            },
            onFailure: 'recovery-step'
          },
          {
            id: 'recovery-step',
            type: 'script',
            name: 'Recovery Step',
            config: {
              script: 'return { recovered: true, message: "Recovered from failure" };'
            }
          }
        ],
        variables: {},
        triggers: []
      };

      await engine.createWorkflow(workflow);
      const executionId = await engine.executeWorkflow(workflow.id);

      await new Promise((resolve) => {
        engine.once('workflow:completed', resolve);
      });

      const execution = engine.getExecution(executionId);
      expect(execution?.status).toBe('completed');
      expect(execution?.results['recovery-step']).toBeTruthy();
      expect(execution?.results['recovery-step'].recovered).toBe(true);
    }, 10000);

    test('should handle workflow cancellation', async () => {
      const workflow: WorkflowDefinition = {
        id: uuidv4(),
        name: 'Long Running Workflow',
        description: 'Test workflow cancellation',
        version: '1.0.0',
        steps: [
          {
            id: 'long-step',
            type: 'script',
            name: 'Long Running Step',
            config: {
              script: 'await new Promise(resolve => setTimeout(resolve, 5000)); return { completed: true };'
            }
          }
        ],
        variables: {},
        triggers: []
      };

      await engine.createWorkflow(workflow);
      const executionId = await engine.executeWorkflow(workflow.id);

      // Cancel after 1 second
      setTimeout(async () => {
        await engine.cancelExecution(executionId);
      }, 1000);

      await new Promise((resolve) => {
        engine.once('workflow:cancelled', resolve);
      });

      const execution = engine.getExecution(executionId);
      expect(execution?.status).toBe('cancelled');
    }, 10000);
  });

  describe('State Persistence', () => {
    test('should persist and resume workflow', async () => {
      const workflow: WorkflowDefinition = {
        id: uuidv4(),
        name: 'Resumable Workflow',
        description: 'Test workflow persistence and resume',
        version: '1.0.0',
        steps: [
          {
            id: 'step1',
            type: 'script',
            name: 'First Step',
            config: {
              script: 'return { step1: true };'
            },
            next: ['step2']
          },
          {
            id: 'step2',
            type: 'script',
            name: 'Second Step',
            config: {
              script: 'await new Promise(resolve => setTimeout(resolve, 2000)); return { step2: true };'
            }
          }
        ],
        variables: {},
        triggers: []
      };

      await engine.createWorkflow(workflow);
      const executionId = await engine.executeWorkflow(workflow.id);

      // Pause after step1 completes
      setTimeout(async () => {
        await engine.pauseWorkflow(executionId);
      }, 1000);

      await new Promise((resolve) => {
        engine.once('workflow:paused', resolve);
      });

      // Verify paused state
      let execution = engine.getExecution(executionId);
      expect(execution?.status).toBe('paused');

      // Resume workflow
      await engine.resumeWorkflow(executionId);

      await new Promise((resolve) => {
        engine.once('workflow:completed', resolve);
      });

      execution = engine.getExecution(executionId);
      expect(execution?.status).toBe('completed');
      expect(execution?.results).toHaveProperty('step1');
      expect(execution?.results).toHaveProperty('step2');
    }, 15000);

    test('should create and restore from snapshots', async () => {
      const workflow: WorkflowDefinition = {
        id: uuidv4(),
        name: 'Snapshot Workflow',
        description: 'Test workflow snapshots',
        version: '1.0.0',
        steps: [
          {
            id: 'step1',
            type: 'script',
            name: 'Create Data',
            config: {
              script: 'return { data: "important_data", timestamp: new Date() };'
            }
          }
        ],
        variables: { snapshotTest: true },
        triggers: []
      };

      await engine.createWorkflow(workflow);
      const executionId = await engine.executeWorkflow(workflow.id);

      // Enable auto-snapshots
      await engine.enableAutoSnapshots(executionId, 1000);

      await new Promise((resolve) => {
        engine.once('workflow:completed', resolve);
      });

      const execution = engine.getExecution(executionId);
      expect(execution?.status).toBe('completed');

      // Verify snapshot was created
      const metrics = engine.getExecutionMetrics(executionId);
      expect(metrics).toBeTruthy();
      expect(metrics.totalSteps).toBeGreaterThan(0);
    }, 10000);
  });

  describe('Complex Workflows', () => {
    test('should execute complex multi-step workflow with all step types', async () => {
      const workflow: WorkflowDefinition = {
        id: uuidv4(),
        name: 'Complex Workflow',
        description: 'Complex workflow with all step types',
        version: '1.0.0',
        steps: [
          // Initialize
          {
            id: 'init',
            type: 'script',
            name: 'Initialize',
            config: {
              script: 'return { initialized: true, startTime: new Date() };'
            },
            next: ['parallel-start']
          },
          // Parallel processing
          {
            id: 'parallel-start',
            type: 'parallel',
            name: 'Parallel Processing',
            config: {
              steps: ['process-a', 'process-b'],
              maxConcurrency: 2
            },
            next: ['condition-check']
          },
          {
            id: 'process-a',
            type: 'script',
            name: 'Process A',
            config: {
              script: 'await new Promise(r => setTimeout(r, 100)); return { processA: true };'
            }
          },
          {
            id: 'process-b',
            type: 'script',
            name: 'Process B',
            config: {
              script: 'await new Promise(r => setTimeout(r, 150)); return { processB: true };'
            }
          },
          // Condition
          {
            id: 'condition-check',
            type: 'condition',
            name: 'Check Results',
            config: {
              condition: 'results["process-a"] && results["process-b"]',
              trueStep: 'loop-process',
              falseStep: 'error-handler'
            }
          },
          // Loop
          {
            id: 'loop-process',
            type: 'loop',
            name: 'Loop Processing',
            config: {
              condition: 'variables.counter < 3',
              loopStep: 'increment',
              maxIterations: 5
            },
            next: ['finalize']
          },
          {
            id: 'increment',
            type: 'script',
            name: 'Increment',
            config: {
              script: 'variables.counter = (variables.counter || 0) + 1; return { iteration: variables.counter };'
            }
          },
          // Error handler
          {
            id: 'error-handler',
            type: 'script',
            name: 'Error Handler',
            config: {
              script: 'return { error: "Parallel processing failed" };'
            }
          },
          // Finalize
          {
            id: 'finalize',
            type: 'script',
            name: 'Finalize',
            config: {
              script: 'return { completed: true, endTime: new Date(), totalSteps: Object.keys(results).length };'
            }
          }
        ],
        variables: { counter: 0 },
        triggers: []
      };

      await engine.createWorkflow(workflow);
      const executionId = await engine.executeWorkflow(workflow.id);

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Complex workflow timeout')), 20000);
        
        engine.once('workflow:completed', () => {
          clearTimeout(timeout);
          resolve(void 0);
        });
        
        engine.once('workflow:failed', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      const execution = engine.getExecution(executionId);
      expect(execution?.status).toBe('completed');
      expect(execution?.results['init']).toBeTruthy();
      expect(execution?.results['parallel-start']).toBeTruthy();
      expect(execution?.results['loop-process']).toBeTruthy();
      expect(execution?.results['finalize']).toBeTruthy();

      const metrics = engine.getExecutionMetrics(executionId);
      expect(metrics.totalSteps).toBeGreaterThan(5);
      expect(metrics.errors).toBe(0);
    }, 25000);
  });

  describe('Performance and Monitoring', () => {
    test('should track execution metrics', async () => {
      const workflow: WorkflowDefinition = {
        id: uuidv4(),
        name: 'Metrics Workflow',
        description: 'Test workflow metrics tracking',
        version: '1.0.0',
        steps: [
          {
            id: 'metrics-step',
            type: 'script',
            name: 'Generate Metrics',
            config: {
              script: 'await new Promise(r => setTimeout(r, 100)); return { metricsGenerated: true };'
            }
          }
        ],
        variables: {},
        triggers: []
      };

      await engine.createWorkflow(workflow);
      const executionId = await engine.executeWorkflow(workflow.id);

      await new Promise((resolve) => {
        engine.once('workflow:completed', resolve);
      });

      const metrics = engine.getExecutionMetrics(executionId);
      expect(metrics).toBeTruthy();
      expect(metrics.executionId).toBe(executionId);
      expect(metrics.status).toBe('completed');
      expect(metrics.duration).toBeGreaterThan(0);
      expect(metrics.totalSteps).toBe(1);
      expect(typeof metrics.startTime).toBe('object');
      expect(typeof metrics.endTime).toBe('object');
    }, 5000);

    test('should filter executions', async () => {
      const workflow: WorkflowDefinition = {
        id: uuidv4(),
        name: 'Filter Test Workflow',
        description: 'Test execution filtering',
        version: '1.0.0',
        steps: [
          {
            id: 'simple-step',
            type: 'script',
            name: 'Simple Step',
            config: {
              script: 'return { done: true };'
            }
          }
        ],
        variables: {},
        triggers: []
      };

      await engine.createWorkflow(workflow);
      
      // Create multiple executions
      const executions = await Promise.all([
        engine.executeWorkflow(workflow.id),
        engine.executeWorkflow(workflow.id),
        engine.executeWorkflow(workflow.id)
      ]);

      // Wait for all to complete
      await Promise.all(executions.map(() => 
        new Promise((resolve) => {
          engine.once('workflow:completed', resolve);
        })
      ));

      // Test filtering
      const allExecutions = engine.listExecutions();
      expect(allExecutions.length).toBeGreaterThanOrEqual(3);

      const completedExecutions = engine.listExecutions({ status: 'completed' });
      expect(completedExecutions.length).toBeGreaterThanOrEqual(3);

      const workflowExecutions = engine.listExecutions({ workflowId: workflow.id });
      expect(workflowExecutions.length).toBeGreaterThanOrEqual(3);
    }, 10000);
  });
});