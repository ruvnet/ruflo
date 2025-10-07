# Azure Agent Documentation

## Overview

The Azure Agent provides native integration with Microsoft's Azure MCP (Model Context Protocol) Server, enabling AI-powered interactions with Azure cloud services directly from your development environment.

## Features

- **Deployment Operations**: Deploy and manage Azure resources using ARM templates and Azure Developer CLI
- **Security & Identity**: Manage RBAC, Key Vault secrets, keys, and certificates
- **Monitoring & Observability**: Query Azure Monitor logs and metrics, check resource health
- **Administrative Tasks**: Manage subscriptions, resource groups, and quotas
- **Debugging Tools**: Run compliance reviews and get best practices guidance

## Quick Start

```typescript
import { createAzureAgent } from './src/agents/azure/azure-agent.js';

const agent = await createAzureAgent({
  credentials: {
    subscriptionId: 'your-subscription-id',
    tenantId: 'your-tenant-id',
  }
}, logger, eventBus, memory, mcpClient);
```

See /Users/arnaud/dev/claude-flow/src/agents/azure/azure-agent.ts for full API documentation.
