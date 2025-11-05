/**
 * AgentDB Backend - Direct integration with AgentDB v1.3.9
 * Provides vector storage, HNSW search, and quantization
 */

export class AgentDBBackend {
  constructor(options = {}) {
    this.dbPath = options.dbPath || '.agentdb/claude-flow.db';
    this.quantization = options.quantization || 'scalar'; // scalar, binary, product
    this.enableHNSW = options.enableHNSW !== false;
    this.db = null;
    this.initialized = false;
  }

  async initialize() {
    try {
      // Dynamic import of AgentDB
      const { default: AgentDB } = await import('agentdb');

      // Initialize AgentDB instance
      this.db = new AgentDB({
        path: this.dbPath,
        quantization: this.quantization,
        indexType: this.enableHNSW ? 'hnsw' : 'flat',
      });

      await this.db.init();
      this.initialized = true;

      console.error(
        `[${new Date().toISOString()}] INFO [agentdb-backend] AgentDB initialized at ${this.dbPath}`,
      );
      console.error(
        `[${new Date().toISOString()}] INFO [agentdb-backend] Quantization: ${this.quantization}, HNSW: ${this.enableHNSW}`,
      );
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] ERROR [agentdb-backend] Failed to initialize AgentDB: ${error.message}`,
      );
      throw new Error(`AgentDB initialization failed: ${error.message}`);
    }
  }

  /**
   * Store a vector with metadata
   * @param {string} key - Unique identifier
   * @param {Array<number>} embedding - Vector embedding
   * @param {Object} metadata - Associated metadata
   * @returns {Promise<void>}
   */
  async storeVector(key, embedding, metadata = {}) {
    if (!this.initialized) {
      throw new Error('AgentDB not initialized');
    }

    try {
      await this.db.add({
        id: key,
        vector: embedding,
        metadata: {
          ...metadata,
          storedAt: Date.now(),
        },
      });
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] ERROR [agentdb-backend] Failed to store vector: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Search for similar vectors
   * @param {Array<number>|string} query - Query vector or text
   * @param {Object} options - Search options
   * @param {number} options.k - Number of results
   * @param {string} options.namespace - Filter by namespace
   * @param {Object} options.filter - Metadata filters
   * @returns {Promise<Array>} Results with similarity scores
   */
  async search(query, options = {}) {
    if (!this.initialized) {
      throw new Error('AgentDB not initialized');
    }

    try {
      const results = await this.db.search({
        vector: query,
        k: options.k || 10,
        filter: this._buildFilter(options),
      });

      return results.map(result => ({
        id: result.id,
        similarity: result.score,
        metadata: result.metadata,
        value: result.metadata?.value,
      }));
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] ERROR [agentdb-backend] Search failed: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Get a specific vector by key
   * @param {string} key - Vector identifier
   * @returns {Promise<Object|null>} Vector data or null
   */
  async getVector(key) {
    if (!this.initialized) {
      throw new Error('AgentDB not initialized');
    }

    try {
      return await this.db.get(key);
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] WARN [agentdb-backend] Get vector failed: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Delete a vector by key
   * @param {string} key - Vector identifier
   * @returns {Promise<boolean>} Success status
   */
  async deleteVector(key) {
    if (!this.initialized) {
      throw new Error('AgentDB not initialized');
    }

    try {
      await this.db.delete(key);
      return true;
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] WARN [agentdb-backend] Delete vector failed: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Build filter object from options
   * @private
   */
  _buildFilter(options) {
    const filter = {};

    if (options.namespace) {
      filter['metadata.namespace'] = options.namespace;
    }

    if (options.filter) {
      Object.entries(options.filter).forEach(([key, value]) => {
        filter[`metadata.${key}`] = value;
      });
    }

    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  /**
   * Get database statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    if (!this.initialized) {
      return {
        initialized: false,
        vectorCount: 0,
      };
    }

    try {
      const stats = await this.db.stats();
      return {
        initialized: true,
        vectorCount: stats.count || 0,
        indexType: this.enableHNSW ? 'hnsw' : 'flat',
        quantization: this.quantization,
        dbPath: this.dbPath,
        ...stats,
      };
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] WARN [agentdb-backend] Stats failed: ${error.message}`,
      );
      return {
        initialized: true,
        error: error.message,
      };
    }
  }

  /**
   * Optimize database indices
   * @returns {Promise<Object>} Optimization results
   */
  async optimize() {
    if (!this.initialized) {
      throw new Error('AgentDB not initialized');
    }

    try {
      const startTime = Date.now();

      if (this.enableHNSW && this.db.optimize) {
        await this.db.optimize();
      }

      return {
        success: true,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] ERROR [agentdb-backend] Optimization failed: ${error.message}`,
      );
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Export all vectors
   * @param {string} namespace - Optional namespace filter
   * @returns {Promise<Array>} All vectors
   */
  async exportVectors(namespace = null) {
    if (!this.initialized) {
      throw new Error('AgentDB not initialized');
    }

    try {
      const filter = namespace ? { 'metadata.namespace': namespace } : undefined;
      const results = await this.db.list({ filter });

      return results.map(result => ({
        id: result.id,
        vector: result.vector,
        metadata: result.metadata,
      }));
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] ERROR [agentdb-backend] Export failed: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Import vectors in batch
   * @param {Array} vectors - Array of {id, vector, metadata}
   * @returns {Promise<Object>} Import results
   */
  async importVectors(vectors) {
    if (!this.initialized) {
      throw new Error('AgentDB not initialized');
    }

    try {
      const startTime = Date.now();
      let successCount = 0;
      let errorCount = 0;

      for (const vector of vectors) {
        try {
          await this.storeVector(vector.id, vector.vector, vector.metadata);
          successCount++;
        } catch (error) {
          errorCount++;
          console.error(
            `[${new Date().toISOString()}] WARN [agentdb-backend] Import vector failed: ${error.message}`,
          );
        }
      }

      return {
        success: true,
        imported: successCount,
        errors: errorCount,
        total: vectors.length,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] ERROR [agentdb-backend] Import failed: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Cleanup expired or invalid vectors
   * @returns {Promise<Object>} Cleanup results
   */
  async cleanup() {
    if (!this.initialized) {
      throw new Error('AgentDB not initialized');
    }

    try {
      // AgentDB handles its own cleanup internally
      // This is a placeholder for custom cleanup logic if needed
      const stats = await this.getStats();

      return {
        success: true,
        vectorCount: stats.vectorCount,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] ERROR [agentdb-backend] Cleanup failed: ${error.message}`,
      );
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Close database connection
   * @returns {Promise<void>}
   */
  async close() {
    if (!this.initialized) {
      return;
    }

    try {
      if (this.db && this.db.close) {
        await this.db.close();
      }
      this.initialized = false;

      console.error(
        `[${new Date().toISOString()}] INFO [agentdb-backend] AgentDB closed`,
      );
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] ERROR [agentdb-backend] Close failed: ${error.message}`,
      );
      throw error;
    }
  }
}

export default AgentDBBackend;
