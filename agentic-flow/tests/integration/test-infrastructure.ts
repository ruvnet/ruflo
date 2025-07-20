/**
 * Integration Test Infrastructure
 * Provides utilities for comprehensive integration testing across all Agentic Flow components
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { ProviderManager } from '../../src/providers/manager';
import { WorkflowEngine } from '../../src/workflows/engine/workflow-engine';
import { AutonomousAgent } from '../../src/autonomous/autonomous-agent';
import { TeamCoordinator } from '../../src/coordination/team-coordinator';
import { LLMProvider, ProviderManagerConfig } from '../../src/providers/types';
import { WorkflowPersistence } from '../../src/workflows/persistence/workflow-persistence';

export interface IntegrationTestContext {
  id: string;
  name: string;
  providers: ProviderManager;
  workflowEngine: WorkflowEngine;
  agents: Map<string, AutonomousAgent>;
  coordinator: TeamCoordinator;
  metrics: TestMetrics;
  cleanup: () => Promise<void>;
}

export interface TestMetrics {
  startTime: number;
  requests: number;
  failures: number;
  latencies: number[];
  resourceUsage: {
    memory: number;
    cpu: number;
  };
  customMetrics: Map<string, any>;
}

export interface IntegrationTestConfig {
  name: string;
  providers?: {
    anthropic?: { apiKey: string };
    openai?: { apiKey: string };
    google?: { apiKey: string };
  };
  agents?: {
    count: number;
    types: string[];
  };
  timeout?: number;
  enableRealProviders?: boolean;
  enablePersistence?: boolean;
}

export class IntegrationTestFramework extends EventEmitter {
  private contexts: Map<string, IntegrationTestContext> = new Map();
  private globalMetrics: TestMetrics;

  constructor() {
    super();
    this.globalMetrics = this.initializeMetrics();
  }

  /**
   * Create a complete integration test context with all components
   */
  async createTestContext(config: IntegrationTestConfig): Promise<IntegrationTestContext> {
    const contextId = uuidv4();
    
    // Create provider manager with real or mock providers
    const providerManager = await this.createProviderManager(config);
    
    // Create workflow engine with in-memory persistence for testing
    const workflowEngine = await this.createWorkflowEngine(config);
    
    // Create autonomous agents
    const agents = await this.createTestAgents(config);
    
    // Create team coordinator
    const coordinator = new TeamCoordinator();
    await coordinator.initialize();
    
    // Register agents with coordinator
    for (const [agentId, agent] of agents) {
      await coordinator.registerAgent(agentId, agent);
    }

    const context: IntegrationTestContext = {
      id: contextId,
      name: config.name,
      providers: providerManager,
      workflowEngine,
      agents,
      coordinator,
      metrics: this.initializeMetrics(),
      cleanup: () => this.cleanupContext(contextId)
    };

    this.contexts.set(contextId, context);
    this.emit('context:created', { contextId, name: config.name });

    return context;
  }

  /**
   * Create provider manager with appropriate configuration
   */
  private async createProviderManager(config: IntegrationTestConfig): Promise<ProviderManager> {
    const providerConfig: ProviderManagerConfig = {
      providers: {},
      fallbackStrategy: 'sequential' as any,
      healthCheckInterval: 5000
    };

    // Configure real providers if API keys provided and enabled
    if (config.enableRealProviders && config.providers) {
      if (config.providers.anthropic?.apiKey) {
        providerConfig.providers[LLMProvider.ANTHROPIC] = {
          apiKey: config.providers.anthropic.apiKey
        };
      }
      if (config.providers.openai?.apiKey) {
        providerConfig.providers[LLMProvider.OPENAI] = {
          apiKey: config.providers.openai.apiKey
        };
      }
      if (config.providers.google?.apiKey) {
        providerConfig.providers[LLMProvider.GOOGLE] = {
          apiKey: config.providers.google.apiKey
        };
      }
    } else {
      // Use mock providers for testing
      providerConfig.providers[LLMProvider.ANTHROPIC] = {
        apiKey: 'test-key'
      };
    }

    const manager = new ProviderManager(providerConfig);
    await manager.initialize();
    return manager;
  }

  /**
   * Create workflow engine with test-appropriate configuration
   */
  private async createWorkflowEngine(config: IntegrationTestConfig): Promise<WorkflowEngine> {
    // Create in-memory persistence for testing
    const persistence = new WorkflowPersistence({
      type: 'memory',
      config: {}
    });

    const engine = new WorkflowEngine({
      persistence,
      enableSnapshots: true,
      snapshotInterval: 1000,
      maxConcurrentWorkflows: 10
    });

    return engine;
  }

  /**
   * Create test agents with various capabilities
   */
  private async createTestAgents(config: IntegrationTestConfig): Promise<Map<string, AutonomousAgent>> {
    const agents = new Map<string, AutonomousAgent>();
    const agentCount = config.agents?.count || 3;
    const agentTypes = config.agents?.types || ['researcher', 'coder', 'analyst'];

    for (let i = 0; i < agentCount; i++) {
      const agentType = agentTypes[i % agentTypes.length];
      const agentId = `test-agent-${agentType}-${i}`;
      
      const capabilities = this.getCapabilitiesForType(agentType);
      const agent = new AutonomousAgent(agentId, `Test ${agentType} Agent ${i}`, agentType, capabilities);
      
      agents.set(agentId, agent);
    }

    return agents;
  }

  /**
   * Get capabilities based on agent type
   */
  private getCapabilitiesForType(type: string) {
    const capabilityMap = {
      researcher: [
        {
          name: 'research',
          description: 'Research and analysis capability',
          proficiency: 0.9,
          requirements: ['data_access'],
          examples: ['research', 'analyze', 'investigate']
        }
      ],
      coder: [
        {
          name: 'programming',
          description: 'Code development capability',
          proficiency: 0.9,
          requirements: ['coding_tools'],
          examples: ['code', 'implement', 'debug']
        }
      ],
      analyst: [
        {
          name: 'analysis',
          description: 'Data analysis capability', 
          proficiency: 0.8,
          requirements: ['data_tools'],
          examples: ['analyze', 'evaluate', 'assess']
        }
      ]
    };

    return capabilityMap[type] || capabilityMap.analyst;
  }

  /**
   * Initialize metrics tracking
   */
  private initializeMetrics(): TestMetrics {
    return {
      startTime: Date.now(),
      requests: 0,
      failures: 0,
      latencies: [],
      resourceUsage: {
        memory: 0,
        cpu: 0
      },
      customMetrics: new Map()
    };
  }

  /**
   * Record test metrics
   */
  recordMetric(contextId: string, metricName: string, value: any): void {
    const context = this.contexts.get(contextId);
    if (context) {
      context.metrics.customMetrics.set(metricName, value);
    }
    this.globalMetrics.customMetrics.set(`${contextId}:${metricName}`, value);
  }

  /**
   * Record request timing
   */
  recordRequest(contextId: string, latency: number, success: boolean): void {
    const context = this.contexts.get(contextId);
    if (context) {
      context.metrics.requests++;
      context.metrics.latencies.push(latency);
      if (!success) {
        context.metrics.failures++;
      }
    }

    this.globalMetrics.requests++;
    this.globalMetrics.latencies.push(latency);
    if (!success) {
      this.globalMetrics.failures++;
    }
  }

  /**
   * Get aggregated metrics for a context
   */
  getMetrics(contextId: string): TestMetrics | null {
    const context = this.contexts.get(contextId);
    if (!context) return null;

    // Update resource usage
    const memUsage = process.memoryUsage();
    context.metrics.resourceUsage.memory = memUsage.heapUsed;
    context.metrics.resourceUsage.cpu = process.cpuUsage().user;

    return context.metrics;
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(contextId: string) {
    const metrics = this.getMetrics(contextId);
    if (!metrics || metrics.latencies.length === 0) return null;

    const sorted = [...metrics.latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      requests: metrics.requests,
      failures: metrics.failures,
      successRate: ((metrics.requests - metrics.failures) / metrics.requests) * 100,
      latency: {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: sum / sorted.length,
        median: sorted[Math.floor(sorted.length / 2)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)]
      },
      duration: Date.now() - metrics.startTime,
      resourceUsage: metrics.resourceUsage
    };
  }

  /**
   * Cleanup test context and resources
   */
  private async cleanupContext(contextId: string): Promise<void> {
    const context = this.contexts.get(contextId);
    if (!context) return;

    try {
      // Cleanup agents
      for (const [agentId, agent] of context.agents) {
        await agent.pause();
      }

      // Cleanup coordinator
      await context.coordinator.shutdown();

      // Cleanup providers
      await context.providers.cleanup();

      // Remove from tracking
      this.contexts.delete(contextId);
      
      this.emit('context:cleaned', { contextId });
    } catch (error) {
      this.emit('cleanup:error', { contextId, error });
      throw error;
    }
  }

  /**
   * Cleanup all contexts
   */
  async cleanup(): Promise<void> {
    const cleanupPromises = Array.from(this.contexts.keys()).map(id => 
      this.cleanupContext(id).catch(err => ({ error: err, contextId: id }))
    );
    
    const results = await Promise.allSettled(cleanupPromises);
    
    // Log any cleanup failures
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(`Failed to cleanup context:`, result.reason);
      }
    });
  }
}

/**
 * Utility class for creating complex test scenarios
 */
export class TestScenarioBuilder {
  private scenario: any = {};

  static create(name: string): TestScenarioBuilder {
    const builder = new TestScenarioBuilder();
    builder.scenario.name = name;
    builder.scenario.steps = [];
    return builder;
  }

  withProviders(providers: string[]): TestScenarioBuilder {
    this.scenario.providers = providers;
    return this;
  }

  withAgents(count: number, types: string[]): TestScenarioBuilder {
    this.scenario.agents = { count, types };
    return this;
  }

  addStep(name: string, action: Function): TestScenarioBuilder {
    this.scenario.steps.push({ name, action });
    return this;
  }

  withTimeout(timeout: number): TestScenarioBuilder {
    this.scenario.timeout = timeout;
    return this;
  }

  build() {
    return this.scenario;
  }
}

/**
 * Helper for waiting for events with timeout
 */
export async function waitForEvent(
  emitter: EventEmitter, 
  event: string, 
  timeout: number = 5000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeout);

    emitter.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/**
 * Helper for measuring execution time
 */
export async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  return { result, duration };
}

/**
 * Create test data for complex scenarios
 */
export const TestDataFactory = {
  createWorkflowDefinition: (name: string, complexity: 'simple' | 'medium' | 'complex' = 'simple') => {
    const baseWorkflow = {
      id: uuidv4(),
      name,
      version: '1.0.0',
      description: `Test workflow: ${name}`,
      nodes: [],
      edges: [],
      variables: {},
      triggers: []
    };

    switch (complexity) {
      case 'simple':
        baseWorkflow.nodes = [
          { id: 'start', type: 'start', name: 'Start' },
          { id: 'task1', type: 'agent-task', name: 'Simple Task' },
          { id: 'end', type: 'end', name: 'End' }
        ];
        baseWorkflow.edges = [
          { from: 'start', to: 'task1' },
          { from: 'task1', to: 'end' }
        ];
        break;
      
      case 'medium':
        baseWorkflow.nodes = [
          { id: 'start', type: 'start', name: 'Start' },
          { id: 'research', type: 'agent-task', name: 'Research Task' },
          { id: 'analysis', type: 'agent-task', name: 'Analysis Task' },
          { id: 'decision', type: 'decision', name: 'Decision Point' },
          { id: 'implement', type: 'agent-task', name: 'Implementation' },
          { id: 'review', type: 'agent-task', name: 'Review' },
          { id: 'end', type: 'end', name: 'End' }
        ];
        baseWorkflow.edges = [
          { from: 'start', to: 'research' },
          { from: 'research', to: 'analysis' },
          { from: 'analysis', to: 'decision' },
          { from: 'decision', to: 'implement', condition: 'approved' },
          { from: 'decision', to: 'review', condition: 'needs_review' },
          { from: 'implement', to: 'end' },
          { from: 'review', to: 'end' }
        ];
        break;
      
      case 'complex':
        // Complex workflow with parallel execution, human tasks, etc.
        baseWorkflow.nodes = [
          { id: 'start', type: 'start', name: 'Start' },
          { id: 'parallel_start', type: 'parallel', name: 'Parallel Start' },
          { id: 'task_a', type: 'agent-task', name: 'Task A' },
          { id: 'task_b', type: 'agent-task', name: 'Task B' },
          { id: 'task_c', type: 'agent-task', name: 'Task C' },
          { id: 'parallel_join', type: 'join', name: 'Parallel Join' },
          { id: 'human_task', type: 'human-task', name: 'Human Review' },
          { id: 'final_task', type: 'agent-task', name: 'Final Task' },
          { id: 'end', type: 'end', name: 'End' }
        ];
        baseWorkflow.edges = [
          { from: 'start', to: 'parallel_start' },
          { from: 'parallel_start', to: 'task_a' },
          { from: 'parallel_start', to: 'task_b' },
          { from: 'parallel_start', to: 'task_c' },
          { from: 'task_a', to: 'parallel_join' },
          { from: 'task_b', to: 'parallel_join' },
          { from: 'task_c', to: 'parallel_join' },
          { from: 'parallel_join', to: 'human_task' },
          { from: 'human_task', to: 'final_task' },
          { from: 'final_task', to: 'end' }
        ];
        break;
    }

    return baseWorkflow;
  },

  createGoal: (description: string, priority: number = 5) => ({
    id: uuidv4(),
    description,
    priority,
    status: 'pending',
    subGoals: [],
    requirements: [],
    context: {}
  }),

  createTestMessage: (role: 'user' | 'assistant' = 'user', content: string = 'Test message') => ({
    role,
    content
  })
};