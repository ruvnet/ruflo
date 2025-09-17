# Enhanced LALO MCP Server

## Overview

The Enhanced LALO MCP Server provides a production-ready Model Context Protocol implementation with comprehensive LALO ecosystem integration, advanced security features, and performance optimizations.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Enhanced MCP Server                      │
├─────────────────────────────────────────────────────────────┤
│  Security Layer                                            │
│  ├─ Rate Limiting (100 req/min)                            │
│  ├─ Input Validation (Zod schemas)                         │
│  ├─ Error Handling (Structured errors)                     │
│  └─ Authentication & Authorization                         │
├─────────────────────────────────────────────────────────────┤
│  Performance Layer                                         │
│  ├─ Caching (Smart TTL-based)                             │
│  ├─ Timeouts (30s tools, 15s resources)                   │
│  ├─ Connection Pooling                                     │
│  └─ Health Monitoring                                      │
├─────────────────────────────────────────────────────────────┤
│  Protocol Layer (MCP 2024-11-05)                          │
│  ├─ Tool Handlers (Enhanced + Legacy)                     │
│  ├─ Resource Handlers (Cached)                            │
│  ├─ Initialization Handler                                 │
│  └─ Logging Handler                                        │
├─────────────────────────────────────────────────────────────┤
│  LALO Integration Layer                                    │
│  ├─ LangGraph Orchestrator                                │
│  ├─ Governance System                                      │
│  ├─ RAG Engine                                            │
│  └─ NL2SQL Engine                                         │
└─────────────────────────────────────────────────────────────┘
```

## Key Features

### 🚀 Enhanced Tools
- **`execute_workflow`** - Governance-controlled workflow execution
- **`create_proposal`** - Advanced governance proposal creation
- **`search_knowledge`** - RAG-powered semantic search
- **`nl2sql_query`** - Natural language to SQL conversion
- **`system_status`** - Comprehensive system monitoring

### 🔒 Security
- **Rate Limiting**: 100 requests per minute per client
- **Input Validation**: Zod schema validation for all inputs
- **Error Handling**: Structured error responses with codes
- **Timeout Protection**: Prevents hanging operations
- **Graceful Degradation**: Component failure handling

### ⚡ Performance
- **Smart Caching**: TTL-based caching for read operations
- **Connection Monitoring**: Real-time connection tracking
- **Health Monitoring**: Component health checking
- **Metrics Collection**: Performance and usage metrics
- **Memory Management**: Automatic cleanup and optimization

### 🔌 MCP Compliance
- **Full Protocol Support**: MCP 2024-11-05 specification
- **Backwards Compatibility**: Legacy tool support
- **Resource Management**: Enhanced resource handling
- **Logging Integration**: Structured logging support

## Implementation Highlights

### Security Implementation
```typescript
// Rate limiting with configurable limits
private rateLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.id || 'anonymous',
  points: 100,
  duration: 60,
});

// Input validation with Zod schemas
const validatedArgs = tool.inputSchema.parse(args);

// Timeout protection for all operations
await this.executeWithTimeout(
  () => tool.handler(validatedArgs),
  30000 // 30 second timeout
);
```

### Performance Optimization
```typescript
// Smart caching system
private cache = new Map<string, { data: any; expiry: number }>();

// Cache key generation
private generateCacheKey(toolName: string, args: any): string {
  const argsHash = crypto.createHash('sha256')
    .update(JSON.stringify(args))
    .digest('hex').substring(0, 16);
  return `tool:${toolName}:${argsHash}`;
}

// Automatic cache cleanup
private cleanupCache(): void {
  const now = Date.now();
  for (const [key, entry] of this.cache.entries()) {
    if (now > entry.expiry) {
      this.cache.delete(key);
    }
  }
}
```

### Health Monitoring
```typescript
// Comprehensive health checking
private async getSystemHealth(): Promise<any> {
  const health = {
    overall: 'healthy' as 'healthy' | 'degraded' | 'unhealthy',
    components: {} as Record<string, any>,
    timestamp: new Date().toISOString()
  };

  // Check each component health
  // LangGraph, Governance, RAG, NL2SQL

  return health;
}
```

## Tool Schemas

### Enhanced Tools
```typescript
// execute_workflow schema
z.object({
  workflowId: z.string().min(1),
  input: z.record(z.any()),
  governanceBypass: z.boolean().default(false),
  options: z.object({
    timeout: z.number().min(1000).max(300000).optional(),
    retries: z.number().min(0).max(5).optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  }).optional(),
})

// create_proposal schema
z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(20).max(5000),
  proposer: z.string().min(1),
  type: z.enum(['workflow', 'config', 'governance', 'emergency', 'upgrade']),
  category: z.enum(['standard', 'critical', 'constitutional']).default('standard'),
  // ... additional fields
})
```

## Error Handling

### Structured Error Format
```typescript
class LALOError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'LALOError';
  }
}

// Error codes:
// - TOOL_NOT_FOUND
// - RESOURCE_NOT_FOUND
// - RATE_LIMIT_EXCEEDED
// - GOVERNANCE_APPROVAL_REQUIRED
// - TIMEOUT
// - VALIDATION_ERROR
```

## Usage Examples

### Basic Usage
```typescript
import { LALOMCPServer } from './server.js';

const server = new LALOMCPServer();
await server.start();
```

### With Monitoring
```typescript
const server = new LALOMCPServer();
await server.start();

// Check metrics
console.log('Metrics:', server.serverMetrics);
console.log('Health:', server.serverHealth);
console.log('Connections:', server.activeConnectionCount);
```

### Graceful Shutdown
```typescript
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await server.stop();
  process.exit(0);
});
```

## Configuration

### Environment Variables
```bash
# Core
OPENAI_API_KEY=your-api-key
NODE_ENV=production

# MCP Server
MCP_PORT=3001
MCP_HOST=localhost
MCP_ENABLE_AUTH=true
MCP_MAX_CONNECTIONS=100

# Governance
GOVERNANCE_MCP_INTEGRATION=true

# Components
VECTOR_STORE=chroma
EMBEDDING_MODEL=text-embedding-3-small
NL2SQL_MODEL=gpt-4o-mini
```

## Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
npm run test:integration
```

### Performance Tests
```bash
npm run test:performance
```

## Deployment

### Development
```bash
npm run mcp:dev
```

### Production
```bash
npm run build
npm run mcp:start
```

### Docker
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm ci --only=production
RUN npm run build
CMD ["npm", "run", "mcp:start"]
```

## Monitoring

### Metrics
- Request rates and success rates
- Average response times
- Cache hit rates
- Error rates and types
- Active connections
- Component health status

### Health Checks
- Component availability
- Database connectivity
- External service health
- Memory and CPU usage

## Migration from Basic MCP Server

1. **Update Dependencies**
   ```bash
   npm install @modelcontextprotocol/sdk rate-limiter-flexible
   ```

2. **Update Environment Variables**
   Add new configuration variables

3. **Tool Migration** (Optional)
   - `lalo_workflow_execute` → `execute_workflow`
   - `lalo_proposal_create` → `create_proposal`
   - `lalo_document_search` → `search_knowledge`
   - `lalo_nl2sql_convert` → `nl2sql_query`
   - `lalo_status` → `system_status`

4. **Error Handling**
   Update error handling for new structured error format

5. **Monitoring**
   Implement monitoring for new metrics and health endpoints

## Contributing

1. Follow TypeScript best practices
2. Add tests for new features
3. Update documentation
4. Follow security guidelines
5. Add performance benchmarks

## License

MIT License - see LICENSE file for details.