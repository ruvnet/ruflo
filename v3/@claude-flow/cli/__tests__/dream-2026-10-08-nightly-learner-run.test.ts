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
 * ran at session end, on either backend, silently. `run()` is the real
 * shared entry point on both.
 *
 * 2026-10-09 follow-up (PR #3909 review): fixing the guard alone would
 * turn a dead path into one that fires on EVERY session end with real,
 * unbounded cost on both backends (full store `dedup()`+`compactHnsw()`
 * on one, episode embedding + causal discovery + edge deletion on the
 * other). So the call is now gated behind an explicit opt-in
 * (`RUFLO_SESSION_END_CONSOLIDATE`, default off) and bounded by a timeout
 * (`RUFLO_SESSION_END_CONSOLIDATE_TIMEOUT_MS`, default 5000ms) so a slow
 * run can never hang session end even when enabled. These tests cover:
 * default-off (safe out of the box), opt-in calls the real `run()` (not
 * the nonexistent `consolidate()`), a hung `run()` times out non-fatally,
 * and graceful degradation when neither method exists.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'ruflo-dream-2026-10-08-nightly-learner-'));
const dbPath = join(root, 'memory.db');
let db: Database.Database | null = null;
const ORIGINAL_ENABLE = process.env.RUFLO_SESSION_END_CONSOLIDATE;
const ORIGINAL_TIMEOUT = process.env.RUFLO_SESSION_END_CONSOLIDATE_TIMEOUT_MS;

beforeEach(() => {
  delete process.env.RUFLO_SESSION_END_CONSOLIDATE;
  delete process.env.RUFLO_SESSION_END_CONSOLIDATE_TIMEOUT_MS;
});

afterEach(async () => {
  const { __setMemoryBridgeRegistryForTests } = await import('../src/memory/memory-bridge.js');
  __setMemoryBridgeRegistryForTests(null);
  db?.close();
  db = null;
});

afterAll(() => {
  if (ORIGINAL_ENABLE === undefined) delete process.env.RUFLO_SESSION_END_CONSOLIDATE;
  else process.env.RUFLO_SESSION_END_CONSOLIDATE = ORIGINAL_ENABLE;
  if (ORIGINAL_TIMEOUT === undefined) delete process.env.RUFLO_SESSION_END_CONSOLIDATE_TIMEOUT_MS;
  else process.env.RUFLO_SESSION_END_CONSOLIDATE_TIMEOUT_MS = ORIGINAL_TIMEOUT;
  rmSync(root, { recursive: true, force: true });
});

describe('Dream Cycle 2026-10-08/09 — nightlyLearner.run() wiring in bridgeSessionEnd', () => {
  it('default (no env var set): never calls nightlyLearner.run() — safe out of the box', async () => {
    db = new Database(dbPath);
    const { __setMemoryBridgeRegistryForTests, bridgeSessionEnd } = await import('../src/memory/memory-bridge.js');

    const run = vi.fn().mockResolvedValue(undefined);
    const nightlyLearner = { run };

    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: (name: string) => (name === 'nightlyLearner' ? nightlyLearner : null),
    });

    const result = await bridgeSessionEnd({ sessionId: `dream-2026-10-09-default-off-${Date.now()}` });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(result!.controller).not.toContain('nightlyLearner');
  });

  it('RUFLO_SESSION_END_CONSOLIDATE=1: calls run() (not the nonexistent consolidate()) and records it on the controller string', async () => {
    process.env.RUFLO_SESSION_END_CONSOLIDATE = '1';
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

  it('RUFLO_SESSION_END_CONSOLIDATE=1: never calls a nightlyLearner.consolidate — confirms the dead branch is gone, not just unreached', async () => {
    process.env.RUFLO_SESSION_END_CONSOLIDATE = '1';
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

  it('RUFLO_SESSION_END_CONSOLIDATE=1: a hung run() times out non-fatally instead of hanging session end', async () => {
    process.env.RUFLO_SESSION_END_CONSOLIDATE = '1';
    process.env.RUFLO_SESSION_END_CONSOLIDATE_TIMEOUT_MS = '50';
    db = new Database(dbPath);
    const { __setMemoryBridgeRegistryForTests, bridgeSessionEnd } = await import('../src/memory/memory-bridge.js');

    // Never resolves within the test's lifetime — simulates a slow/hung
    // causal-discovery or dedup() pass.
    const run = vi.fn(() => new Promise(() => {}));
    const nightlyLearner = { run };

    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: (name: string) => (name === 'nightlyLearner' ? nightlyLearner : null),
    });

    const start = Date.now();
    const result = await bridgeSessionEnd({ sessionId: `dream-2026-10-09-timeout-${Date.now()}` });
    const elapsedMs = Date.now() - start;

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    // Timed out around the configured 50ms bound, not left hanging.
    expect(elapsedMs).toBeLessThan(2000);
    expect(result!.controller).not.toContain('nightlyLearner');
  });

  it('RUFLO_SESSION_END_CONSOLIDATE=1: stays non-fatal when nightlyLearner has neither run nor consolidate (graceful degradation preserved)', async () => {
    process.env.RUFLO_SESSION_END_CONSOLIDATE = '1';
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
