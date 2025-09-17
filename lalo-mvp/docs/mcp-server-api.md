# Enhanced LALO MCP Server API Documentation

## Overview

The Enhanced LALO MCP Server provides a comprehensive Model Context Protocol implementation with full LALO ecosystem integration, advanced security features, and performance optimizations.

## Features

### 🚀 Core Capabilities
- **Full MCP 2024-11-05 Protocol Compliance**
- **Comprehensive LALO Integration** (LangGraph + Governance + RAG + NL2SQL)
- **Advanced Security** (Rate limiting, Input validation, Error handling)
- **Performance Optimization** (Caching, Timeouts, Health monitoring)
- **Graceful Degradation** (Component failure handling)

### 🔧 Enhanced Tools

#### Core LALO Tools

##### `execute_workflow`
Execute workflows through the governance-controlled LALO system.

**Parameters:**
- `workflowId` (required): Workflow identifier
- `input` (required): Workflow input data
- `governanceBypass` (optional): Skip governance checks
- `options` (optional):
  - `timeout`: Execution timeout (1000-300000ms)
  - `retries`: Retry attempts (0-5)
  - `priority`: Execution priority ('low'|'medium'|'high'|'critical')

**Response:**
```json
{
  "success": true,
  "executionId": "exec-123456",
  "result": {...},
  "metadata": {...}
}
```

##### `create_proposal`
Create governance proposals for system changes.

**Parameters:**
- `title` (required): Proposal title (5-200 chars)
- `description` (required): Detailed description (20-5000 chars)
- `proposer` (required): Proposer identifier
- `type` (required): Proposal type ('workflow'|'config'|'governance'|'emergency'|'upgrade')
- `category` (optional): Priority category ('standard'|'critical'|'constitutional')
- `executionData` (optional): Data for proposal execution
- `metadata` (optional): Additional metadata
- `dependencies` (optional): Dependent proposal IDs
- `requiredApprovals` (optional): Required approval addresses

**Response:**
```json
{
  "success": true,
  "proposalId": "prop-123456",
  "status": "active",
  "votingPeriod": 86400000
}
```

##### `search_knowledge`
RAG-powered semantic search across the knowledge base.

**Parameters:**
- `query` (required): Search query
- `filters` (optional): Search filters
- `topK` (optional): Number of results (1-50, default: 10)
- `threshold` (optional): Relevance threshold (0-1, default: 0.7)
- `includeMetadata` (optional): Include result metadata (default: true)
- `searchType` (optional): Search type ('semantic'|'keyword'|'hybrid')

**Response:**
```json
{
  "success": true,
  "query": "search query",
  "resultCount": 5,
  "results": [
    {
      "content": "Document content...",
      "score": 0.95,
      "relevance": 0.87,
      "metadata": {...},
      "source": "document.pdf"
    }
  ],
  "searchMetadata": {...}
}
```

##### `nl2sql_query`
Convert natural language to SQL using advanced NL2SQL engine.

**Parameters:**
- `query` (required): Natural language query
- `context` (optional): Query context
- `validate` (optional): Validate SQL syntax (default: true)
- `explain` (optional): Include explanation (default: false)
- `outputFormat` (optional): Output format ('sql'|'explained'|'both')

**Response:**
```json
{
  "success": true,
  "naturalLanguage": "Find all users created this month",
  "sql": "SELECT * FROM users WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)",
  "confidence": 0.92,
  "tables": ["users"],
  "metadata": {...},
  "explanation": {...}
}
```

##### `system_status`
Comprehensive system health and status information.

**Parameters:**
- `includeMetrics` (optional): Include performance metrics (default: true)
- `includeConnections` (optional): Include connection info (default: false)
- `includeHealth` (optional): Include health status (default: true)
- `detailed` (optional): Include detailed component info (default: false)

**Response:**
```json
{
  "timestamp": "2025-09-17T17:00:00.000Z",
  "server": {
    "name": "lalo-mcp-server",
    "version": "1.0.0",
    "uptime": 3600,
    "initialized": true
  },
  "health": {
    "overall": "healthy",
    "components": {...}
  },
  "metrics": {
    "totalRequests": 1234,
    "successfulRequests": 1200,
    "failedRequests": 34,
    "averageResponseTime": 250,
    "cache": {...}
  }
}
```

#### Legacy Tools (Backwards Compatibility)

The server maintains backwards compatibility with original LALO tools:
- `lalo_workflow_create`
- `lalo_workflow_execute`
- `lalo_workflow_list`
- `lalo_proposal_create`
- `lalo_proposal_vote`
- `lalo_proposal_execute`
- `lalo_voting_power_set`
- `lalo_document_add`
- `lalo_document_search`
- `lalo_nl2sql_convert`
- `lalo_schema_add`
- `lalo_status`

### 🔒 Security Features

#### Rate Limiting
- **Default**: 100 requests per minute per client
- **Configurable**: Via environment variables
- **Response**: HTTP 429 with retry-after header

#### Input Validation
- **Zod Schema Validation**: All inputs validated against strict schemas
- **Sanitization**: Automatic input sanitization
- **Type Safety**: Full TypeScript type checking

#### Error Handling
- **Structured Errors**: Consistent error format with codes
- **Graceful Degradation**: Component failure handling
- **Security**: No sensitive information in error responses

### ⚡ Performance Features

#### Caching
- **Smart Caching**: Automatic caching for read-only operations
- **TTL Management**: Configurable time-to-live
- **Memory Efficient**: Automatic cache cleanup

#### Timeout Protection
- **Tool Execution**: 30-second timeout for tool calls
- **Resource Access**: 15-second timeout for resources
- **Configurable**: Environment-based configuration

#### Health Monitoring
- **Real-time**: Continuous component health monitoring
- **Metrics**: Performance and usage metrics
- **Alerting**: Automatic degradation detection

### 🔧 Resources

#### Available Resources
- `lalo://workflows` - List of registered workflows
- `lalo://proposals` - Governance proposals
- `lalo://governance/stats` - Governance statistics
- `lalo://rag/stats` - RAG system statistics
- `lalo://nl2sql/schemas` - Database schemas

#### Resource Features
- **Caching**: 2-minute cache for resource content
- **Timeout**: 15-second timeout protection
- **Error Handling**: Graceful error responses

### 🚀 Deployment

#### Environment Variables
```bash
# Core Configuration
OPENAI_API_KEY=your-api-key
NODE_ENV=production

# MCP Configuration
MCP_PORT=3001
MCP_HOST=localhost
MCP_ENABLE_AUTH=true
MCP_MAX_CONNECTIONS=100

# Rate Limiting
RATE_LIMIT_POINTS=100
RATE_LIMIT_DURATION=60

# Component Configuration
GOVERNANCE_MCP_INTEGRATION=true
VECTOR_STORE=chroma
EMBEDDING_MODEL=text-embedding-3-small
```

#### Usage Examples

##### Claude Desktop Configuration
```json
{
  "mcpServers": {
    "lalo": {
      "command": "node",
      "args": ["dist/mcp/server.js"],
      "cwd": "/path/to/lalo-mvp"
    }
  }
}
```

##### Programmatic Usage
```typescript
import { LALOMCPServer } from './src/mcp/server.js';

const server = new LALOMCPServer();
await server.start();

// Monitor metrics
console.log(server.serverMetrics);
console.log(server.serverHealth);
console.log(server.activeConnectionCount);

// Graceful shutdown
await server.stop();
```

### 📊 Monitoring

#### Metrics Available
- **Request Metrics**: Total, successful, failed requests
- **Performance**: Average response time, cache hit rate
- **Security**: Rate limit hits, authentication failures
- **Health**: Component status, error rates

#### Health Endpoints
- **Overall Health**: System-wide health status
- **Component Health**: Individual component status
- **Metrics**: Real-time performance metrics

### 🛠 Development

#### Building
```bash
npm run build      # Build entire project
npm run build:mcp  # Build MCP server specifically
```

#### Testing
```bash
npm test           # Run test suite
npm run test:coverage  # Coverage report
```

#### Development Mode
```bash
npm run mcp:dev    # Development server with hot reload
```

### 📝 API Reference

For complete API reference, see the tool schemas defined in the source code. All tools use Zod validation schemas for type safety and runtime validation.

### 🔄 Migration Guide

When migrating from the basic MCP server:

1. **Update Dependencies**: Install enhanced dependencies
2. **Environment Variables**: Update configuration
3. **Tool Names**: Optionally migrate to new tool names
4. **Error Handling**: Update error handling for new error format
5. **Monitoring**: Implement new monitoring capabilities

The enhanced server maintains full backwards compatibility with existing integrations.