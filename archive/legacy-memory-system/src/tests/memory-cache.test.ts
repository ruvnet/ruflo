/**
 * SPARC Memory Bank - Cache Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryCache } from '../cache/memory-cache';
import { MemoryItem } from '../types';

describe('MemoryCache', () => {
  let cache: MemoryCache;

  const createTestItem = (key: string, size?: number): MemoryItem => ({
    id: key,
    category: 'test',
    key,
    value: size ? 'x'.repeat(size) : `value-${key}`,
    metadata: { timestamp: Date.now() }
  });

  describe('LRU Cache', () => {
    beforeEach(() => {
      cache = new MemoryCache({
        maxSize: 100,
        ttl: 60000,
        strategy: 'lru'
      });
    });

    it('should evict least recently used items', () => {
      // Fill cache
      cache.set('item1', createTestItem('item1', 30));
      cache.set('item2', createTestItem('item2', 30));
      cache.set('item3', createTestItem('item3', 30));

      // Access item1 and item2
      cache.get('item1');
      cache.get('item2');

      // Add item that exceeds capacity - should evict item3
      cache.set('item4', createTestItem('item4', 30));

      expect(cache.get('item1')).toBeDefined();
      expect(cache.get('item2')).toBeDefined();
      expect(cache.get('item3')).toBeNull();
      expect(cache.get('item4')).toBeDefined();
    });

    it('should update access order on get', () => {
      cache.set('item1', createTestItem('item1', 30));
      cache.set('item2', createTestItem('item2', 30));
      cache.set('item3', createTestItem('item3', 30));

      // Access item1 multiple times
      cache.get('item1');
      cache.get('item1');

      // Add item that triggers eviction
      cache.set('item4', createTestItem('item4', 30));

      // item2 or item3 should be evicted, not item1
      expect(cache.get('item1')).toBeDefined();
    });
  });

  describe('LFU Cache', () => {
    beforeEach(() => {
      cache = new MemoryCache({
        maxSize: 100,
        ttl: 60000,
        strategy: 'lfu'
      });
    });

    it('should evict least frequently used items', () => {
      cache.set('item1', createTestItem('item1', 30));
      cache.set('item2', createTestItem('item2', 30));
      cache.set('item3', createTestItem('item3', 30));

      // Access item1 and item2 multiple times
      cache.get('item1');
      cache.get('item1');
      cache.get('item2');

      // item3 has lowest frequency (1)
      cache.set('item4', createTestItem('item4', 30));

      expect(cache.get('item1')).toBeDefined();
      expect(cache.get('item2')).toBeDefined();
      expect(cache.get('item3')).toBeNull();
      expect(cache.get('item4')).toBeDefined();
    });

    it('should use age as tiebreaker for same frequency', () => {
      cache.set('item1', createTestItem('item1', 30));
      
      // Wait a bit
      vi.advanceTimersByTime(10);
      
      cache.set('item2', createTestItem('item2', 30));
      cache.set('item3', createTestItem('item3', 30));

      // All have same frequency (1)
      // item1 is oldest, should be evicted first
      cache.set('item4', createTestItem('item4', 30));

      expect(cache.get('item1')).toBeNull();
      expect(cache.get('item2')).toBeDefined();
      expect(cache.get('item3')).toBeDefined();
      expect(cache.get('item4')).toBeDefined();
    });
  });

  describe('FIFO Cache', () => {
    beforeEach(() => {
      cache = new MemoryCache({
        maxSize: 100,
        ttl: 60000,
        strategy: 'fifo'
      });
    });

    it('should evict first in, first out', () => {
      cache.set('item1', createTestItem('item1', 30));
      cache.set('item2', createTestItem('item2', 30));
      cache.set('item3', createTestItem('item3', 30));

      // Access doesn't matter for FIFO
      cache.get('item1');
      cache.get('item1');
      cache.get('item1');

      // Should still evict item1 (first in)
      cache.set('item4', createTestItem('item4', 30));

      expect(cache.get('item1')).toBeNull();
      expect(cache.get('item2')).toBeDefined();
      expect(cache.get('item3')).toBeDefined();
      expect(cache.get('item4')).toBeDefined();
    });
  });

  describe('TTL Expiration', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      cache = new MemoryCache({
        maxSize: 1000,
        ttl: 1000, // 1 second
        strategy: 'lru'
      });
    });

    it('should expire items after TTL', () => {
      cache.set('item1', createTestItem('item1'));

      expect(cache.get('item1')).toBeDefined();

      // Advance time past TTL
      vi.advanceTimersByTime(1500);

      expect(cache.get('item1')).toBeNull();
    });

    it('should cleanup expired items periodically', () => {
      cache.set('item1', createTestItem('item1'));
      cache.set('item2', createTestItem('item2'));

      expect(cache.size()).toBe(2);

      // Advance time to trigger cleanup
      vi.advanceTimersByTime(2000);

      // Trigger cleanup by accessing cache
      cache.get('item1');

      expect(cache.size()).toBeLessThan(2);
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      cache = new MemoryCache({
        maxSize: 1000,
        ttl: 60000,
        strategy: 'lru'
      });
    });

    it('should track hits and misses', () => {
      cache.set('item1', createTestItem('item1'));

      // Hit
      cache.get('item1');
      
      // Misses
      cache.get('item2');
      cache.get('item3');

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBeCloseTo(0.333, 2);
    });

    it('should track evictions', () => {
      const smallCache = new MemoryCache({
        maxSize: 50,
        ttl: 60000,
        strategy: 'lru'
      });

      smallCache.set('item1', createTestItem('item1', 30));
      smallCache.set('item2', createTestItem('item2', 30)); // Should evict item1

      const stats = smallCache.getStats();
      expect(stats.evictions).toBe(1);
    });
  });

  describe('Eviction Callback', () => {
    it('should call onEvict callback', () => {
      const onEvict = vi.fn();
      
      cache = new MemoryCache({
        maxSize: 50,
        ttl: 60000,
        strategy: 'lru',
        onEvict
      });

      const item1 = createTestItem('item1', 30);
      cache.set('item1', item1);
      cache.set('item2', createTestItem('item2', 30)); // Should evict item1

      expect(onEvict).toHaveBeenCalledWith('item1', item1);
    });
  });

  describe('Cache Operations', () => {
    beforeEach(() => {
      cache = new MemoryCache({
        maxSize: 1000,
        ttl: 60000,
        strategy: 'lru'
      });
    });

    it('should delete items', () => {
      cache.set('item1', createTestItem('item1'));
      expect(cache.get('item1')).toBeDefined();

      const deleted = cache.delete('item1');
      expect(deleted).toBe(true);
      expect(cache.get('item1')).toBeNull();

      const deletedAgain = cache.delete('item1');
      expect(deletedAgain).toBe(false);
    });

    it('should clear all items', () => {
      cache.set('item1', createTestItem('item1'));
      cache.set('item2', createTestItem('item2'));
      cache.set('item3', createTestItem('item3'));

      expect(cache.size()).toBe(3);

      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.get('item1')).toBeNull();
    });

    it('should return all keys', () => {
      cache.set('item1', createTestItem('item1'));
      cache.set('item2', createTestItem('item2'));
      cache.set('item3', createTestItem('item3'));

      const keys = cache.keys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain('item1');
      expect(keys).toContain('item2');
      expect(keys).toContain('item3');
    });
  });

  describe('Warmup and Snapshot', () => {
    beforeEach(() => {
      cache = new MemoryCache({
        maxSize: 1000,
        ttl: 60000,
        strategy: 'lru'
      });
    });

    it('should warmup cache with preloaded data', async () => {
      const items = [
        { key: 'item1', value: createTestItem('item1') },
        { key: 'item2', value: createTestItem('item2') },
        { key: 'item3', value: createTestItem('item3') }
      ];

      await cache.warmup(items);

      expect(cache.size()).toBe(3);
      expect(cache.get('item1')).toBeDefined();
      expect(cache.get('item2')).toBeDefined();
      expect(cache.get('item3')).toBeDefined();
    });

    it('should create snapshot of cache', () => {
      cache.set('item1', createTestItem('item1'));
      cache.set('item2', createTestItem('item2'));

      const snapshot = cache.snapshot();

      expect(snapshot).toHaveLength(2);
      expect(snapshot.find(s => s.key === 'item1')).toBeDefined();
      expect(snapshot.find(s => s.key === 'item2')).toBeDefined();
    });
  });
});