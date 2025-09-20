/**
 * Comprehensive Unit Tests for Real Memory Manager
 * Testing all core functionality including vector search, persistence, and semantic operations
 */

import { jest } from '@jest/globals';
import { RealMemoryManager } from '../../memory/real-memory-manager.js';
import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

// Mock dependencies
jest.mock('fs/promises');
jest.mock('path');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;

describe('RealMemoryManager', () => {
  let memoryManager: any;
  let testDir: string;
  let mockLogger: any;

  beforeEach(async () => {
    testDir = './test-memory-data';
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    // Reset mocks
    jest.clearAllMocks();
    
    // Mock filesystem operations
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue([]);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue('{}');
    mockFs.unlink.mockResolvedValue(undefined);
    mockPath.join.mockImplementation((...paths) => paths.join('/'));

    memoryManager = new RealMemoryManager({
      persistenceDir: testDir,
      sessionId: 'test-session',
      logger: mockLogger,
      maxMemorySize: 1024 * 1024, // 1MB
      compressionEnabled: true,
      vectorSearchEnabled: true,
      embeddingDimensions: 128,
      similarityThreshold: 0.3
    });
  });

  afterEach(async () => {
    if (memoryManager && memoryManager.initialized) {
      await memoryManager.clearNamespace('default');
    }
  });

  describe('Initialization', () => {
    it('should initialize successfully with default configuration', async () => {
      const result = await memoryManager.initialize();
      
      expect(result).toBe(true);
      expect(memoryManager.initialized).toBe(true);
      expect(mockFs.mkdir).toHaveBeenCalledWith(testDir, { recursive: true });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('RealMemoryManager fully initialized')
      );
    });

    it('should handle initialization failure gracefully', async () => {
      mockFs.mkdir.mockRejectedValue(new Error('Permission denied'));
      
      const result = await memoryManager.initialize();
      
      expect(result).toBe(false);
      expect(memoryManager.initialized).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        '❌ Failed to initialize RealMemoryManager:',
        expect.any(Error)
      );
    });

    it('should emit initialization event on success', async () => {
      const eventSpy = jest.fn();
      memoryManager.on('memoryManagerInitialized', eventSpy);
      
      await memoryManager.initialize();
      
      expect(eventSpy).toHaveBeenCalledWith({
        sessionId: 'test-session',
        memoriesLoaded: 0,
        timestamp: expect.any(String)
      });
    });

    it('should load persisted memories during initialization', async () => {
      const mockMemoryFile = JSON.stringify({
        id: 'test-id',
        key: 'test-key',
        value: 'test-value',
        namespace: 'default',
        category: 'context',
        tags: ['test'],
        metadata: { size: 10 },
        timestamps: { created: new Date().toISOString() },
        access: { count: 0 }
      });

      mockFs.readdir.mockResolvedValue(['memory_test-id.json']);
      mockFs.readFile.mockResolvedValue(mockMemoryFile);
      
      await memoryManager.initialize();
      
      expect(memoryManager.memories.size).toBe(1);
      expect(mockLogger.info).toHaveBeenCalledWith('📊 Loaded 1 persisted memories');
    });
  });

  describe('Memory Storage', () => {
    beforeEach(async () => {
      await memoryManager.initialize();
    });

    it('should store memory with all metadata', async () => {
      const memoryData = {
        key: 'test-key',
        value: { data: 'test-value', type: 'string' },
        namespace: 'test-namespace',
        category: 'context',
        tags: ['test', 'unit'],
        metadata: { source: 'test' },
        priority: 'high',
        agentId: 'agent-123'
      };

      const storedMemory = await memoryManager.store(memoryData);

      expect(storedMemory).toBeDefined();
      expect(storedMemory.key).toBe(memoryData.key);
      expect(storedMemory.namespace).toBe(memoryData.namespace);
      expect(storedMemory.category).toBe(memoryData.category);
      expect(storedMemory.tags).toEqual(memoryData.tags);
      expect(storedMemory.metadata.agentId).toBe(memoryData.agentId);
      expect(storedMemory.metadata.priority).toBe(memoryData.priority);
      expect(storedMemory.timestamps.created).toBeDefined();
      expect(storedMemory.access.count).toBe(0);
    });

    it('should compress large values when compression is enabled', async () => {
      const largeValue = 'x'.repeat(2000); // Large enough to trigger compression
      
      const storedMemory = await memoryManager.store({
        key: 'large-data',
        value: largeValue
      });

      expect(storedMemory.value).toHaveProperty('compressed', true);
      expect(storedMemory.value).toHaveProperty('data');
      expect(storedMemory.value).toHaveProperty('originalSize', largeValue.length);
      expect(storedMemory.originalValue).toBe(largeValue);
    });

    it('should update statistics on storage', async () => {
      const initialStats = memoryManager.getStats();
      
      await memoryManager.store({
        key: 'stats-test',
        value: 'test-data'
      });

      const updatedStats = memoryManager.getStats();
      expect(updatedStats.memoriesStored).toBe(initialStats.memoriesStored + 1);
      expect(updatedStats.storage.totalMemories).toBe(1);
    });

    it('should emit storage event', async () => {
      const eventSpy = jest.fn();
      memoryManager.on('memoryStored', eventSpy);

      await memoryManager.store({
        key: 'event-test',
        value: 'test-data'
      });

      expect(eventSpy).toHaveBeenCalledWith({
        memoryId: expect.any(String),
        namespace: 'default',
        category: 'context',
        size: expect.any(Number),
        timestamp: expect.any(String)
      });
    });

    it('should handle storage errors gracefully', async () => {
      expect(() => memoryManager.store({
        key: 'test',
        value: 'data'
      })).rejects.toThrow('Memory manager not initialized');
    });
  });

  describe('Memory Retrieval', () => {
    beforeEach(async () => {
      await memoryManager.initialize();
      
      // Store test memories
      await memoryManager.store({
        key: 'retrieval-test',
        value: { data: 'test-value' },
        namespace: 'test-ns',
        tags: ['retrieval', 'test']
      });
    });

    it('should retrieve stored memory correctly', async () => {
      const retrieved = await memoryManager.retrieve('retrieval-test', 'test-ns');

      expect(retrieved).toBeDefined();
      expect(retrieved.key).toBe('retrieval-test');
      expect(retrieved.value).toEqual({ data: 'test-value' });
      expect(retrieved.namespace).toBe('test-ns');
    });

    it('should update access statistics on retrieval', async () => {
      const beforeRetrieval = await memoryManager.retrieve('retrieval-test', 'test-ns');
      const accessCountBefore = beforeRetrieval.access.count;

      const afterRetrieval = await memoryManager.retrieve('retrieval-test', 'test-ns');
      
      expect(afterRetrieval.access.count).toBe(accessCountBefore + 1);
      expect(afterRetrieval.access.lastAccessed).toBeDefined();
      expect(afterRetrieval.timestamps.accessed).toBeDefined();
    });

    it('should handle non-existent memory gracefully', async () => {
      const result = await memoryManager.retrieve('non-existent', 'default');
      expect(result).toBeNull();
    });

    it('should handle expired memories', async () => {
      // Store memory with short TTL
      await memoryManager.store({
        key: 'expired-test',
        value: 'test-data',
        ttl: 1 // 1ms TTL
      });

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await memoryManager.retrieve('expired-test', 'default');
      expect(result).toBeNull();
    });

    it('should emit retrieval event', async () => {
      const eventSpy = jest.fn();
      memoryManager.on('memoryRetrieved', eventSpy);

      await memoryManager.retrieve('retrieval-test', 'test-ns');

      expect(eventSpy).toHaveBeenCalledWith({
        memoryId: expect.any(String),
        namespace: 'test-ns',
        fromCache: true,
        retrievalTime: expect.any(Number),
        timestamp: expect.any(String)
      });
    });
  });

  describe('Memory Querying', () => {
    beforeEach(async () => {
      await memoryManager.initialize();
      
      // Store multiple test memories with different attributes
      const testMemories = [
        {
          key: 'query-test-1',
          value: { content: 'machine learning algorithms' },
          namespace: 'ai',
          category: 'learning',
          tags: ['ml', 'algorithm'],
          agentId: 'agent-1',
          priority: 'high'
        },
        {
          key: 'query-test-2',
          value: { content: 'neural network architecture' },
          namespace: 'ai',
          category: 'patterns',
          tags: ['nn', 'architecture'],
          agentId: 'agent-2',
          priority: 'medium'
        },
        {
          key: 'query-test-3',
          value: { content: 'database optimization techniques' },
          namespace: 'db',
          category: 'performance',
          tags: ['database', 'optimization'],
          agentId: 'agent-1',
          priority: 'low'
        }
      ];

      for (const memory of testMemories) {
        await memoryManager.store(memory);
      }
    });

    it('should query by namespace', async () => {
      const results = await memoryManager.query({ namespace: 'ai' });
      
      expect(results.results).toHaveLength(2);
      expect(results.total).toBe(2);
      expect(results.results.every(r => r.namespace === 'ai')).toBe(true);
    });

    it('should query by category', async () => {
      const results = await memoryManager.query({ category: 'learning' });
      
      expect(results.results).toHaveLength(1);
      expect(results.results[0].category).toBe('learning');
    });

    it('should query by tags', async () => {
      const results = await memoryManager.query({ tags: ['ml'] });
      
      expect(results.results).toHaveLength(1);
      expect(results.results[0].tags).toContain('ml');
    });

    it('should query by agent ID', async () => {
      const results = await memoryManager.query({ agentId: 'agent-1' });
      
      expect(results.results).toHaveLength(2);
      expect(results.results.every(r => r.metadata.agentId === 'agent-1')).toBe(true);
    });

    it('should query by priority', async () => {
      const results = await memoryManager.query({ priority: 'high' });
      
      expect(results.results).toHaveLength(1);
      expect(results.results[0].metadata.priority).toBe('high');
    });

    it('should perform text search', async () => {
      const results = await memoryManager.query({ search: 'machine learning' });
      
      expect(results.results).toHaveLength(1);
      expect(results.results[0].key).toBe('query-test-1');
    });

    it('should handle pagination', async () => {
      const results = await memoryManager.query({ limit: 2, offset: 1 });
      
      expect(results.results).toHaveLength(2);
      expect(results.offset).toBe(1);
      expect(results.limit).toBe(2);
      expect(results.hasMore).toBe(false);
    });

    it('should sort results correctly', async () => {
      const results = await memoryManager.query({ 
        sortBy: 'priority', 
        sortOrder: 'desc' 
      });
      
      expect(results.results[0].metadata.priority).toBe('high');
      expect(results.results[2].metadata.priority).toBe('low');
    });

    it('should emit query event', async () => {
      const eventSpy = jest.fn();
      memoryManager.on('memoryQueried', eventSpy);

      await memoryManager.query({ namespace: 'ai' });

      expect(eventSpy).toHaveBeenCalledWith({
        query: { namespace: 'ai' },
        resultCount: expect.any(Number),
        totalCount: expect.any(Number),
        timestamp: expect.any(String)
      });
    });
  });

  describe('Vector Search Operations', () => {
    beforeEach(async () => {
      await memoryManager.initialize();
      
      // Store memories with rich text content for vector testing
      const testMemories = [
        {
          key: 'vector-test-1',
          value: { 
            content: 'Machine learning involves training algorithms on data to make predictions and decisions without explicit programming'
          },
          tags: ['machine-learning', 'algorithms', 'data-science']
        },
        {
          key: 'vector-test-2', 
          value: {
            content: 'Neural networks are computational models inspired by biological neural networks in animal brains'
          },
          tags: ['neural-networks', 'deep-learning', 'ai']
        },
        {
          key: 'vector-test-3',
          value: {
            content: 'Database optimization involves indexing, query tuning, and schema design for better performance'
          },
          tags: ['database', 'optimization', 'performance']
        }
      ];

      for (const memory of testMemories) {
        await memoryManager.store(memory);
      }
    });

    it('should create TF-IDF vectors for stored memories', async () => {
      const vectorStats = memoryManager.getVectorStats();
      
      expect(vectorStats.vectorsStored).toBe(3);
      expect(vectorStats.totalUniqueTerms).toBeGreaterThan(0);
      expect(vectorStats.averageVectorSparsity).toBeGreaterThan(0);
    });

    it('should perform semantic search using vectors', async () => {
      const results = await memoryManager.query({ 
        semanticSearch: 'artificial intelligence neural computation' 
      });
      
      expect(results.results.length).toBeGreaterThan(0);
      // Should find neural network content as most relevant
      expect(results.results[0].key).toBe('vector-test-2');
    });

    it('should find similar memories using vector similarity', async () => {
      const stored = await memoryManager.retrieve('vector-test-1', 'default');
      const similar = await memoryManager.findSimilarMemories(stored.id, 5);
      
      expect(similar).toBeInstanceOf(Array);
      expect(similar.every(memory => memory.id !== stored.id)).toBe(true);
    });

    it('should calculate cosine similarity correctly', async () => {
      const vectorA = { term1: 0.5, term2: 0.3, term3: 0.2 };
      const vectorB = { term1: 0.4, term2: 0.6, term3: 0.0 };
      
      const similarity = memoryManager.calculateCosineSimilarity(vectorA, vectorB);
      
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThanOrEqual(1);
    });

    it('should create semantic clusters', async () => {
      const clusters = await memoryManager.createSemanticClusters(0.1, 5);
      
      expect(clusters).toBeInstanceOf(Array);
      expect(clusters.every(cluster => 
        cluster.hasOwnProperty('id') && 
        cluster.hasOwnProperty('members') &&
        cluster.hasOwnProperty('avgSimilarity')
      )).toBe(true);
    });

    it('should optimize vector index', async () => {
      const removed = await memoryManager.optimizeVectorIndex();
      
      expect(typeof removed).toBe('number');
      expect(removed).toBeGreaterThanOrEqual(0);
    });

    it('should handle search with relationships', async () => {
      const results = await memoryManager.searchWithRelationships(
        'machine learning algorithms', 
        { includeRelated: true, relationshipDepth: 2 }
      );
      
      expect(results.results).toBeInstanceOf(Array);
      if (results.results.length > 0) {
        expect(results.results[0]).toHaveProperty('relatedMemories');
      }
    });
  });

  describe('Memory Management Operations', () => {
    beforeEach(async () => {
      await memoryManager.initialize();
    });

    it('should update existing memory', async () => {
      const original = await memoryManager.store({
        key: 'update-test',
        value: { version: 1 },
        metadata: { source: 'original' }
      });

      const updated = await memoryManager.update('update-test', {
        value: { version: 2 },
        metadata: { source: 'updated' }
      });

      expect(updated.value).toEqual({ version: 2 });
      expect(updated.metadata.source).toBe('updated');
      expect(updated.metadata.version).toBe(original.metadata.version + 1);
      expect(updated.timestamps.modified).toBeDefined();
    });

    it('should delete memory correctly', async () => {
      await memoryManager.store({
        key: 'delete-test',
        value: 'test-data'
      });

      const deleted = await memoryManager.delete('delete-test', 'default');
      expect(deleted).toBe(true);

      const retrieved = await memoryManager.retrieve('delete-test', 'default');
      expect(retrieved).toBeNull();
    });

    it('should clear namespace', async () => {
      await memoryManager.store({ key: 'ns-test-1', value: 'data', namespace: 'test-ns' });
      await memoryManager.store({ key: 'ns-test-2', value: 'data', namespace: 'test-ns' });
      await memoryManager.store({ key: 'ns-test-3', value: 'data', namespace: 'other-ns' });

      const deleted = await memoryManager.clearNamespace('test-ns');
      
      expect(deleted).toBe(2);
      
      const testNsResults = await memoryManager.query({ namespace: 'test-ns' });
      expect(testNsResults.results).toHaveLength(0);
      
      const otherNsResults = await memoryManager.query({ namespace: 'other-ns' });
      expect(otherNsResults.results).toHaveLength(1);
    });

    it('should perform maintenance operations', async () => {
      // Store memories with various ages and access patterns
      await memoryManager.store({
        key: 'maintenance-test-1',
        value: 'data',
        ttl: 1 // Very short TTL for testing cleanup
      });

      await memoryManager.store({
        key: 'maintenance-test-2',
        value: 'data'
      });

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));

      const eventSpy = jest.fn();
      memoryManager.on('maintenanceCompleted', eventSpy);

      await memoryManager.performMaintenance();

      expect(eventSpy).toHaveBeenCalledWith({
        cleanedUp: expect.any(Number),
        optimized: expect.any(Number),
        vectorsOptimized: expect.any(Number),
        timestamp: expect.any(String)
      });
    });
  });

  describe('Statistics and Monitoring', () => {
    beforeEach(async () => {
      await memoryManager.initialize();
      
      // Store some test data for statistics
      await memoryManager.store({
        key: 'stats-test-1',
        value: 'data',
        namespace: 'stats-ns',
        category: 'testing',
        tags: ['stats', 'test']
      });
    });

    it('should provide comprehensive statistics', async () => {
      const stats = memoryManager.getStats();

      expect(stats).toHaveProperty('session');
      expect(stats).toHaveProperty('storage'); 
      expect(stats).toHaveProperty('organization');
      expect(stats).toHaveProperty('performance');
      expect(stats).toHaveProperty('vectorSearch');

      expect(stats.session.id).toBe('test-session');
      expect(stats.session.initialized).toBe(true);
      expect(stats.storage.totalMemories).toBeGreaterThan(0);
      expect(stats.organization.namespaces).toHaveProperty('stats-ns', 1);
      expect(stats.organization.categories).toHaveProperty('testing', 1);
    });

    it('should track performance metrics', async () => {
      // Perform some operations to generate metrics
      await memoryManager.retrieve('stats-test-1', 'stats-ns');
      await memoryManager.query({ namespace: 'stats-ns' });

      const stats = memoryManager.getStats();

      expect(stats.memoriesStored).toBeGreaterThan(0);
      expect(stats.memoriesRetrieved).toBeGreaterThan(0);
      expect(stats.queriesExecuted).toBeGreaterThan(0);
      expect(stats.performance.averageRetrievalTime).toBeGreaterThanOrEqual(0);
      expect(stats.performance.cacheHitRate).toBeGreaterThanOrEqual(0);
    });

    it('should provide vector statistics', async () => {
      const vectorStats = memoryManager.getVectorStats();

      expect(vectorStats).toHaveProperty('vectorsStored');
      expect(vectorStats).toHaveProperty('totalUniqueTerms');
      expect(vectorStats).toHaveProperty('averageVectorSparsity');
      expect(vectorStats).toHaveProperty('similarityThreshold', 0.3);
      expect(vectorStats).toHaveProperty('embeddingDimensions', 128);
      expect(vectorStats).toHaveProperty('vectorSearchEnabled', true);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    beforeEach(async () => {
      await memoryManager.initialize();
    });

    it('should handle invalid memory data gracefully', async () => {
      await expect(memoryManager.store(null)).rejects.toThrow();
      await expect(memoryManager.store({})).rejects.toThrow();
    });

    it('should handle filesystem errors during persistence', async () => {
      mockFs.writeFile.mockRejectedValueOnce(new Error('Disk full'));
      
      // Should still store in memory despite persistence failure
      const memory = await memoryManager.store({
        key: 'persist-error-test',
        value: 'data'
      });

      expect(memory).toBeDefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to persist memory'),
        expect.any(String)
      );
    });

    it('should handle malformed persisted data', async () => {
      mockFs.readdir.mockResolvedValue(['memory_invalid.json']);
      mockFs.readFile.mockResolvedValue('invalid json');
      
      // Should continue initialization despite invalid file
      const result = await memoryManager.initialize();
      expect(result).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load memory file'),
        expect.any(String)
      );
    });

    it('should handle concurrent access correctly', async () => {
      const promises = [];
      
      // Simulate concurrent stores
      for (let i = 0; i < 10; i++) {
        promises.push(memoryManager.store({
          key: `concurrent-${i}`,
          value: { data: i }
        }));
      }

      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(10);
      expect(results.every(r => r !== null)).toBe(true);
      expect(memoryManager.memories.size).toBe(10);
    });

    it('should handle memory size limits', async () => {
      memoryManager.maxMemorySize = 100; // Very small limit
      
      const largeData = 'x'.repeat(200);
      
      // Should still store but emit warning
      const memory = await memoryManager.store({
        key: 'size-limit-test',
        value: largeData
      });

      expect(memory).toBeDefined();
    });

    it('should handle invalid vector operations', async () => {
      const result = await memoryManager.findSimilarMemories('non-existent-id');
      expect(result).toEqual([]);

      const similarity = memoryManager.calculateCosineSimilarity({}, {});
      expect(similarity).toBe(0);
    });
  });

  describe('Event System', () => {
    beforeEach(async () => {
      await memoryManager.initialize();
    });

    it('should emit all expected events during memory lifecycle', async () => {
      const events = [];
      const eventTypes = [
        'memoryStored',
        'memoryRetrieved', 
        'memoryUpdated',
        'memoryDeleted',
        'memoryQueried',
        'namespaceCleared',
        'maintenanceCompleted'
      ];

      eventTypes.forEach(eventType => {
        memoryManager.on(eventType, (data) => {
          events.push({ type: eventType, data });
        });
      });

      // Trigger all events
      const stored = await memoryManager.store({ key: 'event-test', value: 'data' });
      await memoryManager.retrieve('event-test', 'default');
      await memoryManager.update('event-test', { value: 'updated' });
      await memoryManager.query({ key: 'event-test' });
      await memoryManager.delete('event-test', 'default');
      await memoryManager.clearNamespace('default');
      await memoryManager.performMaintenance();

      expect(events.length).toBeGreaterThan(0);
      expect(events.some(e => e.type === 'memoryStored')).toBe(true);
      expect(events.some(e => e.type === 'memoryRetrieved')).toBe(true);
    });

    it('should provide meaningful event data', async () => {
      const eventSpy = jest.fn();
      memoryManager.on('memoryStored', eventSpy);

      await memoryManager.store({
        key: 'event-data-test',
        value: 'test-data',
        namespace: 'event-ns'
      });

      expect(eventSpy).toHaveBeenCalledWith({
        memoryId: expect.any(String),
        namespace: 'event-ns',
        category: 'context',
        size: expect.any(Number),
        timestamp: expect.any(String)
      });
    });
  });

  describe('Integration with Enhanced Memory Features', () => {
    beforeEach(async () => {
      await memoryManager.initialize();
    });

    it('should support TTL-based expiration', async () => {
      const shortTTL = 50; // 50ms
      
      await memoryManager.store({
        key: 'ttl-test',
        value: 'expires-soon',
        ttl: shortTTL
      });

      // Should exist immediately
      let result = await memoryManager.retrieve('ttl-test', 'default');
      expect(result).not.toBeNull();

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, shortTTL + 10));

      // Should be expired
      result = await memoryManager.retrieve('ttl-test', 'default');
      expect(result).toBeNull();
    });

    it('should support memory relationships and dependencies', async () => {
      const memory = await memoryManager.store({
        key: 'relationship-test',
        value: 'data-with-relationships'
      });

      expect(memory.relationships).toHaveProperty('related');
      expect(memory.relationships).toHaveProperty('dependencies');
      expect(memory.relationships).toHaveProperty('references');
    });

    it('should support custom metadata and categorization', async () => {
      const customMemory = await memoryManager.store({
        key: 'custom-test',
        value: 'custom-data',
        namespace: 'custom-ns',
        category: 'custom-category',
        tags: ['custom', 'metadata', 'test'],
        metadata: {
          customField: 'custom-value',
          processedBy: 'test-agent',
          confidence: 0.95
        },
        priority: 'high',
        agentId: 'custom-agent-123'
      });

      expect(customMemory.namespace).toBe('custom-ns');
      expect(customMemory.category).toBe('custom-category');
      expect(customMemory.tags).toContain('custom');
      expect(customMemory.metadata.customField).toBe('custom-value');
      expect(customMemory.metadata.agentId).toBe('custom-agent-123');
      expect(customMemory.metadata.priority).toBe('high');
    });
  });
});