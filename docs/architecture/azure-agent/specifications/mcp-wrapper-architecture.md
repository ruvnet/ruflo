# Azure MCP Server Wrapper Architecture

## Overview
The MCP Wrapper is the core component that bridges the Azure Agent's high-level interface with Microsoft's Azure MCP server. It provides protocol translation, request orchestration, and response normalization.

## Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│              Azure Agent Interface                   │
│  (High-level, Intent-based, User-friendly)          │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│           MCP Wrapper & Orchestrator                 │
│  • Protocol Translation                              │
│  • Request Validation                                │
│  • Response Normalization                            │
│  • Error Handling                                    │
│  • State Management                                  │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│        Azure MCP Server Connection Layer             │
│  • WebSocket/HTTP Transport                          │
│  • Authentication                                    │
│  • Message Serialization                             │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│         Microsoft Azure MCP Server                   │
│  (50+ Azure Management Tools)                        │
└─────────────────────────────────────────────────────┘
```

## Core Components

### 1. MCP Client Connector

**Purpose**: Manages connection lifecycle with Azure MCP server

```typescript
interface MCPConnector {
  // Connection management
  connect(config: MCPConfig): Promise<void>;
  disconnect(): Promise<void>;
  reconnect(): Promise<void>;
  isConnected(): boolean;

  // Health monitoring
  ping(): Promise<boolean>;
  getStatus(): ConnectionStatus;

  // Configuration
  configure(options: MCPOptions): void;
  getCapabilities(): Promise<ServerCapabilities>;
}

interface MCPConfig {
  serverUrl: string;
  protocol: 'websocket' | 'http' | 'stdio';
  authentication: AuthConfig;
  timeout: number;
  retryStrategy: RetryConfig;
}

class MCPConnectorImpl implements MCPConnector {
  private client: MCPClient;
  private heartbeatInterval: NodeJS.Timeout;
  private reconnectAttempts: number = 0;

  async connect(config: MCPConfig): Promise<void> {
    // Initialize MCP client based on protocol
    this.client = await this.createClient(config);

    // Authenticate with Azure MCP server
    await this.authenticate(config.authentication);

    // Start heartbeat monitoring
    this.startHeartbeat();

    // Verify server capabilities
    await this.verifyCapabilities();
  }

  private async createClient(config: MCPConfig): Promise<MCPClient> {
    switch (config.protocol) {
      case 'websocket':
        return new WebSocketMCPClient(config);
      case 'http':
        return new HttpMCPClient(config);
      case 'stdio':
        return new StdioMCPClient(config);
      default:
        throw new Error(`Unsupported protocol: ${config.protocol}`);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.ping();
      } catch (error) {
        await this.handleConnectionLoss(error);
      }
    }, 30000); // 30 second interval
  }

  private async handleConnectionLoss(error: Error): Promise<void> {
    if (this.reconnectAttempts < 5) {
      this.reconnectAttempts++;
      await this.reconnect();
    } else {
      throw new Error('Max reconnection attempts exceeded');
    }
  }
}
```

### 2. Tool Wrapper Registry

**Purpose**: Wraps each Azure MCP tool with standardized interface

```typescript
interface ToolWrapper {
  // Tool metadata
  name: string;
  category: ToolCategory;
  description: string;

  // Execution
  execute(params: any): Promise<ToolResult>;
  validate(params: any): ValidationResult;

  // Schema
  getSchema(): ToolSchema;

  // Permissions
  requiredPermissions(): string[];
}

type ToolCategory =
  | 'deployment'
  | 'security'
  | 'monitoring'
  | 'networking'
  | 'storage'
  | 'compute'
  | 'database'
  | 'administration';

class ToolWrapperRegistry {
  private wrappers: Map<string, ToolWrapper> = new Map();

  register(wrapper: ToolWrapper): void {
    this.wrappers.set(wrapper.name, wrapper);
  }

  get(toolName: string): ToolWrapper | undefined {
    return this.wrappers.get(toolName);
  }

  listByCategory(category: ToolCategory): ToolWrapper[] {
    return Array.from(this.wrappers.values())
      .filter(w => w.category === category);
  }

  async executeWithRetry(
    toolName: string,
    params: any,
    retryConfig: RetryConfig
  ): Promise<ToolResult> {
    const wrapper = this.get(toolName);
    if (!wrapper) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    // Validate parameters
    const validation = wrapper.validate(params);
    if (!validation.valid) {
      throw new ValidationError(validation.errors);
    }

    // Execute with retry logic
    return await this.retryWithBackoff(
      () => wrapper.execute(params),
      retryConfig
    );
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    config: RetryConfig
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Check if error is retryable
        if (!this.isRetryable(error)) {
          throw error;
        }

        // Wait before retry with exponential backoff
        if (attempt < config.maxRetries) {
          const delay = config.baseDelay * Math.pow(2, attempt);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  private isRetryable(error: any): boolean {
    // Network errors
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return true;
    }

    // Azure throttling
    if (error.statusCode === 429) {
      return true;
    }

    // Temporary server errors
    if (error.statusCode >= 500 && error.statusCode < 600) {
      return true;
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 3. Request Orchestrator

**Purpose**: Coordinates complex multi-tool operations

```typescript
interface RequestOrchestrator {
  // Single operation
  execute(request: ToolRequest): Promise<ToolResult>;

  // Multi-step operation
  executeWorkflow(workflow: Workflow): Promise<WorkflowResult>;

  // Parallel execution
  executeBatch(requests: ToolRequest[]): Promise<BatchResult>;

  // Transaction support
  executeTransaction(operations: Operation[]): Promise<TransactionResult>;
}

interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  rollbackStrategy?: RollbackStrategy;
}

interface WorkflowStep {
  id: string;
  tool: string;
  params: Record<string, any> | ((context: WorkflowContext) => any);
  dependsOn?: string[];
  retryConfig?: RetryConfig;
  onError?: ErrorHandler;
}

class RequestOrchestratorImpl implements RequestOrchestrator {
  constructor(
    private registry: ToolWrapperRegistry,
    private stateManager: StateManager
  ) {}

  async executeWorkflow(workflow: Workflow): Promise<WorkflowResult> {
    const context: WorkflowContext = {
      workflowId: workflow.id,
      results: new Map(),
      startTime: Date.now()
    };

    try {
      // Build dependency graph
      const graph = this.buildDependencyGraph(workflow.steps);

      // Execute steps in topological order
      const sortedSteps = this.topologicalSort(graph);

      for (const stepId of sortedSteps) {
        const step = workflow.steps.find(s => s.id === stepId);
        if (!step) continue;

        // Check if dependencies are satisfied
        if (!this.dependenciesSatisfied(step, context)) {
          throw new Error(`Dependencies not satisfied for step: ${step.id}`);
        }

        // Resolve parameters from context
        const params = typeof step.params === 'function'
          ? step.params(context)
          : step.params;

        // Execute step
        try {
          const result = await this.registry.executeWithRetry(
            step.tool,
            params,
            step.retryConfig || DEFAULT_RETRY_CONFIG
          );

          context.results.set(step.id, result);

          // Save checkpoint for rollback
          await this.stateManager.saveCheckpoint(workflow.id, step.id, result);

        } catch (error) {
          // Handle step error
          if (step.onError) {
            await step.onError(error, context);
          }

          // Rollback if configured
          if (workflow.rollbackStrategy) {
            await this.rollback(workflow, context);
          }

          throw error;
        }
      }

      return {
        success: true,
        workflowId: workflow.id,
        results: context.results,
        duration: Date.now() - context.startTime
      };

    } catch (error) {
      return {
        success: false,
        workflowId: workflow.id,
        error: error.message,
        duration: Date.now() - context.startTime
      };
    }
  }

  async executeBatch(requests: ToolRequest[]): Promise<BatchResult> {
    // Group by category for optimized execution
    const grouped = this.groupBySimilarity(requests);

    // Execute groups in parallel
    const results = await Promise.allSettled(
      grouped.map(group => this.executeGroup(group))
    );

    return {
      total: requests.length,
      successful: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length,
      results: results.map((r, i) => ({
        requestId: requests[i].id,
        status: r.status,
        value: r.status === 'fulfilled' ? r.value : undefined,
        error: r.status === 'rejected' ? r.reason : undefined
      }))
    };
  }

  async executeTransaction(operations: Operation[]): Promise<TransactionResult> {
    const transactionId = this.generateTransactionId();
    const checkpoints: Checkpoint[] = [];

    try {
      // Begin transaction
      await this.stateManager.beginTransaction(transactionId);

      for (const operation of operations) {
        const result = await this.execute(operation);

        // Save checkpoint for rollback
        const checkpoint = await this.stateManager.saveCheckpoint(
          transactionId,
          operation.id,
          result
        );
        checkpoints.push(checkpoint);
      }

      // Commit transaction
      await this.stateManager.commitTransaction(transactionId);

      return {
        success: true,
        transactionId,
        operations: operations.length
      };

    } catch (error) {
      // Rollback all operations
      for (const checkpoint of checkpoints.reverse()) {
        await this.stateManager.rollbackCheckpoint(checkpoint);
      }

      await this.stateManager.rollbackTransaction(transactionId);

      return {
        success: false,
        transactionId,
        error: error.message
      };
    }
  }

  private buildDependencyGraph(steps: WorkflowStep[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const step of steps) {
      graph.set(step.id, step.dependsOn || []);
    }

    return graph;
  }

  private topologicalSort(graph: Map<string, string[]>): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (nodeId: string): void => {
      if (visited.has(nodeId)) return;
      if (visiting.has(nodeId)) {
        throw new Error('Circular dependency detected');
      }

      visiting.add(nodeId);

      const dependencies = graph.get(nodeId) || [];
      for (const depId of dependencies) {
        visit(depId);
      }

      visiting.delete(nodeId);
      visited.add(nodeId);
      sorted.push(nodeId);
    };

    for (const nodeId of graph.keys()) {
      visit(nodeId);
    }

    return sorted;
  }

  private dependenciesSatisfied(
    step: WorkflowStep,
    context: WorkflowContext
  ): boolean {
    if (!step.dependsOn) return true;

    return step.dependsOn.every(depId =>
      context.results.has(depId) &&
      context.results.get(depId)?.success === true
    );
  }
}
```

### 4. Response Normalizer

**Purpose**: Transforms Azure MCP responses into consistent format

```typescript
interface ResponseNormalizer {
  normalize(rawResponse: any, tool: string): NormalizedResponse;
  denormalize(normalized: NormalizedResponse): any;
}

interface NormalizedResponse {
  success: boolean;
  data?: any;
  error?: NormalizedError;
  metadata: ResponseMetadata;
}

interface ResponseMetadata {
  tool: string;
  timestamp: Date;
  duration: number;
  requestId: string;
  azureRequestId?: string;
  resourcesAffected?: string[];
  cost?: CostInfo;
}

class ResponseNormalizerImpl implements ResponseNormalizer {
  private transformers: Map<string, ResponseTransformer> = new Map();

  constructor() {
    this.registerDefaultTransformers();
  }

  normalize(rawResponse: any, tool: string): NormalizedResponse {
    const transformer = this.transformers.get(tool);

    if (!transformer) {
      // Default normalization
      return this.defaultNormalize(rawResponse, tool);
    }

    return transformer.transform(rawResponse);
  }

  private defaultNormalize(rawResponse: any, tool: string): NormalizedResponse {
    // Check for Azure error structure
    if (rawResponse.error || rawResponse.status === 'error') {
      return {
        success: false,
        error: this.normalizeError(rawResponse.error || rawResponse),
        metadata: {
          tool,
          timestamp: new Date(),
          duration: 0,
          requestId: this.generateRequestId()
        }
      };
    }

    // Success response
    return {
      success: true,
      data: rawResponse.data || rawResponse,
      metadata: {
        tool,
        timestamp: new Date(),
        duration: rawResponse.duration || 0,
        requestId: rawResponse.requestId || this.generateRequestId(),
        azureRequestId: rawResponse['x-ms-request-id'],
        resourcesAffected: this.extractResourceIds(rawResponse)
      }
    };
  }

  private normalizeError(error: any): NormalizedError {
    return {
      code: error.code || 'UNKNOWN_ERROR',
      message: error.message || 'An unknown error occurred',
      category: this.categorizeError(error),
      details: error.details || {},
      azureError: error,
      recoverable: this.isRecoverable(error),
      suggestions: this.generateSuggestions(error)
    };
  }

  private categorizeError(error: any): ErrorCategory {
    const code = error.code || '';
    const status = error.statusCode || error.status;

    // Authentication errors
    if (status === 401 || code.includes('Auth')) {
      return 'authentication';
    }

    // Authorization errors
    if (status === 403 || code.includes('Forbidden')) {
      return 'authorization';
    }

    // Validation errors
    if (status === 400 || code.includes('Invalid')) {
      return 'validation';
    }

    // Resource not found
    if (status === 404) {
      return 'not_found';
    }

    // Rate limiting
    if (status === 429) {
      return 'throttling';
    }

    // Server errors
    if (status >= 500) {
      return 'server_error';
    }

    // Network errors
    if (code.includes('ECONNREFUSED') || code.includes('ETIMEDOUT')) {
      return 'network';
    }

    return 'unknown';
  }

  private isRecoverable(error: any): boolean {
    const category = this.categorizeError(error);

    return [
      'throttling',
      'network',
      'server_error'
    ].includes(category);
  }

  private generateSuggestions(error: any): string[] {
    const suggestions: string[] = [];
    const category = this.categorizeError(error);

    switch (category) {
      case 'authentication':
        suggestions.push('Verify your Azure credentials are valid');
        suggestions.push('Check if your access token has expired');
        suggestions.push('Ensure you have logged in: az login');
        break;

      case 'authorization':
        suggestions.push('Verify you have the required permissions');
        suggestions.push('Check RBAC role assignments');
        suggestions.push('Ensure you have access to the subscription');
        break;

      case 'validation':
        suggestions.push('Review the parameters you provided');
        suggestions.push('Check the Azure documentation for this resource type');
        suggestions.push('Validate required fields are present');
        break;

      case 'throttling':
        suggestions.push('Wait a few minutes before retrying');
        suggestions.push('Reduce the frequency of requests');
        suggestions.push('Consider using batch operations');
        break;

      case 'network':
        suggestions.push('Check your internet connection');
        suggestions.push('Verify Azure service status');
        suggestions.push('Check if firewall is blocking requests');
        break;
    }

    return suggestions;
  }

  private extractResourceIds(response: any): string[] {
    const ids: string[] = [];

    // Common Azure resource ID patterns
    const patterns = [
      /\/subscriptions\/[^\/]+\/resourceGroups\/[^\/]+\/providers\/[^\/]+\/[^\s"]+/g,
      /"id":\s*"([^"]+)"/g
    ];

    const str = JSON.stringify(response);

    for (const pattern of patterns) {
      const matches = str.match(pattern);
      if (matches) {
        ids.push(...matches);
      }
    }

    return [...new Set(ids)]; // Remove duplicates
  }

  private registerDefaultTransformers(): void {
    // Register tool-specific transformers
    this.transformers.set('azure_deploy_resource', new DeploymentTransformer());
    this.transformers.set('azure_monitor_metrics', new MetricsTransformer());
    this.transformers.set('azure_logs_query', new LogsTransformer());
    // ... more transformers
  }
}
```

### 5. State Manager

**Purpose**: Manages agent state, caching, and persistence

```typescript
interface StateManager {
  // State persistence
  saveState(state: AgentState): Promise<void>;
  loadState(): Promise<AgentState>;

  // Cache management
  cacheGet<T>(key: string): Promise<T | undefined>;
  cacheSet<T>(key: string, value: T, ttl?: number): Promise<void>;
  cacheInvalidate(pattern: string): Promise<void>;

  // Transaction support
  beginTransaction(id: string): Promise<void>;
  commitTransaction(id: string): Promise<void>;
  rollbackTransaction(id: string): Promise<void>;

  // Checkpoint management
  saveCheckpoint(transactionId: string, stepId: string, result: any): Promise<Checkpoint>;
  rollbackCheckpoint(checkpoint: Checkpoint): Promise<void>;
}

class StateManagerImpl implements StateManager {
  private cache: Map<string, CacheEntry> = new Map();
  private transactions: Map<string, Transaction> = new Map();
  private persistenceAdapter: PersistenceAdapter;

  constructor(adapter: PersistenceAdapter) {
    this.persistenceAdapter = adapter;
    this.startCacheCleanup();
  }

  async saveState(state: AgentState): Promise<void> {
    await this.persistenceAdapter.save('agent_state', state);
  }

  async loadState(): Promise<AgentState> {
    const state = await this.persistenceAdapter.load('agent_state');
    return state || this.getDefaultState();
  }

  async cacheGet<T>(key: string): Promise<T | undefined> {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  async cacheSet<T>(key: string, value: T, ttl?: number): Promise<void> {
    const entry: CacheEntry = {
      value,
      createdAt: Date.now(),
      expiresAt: ttl ? Date.now() + ttl : undefined
    };

    this.cache.set(key, entry);
  }

  async cacheInvalidate(pattern: string): Promise<void> {
    const regex = new RegExp(pattern);

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  async beginTransaction(id: string): Promise<void> {
    if (this.transactions.has(id)) {
      throw new Error(`Transaction already exists: ${id}`);
    }

    this.transactions.set(id, {
      id,
      startTime: Date.now(),
      checkpoints: [],
      status: 'active'
    });
  }

  async commitTransaction(id: string): Promise<void> {
    const transaction = this.transactions.get(id);

    if (!transaction) {
      throw new Error(`Transaction not found: ${id}`);
    }

    transaction.status = 'committed';
    transaction.endTime = Date.now();

    // Persist transaction log
    await this.persistenceAdapter.save(`transaction_${id}`, transaction);

    // Clean up checkpoints
    this.transactions.delete(id);
  }

  async rollbackTransaction(id: string): Promise<void> {
    const transaction = this.transactions.get(id);

    if (!transaction) {
      throw new Error(`Transaction not found: ${id}`);
    }

    // Rollback checkpoints in reverse order
    for (const checkpoint of transaction.checkpoints.reverse()) {
      await this.rollbackCheckpoint(checkpoint);
    }

    transaction.status = 'rolled_back';
    transaction.endTime = Date.now();

    this.transactions.delete(id);
  }

  async saveCheckpoint(
    transactionId: string,
    stepId: string,
    result: any
  ): Promise<Checkpoint> {
    const transaction = this.transactions.get(transactionId);

    if (!transaction) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    const checkpoint: Checkpoint = {
      id: `${transactionId}_${stepId}`,
      transactionId,
      stepId,
      timestamp: Date.now(),
      result,
      rollbackInfo: this.extractRollbackInfo(result)
    };

    transaction.checkpoints.push(checkpoint);

    return checkpoint;
  }

  async rollbackCheckpoint(checkpoint: Checkpoint): Promise<void> {
    // Execute rollback based on checkpoint type
    const { rollbackInfo } = checkpoint;

    if (rollbackInfo.type === 'resource_creation') {
      // Delete the created resource
      await this.deleteResource(rollbackInfo.resourceId);
    } else if (rollbackInfo.type === 'resource_update') {
      // Restore previous state
      await this.restoreResource(
        rollbackInfo.resourceId,
        rollbackInfo.previousState
      );
    }
  }

  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();

      for (const [key, entry] of this.cache.entries()) {
        if (entry.expiresAt && now > entry.expiresAt) {
          this.cache.delete(key);
        }
      }
    }, 60000); // Cleanup every minute
  }

  private extractRollbackInfo(result: any): RollbackInfo {
    // Extract information needed for rollback
    if (result.operation === 'create') {
      return {
        type: 'resource_creation',
        resourceId: result.resourceId
      };
    } else if (result.operation === 'update') {
      return {
        type: 'resource_update',
        resourceId: result.resourceId,
        previousState: result.previousState
      };
    }

    return { type: 'unknown' };
  }
}
```

## Tool Categories and Mappings

### Deployment Tools
- `azure_deploy_resource` - Deploy any Azure resource
- `azure_deploy_template` - Deploy ARM/Bicep template
- `azure_deploy_container` - Deploy containers to AKS/ACI
- `azure_deploy_function` - Deploy Azure Functions

### Security Tools
- `azure_assign_role` - Assign RBAC roles
- `azure_policy_assign` - Assign Azure Policy
- `azure_keyvault_secret` - Manage Key Vault secrets
- `azure_security_scan` - Run security assessments

### Monitoring Tools
- `azure_monitor_metrics` - Query Azure Monitor metrics
- `azure_logs_query` - Query Log Analytics
- `azure_alert_create` - Create alert rules
- `azure_diagnostics_get` - Get diagnostic logs

### Networking Tools
- `azure_network_create` - Create virtual networks
- `azure_nsg_configure` - Configure network security groups
- `azure_load_balancer` - Manage load balancers
- `azure_dns_manage` - Manage DNS zones

### Storage Tools
- `azure_storage_account` - Manage storage accounts
- `azure_blob_operations` - Blob storage operations
- `azure_file_share` - Manage file shares
- `azure_disk_manage` - Manage managed disks

## Integration Patterns

### Pattern 1: Simple Pass-Through
```typescript
// Direct 1:1 mapping to MCP tool
async listResources(resourceGroup: string): Promise<Resource[]> {
  return await this.mcp.call('azure_resource_list', {
    resourceGroup
  });
}
```

### Pattern 2: Parameter Transformation
```typescript
// Transform high-level params to MCP format
async deployWebApp(config: WebAppConfig): Promise<DeploymentResult> {
  const mcpParams = {
    resourceType: 'Microsoft.Web/sites',
    parameters: {
      name: config.name,
      location: config.location,
      properties: {
        serverFarmId: config.appServicePlan,
        siteConfig: {
          linuxFxVersion: `NODE|${config.nodeVersion}`
        }
      }
    }
  };

  return await this.mcp.call('azure_deploy_resource', mcpParams);
}
```

### Pattern 3: Multi-Tool Orchestration
```typescript
// Combine multiple MCP calls
async deployFullApplication(spec: ApplicationSpec): Promise<DeploymentResult> {
  // 1. Create resource group
  await this.mcp.call('azure_resource_group_create', {...});

  // 2. Deploy network infrastructure
  const vnet = await this.mcp.call('azure_network_create', {...});

  // 3. Deploy database
  const db = await this.mcp.call('azure_database_create', {...});

  // 4. Deploy application
  const app = await this.mcp.call('azure_deploy_resource', {
    ...spec,
    databaseConnectionString: db.connectionString,
    subnetId: vnet.subnets[0].id
  });

  // 5. Configure monitoring
  await this.mcp.call('azure_monitor_enable', {
    resourceId: app.id
  });

  return aggregateResults([vnet, db, app]);
}
```

## Error Handling

### Error Categories
1. **Network Errors**: Connection failures, timeouts
2. **Authentication Errors**: Invalid credentials, expired tokens
3. **Authorization Errors**: Insufficient permissions
4. **Validation Errors**: Invalid parameters, schema violations
5. **Resource Errors**: Resource not found, conflicts
6. **Throttling Errors**: Rate limiting, quota exceeded
7. **Server Errors**: Azure service failures

### Retry Strategy
```typescript
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  retryableCategories: ErrorCategory[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  retryableCategories: [
    'network',
    'throttling',
    'server_error'
  ]
};
```

## Performance Optimization

### Request Batching
- Batch similar read operations
- Use Azure's batch APIs
- Parallel execution where possible

### Caching Strategy
- Cache resource metadata: 5 minutes
- Cache subscription info: 1 hour
- Invalidate on write operations
- LRU eviction policy

### Connection Pooling
- Reuse MCP connections
- Connection keepalive
- Automatic reconnection

## Testing

### Unit Tests
- Mock MCP server responses
- Test each wrapper independently
- Validate error handling

### Integration Tests
- Test against Azure test subscriptions
- Verify multi-step workflows
- Test rollback mechanisms

### Performance Tests
- Measure latency per operation
- Test concurrent request handling
- Validate rate limiting
