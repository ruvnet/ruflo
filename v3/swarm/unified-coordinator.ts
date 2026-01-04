/**
 * V3 Unified Swarm Coordinator
 * Consolidates SwarmCoordinator, HiveMind, Maestro, and AgentManager into a single system
 * Supports the 15-agent hierarchical mesh structure with domain-based task routing
 *
 * Performance Targets:
 * - Agent coordination: <100ms for 15 agents
 * - Consensus: <100ms
 * - Message throughput: 1000+ msgs/sec
 *
 * Agent Hierarchy:
 * - Queen (Agent 1): Top-level coordinator
 * - Security Domain (Agents 2-4): security-architect, security-auditor, test-architect
 * - Core Domain (Agents 5-9): core-architect, type-modernization, memory-specialist, swarm-specialist, mcp-optimizer
 * - Integration Domain (Agents 10-12): integration-architect, cli-modernizer, neural-integrator
 * - Support Domain (Agents 13-15): test-architect, performance-engineer, deployment-engineer
 */

import { EventEmitter } from 'events';
import {
  SwarmId,
  AgentId,
  TaskId,
  AgentState,
  AgentType,
  AgentStatus,
  AgentCapabilities,
  AgentMetrics,
  TaskDefinition,
  TaskType,
  TaskStatus,
  TaskPriority,
  CoordinatorConfig,
  CoordinatorState,
  CoordinatorMetrics,
  SwarmStatus,
  SwarmEvent,
  SwarmEventType,
  TopologyConfig,
  TopologyType,
  ConsensusConfig,
  ConsensusResult,
  Message,
  MessageType,
  PerformanceReport,
  IUnifiedSwarmCoordinator,
  SWARM_CONSTANTS,
} from './types.js';
import { TopologyManager, createTopologyManager } from './topology-manager.js';
import { MessageBus, createMessageBus } from './message-bus.js';
import { AgentPool, createAgentPool } from './agent-pool.js';
import { ConsensusEngine, createConsensusEngine } from './consensus/index.js';

// =============================================================================
// Domain Types for 15-Agent Hierarchy
// =============================================================================

export type AgentDomain = 'queen' | 'security' | 'core' | 'integration' | 'support';

export interface DomainConfig {
  name: AgentDomain;
  agentNumbers: number[];
  priority: number;
  capabilities: string[];
  description: string;
}

export interface TaskAssignment {
  taskId: string;
  domain: AgentDomain;
  agentId: string;
  priority: TaskPriority;
  assignedAt: Date;
}

export interface ParallelExecutionResult {
  taskId: string;
  domain: AgentDomain;
  success: boolean;
  result?: unknown;
  error?: Error;
  durationMs: number;
}

export interface DomainStatus {
  name: AgentDomain;
  agentCount: number;
  availableAgents: number;
  busyAgents: number;
  tasksQueued: number;
  tasksCompleted: number;
}

// =============================================================================
// 15-Agent Domain Configuration
// =============================================================================

const DOMAIN_CONFIGS: DomainConfig[] = [
  {
    name: 'queen',
    agentNumbers: [1],
    priority: 0,
    capabilities: ['coordination', 'planning', 'oversight', 'consensus'],
    description: 'Top-level swarm coordination and orchestration',
  },
  {
    name: 'security',
    agentNumbers: [2, 3, 4],
    priority: 1,
    capabilities: ['security-architecture', 'cve-remediation', 'security-testing', 'threat-modeling'],
    description: 'Security architecture, CVE fixes, and security testing',
  },
  {
    name: 'core',
    agentNumbers: [5, 6, 7, 8, 9],
    priority: 2,
    capabilities: ['ddd-design', 'type-modernization', 'memory-unification', 'swarm-coordination', 'mcp-optimization'],
    description: 'Core architecture, DDD, memory unification, and MCP optimization',
  },
  {
    name: 'integration',
    agentNumbers: [10, 11, 12],
    priority: 3,
    capabilities: ['agentic-flow-integration', 'cli-modernization', 'neural-integration', 'hooks-system'],
    description: 'agentic-flow integration, CLI modernization, and neural features',
  },
  {
    name: 'support',
    agentNumbers: [13, 14, 15],
    priority: 4,
    capabilities: ['tdd-testing', 'performance-benchmarking', 'deployment', 'release-management'],
    description: 'Testing, performance optimization, and deployment',
  },
];

export class UnifiedSwarmCoordinator extends EventEmitter implements IUnifiedSwarmCoordinator {
  private config: CoordinatorConfig;
  private state: CoordinatorState;
  private topologyManager: TopologyManager;
  private messageBus: MessageBus;
  private consensusEngine: ConsensusEngine;
  private agentPools: Map<AgentType, AgentPool> = new Map();

  // Domain-based tracking for 15-agent hierarchy
  private domainConfigs: Map<AgentDomain, DomainConfig> = new Map();
  private domainPools: Map<AgentDomain, AgentPool> = new Map();
  private agentDomainMap: Map<string, AgentDomain> = new Map();
  private taskAssignments: Map<string, TaskAssignment> = new Map();
  private domainTaskQueues: Map<AgentDomain, string[]> = new Map();

  // Performance tracking
  private startTime?: Date;
  private taskCounter: number = 0;
  private agentCounter: number = 0;
  private coordinationLatencies: number[] = [];
  private lastMetricsUpdate: Date = new Date();

  // Background intervals
  private heartbeatInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;

  constructor(config: Partial<CoordinatorConfig> = {}) {
    super();

    this.config = this.createDefaultConfig(config);
    this.state = this.createInitialState();

    // Initialize components
    this.topologyManager = createTopologyManager(this.config.topology);
    this.messageBus = createMessageBus(this.config.messageBus);
    this.consensusEngine = createConsensusEngine(
      this.state.id.id,
      this.config.consensus.algorithm,
      this.config.consensus
    );

    // Initialize domain configurations
    this.initializeDomainConfigs();

    this.setupEventForwarding();
  }

  // =============================================================================
  // Domain Configuration Initialization
  // =============================================================================

  private initializeDomainConfigs(): void {
    for (const config of DOMAIN_CONFIGS) {
      this.domainConfigs.set(config.name, config);
      this.domainTaskQueues.set(config.name, []);
    }
  }

  async initialize(): Promise<void> {
    if (this.state.status !== 'initializing' && this.state.status !== 'stopped') {
      throw new Error(`Cannot initialize from status: ${this.state.status}`);
    }

    const startTime = performance.now();

    try {
      // Initialize all components in parallel
      await Promise.all([
        this.topologyManager.initialize(this.config.topology),
        this.messageBus.initialize(this.config.messageBus),
        this.consensusEngine.initialize(this.config.consensus),
      ]);

      // Initialize default agent pools
      await this.initializeAgentPools();

      // Start background processes
      this.startBackgroundProcesses();

      this.state.status = 'running';
      this.startTime = new Date();
      this.state.startedAt = this.startTime;

      const duration = performance.now() - startTime;
      this.recordCoordinationLatency(duration);

      this.emitEvent('swarm.initialized', {
        swarmId: this.state.id.id,
        initDurationMs: duration,
      });

      this.emitEvent('swarm.started', {
        swarmId: this.state.id.id,
        topology: this.config.topology.type,
        consensus: this.config.consensus.algorithm,
      });
    } catch (error) {
      this.state.status = 'failed';
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (this.state.status === 'stopped') {
      return;
    }

    this.state.status = 'shutting_down';

    // Stop background processes
    this.stopBackgroundProcesses();

    // Shutdown components
    await Promise.all([
      this.messageBus.shutdown(),
      this.consensusEngine.shutdown(),
      ...Array.from(this.agentPools.values()).map(pool => pool.shutdown()),
    ]);

    // Clear agents and tasks
    this.state.agents.clear();
    this.state.tasks.clear();

    this.state.status = 'stopped';

    this.emitEvent('swarm.stopped', {
      swarmId: this.state.id.id,
      totalTasks: this.state.metrics.totalTasks,
      completedTasks: this.state.metrics.completedTasks,
    });
  }

  async pause(): Promise<void> {
    if (this.state.status !== 'running') {
      return;
    }

    this.state.status = 'paused';
    this.stopBackgroundProcesses();

    this.emitEvent('swarm.paused', { swarmId: this.state.id.id });
  }

  async resume(): Promise<void> {
    if (this.state.status !== 'paused') {
      return;
    }

    this.startBackgroundProcesses();
    this.state.status = 'running';

    this.emitEvent('swarm.resumed', { swarmId: this.state.id.id });
  }

  // ===== AGENT MANAGEMENT =====

  async registerAgent(
    agentData: Omit<AgentState, 'id'>
  ): Promise<string> {
    const startTime = performance.now();

    if (this.state.agents.size >= this.config.maxAgents) {
      throw new Error(`Maximum agents (${this.config.maxAgents}) reached`);
    }

    this.agentCounter++;
    const agentId: AgentId = {
      id: `agent_${this.state.id.id}_${this.agentCounter}`,
      swarmId: this.state.id.id,
      type: agentData.type,
      instance: this.agentCounter,
    };

    const agent: AgentState = {
      ...agentData,
      id: agentId,
      lastHeartbeat: new Date(),
      connections: [],
    };

    // Add to state
    this.state.agents.set(agentId.id, agent);

    // Add to topology
    const role = this.determineTopologyRole(agent.type);
    await this.topologyManager.addNode(agentId.id, role);

    // Subscribe to message bus
    this.messageBus.subscribe(agentId.id, (message) => {
      this.handleAgentMessage(agentId.id, message);
    });

    // Add to consensus engine
    this.consensusEngine.addNode(agentId.id);

    const duration = performance.now() - startTime;
    this.recordCoordinationLatency(duration);

    this.emitEvent('agent.joined', {
      agentId: agentId.id,
      type: agent.type,
      registrationDurationMs: duration,
    });

    return agentId.id;
  }

  async unregisterAgent(agentId: string): Promise<void> {
    const agent = this.state.agents.get(agentId);
    if (!agent) {
      return;
    }

    // Cancel any assigned tasks
    if (agent.currentTask) {
      await this.cancelTask(agent.currentTask.id);
    }

    // Remove from components
    await this.topologyManager.removeNode(agentId);
    this.messageBus.unsubscribe(agentId);
    this.consensusEngine.removeNode(agentId);

    // Remove from state
    this.state.agents.delete(agentId);

    this.emitEvent('agent.left', { agentId });
  }

  getAgent(agentId: string): AgentState | undefined {
    return this.state.agents.get(agentId);
  }

  getAllAgents(): AgentState[] {
    return Array.from(this.state.agents.values());
  }

  getAgentsByType(type: AgentType): AgentState[] {
    return this.getAllAgents().filter(a => a.type === type);
  }

  getAvailableAgents(): AgentState[] {
    return this.getAllAgents().filter(a => a.status === 'idle');
  }

  // ===== TASK MANAGEMENT =====

  async submitTask(
    taskData: Omit<TaskDefinition, 'id' | 'status' | 'createdAt'>
  ): Promise<string> {
    const startTime = performance.now();

    if (this.state.tasks.size >= this.config.maxTasks) {
      throw new Error(`Maximum tasks (${this.config.maxTasks}) reached`);
    }

    this.taskCounter++;
    const taskId: TaskId = {
      id: `task_${this.state.id.id}_${this.taskCounter}`,
      swarmId: this.state.id.id,
      sequence: this.taskCounter,
      priority: taskData.priority,
    };

    const task: TaskDefinition = {
      ...taskData,
      id: taskId,
      status: 'created',
      createdAt: new Date(),
    };

    this.state.tasks.set(taskId.id, task);
    this.state.metrics.totalTasks++;

    // Assign to available agent
    const assignedAgent = await this.assignTask(task);

    const duration = performance.now() - startTime;
    this.recordCoordinationLatency(duration);

    this.emitEvent('task.created', {
      taskId: taskId.id,
      type: task.type,
      priority: task.priority,
      assignedTo: assignedAgent?.id.id,
      assignmentDurationMs: duration,
    });

    return taskId.id;
  }

  async cancelTask(taskId: string): Promise<void> {
    const task = this.state.tasks.get(taskId);
    if (!task) {
      return;
    }

    // Notify assigned agent
    if (task.assignedTo) {
      await this.messageBus.send({
        type: 'task_fail',
        from: this.state.id.id,
        to: task.assignedTo.id,
        payload: { taskId, reason: 'cancelled' },
        priority: 'high',
        requiresAck: true,
        ttlMs: SWARM_CONSTANTS.DEFAULT_MESSAGE_TTL_MS,
      });

      // Release agent
      const agent = this.state.agents.get(task.assignedTo.id);
      if (agent) {
        agent.status = 'idle';
        agent.currentTask = undefined;
      }
    }

    task.status = 'cancelled';

    this.emitEvent('task.failed', {
      taskId,
      reason: 'cancelled',
    });
  }

  getTask(taskId: string): TaskDefinition | undefined {
    return this.state.tasks.get(taskId);
  }

  getAllTasks(): TaskDefinition[] {
    return Array.from(this.state.tasks.values());
  }

  getTasksByStatus(status: TaskStatus): TaskDefinition[] {
    return this.getAllTasks().filter(t => t.status === status);
  }

  // ===== COORDINATION =====

  async proposeConsensus(value: unknown): Promise<ConsensusResult> {
    const startTime = performance.now();

    const proposal = await this.consensusEngine.propose(value, this.state.id.id);
    const result = await this.consensusEngine.awaitConsensus(proposal.id);

    const duration = performance.now() - startTime;
    this.recordCoordinationLatency(duration);

    if (result.approved) {
      this.emitEvent('consensus.achieved', {
        proposalId: proposal.id,
        approvalRate: result.approvalRate,
        durationMs: duration,
      });
    } else {
      this.emitEvent('consensus.failed', {
        proposalId: proposal.id,
        approvalRate: result.approvalRate,
        reason: 'threshold_not_met',
      });
    }

    return result;
  }

  async broadcastMessage(
    payload: unknown,
    priority: Message['priority'] = 'normal'
  ): Promise<void> {
    await this.messageBus.broadcast({
      type: 'broadcast',
      from: this.state.id.id,
      payload,
      priority,
      requiresAck: false,
      ttlMs: SWARM_CONSTANTS.DEFAULT_MESSAGE_TTL_MS,
    });
  }

  // ===== MONITORING =====

  getState(): CoordinatorState {
    return {
      ...this.state,
      agents: new Map(this.state.agents),
      tasks: new Map(this.state.tasks),
      topology: this.topologyManager.getState(),
    };
  }

  getMetrics(): CoordinatorMetrics {
    return { ...this.state.metrics };
  }

  getPerformanceReport(): PerformanceReport {
    const recentLatencies = this.coordinationLatencies.slice(-100);
    const sortedLatencies = [...recentLatencies].sort((a, b) => a - b);

    return {
      timestamp: new Date(),
      window: 60000, // 1 minute
      coordinationLatencyP50: sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] || 0,
      coordinationLatencyP99: sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || 0,
      messagesPerSecond: this.messageBus.getStats().messagesPerSecond,
      taskThroughput: this.calculateTaskThroughput(),
      agentUtilization: this.calculateAgentUtilization(),
      consensusSuccessRate: this.state.metrics.consensusSuccessRate,
    };
  }

  // ===== PRIVATE METHODS =====

  private createDefaultConfig(config: Partial<CoordinatorConfig>): CoordinatorConfig {
    return {
      topology: {
        type: config.topology?.type ?? 'mesh',
        maxAgents: config.topology?.maxAgents ?? SWARM_CONSTANTS.DEFAULT_MAX_AGENTS,
        replicationFactor: config.topology?.replicationFactor ?? 2,
        partitionStrategy: config.topology?.partitionStrategy ?? 'hash',
        failoverEnabled: config.topology?.failoverEnabled ?? true,
        autoRebalance: config.topology?.autoRebalance ?? true,
      },
      consensus: {
        algorithm: config.consensus?.algorithm ?? 'raft',
        threshold: config.consensus?.threshold ?? SWARM_CONSTANTS.DEFAULT_CONSENSUS_THRESHOLD,
        timeoutMs: config.consensus?.timeoutMs ?? SWARM_CONSTANTS.DEFAULT_CONSENSUS_TIMEOUT_MS,
        maxRounds: config.consensus?.maxRounds ?? 10,
        requireQuorum: config.consensus?.requireQuorum ?? true,
      },
      messageBus: {
        maxQueueSize: config.messageBus?.maxQueueSize ?? SWARM_CONSTANTS.MAX_QUEUE_SIZE,
        processingIntervalMs: config.messageBus?.processingIntervalMs ?? 10,
        ackTimeoutMs: config.messageBus?.ackTimeoutMs ?? 5000,
        retryAttempts: config.messageBus?.retryAttempts ?? SWARM_CONSTANTS.MAX_RETRIES,
        enablePersistence: config.messageBus?.enablePersistence ?? false,
        compressionEnabled: config.messageBus?.compressionEnabled ?? false,
      },
      maxAgents: config.maxAgents ?? SWARM_CONSTANTS.DEFAULT_MAX_AGENTS,
      maxTasks: config.maxTasks ?? SWARM_CONSTANTS.DEFAULT_MAX_TASKS,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? SWARM_CONSTANTS.DEFAULT_HEARTBEAT_INTERVAL_MS,
      healthCheckIntervalMs: config.healthCheckIntervalMs ?? SWARM_CONSTANTS.DEFAULT_HEALTH_CHECK_INTERVAL_MS,
      taskTimeoutMs: config.taskTimeoutMs ?? SWARM_CONSTANTS.DEFAULT_TASK_TIMEOUT_MS,
      autoScaling: config.autoScaling ?? true,
      autoRecovery: config.autoRecovery ?? true,
    };
  }

  private createInitialState(): CoordinatorState {
    const swarmId: SwarmId = {
      id: `swarm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      namespace: 'default',
      version: '3.0.0',
      createdAt: new Date(),
    };

    return {
      id: swarmId,
      status: 'initializing',
      topology: {
        type: 'mesh',
        nodes: [],
        edges: [],
        partitions: [],
      },
      agents: new Map(),
      tasks: new Map(),
      metrics: {
        uptime: 0,
        activeAgents: 0,
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        avgTaskDurationMs: 0,
        messagesPerSecond: 0,
        consensusSuccessRate: 1.0,
        coordinationLatencyMs: 0,
        memoryUsageBytes: 0,
      },
    };
  }

  private async initializeAgentPools(): Promise<void> {
    const defaultPoolTypes: AgentType[] = ['worker', 'coordinator', 'researcher', 'coder'];

    for (const type of defaultPoolTypes) {
      const pool = createAgentPool({
        name: `${type}-pool`,
        type,
        minSize: 0,
        maxSize: Math.floor(this.config.maxAgents / defaultPoolTypes.length),
        scaleUpThreshold: 0.8,
        scaleDownThreshold: 0.2,
        cooldownMs: 30000,
        healthCheckIntervalMs: this.config.healthCheckIntervalMs,
      });

      await pool.initialize();
      this.agentPools.set(type, pool);
    }
  }

  private setupEventForwarding(): void {
    // Forward topology events
    this.topologyManager.on('node.added', (data) => {
      this.emitEvent('topology.updated', { action: 'node_added', ...data });
    });

    this.topologyManager.on('node.removed', (data) => {
      this.emitEvent('topology.updated', { action: 'node_removed', ...data });
    });

    this.topologyManager.on('topology.rebalanced', (data) => {
      this.emitEvent('topology.rebalanced', data);
    });

    // Forward consensus events
    this.consensusEngine.on('consensus.achieved', (data) => {
      this.state.metrics.consensusSuccessRate =
        (this.state.metrics.consensusSuccessRate * 0.9) + (data.approved ? 0.1 : 0);
    });

    // Forward message bus events
    this.messageBus.on('message.delivered', (data) => {
      this.emitEvent('message.received', data);
    });
  }

  private startBackgroundProcesses(): void {
    // Heartbeat monitoring
    this.heartbeatInterval = setInterval(() => {
      this.checkHeartbeats();
    }, this.config.heartbeatIntervalMs);

    // Health checks
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckIntervalMs);

    // Metrics collection
    this.metricsInterval = setInterval(() => {
      this.updateMetrics();
    }, 1000);
  }

  private stopBackgroundProcesses(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = undefined;
    }
  }

  private async assignTask(task: TaskDefinition): Promise<AgentState | undefined> {
    // Find best available agent
    const availableAgents = this.getAvailableAgents();
    if (availableAgents.length === 0) {
      task.status = 'queued';
      return undefined;
    }

    // Score agents based on capabilities and workload
    const scoredAgents = availableAgents.map(agent => ({
      agent,
      score: this.scoreAgentForTask(agent, task),
    })).sort((a, b) => b.score - a.score);

    const bestAgent = scoredAgents[0]?.agent;
    if (!bestAgent) {
      task.status = 'queued';
      return undefined;
    }

    // Assign task
    task.assignedTo = bestAgent.id;
    task.status = 'assigned';
    bestAgent.status = 'busy';
    bestAgent.currentTask = task.id;

    // Notify agent via message bus
    await this.messageBus.send({
      type: 'task_assign',
      from: this.state.id.id,
      to: bestAgent.id.id,
      payload: { task },
      priority: this.mapTaskPriorityToMessagePriority(task.priority),
      requiresAck: true,
      ttlMs: this.config.taskTimeoutMs,
    });

    this.emitEvent('task.assigned', {
      taskId: task.id.id,
      agentId: bestAgent.id.id,
    });

    return bestAgent;
  }

  private scoreAgentForTask(agent: AgentState, task: TaskDefinition): number {
    let score = 100;

    // Type matching
    const typeScores: Record<TaskType, AgentType[]> = {
      research: ['researcher'],
      analysis: ['analyst', 'researcher'],
      coding: ['coder'],
      testing: ['tester'],
      review: ['reviewer'],
      documentation: ['documenter'],
      coordination: ['coordinator', 'queen'],
      consensus: ['coordinator', 'queen'],
      custom: ['worker'],
    };

    const preferredTypes = typeScores[task.type] || ['worker'];
    if (preferredTypes.includes(agent.type)) {
      score += 50;
    }

    // Workload adjustment
    score -= agent.workload * 20;

    // Health adjustment
    score *= agent.health;

    // Metrics-based adjustment
    score += agent.metrics.successRate * 10;
    score -= (agent.metrics.averageExecutionTime / 60000) * 5;

    return score;
  }

  private mapTaskPriorityToMessagePriority(
    priority: TaskPriority
  ): Message['priority'] {
    const mapping: Record<TaskPriority, Message['priority']> = {
      critical: 'urgent',
      high: 'high',
      normal: 'normal',
      low: 'low',
      background: 'low',
    };
    return mapping[priority];
  }

  private determineTopologyRole(
    agentType: AgentType
  ): 'queen' | 'worker' | 'coordinator' | 'peer' {
    switch (agentType) {
      case 'queen':
        return 'queen';
      case 'coordinator':
        return 'coordinator';
      default:
        return this.config.topology.type === 'mesh' ? 'peer' : 'worker';
    }
  }

  private handleAgentMessage(agentId: string, message: Message): void {
    const agent = this.state.agents.get(agentId);
    if (!agent) return;

    // Update heartbeat
    agent.lastHeartbeat = new Date();
    agent.metrics.messagesProcessed++;

    switch (message.type) {
      case 'task_complete':
        this.handleTaskComplete(agentId, message.payload as { taskId: string; result: unknown });
        break;
      case 'task_fail':
        this.handleTaskFail(agentId, message.payload as { taskId: string; error: string });
        break;
      case 'heartbeat':
        this.handleHeartbeat(agentId, message.payload as Record<string, unknown>);
        break;
      case 'status_update':
        this.handleStatusUpdate(agentId, message.payload as Partial<AgentState>);
        break;
    }
  }

  private handleTaskComplete(agentId: string, data: { taskId: string; result: unknown }): void {
    const task = this.state.tasks.get(data.taskId);
    const agent = this.state.agents.get(agentId);

    if (task && agent) {
      task.status = 'completed';
      task.output = data.result;
      task.completedAt = new Date();

      agent.status = 'idle';
      agent.currentTask = undefined;
      agent.metrics.tasksCompleted++;

      this.state.metrics.completedTasks++;

      // Update average task duration
      if (task.startedAt) {
        const duration = task.completedAt.getTime() - task.startedAt.getTime();
        this.state.metrics.avgTaskDurationMs =
          (this.state.metrics.avgTaskDurationMs * 0.9) + (duration * 0.1);
      }

      this.emitEvent('task.completed', {
        taskId: data.taskId,
        agentId,
        result: data.result,
      });
    }
  }

  private handleTaskFail(agentId: string, data: { taskId: string; error: string }): void {
    const task = this.state.tasks.get(data.taskId);
    const agent = this.state.agents.get(agentId);

    if (task && agent) {
      // Check retry
      if (task.retries < task.maxRetries) {
        task.retries++;
        task.status = 'queued';
        task.assignedTo = undefined;
        agent.currentTask = undefined;
        agent.status = 'idle';

        // Re-assign
        this.assignTask(task);
      } else {
        task.status = 'failed';
        agent.status = 'idle';
        agent.currentTask = undefined;
        agent.metrics.tasksFailed++;

        this.state.metrics.failedTasks++;

        this.emitEvent('task.failed', {
          taskId: data.taskId,
          agentId,
          error: data.error,
        });
      }
    }
  }

  private handleHeartbeat(agentId: string, data: Record<string, unknown>): void {
    const agent = this.state.agents.get(agentId);
    if (agent) {
      agent.lastHeartbeat = new Date();
      if (data.metrics) {
        agent.metrics = { ...agent.metrics, ...(data.metrics as Partial<typeof agent.metrics>) };
      }

      this.emitEvent('agent.heartbeat', { agentId });
    }
  }

  private handleStatusUpdate(agentId: string, data: Partial<AgentState>): void {
    const agent = this.state.agents.get(agentId);
    if (agent) {
      if (data.status) agent.status = data.status;
      if (data.health !== undefined) agent.health = data.health;
      if (data.workload !== undefined) agent.workload = data.workload;

      this.emitEvent('agent.status_changed', { agentId, status: agent.status });
    }
  }

  private checkHeartbeats(): void {
    const now = Date.now();
    const timeout = this.config.heartbeatIntervalMs * 3;

    for (const [agentId, agent] of this.state.agents) {
      const timeSinceHeartbeat = now - agent.lastHeartbeat.getTime();

      if (timeSinceHeartbeat > timeout && agent.status !== 'terminated') {
        agent.status = 'error';
        agent.health = Math.max(0, agent.health - 0.2);

        // Auto-recovery
        if (this.config.autoRecovery && agent.health <= 0.2) {
          this.recoverAgent(agentId);
        }
      }
    }
  }

  private async recoverAgent(agentId: string): Promise<void> {
    const agent = this.state.agents.get(agentId);
    if (!agent) return;

    // Reassign any tasks
    if (agent.currentTask) {
      const task = this.state.tasks.get(agent.currentTask.id);
      if (task) {
        task.status = 'queued';
        task.assignedTo = undefined;
        await this.assignTask(task);
      }
    }

    // Reset agent
    agent.status = 'idle';
    agent.currentTask = undefined;
    agent.health = 1.0;
    agent.lastHeartbeat = new Date();
  }

  private performHealthChecks(): void {
    const activeAgents = this.getAllAgents().filter(
      a => a.status === 'idle' || a.status === 'busy'
    );

    this.state.metrics.activeAgents = activeAgents.length;

    // Update topology state
    this.state.topology = this.topologyManager.getState();
  }

  private updateMetrics(): void {
    const now = new Date();
    const uptime = this.startTime
      ? (now.getTime() - this.startTime.getTime()) / 1000
      : 0;

    this.state.metrics.uptime = uptime;
    this.state.metrics.messagesPerSecond = this.messageBus.getStats().messagesPerSecond;

    // Calculate coordination latency
    if (this.coordinationLatencies.length > 0) {
      const recent = this.coordinationLatencies.slice(-50);
      this.state.metrics.coordinationLatencyMs =
        recent.reduce((a, b) => a + b, 0) / recent.length;
    }

    // Memory usage (approximation)
    this.state.metrics.memoryUsageBytes =
      (this.state.agents.size * 2000) +
      (this.state.tasks.size * 1000) +
      (this.messageBus.getQueueDepth() * 500);

    this.lastMetricsUpdate = now;
  }

  private recordCoordinationLatency(latencyMs: number): void {
    this.coordinationLatencies.push(latencyMs);
    if (this.coordinationLatencies.length > 1000) {
      this.coordinationLatencies.shift();
    }
  }

  private calculateTaskThroughput(): number {
    if (!this.startTime) return 0;
    const uptimeSeconds = (Date.now() - this.startTime.getTime()) / 1000;
    return uptimeSeconds > 0
      ? this.state.metrics.completedTasks / uptimeSeconds
      : 0;
  }

  private calculateAgentUtilization(): number {
    const agents = this.getAllAgents();
    if (agents.length === 0) return 0;
    const busyAgents = agents.filter(a => a.status === 'busy').length;
    return busyAgents / agents.length;
  }

  private emitEvent(type: SwarmEventType, data: Record<string, unknown>): void {
    const event: SwarmEvent = {
      id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type,
      source: this.state.id.id,
      timestamp: new Date(),
      data,
    };

    this.emit(type, event);
    this.emit('event', event);
  }

  // ===== UTILITY METHODS =====

  getTopology(): TopologyType {
    return this.config.topology.type;
  }

  setTopology(type: TopologyType): void {
    this.config.topology.type = type;
  }

  getConsensusAlgorithm(): string {
    return this.config.consensus.algorithm;
  }

  isHealthy(): boolean {
    return (
      this.state.status === 'running' &&
      this.state.metrics.activeAgents > 0 &&
      this.state.metrics.coordinationLatencyMs < SWARM_CONSTANTS.COORDINATION_LATENCY_TARGET_MS * 2
    );
  }

  getAgentPool(type: AgentType): AgentPool | undefined {
    return this.agentPools.get(type);
  }
}

export function createUnifiedSwarmCoordinator(
  config?: Partial<CoordinatorConfig>
): UnifiedSwarmCoordinator {
  return new UnifiedSwarmCoordinator(config);
}
