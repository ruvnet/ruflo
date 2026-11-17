/**
 * #2854 — dual-host (Claude Code + Codex) marketplace plugin installer.
 * London-school: execFile and fs are fakes; no real host CLI is ever run.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  HostPluginInputError,
  HostPluginManager,
  buildActionArgv,
  formatArgv,
  planSync,
  resolveHostExecutable,
  validatePluginName,
  type HostState,
  type HostSystemDeps,
} from '../src/services/host-plugin-manager.js';

type Handler = (file: string, args: readonly string[]) => { stdout?: string; stderr?: string; fail?: string };

interface FakeOpts {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  executables?: string[];
  files?: Record<string, string>;
  handler?: Handler;
}

function fakeDeps(o: FakeOpts = {}) {
  const exec = new Set(o.executables ?? []);
  const files = o.files ?? {};
  const calls: Array<{ file: string; args: string[] }> = [];
  const deps: HostSystemDeps = {
    platform: o.platform ?? 'linux',
    env: o.env ?? { PATH: '/usr/local/bin:/usr/bin' },
    execPath: '/opt/node/bin/node',
    access: vi.fn(async (p: string) => {
      if (!exec.has(p) && !(p in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }),
    readFile: vi.fn(async (p: string) => {
      if (!(p in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files[p]!;
    }),
    execFile: vi.fn(async (file: string, args: readonly string[]) => {
      calls.push({ file, args: [...args] });
      const r = (o.handler ?? defaultHandler())(file, args);
      if (r.fail) throw Object.assign(new Error(r.fail), { stdout: r.stdout ?? '', stderr: r.stderr ?? r.fail });
      return { stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    }),
  };
  return { deps, calls };
}

const CLAUDE = '/usr/local/bin/claude';
const CODEX = '/usr/local/bin/codex';

interface World {
  claude: Array<{ id: string; version: string; enabled: boolean; scope?: string }>;
  codex: Array<{ name: string; version: string; enabled: boolean }>;
  claudeMarket?: object | null;
  codexMarket?: object | null;
  failOn?: (file: string, args: readonly string[]) => string | undefined;
}

function defaultHandler(w: World = { claude: [], codex: [] }): Handler {
  return (file, args) => {
    const failure = w.failOn?.(file, args);
    if (failure) return { fail: failure };
    const a = args.join(' ');
    const isClaude = file.endsWith('claude') || args.some((x) => x.endsWith('cli.js'));
    if (a.endsWith('plugin list --json')) {
      return isClaude
        ? { stdout: JSON.stringify(w.claude.map((p) => ({ scope: 'user', ...p }))) }
        : { stdout: JSON.stringify({ installed: w.codex.map((p) => ({ ...p, pluginId: `${p.name}@ruflo`, marketplaceName: 'ruflo', installed: true })), available: [] }) };
    }
    if (a.endsWith('plugin marketplace list --json')) {
      if (isClaude) {
        const m = w.claudeMarket === undefined ? { name: 'ruflo', source: 'github', repo: 'ruvnet/ruflo' } : w.claudeMarket;
        return { stdout: JSON.stringify(m ? [m] : []) };
      }
      const m = w.codexMarket === undefined
        ? { name: 'ruflo', root: '/x', marketplaceSource: { sourceType: 'git', source: 'https://github.com/ruvnet/ruflo.git' } }
        : w.codexMarket;
      return { stdout: JSON.stringify({ marketplaces: m ? [m] : [] }) };
    }
    return { stdout: '{}' };
  };
}

function world(w: World, extra: Partial<FakeOpts> = {}) {
  return fakeDeps({ executables: [CLAUDE, CODEX], handler: defaultHandler(w), ...extra });
}

const mutations = (calls: Array<{ file: string; args: string[] }>) =>
  calls.filter((c) => !c.args.join(' ').endsWith('list --json'));

describe('resolveHostExecutable', () => {
  it('finds a host on PATH by fs.access, without a shell or `which`', async () => {
    const { deps, calls } = fakeDeps({ executables: ['/usr/bin/codex'] });
    const r = await resolveHostExecutable('codex', deps);
    expect(r).toEqual({ ok: true, invocation: { host: 'codex', file: '/usr/bin/codex', prefixArgs: [], resolvedFrom: '/usr/bin/codex' } });
    expect(calls).toHaveLength(0); // discovery never executes anything
  });

  it('reports a missing host with an override hint', async () => {
    const { deps } = fakeDeps({ executables: [] });
    const r = await resolveHostExecutable('claude', deps);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/not found on PATH.*RUFLO_CLAUDE_BIN/);
  });

  it('ignores relative PATH entries', async () => {
    const { deps } = fakeDeps({ env: { PATH: 'bin:/usr/bin' }, executables: ['bin/codex'] });
    expect((await resolveHostExecutable('codex', deps)).ok).toBe(false);
  });

  it('prefers a Windows .exe via PATHEXT and spawns it directly', async () => {
    const { deps } = fakeDeps({
      platform: 'win32',
      env: { Path: 'C:\\Program Files\\Codex;C:\\npm', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
      executables: ['C:\\Program Files\\Codex\\codex.exe', 'C:\\npm\\codex.cmd'],
    });
    const r = await resolveHostExecutable('codex', deps);
    expect(r.ok && r.invocation).toEqual({ host: 'codex', file: 'C:\\Program Files\\Codex\\codex.exe', prefixArgs: [], resolvedFrom: 'C:\\Program Files\\Codex\\codex.exe' });
  });

  it('maps a verified npm .cmd shim to `node <bin.js>` instead of cmd.exe', async () => {
    const pkgDir = 'C:\\Users\\a b\\npm\\node_modules\\@openai\\codex';
    const { deps } = fakeDeps({
      platform: 'win32',
      env: { PATH: 'C:\\Users\\a b\\npm', PATHEXT: '.EXE;.CMD', ComSpec: 'C:\\evil\\cmd.exe' },
      executables: ['C:\\Users\\a b\\npm\\codex.cmd'],
      files: {
        [`${pkgDir}\\package.json`]: JSON.stringify({ name: '@openai/codex', bin: { codex: 'bin/codex.js' } }),
        [`${pkgDir}\\bin\\codex.js`]: '',
      },
    });
    const r = await resolveHostExecutable('codex', deps);
    expect(r.ok && r.invocation).toEqual({
      host: 'codex', file: '/opt/node/bin/node', prefixArgs: [`${pkgDir}\\bin\\codex.js`], resolvedFrom: 'C:\\Users\\a b\\npm\\codex.cmd',
    });
  });

  it('rejects a forged .cmd shim whose package identity does not match', async () => {
    const pkgDir = 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code';
    const { deps } = fakeDeps({
      platform: 'win32',
      env: { PATH: 'C:\\npm', PATHEXT: '.CMD' },
      executables: ['C:\\npm\\claude.cmd'],
      files: {
        [`${pkgDir}\\package.json`]: JSON.stringify({ name: 'evil-claude', bin: { claude: 'cli.js' } }),
        [`${pkgDir}\\cli.js`]: '', // entry exists: only the package identity check can reject it
      },
    });
    const r = await resolveHostExecutable('claude', deps);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/rejected unverifiable launcher.*claude\.cmd/);
  });

  it('rejects a shim whose bin escapes its package directory', async () => {
    const pkgDir = 'C:\\npm\\node_modules\\@openai\\codex';
    const { deps } = fakeDeps({
      platform: 'win32', env: { PATH: 'C:\\npm', PATHEXT: '.CMD' }, executables: ['C:\\npm\\codex.cmd'],
      files: { [`${pkgDir}\\package.json`]: JSON.stringify({ name: '@openai/codex', bin: { codex: '..\\..\\..\\evil.js' } }), 'C:\\evil.js': '' },
    });
    expect((await resolveHostExecutable('codex', deps)).ok).toBe(false);
  });

  it('honours an absolute override and refuses a relative one', async () => {
    const ok = fakeDeps({ env: { PATH: '', RUFLO_CODEX_BIN: '/opt/codex/bin/codex' }, executables: ['/opt/codex/bin/codex'] });
    expect((await resolveHostExecutable('codex', ok.deps)).ok).toBe(true);
    const bad = fakeDeps({ env: { PATH: '', RUFLO_CODEX_BIN: 'codex' } });
    const r = await resolveHostExecutable('codex', bad.deps);
    expect(!r.ok && r.reason).toMatch(/absolute path/);
  });
});

describe('validatePluginName', () => {
  it.each(['ruflo-swarm', 'ruflo-core@ruflo', 'a', 'x9'])('accepts %s', (n) => {
    expect(() => validatePluginName(n)).not.toThrow();
  });

  it.each([
    'ruflo-swarm; rm -rf ~', '$(id)', '`id`', 'a|b', 'a&&b', '--scope=project', '-y', 'a b', '../x', 'Ruflo',
    'a\nb', 'ruflo-swarm@evil', '', 'a--b', 'x-', '"quoted"', 'a%PATH%',
  ])('rejects %j before any argv is built', (n) => {
    expect(() => validatePluginName(n)).toThrow(HostPluginInputError);
  });

  it('rejects injection through the manager without executing anything', async () => {
    const { deps, calls } = world({ claude: [], codex: [] });
    await expect(new HostPluginManager(deps).apply('install', ['ok', 'x;touch /tmp/pwn'])).rejects.toThrow(HostPluginInputError);
    expect(calls).toHaveLength(0);
  });

  it('rejects a marketplace source that is not owner/repo', async () => {
    const { deps, calls } = world({ claude: [], codex: [] });
    await expect(new HostPluginManager(deps).apply('install', ['ok'], { marketplace: { source: '--upload-pack=evil' } }))
      .rejects.toThrow(/owner\/repo/);
    expect(calls).toHaveLength(0);
  });
});

describe('buildActionArgv', () => {
  const mp = { source: 'ruvnet/ruflo', name: 'ruflo' };
  it.each([
    ['install', [['plugin', 'install', 'ruflo-swarm@ruflo', '--scope', 'user']]],
    ['update', [['plugin', 'marketplace', 'update', 'ruflo'], ['plugin', 'update', 'ruflo-swarm@ruflo', '--scope', 'user']]],
    ['uninstall', [['plugin', 'uninstall', 'ruflo-swarm@ruflo', '--scope', 'user']]],
    ['enable', [['plugin', 'enable', 'ruflo-swarm@ruflo', '--scope', 'user']]],
    ['disable', [['plugin', 'disable', 'ruflo-swarm@ruflo', '--scope', 'user']]],
  ] as const)('claude %s', (action, argv) => {
    const r = buildActionArgv('claude', action, 'ruflo-swarm', 'user', mp);
    expect(r.supported && r.steps.map((s) => s.argv)).toEqual(argv);
  });

  it.each([
    ['install', [['plugin', 'add', 'ruflo-swarm@ruflo', '--json']]],
    ['update', [['plugin', 'marketplace', 'upgrade', 'ruflo'], ['plugin', 'add', 'ruflo-swarm@ruflo', '--json']]],
    ['uninstall', [['plugin', 'remove', 'ruflo-swarm@ruflo', '--json']]],
  ] as const)('codex %s', (action, argv) => {
    const r = buildActionArgv('codex', action, 'ruflo-swarm', 'user', mp);
    expect(r.supported && r.steps.map((s) => s.argv)).toEqual(argv);
  });

  it.each(['enable', 'disable'] as const)('codex %s is unsupported with a manual fix, not faked', (action) => {
    const r = buildActionArgv('codex', action, 'ruflo-swarm', 'user', mp);
    expect(r.supported).toBe(false);
    expect(!r.supported && r.manual).toContain('[plugins."ruflo-swarm@ruflo"]');
  });

  it('refuses to widen a project scope into user-global Codex state', () => {
    const r = buildActionArgv('codex', 'install', 'ruflo-swarm', 'project', mp);
    expect(r.supported).toBe(false);
    expect(!r.supported && r.reason).toMatch(/user-global/);
  });
});

describe('HostPluginManager.apply', () => {
  it('installs on both hosts with literal argv arrays', async () => {
    const { deps, calls } = world({ claude: [], codex: [] });
    const report = await new HostPluginManager(deps).apply('install', ['ruflo-swarm']);
    expect(report.ok).toBe(true);
    expect(mutations(calls)).toEqual([
      { file: CLAUDE, args: ['plugin', 'install', 'ruflo-swarm@ruflo', '--scope', 'user'] },
      { file: CODEX, args: ['plugin', 'add', 'ruflo-swarm@ruflo', '--json'] },
    ]);
  });

  it('is idempotent: an installed plugin is not reinstalled', async () => {
    const { deps, calls } = world({
      claude: [{ id: 'ruflo-swarm@ruflo', version: '1.0.0', enabled: true }],
      codex: [{ name: 'ruflo-swarm', version: '1.0.0', enabled: true }],
    });
    const report = await new HostPluginManager(deps).apply('install', ['ruflo-swarm']);
    expect(report.ok).toBe(true);
    expect(report.results.map((r) => r.outcome)).toEqual(['unchanged', 'unchanged']);
    expect(mutations(calls)).toHaveLength(0);
  });

  it('registers the marketplace first when a host lacks it', async () => {
    const { deps, calls } = world({ claude: [], codex: [], codexMarket: null });
    await new HostPluginManager(deps).apply('install', ['ruflo-swarm'], { hosts: 'codex' });
    expect(mutations(calls).map((c) => c.args)).toEqual([
      ['plugin', 'marketplace', 'add', 'ruvnet/ruflo'],
      ['plugin', 'add', 'ruflo-swarm@ruflo', '--json'],
    ]);
  });

  it('reports a partial failure per host without hiding the other host, and fails overall', async () => {
    const { deps } = world({
      claude: [], codex: [],
      failOn: (f, a) => (f === CODEX && a[1] === 'add' ? 'codex: network down' : undefined),
    });
    const report = await new HostPluginManager(deps).apply('install', ['ruflo-swarm']);
    expect(report.ok).toBe(false);
    const byHost = Object.fromEntries(report.results.map((r) => [r.host, r]));
    expect(byHost.claude!.outcome).toBe('ok');
    expect(byHost.codex!.outcome).toBe('failed');
    expect(byHost.codex!.steps[0]!.stderr).toContain('network down');
  });

  it('auto host selection skips an absent host; explicit --host both fails on it', async () => {
    const auto = fakeDeps({ executables: [CLAUDE], handler: defaultHandler() });
    const r1 = await new HostPluginManager(auto.deps).apply('install', ['ruflo-swarm']);
    expect(r1.ok).toBe(true);
    expect(r1.results.find((r) => r.host === 'codex')!.outcome).toBe('not-detected');

    const both = fakeDeps({ executables: [CLAUDE], handler: defaultHandler() });
    const r2 = await new HostPluginManager(both.deps).apply('install', ['ruflo-swarm'], { hosts: 'both' });
    expect(r2.ok).toBe(false);
  });

  it('explicit single-host operation never invokes the other host', async () => {
    const { deps, calls } = world({ claude: [], codex: [] });
    await new HostPluginManager(deps).apply('install', ['ruflo-swarm'], { hosts: 'claude' });
    expect(calls.every((c) => c.file === CLAUDE)).toBe(true);
  });

  it('disable succeeds on Claude and reports Codex as unsupported (non-zero overall)', async () => {
    const { deps, calls } = world({
      claude: [{ id: 'ruflo-swarm@ruflo', version: '1', enabled: true }],
      codex: [{ name: 'ruflo-swarm', version: '1', enabled: true }],
    });
    const report = await new HostPluginManager(deps).apply('disable', ['ruflo-swarm']);
    expect(report.ok).toBe(false);
    expect(report.results.map((r) => [r.host, r.outcome])).toEqual([['claude', 'ok'], ['codex', 'unsupported']]);
    expect(mutations(calls).map((c) => c.file)).toEqual([CLAUDE]);
  });

  it('dry-run prints the exact argv and executes no mutation', async () => {
    const { deps, calls } = world({ claude: [], codex: [] });
    const report = await new HostPluginManager(deps).apply('update', ['ruflo-swarm'], { dryRun: true });
    expect(mutations(calls)).toHaveLength(0);
    expect(report.results.flatMap((r) => r.steps.map((s) => s.display))).toEqual([
      'claude plugin marketplace update ruflo',
      'claude plugin update ruflo-swarm@ruflo --scope user',
      'codex plugin marketplace upgrade ruflo',
      'codex plugin add ruflo-swarm@ruflo --json',
    ]);
    expect(report.results.every((r) => r.outcome === 'planned')).toBe(true);
  });
});

describe('sync', () => {
  const mp = { source: 'ruvnet/ruflo', name: 'ruflo' };
  const st = (plugins: Record<string, [string, boolean]>, src: string | null = 'ruvnet/ruflo'): HostState => ({
    plugins: new Map(Object.entries(plugins).map(([k, [version, enabled]]) => [k, { version, enabled }])),
    marketplaceSource: src,
  });

  it('plans the union of enabled plugins, additively, and keeps explicit disables', () => {
    const plan = planSync({
      claude: st({ 'ruflo-swarm': ['1', true], 'ruflo-adr': ['1', true], 'ruflo-off': ['1', false] }),
      codex: st({ 'ruflo-core': ['1', true], 'ruflo-adr': ['1', false] }),
    }, mp);
    expect(plan.map((p) => [p.host, p.target, p.argv?.join(' ') ?? null, p.note])).toEqual([
      ['claude', '(marketplace)', 'plugin marketplace update ruflo', 'refresh marketplace'],
      ['codex', '(marketplace)', 'plugin marketplace upgrade ruflo', 'refresh marketplace'],
      ['codex', 'ruflo-adr', null, 'kept disabled (explicitly disabled in this host)'],
      ['claude', 'ruflo-core', 'plugin install ruflo-core@ruflo --scope user', 'install (enabled in the other host)'],
      ['codex', 'ruflo-swarm', 'plugin add ruflo-swarm@ruflo --json', 'install (enabled in the other host)'],
    ]);
    // ruflo-off is disabled everywhere it exists: not in the union, not installed in Codex.
    expect(plan.some((p) => p.target === 'ruflo-off')).toBe(false);
  });

  it('adds a missing marketplace and refuses one registered from a foreign source', () => {
    const plan = planSync({ claude: st({}, 'dir:/home/me/ruflo'), codex: st({}, null) }, mp);
    expect(plan[0]).toMatchObject({ host: 'claude', argv: null, note: expect.stringMatching(/^refused/) });
    expect(plan[1]).toMatchObject({ host: 'codex', argv: ['plugin', 'marketplace', 'add', 'ruvnet/ruflo'] });
  });

  it('dry-run sync reports the gap without writes', async () => {
    const { deps, calls } = world({ claude: [{ id: 'ruflo-swarm@ruflo', version: '1', enabled: true }], codex: [] });
    const report = await new HostPluginManager(deps).sync({ dryRun: true });
    expect(mutations(calls)).toHaveLength(0);
    expect(report.ok).toBe(true);
    expect(report.results.find((r) => r.target === 'ruflo-swarm')).toMatchObject({ host: 'codex', outcome: 'planned' });
  });

  it('sync executes installs and is non-zero when the marketplace source is foreign', async () => {
    const { deps, calls } = world({
      claude: [{ id: 'ruflo-swarm@ruflo', version: '1', enabled: true }], codex: [],
      claudeMarket: { name: 'ruflo', source: 'directory', path: '/home/me/ruflo' },
    });
    const report = await new HostPluginManager(deps).sync();
    expect(report.ok).toBe(false);
    expect(mutations(calls)).toEqual([
      { file: CODEX, args: ['plugin', 'marketplace', 'upgrade', 'ruflo'] },
      { file: CODEX, args: ['plugin', 'add', 'ruflo-swarm@ruflo', '--json'] },
    ]);
  });

  it('sync needs both hosts', async () => {
    const { deps } = fakeDeps({ executables: [CLAUDE], handler: defaultHandler() });
    const report = await new HostPluginManager(deps).sync();
    expect(report.ok).toBe(false);
    expect(report.results).toEqual([expect.objectContaining({ host: 'codex', outcome: 'not-detected' })]);
  });
});

describe('status', () => {
  it('shows per-host versions and flags drift', async () => {
    const { deps, calls } = world({
      claude: [
        { id: 'ruflo-swarm@ruflo', version: '1.2.0', enabled: true },
        { id: 'ruflo-adr@ruflo', version: '0.5.8', enabled: true },
        { id: 'other@elsewhere', version: '9', enabled: true },
      ],
      codex: [{ name: 'ruflo-swarm', version: '1.1.0', enabled: true }, { name: 'ruflo-core', version: '0.2.11', enabled: false }],
    });
    const s = await new HostPluginManager(deps).status();
    expect(mutations(calls)).toHaveLength(0);
    expect(s.ok).toBe(true);
    expect(s.rows).toEqual([
      { plugin: 'ruflo-adr', claude: { version: '0.5.8', enabled: true }, codex: null, drift: ['missing in codex'] },
      { plugin: 'ruflo-core', claude: null, codex: { version: '0.2.11', enabled: false }, drift: ['missing in claude'] },
      { plugin: 'ruflo-swarm', claude: { version: '1.2.0', enabled: true }, codex: { version: '1.1.0', enabled: true }, drift: ['version 1.2.0 ≠ 1.1.0'] },
    ]);
    expect(s.marketplaces).toEqual({ claude: 'ruvnet/ruflo', codex: 'ruvnet/ruflo' });
  });
});

describe('formatArgv', () => {
  it('quotes anything outside a safe set (display only)', () => {
    expect(formatArgv('claude', ['plugin', 'install', 'a b'])).toBe('claude plugin install "a b"');
  });
});
