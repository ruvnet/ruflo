import { jest } from '@jest/globals';
import { DAAManager } from '../../lib/daa-manager.js';

describe('DAAManager Unit Tests', () => {
  let daaManager;

  beforeEach(async () => {
    daaManager = new DAAManager();
    await daaManager.init();
  });

  afterEach(async () => {
    if (daaManager && daaManager.cleanup) {
      await daaManager.cleanup();
    }
  });

  describe('Initialization', () => {
    test('should initialize successfully', () => {
      expect(daaManager.initialized).toBe(true);
      expect(daaManager.agents).toBeDefined();
      expect(daaManager.resources).toBeDefined();
      expect(daaManager.lifecycle).toBeDefined();
    });

    test('should have default configuration', () => {
      expect(daaManager.config.maxAgents).toBe(50);
      expect(daaManager.config.resourceThreshold).toBe(0.8);
      expect(daaManager.config.consensusTimeout).toBe(5000);
    });

    test('should initialize helper components', () => {
      expect(daaManager.resources).toBeDefined();
      expect(daaManager.lifecycle).toBeDefined();
      expect(daaManager.communication).toBeDefined();
      expect(daaManager.consensus).toBeDefined();
      expect(daaManager.faultTolerance).toBeDefined();
      expect(daaManager.optimizer).toBeDefined();
    });
  });

  describe('Agent Creation', () => {
    test('should create dynamic agent with coordinator type', async () => {
      const result = await daaManager.execute('daa_agent_create', {
        agent_type: 'coordinator',
        capabilities: ['orchestration', 'planning'],
        resources: { cpu: 0.5, memory: '256MB' }
      });

      expect(result.status).toBe('created');
      expect(result.type).toBe('coordinator');
      expect(result.capabilities).toContain('orchestration');
      expect(result.agentId).toMatch(/^daa_agent_coordinator_/);
    });

    test('should create agent with default capabilities when none provided', async () => {
      const result = await daaManager.execute('daa_agent_create', {
        agent_type: 'analyst'
      });

      expect(result.status).toBe('created');
      expect(result.type).toBe('analyst');
      expect(result.capabilities).toEqual(['data-analysis', 'pattern-recognition', 'reporting', 'visualization']);
    });

    test('should create agent with custom resources', async () => {
      const result = await daaManager.execute('daa_agent_create', {
        agent_type: 'optimizer',
        resources: { cpu: 1.0, memory: '512MB', storage: '2GB' }
      });

      expect(result.status).toBe('created');
      expect(result.resourceAllocation).toBeDefined();
      expect(result.resourceAllocation.cpu).toBe(1.0);
    });

    test('should track agent creation in internal state', async () => {
      const initialSize = daaManager.agents.size;
      
      await daaManager.execute('daa_agent_create', {
        agent_type: 'specialist'
      });

      expect(daaManager.agents.size).toBe(initialSize + 1);
    });
  });

  describe('Capability Matching', () => {
    beforeEach(async () => {
      // Create test agents
      await daaManager.execute('daa_agent_create', {
        agent_type: 'coordinator',
        capabilities: ['orchestration', 'planning', 'delegation']
      });
      await daaManager.execute('daa_agent_create', {
        agent_type: 'analyst',
        capabilities: ['data-analysis', 'reporting']
      });
    });

    test('should match capabilities with exact requirements', async () => {
      const result = await daaManager.execute('daa_capability_match', {
        task_requirements: [
          { capabilities: ['orchestration', 'planning'] },
          { capabilities: ['data-analysis'] }
        ]
      });

      expect(result.status).toBe('completed');
      expect(result.totalRequirements).toBe(2);
      expect(result.matchesFound).toBeGreaterThan(0);
      expect(result.matches).toHaveLength(2);
    });

    test('should handle partial capability matches', async () => {
      const result = await daaManager.execute('daa_capability_match', {
        task_requirements: [
          { capabilities: ['orchestration', 'unknown-capability'] }
        ]
      });

      expect(result.status).toBe('completed');
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]).toHaveProperty('matchFound');
    });

    test('should provide recommendations for unmatched requirements', async () => {
      const result = await daaManager.execute('daa_capability_match', {
        task_requirements: [
          { capabilities: ['non-existent-capability'] }
        ]
      });

      expect(result.status).toBe('completed');
      expect(result.recommendations).toBeDefined();
    });

    test('should return match rate statistics', async () => {
      const result = await daaManager.execute('daa_capability_match', {
        task_requirements: [
          { capabilities: ['orchestration'] },
          { capabilities: ['data-analysis'] },
          { capabilities: ['non-existent'] }
        ]
      });

      expect(result.matchRate).toBeGreaterThanOrEqual(0);
      expect(result.matchRate).toBeLessThanOrEqual(1);
      expect(result.totalRequirements).toBe(3);
    });
  });

  describe('Resource Allocation', () => {
    let agentIds;

    beforeEach(async () => {
      const agent1 = await daaManager.execute('daa_agent_create', { agent_type: 'coordinator' });
      const agent2 = await daaManager.execute('daa_agent_create', { agent_type: 'analyst' });
      agentIds = [agent1.agentId, agent2.agentId];
    });

    test('should allocate resources to multiple agents', async () => {
      const result = await daaManager.execute('daa_resource_alloc', {
        agents: agentIds,
        resources: { cpu: 1.0, memory: '512MB', storage: '1GB' }
      });

      expect(result.status).toBe('completed');
      expect(result.totalAgents).toBe(2);
      expect(result.successfulAllocations).toBeGreaterThan(0);
      expect(result.allocations).toHaveLength(2);
    });

    test('should handle resource allocation with strategy', async () => {
      const result = await daaManager.execute('daa_resource_alloc', {
        agents: agentIds,
        resources: { cpu: 0.8, memory: '384MB' }
      });

      expect(result.strategy).toBe('balanced');
      expect(result.resourceUtilization).toBeDefined();
      expect(result.resourceUtilization.before).toBeDefined();
      expect(result.resourceUtilization.after).toBeDefined();
    });

    test('should calculate success rate for allocations', async () => {
      const result = await daaManager.execute('daa_resource_alloc', {
        agents: agentIds,
        resources: { cpu: 0.5, memory: '256MB' }
      });

      expect(result.successRate).toBeGreaterThanOrEqual(0);
      expect(result.successRate).toBeLessThanOrEqual(1);
      expect(result.successfulAllocations).toBeLessThanOrEqual(result.totalAgents);
    });

    test('should handle non-existent agent gracefully', async () => {
      const result = await daaManager.execute('daa_resource_alloc', {
        agents: [...agentIds, 'non-existent-agent'],
        resources: { cpu: 0.5, memory: '256MB' }
      });

      expect(result.status).toBe('completed');
      expect(result.allocations.some(a => a.status === 'failed')).toBe(true);
    });
  });

  describe('Lifecycle Management', () => {
    let agentId;

    beforeEach(async () => {
      const agent = await daaManager.execute('daa_agent_create', { agent_type: 'coordinator' });
      agentId = agent.agentId;
    });

    test('should pause agent successfully', async () => {
      const result = await daaManager.execute('daa_lifecycle_manage', {
        agentId,
        action: 'pause'
      });

      expect(result.status).toBe('paused');
      expect(result.agentId).toBe(agentId);
      expect(result.action).toBe('pause');

      const agent = daaManager.agents.get(agentId);
      expect(agent.status).toBe('paused');
    });

    test('should resume paused agent', async () => {
      // First pause the agent
      await daaManager.execute('daa_lifecycle_manage', { agentId, action: 'pause' });
      
      // Then resume it
      const result = await daaManager.execute('daa_lifecycle_manage', {
        agentId,
        action: 'resume'
      });

      expect(result.status).toBe('resumed');
      const agent = daaManager.agents.get(agentId);
      expect(agent.status).toBe('active');
    });

    test('should migrate agent', async () => {
      const result = await daaManager.execute('daa_lifecycle_manage', {
        agentId,
        action: 'migrate'
      });

      expect(result.status).toBe('migrated');
      const agent = daaManager.agents.get(agentId);
      expect(agent.lifecycle.transitions).toContainEqual(
        expect.objectContaining({ type: 'migration' })
      );
    });

    test('should scale agent resources', async () => {
      const result = await daaManager.execute('daa_lifecycle_manage', {
        agentId,
        action: 'scale'
      });

      expect(result.status).toBe('scaled');
    });

    test('should get agent status', async () => {
      const result = await daaManager.execute('daa_lifecycle_manage', {
        agentId,
        action: 'status'
      });

      expect(result.status).toBe('active');
      expect(result.agentId).toBe(agentId);
    });

    test('should terminate agent and remove from system', async () => {
      const result = await daaManager.execute('daa_lifecycle_manage', {
        agentId,
        action: 'terminate'
      });

      expect(result.status).toBe('terminated');
      expect(daaManager.agents.has(agentId)).toBe(false);
    });

    test('should throw error for unknown lifecycle action', async () => {
      await expect(
        daaManager.execute('daa_lifecycle_manage', {
          agentId,
          action: 'unknown_action'
        })
      ).rejects.toThrow('Unknown lifecycle action: unknown_action');
    });
  });

  describe('Inter-Agent Communication', () => {
    let fromAgentId, toAgentId;

    beforeEach(async () => {
      const agent1 = await daaManager.execute('daa_agent_create', { agent_type: 'coordinator' });
      const agent2 = await daaManager.execute('daa_agent_create', { agent_type: 'analyst' });
      fromAgentId = agent1.agentId;
      toAgentId = agent2.agentId;
    });

    test('should facilitate communication between agents', async () => {
      const result = await daaManager.execute('daa_communication', {
        from: fromAgentId,
        to: toAgentId,
        message: { type: 'task_assignment', data: { taskId: 'task123' } }
      });

      expect(result.status).toBe('delivered');
      expect(result.from).toBe(fromAgentId);
      expect(result.to).toBe(toAgentId);
      expect(result.messageId).toBeDefined();
      expect(result.deliveryTime).toBeGreaterThan(0);
    });

    test('should update communication metrics for both agents', async () => {
      const initialFromCount = daaManager.agents.get(fromAgentId).metrics.communicationCount;
      const initialToCount = daaManager.agents.get(toAgentId).metrics.communicationCount;

      await daaManager.execute('daa_communication', {
        from: fromAgentId,
        to: toAgentId,
        message: { type: 'status_update', data: {} }
      });

      const fromAgent = daaManager.agents.get(fromAgentId);
      const toAgent = daaManager.agents.get(toAgentId);

      expect(fromAgent.metrics.communicationCount).toBe(initialFromCount + 1);
      expect(toAgent.metrics.communicationCount).toBe(initialToCount + 1);
    });

    test('should handle communication routing', async () => {
      const result = await daaManager.execute('daa_communication', {
        from: fromAgentId,
        to: toAgentId,
        message: { type: 'data_request' }
      });

      expect(result.route).toEqual([`agent-${fromAgentId}`, `agent-${toAgentId}`]);
    });

    test('should throw error for non-existent sender', async () => {
      await expect(
        daaManager.execute('daa_communication', {
          from: 'non-existent',
          to: toAgentId,
          message: { type: 'test' }
        })
      ).rejects.toThrow('Agent not found: non-existent');
    });

    test('should throw error for non-existent receiver', async () => {
      await expect(
        daaManager.execute('daa_communication', {
          from: fromAgentId,
          to: 'non-existent',
          message: { type: 'test' }
        })
      ).rejects.toThrow('Agent not found: non-existent');
    });
  });

  describe('Consensus Mechanisms', () => {
    let agentIds;

    beforeEach(async () => {
      const agents = await Promise.all([
        daaManager.execute('daa_agent_create', { agent_type: 'coordinator' }),
        daaManager.execute('daa_agent_create', { agent_type: 'analyst' }),
        daaManager.execute('daa_agent_create', { agent_type: 'optimizer' })
      ]);
      agentIds = agents.map(a => a.agentId);
    });

    test('should achieve consensus with majority approval', async () => {
      const result = await daaManager.execute('daa_consensus', {
        agents: agentIds,
        proposal: { type: 'resource_reallocation', priority: 'high' }
      });

      expect(result.status).toMatch(/^(achieved|failed)$/);
      expect(result.participantCount).toBe(3);
      expect(result.votesCollected).toBe(3);
      expect(result.quorumRequired).toBe(2); // ceil(3/2) + 1 = 2
      expect(result.consensusId).toMatch(/^consensus_/);
    });

    test('should use raft algorithm by default', async () => {
      const result = await daaManager.execute('daa_consensus', {
        agents: agentIds,
        proposal: { type: 'workflow_change' }
      });

      expect(result.algorithm).toBe('raft');
    });

    test('should collect votes from all participating agents', async () => {
      const result = await daaManager.execute('daa_consensus', {
        agents: agentIds,
        proposal: { type: 'system_update' }
      });

      expect(result.votes).toHaveLength(3);
      expect(result.votes[0]).toHaveProperty('agentId');
      expect(result.votes[0]).toHaveProperty('vote');
      expect(result.votes[0]).toHaveProperty('confidence');
    });

    test('should calculate processing time', async () => {
      const result = await daaManager.execute('daa_consensus', {
        agents: agentIds,
        proposal: { type: 'performance_optimization' }
      });

      expect(result.processingTime).toBeGreaterThan(0);
    });

    test('should throw error for non-existent agent', async () => {
      await expect(
        daaManager.execute('daa_consensus', {
          agents: [...agentIds, 'non-existent'],
          proposal: { type: 'test' }
        })
      ).rejects.toThrow('Agent non-existent not found');
    });

    test('should throw error for inactive agent', async () => {
      // Pause one agent
      await daaManager.execute('daa_lifecycle_manage', {
        agentId: agentIds[0],
        action: 'pause'
      });

      await expect(
        daaManager.execute('daa_consensus', {
          agents: agentIds,
          proposal: { type: 'test' }
        })
      ).rejects.toThrow(/is not active/);
    });
  });

  describe('Fault Tolerance', () => {
    let agentId;

    beforeEach(async () => {
      const agent = await daaManager.execute('daa_agent_create', { agent_type: 'coordinator' });
      agentId = agent.agentId;
    });

    test('should handle auto recovery strategy', async () => {
      const result = await daaManager.execute('daa_fault_tolerance', {
        agentId,
        strategy: 'auto'
      });

      expect(result.status).toBe('handled');
      expect(result.agentId).toBe(agentId);
      expect(result.strategy).toBe('auto');
      expect(result.healthScore).toBeGreaterThan(0);
      expect(result.actionsPerformed).toContain('memory_cleanup');
    });

    test('should handle replication strategy', async () => {
      const result = await daaManager.execute('daa_fault_tolerance', {
        agentId,
        strategy: 'replicate'
      });

      expect(result.status).toBe('handled');
      expect(result.strategy).toBe('replicate');
      expect(result.replicationStatus).toBe('active');
    });

    test('should handle migration strategy', async () => {
      const result = await daaManager.execute('daa_fault_tolerance', {
        agentId,
        strategy: 'migrate'
      });

      expect(result.status).toBe('handled');
      expect(result.strategy).toBe('migrate');
      expect(result.actionsPerformed).toContain('migrate_to_node_2');
    });

    test('should handle checkpoint strategy', async () => {
      const result = await daaManager.execute('daa_fault_tolerance', {
        agentId,
        strategy: 'checkpoint'
      });

      expect(result.status).toBe('handled');
      expect(result.strategy).toBe('checkpoint');
      expect(result.backupCreated).toBe(true);
    });

    test('should handle isolation strategy', async () => {
      const result = await daaManager.execute('daa_fault_tolerance', {
        agentId,
        strategy: 'isolate'
      });

      expect(result.status).toBe('handled');
      expect(result.strategy).toBe('isolate');
      expect(result.actionsPerformed).toContain('isolate_network');
    });

    test('should update agent lifecycle transitions', async () => {
      await daaManager.execute('daa_fault_tolerance', {
        agentId,
        strategy: 'auto'
      });

      const agent = daaManager.agents.get(agentId);
      expect(agent.lifecycle.transitions.some(t => t.type === 'fault_tolerance')).toBe(true);
    });

    test('should throw error for unknown strategy', async () => {
      await expect(
        daaManager.execute('daa_fault_tolerance', {
          agentId,
          strategy: 'unknown_strategy'
        })
      ).rejects.toThrow('Unknown fault tolerance strategy: unknown_strategy');
    });
  });

  describe('Performance Optimization', () => {
    beforeEach(async () => {
      // Create some agents for optimization
      await daaManager.execute('daa_agent_create', { agent_type: 'coordinator' });
      await daaManager.execute('daa_agent_create', { agent_type: 'analyst' });
    });

    test('should optimize performance for system target', async () => {
      const result = await daaManager.execute('daa_optimization', {
        target: 'system',
        metrics: ['response_time', 'throughput']
      });

      expect(result.status).toBe('completed');
      expect(result.target).toBe('system');
      expect(result.totalOptimizations).toBeGreaterThan(0);
      expect(result.performanceImprovement).toBeDefined();
    });

    test('should identify and resolve bottlenecks', async () => {
      const result = await daaManager.execute('daa_optimization', {
        target: 'performance',
        metrics: ['latency', 'resource_usage']
      });

      expect(result.bottlenecksIdentified).toBeGreaterThanOrEqual(0);
      expect(result.bottlenecksResolved).toBeGreaterThanOrEqual(0);
      expect(result.optimizations).toBeDefined();
    });

    test('should provide performance improvement metrics', async () => {
      const result = await daaManager.execute('daa_optimization', {
        target: 'agents'
      });

      expect(result.performanceImprovement.overall).toBeGreaterThanOrEqual(0);
      expect(result.performanceImprovement.specific).toBeDefined();
      expect(result.performanceImprovement.metrics.before).toBeDefined();
      expect(result.performanceImprovement.metrics.after).toBeDefined();
    });

    test('should generate additional recommendations', async () => {
      const result = await daaManager.execute('daa_optimization', {
        target: 'communication'
      });

      expect(result.recommendations).toBeDefined();
      expect(Array.isArray(result.recommendations)).toBe(true);
    });

    test('should track optimization results', async () => {
      const result = await daaManager.execute('daa_optimization', {
        target: 'resource_allocation'
      });

      expect(result.optimizationsApplied).toBeGreaterThanOrEqual(0);
      expect(result.optimizationsApplied).toBeLessThanOrEqual(result.totalOptimizations);
      expect(result.optimizations.every(opt => 
        opt.status === 'applied' || opt.status === 'failed'
      )).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should throw error for unknown tool', async () => {
      await expect(
        daaManager.execute('unknown_tool', {})
      ).rejects.toThrow('Unknown DAA tool: unknown_tool');
    });

    test('should throw error for non-existent agent in lifecycle management', async () => {
      await expect(
        daaManager.execute('daa_lifecycle_manage', {
          agentId: 'non-existent',
          action: 'pause'
        })
      ).rejects.toThrow('Agent non-existent not found');
    });

    test('should throw error for non-existent agent in fault tolerance', async () => {
      await expect(
        daaManager.execute('daa_fault_tolerance', {
          agentId: 'non-existent',
          strategy: 'auto'
        })
      ).rejects.toThrow('Agent non-existent not found');
    });
  });

  describe('Health and Capabilities', () => {
    test('should report healthy status', async () => {
      const health = await daaManager.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.initialized).toBe(true);
      expect(health.agents).toBe(daaManager.agents.size);
      expect(health.resourceUtilization).toBeGreaterThanOrEqual(0);
    });

    test('should report capabilities', () => {
      const capabilities = daaManager.getCapabilities();

      expect(capabilities).toContain('dynamic-agent-creation');
      expect(capabilities).toContain('capability-matching');
      expect(capabilities).toContain('resource-allocation');
      expect(capabilities).toContain('lifecycle-management');
      expect(capabilities).toContain('inter-agent-communication');
      expect(capabilities).toContain('consensus-algorithms');
      expect(capabilities).toContain('fault-tolerance');
      expect(capabilities).toContain('performance-optimization');
    });

    test('should report healthy when initialized', () => {
      expect(daaManager.isHealthy()).toBe(true);
    });
  });
});