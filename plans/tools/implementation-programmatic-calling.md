# Implementation Guide: Programmatic Tool Calling

## Overview

Enable Claude to orchestrate multiple tools through code execution, reducing tokens by 37% and eliminating intermediate results from context.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Model                            │
│  Generates Python/JS code with async tool calls             │
└─────────────────────────┬───────────────────────────────────┘
                          │ Code
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Programmatic Sandbox Executor                   │
│  - Isolate execution environment                            │
│  - Inject tool functions                                    │
│  - Execute generated code                                   │
│  - Aggregate results                                        │
└─────────────────────────┬───────────────────────────────────┘
                          │ Tool calls (parallel via asyncio)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCP Tool Registry                         │
│  - Tools with allowed_callers: ['code_execution']           │
│  - Batch-optimized variants                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Step 1: Create Sandbox Executor

### New File: `src/mcp/programmatic/sandbox-executor.ts`

```typescript
/**
 * Programmatic Tool Calling Sandbox
 *
 * Executes Claude-generated code with tool access.
 * Intermediate results stay outside model context.
 */

import { VM } from 'vm2';  // or isolated-vm for better isolation
import type { MCPTool } from '../../utils/types.js';
import type { ILogger } from '../../core/logger.js';

export interface SandboxConfig {
  timeout: number;           // Execution timeout in ms
  memoryLimit: number;       // Memory limit in MB
  allowedTools: string[];    // Tools accessible from code
  maxParallelCalls: number;  // Max concurrent tool calls
}

export interface ExecutionResult {
  success: boolean;
  output: any;
  error?: string;
  metrics: {
    duration: number;
    toolCallCount: number;
    tokensAvoided: number;  // Estimated tokens saved
  };
}

export class ProgrammaticSandbox {
  private config: SandboxConfig;
  private tools: Map<string, MCPTool>;
  private logger: ILogger;

  constructor(config: SandboxConfig, tools: Map<string, MCPTool>, logger: ILogger) {
    this.config = config;
    this.tools = tools;
    this.logger = logger;
  }

  /**
   * Execute generated code with tool access
   */
  async execute(code: string, context?: any): Promise<ExecutionResult> {
    const startTime = Date.now();
    let toolCallCount = 0;
    const intermediateResults: any[] = [];

    // Create tool wrappers for the sandbox
    const toolFunctions: Record<string, Function> = {};

    for (const toolName of this.config.allowedTools) {
      const tool = this.tools.get(toolName);
      if (!tool) continue;

      // Create async wrapper that tracks calls
      toolFunctions[this.sanitizeToolName(toolName)] = async (args: any) => {
        toolCallCount++;
        this.logger.debug('Programmatic tool call', { tool: toolName, args });

        try {
          const result = await tool.handler(args, context);
          intermediateResults.push({
            tool: toolName,
            resultSize: JSON.stringify(result).length
          });
          return result;
        } catch (error) {
          this.logger.error('Tool call failed in sandbox', { tool: toolName, error });
          throw error;
        }
      };
    }

    // Add utility functions
    const utilities = {
      // Parallel execution helper
      parallel: async (...promises: Promise<any>[]) => {
        return Promise.all(promises);
      },

      // Aggregation helpers
      sum: (arr: number[]) => arr.reduce((a, b) => a + b, 0),
      avg: (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length,

      // Filtering helper
      filter: (arr: any[], predicate: (item: any) => boolean) => arr.filter(predicate),

      // Logging (captured, not sent to model)
      log: (...args: any[]) => {
        this.logger.debug('Sandbox log', { args });
      }
    };

    try {
      // Create isolated VM
      const vm = new VM({
        timeout: this.config.timeout,
        sandbox: {
          ...toolFunctions,
          ...utilities,
          context: context || {}
        },
        eval: false,
        wasm: false,
      });

      // Wrap code in async function if needed
      const wrappedCode = code.includes('async') || code.includes('await')
        ? `(async () => { ${code} })()`
        : code;

      const result = await vm.run(wrappedCode);

      const duration = Date.now() - startTime;

      // Estimate tokens saved (intermediate results not in context)
      const tokensAvoided = intermediateResults.reduce((sum, r) => {
        return sum + Math.ceil(r.resultSize / 4); // ~4 chars per token
      }, 0);

      this.logger.info('Programmatic execution completed', {
        duration,
        toolCallCount,
        tokensAvoided
      });

      return {
        success: true,
        output: result,
        metrics: {
          duration,
          toolCallCount,
          tokensAvoided
        }
      };

    } catch (error) {
      this.logger.error('Sandbox execution failed', { error });

      return {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        metrics: {
          duration: Date.now() - startTime,
          toolCallCount,
          tokensAvoided: 0
        }
      };
    }
  }

  /**
   * Convert tool name to valid JS function name
   * e.g., "memory/query" -> "memory_query"
   */
  private sanitizeToolName(name: string): string {
    return name.replace(/[\/\-\.]/g, '_');
  }
}

export function createSandbox(
  tools: Map<string, MCPTool>,
  logger: ILogger,
  config?: Partial<SandboxConfig>
): ProgrammaticSandbox {
  const defaultConfig: SandboxConfig = {
    timeout: 30000,
    memoryLimit: 128,
    allowedTools: Array.from(tools.keys()),
    maxParallelCalls: 10,
    ...config
  };

  return new ProgrammaticSandbox(defaultConfig, tools, logger);
}
```

---

## Step 2: Create Batch Operation Tools

### New File: `src/mcp/programmatic/batch-tools.ts`

```typescript
/**
 * Batch Operation Tools
 *
 * Optimized for programmatic calling with aggregated results.
 */

import type { MCPTool, MCPContext } from '../../utils/types.js';
import type { ILogger } from '../../core/logger.js';

export function createBatchTools(logger: ILogger): MCPTool[] {
  return [
    // Batch memory queries
    {
      name: 'batch/query-memories',
      description: 'Query multiple memory entries in a single call. Results are aggregated.',
      allowed_callers: ['code_execution'],
      inputSchema: {
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Query identifier' },
                agentId: { type: 'string' },
                type: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                limit: { type: 'number', default: 10 }
              }
            },
            description: 'Array of memory queries to execute'
          },
          parallel: {
            type: 'boolean',
            default: true,
            description: 'Execute queries in parallel'
          }
        },
        required: ['queries']
      },
      handler: async (input: any, context?: MCPContext) => {
        if (!context?.orchestrator) {
          throw new Error('Orchestrator not available');
        }

        const results: Record<string, any> = {};
        const errors: Record<string, string> = {};

        const executeQuery = async (query: any) => {
          try {
            const entries = await context.orchestrator.queryMemory({
              agentId: query.agentId,
              type: query.type,
              tags: query.tags,
              limit: query.limit || 10
            });
            results[query.id] = entries;
          } catch (error) {
            errors[query.id] = error instanceof Error ? error.message : 'Unknown error';
          }
        };

        if (input.parallel) {
          await Promise.all(input.queries.map(executeQuery));
        } else {
          for (const query of input.queries) {
            await executeQuery(query);
          }
        }

        return {
          results,
          errors,
          summary: {
            total: input.queries.length,
            successful: Object.keys(results).length,
            failed: Object.keys(errors).length
          }
        };
      }
    },

    // Batch task creation
    {
      name: 'batch/create-tasks',
      description: 'Create multiple tasks in a single call. Returns all task IDs.',
      allowed_callers: ['code_execution'],
      inputSchema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                description: { type: 'string' },
                priority: { type: 'number', default: 5 },
                dependencies: { type: 'array', items: { type: 'string' } },
                assignToAgentType: { type: 'string' }
              },
              required: ['type', 'description']
            }
          }
        },
        required: ['tasks']
      },
      handler: async (input: any, context?: MCPContext) => {
        if (!context?.orchestrator) {
          throw new Error('Orchestrator not available');
        }

        const taskIds: string[] = [];
        const errors: Array<{ index: number; error: string }> = [];

        for (let i = 0; i < input.tasks.length; i++) {
          try {
            const task = input.tasks[i];
            const taskId = await context.orchestrator.createTask({
              type: task.type,
              description: task.description,
              priority: task.priority || 5,
              dependencies: task.dependencies || [],
              status: 'pending',
              createdAt: new Date()
            });
            taskIds.push(taskId);

            if (task.assignToAgentType) {
              await context.orchestrator.assignTaskToType(taskId, task.assignToAgentType);
            }
          } catch (error) {
            errors.push({
              index: i,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }

        return {
          taskIds,
          errors,
          summary: {
            created: taskIds.length,
            failed: errors.length
          }
        };
      }
    },

    // Batch agent status check
    {
      name: 'batch/agent-status',
      description: 'Get status of multiple agents in a single call.',
      allowed_callers: ['code_execution'],
      inputSchema: {
        type: 'object',
        properties: {
          agentIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of agent IDs to check'
          },
          includeMetrics: {
            type: 'boolean',
            default: false,
            description: 'Include performance metrics for each agent'
          }
        },
        required: ['agentIds']
      },
      handler: async (input: any, context?: MCPContext) => {
        if (!context?.orchestrator) {
          throw new Error('Orchestrator not available');
        }

        const statuses: Record<string, any> = {};

        await Promise.all(input.agentIds.map(async (agentId: string) => {
          try {
            const info = await context.orchestrator.getAgentInfo(agentId);
            statuses[agentId] = {
              status: info?.status || 'unknown',
              type: info?.type,
              currentTask: info?.currentTask,
              metrics: input.includeMetrics ? info?.metrics : undefined
            };
          } catch (error) {
            statuses[agentId] = { status: 'error', error: 'Agent not found' };
          }
        }));

        // Aggregate statistics
        const statusCounts = Object.values(statuses).reduce((acc: any, s: any) => {
          acc[s.status] = (acc[s.status] || 0) + 1;
          return acc;
        }, {});

        return {
          agents: statuses,
          summary: {
            total: input.agentIds.length,
            ...statusCounts
          }
        };
      }
    },

    // Batch file operations (for reading multiple files)
    {
      name: 'batch/read-files',
      description: 'Read multiple files and aggregate results. Useful for analysis tasks.',
      allowed_callers: ['code_execution'],
      inputSchema: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of file paths to read'
          },
          maxSizePerFile: {
            type: 'number',
            default: 100000,
            description: 'Maximum bytes to read per file'
          }
        },
        required: ['paths']
      },
      handler: async (input: any, context?: MCPContext) => {
        const fs = await import('fs/promises');
        const results: Record<string, any> = {};
        const errors: Record<string, string> = {};

        await Promise.all(input.paths.map(async (path: string) => {
          try {
            const stat = await fs.stat(path);
            if (stat.size > (input.maxSizePerFile || 100000)) {
              errors[path] = `File too large: ${stat.size} bytes`;
              return;
            }
            const content = await fs.readFile(path, 'utf-8');
            results[path] = {
              content,
              size: stat.size,
              modified: stat.mtime
            };
          } catch (error) {
            errors[path] = error instanceof Error ? error.message : 'Unknown error';
          }
        }));

        return {
          files: results,
          errors,
          summary: {
            total: input.paths.length,
            successful: Object.keys(results).length,
            failed: Object.keys(errors).length,
            totalBytes: Object.values(results).reduce((sum: number, f: any) => sum + f.size, 0)
          }
        };
      }
    }
  ];
}
```

---

## Step 3: Create Programmatic Calling MCP Tool

### New File: `src/mcp/tools/system/execute-code.ts`

```typescript
/**
 * Execute Code Tool
 *
 * Allows Claude to orchestrate multiple tools through code execution.
 */

import type { MCPTool, MCPContext } from '../../utils/types.js';
import type { ILogger } from '../../core/logger.js';
import { createSandbox } from '../programmatic/sandbox-executor.js';

export function createExecuteCodeTool(
  allTools: Map<string, MCPTool>,
  logger: ILogger
): MCPTool {
  return {
    name: 'system/execute-code',
    description: `Execute JavaScript code to orchestrate multiple tool calls.
Use this for complex workflows that require:
- Calling multiple tools in sequence or parallel
- Processing/filtering intermediate results
- Aggregating data from multiple sources

The code has access to all tools as async functions (e.g., memory_query, agents_list).
Intermediate results DO NOT enter the model context, saving tokens.`,
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code to execute. Has access to tool functions and utilities.'
        },
        timeout: {
          type: 'number',
          default: 30000,
          description: 'Execution timeout in milliseconds'
        }
      },
      required: ['code']
    },
    examples: [
      {
        description: 'Query memory and aggregate results',
        input: {
          code: `
const results = await parallel(
  memory_query({ agentId: 'agent1', type: 'observation' }),
  memory_query({ agentId: 'agent2', type: 'observation' })
);
return {
  agent1Count: results[0].entries.length,
  agent2Count: results[1].entries.length,
  total: results[0].entries.length + results[1].entries.length
};
`
        }
      },
      {
        description: 'Get all active agents and their tasks',
        input: {
          code: `
const agents = await agents_list({ filterByType: 'researcher' });
const activeAgents = agents.agents.filter(a => a.status === 'active');
const taskPromises = activeAgents.map(a =>
  tasks_list({ agentId: a.id, status: 'running' })
);
const tasks = await parallel(...taskPromises);
return {
  activeResearchers: activeAgents.length,
  runningTasks: tasks.reduce((sum, t) => sum + t.count, 0)
};
`
        }
      }
    ],
    handler: async (input: any, context?: MCPContext) => {
      logger.info('Executing programmatic code', {
        codeLength: input.code.length
      });

      // Get allowed tools for programmatic calling
      const programmaticTools = new Map<string, MCPTool>();
      for (const [name, tool] of allTools) {
        // Include tools explicitly marked for code execution or all tools
        const allowedCallers = (tool as any).allowed_callers;
        if (!allowedCallers || allowedCallers.includes('code_execution')) {
          programmaticTools.set(name, tool);
        }
      }

      const sandbox = createSandbox(programmaticTools, logger, {
        timeout: input.timeout || 30000
      });

      const result = await sandbox.execute(input.code, context);

      return {
        success: result.success,
        output: result.output,
        error: result.error,
        metrics: {
          executionTime: `${result.metrics.duration}ms`,
          toolCalls: result.metrics.toolCallCount,
          tokensAvoided: result.metrics.tokensAvoided,
          tokenSavingsEstimate: `~${result.metrics.tokensAvoided} tokens kept out of context`
        }
      };
    }
  };
}
```

---

## Step 4: Integration with SDK

### Update: `src/mcp/sdk-integration.ts`

```typescript
import { createExecuteCodeTool } from './tools/system/execute-code.js';
import { createBatchTools } from './programmatic/batch-tools.js';

export function createProgrammaticCapableServer(
  baseTools: Map<string, MCPTool>,
  logger: ILogger
) {
  // Add batch tools
  const batchTools = createBatchTools(logger);
  for (const tool of batchTools) {
    baseTools.set(tool.name, tool);
  }

  // Add execute-code tool
  const executeCodeTool = createExecuteCodeTool(baseTools, logger);
  baseTools.set(executeCodeTool.name, executeCodeTool);

  // Mark tools for code execution access
  const sdkTools = Array.from(baseTools.values()).map(tool => {
    const allowedCallers = (tool as any).allowed_callers;
    return {
      ...tool,
      // Anthropic's format for programmatic access
      allowed_callers: allowedCallers || ['direct', 'code_execution_20250825']
    };
  });

  return sdkTools;
}
```

---

## Use Cases

### Use Case 1: Multi-Agent Research Aggregation

**Without Programmatic Calling:**
```
Call 1: agents/list → Returns 10 agents (large response)
Call 2-11: memory/query for each agent → 10 responses in context
Call 12: Aggregate in model context
Total: 12 API calls, all intermediate data in context
```

**With Programmatic Calling:**
```typescript
// Single call with code
const code = `
const agents = await agents_list({});
const memoryPromises = agents.agents.map(a =>
  memory_query({ agentId: a.id, type: 'insight', limit: 5 })
);
const memories = await parallel(...memoryPromises);

// Aggregate - this stays OUT of model context
const insights = memories.flatMap(m => m.entries)
  .map(e => ({ agent: e.agentId, content: e.content }))
  .slice(0, 20);  // Only return top 20

return { topInsights: insights, totalFound: memories.length };
`;
```

**Savings:** 12 calls → 1 call, ~40K tokens → ~5K tokens

### Use Case 2: Swarm Status Dashboard

**Code:**
```typescript
const code = `
const [swarmStatus, agents, resources, messages] = await parallel(
  swarm_get_status({ includeDetails: false }),
  agent_list({ status: 'all' }),
  resource_get_statistics({}),
  message_get_metrics({})
);

return {
  swarm: {
    status: swarmStatus.status,
    activeObjectives: swarmStatus.activeObjectives
  },
  agents: {
    total: agents.count,
    byStatus: agents.agents.reduce((acc, a) => {
      acc[a.status] = (acc[a.status] || 0) + 1;
      return acc;
    }, {})
  },
  resources: resources.statistics,
  messaging: {
    sent: messages.metrics.sent,
    queued: messages.metrics.queued
  }
};
`;
```

---

## Testing

### Test File: `src/mcp/programmatic/__tests__/sandbox.test.ts`

```typescript
describe('ProgrammaticSandbox', () => {
  test('executes simple code', async () => {
    const result = await sandbox.execute('return 1 + 1');
    expect(result.success).toBe(true);
    expect(result.output).toBe(2);
  });

  test('calls tools in parallel', async () => {
    const code = `
      const [a, b] = await parallel(
        mock_tool({ id: 1 }),
        mock_tool({ id: 2 })
      );
      return [a, b];
    `;
    const result = await sandbox.execute(code);
    expect(result.success).toBe(true);
    expect(result.metrics.toolCallCount).toBe(2);
  });

  test('handles timeout', async () => {
    const result = await sandbox.execute('while(true){}', { timeout: 100 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });

  test('tracks token savings', async () => {
    // Mock tool that returns large response
    const result = await sandbox.execute(`
      const large = await large_response_tool({});
      return large.summary;  // Only return summary
    `);
    expect(result.metrics.tokensAvoided).toBeGreaterThan(1000);
  });
});
```

---

## Expected Results

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| API calls for complex workflow | 15+ | 1-2 | 90% reduction |
| Token usage for aggregation tasks | ~45K | ~15K | 67% reduction |
| Intermediate data in context | All | None | 100% reduction |
| Latency for multi-step operations | High | Low | ~3x faster |
