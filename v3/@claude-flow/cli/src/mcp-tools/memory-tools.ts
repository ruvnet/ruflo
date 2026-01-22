/**
 * Memory MCP Tools for CLI
 *
 * Tool definitions for memory management with SQLite persistence.
 * Issue #967: MCP and CLI now share the same SQLite database at .swarm/memory.db
 *
 * This ensures data consistency between MCP tool calls and CLI commands.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import type { MCPTool } from './types.js';

// Default database location (same as CLI uses)
const DEFAULT_DB_DIR = '.swarm';
const DEFAULT_DB_NAME = 'memory.db';

/**
 * Get the database path, checking multiple locations for compatibility
 */
function getDbPath(): string {
  const locations = [
    join(process.cwd(), DEFAULT_DB_DIR, DEFAULT_DB_NAME),
    join(process.cwd(), '.claude-flow', DEFAULT_DB_NAME),
    join(process.cwd(), '.claude', DEFAULT_DB_NAME),
    join(process.cwd(), 'data', DEFAULT_DB_NAME),
  ];

  for (const loc of locations) {
    if (existsSync(loc)) {
      return loc;
    }
  }

  // Default to standard location
  return join(process.cwd(), DEFAULT_DB_DIR, DEFAULT_DB_NAME);
}

/**
 * Validate that a required string parameter is present and non-empty
 */
function validateRequiredString(value: unknown, paramName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(\`Missing or empty required parameter: \${paramName}\`);
  }
  return value.trim();
}

export const memoryTools: MCPTool[] = [
  {
    name: 'memory_store',
    description: 'Store a value in memory (persisted to SQLite database at .swarm/memory.db)',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
        value: { description: 'Value to store (will be JSON stringified if object)' },
        namespace: { type: 'string', description: 'Memory namespace (default: "default")' },
        metadata: { type: 'object', description: 'Optional metadata' },
        tags: { type: 'array', description: 'Optional tags for categorization' },
      },
      required: ['key', 'value'],
    },
    handler: async (input) => {
      const key = validateRequiredString(input.key, 'key');
      const namespace = typeof input.namespace === 'string' ? input.namespace : 'default';
      const tags = Array.isArray(input.tags) ? input.tags.filter((t): t is string => typeof t === 'string') : [];

      // Convert value to string if needed
      let valueStr: string;
      if (typeof input.value === 'string') {
        valueStr = input.value;
      } else {
        valueStr = JSON.stringify(input.value);
      }

      try {
        // Dynamic import to avoid circular dependencies
        const { storeEntry, initializeMemoryDatabase } = await import('../memory/memory-initializer.js');
        const dbPath = getDbPath();

        // Ensure database exists
        if (!existsSync(dbPath)) {
          await initializeMemoryDatabase({ force: false });
        }

        const result = await storeEntry({
          key,
          value: valueStr,
          namespace,
          tags,
          generateEmbeddingFlag: true,
          dbPath,
        });

        if (!result.success) {
          return {
            success: false,
            error: result.error || 'Failed to store entry',
            backend: 'sqlite',
          };
        }

        return {
          success: true,
          key,
          namespace,
          stored: true,
          storedAt: new Date().toISOString(),
          id: result.id,
          embedding: result.embedding,
          backend: 'sqlite',
          location: dbPath,
        };
      } catch (error) {
        return {
          success: false,
          key,
          error: error instanceof Error ? error.message : String(error),
          backend: 'sqlite',
        };
      }
    },
  },
  {
    name: 'memory_retrieve',
    description: 'Retrieve a value from memory by key',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
        namespace: { type: 'string', description: 'Memory namespace (default: "default")' },
      },
      required: ['key'],
    },
    handler: async (input) => {
      const key = validateRequiredString(input.key, 'key');
      const namespace = typeof input.namespace === 'string' ? input.namespace : 'default';

      try {
        const { getEntry } = await import('../memory/memory-initializer.js');
        const dbPath = getDbPath();

        const result = await getEntry({
          key,
          namespace,
          dbPath,
        });

        if (!result.success) {
          return {
            key,
            namespace,
            value: null,
            found: false,
            error: result.error,
            backend: 'sqlite',
          };
        }

        if (!result.found || !result.entry) {
          return {
            key,
            namespace,
            value: null,
            found: false,
            backend: 'sqlite',
          };
        }

        // Try to parse JSON value
        let value: unknown = result.entry.content;
        try {
          value = JSON.parse(result.entry.content);
        } catch {
          // Keep as string if not valid JSON
        }

        return {
          key,
          namespace,
          value,
          found: true,
          accessCount: result.entry.accessCount,
          createdAt: result.entry.createdAt,
          updatedAt: result.entry.updatedAt,
          hasEmbedding: result.entry.hasEmbedding,
          tags: result.entry.tags,
          backend: 'sqlite',
        };
      } catch (error) {
        return {
          key,
          namespace,
          value: null,
          found: false,
          error: error instanceof Error ? error.message : String(error),
          backend: 'sqlite',
        };
      }
    },
  },
  {
    name: 'memory_search',
    description: 'Search memory by keyword or semantic similarity (uses HNSW index for 150x faster search)',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        namespace: { type: 'string', description: 'Namespace to search in (default: "default", use "all" for all namespaces)' },
        limit: { type: 'number', description: 'Result limit (default: 10)' },
        threshold: { type: 'number', description: 'Minimum similarity threshold 0-1 (default: 0.3)' },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const query = validateRequiredString(input.query, 'query');
      const namespace = typeof input.namespace === 'string' ? input.namespace : 'default';
      const limit = typeof input.limit === 'number' ? input.limit : 10;
      const threshold = typeof input.threshold === 'number' ? input.threshold : 0.3;
      const startTime = performance.now();

      try {
        const { searchEntries, getHNSWStatus } = await import('../memory/memory-initializer.js');
        const dbPath = getDbPath();

        const result = await searchEntries({
          query,
          namespace,
          limit,
          threshold,
          dbPath,
        });

        const duration = performance.now() - startTime;
        const hnswStatus = getHNSWStatus();

        if (!result.success) {
          return {
            query,
            namespace,
            results: [],
            total: 0,
            searchTime: \`\${duration.toFixed(2)}ms\`,
            error: result.error,
            backend: 'sqlite',
            hnswEnabled: hnswStatus.available,
          };
        }

        return {
          query,
          namespace,
          results: result.results,
          total: result.results.length,
          searchTime: \`\${result.searchTime}ms\`,
          backend: 'sqlite',
          hnswEnabled: hnswStatus.available,
          hnswEntries: hnswStatus.entryCount,
        };
      } catch (error) {
        const duration = performance.now() - startTime;
        return {
          query,
          namespace,
          results: [],
          total: 0,
          searchTime: \`\${duration.toFixed(2)}ms\`,
          error: error instanceof Error ? error.message : String(error),
          backend: 'sqlite',
        };
      }
    },
  },
  {
    name: 'memory_delete',
    description: 'Delete a memory entry by key',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key to delete' },
        namespace: { type: 'string', description: 'Memory namespace (default: "default")' },
      },
      required: ['key'],
    },
    handler: async (input) => {
      const key = validateRequiredString(input.key, 'key');
      const namespace = typeof input.namespace === 'string' ? input.namespace : 'default';

      try {
        const { deleteEntry } = await import('../memory/memory-initializer.js');
        const dbPath = getDbPath();

        const result = await deleteEntry({
          key,
          namespace,
          dbPath,
        });

        return {
          success: result.success,
          key: result.key,
          namespace: result.namespace,
          deleted: result.deleted,
          remainingEntries: result.remainingEntries,
          error: result.error,
          backend: 'sqlite',
        };
      } catch (error) {
        return {
          success: false,
          key,
          namespace,
          deleted: false,
          error: error instanceof Error ? error.message : String(error),
          backend: 'sqlite',
        };
      }
    },
  },
  {
    name: 'memory_list',
    description: 'List all memory entries',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Filter by namespace' },
        limit: { type: 'number', description: 'Result limit (default: 50)' },
        offset: { type: 'number', description: 'Result offset for pagination (default: 0)' },
      },
    },
    handler: async (input) => {
      const namespace = typeof input.namespace === 'string' ? input.namespace : undefined;
      const limit = typeof input.limit === 'number' ? input.limit : 50;
      const offset = typeof input.offset === 'number' ? input.offset : 0;

      try {
        const { listEntries } = await import('../memory/memory-initializer.js');
        const dbPath = getDbPath();

        const result = await listEntries({
          namespace,
          limit,
          offset,
          dbPath,
        });

        if (!result.success) {
          return {
            entries: [],
            total: 0,
            limit,
            offset,
            error: result.error,
            backend: 'sqlite',
          };
        }

        // Format entries for display
        const entries = result.entries.map(e => ({
          key: e.key,
          namespace: e.namespace,
          size: e.size,
          accessCount: e.accessCount,
          createdAt: e.createdAt,
          hasEmbedding: e.hasEmbedding,
        }));

        return {
          entries,
          total: result.total,
          limit,
          offset,
          backend: 'sqlite',
          location: dbPath,
        };
      } catch (error) {
        return {
          entries: [],
          total: 0,
          limit,
          offset,
          error: error instanceof Error ? error.message : String(error),
          backend: 'sqlite',
        };
      }
    },
  },
  {
    name: 'memory_stats',
    description: 'Get memory storage statistics',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      try {
        const { listEntries, getHNSWStatus, checkMemoryInitialization } = await import('../memory/memory-initializer.js');
        const dbPath = getDbPath();

        // Check initialization status
        const initStatus = await checkMemoryInitialization(dbPath);
        const hnswStatus = getHNSWStatus();

        // Get entry count
        const listResult = await listEntries({ limit: 1, dbPath });

        // Get file size
        let fileSize = '0 KB';
        try {
          const { statSync } = await import('fs');
          const stats = statSync(dbPath);
          fileSize = \`\${(stats.size / 1024).toFixed(2)} KB\`;
        } catch {
          // File might not exist
        }

        return {
          totalEntries: listResult.total || 0,
          totalSize: fileSize,
          version: initStatus.version || '3.0.0',
          backend: 'sqlite',
          location: dbPath,
          initialized: initStatus.initialized,
          features: initStatus.features || {
            vectorEmbeddings: false,
            patternLearning: false,
            temporalDecay: false,
          },
          hnsw: {
            available: hnswStatus.available,
            initialized: hnswStatus.initialized,
            entryCount: hnswStatus.entryCount,
            dimensions: hnswStatus.dimensions,
          },
          tables: initStatus.tables || [],
        };
      } catch (error) {
        const dbPath = getDbPath();
        return {
          totalEntries: 0,
          totalSize: '0 KB',
          version: '3.0.0',
          backend: 'sqlite',
          location: dbPath,
          initialized: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
];
