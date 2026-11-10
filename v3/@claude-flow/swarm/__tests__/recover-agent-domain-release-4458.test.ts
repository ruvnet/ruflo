/**
 * #4458 swarm scan: UnifiedSwarmCoordinator.recoverAgent() reset the shared
 * AgentState to idle but never released the agent's domain-pool reservation.
 * AgentPool.busy is separate from AgentState.status, so the slot stayed busy
 * forever and queued domain tasks could not drain after heartbeat recovery.
 */

import { describe, expect, it } from 'vitest';
import {
  UnifiedSwarmCoordinator,
  createUnifiedSwarmCoordinator,
} from '../src/unified-coordinator.ts';

function createCoordinator(): UnifiedSwarmCoordinator {
  return createUnifiedSwarmCoordinator({
    maxAgents: 20,
    maxTasks: 100,
    heartbeatIntervalMs: 1000,
    healthCheckIntervalMs: 2000,
    taskTimeoutMs: 10000,
    topology: { type: 'hierarchical', maxAgents: 20 },
    consensus: {
      algorithm: 'raft',
      threshold: 0.66,
      timeoutMs: 5000,
      maxRounds: 5,
      requireQuorum: true,
    },
  });
}

function taskData(name: string) {
  return {
    type: 'coding' as const,
    name,
    description: name,
    priority: 'normal' as const,
    dependencies: [],
    input: {},
    timeoutMs: 5000,
    retries: 0,
    maxRetries: 3,
    metadata: {},
  };
}

describe('UnifiedSwarmCoordinator recovered-agent domain release (#4458)', () => {
  it('returns the recovered agent to its domain pool and drains a queued task', async () => {
    const coordinator = createCoordinator();
    await coordinator.initialize();

    try {
      const activeTaskId = await coordinator.submitTask(taskData('active'));
      const { agentId } = await coordinator.spawnAgent({ type: 'coder', domain: 'core' });
      expect(await coordinator.assignTaskToDomain(activeTaskId, 'core')).toBe(agentId);

      // The only pool agent is busy, so this is queued in the domain queue.
      const queuedTaskId = await coordinator.submitTask(taskData('queued'));
      expect(await coordinator.assignTaskToDomain(queuedTaskId, 'core')).toBeUndefined();
      expect(coordinator.getTask(queuedTaskId)?.status).toBe('queued');
      expect(coordinator.getDomainPool('core')!.getState().busyAgents).toContain(agentId);

      await (coordinator as unknown as {
        recoverAgent(agentId: string): Promise<void>;
      }).recoverAgent(agentId);

      // Releasing the reservation lets the queued domain task take the slot.
      expect(coordinator.getTask(queuedTaskId)?.status).toBe('assigned');
      expect(coordinator.getTask(queuedTaskId)?.assignedTo?.id).toBe(agentId);
      expect(coordinator.getAgent(agentId)?.currentTask?.id).toBe(queuedTaskId);
      expect(coordinator.getDomainPool('core')!.getState().busyAgents).toContain(agentId);
    } finally {
      await coordinator.shutdown();
    }
  });
});
