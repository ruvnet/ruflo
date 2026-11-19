/**
 * #4458 swarm scan follow-up: handleTaskFail()'s retry branch cleared the
 * failed agent's AgentState and called assignTask() without releasing the
 * agent's domain-pool reservation. When the retry went to a different agent,
 * the original slot stayed busy forever. The same-agent path must keep the
 * reservation (the retried task now owns it).
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

async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 20));
}

describe('UnifiedSwarmCoordinator retry domain-slot release (#4458)', () => {
  it('releases the failed domain agent when the retry is assigned elsewhere', async () => {
    const coordinator = createCoordinator();
    await coordinator.initialize();

    try {
      const taskId = await coordinator.submitTask(taskData('retryable'));

      // The explicitly domain-routed agent has no coding type bonus; the
      // generic coder should win scoreAgentForTask() when the retry is
      // assigned after handleTaskFail() marks the first agent idle.
      const { agentId: domainAgentId } = await coordinator.spawnAgent({
        type: 'tester',
        domain: 'core',
      });

      expect(await coordinator.assignTaskToDomain(taskId, 'core')).toBe(domainAgentId);

      // Queue a second domain task while the only pool agent is busy. Spawn
      // the generic coder only afterwards so submitTask() cannot auto-assign
      // this task before it reaches the domain queue.
      const queuedTaskId = await coordinator.submitTask(taskData('queued-behind-retry'));
      expect(await coordinator.assignTaskToDomain(queuedTaskId, 'core')).toBeUndefined();
      expect(coordinator.getTask(queuedTaskId)?.status).toBe('queued');

      const { agentId: coderAgentId } = await coordinator.spawnAgent({ type: 'coder' });
      expect(coordinator.getDomainPool('core')!.getState().busyAgents).toContain(domainAgentId);

      (coordinator as unknown as {
        handleTaskFail(agentId: string, data: { taskId: string; error: string }): void;
      }).handleTaskFail(domainAgentId, { taskId, error: 'retryable failure' });
      await flush();

      expect(coordinator.getTask(taskId)?.assignedTo?.id).toBe(coderAgentId);
      expect(coordinator.getTask(queuedTaskId)?.status).toBe('assigned');
      expect(coordinator.getTask(queuedTaskId)?.assignedTo?.id).toBe(domainAgentId);
      expect(coordinator.getAgent(domainAgentId)?.currentTask?.id).toBe(queuedTaskId);
    } finally {
      await coordinator.shutdown();
    }
  });
});
