/**
 * SPARC Memory Bank - SQLite Backend
 * High-performance SQLite storage with proper indexing and FTS5
 */

import Database from 'better-sqlite3';
import { MemoryItem, MemoryQuery, MemoryBackend, BackendStats } from '../types';

export interface SqliteBackendConfig {
  path: string;
  readonly?: boolean;
  verbose?: boolean;
  wal?: boolean;
}

export class SqliteBackend implements MemoryBackend {
  private db: Database.Database;
  private config: SqliteBackendConfig;
  private prepared: {
    insert?: Database.Statement;
    get?: Database.Statement;
    delete?: Database.Statement;
    update?: Database.Statement;
  } = {};

  constructor(config: SqliteBackendConfig) {
    this.config = config;
    this.db = new Database(config.path, {
      readonly: config.readonly || false,
      verbose: config.verbose ? console.log : undefined
    });

    // Enable WAL mode for better concurrency
    if (config.wal !== false) {
      this.db.pragma('journal_mode = WAL');
    }

    // Performance optimizations
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');
    this.db.pragma('temp_store = MEMORY');
  }

  async initialize(): Promise<void> {
    // Create main table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_items (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        metadata TEXT,
        vector_embedding BLOB,
        ttl INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        version TEXT,
        namespace TEXT DEFAULT 'default',
        UNIQUE(category, key, namespace)
      )
    `);

    // Create indexes for performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_category ON memory_items(category);
      CREATE INDEX IF NOT EXISTS idx_key ON memory_items(key);
      CREATE INDEX IF NOT EXISTS idx_namespace ON memory_items(namespace);
      CREATE INDEX IF NOT EXISTS idx_created_at ON memory_items(created_at);
      CREATE INDEX IF NOT EXISTS idx_category_key ON memory_items(category, key);
      CREATE INDEX IF NOT EXISTS idx_namespace_category ON memory_items(namespace, category);
    `);

    // Create FTS5 table for full-text search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(
        id UNINDEXED,
        category,
        key,
        value,
        content=memory_items,
        content_rowid=rowid
      );
    `);

    // Create triggers to keep FTS in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_items_ai AFTER INSERT ON memory_items BEGIN
        INSERT INTO memory_items_fts(rowid, id, category, key, value)
        VALUES (new.rowid, new.id, new.category, new.key, new.value);
      END;

      CREATE TRIGGER IF NOT EXISTS memory_items_ad AFTER DELETE ON memory_items BEGIN
        DELETE FROM memory_items_fts WHERE rowid = old.rowid;
      END;

      CREATE TRIGGER IF NOT EXISTS memory_items_au AFTER UPDATE ON memory_items BEGIN
        DELETE FROM memory_items_fts WHERE rowid = old.rowid;
        INSERT INTO memory_items_fts(rowid, id, category, key, value)
        VALUES (new.rowid, new.id, new.category, new.key, new.value);
      END;
    `);

    // Create version history table for time-travel
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL,
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        metadata TEXT,
        version TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        operation TEXT NOT NULL,
        FOREIGN KEY (item_id) REFERENCES memory_items(id)
      );

      CREATE INDEX IF NOT EXISTS idx_versions_item_id ON memory_versions(item_id);
      CREATE INDEX IF NOT EXISTS idx_versions_timestamp ON memory_versions(timestamp);
    `);

    // Prepare statements
    this.prepared.insert = this.db.prepare(`
      INSERT OR REPLACE INTO memory_items 
      (id, category, key, value, metadata, vector_embedding, ttl, created_at, updated_at, version, namespace)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.prepared.get = this.db.prepare(`
      SELECT * FROM memory_items WHERE category = ? AND key = ? AND namespace = ?
    `);

    this.prepared.delete = this.db.prepare(`
      DELETE FROM memory_items WHERE category = ? AND key = ? AND namespace = ?
    `);

    this.prepared.update = this.db.prepare(`
      UPDATE memory_items 
      SET value = ?, metadata = ?, updated_at = ?, version = ?
      WHERE category = ? AND key = ? AND namespace = ?
    `);
  }

  async store(item: MemoryItem): Promise<void> {
    const now = Date.now();
    const namespace = item.metadata?.namespace || 'default';
    
    // Store in main table
    this.prepared.insert!.run(
      item.id,
      item.category,
      item.key,
      JSON.stringify(item.value),
      item.metadata ? JSON.stringify(item.metadata) : null,
      item.vectorEmbedding ? Buffer.from(new Float32Array(item.vectorEmbedding).buffer) : null,
      item.ttl || null,
      now,
      now,
      item.metadata?.version || '1.0',
      namespace
    );

    // Store version history
    this.db.prepare(`
      INSERT INTO memory_versions (item_id, category, key, value, metadata, version, timestamp, operation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id,
      item.category,
      item.key,
      JSON.stringify(item.value),
      item.metadata ? JSON.stringify(item.metadata) : null,
      item.metadata?.version || '1.0',
      now,
      'store'
    );
  }

  async get(category: string, key: string, namespace: string = 'default'): Promise<MemoryItem | null> {
    const row = this.prepared.get!.get(category, key, namespace) as any;
    
    if (!row) return null;

    return this.rowToMemoryItem(row);
  }

  async query(query: MemoryQuery): Promise<MemoryItem[]> {
    let sql = 'SELECT * FROM memory_items WHERE 1=1';
    const params: any[] = [];

    // Build WHERE clause
    if (query.categories && query.categories.length > 0) {
      sql += ` AND category IN (${query.categories.map(() => '?').join(',')})`;
      params.push(...query.categories);
    }

    if (query.keys && query.keys.length > 0) {
      sql += ` AND key IN (${query.keys.map(() => '?').join(',')})`;
      params.push(...query.keys);
    }

    if (query.namespace) {
      sql += ' AND namespace = ?';
      params.push(query.namespace);
    }

    if (query.startTime) {
      sql += ' AND created_at >= ?';
      params.push(query.startTime);
    }

    if (query.endTime) {
      sql += ' AND created_at <= ?';
      params.push(query.endTime);
    }

    // Handle time-travel queries
    if (query.asOf) {
      // Query from version history
      sql = `
        SELECT DISTINCT ON (item_id) * FROM memory_versions 
        WHERE timestamp <= ? 
        ${query.categories ? `AND category IN (${query.categories.map(() => '?').join(',')})` : ''}
        ${query.keys ? `AND key IN (${query.keys.map(() => '?').join(',')})` : ''}
        ORDER BY item_id, timestamp DESC
      `;
      params.unshift(query.asOf);
    }

    // Add ordering
    if (query.orderBy) {
      sql += ` ORDER BY ${query.orderBy} ${query.orderDirection || 'ASC'}`;
    }

    // Add limit and offset
    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);

    let items = rows.map((row: any) => this.rowToMemoryItem(row));

    // Apply custom filter if provided
    if (query.filter) {
      items = items.filter(query.filter);
    }

    return items;
  }

  async delete(category: string, key: string, namespace: string = 'default'): Promise<boolean> {
    // Get item before deletion for version history
    const item = await this.get(category, key, namespace);
    if (!item) return false;

    // Delete from main table
    const result = this.prepared.delete!.run(category, key, namespace);

    // Record deletion in version history
    if (result.changes > 0) {
      this.db.prepare(`
        INSERT INTO memory_versions (item_id, category, key, value, metadata, version, timestamp, operation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.id,
        category,
        key,
        JSON.stringify(item.value),
        item.metadata ? JSON.stringify(item.metadata) : null,
        item.metadata?.version || '1.0',
        Date.now(),
        'delete'
      );
    }

    return result.changes > 0;
  }

  async update(category: string, key: string, updates: Partial<MemoryItem>): Promise<boolean> {
    const namespace = updates.metadata?.namespace || 'default';
    const existing = await this.get(category, key, namespace);
    
    if (!existing) return false;

    const merged = {
      ...existing,
      ...updates,
      metadata: {
        ...existing.metadata,
        ...updates.metadata,
        updated_at: Date.now()
      }
    };

    const result = this.prepared.update!.run(
      JSON.stringify(merged.value),
      JSON.stringify(merged.metadata),
      Date.now(),
      merged.metadata.version,
      category,
      key,
      namespace
    );

    return result.changes > 0;
  }

  async getStats(): Promise<BackendStats> {
    const stats = this.db.prepare(`
      SELECT 
        COUNT(*) as totalItems,
        COUNT(DISTINCT category) as categories,
        SUM(LENGTH(value) + COALESCE(LENGTH(metadata), 0)) as sizeBytes,
        MIN(created_at) as oldestItem,
        MAX(created_at) as newestItem
      FROM memory_items
    `).get() as any;

    return {
      totalItems: stats.totalItems || 0,
      categories: stats.categories || 0,
      sizeBytes: stats.sizeBytes || 0,
      oldestItem: stats.oldestItem,
      newestItem: stats.newestItem
    };
  }

  async close(): Promise<void> {
    this.db.close();
  }

  /**
   * Run full-text search
   */
  async search(searchTerm: string, options?: {
    categories?: string[];
    limit?: number;
  }): Promise<MemoryItem[]> {
    let sql = `
      SELECT mi.* FROM memory_items mi
      JOIN memory_items_fts fts ON mi.rowid = fts.rowid
      WHERE memory_items_fts MATCH ?
    `;
    const params: any[] = [searchTerm];

    if (options?.categories && options.categories.length > 0) {
      sql += ` AND mi.category IN (${options.categories.map(() => '?').join(',')})`;
      params.push(...options.categories);
    }

    sql += ' ORDER BY rank';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);

    return rows.map((row: any) => this.rowToMemoryItem(row));
  }

  /**
   * Vacuum database to reclaim space
   */
  async vacuum(): Promise<void> {
    this.db.exec('VACUUM');
  }

  /**
   * Convert database row to MemoryItem
   */
  private rowToMemoryItem(row: any): MemoryItem {
    return {
      id: row.id,
      category: row.category,
      key: row.key,
      value: JSON.parse(row.value),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      vectorEmbedding: row.vector_embedding ? 
        Array.from(new Float32Array(row.vector_embedding.buffer)) : undefined,
      ttl: row.ttl || undefined
    };
  }
}