/**
 * Unified Memory Manager
 * Provides a single interface for all memory operations across the system
 */

import { promises as fs } from 'fs';
import path from 'path';
import { existsSync } from '../cli/node-compat.js';
import { getProjectRoot, getClaudeFlowDir } from '../utils/project-root.js';

export class UnifiedMemoryManager {
  constructor(options = {}) {
    const claudeFlowDir = getClaudeFlowDir();
    const projectRoot = getProjectRoot();
    this.config = {
      primaryStore: path.join(claudeFlowDir, 'memory', 'unified-memory.db'),
      fallbackStore: path.join(projectRoot, 'memory', 'memory-store.json'),
      configPath: path.join(claudeFlowDir, 'memory-config.json'),
      ...options
    };
    
    this.isInitialized = false;
    this.useSqlite = false;
    this.db = null;
  }

  /**
   * Initialize the memory manager
   */
  async initialize() {
    if (this.isInitialized) return;

    // Check if we have a unified database
    if (existsSync(this.config.primaryStore)) {
      try {
        // Try to load SQLite modules
        const sqlite3Module = await import('sqlite3');
        const sqliteModule = await import('sqlite');
        
        this.sqlite3 = sqlite3Module.default;
        this.sqliteOpen = sqliteModule.open;
        this.useSqlite = true;
        
        // Open database connection
        this.db = await this.sqliteOpen({
          filename: this.config.primaryStore,
          driver: this.sqlite3.Database
        });
        
        // Enable WAL mode for better performance
        await this.db.exec('PRAGMA journal_mode = WAL');
        
      } catch (err) {
        console.warn('SQLite not available, falling back to JSON store');
        this.useSqlite = false;
      }
    }
    
    this.isInitialized = true;
  }

  /**
   * Store a key-value pair
   */
  async store(key, value, namespace = 'default', metadata = {}) {
    await this.initialize();
    
    if (this.useSqlite) {
      return await this.storeSqlite(key, value, namespace, metadata);
    } else {
      return await this.storeJson(key, value, namespace, metadata);
    }
  }

  /**
   * Store in SQLite database
   */
  async storeSqlite(key, value, namespace, metadata) {
    const timestamp = Date.now();
    
    await this.db.run(`
      INSERT OR REPLACE INTO memory_entries (key, value, namespace, timestamp, source)
      VALUES (?, ?, ?, ?, ?)
    `, key, value, namespace, timestamp, 'unified-manager');
    
    return { key, value, namespace, timestamp };
  }

  /**
   * Store in JSON file
   */
  async storeJson(key, value, namespace, metadata) {
    const data = await this.loadJsonData();
    
    if (!data[namespace]) {
      data[namespace] = [];
    }
    
    // Remove existing entry with same key
    data[namespace] = data[namespace].filter((e) => e.key !== key);
    
    // Add new entry
    const entry = {
      key,
      value,
      namespace,
      timestamp: Date.now(),
      ...metadata
    };
    
    data[namespace].push(entry);
    
    await this.saveJsonData(data);
    return entry;
  }

  /**
   * Query memory entries
   */
  async query(search, options = {}) {
    await this.initialize();
    
    if (this.useSqlite) {
      return await this.querySqlite(search, options);
    } else {
      return await this.queryJson(search, options);
    }
  }

  /**
   * Query SQLite database
   */
  async querySqlite(search, options) {
    const { namespace, limit = 100, offset = 0 } = options;
    
    let query = `
      SELECT * FROM memory_entries 
      WHERE (key LIKE ? OR value LIKE ?)
    `;
    
    const params = [`%${search}%`, `%${search}%`];
    
    if (namespace) {
      query += ' AND namespace = ?';
      params.push(namespace);
    }
    
    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const results = await this.db.all(query, ...params);
    return results;
  }

  /**
   * Query JSON store
   */
  async queryJson(search, options) {
    const data = await this.loadJsonData();
    const { namespace, limit = 100, offset = 0 } = options;
    
    const results = [];
    const namespaces = namespace ? [namespace] : Object.keys(data);
    
    for (const ns of namespaces) {
      if (data[ns]) {
        for (const entry of data[ns]) {
          if (entry.key.includes(search) || entry.value.includes(search)) {
            results.push(entry);
          }
        }
      }
    }
    
    // Sort by timestamp (newest first)
    results.sort((a, b) => b.timestamp - a.timestamp);
    
    // Apply pagination
    return results.slice(offset, offset + limit);
  }

  /**
   * Get memory by exact key
   */
  async get(key, namespace = 'default') {
    await this.initialize();
    
    if (this.useSqlite) {
      const result = await this.db.get(`
        SELECT * FROM memory_entries 
        WHERE key = ? AND namespace = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `, key, namespace);
      
      return result;
    } else {
      const data = await this.loadJsonData();
      if (data[namespace]) {
        const entry = data[namespace].find(e => e.key === key);
        return entry;
      }
      return null;
    }
  }

  /**
   * Delete memory entry
   */
  async delete(key, namespace = 'default') {
    await this.initialize();
    
    if (this.useSqlite) {
      await this.db.run(`
        DELETE FROM memory_entries 
        WHERE key = ? AND namespace = ?
      `, key, namespace);
    } else {
      const data = await this.loadJsonData();
      if (data[namespace]) {
        data[namespace] = data[namespace].filter(e => e.key !== key);
        await this.saveJsonData(data);
      }
    }
  }

  /**
   * Clear namespace
   */
  async clearNamespace(namespace) {
    await this.initialize();
    
    if (this.useSqlite) {
      const result = await this.db.run(`
        DELETE FROM memory_entries 
        WHERE namespace = ?
      `, namespace);
      
      return result.changes;
    } else {
      const data = await this.loadJsonData();
      const count = data[namespace] ? data[namespace].length : 0;
      delete data[namespace];
      await this.saveJsonData(data);
      return count;
    }
  }

  /**
   * Get statistics
   */
  async getStats() {
    await this.initialize();
    
    if (this.useSqlite) {
      const stats = await this.db.get(`
        SELECT 
          COUNT(*) as totalEntries,
          COUNT(DISTINCT namespace) as namespaces
        FROM memory_entries
      `);
      
      const namespaceStats = await this.db.all(`
        SELECT namespace, COUNT(*) as count 
        FROM memory_entries 
        GROUP BY namespace
      `);
      
      // Get database size
      const dbInfo = await this.db.get(`
        SELECT page_count * page_size as sizeBytes 
        FROM pragma_page_count(), pragma_page_size()
      `);
      
      return {
        totalEntries: stats.totalEntries,
        namespaces: stats.namespaces,
        namespaceStats: namespaceStats.reduce((acc, ns) => {
          acc[ns.namespace] = ns.count;
          return acc;
        }, {}),
        sizeBytes: dbInfo.sizeBytes,
        storageType: 'sqlite'
      };
    } else {
      const data = await this.loadJsonData();
      let totalEntries = 0;
      const namespaceStats = {};
      
      for (const [namespace, entries] of Object.entries(data)) {
        namespaceStats[namespace] = entries.length;
        totalEntries += entries.length;
      }
      
      return {
        totalEntries,
        namespaces: Object.keys(data).length,
        namespaceStats,
        sizeBytes: new TextEncoder().encode(JSON.stringify(data)).length,
        storageType: 'json'
      };
    }
  }

  /**
   * List all namespaces
   */
  async listNamespaces() {
    await this.initialize();
    
    if (this.useSqlite) {
      const namespaces = await this.db.all(`
        SELECT DISTINCT namespace, COUNT(*) as count 
        FROM memory_entries 
        GROUP BY namespace
        ORDER BY namespace
      `);
      
      return namespaces;
    } else {
      const data = await this.loadJsonData();
      return Object.keys(data).map(namespace => ({
        namespace,
        count: data[namespace].length
      }));
    }
  }

  /**
   * Export data
   */
  async export(filePath, namespace = null) {
    await this.initialize();
    
    let exportData;
    
    if (this.useSqlite) {
      let query = 'SELECT * FROM memory_entries';
      const params = [];
      
      if (namespace) {
        query += ' WHERE namespace = ?';
        params.push(namespace);
      }
      
      const entries = await this.db.all(query, ...params);
      
      // Group by namespace
      exportData = entries.reduce((acc, entry) => {
        if (!acc[entry.namespace]) {
          acc[entry.namespace] = [];
        }
        acc[entry.namespace].push(entry);
        return acc;
      }, {});
    } else {
      const data = await this.loadJsonData();
      exportData = namespace ? { [namespace]: data[namespace] || [] } : data;
    }
    
    await fs.writeFile(filePath, JSON.stringify(exportData, null, 2));
    
    let totalEntries = 0;
    for (const entries of Object.values(exportData)) {
      totalEntries += entries.length;
    }
    
    return {
      namespaces: Object.keys(exportData).length,
      entries: totalEntries,
      size: new TextEncoder().encode(JSON.stringify(exportData)).length
    };
  }

  /**
   * Import data
   */
  async import(filePath, options = {}) {
    await this.initialize();
    
    const content = await fs.readFile(filePath, 'utf8');
    const importData = JSON.parse(content);
    
    let imported = 0;
    
    for (const [namespace, entries] of Object.entries(importData)) {
      for (const entry of entries) {
        await this.store(
          entry.key,
          entry.value,
          entry.namespace || namespace,
          { timestamp: entry.timestamp, source: filePath }
        );
        imported++;
      }
    }
    
    return { imported };
  }

  /**
   * Load JSON data
   */
  async loadJsonData() {
    try {
      const content = await fs.readFile(this.config.fallbackStore, 'utf8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  /**
   * Save JSON data
   */
  async saveJsonData(data) {
    await fs.mkdir(path.dirname(this.config.fallbackStore), { recursive: true });
    await fs.writeFile(this.config.fallbackStore, JSON.stringify(data, null, 2));
  }

  /**
   * Close database connection
   */
  async close() {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.isInitialized = false;
    }
  }

  /**
   * Check if using unified store
   */
  isUnified() {
    return this.useSqlite;
  }

  /**
   * Get storage info
   */
  getStorageInfo() {
    return {
      type: this.useSqlite ? 'sqlite' : 'json',
      path: this.useSqlite ? this.config.primaryStore : this.config.fallbackStore,
      unified: this.useSqlite
    };
  }
}

// Singleton instance
let instance = null;

/**
 * Get unified memory manager instance
 */
export function getUnifiedMemory(options = {}) {
  if (!instance) {
    instance = new UnifiedMemoryManager(options);
  }
  return instance;
}

export default UnifiedMemoryManager;