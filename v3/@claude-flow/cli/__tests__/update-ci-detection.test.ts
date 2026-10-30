/**
 * The startup update check must skip CI runs however CI is spelled. It matched only
 * `CI=true`, so a `CI=1` run checked, found a newer published CLI and ran
 * `npm install @claude-flow/cli@<latest> --save-exact` in the working directory during `ruflo init`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isCI, shouldCheckForUpdates } from '../src/update/rate-limiter.js';

const saved = { CI: process.env.CI, CONTINUOUS_INTEGRATION: process.env.CONTINUOUS_INTEGRATION, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('update check: CI detection', () => {
  it.each(['true', '1', 'TRUE', 'yes', 'woodpecker'])('CI=%s is CI', (value) => {
    expect(isCI({ CI: value })).toBe(true);
  });

  it.each(['', '0', 'false', 'False'])('CI=%j is not CI', (value) => {
    expect(isCI({ CI: value })).toBe(false);
  });

  it('GITHUB_ACTIONS and CONTINUOUS_INTEGRATION count too; no variable is not CI', () => {
    expect(isCI({ GITHUB_ACTIONS: 'true' })).toBe(true);
    expect(isCI({ CONTINUOUS_INTEGRATION: '1' })).toBe(true);
    expect(isCI({})).toBe(false);
  });

  it('shouldCheckForUpdates skips a CI=1 run', () => {
    delete process.env.CONTINUOUS_INTEGRATION;
    delete process.env.GITHUB_ACTIONS;
    process.env.CI = '1';
    expect(shouldCheckForUpdates()).toEqual({ allowed: false, reason: 'CI environment detected' });
  });
});
