/**
 * End-to-End Swarm Coordination Tests for Gemini Flow v2.0.0
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { SystemIntegration } from '../../integration/system-integration.js';
import { SwarmCoordinator } from '../../coordination/swarm-coordinator.js';
import { AgentManager } from '../../agents/agent-manager.js';
import { TaskEngine } from '../../task/engine.js';
import { EventBus } from '../../core/event-bus.js';
import { Logger } from '../../core/logger.js';
import { MemoryManager } from '../../memory/manager.js';
import type { IntegrationConfig } from '../../integration/types.js';

// Mock external dependencies
jest.mock('fs-extra');
jest.mock('better-sqlite3');
jest.mock('child_process');

describe('End-to-End Swarm Coordination Tests', () => {
  let systemIntegration: SystemIntegration;
  let swarmCoordinator: SwarmCoordinator;
  let agentManager: AgentManager;
  let taskEngine: TaskEngine;
  let eventBus: EventBus;
  let logger: Logger;
  let memoryManager: MemoryManager;

  beforeEach(async () => {
    // Initialize system with test configuration
    const config: IntegrationConfig = {
      logLevel: 'info',
      environment: 'testing',
      swarm: {
        topology: 'mesh',
        maxDepth: 3,
        enablePersistence: true
      },
      agents: {
        maxAgents: 10,
        defaultStrategy: 'auto'
      },
      monitoring: {
        enabled: true,
        metrics: true,
        realTime: false // Disable for tests
      }
    };

    systemIntegration = SystemIntegration.getInstance();
    await systemIntegration.initialize(config);

    // Get initialized components
    swarmCoordinator = systemIntegration.getComponent<SwarmCoordinator>('swarmCoordinator')!;
    agentManager = systemIntegration.getComponent<AgentManager>('agentManager')!;
    taskEngine = systemIntegration.getComponent<TaskEngine>('taskEngine')!;
    eventBus = systemIntegration.getComponent<EventBus>('eventBus')!;
    logger = systemIntegration.getComponent<Logger>('logger')!;
    memoryManager = systemIntegration.getComponent<MemoryManager>('memoryManager')!;
  });

  afterEach(async () => {
    await systemIntegration.shutdown();
    jest.clearAllMocks();
  });

  describe('Basic Swarm Operations', () => {
    it('should create and manage a simple swarm', async () => {
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'Test swarm creation',
        strategy: 'development',
        topology: 'centralized',
        maxAgents: 3
      });

      expect(swarmId).toBeDefined();
      expect(typeof swarmId).toBe('string');

      const swarmStatus = await swarmCoordinator.getSwarmStatus(swarmId);
      expect(swarmStatus.id).toBe(swarmId);
      expect(swarmStatus.status).toBe('active');
    });

    it('should spawn agents within swarm', async () => {
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'Multi-agent test',
        strategy: 'research',
        topology: 'mesh',
        maxAgents: 5
      });

      // Spawn different types of agents
      const researcherAgent = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'researcher',
        name: 'Research Agent',
        capabilities: ['research', 'analysis', 'web-search']
      });

      const coderAgent = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coder',
        name: 'Coding Agent',
        capabilities: ['coding', 'testing', 'debugging']
      });

      const coordinatorAgent = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coordinator',
        name: 'Coordinator Agent',
        capabilities: ['coordination', 'task-management', 'communication']
      });

      expect(researcherAgent).toBeDefined();
      expect(coderAgent).toBeDefined();
      expect(coordinatorAgent).toBeDefined();

      const swarmAgents = await swarmCoordinator.getSwarmAgents(swarmId);
      expect(swarmAgents).toHaveLength(3);
    });

    it('should execute coordinated tasks', async () => {
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'Build a simple REST API',
        strategy: 'development',
        topology: 'hierarchical',
        maxAgents: 4
      });

      // Spawn coordinated agents
      const architects = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'architect',
        name: 'System Architect',
        capabilities: ['system-design', 'architecture']
      });

      const developer = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coder',
        name: 'Backend Developer',
        capabilities: ['nodejs', 'express', 'api-development']
      });

      const tester = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'tester',
        name: 'QA Engineer',
        capabilities: ['testing', 'jest', 'integration-testing']
      });

      // Create and execute coordinated task
      const taskId = await taskEngine.createTask({
        swarmId,
        type: 'development',
        objective: 'Build REST API with tests',
        requirements: [
          'Create Express.js server',
          'Implement CRUD endpoints',
          'Add input validation',
          'Write comprehensive tests',
          'Create API documentation'
        ],
        priority: 'high'
      });

      expect(taskId).toBeDefined();

      // Monitor task execution
      const taskStatus = await taskEngine.getTaskStatus(taskId);
      expect(taskStatus.id).toBe(taskId);
      expect(taskStatus.swarmId).toBe(swarmId);
    });
  });

  describe('Complex Swarm Workflows', () => {
    it('should handle research and development workflow', async () => {
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'Research and implement machine learning pipeline',
        strategy: 'research',
        topology: 'mesh',
        maxAgents: 6
      });

      // Research phase agents
      const researcher = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'researcher',
        name: 'ML Researcher',
        capabilities: ['ml-research', 'paper-analysis', 'algorithm-analysis']
      });

      const dataAnalyst = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'analyst',
        name: 'Data Analyst',
        capabilities: ['data-analysis', 'statistics', 'data-preprocessing']
      });

      // Development phase agents
      const mlEngineer = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coder',
        name: 'ML Engineer',
        capabilities: ['python', 'tensorflow', 'pytorch', 'scikit-learn']
      });

      const devopsEngineer = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'specialist',
        name: 'DevOps Engineer',
        capabilities: ['docker', 'kubernetes', 'ci-cd', 'deployment']
      });

      // Coordination agents
      const coordinator = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coordinator',
        name: 'Project Coordinator',
        capabilities: ['project-management', 'workflow-coordination']
      });

      const reviewer = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'reviewer',
        name: 'Code Reviewer',
        capabilities: ['code-review', 'quality-assurance', 'best-practices']
      });

      // Create phased workflow
      const researchTaskId = await taskEngine.createTask({
        swarmId,
        type: 'research',
        objective: 'Research ML algorithms for the use case',
        requirements: [
          'Analyze existing literature',
          'Compare algorithm performance',
          'Identify best approach',
          'Document findings'
        ],
        assignedAgents: [researcher, dataAnalyst],
        priority: 'high'
      });

      const developmentTaskId = await taskEngine.createTask({
        swarmId,
        type: 'development',
        objective: 'Implement ML pipeline',
        requirements: [
          'Implement chosen algorithm',
          'Create data preprocessing pipeline',
          'Add model training and evaluation',
          'Create prediction API',
          'Write comprehensive tests'
        ],
        dependencies: [researchTaskId],
        assignedAgents: [mlEngineer, coordinator],
        priority: 'high'
      });

      const deploymentTaskId = await taskEngine.createTask({
        swarmId,
        type: 'deployment',
        objective: 'Deploy ML pipeline to production',
        requirements: [
          'Containerize application',
          'Set up CI/CD pipeline',
          'Deploy to cloud',
          'Monitor performance'
        ],
        dependencies: [developmentTaskId],
        assignedAgents: [devopsEngineer, coordinator],
        priority: 'medium'
      });

      // Verify workflow setup
      const workflow = await taskEngine.getWorkflow(swarmId);
      expect(workflow.tasks).toHaveLength(3);
      expect(workflow.dependencies).toBeDefined();
    });

    it('should handle parallel task execution', async () => {
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'Parallel development of microservices',
        strategy: 'development',
        topology: 'distributed',
        maxAgents: 8
      });

      // Spawn specialized agents for different services
      const userServiceDev = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coder',
        name: 'User Service Developer',
        capabilities: ['nodejs', 'express', 'mongodb', 'authentication']
      });

      const productServiceDev = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coder',
        name: 'Product Service Developer',
        capabilities: ['nodejs', 'express', 'postgresql', 'crud-operations']
      });

      const orderServiceDev = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coder',
        name: 'Order Service Developer',
        capabilities: ['nodejs', 'express', 'redis', 'event-driven']
      });

      const apiGatewayDev = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coder',
        name: 'API Gateway Developer',
        capabilities: ['nginx', 'load-balancing', 'routing']
      });

      // Create parallel tasks
      const userServiceTask = await taskEngine.createTask({
        swarmId,
        type: 'development',
        objective: 'Build User Service',
        assignedAgents: [userServiceDev],
        priority: 'high'
      });

      const productServiceTask = await taskEngine.createTask({
        swarmId,
        type: 'development',
        objective: 'Build Product Service',
        assignedAgents: [productServiceDev],
        priority: 'high'
      });

      const orderServiceTask = await taskEngine.createTask({
        swarmId,
        type: 'development',
        objective: 'Build Order Service',
        assignedAgents: [orderServiceDev],
        priority: 'high'
      });

      const gatewayTask = await taskEngine.createTask({
        swarmId,
        type: 'development',
        objective: 'Build API Gateway',
        dependencies: [userServiceTask, productServiceTask, orderServiceTask],
        assignedAgents: [apiGatewayDev],
        priority: 'medium'
      });

      // Verify parallel execution capability
      const activeTasks = await taskEngine.getActiveTasks(swarmId);
      expect(activeTasks.length).toBeGreaterThan(0);
    });
  });

  describe('Swarm Communication and Memory', () => {
    it('should enable inter-agent communication', async () => {
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'Test agent communication',
        strategy: 'coordination',
        topology: 'mesh',
        maxAgents: 3
      });

      const agent1 = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coordinator',
        name: 'Agent 1'
      });

      const agent2 = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'researcher',
        name: 'Agent 2'
      });

      const agent3 = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coder',
        name: 'Agent 3'
      });

      // Test direct communication
      const message = {
        from: agent1,
        to: agent2,
        type: 'request',
        data: { task: 'Research requirement', priority: 'high' }
      };

      const response = await swarmCoordinator.sendMessage(swarmId, message);
      expect(response).toBeDefined();

      // Test broadcast communication
      const broadcastMessage = {
        from: agent1,
        to: 'all',
        type: 'announcement',
        data: { message: 'Project kickoff meeting in 5 minutes' }
      };

      const broadcastResponse = await swarmCoordinator.broadcastMessage(swarmId, broadcastMessage);
      expect(broadcastResponse).toBeDefined();
    });

    it('should maintain shared memory across agents', async () => {
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'Test shared memory',
        strategy: 'coordination',
        topology: 'centralized',
        maxAgents: 3
      });

      // Store shared information
      await memoryManager.set(`swarm:${swarmId}:shared:project-spec`, {
        name: 'E-commerce Platform',
        requirements: ['User authentication', 'Product catalog', 'Shopping cart'],
        technologies: ['Node.js', 'React', 'MongoDB']
      });

      await memoryManager.set(`swarm:${swarmId}:shared:decisions`, {
        architecture: 'microservices',
        database: 'MongoDB',
        frontend: 'React'
      });

      // Verify agents can access shared memory
      const projectSpec = await memoryManager.get(`swarm:${swarmId}:shared:project-spec`);
      const decisions = await memoryManager.get(`swarm:${swarmId}:shared:decisions`);

      expect(projectSpec).toBeDefined();
      expect(projectSpec.name).toBe('E-commerce Platform');
      expect(decisions).toBeDefined();
      expect(decisions.architecture).toBe('microservices');

      // Test memory patterns
      const sharedKeys = await memoryManager.keys(`swarm:${swarmId}:shared:*`);
      expect(sharedKeys).toContain(`swarm:${swarmId}:shared:project-spec`);
      expect(sharedKeys).toContain(`swarm:${swarmId}:shared:decisions`);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle agent failures gracefully', async () => {
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'Test error handling',
        strategy: 'development',
        topology: 'hierarchical',
        maxAgents: 4
      });

      const agent1 = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coordinator',
        name: 'Coordinator'
      });

      const agent2 = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coder',
        name: 'Developer'
      });

      // Simulate agent failure
      await agentManager.terminateAgent(agent2);

      // Verify swarm continues functioning
      const swarmStatus = await swarmCoordinator.getSwarmStatus(swarmId);
      expect(swarmStatus.status).toBe('active');

      // Verify automatic agent replacement
      const replacementAgent = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coder',
        name: 'Replacement Developer'
      });

      expect(replacementAgent).toBeDefined();
    });

    it('should handle task failures and retries', async () => {
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'Test task recovery',
        strategy: 'development',
        topology: 'mesh',
        maxAgents: 2
      });

      const agent = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coder',
        name: 'Test Developer'
      });

      // Create a task that might fail
      const taskId = await taskEngine.createTask({
        swarmId,
        type: 'development',
        objective: 'Flaky task for testing',
        assignedAgents: [agent],
        retries: 3,
        priority: 'high'
      });

      // Simulate task failure and recovery
      await taskEngine.failTask(taskId, 'Simulated failure');
      
      const taskStatus = await taskEngine.getTaskStatus(taskId);
      expect(taskStatus.retryCount).toBeGreaterThan(0);
      expect(taskStatus.status).toBe('retrying');
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large swarms efficiently', async () => {
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'Large scale coordination test',
        strategy: 'auto',
        topology: 'distributed',
        maxAgents: 20
      });

      const startTime = Date.now();

      // Spawn many agents in parallel
      const agentPromises = [];
      for (let i = 0; i < 15; i++) {
        agentPromises.push(
          swarmCoordinator.spawnAgentInSwarm(swarmId, {
            type: ['researcher', 'coder', 'analyst', 'tester', 'coordinator'][i % 5],
            name: `Agent ${i + 1}`,
            capabilities: ['general']
          })
        );
      }

      const agents = await Promise.all(agentPromises);
      const spawnTime = Date.now() - startTime;

      expect(agents).toHaveLength(15);
      expect(spawnTime).toBeLessThan(5000); // Should complete in under 5 seconds

      // Test coordination efficiency
      const coordinationStart = Date.now();
      
      const swarmStatus = await swarmCoordinator.getSwarmStatus(swarmId);
      const coordinationTime = Date.now() - coordinationStart;

      expect(swarmStatus.agents).toHaveLength(15);
      expect(coordinationTime).toBeLessThan(1000); // Should be fast
    });

    it('should handle concurrent task execution', async () => {
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'Concurrent task test',
        strategy: 'development',
        topology: 'mesh',
        maxAgents: 10
      });

      // Create multiple agents
      const agents = [];
      for (let i = 0; i < 8; i++) {
        const agent = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
          type: 'coder',
          name: `Developer ${i + 1}`
        });
        agents.push(agent);
      }

      // Create multiple concurrent tasks
      const taskPromises = [];
      for (let i = 0; i < 12; i++) {
        taskPromises.push(
          taskEngine.createTask({
            swarmId,
            type: 'development',
            objective: `Concurrent task ${i + 1}`,
            assignedAgents: [agents[i % agents.length]],
            priority: 'medium'
          })
        );
      }

      const tasks = await Promise.all(taskPromises);
      expect(tasks).toHaveLength(12);

      // Verify task distribution
      const activeTasks = await taskEngine.getActiveTasks(swarmId);
      expect(activeTasks.length).toBeGreaterThan(0);
    });
  });

  describe('Monitoring and Metrics', () => {
    it('should collect swarm metrics', async () => {
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'Metrics collection test',
        strategy: 'development',
        topology: 'hierarchical',
        maxAgents: 5
      });

      // Create some activity
      const agent = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coder',
        name: 'Test Developer'
      });

      const taskId = await taskEngine.createTask({
        swarmId,
        type: 'development',
        objective: 'Test task for metrics',
        assignedAgents: [agent],
        priority: 'high'
      });

      // Collect metrics
      const metrics = await swarmCoordinator.getSwarmMetrics(swarmId);
      
      expect(metrics).toBeDefined();
      expect(metrics.agentCount).toBeGreaterThan(0);
      expect(metrics.taskCount).toBeGreaterThan(0);
      expect(metrics.uptime).toBeGreaterThan(0);
      expect(metrics.messagesExchanged).toBeDefined();
    });

    it('should track performance metrics', async () => {
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'Performance tracking test',
        strategy: 'auto',
        topology: 'mesh',
        maxAgents: 3
      });

      const performanceStart = Date.now();

      // Create agents and tasks
      const agent1 = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'researcher',
        name: 'Researcher'
      });

      const agent2 = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coder',
        name: 'Developer'
      });

      const taskId = await taskEngine.createTask({
        swarmId,
        type: 'research',
        objective: 'Performance research task',
        assignedAgents: [agent1, agent2],
        priority: 'high'
      });

      const performanceEnd = Date.now();
      const operationTime = performanceEnd - performanceStart;

      // Verify performance tracking
      const performanceMetrics = await swarmCoordinator.getPerformanceMetrics(swarmId);
      
      expect(performanceMetrics).toBeDefined();
      expect(performanceMetrics.averageTaskTime).toBeDefined();
      expect(performanceMetrics.throughput).toBeDefined();
      expect(operationTime).toBeLessThan(3000); // Should be reasonably fast
    });
  });
});