# Azure Agent for Claude Flow

Native integration with Microsoft's Azure MCP Server for cloud operations.

## Features

### Deployment
- Deploy ARM templates and Bicep files
- Azure Developer CLI (azd) integration
- Resource lifecycle management

### Security & Identity
- RBAC role management
- Azure Key Vault operations (secrets, keys, certificates)
- Identity and access management

### Monitoring & Observability
- Azure Monitor log queries
- Resource health checks
- App Lens diagnostics
- Metrics and alerts

### Administration
- Subscription management
- Resource group operations
- Quota and limit management

### Debugging
- Compliance quick reviews
- Best practices guidance
- Security scanning

## Installation

```bash
npm install @anthropic-ai/claude-code
npm install claude-flow@alpha
```

Configure Azure MCP Server:
```bash
claude mcp add azure-mcp npx @azure/mcp-server
```

## Quick Start

```typescript
import { createAzureAgent } from 'claude-flow/agents/azure';

const agent = await createAzureAgent({
  credentials: {
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
    tenantId: process.env.AZURE_TENANT_ID,
  }
}, logger, eventBus, memory, mcpClient);

// Deploy resources
const result = await agent.deploy({
  resourceGroup: 'my-rg',
  templateFile: 'infrastructure/template.json',
  location: 'eastus'
});
```

## Environment Variables

```bash
AZURE_SUBSCRIPTION_ID=your-subscription-id
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id       # Optional for service principal
AZURE_CLIENT_SECRET=your-secret      # Optional for service principal
AZURE_RESOURCE_GROUP=default-rg      # Optional default
AZURE_REGION=eastus                  # Optional default
```

## Usage Examples

### Deploy Infrastructure

```typescript
const deployResult = await agent.deploy({
  resourceGroup: 'production-rg',
  templateFile: './infra/main.json',
  parametersFile: './infra/params.json',
  location: 'eastus',
  mode: 'Incremental'
});
```

### Manage Secrets

```typescript
// Get secret
const secret = await agent.keyVault('get', 'secret', {
  vaultName: 'my-vault',
  secretName: 'database-password'
});

// Set secret
await agent.keyVault('set', 'secret', {
  vaultName: 'my-vault',
  secretName: 'api-key'
});
```

### Query Logs

```typescript
const logs = await agent.monitor({
  query: 'AzureActivity | where TimeGenerated > ago(1h)',
  timeRange: '1h',
  workspace: 'my-workspace'
});
```

### Check Resource Health

```typescript
const health = await agent.checkResourceHealth(
  '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/sites/app'
);
```

### Run Compliance Scan

```typescript
const compliance = await agent.complianceReview({
  subscription: 'subscription-id'
});
```

## Using the Wrapper

Simplified interface for common operations:

```typescript
import { AzureAgentWrapper } from 'claude-flow/agents/azure';

const wrapper = new AzureAgentWrapper(agent, logger);

// Simplified operations
const secret = await wrapper.getSecret('vault', 'secret-name');
const health = await wrapper.checkHealth([resourceId1, resourceId2]);
const logs = await wrapper.queryLogs('AzureActivity', '24h');
const scan = await wrapper.runComplianceScan();
```

## Using the Factory

Create specialized agents:

```typescript
import { AzureAgentFactory } from 'claude-flow/agents/azure';

const factory = new AzureAgentFactory(logger, eventBus, memory);

// Deployment-focused
const deployAgent = await factory.createDeploymentAgent('sub-id', 'rg');

// Monitoring-focused
const monitorAgent = await factory.createMonitoringAgent('sub-id');

// Security-focused
const securityAgent = await factory.createSecurityAgent('sub-id', 'tenant-id');

// From environment
const envAgent = await factory.createFromEnvironment();
```

## Architecture

### Core Components

- **AzureAgent**: Main agent class with all Azure MCP tool wrappers
- **AzureAgentWrapper**: Simplified high-level interface
- **AzureAgentFactory**: Factory for creating specialized agents

### Integration Points

- **MCP Client**: Communicates with Azure MCP Server
- **Memory System**: Persists agent state and operation history
- **Event Bus**: Emits events for coordination
- **Logger**: Structured logging for all operations

### Error Handling

- Automatic retry with exponential backoff
- Comprehensive error reporting
- Operation-level success/failure tracking

### Metrics & Monitoring

- Operation success rates
- Execution time tracking
- Resource usage monitoring
- Health scoring

## API Reference

See [azure-agent.ts](./azure-agent.ts) for complete API documentation.

### Main Methods

- `deploy()` - Deploy ARM templates
- `azd()` - Azure Developer CLI
- `manageRBAC()` - RBAC operations
- `keyVault()` - Key Vault operations
- `monitor()` - Azure Monitor queries
- `checkResourceHealth()` - Health checks
- `appLens()` - Diagnostics
- `listSubscriptions()` - List subscriptions
- `listResourceGroups()` - List resource groups
- `manageQuotas()` - Quota management
- `complianceReview()` - Compliance scans
- `getBestPractices()` - Best practices

## Testing

```bash
npm test tests/agents/azure-agent.test.ts
```

## Configuration

### Retry Policy

```typescript
const agent = await createAzureAgent({
  credentials: { /* ... */ },
  retryPolicy: {
    maxRetries: 3,
    retryDelay: 1000,
    backoffMultiplier: 2
  }
});
```

### Network Timeout

```typescript
const agent = await createAzureAgent({
  credentials: { /* ... */ },
  networkTimeout: 30000  // 30 seconds
});
```

### Permissions

```typescript
const agent = await createAzureAgent({
  credentials: { /* ... */ },
  permissions: [
    'azure:read',
    'azure:write',
    'azure:deploy',
    'azure:monitor',
    'azure:security'
  ]
});
```

## Best Practices

1. **Credentials**: Use environment variables or Azure Key Vault
2. **Resource Groups**: Organize resources logically
3. **Monitoring**: Set up proactive alerts
4. **Security**: Use RBAC with least privilege
5. **Compliance**: Run regular scans
6. **Cost**: Use quotas to control spending
7. **Documentation**: Keep templates documented

## Troubleshooting

### Authentication Issues

```bash
# Verify Azure CLI login
az account show

# Check environment variables
echo $AZURE_SUBSCRIPTION_ID
echo $AZURE_TENANT_ID
```

### MCP Client Issues

```typescript
// Ensure MCP client is set
agent.setMCPClient(mcpClient);
```

### Timeout Issues

```typescript
// Increase timeout
const result = await agent.deploy({
  resourceGroup: 'rg',
  templateFile: 'template.json',
  timeout: 60000  // 60 seconds
});
```

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development guidelines.

## License

MIT - Part of claude-flow project

## Resources

- [Azure MCP Server Docs](https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Azure ARM Templates](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/)
- [Azure Developer CLI](https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/)
