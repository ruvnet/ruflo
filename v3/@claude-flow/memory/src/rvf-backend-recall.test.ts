/**
 * RvfBackend search quality — recall@10 against exact search, through the
 * real RvfBackend.search() path.
 *
 * The backend's previous inlined `HnswLite` seeded its search from the first
 * `efConstruction` vectors in insertion order and had no recall guarantee
 * (recall@10 = 0.09 on 5k random 384-dim vectors). It now delegates to the
 * canonical HNSWIndex (ADR-125), with an exact scan for small indexes.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RvfBackend } from './rvf-backend.js';
import { createDefaultEntry, type MemoryEntry } from './types.js';

const DIM = 64;
const K = 10;

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

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s;
}

function exactTopK(data: Float32Array[], q: Float32Array, k: number): string[] {
  return data.map((v, i) => [i, dot(q, v)] as const)
    .sort((a, b) => b[1] - a[1]).slice(0, k).map(([i]) => `v${i}`);
}

function entry(i: number, embedding: Float32Array): MemoryEntry {
  const e = createDefaultEntry({ key: `k${i}`, content: `c${i}`, namespace: 'recall' });
  return { ...e, id: `v${i}`, embedding };
}

async function recallAt10(backend: RvfBackend, data: Float32Array[], queries: Float32Array[]): Promise<number> {
  let hits = 0;
  for (const q of queries) {
    const truth = new Set(exactTopK(data, q, K));
    const got = await backend.search(q, { k: K });
    hits += got.filter(r => truth.has(r.entry.id)).length;
  }
  return hits / (queries.length * K);
}

describe('RvfBackend recall', () => {
  it('reaches recall@10 >= 0.9 on 2,000 random unit vectors (graph path)', async () => {
    const data = unitVectors(2000, 7);
    const queries = unitVectors(50, 99);
    const backend = new RvfBackend({ databasePath: ':memory:', dimensions: DIM, autoPersistInterval: 0 });
    await backend.initialize();
    for (let i = 0; i < data.length; i++) await backend.store(entry(i, data[i]));

    const recall = await recallAt10(backend, data, queries);
    expect(recall).toBeGreaterThanOrEqual(0.9);
    await backend.shutdown();
  }, 20_000);

  it('is exact for small indexes', async () => {
    const data = unitVectors(300, 3);
    const queries = unitVectors(20, 4);
    const backend = new RvfBackend({ databasePath: ':memory:', dimensions: DIM, autoPersistInterval: 0 });
    await backend.initialize();
    for (let i = 0; i < data.length; i++) await backend.store(entry(i, data[i]));
    expect(await recallAt10(backend, data, queries)).toBe(1);
    await backend.shutdown();
  });

  it('never returns deleted ids and re-indexes a re-stored embedding', async () => {
    const data = unitVectors(1500, 11);
    const backend = new RvfBackend({ databasePath: ':memory:', dimensions: DIM, autoPersistInterval: 0 });
    await backend.initialize();
    for (let i = 0; i < data.length; i++) await backend.store(entry(i, data[i]));

    // Delete every 3rd entry, then query each deleted vector directly.
    const deleted = new Set<string>();
    for (let i = 0; i < data.length; i += 3) { await backend.delete(`v${i}`); deleted.add(`v${i}`); }
    for (let i = 0; i < data.length; i += 30) {
      const got = await backend.search(data[i], { k: K });
      expect(got.length).toBe(K);
      for (const r of got) expect(deleted.has(r.entry.id)).toBe(false);
    }

    // Move v1 onto v2's vector: v1 must now be found at the new location
    // (as a top-2 hit for v2's vector) and no longer be the hit for its old one.
    const moved = Float32Array.from(data[2]);
    await backend.store(entry(1, moved));
    const atNew = (await backend.search(data[2], { k: 2 })).map(r => r.entry.id);
    expect(atNew).toContain('v1');
    const atOld = await backend.search(data[1], { k: 1 });
    expect(atOld[0]?.entry.id).not.toBe('v1');
    await backend.shutdown();
  }, 20_000);

  it('rebuilds a searchable index when the snapshot is reopened', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-mem-rvf-recall-'));
    const dbPath = path.join(dir, 'memory.rvf');
    try {
      const data = unitVectors(1200, 21);
      const queries = unitVectors(30, 22);
      const first = new RvfBackend({ databasePath: dbPath, dimensions: DIM, autoPersistInterval: 0 });
      await first.initialize();
      for (let i = 0; i < data.length; i++) await first.store(entry(i, data[i]));
      await first.shutdown();

      const second = new RvfBackend({ databasePath: dbPath, dimensions: DIM, autoPersistInterval: 0 });
      await second.initialize();
      expect(await recallAt10(second, data, queries)).toBeGreaterThanOrEqual(0.9);
      await second.shutdown();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
