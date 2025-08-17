/**
 * SQLite-based memory store for MCP server
 * Provides persistent storage that works with both local and remote npx execution
 */

import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';
import { createDatabase } from './sqlite-wrapper.js';
import { sessionSerializer } from './enhanced-session-serializer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SqliteMemoryStore {
  constructor(options = {}) {
    this.options = {
      dbName: options.dbName || 'memory.db',
      directory: options.directory || this._getMemoryDirectory(),
      ...options,
    };

    this.db = null;
    this.statements = new Map();
    this.isInitialized = false;
  }

  /**
   * Determine the best directory for memory storage
   * Uses .swarm directory in current working directory (consistent with hive-mind approach)
   */
  _getMemoryDirectory() {
    // Always use .swarm directory in the current working directory
    // This ensures consistency whether running locally or via npx
    return path.join(process.cwd(), '.swarm');
  }

  _directoryExists(dir) {
    try {
      const stats = require('fs').statSync(dir);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Ensure directory exists
      await fs.mkdir(this.options.directory, { recursive: true });

      // Open database
      const dbPath = path.join(this.options.directory, this.options.dbName);
      this.db = await createDatabase(dbPath);

      // Enable WAL mode for better concurrency
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');

      // Create tables
      this._createTables();

      // Prepare statements
      this._prepareStatements();

      this.isInitialized = true;

      console.error(
        `[${new Date().toISOString()}] INFO [memory-store] Initialized SQLite at: ${dbPath}`,
      );
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] ERROR [memory-store] Failed to initialize:`,
        error,
      );
      throw error;
    }
  }

  _createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        namespace TEXT NOT NULL DEFAULT 'default',
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        accessed_at INTEGER DEFAULT (strftime('%s', 'now')),
        access_count INTEGER DEFAULT 0,
        ttl INTEGER,
        expires_at INTEGER,
        UNIQUE(key, namespace)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_namespace ON memory_entries(namespace);
      CREATE INDEX IF NOT EXISTS idx_memory_expires ON memory_entries(expires_at) WHERE expires_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_memory_accessed ON memory_entries(accessed_at);
    `);
  }

  _prepareStatements() {
    // Store/update statement
    this.statements.set(
      'upsert',
      this.db.prepare(`
      INSERT INTO memory_entries (key, value, namespace, metadata, ttl, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(key, namespace) DO UPDATE SET
        value = excluded.value,
        metadata = excluded.metadata,
        ttl = excluded.ttl,
        expires_at = excluded.expires_at,
        updated_at = strftime('%s', 'now'),
        access_count = memory_entries.access_count + 1
    `),
    );

    // Retrieve statement
    this.statements.set(
      'get',
      this.db.prepare(`
      SELECT * FROM memory_entries 
      WHERE key = ? AND namespace = ? AND (expires_at IS NULL OR expires_at > strftime('%s', 'now'))
    `),
    );

    // List statement
    this.statements.set(
      'list',
      this.db.prepare(`
      SELECT * FROM memory_entries 
      WHERE namespace = ? AND (expires_at IS NULL OR expires_at > strftime('%s', 'now'))
      ORDER BY updated_at DESC
      LIMIT ?
    `),
    );

    // Delete statement
    this.statements.set(
      'delete',
      this.db.prepare(`
      DELETE FROM memory_entries WHERE key = ? AND namespace = ?
    `),
    );

    // Search statement
    this.statements.set(
      'search',
      this.db.prepare(`
      SELECT * FROM memory_entries 
      WHERE namespace = ? AND (key LIKE ? OR value LIKE ?) 
      AND (expires_at IS NULL OR expires_at > strftime('%s', 'now'))
      ORDER BY access_count DESC, updated_at DESC
      LIMIT ?
    `),
    );

    // Cleanup statement
    this.statements.set(
      'cleanup',
      this.db.prepare(`
      DELETE FROM memory_entries WHERE expires_at IS NOT NULL AND expires_at <= strftime('%s', 'now')
    `),
    );

    // Update access statement
    this.statements.set(
      'updateAccess',
      this.db.prepare(`
      UPDATE memory_entries 
      SET accessed_at = strftime('%s', 'now'), access_count = access_count + 1
      WHERE key = ? AND namespace = ?
    `),
    );
  }

  async store(key, value, options = {}) {
    await this.initialize();

    const namespace = options.namespace || 'default';
    const metadata = options.metadata ? JSON.stringify(options.metadata) : null;
    const ttl = options.ttl || null;
    const expiresAt = ttl ? Math.floor(Date.now() / 1000) + ttl : null;
    const valueStr = typeof value === 'string' ? value : sessionSerializer.serializer.serialize(value);

    try {
      const result = this.statements
        .get('upsert')
        .run(key, valueStr, namespace, metadata, ttl, expiresAt);

      return {
        success: true,
        id: result.lastInsertRowid,
        size: valueStr.length,
      };
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ERROR [memory-store] Store failed:`, error);
      throw error;
    }
  }

  async retrieve(key, options = {}) {
    await this.initialize();

    const namespace = options.namespace || 'default';

    try {
      const row = this.statements.get('get').get(key, namespace);

      if (!row) {
        return null;
      }

      // Update access stats
      this.statements.get('updateAccess').run(key, namespace);

      // Try to deserialize, fall back to raw string
      try {
        return sessionSerializer.serializer.deserialize(row.value);
      } catch {
        return row.value;
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ERROR [memory-store] Retrieve failed:`, error);
      throw error;
    }
  }

  async list(options = {}) {
    await this.initialize();

    const namespace = options.namespace || 'default';
    const limit = options.limit || 100;

    try {
      const rows = this.statements.get('list').all(namespace, limit);

      return rows.map((row) => ({
        key: row.key,
        value: this._tryParseJson(row.value),
        namespace: row.namespace,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
        createdAt: new Date(row.created_at * 1000),
        updatedAt: new Date(row.updated_at * 1000),
        accessCount: row.access_count,
      }));
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ERROR [memory-store] List failed:`, error);
      throw error;
    }
  }

  async delete(key, options = {}) {
    await this.initialize();

    const namespace = options.namespace || 'default';

    try {
      const result = this.statements.get('delete').run(key, namespace);
      return result.changes > 0;
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ERROR [memory-store] Delete failed:`, error);
      throw error;
    }
  }

  async search(pattern, options = {}) {
    await this.initialize();

    const namespace = options.namespace || 'default';
    const limit = options.limit || 50;
    const searchPattern = `%${pattern}%`;

    try {
      const rows = this.statements
        .get('search')
        .all(namespace, searchPattern, searchPattern, limit);

      return rows.map((row) => ({
        key: row.key,
        value: this._tryParseJson(row.value),
        namespace: row.namespace,
        score: row.access_count,
        updatedAt: new Date(row.updated_at * 1000),
      }));
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ERROR [memory-store] Search failed:`, error);
      throw error;
    }
  }

  async cleanup() {
    await this.initialize();

    try {
      const result = this.statements.get('cleanup').run();
      return result.changes;
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ERROR [memory-store] Cleanup failed:`, error);
      throw error;
    }
  }

  _tryParseJson(value) {
    try {
      return sessionSerializer.serializer.deserialize(value);
    } catch {
      return value;
    }
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
    }
  }
}

// Export a singleton instance for MCP server
export const memoryStore = new SqliteMemoryStore();

export { SqliteMemoryStore };
export default SqliteMemoryStore;
