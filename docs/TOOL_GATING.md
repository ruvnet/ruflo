# Tool Gating and Proxy Architecture

## Overview

The claude-flow system has been refactored to implement a **proxy-core architecture** that separates tool discovery, provisioning, and execution into distinct components. This architecture enables intelligent tool gating based on token limits and semantic discovery of tools based on natural language queries.

## Architecture Components

### 1. Proxy Server (Frontend)
- **Role**: Acts as the main entry point for client requests
- **Responsibilities**: Tool discovery, provisioning, and request routing
- **Key Services**:
  - `DiscoveryService`: Semantic tool discovery
  - `GatingService`: Token-based tool provisioning
  - `ProxyService`: Tool execution routing

### 2. Backend Servers (Tool Providers)
- **Role**: Host and execute actual tool implementations
- **Responsibilities**: Tool registration, execution, and result delivery
- **Communication**: MCP protocol over stdio transport

### 3. Tool Repository
- **Role**: In-memory storage for discovered tools
- **Responsibilities**: Tool metadata management and search
- **Features**: Caching, categorization, and semantic indexing

## Key Features

### Semantic Tool Discovery
```typescript
const tools = await discoverTools({
  query: "file operations and system information",
  limit: 10
});
```

### Token-Based Tool Gating
```typescript
const provisionedTools = await provisionTools({
  query: "file operations",
  maxTokens: 5000
});
```

### Dynamic Tool Execution
```typescript
const result = await executeTool('file/read', {
  path: '/path/to/file.txt'
});
```

## Configuration

### Proxy Server Configuration
```typescript
const config: ProxyServerConfig = {
  transport: 'stdio',
  auth: {
    enabled: true,
    method: 'token'
  },
  loadBalancer: {
    enabled: true,
    maxRequestsPerSecond: 1000
  },
  backendServers: [
    {
      name: 'claude-flow-backend',
      command: 'node',
      args: ['src/mcp/backend/claude-flow-backend.js'],
      env: { NODE_ENV: 'production' }
    }
  ]
};
```

### Backend Server Configuration
```typescript
const backendConfig: BackendServerConfig = {
  name: 'claude-flow-backend',
  tools: [
    // 87+ tool implementations
  ],
  transport: 'stdio',
  discovery: {
    enabled: true,
    autoRegister: true
  }
};
```

## Performance Benefits

### Context Window Reduction
- **Before**: All 87+ tools included in context
- **After**: Only provisioned tools (typically 5-15) included
- **Reduction**: ~80-90% reduction in context size

### Response Latency
- **Discovery**: ~50-100ms for semantic search
- **Provisioning**: ~20-50ms for token-based selection
- **Execution**: ~10-30ms for tool routing

### Memory Usage
- **Proxy Server**: ~50MB base memory
- **Per Backend**: ~20-30MB additional
- **Scalability**: Linear scaling with backend servers

## Usage Patterns

### Basic Discovery and Execution
```typescript
// 1. Discover relevant tools
const tools = await discoverTools({
  query: "work with files",
  limit: 5
});

// 2. Provision tools within token budget
const provisioned = await provisionTools({
  query: "file operations",
  maxTokens: 3000
});

// 3. Execute specific tool
const result = await executeTool('file/read', {
  path: 'data.txt'
});
```

### Advanced Gating Strategy
```typescript
// Multi-stage provisioning
const stages = [
  { query: "critical operations", maxTokens: 2000, priority: 1 },
  { query: "secondary tools", maxTokens: 3000, priority: 2 },
  { query: "utility functions", maxTokens: 1000, priority: 3 }
];

for (const stage of stages) {
  const tools = await provisionTools({
    query: stage.query,
    maxTokens: stage.maxTokens
  });
  
  if (tools.length > 0) {
    console.log(`Provisioned ${tools.length} tools for ${stage.query}`);
  }
}
```

## Migration Guide

### From Monolithic to Proxy Architecture

1. **Update Dependencies**
   ```bash
   npm install @modelcontextprotocol/sdk@latest
   ```

2. **Configure Proxy Server**
   ```typescript
   // src/config/proxy.config.ts
   export const proxyConfig: ProxyServerConfig = {
     transport: 'stdio',
     backendServers: [
       {
         name: 'main-backend',
         command: 'node',
         args: ['dist/mcp/backend/claude-flow-backend.js']
       }
     ]
   };
   ```

3. **Start Backend Server**
   ```bash
   node dist/mcp/backend/claude-flow-backend.js
   ```

4. **Start Proxy Server**
   ```bash
   node dist/mcp/proxy/proxy-server.js
   ```

### Client Migration

**Before (Monolithic)**
```typescript
const client = new MCPClient({
  serverCommand: 'node',
  serverArgs: ['dist/mcp/server.js']
});
```

**After (Proxy Architecture)**
```typescript
const client = new MCPClient({
  serverCommand: 'node',
  serverArgs: ['dist/mcp/proxy/proxy-server.js']
});
```

## Best Practices

### 1. Token Budget Management
- Start with conservative token limits (2000-3000)
- Monitor actual usage and adjust accordingly
- Use multi-stage provisioning for complex workflows

### 2. Backend Server Organization
- Group related tools in separate backends
- Use descriptive backend names
- Implement health checks and monitoring

### 3. Error Handling
- Always handle discovery/provisioning failures
- Implement fallback strategies
- Log and monitor performance metrics

### 4. Performance Optimization
- Cache frequently used tool combinations
- Implement connection pooling for backends
- Use load balancing for high-traffic scenarios

## Monitoring and Debugging

### Key Metrics
- **Discovery Latency**: Time to find relevant tools
- **Provisioning Efficiency**: Token utilization rate
- **Execution Throughput**: Tools executed per second
- **Error Rates**: Failed discoveries/provisioning/executions

### Logging
```typescript
// Enable detailed logging
const logger = new Logger('ProxyServer', {
  level: 'debug',
  includeTimestamp: true
});
```

### Health Checks
```typescript
// Backend health monitoring
const healthCheck = await proxyServer.getBackendHealth();
console.log('Backend status:', healthCheck);
```

## Troubleshooting

### Common Issues

1. **Backend Connection Failed**
   - Check backend server is running
   - Verify network connectivity
   - Review backend logs

2. **Tool Discovery Returns Empty**
   - Verify backend tools are registered
   - Check query relevance
   - Review discovery service logs

3. **Provisioning Exceeds Token Limit**
   - Reduce `maxTokens` parameter
   - Use more specific queries
   - Implement multi-stage provisioning

4. **Tool Execution Fails**
   - Verify tool is provisioned
   - Check backend availability
   - Review execution parameters

## Future Enhancements

### Planned Features
- **Dynamic Backend Scaling**: Auto-scale backends based on load
- **Intelligent Caching**: Cache tool combinations and results
- **Advanced Load Balancing**: Weighted routing and failover
- **Tool Versioning**: Support multiple tool versions
- **A/B Testing**: Compare different provisioning strategies
- **Ruv-Swarm Context Slimming** *(roadmap)*:
  - Audit the current `ruv-swarm` MCP prompt/template to identify the 11k token baseline.
  - Port the proxy/gating pattern used for `claude-flow` so `ruv-swarm` only loads tool/toolset metadata on demand.
  - Introduce per-toolset TTL/LRU rules and semantic discovery hooks to keep active context under 5k tokens.
  - Provide migration guidance so downstream users can toggle the trimmed profile set or fall back to the legacy, full-context mode during rollout.

### Performance Improvements
- **Connection Pooling**: Reuse backend connections
- **Async Processing**: Non-blocking tool discovery
- **Compression**: Reduce network overhead
- **CDN Integration**: Cache static tool metadata

## Conclusion

The proxy-core architecture provides a scalable, efficient solution for managing large tool sets while maintaining optimal context window usage. By separating concerns and implementing intelligent gating, the system can handle complex workflows with improved performance and reliability.
