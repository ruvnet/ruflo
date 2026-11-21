// #4957: openrouter-alts.json was probed only relative to process.cwd(), so an
// npm install (cwd = the user's project) never loaded it and OpenRouter users got
// no per-tier alternate. It must resolve relative to the package itself.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ALTS = JSON.parse(readFileSync(resolve(__dirname, '..', 'assets', 'model-router', 'openrouter-alts.json'), 'utf8')) as {
  tiers: Record<string, { openrouter_alt: string }>;
};

describe('openrouter-alts.json resolves from the package, not the cwd (#4957)', () => {
  let outside: string;

  beforeEach(() => {
    outside = mkdtempSync(join(tmpdir(), 'or-alts-4957-'));
    vi.spyOn(process, 'cwd').mockReturnValue(outside);
    vi.stubEnv('CLAUDE_FLOW_ROUTER_PROVIDER', 'openrouter');
    vi.stubEnv('CLAUDE_FLOW_ROUTER_OPENROUTER_ALTS', '');
    vi.stubEnv('CLAUDE_FLOW_ROUTER_NEURAL', '');
    vi.resetModules(); // the alts file is cached per module instance
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(outside, { recursive: true, force: true });
  });

  it('routes an OpenRouter user to the bundled per-tier alternate with cwd outside the repo when opted in', async () => {
    vi.stubEnv('CLAUDE_FLOW_ROUTER_OPENROUTER_ALTS', 'bundled');
    expect(process.cwd()).toBe(outside);
    const { createModelRouter } = await import('../src/ruvector/model-router.js');
    const router = createModelRouter({ statePath: join(outside, 'state.json'), autoSaveInterval: 1_000_000 });
    const result = await router.route('fix a typo in the readme');
    expect(result.provider).toBe('openrouter');
    expect(result.openrouterModel).toBe(ALTS.tiers[result.model].openrouter_alt);
  });

  it('leaves npm installs on no alternate by default (opt-in until a maintainer decides)', async () => {
    const { createModelRouter } = await import('../src/ruvector/model-router.js');
    const router = createModelRouter({ statePath: join(outside, 'state.json'), autoSaveInterval: 1_000_000 });
    const result = await router.route('fix a typo in the readme');
    expect(result.provider).toBe('openrouter');
    expect(result.openrouterModel).toBeUndefined();
  });
});
