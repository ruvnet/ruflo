/**
 * Dream Cycle 2026-10-03 — HNSW serialize()/deserialize() dropped
 * quantization state entirely.
 *
 * `HNSWIndex.serialize()` never wrote `config.quantization` (or, for
 * trained product quantization, the learned PQ codebooks) to the wire
 * format. `deserialize()` always reconstructed via
 * `new HNSWIndex({ dimensions, M, efConstruction, metric })` — no
 * `quantization` field — so `this.quantizer` came back `null` after *any*
 * save/reload cycle, regardless of what the index was built with. For
 * trained product quantization this silently re-broke the distance
 * dispatch fixed in #3093/#3094 (2026-08-25): `isProductQuantized()`
 * depends on `this.quantizer !== null`, so a deserialized PQ index fell
 * back to generic cosine/euclidean on raw PQ centroid indices — the exact
 * bug that fix closed, reintroduced on every reload. This matters because
 * `AgentDBAdapter.saveToDisk()`/`loadFromDisk()` call this exact
 * serialize/deserialize pair in production.
 *
 * This test builds a trained-PQ index, measures recall@10 against a brute
 * force unquantized ground truth *before* serialization, then measures it
 * again on the object returned by `HNSWIndex.deserialize(index.serialize())`
 * using the identical corpus/queries. Pre-fix, post-deserialize recall
 * collapses to the same ~0.10 chance-level the already-fixed #3093/#3094
 * bug produced; post-fix it stays at the ~0.27 level the trained-PQ fix
 * established (same ballpark as `hnsw-quantization.test.ts`'s own
 * measured figures, since this is the same dispatch path exercised after a
 * round trip instead of in-process).
 */

import { describe, it, expect } from 'vitest';
import { HNSWIndex } from './hnsw-index.js';

function xorshift32(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function buildClusteredCorpus(n: number, dim: number, numClusters: number, seed: number): Float32Array[] {
  const rand = xorshift32(seed);
  const centers: Float32Array[] = [];
  for (let c = 0; c < numClusters; c++) {
    const center = new Float32Array(dim);
    for (let d = 0; d < dim; d++) center[d] = (rand() - 0.5) * 20;
    centers.push(center);
  }
  const vectors: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const center = centers[i % numClusters];
    const v = new Float32Array(dim);
    for (let d = 0; d < dim; d++) v[d] = center[d] + (rand() - 0.5) * 1.5;
    vectors.push(v);
  }
  return vectors;
}

function bruteForceTopK(query: Float32Array, corpus: Float32Array[], ids: string[], k: number): Set<string> {
  const scored = corpus.map((v, i) => {
    let sum = 0;
    for (let d = 0; d < v.length; d++) {
      const diff = v[d] - query[d];
      sum += diff * diff;
    }
    return { id: ids[i], dist: sum };
  });
  scored.sort((a, b) => a.dist - b.dist);
  return new Set(scored.slice(0, k).map((s) => s.id));
}

async function recallAtK(index: HNSWIndex, corpus: Float32Array[], ids: string[], seed: number, numQueries: number, k: number): Promise<number> {
  const rand = xorshift32(seed);
  let totalRecall = 0;
  for (let q = 0; q < numQueries; q++) {
    const queryIdx = Math.floor(rand() * corpus.length);
    const query = corpus[queryIdx];
    const groundTruth = bruteForceTopK(query, corpus, ids, k);
    const results = await index.search(query, k, 200);
    const returned = new Set(results.map((r) => r.id));
    let hits = 0;
    for (const id of returned) if (groundTruth.has(id)) hits++;
    totalRecall += hits / k;
  }
  return totalRecall / numQueries;
}

describe('HNSWIndex serialize/deserialize — quantization round-trip (Dream Cycle 2026-10-03)', () => {
  const DIM = 64;
  const N = 1500; // well above pqTrainingThreshold=256
  const NUM_CLUSTERS = 8;
  const NUM_QUERIES = 30;
  const K = 10;

  it('product-quantized recall@10 survives a serialize()/deserialize() round trip', async () => {
    const corpus = buildClusteredCorpus(N, DIM, NUM_CLUSTERS, 42);
    const ids = corpus.map((_, i) => `v-${i}`);

    const index = new HNSWIndex({
      dimensions: DIM,
      metric: 'euclidean',
      M: 16,
      efConstruction: 100,
      quantization: { type: 'product', subquantizers: 8, codebookSize: 256 },
    });
    for (let i = 0; i < corpus.length; i++) await index.addPoint(ids[i], corpus[i]);

    const preRecall = await recallAtK(index, corpus, ids, 1337, NUM_QUERIES, K);
    // eslint-disable-next-line no-console
    console.log(`[dream-cycle] pre-serialize recall@10 = ${preRecall.toFixed(3)}`);
    expect(preRecall).toBeGreaterThanOrEqual(0.25); // sanity: matches hnsw-quantization.test.ts's measured floor

    const restored = HNSWIndex.deserialize(index.serialize());
    const postRecall = await recallAtK(restored, corpus, ids, 1337, NUM_QUERIES, K);
    // eslint-disable-next-line no-console
    console.log(`[dream-cycle] post-deserialize recall@10 = ${postRecall.toFixed(3)}`);
    // Pre-fix: quantizer dropped on reload -> isProductQuantized() false ->
    // generic distance on raw PQ centroid indices -> recall collapses to
    // ~0.10 (chance level, same class as the pre-#3093/#3094 measurement).
    // Post-fix: quantizer + trained codebooks restored -> dispatch matches
    // pre-serialize behavior.
    expect(postRecall).toBeGreaterThanOrEqual(0.25);
    expect(Math.abs(postRecall - preRecall)).toBeLessThan(0.05);
  });

  it('restored index exposes the same quantization config and trained codebooks', async () => {
    const corpus = buildClusteredCorpus(N, DIM, NUM_CLUSTERS, 7);
    const index = new HNSWIndex({
      dimensions: DIM,
      metric: 'euclidean',
      quantization: { type: 'product', subquantizers: 8, codebookSize: 256 },
    });
    for (let i = 0; i < corpus.length; i++) await index.addPoint(`v-${i}`, corpus[i]);

    const restored = HNSWIndex.deserialize(index.serialize()) as unknown as {
      quantizer: { getCompressionRatio(): number; isPQTrained: boolean } | null;
    };
    expect(restored.quantizer).not.toBeNull();
    expect(restored.quantizer!.isPQTrained).toBe(true);
    expect(restored.quantizer!.getCompressionRatio()).toBe(8);
  });

  it('non-quantized index round-trip is unaffected (no quantization section regression)', async () => {
    const index = new HNSWIndex({ dimensions: 8, metric: 'cosine' });
    await index.addPoint('a', new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]));
    await index.addPoint('b', new Float32Array([0, 1, 0, 0, 0, 0, 0, 0]));

    const restored = HNSWIndex.deserialize(index.serialize()) as unknown as { quantizer: unknown };
    expect(restored.quantizer).toBeNull();

    const results = await (restored as unknown as HNSWIndex).search(new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]), 2, 50);
    expect(results.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('v1-format buffers (no quantization section) still deserialize, with no quantizer (backward compatibility)', async () => {
    // Hand-build a v1-format buffer for a tiny 2-node, non-quantized,
    // cosine-metric index — the exact wire format serialize() produced
    // before this fix (magic byte 0x01, no quantization section).
    const chunks: Buffer[] = [];
    chunks.push(Buffer.from([0x48, 0x4e, 0x53, 0x57, 0x01])); // v1 magic

    const header = Buffer.alloc(16);
    header.writeUInt32BE(8, 0); // dimensions
    header.writeUInt32BE(16, 4); // M
    header.writeUInt32BE(200, 8); // efConstruction
    header.writeUInt32BE(0, 12); // maxLevel
    chunks.push(header);

    const encodeStr = (s: string): Buffer => {
      const strBuf = Buffer.from(s, 'utf-8');
      const out = Buffer.alloc(4 + strBuf.length);
      out.writeUInt32BE(strBuf.length, 0);
      strBuf.copy(out, 4);
      return out;
    };
    chunks.push(encodeStr('cosine')); // metric
    chunks.push(encodeStr('a')); // entryPoint

    const nodeCountBuf = Buffer.alloc(4);
    nodeCountBuf.writeUInt32BE(1, 0);
    chunks.push(nodeCountBuf);

    // One node "a", level 0, vector [1,0,0,0,0,0,0,0], no normalizedVector, no connections.
    chunks.push(encodeStr('a'));
    const meta = Buffer.alloc(4);
    meta.writeUInt32BE(0, 0); // level
    chunks.push(meta);
    const vec = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);
    const vecLenBuf = Buffer.alloc(4);
    vecLenBuf.writeUInt32BE(vec.length, 0);
    chunks.push(vecLenBuf, Buffer.from(vec.buffer));
    chunks.push(Buffer.from([0])); // no normalizedVector
    const lvlCountBuf = Buffer.alloc(4);
    lvlCountBuf.writeUInt32BE(0, 0); // zero connection levels
    chunks.push(lvlCountBuf);

    const v1Buffer = Buffer.concat(chunks);

    const restored = HNSWIndex.deserialize(v1Buffer) as unknown as { quantizer: unknown };
    expect(restored.quantizer).toBeNull(); // no quantization section in v1 -> no quantizer, same as pre-fix behavior
    const results = await (restored as unknown as HNSWIndex).search(new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]), 1, 50);
    expect(results[0]?.id).toBe('a');
  });
});
