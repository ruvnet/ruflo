/**
 * SQLite Memory Backend
 *
 * Uses sql.js for cross-platform SQLite support.
 * Persists to disk with configurable sync intervals.
 */

import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { Database } from 'sql.js';
import type { MemoryBackend, MemoryEntry, SearchResult, MemoryStats } from './interface.js';

export interface SQLiteBackendOptions {
  dbPath: string;
  syncIntervalMs?: number;
  enableFTS?: boolean;
  enableVector?: boolean;
}

export class SQLiteBackend implements MemoryBackend {
  readonly name = 'sqlite';
  private db: Database | null = null;
  private options: SQLiteBackendOptions;
  private syncTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(options: SQLiteBackendOptions) {
    this.options = {
      syncIntervalMs: 5000,
      enableFTS: true,
      enableVector: false,
      ...options,
    };
  }

  async init(): Promise<void> {
    const SQL = await initSqlJs();

    // Load existing database or create new
    if (fs.existsSync(this.options.dbPath)) {
      const buffer = fs.readFileSync(this.options.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      // Ensure directory exists
      const dir = path.dirname(this.options.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new SQL.Database();
    }

    // Create tables
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        metadata TEXT,
        timestamp INTEGER NOT NULL,
        ttl INTEGER,
        embedding BLOB
      )
    `);

    // Create FTS index if enabled
    if (this.options.enableFTS) {
      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
          key,
          value_text,
          content='memory',
          content_rowid='rowid'
        )
      `);

      // Trigger to keep FTS in sync
      this.db.run(`
        CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
          INSERT INTO memory_fts(rowid, key, value_text)
          VALUES (NEW.rowid, NEW.key, NEW.value);
        END
      `);

      this.db.run(`
        CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
          INSERT INTO memory_fts(memory_fts, rowid, key, value_text)
          VALUES ('delete', OLD.rowid, OLD.key, OLD.value);
        END
      `);
    }

    // Start sync timer
    if (this.options.syncIntervalMs && this.options.syncIntervalMs > 0) {
      this.syncTimer = setInterval(() => this.sync(), this.options.syncIntervalMs);
    }
  }

  async close(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.dirty) {
      await this.sync();
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private sync(): void {
    if (!this.db || !this.dirty) return;

    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.options.dbPath, buffer);
      this.dirty = false;
    } catch (error) {
      console.error('[SQLiteBackend] Sync failed:', error);
    }
  }

  async store(key: string, value: unknown, metadata?: Record<string, unknown>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const valueJson = JSON.stringify(value);
    const metadataJson = metadata ? JSON.stringify(metadata) : null;
    const timestamp = Date.now();

    this.db.run(
      `INSERT OR REPLACE INTO memory (key, value, metadata, timestamp) VALUES (?, ?, ?, ?)`,
      [key, valueJson, metadataJson, timestamp]
    );

    this.dirty = true;
  }

  async retrieve(key: string): Promise<MemoryEntry | null> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT key, value, metadata, timestamp, ttl FROM memory WHERE key = ?`,
      [key]
    );

    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }

    const row = result[0].values[0];
    return {
      key: row[0] as string,
      value: JSON.parse(row[1] as string),
      metadata: row[2] ? JSON.parse(row[2] as string) : undefined,
      timestamp: row[3] as number,
      ttl: row[4] as number | undefined,
    };
  }

  async delete(key: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');

    const before = this.db.getRowsModified();
    this.db.run(`DELETE FROM memory WHERE key = ?`, [key]);
    const deleted = this.db.getRowsModified() > before;

    if (deleted) {
      this.dirty = true;
    }

    return deleted;
  }

  async list(options?: { limit?: number; offset?: number; prefix?: string }): Promise<MemoryEntry[]> {
    if (!this.db) throw new Error('Database not initialized');

    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const prefix = options?.prefix;

    let sql = `SELECT key, value, metadata, timestamp, ttl FROM memory`;
    const params: unknown[] = [];

    if (prefix) {
      sql += ` WHERE key LIKE ?`;
      params.push(`${prefix}%`);
    }

    sql += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const result = this.db.exec(sql, params);

    if (result.length === 0) {
      return [];
    }

    return result[0].values.map(row => ({
      key: row[0] as string,
      value: JSON.parse(row[1] as string),
      metadata: row[2] ? JSON.parse(row[2] as string) : undefined,
      timestamp: row[3] as number,
      ttl: row[4] as number | undefined,
    }));
  }

  async search(query: string, options?: { limit?: number; threshold?: number }): Promise<SearchResult[]> {
    if (!this.db) throw new Error('Database not initialized');

    const limit = options?.limit ?? 10;

    if (this.options.enableFTS) {
      // Use FTS5 for full-text search
      const result = this.db.exec(
        `SELECT m.key, m.value, m.metadata, bm25(memory_fts) as score
         FROM memory_fts f
         JOIN memory m ON f.rowid = m.rowid
         WHERE memory_fts MATCH ?
         ORDER BY score
         LIMIT ?`,
        [query, limit]
      );

      if (result.length === 0) {
        return [];
      }

      return result[0].values.map(row => ({
        key: row[0] as string,
        value: JSON.parse(row[1] as string),
        metadata: row[2] ? JSON.parse(row[2] as string) : undefined,
        score: Math.abs(row[3] as number), // BM25 returns negative scores
      }));
    }

    // Fallback: simple LIKE search
    const result = this.db.exec(
      `SELECT key, value, metadata FROM memory
       WHERE key LIKE ? OR value LIKE ?
       LIMIT ?`,
      [`%${query}%`, `%${query}%`, limit]
    );

    if (result.length === 0) {
      return [];
    }

    return result[0].values.map((row, i) => ({
      key: row[0] as string,
      value: JSON.parse(row[1] as string),
      metadata: row[2] ? JSON.parse(row[2] as string) : undefined,
      score: 1 - (i / result[0].values.length), // Simple position-based score
    }));
  }

  async stats(): Promise<MemoryStats> {
    if (!this.db) throw new Error('Database not initialized');

    const countResult = this.db.exec(`SELECT COUNT(*) FROM memory`);
    const totalEntries = countResult[0]?.values[0]?.[0] as number ?? 0;

    const sizeResult = this.db.exec(`SELECT SUM(LENGTH(value)) FROM memory`);
    const totalSizeBytes = sizeResult[0]?.values[0]?.[0] as number ?? 0;

    const timeResult = this.db.exec(
      `SELECT MIN(timestamp), MAX(timestamp) FROM memory`
    );
    const oldestEntry = timeResult[0]?.values[0]?.[0] as number | undefined;
    const newestEntry = timeResult[0]?.values[0]?.[1] as number | undefined;

    return {
      totalEntries,
      totalSizeBytes,
      oldestEntry,
      newestEntry,
    };
  }

  async clear(namespace?: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    if (namespace) {
      this.db.run(`DELETE FROM memory WHERE key LIKE ?`, [`${namespace}:%`]);
    } else {
      this.db.run(`DELETE FROM memory`);
    }

    this.dirty = true;
  }

  async health(): Promise<boolean> {
    if (!this.db) return false;

    try {
      this.db.exec(`SELECT 1`);
      return true;
    } catch {
      return false;
    }
  }
}
