/**
 * Beads MCP Tools
 *
 * MCP tool definitions for Beads issue tracking integration.
 * Provides 11 tools for full issue lifecycle management.
 */

import type { MCPTool, MCPToolResult } from './types.js';
import {
  BeadsCliWrapper,
  createBeadsWrapper,
} from '../beads/cli-wrapper.js';
import type {
  BeadsCreateParams,
  BeadsListParams,
  BeadsReadyParams,
  BeadsShowParams,
  BeadsUpdateParams,
  BeadsCloseParams,
  BeadsDepAddParams,
  BeadsDepTreeParams,
  BeadsBlockedParams,
} from '../beads/types.js';

// Wrapper instance with dependency injection support
let beadsWrapper: BeadsCliWrapper | null = null;

/**
 * Get the wrapper instance, creating a default one if needed
 */
function getWrapper(): BeadsCliWrapper {
  if (!beadsWrapper) {
    beadsWrapper = createBeadsWrapper();
  }
  return beadsWrapper;
}

/**
 * Set the wrapper instance (for testing/dependency injection)
 */
export function setBeadsWrapper(wrapper: BeadsCliWrapper | null): void {
  beadsWrapper = wrapper;
}

/**
 * Helper to create success result
 */
function success(data: unknown): MCPToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Helper to create error result
 */
function error(message: string): MCPToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Get all Beads MCP tools
 */
export function getBeadsTools(): MCPTool[] {
  return [
    // beads_create - Create a new issue
    {
      name: 'beads_create',
      description: 'Create a new Beads issue for tracking work items, bugs, features, or tasks',
      category: 'beads',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Issue title (required)',
          },
          description: {
            type: 'string',
            description: 'Detailed issue description',
          },
          priority: {
            type: 'number',
            description: 'Priority level 0-4 (0=highest, 4=lowest). Default: 2',
          },
          type: {
            type: 'string',
            enum: ['bug', 'feature', 'task', 'epic', 'chore'],
            description: 'Issue type classification',
          },
          assignee: {
            type: 'string',
            description: 'Person assigned to the issue',
          },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Labels for categorization',
          },
          parent_id: {
            type: 'string',
            description: 'Parent issue ID for hierarchical organization',
          },
        },
        required: ['title'],
      },
      handler: async (input) => {
        try {
          const wrapper = getWrapper();
          if (!wrapper) {
            return error('Beads wrapper not initialized');
          }

          const params: BeadsCreateParams = {
            title: input.title as string,
            description: input.description as string | undefined,
            priority: input.priority as number | undefined,
            type: input.type as BeadsCreateParams['type'],
            assignee: input.assignee as string | undefined,
            labels: input.labels as string[] | undefined,
            parent_id: input.parent_id as string | undefined,
          };

          const result = await wrapper.create(params);

          if (result.success && result.data) {
            return success(result.data);
          }
          return error(result.error || 'Failed to create issue');
        } catch (err) {
          return error(err instanceof Error ? err.message : 'Unknown error');
        }
      },
    },

    // beads_list - List issues with filters
    {
      name: 'beads_list',
      description: 'List Beads issues with optional filters for status, assignee, labels, and priority',
      category: 'beads',
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['open', 'in_progress', 'blocked', 'closed', 'done'],
            description: 'Filter by status',
          },
          assignee: {
            type: 'string',
            description: 'Filter by assignee',
          },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by labels (any match)',
          },
          priority: {
            type: 'number',
            description: 'Filter by priority level',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return',
          },
        },
      },
      handler: async (input) => {
        try {
          const wrapper = getWrapper();
          if (!wrapper) {
            return error('Beads wrapper not initialized');
          }

          const params: BeadsListParams = {
            status: input.status as BeadsListParams['status'],
            assignee: input.assignee as string | undefined,
            labels: input.labels as string[] | undefined,
            priority: input.priority as number | undefined,
            limit: input.limit as number | undefined,
          };

          const result = await wrapper.list(params);

          if (result.success && result.data) {
            return success(result.data);
          }
          return error(result.error || 'Failed to list issues');
        } catch (err) {
          return error(err instanceof Error ? err.message : 'Unknown error');
        }
      },
    },

    // beads_ready - Get issues ready to work on
    {
      name: 'beads_ready',
      description: 'List issues ready to work on (no unresolved dependencies/blockers)',
      category: 'beads',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of results to return',
          },
        },
      },
      handler: async (input) => {
        try {
          const wrapper = getWrapper();
          if (!wrapper) {
            return error('Beads wrapper not initialized');
          }

          const result = await wrapper.ready({
            limit: input.limit as number | undefined,
          });

          if (result.success && result.data) {
            return success(result.data);
          }
          return error(result.error || 'Failed to get ready issues');
        } catch (err) {
          return error(err instanceof Error ? err.message : 'Unknown error');
        }
      },
    },

    // beads_show - Show detailed issue info
    {
      name: 'beads_show',
      description: 'Show detailed information about a specific issue including description, history, and dependencies',
      category: 'beads',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Issue ID to display',
          },
        },
        required: ['id'],
      },
      handler: async (input) => {
        try {
          const wrapper = getWrapper();
          if (!wrapper) {
            return error('Beads wrapper not initialized');
          }

          const params: BeadsShowParams = {
            id: input.id as string,
          };

          const result = await wrapper.show(params);

          if (result.success && result.data) {
            return success(result.data);
          }
          return error(result.error || 'Failed to show issue');
        } catch (err) {
          return error(err instanceof Error ? err.message : 'Unknown error');
        }
      },
    },

    // beads_update - Update an issue
    {
      name: 'beads_update',
      description: 'Update an existing issue\'s properties like status, priority, assignee, or description',
      category: 'beads',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Issue ID to update',
          },
          title: {
            type: 'string',
            description: 'New title',
          },
          description: {
            type: 'string',
            description: 'New description',
          },
          status: {
            type: 'string',
            enum: ['open', 'in_progress', 'blocked', 'closed', 'done'],
            description: 'New status',
          },
          priority: {
            type: 'number',
            description: 'New priority level (0-4)',
          },
          type: {
            type: 'string',
            enum: ['bug', 'feature', 'task', 'epic', 'chore'],
            description: 'New type classification',
          },
          assignee: {
            type: 'string',
            description: 'New assignee',
          },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'New labels (replaces existing)',
          },
        },
        required: ['id'],
      },
      handler: async (input) => {
        try {
          const wrapper = getWrapper();
          if (!wrapper) {
            return error('Beads wrapper not initialized');
          }

          const params: BeadsUpdateParams = {
            id: input.id as string,
            status: input.status as string | undefined,
            priority: input.priority as number | undefined,
            assignee: input.assignee as string | undefined,
            labels: input.labels as string[] | undefined,
            notes: input.notes as string | undefined,
          };

          const result = await wrapper.update(params);

          if (result.success && result.data) {
            return success(result.data);
          }
          return error(result.error || 'Failed to update issue');
        } catch (err) {
          return error(err instanceof Error ? err.message : 'Unknown error');
        }
      },
    },

    // beads_close - Close an issue
    {
      name: 'beads_close',
      description: 'Close an issue with an optional reason',
      category: 'beads',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Issue ID to close',
          },
          reason: {
            type: 'string',
            description: 'Reason for closing (e.g., "fixed", "duplicate", "wontfix")',
          },
        },
        required: ['id'],
      },
      handler: async (input) => {
        try {
          const wrapper = getWrapper();
          if (!wrapper) {
            return error('Beads wrapper not initialized');
          }

          const params: BeadsCloseParams = {
            id: input.id as string,
            reason: input.reason as string | undefined,
          };

          const result = await wrapper.close(params);

          if (result.success && result.data) {
            return success(result.data);
          }
          return error(result.error || 'Failed to close issue');
        } catch (err) {
          return error(err instanceof Error ? err.message : 'Unknown error');
        }
      },
    },

    // beads_dep_add - Add a dependency
    {
      name: 'beads_dep_add',
      description: 'Add a dependency relationship between issues (from_id depends on to_id)',
      category: 'beads',
      inputSchema: {
        type: 'object',
        properties: {
          from_id: {
            type: 'string',
            description: 'Source issue ID (the issue that depends on another)',
          },
          to_id: {
            type: 'string',
            description: 'Target issue ID (the issue being depended upon)',
          },
        },
        required: ['from_id', 'to_id'],
      },
      handler: async (input) => {
        try {
          const wrapper = getWrapper();
          if (!wrapper) {
            return error('Beads wrapper not initialized');
          }

          const params: BeadsDepAddParams = {
            from_id: input.from_id as string,
            to_id: input.to_id as string,
          };

          const result = await wrapper.depAdd(params);

          if (result.success && result.data) {
            return success(result.data);
          }
          return error(result.error || 'Failed to add dependency');
        } catch (err) {
          return error(err instanceof Error ? err.message : 'Unknown error');
        }
      },
    },

    // beads_dep_tree - Show dependency tree
    {
      name: 'beads_dep_tree',
      description: 'Display the dependency tree for an issue or the entire project',
      category: 'beads',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Issue ID to show tree from (optional, shows full tree if omitted)',
          },
        },
      },
      handler: async (input) => {
        try {
          const wrapper = getWrapper();
          if (!wrapper) {
            return error('Beads wrapper not initialized');
          }

          const params: BeadsDepTreeParams = {
            id: (input.id as string | undefined) || '',
          };

          const result = await wrapper.depTree(params);

          if (result.success && result.data) {
            return success(result.data);
          }
          return error(result.error || 'Failed to get dependency tree');
        } catch (err) {
          return error(err instanceof Error ? err.message : 'Unknown error');
        }
      },
    },

    // beads_blocked - List blocked issues
    {
      name: 'beads_blocked',
      description: 'List all issues that are currently blocked by unresolved dependencies',
      category: 'beads',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        try {
          const wrapper = getWrapper();
          if (!wrapper) {
            return error('Beads wrapper not initialized');
          }

          const result = await wrapper.blocked();

          if (result.success && result.data) {
            return success(result.data);
          }
          return error(result.error || 'Failed to get blocked issues');
        } catch (err) {
          return error(err instanceof Error ? err.message : 'Unknown error');
        }
      },
    },

    // beads_stats - Show statistics
    {
      name: 'beads_stats',
      description: 'Show statistics about issues: counts by status, priority, type, and assignee',
      category: 'beads',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        try {
          const wrapper = getWrapper();
          if (!wrapper) {
            return error('Beads wrapper not initialized');
          }

          const result = await wrapper.stats();

          if (result.success && result.data) {
            return success(result.data);
          }
          return error(result.error || 'Failed to get statistics');
        } catch (err) {
          return error(err instanceof Error ? err.message : 'Unknown error');
        }
      },
    },

    // beads_sync - Sync with remote
    {
      name: 'beads_sync',
      description: 'Synchronize issues with git repository',
      category: 'beads',
      inputSchema: {
        type: 'object',
        properties: {
          force: {
            type: 'boolean',
            description: 'Force sync even if no changes detected',
          },
        },
      },
      handler: async (input) => {
        try {
          const wrapper = getWrapper();
          if (!wrapper) {
            return error('Beads wrapper not initialized');
          }

          const result = await wrapper.sync(input.force as boolean | undefined);

          if (result.success && result.data) {
            return success(result.data);
          }
          return error(result.error || 'Failed to sync');
        } catch (err) {
          return error(err instanceof Error ? err.message : 'Unknown error');
        }
      },
    },
  ];
}

/**
 * Export tools array for registration
 */
export const beadsTools: MCPTool[] = getBeadsTools();
