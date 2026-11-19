/**
 * #4481 — CacheManager charges each entry's size once, at write time, and
 * refunds that same number on overwrite, delete and eviction instead of
 * re-serializing the value being removed.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { CacheManager } from './cache-manager.js';

const caches: CacheManager<any>[] = [];
afterEach(() => {
  for (const cache of caches.splice(0)) cache.shutdown();
});
function create<T>(config: { maxMemory?: number; maxSize?: number } = {}): CacheManager<T> {
  const cache = new CacheManager<T>(config);
  caches.push(cache as CacheManager<any>);
  return cache;
}
const sizeOf = (v: unknown) => JSON.stringify(v).length * 2;

/** A value whose serialization is counted. */
function counted(payload: string) {
  const value = { payload, serialized: 0, toJSON() { value.serialized++; return { payload: value.payload }; } };
  return value;
}

describe('CacheManager size accounting (#4481)', () => {
  it('stays exact across set, overwrite, delete and eviction', () => {
    const cache = create<string>({ maxMemory: 64 });
    cache.set('a', 'aaaa');                                   // 12
    cache.set('b', 'bbbbbb');                                 // 16
    expect(cache.getStats().memoryUsage).toBe(sizeOf('aaaa') + sizeOf('bbbbbb'));
    cache.set('a', 'aaaaaaaaaa');                             // overwrite: 12 -> 24
    expect(cache.getStats().memoryUsage).toBe(sizeOf('aaaaaaaaaa') + sizeOf('bbbbbb'));
    cache.set('c', 'cccccccccccccc');                         // 32, evicts LRU 'b'
    expect(cache.get('b')).toBeNull();
    expect(cache.getStats().memoryUsage).toBe(sizeOf('aaaaaaaaaa') + sizeOf('cccccccccccccc'));
    cache.delete('a');
    cache.delete('c');
    expect(cache.getStats().memoryUsage).toBe(0);
  });

  it('refunds the charged size even if the cached object was mutated since', () => {
    const cache = create<{ items: string[] }>({ maxMemory: 10_000 });
    const value = { items: ['x'] };
    cache.set('k', value);
    value.items.push('a much longer item that grows the serialized form');
    cache.delete('k');
    expect(cache.getStats().memoryUsage).toBe(0);
  });

  it('serializes a value once, when it is written, not again when it is removed', () => {
    const cache = create<ReturnType<typeof counted>>({ maxSize: 1 });
    const first = counted('one');
    cache.set('a', first);
    expect(first.serialized).toBe(1);
    cache.set('a', counted('two'));           // overwrite refunds first without re-serializing
    expect(first.serialized).toBe(1);
    const second = cache.get('a')!;
    cache.set('b', counted('three'));         // maxSize eviction of 'a'
    expect(second.serialized).toBe(1);
    const third = cache.get('b')!;
    cache.delete('b');
    expect(third.serialized).toBe(1);
    expect(cache.getStats().memoryUsage).toBe(0);
  });
});
