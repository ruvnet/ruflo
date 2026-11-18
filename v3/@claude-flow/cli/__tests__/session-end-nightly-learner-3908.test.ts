/**
 * #3908: bridgeSessionEnd only called `nightlyLearner.consolidate`, which
 * neither the MemoryConsolidator wrapper nor AgentDB's NightlyLearner has —
 * they expose `run`/`runAll` — so session-end consolidation never ran.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setMemoryBridgeRegistryForTests, bridgeSessionEnd } from '../src/memory/memory-bridge.js';

afterEach(() => {
  vi.useRealTimers();
  __setMemoryBridgeRegistryForTests(null);
});

function registry(nightlyLearner: Record<string, unknown> | null) {
  __setMemoryBridgeRegistryForTests({
    get: (name: string) => {
      // A stored episode lets session-end proceed past the (stubbed-out) entry write.
      if (name === 'reflexion') return { storeEpisode: vi.fn().mockResolvedValue(1) };
      if (name === 'nightlyLearner') return nightlyLearner;
      return null;
    },
    getBackend: () => null,
  });
}

const end = () => bridgeSessionEnd({ sessionId: 's1', summary: 'did some work' });

describe('#3908 session-end NightlyLearner consolidation', () => {
  it('calls run() on the MemoryConsolidator-shaped wrapper', async () => {
    const run = vi.fn().mockResolvedValue({ swept: 0 });
    const runAll = vi.fn();
    registry({ run, runAll, source: 'memory-consolidator' });
    const r = await end();
    expect(run).toHaveBeenCalledOnce();
    expect(runAll).not.toHaveBeenCalled();
    expect(r?.controller).toContain('+nightlyLearner');
  });

  it('falls back to runAll() when run() is absent', async () => {
    const runAll = vi.fn().mockResolvedValue(undefined);
    registry({ runAll });
    const r = await end();
    expect(runAll).toHaveBeenCalledOnce();
    expect(r?.controller).toContain('+nightlyLearner');
  });

  it('still prefers consolidate({ sessionId }) when a controller provides it', async () => {
    const consolidate = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn();
    registry({ consolidate, run });
    await end();
    expect(consolidate).toHaveBeenCalledWith({ sessionId: 's1' });
    expect(run).not.toHaveBeenCalled();
  });

  it('a failing sweep is non-fatal', async () => {
    registry({ run: vi.fn().mockRejectedValue(new Error('boom')) });
    const r = await end();
    expect(r?.success).toBe(true);
    expect(r?.controller).not.toContain('nightlyLearner');
  });

  it('a hung sweep is bounded and does not hold session-end open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    registry({ run: () => new Promise(() => { /* never settles */ }) });
    const pending = end();
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await pending;
    expect(r?.success).toBe(true);
    expect(r?.controller).not.toContain('nightlyLearner');
  });

  it('a controller with no known entry point is skipped', async () => {
    registry({ somethingElse: vi.fn() });
    const r = await end();
    expect(r?.success).toBe(true);
    expect(r?.controller).not.toContain('nightlyLearner');
  });
});
