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
