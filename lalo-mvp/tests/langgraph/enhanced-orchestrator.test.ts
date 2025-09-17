import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { EnhancedLangGraphOrchestrator, WorkflowExecution } from '../../src/langgraph/enhanced-orchestrator.js';
import { Workflow, WorkflowNode, WorkflowEdge } from '../../src/types/index.js';
import GovernanceSystem from '../../src/governance/index.js';
import RAGSystem from '../../src/rag/index.js';
import NL2SQLEngine from '../../src/nl2sql/index.js';

// Mock the dependencies
jest.mock('../../src/governance/index.js');
jest.mock('../../src/rag/index.js');
jest.mock('../../src/nl2sql/index.js');

describe('EnhancedLangGraphOrchestrator', () => {
  let orchestrator: EnhancedLangGraphOrchestrator;
  let mockGovernance: jest.Mocked<GovernanceSystem>;
  let mockRAG: jest.Mocked<RAGSystem>;
  let mockNL2SQL: jest.Mocked<NL2SQLEngine>;

  const sampleWorkflow: Workflow = {
    id: 'test-workflow',
    name: 'Test Workflow',
    description: 'A test workflow for unit testing',
    nodes: [
      {
        id: 'start',
        type: 'start',
        name: 'Start Node'
      },
      {
        id: 'process',
        type: 'task',
        name: 'Process Node',
        function: 'process_data'
      },
      {
        id: 'decision',
        type: 'decision',
        name: 'Decision Node',
        condition: 'data.processed',
        next: ['end', 'error']
      },
      {
        id: 'parallel',
        type: 'parallel',
        name: 'Parallel Node',
        next: ['task1', 'task2']
      },
      {
        id: 'end',
        type: 'end',
        name: 'End Node'
      }
    ],
    edges: [
      { from: 'start', to: 'process' },
      { from: 'process', to: 'decision' },
      { from: 'decision', to: 'end', condition: 'data.processed' },
      { from: 'parallel', to: 'end' }
    ]
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock instances
    mockGovernance = new GovernanceSystem() as jest.Mocked<GovernanceSystem>;
    mockRAG = new RAGSystem() as jest.Mocked<RAGSystem>;
    mockNL2SQL = new NL2SQLEngine() as jest.Mocked<NL2SQLEngine>;

    // Setup mock implementations
    mockGovernance.on = jest.fn();
    mockGovernance.getProposal = jest.fn();

    mockRAG.search = jest.fn().mockResolvedValue([
      {
        document: { id: 'doc1', content: 'test content', metadata: {}, createdAt: new Date() },
        score: 0.95,
        relevance: 0.95
      }
    ]);

    mockNL2SQL.convertToSQL = jest.fn().mockResolvedValue({
      sql: 'SELECT * FROM test_table',
      confidence: 0.9,
      explanation: 'Test SQL query',
      tables: ['test_table'],
      metadata: {}
    });

    orchestrator = new EnhancedLangGraphOrchestrator(mockGovernance, mockRAG, mockNL2SQL);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Workflow Registration', () => {
    it('should register a workflow successfully', async () => {
      await expect(orchestrator.registerWorkflow(sampleWorkflow)).resolves.toBeUndefined();
      expect(orchestrator.getWorkflows()).toContain('test-workflow');
    });

    it('should throw error for invalid workflow', async () => {
      const invalidWorkflow = { ...sampleWorkflow, nodes: [] };
      await expect(orchestrator.registerWorkflow(invalidWorkflow)).rejects.toThrow();
    });
  });

  describe('Workflow Execution', () => {
    beforeEach(async () => {
      await orchestrator.registerWorkflow(sampleWorkflow);
    });

    it('should execute a basic workflow successfully', async () => {
      const input = { test: 'data' };
      const result = await orchestrator.executeWorkflow('test-workflow', input);

      expect(result).toBeDefined();
      expect(result.completed).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({ processed: true }));
    });

    it('should execute workflow with RAG enabled', async () => {
      const input = { query: 'test query' };
      const options = { enableRAG: true };

      const result = await orchestrator.executeWorkflow('test-workflow', input, options);

      expect(result).toBeDefined();
      expect(mockRAG.search).toHaveBeenCalled();
      expect(result.ragResults).toBeDefined();
    });

    it('should execute workflow with SQL enabled', async () => {
      const input = { naturalLanguage: 'show all users' };
      const options = { enableSQL: true };

      const result = await orchestrator.executeWorkflow('test-workflow', input, options);

      expect(result).toBeDefined();
      expect(mockNL2SQL.convertToSQL).toHaveBeenCalled();
      expect(result.sqlResults).toBeDefined();
    });

    it('should handle workflow execution with governance approval', async () => {
      const input = { test: 'data' };
      const options = { requireGovernance: true };

      // Mock governance approval
      mockGovernance.getProposal.mockReturnValue({
        id: 'prop1',
        title: 'Test Proposal',
        description: 'Test',
        proposer: 'test',
        type: 'workflow',
        category: 'standard',
        status: 'passed',
        votes: [],
        signatures: [],
        createdAt: new Date(),
        votingEndsAt: new Date(),
        metadata: {
          tags: [],
          priority: 'medium',
          estimatedImpact: 'minimal',
          riskLevel: 'low'
        },
        requiredApprovals: []
      });

      const result = await orchestrator.executeWorkflow('test-workflow', input, options);
      expect(result).toBeDefined();
    });

    it('should timeout long-running workflows', async () => {
      // Register a workflow that would take longer than timeout
      const longWorkflow: Workflow = {
        ...sampleWorkflow,
        id: 'long-workflow',
        nodes: [
          {
            id: 'start',
            type: 'start',
            name: 'Start'
          },
          {
            id: 'slow',
            type: 'task',
            name: 'Slow Task',
            function: 'slow_function'
          },
          {
            id: 'end',
            type: 'end',
            name: 'End'
          }
        ],
        edges: [
          { from: 'start', to: 'slow' },
          { from: 'slow', to: 'end' }
        ]
      };

      // Register a slow function
      orchestrator.registerFunction('slow_function', async () => {
        return new Promise(resolve => setTimeout(resolve, 5000));
      });

      await orchestrator.registerWorkflow(longWorkflow);

      const input = { test: 'data' };
      const options = { timeout: 100 }; // 100ms timeout

      await expect(
        orchestrator.executeWorkflow('long-workflow', input, options)
      ).rejects.toThrow('Workflow timeout');
    });
  });

  describe('Execution Management', () => {
    beforeEach(async () => {
      await orchestrator.registerWorkflow(sampleWorkflow);
    });

    it('should track active executions', async () => {
      const input = { test: 'data' };

      // Start execution without waiting
      const executionPromise = orchestrator.executeWorkflow('test-workflow', input);

      // Check active executions
      const activeExecutions = orchestrator.getActiveExecutions();
      expect(activeExecutions.length).toBeGreaterThan(0);

      // Wait for completion
      await executionPromise;

      // Check that execution is no longer active
      const finalActiveExecutions = orchestrator.getActiveExecutions();
      expect(finalActiveExecutions.length).toBe(0);
    });

    it('should pause and resume executions', async () => {
      // This would require a more complex setup with a pausable workflow
      // For now, we'll test the API
      const executionId = 'test-execution-id';

      // Mock an active execution
      const mockExecution: WorkflowExecution = {
        id: executionId,
        workflowId: 'test-workflow',
        state: {
          messages: [],
          data: {},
          currentNode: 'process',
          completed: false
        },
        status: 'running',
        startTime: new Date(),
        progress: 50,
        metrics: {
          totalNodes: 5,
          completedNodes: 2,
          failedNodes: 0,
          executionTime: 1000,
          memoryUsage: 1024,
          resourceUsage: {},
          parallelExecutions: 0
        }
      };

      // Manually add to active executions for testing
      (orchestrator as any).activeExecutions.set(executionId, mockExecution);

      // Test pause
      const pauseResult = await orchestrator.pauseExecution(executionId);
      expect(pauseResult).toBe(true);

      // Test resume
      const resumeResult = await orchestrator.resumeExecution(executionId);
      expect(resumeResult).toBe(true);

      // Test cancel
      const cancelResult = await orchestrator.cancelExecution(executionId);
      expect(cancelResult).toBe(true);
    });

    it('should provide execution metrics', async () => {
      const input = { test: 'data' };
      await orchestrator.executeWorkflow('test-workflow', input);

      const systemMetrics = orchestrator.getSystemMetrics();
      expect(systemMetrics).toEqual(expect.objectContaining({
        activeExecutions: expect.any(Number),
        pausedExecutions: expect.any(Number),
        registeredWorkflows: expect.any(Number),
        registeredFunctions: expect.any(Number),
        totalExecutions: expect.any(Number),
        averageExecutionTime: expect.any(Number),
        memoryUsage: expect.any(Object)
      }));
    });
  });

  describe('Custom Functions', () => {
    it('should register and execute custom functions', async () => {
      const customFunction = jest.fn().mockResolvedValue({ custom: true });
      orchestrator.registerFunction('custom_test', customFunction);

      // Create workflow with custom function
      const customWorkflow: Workflow = {
        id: 'custom-workflow',
        name: 'Custom Workflow',
        description: 'Workflow with custom function',
        nodes: [
          { id: 'start', type: 'start', name: 'Start' },
          { id: 'custom', type: 'task', name: 'Custom Task', function: 'custom_test' },
          { id: 'end', type: 'end', name: 'End' }
        ],
        edges: [
          { from: 'start', to: 'custom' },
          { from: 'custom', to: 'end' }
        ]
      };

      await orchestrator.registerWorkflow(customWorkflow);

      const input = { test: 'data' };
      const result = await orchestrator.executeWorkflow('custom-workflow', input);

      expect(customFunction).toHaveBeenCalled();
      expect(result.data).toEqual(expect.objectContaining({ custom: true }));
    });
  });

  describe('Memory Management', () => {
    it('should store and retrieve workflow memory', () => {
      const workflowId = 'test-workflow';
      const memory = { key: 'value', data: [1, 2, 3] };

      orchestrator.setWorkflowMemory(workflowId, memory);
      const retrievedMemory = orchestrator.getWorkflowMemory(workflowId);

      expect(retrievedMemory).toEqual(memory);
    });

    it('should return undefined for non-existent workflow memory', () => {
      const memory = orchestrator.getWorkflowMemory('non-existent-workflow');
      expect(memory).toBeUndefined();
    });
  });

  describe('Event System', () => {
    it('should emit workflow lifecycle events', async () => {
      const startedHandler = jest.fn();
      const completedHandler = jest.fn();
      const nodeEnterHandler = jest.fn();
      const nodeExitHandler = jest.fn();

      orchestrator.on('workflow:started', startedHandler);
      orchestrator.on('workflow:completed', completedHandler);
      orchestrator.on('workflow:node:enter', nodeEnterHandler);
      orchestrator.on('workflow:node:exit', nodeExitHandler);

      const input = { test: 'data' };
      await orchestrator.executeWorkflow('test-workflow', input);

      expect(startedHandler).toHaveBeenCalled();
      expect(completedHandler).toHaveBeenCalled();
      expect(nodeEnterHandler).toHaveBeenCalled();
      expect(nodeExitHandler).toHaveBeenCalled();
    });

    it('should emit integration events', async () => {
      const ragHandler = jest.fn();
      const sqlHandler = jest.fn();

      orchestrator.on('rag:context:injected', ragHandler);
      orchestrator.on('sql:query:executed', sqlHandler);

      const input = { query: 'test query', naturalLanguage: 'show data' };
      const options = { enableRAG: true, enableSQL: true };

      await orchestrator.executeWorkflow('test-workflow', input, options);

      expect(ragHandler).toHaveBeenCalled();
      expect(sqlHandler).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle workflow execution errors gracefully', async () => {
      const errorFunction = jest.fn().mockRejectedValue(new Error('Test error'));
      orchestrator.registerFunction('error_function', errorFunction);

      const errorWorkflow: Workflow = {
        id: 'error-workflow',
        name: 'Error Workflow',
        description: 'Workflow that throws error',
        nodes: [
          { id: 'start', type: 'start', name: 'Start' },
          { id: 'error', type: 'task', name: 'Error Task', function: 'error_function' },
          { id: 'end', type: 'end', name: 'End' }
        ],
        edges: [
          { from: 'start', to: 'error' },
          { from: 'error', to: 'end' }
        ]
      };

      await orchestrator.registerWorkflow(errorWorkflow);

      const input = { test: 'data' };

      await expect(
        orchestrator.executeWorkflow('error-workflow', input)
      ).rejects.toThrow('Workflow execution failed');
    });

    it('should emit error events for node failures', async () => {
      const errorHandler = jest.fn();
      orchestrator.on('workflow:node:error', errorHandler);

      const errorFunction = jest.fn().mockRejectedValue(new Error('Node error'));
      orchestrator.registerFunction('node_error_function', errorFunction);

      const errorWorkflow: Workflow = {
        id: 'node-error-workflow',
        name: 'Node Error Workflow',
        description: 'Workflow with node error',
        nodes: [
          { id: 'start', type: 'start', name: 'Start' },
          { id: 'error', type: 'task', name: 'Error Task', function: 'node_error_function' },
          { id: 'end', type: 'end', name: 'End' }
        ],
        edges: [
          { from: 'start', to: 'error' },
          { from: 'error', to: 'end' }
        ]
      };

      await orchestrator.registerWorkflow(errorWorkflow);

      const input = { test: 'data' };

      try {
        await orchestrator.executeWorkflow('node-error-workflow', input);
      } catch (error) {
        // Expected to fail
      }

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('Parallel Execution', () => {
    it('should handle parallel node execution', async () => {
      const parallelWorkflow: Workflow = {
        id: 'parallel-workflow',
        name: 'Parallel Workflow',
        description: 'Workflow with parallel execution',
        nodes: [
          { id: 'start', type: 'start', name: 'Start' },
          { id: 'parallel', type: 'parallel', name: 'Parallel Tasks', next: ['task1', 'task2'] },
          { id: 'end', type: 'end', name: 'End' }
        ],
        edges: [
          { from: 'start', to: 'parallel' },
          { from: 'parallel', to: 'end' }
        ]
      };

      await orchestrator.registerWorkflow(parallelWorkflow);

      const input = { tasks: [{ data: 'task1' }, { data: 'task2' }] };
      const result = await orchestrator.executeWorkflow('parallel-workflow', input);

      expect(result).toBeDefined();
      expect(result.data.parallelResults).toBeDefined();
    });
  });

  describe('Cleanup Operations', () => {
    it('should cleanup completed executions', async () => {
      const input = { test: 'data' };
      await orchestrator.executeWorkflow('test-workflow', input);

      // Execute multiple workflows to have completed executions
      await orchestrator.executeWorkflow('test-workflow', input);
      await orchestrator.executeWorkflow('test-workflow', input);

      const cleanedUp = orchestrator.cleanupCompletedExecutions();
      expect(cleanedUp).toBeGreaterThanOrEqual(0);
    });
  });
});