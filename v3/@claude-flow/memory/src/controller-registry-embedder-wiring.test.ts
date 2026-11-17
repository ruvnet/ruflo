/**
 * ADR-514: AgentDB controllers that take `(db, embedder, …)` must be built
 * with an embedder. The registry constructed LearningSystem, NightlyLearner,
 * ExplainableRecall and the graph transformer's CausalMemoryGraph with the
 * database alone, so their first predict/discover/recall call threw a
 * TypeError on `this.embedder.embed…`, or the controller came back null.
 *
 * Runs against the real `agentdb` package in a temp directory.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControllerRegistry } from './controller-registry.js';

const dir = mkdtempSync(join(tmpdir(), 'ruflo-adr514-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const NAMES = ['learningSystem', 'explainableRecall', 'nightlyLearner', 'graphTransformer'] as const;

describe('ControllerRegistry hands AgentDB controllers an embedder (ADR-514)', () => {
  it('builds each embedder-taking controller with a usable embedder', async () => {
    const reg = new ControllerRegistry();
    await reg.initialize({
      dbPath: join(dir, 'agentdb-memory.db'),
      controllers: Object.fromEntries(NAMES.map((n) => [n, true])) as any,
    });
    if (!reg.getAgentDB()) {
      // AgentDB could not open in this environment; nothing to check.
      expect(reg.getAgentDBInitError()).toBeTruthy();
      await reg.shutdown();
      return;
    }

    for (const name of NAMES) {
      const c = reg.get<any>(name);
      expect(c, name).not.toBeNull();
      const embedder = c.embedder;
      expect(embedder, `${name}.embedder`).toBeTruthy();
      const embed = embedder.embedQuery ?? embedder.embed;
      expect(typeof embed, `${name}.embedder can embed`).toBe('function');
    }
    await reg.shutdown();
  }, 60_000);
});

describe('ControllerRegistry honours a configured embedder and dimension (#4984)', () => {
  it('sizes AgentDB at config.dimension and routes agentdb.embedder through embeddingGenerator', async () => {
    const DIM = 8;
    const calls: string[] = [];
    const reg = new ControllerRegistry();
    await reg.initialize({
      dbPath: join(dir, 'agentdb-4984.db'),
      dimension: DIM,
      embeddingGenerator: async (t: string) => { calls.push(t); return new Float32Array(DIM).fill(0.5); },
      controllers: { reasoningBank: true } as any,
    });
    const agentdb: any = reg.getAgentDB();
    if (!agentdb) {
      expect(reg.getAgentDBInitError()).toBeTruthy();
      await reg.shutdown();
      return;
    }
    expect(agentdb.config?.vectorDimension).toBe(DIM);
    const v = await agentdb.embedder.embed('hello');
    expect(v.length).toBe(DIM);
    expect(calls).toContain('hello');
    const q = typeof agentdb.embedder.embedQuery === 'function' ? await agentdb.embedder.embedQuery('q') : v;
    expect(q.length).toBe(DIM);
    await reg.shutdown();
  }, 60_000);

  it('rejects a generator vector whose length differs from config.dimension', async () => {
    const reg = new ControllerRegistry();
    await reg.initialize({
      dbPath: join(dir, 'agentdb-4984b.db'),
      dimension: 8,
      embeddingGenerator: async () => new Float32Array(3),
      controllers: { reasoningBank: true } as any,
    });
    const agentdb: any = reg.getAgentDB();
    if (agentdb) await expect(agentdb.embedder.embed('x')).rejects.toThrow(/expected 8/);
    await reg.shutdown();
  }, 60_000);
});
