import { strict as assert } from 'node:assert';
import { it } from 'vitest';
import { SONAManager } from '../src/sona-manager.js';
import type { Pattern } from '../src/types.js';

const vector = (tail: number) => Float32Array.of(...Array(16).fill(1), tail);
const store = (m: SONAManager, name: string, embedding: Float32Array): Pattern =>
  m.storePattern({ name, embedding, domain: 'test', strategy: name, successRate: 1,
    usageCount: 0, qualityHistory: [], evolutionHistory: [] });

it('distinguishes full query vectors, including in-place edits and same rounded prefix', async () => {
  const m = new SONAManager('balanced');
  await m.initialize();
  const q = vector(1);
  const a = store(m, 'a', vector(1));
  const b = store(m, 'b', vector(-1));
  assert.equal((await m.findSimilarPatterns(q, 1))[0].pattern, a);
  q[16] = -1;
  assert.equal((await m.findSimilarPatterns(q, 1))[0].pattern, b);
  await m.cleanup();
});

it('sees inserts, live confidence and edits through returned pattern references', async () => {
  const m = new SONAManager('balanced');
  await m.initialize();
  const q = vector(1);
  const a = store(m, 'a', vector(-1));
  await m.findSimilarPatterns(q, 1);
  const b = store(m, 'b', vector(1));
  assert.equal((await m.findSimilarPatterns(q, 1))[0].pattern, b);
  m.updatePatternUsage(b.patternId, 0.25);
  assert.equal((await m.findSimilarPatterns(q, 1))[0].confidence.toFixed(6), '0.250000');
  // Mutate the *nonwinner*; checking only the cached matches misses this case.
  a.embedding.set(q);
  b.embedding[16] = -1;
  assert.equal((await m.findSimilarPatterns(q, 1))[0].pattern, a);
  await m.cleanup();
});

it('keeps managers isolated and applies stable ordering when k changes', async () => {
  const x = new SONAManager('balanced'), y = new SONAManager('balanced');
  await x.initialize(); await y.initialize();
  const q = vector(0), a = store(x, 'a', q), b = store(x, 'b', q), c = store(y, 'c', q);
  assert.deepEqual((await x.findSimilarPatterns(q, 2)).map(v => v.pattern), [a, b]);
  assert.equal((await y.findSimilarPatterns(q, 1))[0].pattern, c);
  assert.equal((await x.findSimilarPatterns(q, 1))[0].pattern, a);
  await x.cleanup(); await y.cleanup();
});

it('matches stable exhaustive order for small and large k, ties, zero and negative scores', async () => {
  const m = new SONAManager('balanced');
  const scores = [-1, 0, 1, -1, 1, 0, 0, 1, 1, -1, 0, 1];
  const entries = scores.map((s, i) => store(m, String(i), Float32Array.of(s)));
  const ordered = entries.slice().sort((a, b) => b.embedding[0] - a.embedding[0]);
  for (const k of [0, 1, 2, 3, 8, 9, 15, -1]) {
    const matches = await m.findSimilarPatterns(Float32Array.of(1), k);
    assert.deepEqual(matches.map(v => v.pattern), ordered.slice(0, k));
  }
  // A non-finite cosine comparator falls back to the native full sort.
  entries[3].embedding[0] = Infinity;
  const mixed = entries.slice().sort((a,b) => {
    const score = (p: Pattern) => Number.isFinite(p.embedding[0]) ? p.embedding[0] : NaN;
    return score(b) - score(a);
  });
  assert.deepEqual((await m.findSimilarPatterns(Float32Array.of(1), 3)).map(v => v.pattern), mixed.slice(0, 3));
  await m.cleanup();
});
