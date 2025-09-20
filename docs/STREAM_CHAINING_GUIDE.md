# Stream Chaining Guide - Claude Flow Alpha 85

## Overview

Stream chaining is a powerful new feature in Claude Flow Alpha 85 that enables real-time JSON streaming between agents, automatic pipeline creation, and sophisticated multi-agent workflows. This system allows for token-level cognitive state flow and seamless agent-to-agent communication.

## Key Features

### 🌊 Real-time JSON Streaming
- Newline-delimited JSON format for efficient parsing
- Structured message format with metadata
- Compression support (gzip, lz4)
- Configurable batch sizes and flush intervals

### 🔗 Automatic Stream Wiring
- Intelligent dependency detection from task descriptions
- Auto-wiring of pipeline stages
- Dynamic connection management
- Graceful error handling and recovery

### 🚀 Pipeline Automation
- Pre-built templates for common workflow patterns
- Custom pipeline creation
- Parallel execution support
- Real-time monitoring and metrics

### 📊 Structured Communication
- Type-safe message formats
- Metadata tracking for lineage
- Heartbeat and status monitoring
- Error propagation and handling

## Stream Message Format

```typescript
interface StreamMessage {
  id: string;                    // Unique message identifier
  timestamp: number;             // Unix timestamp
  type: 'message' | 'tool_call' | 'result' | 'error' | 'status' | 'heartbeat';
  source: string;                // Source agent ID
  target?: string;               // Target agent ID (optional)
  data: any;                     // Message payload
  metadata?: {                   // Optional metadata
    chainId?: string;            // Pipeline chain ID
    parentId?: string;           // Parent message ID
    dependencies?: string[];     // Task dependencies
    phase?: string;              // Processing phase
    priority?: number;           // Message priority
  };
}
```

## Built-in Pipeline Templates

### 1. Generate → Critique → Revise (GCR)
**Use Case**: Recursive content improvement
```bash
claude-flow stream template create generate-critique-revise --name content-improver
```

**Workflow**:
1. **Generator Agent**: Creates initial content
2. **Critic Agent**: Analyzes and provides feedback
3. **Reviser Agent**: Improves content based on feedback

### 2. Analyze → Score → Synthesize (ASS)
**Use Case**: Multi-phase analysis with scoring
```bash
claude-flow stream template create analyze-score-synthesize --name data-analyzer
```

**Workflow**:
1. **Analyzer Agent**: Processes input data
2. **Scorer Agent**: Evaluates quality and relevance
3. **Synthesizer Agent**: Combines results into final output

### 3. Research → Implement → Test (RIT)
**Use Case**: Complete development workflow
```bash
claude-flow stream template create research-implement-test --name dev-pipeline
```

**Workflow**:
1. **Researcher Agent**: Gathers requirements and best practices
2. **Implementer Agent**: Writes code based on research
3. **Tester Agent**: Creates and runs comprehensive tests

### 4. Parallel Analysis
**Use Case**: Concurrent multi-agent analysis
```bash
claude-flow stream template create parallel-analysis --name multi-analysis
```

**Workflow**:
1. **Security Analyzer**: Checks for security issues
2. **Performance Analyzer**: Identifies performance bottlenecks
3. **Code Quality Analyzer**: Reviews code quality metrics
4. **Architecture Analyzer**: Evaluates architectural patterns
5. **Synthesizer**: Combines all analysis results

## CLI Commands

### Stream Connections
```bash
# Create direct connection between agents
claude-flow stream connect agent1 agent2 --format json-stream --compression gzip

# Monitor connection status
claude-flow stream status --verbose
```

### Pipeline Management
```bash
# Create pipeline from template
claude-flow stream template create generate-critique-revise --name my-pipeline

# List available templates
claude-flow stream template list

# Execute pipeline with input
claude-flow stream execute pipeline-123 '{"text":"Hello world"}' --format json

# Monitor pipeline execution
claude-flow stream monitor --interval 5
```

### Auto-dependency Detection
```bash
# Analyze task dependencies
claude-flow stream auto-wire tasks.json

# Create pipeline from dependencies
claude-flow stream auto-wire tasks.json --create-pipeline
```

## MCP Tool Integration

Stream chaining integrates seamlessly with the MCP (Model Context Protocol) system:

### Stream Connection Tool
```javascript
mcp__claude-flow-mcp__stream_connect({
  sourceAgentId: "researcher-1",
  targetAgentId: "analyst-1", 
  format: "json-stream",
  compression: "gzip"
})
```

### Pipeline Creation Tool
```javascript
mcp__claude-flow-mcp__stream_pipeline({
  action: "create",
  templateName: "generate-critique-revise",
  name: "content-pipeline",
  parallelism: 2
})
```

### Pipeline Execution Tool
```javascript
mcp__claude-flow-mcp__stream_execute({
  pipelineId: "gcr-123",
  input: {
    content: "Write about AI agent orchestration",
    requirements: ["technical", "engaging"]
  },
  timeout: 300000
})
```

### Auto-wiring Tool
```javascript
mcp__claude-flow-mcp__stream_autowire({
  tasks: [
    { id: "research", type: "research", description: "Research market trends" },
    { id: "analyze", type: "analysis", description: "Analyze research data" },
    { id: "report", type: "documentation", description: "Create analysis report" }
  ],
  createPipeline: true
})
```

## Advanced Usage Examples

### Example 1: Content Creation Pipeline
```javascript
// Create content improvement pipeline
const pipeline = await processor.createPipelineFromTemplate(
  'generate-critique-revise',
  { name: 'Blog Post Improver', parallelism: 1 }
);

// Execute with blog post requirements
const input = {
  topic: 'Stream Processing in AI Systems',
  audience: 'developers',
  length: 2000,
  tone: 'technical but accessible'
};

const results = await processor.executePipeline(pipeline.id, input);
```

### Example 2: Code Analysis Workflow
```javascript
// Set up parallel analysis pipeline
const pipeline = await processor.createPipelineFromTemplate(
  'parallel-analysis',
  { name: 'Code Review Pipeline', parallelism: 4 }
);

// Analyze codebase
const input = {
  repository: 'https://github.com/user/repo',
  language: 'typescript',
  frameworks: ['react', 'express'],
  scope: ['security', 'performance', 'quality']
};

const analysisResults = await processor.executePipeline(pipeline.id, input);
```

### Example 3: Custom Dependency Detection
```javascript
// Define complex tasks
const tasks = [
  { id: 'ui-design', type: 'design', description: 'Design user interface mockups' },
  { id: 'api-spec', type: 'architecture', description: 'Create API specification' },
  { id: 'frontend', type: 'coding', description: 'Implement frontend based on UI design' },
  { id: 'backend', type: 'coding', description: 'Implement backend API from specification' },
  { id: 'integration', type: 'testing', description: 'Test frontend and backend integration' },
];

// Auto-detect dependencies
const dependencies = StreamChainUtils.detectDependencies(tasks);
const suggestedTemplate = StreamChainUtils.suggestPipelineTemplate(tasks);

// Create custom pipeline
const customPipeline = await processor.createCustomPipeline({
  name: 'Full Stack Development',
  stages: tasks.map(task => ({
    id: task.id,
    name: task.description,
    agentType: getAgentTypeForTask(task.type),
    dependencies: dependencies.get(task.id) || [],
  })),
  autoWire: true,
  parallelism: 2
});
```

## Performance Characteristics

- **Throughput**: Up to 1000 messages/second per connection
- **Latency**: <10ms message processing overhead
- **Memory**: Efficient streaming with configurable buffer sizes
- **Scalability**: Supports hundreds of concurrent connections
- **Reliability**: Automatic retry and error recovery

## Best Practices

### 1. Pipeline Design
- Keep stages focused on single responsibilities
- Use descriptive names for stages and connections
- Plan for error handling and timeouts
- Consider parallelism opportunities

### 2. Message Design
- Include sufficient metadata for debugging
- Use consistent data structures
- Implement proper error reporting
- Add progress indicators for long operations

### 3. Monitoring
- Set up real-time monitoring for production pipelines
- Track key metrics (throughput, latency, errors)
- Use logging for debugging and audit trails
- Implement health checks and alerting

### 4. Resource Management
- Clean up connections and pipelines when done
- Monitor memory usage with large data flows
- Use compression for high-volume streams
- Implement circuit breakers for fault tolerance

## Troubleshooting

### Common Issues

**Pipeline Execution Timeout**
```bash
# Increase timeout for complex pipelines
claude-flow stream execute pipeline-123 '{"data": "..."}' --timeout 600
```

**Dependency Detection Failures**
```bash
# Use explicit dependencies in task definitions
# Include keywords like "after", "depends on", "requires"
```

**Connection Drops**
```bash
# Check network connectivity and firewall settings
# Monitor connection health with heartbeats
claude-flow stream status --detailed
```

**Memory Issues**
```bash
# Reduce batch sizes for large data streams
# Enable compression for better memory efficiency
claude-flow stream connect agent1 agent2 --compression gzip --batch-size 10
```

## Future Enhancements

- **Stream Persistence**: Durable queues for reliable message delivery
- **Cross-Network Streaming**: Support for distributed agent deployments
- **Visual Pipeline Builder**: GUI for creating complex workflows
- **Stream Analytics**: Advanced metrics and performance insights
- **Integration Plugins**: Connectors for external systems and APIs

## Examples and Demos

Run the included demo to see stream chaining in action:

```bash
cd /Users/marc/Documents/Cline/MCP/claude-flow-mcp
node examples/stream-chaining-demo.js
```

This demo showcases:
- Direct stream connections
- Pipeline creation from templates
- Auto-dependency detection
- Parallel processing
- Real-time monitoring

## Support

For questions and support:
- Documentation: https://github.com/ruvnet/claude-code-flow/wiki/stream-chaining
- Issues: https://github.com/ruvnet/claude-code-flow/issues
- Community: Claude Flow Discord Server

---

**Stream chaining in Claude Flow Alpha 85 enables a new level of sophisticated multi-agent coordination, bringing real-time communication and intelligent workflow automation to AI agent orchestration.**