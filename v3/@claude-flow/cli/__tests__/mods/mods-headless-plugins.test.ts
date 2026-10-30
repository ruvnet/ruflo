/**
 * ADR-510 — loading ruflo plugins in headless `claude -p` workers.
 *
 *  - resolvePluginPaths: each source in order (local checkout, clone, cache),
 *    a missing manifest, a CLAUDE_CONFIG_DIR override, and that the project's
 *    own settings (or a relative path) never choose the folder.
 *  - withHeadlessPlugins: adds --plugin-dir + CLAUDE_CODE_ENABLE_FUNCTION_HOOKS,
 *    never duplicates a caller's own flag, keeps a caller's env value, logs a
 *    missing plugin once and reports it.
 *  - the doctor check, with an injected runner (no claude, no API key).
 *
 * Mock-first: a fake filesystem; nothing here reads the real ~/.claude.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { resolvePluginPaths, type PluginFs } from '../../src/mods/plugin-paths.js';
import { existingPluginDirs, resetHeadlessPluginWarnings, withHeadlessPlugins, workerProfile } from '../../src/mods/headless-plugins.js';
import { checkHeadlessPlugins, findInitEvent, hasModelCredential, HEARTBEAT, type HeadlessRunner } from '../../src/mods/headless-check.js';

const HOME = '/home/u';
const CFG = join(HOME, '.claude');
const ROOT = '/work/proj';
const CHECKOUT = '/src/ruflo';
const CLONE = join(CFG, 'plugins', 'marketplaces', 'ruflo');
const cacheDir = (cfg: string, v: string) => join(cfg, 'plugins', 'cache', 'ruflo', 'ruflo-mods', v);
const manifestIn = (dir: string) => join(dir, '.claude-plugin', 'plugin.json');

/** Fake fs: files (with text), plus directory listings derived from every path. */
function fakeFs(files: Record<string, unknown>, dirs: string[] = []): PluginFs {
  const all = [...Object.keys(files), ...dirs];
  const exists = new Set(all);
  for (const p of all) {
    let d = p;
    while (d !== '/' && d !== '.') {
      d = join(d, '..');
      exists.add(d);
    }
  }
  return {
    exists: (p) => exists.has(p),
    readText: (p) => (p in files ? (typeof files[p] === 'string' ? (files[p] as string) : JSON.stringify(files[p])) : undefined),
    list: (p) => [...new Set(all.filter((x) => x.startsWith(`${p}/`)).map((x) => x.slice(p.length + 1).split('/')[0]!))],
  };
}

const knownLocal = { [join(CFG, 'plugins', 'known_marketplaces.json')]: { ruflo: { source: { source: 'directory', path: CHECKOUT }, installLocation: CHECKOUT } } };
const inCheckout = { [manifestIn(join(CHECKOUT, 'plugins', 'ruflo-mods'))]: '{}' };
const inClone = { [manifestIn(join(CLONE, 'plugins', 'ruflo-mods'))]: '{}' };
const opts = (fs: PluginFs, env: NodeJS.ProcessEnv = {}) => ({ projectRoot: ROOT, env, home: HOME, fs });

describe('ADR-510 resolvePluginPaths', () => {
  it('prefers a directory marketplace Claude Code knows (user-level) over the clone and the cache', () => {
    const fs = fakeFs({ ...knownLocal, ...inCheckout, ...inClone, [manifestIn(cacheDir(CFG, '0.8.0'))]: '{}' }, [CHECKOUT]);
    expect(resolvePluginPaths(['ruflo-mods'], opts(fs))).toEqual({
      resolved: [{ name: 'ruflo-mods', path: join(CHECKOUT, 'plugins', 'ruflo-mods'), source: 'local' }],
      missing: [],
    });
  });

  it("never lets the project's own settings choose the folder (committed settings.json or settings.local.json)", () => {
    const EVIL = join(ROOT, 'x');
    const inRepo = { [manifestIn(join(EVIL, 'plugins', 'ruflo-mods'))]: '{}' };
    for (const declared of [EVIL, './x']) {
      const entry = { extraKnownMarketplaces: { ruflo: { source: { source: 'directory', path: declared } } } };
      for (const file of ['settings.json', 'settings.local.json']) {
        const settings = { [join(ROOT, '.claude', file)]: entry };
        // With a clone present: the clone wins, never the repo.
        const withClone = resolvePluginPaths(['ruflo-mods'], opts(fakeFs({ ...settings, ...inRepo, ...inClone }, [CLONE])));
        expect(withClone.resolved).toEqual([{ name: 'ruflo-mods', path: join(CLONE, 'plugins', 'ruflo-mods'), source: 'clone' }]);
        // With only the cache: the cache wins.
        const withCache = resolvePluginPaths(['ruflo-mods'], opts(fakeFs({ ...settings, ...inRepo, [manifestIn(cacheDir(CFG, '0.8.0'))]: '{}' })));
        expect(withCache.resolved[0]).toMatchObject({ source: 'cache', path: cacheDir(CFG, '0.8.0') });
        // With nothing installed: missing, and the repo folder is not even mentioned.
        const nothing = resolvePluginPaths(['ruflo-mods'], opts(fakeFs({ ...settings, ...inRepo })));
        expect(nothing.resolved).toEqual([]);
        expect(nothing.missing[0]!.reason).not.toContain(ROOT);
      }
    }
  });

  it('a relative directory path, even in known_marketplaces.json, is rejected', () => {
    const rel = { [join(CFG, 'plugins', 'known_marketplaces.json')]: { ruflo: { source: { source: 'directory', path: './x' } } } };
    const fs = fakeFs({ ...rel, [manifestIn(join(ROOT, 'x', 'plugins', 'ruflo-mods'))]: '{}', [manifestIn(join('x', 'plugins', 'ruflo-mods'))]: '{}', [manifestIn(cacheDir(CFG, '0.8.0'))]: '{}' });
    expect(resolvePluginPaths(['ruflo-mods'], opts(fs)).resolved[0]).toMatchObject({ source: 'cache' });
  });

  it('falls back to the marketplace clone, honouring marketplace.json source', () => {
    const fs = fakeFs({ ...inClone }, [CLONE]);
    expect(resolvePluginPaths(['ruflo-mods@ruflo'], opts(fs)).resolved).toEqual([{ name: 'ruflo-mods', path: join(CLONE, 'plugins', 'ruflo-mods'), source: 'clone' }]);
    const moved = fakeFs({ [join(CLONE, '.claude-plugin', 'marketplace.json')]: { plugins: [{ name: 'ruflo-mods', source: './x/mods' }] }, [manifestIn(join(CLONE, 'x', 'mods'))]: '{}' }, [CLONE]);
    expect(resolvePluginPaths(['ruflo-mods'], opts(moved)).resolved[0]!.path).toBe(join(CLONE, 'x', 'mods'));
  });

  it('then the install cache: installed_plugins.json path first, else the highest version folder', () => {
    const scan = fakeFs({ [manifestIn(cacheDir(CFG, '0.9.0'))]: '{}', [manifestIn(cacheDir(CFG, '0.10.0'))]: '{}', [join(cacheDir(CFG, '0.11.0'), 'README.md')]: '' });
    expect(resolvePluginPaths(['ruflo-mods'], opts(scan)).resolved[0]).toEqual({ name: 'ruflo-mods', path: cacheDir(CFG, '0.10.0'), source: 'cache' });
    const recorded = fakeFs({
      [join(CFG, 'plugins', 'installed_plugins.json')]: { plugins: { 'ruflo-mods@ruflo': [{ scope: 'user', installPath: cacheDir(CFG, '0.9.0') }] } },
      [manifestIn(cacheDir(CFG, '0.9.0'))]: '{}',
      [manifestIn(cacheDir(CFG, '0.10.0'))]: '{}',
    });
    expect(resolvePluginPaths(['ruflo-mods'], opts(recorded)).resolved[0]!.path).toBe(cacheDir(CFG, '0.9.0'));
  });

  it('a folder without .claude-plugin/plugin.json is reported missing, never returned', () => {
    const fs = fakeFs({ ...knownLocal, [join(CHECKOUT, 'plugins', 'ruflo-mods', 'README.md')]: '', [join(CLONE, 'plugins', 'ruflo-mods', 'hooks', 'index.ts')]: '' }, [CHECKOUT]);
    const r = resolvePluginPaths(['ruflo-mods'], opts(fs));
    expect(r.resolved).toEqual([]);
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0]!.name).toBe('ruflo-mods');
    expect(r.missing[0]!.reason).toContain('.claude-plugin');
  });

  it('honours CLAUDE_CONFIG_DIR instead of ~/.claude', () => {
    const alt = '/alt/cfg';
    const fs = fakeFs({ [manifestIn(cacheDir(alt, '1.0.0'))]: '{}', [manifestIn(cacheDir(CFG, '2.0.0'))]: '{}' });
    expect(resolvePluginPaths(['ruflo-mods'], opts(fs, { CLAUDE_CONFIG_DIR: alt })).resolved[0]!.path).toBe(cacheDir(alt, '1.0.0'));
    expect(resolvePluginPaths(['ruflo-mods'], opts(fs)).resolved[0]!.path).toBe(cacheDir(CFG, '2.0.0'));
  });
});

describe('ADR-510 withHeadlessPlugins', () => {
  const MODS = join(CLONE, 'plugins', 'ruflo-mods');
  const found = () => ({ resolved: [{ name: 'ruflo-mods', path: MODS, source: 'clone' as const }], missing: [] });
  const none = () => ({ resolved: [], missing: [{ name: 'ruflo-mods', reason: 'no manifest' }] });
  let lines: string[];
  beforeEach(() => {
    lines = [];
    resetHeadlessPluginWarnings();
  });
  const warn = (l: string) => lines.push(l);

  it('adds --plugin-dir and turns function hooks on', () => {
    const r = withHeadlessPlugins(['-p', '--output-format', 'json'], { PATH: '/bin' }, { resolver: found, warn });
    expect(r.argv).toEqual(['-p', '--output-format', 'json', '--plugin-dir', MODS]);
    expect(r.env).toEqual({ PATH: '/bin', CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' });
    expect(r.added).toEqual(['ruflo-mods']);
    expect(lines).toEqual([]);
  });

  it("keeps a caller's own CLAUDE_CODE_ENABLE_FUNCTION_HOOKS value", () => {
    const r = withHeadlessPlugins(['-p'], { CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '0' }, { resolver: found, warn });
    expect(r.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS).toBe('0');
  });

  it("does not duplicate a caller's own --plugin-dir (same folder, = form, or its own copy)", () => {
    for (const own of [['--plugin-dir', MODS], [`--plugin-dir=${MODS}`], ['--plugin-dir', '/elsewhere/ruflo-mods']]) {
      const r = withHeadlessPlugins(['-p', ...own], {}, { resolver: found, warn });
      expect(existingPluginDirs(r.argv)).toHaveLength(1);
      expect(r.added).toEqual([]);
      expect(r.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS).toBe('1');
    }
  });

  it('a missing plugin: the worker still starts, the miss is logged once and reported', () => {
    const a = withHeadlessPlugins(['-p'], {}, { resolver: none, warn });
    const b = withHeadlessPlugins(['-p'], {}, { resolver: none, warn });
    expect(a.argv).toEqual(['-p']);
    expect(a.missing).toEqual(['ruflo-mods']);
    expect(b.missing).toEqual(['ruflo-mods']);
    expect(lines).toEqual(['plugin ruflo-mods not found; worker runs without it']);
    expect(a.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS).toBeUndefined();
  });

  it('RUFLO_HEADLESS_PLUGINS picks the profile; none turns staging off', () => {
    expect(workerProfile({})).toEqual(['ruflo-mods']);
    expect(workerProfile({ RUFLO_HEADLESS_PLUGINS: 'ruflo-mods, ruflo-swarm' })).toEqual(['ruflo-mods', 'ruflo-swarm']);
    expect(workerProfile({ RUFLO_HEADLESS_PLUGINS: 'none' })).toEqual([]);
    const r = withHeadlessPlugins(['-p'], { RUFLO_HEADLESS_PLUGINS: 'none' }, { resolver: found, warn });
    expect(r.argv).toEqual(['-p']);
  });
});

describe('ADR-510 doctor --component headless-plugins', () => {
  const MODS = '/plugins/ruflo-mods';
  const resolved = () => ({ resolved: [{ name: 'ruflo-mods', path: MODS, source: 'clone' as const }], missing: [] });
  const init = (extra: Record<string, unknown> = {}) =>
    `${JSON.stringify({ type: 'system', subtype: 'hook_started' })}\n${JSON.stringify({ type: 'system', subtype: 'init', plugins: [{ name: 'ruflo-mods', path: MODS, source: 'ruflo-mods@inline' }], ...extra })}\n${JSON.stringify({ type: 'result', subtype: 'success', result: 'ok' })}\n`;
  let seen: { argv: string[]; env: NodeJS.ProcessEnv; cwd: string } | null;
  const runner = (stdout: string, writeHeartbeat: boolean): HeadlessRunner => async (argv, env, cwd) => {
    seen = { argv, env, cwd };
    if (writeHeartbeat) beat.add(join(cwd, HEARTBEAT));
    return { exitCode: 0, stdout, stderr: '' };
  };
  const beat = new Set<string>();
  const exists = (p: string) => beat.has(p);
  afterEach(() => {
    beat.clear();
    seen = null;
  });

  it('pass: init lists ruflo-mods, no plugin_errors, heartbeat written', async () => {
    const r = await checkHeadlessPlugins({ resolve: resolved, runner: runner(init(), true), exists, env: {} });
    expect(r.status).toBe('pass');
    expect(r.message).toContain('heartbeat: written');
    expect(seen!.argv).toEqual(expect.arrayContaining(['-p', '--plugin-dir', MODS, '--output-format', 'stream-json', '--verbose']));
    expect(seen!.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS).toBe('1');
  });

  it('warn: the plugin loads but no heartbeat (hooks did not run)', async () => {
    const r = await checkHeadlessPlugins({ resolve: resolved, runner: runner(init(), false), exists, env: {} });
    expect(r.status).toBe('warn');
    expect(r.message).toContain('heartbeat: absent');
  });

  it('fail: ruflo-mods not in the init event, or plugin_errors present', async () => {
    const missingInit = `${JSON.stringify({ type: 'system', subtype: 'init', plugins: [] })}\n`;
    expect((await checkHeadlessPlugins({ resolve: resolved, runner: runner(missingInit, false), exists, env: {} })).status).toBe('fail');
    const errs = await checkHeadlessPlugins({ resolve: resolved, runner: runner(init({ plugin_errors: [{ plugin: 'ruflo-mods', error: 'bad' }] }), true), exists, env: {} });
    expect(errs.status).toBe('fail');
    expect(errs.message).toContain('bad');
  });

  it('fail: no init event at all (claude errored)', async () => {
    const r = await checkHeadlessPlugins({ resolve: resolved, runner: async () => ({ exitCode: 1, stdout: '', stderr: 'Invalid API key' }), exists, env: {} });
    expect(r.status).toBe('fail');
    expect(r.message).toContain('Invalid API key');
  });

  it('warn without spawning when ruflo-mods is not found, or no model credential exists', async () => {
    let ran = false;
    const r = await checkHeadlessPlugins({ resolve: () => ({ resolved: [], missing: [{ name: 'ruflo-mods', reason: 'nowhere' }] }), runner: async () => { ran = true; return { exitCode: 0, stdout: '', stderr: '' }; }, env: {} });
    expect(r.status).toBe('warn');
    expect(ran).toBe(false);
    const skipped = await checkHeadlessPlugins({ resolve: resolved, exists: () => false, env: {}, home: '/nohome' });
    if (process.platform !== 'darwin') {
      expect(skipped.status).toBe('warn');
      expect(skipped.message).toMatch(/^skipped: no model credential/);
    }
  });

  it('credential detection and init parsing', () => {
    expect(hasModelCredential({ ANTHROPIC_API_KEY: 'x' }, '/c', () => false)).toBe(true);
    expect(hasModelCredential({}, '/c', (p) => p === '/c/.credentials.json')).toBe(true);
    expect(findInitEvent('noise\n{"type":"system","subtype":"init","plugins":[]}\n')).toEqual({ type: 'system', subtype: 'init', plugins: [] });
    expect(findInitEvent('{"type":"result"}')).toBeNull();
  });
});
