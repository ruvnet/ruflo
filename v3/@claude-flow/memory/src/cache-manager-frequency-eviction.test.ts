/**
 * Discriminating tests for CacheManager's frequency-aware eviction
 * (dream-cycle 2026-11-18, memory surface).
 *
 * HTM-EAR (arXiv:2603.10032, Feb 2026) documents that pure-LRU eviction
 * drops high-access-frequency entries that happen to sit near the LRU tail
 * (because nothing *else* touched them recently), even though they carry
 * far more historical value than their low-frequency neighbors. These tests
 * reproduce exactly that scenario against CacheManager's real eviction path.
 */
import { describe, it, expect } from 'vitest';
import { CacheManager } from './cache-manager.js';

function setupSkewedCache(frequencyWeight?: number): CacheManager<string> {
  const cache = new CacheManager<string>({
    maxSize: 4,
    frequencyWeight,
    evictionScanWindow: 4,
  });

  cache.set('A', 'high-frequency-entry');
  cache.get('A');
  cache.get('A');
  cache.get('A');
  cache.get('A');
  cache.get('A'); // A.accessCount === 5

  // B, C, D are each set and never re-accessed, which — because `set()`
  // moves the new entry to the front — pushes A toward the tail purely
  // through recency decay while its accessCount stays at 5.
  cache.set('B', 'cold-1');
  cache.set('C', 'cold-2');
  cache.set('D', 'cold-3');

  return cache;
}

describe('CacheManager frequency-aware eviction (discriminating)', () => {
  it('pure LRU (frequencyWeight unset) evicts the high-frequency entry once capacity is exceeded', () => {
    const cache = setupSkewedCache(undefined);
    cache.set('E', 'cold-4'); // triggers eviction at maxSize=4

    expect(cache.has('A')).toBe(false); // the valuable entry is gone
    expect(cache.has('B')).toBe(true);
  });

  it('frequencyWeight=1 protects the high-frequency entry, evicting a cold one instead', () => {
    const cache = setupSkewedCache(1);
    cache.set('E', 'cold-4');

    expect(cache.has('A')).toBe(true); // protected despite being LRU-oldest
    expect(cache.has('B')).toBe(false); // a cold, never-reaccessed entry is evicted instead
  });

  it('frequencyWeight=0 explicitly behaves identically to unset (exact pure-LRU passthrough)', () => {
    const cacheUnset = setupSkewedCache(undefined);
    const cacheZero = setupSkewedCache(0);

    cacheUnset.set('E', 'cold-4');
    cacheZero.set('E', 'cold-4');

    expect(cacheZero.has('A')).toBe(cacheUnset.has('A'));
    expect(cacheZero.keys().sort()).toEqual(cacheUnset.keys().sort());
  });

  it('control: with no skew (all entries equally cold), frequencyWeight=1 still evicts the oldest on ties', () => {
    const cache = new CacheManager<string>({ maxSize: 3, frequencyWeight: 1, evictionScanWindow: 3 });
    cache.set('X', '1');
    cache.set('Y', '2');
    cache.set('Z', '3');
    cache.set('W', '4'); // all accessCount === 0 -> tie -> first-scanned (oldest/tail) wins

    expect(cache.has('X')).toBe(false);
    expect(cache.has('Y')).toBe(true);
    expect(cache.has('Z')).toBe(true);
    expect(cache.has('W')).toBe(true);
  });
});
