import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, checkSinglePackage, checkForUpdates } from '../src/update/checker.js';

vi.mock('node:module', () => ({
  createRequire: () => Object.assign(() => ({ version: '1.0.0' }), { resolve: () => 'fixture-package.json' }),
}));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('package patch updates require opt-in regardless of priority', () => {
  it('disables automatic patch installation by default', () => {
    expect(DEFAULT_CONFIG.autoUpdate.patch).toBe(false);
  });

  it.each(['critical', 'high', 'normal', 'low'] as const)('honors opt-out for %s packages', async priority => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ 'dist-tags': { latest: '1.0.1' } }) })));
    const config = { ...DEFAULT_CONFIG, autoUpdate: { patch: false, minor: false, major: false }, priority: { '@claude-flow/cli': priority } };
    expect(await checkSinglePackage('@claude-flow/cli', config)).toMatchObject({ updateType: 'patch', shouldAutoUpdate: false });
    expect(await checkSinglePackage('@claude-flow/cli', { ...config, autoUpdate: { ...config.autoUpdate, patch: true } })).toMatchObject({ shouldAutoUpdate: true });
  });

  it.each(['CI', 'CLAUDE_FLOW_AUTO_UPDATE'])('preserves the %s disable gate with the new opt-in present', async name => {
    vi.stubEnv('CI', '');
    vi.stubEnv('CONTINUOUS_INTEGRATION', '');
    vi.stubEnv('RUFLO_AUTO_UPDATE', 'true');
    vi.stubEnv(name, name === 'CI' ? '1' : 'false');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await checkForUpdates({ ...DEFAULT_CONFIG, autoUpdate: { patch: true, minor: false, major: false } })).toMatchObject({ skipped: true, results: [] });
    expect(fetch).not.toHaveBeenCalled();
  });
});
