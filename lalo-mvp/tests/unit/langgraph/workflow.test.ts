/**
 * LangGraph Workflow Unit Tests
 * Tests for workflow orchestration, state management, and transitions
 */

import { LangGraphWorkflow, WorkflowState, WorkflowNode } from '../../../src/langgraph';

describe('LangGraph Workflow', () => {
  let workflow: LangGraphWorkflow;
  let mockConfig: any;

  beforeEach(() => {
    mockConfig = {
      nodes: ['start', 'process', 'decision', 'end'],
      edges: [
        { from: 'start', to: 'process' },
        { from: 'process', to: 'decision' },
        { from: 'decision', to: 'end', condition: 'success' },
        { from: 'decision', to: 'process', condition: 'retry' }
      ],
      entryPoint: 'start',
      exitPoints: ['end']
    };
    workflow = new LangGraphWorkflow(mockConfig);
  });

  describe('Workflow Initialization', () => {
    test('should initialize with correct configuration', () => {
      expect(workflow.getConfig()).toEqual(mockConfig);
      expect(workflow.getCurrentState()).toBe('start');
      expect(workflow.isInitialized()).toBe(true);
    });

    test('should validate workflow configuration', () => {
      const invalidConfig = { nodes: [], edges: [] };
      expect(() => new LangGraphWorkflow(invalidConfig)).toThrow('Invalid workflow configuration');
    });

    test('should set initial context', () => {
      const context = { userId: 'test-user', sessionId: 'test-session' };
      workflow.setContext(context);

      expect(workflow.getContext()).toEqual(context);
      expect(workflow.getContext().userId).toBe('test-user');
    });
  });

  describe('State Transitions', () => {
    test('should transition between states correctly', async () => {
      expect(workflow.getCurrentState()).toBe('start');

      await workflow.transition('process');
      expect(workflow.getCurrentState()).toBe('process');

      await workflow.transition('decision');
      expect(workflow.getCurrentState()).toBe('decision');
    });

    test('should validate transitions', async () => {
      // Invalid transition
      await expect(workflow.transition('end')).rejects.toThrow('Invalid transition');

      // Valid transition
      await expect(workflow.transition('process')).resolves.not.toThrow();
    });

    test('should handle conditional transitions', async () => {
      await workflow.transition('process');
      await workflow.transition('decision');

      // Set condition for success path
      workflow.setCondition('success', true);
      await workflow.transition();
      expect(workflow.getCurrentState()).toBe('end');
    });

    test('should handle retry logic', async () => {
      await workflow.transition('process');
      await workflow.transition('decision');

      // Set condition for retry path
      workflow.setCondition('retry', true);
      await workflow.transition();
      expect(workflow.getCurrentState()).toBe('process');
    });
  });

  describe('Node Execution', () => {
    test('should execute node functions', async () => {
      const mockNodeFunction = jest.fn().mockResolvedValue({ success: true });
      workflow.addNodeFunction('process', mockNodeFunction);

      await workflow.executeNode('process', { input: 'test' });

      expect(mockNodeFunction).toHaveBeenCalledWith({ input: 'test' });
    });

    test('should handle node execution errors', async () => {
      const mockNodeFunction = jest.fn().mockRejectedValue(new Error('Node error'));
      workflow.addNodeFunction('process', mockNodeFunction);

      await expect(workflow.executeNode('process', {})).rejects.toThrow('Node error');
    });

    test('should track execution history', async () => {
      await workflow.transition('process');
      await workflow.transition('decision');

      const history = workflow.getExecutionHistory();
      expect(history).toHaveLength(3); // start, process, decision
      expect(history[1].node).toBe('process');
      expect(history[1].timestamp).toBeDefined();
    });
  });

  describe('State Management', () => {
    test('should manage workflow state', () => {
      const state = { counter: 0, data: 'test' };
      workflow.setState(state);

      expect(workflow.getState()).toEqual(state);

      workflow.updateState({ counter: 1 });
      expect(workflow.getState().counter).toBe(1);
      expect(workflow.getState().data).toBe('test');
    });

    test('should handle state persistence', async () => {
      const state = { userId: 'test', progress: 50 };
      workflow.setState(state);

      const serialized = workflow.serialize();
      const newWorkflow = LangGraphWorkflow.deserialize(serialized);

      expect(newWorkflow.getState()).toEqual(state);
      expect(newWorkflow.getCurrentState()).toBe(workflow.getCurrentState());
    });

    test('should validate state schema', () => {
      const schema = {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          progress: { type: 'number', minimum: 0, maximum: 100 }
        },
        required: ['userId']
      };

      workflow.setStateSchema(schema);

      // Valid state
      expect(() => workflow.setState({ userId: 'test', progress: 50 })).not.toThrow();

      // Invalid state
      expect(() => workflow.setState({ progress: 50 })).toThrow('State validation failed');
    });
  });

  describe('Parallel Execution', () => {
    test('should handle parallel node execution', async () => {
      const mockNode1 = jest.fn().mockResolvedValue({ result: 'A' });
      const mockNode2 = jest.fn().mockResolvedValue({ result: 'B' });

      workflow.addNodeFunction('nodeA', mockNode1);
      workflow.addNodeFunction('nodeB', mockNode2);

      const results = await workflow.executeParallel(['nodeA', 'nodeB'], { input: 'test' });

      expect(results).toHaveLength(2);
      expect(results[0].result).toBe('A');
      expect(results[1].result).toBe('B');
      expect(mockNode1).toHaveBeenCalledWith({ input: 'test' });
      expect(mockNode2).toHaveBeenCalledWith({ input: 'test' });
    });

    test('should handle parallel execution errors', async () => {
      const mockNode1 = jest.fn().mockResolvedValue({ result: 'A' });
      const mockNode2 = jest.fn().mockRejectedValue(new Error('Node B error'));

      workflow.addNodeFunction('nodeA', mockNode1);
      workflow.addNodeFunction('nodeB', mockNode2);

      await expect(workflow.executeParallel(['nodeA', 'nodeB'], {})).rejects.toThrow('Node B error');
    });
  });

  describe('Workflow Completion', () => {
    test('should complete workflow successfully', async () => {
      await workflow.transition('process');
      await workflow.transition('decision');
      workflow.setCondition('success', true);
      await workflow.transition();

      expect(workflow.isCompleted()).toBe(true);
      expect(workflow.getCurrentState()).toBe('end');
    });

    test('should handle workflow cancellation', async () => {
      await workflow.transition('process');
      workflow.cancel();

      expect(workflow.isCancelled()).toBe(true);
      expect(workflow.getStatus()).toBe('cancelled');
    });

    test('should track execution metrics', async () => {
      const startTime = Date.now();

      await workflow.transition('process');
      await workflow.transition('decision');
      workflow.setCondition('success', true);
      await workflow.transition();

      const metrics = workflow.getMetrics();
      expect(metrics.totalExecutionTime).toBeGreaterThan(0);
      expect(metrics.nodeExecutions).toBe(3);
      expect(metrics.transitions).toBe(2);
    });
  });

  describe('Error Handling', () => {
    test('should handle workflow errors gracefully', async () => {
      const errorHandler = jest.fn();
      workflow.setErrorHandler(errorHandler);

      // Simulate error during execution
      workflow.addNodeFunction('process', () => {
        throw new Error('Processing error');
      });

      await workflow.transition('process');

      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
      expect(workflow.getStatus()).toBe('error');
    });

    test('should support error recovery', async () => {
      workflow.setErrorRecoveryStrategy('retry');

      let attempts = 0;
      workflow.addNodeFunction('process', () => {
        attempts++;
        if (attempts < 3) throw new Error('Temporary error');
        return { success: true };
      });

      await workflow.transition('process');

      expect(attempts).toBe(3);
      expect(workflow.getStatus()).toBe('running');
    });
  });

  describe('Hive Mind Integration', () => {
    test('should coordinate with other workflow instances', async () => {
      const coordination = workflow.getCoordination();
      expect(coordination).toBeDefined();
      expect(coordination.nodeId).toBeDefined();
    });

    test('should share state with hive memory', async () => {
      const state = { sharedData: 'test' };
      await workflow.shareStateWithHive(state);

      const sharedState = await workflow.getSharedState();
      expect(sharedState.sharedData).toBe('test');
    });

    test('should receive coordination messages', async () => {
      const messageHandler = jest.fn();
      workflow.setCoordinationMessageHandler(messageHandler);

      const message = {
        type: 'coordination',
        from: 'other-workflow',
        data: { action: 'sync' }
      };

      await workflow.handleCoordinationMessage(message);
      expect(messageHandler).toHaveBeenCalledWith(message);
    });
  });
});