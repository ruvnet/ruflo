/**
 * AgentDB Memory Adapter - v1.3.9 Integration
 * Extends EnhancedMemory with vector search capabilities
 * 100% backward compatible with existing memory operations
 */

import { EnhancedMemory } from './enhanced-memory.js';
import { AgentDBBackend } from './backends/agentdb.js';

export class AgentDBMemoryAdapter extends EnhancedMemory {
  constructor(options = {}) {
    super(options);

    /**
     * Operational modes:
     * - 'hybrid': AgentDB for new features, fallback to legacy (default, recommended)
     * - 'agentdb': AgentDB only, fail if unavailable
     * - 'legacy': Legacy only, no AgentDB features
     */
    this.mode = options.mode || 'hybrid';

    /**
     * AgentDB instance for vector operations
     * Null if mode is 'legacy' or initialization fails
     */
    this.agentdb = null;

    /**
     * Track initialization state
     */
    this.agentdbInitialized = false;
    this.agentdbError = null;
  }

  async initialize() {
    // Always initialize legacy memory first
    await super.initialize();

    // Initialize AgentDB if mode allows
    if (this.mode !== 'legacy') {
      try {
        this.agentdb = new AgentDBBackend({
          dbPath: this.options.agentdbPath || '.agentdb/claude-flow.db',
          quantization: this.options.quantization || 'scalar',
          enableHNSW: this.options.enableHNSW !== false,
        });

        await this.agentdb.initialize();
        this.agentdbInitialized = true;

        console.error(
          `[${new Date().toISOString()}] INFO [agentdb-adapter] AgentDB initialized in ${this.mode} mode`,
        );
      } catch (error) {
        this.agentdbError = error;

        if (this.mode === 'agentdb') {
          // Fail hard if AgentDB-only mode
          throw new Error(`AgentDB initialization failed in agentdb-only mode: ${error.message}`);
        }

        // Hybrid mode: warn and continue with legacy
        console.error(
          `[${new Date().toISOString()}] WARN [agentdb-adapter] AgentDB initialization failed, using legacy mode: ${error.message}`,
        );
      }
    }
  }

  /**
   * Check if AgentDB is available
   * @returns {boolean} True if AgentDB is initialized and ready
   */
  isAgentDBAvailable() {
    return this.agentdbInitialized && this.agentdb !== null;
  }

  /**
   * Store data with optional vector embedding
   * Backward compatible with legacy store() method
   *
   * @param {string} key - Storage key
   * @param {*} value - Value to store
   * @param {Object} options - Storage options
   * @param {string} options.embedding - Optional embedding vector for semantic search
   * @param {Object} options.metadata - Metadata for the entry
   * @param {string} options.namespace - Namespace for organization
   * @param {number} options.ttl - Time to live in seconds
   * @returns {Promise<*>} Storage result
   */
  async storeWithEmbedding(key, value, options = {}) {
    // Always store in legacy for backward compatibility
    const legacyResult = await this.store(key, value, options);

    // If embedding provided and AgentDB available, store vector
    if (options.embedding && this.isAgentDBAvailable()) {
      try {
        await this.agentdb.storeVector(key, options.embedding, {
          value,
          metadata: options.metadata,
          namespace: options.namespace,
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error(
          `[${new Date().toISOString()}] WARN [agentdb-adapter] Vector storage failed: ${error.message}`,
        );
        // Don't fail if vector storage fails in hybrid mode
      }
    }

    return legacyResult;
  }

  /**
   * Perform semantic vector search
   * Falls back to legacy search if AgentDB unavailable
   *
   * @param {Array<number>|string} query - Query vector or embedding
   * @param {Object} options - Search options
   * @param {number} options.k - Number of results (default: 10)
   * @param {string} options.namespace - Filter by namespace
   * @param {Object} options.filter - Additional filters
   * @returns {Promise<Array>} Search results with similarity scores
   */
  async vectorSearch(query, options = {}) {
    if (!this.isAgentDBAvailable()) {
      // Fallback to legacy pattern search
      console.error(
        `[${new Date().toISOString()}] WARN [agentdb-adapter] AgentDB unavailable, falling back to legacy search`,
      );

      const pattern = typeof query === 'string' ? query : '*';
      return this.search(pattern, {
        namespace: options.namespace,
        limit: options.k || 10,
      });
    }

    try {
      return await this.agentdb.search(query, {
        k: options.k || 10,
        namespace: options.namespace,
        filter: options.filter,
      });
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] ERROR [agentdb-adapter] Vector search failed: ${error.message}`,
      );

      // Fallback to legacy in hybrid mode
      if (this.mode === 'hybrid') {
        const pattern = typeof query === 'string' ? query : '*';
        return this.search(pattern, {
          namespace: options.namespace,
          limit: options.k || 10,
        });
      }

      throw error;
    }
  }

  /**
   * Retrieve semantically similar data
   * Combines vector search with legacy retrieval
   *
   * @param {string} query - Query text or embedding
   * @param {Object} options - Retrieval options
   * @returns {Promise<*>} Retrieved value or null
   */
  async semanticRetrieve(query, options = {}) {
    if (!this.isAgentDBAvailable()) {
      // Fallback to exact key match
      return this.retrieve(query, options);
    }

    try {
      const results = await this.vectorSearch(query, {
        k: 1,
        namespace: options.namespace,
        filter: options.filter,
      });

      if (results.length === 0) {
        return null;
      }

      // Return the most similar result
      return results[0].value || results[0].metadata?.value;
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] WARN [agentdb-adapter] Semantic retrieve failed: ${error.message}`,
      );

      // Fallback to exact match
      return this.retrieve(query, options);
    }
  }

  /**
   * Store knowledge with semantic embedding
   * Enhanced version of storeKnowledge with vector support
   */
  async storeKnowledgeWithEmbedding(domain, key, value, metadata = {}, embedding = null) {
    // Store in legacy knowledge base
    const legacyResult = await this.storeKnowledge(domain, key, value, metadata);

    // If embedding provided, store vector
    if (embedding && this.isAgentDBAvailable()) {
      try {
        await this.agentdb.storeVector(`knowledge:${domain}:${key}`, embedding, {
          domain,
          key,
          value,
          metadata,
          createdAt: Date.now(),
        });
      } catch (error) {
        console.error(
          `[${new Date().toISOString()}] WARN [agentdb-adapter] Knowledge vector storage failed: ${error.message}`,
        );
      }
    }

    return legacyResult;
  }

  /**
   * Search knowledge semantically
   * Enhanced version of searchKnowledge with vector support
   */
  async searchKnowledgeSemantic(domain, queryEmbedding, options = {}) {
    if (!this.isAgentDBAvailable()) {
      // Fallback to legacy pattern search
      return this.searchKnowledge(domain, '*');
    }

    try {
      return await this.agentdb.search(queryEmbedding, {
        k: options.limit || 50,
        filter: { domain },
      });
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] WARN [agentdb-adapter] Semantic knowledge search failed: ${error.message}`,
      );
      return this.searchKnowledge(domain, '*');
    }
  }

  /**
   * Get AgentDB statistics
   * @returns {Promise<Object>} Database statistics
   */
  async getAgentDBStats() {
    if (!this.isAgentDBAvailable()) {
      return {
        available: false,
        error: this.agentdbError?.message || 'AgentDB not initialized',
      };
    }

    try {
      return await this.agentdb.getStats();
    } catch (error) {
      return {
        available: true,
        error: error.message,
      };
    }
  }

  /**
   * Optimize AgentDB indices
   * @returns {Promise<Object>} Optimization results
   */
  async optimizeAgentDB() {
    if (!this.isAgentDBAvailable()) {
      throw new Error('AgentDB not available for optimization');
    }

    return this.agentdb.optimize();
  }

  /**
   * Export data including vectors
   * @param {string} namespace - Optional namespace filter
   * @returns {Promise<Object>} Exported data with vectors
   */
  async exportDataWithVectors(namespace = null) {
    const legacyData = await this.exportData(namespace);

    if (!this.isAgentDBAvailable()) {
      return {
        legacy: legacyData,
        vectors: null,
        agentdbAvailable: false,
      };
    }

    try {
      const vectorData = await this.agentdb.exportVectors(namespace);
      return {
        legacy: legacyData,
        vectors: vectorData,
        agentdbAvailable: true,
      };
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] WARN [agentdb-adapter] Vector export failed: ${error.message}`,
      );
      return {
        legacy: legacyData,
        vectors: null,
        agentdbAvailable: true,
        error: error.message,
      };
    }
  }

  /**
   * Cleanup both legacy and AgentDB data
   * @returns {Promise<Object>} Cleanup results
   */
  async cleanupAll() {
    const legacyCleanup = await this.cleanupExpired();

    if (!this.isAgentDBAvailable()) {
      return {
        legacy: legacyCleanup,
        agentdb: null,
      };
    }

    try {
      const agentdbCleanup = await this.agentdb.cleanup();
      return {
        legacy: legacyCleanup,
        agentdb: agentdbCleanup,
      };
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] WARN [agentdb-adapter] AgentDB cleanup failed: ${error.message}`,
      );
      return {
        legacy: legacyCleanup,
        agentdb: null,
        error: error.message,
      };
    }
  }

  /**
   * Close both legacy and AgentDB connections
   * @returns {Promise<void>}
   */
  async close() {
    await super.close?.();

    if (this.isAgentDBAvailable()) {
      try {
        await this.agentdb.close();
      } catch (error) {
        console.error(
          `[${new Date().toISOString()}] WARN [agentdb-adapter] AgentDB close failed: ${error.message}`,
        );
      }
    }
  }
}

export default AgentDBMemoryAdapter;
