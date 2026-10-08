/**
 * Dream Cycle 2026-10-08 — `bridgeSessionEnd`'s "Phase 3: Trigger
 * NightlyLearner consolidation if available" step gated on
 * `typeof nightlyLearner.consolidate === 'function'`. Neither backend
 * `registry.get('nightlyLearner')` can return has ever had a bare
 * `consolidate()` method:
 *   - the legacy `agentdb` `NightlyLearner` class exposes `run()`,
 *     `discover()`, `consolidateEpisodes()` — no `consolidate`;
 *   - the ADR-125 Phase 4 `MemoryConsolidator` wrapper from
 *     `controller-registry.ts`'s `case 'nightlyLearner'` exposes
 *     `run`/`runAll`/`sweepExpired`/`dedup`/`compactHnsw` — also no
 *     `consolidate`.
 * So the guard was false unconditionally and consolidation never actually
 * ran at session end, on either backend, silently (the call sat behind a
 * `try/catch { non-fatal }` that never even executed). `run()` is the real
 * shared entry point on both. This test pins the fixed behavior: a
 * `nightlyLearner` controller exposing `run()` (not `consolidate()`) is
 * invoked, and `controller` reflects it.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'ruflo-dream-2026-10-08-nightly-learner-'));
const dbPath = join(root, 'memory.db');
let db: Database.Database | null = null;

afterEach(async () => {
  const { __setMemoryBridgeRegistryForTests } = await import('../src/memory/memory-bridge.js');
  __setMemoryBridgeRegistryForTests(null);
  db?.close();
  db = null;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Dream Cycle 2026-10-08 — nightlyLearner.run() wiring in bridgeSessionEnd', () => {
  it('calls run() (not the nonexistent consolidate()) and records it on the controller string', async () => {
    db = new Database(dbPath);
    const { __setMemoryBridgeRegistryForTests, bridgeSessionEnd } = await import('../src/memory/memory-bridge.js');

    const run = vi.fn().mockResolvedValue({ edgesDiscovered: 0 });
    // Shaped exactly like controller-registry.ts's real
    // `case 'nightlyLearner'` return value when a MemoryService is
    // registered: run/runAll/sweepExpired/dedup/compactHnsw, no consolidate.
    const nightlyLearner = {
      run,
      runAll: vi.fn(),
      sweepExpired: vi.fn(),
      dedup: vi.fn(),
      compactHnsw: vi.fn(),
      source: 'memory-consolidator' as const,
    };

    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: (name: string) => (name === 'nightlyLearner' ? nightlyLearner : null),
    });

    const result = await bridgeSessionEnd({ sessionId: `dream-2026-10-08-${Date.now()}` });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(); // real run()/runAll() take no args — no stale {sessionId} pass-through
    expect(result!.controller).toContain('nightlyLearner');
  });

  it('never calls a nightlyLearner.consolidate — confirms the dead branch is gone, not just unreached', async () => {
    db = new Database(dbPath);
    const { __setMemoryBridgeRegistryForTests, bridgeSessionEnd } = await import('../src/memory/memory-bridge.js');

    const consolidate = vi.fn();
    const run = vi.fn().mockResolvedValue(undefined);
    // A controller offering BOTH, to prove `run` is what gets called now —
    // pre-fix code would have called `consolidate` here instead and this
    // assertion would fail.
    const nightlyLearner = { run, consolidate };

    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: (name: string) => (name === 'nightlyLearner' ? nightlyLearner : null),
    });

    await bridgeSessionEnd({ sessionId: `dream-2026-10-08-both-${Date.now()}` });

    expect(run).toHaveBeenCalledTimes(1);
    expect(consolidate).not.toHaveBeenCalled();
  });

  it('stays non-fatal when nightlyLearner has neither run nor consolidate (graceful degradation preserved)', async () => {
    db = new Database(dbPath);
    const { __setMemoryBridgeRegistryForTests, bridgeSessionEnd } = await import('../src/memory/memory-bridge.js');

    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: (name: string) => (name === 'nightlyLearner' ? {} : null),
    });

    const result = await bridgeSessionEnd({ sessionId: `dream-2026-10-08-none-${Date.now()}` });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.controller).not.toContain('nightlyLearner');
  });
});
