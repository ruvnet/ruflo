/**
 * #4693 — hooks_intelligence_learn advertised `trajectoryIds` but never read it,
 * so a request scoped to some trajectories ran global learning. An explicit
 * selection is now refused before the intelligence layer is imported.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const distillLearning = vi.fn(async () => ({ patternsDistilled: 1, ewcPenalty: 0 }));
const runBackgroundLearning = vi.fn(async () => undefined);

vi.mock('../src/memory/intelligence.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  distillLearning,
  runBackgroundLearning,
}));

const { hooksIntelligenceLearn } = await import('../src/mcp-tools/hooks-tools.js');

afterEach(() => {
  distillLearning.mockClear();
  runBackgroundLearning.mockClear();
});

describe('#4693 hooks_intelligence_learn trajectoryIds', () => {
  for (const trajectoryIds of [['selected-only'], [], null, 'one']) {
    it(`refuses an explicit selection (${JSON.stringify(trajectoryIds)}) and runs no learning`, async () => {
      const result = (await hooksIntelligenceLearn.handler({ trajectoryIds, consolidate: false })) as Record<string, unknown>;

      expect(result.success).toBe(false);
      expect(result.learned).toBe(false);
      expect(String(result.error)).toMatch(/trajectoryIds is not supported/);
      expect(distillLearning).not.toHaveBeenCalled();
      expect(runBackgroundLearning).not.toHaveBeenCalled();
    });
  }

  it('without a selection it still runs the learning cycle', async () => {
    const result = (await hooksIntelligenceLearn.handler({ consolidate: false })) as Record<string, unknown>;

    expect(result.success).not.toBe(false);
    expect(distillLearning).toHaveBeenCalledTimes(1);
  });

  it('says in its schema that the selection is not supported', () => {
    const prop = (hooksIntelligenceLearn.inputSchema.properties as Record<string, { description: string }>).trajectoryIds;

    expect(prop.description).toMatch(/Not supported/);
  });
});
