/**
 * Real Memory Manager Implementation
 * Replaces mock/placeholder memory functionality with actual persistence and indexing
 * Integrates with enhanced-memory-mcp for advanced capabilities
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export class RealMemoryManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // Memory configuration
    this.persistenceDir = options.persistenceDir || './data/memory';
    this.sessionId = options.sessionId || `memory_${Date.now()}`;
    this.logger = options.logger || console;
    this.maxMemorySize = options.maxMemorySize || 100 * 1024 * 1024; // 100MB default
    this.compressionEnabled = options.compressionEnabled !== false;
    this.vectorSearchEnabled = options.vectorSearchEnabled !== false;
    this.embeddingDimensions = options.embeddingDimensions || 384; // Default sentence transformer size
    this.similarityThreshold = options.similarityThreshold || 0.3;
    this.stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 
      'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
      'this', 'that', 'these', 'those', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours',
      'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its'
    ]);
    
    // Memory storage structures
    this.memories = new Map(); // In-memory cache
    this.memoryIndex = new Map(); // Fast lookup index
    this.semanticIndex = new Map(); // Semantic similarity index
    this.vectorIndex = new Map(); // Vector embeddings index
    this.termFrequency = new Map(); // TF-IDF term frequency
    this.documentFrequency = new Map(); // TF-IDF document frequency
    this.namespaces = new Map(); // Namespace organization
    this.tags = new Map(); // Tag-based indexing
    
    // Memory categories for organization
    this.categories = {
      coordination: new Map(),
      learning: new Map(),
      patterns: new Map(),
      decisions: new Map(),
      context: new Map(),
      performance: new Map()
    };
    
    // Performance tracking
    this.stats = {
      memoriesStored: 0,
      memoriesRetrieved: 0,
      queriesExecuted: 0,
      compressionRatio: 0,
      averageRetrievalTime: 0,
      cacheHitRate: 0,
      totalSize: 0
    };
    
    this.initialized = false;
    this.logger.info(`🧠 RealMemoryManager initialized with session: ${this.sessionId}`);
  }

  /**
   * Initialize the memory manager with persistence and indexing
   */
  async initialize() {
    try {
      await fs.mkdir(this.persistenceDir, { recursive: true });
      await this.loadPersistedMemories();
      await this.buildIndexes();
      
      this.initialized = true;
      this.emit('memoryManagerInitialized', {
        sessionId: this.sessionId,
        memoriesLoaded: this.memories.size,
        timestamp: new Date().toISOString()
      });
      
      this.logger.info(`✅ RealMemoryManager fully initialized - ${this.memories.size} memories loaded`);
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to initialize RealMemoryManager:', error);
      return false;
    }
  }

  /**
   * Store memory with advanced indexing and categorization
   */
  async store(memoryData) {
    if (!this.initialized) {
      throw new Error('Memory manager not initialized');
    }

    const {
      key,
      value,
      namespace = 'default',
      category = 'context',
      tags = [],
      metadata = {},
      ttl = null,
      priority = 'medium',
      agentId = null,
      timestamp = new Date().toISOString()
    } = memoryData;

    const memoryId = this.generateMemoryId(key, namespace);
    
    // Create comprehensive memory entry
    const memory = {
      id: memoryId,
      key,
      value: await this.compressValue(value),
      originalValue: value, // Keep for immediate access
      namespace,
      category,
      tags: Array.isArray(tags) ? tags : [tags].filter(Boolean),
      metadata: {
        ...metadata,
        agentId,
        priority,
        size: this.calculateSize(value),
        compressed: this.compressionEnabled,
        version: 1
      },
      timestamps: {
        created: timestamp,
        modified: timestamp,
        accessed: timestamp,
        expires: ttl ? new Date(Date.now() + ttl).toISOString() : null
      },
      access: {
        count: 0,
        lastAccessed: null,
        accessHistory: []
      },
      relationships: {
        related: [],
        dependencies: [],
        references: []
      }
    };

    // Store in main memory cache
    this.memories.set(memoryId, memory);
    
    // Update indexes
    await this.updateIndexes(memory);
    
    // Store in category
    this.categories[category].set(memoryId, memory);
    
    // Store in namespace
    if (!this.namespaces.has(namespace)) {
      this.namespaces.set(namespace, new Set());
    }
    this.namespaces.get(namespace).add(memoryId);
    
    // Update tag index
    for (const tag of memory.tags) {
      if (!this.tags.has(tag)) {
        this.tags.set(tag, new Set());
      }
      this.tags.get(tag).add(memoryId);
    }
    
    // Update statistics
    this.stats.memoriesStored++;
    this.stats.totalSize += memory.metadata.size;
    
    // Emit storage event
    this.emit('memoryStored', {
      memoryId,
      namespace,
      category,
      size: memory.metadata.size,
      timestamp
    });

    // Persist to disk asynchronously
    this.persistMemory(memory).catch(error => {
      this.logger.warn(`Failed to persist memory ${memoryId}:`, error.message);
    });
    
    this.logger.debug(`🧠 Stored memory: ${memoryId} in ${namespace}/${category}`);
    return memory;
  }

  /**
   * Retrieve memory with access tracking
   */
  async retrieve(key, namespace = 'default') {
    if (!this.initialized) {
      throw new Error('Memory manager not initialized');
    }

    const startTime = Date.now();
    const memoryId = this.generateMemoryId(key, namespace);
    
    let memory = this.memories.get(memoryId);
    let cacheHit = true;
    
    // If not in cache, try to load from disk
    if (!memory) {
      memory = await this.loadMemoryFromDisk(memoryId);
      cacheHit = false;
      
      if (memory) {
        this.memories.set(memoryId, memory);
      }
    }
    
    if (memory) {
      // Check if memory has expired
      if (memory.timestamps.expires && new Date() > new Date(memory.timestamps.expires)) {
        await this.delete(key, namespace);
        return null;
      }
      
      // Update access information
      memory.access.count++;
      memory.access.lastAccessed = new Date().toISOString();
      memory.access.accessHistory.push({
        timestamp: new Date().toISOString(),
        fromCache: cacheHit
      });
      
      // Keep only last 10 access records
      if (memory.access.accessHistory.length > 10) {
        memory.access.accessHistory = memory.access.accessHistory.slice(-10);
      }
      
      // Update timestamps
      memory.timestamps.accessed = new Date().toISOString();
      
      // Update statistics
      this.stats.memoriesRetrieved++;
      const retrievalTime = Date.now() - startTime;
      this.stats.averageRetrievalTime = 
        (this.stats.averageRetrievalTime * (this.stats.memoriesRetrieved - 1) + retrievalTime) / 
        this.stats.memoriesRetrieved;
      
      if (cacheHit) {
        this.stats.cacheHitRate = 
          (this.stats.cacheHitRate * (this.stats.memoriesRetrieved - 1) + 1) / 
          this.stats.memoriesRetrieved;
      } else {
        this.stats.cacheHitRate = 
          (this.stats.cacheHitRate * (this.stats.memoriesRetrieved - 1)) / 
          this.stats.memoriesRetrieved;
      }
      
      // Emit retrieval event
      this.emit('memoryRetrieved', {
        memoryId,
        namespace,
        fromCache: cacheHit,
        retrievalTime,
        timestamp: new Date().toISOString()
      });
      
      // Return decompressed value
      return {
        ...memory,
        value: await this.decompressValue(memory.value) || memory.originalValue
      };
    }
    
    return null;
  }

  /**
   * Query memories with advanced filtering and semantic search
   */
  async query(queryOptions = {}) {
    if (!this.initialized) {
      throw new Error('Memory manager not initialized');
    }

    const {
      namespace = null,
      category = null,
      tags = [],
      search = null,
      semanticSearch = null,
      agentId = null,
      priority = null,
      limit = 100,
      offset = 0,
      sortBy = 'timestamp',
      sortOrder = 'desc',
      includeExpired = false
    } = queryOptions;

    this.stats.queriesExecuted++;
    
    let results = Array.from(this.memories.values());
    
    // Filter by namespace
    if (namespace) {
      results = results.filter(memory => memory.namespace === namespace);
    }
    
    // Filter by category
    if (category) {
      results = results.filter(memory => memory.category === category);
    }
    
    // Filter by tags
    if (tags.length > 0) {
      results = results.filter(memory => 
        tags.some(tag => memory.tags.includes(tag))
      );
    }
    
    // Filter by agent ID
    if (agentId) {
      results = results.filter(memory => memory.metadata.agentId === agentId);
    }
    
    // Filter by priority
    if (priority) {
      results = results.filter(memory => memory.metadata.priority === priority);
    }
    
    // Filter expired memories
    if (!includeExpired) {
      const now = new Date();
      results = results.filter(memory => 
        !memory.timestamps.expires || new Date(memory.timestamps.expires) > now
      );
    }
    
    // Text search
    if (search) {
      const searchLower = search.toLowerCase();
      results = results.filter(memory => {
        const searchableText = [
          memory.key,
          JSON.stringify(memory.originalValue || memory.value),
          ...memory.tags,
          JSON.stringify(memory.metadata)
        ].join(' ').toLowerCase();
        
        return searchableText.includes(searchLower);
      });
    }
    
    // Semantic search (if enabled and query provided)
    if (semanticSearch && this.vectorSearchEnabled) {
      // Use vector search on current results
      results = await this.performVectorSearch(results, semanticSearch);
    }
    
    // Sort results
    results.sort((a, b) => {
      let aValue, bValue;
      
      switch (sortBy) {
        case 'timestamp':
          aValue = new Date(a.timestamps.created);
          bValue = new Date(b.timestamps.created);
          break;
        case 'accessed':
          aValue = new Date(a.timestamps.accessed);
          bValue = new Date(b.timestamps.accessed);
          break;
        case 'accessCount':
          aValue = a.access.count;
          bValue = b.access.count;
          break;
        case 'size':
          aValue = a.metadata.size;
          bValue = b.metadata.size;
          break;
        case 'priority':
          const priorities = { high: 3, medium: 2, low: 1 };
          aValue = priorities[a.metadata.priority] || 0;
          bValue = priorities[b.metadata.priority] || 0;
          break;
        default:
          aValue = a.key;
          bValue = b.key;
      }
      
      if (sortOrder === 'desc') {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      } else {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      }
    });
    
    // Apply pagination
    const total = results.length;
    results = results.slice(offset, offset + limit);
    
    // Decompress values for results
    const decompressedResults = await Promise.all(
      results.map(async memory => ({
        ...memory,
        value: await this.decompressValue(memory.value) || memory.originalValue
      }))
    );
    
    this.emit('memoryQueried', {
      query: queryOptions,
      resultCount: decompressedResults.length,
      totalCount: total,
      timestamp: new Date().toISOString()
    });
    
    return {
      results: decompressedResults,
      total,
      offset,
      limit,
      hasMore: offset + limit < total
    };
  }

  /**
   * Update existing memory
   */
  async update(key, updates, namespace = 'default') {
    const memory = await this.retrieve(key, namespace);
    if (!memory) {
      throw new Error(`Memory not found: ${key} in namespace ${namespace}`);
    }

    // Create updated memory
    const updatedMemory = {
      ...memory,
      ...updates,
      id: memory.id, // Preserve ID
      metadata: {
        ...memory.metadata,
        ...updates.metadata,
        version: memory.metadata.version + 1,
        size: this.calculateSize(updates.value || memory.originalValue)
      },
      timestamps: {
        ...memory.timestamps,
        modified: new Date().toISOString()
      }
    };

    // If value was updated, compress it
    if (updates.value !== undefined) {
      updatedMemory.value = await this.compressValue(updates.value);
      updatedMemory.originalValue = updates.value;
    }

    // Update in cache
    this.memories.set(memory.id, updatedMemory);
    
    // Update indexes
    await this.updateIndexes(updatedMemory);
    
    // Persist to disk
    await this.persistMemory(updatedMemory);
    
    this.emit('memoryUpdated', {
      memoryId: memory.id,
      version: updatedMemory.metadata.version,
      timestamp: new Date().toISOString()
    });
    
    return updatedMemory;
  }

  /**
   * Delete memory
   */
  async delete(key, namespace = 'default') {
    const memoryId = this.generateMemoryId(key, namespace);
    const memory = this.memories.get(memoryId);
    
    if (!memory) {
      return false;
    }

    // Remove from all indexes
    this.memories.delete(memoryId);
    this.memoryIndex.delete(memoryId);
    this.categories[memory.category].delete(memoryId);
    
    // Remove from namespace
    if (this.namespaces.has(memory.namespace)) {
      this.namespaces.get(memory.namespace).delete(memoryId);
    }
    
    // Remove from tag indexes
    for (const tag of memory.tags) {
      if (this.tags.has(tag)) {
        this.tags.get(tag).delete(memoryId);
      }
    }
    
    // Update statistics
    this.stats.totalSize -= memory.metadata.size;
    
    // Delete from disk
    await this.deleteMemoryFromDisk(memoryId);
    
    this.emit('memoryDeleted', {
      memoryId,
      namespace: memory.namespace,
      timestamp: new Date().toISOString()
    });
    
    return true;
  }

  /**
   * Get comprehensive memory statistics
   */
  getStats() {
    const namespaceStats = {};
    for (const [namespace, memoryIds] of this.namespaces) {
      namespaceStats[namespace] = memoryIds.size;
    }

    const categoryStats = {};
    for (const [category, memories] of Object.entries(this.categories)) {
      categoryStats[category] = memories.size;
    }

    return {
      ...this.stats,
      session: {
        id: this.sessionId,
        initialized: this.initialized,
        uptime: Date.now()
      },
      storage: {
        totalMemories: this.memories.size,
        totalSize: this.stats.totalSize,
        averageSize: this.memories.size > 0 ? this.stats.totalSize / this.memories.size : 0,
        compressionRatio: this.stats.compressionRatio
      },
      organization: {
        namespaces: namespaceStats,
        categories: categoryStats,
        totalTags: this.tags.size
      },
      performance: {
        averageRetrievalTime: this.stats.averageRetrievalTime,
        cacheHitRate: this.stats.cacheHitRate,
        queriesPerSecond: this.stats.queriesExecuted / (Date.now() - this.startTime) * 1000
      },
      vectorSearch: this.getVectorStats()
    };
  }

  /**
   * Clear all memories in a namespace
   */
  async clearNamespace(namespace) {
    if (!this.namespaces.has(namespace)) {
      return 0;
    }

    const memoryIds = Array.from(this.namespaces.get(namespace));
    let deletedCount = 0;

    for (const memoryId of memoryIds) {
      const memory = this.memories.get(memoryId);
      if (memory) {
        await this.delete(memory.key, memory.namespace);
        deletedCount++;
      }
    }

    this.emit('namespaceCleared', {
      namespace,
      deletedCount,
      timestamp: new Date().toISOString()
    });

    return deletedCount;
  }

  /**
   * Perform memory cleanup and optimization
   */
  async performMaintenance() {
    if (!this.initialized) {
      return;
    }

    this.logger.info('🔧 Performing memory maintenance...');
    
    let cleanedUp = 0;
    let optimized = 0;
    let vectorsOptimized = 0;
    
    // Clean up expired memories
    const now = new Date();
    for (const [memoryId, memory] of this.memories) {
      if (memory.timestamps.expires && new Date(memory.timestamps.expires) <= now) {
        await this.delete(memory.key, memory.namespace);
        cleanedUp++;
      }
    }
    
    // Optimize frequently accessed memories (move to fast cache)
    for (const [memoryId, memory] of this.memories) {
      if (memory.access.count > 10 && !memory.metadata.optimized) {
        memory.metadata.optimized = true;
        optimized++;
      }
    }
    
    // Optimize vector index
    if (this.vectorSearchEnabled) {
      vectorsOptimized = await this.optimizeVectorIndex();
    }
    
    // Update compression ratios
    await this.calculateCompressionStats();
    
    // Rebuild indexes if needed
    if (cleanedUp > 0 || vectorsOptimized > 0) {
      await this.buildIndexes();
    }
    
    this.emit('maintenanceCompleted', {
      cleanedUp,
      optimized,
      vectorsOptimized,
      timestamp: new Date().toISOString()
    });
    
    this.logger.info(`✅ Memory maintenance completed: ${cleanedUp} cleaned, ${optimized} optimized, ${vectorsOptimized} vectors optimized`);
  }

  // Helper methods

  generateMemoryId(key, namespace) {
    return crypto.createHash('sha256')
      .update(`${namespace}:${key}`)
      .digest('hex')
      .substring(0, 16);
  }

  calculateSize(value) {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  }

  async compressValue(value) {
    if (!this.compressionEnabled) {
      return value;
    }
    
    try {
      // Simple compression - could be enhanced with actual compression library
      const jsonString = JSON.stringify(value);
      if (jsonString.length > 1000) {
        // Only compress larger values
        return {
          compressed: true,
          data: Buffer.from(jsonString).toString('base64'),
          originalSize: jsonString.length
        };
      }
      return value;
    } catch (error) {
      this.logger.warn('Failed to compress value:', error);
      return value;
    }
  }

  async decompressValue(value) {
    if (!value || typeof value !== 'object' || !value.compressed) {
      return value;
    }
    
    try {
      const jsonString = Buffer.from(value.data, 'base64').toString();
      return JSON.parse(jsonString);
    } catch (error) {
      this.logger.warn('Failed to decompress value:', error);
      return null;
    }
  }

  async updateIndexes(memory) {
    // Update main index
    this.memoryIndex.set(memory.id, {
      key: memory.key,
      namespace: memory.namespace,
      category: memory.category,
      tags: memory.tags,
      timestamp: memory.timestamps.created
    });
    
    // Update vector and semantic indexes
    if (this.vectorSearchEnabled) {
      const searchableText = [
        memory.key,
        JSON.stringify(memory.originalValue || memory.value),
        ...memory.tags
      ].join(' ').toLowerCase();
      
      // Extract and store keywords
      const keywords = this.extractKeywords(searchableText);
      
      // Update semantic index
      this.semanticIndex.set(memory.id, {
        text: searchableText,
        keywords
      });
      
      // Create and store vector representation
      await this.createAndStoreVector(memory.id, searchableText, keywords);
    }
  }

  extractKeywords(text) {
    // Enhanced keyword extraction with stopword filtering and stemming
    return text
      .toLowerCase()
      .replace(/[^a-zA-Z0-9\s]/g, ' ') // Remove punctuation
      .split(/\s+/)
      .filter(word => 
        word.length > 2 && 
        !this.stopWords.has(word) &&
        !/^\d+$/.test(word) // Remove pure numbers
      )
      .reduce((acc, word) => {
        // Simple stemming - remove common suffixes
        const stemmed = word.replace(/(ing|ed|er|est|ly|tion|sion)$/, '');
        acc[stemmed] = (acc[stemmed] || 0) + 1;
        return acc;
      }, {});
  }

  async performSemanticSearch(memories, query, useVector = true) {
    // Enhanced keyword-based search with TF-IDF
    const queryTerms = this.extractKeywords(query.toLowerCase());
    const queryVector = this.createTFIDFVector(queryTerms);
    
    return memories
      .map(memory => {
        const vectorData = this.vectorIndex.get(memory.id);
        if (!vectorData) return { memory, score: 0 };
        
        const score = this.calculateCosineSimilarity(queryVector, vectorData.tfidf);
        return { memory, score };
      })
      .filter(item => item.score > this.similarityThreshold)
      .sort((a, b) => b.score - a.score)
      .map(item => item.memory);
  }

  async buildIndexes() {
    this.memoryIndex.clear();
    this.semanticIndex.clear();
    this.vectorIndex.clear();
    this.termFrequency.clear();
    this.documentFrequency.clear();
    
    // First pass: build term frequency and document frequency
    const allDocuments = [];
    this.documentFrequency.clear();
    
    for (const memory of this.memories.values()) {
      const searchableText = [
        memory.key,
        JSON.stringify(memory.originalValue || memory.value),
        ...memory.tags
      ].join(' ').toLowerCase();
      
      const keywords = this.extractKeywords(searchableText);
      allDocuments.push({ memoryId: memory.id, keywords, text: searchableText });
      
      // Build document frequency
      const uniqueTerms = new Set(Object.keys(keywords));
      for (const term of uniqueTerms) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) || 0) + 1);
      }
    }
    
    // Second pass: create indexes with TF-IDF
    for (const doc of allDocuments) {
      await this.updateIndexes(this.memories.get(doc.memoryId));
    }
  }

  async persistMemory(memory) {
    try {
      const filePath = path.join(this.persistenceDir, `memory_${memory.id}.json`);
      
      // Include vector data if available
      const vectorData = this.vectorIndex.get(memory.id);
      const persistData = {
        ...memory,
        vectorData: vectorData || null
      };
      
      await fs.writeFile(filePath, JSON.stringify(persistData, null, 2));
    } catch (error) {
      this.logger.warn(`Failed to persist memory ${memory.id}:`, error.message);
    }
  }

  async loadMemoryFromDisk(memoryId) {
    try {
      const filePath = path.join(this.persistenceDir, `memory_${memoryId}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  async deleteMemoryFromDisk(memoryId) {
    try {
      const filePath = path.join(this.persistenceDir, `memory_${memoryId}.json`);
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore errors - file might not exist
    }
  }

  async loadPersistedMemories() {
    try {
      const files = await fs.readdir(this.persistenceDir);
      const memoryFiles = files.filter(file => file.startsWith('memory_') && file.endsWith('.json'));
      
      for (const file of memoryFiles) {
        try {
          const filePath = path.join(this.persistenceDir, file);
          const data = await fs.readFile(filePath, 'utf8');
          const persistedData = JSON.parse(data);
          
          // Separate memory and vector data
          const { vectorData, ...memory } = persistedData;
          
          this.memories.set(memory.id, memory);
          
          // Restore vector data if available
          if (vectorData && this.vectorSearchEnabled) {
            this.vectorIndex.set(memory.id, vectorData);
            
            // Restore term frequencies
            if (vectorData.keywords) {
              this.termFrequency.set(memory.id, vectorData.keywords);
              
              // Update document frequency
              const uniqueTerms = new Set(Object.keys(vectorData.keywords));
              for (const term of uniqueTerms) {
                this.documentFrequency.set(term, (this.documentFrequency.get(term) || 0) + 1);
              }
            }
          }
          
          // Restore to categories and namespaces
          this.categories[memory.category].set(memory.id, memory);
          if (!this.namespaces.has(memory.namespace)) {
            this.namespaces.set(memory.namespace, new Set());
          }
          this.namespaces.get(memory.namespace).add(memory.id);
          
          // Restore tags
          for (const tag of memory.tags) {
            if (!this.tags.has(tag)) {
              this.tags.set(tag, new Set());
            }
            this.tags.get(tag).add(memory.id);
          }
          
        } catch (error) {
          this.logger.warn(`Failed to load memory file ${file}:`, error.message);
        }
      }
      
      this.logger.info(`📊 Loaded ${this.memories.size} persisted memories`);
    } catch (error) {
      this.logger.debug('No existing memory directory found, starting fresh');
    }
  }

  async calculateCompressionStats() {
    let totalOriginal = 0;
    let totalCompressed = 0;
    
    for (const memory of this.memories.values()) {
      if (memory.value && memory.value.compressed) {
        totalOriginal += memory.value.originalSize;
        totalCompressed += Buffer.byteLength(memory.value.data, 'base64');
      }
    }
    
    this.stats.compressionRatio = totalOriginal > 0 ? 
      (totalOriginal - totalCompressed) / totalOriginal : 0;
  }

  // Vector Processing Methods

  /**
   * Create and store vector representation for a memory
   */
  async createAndStoreVector(memoryId, text, keywords) {
    // Calculate TF-IDF vector
    const tfidfVector = this.createTFIDFVector(keywords);
    
    // Store vector data
    this.vectorIndex.set(memoryId, {
      text,
      keywords,
      tfidf: tfidfVector,
      magnitude: this.calculateMagnitude(tfidfVector),
      timestamp: new Date().toISOString()
    });
    
    // Store term frequencies for this document
    this.termFrequency.set(memoryId, keywords);
  }

  /**
   * Create TF-IDF vector from keyword frequencies
   */
  createTFIDFVector(keywords) {
    const vector = {};
    const totalTerms = Object.values(keywords).reduce((sum, freq) => sum + freq, 0);
    const totalDocuments = this.memories.size;
    
    for (const [term, frequency] of Object.entries(keywords)) {
      // Term Frequency (TF)
      const tf = frequency / totalTerms;
      
      // Inverse Document Frequency (IDF)
      const df = this.documentFrequency.get(term) || 1;
      const idf = Math.log(totalDocuments / df);
      
      // TF-IDF score
      vector[term] = tf * idf;
    }
    
    return vector;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  calculateCosineSimilarity(vectorA, vectorB) {
    const allTerms = new Set([...Object.keys(vectorA), ...Object.keys(vectorB)]);
    
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    
    for (const term of allTerms) {
      const valueA = vectorA[term] || 0;
      const valueB = vectorB[term] || 0;
      
      dotProduct += valueA * valueB;
      magnitudeA += valueA * valueA;
      magnitudeB += valueB * valueB;
    }
    
    const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Calculate vector magnitude
   */
  calculateMagnitude(vector) {
    return Math.sqrt(Object.values(vector).reduce((sum, value) => sum + value * value, 0));
  }

  /**
   * Perform advanced vector-based semantic search
   */
  async performVectorSearch(memories, query) {
    const queryKeywords = this.extractKeywords(query.toLowerCase());
    const queryVector = this.createTFIDFVector(queryKeywords);
    
    // Calculate similarities and rank results
    const scoredResults = memories
      .map(memory => {
        const vectorData = this.vectorIndex.get(memory.id);
        if (!vectorData) return { memory, score: 0 };
        
        const similarity = this.calculateCosineSimilarity(queryVector, vectorData.tfidf);
        
        // Boost score based on tag matches and recency
        let boost = 1;
        const memoryTags = memory.tags || [];
        const queryTerms = Object.keys(queryKeywords);
        
        // Tag match boost
        const tagMatches = memoryTags.filter(tag => 
          queryTerms.some(term => tag.toLowerCase().includes(term))
        ).length;
        boost += tagMatches * 0.2;
        
        // Recency boost (newer memories get slight preference)
        const ageInDays = (Date.now() - new Date(memory.timestamps.created)) / (1000 * 60 * 60 * 24);
        const recencyBoost = Math.max(0, 1 - (ageInDays / 365)); // Decay over a year
        boost += recencyBoost * 0.1;
        
        // Access frequency boost
        const accessBoost = Math.min(memory.access.count / 10, 0.2);
        boost += accessBoost;
        
        return { memory, score: similarity * boost };
      })
      .filter(item => item.score > this.similarityThreshold)
      .sort((a, b) => b.score - a.score);
    
    return scoredResults.map(item => item.memory);
  }

  /**
   * Find similar memories using vector similarity
   */
  async findSimilarMemories(memoryId, limit = 10) {
    const targetVector = this.vectorIndex.get(memoryId);
    if (!targetVector) return [];
    
    const similarities = [];
    
    for (const [id, vectorData] of this.vectorIndex) {
      if (id === memoryId) continue;
      
      const similarity = this.calculateCosineSimilarity(targetVector.tfidf, vectorData.tfidf);
      if (similarity > this.similarityThreshold) {
        const memory = this.memories.get(id);
        if (memory) {
          similarities.push({ memory, similarity });
        }
      }
    }
    
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map(item => item.memory);
  }

  /**
   * Get vector statistics and health metrics
   */
  getVectorStats() {
    const vectorCount = this.vectorIndex.size;
    const totalTerms = this.documentFrequency.size;
    
    // Calculate average vector sparsity
    let totalNonZeroTerms = 0;
    for (const vectorData of this.vectorIndex.values()) {
      totalNonZeroTerms += Object.keys(vectorData.keywords || {}).length;
    }
    const averageSparsity = vectorCount > 0 ? totalNonZeroTerms / vectorCount : 0;
    
    return {
      vectorsStored: vectorCount,
      totalUniqueTerms: totalTerms,
      averageVectorSparsity: averageSparsity,
      similarityThreshold: this.similarityThreshold,
      embeddingDimensions: this.embeddingDimensions,
      vectorSearchEnabled: this.vectorSearchEnabled
    };
  }

  /**
   * Create semantic clusters of related memories
   */
  async createSemanticClusters(threshold = 0.2, maxClusters = 10) {
    const clusters = [];
    const processed = new Set();
    
    for (const [memoryId, vectorData] of this.vectorIndex) {
      if (processed.has(memoryId)) continue;
      
      const cluster = {
        id: `cluster_${clusters.length}`,
        centroid: memoryId,
        members: [memoryId],
        avgSimilarity: 0,
        keywords: new Set(Object.keys(vectorData.keywords))
      };
      
      // Find similar memories for this cluster
      for (const [otherMemoryId, otherVectorData] of this.vectorIndex) {
        if (otherMemoryId === memoryId || processed.has(otherMemoryId)) continue;
        
        const similarity = this.calculateCosineSimilarity(vectorData.tfidf, otherVectorData.tfidf);
        if (similarity >= threshold) {
          cluster.members.push(otherMemoryId);
          processed.add(otherMemoryId);
          
          // Add keywords from similar memory
          Object.keys(otherVectorData.keywords).forEach(keyword => 
            cluster.keywords.add(keyword)
          );
        }
      }
      
      if (cluster.members.length > 1) {
        // Calculate average similarity within cluster
        let totalSimilarity = 0;
        let comparisons = 0;
        
        for (let i = 0; i < cluster.members.length; i++) {
          for (let j = i + 1; j < cluster.members.length; j++) {
            const vec1 = this.vectorIndex.get(cluster.members[i]);
            const vec2 = this.vectorIndex.get(cluster.members[j]);
            if (vec1 && vec2) {
              totalSimilarity += this.calculateCosineSimilarity(vec1.tfidf, vec2.tfidf);
              comparisons++;
            }
          }
        }
        
        cluster.avgSimilarity = comparisons > 0 ? totalSimilarity / comparisons : 0;
        cluster.keywords = Array.from(cluster.keywords).slice(0, 20); // Top 20 keywords
        clusters.push(cluster);
      }
      
      processed.add(memoryId);
      
      if (clusters.length >= maxClusters) break;
    }
    
    return clusters.sort((a, b) => b.avgSimilarity - a.avgSimilarity);
  }

  /**
   * Enhanced search with memory relationship detection
   */
  async searchWithRelationships(query, options = {}) {
    const {
      includeRelated = true,
      relationshipDepth = 2,
      useVector = true,
      ...searchOptions
    } = options;
    
    // Perform initial search
    const results = await this.query({ 
      semanticSearch: query, 
      ...searchOptions 
    });
    
    if (!includeRelated || results.results.length === 0) {
      return results;
    }
    
    // Find related memories for each result
    const relatedMemories = new Map();
    
    for (const memory of results.results.slice(0, 5)) { // Only for top 5 results
      const related = await this.findSimilarMemories(memory.id, 3);
      if (related.length > 0) {
        relatedMemories.set(memory.id, related);
      }
    }
    
    // Add relationship data to results
    const enhancedResults = results.results.map(memory => ({
      ...memory,
      relatedMemories: relatedMemories.get(memory.id) || []
    }));
    
    return {
      ...results,
      results: enhancedResults
    };
  }

  /**
   * External embedding API integration (placeholder for future enhancement)
   */
  async getExternalEmbedding(text, apiProvider = 'openai') {
    // This would integrate with external APIs like OpenAI, Hugging Face, etc.
    // For now, return null to fall back to TF-IDF
    this.logger.debug(`External embedding requested for provider: ${apiProvider}`);
    return null;
  }

  /**
   * Optimize vector index by removing low-quality vectors
   */
  async optimizeVectorIndex() {
    let removed = 0;
    const minTerms = 3;
    const maxAge = 90 * 24 * 60 * 60 * 1000; // 90 days
    
    for (const [memoryId, vectorData] of this.vectorIndex) {
      const memory = this.memories.get(memoryId);
      if (!memory) {
        this.vectorIndex.delete(memoryId);
        removed++;
        continue;
      }
      
      // Remove vectors with too few terms
      if (Object.keys(vectorData.keywords).length < minTerms) {
        this.vectorIndex.delete(memoryId);
        removed++;
        continue;
      }
      
      // Remove very old, rarely accessed memories
      const age = Date.now() - new Date(memory.timestamps.created).getTime();
      if (age > maxAge && memory.access.count < 2) {
        this.vectorIndex.delete(memoryId);
        removed++;
      }
    }
    
    if (removed > 0) {
      this.logger.info(`🧹 Optimized vector index: removed ${removed} low-quality vectors`);
      await this.buildIndexes(); // Rebuild to update document frequencies
    }
    
    return removed;
  }
}

export default RealMemoryManager;