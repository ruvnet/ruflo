# MCP (Model Context Protocol) Implementation

This document describes the complete MCP implementation for Claude-Flow, providing a production-ready interface for AI tool integration.

## Overview

The MCP implementation includes:
- **Full Protocol Compliance**: JSON-RPC 2.0 with MCP extensions
- **Multiple Transports**: stdio, HTTP with WebSocket support
- **Authentication & Authorization**: Token-based, Basic auth, and OAuth ready
- **Session Management**: Client session tracking and lifecycle management  
- **Load Balancing**: Rate limiting, circuit breaker, and request queuing
- **Comprehensive Tools**: Full Claude-Flow functionality exposure
- **Error Handling**: Robust error reporting and recovery
- **Metrics & Monitoring**: Performance tracking and health checks

## Architecture

```
┌─────────────────────────────────────────────────┐
│                MCP Server                       │
├─────────────────────────────────────────────────┤
│  Session Manager  │  Auth Manager  │  Load Bal. │
├─────────────────────────────────────────────────┤
│           Tool Registry & Router                │
├─────────────────────────────────────────────────┤
│    stdio Transport    │     HTTP Transport      │
│                       │   (REST + WebSocket)   │
└─────────────────────────────────────────────────┘
```

## Core Components

### 1. MCP Server (`src/mcp/server.ts`)

The central server implementation that orchestrates all MCP functionality.

**Key Features:**
- Protocol version negotiation (2024-11-05)
- Client capability negotiation
- Tool registration and management
- Request routing and processing
- Session lifecycle management
- Health monitoring and metrics

**Usage:**
```typescript
import { MCPServer } from './src/mcp/server.ts';

const server = new MCPServer(config, eventBus, logger, orchestrator);
await server.start();
```

### 2. Transport Layer

#### stdio Transport (`src/mcp/transports/stdio.ts`)

For command-line integration and process communication.

**Features:**
- JSON-RPC message parsing
- Line-buffered communication
- Notification support
- Error recovery

#### HTTP Transport (`src/mcp/transports/http.ts`)

For remote API access and web integration.

**Features:**
- RESTful JSON-RPC endpoint (`/rpc`)
- WebSocket support (`/ws`) for real-time notifications
- CORS handling
- Authentication integration
- Request/response logging

### 3. Session Management (`src/mcp/session-manager.ts`)

Tracks client connections and manages their lifecycle.

**Features:**
- Session creation and initialization
- Protocol version validation
- Session expiration and cleanup
- Client capability tracking
- Authentication state management

**Session Lifecycle:**
1. **Create**: New session with transport type
2. **Initialize**: Protocol handshake and capability negotiation
3. **Authenticate**: Optional authentication (if enabled)
4. **Active**: Normal operation with activity tracking
5. **Expire/Terminate**: Cleanup and resource release

### 4. Authentication & Authorization (`src/mcp/auth.ts`)

Flexible authentication system supporting multiple methods.

**Supported Methods:**
- **Token**: Bearer token validation
- **Basic**: Username/password authentication
- **OAuth**: JWT token validation (extensible)

**Permission System:**
```typescript
// Built-in permissions
const permissions = {
  'system.*': 'All system operations',
  'agents.spawn': 'Spawn new agents',
  'tasks.create': 'Create tasks',
  'memory.read': 'Read memory entries',
  // ... more permissions
};
```

### 5. Load Balancing (`src/mcp/load-balancer.ts`)

Production-ready request management and protection.

**Features:**
- **Rate Limiting**: Token bucket algorithm per session/global
- **Circuit Breaker**: Automatic failure detection and recovery
- **Request Queuing**: Backpressure handling
- **Metrics Tracking**: Performance monitoring

### 6. Tool Registry (`src/mcp/tools.ts`)

Manages tool registration, validation, and execution.

**Features:**
- JSON Schema validation
- Namespace-based organization (`namespace/tool`)
- Input/output validation
- Error handling and reporting
- Execution context injection

### 7. Claude-Flow Tools (`src/mcp/claude-flow-tools.ts`)

Complete set of tools exposing Claude-Flow functionality.

**Tool Categories:**
- **Agent Management**: spawn, list, terminate, info
- **Task Management**: create, list, status, cancel, assign
- **Memory Management**: query, store, delete, export, import
- **System Monitoring**: status, metrics, health
- **Configuration**: get, update, validate
- **Workflow**: execute, create, list
- **Terminal**: execute, list, create

## Configuration

### Basic Configuration

```json
{
  "mcp": {
    "transport": "stdio",
    "host": "localhost",
    "port": 3000,
    "tlsEnabled": false,
    "sessionTimeout": 3600000,
    "maxSessions": 100,
    "enableMetrics": true,
    "corsEnabled": true,
    "corsOrigins": ["*"]
  }
}
```

### Authentication Configuration

```json
{
  "mcp": {
    "auth": {
      "enabled": true,
      "method": "token",
      "tokens": ["your-secret-token"],
      "sessionTimeout": 3600000
    }
  }
}
```

### Load Balancer Configuration

```json
{
  "mcp": {
    "loadBalancer": {
      "enabled": true,
      "strategy": "round-robin",
      "maxRequestsPerSecond": 100,
      "circuitBreakerThreshold": 5,
      "healthCheckInterval": 30000
    }
  }
}
```

## Protocol Compliance

### Initialization Sequence

1. **Client connects** via transport
2. **Initialize request** with protocol version and capabilities
3. **Server responds** with server info and capabilities
4. **Client can now make requests** to available tools

### Example Initialize Request

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": {"major": 2024, "minor": 11, "patch": 5},
    "capabilities": {
      "tools": {"listChanged": true},
      "logging": {"level": "info"}
    },
    "clientInfo": {
      "name": "claude-client",
      "version": "1.0.0"
    }
  }
}
```

### Example Tool Call

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "agents/spawn",
  "params": {
    "type": "researcher",
    "name": "Research Assistant",
    "capabilities": ["web_search", "data_analysis"]
  }
}
```

## Tool Usage Examples

### Spawn an Agent

```bash
# Via CLI
claude-flow mcp-call agents/spawn '{"type": "researcher", "name": "Research Assistant"}'

# Via HTTP
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "agents/spawn",
    "params": {
      "type": "researcher",
      "name": "Research Assistant"
    }
  }'
```

### Create and Execute a Task

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tasks/create",
  "params": {
    "type": "research",
    "description": "Research quantum computing trends",
    "priority": 8,
    "assignToAgentType": "researcher"
  }
}
```

### Query Memory

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "memory/query",
  "params": {
    "search": "quantum computing",
    "type": "insight",
    "limit": 10
  }
}
```

## Error Handling

The MCP implementation follows JSON-RPC 2.0 error codes:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": {
      "validation_errors": ["Missing required field: type"]
    }
  }
}
```

### Error Codes

- `-32700`: Parse error (invalid JSON)
- `-32600`: Invalid request (missing jsonrpc, method, etc.)
- `-32601`: Method not found
- `-32602`: Invalid params
- `-32603`: Internal error
- `-32000`: Rate limit exceeded
- `-32001`: Authentication required
- `-32002`: Server not initialized

## Security Features

### Authentication

```typescript
// Token-based authentication
const authResult = await authManager.authenticate('bearer-token-123');

// Basic authentication
const authResult = await authManager.authenticate({
  username: 'user',
  password: 'pass'
});
```

### Authorization

```typescript
// Check permission before tool execution
const hasPermission = authManager.authorize(session, 'agents.spawn');
if (!hasPermission) {
  throw new Error('Insufficient permissions');
}
```

### Rate Limiting

```typescript
// Automatic rate limiting per session
const allowed = await loadBalancer.shouldAllowRequest(session, request);
if (!allowed) {
  throw new Error('Rate limit exceeded');
}
```

## Monitoring & Metrics

### Health Check

```bash
curl http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "system/health"
  }'
```

### Metrics

The server provides comprehensive metrics:

```json
{
  "totalRequests": 1542,
  "successfulRequests": 1489,
  "failedRequests": 53,
  "averageResponseTime": 145.2,
  "activeSessions": 12,
  "toolInvocations": {
    "agents/spawn": 23,
    "tasks/create": 87,
    "memory/query": 156
  },
  "rateLimitedRequests": 5,
  "circuitBreakerTrips": 2
}
```

## Testing

### Run Tests

```bash
# All tests
deno run --allow-all scripts/test-mcp.ts --all --coverage

# Unit tests only
deno run --allow-all scripts/test-mcp.ts --unit

# Integration tests only
deno run --allow-all scripts/test-mcp.ts --integration

# Watch mode
deno run --allow-all scripts/test-mcp.ts --watch

# Filter specific tests
deno run --allow-all scripts/test-mcp.ts --filter server
```

### Test Coverage

The test suite includes:
- **Unit Tests**: Individual component testing
- **Integration Tests**: End-to-end workflow testing
- **Performance Tests**: Load and stress testing
- **Security Tests**: Authentication and authorization testing

## Deployment

### stdio Mode (Command Line)

```bash
# Start MCP server
claude-flow start --mcp-transport stdio

# Client connection
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}' | claude-flow mcp
```

### HTTP Mode (Web API)

```bash
# Start HTTP server
claude-flow start --mcp-transport http --port 3000

# Client connection
curl -X POST http://localhost:3000/rpc -H "Content-Type: application/json" -d '{...}'
```

### Docker Deployment

```dockerfile
FROM denoland/deno:alpine

WORKDIR /app
COPY . .

RUN deno cache src/cli/index.ts

EXPOSE 3000

CMD ["deno", "run", "--allow-all", "src/cli/index.ts", "start", "--mcp-transport", "http"]
```

## Best Practices

### Tool Development

1. **Use descriptive namespaces**: `agents/`, `tasks/`, `memory/`
2. **Validate input thoroughly**: Use JSON Schema
3. **Handle errors gracefully**: Provide meaningful error messages
4. **Document parameters**: Clear descriptions and examples
5. **Test extensively**: Unit and integration tests

### Security

1. **Enable authentication** for production
2. **Use HTTPS** for HTTP transport
3. **Implement rate limiting** to prevent abuse
4. **Validate all inputs** to prevent injection attacks
5. **Log security events** for monitoring

### Performance

1. **Enable load balancing** for high-traffic scenarios
2. **Monitor metrics** regularly
3. **Set appropriate timeouts** for long-running operations
4. **Use WebSockets** for real-time communication
5. **Implement circuit breakers** for external dependencies

## Troubleshooting

### Common Issues

**Connection Refused**
```bash
# Check if server is running
curl -f http://localhost:3000/rpc || echo "Server not running"
```

**Authentication Errors**
```bash
# Verify token
curl -H "Authorization: Bearer your-token" http://localhost:3000/rpc
```

**Rate Limiting**
```bash
# Check current limits
curl http://localhost:3000/rpc -d '{"jsonrpc":"2.0","id":1,"method":"system/metrics"}'
```

### Debug Mode

```bash
# Enable debug logging
claude-flow start --log-level debug --mcp-transport http
```

### Health Monitoring

```bash
# Continuous health monitoring
watch -n 5 'curl -s http://localhost:3000/rpc -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"system/health\"}" | jq'
```

## Contributing

1. **Add new tools** in `src/mcp/claude-flow-tools.ts`
2. **Extend transports** by implementing `ITransport`
3. **Add authentication methods** in `src/mcp/auth.ts`
4. **Write comprehensive tests** for all new features
5. **Update documentation** with examples and usage

## License

This MCP implementation is part of Claude-Flow and follows the same MIT license.