/**
 * Azure Agent Tests
 * Comprehensive test suite for Azure MCP integration
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AzureAgent, createAzureAgent, type AzureAgentConfig } from '../../src/agents/azure/azure-agent.js';
import { AzureAgentWrapper } from '../../src/agents/azure/azure-agent-wrapper.js';
import { AzureAgentFactory } from '../../src/agents/azure/azure-agent-factory.js';

// Mock dependencies
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockEventBus = {
  on: jest.fn(),
  emit: jest.fn(),
  off: jest.fn(),
};

const mockMemory = {
  store: jest.fn(),
  retrieve: jest.fn(),
  deleteEntry: jest.fn(),
  query: jest.fn(),
};

const mockMCPClient = {
  callTool: jest.fn(),
};

describe('AzureAgent', () => {
  let agent: AzureAgent;
  let config: Partial<AzureAgentConfig>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    config = {
      credentials: {
        subscriptionId: 'test-subscription-id',
        tenantId: 'test-tenant-id',
      },
      defaultSubscription: 'test-subscription-id',
      defaultResourceGroup: 'test-resource-group',
    };

    mockMemory.retrieve.mockResolvedValue(null);
    mockMCPClient.callTool.mockResolvedValue({ success: true, data: {} });
  });

  afterEach(async () => {
    if (agent) {
      await agent.shutdown();
    }
  });

  describe('Initialization', () => {
    it('should create an Azure agent with valid configuration', async () => {
      agent = await createAzureAgent(
        config,
        mockLogger as any,
        mockEventBus as any,
        mockMemory as any,
        mockMCPClient,
      );

      expect(agent).toBeInstanceOf(AzureAgent);
      expect(agent.getId()).toBeTruthy();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initializing Azure agent',
        expect.any(Object),
      );
    });

    it('should initialize with environment credentials', async () => {
      process.env.AZURE_SUBSCRIPTION_ID = 'env-sub-id';
      process.env.AZURE_TENANT_ID = 'env-tenant-id';

      agent = await createAzureAgent(
        {},
        mockLogger as any,
        mockEventBus as any,
        mockMemory as any,
        mockMCPClient,
      );

      expect(agent).toBeInstanceOf(AzureAgent);
    });

    it('should load cached data from memory on initialization', async () => {
      mockMemory.retrieve.mockResolvedValue({
        value: { agentState: {}, operationHistory: [] },
      });

      agent = await createAzureAgent(
        config,
        mockLogger as any,
        mockEventBus as any,
        mockMemory as any,
        mockMCPClient,
      );

      expect(mockMemory.retrieve).toHaveBeenCalled();
    });
  });

  describe('Deployment Operations', () => {
    beforeEach(async () => {
      agent = await createAzureAgent(
        config,
        mockLogger as any,
        mockEventBus as any,
        mockMemory as any,
        mockMCPClient,
      );
    });

    it('should deploy Azure resources successfully', async () => {
      mockMCPClient.callTool.mockResolvedValue({
        deploymentId: 'test-deployment',
        status: 'succeeded',
        resources: ['resource1', 'resource2'],
      });

      const result = await agent.deploy({
        resourceGroup: 'test-rg',
        templateFile: 'template.json',
        location: 'eastus',
      });

      expect(result.success).toBe(true);
      expect(mockMCPClient.callTool).toHaveBeenCalledWith(
        'azure_deploy',
        expect.objectContaining({
          resourceGroup: 'test-rg',
          templateFile: 'template.json',
        }),
      );
    });

    it('should handle deployment failures with retry', async () => {
      mockMCPClient.callTool
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ deploymentId: 'test-deployment', status: 'succeeded' });

      const result = await agent.deploy({
        resourceGroup: 'test-rg',
        templateFile: 'template.json',
      });

      expect(result.success).toBe(true);
      expect(mockMCPClient.callTool).toHaveBeenCalledTimes(3);
    });

    it('should fail after maximum retries', async () => {
      mockMCPClient.callTool.mockRejectedValue(new Error('Persistent error'));

      const result = await agent.deploy({
        resourceGroup: 'test-rg',
        templateFile: 'template.json',
        retryConfig: { maxRetries: 2 },
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Persistent error');
      expect(mockMCPClient.callTool).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('should execute Azure Developer CLI commands', async () => {
      mockMCPClient.callTool.mockResolvedValue({ output: 'Command executed' });

      const result = await agent.azd('init');

      expect(result.success).toBe(true);
      expect(mockMCPClient.callTool).toHaveBeenCalledWith(
        'azure_developer_cli',
        expect.objectContaining({
          command: 'init',
        }),
      );
    });
  });

  describe('Security Operations', () => {
    beforeEach(async () => {
      agent = await createAzureAgent(
        config,
        mockLogger as any,
        mockEventBus as any,
        mockMemory as any,
        mockMCPClient,
      );
    });

    it('should list RBAC role assignments', async () => {
      mockMCPClient.callTool.mockResolvedValue({
        roleAssignments: [
          { principalId: 'user1', roleDefinitionId: 'role1', scope: '/subscriptions/sub1' },
        ],
      });

      const result = await agent.manageRBAC('list', {});

      expect(result.success).toBe(true);
      expect(mockMCPClient.callTool).toHaveBeenCalledWith(
        'azure_rbac',
        expect.objectContaining({ action: 'list' }),
      );
    });

    it('should retrieve secrets from Key Vault', async () => {
      mockMCPClient.callTool.mockResolvedValue({ value: 'secret-value' });

      const result = await agent.keyVault('get', 'secret', {
        vaultName: 'test-vault',
        secretName: 'test-secret',
      });

      expect(result.success).toBe(true);
      expect(mockMCPClient.callTool).toHaveBeenCalledWith(
        'azure_key_vault',
        expect.objectContaining({
          operation: 'get',
          type: 'secret',
          vaultName: 'test-vault',
          secretName: 'test-secret',
        }),
      );
    });

    it('should store secrets in Key Vault', async () => {
      mockMCPClient.callTool.mockResolvedValue({ success: true });

      const result = await agent.keyVault('set', 'secret', {
        vaultName: 'test-vault',
        secretName: 'test-secret',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Monitoring Operations', () => {
    beforeEach(async () => {
      agent = await createAzureAgent(
        config,
        mockLogger as any,
        mockEventBus as any,
        mockMemory as any,
        mockMCPClient,
      );
    });

    it('should query Azure Monitor logs', async () => {
      mockMCPClient.callTool.mockResolvedValue({
        logs: [{ timestamp: '2025-01-01', message: 'Log entry' }],
      });

      const result = await agent.monitor({
        query: 'AzureActivity | limit 10',
        timeRange: '24h',
      });

      expect(result.success).toBe(true);
      expect(mockMCPClient.callTool).toHaveBeenCalledWith(
        'azure_monitor',
        expect.objectContaining({
          query: 'AzureActivity | limit 10',
          timeRange: '24h',
        }),
      );
    });

    it('should check resource health', async () => {
      mockMCPClient.callTool.mockResolvedValue({
        availabilityState: 'available',
        reasonType: 'none',
      });

      const result = await agent.checkResourceHealth('/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Web/sites/app1');

      expect(result.success).toBe(true);
    });

    it('should diagnose with App Lens', async () => {
      mockMCPClient.callTool.mockResolvedValue({
        healthy: false,
        detectedIssues: [{ name: 'High CPU', severity: 'warning' }],
      });

      const result = await agent.appLens('/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Web/sites/app1');

      expect(result.success).toBe(true);
    });
  });

  describe('Administrative Operations', () => {
    beforeEach(async () => {
      agent = await createAzureAgent(
        config,
        mockLogger as any,
        mockEventBus as any,
        mockMemory as any,
        mockMCPClient,
      );
    });

    it('should list subscriptions', async () => {
      mockMCPClient.callTool.mockResolvedValue({
        subscriptions: [
          { id: 'sub1', name: 'Subscription 1' },
          { id: 'sub2', name: 'Subscription 2' },
        ],
      });

      const result = await agent.listSubscriptions();

      expect(result.success).toBe(true);
      expect(mockMCPClient.callTool).toHaveBeenCalledWith('azure_subscription', {});
    });

    it('should list resource groups', async () => {
      mockMCPClient.callTool.mockResolvedValue({
        resourceGroups: [
          { name: 'rg1', location: 'eastus' },
          { name: 'rg2', location: 'westus' },
        ],
      });

      const result = await agent.listResourceGroups();

      expect(result.success).toBe(true);
    });

    it('should manage quotas', async () => {
      mockMCPClient.callTool.mockResolvedValue({
        quotas: [
          { name: 'Cores', limit: 100, current: 50, unit: 'count' },
        ],
      });

      const result = await agent.manageQuotas('list', {
        location: 'eastus',
        provider: 'Microsoft.Compute',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Metrics and State Management', () => {
    beforeEach(async () => {
      agent = await createAzureAgent(
        config,
        mockLogger as any,
        mockEventBus as any,
        mockMemory as any,
        mockMCPClient,
      );
    });

    it('should track operation metrics', async () => {
      mockMCPClient.callTool.mockResolvedValue({ success: true });

      await agent.deploy({ resourceGroup: 'test-rg', templateFile: 'template.json' });
      const metrics = agent.getMetrics();

      expect(metrics.tasksCompleted).toBe(1);
      expect(metrics.successRate).toBe(1.0);
    });

    it('should track failed operations', async () => {
      mockMCPClient.callTool.mockRejectedValue(new Error('Operation failed'));

      await agent.deploy({
        resourceGroup: 'test-rg',
        templateFile: 'template.json',
        retryConfig: { maxRetries: 0 },
      });

      const metrics = agent.getMetrics();
      expect(metrics.tasksFailed).toBe(1);
      expect(metrics.successRate).toBeLessThan(1.0);
    });

    it('should save state to memory on shutdown', async () => {
      await agent.shutdown();

      expect(mockMemory.store).toHaveBeenCalledWith(
        expect.stringContaining('azure-agent:'),
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('should maintain operation history', async () => {
      mockMCPClient.callTool.mockResolvedValue({ success: true });

      await agent.deploy({ resourceGroup: 'test-rg', templateFile: 'template.json' });
      await agent.listSubscriptions();

      const history = agent.getOperationHistory();
      expect(history.length).toBe(2);
    });
  });
});

describe('AzureAgentWrapper', () => {
  let agent: AzureAgent;
  let wrapper: AzureAgentWrapper;

  beforeEach(async () => {
    jest.clearAllMocks();

    agent = await createAzureAgent(
      {
        credentials: { subscriptionId: 'test-sub' },
        defaultSubscription: 'test-sub',
      },
      mockLogger as any,
      mockEventBus as any,
      mockMemory as any,
      mockMCPClient,
    );

    wrapper = new AzureAgentWrapper(agent, mockLogger as any);
  });

  afterEach(async () => {
    await agent.shutdown();
  });

  it('should deploy template with simplified interface', async () => {
    mockMCPClient.callTool.mockResolvedValue({
      deploymentId: 'dep-123',
      status: 'succeeded',
      resources: ['res1', 'res2'],
    });

    const result = await wrapper.deployTemplate('test-rg', 'template.json');

    expect(result.status).toBe('succeeded');
    expect(result.resources).toHaveLength(2);
  });

  it('should retrieve secrets easily', async () => {
    mockMCPClient.callTool.mockResolvedValue({ value: 'my-secret-value' });

    const secret = await wrapper.getSecret('vault1', 'secret1');

    expect(secret).toBe('my-secret-value');
  });

  it('should query logs with simple interface', async () => {
    mockMCPClient.callTool.mockResolvedValue({
      logs: [{ timestamp: '2025-01-01', level: 'info', message: 'Test log' }],
      metrics: [],
    });

    const data = await wrapper.queryLogs('AzureActivity', '24h');

    expect(data.logs).toHaveLength(1);
  });
});

describe('AzureAgentFactory', () => {
  let factory: AzureAgentFactory;

  beforeEach(() => {
    jest.clearAllMocks();
    factory = new AzureAgentFactory(
      mockLogger as any,
      mockEventBus as any,
      mockMemory as any,
      { subscriptionId: 'default-sub' },
    );
  });

  it('should create standard agent', async () => {
    const agent = await factory.createAgent({ subscriptionId: 'test-sub' });

    expect(agent).toBeInstanceOf(AzureAgent);
    await agent.shutdown();
  });

  it('should create deployment-focused agent', async () => {
    const agent = await factory.createDeploymentAgent('sub1', 'rg1');

    expect(agent).toBeInstanceOf(AzureAgent);
    const capabilities = agent.getCapabilities();
    expect(capabilities.frameworks).toContain('arm-templates');

    await agent.shutdown();
  });

  it('should create monitoring-focused agent', async () => {
    const agent = await factory.createMonitoringAgent('sub1');

    expect(agent).toBeInstanceOf(AzureAgent);
    await agent.shutdown();
  });

  it('should create security-focused agent', async () => {
    const agent = await factory.createSecurityAgent('sub1', 'tenant1');

    expect(agent).toBeInstanceOf(AzureAgent);
    await agent.shutdown();
  });

  it('should create agent from environment variables', async () => {
    process.env.AZURE_SUBSCRIPTION_ID = 'env-sub';
    process.env.AZURE_TENANT_ID = 'env-tenant';

    const agent = await factory.createFromEnvironment();

    expect(agent).toBeInstanceOf(AzureAgent);
    await agent.shutdown();
  });

  it('should set default MCP client', () => {
    factory.setDefaultMCPClient(mockMCPClient);

    const options = factory.getDefaultOptions();
    expect(options.mcpClient).toBe(mockMCPClient);
  });
});
