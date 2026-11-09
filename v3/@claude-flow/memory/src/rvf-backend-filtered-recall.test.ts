/**
 * RvfBackend under selective filters: recall@10 against exact filtered search.
 *
 * search() used to fetch k*2 from the HNSW graph and then drop entries that
 * failed the namespace/tags/type filters, and query({type:'semantic'})
 * intersected a fixed top-`limit` with the filter. With a filter matching 1%
 * of entries both returned almost nothing (recall@10 0.02 here). Both now
 * rank the filtered candidates: exactly when the candidate set is small,
 * otherwise by widening the HNSW fetch until k candidates are found.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RvfBackend } from './rvf-backend.js';
import { createDefaultEntry, type MemoryEntry, type MemoryQuery } from './types.js';

const DIM = 64;
const K = 10;
const N = 3000;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function unitVectors(count: number, seed: number): Float32Array[] {
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
  return Array.from({ length: count }, () => {
    const v = Float32Array.from({ length: DIM }, gauss);
    let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n);
    for (let i = 0; i < DIM; i++) v[i] /= n;
    return v;
  });
}

const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** 1% "rare" namespace, 35% tagged "hot", the rest plain. */
const namespaceOf = (i: number) => (i % 100 === 0 ? 'rare' : 'common');
const tagsOf = (i: number) => (i % 20 < 7 ? ['hot'] : []);

describe('RvfBackend filtered recall', () => {
  const data = unitVectors(N, 21);
  const queries = unitVectors(25, 77);
  let backend: RvfBackend;

  beforeAll(async () => {
    backend = new RvfBackend({ databasePath: ':memory:', dimensions: DIM, autoPersistInterval: 0 });
    await backend.initialize();
    for (let i = 0; i < N; i++) {
      const e: MemoryEntry = {
        ...createDefaultEntry({ key: `k${i}`, content: `c${i}`, namespace: namespaceOf(i), tags: tagsOf(i) }),
        id: `v${i}`,
        embedding: data[i],
      };
      await backend.store(e);
    }
  }, 60_000);

  afterAll(async () => { await backend.shutdown(); });

  const truth = (q: Float32Array, keep: (i: number) => boolean) =>
    new Set(data.map((v, i) => [i, dot(q, v)] as const).filter(([i]) => keep(i))
      .sort((a, b) => b[1] - a[1]).slice(0, K).map(([i]) => `v${i}`));

  it('search(): 1% namespace filter returns k results with recall@10 = 1', async () => {
    let hits = 0, returned = 0;
    for (const q of queries) {
      const t = truth(q, i => namespaceOf(i) === 'rare');
      const got = await backend.search(q, { k: K, filters: { namespace: 'rare' } as MemoryQuery });
      returned += got.length;
      hits += got.filter(r => t.has(r.entry.id)).length;
      expect(got.every(r => r.entry.namespace === 'rare')).toBe(true);
    }
    expect(returned).toBe(queries.length * K);
    expect(hits / (queries.length * K)).toBe(1);
  });

  it('search(): 35% tag filter (graph path) returns k results with recall@10 >= 0.9', async () => {
    let hits = 0, returned = 0;
    for (const q of queries) {
      const t = truth(q, i => tagsOf(i).includes('hot'));
      const got = await backend.search(q, { k: K, filters: { tags: ['hot'] } as MemoryQuery });
      returned += got.length;
      hits += got.filter(r => t.has(r.entry.id)).length;
      expect(got.every(r => r.entry.tags.includes('hot'))).toBe(true);
    }
    expect(returned).toBe(queries.length * K);
    expect(hits / (queries.length * K)).toBeGreaterThanOrEqual(0.9);
  });

  it('query({type: semantic}) with a selective namespace returns `limit` hits ranked by similarity', async () => {
    let hits = 0;
    for (const q of queries) {
      const t = truth(q, i => namespaceOf(i) === 'rare');
      const got = await backend.query({ type: 'semantic', embedding: q, namespace: 'rare', limit: K });
      expect(got).toHaveLength(K);
      hits += got.filter(e => t.has(e.id)).length;
      const scores = got.map(e => dot(q, e.embedding!));
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
    expect(hits / (queries.length * K)).toBe(1);
  });
});
