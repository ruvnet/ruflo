import { LangGraphOrchestrator } from '../../src/langgraph/index.js';
import { Workflow, WorkflowNode, WorkflowEdge } from '../../src/types/index.js';

describe('LangGraph Orchestrator', () => {
  let orchestrator: LangGraphOrchestrator;

  beforeEach(() => {
    orchestrator = new LangGraphOrchestrator();
  });

  describe('Workflow Registration', () => {
    it('should register a simple workflow', async () => {
      const workflow: Workflow = {
        id: 'test-workflow-1',
        name: 'Test Workflow',
        description: 'A simple test workflow',
        nodes: [
          {
            id: 'start',
            type: 'start',
            name: 'Start Node',
            next: 'process'
          },
          {
            id: 'process',
            type: 'task',
            name: 'Process Data',
            function: 'process_data',
            next: 'end'
          },
          {
            id: 'end',
            type: 'end',
            name: 'End Node'
          }
        ],
        edges: [
          { from: 'start', to: 'process' },
          { from: 'process', to: 'end' }
        ]
      };

      await expect(orchestrator.registerWorkflow(workflow)).resolves.not.toThrow();
      expect(orchestrator.getWorkflows()).toContain('test-workflow-1');
    });

    it('should handle workflow registration errors', async () => {
      const invalidWorkflow = {
        id: '',
        name: '',
        description: '',
        nodes: [],
        edges: []
      } as Workflow;

      await expect(orchestrator.registerWorkflow(invalidWorkflow)).rejects.toThrow();
    });
  });

  describe('Workflow Execution', () => {
    beforeEach(async () => {
      const workflow: Workflow = {
        id: 'test-execution',
        name: 'Test Execution Workflow',
        description: 'Workflow for testing execution',
        nodes: [
          {
            id: 'start',
            type: 'start',
            name: 'Start',
            next: 'validate'
          },
          {
            id: 'validate',
            type: 'task',
            name: 'Validate Input',
            function: 'validate_input',
            next: 'end'
          },
          {
            id: 'end',
            type: 'end',
            name: 'End'
          }
        ],
        edges: [
          { from: 'start', to: 'validate' },
          { from: 'validate', to: 'end' }
        ]
      };

      await orchestrator.registerWorkflow(workflow);
    });

    it('should execute a workflow successfully', async () => {
      const input = { data: 'test input' };
      const result = await orchestrator.executeWorkflow('test-execution', input);

      expect(result).toBeDefined();
      expect(result.completed).toBe(true);
      expect(result.data).toMatchObject({ ...input, validated: true });
    });

    it('should handle execution timeout', async () => {
      const input = { data: 'test input' };
      const options = { timeout: 1 }; // 1ms timeout

      await expect(
        orchestrator.executeWorkflow('test-execution', input, options)
      ).rejects.toThrow('timeout');
    });

    it('should track active executions', async () => {
      const input = { data: 'test input' };

      // Start execution (don't await)
      const executionPromise = orchestrator.executeWorkflow('test-execution', input);

      // Check active executions
      const active = orchestrator.getActiveExecutions();
      expect(active.length).toBeGreaterThan(0);

      // Complete execution
      await executionPromise;

      // Check active executions again
      const activeAfter = orchestrator.getActiveExecutions();
      expect(activeAfter.length).toBe(0);
    });
  });

  describe('Workflow Management', () => {
    it('should list registered workflows', () => {
      expect(orchestrator.getWorkflows()).toBeInstanceOf(Array);
    });

    it('should cancel workflow execution', async () => {
      const workflow: Workflow = {
        id: 'cancellable-workflow',
        name: 'Cancellable Workflow',
        description: 'A workflow that can be cancelled',
        nodes: [
          { id: 'start', type: 'start', name: 'Start', next: 'end' },
          { id: 'end', type: 'end', name: 'End' }
        ],
        edges: [{ from: 'start', to: 'end' }]
      };

      await orchestrator.registerWorkflow(workflow);

      // Start execution
      const executionPromise = orchestrator.executeWorkflow('cancellable-workflow', {});

      // Get execution ID from active executions
      const active = orchestrator.getActiveExecutions();
      if (active.length > 0) {
        const cancelled = await orchestrator.cancelExecution(active[0].executionId);
        expect(cancelled).toBe(true);
      }

      // Complete the promise to avoid hanging
      try {
        await executionPromise;
      } catch (error) {
        // Expected if cancelled
      }
    });
  });
});