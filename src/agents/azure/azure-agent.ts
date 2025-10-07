/**
 * Azure Agent - Native integration with Microsoft Azure MCP Server
 * Provides unified interface for Azure cloud operations through MCP
 *
 * @module azure-agent
 * @version 1.0.0
 */

import { EventEmitter } from 'node:events';
import type { ILogger } from '../../core/logger.js';
import type { IEventBus } from '../../core/event-bus.js';
import type { DistributedMemorySystem } from '../../memory/distributed-memory.js';
import type {
  AgentId,
  AgentState,
  AgentCapabilities,
  AgentConfig,
  AgentEnvironment,
  AgentMetrics,
} from '../../swarm/types.js';
import { MCPError } from '../../utils/errors.js';
import { generateId } from '../../utils/helpers.js';

// ===== AZURE MCP TYPES =====

export interface AzureCredentials {
  subscriptionId?: string;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  resourceGroup?: string;
}

export interface AzureAgentConfig extends AgentConfig {
  credentials: AzureCredentials;
  defaultSubscription?: string;
  defaultResourceGroup?: string;
  retryPolicy?: {
    maxRetries: number;
    retryDelay: number;
    backoffMultiplier: number;
  };
  networkTimeout?: number;
}

export interface AzureToolOptions {
  subscription?: string;
  resourceGroup?: string;
  tenantId?: string;
  authMethod?: string;
  timeout?: number;
  retryConfig?: {
    maxRetries?: number;
    retryDelay?: number;
  };
}

export interface AzureDeploymentOptions extends AzureToolOptions {
  templateFile?: string;
  parametersFile?: string;
  location?: string;
  mode?: 'Incremental' | 'Complete';
}

export interface AzureKeyVaultOptions extends AzureToolOptions {
  vaultName: string;
  secretName?: string;
  keyName?: string;
  certificateName?: string;
}

export interface AzureMonitorQuery extends AzureToolOptions {
  query: string;
  timeRange?: string;
  workspace?: string;
}

export interface AzureRBACOptions extends AzureToolOptions {
  principalId?: string;
  roleDefinitionId?: string;
  scope?: string;
}

export interface AzureQuotaOptions extends AzureToolOptions {
  location?: string;
  provider?: string;
}

// ===== AZURE MCP TOOL CATEGORIES =====

export interface AzureToolResult<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata: {
    timestamp: Date;
    executionTime: number;
    subscription?: string;
    resourceGroup?: string;
  };
}

/**
 * Azure Agent - Comprehensive Azure cloud operations agent
 */
export class AzureAgent extends EventEmitter {
  private logger: ILogger;
  private eventBus: IEventBus;
  private memory: DistributedMemorySystem;
  private config: AzureAgentConfig;
  private agentState: AgentState;
  private mcpClient: any; // MCP client instance (to be injected)
  private operationHistory: Map<string, AzureToolResult> = new Map();

  constructor(
    config: Partial<AzureAgentConfig>,
    logger: ILogger,
    eventBus: IEventBus,
    memory: DistributedMemorySystem,
    mcpClient?: any,
  ) {
    super();
    this.logger = logger;
    this.eventBus = eventBus;
    this.memory = memory;
    this.mcpClient = mcpClient;

    // Initialize configuration with defaults
    this.config = {
      autonomyLevel: 0.7,
      learningEnabled: true,
      adaptationEnabled: true,
      maxTasksPerHour: 50,
      maxConcurrentTasks: 10,
      timeoutThreshold: 300000, // 5 minutes
      reportingInterval: 30000,
      heartbeatInterval: 15000,
      permissions: ['azure:read', 'azure:write', 'azure:deploy', 'azure:monitor'],
      trustedAgents: [],
      expertise: {
        'azure-deployment': 0.95,
        'azure-security': 0.9,
        'azure-monitoring': 0.85,
        'cloud-architecture': 0.9,
      },
      preferences: {
        defaultRegion: 'eastus',
        preferredAuthMethod: 'azure-cli',
      },
      credentials: {
        subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
        tenantId: process.env.AZURE_TENANT_ID,
        clientId: process.env.AZURE_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
      },
      retryPolicy: {
        maxRetries: 3,
        retryDelay: 1000,
        backoffMultiplier: 2,
      },
      networkTimeout: 30000,
      ...config,
    };

    // Initialize agent state
    this.agentState = this.createInitialState();
    this.setupEventHandlers();
  }

  /**
   * Initialize the Azure agent
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing Azure agent', {
      agentId: this.agentState.id.id,
      subscription: this.config.credentials.subscriptionId,
    });

    try {
      // Validate credentials
      await this.validateCredentials();

      // Test Azure connectivity
      await this.testConnectivity();

      // Load cached data from memory
      await this.loadFromMemory();

      this.agentState.status = 'idle';
      this.emit('agent:initialized', { agentId: this.agentState.id.id });

      this.logger.info('Azure agent initialized successfully', {
        agentId: this.agentState.id.id,
      });
    } catch (error) {
      this.agentState.status = 'error';
      this.logger.error('Failed to initialize Azure agent', { error });
      throw error;
    }
  }

  /**
   * Shutdown the Azure agent
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Azure agent', { agentId: this.agentState.id.id });

    this.agentState.status = 'terminating';

    // Save state to memory
    await this.saveToMemory();

    this.agentState.status = 'terminated';
    this.emit('agent:shutdown', { agentId: this.agentState.id.id });
  }

  // ===== DEPLOYMENT OPERATIONS =====

  /**
   * Deploy Azure resources using ARM template
   */
  async deploy(options: AzureDeploymentOptions): Promise<AzureToolResult> {
    return this.executeAzureTool('azure/deploy', options, async () => {
      if (!this.mcpClient) {
        throw new MCPError('MCP client not available');
      }

      this.logger.info('Deploying Azure resources', options);

      const result = await this.mcpClient.callTool('azure_deploy', {
        subscription: options.subscription || this.config.defaultSubscription,
        resourceGroup: options.resourceGroup || this.config.defaultResourceGroup,
        templateFile: options.templateFile,
        parametersFile: options.parametersFile,
        location: options.location,
        mode: options.mode || 'Incremental',
      });

      return result;
    });
  }

  /**
   * Execute Azure Developer CLI commands
   */
  async azd(command: string, options: AzureToolOptions = {}): Promise<AzureToolResult> {
    return this.executeAzureTool('azure/azd', options, async () => {
      if (!this.mcpClient) {
        throw new MCPError('MCP client not available');
      }

      this.logger.info('Executing Azure Developer CLI command', { command, options });

      const result = await this.mcpClient.callTool('azure_developer_cli', {
        command,
        subscription: options.subscription || this.config.defaultSubscription,
        authMethod: options.authMethod,
      });

      return result;
    });
  }

  // ===== SECURITY & IDENTITY OPERATIONS =====

  /**
   * Manage Azure RBAC (Role-Based Access Control)
   */
  async manageRBAC(
    action: 'list' | 'assign' | 'remove',
    options: AzureRBACOptions,
  ): Promise<AzureToolResult> {
    return this.executeAzureTool('azure/rbac', options, async () => {
      if (!this.mcpClient) {
        throw new MCPError('MCP client not available');
      }

      this.logger.info('Managing Azure RBAC', { action, options });

      const result = await this.mcpClient.callTool('azure_rbac', {
        action,
        tenantId: options.tenantId || this.config.credentials.tenantId,
        subscription: options.subscription || this.config.defaultSubscription,
        principalId: options.principalId,
        roleDefinitionId: options.roleDefinitionId,
        scope: options.scope,
      });

      return result;
    });
  }

  /**
   * Manage Azure Key Vault secrets, keys, and certificates
   */
  async keyVault(
    operation: 'list' | 'get' | 'set' | 'delete',
    type: 'secret' | 'key' | 'certificate',
    options: AzureKeyVaultOptions,
  ): Promise<AzureToolResult> {
    return this.executeAzureTool('azure/keyvault', options, async () => {
      if (!this.mcpClient) {
        throw new MCPError('MCP client not available');
      }

      this.logger.info('Managing Azure Key Vault', { operation, type, options });

      const result = await this.mcpClient.callTool('azure_key_vault', {
        operation,
        type,
        vaultName: options.vaultName,
        subscription: options.subscription || this.config.defaultSubscription,
        resourceGroup: options.resourceGroup || this.config.defaultResourceGroup,
        secretName: options.secretName,
        keyName: options.keyName,
        certificateName: options.certificateName,
        authMethod: options.authMethod,
      });

      return result;
    });
  }

  // ===== MONITORING & OBSERVABILITY OPERATIONS =====

  /**
   * Query Azure Monitor logs and metrics
   */
  async monitor(query: AzureMonitorQuery): Promise<AzureToolResult> {
    return this.executeAzureTool('azure/monitor', query, async () => {
      if (!this.mcpClient) {
        throw new MCPError('MCP client not available');
      }

      this.logger.info('Querying Azure Monitor', query);

      const result = await this.mcpClient.callTool('azure_monitor', {
        query: query.query,
        timeRange: query.timeRange,
        workspace: query.workspace,
        subscription: query.subscription || this.config.defaultSubscription,
        timeout: query.timeout || this.config.networkTimeout,
      });

      return result;
    });
  }

  /**
   * Check Azure resource health
   */
  async checkResourceHealth(
    resourceId: string,
    options: AzureToolOptions = {},
  ): Promise<AzureToolResult> {
    return this.executeAzureTool('azure/resource-health', options, async () => {
      if (!this.mcpClient) {
        throw new MCPError('MCP client not available');
      }

      this.logger.info('Checking Azure resource health', { resourceId, options });

      const result = await this.mcpClient.callTool('azure_resource_health', {
        resourceId,
        subscription: options.subscription || this.config.defaultSubscription,
      });

      return result;
    });
  }

  /**
   * Diagnose application performance with Azure App Lens
   */
  async appLens(
    resourceId: string,
    detector?: string,
    options: AzureToolOptions = {},
  ): Promise<AzureToolResult> {
    return this.executeAzureTool('azure/app-lens', options, async () => {
      if (!this.mcpClient) {
        throw new MCPError('MCP client not available');
      }

      this.logger.info('Running Azure App Lens diagnostics', { resourceId, detector, options });

      const result = await this.mcpClient.callTool('azure_app_lens', {
        resourceId,
        detector,
        subscription: options.subscription || this.config.defaultSubscription,
        resourceGroup: options.resourceGroup || this.config.defaultResourceGroup,
      });

      return result;
    });
  }

  // ===== ADMINISTRATIVE OPERATIONS =====

  /**
   * List Azure subscriptions
   */
  async listSubscriptions(): Promise<AzureToolResult> {
    return this.executeAzureTool('azure/subscriptions', {}, async () => {
      if (!this.mcpClient) {
        throw new MCPError('MCP client not available');
      }

      this.logger.info('Listing Azure subscriptions');

      const result = await this.mcpClient.callTool('azure_subscription', {});

      return result;
    });
  }

  /**
   * List Azure resource groups
   */
  async listResourceGroups(options: AzureToolOptions = {}): Promise<AzureToolResult> {
    return this.executeAzureTool('azure/resource-groups', options, async () => {
      if (!this.mcpClient) {
        throw new MCPError('MCP client not available');
      }

      this.logger.info('Listing Azure resource groups', options);

      const result = await this.mcpClient.callTool('azure_resource_groups', {
        subscription: options.subscription || this.config.defaultSubscription,
      });

      return result;
    });
  }

  /**
   * Manage Azure resource quotas
   */
  async manageQuotas(
    action: 'list' | 'get' | 'request',
    options: AzureQuotaOptions,
  ): Promise<AzureToolResult> {
    return this.executeAzureTool('azure/quotas', options, async () => {
      if (!this.mcpClient) {
        throw new MCPError('MCP client not available');
      }

      this.logger.info('Managing Azure quotas', { action, options });

      const result = await this.mcpClient.callTool('azure_quotas', {
        action,
        subscription: options.subscription || this.config.defaultSubscription,
        location: options.location,
        provider: options.provider,
      });

      return result;
    });
  }

  // ===== DEBUGGING OPERATIONS =====

  /**
   * Run Azure Compliance Quick Review
   */
  async complianceReview(options: AzureToolOptions = {}): Promise<AzureToolResult> {
    return this.executeAzureTool('azure/compliance', options, async () => {
      if (!this.mcpClient) {
        throw new MCPError('MCP client not available');
      }

      this.logger.info('Running Azure compliance review', options);

      const result = await this.mcpClient.callTool('azure_compliance_quick_review', {
        subscription: options.subscription || this.config.defaultSubscription,
        retryConfig: options.retryConfig,
      });

      return result;
    });
  }

  /**
   * Get Azure best practices guidance
   */
  async getBestPractices(
    topic?: 'functions' | 'sdk' | 'deployment',
    options: AzureToolOptions = {},
  ): Promise<AzureToolResult> {
    return this.executeAzureTool('azure/best-practices', options, async () => {
      if (!this.mcpClient) {
        throw new MCPError('MCP client not available');
      }

      this.logger.info('Getting Azure best practices', { topic, options });

      const result = await this.mcpClient.callTool('azure_best_practices', {
        topic,
      });

      return result;
    });
  }

  // ===== UTILITY METHODS =====

  /**
   * Execute Azure tool with error handling and retry logic
   */
  private async executeAzureTool<T>(
    toolName: string,
    options: AzureToolOptions,
    operation: () => Promise<T>,
  ): Promise<AzureToolResult<T>> {
    const startTime = Date.now();
    const operationId = generateId('azure-op');

    this.agentState.status = 'busy';
    this.emit('operation:started', { operationId, toolName, options });

    let lastError: Error | null = null;
    const maxRetries = options.retryConfig?.maxRetries || this.config.retryPolicy?.maxRetries || 3;
    const retryDelay = options.retryConfig?.retryDelay || this.config.retryPolicy?.retryDelay || 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const data = await operation();
        const executionTime = Date.now() - startTime;

        const result: AzureToolResult<T> = {
          success: true,
          data,
          metadata: {
            timestamp: new Date(),
            executionTime,
            subscription: options.subscription || this.config.defaultSubscription,
            resourceGroup: options.resourceGroup || this.config.defaultResourceGroup,
          },
        };

        // Store in operation history
        this.operationHistory.set(operationId, result);

        // Update metrics
        this.updateMetrics(true, executionTime);

        this.agentState.status = 'idle';
        this.emit('operation:completed', { operationId, toolName, result });

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`Azure operation failed (attempt ${attempt + 1}/${maxRetries + 1})`, {
          toolName,
          error: lastError.message,
        });

        if (attempt < maxRetries) {
          const delay = retryDelay * Math.pow(this.config.retryPolicy?.backoffMultiplier || 2, attempt);
          await this.sleep(delay);
        }
      }
    }

    // All retries failed
    const executionTime = Date.now() - startTime;
    const result: AzureToolResult = {
      success: false,
      error: {
        code: 'AZURE_OPERATION_FAILED',
        message: lastError?.message || 'Unknown error',
        details: lastError,
      },
      metadata: {
        timestamp: new Date(),
        executionTime,
        subscription: options.subscription || this.config.defaultSubscription,
        resourceGroup: options.resourceGroup || this.config.defaultResourceGroup,
      },
    };

    // Store in operation history
    this.operationHistory.set(operationId, result);

    // Update metrics
    this.updateMetrics(false, executionTime);

    this.agentState.status = 'idle';
    this.emit('operation:failed', { operationId, toolName, error: lastError });

    return result;
  }

  /**
   * Validate Azure credentials
   */
  private async validateCredentials(): Promise<void> {
    const { subscriptionId, tenantId } = this.config.credentials;

    if (!subscriptionId && !this.config.defaultSubscription) {
      this.logger.warn('No Azure subscription ID configured');
    }

    if (!tenantId) {
      this.logger.warn('No Azure tenant ID configured');
    }

    this.logger.info('Azure credentials validated');
  }

  /**
   * Test Azure connectivity
   */
  private async testConnectivity(): Promise<void> {
    try {
      // Try to list subscriptions as connectivity test
      const result = await this.listSubscriptions();
      if (!result.success) {
        throw new Error('Failed to connect to Azure: ' + result.error?.message);
      }
      this.logger.info('Azure connectivity test successful');
    } catch (error) {
      this.logger.warn('Azure connectivity test failed (continuing anyway)', { error });
    }
  }

  /**
   * Load cached data from memory
   */
  private async loadFromMemory(): Promise<void> {
    try {
      const memoryKey = `azure-agent:${this.agentState.id.id}`;
      const cached = await this.memory.retrieve(memoryKey);

      if (cached && cached.value) {
        this.logger.info('Loaded cached Azure agent data from memory');
      }
    } catch (error) {
      this.logger.warn('Failed to load cached data from memory', { error });
    }
  }

  /**
   * Save state to memory
   */
  private async saveToMemory(): Promise<void> {
    try {
      const memoryKey = `azure-agent:${this.agentState.id.id}`;
      await this.memory.store(
        memoryKey,
        {
          agentState: this.agentState,
          operationHistory: Array.from(this.operationHistory.entries()),
        },
        {
          type: 'agent-state',
          tags: ['azure-agent', 'state-snapshot'],
          partition: 'agents',
        },
      );

      this.logger.info('Saved Azure agent state to memory');
    } catch (error) {
      this.logger.error('Failed to save state to memory', { error });
    }
  }

  /**
   * Update agent metrics
   */
  private updateMetrics(success: boolean, executionTime: number): void {
    const metrics = this.agentState.metrics;

    if (success) {
      metrics.tasksCompleted++;
    } else {
      metrics.tasksFailed++;
    }

    const totalTasks = metrics.tasksCompleted + metrics.tasksFailed;
    metrics.successRate = totalTasks > 0 ? metrics.tasksCompleted / totalTasks : 1.0;
    metrics.averageExecutionTime =
      (metrics.averageExecutionTime * (totalTasks - 1) + executionTime) / totalTasks;
    metrics.lastActivity = new Date();
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.eventBus.on('azure:deploy-requested', async (data: unknown) => {
      const deployData = data as AzureDeploymentOptions;
      await this.deploy(deployData);
    });

    this.eventBus.on('azure:monitor-query', async (data: unknown) => {
      const queryData = data as AzureMonitorQuery;
      await this.monitor(queryData);
    });
  }

  /**
   * Create initial agent state
   */
  private createInitialState(): AgentState {
    const agentId: AgentId = {
      id: generateId('azure-agent'),
      swarmId: 'default',
      type: 'specialist',
      instance: 1,
    };

    const capabilities: AgentCapabilities = {
      codeGeneration: false,
      codeReview: false,
      testing: false,
      documentation: true,
      research: false,
      analysis: true,
      webSearch: false,
      apiIntegration: true,
      fileSystem: true,
      terminalAccess: true,
      languages: [],
      frameworks: ['azure', 'arm-templates', 'bicep'],
      domains: [
        'azure-cloud',
        'devops',
        'infrastructure',
        'security',
        'monitoring',
        'deployment',
      ],
      tools: [
        'azure-cli',
        'azure-devops',
        'azure-monitor',
        'key-vault',
        'rbac',
        'resource-manager',
      ],
      maxConcurrentTasks: this.config.maxConcurrentTasks,
      maxMemoryUsage: 512 * 1024 * 1024,
      maxExecutionTime: this.config.timeoutThreshold,
      reliability: 0.95,
      speed: 0.8,
      quality: 0.9,
    };

    const metrics: AgentMetrics = {
      tasksCompleted: 0,
      tasksFailed: 0,
      averageExecutionTime: 0,
      successRate: 1.0,
      cpuUsage: 0,
      memoryUsage: 0,
      diskUsage: 0,
      networkUsage: 0,
      codeQuality: 0,
      testCoverage: 0,
      bugRate: 0,
      userSatisfaction: 0.85,
      totalUptime: 0,
      lastActivity: new Date(),
      responseTime: 0,
    };

    const environment: AgentEnvironment = {
      runtime: 'node',
      version: process.version,
      workingDirectory: process.cwd(),
      tempDirectory: '/tmp/azure-agent',
      logDirectory: './logs/azure-agent',
      apiEndpoints: {
        azure: 'https://management.azure.com',
      },
      credentials: {},
      availableTools: [
        'azure_deploy',
        'azure_developer_cli',
        'azure_rbac',
        'azure_key_vault',
        'azure_monitor',
        'azure_resource_health',
        'azure_app_lens',
        'azure_subscription',
        'azure_resource_groups',
        'azure_quotas',
        'azure_compliance_quick_review',
        'azure_best_practices',
      ],
      toolConfigs: {},
    };

    return {
      id: agentId,
      name: 'Azure Cloud Operations Agent',
      type: 'specialist',
      status: 'initializing',
      capabilities,
      metrics,
      workload: 0,
      health: 1.0,
      config: this.config,
      environment,
      endpoints: [],
      lastHeartbeat: new Date(),
      taskHistory: [],
      errorHistory: [],
      childAgents: [],
      collaborators: [],
    };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ===== PUBLIC API =====

  /**
   * Get agent state
   */
  getState(): AgentState {
    return { ...this.agentState };
  }

  /**
   * Get agent ID
   */
  getId(): string {
    return this.agentState.id.id;
  }

  /**
   * Get operation history
   */
  getOperationHistory(limit?: number): AzureToolResult[] {
    const history = Array.from(this.operationHistory.values());
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Clear operation history
   */
  clearOperationHistory(): void {
    this.operationHistory.clear();
    this.logger.info('Cleared Azure agent operation history');
  }

  /**
   * Set MCP client
   */
  setMCPClient(client: any): void {
    this.mcpClient = client;
    this.logger.info('MCP client set for Azure agent');
  }

  /**
   * Get agent metrics
   */
  getMetrics(): AgentMetrics {
    return { ...this.agentState.metrics };
  }

  /**
   * Get agent capabilities
   */
  getCapabilities(): AgentCapabilities {
    return { ...this.agentState.capabilities };
  }
}

/**
 * Create and initialize Azure agent
 */
export async function createAzureAgent(
  config: Partial<AzureAgentConfig>,
  logger: ILogger,
  eventBus: IEventBus,
  memory: DistributedMemorySystem,
  mcpClient?: any,
): Promise<AzureAgent> {
  const agent = new AzureAgent(config, logger, eventBus, memory, mcpClient);
  await agent.initialize();
  return agent;
}
