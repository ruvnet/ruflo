/**
 * Enhanced Agent Spawner with Auto-Creation
 * Integrates with the EnhancedAgentManager for automatic agent type creation
 */

import { EnhancedAgentManager } from '../agents/enhanced-agent-manager.js';
import type { AgentType, AgentConfig, AgentEnvironment } from './types.js';
import type { ILogger } from '../core/logger.js';
import type { IEventBus } from '../core/event-bus.js';
import type { DistributedMemorySystem } from '../memory/distributed-memory.js';
import { getErrorMessage } from '../utils/error-handler.js';

export interface AgentSpawnOptions {
  type: string; // Can be any string now, not just predefined AgentType
  name?: string;
  config?: Partial<AgentConfig>;
  environment?: Partial<AgentEnvironment>;
  autoCreate?: boolean; // Whether to auto-create if type doesn't exist
}

export class EnhancedAgentSpawner {
  private agentManager: EnhancedAgentManager;
  private logger: ILogger;
  private spawnHistory: Map<string, { type: string; created: Date; autoCreated: boolean }>;

  constructor(
    agentManager: EnhancedAgentManager,
    logger: ILogger
  ) {
    this.agentManager = agentManager;
    this.logger = logger;
    this.spawnHistory = new Map();
  }

  /**
   * Spawn an agent with automatic type creation if needed
   */
  async spawnAgent(options: AgentSpawnOptions): Promise<string> {
    const { type, name, config, environment, autoCreate = true } = options;

    this.logger.info('[EnhancedAgentSpawner] Spawning agent', {
      type,
      name,
      autoCreate
    });

    try {
      // Enable or disable auto-creation based on the option
      const currentAutoCreation = this.agentManager.getAutoCreationStats().enabled;
      if (autoCreate !== currentAutoCreation) {
        this.agentManager.setAutoCreation(autoCreate);
      }

      // Attempt to create the agent
      const agentId = await this.agentManager.createAgent(type, {
        name,
        config,
        environment
      });

      // Check if this was auto-created
      const stats = this.agentManager.getAutoCreationStats();
      const wasAutoCreated = stats.createdTemplates > 0;

      // Record spawn history
      this.spawnHistory.set(agentId, {
        type,
        created: new Date(),
        autoCreated: wasAutoCreated
      });

      // Start the agent
      await this.agentManager.startAgent(agentId);

      this.logger.info('[EnhancedAgentSpawner] Agent spawned successfully', {
        agentId,
        type,
        name: name || `${type}-${agentId.slice(-8)}`,
        autoCreated: wasAutoCreated
      });

      return agentId;

    } catch (error) {
      this.logger.error('[EnhancedAgentSpawner] Failed to spawn agent', {
        type,
        error: getErrorMessage(error)
      });
      throw error;
    } finally {
      // Restore original auto-creation setting if changed
      if (autoCreate !== currentAutoCreation) {
        this.agentManager.setAutoCreation(currentAutoCreation);
      }
    }
  }

  /**
   * Spawn multiple agents in parallel
   */
  async spawnMultipleAgents(agents: AgentSpawnOptions[]): Promise<string[]> {
    this.logger.info('[EnhancedAgentSpawner] Spawning multiple agents', {
      count: agents.length,
      types: agents.map(a => a.type)
    });

    const spawnPromises = agents.map(options => this.spawnAgent(options));
    const results = await Promise.allSettled(spawnPromises);

    const successfulAgents: string[] = [];
    const failedAgents: { type: string; error: string }[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successfulAgents.push(result.value);
      } else {
        failedAgents.push({
          type: agents[index].type,
          error: getErrorMessage(result.reason)
        });
      }
    });

    if (failedAgents.length > 0) {
      this.logger.warn('[EnhancedAgentSpawner] Some agents failed to spawn', {
        successful: successfulAgents.length,
        failed: failedAgents
      });
    }

    return successfulAgents;
  }

  /**
   * Create a specialized agent with custom capabilities
   */
  async spawnSpecializedAgent(
    type: string,
    specialization: {
      domains: string[];
      expertise: Record<string, number>;
      tools?: string[];
      languages?: string[];
      frameworks?: string[];
    },
    options: Omit<AgentSpawnOptions, 'type'> = {}
  ): Promise<string> {
    const config: Partial<AgentConfig> = {
      ...options.config,
      expertise: specialization.expertise
    };

    // Create a custom template handler for this specialized type
    this.agentManager.addCustomTemplateHandler(type, async () => {
      return {
        name: options.name || `${type.replace(/_/g, ' ')} Specialist`,
        type: type as AgentType,
        capabilities: {
          codeGeneration: specialization.languages && specialization.languages.length > 0,
          codeReview: false,
          testing: false,
          documentation: true,
          research: specialization.domains.includes('research'),
          analysis: specialization.domains.includes('analysis'),
          webSearch: specialization.domains.includes('research'),
          apiIntegration: false,
          fileSystem: true,
          terminalAccess: false,
          languages: specialization.languages || [],
          frameworks: specialization.frameworks || [],
          domains: specialization.domains,
          tools: specialization.tools || [],
          maxConcurrentTasks: 3,
          maxMemoryUsage: 512 * 1024 * 1024,
          maxExecutionTime: 600000,
          reliability: 0.85,
          speed: 0.75,
          quality: 0.9
        },
        config: {
          autonomyLevel: 0.8,
          learningEnabled: true,
          adaptationEnabled: true,
          maxTasksPerHour: 15,
          maxConcurrentTasks: 3,
          timeoutThreshold: 600000,
          reportingInterval: 30000,
          heartbeatInterval: 10000,
          permissions: ['file-read', 'file-write'],
          trustedAgents: [],
          expertise: specialization.expertise,
          preferences: {}
        },
        environment: {
          runtime: 'deno',
          version: '1.40.0',
          workingDirectory: `./agents/${type}`,
          tempDirectory: `./tmp/${type}`,
          logDirectory: `./logs/${type}`,
          apiEndpoints: {},
          credentials: {},
          availableTools: specialization.tools || [],
          toolConfigs: {}
        },
        startupScript: `./scripts/start-${type}.ts`
      };
    });

    try {
      return await this.spawnAgent({
        type,
        config,
        ...options
      });
    } finally {
      // Remove the custom handler after use
      this.agentManager.removeCustomTemplateHandler(type);
    }
  }

  /**
   * Get spawn history
   */
  getSpawnHistory(): Array<{ agentId: string; type: string; created: Date; autoCreated: boolean }> {
    return Array.from(this.spawnHistory.entries()).map(([agentId, data]) => ({
      agentId,
      ...data
    }));
  }

  /**
   * Get auto-created agent types
   */
  getAutoCreatedTypes(): string[] {
    const history = this.getSpawnHistory();
    const autoCreatedTypes = new Set<string>();
    
    history.forEach(entry => {
      if (entry.autoCreated) {
        autoCreatedTypes.add(entry.type);
      }
    });

    return Array.from(autoCreatedTypes);
  }
}

/**
 * Create an enhanced agent spawner with auto-creation capabilities
 */
export function createEnhancedAgentSpawner(
  logger: ILogger,
  eventBus: IEventBus,
  memory: DistributedMemorySystem,
  config?: {
    maxAgents?: number;
    enableAutoCreation?: boolean;
  }
): { agentManager: EnhancedAgentManager; spawner: EnhancedAgentSpawner } {
  const agentManager = new EnhancedAgentManager({
    maxAgents: config?.maxAgents || 50,
    enableAutoCreation: config?.enableAutoCreation ?? true,
    autoCreation: {
      inferFromName: true,
      autoRegister: true
    }
  }, logger, eventBus, memory);

  const spawner = new EnhancedAgentSpawner(agentManager, logger);

  return { agentManager, spawner };
}