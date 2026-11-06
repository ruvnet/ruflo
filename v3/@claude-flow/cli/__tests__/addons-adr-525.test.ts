/**
 * ADR-525: heavy capabilities are installed on demand with `ruflo add`, into
 * a user-level add-on root, and resolved from there without executing code.
 * Hermetic: every test points RUFLO_ADDONS_DIR at a temp dir; no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADDONS,
  addonHint,
  addonRoot,
  importAddon,
  isAddonName,
  parseSpecifier,
  resolveAddonModule,
  resolveAddonPackageRoot,
  resolveExportsTarget,
} from '../src/addons/index.js';

const FAKE = 'ruflo-adr525-fake-addon';
let root: string;
let savedEnv: string | undefined;

function writePackage(name: string, pkg: Record<string, unknown>, files: Record<string, string>): string {
  const dir = join(root, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '3.1.4', ...pkg }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

beforeEach(() => {
  savedEnv = process.env.RUFLO_ADDONS_DIR;
  root = mkdtempSync(join(tmpdir(), 'ruflo-addons-525-'));
  process.env.RUFLO_ADDONS_DIR = root;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.RUFLO_ADDONS_DIR;
  else process.env.RUFLO_ADDONS_DIR = savedEnv;
  rmSync(root, { recursive: true, force: true });
  vi.doUnmock('node:child_process');
  vi.doUnmock('../src/addons/index.js');
  vi.resetModules();
});

describe('add-on registry', () => {
  it('registers learning as agentic-flow at the tested range', () => {
    expect(ADDONS.learning).toMatchObject({ pkg: 'agentic-flow', range: '^3.0.0' });
    expect(Object.isFrozen(ADDONS)).toBe(true);
  });

  it.each(['learning'])('accepts %s', (name) => expect(isAddonName(name)).toBe(true));
  it.each(['nope', 'agentic-flow', '__proto__', 'toString', 'constructor', '', 'learning ', 42, null])(
    'rejects %j',
    (name) => expect(isAddonName(name)).toBe(false),
  );

  it('hints with the exact install command', () => {
    expect(addonHint('learning')).toBe('autopilot learning needs agentic-flow: run `ruflo add learning`');
    expect(addonHint('learning', 'ReasoningBank retrieval')).toBe('ReasoningBank retrieval needs agentic-flow: run `ruflo add learning`');
  });
});

describe('addonRoot', () => {
  it('honours RUFLO_ADDONS_DIR', () => {
    expect(addonRoot()).toBe(root);
  });

  it('defaults to ~/.ruflo/addons', () => {
    delete process.env.RUFLO_ADDONS_DIR;
    expect(addonRoot()).toBe(join(homedir(), '.ruflo', 'addons'));
    process.env.RUFLO_ADDONS_DIR = '   ';
    expect(addonRoot()).toBe(join(homedir(), '.ruflo', 'addons'));
  });
});

describe('specifier parsing', () => {
  it('splits package and subpath', () => {
    expect(parseSpecifier('agentic-flow')).toEqual({ pkg: 'agentic-flow', subpath: '.' });
    expect(parseSpecifier('agentic-flow/reasoningbank')).toEqual({ pkg: 'agentic-flow', subpath: './reasoningbank' });
    expect(parseSpecifier('@scope/pkg/a/b')).toEqual({ pkg: '@scope/pkg', subpath: './a/b' });
  });

  it.each(['../x', 'pkg/../../etc', '/abs/path', 'pkg//x', 'pkg/./x', '@scope', 'pkg\\x', '', 'C:\\x'])('rejects %j', (spec) => {
    expect(parseSpecifier(spec)).toBeNull();
  });
});

describe('exports resolution', () => {
  it('handles string, condition objects, subpath maps, patterns and require-only', () => {
    expect(resolveExportsTarget('./main.js', '.')).toBe('./main.js');
    expect(resolveExportsTarget('./main.js', './x')).toBeNull();
    expect(resolveExportsTarget({ import: './esm.js', require: './cjs.js' }, '.')).toBe('./esm.js');
    expect(resolveExportsTarget({ require: './cjs.js' }, '.')).toBe('./cjs.js');
    expect(resolveExportsTarget({ browser: './b.js', node: './n.js', default: './d.js' }, '.')).toBe('./n.js');
    expect(resolveExportsTarget({ default: './d.js', node: './n.js' }, '.')).toBe('./d.js');
    const map = {
      '.': './dist/index.js',
      './reasoningbank': { node: './dist/rb/index.js', browser: './dist/rb/wasm.js', default: './dist/rb/index.js' },
      './nested': { import: { node: './dist/nested.mjs' }, require: './dist/nested.cjs' },
      './features/*': './dist/features/*.js',
    };
    expect(resolveExportsTarget(map, '.')).toBe('./dist/index.js');
    expect(resolveExportsTarget(map, './reasoningbank')).toBe('./dist/rb/index.js');
    expect(resolveExportsTarget(map, './nested')).toBe('./dist/nested.mjs');
    expect(resolveExportsTarget(map, './features/a')).toBe('./dist/features/a.js');
    expect(resolveExportsTarget(map, './dist/coordination/x.js')).toBeNull();
  });
});

describe('resolveAddonModule against the add-on root', () => {
  it('resolves string, conditional and subpath exports to file URLs', () => {
    const dir = writePackage(FAKE, {
      type: 'module',
      exports: {
        '.': './dist/index.js',
        './cond': { browser: './dist/browser.js', node: './dist/node.js', default: './dist/index.js' },
        './sub': './dist/sub/entry.js',
        './escape': '../outside.js',
        './missing': './dist/not-there.js',
      },
    }, {
      'dist/index.js': 'export const answer = 42;',
      'dist/node.js': 'export const which = "node";',
      'dist/browser.js': 'export const which = "browser";',
      'dist/sub/entry.js': 'export const sub = true;',
    });

    expect(fileURLToPath(resolveAddonModule(FAKE)!)).toBe(join(dir, 'dist', 'index.js'));
    expect(fileURLToPath(resolveAddonModule(`${FAKE}/cond`)!)).toBe(join(dir, 'dist', 'node.js'));
    expect(fileURLToPath(resolveAddonModule(`${FAKE}/sub`)!)).toBe(join(dir, 'dist', 'sub', 'entry.js'));
    expect(resolveAddonModule(`${FAKE}/escape`)).toBeNull();
    expect(resolveAddonModule(`${FAKE}/missing`)).toBeNull();
    expect(resolveAddonModule(`${FAKE}/dist/index.js`)).toBeNull();
    expect(resolveAddonPackageRoot(FAKE)).toEqual({ dir, source: 'addon' });
  });

  it('accepts a top-level condition object and falls back to main without exports', () => {
    const condDir = writePackage(`${FAKE}-cond`, { exports: { import: './esm.js', require: './cjs.js' } }, {
      'esm.js': 'export {}', 'cjs.js': 'module.exports = {}',
    });
    const mainDir = writePackage(`${FAKE}-main`, { main: 'lib/main.js' }, { 'lib/main.js': 'module.exports = {}' });
    expect(fileURLToPath(resolveAddonModule(`${FAKE}-cond`)!)).toBe(join(condDir, 'esm.js'));
    expect(fileURLToPath(resolveAddonModule(`${FAKE}-main`)!)).toBe(join(mainDir, 'lib', 'main.js'));
  });

  it('returns null when the package is installed nowhere', () => {
    expect(resolveAddonModule(`${FAKE}-absent/x`)).toBeNull();
    expect(resolveAddonPackageRoot(`${FAKE}-absent`)).toBeNull();
  });
});

describe('importAddon', () => {
  it('returns null (never throws) when the add-on is missing', async () => {
    await expect(importAddon(`${FAKE}-absent/reasoningbank`)).resolves.toBeNull();
    await expect(importAddon('../escape')).resolves.toBeNull();
  });

  it('loads a module from the add-on root by file URL', async () => {
    writePackage(FAKE, { type: 'module', exports: { './rb': './rb.js' } }, { 'rb.js': 'export const answer = 42;' });
    const mod = await importAddon<{ answer: number }>(`${FAKE}/rb`);
    expect(mod?.answer).toBe(42);
  });
});

describe('ruflo add', () => {
  async function loadAdd(spawnImpl: ReturnType<typeof vi.fn>) {
    vi.resetModules();
    vi.doMock('node:child_process', async (importOriginal) => ({
      ...(await importOriginal<typeof import('node:child_process')>()),
      spawn: spawnImpl,
    }));
    vi.doMock('../src/addons/index.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/addons/index.js')>()),
      resolveAddonPackageRoot: () => null,
    }));
    return import('../src/commands/add.js');
  }

  function fakeChild(code: number) {
    const handlers: Record<string, (arg: unknown) => void> = {};
    const child = { on: (event: string, cb: (arg: unknown) => void) => { handlers[event] = cb; return child; } };
    setTimeout(() => handlers.close?.(code), 0);
    return child;
  }

  it('builds the exact npm argv', async () => {
    const { buildNpmInstallArgs } = await loadAdd(vi.fn());
    expect(buildNpmInstallArgs('learning', '/r')).toEqual([
      'install', '--no-audit', '--no-fund', '--prefix', '/r', 'agentic-flow@^3.0.0',
    ]);
  });

  it('runs npm from an argument array with no shell', async () => {
    const spawn = vi.fn(() => fakeChild(0));
    const { addCommand, resolveNpmInvocation } = await loadAdd(spawn);
    const result = await addCommand.action!({ args: ['learning'], flags: {}, cwd: root, interactive: false } as never);
    expect(result).toMatchObject({ success: true });
    expect(spawn).toHaveBeenCalledTimes(1);
    const npm = resolveNpmInvocation()!;
    const [command, argv, options] = spawn.mock.calls[0] as unknown as [string, string[], { shell?: boolean }];
    expect(command).toBe(npm.command);
    expect(argv).toEqual([...npm.prefixArgs, 'install', '--no-audit', '--no-fund', '--prefix', root, 'agentic-flow@^3.0.0']);
    expect(options.shell).toBe(false);
  });

  it('reports a failed npm run', async () => {
    const { addCommand } = await loadAdd(vi.fn(() => fakeChild(3)));
    const result = await addCommand.action!({ args: ['learning'], flags: {}, cwd: root, interactive: false } as never);
    expect(result).toMatchObject({ success: false, exitCode: 3 });
  });

  it.each([['agentic-flow'], ['learning; rm -rf ~'], ['__proto__'], []])('rejects %j without running npm', async (...args) => {
    const spawn = vi.fn();
    const { addCommand } = await loadAdd(spawn);
    const result = await addCommand.action!({ args, flags: {}, cwd: root, interactive: false } as never);
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('--list reports missing add-ons with their install command', async () => {
    const spawn = vi.fn();
    const { addCommand } = await loadAdd(spawn);
    const result = await addCommand.action!({ args: [], flags: { list: true }, cwd: root, interactive: false } as never);
    expect(result.success).toBe(true);
    expect((result.data as { addons: Array<Record<string, string>> }).addons).toEqual([
      expect.objectContaining({ name: 'learning', status: 'missing', where: 'ruflo add learning' }),
    ]);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('doctor', () => {
  it('reports a missing learning add-on as an optional pass with the install command', async () => {
    vi.resetModules();
    vi.doMock('../src/addons/index.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/addons/index.js')>()),
      resolveAddonPackageRoot: () => null,
    }));
    const cwd = process.cwd();
    const project = mkdtempSync(join(tmpdir(), 'ruflo-addons-525-project-'));
    process.chdir(project);
    try {
      const { doctorCommand } = await import('../src/commands/doctor.js');
      const result = await doctorCommand.action!({ args: [], flags: { component: 'agentic-flow' }, cwd: root, interactive: false } as never);
      const checks = (result.data as { results: Array<{ name: string; status: string; message: string }> }).results;
      expect(checks).toEqual([
        { name: 'agentic-flow', status: 'pass', message: 'Not installed (optional): autopilot learning needs agentic-flow: run `ruflo add learning`' },
      ]);
    } finally {
      process.chdir(cwd);
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('finds agentic-flow in the add-on root', async () => {
    writePackage('agentic-flow', { version: '3.1.0', exports: { './reasoningbank': './rb.js' } }, { 'rb.js': '' });
    const cwd = process.cwd();
    const project = mkdtempSync(join(tmpdir(), 'ruflo-addons-525-project-'));
    process.chdir(project);
    try {
      vi.resetModules();
      vi.doMock('../src/addons/index.js', async (importOriginal) => {
        const real = await importOriginal<typeof import('../src/addons/index.js')>();
        return { ...real, resolveAddonPackageRoot: () => ({ dir: join(root, 'node_modules', 'agentic-flow'), source: 'addon' as const }) };
      });
      const { doctorCommand } = await import('../src/commands/doctor.js');
      const result = await doctorCommand.action!({ args: [], flags: { component: 'agentic-flow' }, cwd: root, interactive: false } as never);
      const [check] = (result.data as { results: Array<{ status: string; message: string }> }).results;
      expect(check).toMatchObject({ status: 'pass' });
      expect(check.message).toMatch(/^v3\.1\.0 \(ReasoningBank\) — add-on root$/);
    } finally {
      process.chdir(cwd);
      rmSync(project, { recursive: true, force: true });
    }
  });
});
