/**
 * Event Buffer
 * Circular buffer for storing events with auto-eviction
 */

import type { NormalizedEvent } from './EventAggregator';

export interface CircularBufferConfig {
  maxSize: number;
}

/**
 * Generic Circular Buffer implementation
 */
export class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private tail = 0;
  private count = 0;
  private readonly maxSize: number;

  constructor(config: CircularBufferConfig) {
    this.maxSize = config.maxSize;
    this.buffer = new Array(config.maxSize);
  }

  /**
   * Add an item to the buffer
   * Auto-evicts oldest item if buffer is full
   */
  add(item: T): T | undefined {
    let evicted: T | undefined;

    if (this.count === this.maxSize) {
      // Buffer is full - evict oldest item
      evicted = this.buffer[this.head];
      this.head = (this.head + 1) % this.maxSize;
    } else {
      this.count++;
    }

    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.maxSize;

    return evicted;
  }

  /**
   * Get all items in order (oldest to newest)
   */
  getAll(): T[] {
    const result: T[] = [];

    for (let i = 0; i < this.count; i++) {
      const index = (this.head + i) % this.maxSize;
      const item = this.buffer[index];
      if (item !== undefined) {
        result.push(item);
      }
    }

    return result;
  }

  /**
   * Get the most recent N items (newest first)
   */
  getRecent(count: number): T[] {
    const actualCount = Math.min(count, this.count);
    const result: T[] = [];

    for (let i = 0; i < actualCount; i++) {
      const index = (this.tail - 1 - i + this.maxSize) % this.maxSize;
      const item = this.buffer[index];
      if (item !== undefined) {
        result.push(item);
      }
    }

    return result;
  }

  /**
   * Get the oldest N items (oldest first)
   */
  getOldest(count: number): T[] {
    const actualCount = Math.min(count, this.count);
    const result: T[] = [];

    for (let i = 0; i < actualCount; i++) {
      const index = (this.head + i) % this.maxSize;
      const item = this.buffer[index];
      if (item !== undefined) {
        result.push(item);
      }
    }

    return result;
  }

  /**
   * Peek at the most recent item without removing it
   */
  peekNewest(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    return this.buffer[(this.tail - 1 + this.maxSize) % this.maxSize];
  }

  /**
   * Peek at the oldest item without removing it
   */
  peekOldest(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    return this.buffer[this.head];
  }

  /**
   * Clear all items from the buffer
   */
  clear(): void {
    this.buffer = new Array(this.maxSize);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  /**
   * Get current number of items in buffer
   */
  size(): number {
    return this.count;
  }

  /**
   * Check if buffer is empty
   */
  isEmpty(): boolean {
    return this.count === 0;
  }

  /**
   * Check if buffer is full
   */
  isFull(): boolean {
    return this.count === this.maxSize;
  }

  /**
   * Get the maximum capacity
   */
  capacity(): number {
    return this.maxSize;
  }

  /**
   * Find items matching a predicate
   */
  find(predicate: (item: T) => boolean): T[] {
    return this.getAll().filter(predicate);
  }

  /**
   * Find the first item matching a predicate
   */
  findFirst(predicate: (item: T) => boolean): T | undefined {
    for (let i = 0; i < this.count; i++) {
      const index = (this.head + i) % this.maxSize;
      const item = this.buffer[index];
      if (item !== undefined && predicate(item)) {
        return item;
      }
    }
    return undefined;
  }

  /**
   * Find the last item matching a predicate
   */
  findLast(predicate: (item: T) => boolean): T | undefined {
    for (let i = this.count - 1; i >= 0; i--) {
      const index = (this.head + i) % this.maxSize;
      const item = this.buffer[index];
      if (item !== undefined && predicate(item)) {
        return item;
      }
    }
    return undefined;
  }

  /**
   * Map over all items
   */
  map<U>(fn: (item: T, index: number) => U): U[] {
    const result: U[] = [];

    for (let i = 0; i < this.count; i++) {
      const index = (this.head + i) % this.maxSize;
      const item = this.buffer[index];
      if (item !== undefined) {
        result.push(fn(item, i));
      }
    }

    return result;
  }

  /**
   * Iterate over all items
   */
  forEach(fn: (item: T, index: number) => void): void {
    for (let i = 0; i < this.count; i++) {
      const index = (this.head + i) % this.maxSize;
      const item = this.buffer[index];
      if (item !== undefined) {
        fn(item, i);
      }
    }
  }

  /**
   * Convert to array (alias for getAll)
   */
  toArray(): T[] {
    return this.getAll();
  }
}

/**
 * Specialized Event Buffer with additional event-specific methods
 */
export class EventBuffer extends CircularBuffer<NormalizedEvent> {
  constructor(maxSize = 1000) {
    super({ maxSize });
  }

  /**
   * Add multiple events at once
   */
  addBatch(events: NormalizedEvent[]): NormalizedEvent[] {
    const evicted: NormalizedEvent[] = [];

    for (const event of events) {
      const removed = this.add(event);
      if (removed) {
        evicted.push(removed);
      }
    }

    return evicted;
  }

  /**
   * Get events by type
   */
  getByType(type: string): NormalizedEvent[] {
    return this.find(event => event.type === type);
  }

  /**
   * Get events by channel
   */
  getByChannel(channel: string): NormalizedEvent[] {
    return this.find(event => event.channel === channel);
  }

  /**
   * Get events within a time range
   */
  getByTimeRange(startTime: number, endTime: number): NormalizedEvent[] {
    return this.find(
      event => event.timestamp >= startTime && event.timestamp <= endTime
    );
  }

  /**
   * Get events from the last N milliseconds
   */
  getRecentByTime(milliseconds: number): NormalizedEvent[] {
    const cutoff = Date.now() - milliseconds;
    return this.find(event => event.timestamp >= cutoff);
  }

  /**
   * Get the latest event of a specific type
   */
  getLatestByType(type: string): NormalizedEvent | undefined {
    return this.findLast(event => event.type === type);
  }

  /**
   * Count events by type
   */
  countByType(type: string): number {
    return this.getByType(type).length;
  }

  /**
   * Get event statistics
   */
  getStats(): {
    totalCount: number;
    byType: Map<string, number>;
    byChannel: Map<string, number>;
    timeRange: { earliest: number; latest: number } | null;
  } {
    const events = this.getAll();
    const byType = new Map<string, number>();
    const byChannel = new Map<string, number>();

    let earliest = Infinity;
    let latest = -Infinity;

    for (const event of events) {
      // Count by type
      byType.set(event.type, (byType.get(event.type) ?? 0) + 1);

      // Count by channel
      const channel = event.channel ?? 'default';
      byChannel.set(channel, (byChannel.get(channel) ?? 0) + 1);

      // Track time range
      if (event.timestamp < earliest) earliest = event.timestamp;
      if (event.timestamp > latest) latest = event.timestamp;
    }

    return {
      totalCount: events.length,
      byType,
      byChannel,
      timeRange: events.length > 0 ? { earliest, latest } : null,
    };
  }

  /**
   * Export all events as JSON
   */
  toJSON(): string {
    return JSON.stringify(this.getAll());
  }

  /**
   * Import events from JSON
   */
  fromJSON(json: string): void {
    try {
      const events = JSON.parse(json) as NormalizedEvent[];
      this.clear();
      this.addBatch(events);
    } catch (error) {
      console.error('Failed to import events from JSON:', error);
      throw error;
    }
  }
}
