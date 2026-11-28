/**
 * Discriminating tests for CacheManager.clear()'s `cache:cleared` event payload
 * (dream-cycle 2026-11-28, memory surface).
 *
 * `clear()` emptied the cache via `Map.clear()` and only then read
 * `this.cache.size` to report `previousSize` on the `cache:cleared` event —
 * by that point the map is already empty, so `previousSize` was always `0`
 * regardless of how many entries existed before the call. Disclosed in the
 * Dream Cycle ledger four times (2026-10-27, 2026-11-02, 2026-11-16, and
 * reconfirmed independently tonight by two research roles) without ever
 * being fixed. These tests reproduce it directly against the real emitted
 * event.
 */
import { describe, it, expect } from 'vitest';
import { CacheManager } from './cache-manager.js';

describe('CacheManager.clear() cache:cleared event (discriminating)', () => {
  it('reports the actual pre-clear size, not 0, when entries exist', () => {
    const cache = new CacheManager<string>({ maxSize: 10 });
    cache.set('A', 'a');
    cache.set('B', 'b');
    cache.set('C', 'c');

    let emittedPreviousSize: number | undefined;
    cache.once('cache:cleared', (payload: { previousSize: number }) => {
      emittedPreviousSize = payload.previousSize;
    });

    cache.clear();

    expect(emittedPreviousSize).toBe(3);
  });

  it('still reports 0 when the cache was already empty (control)', () => {
    const cache = new CacheManager<string>({ maxSize: 10 });

    let emittedPreviousSize: number | undefined;
    cache.once('cache:cleared', (payload: { previousSize: number }) => {
      emittedPreviousSize = payload.previousSize;
    });

    cache.clear();

    expect(emittedPreviousSize).toBe(0);
  });

  it('empties the cache synchronously regardless of the reported size (control)', () => {
    const cache = new CacheManager<string>({ maxSize: 10 });
    cache.set('A', 'a');
    cache.set('B', 'b');

    cache.clear();

    expect(cache.getStats().size).toBe(0);
    expect(cache.has('A')).toBe(false);
  });
});
