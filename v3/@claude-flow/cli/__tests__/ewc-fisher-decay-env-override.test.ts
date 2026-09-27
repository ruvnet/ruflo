/**
 * Dream Cycle 2026-09-27 (intelligence surface).
 *
 * `EWCConsolidator`'s `fisherDecayRate` (default 0.01) gates the online-EMA
 * update in `computeFisherMatrix()`, `recordGradient()`, and the
 * production-wired `updateFisherFromConfidences()` (see
 * `ewc-fisher-ema-direction.test.ts`, Dream Cycle 2026-09-22, #3395). Before
 * that fix, tuning this rate would have been pointless — the EMA ran
 * backwards, so a "faster" decay just discarded accumulated importance
 * faster in the wrong direction. Now that all three sites share one correct
 * direction, `fisherDecayRate` is a legitimate tunable: how quickly should
 * accumulated pattern-importance respond to new evidence vs. resist being
 * overwritten by a single low-signal batch?
 *
 * This adds a `CLAUDE_FLOW_FISHER_DECAY` env override, mirroring the exact
 * `envPriorDecay()` pattern (`v3/@claude-flow/cli/src/ruvector/model-router.ts`,
 * Dream Cycle 2026-08-17/#3049, exposed as `CLAUDE_FLOW_PRIOR_DECAY` by Dream
 * Cycle 2026-09-17/#3350) so the rate can be swept experimentally (e.g. by
 * Darwin's bounded evolution against a synthetic retention/discrimination
 * fitness proxy — see docs/dream-cycle/dream-gist-2026-09-27.md) without a
 * code change per candidate value. Unset/invalid input falls back to the
 * unchanged default (0.01) — this is opt-in only, no default-behavior change
 * for existing deployments.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('EWCConsolidator — CLAUDE_FLOW_FISHER_DECAY env override (Dream Cycle 2026-09-27, mirrors #3350 envPriorDecay)', () => {
  const ENV_KEY = 'CLAUDE_FLOW_FISHER_DECAY';
  let originalEnv: string | undefined;
  let counter = 0;

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY];
    counter += 1;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
    vi.resetModules();
  });

  function storagePath(label: string): string {
    return `/tmp/ewc-fisher-decay-env-${label}-${counter}.json`;
  }

  it('wires the env var into the default fisherDecayRate for a consolidator built with no explicit config', async () => {
    process.env[ENV_KEY] = '0.5';
    vi.resetModules();
    const { EWCConsolidator: FreshEWCConsolidator } = await import(
      '../src/memory/ewc-consolidation.js'
    );
    const consolidator = new FreshEWCConsolidator({
      dimensions: 4,
      storagePath: storagePath('wired'),
    });

    consolidator.updateFisherFromConfidences([
      { id: 'important', embedding: new Array(4).fill(10), oldConf: 0.5, newConf: 0.9 },
    ]);
    const afterFirst = consolidator.getConsolidationStats().avgFisherValue;
    expect(afterFirst).toBeGreaterThan(0);

    // A single near-zero-signal batch under decay=0.5 should erode roughly
    // half the accumulated signal ((1-0.5)*old + 0.5*~0 ≈ 0.5*old) — sharply
    // different from the default 0.01's ~99% retention on the very next
    // call. This directly discriminates "env value is actually read by the
    // EMA math", not merely stored cosmetically.
    consolidator.updateFisherFromConfidences([
      { id: 'noise', embedding: new Array(4).fill(0.001), oldConf: 0.5, newConf: 0.51 },
    ]);
    const afterOneNoisyCall = consolidator.getConsolidationStats().avgFisherValue;

    expect(afterOneNoisyCall).toBeLessThan(afterFirst * 0.65);
    expect(afterOneNoisyCall).toBeGreaterThan(afterFirst * 0.35);
  });

  it('falls back to the unchanged default (0.01) for an out-of-range env value', async () => {
    process.env[ENV_KEY] = '1.5';
    vi.resetModules();
    const { EWCConsolidator: FreshEWCConsolidator } = await import(
      '../src/memory/ewc-consolidation.js'
    );
    const consolidator = new FreshEWCConsolidator({
      dimensions: 4,
      storagePath: storagePath('outofrange'),
    });

    consolidator.updateFisherFromConfidences([
      { id: 'important', embedding: new Array(4).fill(10), oldConf: 0.5, newConf: 0.9 },
    ]);
    const afterFirst = consolidator.getConsolidationStats().avgFisherValue;

    for (let i = 0; i < 5; i++) {
      consolidator.updateFisherFromConfidences([
        { id: 'noise', embedding: new Array(4).fill(0.001), oldConf: 0.5, newConf: 0.51 },
      ]);
    }
    const afterFiveNoisyCalls = consolidator.getConsolidationStats().avgFisherValue;

    // Matches the existing default-decay discriminating threshold from
    // ewc-fisher-ema-direction.test.ts: retains ~95.1% at decay=0.01.
    expect(afterFiveNoisyCalls).toBeGreaterThan(afterFirst * 0.9);
  });

  it('falls back to the unchanged default (0.01) for a non-numeric env value', async () => {
    process.env[ENV_KEY] = 'not-a-number';
    vi.resetModules();
    const { EWCConsolidator: FreshEWCConsolidator } = await import(
      '../src/memory/ewc-consolidation.js'
    );
    const consolidator = new FreshEWCConsolidator({
      dimensions: 4,
      storagePath: storagePath('nan'),
    });

    consolidator.updateFisherFromConfidences([
      { id: 'important', embedding: new Array(4).fill(10), oldConf: 0.5, newConf: 0.9 },
    ]);
    const afterFirst = consolidator.getConsolidationStats().avgFisherValue;

    for (let i = 0; i < 5; i++) {
      consolidator.updateFisherFromConfidences([
        { id: 'noise', embedding: new Array(4).fill(0.001), oldConf: 0.5, newConf: 0.51 },
      ]);
    }
    const afterFiveNoisyCalls = consolidator.getConsolidationStats().avgFisherValue;
    expect(afterFiveNoisyCalls).toBeGreaterThan(afterFirst * 0.9);
  });

  it('falls back to the unchanged default (0.01) for a zero env value', async () => {
    process.env[ENV_KEY] = '0';
    vi.resetModules();
    const { EWCConsolidator: FreshEWCConsolidator } = await import(
      '../src/memory/ewc-consolidation.js'
    );
    const consolidator = new FreshEWCConsolidator({
      dimensions: 4,
      storagePath: storagePath('zero'),
    });

    consolidator.updateFisherFromConfidences([
      { id: 'important', embedding: new Array(4).fill(10), oldConf: 0.5, newConf: 0.9 },
    ]);
    const afterFirst = consolidator.getConsolidationStats().avgFisherValue;
    consolidator.updateFisherFromConfidences([
      { id: 'noise', embedding: new Array(4).fill(0.001), oldConf: 0.5, newConf: 0.51 },
    ]);
    const afterOneNoisyCall = consolidator.getConsolidationStats().avgFisherValue;

    // decay=0 would freeze globalFisher forever (never incorporate new
    // signal at all) -- confirming the guard rejects 0, not just >1.
    expect(afterOneNoisyCall).toBeLessThan(afterFirst);
    expect(afterOneNoisyCall).toBeGreaterThan(afterFirst * 0.9);
  });

  it('an explicit constructor config value still takes precedence over the env var', async () => {
    process.env[ENV_KEY] = '0.9';
    vi.resetModules();
    const { EWCConsolidator: FreshEWCConsolidator } = await import(
      '../src/memory/ewc-consolidation.js'
    );
    const consolidator = new FreshEWCConsolidator({
      dimensions: 4,
      fisherDecayRate: 0.01,
      storagePath: storagePath('explicit'),
    });

    consolidator.updateFisherFromConfidences([
      { id: 'important', embedding: new Array(4).fill(10), oldConf: 0.5, newConf: 0.9 },
    ]);
    const afterFirst = consolidator.getConsolidationStats().avgFisherValue;
    for (let i = 0; i < 5; i++) {
      consolidator.updateFisherFromConfidences([
        { id: 'noise', embedding: new Array(4).fill(0.001), oldConf: 0.5, newConf: 0.51 },
      ]);
    }
    const afterFiveNoisyCalls = consolidator.getConsolidationStats().avgFisherValue;

    // If the env var (0.9) leaked through instead of the explicit 0.01,
    // retention after 5 calls would collapse toward ~0 ((1-0.9)^5 ≈ 1e-5),
    // not stay above 90%.
    expect(afterFiveNoisyCalls).toBeGreaterThan(afterFirst * 0.9);
  });
});
