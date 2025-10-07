/**
 * Azure Agent Factory - Simplified agent creation and configuration
 * @module azure-agent-factory
 */

import { AzureAgent, createAzureAgent, type AzureAgentConfig } from './azure-agent.js';
import { AzureAgentWrapper } from './azure-agent-wrapper.js';
import type { ILogger } from '../../core/logger.js';
import type { IEventBus } from '../../core/event-bus.js';
import type { DistributedMemorySystem } from '../../memory/distributed-memory.js';

export interface AzureAgentFactoryOptions {
  subscriptionId?: string;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  resourceGroup?: string;
  region?: string;
  retryPolicy?: {
    maxRetries: number;
    retryDelay: number;
    backoffMultiplier: number;
  };
  mcpClient?: any;
}

/**
 * Factory for creating and configuring Azure agents
 */
export class AzureAgentFactory {
  private logger: ILogger;
  private eventBus: IEventBus;
  private memory: DistributedMemorySystem;
  private defaultOptions: Partial<AzureAgentFactoryOptions>;

  constructor(
    logger: ILogger,
    eventBus: IEventBus,
    memory: DistributedMemorySystem,
    defaultOptions: Partial<AzureAgentFactoryOptions> = {},
  ) {
    this.logger = logger;
    this.eventBus = eventBus;
    this.memory = memory;
    this.defaultOptions = defaultOptions;
  }

  /**
   * Create a standard Azure agent
   */
  async createAgent(options: Partial<AzureAgentFactoryOptions> = {}): Promise<AzureAgent> {
    const mergedOptions = { ...this.defaultOptions, ...options };

    const config: Partial<AzureAgentConfig> = {
      credentials: {
        subscriptionId: mergedOptions.subscriptionId,
        tenantId: mergedOptions.tenantId,
        clientId: mergedOptions.clientId,
        clientSecret: mergedOptions.clientSecret,
        resourceGroup: mergedOptions.resourceGroup,
      },
      defaultSubscription: mergedOptions.subscriptionId,
      defaultResourceGroup: mergedOptions.resourceGroup,
      retryPolicy: mergedOptions.retryPolicy,
      preferences: {
        defaultRegion: mergedOptions.region || 'eastus',
      },
    };

    const agent = await createAzureAgent(
      config,
      this.logger,
      this.eventBus,
      this.memory,
      mergedOptions.mcpClient,
    );

    this.logger.info('Azure agent created', { agentId: agent.getId() });

    return agent;
  }

  /**
   * Create an Azure agent with wrapper
   */
  async createAgentWithWrapper(
    options: Partial<AzureAgentFactoryOptions> = {},
  ): Promise<AzureAgentWrapper> {
    const agent = await this.createAgent(options);
    return new AzureAgentWrapper(agent, this.logger);
  }

  /**
   * Create a deployment-focused agent
   */
  async createDeploymentAgent(
    subscriptionId: string,
    resourceGroup: string,
    options: Partial<AzureAgentFactoryOptions> = {},
  ): Promise<AzureAgent> {
    const config: Partial<AzureAgentConfig> = {
      credentials: {
        subscriptionId,
        resourceGroup,
        tenantId: options.tenantId,
      },
      defaultSubscription: subscriptionId,
      defaultResourceGroup: resourceGroup,
      expertise: {
        'azure-deployment': 0.98,
        'infrastructure-as-code': 0.95,
        'arm-templates': 0.95,
      },
      permissions: [
        'azure:read',
        'azure:write',
        'azure:deploy',
        'azure:resource-manager',
      ],
      ...options,
    };

    const agent = await createAzureAgent(
      config,
      this.logger,
      this.eventBus,
      this.memory,
      options.mcpClient,
    );

    this.logger.info('Deployment-focused Azure agent created', { agentId: agent.getId() });

    return agent;
  }

  /**
   * Create a monitoring-focused agent
   */
  async createMonitoringAgent(
    subscriptionId: string,
    options: Partial<AzureAgentFactoryOptions> = {},
  ): Promise<AzureAgent> {
    const config: Partial<AzureAgentConfig> = {
      credentials: {
        subscriptionId,
        tenantId: options.tenantId,
      },
      defaultSubscription: subscriptionId,
      expertise: {
        'azure-monitoring': 0.98,
        'azure-logs': 0.95,
        'azure-metrics': 0.95,
        observability: 0.9,
      },
      permissions: ['azure:read', 'azure:monitor', 'azure:logs'],
      ...options,
    };

    const agent = await createAzureAgent(
      config,
      this.logger,
      this.eventBus,
      this.memory,
      options.mcpClient,
    );

    this.logger.info('Monitoring-focused Azure agent created', { agentId: agent.getId() });

    return agent;
  }

  /**
   * Create a security-focused agent
   */
  async createSecurityAgent(
    subscriptionId: string,
    tenantId: string,
    options: Partial<AzureAgentFactoryOptions> = {},
  ): Promise<AzureAgent> {
    const config: Partial<AzureAgentConfig> = {
      credentials: {
        subscriptionId,
        tenantId,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
      },
      defaultSubscription: subscriptionId,
      expertise: {
        'azure-security': 0.98,
        'azure-rbac': 0.95,
        'key-vault': 0.95,
        'identity-management': 0.9,
        compliance: 0.9,
      },
      permissions: [
        'azure:read',
        'azure:security',
        'azure:rbac',
        'azure:key-vault',
        'azure:compliance',
      ],
      ...options,
    };

    const agent = await createAzureAgent(
      config,
      this.logger,
      this.eventBus,
      this.memory,
      options.mcpClient,
    );

    this.logger.info('Security-focused Azure agent created', { agentId: agent.getId() });

    return agent;
  }

  /**
   * Create an agent from environment variables
   */
  async createFromEnvironment(
    options: Partial<AzureAgentFactoryOptions> = {},
  ): Promise<AzureAgent> {
    const envOptions: Partial<AzureAgentFactoryOptions> = {
      subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
      tenantId: process.env.AZURE_TENANT_ID,
      clientId: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
      resourceGroup: process.env.AZURE_RESOURCE_GROUP,
      region: process.env.AZURE_REGION || 'eastus',
      ...options,
    };

    return this.createAgent(envOptions);
  }

  /**
   * Set default MCP client for all agents
   */
  setDefaultMCPClient(mcpClient: any): void {
    this.defaultOptions.mcpClient = mcpClient;
    this.logger.info('Default MCP client set for Azure agent factory');
  }

  /**
   * Update default options
   */
  setDefaultOptions(options: Partial<AzureAgentFactoryOptions>): void {
    this.defaultOptions = { ...this.defaultOptions, ...options };
    this.logger.info('Default Azure agent factory options updated');
  }

  /**
   * Get current default options
   */
  getDefaultOptions(): Partial<AzureAgentFactoryOptions> {
    return { ...this.defaultOptions };
  }
}

/**
 * Create a singleton factory instance
 */
export function createAzureAgentFactory(
  logger: ILogger,
  eventBus: IEventBus,
  memory: DistributedMemorySystem,
  defaultOptions?: Partial<AzureAgentFactoryOptions>,
): AzureAgentFactory {
  return new AzureAgentFactory(logger, eventBus, memory, defaultOptions);
}
