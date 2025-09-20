/**
 * Orchestration Integration Test Suite
 * Comprehensive tests for the real swarm orchestration system
 * Tests integration with RealMemoryManager and all components
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { RealSwarmOrchestrator, SwarmTopology, AgentState } from '../src/orchestration/real-swarm-orchestrator.js';
import { TopologyManager } from '../src/orchestration/topology-manager.js';
import { LoadBalancer, LoadBalancingStrategy } from '../src/orchestration/load-balancer.js';
import { FailureRecoveryManager, FailureType } from '../src/orchestration/failure-recovery.js';
import { OrchestrationFactory, OrchestrationUtils } from '../src/orchestration/index.js';
import { RealMemoryManager } from '../src/memory/real-memory-manager.js';

// Mock dependencies
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe('Real Swarm Orchestration System', () => {
  let memoryManager;
  let orchestrationSystem;
  
  beforeEach(async () => {
    // Create memory manager for tests
    memoryManager = new RealMemoryManager({
      persistenceDir: './test-data/memory',
      sessionId: `test_${Date.now()}`,
      logger: mockLogger
    });
    
    await memoryManager.initialize();
    
    // Create orchestration system
    orchestrationSystem = await OrchestrationFactory.createSwarmSystem({
      swarmId: `test_swarm_${Date.now()}`,
      topology: SwarmTopology.HIERARCHICAL,
      maxAgents: 5,
      logger: mockLogger,
      memoryManager
    });
    
    await orchestrationSystem.initialize();
  });
  
  afterEach(async () => {
    if (orchestrationSystem) {
      await orchestrationSystem.shutdown();
    }
    
    // Clean up memory
    await memoryManager.clearNamespace('swarm');
    
    // Reset mocks
    jest.clearAllMocks();
  });
  
  describe('RealSwarmOrchestrator', () => {
    test('should initialize with correct configuration', async () => {
      const orchestrator = orchestrationSystem.orchestrator;
      
      expect(orchestrator.swarmId).toBeDefined();
      expect(orchestrator.topology).toBe(SwarmTopology.HIERARCHICAL);
      expect(orchestrator.maxAgents).toBe(5);
      expect(orchestrator.isRunning).toBe(true);
    });
    
    test('should spawn agents successfully', async () => {
      const orchestrator = orchestrationSystem.orchestrator;
      
      const agent = await orchestrator.spawnAgent({
        name: 'TestAgent',
        type: 'general',
        capabilities: ['testing', 'general'],
        priority: 'medium'
      });
      
      expect(agent).toBeDefined();
      expect(agent.name).toBe('TestAgent');
      expect(agent.type).toBe('general');
      expect(agent.capabilities).toContain('testing');
      
      // Check if agent is registered in memory
      const agentMemory = await memoryManager.retrieve(`agent/${agent.id}/spawn`, 'swarm');
      expect(agentMemory).toBeDefined();
      expect(agentMemory.value.name).toBe('TestAgent');
    });
    
    test('should distribute tasks to agents', async () => {
      const orchestrator = orchestrationSystem.orchestrator;
      
      // Spawn test agent
      const agent = await orchestrator.spawnAgent({
        name: 'TaskAgent',
        type: 'worker',
        capabilities: ['task-execution']
      });
      
      // Create test task
      const task = {
        id: `task_${Date.now()}`,
        type: 'test_task',
        description: 'Test task for orchestration',
        requiredCapabilities: ['task-execution'],
        timeout: 10000,
        parameters: {
          operation: 'test',
          data: { test: true }
        }
      };
      
      // Distribute task
      const assignment = await orchestrator.distributeTask(task);
      
      expect(assignment).toBeDefined();
      expect(assignment.agents).toContain(agent.id);
      expect(assignment.strategy).toBeDefined();
      
      // Check task storage in memory
      const taskMemory = await memoryManager.retrieve(`task/${task.id}/distribution`, 'swarm');
      expect(taskMemory).toBeDefined();
      expect(taskMemory.value.assignment).toBeDefined();
    });
    
    test('should handle agent disconnection gracefully', async () => {
      const orchestrator = orchestrationSystem.orchestrator;
      
      // Spawn and register agent
      const agent = await orchestrator.spawnAgent({
        name: 'DisconnectAgent',
        type: 'worker'
      });
      
      // Simulate disconnection
      await orchestrator.handleAgentDisconnection(agent.id);
      
      // Verify agent is no longer in active agents
      const status = orchestrator.getSwarmStatus();
      expect(status.agents.total).toBe(0);
    });
    
    test('should maintain swarm status correctly', async () => {
      const orchestrator = orchestrationSystem.orchestrator;
      
      // Initial status
      let status = orchestrator.getSwarmStatus();
      expect(status.swarmId).toBeDefined();
      expect(status.isRunning).toBe(true);
      expect(status.agents.total).toBe(0);
      
      // Spawn agents
      await orchestrator.spawnAgent({ name: 'Agent1', type: 'worker' });
      await orchestrator.spawnAgent({ name: 'Agent2', type: 'coordinator' });
      
      status = orchestrator.getSwarmStatus();
      expect(status.agents.total).toBe(2);
      expect(status.agents.byType.worker).toBe(1);
      expect(status.agents.byType.coordinator).toBe(1);
    });
  });
  
  describe('TopologyManager', () => {
    test('should manage agent topology correctly', async () => {
      const topologyManager = orchestrationSystem.topologyManager;
      
      // Add agents to topology
      await topologyManager.addAgent('agent1', ['general']);
      await topologyManager.addAgent('agent2', ['coordination']);
      await topologyManager.addAgent('agent3', ['specialized']);
      
      const status = topologyManager.getTopologyStatus();
      expect(status.agentCount).toBe(3);
      expect(status.currentTopology).toBe(SwarmTopology.HIERARCHICAL);
      
      // Get topology graph
      const graph = topologyManager.getTopologyGraph();
      expect(graph.nodes).toHaveLength(3);
      expect(graph.edges.length).toBeGreaterThan(0);
    });
    
    test('should change topology dynamically', async () => {
      const topologyManager = orchestrationSystem.topologyManager;
      
      // Add agents
      await topologyManager.addAgent('agent1');
      await topologyManager.addAgent('agent2');
      
      // Change topology
      await topologyManager.changeTopology(SwarmTopology.MESH, {
        reason: 'test'
      });
      
      const status = topologyManager.getTopologyStatus();
      expect(status.currentTopology).toBe(SwarmTopology.MESH);
      
      // Verify topology change is stored in memory
      const changes = await memoryManager.query({
        namespace: 'swarm',
        category: 'coordination',
        tags: ['topology', 'change']
      });
      
      expect(changes.results.length).toBeGreaterThan(0);
      expect(changes.results[0].value.toTopology).toBe(SwarmTopology.MESH);
    });
    
    test('should analyze topology performance', async () => {
      const topologyManager = orchestrationSystem.topologyManager;
      
      // Add agents
      await topologyManager.addAgent('agent1');
      await topologyManager.addAgent('agent2');
      await topologyManager.addAgent('agent3');
      
      const analysis = await topologyManager.analyzeTopologyPerformance();
      
      expect(analysis.topology).toBe(SwarmTopology.HIERARCHICAL);
      expect(analysis.agentCount).toBe(3);
      expect(analysis.density).toBeGreaterThanOrEqual(0);
      expect(analysis.recommendations).toBeDefined();
    });
  });
  
  describe('LoadBalancer', () => {
    test('should register and manage agents', async () => {
      const loadBalancer = orchestrationSystem.loadBalancer;
      
      // Register agents
      await loadBalancer.registerAgent('agent1', ['general'], {
        cpu: 2.0,
        memory: 2048,
        maxTasks: 5
      });
      
      await loadBalancer.registerAgent('agent2', ['specialized'], {
        cpu: 1.0,
        memory: 1024,
        maxTasks: 3
      });
      
      const stats = loadBalancer.getLoadBalancingStats();
      expect(stats.agentCount).toBe(2);
      expect(stats.totalCapacity).toBe(8); // 5 + 3 tasks
    });
    
    test('should select agents using different strategies', async () => {
      const loadBalancer = orchestrationSystem.loadBalancer;
      
      // Register agents
      await loadBalancer.registerAgent('agent1', ['task1'], { maxTasks: 5 });
      await loadBalancer.registerAgent('agent2', ['task1'], { maxTasks: 3 });
      
      const task = {
        id: 'test_task',
        type: 'task1',
        requiredCapabilities: ['task1'],
        requiredResources: {}
      };
      
      // Test agent selection
      const selectedAgent = await loadBalancer.selectAgent(task);
      expect(selectedAgent).toBeDefined();
      expect(selectedAgent.capabilities).toContain('task1');
    });
    
    test('should handle task allocation and deallocation', async () => {
      const loadBalancer = orchestrationSystem.loadBalancer;
      
      await loadBalancer.registerAgent('agent1', ['test'], { maxTasks: 3 });
      
      const task = {
        id: 'allocation_test',
        type: 'test',
        requiredCapabilities: ['test'],
        requiredResources: { concurrent_tasks: 1 }
      };
      
      // Allocate task
      await loadBalancer.allocateTask('agent1', task);
      
      let stats = loadBalancer.getLoadBalancingStats();
      expect(stats.totalTasks).toBe(1);
      
      // Deallocate task
      await loadBalancer.deallocateTask('agent1', task.id, { success: true });
      
      stats = loadBalancer.getLoadBalancingStats();
      expect(stats.totalTasks).toBe(0);
    });
  });
  
  describe('FailureRecoveryManager', () => {
    test('should detect and report failures', async () => {
      const failureRecovery = orchestrationSystem.failureRecovery;
      
      const failureId = await failureRecovery.reportFailure({
        type: FailureType.AGENT_CRASH,
        entityId: 'agent1',
        entityType: 'agent',
        description: 'Agent crashed during task execution',
        severity: 'high'
      });
      
      expect(failureId).toBeDefined();
      
      const stats = failureRecovery.getFailureStats();
      expect(stats.total).toBe(1);
      expect(stats.active).toBe(1);
      
      // Check failure storage in memory
      const failureMemory = await memoryManager.retrieve(`failure/${failureId}`, 'swarm');
      expect(failureMemory).toBeDefined();
      expect(failureMemory.value.type).toBe(FailureType.AGENT_CRASH);
    });
    
    test('should initiate recovery for failures', async () => {
      const failureRecovery = orchestrationSystem.failureRecovery;
      
      // Mock the recovery dependencies
      failureRecovery.swarmOrchestrator = {
        terminateAgent: jest.fn().mockResolvedValue(true),
        spawnAgent: jest.fn().mockResolvedValue({ id: 'new_agent' })
      };
      
      const failureId = await failureRecovery.reportFailure({
        type: FailureType.AGENT_CRASH,
        entityId: 'failed_agent',
        entityType: 'agent',
        description: 'Test failure for recovery',
        severity: 'medium'
      });
      
      // Recovery should be initiated automatically
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const failure = failureRecovery.activeFailures.get(failureId);
      expect(failure.status).toBe('recovering');
    });
    
    test('should analyze failure patterns', async () => {
      const failureRecovery = orchestrationSystem.failureRecovery;
      
      // Report multiple similar failures
      for (let i = 0; i < 3; i++) {
        await failureRecovery.reportFailure({
          type: FailureType.AGENT_OVERLOAD,
          entityId: `agent${i}`,
          entityType: 'agent',
          description: 'Agent overloaded',
          severity: 'medium'
        });
      }
      
      // Check pattern detection
      const patterns = await memoryManager.query({
        namespace: 'swarm',
        category: 'monitoring',
        tags: ['pattern', 'failure-analysis']
      });
      
      expect(patterns.results.length).toBeGreaterThan(0);
    });
  });
  
  describe('Memory Integration', () => {
    test('should store orchestration events in memory', async () => {
      const orchestrator = orchestrationSystem.orchestrator;
      
      // Perform orchestration operations
      const agent = await orchestrator.spawnAgent({
        name: 'MemoryTestAgent',
        type: 'general'
      });
      
      // Check stored events
      const spawnEvents = await memoryManager.query({
        namespace: 'swarm',
        category: 'coordination',
        tags: ['agent', 'spawn']
      });
      
      expect(spawnEvents.results.length).toBeGreaterThan(0);
      expect(spawnEvents.results[0].value.name).toBe('MemoryTestAgent');
    });
    
    test('should retrieve and use historical data', async () => {
      // Store some historical performance data
      await memoryManager.store({
        key: 'historical/performance',
        value: {
          agentId: 'agent1',
          successRate: 0.95,
          averageTime: 1000
        },
        namespace: 'swarm',
        category: 'performance',
        tags: ['historical', 'performance']
      });
      
      // Query historical data
      const history = await memoryManager.query({
        namespace: 'swarm',
        category: 'performance',
        tags: ['historical']
      });
      
      expect(history.results.length).toBe(1);
      expect(history.results[0].value.successRate).toBe(0.95);
    });
    
    test('should handle memory cleanup and optimization', async () => {
      // Store multiple entries
      for (let i = 0; i < 10; i++) {
        await memoryManager.store({
          key: `cleanup/test${i}`,
          value: { data: `test${i}` },
          namespace: 'swarm',
          ttl: 1000 // 1 second TTL
        });
      }
      
      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Perform maintenance
      await memoryManager.performMaintenance();
      
      // Check that expired entries are cleaned up
      const remaining = await memoryManager.query({
        namespace: 'swarm',
        search: 'cleanup'
      });
      
      expect(remaining.results.length).toBe(0);
    });
  });
  
  describe('Integration and End-to-End Tests', () => {
    test('should handle complete task lifecycle', async () => {
      const { orchestrator, loadBalancer, failureRecovery } = orchestrationSystem;
      
      // Spawn multiple agents
      const agents = [];
      for (let i = 0; i < 3; i++) {
        const agent = await orchestrator.spawnAgent({
          name: `E2EAgent${i}`,
          type: 'worker',
          capabilities: ['e2e-test']
        });
        agents.push(agent);
        
        // Register with load balancer
        await loadBalancer.registerAgent(agent.id, ['e2e-test'], {
          maxTasks: 2
        });
      }
      
      // Create and distribute tasks
      const tasks = [];
      for (let i = 0; i < 5; i++) {
        const task = {
          id: `e2e_task_${i}`,
          type: 'e2e_test',
          description: `End-to-end test task ${i}`,
          requiredCapabilities: ['e2e-test'],
          timeout: 5000
        };
        
        const assignment = await orchestrator.distributeTask(task);
        expect(assignment).toBeDefined();
        tasks.push(task);
      }
      
      // Check swarm status
      const status = orchestrator.getSwarmStatus();
      expect(status.agents.total).toBe(3);
      expect(status.tasks.total).toBe(5);
      
      // Simulate task completion
      for (const task of tasks) {
        await orchestrator.handleTaskResult(
          tasks[0].assignment?.agents[0] || agents[0].id,
          {
            data: {
              taskId: task.id,
              result: { success: true, data: 'completed' },
              metrics: { executionTime: 1000 }
            }
          }
        );
      }
      
      // Verify final status
      const finalStats = loadBalancer.getLoadBalancingStats();
      expect(finalStats.totalTasks).toBe(0); // All tasks deallocated
    });
    
    test('should handle cascade failure recovery', async () => {
      const { orchestrator, failureRecovery } = orchestrationSystem;
      
      // Spawn agents
      const agents = [];
      for (let i = 0; i < 3; i++) {
        const agent = await orchestrator.spawnAgent({
          name: `CascadeAgent${i}`,
          type: 'worker'
        });
        agents.push(agent);
      }
      
      // Report multiple failures quickly to trigger cascade detection
      const failurePromises = agents.map((agent, index) => 
        failureRecovery.reportFailure({
          type: FailureType.AGENT_CRASH,
          entityId: agent.id,
          entityType: 'agent',
          description: `Cascade failure ${index}`,
          severity: 'high'
        })
      );
      
      await Promise.all(failurePromises);
      
      // Check for cascade failure detection
      const cascadeFailures = await memoryManager.query({
        namespace: 'swarm',
        category: 'monitoring',
        tags: ['failure'],
        search: 'cascade'
      });
      
      // Should detect cascade and create cascade failure
      expect(cascadeFailures.results.length).toBeGreaterThan(0);
    });
    
    test('should maintain system resilience under load', async () => {
      const { orchestrator, loadBalancer, failureRecovery } = orchestrationSystem;
      
      // Create a high-load scenario
      const agents = [];
      for (let i = 0; i < 5; i++) {
        const agent = await orchestrator.spawnAgent({
          name: `LoadAgent${i}`,
          type: 'worker',
          capabilities: ['load-test']
        });
        agents.push(agent);
        
        await loadBalancer.registerAgent(agent.id, ['load-test'], {
          maxTasks: 3
        });
      }
      
      // Create many tasks
      const taskPromises = [];
      for (let i = 0; i < 20; i++) {
        const task = {
          id: `load_task_${i}`,
          type: 'load_test',
          requiredCapabilities: ['load-test']
        };
        
        taskPromises.push(orchestrator.distributeTask(task));
      }
      
      // Wait for all tasks to be distributed
      const assignments = await Promise.allSettled(taskPromises);
      const successful = assignments.filter(a => a.status === 'fulfilled');
      
      // Should handle the load gracefully
      expect(successful.length).toBeGreaterThan(10);
      
      // Check system health
      const stats = failureRecovery.getFailureStats();
      expect(stats.resolutionRate).toBeGreaterThan(0.5);
    });
  });
  
  describe('Performance and Optimization', () => {
    test('should optimize topology based on workload', async () => {
      const { topologyManager } = orchestrationSystem;
      
      // Add agents
      for (let i = 0; i < 6; i++) {
        await topologyManager.addAgent(`perf_agent_${i}`, ['performance']);
      }
      
      // Analyze performance
      const analysis = await topologyManager.analyzeTopologyPerformance();
      
      expect(analysis.density).toBeDefined();
      expect(analysis.pathLength).toBeDefined();
      expect(analysis.recommendations).toBeDefined();
      
      // Should provide recommendations for optimization
      expect(analysis.recommendations.length).toBeGreaterThanOrEqual(0);
    });
    
    test('should balance load effectively', async () => {
      const { loadBalancer } = orchestrationSystem;
      
      // Register agents with different capacities
      await loadBalancer.registerAgent('fast_agent', ['compute'], {
        cpu: 4.0,
        memory: 4096,
        maxTasks: 10
      });
      
      await loadBalancer.registerAgent('slow_agent', ['compute'], {
        cpu: 1.0,
        memory: 1024,
        maxTasks: 3
      });
      
      // Create tasks and verify distribution
      const tasks = [];
      for (let i = 0; i < 8; i++) {
        const task = {
          id: `balance_task_${i}`,
          requiredCapabilities: ['compute']
        };
        
        const agent = await loadBalancer.selectAgent(task);
        if (agent) {
          await loadBalancer.allocateTask(agent.id, task);
          tasks.push({ task, agentId: agent.id });
        }
      }
      
      // Check load distribution
      const stats = loadBalancer.getLoadBalancingStats();
      const fastAgent = stats.agents.find(a => a.id === 'fast_agent');
      const slowAgent = stats.agents.find(a => a.id === 'slow_agent');
      
      // Fast agent should get more tasks
      expect(fastAgent.taskCount).toBeGreaterThan(slowAgent.taskCount);
    });
    
    test('should handle memory pressure gracefully', async () => {
      // Create a scenario with high memory usage
      const largeData = new Array(1000).fill(0).map((_, i) => ({
        id: i,
        data: new Array(100).fill(`data_${i}`).join('')
      }));
      
      // Store large dataset
      await memoryManager.store({
        key: 'large-dataset',
        value: largeData,
        namespace: 'swarm',
        category: 'performance',
        tags: ['large-data', 'memory-test']
      });
      
      // Trigger memory maintenance
      await memoryManager.performMaintenance();
      
      // Check memory stats
      const stats = memoryManager.getStats();
      expect(stats.storage.totalSize).toBeGreaterThan(0);
      expect(stats.performance.cacheHitRate).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('OrchestrationUtils', () => {
  test('should validate configuration correctly', () => {
    const validConfig = {
      swarmId: 'test_swarm',
      maxAgents: 10,
      topology: SwarmTopology.MESH
    };
    
    const validation = OrchestrationUtils.validateConfig(validConfig);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
    
    const invalidConfig = {
      maxAgents: 150, // Too high
      topology: 'invalid_topology'
    };
    
    const invalidValidation = OrchestrationUtils.validateConfig(invalidConfig);
    expect(invalidValidation.valid).toBe(false);
    expect(invalidValidation.errors.length).toBeGreaterThan(0);
  });
  
  test('should calculate optimal configuration', () => {
    const workload = {
      expectedTasks: 15,
      taskComplexity: 'high',
      concurrencyRequirements: 'high',
      reliabilityRequirements: 'high'
    };
    
    const config = OrchestrationUtils.calculateOptimalConfig(workload);
    
    expect(config.maxAgents).toBeGreaterThan(5);
    expect(config.topology).toBe(SwarmTopology.HYBRID);
    expect(config.enableFailover).toBe(true);
  });
  
  test('should generate comprehensive metrics report', () => {
    const mockComponents = {
      orchestrator: {
        getSwarmStatus: () => ({
          agents: { total: 5, byState: { idle: 3, busy: 2 } },
          tasks: { total: 10, byStatus: { completed: 8, failed: 2 } }
        })
      },
      loadBalancer: {
        getLoadBalancingStats: () => ({
          utilization: 0.6,
          agentCount: 5
        })
      },
      failureRecovery: {
        getFailureStats: () => ({
          total: 3,
          active: 1,
          resolved: 2
        })
      },
      topologyManager: {
        getTopologyStatus: () => ({
          currentTopology: SwarmTopology.HIERARCHICAL,
          agentCount: 5
        })
      }
    };
    
    const report = OrchestrationUtils.generateMetricsReport(mockComponents);
    
    expect(report.timestamp).toBeDefined();
    expect(report.summary.totalAgents).toBe(5);
    expect(report.summary.systemHealth).toBeGreaterThan(0);
    expect(report.summary.performance).toBeGreaterThan(0);
  });
});