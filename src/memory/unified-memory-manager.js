/**
 * Unified Memory Manager
 * Provides a single interface for all memory operations across the system
 * Integrates with ReasoningBank for semantic search when available
 */

import { promises as fs } from 'fs';
import path from 'path';
import { existsSync } from '../cli/node-compat.js';
import { getProjectRoot, getClaudeFlowDir } from '../utils/project-root.js';

export class UnifiedMemoryManager {
  constructor(options = {}) {
    const claudeFlowDir = getClaudeFlowDir();
    const projectRoot = getProjectRoot();
    // Use process.cwd() for ReasoningBank path - it should be in the user's working directory
    const workingDir = process.cwd();
    this.config = {
      primaryStore: path.join(claudeFlowDir, 'memory', 'unified-memory.db'),
      fallbackStore: path.join(workingDir, 'memory', 'memory-store.json'),
      reasoningBankPath: path.join(workingDir, '.swarm', 'memory.db'),
      configPath: path.join(claudeFlowDir, 'memory-config.json'),
      ...options
    };

    this.isInitialized = false;
    this.useSqlite = false;
    this.useReasoningBank = false;
    this.db = null;
    this.reasoningBankAdapter = null;
  }

  /**
   * Initialize the memory manager
   */
  async initialize() {
    if (this.isInitialized) return;

    // Priority 1: Check for ReasoningBank (best - has semantic search)
    if (existsSync(this.config.reasoningBankPath)) {
      try {
        // Lazy load ReasoningBank adapter
        const adapter = await import('../reasoningbank/reasoningbank-adapter.js');
        await adapter.initializeReasoningBank();
        this.reasoningBankAdapter = adapter;
        this.useReasoningBank = true;
        console.log('[UnifiedMemory] Using ReasoningBank with semantic search');
      } catch (err) {
        console.warn('[UnifiedMemory] ReasoningBank detected but initialization failed:', err.message);
        this.useReasoningBank = false;
      }
    }

    // Priority 2: Check for unified SQLite database
    if (!this.useReasoningBank && existsSync(this.config.primaryStore)) {
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
        console.log('[UnifiedMemory] Using SQLite database');

      } catch (err) {
        console.warn('[UnifiedMemory] SQLite not available, falling back to JSON store');
        this.useSqlite = false;
      }
    }

    // Priority 3: JSON fallback (always available)
    if (!this.useReasoningBank && !this.useSqlite) {
      console.log('[UnifiedMemory] Using JSON file storage');
    }

    this.isInitialized = true;
  }

  /**
   * Store a key-value pair
   * Supports both APIs for backward compatibility:
   * - New API: store(key, value, namespace, metadata)
   * - Old API: store(key, value, {namespace, ttl, metadata})
   */
  async store(key, value, namespaceOrOptions = 'default', metadata = {}) {
    await this.initialize();

    // Handle old memoryStore API: store(key, value, {namespace, ttl, metadata})
    let namespace, actualMetadata;
    if (typeof namespaceOrOptions === 'object') {
      namespace = namespaceOrOptions.namespace || 'default';
      actualMetadata = namespaceOrOptions.metadata || {};
      // Ignore TTL for now - memoryManager doesn't support it yet
    } else {
      namespace = namespaceOrOptions;
      actualMetadata = metadata;
    }

    if (this.useReasoningBank) {
      return await this.storeReasoningBank(key, value, namespace, actualMetadata);
    } else if (this.useSqlite) {
      return await this.storeSqlite(key, value, namespace, actualMetadata);
    } else {
      return await this.storeJson(key, value, namespace, actualMetadata);
    }
  }

  /**
   * Store in ReasoningBank with semantic embeddings
   */
  async storeReasoningBank(key, value, namespace, metadata) {
    try {
      const memoryId = await this.reasoningBankAdapter.storeMemory(key, value, {
        namespace,
        agent: metadata.agent || 'unified-memory',
        domain: namespace,
        confidence: metadata.confidence || 0.8,
        ...metadata
      });

      return {
        key,
        value,
        namespace,
        timestamp: Date.now(),
        memoryId,
        searchable: true,
        mode: 'reasoningbank'
      };
    } catch (error) {
      console.error('[UnifiedMemory] ReasoningBank store failed:', error.message);
      throw error;
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
   * Query memory entries (with semantic search if ReasoningBank is available)
   */
  async query(search, options = {}) {
    await this.initialize();

    if (this.useReasoningBank) {
      return await this.queryReasoningBank(search, options);
    } else if (this.useSqlite) {
      return await this.querySqlite(search, options);
    } else {
      return await this.queryJson(search, options);
    }
  }

  /**
   * Query ReasoningBank with semantic search
   */
  async queryReasoningBank(search, options) {
    try {
      const { namespace, limit = 10, minConfidence = 0.3 } = options;

      const results = await this.reasoningBankAdapter.queryMemories(search, {
        namespace,
        limit,
        minConfidence
      });

      // Map ReasoningBank results to our format
      return results.map(result => ({
        key: result.key,
        value: result.value,
        namespace: result.namespace,
        timestamp: new Date(result.created_at).getTime(),
        score: result.score,
        confidence: result.confidence,
        usage_count: result.usage_count,
        searchable: true,
        mode: 'reasoningbank'
      }));
    } catch (error) {
      console.error('[UnifiedMemory] ReasoningBank query failed:', error.message);
      return [];
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

    if (this.useReasoningBank) {
      // Use query with exact key match for ReasoningBank
      const results = await this.queryReasoningBank(key, { namespace, limit: 10 });
      // Find exact key match
      const exactMatch = results.find(r => r.key === key);
      return exactMatch || null;
    } else if (this.useSqlite) {
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

    if (this.useReasoningBank) {
      // ReasoningBank doesn't have direct delete by key
      // We would need to implement deleteMemory in the adapter
      console.warn('[UnifiedMemory] Delete not fully supported in ReasoningBank mode');
      return;
    } else if (this.useSqlite) {
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

    if (this.useReasoningBank) {
      // ReasoningBank doesn't have direct clear namespace
      console.warn('[UnifiedMemory] Clear namespace not fully supported in ReasoningBank mode');
      return 0;
    } else if (this.useSqlite) {
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

    if (this.useReasoningBank) {
      try {
        const rbStats = await this.reasoningBankAdapter.getStatus();
        return {
          totalEntries: rbStats.total_memories || 0,
          namespaces: rbStats.total_categories || 0,
          namespaceStats: {},
          sizeBytes: 0,
          storageType: 'reasoningbank',
          avgConfidence: rbStats.avg_confidence,
          totalEmbeddings: rbStats.total_embeddings,
          totalTrajectories: rbStats.total_trajectories
        };
      } catch (error) {
        console.error('[UnifiedMemory] Failed to get ReasoningBank stats:', error.message);
        return {
          totalEntries: 0,
          namespaces: 0,
          namespaceStats: {},
          sizeBytes: 0,
          storageType: 'reasoningbank',
          error: error.message
        };
      }
    } else if (this.useSqlite) {
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

    if (this.useReasoningBank) {
      // ReasoningBank doesn't have a direct namespace listing
      // Return empty array for now
      console.warn('[UnifiedMemory] List namespaces not fully supported in ReasoningBank mode');
      return [];
    } else if (this.useSqlite) {
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
   * Close database connection and cleanup
   */
  async close() {
    if (this.reasoningBankAdapter && this.reasoningBankAdapter.cleanup) {
      this.reasoningBankAdapter.cleanup();
      this.reasoningBankAdapter = null;
    }
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
    this.isInitialized = false;
    this.useReasoningBank = false;
    this.useSqlite = false;
  }

  /**
   * Check if using unified store
   */
  isUnified() {
    return this.useReasoningBank || this.useSqlite;
  }

  /**
   * Check if ReasoningBank is active
   */
  isReasoningBankActive() {
    return this.useReasoningBank;
  }

  /**
   * Get storage info
   */
  getStorageInfo() {
    if (this.useReasoningBank) {
      return {
        type: 'reasoningbank',
        path: this.config.reasoningBankPath,
        unified: true,
        semanticSearch: true,
        features: ['semantic_search', 'embeddings', 'similarity_scores']
      };
    } else if (this.useSqlite) {
      return {
        type: 'sqlite',
        path: this.config.primaryStore,
        unified: true,
        semanticSearch: false
      };
    } else {
      return {
        type: 'json',
        path: this.config.fallbackStore,
        unified: false,
        semanticSearch: false
      };
    }
  }

  /**
   * Backward compatibility: retrieve() method for old memoryStore API
   * @param {string} key - Key to retrieve
   * @param {object} options - Options object with namespace
   * @returns {Promise<string|null>} - Value or null
   */
  async retrieve(key, options = {}) {
    const namespace = options.namespace || 'default';
    const entry = await this.get(key, namespace);
    return entry?.value || null;
  }

  /**
   * Backward compatibility: list() method for old memoryStore API
   * @param {object} options - Options object with namespace and limit
   * @returns {Promise<Array>} - List of entries
   */
  async list(options = {}) {
    const namespace = options.namespace || 'default';
    const limit = options.limit || 100;
    return await this.query('', { namespace, limit });
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