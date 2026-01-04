/**
 * V3 Swarm Hub
 * Central coordination hub for the 15-agent hierarchical mesh swarm
 *
 * Based on ADR-001 (agentic-flow integration), ADR-003 (Single Coordination Engine),
 * and the 15-Agent Swarm Architecture
 */

import {
  AgentId,
  AgentRole,
  AgentDomain,
  AgentState,
  TaskId,
  TaskDefinition,
  TaskResult,
  PhaseId,
  PhaseDefinition,
  MilestoneDefinition,
  TopologyType,
  SwarmConfig,
  SwarmState,
  SwarmMetrics,
  SwarmMessage,
  MessageType,
  MessageHandler,
  EventHandler,
  V3_PERFORMANCE_TARGETS
} from '../shared/types';
import {
  IEventBus,
  EventBus,
  swarmInitializedEvent,
  swarmPhaseChangedEvent,
  swarmMilestoneReachedEvent,
  swarmErrorEvent
} from '../shared/events';
import { IAgentRegistry, AgentRegistry, createAgentRegistry } from './agent-registry';
import { ITaskOrchestrator, TaskOrchestrator, TaskSpec, createTaskOrchestrator } from './task-orchestrator';

// =============================================================================
// Swarm Hub Interface
// =============================================================================

export interface ISwarmHub {
  // Lifecycle
  initialize(config?: Partial<SwarmConfig>): Promise<void>;
  shutdown(): Promise<void>;
  isInitialized(): boolean;

  // Agent Management
  spawnAgent(agentId: AgentId): Promise<AgentState>;
  spawnAllAgents(): Promise<Map<AgentId, AgentState>>;
  spawnAgentsByDomain(domain: AgentDomain): Promise<AgentState[]>;
  terminateAgent(agentId: AgentId): Promise<boolean>;

  // Task Management
  submitTask(spec: TaskSpec): TaskDefinition;
  submitBatchTasks(specs: TaskSpec[]): TaskDefinition[];
  assignNextTask(agentId: AgentId): TaskDefinition | undefined;
  completeTask(taskId: TaskId, result: TaskResult): void;

  // Phase Management
  getCurrentPhase(): PhaseId;
  advancePhase(): PhaseId;
  getPhaseDefinition(phaseId: PhaseId): PhaseDefinition;

  // Milestone Tracking
  getMilestones(): MilestoneDefinition[];
  completeMilestone(milestoneId: string): void;

  // Messaging
  sendMessage<T>(message: Omit<SwarmMessage<T>, 'id' | 'timestamp'>): void;
  broadcast<T>(from: AgentId, type: MessageType, payload: T): void;
  onMessage<T>(handler: MessageHandler<T>): () => void;

  // Metrics & Status
  getState(): SwarmState;
  getMetrics(): SwarmMetrics;
  getAgentRegistry(): IAgentRegistry;
  getTaskOrchestrator(): ITaskOrchestrator;

  // Events
  onSwarmEvent(handler: EventHandler): () => void;
}

// =============================================================================
// Swarm Hub Implementation
// =============================================================================

export class SwarmHub implements ISwarmHub {
  private initialized: boolean = false;
  private config: SwarmConfig;
  private eventBus: IEventBus;
  private agentRegistry: IAgentRegistry;
  private taskOrchestrator: ITaskOrchestrator;
  private currentPhase: PhaseId = 'phase-1-foundation';
  private phases: Map<PhaseId, PhaseDefinition>;
  private milestones: Map<string, MilestoneDefinition> = new Map();
  private messageHandlers: Set<MessageHandler> = new Set();
  private messageCounter: number = 0;
  private startTime: number = 0;

  constructor(eventBus?: IEventBus) {
    this.eventBus = eventBus ?? new EventBus();
    this.agentRegistry = createAgentRegistry(this.eventBus);
    this.taskOrchestrator = createTaskOrchestrator(this.eventBus, this.agentRegistry);
    this.phases = this.createPhaseDefinitions();
    this.config = this.getDefaultConfig();
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async initialize(config?: Partial<SwarmConfig>): Promise<void> {
    if (this.initialized) {
      throw new Error('SwarmHub is already initialized');
    }

    this.config = { ...this.config, ...config };
    this.startTime = Date.now();

    this.initializeMilestones();

    (this.agentRegistry as AgentRegistry).startHealthChecks();

    this.initialized = true;

    await this.eventBus.emit(swarmInitializedEvent({
      topology: this.config.topology,
      maxAgents: this.config.maxAgents,
      performanceTargets: V3_PERFORMANCE_TARGETS
    }));

    console.log(`[SwarmHub] Initialized with ${this.config.topology} topology`);
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    (this.agentRegistry as AgentRegistry).stopHealthChecks();

    const activeAgents = this.agentRegistry.getActiveAgents();
    for (const agent of activeAgents) {
      try {
        await this.terminateAgent(agent.id);
      } catch (err) {
        console.error(`[SwarmHub] Error terminating agent ${agent.id}: ${err}`);
      }
    }

    this.initialized = false;
    console.log('[SwarmHub] Shutdown complete');
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // ==========================================================================
  // Agent Management
  // ==========================================================================

  async spawnAgent(agentId: AgentId): Promise<AgentState> {
    this.ensureInitialized();
    return this.agentRegistry.spawn(agentId);
  }

  async spawnAllAgents(): Promise<Map<AgentId, AgentState>> {
    this.ensureInitialized();

    const results = new Map<AgentId, AgentState>();
    const allAgents = this.agentRegistry.getAllAgents();

    const sortedAgents = allAgents.sort((a, b) => a.priority - b.priority);

    for (const agent of sortedAgents) {
      try {
        const state = await this.spawnAgent(agent.id);
        results.set(agent.id, state);
      } catch (err) {
        console.error(`[SwarmHub] Failed to spawn agent ${agent.id}: ${err}`);
      }
    }

    return results;
  }

  async spawnAgentsByDomain(domain: AgentDomain): Promise<AgentState[]> {
    this.ensureInitialized();

    const domainAgents = this.agentRegistry.getAgentsByDomain(domain);
    const results: AgentState[] = [];

    for (const agent of domainAgents) {
      try {
        const state = await this.spawnAgent(agent.id);
        results.push(state);
      } catch (err) {
        console.error(`[SwarmHub] Failed to spawn agent ${agent.id}: ${err}`);
      }
    }

    return results;
  }

  async terminateAgent(agentId: AgentId): Promise<boolean> {
    this.ensureInitialized();
    return this.agentRegistry.terminate(agentId);
  }

  // ==========================================================================
  // Task Management
  // ==========================================================================

  submitTask(spec: TaskSpec): TaskDefinition {
    this.ensureInitialized();
    return this.taskOrchestrator.createTask(spec);
  }

  submitBatchTasks(specs: TaskSpec[]): TaskDefinition[] {
    this.ensureInitialized();
    return this.taskOrchestrator.createBatchTasks(specs);
  }

  assignNextTask(agentId: AgentId): TaskDefinition | undefined {
    this.ensureInitialized();

    const nextTask = this.taskOrchestrator.getNextTask(agentId);
    if (nextTask) {
      this.taskOrchestrator.queueTask(nextTask.id);
      this.taskOrchestrator.assignTask(nextTask.id, agentId);
      this.taskOrchestrator.startTask(nextTask.id);
    }

    return nextTask;
  }

  completeTask(taskId: TaskId, result: TaskResult): void {
    this.ensureInitialized();

    if (result.success) {
      this.taskOrchestrator.completeTask(taskId, result);
    } else {
      this.taskOrchestrator.failTask(taskId, result.error ?? new Error('Unknown error'));
    }
  }

  // ==========================================================================
  // Phase Management
  // ==========================================================================

  getCurrentPhase(): PhaseId {
    return this.currentPhase;
  }

  advancePhase(): PhaseId {
    const phaseOrder: PhaseId[] = [
      'phase-1-foundation',
      'phase-2-core',
      'phase-3-integration',
      'phase-4-release'
    ];

    const currentIndex = phaseOrder.indexOf(this.currentPhase);
    if (currentIndex < phaseOrder.length - 1) {
      const previousPhase = this.currentPhase;
      this.currentPhase = phaseOrder[currentIndex + 1];

      this.eventBus.emitSync(swarmPhaseChangedEvent(previousPhase, this.currentPhase));

      console.log(`[SwarmHub] Advanced from ${previousPhase} to ${this.currentPhase}`);
    }

    return this.currentPhase;
  }

  getPhaseDefinition(phaseId: PhaseId): PhaseDefinition {
    const phase = this.phases.get(phaseId);
    if (!phase) {
      throw new Error(`Phase ${phaseId} not found`);
    }
    return phase;
  }

  // ==========================================================================
  // Milestone Tracking
  // ==========================================================================

  getMilestones(): MilestoneDefinition[] {
    return Array.from(this.milestones.values());
  }

  completeMilestone(milestoneId: string): void {
    const milestone = this.milestones.get(milestoneId);
    if (!milestone) {
      throw new Error(`Milestone ${milestoneId} not found`);
    }

    milestone.status = 'completed';
    milestone.completedAt = Date.now();

    this.eventBus.emitSync(swarmMilestoneReachedEvent(milestoneId, milestone.name));

    console.log(`[SwarmHub] Milestone completed: ${milestone.name}`);
  }

  // ==========================================================================
  // Messaging
  // ==========================================================================

  sendMessage<T>(message: Omit<SwarmMessage<T>, 'id' | 'timestamp'>): void {
    const fullMessage: SwarmMessage<T> = {
      ...message,
      id: `msg-${Date.now()}-${++this.messageCounter}`,
      timestamp: Date.now()
    };

    for (const handler of this.messageHandlers) {
      try {
        handler(fullMessage);
      } catch (err) {
        console.error(`[SwarmHub] Message handler error: ${err}`);
      }
    }
  }

  broadcast<T>(from: AgentId, type: MessageType, payload: T): void {
    this.sendMessage({
      type,
      from,
      to: 'broadcast',
      payload,
      correlationId: null
    });
  }

  onMessage<T>(handler: MessageHandler<T>): () => void {
    this.messageHandlers.add(handler as MessageHandler);

    return () => {
      this.messageHandlers.delete(handler as MessageHandler);
    };
  }

  // ==========================================================================
  // Metrics & Status
  // ==========================================================================

  getState(): SwarmState {
    const allAgents = this.agentRegistry.getAllAgents();
    const agents = new Map<AgentId, AgentState>();

    for (const agent of allAgents) {
      const state = this.agentRegistry.getState(agent.id);
      if (state) {
        agents.set(agent.id, state);
      }
    }

    const allTasks = this.taskOrchestrator.getAllTasks();
    const tasks = new Map<TaskId, TaskDefinition>();

    for (const task of allTasks) {
      tasks.set(task.id, task);
    }

    return {
      initialized: this.initialized,
      topology: this.config.topology,
      agents,
      tasks,
      currentPhase: this.currentPhase,
      metrics: this.getMetrics()
    };
  }

  getMetrics(): SwarmMetrics {
    const activeAgents = this.agentRegistry.getActiveAgents();
    const allAgents = this.agentRegistry.getAllAgents();
    const taskMetrics = this.taskOrchestrator.getTaskMetrics();

    const idleAgents = allAgents.filter(a => {
      const state = this.agentRegistry.getState(a.id);
      return state && state.status === 'idle';
    }).length;

    const blockedAgents = allAgents.filter(a => {
      const state = this.agentRegistry.getState(a.id);
      return state && state.status === 'blocked';
    }).length;

    const totalAgentsWithState = activeAgents.length + idleAgents + blockedAgents;

    return {
      totalAgents: allAgents.length,
      activeAgents: activeAgents.length,
      idleAgents,
      blockedAgents,
      totalTasks: taskMetrics.totalTasks,
      completedTasks: taskMetrics.tasksByStatus['completed'],
      failedTasks: taskMetrics.tasksByStatus['failed'],
      pendingTasks: taskMetrics.tasksByStatus['pending'] + taskMetrics.tasksByStatus['queued'],
      averageTaskDuration: taskMetrics.averageExecutionTime,
      utilization: totalAgentsWithState > 0 ? activeAgents.length / totalAgentsWithState : 0,
      startTime: this.startTime,
      lastUpdate: Date.now()
    };
  }

  getAgentRegistry(): IAgentRegistry {
    return this.agentRegistry;
  }

  getTaskOrchestrator(): ITaskOrchestrator {
    return this.taskOrchestrator;
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  onSwarmEvent(handler: EventHandler): () => void {
    const unsubscribers = [
      this.eventBus.subscribe('swarm:initialized', handler),
      this.eventBus.subscribe('swarm:phase-changed', handler),
      this.eventBus.subscribe('swarm:milestone-reached', handler),
      this.eventBus.subscribe('swarm:error', handler)
    ];

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('SwarmHub is not initialized. Call initialize() first.');
    }
  }

  private getDefaultConfig(): SwarmConfig {
    return {
      topology: 'hierarchical-mesh',
      maxAgents: 15,
      messageTimeout: 30000,
      retryAttempts: 3,
      healthCheckInterval: 5000,
      loadBalancingStrategy: 'capability-match'
    };
  }

  private createPhaseDefinitions(): Map<PhaseId, PhaseDefinition> {
    const phases = new Map<PhaseId, PhaseDefinition>();

    phases.set('phase-1-foundation', {
      id: 'phase-1-foundation',
      name: 'Foundation',
      description: 'Security architecture, core design, and infrastructure setup',
      weeks: [1, 2],
      activeAgents: ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5', 'agent-6'],
      goals: [
        'Initialize swarm coordination',
        'Complete security architecture review',
        'Begin CVE fixes (CVE-1, CVE-2, CVE-3)',
        'Design core DDD architecture',
        'Modernize type system'
      ],
      milestones: []
    });

    phases.set('phase-2-core', {
      id: 'phase-2-core',
      name: 'Core Systems',
      description: 'Core implementation, memory unification, and swarm coordination',
      weeks: [3, 6],
      activeAgents: ['agent-1', 'agent-5', 'agent-6', 'agent-7', 'agent-8', 'agent-9', 'agent-13'],
      goals: [
        'Complete core module implementation',
        'Unify memory system with AgentDB (150x improvement)',
        'Merge 4 coordination systems into single SwarmCoordinator',
        'Optimize MCP server',
        'Implement TDD London School tests'
      ],
      milestones: []
    });

    phases.set('phase-3-integration', {
      id: 'phase-3-integration',
      name: 'Integration',
      description: 'agentic-flow integration, CLI modernization, and neural features',
      weeks: [7, 10],
      activeAgents: ['agent-1', 'agent-10', 'agent-11', 'agent-12', 'agent-13', 'agent-14'],
      goals: [
        'Complete agentic-flow@alpha integration',
        'Modernize CLI and hooks system',
        'Integrate Neural/SONA learning',
        'Run integration tests',
        'Initial performance benchmarks'
      ],
      milestones: []
    });

    phases.set('phase-4-release', {
      id: 'phase-4-release',
      name: 'Optimization & Release',
      description: 'Performance optimization, deployment, and v3.0.0 release',
      weeks: [11, 14],
      activeAgents: [
        'agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5', 'agent-6',
        'agent-7', 'agent-8', 'agent-9', 'agent-10', 'agent-11', 'agent-12',
        'agent-13', 'agent-14', 'agent-15'
      ],
      goals: [
        'Achieve 2.49x-7.47x Flash Attention speedup',
        'Verify 150x-12,500x AgentDB search improvement',
        'Complete deployment pipeline',
        'Final test coverage push (>90%)',
        'Release v3.0.0'
      ],
      milestones: []
    });

    return phases;
  }

  private initializeMilestones(): void {
    const allMilestones: MilestoneDefinition[] = [
      {
        id: 'ms-security-architecture',
        name: 'Security Architecture Complete',
        description: 'All security reviews and CVE fixes implemented',
        criteria: [
          { description: 'CVE-1 fixed', met: false, evidence: null },
          { description: 'CVE-2 fixed', met: false, evidence: null },
          { description: 'CVE-3 fixed', met: false, evidence: null },
          { description: 'Security tests passing', met: false, evidence: null }
        ],
        status: 'pending',
        completedAt: null
      },
      {
        id: 'ms-core-architecture',
        name: 'Core Architecture Complete',
        description: 'DDD structure implemented with all core modules',
        criteria: [
          { description: 'DDD bounded contexts defined', met: false, evidence: null },
          { description: 'Core modules implemented', met: false, evidence: null },
          { description: 'Type system modernized', met: false, evidence: null }
        ],
        status: 'pending',
        completedAt: null
      },
      {
        id: 'ms-memory-unification',
        name: 'Memory Unification Complete',
        description: 'Single memory service with AgentDB backend achieving 150x improvement',
        criteria: [
          { description: 'AgentDB integrated', met: false, evidence: null },
          { description: '150x search improvement verified', met: false, evidence: null },
          { description: 'Hybrid backend working', met: false, evidence: null }
        ],
        status: 'pending',
        completedAt: null
      },
      {
        id: 'ms-swarm-coordination',
        name: 'Swarm Coordination Unified',
        description: 'Single SwarmCoordinator merging 4 systems',
        criteria: [
          { description: 'Single CoordinationEngine', met: false, evidence: null },
          { description: 'Pluggable strategies', met: false, evidence: null },
          { description: '50% code reduction', met: false, evidence: null }
        ],
        status: 'pending',
        completedAt: null
      },
      {
        id: 'ms-agentic-integration',
        name: 'agentic-flow Integration Complete',
        description: 'Deep integration with agentic-flow@alpha eliminating duplicate code',
        criteria: [
          { description: 'Agent class extends agentic-flow', met: false, evidence: null },
          { description: 'Swarm uses agentic-flow system', met: false, evidence: null },
          { description: '<5,000 lines of orchestration code', met: false, evidence: null }
        ],
        status: 'pending',
        completedAt: null
      },
      {
        id: 'ms-performance-targets',
        name: 'Performance Targets Met',
        description: 'All performance targets achieved and verified',
        criteria: [
          { description: '2.49x-7.47x Flash Attention speedup', met: false, evidence: null },
          { description: '150x-12,500x AgentDB search', met: false, evidence: null },
          { description: '50-75% memory reduction', met: false, evidence: null },
          { description: '<500ms startup time', met: false, evidence: null }
        ],
        status: 'pending',
        completedAt: null
      },
      {
        id: 'ms-v3-release',
        name: 'V3.0.0 Released',
        description: 'Claude-Flow v3.0.0 published to npm',
        criteria: [
          { description: 'All tests passing (>90% coverage)', met: false, evidence: null },
          { description: 'Documentation complete', met: false, evidence: null },
          { description: 'npm package published', met: false, evidence: null },
          { description: 'GitHub release created', met: false, evidence: null }
        ],
        status: 'pending',
        completedAt: null
      }
    ];

    for (const milestone of allMilestones) {
      this.milestones.set(milestone.id, milestone);
    }

    for (const [phaseId, phase] of this.phases) {
      switch (phaseId) {
        case 'phase-1-foundation':
          phase.milestones = [
            this.milestones.get('ms-security-architecture')!,
            this.milestones.get('ms-core-architecture')!
          ];
          break;
        case 'phase-2-core':
          phase.milestones = [
            this.milestones.get('ms-memory-unification')!,
            this.milestones.get('ms-swarm-coordination')!
          ];
          break;
        case 'phase-3-integration':
          phase.milestones = [
            this.milestones.get('ms-agentic-integration')!
          ];
          break;
        case 'phase-4-release':
          phase.milestones = [
            this.milestones.get('ms-performance-targets')!,
            this.milestones.get('ms-v3-release')!
          ];
          break;
      }
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createSwarmHub(eventBus?: IEventBus): ISwarmHub {
  return new SwarmHub(eventBus);
}

let globalSwarmHub: ISwarmHub | null = null;

export function getSwarmHub(): ISwarmHub {
  if (!globalSwarmHub) {
    globalSwarmHub = createSwarmHub();
  }
  return globalSwarmHub;
}

export function resetSwarmHub(): void {
  if (globalSwarmHub?.isInitialized()) {
    globalSwarmHub.shutdown();
  }
  globalSwarmHub = null;
}
