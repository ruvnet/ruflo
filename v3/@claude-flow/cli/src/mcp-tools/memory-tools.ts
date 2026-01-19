/**
 * Memory MCP Tools for CLI
 *
 * Tool definitions for memory management with SQLite persistence.
 * Uses sql.js (WASM) for cross-platform compatibility.
 *
 * FIXED: Now uses the same SQLite database as CLI commands (.swarm/memory.db)
 * instead of a separate JSON file store. This ensures MCP tools and CLI
 * commands see the same data.
 *
 * FIXED: Uses mtime-based cache invalidation to detect CLI changes.
 * - Fast path (~0.1ms): stat() check when file unchanged
 * - Reload path (~few ms): only when CLI has written to the database
 *
 * Related:
 * - https://github.com/ruvnet/claude-flow/issues/967 (SQLite unification)
 * - https://github.com/ruvnet/claude-flow/issues/969 (mtime cache invalidation)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import type { MCPTool } from './types.js';

// Type for sql.js Database
interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
  export(): Uint8Array;
  getRowsModified(): number;
}

interface SqlJsStatic {
  Database: new (data?: ArrayLike<number>) => SqlJsDatabase;
}

// Lazy-loaded sql.js instance
let SQL: SqlJsStatic | null = null;
let db: SqlJsDatabase | null = null;
let dbPath: string | null = null;
let lastMtime: number | null = null; // Track file modification time for smart cache invalidation

// Database paths to search (in order of preference)
const DB_PATHS = [
  '.swarm/memory.db',
  '.claude/memory.db',
  'data/memory.db',
];

/**
 * Find the memory database path
 */
function findDatabasePath(): string {
  for (const p of DB_PATHS) {
    const fullPath = resolve(process.cwd(), p);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  // Default to first path if none exist
  return resolve(process.cwd(), DB_PATHS[0]);
}

/**
 * Initialize sql.js and load the database
 *
 * Uses mtime-based cache invalidation to detect CLI changes.
 * - Fast path (~0.1ms): stat() check when file unchanged
 * - Reload path (~few ms): only when CLI has written to the database
 */
async function initDatabase(): Promise<SqlJsDatabase> {
  try {
    // Dynamic import for sql.js (cached after first load)
    if (!SQL) {
      const initSqlJs = (await import('sql.js')).default;
      SQL = await initSqlJs();
    }

    const currentPath = findDatabasePath();

    // Check if we need to reload (path changed or file modified)
    let needsReload = !db || dbPath !== currentPath;

    if (!needsReload && existsSync(currentPath)) {
      const stats = statSync(currentPath);
      const currentMtime = stats.mtimeMs;
      if (currentMtime !== lastMtime) {
        needsReload = true;
      }
    }

    if (needsReload) {
      dbPath = currentPath;

      if (existsSync(dbPath)) {
        // Load database from disk
        const buffer = readFileSync(dbPath);
        db = new SQL.Database(buffer);
        // Update cached mtime
        const stats = statSync(dbPath);
        lastMtime = stats.mtimeMs;
      } else {
        // Create new database with schema
        db = new SQL.Database();
        initializeSchema(db);
        persistDatabase();
      }
    }

    return db!;
  } catch (error) {
    console.error('Failed to initialize sql.js database:', error);
    throw error;
  }
}

/**
 * Initialize database schema (matches CLI schema)
 */
function initializeSchema(database: SqlJsDatabase): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      namespace TEXT DEFAULT 'default',
      content TEXT NOT NULL,
      type TEXT DEFAULT 'semantic',
      embedding TEXT,
      embedding_model TEXT DEFAULT 'local',
      embedding_dimensions INTEGER,
      tags TEXT,
      metadata TEXT,
      owner_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      expires_at INTEGER,
      last_accessed_at INTEGER,
      access_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      UNIQUE(namespace, key)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_namespace ON memory_entries(namespace);
    CREATE INDEX IF NOT EXISTS idx_memory_key ON memory_entries(key);
    CREATE INDEX IF NOT EXISTS idx_memory_status ON memory_entries(status);
  `);
}

/**
 * Persist database to disk and update mtime cache
 */
function persistDatabase(): void {
  if (!db || !dbPath) return;

  try {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(dbPath, buffer);

    // Update cached mtime so we don't reload our own write
    const stats = statSync(dbPath);
    lastMtime = stats.mtimeMs;
  } catch (error) {
    console.error('Failed to persist database:', error);
  }
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export const memoryTools: MCPTool[] = [
  {
    name: 'memory/store',
    description: 'Store a value in memory (SQLite backend)',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
        value: { description: 'Value to store' },
        namespace: { type: 'string', description: 'Namespace (default: default)' },
        metadata: { type: 'object', description: 'Optional metadata' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
      },
      required: ['key', 'value'],
    },
    handler: async (input) => {
      const database = await initDatabase();
      const key = input.key as string;
      const namespace = (input.namespace as string) || 'default';
      const value = typeof input.value === 'string' ? input.value : JSON.stringify(input.value);
      const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
      const tags = input.tags ? JSON.stringify(input.tags) : null;
      const now = Date.now();

      try {
        // Check if entry exists
        const existing = database.exec(
          `SELECT id FROM memory_entries WHERE namespace = ? AND key = ?`,
          [namespace, key]
        );

        if (existing.length > 0 && existing[0].values.length > 0) {
          // Update existing entry
          database.run(
            `UPDATE memory_entries SET content = ?, metadata = ?, tags = ?, updated_at = ? WHERE namespace = ? AND key = ?`,
            [value, metadata, tags, now, namespace, key]
          );
        } else {
          // Insert new entry
          const id = generateId();
          database.run(
            `INSERT INTO memory_entries (id, key, namespace, content, metadata, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, key, namespace, value, metadata, tags, now, now]
          );
        }

        persistDatabase();

        const countResult = database.exec(
          `SELECT COUNT(*) as count FROM memory_entries WHERE status = 'active'`
        );
        const totalEntries = countResult[0]?.values[0]?.[0] || 0;

        return {
          success: true,
          key,
          namespace,
          stored: true,
          storedAt: new Date(now).toISOString(),
          totalEntries,
          backend: 'sqlite',
        };
      } catch (error) {
        return {
          success: false,
          key,
          error: String(error),
          backend: 'sqlite',
        };
      }
    },
  },
  {
    name: 'memory/retrieve',
    description: 'Retrieve a value from memory (SQLite backend)',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
        namespace: { type: 'string', description: 'Namespace (default: default)' },
      },
      required: ['key'],
    },
    handler: async (input) => {
      const database = await initDatabase();
      const key = input.key as string;
      const namespace = (input.namespace as string) || 'default';
      const now = Date.now();

      try {
        const result = database.exec(
          `SELECT content, metadata, tags, created_at, access_count FROM memory_entries WHERE namespace = ? AND key = ? AND status = 'active'`,
          [namespace, key]
        );

        if (result.length > 0 && result[0].values.length > 0) {
          const row = result[0].values[0];
          const content = row[0] as string;
          const metadata = row[1] ? JSON.parse(row[1] as string) : {};
          const tags = row[2] ? JSON.parse(row[2] as string) : [];
          const createdAt = row[3] as number;
          const accessCount = (row[4] as number) + 1;

          // Update access stats
          database.run(
            `UPDATE memory_entries SET access_count = ?, last_accessed_at = ? WHERE namespace = ? AND key = ?`,
            [accessCount, now, namespace, key]
          );
          persistDatabase();

          // Try to parse content as JSON, fallback to string
          let value: unknown = content;
          try {
            value = JSON.parse(content);
          } catch {
            // Keep as string
          }

          return {
            key,
            namespace,
            value,
            metadata,
            tags,
            storedAt: new Date(createdAt).toISOString(),
            accessCount,
            found: true,
            backend: 'sqlite',
          };
        }

        return {
          key,
          namespace,
          value: null,
          found: false,
          backend: 'sqlite',
        };
      } catch (error) {
        return {
          key,
          namespace,
          value: null,
          found: false,
          error: String(error),
          backend: 'sqlite',
        };
      }
    },
  },
  {
    name: 'memory/search',
    description: 'Search memory by keyword (SQLite backend)',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        namespace: { type: 'string', description: 'Namespace filter' },
        limit: { type: 'number', description: 'Result limit' },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const database = await initDatabase();
      const query = (input.query as string).toLowerCase();
      const namespace = input.namespace as string | undefined;
      const limit = (input.limit as number) || 10;
      const startTime = performance.now();

      try {
        let sql = `SELECT key, namespace, content, created_at FROM memory_entries WHERE status = 'active' AND (LOWER(key) LIKE ? OR LOWER(content) LIKE ?)`;
        const params: unknown[] = [`%${query}%`, `%${query}%`];

        if (namespace) {
          sql += ` AND namespace = ?`;
          params.push(namespace);
        }

        sql += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(limit);

        const result = database.exec(sql, params);
        const duration = performance.now() - startTime;

        const results = (result[0]?.values || []).map((row) => {
          let value: unknown = row[2];
          try {
            value = JSON.parse(row[2] as string);
          } catch {
            // Keep as string
          }

          return {
            key: row[0],
            namespace: row[1],
            value,
            score: 1.0,
            storedAt: new Date(row[3] as number).toISOString(),
          };
        });

        return {
          query: input.query,
          results,
          total: results.length,
          searchTime: `${duration.toFixed(2)}ms`,
          backend: 'sqlite',
        };
      } catch (error) {
        return {
          query: input.query,
          results: [],
          total: 0,
          error: String(error),
          backend: 'sqlite',
        };
      }
    },
  },
  {
    name: 'memory/delete',
    description: 'Delete a memory entry (SQLite backend)',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
        namespace: { type: 'string', description: 'Namespace (default: default)' },
      },
      required: ['key'],
    },
    handler: async (input) => {
      const database = await initDatabase();
      const key = input.key as string;
      const namespace = (input.namespace as string) || 'default';

      try {
        // Soft delete by setting status
        database.run(
          `UPDATE memory_entries SET status = 'deleted', updated_at = ? WHERE namespace = ? AND key = ? AND status = 'active'`,
          [Date.now(), namespace, key]
        );

        const changes = database.getRowsModified();
        persistDatabase();

        const countResult = database.exec(
          `SELECT COUNT(*) as count FROM memory_entries WHERE status = 'active'`
        );
        const remainingEntries = countResult[0]?.values[0]?.[0] || 0;

        return {
          success: changes > 0,
          key,
          namespace,
          deleted: changes > 0,
          remainingEntries,
          backend: 'sqlite',
        };
      } catch (error) {
        return {
          success: false,
          key,
          namespace,
          deleted: false,
          error: String(error),
          backend: 'sqlite',
        };
      }
    },
  },
  {
    name: 'memory/list',
    description: 'List all memory entries (SQLite backend)',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Namespace filter' },
        limit: { type: 'number', description: 'Result limit' },
        offset: { type: 'number', description: 'Result offset' },
      },
    },
    handler: async (input) => {
      const database = await initDatabase();
      const namespace = input.namespace as string | undefined;
      const limit = (input.limit as number) || 50;
      const offset = (input.offset as number) || 0;

      try {
        let sql = `SELECT key, namespace, content, created_at, access_count FROM memory_entries WHERE status = 'active'`;
        const params: unknown[] = [];

        if (namespace) {
          sql += ` AND namespace = ?`;
          params.push(namespace);
        }

        sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const result = database.exec(sql, params);

        // Get total count
        let countSql = `SELECT COUNT(*) FROM memory_entries WHERE status = 'active'`;
        if (namespace) {
          countSql += ` AND namespace = ?`;
        }
        const countResult = database.exec(countSql, namespace ? [namespace] : []);
        const total = countResult[0]?.values[0]?.[0] || 0;

        const entries = (result[0]?.values || []).map((row) => {
          const content = row[2] as string;
          return {
            key: row[0],
            namespace: row[1],
            storedAt: new Date(row[3] as number).toISOString(),
            accessCount: row[4],
            preview: content.substring(0, 50) + (content.length > 50 ? '...' : ''),
          };
        });

        return {
          entries,
          total,
          limit,
          offset,
          backend: 'sqlite',
        };
      } catch (error) {
        return {
          entries: [],
          total: 0,
          limit,
          offset,
          error: String(error),
          backend: 'sqlite',
        };
      }
    },
  },
  {
    name: 'memory/stats',
    description: 'Get memory storage statistics (SQLite backend)',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const database = await initDatabase();
      const path = findDatabasePath();

      try {
        const countResult = database.exec(
          `SELECT COUNT(*) FROM memory_entries WHERE status = 'active'`
        );
        const totalEntries = countResult[0]?.values[0]?.[0] || 0;

        const namespaceResult = database.exec(
          `SELECT DISTINCT namespace FROM memory_entries WHERE status = 'active'`
        );
        const namespaces = (namespaceResult[0]?.values || []).map((row) => row[0] as string);

        const oldestResult = database.exec(
          `SELECT MIN(created_at) FROM memory_entries WHERE status = 'active'`
        );
        const oldestTimestamp = oldestResult[0]?.values[0]?.[0] as number | null;

        const newestResult = database.exec(
          `SELECT MAX(created_at) FROM memory_entries WHERE status = 'active'`
        );
        const newestTimestamp = newestResult[0]?.values[0]?.[0] as number | null;

        // Get database file size
        let totalSize = 0;
        try {
          if (existsSync(path)) {
            const stats = statSync(path);
            totalSize = stats.size;
          }
        } catch {
          // Ignore size errors
        }

        return {
          totalEntries,
          totalSize: `${(totalSize / 1024).toFixed(2)} KB`,
          namespaces,
          version: '3.0.0',
          backend: 'sqlite',
          location: path,
          oldestEntry: oldestTimestamp ? new Date(oldestTimestamp).toISOString() : null,
          newestEntry: newestTimestamp ? new Date(newestTimestamp).toISOString() : null,
        };
      } catch (error) {
        return {
          totalEntries: 0,
          totalSize: '0 KB',
          version: '3.0.0',
          backend: 'sqlite',
          location: path,
          error: String(error),
        };
      }
    },
  },
];
