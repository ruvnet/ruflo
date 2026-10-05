/**
 * mmrRerank incremental running-max similarity cache (Dream Cycle 2026-10-05).
 *
 * `mmrRerank`'s outer loop picks the next item to add to `selected` by, for
 * every remaining candidate, scanning the *entire* `selected` set so far to
 * find the max similarity-to-selected. Across all `limit` outer rounds that
 * is O(limit^2 x N) pairSimilarity calls in the worst case (the same shape
 * Dream Cycle research confirmed in LangChain core's
 * `maximal_marginal_relevance` and Elastic's published reference MMR
 * implementation — both verified via direct source inspection to recompute
 * from scratch every round).
 *
 * The fix caches each remaining candidate's running max-similarity-to-
 * selected and, each round, only folds in a single new comparison against
 * the just-added item — mathematically exact (not an approximation),
 * because `max` over a growing set equals `max(running_max, sim(newest))`
 * regardless of sign (confirmed by Dream Cycle research against the
 * Carbonell & Goldstein 1998 MMR formula this code implements) — reducing
 * total similarity computations to O(limit x N).
 *
 * NOTE on methodology: an earlier draft of this test tried to prove the
 * call-count reduction by `vi.spyOn`-ing the exported `cosineSimilarity`
 * and counting invocations from `applyMMR`. That does not work under
 * Vitest's SSR transform — `pairSimilarity`'s call to `cosineSimilarity`
 * is a same-module self-reference, not a call through the exported
 * namespace object, so the spy silently observes 0 calls regardless of
 * the real algorithm (only cross-module calls, like this test file's own
 * `baselineMmrRerank` calling `smartRetrieval.cosineSimilarity`
 * explicitly, are interceptable). Discovered via a throwaway debug test
 * that intentionally asserted a scaling property and got "Infinity is not
 * greater than Infinity" — i.e. 0 candidate calls at every corpus size.
 * Rather than instrument production code just to make a spy work, this
 * file proves the complexity change the honest way: measured wall-clock
 * time at increasing corpus sizes, asserting the *speedup ratio itself
 * grows* with N — a constant-factor win would hold the ratio flat; an
 * O(limit^2) vs O(limit) win makes the ratio grow with N.
 */
import { describe, it, expect } from 'vitest';
import * as smartRetrieval from './smart-retrieval.js';
import { applyMMR, type SearchCandidate } from './smart-retrieval.js';

function makeCandidate(id: string, content: string, score: number, embedding?: number[]): SearchCandidate {
  return { id, key: id, content, score, namespace: 'test', embedding };
}

/** Deterministic pseudo-embedding, 384-dim to match this repo's production embedding size
 *  (ADR-era all-MiniLM-L6-v2 convention), range [-1,1) so some pairs are anti-correlated. */
function seededEmbedding(seed: number, dim = 384): number[] {
  const out: number[] = [];
  let x = seed * 2654435761;
  for (let i = 0; i < dim; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out.push(((x % 2000) - 1000) / 1000);
  }
  return out;
}

function corpus(n: number, dim = 384): SearchCandidate[] {
  return Array.from({ length: n }, (_, i) =>
    makeCandidate(`c${i}`, `item number ${i}`, 1 - i / n, seededEmbedding(i, dim))
  );
}

/**
 * Frozen copy of the pre-candidate `mmrRerank`: for every remaining
 * candidate, on every outer round, rescans the *entire* selected set from
 * scratch via `smartRetrieval.cosineSimilarity` (all candidates here carry
 * embeddings, so the Jaccard fallback never triggers). Used only as a
 * correctness/timing baseline — never modified after being frozen here.
 */
function baselineMmrRerank(
  scored: Array<{ candidate: SearchCandidate; score: number }>,
  lambda: number,
  limit: number
): Array<{ candidate: SearchCandidate; score: number }> {
  if (scored.length <= 1) return scored.slice(0, limit);

  const selected: typeof scored = [];
  const remaining = [...scored];
  const selectedEmbeddings: number[][] = [];

  const first = remaining.shift()!;
  selected.push(first);
  selectedEmbeddings.push(first.candidate.embedding!);

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = -1;
    let bestMmr = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      let maxOverlap = 0;
      for (let j = 0; j < selectedEmbeddings.length; j++) {
        const sim = smartRetrieval.cosineSimilarity(cand.candidate.embedding!, selectedEmbeddings[j]);
        if (sim > maxOverlap) maxOverlap = sim;
      }
      const mmr = lambda * cand.score - (1 - lambda) * maxOverlap;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const [chosen] = remaining.splice(bestIdx, 1);
    selected.push(chosen);
    selectedEmbeddings.push(chosen.candidate.embedding!);
  }
  return selected;
}

describe('mmrRerank incremental running-max cache — correctness parity', () => {
  it('byte-identical selection to the frozen recompute-from-scratch baseline (negative-cosine pairs included)', () => {
    const cands = corpus(40, 16);
    const scored = cands.map((c) => ({ candidate: c, score: c.score }));

    const baseline = baselineMmrRerank(scored, 0.7, 25);
    const candidate = applyMMR(scored, 0.7, 25);

    expect(candidate.map((s) => s.candidate.id)).toEqual(baseline.map((s) => s.candidate.id));
    expect(candidate.map((s) => s.score)).toEqual(baseline.map((s) => s.score));
  });

  it('byte-identical at lambda extremes (pure relevance, pure diversity)', () => {
    const cands = corpus(30, 16);
    const scored = cands.map((c) => ({ candidate: c, score: c.score }));
    for (const lambda of [0, 1]) {
      const baseline = baselineMmrRerank(scored, lambda, 18);
      const candidate = applyMMR(scored, lambda, 18);
      expect(candidate.map((s) => s.candidate.id)).toEqual(baseline.map((s) => s.candidate.id));
    }
  });

  it('byte-identical for a small corpus (limit > scored.length edge case)', () => {
    const cands = corpus(5, 16);
    const scored = cands.map((c) => ({ candidate: c, score: c.score }));
    const baseline = baselineMmrRerank(scored, 0.5, 10);
    const candidate = applyMMR(scored, 0.5, 10);
    expect(candidate.map((s) => s.candidate.id)).toEqual(baseline.map((s) => s.candidate.id));
  });
});

describe('mmrRerank incremental running-max cache — measured wall-clock scaling', () => {
  function meanMs(fn: () => void, runs: number): number {
    for (let i = 0; i < 3; i++) fn(); // warmup
    let total = 0;
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      fn();
      total += performance.now() - t0;
    }
    return total / runs;
  }

  function speedupAt(n: number, limit: number): number {
    const cands = corpus(n);
    const scored = cands.map((c) => ({ candidate: c, score: c.score }));
    const baselineMean = meanMs(() => baselineMmrRerank(scored.map((s) => ({ ...s })), 0.7, limit), 5);
    const candidateMean = meanMs(() => applyMMR(scored.map((s) => ({ ...s })), 0.7, limit), 5);
    return baselineMean / candidateMean;
  }

  it('speedup ratio grows with corpus size — demonstrates O(limit^2 x N) vs O(limit x N), not a flat constant-factor win', () => {
    const small = speedupAt(40, 25);
    const large = speedupAt(300, 150);

    // eslint-disable-next-line no-console
    console.log(`[mmr-rerank-complexity] speedup N=40/limit=25: ${small.toFixed(2)}x, N=300/limit=150: ${large.toFixed(2)}x`);

    expect(small).toBeGreaterThan(1); // candidate is faster even at small N
    expect(large).toBeGreaterThan(small * 2); // and the gap widens substantially as N/limit grow
  });

  it('absolute latency at a realistic corpus size (N=200, limit=100, 384-dim embeddings)', () => {
    const baselineMean = (() => {
      const cands = corpus(200);
      const scored = cands.map((c) => ({ candidate: c, score: c.score }));
      return meanMs(() => baselineMmrRerank(scored.map((s) => ({ ...s })), 0.7, 100), 5);
    })();
    const candidateMean = (() => {
      const cands = corpus(200);
      const scored = cands.map((c) => ({ candidate: c, score: c.score }));
      return meanMs(() => applyMMR(scored.map((s) => ({ ...s })), 0.7, 100), 5);
    })();

    // eslint-disable-next-line no-console
    console.log(
      `[mmr-rerank-complexity] N=200,limit=100: baseline=${baselineMean.toFixed(3)}ms candidate=${candidateMean.toFixed(3)}ms speedup=${(baselineMean / candidateMean).toFixed(2)}x`
    );

    expect(candidateMean).toBeLessThan(baselineMean / 5);
  });
});
