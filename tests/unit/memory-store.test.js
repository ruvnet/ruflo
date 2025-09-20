import { jest } from '@jest/globals';
import { MemoryStore } from '../../lib/memory-store.js';

describe('MemoryStore Unit Tests', () => {
  let memoryStore;

  beforeEach(async () => {
    memoryStore = new MemoryStore();
    await memoryStore.init();
  });

  afterEach(async () => {
    if (memoryStore && memoryStore.cleanup) {
      await memoryStore.cleanup();
    }
  });

  describe('Initialization', () => {
    test('should initialize successfully', () => {
      expect(memoryStore.initialized).toBe(true);
      expect(memoryStore.storage).toBeDefined();
      expect(memoryStore.cache).toBeDefined();
      expect(memoryStore.persistence).toBeDefined();
    });

    test('should have default configuration', () => {
      expect(memoryStore.config.defaultTTL).toBe(3600000); // 1 hour
      expect(memoryStore.config.maxEntries).toBe(10000);
      expect(memoryStore.config.compressionThreshold).toBe(1024);
      expect(memoryStore.config.persistenceEnabled).toBe(true);
    });

    test('should initialize helper components', () => {
      expect(memoryStore.searchEngine).toBeDefined();
      expect(memoryStore.compression).toBeDefined();
      expect(memoryStore.backup).toBeDefined();
      expect(memoryStore.sync).toBeDefined();
      expect(memoryStore.analytics).toBeDefined();
      expect(memoryStore.namespace).toBeDefined();
    });
  });

  describe('Memory Storage', () => {
    test('should store key-value pair with default TTL', async () => {
      const result = await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'test-key',
        value: 'test-value'
      });

      expect(result.action).toBe('store');
      expect(result.key).toBe('test-key');
      expect(result.status).toBe('stored');
      expect(result.ttl).toBe(memoryStore.config.defaultTTL);
    });

    test('should store key-value pair with custom TTL', async () => {
      const customTTL = 5000;
      const result = await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'test-key-ttl',
        value: 'test-value',
        ttl: customTTL
      });

      expect(result.action).toBe('store');
      expect(result.ttl).toBe(customTTL);
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    test('should store key-value pair with namespace', async () => {
      const result = await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'test-key',
        value: 'test-value',
        namespace: 'test-namespace'
      });

      expect(result.namespace).toBe('test-namespace');
      expect(result.fullKey).toBe('test-namespace:test-key');
    });

    test('should handle large value compression', async () => {
      const largeValue = 'x'.repeat(2000); // Exceeds compression threshold
      const result = await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'large-key',
        value: largeValue
      });

      expect(result.compressed).toBe(true);
      expect(result.originalSize).toBe(2000);
      expect(result.compressedSize).toBeLessThan(2000);
    });

    test('should update storage statistics', async () => {
      const initialCount = memoryStore.storage.size;
      
      await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'stat-test',
        value: 'test-value'
      });

      expect(memoryStore.storage.size).toBe(initialCount + 1);
    });
  });

  describe('Memory Retrieval', () => {
    beforeEach(async () => {
      // Store test data
      await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'retrieve-test',
        value: 'stored-value',
        namespace: 'test'
      });
    });

    test('should retrieve stored value', async () => {
      const result = await memoryStore.execute('memory_usage', {
        action: 'retrieve',
        key: 'retrieve-test',
        namespace: 'test'
      });

      expect(result.action).toBe('retrieve');
      expect(result.key).toBe('retrieve-test');
      expect(result.value).toBe('stored-value');
      expect(result.found).toBe(true);
    });

    test('should return not found for non-existent key', async () => {
      const result = await memoryStore.execute('memory_usage', {
        action: 'retrieve',
        key: 'non-existent-key'
      });

      expect(result.found).toBe(false);
      expect(result.value).toBeNull();
    });

    test('should handle expired keys', async () => {
      // Store with very short TTL
      await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'expired-key',
        value: 'expired-value',
        ttl: 1 // 1ms
      });

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await memoryStore.execute('memory_usage', {
        action: 'retrieve',
        key: 'expired-key'
      });

      expect(result.found).toBe(false);
      expect(result.expired).toBe(true);
    });

    test('should decompress large values on retrieval', async () => {
      const largeValue = 'y'.repeat(2000);
      await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'compressed-key',
        value: largeValue
      });

      const result = await memoryStore.execute('memory_usage', {
        action: 'retrieve',
        key: 'compressed-key'
      });

      expect(result.value).toBe(largeValue);
      expect(result.decompressed).toBe(true);
    });
  });

  describe('Memory Listing', () => {
    beforeEach(async () => {
      // Store multiple test entries
      await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'list-test-1',
        value: 'value-1',
        namespace: 'list-test'
      });
      await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'list-test-2',
        value: 'value-2',
        namespace: 'list-test'
      });
      await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'other-key',
        value: 'other-value',
        namespace: 'other'
      });
    });

    test('should list all keys', async () => {
      const result = await memoryStore.execute('memory_usage', {
        action: 'list'
      });

      expect(result.action).toBe('list');
      expect(Array.isArray(result.keys)).toBe(true);
      expect(result.total).toBeGreaterThanOrEqual(3);
      expect(result.keys).toContain('list-test:list-test-1');
      expect(result.keys).toContain('list-test:list-test-2');
      expect(result.keys).toContain('other:other-key');
    });

    test('should list keys in specific namespace', async () => {
      const result = await memoryStore.execute('memory_usage', {
        action: 'list',
        namespace: 'list-test'
      });

      expect(result.namespace).toBe('list-test');
      expect(result.total).toBe(2);
      expect(result.keys.every(key => key.startsWith('list-test:'))).toBe(true);
    });

    test('should include metadata in listing', async () => {
      const result = await memoryStore.execute('memory_usage', {
        action: 'list',
        namespace: 'list-test'
      });

      expect(result.entries).toBeDefined();
      expect(result.entries[0]).toHaveProperty('key');
      expect(result.entries[0]).toHaveProperty('size');
      expect(result.entries[0]).toHaveProperty('createdAt');
      expect(result.entries[0]).toHaveProperty('ttl');
    });
  });

  describe('Memory Deletion', () => {
    beforeEach(async () => {
      await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'delete-test',
        value: 'to-be-deleted',
        namespace: 'test'
      });
    });

    test('should delete existing key', async () => {
      const result = await memoryStore.execute('memory_usage', {
        action: 'delete',
        key: 'delete-test',
        namespace: 'test'
      });

      expect(result.action).toBe('delete');
      expect(result.key).toBe('delete-test');
      expect(result.deleted).toBe(true);

      // Verify deletion
      const retrieveResult = await memoryStore.execute('memory_usage', {
        action: 'retrieve',
        key: 'delete-test',
        namespace: 'test'
      });
      expect(retrieveResult.found).toBe(false);
    });

    test('should handle deletion of non-existent key', async () => {
      const result = await memoryStore.execute('memory_usage', {
        action: 'delete',
        key: 'non-existent',
        namespace: 'test'
      });

      expect(result.deleted).toBe(false);
      expect(result.found).toBe(false);
    });
  });

  describe('Memory Search', () => {
    beforeEach(async () => {
      await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'search-user-1',
        value: JSON.stringify({ name: 'John', role: 'admin' }),
        namespace: 'users'
      });
      await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'search-user-2',
        value: JSON.stringify({ name: 'Jane', role: 'user' }),
        namespace: 'users'
      });
    });

    test('should search keys by pattern', async () => {
      const result = await memoryStore.execute('memory_search', {
        pattern: 'users:*user*',
        limit: 10
      });

      expect(result.pattern).toBe('users:*user*');
      expect(result.matches).toBeGreaterThanOrEqual(2);
      expect(result.results).toHaveLength(2);
      expect(result.results.every(r => r.key.includes('user'))).toBe(true);
    });

    test('should search with limit', async () => {
      const result = await memoryStore.execute('memory_search', {
        pattern: 'users:*',
        limit: 1
      });

      expect(result.results).toHaveLength(1);
      expect(result.hasMore).toBe(true);
    });

    test('should search by value content', async () => {
      const result = await memoryStore.execute('memory_search', {
        pattern: '*',
        namespace: 'users'
      });

      const adminResult = result.results.find(r => 
        r.value && r.value.includes('admin')
      );
      expect(adminResult).toBeDefined();
    });

    test('should handle empty search results', async () => {
      const result = await memoryStore.execute('memory_search', {
        pattern: 'nonexistent:*'
      });

      expect(result.matches).toBe(0);
      expect(result.results).toHaveLength(0);
    });
  });

  describe('Memory Persistence', () => {
    test('should persist session data', async () => {
      const result = await memoryStore.execute('memory_persist', {
        sessionId: 'test-session-123'
      });

      expect(result.sessionId).toBe('test-session-123');
      expect(result.status).toBe('persisted');
      expect(result.entriesPersisted).toBeGreaterThanOrEqual(0);
      expect(result.persistenceFile).toBeDefined();
    });

    test('should handle persistence without session ID', async () => {
      const result = await memoryStore.execute('memory_persist', {});

      expect(result.status).toBe('persisted');
      expect(result.sessionId).toMatch(/^session_/);
    });

    test('should track persistence metrics', async () => {
      const result = await memoryStore.execute('memory_persist', {
        sessionId: 'metrics-test'
      });

      expect(result.metrics).toBeDefined();
      expect(result.metrics.totalSize).toBeGreaterThanOrEqual(0);
      expect(result.metrics.compressionRatio).toBeGreaterThanOrEqual(0);
      expect(result.metrics.persistenceTime).toBeGreaterThan(0);
    });
  });

  describe('Memory Namespace Management', () => {
    test('should create namespace', async () => {
      const result = await memoryStore.execute('memory_namespace', {
        namespace: 'new-namespace',
        action: 'create'
      });

      expect(result.namespace).toBe('new-namespace');
      expect(result.action).toBe('create');
      expect(result.status).toBe('created');
    });

    test('should delete namespace and all its keys', async () => {
      // Store data in namespace
      await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'ns-test',
        value: 'test-value',
        namespace: 'temp-namespace'
      });

      const result = await memoryStore.execute('memory_namespace', {
        namespace: 'temp-namespace',
        action: 'delete'
      });

      expect(result.status).toBe('deleted');
      expect(result.keysDeleted).toBeGreaterThanOrEqual(1);
    });

    test('should list all namespaces', async () => {
      const result = await memoryStore.execute('memory_namespace', {
        action: 'list'
      });

      expect(result.action).toBe('list');
      expect(Array.isArray(result.namespaces)).toBe(true);
      expect(result.total).toBeGreaterThanOrEqual(0);
    });

    test('should get namespace statistics', async () => {
      await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'stats-test',
        value: 'test-value',
        namespace: 'stats-namespace'
      });

      const result = await memoryStore.execute('memory_namespace', {
        namespace: 'stats-namespace',
        action: 'stats'
      });

      expect(result.namespace).toBe('stats-namespace');
      expect(result.keyCount).toBeGreaterThanOrEqual(1);
      expect(result.totalSize).toBeGreaterThan(0);
    });
  });

  describe('Memory Backup', () => {
    test('should create backup', async () => {
      const result = await memoryStore.execute('memory_backup', {
        path: '/tmp/memory-backup-test.json'
      });

      expect(result.status).toBe('completed');
      expect(result.path).toBe('/tmp/memory-backup-test.json');
      expect(result.entriesBackedUp).toBeGreaterThanOrEqual(0);
      expect(result.backupSize).toBeGreaterThan(0);
    });

    test('should create backup with compression', async () => {
      const result = await memoryStore.execute('memory_backup', {
        path: '/tmp/compressed-backup.gz',
        compress: true
      });

      expect(result.compressed).toBe(true);
      expect(result.compressionRatio).toBeGreaterThan(0);
    });

    test('should create incremental backup', async () => {
      const result = await memoryStore.execute('memory_backup', {
        path: '/tmp/incremental-backup.json',
        incremental: true,
        since: Date.now() - 3600000 // 1 hour ago
      });

      expect(result.incremental).toBe(true);
      expect(result.entriesBackedUp).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Memory Restore', () => {
    test('should restore from backup', async () => {
      const result = await memoryStore.execute('memory_restore', {
        backupPath: '/tmp/test-restore-backup.json'
      });

      expect(result.status).toBe('completed');
      expect(result.backupPath).toBe('/tmp/test-restore-backup.json');
      expect(result.entriesRestored).toBeGreaterThanOrEqual(0);
      expect(result.conflicts).toBeGreaterThanOrEqual(0);
    });

    test('should handle restore conflicts', async () => {
      const result = await memoryStore.execute('memory_restore', {
        backupPath: '/tmp/conflict-backup.json',
        conflictStrategy: 'overwrite'
      });

      expect(result.conflictStrategy).toBe('overwrite');
      expect(result.conflictsResolved).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Memory Compression', () => {
    test('should compress memory data', async () => {
      const result = await memoryStore.execute('memory_compress', {
        namespace: 'test'
      });

      expect(result.status).toBe('completed');
      expect(result.entriesCompressed).toBeGreaterThanOrEqual(0);
      expect(result.spaceSaved).toBeGreaterThanOrEqual(0);
      expect(result.compressionRatio).toBeGreaterThanOrEqual(0);
    });

    test('should compress all memory data', async () => {
      const result = await memoryStore.execute('memory_compress', {});

      expect(result.totalEntries).toBeGreaterThanOrEqual(0);
      expect(result.compressionTime).toBeGreaterThan(0);
    });
  });

  describe('Memory Synchronization', () => {
    test('should sync with target instance', async () => {
      const result = await memoryStore.execute('memory_sync', {
        target: 'remote-memory-instance'
      });

      expect(result.target).toBe('remote-memory-instance');
      expect(result.status).toBe('synchronized');
      expect(result.entriesSynced).toBeGreaterThanOrEqual(0);
      expect(result.conflicts).toBeGreaterThanOrEqual(0);
    });

    test('should handle sync conflicts', async () => {
      const result = await memoryStore.execute('memory_sync', {
        target: 'conflicting-instance',
        conflictResolution: 'latest_wins'
      });

      expect(result.conflictResolution).toBe('latest_wins');
      expect(result.conflictsResolved).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Memory Analytics', () => {
    test('should provide memory usage analytics', async () => {
      const result = await memoryStore.execute('memory_analytics', {
        timeframe: '1h'
      });

      expect(result.timeframe).toBe('1h');
      expect(result.analytics.totalEntries).toBeGreaterThanOrEqual(0);
      expect(result.analytics.totalSize).toBeGreaterThanOrEqual(0);
      expect(result.analytics.hitRate).toBeGreaterThanOrEqual(0);
      expect(result.analytics.namespaces).toBeDefined();
    });

    test('should provide detailed analytics', async () => {
      const result = await memoryStore.execute('memory_analytics', {
        detailed: true
      });

      expect(result.analytics.topKeys).toBeDefined();
      expect(result.analytics.sizeDistribution).toBeDefined();
      expect(result.analytics.ttlDistribution).toBeDefined();
      expect(result.analytics.accessPatterns).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('should throw error for unknown action', async () => {
      await expect(
        memoryStore.execute('memory_usage', {
          action: 'unknown_action',
          key: 'test'
        })
      ).rejects.toThrow('Unknown memory action: unknown_action');
    });

    test('should throw error for unknown tool', async () => {
      await expect(
        memoryStore.execute('unknown_tool', {})
      ).rejects.toThrow('Unknown memory tool: unknown_tool');
    });

    test('should handle invalid namespace characters', async () => {
      await expect(
        memoryStore.execute('memory_usage', {
          action: 'store',
          key: 'test',
          value: 'test',
          namespace: 'invalid:namespace'
        })
      ).rejects.toThrow('Invalid namespace format');
    });

    test('should handle storage quota exceeded', async () => {
      // Temporarily reduce max entries for test
      const originalMax = memoryStore.config.maxEntries;
      memoryStore.config.maxEntries = 1;

      await memoryStore.execute('memory_usage', {
        action: 'store',
        key: 'quota-test-1',
        value: 'test'
      });

      await expect(
        memoryStore.execute('memory_usage', {
          action: 'store',
          key: 'quota-test-2',
          value: 'test'
        })
      ).rejects.toThrow('Storage quota exceeded');

      // Restore original max
      memoryStore.config.maxEntries = originalMax;
    });
  });

  describe('Health and Capabilities', () => {
    test('should report healthy status', async () => {
      const health = await memoryStore.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.initialized).toBe(true);
      expect(health.entries).toBeGreaterThanOrEqual(0);
      expect(health.memoryUsage).toBeGreaterThanOrEqual(0);
      expect(health.hitRate).toBeGreaterThanOrEqual(0);
    });

    test('should report capabilities', () => {
      const capabilities = memoryStore.getCapabilities();

      expect(capabilities).toContain('key-value-storage');
      expect(capabilities).toContain('namespacing');
      expect(capabilities).toContain('ttl-support');
      expect(capabilities).toContain('compression');
      expect(capabilities).toContain('search');
      expect(capabilities).toContain('persistence');
      expect(capabilities).toContain('backup-restore');
      expect(capabilities).toContain('synchronization');
      expect(capabilities).toContain('analytics');
    });

    test('should report healthy when initialized', () => {
      expect(memoryStore.isHealthy()).toBe(true);
    });

    test('should provide storage metrics', async () => {
      const health = await memoryStore.getHealth();

      expect(health.metrics).toBeDefined();
      expect(health.metrics.totalSize).toBeGreaterThanOrEqual(0);
      expect(health.metrics.compressionRatio).toBeGreaterThanOrEqual(0);
      expect(health.metrics.averageKeySize).toBeGreaterThanOrEqual(0);
    });
  });
});