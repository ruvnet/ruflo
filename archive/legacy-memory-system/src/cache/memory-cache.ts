/**
 * SPARC Memory Bank - Cache Implementation
 * High-performance caching with LRU, LFU, and FIFO eviction strategies
 */

import { MemoryItem, CacheConfig } from '../types';

interface CacheEntry {
  key: string;
  value: MemoryItem;
  timestamp: number;
  frequency: number;
  lastAccess: number;
  size: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  currentSize: number;
  maxSize: number;
  itemCount: number;
  hitRate: number;
}

export class MemoryCache {
  private cache: Map<string, CacheEntry> = new Map();
  private accessOrder: string[] = []; // For LRU
  private frequencyMap: Map<number, Set<string>> = new Map(); // For LFU
  private config: CacheConfig;
  private stats: CacheStats;
  private currentSize: number = 0;

  constructor(config: CacheConfig) {
    this.config = config;
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      currentSize: 0,
      maxSize: config.maxSize,
      itemCount: 0,
      hitRate: 0
    };

    // Start TTL cleanup interval
    if (config.ttl > 0) {
      setInterval(() => this.cleanupExpired(), Math.min(config.ttl / 10, 60000));
    }
  }

  /**
   * Get item from cache
   */
  get(key: string): MemoryItem | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    // Check TTL
    if (this.isExpired(entry)) {
      this.delete(key);
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    // Update access tracking
    this.updateAccess(key, entry);
    
    this.stats.hits++;
    this.updateHitRate();
    
    return entry.value;
  }

  /**
   * Set item in cache
   */
  set(key: string, value: MemoryItem): void {
    const size = this.calculateSize(value);
    
    // Check if we need to evict items
    while (this.currentSize + size > this.config.maxSize && this.cache.size > 0) {
      this.evict();
    }

    // Remove existing entry if present
    if (this.cache.has(key)) {
      this.delete(key);
    }

    // Add new entry
    const entry: CacheEntry = {
      key,
      value,
      timestamp: Date.now(),
      frequency: 1,
      lastAccess: Date.now(),
      size
    };

    this.cache.set(key, entry);
    this.currentSize += size;
    this.stats.itemCount++;
    this.stats.currentSize = this.currentSize;

    // Update tracking based on strategy
    if (this.config.strategy === 'lru') {
      this.accessOrder.push(key);
    } else if (this.config.strategy === 'lfu') {
      this.updateFrequency(key, 0, 1);
    }
  }

  /**
   * Delete item from cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    this.cache.delete(key);
    this.currentSize -= entry.size;
    this.stats.itemCount--;
    this.stats.currentSize = this.currentSize;

    // Update tracking
    if (this.config.strategy === 'lru') {
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
    } else if (this.config.strategy === 'lfu') {
      const freqSet = this.frequencyMap.get(entry.frequency);
      if (freqSet) {
        freqSet.delete(key);
        if (freqSet.size === 0) {
          this.frequencyMap.delete(entry.frequency);
        }
      }
    }

    return true;
  }

  /**
   * Clear all items from cache
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.frequencyMap.clear();
    this.currentSize = 0;
    this.stats.itemCount = 0;
    this.stats.currentSize = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get all keys in cache
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Evict items based on strategy
   */
  private evict(): void {
    let keyToEvict: string | undefined;

    switch (this.config.strategy) {
      case 'lru':
        keyToEvict = this.evictLRU();
        break;
      case 'lfu':
        keyToEvict = this.evictLFU();
        break;
      case 'fifo':
        keyToEvict = this.evictFIFO();
        break;
    }

    if (keyToEvict) {
      const entry = this.cache.get(keyToEvict);
      if (entry) {
        if (this.config.onEvict) {
          this.config.onEvict(keyToEvict, entry.value);
        }
        this.delete(keyToEvict);
        this.stats.evictions++;
      }
    }
  }

  /**
   * Evict least recently used item
   */
  private evictLRU(): string | undefined {
    if (this.accessOrder.length === 0) return undefined;
    return this.accessOrder[0];
  }

  /**
   * Evict least frequently used item
   */
  private evictLFU(): string | undefined {
    // Find the minimum frequency
    let minFreq = Number.MAX_SAFE_INTEGER;
    for (const freq of this.frequencyMap.keys()) {
      if (freq < minFreq) {
        minFreq = freq;
      }
    }

    const minFreqSet = this.frequencyMap.get(minFreq);
    if (!minFreqSet || minFreqSet.size === 0) return undefined;

    // Get the oldest item with minimum frequency
    let oldestKey: string | undefined;
    let oldestTime = Number.MAX_SAFE_INTEGER;

    for (const key of minFreqSet) {
      const entry = this.cache.get(key);
      if (entry && entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * Evict first in, first out
   */
  private evictFIFO(): string | undefined {
    let oldestKey: string | undefined;
    let oldestTime = Number.MAX_SAFE_INTEGER;

    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * Update access tracking for an entry
   */
  private updateAccess(key: string, entry: CacheEntry): void {
    entry.lastAccess = Date.now();

    if (this.config.strategy === 'lru') {
      // Move to end of access order
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
      this.accessOrder.push(key);
    } else if (this.config.strategy === 'lfu') {
      // Update frequency
      const oldFreq = entry.frequency;
      entry.frequency++;
      this.updateFrequency(key, oldFreq, entry.frequency);
    }
  }

  /**
   * Update frequency tracking
   */
  private updateFrequency(key: string, oldFreq: number, newFreq: number): void {
    // Remove from old frequency set
    if (oldFreq > 0) {
      const oldSet = this.frequencyMap.get(oldFreq);
      if (oldSet) {
        oldSet.delete(key);
        if (oldSet.size === 0) {
          this.frequencyMap.delete(oldFreq);
        }
      }
    }

    // Add to new frequency set
    if (!this.frequencyMap.has(newFreq)) {
      this.frequencyMap.set(newFreq, new Set());
    }
    this.frequencyMap.get(newFreq)!.add(key);
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    if (this.config.ttl <= 0) return false;
    return Date.now() - entry.timestamp > this.config.ttl;
  }

  /**
   * Clean up expired entries
   */
  private cleanupExpired(): void {
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.delete(key);
    }
  }

  /**
   * Calculate size of a memory item
   */
  private calculateSize(item: MemoryItem): number {
    // Simple size calculation based on JSON string length
    // In production, you might want a more sophisticated approach
    const jsonStr = JSON.stringify(item);
    return jsonStr.length;
  }

  /**
   * Update hit rate statistics
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Warm up cache with preloaded data
   */
  async warmup(items: Array<{ key: string; value: MemoryItem }>): Promise<void> {
    for (const { key, value } of items) {
      this.set(key, value);
    }
  }

  /**
   * Get cache snapshot for persistence
   */
  snapshot(): Array<{ key: string; value: MemoryItem }> {
    const items: Array<{ key: string; value: MemoryItem }> = [];
    
    for (const [key, entry] of this.cache) {
      if (!this.isExpired(entry)) {
        items.push({ key, value: entry.value });
      }
    }

    return items;
  }
}