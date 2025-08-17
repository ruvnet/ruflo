# Examples and Use Cases

This directory contains practical examples and real-world use cases for Claude-Flow's multi-agent orchestration system.

## Quick Examples

### Basic Agent Workflow

```bash
# 1. Start Claude-Flow
npx claude-flow start

# 2. Create a research agent
claude-flow agent spawn researcher --name "AI Research Assistant"

# 3. Assign a research task
claude-flow task create research "Analyze the latest developments in Large Language Models"

# 4. Monitor progress
claude-flow task list --watch
```

### Multi-Agent Collaboration

```bash
# Spawn specialized agents
claude-flow agent spawn researcher --name "Data Researcher"
claude-flow agent spawn analyst --name "Data Analyst"
claude-flow agent spawn coordinator --name "Project Manager"

# Create coordinated workflow
claude-flow workflow execute ./examples/research-analysis-workflow.json
```

## Example Categories

### 🔬 Research and Analysis
- [Academic Research Pipeline](./research/academic-pipeline.md)
- [Market Analysis Workflow](./research/market-analysis.md)
- [Competitive Intelligence](./research/competitive-intelligence.md)

### 💻 Software Development
- [Code Review Automation](./development/code-review.md)
- [Testing and QA Pipeline](./development/testing-pipeline.md)
- [Documentation Generation](./development/docs-generation.md)

### 📊 Data Processing
- [Data Analysis Pipeline](./data/analysis-pipeline.md)
- [Report Generation](./data/report-generation.md)
- [ETL Workflows](./data/etl-workflows.md)

### 🏢 Business Operations
- [Customer Support Automation](./business/customer-support.md)
- [Content Creation Pipeline](./business/content-creation.md)
- [Process Optimization](./business/process-optimization.md)

### 🧪 Experimental Features
- [Advanced Memory Usage](./experimental/advanced-memory.md)
- [Custom Agent Types](./experimental/custom-agents.md)
- [Plugin Development](./experimental/plugins.md)

## Workflow Templates

Ready-to-use workflow templates for common scenarios:

### Research and Analysis Template

```json
{
  "name": "Research and Analysis Workflow",
  "description": "Comprehensive research followed by detailed analysis",
  "parameters": {
    "topic": { "type": "string", "required": true },
    "depth": { "type": "string", "default": "standard", "enum": ["basic", "standard", "comprehensive"] }
  },
  "tasks": [
    {
      "id": "primary_research",
      "type": "research",
      "description": "Conduct primary research on {{topic}}",
      "assignTo": "researcher",
      "timeout": 1800000
    },
    {
      "id": "data_analysis",
      "type": "analysis",
      "description": "Analyze research findings",
      "dependencies": ["primary_research"],
      "assignTo": "analyst",
      "timeout": 1200000
    },
    {
      "id": "report_compilation",
      "type": "coordination",
      "description": "Compile comprehensive report",
      "dependencies": ["data_analysis"],
      "assignTo": "coordinator",
      "timeout": 900000
    }
  ]
}
```

### Software Development Template

```json
{
  "name": "Feature Development Workflow",
  "description": "End-to-end feature development pipeline",
  "parameters": {
    "feature": { "type": "string", "required": true },
    "priority": { "type": "string", "default": "normal", "enum": ["low", "normal", "high", "urgent"] }
  },
  "tasks": [
    {
      "id": "requirements_analysis",
      "type": "analysis",
      "description": "Analyze requirements for {{feature}}",
      "assignTo": "analyst"
    },
    {
      "id": "implementation",
      "type": "implementation",
      "description": "Implement {{feature}}",
      "dependencies": ["requirements_analysis"],
      "assignTo": "implementer"
    },
    {
      "id": "testing",
      "type": "testing",
      "description": "Test {{feature}} implementation",
      "dependencies": ["implementation"],
      "assignTo": "implementer",
      "parallel": true
    },
    {
      "id": "documentation",
      "type": "documentation",
      "description": "Document {{feature}}",
      "dependencies": ["implementation"],
      "assignTo": "implementer",
      "parallel": true
    }
  ]
}
```

## Integration Examples

### VSCode Integration

```typescript
// VSCode extension integration example
import { workspace, window } from 'vscode';
import { ClaudeFlow } from 'claude-flow';

export class ClaudeFlowExtension {
  private claudeFlow: ClaudeFlow;

  async activate() {
    this.claudeFlow = new ClaudeFlow({
      terminal: {
        type: 'vscode',
        integration: {
          workspaceIntegration: true,
          showProgress: true
        }
      }
    });

    await this.claudeFlow.start();
    
    // Register commands
    vscode.commands.registerCommand('claude-flow.analyzeCode', 
      () => this.analyzeCurrentFile());
  }

  private async analyzeCurrentFile() {
    const editor = window.activeTextEditor;
    if (!editor) return;

    const agent = await this.claudeFlow.spawnAgent({
      type: 'analyst',
      name: 'Code Analyzer'
    });

    const result = await this.claudeFlow.executeTask({
      type: 'analysis',
      description: 'Analyze code quality and suggest improvements',
      input: {
        code: editor.document.getText(),
        language: editor.document.languageId,
        file: editor.document.fileName
      },
      assignTo: agent.id
    });

    // Show results in VSCode
    await this.showAnalysisResults(result);
  }
}
```

### Web API Integration

```typescript
// Express.js API integration
import express from 'express';
import { ClaudeFlow } from 'claude-flow';

const app = express();
const claudeFlow = new ClaudeFlow();

app.post('/api/analyze', async (req, res) => {
  try {
    const { data, analysisType } = req.body;

    const task = await claudeFlow.createTask({
      type: 'analysis',
      description: `Perform ${analysisType} analysis`,
      input: data,
      priority: 'high'
    });

    const result = await claudeFlow.waitForCompletion(task.id);
    
    res.json({
      success: true,
      taskId: task.id,
      result: result.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(3000, () => {
  console.log('Claude-Flow API server running on port 3000');
});
```

## Performance Examples

### Optimized Configuration

```json
{
  "name": "High-Performance Configuration",
  "description": "Optimized for maximum throughput",
  "orchestrator": {
    "maxConcurrentAgents": 20,
    "taskQueueSize": 1000,
    "healthCheckInterval": 60000
  },
  "memory": {
    "backend": "sqlite",
    "cacheSizeMB": 512,
    "backends": {
      "sqlite": {
        "options": {
          "journalMode": "WAL",
          "cacheSize": 50000,
          "maxConnections": 50
        }
      }
    }
  },
  "terminal": {
    "poolSize": 15,
    "recycleAfter": 50
  },
  "tasks": {
    "defaults": {
      "maxParallel": 10
    },
    "queue": {
      "strategy": "round_robin"
    }
  }
}
```

### Batch Processing Example

```typescript
// Efficient batch processing
import { ClaudeFlow } from 'claude-flow';

async function processBatch(items: any[]) {
  const claudeFlow = new ClaudeFlow();
  
  // Create batch task
  const batchTask = await claudeFlow.createBatch({
    template: {
      type: 'analysis',
      timeout: 300000
    },
    items: items.map(item => ({
      id: item.id,
      data: item.data
    })),
    batchConfig: {
      maxConcurrent: 8,
      aggregateResults: true,
      failureHandling: 'continue'
    }
  });

  // Monitor progress
  const results = await claudeFlow.waitForBatch(batchTask.id, {
    onProgress: (progress) => {
      console.log(`Progress: ${progress.percentage}%`);
    }
  });

  return results;
}
```

## Advanced Use Cases

### Multi-Tenant System

```typescript
// Multi-tenant configuration
class MultiTenantClaudeFlow {
  private instances = new Map<string, ClaudeFlow>();

  async getTenantInstance(tenantId: string): Promise<ClaudeFlow> {
    if (!this.instances.has(tenantId)) {
      const instance = new ClaudeFlow({
        memory: {
          namespaces: {
            enabled: true,
            defaultNamespace: tenantId,
            strictIsolation: true
          }
        },
        security: {
          isolation: {
            tenantId: tenantId,
            resourceIsolation: true
          }
        }
      });
      
      await instance.start();
      this.instances.set(tenantId, instance);
    }

    return this.instances.get(tenantId)!;
  }

  async executeForTenant(tenantId: string, task: any) {
    const instance = await this.getTenantInstance(tenantId);
    return await instance.executeTask(task);
  }
}
```

### Distributed Processing

```typescript
// Distributed processing across multiple nodes
class DistributedClaudeFlow {
  private nodes: ClaudeFlowNode[] = [];

  async addNode(nodeConfig: NodeConfig): Promise<void> {
    const node = new ClaudeFlowNode(nodeConfig);
    await node.connect();
    this.nodes.push(node);
  }

  async distributeTask(task: Task): Promise<TaskResult> {
    // Find best node for task
    const node = await this.selectOptimalNode(task);
    
    // Execute on selected node
    return await node.executeTask(task);
  }

  private async selectOptimalNode(task: Task): Promise<ClaudeFlowNode> {
    const nodeMetrics = await Promise.all(
      this.nodes.map(node => node.getMetrics())
    );

    // Select node with lowest load and best capability match
    return this.nodes.reduce((best, current, index) => {
      const score = this.calculateNodeScore(task, nodeMetrics[index]);
      return score > best.score ? { node: current, score } : best;
    }, { node: this.nodes[0], score: 0 }).node;
  }
}
```

## Testing Examples

### Unit Testing

```typescript
// Testing Claude-Flow workflows
import { describe, it, expect } from 'vitest';
import { ClaudeFlow, MockAgent } from 'claude-flow/testing';

describe('Research Workflow', () => {
  let claudeFlow: ClaudeFlow;

  beforeEach(async () => {
    claudeFlow = new ClaudeFlow({
      testing: {
        mode: 'mock',
        mockResponses: true
      }
    });

    await claudeFlow.start();
  });

  it('should complete research task successfully', async () => {
    const agent = await claudeFlow.spawnAgent({
      type: 'researcher',
      name: 'Test Researcher'
    });

    const task = await claudeFlow.createTask({
      type: 'research',
      description: 'Test research task',
      assignTo: agent.id
    });

    const result = await claudeFlow.waitForCompletion(task.id);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });
});
```

### Integration Testing

```typescript
// End-to-end workflow testing
describe('Full Workflow Integration', () => {
  it('should execute complete analysis workflow', async () => {
    const claudeFlow = new ClaudeFlow();
    await claudeFlow.start();

    // Execute workflow
    const workflow = await claudeFlow.executeWorkflow({
      name: 'Test Analysis Workflow',
      tasks: [
        { type: 'research', description: 'Research phase' },
        { type: 'analysis', description: 'Analysis phase' },
        { type: 'report', description: 'Report generation' }
      ]
    });

    // Verify results
    expect(workflow.status).toBe('completed');
    expect(workflow.results).toHaveLength(3);
    
    await claudeFlow.stop();
  });
});
```

## Best Practices Examples

### Error Handling

```typescript
// Robust error handling
class RobustClaudeFlow {
  async executeWithRetry(task: Task, maxRetries = 3): Promise<TaskResult> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.claudeFlow.executeTask(task);
      } catch (error) {
        lastError = error;

        if (!this.isRetryable(error) || attempt === maxRetries) {
          throw error;
        }

        // Exponential backoff
        await this.delay(Math.pow(2, attempt) * 1000);
      }
    }

    throw lastError!;
  }

  private isRetryable(error: Error): boolean {
    const retryableCodes = ['TIMEOUT', 'AGENT_UNAVAILABLE', 'RESOURCE_EXHAUSTED'];
    return retryableCodes.includes(error.code);
  }
}
```

### Resource Management

```typescript
// Efficient resource management
class ResourceManagedClaudeFlow {
  private resourcePool = new Map<string, Resource>();

  async acquireResource(type: string): Promise<Resource> {
    const poolKey = `${type}_pool`;
    
    if (!this.resourcePool.has(poolKey)) {
      this.resourcePool.set(poolKey, await this.createResource(type));
    }

    return this.resourcePool.get(poolKey)!;
  }

  async releaseResource(resource: Resource): Promise<void> {
    // Clean up and return to pool
    await resource.cleanup();
    // Resource remains in pool for reuse
  }

  async shutdown(): Promise<void> {
    // Clean up all resources
    for (const resource of this.resourcePool.values()) {
      await resource.destroy();
    }
    this.resourcePool.clear();
  }
}
```

This examples directory provides comprehensive, practical guidance for using Claude-Flow in real-world scenarios, from simple tasks to complex distributed systems.