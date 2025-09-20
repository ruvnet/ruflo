import { jest } from '@jest/globals';
import { WorkflowEngine } from '../../lib/workflow-engine.js';

describe('WorkflowEngine Unit Tests', () => {
  let workflowEngine;

  beforeEach(async () => {
    workflowEngine = new WorkflowEngine();
    await workflowEngine.init();
  });

  afterEach(async () => {
    if (workflowEngine && workflowEngine.cleanup) {
      await workflowEngine.cleanup();
    }
  });

  describe('Initialization', () => {
    test('should initialize successfully', () => {
      expect(workflowEngine.initialized).toBe(true);
      expect(workflowEngine.workflows).toBeDefined();
      expect(workflowEngine.workflowTemplates).toBeDefined();
      expect(workflowEngine.executionHistory).toBeDefined();
    });

    test('should have default configuration', () => {
      expect(workflowEngine.config.maxConcurrentWorkflows).toBe(10);
      expect(workflowEngine.config.defaultTimeout).toBe(300000); // 5 minutes
      expect(workflowEngine.config.retryAttempts).toBe(3);
      expect(workflowEngine.config.enablePersistence).toBe(true);
      expect(workflowEngine.config.workflowHistoryLimit).toBe(1000);
    });

    test('should initialize helper components', () => {
      expect(workflowEngine.scheduler).toBeDefined();
      expect(workflowEngine.triggerManager).toBeDefined();
      expect(workflowEngine.pipelineManager).toBeDefined();
      expect(workflowEngine.automationEngine).toBeDefined();
      expect(workflowEngine.batchProcessor).toBeDefined();
      expect(workflowEngine.templateManager).toBeDefined();
    });

    test('should initialize workflow statistics', () => {
      expect(workflowEngine.workflowStats.totalExecuted).toBe(0);
      expect(workflowEngine.workflowStats.successRate).toBe(0);
      expect(workflowEngine.workflowStats.averageExecutionTime).toBe(0);
    });
  });

  describe('Workflow Creation', () => {
    test('should create workflow with basic steps', async () => {
      const result = await workflowEngine.execute('workflow_create', {
        name: 'Test Workflow',
        steps: [
          { name: 'Step 1', action: 'test-action-1' },
          { name: 'Step 2', action: 'test-action-2' }
        ]
      });

      expect(result.workflowId).toMatch(/^workflow_/);
      expect(result.name).toBe('Test Workflow');
      expect(result.status).toBe('created');
      expect(result.stepCount).toBe(2);
      expect(result.triggerCount).toBe(0);
      expect(result.configuration).toBeDefined();
    });

    test('should create workflow with triggers', async () => {
      const result = await workflowEngine.execute('workflow_create', {
        name: 'Triggered Workflow',
        steps: [
          { name: 'Step 1', action: 'test-action' }
        ],
        triggers: [
          { type: 'schedule', cron: '0 9 * * *' },
          { type: 'webhook', url: '/webhook' }
        ]
      });

      expect(result.triggerCount).toBe(2);
      expect(result.configuration).toBeDefined();
    });

    test('should create workflow with metadata', async () => {
      const metadata = {
        timeout: 600000,
        retryAttempts: 5,
        parallelExecution: true,
        errorHandling: 'continue'
      };

      const result = await workflowEngine.execute('workflow_create', {
        name: 'Custom Workflow',
        steps: [
          { name: 'Step 1', action: 'test-action' }
        ],
        metadata
      });

      expect(result.configuration.timeout).toBe(600000);
      expect(result.configuration.retryAttempts).toBe(5);
      expect(result.configuration.parallelExecution).toBe(true);
      expect(result.configuration.errorHandling).toBe('continue');
    });

    test('should store workflow in internal state', async () => {
      const initialSize = workflowEngine.workflows.size;
      
      const result = await workflowEngine.execute('workflow_create', {
        name: 'Storage Test',
        steps: [{ name: 'Step 1', action: 'test-action' }]
      });

      expect(workflowEngine.workflows.size).toBe(initialSize + 1);
      expect(workflowEngine.workflows.has(result.workflowId)).toBe(true);
    });

    test('should throw error for invalid workflow steps', async () => {
      await expect(
        workflowEngine.execute('workflow_create', {
          name: 'Invalid Workflow',
          steps: []
        })
      ).rejects.toThrow('Workflow validation failed');
    });

    test('should throw error for steps without required fields', async () => {
      await expect(
        workflowEngine.execute('workflow_create', {
          name: 'Invalid Steps',
          steps: [
            { name: 'Step 1' } // Missing action
          ]
        })
      ).rejects.toThrow('Each step must have a name and action');
    });
  });

  describe('Workflow Execution', () => {
    let workflowId;

    beforeEach(async () => {
      const workflow = await workflowEngine.execute('workflow_create', {
        name: 'Test Execution Workflow',
        steps: [
          { name: 'Step 1', action: 'test-action-1' },
          { name: 'Step 2', action: 'test-action-2' }
        ]
      });
      workflowId = workflow.workflowId;
    });

    test('should execute workflow sequentially', async () => {
      const result = await workflowEngine.execute('workflow_execute', {
        workflowId,
        params: { testParam: 'value' }
      });

      expect(result.executionId).toMatch(/^exec_/);
      expect(result.workflowId).toBe(workflowId);
      expect(result.status).toBe('completed');
      expect(result.stepsExecuted).toBe(2);
      expect(result.duration).toBeGreaterThan(0);
      expect(Array.isArray(result.results)).toBe(true);
    });

    test('should execute workflow with parameters', async () => {
      const params = { environment: 'test', version: '1.0.0' };

      const result = await workflowEngine.execute('workflow_execute', {
        workflowId,
        params
      });

      expect(result.status).toBe('completed');
      expect(result.results.every(r => r.status === 'completed')).toBe(true);
    });

    test('should execute workflow with options', async () => {
      const result = await workflowEngine.execute('workflow_execute', {
        workflowId,
        options: { priority: 'high' }
      });

      expect(result.status).toBe('completed');
    });

    test('should store execution in history', async () => {
      const initialSize = workflowEngine.executionHistory.size;

      const result = await workflowEngine.execute('workflow_execute', {
        workflowId
      });

      expect(workflowEngine.executionHistory.size).toBe(initialSize + 1);
      expect(workflowEngine.executionHistory.has(result.executionId)).toBe(true);
    });

    test('should update workflow statistics', async () => {
      const initialCount = workflowEngine.workflows.get(workflowId).executionCount;
      
      await workflowEngine.execute('workflow_execute', {
        workflowId
      });

      const workflow = workflowEngine.workflows.get(workflowId);
      expect(workflow.executionCount).toBe(initialCount + 1);
      expect(workflow.successCount).toBe(1);
      expect(workflow.averageExecutionTime).toBeGreaterThan(0);
    });

    test('should throw error for non-existent workflow', async () => {
      await expect(
        workflowEngine.execute('workflow_execute', {
          workflowId: 'non-existent-workflow'
        })
      ).rejects.toThrow('Workflow non-existent-workflow not found');
    });
  });

  describe('Workflow Export', () => {
    let workflowId;

    beforeEach(async () => {
      const workflow = await workflowEngine.execute('workflow_create', {
        name: 'Export Test Workflow',
        steps: [
          { name: 'Build', action: 'build' },
          { name: 'Test', action: 'test-run' }
        ],
        triggers: [
          { type: 'push', branches: ['main'] }
        ]
      });
      workflowId = workflow.workflowId;
    });

    test('should export workflow in JSON format', async () => {
      const result = await workflowEngine.execute('workflow_export', {
        workflowId,
        format: 'json'
      });

      expect(result.workflowId).toBe(workflowId);
      expect(result.format).toBe('json');
      expect(result.data).toBeDefined();
      expect(result.data.version).toBe('2.0.0');
      expect(result.data.workflow).toBeDefined();
      expect(result.size).toBeGreaterThan(0);
    });

    test('should export workflow in YAML format', async () => {
      const result = await workflowEngine.execute('workflow_export', {
        workflowId,
        format: 'yaml'
      });

      expect(result.format).toBe('yaml');
      expect(typeof result.data).toBe('string');
      expect(result.data).toContain('name: Export Test Workflow');
    });

    test('should export workflow in XML format', async () => {
      const result = await workflowEngine.execute('workflow_export', {
        workflowId,
        format: 'xml'
      });

      expect(result.format).toBe('xml');
      expect(typeof result.data).toBe('string');
      expect(result.data).toContain('<?xml version="1.0"');
    });

    test('should export workflow in GitHub Actions format', async () => {
      const result = await workflowEngine.execute('workflow_export', {
        workflowId,
        format: 'github-actions'
      });

      expect(result.format).toBe('github-actions');
      expect(result.data.name).toBe('Export Test Workflow');
      expect(result.data.jobs).toBeDefined();
      expect(result.data.on).toBeDefined();
    });

    test('should use JSON format by default', async () => {
      const result = await workflowEngine.execute('workflow_export', {
        workflowId
      });

      expect(result.format).toBe('json');
    });

    test('should throw error for unknown export format', async () => {
      await expect(
        workflowEngine.execute('workflow_export', {
          workflowId,
          format: 'unknown-format'
        })
      ).rejects.toThrow('Unsupported export format: unknown-format');
    });

    test('should throw error for non-existent workflow', async () => {
      await expect(
        workflowEngine.execute('workflow_export', {
          workflowId: 'non-existent',
          format: 'json'
        })
      ).rejects.toThrow('Workflow non-existent not found');
    });
  });

  describe('Template Management', () => {
    test('should create workflow template', async () => {
      const result = await workflowEngine.execute('workflow_template', {
        action: 'create',
        templateData: {
          name: 'Test Template',
          description: 'Template for testing',
          steps: [
            { name: 'Setup', action: 'setup' },
            { name: 'Execute', action: 'execute' }
          ]
        }
      });

      expect(result.templateId).toBeDefined();
      expect(result.status).toBe('created');
    });

    test('should update workflow template', async () => {
      // First create a template
      const createResult = await workflowEngine.execute('workflow_template', {
        action: 'create',
        templateData: { name: 'Original Template' }
      });

      const result = await workflowEngine.execute('workflow_template', {
        action: 'update',
        templateId: createResult.templateId,
        templateData: { name: 'Updated Template' }
      });

      expect(result.templateId).toBe(createResult.templateId);
      expect(result.status).toBe('updated');
    });

    test('should delete workflow template', async () => {
      // First create a template
      const createResult = await workflowEngine.execute('workflow_template', {
        action: 'create',
        templateData: { name: 'To Delete Template' }
      });

      const result = await workflowEngine.execute('workflow_template', {
        action: 'delete',
        templateId: createResult.templateId
      });

      expect(result.templateId).toBe(createResult.templateId);
      expect(result.status).toBe('deleted');
    });

    test('should list workflow templates', async () => {
      const result = await workflowEngine.execute('workflow_template', {
        action: 'list'
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    test('should apply workflow template', async () => {
      const result = await workflowEngine.execute('workflow_template', {
        action: 'apply',
        templateId: 'ci-cd-basic', // Built-in template
        templateData: { environment: 'production' }
      });

      expect(result.templateId).toBe('ci-cd-basic');
      expect(result.status).toBe('applied');
    });

    test('should throw error for unknown template action', async () => {
      await expect(
        workflowEngine.execute('workflow_template', {
          action: 'unknown_action'
        })
      ).rejects.toThrow('Unknown template action: unknown_action');
    });
  });

  describe('Automation Setup', () => {
    test('should setup automation rules', async () => {
      const rules = [
        {
          condition: { type: 'file_changed', pattern: '*.js' },
          action: { type: 'run_tests' }
        },
        {
          condition: { type: 'pr_opened' },
          action: { type: 'run_quality_check' }
        }
      ];

      const result = await workflowEngine.execute('automation_setup', {
        rules
      });

      expect(result.automationId).toMatch(/^automation_/);
      expect(result.status).toBe('active');
      expect(result.rulesCount).toBe(2);
      expect(result.validRules).toBe(2);
      expect(result.invalidRules).toBe(0);
    });

    test('should handle invalid automation rules', async () => {
      const rules = [
        {
          condition: { type: 'valid_condition' },
          action: { type: 'valid_action' }
        },
        {
          // Missing action
          condition: { type: 'valid_condition' }
        }
      ];

      const result = await workflowEngine.execute('automation_setup', {
        rules
      });

      expect(result.validRules).toBe(1);
      expect(result.invalidRules).toBe(1);
    });

    test('should return automation statistics', async () => {
      const rules = [
        {
          condition: { type: 'schedule', cron: '0 0 * * *' },
          action: { type: 'cleanup' }
        }
      ];

      const result = await workflowEngine.execute('automation_setup', {
        rules
      });

      expect(result.rulesCount).toBe(1);
      expect(result.validRules + result.invalidRules).toBe(result.rulesCount);
    });
  });

  describe('Pipeline Creation', () => {
    test('should create CI/CD pipeline', async () => {
      const config = {
        name: 'Test Pipeline',
        stages: [
          { name: 'build', steps: ['npm install', 'npm run build'] },
          { name: 'test', steps: ['npm test'] }
        ],
        triggers: [
          { type: 'push', branches: ['main'] }
        ]
      };

      const result = await workflowEngine.execute('pipeline_create', {
        config
      });

      expect(result.pipelineId).toMatch(/^pipeline_/);
      expect(result.status).toBe('created');
      expect(result.stages).toBe(2);
      expect(result.triggers).toBe(1);
      expect(result.configuration).toBeDefined();
    });

    test('should create pipeline with minimal configuration', async () => {
      const config = {
        name: 'Minimal Pipeline'
      };

      const result = await workflowEngine.execute('pipeline_create', {
        config
      });

      expect(result.status).toBe('created');
      expect(result.stages).toBe(0);
      expect(result.triggers).toBe(0);
    });
  });

  describe('Scheduler Management', () => {
    test('should create schedule', async () => {
      const schedule = {
        name: 'Daily Backup',
        cron: '0 2 * * *',
        workflowId: 'test-workflow'
      };

      const result = await workflowEngine.execute('scheduler_manage', {
        action: 'create',
        schedule
      });

      expect(result.scheduleId).toBeDefined();
      expect(result.status).toBe('created');
    });

    test('should update schedule', async () => {
      const schedule = {
        id: 'test-schedule-123',
        name: 'Updated Backup',
        cron: '0 3 * * *'
      };

      const result = await workflowEngine.execute('scheduler_manage', {
        action: 'update',
        schedule
      });

      expect(result.scheduleId).toBe('test-schedule-123');
      expect(result.status).toBe('updated');
    });

    test('should delete schedule', async () => {
      const result = await workflowEngine.execute('scheduler_manage', {
        action: 'delete',
        schedule: { id: 'test-schedule-123' }
      });

      expect(result.scheduleId).toBe('test-schedule-123');
      expect(result.status).toBe('deleted');
    });

    test('should list all schedules', async () => {
      const result = await workflowEngine.execute('scheduler_manage', {
        action: 'list'
      });

      expect(Array.isArray(result)).toBe(true);
    });

    test('should pause schedule', async () => {
      const result = await workflowEngine.execute('scheduler_manage', {
        action: 'pause',
        schedule: { id: 'test-schedule-123' }
      });

      expect(result.scheduleId).toBe('test-schedule-123');
      expect(result.status).toBe('paused');
    });

    test('should resume schedule', async () => {
      const result = await workflowEngine.execute('scheduler_manage', {
        action: 'resume',
        schedule: { id: 'test-schedule-123' }
      });

      expect(result.scheduleId).toBe('test-schedule-123');
      expect(result.status).toBe('resumed');
    });

    test('should throw error for unknown scheduler action', async () => {
      await expect(
        workflowEngine.execute('scheduler_manage', {
          action: 'unknown_action',
          schedule: { id: 'test' }
        })
      ).rejects.toThrow('Unknown scheduler action: unknown_action');
    });
  });

  describe('Trigger Setup', () => {
    test('should setup event triggers with actions', async () => {
      const events = [
        { type: 'file_change', pattern: '*.js' },
        { type: 'pr_opened' }
      ];
      const actions = [
        { type: 'run_tests' },
        { type: 'send_notification' }
      ];

      const result = await workflowEngine.execute('trigger_setup', {
        events,
        actions
      });

      expect(result.triggerId).toMatch(/^trigger_/);
      expect(result.status).toBe('active');
      expect(result.eventsCount).toBe(2);
      expect(result.actionsCount).toBe(2);
      expect(result.triggersRegistered).toBe(4); // 2 events × 2 actions
      expect(Array.isArray(result.triggers)).toBe(true);
    });

    test('should setup single event with multiple actions', async () => {
      const events = [{ type: 'deployment' }];
      const actions = [
        { type: 'run_tests' },
        { type: 'notify_team' },
        { type: 'update_status' }
      ];

      const result = await workflowEngine.execute('trigger_setup', {
        events,
        actions
      });

      expect(result.eventsCount).toBe(1);
      expect(result.actionsCount).toBe(3);
      expect(result.triggersRegistered).toBe(3);
    });

    test('should setup multiple events with single action', async () => {
      const events = [
        { type: 'push' },
        { type: 'pull_request' },
        { type: 'release' }
      ];
      const actions = [{ type: 'notify_slack' }];

      const result = await workflowEngine.execute('trigger_setup', {
        events,
        actions
      });

      expect(result.eventsCount).toBe(3);
      expect(result.actionsCount).toBe(1);
      expect(result.triggersRegistered).toBe(3);
    });
  });

  describe('Batch Processing', () => {
    test('should process batch of items', async () => {
      const items = ['item1', 'item2', 'item3', 'item4'];
      const operation = 'validate';

      const result = await workflowEngine.execute('batch_process', {
        items,
        operation
      });

      expect(result.batchId).toMatch(/^batch_/);
      expect(result.operation).toBe('validate');
      expect(result.status).toBe('completed');
      expect(result.totalItems).toBe(4);
      expect(result.processed).toBe(4);
      expect(result.successful + result.failed).toBe(result.processed);
      expect(result.throughput).toBeGreaterThan(0);
      expect(Array.isArray(result.results)).toBe(true);
    });

    test('should provide batch processing metrics', async () => {
      const items = ['test1', 'test2'];
      
      const result = await workflowEngine.execute('batch_process', {
        items,
        operation: 'process'
      });

      expect(result.duration).toBeGreaterThan(0);
      expect(result.throughput).toBeGreaterThan(0);
      expect(result.results).toHaveLength(2);
    });

    test('should handle empty batch', async () => {
      const result = await workflowEngine.execute('batch_process', {
        items: [],
        operation: 'test'
      });

      expect(result.totalItems).toBe(0);
      expect(result.processed).toBe(0);
    });
  });

  describe('Parallel Execution', () => {
    test('should execute tasks in parallel', async () => {
      const tasks = [
        { name: 'task1', type: 'compute' },
        { name: 'task2', type: 'io' },
        { name: 'task3', type: 'network' }
      ];

      const result = await workflowEngine.execute('parallel_execute', {
        tasks
      });

      expect(result.parallelExecutionId).toMatch(/^parallel_/);
      expect(result.status).toBe('completed');
      expect(result.totalTasks).toBe(3);
      expect(result.successful + result.failed).toBe(result.totalTasks);
      expect(result.successRate).toBeGreaterThanOrEqual(0);
      expect(result.successRate).toBeLessThanOrEqual(100);
      expect(result.totalDuration).toBeGreaterThan(0);
      expect(result.averageTaskDuration).toBeGreaterThan(0);
    });

    test('should provide parallel execution statistics', async () => {
      const tasks = [
        { name: 'quick-task', duration: 100 },
        { name: 'slow-task', duration: 500 }
      ];

      const result = await workflowEngine.execute('parallel_execute', {
        tasks
      });

      expect(result.results).toHaveLength(2);
      expect(result.results.every(r => r.taskIndex >= 0)).toBe(true);
      expect(result.results.every(r => r.status)).toBeTruthy();
    });

    test('should handle empty task list', async () => {
      const result = await workflowEngine.execute('parallel_execute', {
        tasks: []
      });

      expect(result.totalTasks).toBe(0);
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('should throw error for unknown tool', async () => {
      await expect(
        workflowEngine.execute('unknown_tool', {})
      ).rejects.toThrow('Unknown workflow tool: unknown_tool');
    });

    test('should handle workflow execution failure gracefully', async () => {
      // Create a workflow that will fail during execution
      const workflow = await workflowEngine.execute('workflow_create', {
        name: 'Failing Workflow',
        steps: [
          { name: 'Failing Step', action: 'fail-action' }
        ],
        metadata: { errorHandling: 'stop' }
      });

      // The execution should handle the failure and update statistics
      const initialFailureCount = workflowEngine.workflows.get(workflow.workflowId).failureCount;
      
      try {
        await workflowEngine.execute('workflow_execute', {
          workflowId: workflow.workflowId
        });
      } catch (error) {
        const updatedWorkflow = workflowEngine.workflows.get(workflow.workflowId);
        expect(updatedWorkflow.failureCount).toBe(initialFailureCount + 1);
        expect(error.message).toContain('Workflow execution failed');
      }
    });
  });

  describe('Health and Capabilities', () => {
    test('should report healthy status', async () => {
      const health = await workflowEngine.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.initialized).toBe(true);
      expect(health.workflows).toBe(workflowEngine.workflows.size);
      expect(health.activeExecutions).toBe(workflowEngine.activeWorkflows.size);
      expect(health.templates).toBe(workflowEngine.workflowTemplates.size);
      expect(health.statistics).toBeDefined();
    });

    test('should report capabilities', () => {
      const capabilities = workflowEngine.getCapabilities();

      expect(capabilities).toContain('workflow-creation');
      expect(capabilities).toContain('workflow-execution');
      expect(capabilities).toContain('template-management');
      expect(capabilities).toContain('automation-rules');
      expect(capabilities).toContain('pipeline-management');
      expect(capabilities).toContain('batch-processing');
      expect(capabilities).toContain('parallel-execution');
      expect(capabilities).toContain('trigger-management');
      expect(capabilities).toContain('workflow-scheduling');
    });

    test('should report healthy when initialized', () => {
      expect(workflowEngine.isHealthy()).toBe(true);
    });

    test('should report workflow statistics', async () => {
      const health = await workflowEngine.getHealth();

      expect(health.statistics.totalExecuted).toBeGreaterThanOrEqual(0);
      expect(health.statistics.successRate).toBeGreaterThanOrEqual(0);
      expect(health.statistics.averageExecutionTime).toBeGreaterThanOrEqual(0);
    });
  });
});