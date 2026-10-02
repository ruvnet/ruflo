/**
 * ADR-407 — the `--mods` step of `ruflo init`: ruflo-mods and the mod manager
 * enabled in settings.local.json, made resolvable through #3612's repair,
 * idempotent, dry-runnable, and never writing under .claude/helpers.
 * Mock-first: an injected exec and temp dirs; no real claude, no real ~/.claude.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { MANAGER_PLUGIN_ID, MANAGER_RECORD, enableManager, installManager, planModsStep, removeManager, runModsStep } from '../../src/init/mods-generator.js';
import { MOD_PLUGIN_ID, uninstallMod } from '../../src/mods/install.js';
import type { Exec } from '../../src/mods/plugin-repair.js';

let root: string;
let home: string;
let cfg: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ruflo-mods-gen-'));
  home = mkdtempSync(join(tmpdir(), 'ruflo-mods-gen-home-'));
  cfg = join(home, 'cfg');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const local = () => join(root, '.claude', 'settings.local.json');
const env = () => ({ CLAUDE_CONFIG_DIR: cfg, PATH: '' }) as NodeJS.ProcessEnv;

/** A stand-in claude that records argv and, when ok, installs as Claude Code records it. */
function fakeExec(calls: string[][], ok = true): Exec {
  return async (_file, args) => {
    calls.push([...args]);
    if (!ok) return { code: 1, stdout: '', stderr: 'network down' };
    const plugins = join(cfg, 'plugins');
    if (args[1] === 'marketplace') {
      mkdirSync(join(plugins, 'marketplaces', 'ruflo', 'plugins', 'ruflo-mods', '.claude-plugin'), { recursive: true });
      writeFileSync(join(plugins, 'marketplaces', 'ruflo', 'plugins', 'ruflo-mods', '.claude-plugin', 'plugin.json'), '{}');
      writeFileSync(join(plugins, 'known_marketplaces.json'), JSON.stringify({ ruflo: { installLocation: join(plugins, 'marketplaces', 'ruflo') } }));
    }
    if (args[1] === 'install') {
      const id = args[2]!;
      const path = join(plugins, 'cache', id.split('@')[0]!);
      mkdirSync(path, { recursive: true });
      const file = join(plugins, 'installed_plugins.json');
      const record = existsSync(file) ? read(file) : { version: 2, plugins: {} };
      record.plugins[id] = [{ scope: 'local', installPath: path, projectPath: root }];
      writeFileSync(file, JSON.stringify(record));
    }
    return { code: 0, stdout: '', stderr: '' };
  };
}

/** Every file under a directory, relative to it. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p).map((f) => join(name, f)) : [name];
  });
}

describe('ADR-407 init --mods step', () => {
  it('plans both keys, the marketplace, ruflo-mods and the manager installs', () => {
    const plan = planModsStep({ projectRoot: root, env: env(), home, claude: '/bin/claude', claudeVersion: '2.1.287' });
    expect((plan.settings.enabledPlugins as Record<string, boolean>)).toEqual({ [MOD_PLUGIN_ID]: true, [MANAGER_PLUGIN_ID]: true });
    expect(plan.argv).toEqual([
      ['plugin', 'marketplace', 'add', 'ruvnet/ruflo', '--scope', 'local'],
      ['plugin', 'install', MOD_PLUGIN_ID, '--scope', 'local'],
      ['plugin', 'install', MANAGER_PLUGIN_ID, '--scope', 'local'],
    ]);
    expect(existsSync(join(root, '.claude'))).toBe(false); // planning writes nothing
  });

  it('runs the steps in order and ends resolvable; nothing is written under .claude/helpers', async () => {
    const calls: string[][] = [];
    const r = await runModsStep({ projectRoot: root, env: env(), home, claude: '/bin/claude', claudeVersion: '2.1.287', exec: fakeExec(calls) });
    expect(calls.map((c) => c.slice(0, 3).join(' '))).toEqual(['plugin marketplace add', `plugin install ${MOD_PLUGIN_ID}`, `plugin install ${MANAGER_PLUGIN_ID}`]);
    expect(r).toMatchObject({ resolvable: true, managerInstalled: true, managerAdded: true });
    expect(read(local()).enabledPlugins).toEqual({ [MOD_PLUGIN_ID]: true, [MANAGER_PLUGIN_ID]: true });
    expect(read(join(root, MANAGER_RECORD))).toMatchObject({ version: 1, settingsFile: local(), added: true });
    expect(filesUnder(root).filter((f) => f.startsWith(join('.claude', 'helpers')))).toEqual([]);
  });

  it('is idempotent: a second run leaves settings byte-identical and keeps the claims', async () => {
    const calls: string[][] = [];
    const opts = { projectRoot: root, env: env(), home, claude: '/bin/claude', claudeVersion: '2.1.287', exec: fakeExec(calls) };
    await runModsStep(opts);
    const first = readFileSync(local(), 'utf8');
    const r2 = await runModsStep(opts);
    expect(readFileSync(local(), 'utf8')).toBe(first);
    expect(r2.managerAdded).toBe(true); // OR-ed with the first record
    expect(calls[3]).toEqual(['plugin', 'marketplace', 'update', 'ruflo']); // known now: updated, not re-added
    // Uninstall takes back exactly what was added.
    removeManager(root);
    uninstallMod(root);
    expect(read(local())).toEqual({});
  });

  it('never claims a key a person set; uninstall then leaves it', () => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(local(), JSON.stringify({ enabledPlugins: { [MANAGER_PLUGIN_ID]: true } }));
    expect(enableManager(root).added).toBe(false);
    removeManager(root);
    expect(read(local()).enabledPlugins[MANAGER_PLUGIN_ID]).toBe(true);
    expect(existsSync(join(root, MANAGER_RECORD))).toBe(false);
  });

  it('no claude: settings are written, nothing runs, the manual commands are given', async () => {
    const r = await runModsStep({ projectRoot: root, env: env(), home, claude: null });
    expect(r.plan.skip).toBe('no runnable claude on PATH');
    expect(r.steps).toEqual([]);
    expect(r.resolvable).toBe(false);
    expect(r.plan.manual).toEqual([`cd ${JSON.stringify(root)}`, 'claude plugin marketplace add ruvnet/ruflo --scope local', `claude plugin install ${MOD_PLUGIN_ID} --scope local`, `claude plugin install ${MANAGER_PLUGIN_ID} --scope local`]);
    expect(read(local()).enabledPlugins[MANAGER_PLUGIN_ID]).toBe(true);
  });

  it('claude older than 2.1.287 (or of unknown version): ruflo-mods is repaired, the manager install skipped with the reason', async () => {
    for (const version of ['2.1.282', null]) {
      const calls: string[][] = [];
      const r = await runModsStep({ projectRoot: root, env: env(), home, claude: '/bin/claude', claudeVersion: version, exec: fakeExec(calls) });
      expect(calls.some((c) => c[2] === MANAGER_PLUGIN_ID)).toBe(false);
      expect(calls.some((c) => c[2] === MOD_PLUGIN_ID)).toBe(true);
      expect(r.plan.managerSkip).toMatch(version ? /older than 2\.1\.287/ : /version unknown/);
      expect(r.resolvable).toBe(true);
    }
  });

  it('--no-mods-manager keeps ADR-404 behaviour: ruflo-mods only', async () => {
    const calls: string[][] = [];
    await runModsStep({ projectRoot: root, env: env(), home, claude: '/bin/claude', claudeVersion: '2.1.287', exec: fakeExec(calls), manager: false });
    expect(read(local()).enabledPlugins).toEqual({ [MOD_PLUGIN_ID]: true });
    expect(existsSync(join(root, MANAGER_RECORD))).toBe(false);
    expect(calls.some((c) => c[2] === MANAGER_PLUGIN_ID)).toBe(false);
  });

  it('a failed repair stops before the manager and reports unresolvable', async () => {
    const calls: string[][] = [];
    const r = await runModsStep({ projectRoot: root, env: env(), home, claude: '/bin/claude', claudeVersion: '2.1.287', exec: fakeExec(calls, false) });
    expect(calls).toHaveLength(1);
    expect(r.resolvable).toBe(false);
  });

  it('dry run writes nothing and runs nothing', async () => {
    const calls: string[][] = [];
    const r = await runModsStep({ projectRoot: root, env: env(), home, claude: '/bin/claude', claudeVersion: '2.1.287', exec: fakeExec(calls), dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(calls).toEqual([]);
    expect(filesUnder(root)).toEqual([]);
    expect(removeManager(root, true)).toEqual({ removed: false });
  });

  it('installManager (mods install): the manager half alone', async () => {
    const calls: string[][] = [];
    const m = await installManager({ projectRoot: root, env: env(), home, claude: '/bin/claude', claudeVersion: '2.1.287', exec: fakeExec(calls) });
    expect(calls).toEqual([['plugin', 'install', MANAGER_PLUGIN_ID, '--scope', 'local']]);
    expect(m).toMatchObject({ added: true, skip: null, installed: true, step: { ok: true } });
    expect(relative(root, read(join(root, MANAGER_RECORD)).settingsFile)).toBe(join('.claude', 'settings.local.json'));
  });

  it('refuses a manager record that points outside the project .claude folder', () => {
    mkdirSync(join(root, '.claude-flow', 'mods'), { recursive: true });
    writeFileSync(join(root, MANAGER_RECORD), JSON.stringify({ version: 1, settingsFile: join(home, 'settings.json'), installedAt: 'x', added: true }));
    expect(() => removeManager(root)).toThrow(/outside/);
  });
});
