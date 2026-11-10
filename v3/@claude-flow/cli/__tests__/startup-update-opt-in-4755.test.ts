import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runStartupUpdateCheck } from '../src/update/index.js';
import { DEFAULT_CONFIG } from '../src/update/checker.js';
import updateCommand from '../src/commands/update.js';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const mocks = vi.hoisted(() => ({ check: vi.fn(), execute: vi.fn() }));
vi.mock('../src/update/checker.js', () => ({
  DEFAULT_CONFIG: { enabled: true, checkIntervalHours: 24, autoUpdate: { patch: false, minor: false, major: false }, priority: {}, exclude: [] },
  checkForUpdates: mocks.check,
  checkSinglePackage: vi.fn(),
  getInstalledVersion: () => '1.0.0',
}));
vi.mock('../src/update/executor.js', () => ({
  executeMultipleUpdates: mocks.execute, executeUpdate: vi.fn(), rollbackUpdate: vi.fn(),
  getUpdateHistory: vi.fn(), clearHistory: vi.fn(), loadHistory: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('RUFLO_AUTO_UPDATE', '');
  mocks.check.mockResolvedValue({ results: [{ package: '@claude-flow/cli', currentVersion: '1.0.0', latestVersion: '1.0.1', updateType: 'patch', shouldAutoUpdate: true, priority: 'critical' }], skipped: false });
  mocks.execute.mockResolvedValue([{ package: '@claude-flow/cli', version: '1.0.1', success: true }]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('startup update installation policy', () => {
  it('still reports available updates but does not install them without opt-in', async () => {
    const result = await runStartupUpdateCheck({});
    expect(result.checked).toBe(true);
    expect(result.updatesAvailable).toHaveLength(1);
    expect(result.updatesApplied).toEqual([]);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(['1', 'true', ' YES ', 'On'])('accepts the explicit environment opt-in %s', async value => {
    vi.stubEnv('RUFLO_AUTO_UPDATE', value);
    expect((await runStartupUpdateCheck({})).updatesApplied).toEqual(['@claude-flow/cli@1.0.1']);
    expect(mocks.check).toHaveBeenCalledWith(expect.objectContaining({ autoUpdate: { patch: true, minor: false, major: false } }));
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(DEFAULT_CONFIG.autoUpdate.patch).toBe(false);
  });

  it.each(['0', 'false', 'off', 'not-enabled'])('does not install for %s', async value => {
    vi.stubEnv('RUFLO_AUTO_UPDATE', value);
    expect((await runStartupUpdateCheck({})).updatesApplied).toEqual([]);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('lets explicit options override environment settings in both directions', async () => {
    vi.stubEnv('RUFLO_AUTO_UPDATE', 'true');
    await runStartupUpdateCheck({ autoUpdate: false });
    expect(mocks.execute).not.toHaveBeenCalled();
    vi.stubEnv('RUFLO_AUTO_UPDATE', 'false');
    await runStartupUpdateCheck({ autoUpdate: true });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('reports the same opt-in policy in update check without installing packages', async () => {
    vi.stubEnv('RUFLO_AUTO_UPDATE', 'true');
    mocks.check.mockImplementation(async config => ({
      skipped: false,
      results: [{ package: '@claude-flow/cli', updateType: 'patch', shouldAutoUpdate: config.autoUpdate.patch }],
    }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const command = updateCommand.subcommands!.find(item => item.name === 'check')!;
    await command.action!({ args: [], flags: { json: true }, cwd: process.cwd(), interactive: false });
    expect(JSON.parse(log.mock.calls[0][0] as string)[0].shouldAutoUpdate).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(DEFAULT_CONFIG.autoUpdate.patch).toBe(false);
  });

  it('keeps the CLI entry point from forcing startup installation', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/runStartupUpdateCheck\(\{\s*autoUpdate:\s*true\s*\}\)/);
  });

  it('publishes the development Mongo service only on loopback', () => {
    const compose = parse(readFileSync(new URL('../../../../ruflo/src/ruvocal/docker-compose.yml', import.meta.url), 'utf8'));
    const ports = compose.services.mongo.ports as string[];
    expect(ports).toHaveLength(1);
    const resolved = ports[0].replace('${LOCAL_MONGO_PORT:-27017}', '27118').split(':');
    expect(resolved).toEqual(['127.0.0.1', '27118', '27017']);
  });
});
