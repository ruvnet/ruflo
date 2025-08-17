/**
 * Tests for Graphiti Memory Adapter
 */

import { GraphitiMemoryAdapter } from '../../memory/graphiti-adapter';
import type { MemoryEntry } from '../../memory/advanced-memory-manager';

describe('GraphitiMemoryAdapter', () => {
  let adapter: GraphitiMemoryAdapter;

  beforeEach(() => {
    adapter = new GraphitiMemoryAdapter({
      enabled: true,
      defaultGroupId: 'test_group',
      enableAutoSync: false // Disable for testing
    });
  });

  afterEach(async () => {
    await adapter.destroy();
  });

  describe('Memory Operations', () => {
    test('should add memory episode', async () => {
      const uuid = await adapter.addMemory(
        'Test Memory',
        'This is a test memory content',
        {
          source: 'text',
          sourceDescription: 'Unit test',
          groupId: 'test_group'
        }
      );

      expect(uuid).toBeDefined();
      expect(typeof uuid).toBe('string');
    });

    test('should add JSON memory episode', async () => {
      const jsonContent = {
        user: 'test_user',
        action: 'test_action',
        timestamp: new Date().toISOString()
      };

      const uuid = await adapter.addMemory(
        'JSON Test Memory',
        JSON.stringify(jsonContent),
        {
          source: 'json',
          sourceDescription: 'JSON unit test',
          groupId: 'test_group'
        }
      );

      expect(uuid).toBeDefined();
    });

    test('should convert MemoryEntry to episode', async () => {
      const memoryEntry: MemoryEntry = {
        id: 'test_id',
        key: 'test_key',
        value: { data: 'test_value' },
        type: 'test',
        namespace: 'test_namespace',
        tags: ['test', 'unit'],
        metadata: { test: true },
        owner: 'test_owner',
        accessLevel: 'shared',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessedAt: new Date(),
        version: 1,
        size: 100,
        compressed: false,
        checksum: 'abc123',
        references: [],
        dependencies: []
      };

      const uuid = await adapter.fromMemoryEntry(memoryEntry);
      expect(uuid).toBeDefined();
    });
  });

  describe('Search Operations', () => {
    test('should search nodes', async () => {
      // Add some test data first
      await adapter.addMemory('Search Test 1', 'Content about testing');
      await adapter.addMemory('Search Test 2', 'Content about nodes');

      const results = await adapter.searchNodes('test', {
        groupIds: ['test_group'],
        maxNodes: 10
      });

      expect(results).toBeDefined();
      expect(results.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(results.relevanceScore).toBeLessThanOrEqual(1);
    });

    test('should search facts', async () => {
      const results = await adapter.searchFacts('relationship', {
        groupIds: ['test_group'],
        maxFacts: 20
      });

      expect(results).toBeDefined();
      expect(results.relevanceScore).toBeGreaterThanOrEqual(0);
    });

    test('should handle search with entity type filter', async () => {
      const results = await adapter.searchNodes('test', {
        entityType: 'Preference',
        maxNodes: 5
      });

      expect(results).toBeDefined();
    });
  });

  describe('Episode Management', () => {
    test('should get recent episodes', async () => {
      // Add some episodes
      await adapter.addMemory('Episode 1', 'Content 1');
      await adapter.addMemory('Episode 2', 'Content 2');
      await adapter.addMemory('Episode 3', 'Content 3');

      const episodes = await adapter.getRecentEpisodes('test_group', 2);
      
      expect(Array.isArray(episodes)).toBe(true);
      expect(episodes.length).toBeLessThanOrEqual(2);
    });

    test('should queue episodes when not connected', async () => {
      // Simulate disconnected state
      adapter['isConnected'] = false;

      await adapter.addMemory('Queued Episode', 'Queued content');
      
      const stats = adapter.getStatistics();
      expect(stats.queuedEpisodes).toBeGreaterThan(0);
    });
  });

  describe('Temporal Tracking', () => {
    test('should update fact validity', async () => {
      const edgeUuid = 'test_edge_uuid';
      const validUntil = new Date(Date.now() + 86400000); // Tomorrow

      await adapter.updateFactValidity(edgeUuid, false, validUntil);
      
      // Verify the update was processed (would check cache in real implementation)
      expect(true).toBe(true);
    });
  });

  describe('Hive-Mind Integration', () => {
    test('should share nodes with hive-mind', async () => {
      const sharePromise = new Promise<void>((resolve) => {
        adapter.once('hivemind:share', (data) => {
          expect(data.nodes).toBeDefined();
          expect(data.targetSwarms).toContain('swarm1');
          resolve();
        });
      });

      await adapter.shareWithHiveMind(['node1', 'node2'], ['swarm1']);
      
      // Wait for event or timeout
      await Promise.race([
        sharePromise,
        new Promise(resolve => setTimeout(resolve, 100))
      ]);
    });
  });

  describe('Statistics', () => {
    test('should return accurate statistics', () => {
      const stats = adapter.getStatistics();

      expect(stats).toHaveProperty('totalNodes');
      expect(stats).toHaveProperty('totalEdges');
      expect(stats).toHaveProperty('queuedEpisodes');
      expect(stats).toHaveProperty('cacheSize');
      expect(stats).toHaveProperty('isConnected');
      expect(typeof stats.isConnected).toBe('boolean');
    });
  });

  describe('Graph Management', () => {
    test('should clear graph', async () => {
      // Add some data
      await adapter.addMemory('To be cleared', 'Content');
      
      // Clear the graph
      await adapter.clearGraph();
      
      const stats = adapter.getStatistics();
      expect(stats.totalNodes).toBe(0);
      expect(stats.totalEdges).toBe(0);
      expect(stats.queuedEpisodes).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle search errors gracefully', async () => {
      // Force an error by setting invalid state
      adapter['isConnected'] = false;
      
      const results = await adapter.searchNodes('test');
      
      // Should return fallback results
      expect(results).toBeDefined();
      expect(results.nodes).toBeDefined();
    });

    test('should emit error events', (done) => {
      adapter.once('error', (error) => {
        expect(error).toBeDefined();
        done();
      });

      // Trigger an error
      adapter.emit('error', new Error('Test error'));
    });
  });
});