/**
 * Regression: pattern store and search must use the same backend when the
 * registered `reasoningBank` is the intelligence module's LocalReasoningBank.
 *
 * `@claude-flow/memory` 3.1.0 (#4550) added `ControllerRegistry.set()`, so the
 * memory bridge's post-init wiring now really registers LocalReasoningBank
 * whenever agentdb's own ReasoningBank is not available. LocalReasoningBank
 * has `store()`/`findSimilar()`/`getAll()` but no `storePattern()`, so
 * `bridgeStorePattern` skipped it and wrote to the SQL `pattern` namespace,
 * while `bridgeSearchPatterns` read LocalReasoningBank. A bank that already
 * held other patterns returned those as non-empty `reasoningBank` results, so
 * the pattern just stored was never found (seen on CI as the #2226 test
 * failing in bug-cluster-2219-2226.test.ts).
 */
import { afterAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'ruflo-local-rb-pattern-'));
const db = new Database(join(root, 'memory.db'));

/** Minimal stand-in for LocalReasoningBank: same method surface, in memory. */
function makeLocalBank() {
  const list: Array<{ id: string; type: string; content: string; confidence: number; embedding: number[] }> = [];
  const cos = (a: number[], b: number[]) => {
    if (!a?.length || !b?.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  };
  return {
    flushed: 0,
    store(p: { id: string; type: string; content: string; confidence: number; embedding: number[] }) {
      list.push(p);
      return true;
    },
    findSimilar(q: number[], opts: { k?: number; threshold?: number }) {
      return list
        .map(p => ({ ...p, similarity: cos(q, p.embedding) }))
        .filter(p => p.similarity >= (opts.threshold ?? 0.5))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, opts.k ?? 5);
    },
    getAll() { return list; },
    flushToDisk() { this.flushed++; },
  };
}

afterAll(async () => {
  const { __setMemoryBridgeRegistryForTests } = await import('../src/memory/memory-bridge.js');
  __setMemoryBridgeRegistryForTests(null);
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe('pattern store/search with LocalReasoningBank registered', () => {
  it('finds a stored pattern even when the bank already holds other patterns', async () => {
    const { __setMemoryBridgeRegistryForTests, bridgeStorePattern, bridgeSearchPatterns } = await import(
      '../src/memory/memory-bridge.js'
    );
    const { generateEmbedding } = await import('../src/memory/memory-initializer.js');

    const bank = makeLocalBank();
    // A pattern learned earlier: every query scores against it, which is what
    // hid the stored pattern behind a non-empty result set.
    const prior = await generateEmbedding('prior unrelated routing pattern');
    bank.store({ id: 'prior', type: 'general', content: 'prior unrelated routing pattern', confidence: 0.9, embedding: prior.embedding });

    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: (name: string) => (name === 'reasoningBank' ? bank : null),
    });

    const marker = `local-rb-roundtrip-${process.pid}-${Date.now()}`;
    const stored = await bridgeStorePattern({ pattern: `Use ${marker} for session renewal`, type: 'auth-pattern', confidence: 0.9 });
    expect(stored?.success).toBe(true);
    expect(stored?.controller).toBe('reasoningBank');
    expect(bank.flushed).toBeGreaterThan(0);

    const found = await bridgeSearchPatterns({ query: `Use ${marker} for session renewal`, topK: 5, minConfidence: 0.1 });
    expect(found?.controller).toBe('reasoningBank');
    expect(found?.results.some(r => r.content.includes(marker))).toBe(true);
  });

  it('falls through to the SQL namespace when the bank has no match', async () => {
    const { __setMemoryBridgeRegistryForTests, bridgeStoreEntry, bridgeSearchPatterns } = await import(
      '../src/memory/memory-bridge.js'
    );

    const bank = makeLocalBank();
    // A pattern written to SQL by an earlier fallback-path store.
    __setMemoryBridgeRegistryForTests({ getAgentDB: () => ({ database: db, embedder: null }), get: () => null });
    const marker = `sql-only-pattern-${process.pid}-${Date.now()}`;
    const written = await bridgeStoreEntry({
      key: `pattern-${marker}`,
      value: JSON.stringify({ pattern: `Use ${marker}`, type: 'general', confidence: 0.9 }),
      namespace: 'pattern',
      generateEmbeddingFlag: true,
    });
    expect(written?.success).toBe(true);

    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: (name: string) => (name === 'reasoningBank' ? bank : null),
    });
    const found = await bridgeSearchPatterns({ query: `Use ${marker}`, topK: 5, minConfidence: 0.1 });
    expect(found?.results.some(r => r.content.includes(marker))).toBe(true);
  });
});
