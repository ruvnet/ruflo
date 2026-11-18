/**
 * #3475: the Fisher EMA decay rate was hard-coded. CLAUDE_FLOW_FISHER_DECAY
 * now overrides it, honoured only for a finite number in (0, 1].
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EWCConsolidator, fisherDecayRateFromEnv } from '../src/memory/ewc-consolidation.js';

const decayOf = (c: EWCConsolidator) =>
  (c as unknown as { config: { fisherDecayRate: number } }).config.fisherDecayRate;

afterEach(() => vi.unstubAllEnvs());

describe('#3475 CLAUDE_FLOW_FISHER_DECAY', () => {
  it('keeps the 0.01 default when unset', () => {
    vi.stubEnv('CLAUDE_FLOW_FISHER_DECAY', undefined as unknown as string);
    expect(decayOf(new EWCConsolidator())).toBe(0.01);
  });

  it.each(['0.05', '1', '0.5 '])('honours a valid value %j', (raw) => {
    vi.stubEnv('CLAUDE_FLOW_FISHER_DECAY', raw);
    expect(decayOf(new EWCConsolidator())).toBe(Number(raw));
  });

  it.each(['', '  ', '0', '-0.1', '1.5', 'abc', 'NaN', 'Infinity', '1e999'])(
    'ignores an invalid value %j and keeps the default', (raw) => {
      vi.stubEnv('CLAUDE_FLOW_FISHER_DECAY', raw);
      expect(fisherDecayRateFromEnv()).toBeUndefined();
      expect(decayOf(new EWCConsolidator())).toBe(0.01);
    });

  it('an explicit constructor value wins over the env override', () => {
    vi.stubEnv('CLAUDE_FLOW_FISHER_DECAY', '0.2');
    expect(decayOf(new EWCConsolidator({ fisherDecayRate: 0.03 }))).toBe(0.03);
  });

  it('the override drives the Fisher EMA', () => {
    vi.stubEnv('CLAUDE_FLOW_FISHER_DECAY', '0.5');
    const c = new EWCConsolidator({ dimensions: 2, storagePath: '/nonexistent/ewc.json' });
    c.recordGradient('p', [2, 0], true);
    const fisher = (c as unknown as { globalFisher: number[] }).globalFisher;
    // F = (1 - 0.5) * 0 + 0.5 * 2^2
    expect(fisher[0]).toBeCloseTo(2);
  });
});
