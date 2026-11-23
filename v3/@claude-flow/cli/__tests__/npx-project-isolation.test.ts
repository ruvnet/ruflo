/**
 * Tool-time `npx` calls must not resolve packages from the opened repository
 * (its node_modules/.bin, dependency tree or .npmrc registry).
 */
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const driver = vi.hoisted(() => {
  const runSessionCommand = vi.fn();
  return {
    runSessionCommand,
    childProcess: {
      execFileSync: vi.fn(),
      execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: runSessionCommand }),
    },
  };
});
vi.mock('child_process', () => driver.childProcess);
vi.mock('node:child_process', () => driver.childProcess);
vi.mock('../src/runtime/browser-command.js', () => ({
  resolveAgentBrowserLaunch: () => null,
  resolveNpxLaunch: () => ({ command: 'npx', argsPrefix: [] }),
}));

// Exercise the npx fallback for ruvector regardless of what the host has installed.
vi.mock('node:module', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:module')>(),
  createRequire: () => ({ resolve: () => { throw new Error('ruvector unavailable in test'); } }),
}));

import { execBrowserCommand } from '../src/mcp-tools/browser-tools.js';
import { browserSessionTools } from '../src/mcp-tools/browser-session-tools.js';
import { npmGlobalConfigPath, npxIsolationArgs, npxPrefixDir } from '../src/runtime/npx-isolation.js';

let project: string;
let home: string;
const realCwd = process.cwd();
const realHome = process.env.HOME;

/** The --prefix value in an npx argv, or undefined. */
function prefixOf(argv: string[]): string | undefined {
  const i = argv.indexOf('--prefix');
  return i >= 0 ? argv[i + 1] : undefined;
}
const outside = (dir: string, root: string) => {
  const rel = relative(root, dir);
  return rel.startsWith('..') || isAbsolute(rel);
};

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'npx-iso-project-'));
  home = mkdtempSync(join(tmpdir(), 'npx-iso-home-'));
  writeFileSync(join(project, 'package.json'), '{"name":"opened-repo","version":"1.0.0"}');
  writeFileSync(join(project, '.npmrc'), 'registry=http://127.0.0.1:9/\n');
  mkdirSync(join(project, 'node_modules', '.bin'), { recursive: true });
  process.chdir(project);
  process.env.HOME = home;
  driver.childProcess.execFileSync.mockReset().mockReturnValue('{"success":true}');
  driver.runSessionCommand.mockReset().mockResolvedValue({ stdout: '', stderr: '' });
});

afterEach(() => {
  process.chdir(realCwd);
  if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
  rmSync(project, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe('tool-time npx is isolated from the project directory', () => {
  it('browser tools pass a ruflo-owned --prefix to the npx fallback', async () => {
    await execBrowserCommand(['open', 'https://example.invalid/'], 's1');
    const [command, argv] = driver.childProcess.execFileSync.mock.calls.at(-1)!;
    expect(command).toBe('npx');
    const prefix = prefixOf(argv);
    expect(prefix).toBeTruthy();
    expect(outside(prefix!, project)).toBe(true);
    expect(argv.indexOf('--prefix')).toBeLessThan(argv.indexOf('agent-browser'));
  });

  it('browser session tools pass a ruflo-owned --prefix to every npx call', async () => {
    const tool = browserSessionTools.find(t => t.name === 'browser_session_end')!;
    await tool.handler({ session: 's1', rvf_path: join('.ruflo', 'browser-sessions', 's1.rvf'), verdict: 'pass' }, {} as never);
    const npxCalls = driver.runSessionCommand.mock.calls.filter(([cmd]) => cmd === 'npx');
    expect(npxCalls.length).toBeGreaterThan(0);
    for (const [, argv] of npxCalls) {
      const prefix = prefixOf(argv as string[]);
      expect(prefix).toBeTruthy();
      expect(outside(prefix!, project)).toBe(true);
    }
  });

  it('the --prefix makes npm ignore the project .npmrc', async () => {
    const real = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    let registry: string;
    try {
      registry = real.execFileSync('npm', [...npxIsolationArgs(home), 'config', 'get', 'registry'], {
        cwd: project, encoding: 'utf-8', env: { ...process.env, HOME: home },
      }).trim();
    } catch {
      return; // npm not available on this runner
    }
    expect(registry).not.toContain('127.0.0.1:9');
  });

  it('the --prefix keeps the child in the project directory', async () => {
    // Relative paths in tool argv (RVF files, screenshots) and the memory CLI's
    // project store must still resolve against the opened project.
    const real = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    let cwd: string;
    try {
      cwd = real.execFileSync('npm', ['exec', ...npxIsolationArgs(home), '-c', 'node -p process.cwd()'], {
        cwd: project, encoding: 'utf-8', env: { ...process.env, HOME: home },
      }).trim();
    } catch {
      return; // npm not available on this runner
    }
    expect(realpathSync(cwd)).toBe(realpathSync(project));
  });

  it('keeps the user global npmrc, which npm would otherwise look for under the prefix', async () => {
    expect(npxIsolationArgs(home)).toContain('--globalconfig');
    if (process.platform !== 'win32') {
      expect(npmGlobalConfigPath({}, '/opt/node/bin/node')).toBe('/opt/node/etc/npmrc');
    }
    expect(npmGlobalConfigPath({ npm_config_globalconfig: '/custom/npmrc' })).toBe('/custom/npmrc');

    const globalRc = join(home, 'global-npmrc');
    writeFileSync(globalRc, 'registry=http://127.0.0.1:7/\n');
    const real = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const env = { ...process.env, HOME: home };
    for (const k of Object.keys(env)) if (/^npm_config_/i.test(k)) delete env[k];
    let registry: string;
    try {
      registry = real.execFileSync('npm', ['--prefix', npxPrefixDir(home), '--globalconfig', globalRc, 'config', 'get', 'registry'], {
        cwd: project, encoding: 'utf-8', env,
      }).trim();
    } catch {
      return; // npm not available on this runner
    }
    expect(registry).toContain('127.0.0.1:7');
  });
});
