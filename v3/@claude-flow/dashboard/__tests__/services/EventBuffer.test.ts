/**
 * EventBuffer Tests
 * Tests for circular buffer behavior, max size eviction, and query operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CircularBuffer, EventBuffer } from '../../src/services/EventBuffer';
import type { NormalizedEvent } from '../../src/services/EventAggregator';

describe('CircularBuffer', () => {
  let buffer: CircularBuffer<number>;

  beforeEach(() => {
    buffer = new CircularBuffer<number>({ maxSize: 5 });
  });

  describe('Circular Buffer Behavior', () => {
    it('should add items to buffer', () => {
      buffer.add(1);
      buffer.add(2);
      buffer.add(3);

      expect(buffer.size()).toBe(3);
      expect(buffer.getAll()).toEqual([1, 2, 3]);
    });

    it('should maintain insertion order', () => {
      buffer.add(10);
      buffer.add(20);
      buffer.add(30);
      buffer.add(40);

      expect(buffer.getAll()).toEqual([10, 20, 30, 40]);
    });

    it('should wrap around when reaching capacity', () => {
      for (let i = 1; i <= 7; i++) {
        buffer.add(i);
      }

      expect(buffer.size()).toBe(5);
      expect(buffer.getAll()).toEqual([3, 4, 5, 6, 7]);
    });

    it('should handle multiple wrap-arounds', () => {
      for (let i = 1; i <= 12; i++) {
        buffer.add(i);
      }

      expect(buffer.size()).toBe(5);
      expect(buffer.getAll()).toEqual([8, 9, 10, 11, 12]);
    });
  });

  describe('Max Size Eviction', () => {
    it('should evict oldest item when full', () => {
      buffer.add(1);
      buffer.add(2);
      buffer.add(3);
      buffer.add(4);
      buffer.add(5);
      const evicted = buffer.add(6);

      expect(evicted).toBe(1);
      expect(buffer.size()).toBe(5);
      expect(buffer.getAll()).toEqual([2, 3, 4, 5, 6]);
    });

    it('should return undefined when no eviction', () => {
      const evicted = buffer.add(1);
      expect(evicted).toBeUndefined();
    });

    it('should evict in correct order', () => {
      buffer.add(1);
      buffer.add(2);
      buffer.add(3);
      buffer.add(4);
      buffer.add(5);

      expect(buffer.add(6)).toBe(1);
      expect(buffer.add(7)).toBe(2);
      expect(buffer.add(8)).toBe(3);

      expect(buffer.getAll()).toEqual([4, 5, 6, 7, 8]);
    });

    it('should clear all items', () => {
      buffer.add(1);
      buffer.add(2);
      buffer.clear();

      expect(buffer.size()).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
    });

    it('should handle adding after clear', () => {
      buffer.add(1);
      buffer.add(2);
      buffer.clear();
      buffer.add(10);
      buffer.add(20);

      expect(buffer.getAll()).toEqual([10, 20]);
    });
  });

  describe('getRecent', () => {
    beforeEach(() => {
      buffer.add(1);
      buffer.add(2);
      buffer.add(3);
      buffer.add(4);
      buffer.add(5);
    });

    it('should get recent items (newest first)', () => {
      expect(buffer.getRecent(3)).toEqual([5, 4, 3]);
    });

    it('should return all items if count exceeds size', () => {
      expect(buffer.getRecent(10)).toEqual([5, 4, 3, 2, 1]);
    });

    it('should return empty array for zero count', () => {
      expect(buffer.getRecent(0)).toEqual([]);
    });

    it('should work after wrap-around', () => {
      buffer.add(6);
      buffer.add(7);

      expect(buffer.getRecent(3)).toEqual([7, 6, 5]);
    });
  });

  describe('findFirst', () => {
    beforeEach(() => {
      buffer.add(1);
      buffer.add(2);
      buffer.add(3);
      buffer.add(4);
      buffer.add(5);
    });

    it('should find first item matching predicate', () => {
      const first = buffer.findFirst((n) => n > 2);
      expect(first).toBe(3);
    });

    it('should return undefined when no match', () => {
      expect(buffer.findFirst((n) => n > 10)).toBeUndefined();
    });

    it('should find first even number', () => {
      expect(buffer.findFirst((n) => n % 2 === 0)).toBe(2);
    });
  });

  describe('findLast', () => {
    beforeEach(() => {
      buffer.add(1);
      buffer.add(2);
      buffer.add(3);
      buffer.add(4);
      buffer.add(5);
    });

    it('should find last item matching predicate', () => {
      const last = buffer.findLast((n) => n < 4);
      expect(last).toBe(3);
    });

    it('should return undefined when no match', () => {
      expect(buffer.findLast((n) => n > 10)).toBeUndefined();
    });

    it('should find last even number', () => {
      expect(buffer.findLast((n) => n % 2 === 0)).toBe(4);
    });
  });

  describe('Retrieval', () => {
    beforeEach(() => {
      buffer.add(1);
      buffer.add(2);
      buffer.add(3);
      buffer.add(4);
      buffer.add(5);
    });

    it('should get all items in order', () => {
      expect(buffer.getAll()).toEqual([1, 2, 3, 4, 5]);
    });

    it('should get oldest items', () => {
      expect(buffer.getOldest(3)).toEqual([1, 2, 3]);
    });

    it('should peek at newest item', () => {
      expect(buffer.peekNewest()).toBe(5);
    });

    it('should peek at oldest item', () => {
      expect(buffer.peekOldest()).toBe(1);
    });

    it('should return undefined when peeking empty buffer', () => {
      buffer.clear();
      expect(buffer.peekNewest()).toBeUndefined();
      expect(buffer.peekOldest()).toBeUndefined();
    });
  });

  describe('Query Operations', () => {
    beforeEach(() => {
      buffer.add(1);
      buffer.add(2);
      buffer.add(3);
      buffer.add(4);
      buffer.add(5);
    });

    it('should find items matching predicate', () => {
      const evens = buffer.find((n) => n % 2 === 0);
      expect(evens).toEqual([2, 4]);
    });

    it('should return empty array when no matches', () => {
      const result = buffer.find((n) => n > 100);
      expect(result).toEqual([]);
    });
  });

  describe('Iteration', () => {
    it('should map over all items', () => {
      buffer.add(1);
      buffer.add(2);
      buffer.add(3);

      const doubled = buffer.map((n) => n * 2);
      expect(doubled).toEqual([2, 4, 6]);
    });

    it('should forEach over all items', () => {
      buffer.add(1);
      buffer.add(2);
      buffer.add(3);

      const items: number[] = [];
      buffer.forEach((n) => items.push(n));
      expect(items).toEqual([1, 2, 3]);
    });

    it('should provide index in map callback', () => {
      buffer.add(10);
      buffer.add(20);
      buffer.add(30);

      const indexed = buffer.map((n, i) => `${i}:${n}`);
      expect(indexed).toEqual(['0:10', '1:20', '2:30']);
    });

    it('should convert to array', () => {
      buffer.add(1);
      buffer.add(2);
      expect(buffer.toArray()).toEqual([1, 2]);
    });
  });

  describe('Capacity', () => {
    it('should report correct capacity', () => {
      expect(buffer.capacity()).toBe(5);
    });

    it('should detect when buffer is full', () => {
      expect(buffer.isFull()).toBe(false);

      buffer.add(1);
      buffer.add(2);
      buffer.add(3);
      buffer.add(4);
      buffer.add(5);

      expect(buffer.isFull()).toBe(true);
    });

    it('should detect when buffer is empty', () => {
      expect(buffer.isEmpty()).toBe(true);

      buffer.add(1);
      expect(buffer.isEmpty()).toBe(false);
    });

    it('should remain full after eviction', () => {
      for (let i = 0; i < 5; i++) {
        buffer.add(i);
      }
      expect(buffer.isFull()).toBe(true);

      buffer.add(100);
      expect(buffer.isFull()).toBe(true);
      expect(buffer.size()).toBe(5);
    });
  });

  describe('Edge Cases', () => {
    it('should handle buffer of size 1', () => {
      const smallBuffer = new CircularBuffer<number>({ maxSize: 1 });

      smallBuffer.add(1);
      expect(smallBuffer.getAll()).toEqual([1]);

      const evicted = smallBuffer.add(2);
      expect(evicted).toBe(1);
      expect(smallBuffer.getAll()).toEqual([2]);
    });

    it('should handle large number of operations', () => {
      for (let i = 0; i < 1000; i++) {
        buffer.add(i);
      }

      expect(buffer.size()).toBe(5);
      expect(buffer.getAll()).toEqual([995, 996, 997, 998, 999]);
    });
  });
});

describe('EventBuffer', () => {
  let buffer: EventBuffer;

  const createEvent = (
    id: string,
    type: string,
    timestamp: number,
    channel?: string
  ): NormalizedEvent => ({
    id,
    type,
    payload: {},
    timestamp,
    receivedAt: Date.now(),
    channel,
  });

  beforeEach(() => {
    buffer = new EventBuffer(10);
  });

  describe('Batch Operations', () => {
    it('should add batch of events', () => {
      const events = [
        createEvent('1', 'agent:status', Date.now()),
        createEvent('2', 'task:update', Date.now()),
        createEvent('3', 'message:sent', Date.now()),
      ];

      buffer.addBatch(events);

      expect(buffer.size()).toBe(3);
    });

    it('should return evicted events from batch', () => {
      // Fill buffer first
      for (let i = 0; i < 10; i++) {
        buffer.add(createEvent(`old-${i}`, 'test', Date.now()));
      }

      const newEvents = [
        createEvent('new-1', 'test', Date.now()),
        createEvent('new-2', 'test', Date.now()),
      ];

      const evicted = buffer.addBatch(newEvents);

      expect(evicted.length).toBe(2);
      expect(evicted[0].id).toBe('old-0');
      expect(evicted[1].id).toBe('old-1');
    });

    it('should maintain order in batch add', () => {
      const events = [
        createEvent('1', 'type-a', 1000),
        createEvent('2', 'type-b', 2000),
        createEvent('3', 'type-c', 3000),
      ];

      buffer.addBatch(events);

      const all = buffer.getAll();
      expect(all[0].id).toBe('1');
      expect(all[2].id).toBe('3');
    });
  });

  describe('Type-based Queries', () => {
    beforeEach(() => {
      buffer.add(createEvent('1', 'agent:status', Date.now()));
      buffer.add(createEvent('2', 'task:update', Date.now()));
      buffer.add(createEvent('3', 'agent:status', Date.now()));
      buffer.add(createEvent('4', 'message:sent', Date.now()));
    });

    it('should get events by type', () => {
      const agentEvents = buffer.getByType('agent:status');
      expect(agentEvents.length).toBe(2);
      expect(agentEvents.every((e) => e.type === 'agent:status')).toBe(true);
    });

    it('should get latest event by type', () => {
      const latest = buffer.getLatestByType('agent:status');
      expect(latest?.id).toBe('3');
    });

    it('should return undefined for nonexistent type', () => {
      const latest = buffer.getLatestByType('nonexistent');
      expect(latest).toBeUndefined();
    });

    it('should count events by type', () => {
      expect(buffer.countByType('agent:status')).toBe(2);
      expect(buffer.countByType('task:update')).toBe(1);
      expect(buffer.countByType('nonexistent')).toBe(0);
    });
  });

  describe('Time-based Queries', () => {
    const now = Date.now();

    beforeEach(() => {
      buffer.add(createEvent('1', 'test', now - 5000));
      buffer.add(createEvent('2', 'test', now - 3000));
      buffer.add(createEvent('3', 'test', now - 1000));
      buffer.add(createEvent('4', 'test', now));
    });

    it('should get events by time range', () => {
      const events = buffer.getByTimeRange(now - 4000, now - 2000);
      expect(events.length).toBe(1);
      expect(events[0].id).toBe('2');
    });

    it('should get events from last N milliseconds', () => {
      const recent = buffer.getRecentByTime(2000);
      expect(recent.length).toBe(2);
    });

    it('should return empty array for future time range', () => {
      const events = buffer.getByTimeRange(now + 1000, now + 2000);
      expect(events).toEqual([]);
    });

    it('should handle inclusive time range', () => {
      const events = buffer.getByTimeRange(now - 5000, now);
      expect(events.length).toBe(4);
    });
  });

  describe('Channel-based Queries', () => {
    beforeEach(() => {
      buffer.add(createEvent('1', 'test', Date.now(), 'agents'));
      buffer.add(createEvent('2', 'test', Date.now(), 'tasks'));
      buffer.add(createEvent('3', 'test', Date.now(), 'agents'));
      buffer.add(createEvent('4', 'test', Date.now()));
    });

    it('should get events by channel', () => {
      const agentEvents = buffer.getByChannel('agents');
      expect(agentEvents.length).toBe(2);
    });

    it('should return empty array for nonexistent channel', () => {
      const events = buffer.getByChannel('nonexistent');
      expect(events).toEqual([]);
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      buffer.add({ ...createEvent('1', 'agent:status', 1000), channel: 'agents' });
      buffer.add({ ...createEvent('2', 'task:update', 2000), channel: 'tasks' });
      buffer.add({ ...createEvent('3', 'agent:status', 3000), channel: 'agents' });
    });

    it('should calculate stats', () => {
      const stats = buffer.getStats();

      expect(stats.totalCount).toBe(3);
      expect(stats.byType.get('agent:status')).toBe(2);
      expect(stats.byType.get('task:update')).toBe(1);
      expect(stats.byChannel.get('agents')).toBe(2);
      expect(stats.timeRange?.earliest).toBe(1000);
      expect(stats.timeRange?.latest).toBe(3000);
    });

    it('should return null time range for empty buffer', () => {
      const emptyBuffer = new EventBuffer(10);
      const stats = emptyBuffer.getStats();

      expect(stats.totalCount).toBe(0);
      expect(stats.timeRange).toBeNull();
    });

    it('should handle events without channel', () => {
      const bufferWithNoChannel = new EventBuffer(10);
      bufferWithNoChannel.add(createEvent('1', 'test', Date.now()));

      const stats = bufferWithNoChannel.getStats();
      expect(stats.byChannel.get('default')).toBe(1);
    });
  });

  describe('JSON Export/Import', () => {
    it('should export to JSON', () => {
      buffer.add(createEvent('1', 'test', 1000));
      buffer.add(createEvent('2', 'test', 2000));

      const json = buffer.toJSON();
      const parsed = JSON.parse(json);

      expect(parsed.length).toBe(2);
      expect(parsed[0].id).toBe('1');
      expect(parsed[1].id).toBe('2');
    });

    it('should import from JSON', () => {
      const events = [
        createEvent('1', 'test', 1000),
        createEvent('2', 'test', 2000),
      ];

      buffer.fromJSON(JSON.stringify(events));

      expect(buffer.size()).toBe(2);
      expect(buffer.getAll()[0].id).toBe('1');
    });

    it('should clear existing events on import', () => {
      buffer.add(createEvent('old', 'test', 500));

      const events = [createEvent('new', 'test', 1000)];
      buffer.fromJSON(JSON.stringify(events));

      expect(buffer.size()).toBe(1);
      expect(buffer.getAll()[0].id).toBe('new');
    });

    it('should throw on invalid JSON', () => {
      expect(() => buffer.fromJSON('invalid json')).toThrow();
    });

    it('should export empty buffer as empty array', () => {
      const json = buffer.toJSON();
      expect(JSON.parse(json)).toEqual([]);
    });
  });

  describe('Combined Queries', () => {
    beforeEach(() => {
      buffer.add({ ...createEvent('1', 'agent:status', Date.now() - 5000), channel: 'agents' });
      buffer.add({ ...createEvent('2', 'agent:status', Date.now() - 3000), channel: 'agents' });
      buffer.add({ ...createEvent('3', 'task:update', Date.now() - 1000), channel: 'tasks' });
    });

    it('should get events by type and filter by time', () => {
      const agentEvents = buffer.getByType('agent:status');
      const recentAgent = agentEvents.filter((e) => e.timestamp >= Date.now() - 4000);

      expect(recentAgent.length).toBe(1);
      expect(recentAgent[0].id).toBe('2');
    });

    it('should get events by channel and count by type', () => {
      const agentChannel = buffer.getByChannel('agents');
      const statusEvents = agentChannel.filter((e) => e.type === 'agent:status');

      expect(statusEvents.length).toBe(2);
    });
  });
});
