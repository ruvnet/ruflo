/**
 * Tests for MCP Cleanup Tools
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createCleanupTools } from '../cleanup-tools.js';
import type { ILogger } from '../../core/logger.js';
import type { CleanupToolContext } from '../cleanup-tools.js';

describe('MCP Cleanup Tools', () => {
  let mockLogger: ILogger;
  let cleanupTools: ReturnType<typeof createCleanupTools>;
  let mockContext: CleanupToolContext;

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as ILogger;

    // Create cleanup tools
    cleanupTools = createCleanupTools(mockLogger);

    // Mock context
    mockContext = {
      swarmCoordinator: {
        cleanup: jest.fn().mockResolvedValue(undefined),
        getSwarmStatus: jest.fn().mockResolvedValue({
          activeSwarms: 2,
          totalSwarms: 3,
        }),
        setSwarmTTL: jest.fn().mockResolvedValue(undefined),
      },
      agentManager: {
        getAllAgents: jest.fn().mockResolvedValue([
          { id: 'agent-1', swarmId: 'test-swarm', status: 'active' },
          { id: 'agent-2', swarmId: 'test-swarm', status: 'idle' },
          { id: 'agent-3', swarmId: 'other-swarm', status: 'busy' },
        ]),
        terminateAgent: jest.fn().mockResolvedValue(undefined),
        forceTerminateAgent: jest.fn().mockResolvedValue(undefined),
        getAgent: jest.fn().mockResolvedValue({
          id: 'agent-1',
          state: { data: 'test' },
          tasks: [
            { id: 'task-1', status: 'in_progress' },
            { id: 'task-2', status: 'completed' },
          ],
        }),
        saveAgentState: jest.fn().mockResolvedValue(undefined),
        transferTask: jest.fn().mockResolvedValue(undefined),
        setAgentTTL: jest.fn().mockResolvedValue(undefined),
      },
      lifecycleManager: {
        cleanupExpiredAgents: jest.fn().mockResolvedValue(2),
        retireAgent: jest.fn().mockResolvedValue(undefined),
        getConfig: jest.fn().mockReturnValue({
          agentTTL: 3600000,
          autoRetire: true,
          maxAgents: 50,
        }),
        updateConfig: jest.fn().mockResolvedValue(undefined),
        scheduleCleanup: jest.fn(),
      },
      sessionManager: {
        cleanupOrphanedProcesses: jest.fn().mockReturnValue(3),
        getOrphanedProcessCount: jest.fn().mockReturnValue(5),
      },
    };
  });

  describe('swarm_cleanup tool', () => {
    const swarmCleanupTool = () => cleanupTools.find(t => t.name === 'swarm_cleanup');

    it('should be registered', () => {
      expect(swarmCleanupTool()).toBeDefined();
    });

    it('should clean up all agents in a swarm', async () => {
      const tool = swarmCleanupTool()!;
      const result = await tool.handler({ swarmId: 'test-swarm' }, mockContext);

      expect(result.success).toBe(true);
      // 2 from agent manager + 2 from lifecycle manager = 4 total
      expect(result.agentsTerminated).toBe(4);
      expect(mockContext.agentManager.terminateAgent).toHaveBeenCalledTimes(2);
      expect(mockContext.swarmCoordinator.cleanup).toHaveBeenCalledWith('test-swarm');
    });

    it('should force cleanup when force flag is set', async () => {
      const tool = swarmCleanupTool()!;
      const result = await tool.handler({ swarmId: 'test-swarm', force: true }, mockContext);

      expect(result.success).toBe(true);
      // 2 from agent manager + 2 from lifecycle manager = 4 total
      expect(result.agentsTerminated).toBe(4);
      // Force flag should terminate even busy agents
      expect(mockContext.agentManager.terminateAgent).toHaveBeenCalledTimes(2);
    });

    it('should clean up lifecycle and session managers', async () => {
      const tool = swarmCleanupTool()!;
      const result = await tool.handler({ swarmId: 'test-swarm' }, mockContext);

      expect(mockContext.lifecycleManager.cleanupExpiredAgents).toHaveBeenCalled();
      expect(mockContext.sessionManager.cleanupOrphanedProcesses).toHaveBeenCalled();
      expect(result.agentsTerminated).toBe(4); // 2 from swarm + 2 from lifecycle
      expect(result.resourcesReleased).toBe(4); // 1 from coordinator + 3 from session
    });
  });

  describe('agent_terminate tool', () => {
    const agentTerminateTool = () => cleanupTools.find(t => t.name === 'agent_terminate');

    it('should be registered', () => {
      expect(agentTerminateTool()).toBeDefined();
    });

    it('should gracefully terminate an agent', async () => {
      const tool = agentTerminateTool()!;
      const result = await tool.handler(
        { agentId: 'agent-1', reason: 'Test termination', gracePeriod: 5000 },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.terminated).toBe(true);
      expect(result.statePreserved).toBe(true);
      expect(result.tasksSaved).toBe(1); // Only incomplete tasks
      expect(mockContext.agentManager.saveAgentState).toHaveBeenCalled();
      expect(mockContext.agentManager.terminateAgent).toHaveBeenCalledWith('agent-1', 5000);
      expect(mockContext.lifecycleManager.retireAgent).toHaveBeenCalledWith('agent-1', 'Test termination');
    });

    it('should force terminate when force flag is set', async () => {
      const tool = agentTerminateTool()!;
      const result = await tool.handler(
        { agentId: 'agent-1', reason: 'Force termination', force: true },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.terminated).toBe(true);
      expect(result.statePreserved).toBe(false); // No state saved on force
      expect(result.tasksSaved).toBe(0); // No tasks transferred on force
      expect(mockContext.agentManager.forceTerminateAgent).toHaveBeenCalledWith('agent-1');
    });
  });

  describe('swarm_set_ttl tool', () => {
    const swarmSetTTLTool = () => cleanupTools.find(t => t.name === 'swarm_set_ttl');

    it('should be registered', () => {
      expect(swarmSetTTLTool()).toBeDefined();
    });

    it('should set global TTL', async () => {
      const tool = swarmSetTTLTool()!;
      const result = await tool.handler(
        { scope: 'global', ttl: 7200000, autoRetire: true },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.previousTTL).toBe(3600000);
      expect(result.newTTL).toBe(7200000);
      expect(mockContext.lifecycleManager.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          agentTTL: 7200000,
          autoRetire: true,
        })
      );
      expect(mockContext.lifecycleManager.scheduleCleanup).toHaveBeenCalled();
    });

    it('should set agent-specific TTL', async () => {
      const tool = swarmSetTTLTool()!;
      const result = await tool.handler(
        { scope: 'agent', targetId: 'agent-1', ttl: 1800000, autoRetire: false },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(1);
      expect(mockContext.agentManager.setAgentTTL).toHaveBeenCalledWith('agent-1', 1800000, false);
    });
  });

  describe('swarm_get_cleanup_status tool', () => {
    const getCleanupStatusTool = () => cleanupTools.find(t => t.name === 'swarm_get_cleanup_status');

    it('should be registered', () => {
      expect(getCleanupStatusTool()).toBeDefined();
    });

    it('should return cleanup status', async () => {
      const tool = getCleanupStatusTool()!;
      const result = await tool.handler({ includeAgents: false }, mockContext);

      expect(result.success).toBe(true);
      expect(result.status.lifecycle).toEqual({
        globalTTL: 3600000,
        autoRetire: true,
        maxAgents: 50,
        cleanupInterval: 60000,
      });
      expect(result.status.orphanedProcesses).toBe(5);
      expect(result.recommendations).toContain('5 orphaned processes detected - run swarm_cleanup');
    });

    it('should include agent details when requested', async () => {
      const tool = getCleanupStatusTool()!;
      
      // Mock agents with timestamps
      const now = Date.now();
      mockContext.agentManager.getAllAgents = jest.fn().mockResolvedValue([
        { id: 'agent-1', type: 'coder', status: 'active', createdAt: now - 1800000, ttl: 3600000 },
        { id: 'agent-2', type: 'tester', status: 'idle', createdAt: now - 7200000 }, // Expired
      ]);

      const result = await tool.handler({ includeAgents: true }, mockContext);

      expect(result.status.agents.details).toBeDefined();
      expect(result.status.agents.details).toHaveLength(2);
      expect(result.status.agents.expired).toBe(1);
      expect(result.recommendations).toContain('1 agents have exceeded their TTL and should be cleaned up');
    });
  });
});