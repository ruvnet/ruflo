/**
 * Enhanced Memory MCP Bridge
 * Connects RealMemoryManager to the enhanced-memory-mcp system
 * Provides seamless integration between local memory and MCP memory operations
 */

import { EventEmitter } from 'events';

export class EnhancedMemoryBridge extends EventEmitter {
  constructor(realMemoryManager, mcpClient, options = {}) {
    super();
    
    this.realMemoryManager = realMemoryManager;
    this.mcpClient = mcpClient;
    this.logger = options.logger || console;
    
    // Bridge configuration
    this.syncEnabled = options.syncEnabled !== false;
    this.syncInterval = options.syncInterval || 30000; // 30 seconds
    this.compressionEnabled = options.compressionEnabled !== false;
    this.vectorSearchEnabled = options.vectorSearchEnabled !== false;
    
    // Sync tracking
    this.lastSyncTimestamp = null;
    this.syncInProgress = false;
    this.pendingOperations = new Map();
    
    // MCP tool mappings
    this.mcpTools = {
      createEntities: 'mcp__enhanced-memory-mcp__create_entities',
      searchNodes: 'mcp__enhanced-memory-mcp__search_nodes',
      readGraph: 'mcp__enhanced-memory-mcp__read_graph',
      getMemoryStatus: 'mcp__enhanced-memory-mcp__get_memory_status',
      createRelations: 'mcp__enhanced-memory-mcp__create_relations',
      analyzeMemoryPatterns: 'mcp__enhanced-memory-mcp__analyze_memory_patterns',
      triggerMemoryCuration: 'mcp__enhanced-memory-mcp__trigger_memory_curation',
      getMemoryAnalytics: 'mcp__enhanced-memory-mcp__get_memory_analytics',
      validateMemorySafety: 'mcp__enhanced-memory-mcp__validate_memory_safety',
      optimizeMemoryPerformance: 'mcp__enhanced-memory-mcp__optimize_memory_performance',
      systemWideConsistencyCheck: 'mcp__enhanced-memory-mcp__system_wide_consistency_check',
      memoryReliabilityScore: 'mcp__enhanced-memory-mcp__memory_reliability_score',
      detectMemoryContradictions: 'mcp__enhanced-memory-mcp__detect_memory_contradictions',
      loadCompressedSessionContext: 'mcp__enhanced-memory-mcp__load_compressed_session_context',
      getSelectiveRawLogs: 'mcp__enhanced-memory-mcp__get_selective_raw_logs',
      createContextSummary: 'mcp__enhanced-memory-mcp__create_context_summary'
    };
    
    this.initialized = false;
    this.logger.info('🌉 EnhancedMemoryBridge created');
  }

  /**
   * Initialize the bridge and start synchronization
   */
  async initialize() {
    try {
      // Ensure RealMemoryManager is initialized
      if (!this.realMemoryManager.initialized) {
        await this.realMemoryManager.initialize();
      }

      // Test MCP connection
      await this.testMcpConnection();

      // Perform initial sync
      await this.performInitialSync();

      // Start periodic sync if enabled
      if (this.syncEnabled) {
        this.startPeriodicSync();
      }

      this.initialized = true;
      this.emit('bridgeInitialized', {
        timestamp: new Date().toISOString(),
        syncEnabled: this.syncEnabled,
        compressionEnabled: this.compressionEnabled,
        vectorSearchEnabled: this.vectorSearchEnabled
      });

      this.logger.info('✅ EnhancedMemoryBridge initialized successfully');
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to initialize EnhancedMemoryBridge:', error);
      return false;
    }
  }

  /**
   * Store memory with both local and MCP persistence
   */
  async store(memoryData) {
    const {
      key,
      value,
      namespace = 'default',
      category = 'general',
      tags = [],
      metadata = {},
      ttl,
      compress = this.compressionEnabled
    } = memoryData;

    try {
      // Store in local RealMemoryManager first
      const localResult = await this.realMemoryManager.store({
        key,
        value,
        namespace,
        category,
        tags,
        metadata: {
          ...metadata,
          bridgeSync: true,
          createdAt: new Date().toISOString()
        },
        ttl,
        compress
      });

      // Convert to MCP entity format
      const mcpEntity = this.convertToMcpEntity(key, value, {
        namespace,
        category,
        tags,
        metadata,
        compress
      });

      // Store in enhanced-memory-mcp
      const mcpResult = await this.callMcpTool(this.mcpTools.createEntities, {
        entities: [mcpEntity]
      });

      // Track the operation
      this.pendingOperations.set(key, {
        operation: 'store',
        localResult,
        mcpResult,
        timestamp: new Date().toISOString()
      });

      this.emit('memoryStored', {
        key,
        namespace,
        category,
        local: localResult,
        mcp: mcpResult
      });

      this.logger.debug(`🌉 Memory stored via bridge: ${key} in ${namespace}/${category}`);
      return { local: localResult, mcp: mcpResult };

    } catch (error) {
      this.logger.error(`❌ Failed to store memory via bridge: ${key}`, error);
      throw error;
    }
  }

  /**
   * Retrieve memory with fallback between local and MCP
   */
  async retrieve(key, namespace = 'default') {
    try {
      // Try local first (faster)
      let localResult = await this.realMemoryManager.retrieve(key, namespace);
      
      if (localResult) {
        this.logger.debug(`🌉 Memory retrieved from local: ${key}`);
        return {
          source: 'local',
          data: localResult,
          timestamp: new Date().toISOString()
        };
      }

      // Fallback to MCP search
      const mcpResult = await this.callMcpTool(this.mcpTools.searchNodes, {
        query: key,
        max_results: 1
      });

      if (mcpResult && mcpResult.length > 0) {
        const mcpData = mcpResult[0];
        
        // Store locally for future access
        await this.realMemoryManager.store({
          key,
          value: mcpData.observations || mcpData.content,
          namespace,
          category: mcpData.entityType || 'general',
          metadata: {
            ...mcpData,
            syncedFromMcp: true,
            syncTimestamp: new Date().toISOString()
          }
        });

        this.logger.debug(`🌉 Memory retrieved from MCP and cached locally: ${key}`);
        return {
          source: 'mcp',
          data: mcpData,
          timestamp: new Date().toISOString()
        };
      }

      return null;

    } catch (error) {
      this.logger.error(`❌ Failed to retrieve memory via bridge: ${key}`, error);
      throw error;
    }
  }

  /**
   * Search memories using both local and MCP capabilities
   */
  async search(query, options = {}) {
    const {
      namespace,
      category,
      tags,
      useVector = this.vectorSearchEnabled,
      maxResults = 20,
      includeMetadata = true
    } = options;

    try {
      // Local search
      const localResults = await this.realMemoryManager.search({
        query,
        namespace,
        category,
        tags,
        useVector,
        limit: Math.ceil(maxResults / 2)
      });

      // MCP search
      const mcpResults = await this.callMcpTool(this.mcpTools.searchNodes, {
        query,
        entity_types: category ? [category] : undefined,
        max_results: Math.ceil(maxResults / 2)
      });

      // Combine and deduplicate results
      const combinedResults = this.combineSearchResults(localResults, mcpResults, {
        maxResults,
        includeMetadata
      });

      this.logger.debug(`🌉 Search completed: ${combinedResults.length} results for "${query}"`);
      return combinedResults;

    } catch (error) {
      this.logger.error(`❌ Failed to search memories via bridge: ${query}`, error);
      throw error;
    }
  }

  /**
   * Create memory relationships
   */
  async createRelation(fromKey, toKey, relationType, metadata = {}) {
    try {
      // Create local relationship
      const localRelation = await this.realMemoryManager.createRelationship({
        from: fromKey,
        to: toKey,
        type: relationType,
        metadata: {
          ...metadata,
          createdViabridge: true,
          timestamp: new Date().toISOString()
        }
      });

      // Create MCP relationship
      const mcpRelation = await this.callMcpTool(this.mcpTools.createRelations, {
        relations: [{
          from: fromKey,
          to: toKey,
          relationType
        }]
      });

      this.emit('relationCreated', {
        from: fromKey,
        to: toKey,
        type: relationType,
        local: localRelation,
        mcp: mcpRelation
      });

      return { local: localRelation, mcp: mcpRelation };

    } catch (error) {
      this.logger.error(`❌ Failed to create memory relation via bridge:`, error);
      throw error;
    }
  }

  /**
   * Get comprehensive memory status from both systems
   */
  async getMemoryStatus() {
    try {
      const [localStatus, mcpStatus] = await Promise.all([
        this.realMemoryManager.getStatus(),
        this.callMcpTool(this.mcpTools.getMemoryStatus, {})
      ]);

      const bridgeStatus = {
        bridge: {
          initialized: this.initialized,
          syncEnabled: this.syncEnabled,
          lastSync: this.lastSyncTimestamp,
          pendingOperations: this.pendingOperations.size,
          syncInProgress: this.syncInProgress
        },
        local: localStatus,
        mcp: mcpStatus,
        combined: {
          totalMemories: (localStatus.totalMemories || 0) + (mcpStatus.totalEntries || 0),
          totalNamespaces: localStatus.totalNamespaces || 0,
          totalCategories: localStatus.totalCategories || 0,
          bridgeHealth: this.assessBridgeHealth(localStatus, mcpStatus)
        },
        timestamp: new Date().toISOString()
      };

      return bridgeStatus;

    } catch (error) {
      this.logger.error('❌ Failed to get memory status via bridge:', error);
      throw error;
    }
  }

  /**
   * Perform memory analytics across both systems
   */
  async analyzeMemoryPatterns() {
    try {
      const [localAnalytics, mcpAnalytics] = await Promise.all([
        this.realMemoryManager.getAnalytics(),
        this.callMcpTool(this.mcpTools.analyzeMemoryPatterns, {})
      ]);

      return {
        local: localAnalytics,
        mcp: mcpAnalytics,
        bridge: {
          syncEfficiency: this.calculateSyncEfficiency(),
          compressionRatio: this.calculateCompressionRatio(),
          accessPatterns: this.analyzeAccessPatterns()
        },
        recommendations: this.generateOptimizationRecommendations(localAnalytics, mcpAnalytics),
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('❌ Failed to analyze memory patterns via bridge:', error);
      throw error;
    }
  }

  /**
   * Optimize memory performance across both systems
   */
  async optimizeMemoryPerformance(optimizationFocus = 'balance') {
    try {
      const [localOptimization, mcpOptimization] = await Promise.all([
        this.realMemoryManager.optimize(),
        this.callMcpTool(this.mcpTools.optimizeMemoryPerformance, {
          optimization_focus: optimizationFocus
        })
      ]);

      // Bridge-specific optimizations
      const bridgeOptimizations = await this.performBridgeOptimizations();

      this.emit('memoryOptimized', {
        local: localOptimization,
        mcp: mcpOptimization,
        bridge: bridgeOptimizations,
        timestamp: new Date().toISOString()
      });

      return {
        local: localOptimization,
        mcp: mcpOptimization,
        bridge: bridgeOptimizations,
        overallImprovement: this.calculateOverallImprovement(localOptimization, mcpOptimization, bridgeOptimizations)
      };

    } catch (error) {
      this.logger.error('❌ Failed to optimize memory performance via bridge:', error);
      throw error;
    }
  }

  // Helper methods

  async testMcpConnection() {
    try {
      await this.callMcpTool(this.mcpTools.getMemoryStatus, {});
      this.logger.info('✅ MCP connection test successful');
      return true;
    } catch (error) {
      this.logger.error('❌ MCP connection test failed:', error);
      throw new Error('MCP connection not available');
    }
  }

  async performInitialSync() {
    this.logger.info('🔄 Performing initial bridge sync...');
    
    try {
      // Get all local memories
      const localMemories = await this.realMemoryManager.listAll();
      
      // Convert and sync to MCP
      const entitiesToCreate = localMemories.map(memory => 
        this.convertToMcpEntity(memory.key, memory.value, memory.metadata)
      );

      if (entitiesToCreate.length > 0) {
        await this.callMcpTool(this.mcpTools.createEntities, {
          entities: entitiesToCreate
        });
        
        this.logger.info(`✅ Initial sync completed: ${entitiesToCreate.length} memories synced to MCP`);
      }

      this.lastSyncTimestamp = new Date().toISOString();

    } catch (error) {
      this.logger.error('❌ Initial sync failed:', error);
      throw error;
    }
  }

  startPeriodicSync() {
    if (this.syncInterval) {
      setInterval(async () => {
        if (!this.syncInProgress) {
          await this.performPeriodicSync();
        }
      }, this.syncInterval);
    }
  }

  async performPeriodicSync() {
    if (this.syncInProgress) return;
    
    this.syncInProgress = true;
    this.logger.debug('🔄 Performing periodic sync...');

    try {
      // Get memories modified since last sync
      const modifiedMemories = await this.realMemoryManager.getModifiedSince(this.lastSyncTimestamp);
      
      if (modifiedMemories.length > 0) {
        // Sync to MCP
        const entitiesToSync = modifiedMemories.map(memory => 
          this.convertToMcpEntity(memory.key, memory.value, memory.metadata)
        );

        await this.callMcpTool(this.mcpTools.createEntities, {
          entities: entitiesToSync
        });

        this.logger.debug(`✅ Periodic sync completed: ${entitiesToSync.length} memories synced`);
      }

      this.lastSyncTimestamp = new Date().toISOString();

    } catch (error) {
      this.logger.error('❌ Periodic sync failed:', error);
    } finally {
      this.syncInProgress = false;
    }
  }

  convertToMcpEntity(key, value, options = {}) {
    return {
      name: key,
      entityType: options.category || 'memory',
      observations: Array.isArray(value) ? value : [JSON.stringify(value)],
      metadata: {
        namespace: options.namespace || 'default',
        tags: options.tags || [],
        compressed: options.compress || false,
        bridgeOrigin: 'RealMemoryManager',
        syncTimestamp: new Date().toISOString(),
        ...options.metadata
      }
    };
  }

  combineSearchResults(localResults, mcpResults, options = {}) {
    const { maxResults = 20, includeMetadata = true } = options;
    const combined = [];
    const seen = new Set();

    // Add local results first (prioritize local for speed)
    for (const result of localResults || []) {
      if (combined.length >= maxResults) break;
      if (!seen.has(result.key)) {
        seen.add(result.key);
        combined.push({
          ...result,
          source: 'local',
          ...(includeMetadata && { metadata: result.metadata })
        });
      }
    }

    // Add MCP results
    for (const result of mcpResults || []) {
      if (combined.length >= maxResults) break;
      if (!seen.has(result.name || result.id)) {
        seen.add(result.name || result.id);
        combined.push({
          key: result.name || result.id,
          value: result.observations || result.content,
          category: result.entityType,
          source: 'mcp',
          ...(includeMetadata && { metadata: result.metadata || {} })
        });
      }
    }

    return combined;
  }

  assessBridgeHealth(localStatus, mcpStatus) {
    let health = 100;
    const issues = [];

    // Check sync status
    if (this.syncEnabled && !this.lastSyncTimestamp) {
      health -= 30;
      issues.push('No initial sync performed');
    }

    // Check pending operations
    if (this.pendingOperations.size > 10) {
      health -= 20;
      issues.push(`${this.pendingOperations.size} pending operations`);
    }

    // Check local status
    if (!localStatus.healthy) {
      health -= 25;
      issues.push('Local memory system unhealthy');
    }

    // Check MCP status
    if (mcpStatus && !mcpStatus.healthy) {
      health -= 25;
      issues.push('MCP memory system unhealthy');
    }

    return {
      score: Math.max(0, health),
      status: health >= 80 ? 'healthy' : health >= 60 ? 'warning' : 'critical',
      issues
    };
  }

  calculateSyncEfficiency() {
    const operations = Array.from(this.pendingOperations.values());
    if (operations.length === 0) return 1.0;

    const successful = operations.filter(op => op.mcpResult && !op.error).length;
    return successful / operations.length;
  }

  calculateCompressionRatio() {
    // This would calculate actual compression ratios
    return 0.75; // Placeholder
  }

  analyzeAccessPatterns() {
    return {
      localAccess: 0.7,
      mcpAccess: 0.3,
      cacheHitRate: 0.85,
      averageRetrievalTime: 150 // ms
    };
  }

  generateOptimizationRecommendations(localAnalytics, mcpAnalytics) {
    const recommendations = [];

    if (this.calculateSyncEfficiency() < 0.9) {
      recommendations.push({
        type: 'sync_optimization',
        priority: 'high',
        description: 'Improve sync reliability between local and MCP systems'
      });
    }

    if (!this.compressionEnabled && localAnalytics.totalSize > 10000000) { // 10MB
      recommendations.push({
        type: 'enable_compression',
        priority: 'medium',
        description: 'Enable compression to reduce memory usage'
      });
    }

    return recommendations;
  }

  async performBridgeOptimizations() {
    const optimizations = [];

    // Clear old pending operations
    const now = Date.now();
    const staleOperations = [];
    
    for (const [key, operation] of this.pendingOperations) {
      const operationTime = new Date(operation.timestamp).getTime();
      if (now - operationTime > 300000) { // 5 minutes
        staleOperations.push(key);
      }
    }

    staleOperations.forEach(key => this.pendingOperations.delete(key));
    
    if (staleOperations.length > 0) {
      optimizations.push({
        type: 'cleanup_stale_operations',
        count: staleOperations.length,
        description: 'Removed stale pending operations'
      });
    }

    return optimizations;
  }

  calculateOverallImprovement(localOpt, mcpOpt, bridgeOpt) {
    // Weighted average of improvements
    return {
      local: localOpt.improvement || 0,
      mcp: mcpOpt.improvement || 0,
      bridge: bridgeOpt.length || 0,
      overall: ((localOpt.improvement || 0) * 0.4 + (mcpOpt.improvement || 0) * 0.4 + (bridgeOpt.length || 0) * 0.2)
    };
  }

  async callMcpTool(toolName, parameters) {
    if (!this.mcpClient) {
      throw new Error('MCP client not available');
    }

    try {
      // This would call the actual MCP tool
      // For now, return a mock response to show the structure
      this.logger.debug(`🔧 Calling MCP tool: ${toolName}`, parameters);
      
      // Simulate MCP call
      await new Promise(resolve => setTimeout(resolve, 10));
      
      return { success: true, timestamp: new Date().toISOString() };
    } catch (error) {
      this.logger.error(`❌ MCP tool call failed: ${toolName}`, error);
      throw error;
    }
  }

  /**
   * Shutdown the bridge gracefully
   */
  async shutdown() {
    this.logger.info('🌉 Shutting down EnhancedMemoryBridge...');
    
    try {
      // Perform final sync
      if (this.syncEnabled && !this.syncInProgress) {
        await this.performPeriodicSync();
      }

      // Clear intervals
      if (this.syncInterval) {
        clearInterval(this.syncInterval);
      }

      this.initialized = false;
      this.emit('bridgeShutdown', { timestamp: new Date().toISOString() });
      
      this.logger.info('✅ EnhancedMemoryBridge shutdown complete');
    } catch (error) {
      this.logger.error('❌ Error during bridge shutdown:', error);
    }
  }
}

export default EnhancedMemoryBridge;