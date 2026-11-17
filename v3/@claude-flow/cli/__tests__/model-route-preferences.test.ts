import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelRouter, type ModelRoutingResult } from '../src/ruvector/model-router.js';

let dir: string;
let router: ModelRouter;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-model-preferences-'));
  vi.stubEnv('CLAUDE_FLOW_ROUTER_NEURAL', undefined);
  vi.stubEnv('CLAUDE_FLOW_ROUTER_TRAJECTORY', undefined);
  // Equal Thompson samples isolate preference effects from exploration.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  router = new ModelRouter({ statePath: join(dir, 'router.json'), maxUncertainty: 1 });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function alternativeScore(result: ModelRoutingResult, model: string): number {
  return result.alternatives.find(alternative => alternative.model === model)!.score;
}

describe('request-local model routing preferences (#4722)', () => {
  it('preferCost selects a cheaper capable tier for a borderline task', async () => {
    const task = 'add extra feature';
    const baseline = await router.route(task);
    const preferred = await router.route(task, undefined, { preferCost: true });
    expect(baseline.model).toBe('sonnet');
    expect(preferred.model).toBe('haiku');
    expect(preferred.costMultiplier).toBeLessThan(baseline.costMultiplier);
  });

  it('preferSpeed selects a faster capable tier', async () => {
    const task = 'refactor module';
    expect((await router.route(task)).model).toBe('sonnet');
    expect((await router.route(task, undefined, { preferSpeed: true })).model).toBe('haiku');
  });

  it('omitted and false preferences retain baseline behavior after a preferred request', async () => {
    const task = 'add extra feature';
    const baseline = await router.route(task);
    await router.route(task, undefined, { preferCost: true, preferSpeed: true });
    for (const result of [
      await router.route(task),
      await router.route(task, undefined, { preferCost: false, preferSpeed: false }),
    ]) {
      expect(result).toMatchObject({
        model: baseline.model,
        confidence: baseline.confidence,
        uncertainty: baseline.uncertainty,
        alternatives: baseline.alternatives,
      });
    }
  });

  it.each([
    ['haiku', 'architect a distributed concurrent system with security audit'],
    ['sonnet', 'investigate and implement a distributed security architecture across multiple files; maybe debug an unknown error and unclear concurrency problem'],
  ])('does not boost %s beyond its complexity capability', async (model, task) => {
    const baseline = await router.route(task);
    const preferred = await router.route(task, undefined, { preferCost: true, preferSpeed: true });
    expect(alternativeScore(baseline, model)).toBeGreaterThan(0);
    expect(alternativeScore(preferred, model)).toBe(alternativeScore(baseline, model));
  });

  it('retains uncertainty escalation when speed is preferred', async () => {
    router = new ModelRouter({ statePath: join(dir, 'router.json'), maxUncertainty: 0.15 });
    const result = await router.route('refactor module', undefined, { preferSpeed: true });
    expect(result.uncertainty).toBeGreaterThan(0.15);
    expect(result.model).toBe('sonnet');
  });

  it('applies circuit-breaker penalties after cost weighting', async () => {
    const task = 'add extra feature';
    const baseline = await router.route(task);
    expect((await router.route(task, undefined, { preferCost: true })).model).toBe('haiku');
    for (let i = 0; i < 5; i++) router.recordOutcome(task, 'haiku', 'failure');
    const result = await router.route(task, undefined, { preferCost: true });
    expect(result.model).not.toBe('haiku');
    expect(alternativeScore(result, 'haiku')).toBeCloseTo(alternativeScore(baseline, 'haiku') * 1.96 * 0.1);
  });
});
