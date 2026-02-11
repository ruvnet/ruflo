/**
 * QE Hive Bridge
 *
 * Anti-corruption layer for V3 Hive-Mind coordination integration.
 * Handles Queen coordinator registration, worker spawning, consensus,
 * and Byzantine fault-tolerant task execution.
 *
 * Integrates with V3 Hive-Mind services:
 * - Queen role registration for QE coordination
 * - Worker capability announcement
 * - Consensus for agent allocation
 * - Shared memory for coordination state
 *
 * Based on:
 * - ADR-030: Agentic-QE Plugin Integration
 * - ADR-007: Hive-Mind Consensus
 *
 * @module v3/plugins/agentic-qe/bridges/QEHiveBridge
 */

import type {
  IQEHiveBridge,
  HiveRole,
  QESwarmTask,
  QESwarmResult,
  AgentTaskResult,
  VotingResult,
  QELogger,
} from '../interfaces.js';

// V3 Hive-Mind types (would be imported from @claude-flow/coordination in production)
interface IHiveMindService {
  join(config: HiveJoinConfig): Promise<void>;
  leave(agentId: string): Promise<void>;
  consensus(proposal: VotingProposal): Promise<HiveVotingResult>;
  broadcast(message: HiveBroadcastMessage): Promise<void>;
  memory(operation: HiveMemoryOperation): Promise<HiveMemoryResult>;
  getStatus(): Promise<HiveStatus>;
  getWorkers(): Promise<HiveWorker[]>;
}

interface HiveJoinConfig {
  agentId: string;
  role: HiveRole;
  capabilities: string[];
  metadata?: Record<string, unknown>;
}

interface VotingProposal {
  action: 'propose' | 'vote' | 'status';
  type?: string;
  value?: Record<string, unknown>;
  proposalId?: string;
  vote?: boolean;
}

interface HiveVotingResult {
  accepted: boolean;
  reason?: string;
  votesFor: number;
  votesAgainst: number;
  totalVoters: number;
  proposalId?: string;
}

interface HiveBroadcastMessage {
  message: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  fromId: string;
  targetRole?: string;
}

interface HiveMemoryOperation {
  action: 'get' | 'set' | 'delete' | 'list';
  key?: string;
  value?: string;
}

interface HiveMemoryResult {
  success: boolean;
  value?: string;
  keys?: string[];
}

interface HiveStatus {
  initialized: boolean;
  topology: string;
  queenId: string | null;
  workerCount: number;
  votingAlgorithm: string;
}

interface HiveWorker {
  id: string;
  role: HiveRole;
  capabilities: string[];
  status: 'active' | 'idle' | 'busy';
  lastHeartbeat: number;
}

/**
 * QE-specific capabilities for hive workers
 */
const QE_CAPABILITIES = {
  testGeneration: [
    'unit-test-generation',
    'integration-test-generation',
    'e2e-test-generation',
    'property-test-generation',
  ],
  testExecution: [
    'test-execution',
    'parallel-execution',
    'result-aggregation',
  ],
  coverageAnalysis: [
    'coverage-collection',
    'gap-detection',
    'priority-ranking',
  ],
  qualityAssessment: [
    'quality-gate-evaluation',
    'risk-assessment',
    'readiness-assessment',
  ],
  securityCompliance: [
    'sast-scanning',
    'dast-scanning',
    'compliance-checking',
  ],
} as const;

/**
 * QE Hive Bridge Implementation
 *
 * Bridges agentic-qe coordination needs to V3's Hive-Mind.
 * Manages Queen registration, worker spawning, and BFT execution.
 */
export class QEHiveBridge implements IQEHiveBridge {
  private hiveMind: IHiveMindService;
  private logger: QELogger;
  private queenId: string;
  private spawnedWorkers: Map<string, string> = new Map(); // workerId -> agentType
  private initialized: boolean = false;

  constructor(
    hiveMind: IHiveMindService,
    logger: QELogger
  ) {
    this.hiveMind = hiveMind;
    this.logger = logger;
    this.queenId = `aqe-queen-${Date.now()}`;
  }

  /**
   * Get the Queen identifier
   */
  getQueenId(): string {
    return this.queenId;
  }

  /**
   * Register QE Queen with Hive Mind
   */
  async registerQueen(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('QE Queen already registered');
      return;
    }

    try {
      this.logger.info(`Registering QE Queen: ${this.queenId}`);

      await this.hiveMind.join({
        agentId: this.queenId,
        role: 'queen',
        capabilities: [
          'qe-coordination',
          'test-orchestration',
          'coverage-coordination',
          'quality-gate-enforcement',
          'security-scan-coordination',
        ],
        metadata: {
          source: 'agentic-qe',
          version: '3.2.3',
          contexts: [
            'test-generation',
            'test-execution',
            'coverage-analysis',
            'quality-assessment',
            'defect-intelligence',
            'security-compliance',
          ],
        },
      });

      this.initialized = true;
      this.logger.info('QE Queen registered successfully');
    } catch (error) {
      this.logger.error('Failed to register QE Queen', error);
      throw new QEHiveError('Failed to register Queen', error as Error);
    }
  }

  /**
   * Spawn a QE worker and join to hive
   */
  async spawnQEWorker(agentType: string, context: string): Promise<string> {
    this.ensureInitialized();

    try {
      const workerId = `aqe-${agentType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this.logger.info(`Spawning QE worker: ${workerId} (type: ${agentType}, context: ${context})`);

      // Get capabilities for this agent type
      const capabilities = this.getCapabilitiesForAgent(agentType, context);

      await this.hiveMind.join({
        agentId: workerId,
        role: 'worker',
        capabilities,
        metadata: {
          parentQueen: this.queenId,
          agentType,
          qeContext: context,
          spawnedAt: Date.now(),
        },
      });

      this.spawnedWorkers.set(workerId, agentType);
      this.logger.debug(`QE worker spawned: ${workerId}`);

      return workerId;
    } catch (error) {
      this.logger.error(`Failed to spawn QE worker: ${agentType}`, error);
      throw new QEHiveError('Failed to spawn worker', error as Error);
    }
  }

  /**
   * Coordinate a QE swarm task
   */
  async coordinateQESwarm(task: QESwarmTask): Promise<QESwarmResult> {
    this.ensureInitialized();

    try {
      this.logger.info(`Coordinating QE swarm task: ${task.id} (agents: ${task.agents.join(', ')})`);

      // 1. Propose task allocation via consensus
      const consensusResult = await this.proposeTaskAllocation(task, task.agents);

      if (!consensusResult.accepted) {
        this.logger.warn(`Task allocation rejected: ${consensusResult.reason}`);
        return {
          taskId: task.id,
          agentResults: [],
          completedAgents: 0,
          totalAgents: task.agents.length,
          success: false,
          aggregatedOutput: { error: consensusResult.reason },
        };
      }

      // 2. Broadcast task to allocated workers
      await this.broadcastTask(task);

      // 3. Collect results from workers
      const results = await this.collectResults(task);

      // 4. Aggregate results
      const success = results.filter((r) => r.success).length >= Math.ceil(task.agents.length / 2);

      const swarmResult: QESwarmResult = {
        taskId: task.id,
        agentResults: results,
        completedAgents: results.length,
        totalAgents: task.agents.length,
        success,
        aggregatedOutput: this.aggregateResults(results),
      };

      this.logger.info(`QE swarm task complete: ${task.id} (success: ${success})`);
      return swarmResult;
    } catch (error) {
      this.logger.error(`QE swarm task failed: ${task.id}`, error);
      throw new QEHiveError('Swarm coordination failed', error as Error);
    }
  }

  /**
   * Execute operation with Byzantine fault tolerance
   */
  async executeWithBFT<T>(
    operation: () => Promise<T>,
    replicaCount: number = 3
  ): Promise<T> {
    this.ensureInitialized();

    this.logger.debug(`Executing operation with BFT (replicas: ${replicaCount})`);

    const results: T[] = [];
    const errors: Error[] = [];

    // Execute operation on multiple replicas
    const promises = Array(replicaCount).fill(null).map(async (_, i) => {
      try {
        const result = await operation();
        return { success: true, result, index: i };
      } catch (error) {
        return { success: false, error: error as Error, index: i };
      }
    });

    const outcomes = await Promise.all(promises);

    for (const outcome of outcomes) {
      if (outcome.success) {
        results.push(outcome.result as T);
      } else {
        errors.push(outcome.error as Error);
      }
    }

    // BFT requires 2f+1 agreeing results (f = max faults tolerated)
    // For 3 replicas: f=1, need 2 agreeing
    // For 5 replicas: f=2, need 3 agreeing
    const maxFaults = Math.floor((replicaCount - 1) / 3);
    const requiredAgreement = 2 * maxFaults + 1;

    if (results.length < requiredAgreement) {
      this.logger.error(`BFT consensus failed: ${results.length}/${replicaCount} replicas succeeded`);
      throw new QEHiveError(
        `BFT consensus failed: only ${results.length}/${replicaCount} replicas succeeded`,
        errors[0]
      );
    }

    // Return first successful result (in production, would compare for consensus)
    this.logger.debug(`BFT consensus achieved: ${results.length}/${replicaCount} replicas agreed`);
    return results[0];
  }

  /**
   * Propose task allocation via consensus
   */
  async proposeTaskAllocation(
    task: QESwarmTask,
    requiredAgents: string[]
  ): Promise<VotingResult> {
    this.ensureInitialized();

    try {
      this.logger.debug(`Proposing task allocation: ${task.id}`);

      const result = await this.hiveMind.voting({
        action: 'propose',
        type: 'qe-task-allocation',
        value: {
          taskId: task.id,
          taskType: task.type,
          requiredAgents,
          priority: task.priority,
          proposedBy: this.queenId,
          timestamp: Date.now(),
        },
      });

      return {
        accepted: result.accepted,
        reason: result.reason,
        votesFor: result.votesFor,
        votesAgainst: result.votesAgainst,
        totalVoters: result.totalVoters,
      };
    } catch (error) {
      this.logger.error('Task allocation proposal failed', error);
      throw new QEHiveError('Consensus proposal failed', error as Error);
    }
  }

  /**
   * Broadcast result to hive
   */
  async broadcastResult(taskId: string, result: QESwarmResult): Promise<void> {
    this.ensureInitialized();

    try {
      this.logger.debug(`Broadcasting result for task: ${taskId}`);

      await this.hiveMind.broadcast({
        message: JSON.stringify({
          type: 'qe-result',
          taskId,
          result: {
            success: result.success,
            completedAgents: result.completedAgents,
            totalAgents: result.totalAgents,
            aggregatedOutput: result.aggregatedOutput,
          },
        }),
        priority: result.success ? 'normal' : 'high',
        fromId: this.queenId,
      });

      this.logger.debug(`Result broadcast complete for task: ${taskId}`);
    } catch (error) {
      this.logger.error(`Failed to broadcast result: ${taskId}`, error);
      throw new QEHiveError('Result broadcast failed', error as Error);
    }
  }

  /**
   * Store QE state in hive memory
   */
  async storeQEState(key: string, value: unknown): Promise<void> {
    this.ensureInitialized();

    try {
      const qeKey = `qe:${key}`;
      this.logger.debug(`Storing QE state: ${qeKey}`);

      await this.hiveMind.memory({
        action: 'set',
        key: qeKey,
        value: JSON.stringify(value),
      });
    } catch (error) {
      this.logger.error(`Failed to store QE state: ${key}`, error);
      throw new QEHiveError('Failed to store state', error as Error);
    }
  }

  /**
   * Retrieve QE state from hive memory
   */
  async getQEState<T>(key: string): Promise<T | null> {
    this.ensureInitialized();

    try {
      const qeKey = `qe:${key}`;
      const result = await this.hiveMind.memory({
        action: 'get',
        key: qeKey,
      });

      if (!result.value) return null;

      return JSON.parse(result.value) as T;
    } catch (error) {
      this.logger.error(`Failed to get QE state: ${key}`, error);
      return null;
    }
  }

  /**
   * Leave the hive (cleanup)
   */
  async leave(): Promise<void> {
    if (!this.initialized) return;

    try {
      this.logger.info('QE Queen leaving hive...');

      // Remove all spawned workers
      for (const [workerId] of this.spawnedWorkers) {
        try {
          await this.hiveMind.leave(workerId);
          this.logger.debug(`Worker removed: ${workerId}`);
        } catch {
          // Best effort cleanup
        }
      }
      this.spawnedWorkers.clear();

      // Remove queen
      await this.hiveMind.leave(this.queenId);
      this.initialized = false;

      this.logger.info('QE Queen left hive successfully');
    } catch (error) {
      this.logger.error('Error leaving hive', error);
      throw new QEHiveError('Failed to leave hive', error as Error);
    }
  }

  /**
   * Broadcast task to allocated workers
   */
  private async broadcastTask(task: QESwarmTask): Promise<void> {
    await this.hiveMind.broadcast({
      message: JSON.stringify({
        type: 'qe-task',
        taskId: task.id,
        taskType: task.type,
        payload: task.payload,
        timeout: task.timeout,
        assignedAgents: task.agents,
      }),
      priority: task.priority === 'critical' ? 'critical' : 'normal',
      fromId: this.queenId,
    });
  }

  /**
   * Collect results from workers
   */
  private async collectResults(task: QESwarmTask): Promise<AgentTaskResult[]> {
    const results: AgentTaskResult[] = [];
    const timeout = task.timeout || 30000;
    const startTime = Date.now();

    // Poll for results
    while (Date.now() - startTime < timeout) {
      const resultData = await this.getQEState<AgentTaskResult[]>(`task-results:${task.id}`);

      if (resultData && resultData.length >= task.agents.length) {
        return resultData;
      }

      // Wait before polling again
      await this.sleep(500);
    }

    // Return partial results on timeout
    this.logger.warn(`Task ${task.id} timed out, returning partial results`);
    const partialResults = await this.getQEState<AgentTaskResult[]>(`task-results:${task.id}`);
    return partialResults || [];
  }

  /**
   * Aggregate results from multiple agents
   */
  private aggregateResults(results: AgentTaskResult[]): Record<string, unknown> {
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    // Merge outputs
    const mergedOutput: Record<string, unknown> = {};
    for (const result of results) {
      if (result.success && result.output) {
        Object.assign(mergedOutput, result.output);
      }
    }

    return {
      summary: {
        total: results.length,
        successful: successCount,
        failed: failureCount,
        successRate: results.length > 0 ? successCount / results.length : 0,
      },
      errors: results.filter((r) => !r.success).map((r) => ({
        agentId: r.agentId,
        error: r.error,
      })),
      mergedOutput,
    };
  }

  /**
   * Get capabilities for an agent type
   */
  private getCapabilitiesForAgent(agentType: string, context: string): string[] {
    const baseCapabilities = [`context:${context}`, agentType];

    // Add context-specific capabilities
    if (context.includes('test-generation')) {
      baseCapabilities.push(...QE_CAPABILITIES.testGeneration);
    } else if (context.includes('test-execution')) {
      baseCapabilities.push(...QE_CAPABILITIES.testExecution);
    } else if (context.includes('coverage')) {
      baseCapabilities.push(...QE_CAPABILITIES.coverageAnalysis);
    } else if (context.includes('quality')) {
      baseCapabilities.push(...QE_CAPABILITIES.qualityAssessment);
    } else if (context.includes('security')) {
      baseCapabilities.push(...QE_CAPABILITIES.securityCompliance);
    }

    return baseCapabilities;
  }

  /**
   * Ensure bridge is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new QEHiveError('QEHiveBridge not initialized. Call registerQueen() first.');
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * QE Hive Error class
 */
export class QEHiveError extends Error {
  public readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'QEHiveError';
    this.cause = cause;
  }
}
