/**
 * Batch Operation Tools for Programmatic Calling
 *
 * These tools are optimized for programmatic execution where multiple
 * operations are batched together, keeping intermediate results out of
 * the model's context window.
 *
 * Based on Anthropic's Programmatic Tool Calling pattern for 37% token reduction.
 *
 * @see https://www.anthropic.com/engineering/advanced-tool-use
 */

import type { MCPTool, MCPContext } from '../../utils/types.js';
import type { ILogger } from '../../core/logger.js';

export interface BatchToolContext extends MCPContext {
  orchestrator?: {
    queryMemory: (query: unknown) => Promise<{ entries: unknown[] }>;
    createTask: (task: unknown) => Promise<string>;
    assignTaskToType: (taskId: string, type: string) => Promise<void>;
    getAgentInfo: (agentId: string) => Promise<unknown>;
  };
}

/**
 * Create batch operation tools
 */
export function createBatchTools(logger: ILogger): MCPTool[] {
  return [
    createBatchQueryMemoriesTool(logger),
    createBatchCreateTasksTool(logger),
    createBatchAgentStatusTool(logger),
    createBatchExecuteTool(logger),
  ];
}

/**
 * Batch memory queries - query multiple memory entries in parallel
 */
function createBatchQueryMemoriesTool(logger: ILogger): MCPTool {
  return {
    name: 'batch/query-memories',
    description: `Query multiple memory entries in a single call with aggregated results.
Executes queries in parallel for efficiency. Results are summarized to minimize context usage.

Returns:
- results: Object mapping query IDs to their results
- errors: Any errors that occurred
- summary: Aggregate statistics`,
    inputSchema: {
      type: 'object',
      properties: {
        queries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique identifier for this query' },
              agentId: { type: 'string', description: 'Filter by agent ID' },
              type: {
                type: 'string',
                enum: ['observation', 'insight', 'decision', 'artifact', 'error'],
                description: 'Filter by entry type'
              },
              tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
              search: { type: 'string', description: 'Search text' },
              limit: { type: 'number', default: 10, description: 'Max entries per query' }
            },
            required: ['id']
          },
          description: 'Array of memory queries to execute'
        },
        parallel: {
          type: 'boolean',
          default: true,
          description: 'Execute queries in parallel (faster) or sequential'
        },
        summarize: {
          type: 'boolean',
          default: true,
          description: 'Return summaries instead of full entries to save tokens'
        }
      },
      required: ['queries']
    },
    handler: async (input: unknown, context?: BatchToolContext) => {
      const { queries, parallel = true, summarize = true } = input as {
        queries: Array<{
          id: string;
          agentId?: string;
          type?: string;
          tags?: string[];
          search?: string;
          limit?: number;
        }>;
        parallel?: boolean;
        summarize?: boolean;
      };

      // Security: Limit array size to prevent resource exhaustion
      const MAX_BATCH_SIZE = 50;
      if (!queries || queries.length === 0) {
        throw new Error('At least one query is required');
      }
      if (queries.length > MAX_BATCH_SIZE) {
        throw new Error(`Maximum ${MAX_BATCH_SIZE} queries allowed per batch (received ${queries.length})`);
      }

      logger.info('Batch memory query', { queryCount: queries.length, parallel });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available for batch memory queries');
      }

      const results: Record<string, unknown> = {};
      const errors: Record<string, string> = {};
      const startTime = Date.now();

      const executeQuery = async (query: typeof queries[0]) => {
        try {
          const memoryResult = await context.orchestrator!.queryMemory({
            agentId: query.agentId,
            type: query.type,
            tags: query.tags,
            search: query.search,
            limit: query.limit || 10
          });

          if (summarize) {
            // Return summary instead of full entries
            results[query.id] = {
              count: memoryResult.entries.length,
              types: [...new Set((memoryResult.entries as Array<{ type?: string }>).map(e => e.type))],
              preview: (memoryResult.entries as Array<{ content?: string }>).slice(0, 2).map(e =>
                typeof e.content === 'string' ? e.content.substring(0, 100) : '[non-text]'
              )
            };
          } else {
            results[query.id] = memoryResult.entries;
          }
        } catch (error) {
          errors[query.id] = error instanceof Error ? error.message : 'Unknown error';
        }
      };

      if (parallel) {
        await Promise.all(queries.map(executeQuery));
      } else {
        for (const query of queries) {
          await executeQuery(query);
        }
      }

      const duration = Date.now() - startTime;

      logger.info('Batch memory query complete', {
        successful: Object.keys(results).length,
        failed: Object.keys(errors).length,
        duration
      });

      return {
        results,
        errors,
        summary: {
          totalQueries: queries.length,
          successful: Object.keys(results).length,
          failed: Object.keys(errors).length,
          durationMs: duration,
          tokensAvoided: summarize ? 'Summaries returned instead of full entries' : 'Full entries returned'
        }
      };
    }
  };
}

/**
 * Batch task creation - create multiple tasks in one call
 */
function createBatchCreateTasksTool(logger: ILogger): MCPTool {
  return {
    name: 'batch/create-tasks',
    description: `Create multiple tasks in a single call.
Returns all task IDs for tracking. Useful for setting up workflows programmatically.

Returns:
- taskIds: Array of created task IDs
- errors: Any errors during creation
- summary: Creation statistics`,
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'Task type (e.g., research, implement, test)' },
              description: { type: 'string', description: 'Task description' },
              priority: { type: 'number', default: 5, description: 'Priority 1-10' },
              dependencies: { type: 'array', items: { type: 'string' }, description: 'Dependent task IDs' },
              assignToAgentType: { type: 'string', description: 'Agent type to assign to' },
              metadata: { type: 'object', description: 'Additional task metadata' }
            },
            required: ['type', 'description']
          },
          description: 'Array of tasks to create'
        },
        stopOnError: {
          type: 'boolean',
          default: false,
          description: 'Stop creating tasks if one fails'
        }
      },
      required: ['tasks']
    },
    handler: async (input: unknown, context?: BatchToolContext) => {
      const { tasks, stopOnError = false } = input as {
        tasks: Array<{
          type: string;
          description: string;
          priority?: number;
          dependencies?: string[];
          assignToAgentType?: string;
          metadata?: Record<string, unknown>;
        }>;
        stopOnError?: boolean;
      };

      // Security: Limit array size to prevent resource exhaustion
      const MAX_BATCH_SIZE = 50;
      if (!tasks || tasks.length === 0) {
        throw new Error('At least one task is required');
      }
      if (tasks.length > MAX_BATCH_SIZE) {
        throw new Error(`Maximum ${MAX_BATCH_SIZE} tasks allowed per batch (received ${tasks.length})`);
      }

      logger.info('Batch task creation', { taskCount: tasks.length });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available for batch task creation');
      }

      const taskIds: string[] = [];
      const errors: Array<{ index: number; error: string }> = [];
      const startTime = Date.now();

      for (let i = 0; i < tasks.length; i++) {
        try {
          const task = tasks[i];
          const taskId = await context.orchestrator.createTask({
            type: task.type,
            description: task.description,
            priority: task.priority || 5,
            dependencies: task.dependencies || [],
            metadata: task.metadata || {},
            status: 'pending',
            createdAt: new Date()
          });

          taskIds.push(taskId);

          // Assign to agent type if specified
          if (task.assignToAgentType) {
            await context.orchestrator.assignTaskToType(taskId, task.assignToAgentType);
          }

          logger.debug('Task created in batch', { index: i, taskId });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          errors.push({ index: i, error: errorMsg });

          logger.warn('Task creation failed in batch', { index: i, error: errorMsg });

          if (stopOnError) {
            break;
          }
        }
      }

      const duration = Date.now() - startTime;

      logger.info('Batch task creation complete', {
        created: taskIds.length,
        failed: errors.length,
        duration
      });

      return {
        taskIds,
        errors,
        summary: {
          totalRequested: tasks.length,
          created: taskIds.length,
          failed: errors.length,
          durationMs: duration
        }
      };
    }
  };
}

/**
 * Batch agent status check - get status of multiple agents at once
 */
function createBatchAgentStatusTool(logger: ILogger): MCPTool {
  return {
    name: 'batch/agent-status',
    description: `Get status of multiple agents in a single call.
Returns aggregated status information with optional detailed metrics.

Returns:
- agents: Object mapping agent IDs to their status
- summary: Aggregate statistics (active, idle, busy counts)`,
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
        },
        includeCurrentTask: {
          type: 'boolean',
          default: true,
          description: 'Include current task information'
        }
      },
      required: ['agentIds']
    },
    handler: async (input: unknown, context?: BatchToolContext) => {
      const { agentIds, includeMetrics = false, includeCurrentTask = true } = input as {
        agentIds: string[];
        includeMetrics?: boolean;
        includeCurrentTask?: boolean;
      };

      // Security: Limit array size to prevent resource exhaustion
      const MAX_BATCH_SIZE = 100;
      if (!agentIds || agentIds.length === 0) {
        throw new Error('At least one agent ID is required');
      }
      if (agentIds.length > MAX_BATCH_SIZE) {
        throw new Error(`Maximum ${MAX_BATCH_SIZE} agent IDs allowed per batch (received ${agentIds.length})`);
      }

      logger.info('Batch agent status check', { agentCount: agentIds.length });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available for batch agent status');
      }

      const statuses: Record<string, unknown> = {};
      const startTime = Date.now();

      await Promise.all(agentIds.map(async (agentId: string) => {
        try {
          const info = await context.orchestrator!.getAgentInfo(agentId) as {
            status?: string;
            type?: string;
            currentTask?: unknown;
            metrics?: unknown;
          } | null;

          if (info) {
            statuses[agentId] = {
              status: info.status || 'unknown',
              type: info.type,
              ...(includeCurrentTask && info.currentTask ? { currentTask: info.currentTask } : {}),
              ...(includeMetrics && info.metrics ? { metrics: info.metrics } : {})
            };
          } else {
            statuses[agentId] = { status: 'not_found' };
          }
        } catch (error) {
          statuses[agentId] = {
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }));

      // Aggregate statistics
      const statusCounts: Record<string, number> = {};
      for (const status of Object.values(statuses)) {
        const s = (status as { status: string }).status;
        statusCounts[s] = (statusCounts[s] || 0) + 1;
      }

      const duration = Date.now() - startTime;

      logger.info('Batch agent status check complete', {
        checked: agentIds.length,
        duration
      });

      return {
        agents: statuses,
        summary: {
          total: agentIds.length,
          ...statusCounts,
          durationMs: duration
        }
      };
    }
  };
}

/**
 * Generic batch execute - run multiple tool calls and aggregate results
 */
function createBatchExecuteTool(logger: ILogger): MCPTool {
  return {
    name: 'batch/execute',
    description: `Execute multiple tool operations and return aggregated results.
Use this for complex workflows where intermediate results don't need to enter context.
Operations run in parallel by default.

Returns:
- results: Array of operation results
- errors: Any errors that occurred
- summary: Execution statistics including estimated tokens avoided`,
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique operation identifier' },
              tool: { type: 'string', description: 'Tool name to call' },
              args: { type: 'object', description: 'Arguments for the tool' }
            },
            required: ['id', 'tool', 'args']
          },
          description: 'Array of operations to execute'
        },
        parallel: {
          type: 'boolean',
          default: true,
          description: 'Execute operations in parallel'
        },
        summarizeResults: {
          type: 'boolean',
          default: true,
          description: 'Summarize large results to save tokens'
        },
        maxResultSize: {
          type: 'number',
          default: 1000,
          description: 'Maximum characters per result before summarization'
        }
      },
      required: ['operations']
    },
    handler: async (input: unknown, context?: BatchToolContext) => {
      const {
        operations,
        parallel = true,
        summarizeResults = true,
        maxResultSize = 1000
      } = input as {
        operations: Array<{
          id: string;
          tool: string;
          args: Record<string, unknown>;
        }>;
        parallel?: boolean;
        summarizeResults?: boolean;
        maxResultSize?: number;
      };

      // Security: Limit array size to prevent resource exhaustion
      const MAX_BATCH_SIZE = 50;
      if (!operations || operations.length === 0) {
        throw new Error('At least one operation is required');
      }
      if (operations.length > MAX_BATCH_SIZE) {
        throw new Error(`Maximum ${MAX_BATCH_SIZE} operations allowed per batch (received ${operations.length})`);
      }

      logger.info('Batch execute', { operationCount: operations.length, parallel });

      const results: Record<string, unknown> = {};
      const errors: Record<string, string> = {};
      const startTime = Date.now();
      let totalOriginalSize = 0;
      let totalFinalSize = 0;

      const executeOperation = async (op: typeof operations[0]) => {
        // Note: In a full implementation, this would route to the actual tool
        // For now, we return a mock result showing the pattern
        try {
          const result = {
            executed: true,
            tool: op.tool,
            args: op.args,
            timestamp: new Date().toISOString()
          };

          const resultStr = JSON.stringify(result);
          totalOriginalSize += resultStr.length;

          if (summarizeResults && resultStr.length > maxResultSize) {
            results[op.id] = {
              _summarized: true,
              tool: op.tool,
              success: true,
              originalSize: resultStr.length
            };
            totalFinalSize += JSON.stringify(results[op.id]).length;
          } else {
            results[op.id] = result;
            totalFinalSize += resultStr.length;
          }
        } catch (error) {
          errors[op.id] = error instanceof Error ? error.message : 'Unknown error';
        }
      };

      if (parallel) {
        await Promise.all(operations.map(executeOperation));
      } else {
        for (const op of operations) {
          await executeOperation(op);
        }
      }

      const duration = Date.now() - startTime;
      const tokensAvoided = Math.floor((totalOriginalSize - totalFinalSize) / 4);

      logger.info('Batch execute complete', {
        successful: Object.keys(results).length,
        failed: Object.keys(errors).length,
        duration,
        tokensAvoided
      });

      return {
        results,
        errors,
        summary: {
          totalOperations: operations.length,
          successful: Object.keys(results).length,
          failed: Object.keys(errors).length,
          durationMs: duration,
          originalResultSize: totalOriginalSize,
          finalResultSize: totalFinalSize,
          estimatedTokensAvoided: tokensAvoided
        }
      };
    }
  };
}

export default createBatchTools;
