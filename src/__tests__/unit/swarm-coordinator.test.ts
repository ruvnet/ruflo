/**
 * Comprehensive Unit Tests for Swarm Coordinator
 * Testing swarm orchestration, agent management, and task coordination
 */

import { jest } from '@jest/globals';
import { SwarmCoordinator } from '../../swarm/coordinator.js';
import { Logger } from '../../core/logger.js';
import { EventEmitter } from 'events';

// Mock dependencies
jest.mock('../../core/logger.js');
jest.mock('../../utils/paths.js');
jest.mock('../../swarm/strategies/auto.js');

const MockLogger = Logger as jest.MockedClass<typeof Logger>;

describe('SwarmCoordinator', () => {
  let coordinator: SwarmCoordinator;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    MockLogger.mockImplementation(() => mockLogger);

    coordinator = new SwarmCoordinator({
      mode: 'distributed',
      strategy: 'adaptive',
      maxAgents: 5,
      topology: 'mesh',
      logging: {
        level: 'info',
        format: 'json',
        destination: 'console'
      }
    });
  });

  afterEach(async () => {
    if (coordinator && (coordinator as any)._isRunning) {
      await coordinator.shutdown();
    }
    jest.clearAllMocks();
  });

  describe('Initialization and Configuration', () => {
    it('should initialize with default configuration', () => {
      const defaultCoordinator = new SwarmCoordinator();
      
      expect(defaultCoordinator).toBeInstanceOf(SwarmCoordinator);
      expect(defaultCoordinator).toBeInstanceOf(EventEmitter);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'SwarmCoordinator initialized',
        expect.objectContaining({
          swarmId: expect.any(String),
          mode: expect.any(String),
          strategy: expect.any(String)
        })
      );
    });

    it('should initialize with custom configuration', () => {
      const config = {
        mode: 'centralized' as const,
        strategy: 'parallel' as const,
        maxAgents: 10,
        topology: 'hierarchical' as const,
        timeout: 60000,
        retryAttempts: 5
      };

      const customCoordinator = new SwarmCoordinator(config);
      
      expect(customCoordinator).toBeInstanceOf(SwarmCoordinator);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'SwarmCoordinator initialized',
        expect.objectContaining({
          mode: 'centralized',
          strategy: 'parallel'
        })
      );
    });

    it('should generate unique swarm IDs', () => {
      const coordinator1 = new SwarmCoordinator();
      const coordinator2 = new SwarmCoordinator();
      
      const id1 = (coordinator1 as any).swarmId.id;
      const id2 = (coordinator2 as any).swarmId.id;
      
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
      expect(typeof id2).toBe('string');
    });

    it('should validate configuration on initialization', async () => {
      const invalidConfig = {
        maxAgents: -1, // Invalid value
        timeout: 0     // Invalid value
      };

      const invalidCoordinator = new SwarmCoordinator(invalidConfig);
      
      await expect(invalidCoordinator.initialize()).rejects.toThrow(
        expect.stringContaining('Configuration validation failed')
      );
    });

    it('should setup event handlers correctly', () => {
      const eventSpy = jest.fn();
      coordinator.on('swarm.started', eventSpy);
      
      expect(coordinator.listenerCount('swarm.started')).toBe(1);
    });
  });

  describe('Lifecycle Management', () => {
    it('should initialize successfully', async () => {
      await coordinator.initialize();
      
      expect((coordinator as any)._isRunning).toBe(true);
      expect((coordinator as any).status).toBe('executing');
      expect((coordinator as any).startTime).toBeInstanceOf(Date);
      expect(mockLogger.info).toHaveBeenCalledWith('Swarm coordinator initialized successfully');
    });

    it('should prevent double initialization', async () => {
      await coordinator.initialize();
      
      await expect(coordinator.initialize()).rejects.toThrow(
        'Swarm coordinator already running'
      );
    });

    it('should shutdown gracefully', async () => {
      await coordinator.initialize();
      await coordinator.shutdown();
      
      expect((coordinator as any)._isRunning).toBe(false);
      expect((coordinator as any).status).toBe('completed');
      expect((coordinator as any).endTime).toBeInstanceOf(Date);
      expect(mockLogger.info).toHaveBeenCalledWith('Swarm coordinator shut down successfully');
    });

    it('should handle shutdown when not running', async () => {
      // Should not throw error
      await coordinator.shutdown();
      
      expect((coordinator as any)._isRunning).toBe(false);
    });

    it('should pause and resume execution', async () => {
      await coordinator.initialize();
      
      await coordinator.pause();
      expect((coordinator as any).status).toBe('paused');
      
      await coordinator.resume();
      expect((coordinator as any).status).toBe('executing');
    });

    it('should emit lifecycle events', async () => {
      const startedEventSpy = jest.fn();
      const completedEventSpy = jest.fn();
      const pausedEventSpy = jest.fn();
      
      coordinator.on('swarm.started', startedEventSpy);
      coordinator.on('swarm.completed', completedEventSpy);
      coordinator.on('swarm.paused', pausedEventSpy);
      
      await coordinator.initialize();
      expect(startedEventSpy).toHaveBeenCalled();
      
      await coordinator.pause();
      expect(pausedEventSpy).toHaveBeenCalled();
      
      await coordinator.shutdown();
      expect(completedEventSpy).toHaveBeenCalled();
    });
  });

  describe('Agent Management', () => {
    beforeEach(async () => {
      await coordinator.initialize();
    });

    it('should spawn agents with correct configuration', async () => {
      const agentConfig = {
        type: 'researcher' as const,
        name: 'Test Researcher',
        capabilities: ['search', 'analyze'],
        maxConcurrentTasks: 3
      };

      const agentId = await coordinator.spawnAgent(agentConfig);
      
      expect(agentId).toBeDefined();
      expect(typeof agentId).toBe('string');
      
      const agents = await coordinator.listAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].type).toBe('researcher');
      expect(agents[0].name).toBe('Test Researcher');
    });

    it('should enforce maximum agent limits', async () => {
      const smallCoordinator = new SwarmCoordinator({ maxAgents: 2 });
      await smallCoordinator.initialize();

      try {
        await smallCoordinator.spawnAgent({ type: 'coder' });
        await smallCoordinator.spawnAgent({ type: 'tester' });
        
        await expect(smallCoordinator.spawnAgent({ type: 'researcher' })).rejects.toThrow(
          expect.stringContaining('Maximum agent limit reached')
        );
      } finally {
        await smallCoordinator.shutdown();
      }
    });

    it('should track agent states correctly', async () => {
      const agentId = await coordinator.spawnAgent({ type: 'coder' });
      
      let agent = await coordinator.getAgent(agentId);
      expect(agent.status).toBe('idle');
      
      // Simulate task assignment
      await coordinator.assignTask(agentId, {
        id: 'test-task',
        type: 'code',
        description: 'Write unit tests',
        priority: 'medium',
        estimatedDuration: 30000
      });
      
      agent = await coordinator.getAgent(agentId);
      expect(agent.status).toBe('busy');
    });

    it('should remove agents correctly', async () => {
      const agentId = await coordinator.spawnAgent({ type: 'analyst' });
      
      let agents = await coordinator.listAgents();
      expect(agents).toHaveLength(1);
      
      await coordinator.removeAgent(agentId);
      
      agents = await coordinator.listAgents();
      expect(agents).toHaveLength(0);
    });

    it('should handle agent failures gracefully', async () => {
      const agentId = await coordinator.spawnAgent({ type: 'coder' });
      
      // Simulate agent failure
      await coordinator.handleAgentFailure(agentId, new Error('Agent crashed'));
      
      const agent = await coordinator.getAgent(agentId);
      expect(agent.status).toBe('failed');
      expect(agent.lastError).toBeDefined();
    });

    it('should support different agent types', async () => {
      const agentTypes = ['coordinator', 'researcher', 'coder', 'analyst', 'tester'] as const;
      const spawnedAgents = [];

      for (const type of agentTypes) {
        const agentId = await coordinator.spawnAgent({ type });
        spawnedAgents.push(agentId);
      }

      const agents = await coordinator.listAgents();
      expect(agents).toHaveLength(agentTypes.length);
      
      const spawnedTypes = agents.map(a => a.type).sort();
      expect(spawnedTypes).toEqual([...agentTypes].sort());
    });
  });

  describe('Task Management', () => {
    let agentId: string;

    beforeEach(async () => {
      await coordinator.initialize();
      agentId = await coordinator.spawnAgent({ 
        type: 'coder',
        capabilities: ['coding', 'testing']
      });
    });

    it('should create and assign tasks correctly', async () => {
      const taskDefinition = {
        id: 'test-task-1',
        type: 'code' as const,
        description: 'Implement user authentication',
        priority: 'high' as const,
        estimatedDuration: 60000,
        dependencies: [],
        requirements: ['javascript', 'security']
      };

      await coordinator.assignTask(agentId, taskDefinition);
      
      const tasks = await coordinator.listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('test-task-1');
      expect(tasks[0].assignedTo).toBe(agentId);
      expect(tasks[0].status).toBe('assigned');
    });

    it('should handle task priorities correctly', async () => {
      const highPriorityTask = {
        id: 'high-task',
        type: 'test' as const,
        description: 'Critical bug fix',
        priority: 'critical' as const,
        estimatedDuration: 30000
      };

      const lowPriorityTask = {
        id: 'low-task',
        type: 'code' as const,
        description: 'Code cleanup',
        priority: 'low' as const,
        estimatedDuration: 45000
      };

      await coordinator.queueTask(highPriorityTask);
      await coordinator.queueTask(lowPriorityTask);
      
      const tasks = await coordinator.listTasks({ sortBy: 'priority' });
      expect(tasks[0].priority).toBe('critical');
      expect(tasks[1].priority).toBe('low');
    });

    it('should track task dependencies', async () => {
      const dependencyTask = {
        id: 'dependency-task',
        type: 'analysis' as const,
        description: 'Analyze requirements',
        priority: 'medium' as const,
        estimatedDuration: 20000
      };

      const mainTask = {
        id: 'main-task',
        type: 'code' as const,
        description: 'Implement feature',
        priority: 'high' as const,
        estimatedDuration: 40000,
        dependencies: ['dependency-task']
      };

      await coordinator.queueTask(dependencyTask);
      await coordinator.queueTask(mainTask);
      
      const tasks = await coordinator.listTasks();
      const main = tasks.find(t => t.id === 'main-task');
      expect(main?.dependencies).toContain('dependency-task');
      expect(main?.status).toBe('blocked'); // Should be blocked by dependency
    });

    it('should update task status correctly', async () => {
      const taskDefinition = {
        id: 'status-test',
        type: 'code' as const,
        description: 'Test status updates',
        priority: 'medium' as const,
        estimatedDuration: 30000
      };

      await coordinator.assignTask(agentId, taskDefinition);
      
      // Start task
      await coordinator.updateTaskStatus('status-test', 'in_progress');
      let task = await coordinator.getTask('status-test');
      expect(task.status).toBe('in_progress');
      expect(task.startTime).toBeDefined();
      
      // Complete task
      await coordinator.updateTaskStatus('status-test', 'completed', {
        output: 'Task completed successfully',
        metrics: { duration: 25000 }
      });
      
      task = await coordinator.getTask('status-test');
      expect(task.status).toBe('completed');
      expect(task.endTime).toBeDefined();
      expect(task.output).toBe('Task completed successfully');
    });

    it('should handle task failures', async () => {
      const taskDefinition = {
        id: 'failure-test',
        type: 'test' as const,
        description: 'Test failure handling',
        priority: 'medium' as const,
        estimatedDuration: 30000
      };

      await coordinator.assignTask(agentId, taskDefinition);
      
      const error = new Error('Task execution failed');
      await coordinator.handleTaskFailure('failure-test', error);
      
      const task = await coordinator.getTask('failure-test');
      expect(task.status).toBe('failed');
      expect(task.error).toBe(error.message);
      expect(task.retryCount).toBe(0);
    });

    it('should support task retries', async () => {
      const retryCoordinator = new SwarmCoordinator({ 
        retryAttempts: 3,
        retryDelay: 1000
      });
      await retryCoordinator.initialize();
      
      try {
        const agentId = await retryCoordinator.spawnAgent({ type: 'coder' });
        const taskDefinition = {
          id: 'retry-test',
          type: 'code' as const,
          description: 'Test retry mechanism',
          priority: 'medium' as const,
          estimatedDuration: 30000
        };

        await retryCoordinator.assignTask(agentId, taskDefinition);
        
        // Fail task multiple times
        await retryCoordinator.handleTaskFailure('retry-test', new Error('First failure'));
        let task = await retryCoordinator.getTask('retry-test');
        expect(task.retryCount).toBe(1);
        expect(task.status).toBe('pending'); // Should be queued for retry
        
        await retryCoordinator.handleTaskFailure('retry-test', new Error('Second failure'));
        task = await retryCoordinator.getTask('retry-test');
        expect(task.retryCount).toBe(2);
        
        await retryCoordinator.handleTaskFailure('retry-test', new Error('Third failure'));
        task = await retryCoordinator.getTask('retry-test');
        expect(task.retryCount).toBe(3);
        
        await retryCoordinator.handleTaskFailure('retry-test', new Error('Final failure'));
        task = await retryCoordinator.getTask('retry-test');
        expect(task.status).toBe('failed'); // Should give up after max retries
        
      } finally {
        await retryCoordinator.shutdown();
      }
    });
  });

  describe('Swarm Strategies', () => {
    beforeEach(async () => {
      await coordinator.initialize();
    });

    it('should support adaptive strategy', async () => {
      const adaptiveCoordinator = new SwarmCoordinator({
        strategy: 'adaptive',
        topology: 'mesh'
      });
      await adaptiveCoordinator.initialize();
      
      try {
        // Spawn agents for adaptive load balancing
        const agents = await Promise.all([
          adaptiveCoordinator.spawnAgent({ type: 'coder' }),
          adaptiveCoordinator.spawnAgent({ type: 'tester' }),
          adaptiveCoordinator.spawnAgent({ type: 'researcher' })
        ]);

        // Queue multiple tasks
        const tasks = [
          { id: 'task-1', type: 'code' as const, description: 'Task 1', priority: 'high' as const },
          { id: 'task-2', type: 'test' as const, description: 'Task 2', priority: 'medium' as const },
          { id: 'task-3', type: 'research' as const, description: 'Task 3', priority: 'low' as const }
        ];

        for (const task of tasks) {
          await adaptiveCoordinator.queueTask(task);
        }

        // Strategy should auto-assign tasks to appropriate agents
        const allTasks = await adaptiveCoordinator.listTasks();
        const assignedTasks = allTasks.filter(t => t.assignedTo);
        expect(assignedTasks.length).toBeGreaterThan(0);
        
      } finally {
        await adaptiveCoordinator.shutdown();
      }
    });

    it('should support parallel strategy', async () => {
      const parallelCoordinator = new SwarmCoordinator({
        strategy: 'parallel',
        maxAgents: 4
      });
      await parallelCoordinator.initialize();
      
      try {
        // Spawn multiple agents
        const agents = await Promise.all([
          parallelCoordinator.spawnAgent({ type: 'coder' }),
          parallelCoordinator.spawnAgent({ type: 'coder' }),
          parallelCoordinator.spawnAgent({ type: 'coder' })
        ]);

        // Queue parallel tasks
        const parallelTasks = [
          { id: 'parallel-1', type: 'code' as const, description: 'Parallel Task 1', priority: 'medium' as const },
          { id: 'parallel-2', type: 'code' as const, description: 'Parallel Task 2', priority: 'medium' as const },
          { id: 'parallel-3', type: 'code' as const, description: 'Parallel Task 3', priority: 'medium' as const }
        ];

        for (const task of parallelTasks) {
          await parallelCoordinator.queueTask(task);
        }

        // All tasks should be assigned to different agents for parallel execution
        const tasks = await parallelCoordinator.listTasks();
        const assignedAgents = new Set(tasks.map(t => t.assignedTo).filter(Boolean));
        expect(assignedAgents.size).toBe(Math.min(agents.length, parallelTasks.length));
        
      } finally {
        await parallelCoordinator.shutdown();
      }
    });

    it('should support sequential strategy', async () => {
      const sequentialCoordinator = new SwarmCoordinator({
        strategy: 'sequential'
      });
      await sequentialCoordinator.initialize();
      
      try {
        const agentId = await sequentialCoordinator.spawnAgent({ type: 'coder' });

        // Queue sequential tasks
        const sequentialTasks = [
          { id: 'seq-1', type: 'code' as const, description: 'Sequential Task 1', priority: 'high' as const },
          { id: 'seq-2', type: 'code' as const, description: 'Sequential Task 2', priority: 'high' as const }
        ];

        for (const task of sequentialTasks) {
          await sequentialCoordinator.queueTask(task);
        }

        // Only first task should be assigned initially
        const tasks = await sequentialCoordinator.listTasks();
        const assignedTasks = tasks.filter(t => t.assignedTo);
        expect(assignedTasks).toHaveLength(1);
        expect(assignedTasks[0].id).toBe('seq-1');
        
      } finally {
        await sequentialCoordinator.shutdown();
      }
    });
  });

  describe('Communication and Events', () => {
    beforeEach(async () => {
      await coordinator.initialize();
    });

    it('should emit task-related events', async () => {
      const taskCreatedSpy = jest.fn();
      const taskAssignedSpy = jest.fn();
      const taskCompletedSpy = jest.fn();
      
      coordinator.on('task.created', taskCreatedSpy);
      coordinator.on('task.assigned', taskAssignedSpy);
      coordinator.on('task.completed', taskCompletedSpy);
      
      const agentId = await coordinator.spawnAgent({ type: 'coder' });
      const taskDefinition = {
        id: 'event-test',
        type: 'code' as const,
        description: 'Test event emission',
        priority: 'medium' as const,
        estimatedDuration: 30000
      };

      await coordinator.queueTask(taskDefinition);
      expect(taskCreatedSpy).toHaveBeenCalled();
      
      await coordinator.assignTask(agentId, taskDefinition);
      expect(taskAssignedSpy).toHaveBeenCalled();
      
      await coordinator.updateTaskStatus('event-test', 'completed');
      expect(taskCompletedSpy).toHaveBeenCalled();
    });

    it('should emit agent-related events', async () => {
      const agentSpawnedSpy = jest.fn();
      const agentRemovedSpy = jest.fn();
      
      coordinator.on('agent.spawned', agentSpawnedSpy);
      coordinator.on('agent.removed', agentRemovedSpy);
      
      const agentId = await coordinator.spawnAgent({ type: 'researcher' });
      expect(agentSpawnedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentId,
            type: 'researcher'
          })
        })
      );
      
      await coordinator.removeAgent(agentId);
      expect(agentRemovedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentId
          })
        })
      );
    });

    it('should support message broadcasting', async () => {
      const agent1Id = await coordinator.spawnAgent({ type: 'coder' });
      const agent2Id = await coordinator.spawnAgent({ type: 'tester' });
      
      const message = {
        type: 'broadcast',
        content: 'Global announcement',
        timestamp: new Date(),
        from: 'coordinator'
      };

      await coordinator.broadcastMessage(message);
      
      // Should emit broadcast event
      expect(coordinator.listenerCount('message.broadcast')).toBeGreaterThanOrEqual(0);
    });

    it('should handle inter-agent communication', async () => {
      const senderAgent = await coordinator.spawnAgent({ type: 'coder' });
      const receiverAgent = await coordinator.spawnAgent({ type: 'tester' });
      
      const message = {
        type: 'direct',
        content: 'Test completed, ready for integration',
        from: senderAgent,
        to: receiverAgent,
        timestamp: new Date()
      };

      await coordinator.sendMessage(senderAgent, receiverAgent, message);
      
      // Should track message in agent states
      const sender = await coordinator.getAgent(senderAgent);
      const receiver = await coordinator.getAgent(receiverAgent);
      
      expect(sender.messagesSent).toBeGreaterThan(0);
      expect(receiver.messagesReceived).toBeGreaterThan(0);
    });
  });

  describe('Performance Monitoring and Metrics', () => {
    beforeEach(async () => {
      await coordinator.initialize();
    });

    it('should track comprehensive metrics', async () => {
      const agentId = await coordinator.spawnAgent({ type: 'coder' });
      
      // Create and complete some tasks to generate metrics
      const tasks = [
        { id: 'metrics-1', type: 'code' as const, description: 'Task 1', priority: 'high' as const },
        { id: 'metrics-2', type: 'test' as const, description: 'Task 2', priority: 'medium' as const }
      ];

      for (const task of tasks) {
        await coordinator.queueTask(task);
        await coordinator.assignTask(agentId, task);
        await coordinator.updateTaskStatus(task.id, 'completed');
      }

      const metrics = await coordinator.getMetrics();
      
      expect(metrics).toHaveProperty('totalTasks');
      expect(metrics).toHaveProperty('completedTasks');
      expect(metrics).toHaveProperty('failedTasks');
      expect(metrics).toHaveProperty('activeAgents');
      expect(metrics).toHaveProperty('averageTaskDuration');
      expect(metrics).toHaveProperty('throughput');
      
      expect(metrics.totalTasks).toBe(2);
      expect(metrics.completedTasks).toBe(2);
      expect(metrics.activeAgents).toBe(1);
    });

    it('should calculate performance statistics', async () => {
      const agentId = await coordinator.spawnAgent({ type: 'coder' });
      
      // Simulate task with known duration
      const taskDefinition = {
        id: 'perf-test',
        type: 'code' as const,
        description: 'Performance test task',
        priority: 'medium' as const,
        estimatedDuration: 30000
      };

      await coordinator.assignTask(agentId, taskDefinition);
      await coordinator.updateTaskStatus('perf-test', 'in_progress');
      
      // Wait a bit to simulate work
      await new Promise(resolve => setTimeout(resolve, 100));
      
      await coordinator.updateTaskStatus('perf-test', 'completed');
      
      const metrics = await coordinator.getMetrics();
      expect(metrics.averageTaskDuration).toBeGreaterThan(0);
      expect(metrics.throughput).toBeGreaterThanOrEqual(0);
    });

    it('should track resource utilization', async () => {
      // Spawn multiple agents with different loads
      const agents = await Promise.all([
        coordinator.spawnAgent({ type: 'coder', maxConcurrentTasks: 2 }),
        coordinator.spawnAgent({ type: 'tester', maxConcurrentTasks: 3 }),
        coordinator.spawnAgent({ type: 'researcher', maxConcurrentTasks: 1 })
      ]);

      const resourceMetrics = await coordinator.getResourceUtilization();
      
      expect(resourceMetrics).toHaveProperty('totalAgents', 3);
      expect(resourceMetrics).toHaveProperty('idleAgents');
      expect(resourceMetrics).toHaveProperty('busyAgents');
      expect(resourceMetrics).toHaveProperty('avgCpuUsage');
      expect(resourceMetrics).toHaveProperty('avgMemoryUsage');
    });

    it('should generate performance reports', async () => {
      // Create some activity for the report
      const agentId = await coordinator.spawnAgent({ type: 'coder' });
      await coordinator.queueTask({
        id: 'report-task',
        type: 'code' as const,
        description: 'Task for reporting',
        priority: 'medium' as const
      });

      const report = await coordinator.generatePerformanceReport();
      
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('agentPerformance');
      expect(report).toHaveProperty('taskAnalysis');
      expect(report).toHaveProperty('recommendations');
      expect(report).toHaveProperty('generatedAt');
      
      expect(report.summary.totalAgents).toBe(1);
      expect(report.summary.totalTasks).toBe(1);
    });
  });

  describe('Error Handling and Recovery', () => {
    beforeEach(async () => {
      await coordinator.initialize();
    });

    it('should handle initialization failures gracefully', async () => {
      const faultyCoordinator = new SwarmCoordinator({
        maxAgents: -1 // Invalid configuration
      });

      await expect(faultyCoordinator.initialize()).rejects.toThrow();
      expect((faultyCoordinator as any).status).toBe('failed');
    });

    it('should recover from agent failures', async () => {
      const agentId = await coordinator.spawnAgent({ type: 'coder' });
      
      // Simulate agent failure
      const error = new Error('Agent process crashed');
      await coordinator.handleAgentFailure(agentId, error);
      
      const agent = await coordinator.getAgent(agentId);
      expect(agent.status).toBe('failed');
      expect(agent.lastError).toBe(error.message);
      
      // Coordinator should attempt recovery
      await coordinator.recoverFailedAgent(agentId);
      
      const recoveredAgent = await coordinator.getAgent(agentId);
      expect(recoveredAgent.status).toBe('idle');
      expect(recoveredAgent.restartCount).toBe(1);
    });

    it('should handle task timeout', async () => {
      const shortTimeoutCoordinator = new SwarmCoordinator({
        timeout: 1000 // 1 second timeout
      });
      await shortTimeoutCoordinator.initialize();
      
      try {
        const agentId = await shortTimeoutCoordinator.spawnAgent({ type: 'coder' });
        const taskDefinition = {
          id: 'timeout-test',
          type: 'code' as const,
          description: 'Task that will timeout',
          priority: 'medium' as const,
          estimatedDuration: 5000 // Longer than timeout
        };

        await shortTimeoutCoordinator.assignTask(agentId, taskDefinition);
        await shortTimeoutCoordinator.updateTaskStatus('timeout-test', 'in_progress');
        
        // Wait for timeout
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const task = await shortTimeoutCoordinator.getTask('timeout-test');
        expect(task.status).toBe('failed');
        expect(task.error).toContain('timeout');
        
      } finally {
        await shortTimeoutCoordinator.shutdown();
      }
    });

    it('should handle communication failures', async () => {
      const agent1 = await coordinator.spawnAgent({ type: 'coder' });
      const agent2 = await coordinator.spawnAgent({ type: 'tester' });
      
      // Simulate communication failure
      const message = {
        type: 'direct',
        content: 'This message will fail',
        from: agent1,
        to: 'invalid-agent-id', // Invalid recipient
        timestamp: new Date()
      };

      await expect(coordinator.sendMessage(agent1, 'invalid-agent-id', message))
        .rejects.toThrow('Agent not found');
    });

    it('should cleanup resources on shutdown failure', async () => {
      const cleanupSpy = jest.fn();
      (coordinator as any).cleanupResources = cleanupSpy;
      
      // Mock shutdown failure
      const originalStopAllAgents = (coordinator as any).stopAllAgents;
      (coordinator as any).stopAllAgents = jest.fn().mockRejectedValue(new Error('Shutdown failed'));
      
      await expect(coordinator.shutdown()).rejects.toThrow('Shutdown failed');
      
      // Restore original method
      (coordinator as any).stopAllAgents = originalStopAllAgents;
    });
  });

  describe('Integration and Real-world Scenarios', () => {
    it('should handle large-scale operations', async () => {
      const largeScaleCoordinator = new SwarmCoordinator({
        maxAgents: 20,
        strategy: 'adaptive',
        topology: 'hierarchical'
      });
      await largeScaleCoordinator.initialize();
      
      try {
        // Spawn many agents
        const agentPromises = [];
        const agentTypes = ['coder', 'tester', 'researcher', 'analyst'] as const;
        
        for (let i = 0; i < 15; i++) {
          const type = agentTypes[i % agentTypes.length];
          agentPromises.push(largeScaleCoordinator.spawnAgent({ type }));
        }
        
        const agents = await Promise.all(agentPromises);
        expect(agents).toHaveLength(15);
        
        // Queue many tasks
        const taskPromises = [];
        for (let i = 0; i < 50; i++) {
          const task = {
            id: `large-task-${i}`,
            type: agentTypes[i % agentTypes.length] as any,
            description: `Large scale task ${i}`,
            priority: ['low', 'medium', 'high'][i % 3] as any
          };
          taskPromises.push(largeScaleCoordinator.queueTask(task));
        }
        
        await Promise.all(taskPromises);
        
        const allTasks = await largeScaleCoordinator.listTasks();
        expect(allTasks).toHaveLength(50);
        
        const metrics = await largeScaleCoordinator.getMetrics();
        expect(metrics.totalTasks).toBe(50);
        expect(metrics.activeAgents).toBe(15);
        
      } finally {
        await largeScaleCoordinator.shutdown();
      }
    });

    it('should handle mixed workload scenarios', async () => {
      await coordinator.initialize();
      
      // Create diverse agent pool
      const coder = await coordinator.spawnAgent({ 
        type: 'coder', 
        capabilities: ['javascript', 'python', 'testing']
      });
      const researcher = await coordinator.spawnAgent({ 
        type: 'researcher',
        capabilities: ['analysis', 'documentation']
      });
      const tester = await coordinator.spawnAgent({ 
        type: 'tester',
        capabilities: ['unit-testing', 'integration-testing']
      });
      
      // Queue mixed tasks with dependencies
      const tasks = [
        {
          id: 'research-phase',
          type: 'research' as const,
          description: 'Research user requirements',
          priority: 'high' as const,
          estimatedDuration: 30000
        },
        {
          id: 'design-phase',
          type: 'analysis' as const,
          description: 'Design system architecture',
          priority: 'high' as const,
          dependencies: ['research-phase'],
          estimatedDuration: 40000
        },
        {
          id: 'implementation-phase',
          type: 'code' as const,
          description: 'Implement core features',
          priority: 'medium' as const,
          dependencies: ['design-phase'],
          estimatedDuration: 60000
        },
        {
          id: 'testing-phase',
          type: 'test' as const,
          description: 'Write and execute tests',
          priority: 'medium' as const,
          dependencies: ['implementation-phase'],
          estimatedDuration: 30000
        }
      ];

      for (const task of tasks) {
        await coordinator.queueTask(task);
      }
      
      // Only the first task should be immediately assignable
      const queuedTasks = await coordinator.listTasks();
      const assignableTasks = queuedTasks.filter(t => t.status === 'pending' && !t.dependencies?.length);
      expect(assignableTasks).toHaveLength(1);
      expect(assignableTasks[0].id).toBe('research-phase');
    });
  });
});