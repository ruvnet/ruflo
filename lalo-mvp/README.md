# LALO MVP - LangGraph + Governance + MCP + RAG + NL2SQL

A comprehensive system that integrates **LangGraph** workflow orchestration, **Governance** voting mechanisms, **MCP** (Model Context Protocol) server, **RAG** (Retrieval-Augmented Generation), and **NL2SQL** natural language to SQL conversion.

## 🚀 Features

### LangGraph Workflow Orchestration
- **Workflow Definition**: Create complex workflows with nodes and edges
- **Parallel Execution**: Execute multiple workflows concurrently
- **Error Handling**: Robust error handling with retries and timeouts
- **State Management**: Persistent workflow state across executions

### Governance System
- **Proposal Creation**: Create proposals for workflow execution and system changes
- **Voting Mechanism**: Weighted voting system with configurable thresholds
- **Execution Control**: Automatic execution of passed proposals after delay
- **Transparency**: Full audit trail of proposals and votes

### MCP Server
- **Custom Tools**: 15+ LALO-specific tools for workflow, governance, RAG, and NL2SQL operations
- **Resource Management**: Access to system resources and statistics
- **Real-time Integration**: Live system monitoring and control

### RAG System
- **Vector Storage**: ChromaDB integration for semantic search
- **Document Management**: Add, update, and remove documents
- **Smart Chunking**: Intelligent document chunking with overlap
- **Embedding Generation**: OpenAI embeddings for semantic similarity

### NL2SQL Engine
- **Natural Language Processing**: Convert questions to SQL queries
- **Schema Awareness**: Context-aware query generation based on database schemas
- **Validation**: SQL validation and suggestion system
- **Context Integration**: RAG-enhanced query generation

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   LangGraph     │    │   Governance    │    │      RAG        │
│  Orchestrator   │◄──►│     System      │◄──►│    System       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         ▲                       ▲                       ▲
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                        LALO Core System                        │
└─────────────────────────────────────────────────────────────────┘
         ▲                       ▲                       ▲
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   MCP Server    │    │    NL2SQL       │    │   Integration   │
│     Tools       │    │    Engine       │    │     Layer       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 📦 Installation

1. **Clone and Install**:
   ```bash
   git clone <repository-url>
   cd lalo-mvp
   npm install
   ```

2. **Environment Setup**:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys and configuration
   ```

3. **Build**:
   ```bash
   npm run build
   ```

## 🔧 Configuration

### Required Environment Variables

```bash
# OpenAI API Key (Required)
OPENAI_API_KEY=your_openai_api_key_here

# Optional: Chroma Vector Database
CHROMA_HOST=localhost
CHROMA_PORT=8000

# Optional: MCP Server Configuration
MCP_PORT=3001
MCP_HOST=localhost
```

### System Configuration

The system uses TypeScript interfaces for configuration:

```typescript
interface LALOConfig {
  langgraph: LangGraphConfig;
  governance: GovernanceConfig;
  mcp: MCPConfig;
  rag: RAGConfig;
  nl2sql: NL2SQLConfig;
}
```

## 🚀 Usage

### Starting the System

```bash
# Development mode
npm run dev

# Production mode
npm start

# MCP Server only
npm run mcp:start
```

### Basic Operations

#### 1. Create and Execute Workflows

```typescript
import { LALOSystem } from './src/lalo.js';

const lalo = new LALOSystem();
await lalo.initialize();

// Create workflow
const workflow = {
  id: 'data-processing',
  name: 'Data Processing Pipeline',
  description: 'Process and validate data',
  nodes: [
    { id: 'start', type: 'start', name: 'Start', next: 'validate' },
    { id: 'validate', type: 'task', name: 'Validate', function: 'validate_input', next: 'end' },
    { id: 'end', type: 'end', name: 'End' }
  ],
  edges: [
    { from: 'start', to: 'validate' },
    { from: 'validate', to: 'end' }
  ]
};

await lalo.createWorkflow(workflow);

// Execute via governance
const proposalId = await lalo.executeGovernedWorkflow(
  'data-processing',
  { data: 'input data' },
  'user1',
  'Execute Data Processing',
  'Process incoming data batch'
);
```

#### 2. Governance Operations

```typescript
// Set voting power
lalo.governance.setVotingPower('user1', 10);
lalo.governance.setVotingPower('user2', 5);

// Create proposal
const proposalId = await lalo.governance.createProposal(
  'System Update',
  'Update system configuration',
  'user1',
  'config',
  { newSetting: 'value' }
);

// Vote on proposal
await lalo.governance.vote(proposalId, 'user2', 'for', 'I support this change');

// Execute after approval
await lalo.governance.executeProposal(proposalId);
```

#### 3. RAG Operations

```typescript
// Add documents
const docId = await lalo.addDocument(
  'LALO is a comprehensive system for workflow orchestration...',
  { type: 'documentation', version: '1.0' },
  'docs/overview.md'
);

// Search documents
const results = await lalo.rag.search({
  query: 'How to create workflows?',
  topK: 5,
  threshold: 0.7
});
```

#### 4. NL2SQL Operations

```typescript
// Add database schema
await lalo.nl2sql.addTableSchema({
  name: 'users',
  description: 'User accounts',
  columns: [
    { name: 'id', type: 'INTEGER', primaryKey: true, nullable: false },
    { name: 'username', type: 'VARCHAR(50)', nullable: false },
    { name: 'email', type: 'VARCHAR(100)', nullable: false }
  ],
  relationships: []
});

// Convert natural language to SQL
const result = await lalo.queryWithContext(
  'Show me all users created in the last week',
  true, // Use RAG for context
  true  // Validate SQL
);

console.log(result.sql); // Generated SQL query
console.log(result.confidence); // Confidence score
```

## 🔌 MCP Integration

The LALO system provides an MCP server with 15+ custom tools:

### Workflow Tools
- `lalo_workflow_create` - Create new workflows
- `lalo_workflow_execute` - Execute workflows
- `lalo_workflow_list` - List all workflows

### Governance Tools
- `lalo_proposal_create` - Create governance proposals
- `lalo_proposal_vote` - Vote on proposals
- `lalo_proposal_execute` - Execute approved proposals
- `lalo_voting_power_set` - Set voting power

### RAG Tools
- `lalo_document_add` - Add documents to knowledge base
- `lalo_document_search` - Search documents

### NL2SQL Tools
- `lalo_nl2sql_convert` - Convert natural language to SQL
- `lalo_schema_add` - Add database schemas

### System Tools
- `lalo_status` - Get system status

### Using with Claude Desktop

Add to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "lalo": {
      "command": "node",
      "args": ["path/to/lalo-mvp/dist/mcp/server.js"]
    }
  }
}
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test suite
npm test -- --testPathPattern=langgraph

# Watch mode
npm run test:watch
```

## 📁 Project Structure

```
src/
├── types/           # TypeScript type definitions
├── config/          # Configuration management
├── langgraph/       # Workflow orchestration
├── governance/      # Voting and proposals
├── mcp/            # MCP server implementation
├── rag/            # RAG system
├── nl2sql/         # Natural language to SQL
├── lalo.ts         # Main system integration
└── index.ts        # Entry point

tests/
├── langgraph/      # Workflow tests
├── governance/     # Governance tests
├── rag/           # RAG tests
├── nl2sql/        # NL2SQL tests
└── integration/   # Integration tests
```

## 🔍 System Status

Get comprehensive system status:

```typescript
const status = await lalo.getSystemStatus();
console.log(status);
```

Output:
```json
{
  "initialized": true,
  "components": {
    "langgraph": { "workflows": 5, "activeExecutions": 2 },
    "governance": { "totalProposals": 10, "activeProposals": 3 },
    "rag": { "totalDocuments": 50, "totalChunks": 200 },
    "nl2sql": { "totalSchemas": 5, "totalQueries": 25 },
    "mcp": true
  },
  "uptime": 3600,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## 📊 Monitoring and Observability

- **Workflow Execution**: Track workflow performance and errors
- **Governance Activity**: Monitor proposal creation and voting patterns
- **RAG Performance**: Document search metrics and relevance scores
- **NL2SQL Quality**: Query generation confidence and validation results
- **System Health**: Component status and resource usage

## 🛡️ Security Features

- **Input Validation**: All inputs validated with Zod schemas
- **Error Handling**: Comprehensive error handling with custom error types
- **Resource Limits**: Configurable limits for workflows, documents, and queries
- **Access Control**: Voting power-based access control for governance

## 🔧 Development

### Adding New Workflow Functions

```typescript
// In LangGraphOrchestrator
private async executeFunction(functionName: string, data: any): Promise<any> {
  switch (functionName) {
    case 'custom_function':
      return this.customFunction(data);
    // ... other functions
  }
}

private async customFunction(data: any): Promise<any> {
  // Implementation
  return { ...data, processed: true };
}
```

### Adding New MCP Tools

```typescript
// In LALOMCPServer
this.registerTool({
  name: 'lalo_custom_tool',
  description: 'Custom LALO tool',
  inputSchema: z.object({
    input: z.string()
  }),
  handler: async (params) => {
    // Implementation
    return { result: 'success' };
  }
});
```

## 📚 Documentation

- [LangGraph Documentation](./docs/langgraph.md)
- [Governance Guide](./docs/governance.md)
- [RAG System Guide](./docs/rag.md)
- [NL2SQL Guide](./docs/nl2sql.md)
- [MCP Tools Reference](./docs/mcp-tools.md)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Implement changes with tests
4. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🆘 Support

For issues and questions:
- GitHub Issues: [Create an issue](../../issues)
- Documentation: Check the docs/ directory
- Examples: See examples/ directory

---

**LALO MVP** - Bringing together the best of workflow orchestration, governance, RAG, and NL2SQL in one comprehensive system.