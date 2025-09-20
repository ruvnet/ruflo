import { jest } from '@jest/globals';
import { SwarmManager } from '../../lib/swarm-manager.js';

describe('SwarmManager Unit Tests', () => {
  let swarmManager;

  beforeEach(async () => {
    swarmManager = new SwarmManager();
    await swarmManager.init();
  });

  afterEach(async () => {
    if (swarmManager && swarmManager.cleanup) {
      await swarmManager.cleanup();
    }
  });

  describe('Initialization', () => {
    test('should initialize successfully', () => {
      expect(swarmManager.initialized).toBe(true);
      expect(swarmManager.swarms).toBeDefined();
      expect(swarmManager.agents).toBeDefined();
      expect(swarmManager.tasks).toBeDefined();
    });

    test('should have default configuration', () => {
      expect(swarmManager.defaultConfig.maxAgents).toBe(8);
      expect(swarmManager.defaultConfig.defaultTopology).toBe('hierarchical');
      expect(swarmManager.defaultConfig.taskTimeout).toBe(300000);
    });

    test('should initialize helper components', () => {
      expect(swarmManager.loadBalancer).toBeDefined();
      expect(swarmManager.coordinator).toBeDefined();
      expect(swarmManager.metrics).toBeDefined();
    });
  });

  describe('Swarm Operations', () => {
    test('should initialize swarm with hierarchical topology', async () => {
      const result = await swarmManager.execute('swarm_init', {
        topology: 'hierarchical',
        maxAgents: 10,
        strategy: 'auto'
      });

      expect(result.status).toBe('success');
      expect(result.topology).toBe('hierarchical');
      expect(result.maxAgents).toBe(10);
      expect(result.swarmId).toMatch(/^swarm_/);
    });

    test('should initialize swarm with mesh topology', async () => {
      const result = await swarmManager.execute('swarm_init', {
        topology: 'mesh',
        maxAgents: 6,
        strategy: 'balanced'
      });

      expect(result.status).toBe('success');
      expect(result.topology).toBe('mesh');
      expect(result.maxAgents).toBe(6);
    });

    test('should get swarm status', async () => {
      // First create a swarm
      const initResult = await swarmManager.execute('swarm_init', {
        topology: 'hierarchical'
      });
      const swarmId = initResult.swarmId;

      // Get swarm status
      const status = await swarmManager.execute('swarm_status', { swarmId });

      expect(status.id).toBe(swarmId);
      expect(status.status).toBe('active');
      expect(status.topology).toBe('hierarchical');
      expect(status.agents.total).toBe(0); // No agents spawned yet
    });

    test('should destroy swarm successfully', async () => {
      // Create swarm
      const initResult = await swarmManager.execute('swarm_init', {
        topology: 'star'
      });
      const swarmId = initResult.swarmId;

      // Destroy swarm
      const result = await swarmManager.execute('swarm_destroy', { swarmId });

      expect(result.status).toBe('destroyed');
      expect(result.swarmId).toBe(swarmId);
      expect(swarmManager.swarms.has(swarmId)).toBe(false);
    });
  });

  describe('Agent Operations', () => {
    let swarmId;

    beforeEach(async () => {
      const initResult = await swarmManager.execute('swarm_init', {
        topology: 'hierarchical',
        maxAgents: 5
      });
      swarmId = initResult.swarmId;
    });

    test('should spawn agent with specific type', async () => {
      const result = await swarmManager.execute('agent_spawn', {
        type: 'coordinator',
        name: 'test-coordinator',
        swarmId,
        capabilities: ['orchestration', 'planning']
      });

      expect(result.status).toBe('spawned');
      expect(result.type).toBe('coordinator');
      expect(result.name).toBe('test-coordinator');
      expect(result.capabilities).toContain('orchestration');
      expect(result.swarmId).toBe(swarmId);
    });

    test('should spawn agent with default capabilities', async () => {
      const result = await swarmManager.execute('agent_spawn', {
        type: 'analyst',
        swarmId
      });

      expect(result.status).toBe('spawned');
      expect(result.type).toBe('analyst');
      expect(result.capabilities).toEqual(['data-analysis', 'pattern-recognition', 'reporting']);
    });

    test('should prevent spawning when swarm at capacity', async () => {
      // Spawn agents up to capacity
      for (let i = 0; i < 5; i++) {
        await swarmManager.execute('agent_spawn', {
          type: 'specialist',
          swarmId
        });
      }

      // Attempt to spawn one more (should fail)
      await expect(
        swarmManager.execute('agent_spawn', {
          type: 'optimizer',
          swarmId
        })
      ).rejects.toThrow('has reached maximum capacity');
    });

    test('should list agents in swarm', async () => {
      // Spawn a few agents
      await swarmManager.execute('agent_spawn', {
        type: 'coordinator',
        name: 'coord-1',
        swarmId
      });
      await swarmManager.execute('agent_spawn', {
        type: 'analyst',
        name: 'analyst-1',
        swarmId
      });

      const agents = await swarmManager.execute('agent_list', { swarmId });

      expect(agents).toHaveLength(2);
      expect(agents[0].type).toBe('coordinator');
      expect(agents[1].type).toBe('analyst');
    });

    test('should get agent metrics', async () => {
      const spawnResult = await swarmManager.execute('agent_spawn', {
        type: 'monitor',
        swarmId
      });
      const agentId = spawnResult.agentId;

      const metrics = await swarmManager.execute('agent_metrics', { agentId });

      expect(metrics.id).toBe(agentId);
      expect(metrics.type).toBe('monitor');
      expect(metrics.metrics).toBeDefined();
      expect(metrics.uptime).toBeGreaterThan(0);
    });
  });

  describe('Task Operations', () => {
    let swarmId;

    beforeEach(async () => {
      const initResult = await swarmManager.execute('swarm_init', {
        topology: 'mesh'
      });
      swarmId = initResult.swarmId;
      
      // Spawn an agent to handle tasks
      await swarmManager.execute('agent_spawn', {
        type: 'coordinator',
        swarmId
      });
    });

    test('should orchestrate task with adaptive strategy', async () => {
      const result = await swarmManager.execute('task_orchestrate', {
        task: 'Analyze system performance',
        strategy: 'adaptive',
        priority: 'high'
      });

      expect(result.status).toBe('orchestrated');
      expect(result.strategy).toBe('adaptive');
      expect(result.priority).toBe('high');
      expect(result.taskId).toMatch(/^task_/);
    });

    test('should orchestrate task with parallel strategy', async () => {
      const result = await swarmManager.execute('task_orchestrate', {
        task: 'Process data batch',
        strategy: 'parallel',
        priority: 'medium',
        dependencies: ['task_1', 'task_2']
      });

      expect(result.status).toBe('orchestrated');
      expect(result.strategy).toBe('parallel');
      expect(result.priority).toBe('medium');
    });

    test('should get task status', async () => {
      const orchestrateResult = await swarmManager.execute('task_orchestrate', {
        task: 'Generate report',
        strategy: 'sequential'
      });
      const taskId = orchestrateResult.taskId;

      const status = await swarmManager.execute('task_status', { taskId });

      expect(status.id).toBe(taskId);
      expect(status.status).toMatch(/^(pending|assigned)$/);
    });

    test('should get task results', async () => {
      const orchestrateResult = await swarmManager.execute('task_orchestrate', {
        task: 'Calculate metrics'
      });
      const taskId = orchestrateResult.taskId;

      const results = await swarmManager.execute('task_results', { taskId });

      expect(results.id).toBe(taskId);
      expect(results.status).toBeDefined();
    });

    test('should execute tasks in parallel', async () => {
      const tasks = [
        { task: 'Task 1', strategy: 'parallel', priority: 'medium' },
        { task: 'Task 2', strategy: 'parallel', priority: 'high' },
        { task: 'Task 3', strategy: 'parallel', priority: 'low' }
      ];

      const result = await swarmManager.execute('parallel_execute', { tasks });

      expect(result.total).toBe(3);
      expect(result.successful).toBeGreaterThan(0);
      expect(result.results).toHaveLength(3);
    });
  });

  describe('Advanced Operations', () => {
    let swarmId;

    beforeEach(async () => {
      const initResult = await swarmManager.execute('swarm_init', {
        topology: 'hierarchical',
        maxAgents: 10
      });
      swarmId = initResult.swarmId;
    });

    test('should optimize topology', async () => {
      const result = await swarmManager.execute('topology_optimize', { swarmId });

      expect(result.status).toBe('optimized');
      expect(result.swarmId).toBe(swarmId);
    });

    test('should sync coordination', async () => {
      const result = await swarmManager.execute('coordination_sync', { swarmId });

      expect(result.status).toBe('synchronized');
      expect(result.swarmId).toBe(swarmId);
    });

    test('should scale swarm up', async () => {
      // Initially spawn 2 agents
      await swarmManager.execute('agent_spawn', {
        type: 'coordinator',
        swarmId
      });
      await swarmManager.execute('agent_spawn', {
        type: 'analyst',
        swarmId
      });

      // Scale up to 5 agents
      const result = await swarmManager.execute('swarm_scale', {
        swarmId,
        targetSize: 5
      });

      expect(result.status).toBe('scaled');
      expect(result.action).toBe('up');
      expect(result.from).toBe(2);
      expect(result.to).toBe(5);
      expect(result.newAgents).toHaveLength(3);
    });

    test('should scale swarm down', async () => {
      // Spawn 4 agents
      for (let i = 0; i < 4; i++) {
        await swarmManager.execute('agent_spawn', {
          type: 'specialist',
          swarmId
        });
      }

      // Scale down to 2 agents
      const result = await swarmManager.execute('swarm_scale', {
        swarmId,
        targetSize: 2
      });

      expect(result.status).toBe('scaled');
      expect(result.action).toBe('down');
      expect(result.from).toBe(4);
      expect(result.to).toBe(2);
      expect(result.removedAgents).toHaveLength(2);
    });

    test('should monitor swarm', async () => {
      const result = await swarmManager.execute('swarm_monitor', {
        swarmId,
        interval: 1000,
        metrics: ['agents', 'tasks']
      });

      expect(result.id).toBe(swarmId);
      expect(result.status).toBe('active');
      expect(result.agents).toBeDefined();
      expect(result.tasks).toBeDefined();
    });

    test('should balance load', async () => {
      const tasks = [
        { id: 'task1', priority: 'high' },
        { id: 'task2', priority: 'medium' }
      ];

      const result = await swarmManager.execute('load_balance', {
        swarmId,
        tasks
      });

      expect(result.status).toBe('balanced');
    });
  });

  describe('Error Handling', () => {
    test('should throw error for unknown tool', async () => {
      await expect(
        swarmManager.execute('unknown_tool', {})
      ).rejects.toThrow('Unknown swarm tool: unknown_tool');
    });

    test('should throw error for non-existent swarm', async () => {
      await expect(
        swarmManager.execute('swarm_status', { swarmId: 'non-existent' })
      ).rejects.toThrow('Swarm non-existent not found');
    });

    test('should throw error for invalid topology', async () => {
      await expect(
        swarmManager.execute('swarm_init', { topology: 'invalid' })
      ).rejects.toThrow();
    });
  });

  describe('Health and Capabilities', () => {
    test('should report healthy status', async () => {
      const health = await swarmManager.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.swarms).toBe(swarmManager.swarms.size);
      expect(health.agents).toBe(swarmManager.agents.size);
      expect(health.tasks).toBe(swarmManager.tasks.size);
    });

    test('should report capabilities', () => {
      const capabilities = swarmManager.getCapabilities();

      expect(capabilities).toContain('swarm-orchestration');
      expect(capabilities).toContain('agent-management');
      expect(capabilities).toContain('task-coordination');
      expect(capabilities).toContain('load-balancing');
      expect(capabilities).toContain('topology-optimization');
    });

    test('should report healthy when initialized', () => {
      expect(swarmManager.isHealthy()).toBe(true);
    });
  });
});
