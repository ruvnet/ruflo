/**
 * #4773: the doctor checks moved out of commands/doctor.ts into
 * commands/doctor-checks/. This snapshots doctor's complete output so that move,
 * and any later one, must leave it byte-identical.
 *
 * Every input doctor reads from the machine is pinned rather than normalized
 * away: a fresh project and HOME, an env allowlist, fixed answers for the
 * commands it shells out to, the native-addon probe (it depends on the Node
 * minor), the MCP tool list, the optional @metaharness/* packages (two need
 * a build that succeeds on some platforms) and the optional metaharness peer,
 * which CI's `npm ci --legacy-peer-deps` never installs. The only substitutions are exact
 * values read from the same files the checks read, so a wrong value (a version
 * fallback, a mis-resolved package) still shows up as a diff.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const shell = vi.hoisted(() => {
  const answers: Record<string, string> = {
    'npm --version': '10.9.0',
    'git --version': 'git version 2.47.0',
    'df -Ph . | tail -1': '/dev/sda1 100G 40G 60G 40% /',
    'claude --version': '2.0.0 (Claude Code)',
  };
  // Anything not in the table behaves like a missing binary.
  const run = async (command: string) => {
    if (Object.hasOwn(answers, command)) return { stdout: `${answers[command]}\n`, stderr: '' };
    throw Object.assign(new Error(`spawn ${command.split(' ')[0]} ENOENT`), { code: 'ENOENT' });
  };
  return { run };
});

// doctor promisifies exec/execFile when it loads, so the fakes carry
// util.promisify.custom and must be in place before it is imported. They are
// plain functions, not vi.fn(), so the root config's mockReset leaves them alone.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const { promisify } = await import('node:util');
  const unexpected = () => { throw new Error('doctor called child_process without promisify'); };
  const exec = Object.assign(unexpected, { [promisify.custom]: (command: string) => shell.run(command) });
  const execFile = Object.assign(() => unexpected(), {
    [promisify.custom]: (file: string, args: string[] = []) => shell.run([file, ...args].join(' ')),
  });
  return { ...actual, exec, execFile, default: { ...actual, exec, execFile } };
});

const METAHARNESS_PACKAGE = /[\\/]node_modules[\\/]@metaharness[\\/][^\\/]+[\\/]package\.json$/;
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const existsSync = (path: import('fs').PathLike) => !METAHARNESS_PACKAGE.test(String(path)) && actual.existsSync(path);
  return { ...actual, existsSync, default: { ...actual, existsSync } };
});

// The MetaHarness check resolves the peer with import.meta.resolve and then
// converts the URL to a path. Failing that conversion lands a local install in
// the same not-installed branch that CI takes. The pattern lives in the factory
// because modules call fileURLToPath while they load, before top-level consts.
vi.mock('url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('url')>();
  const METAHARNESS_PEER = /[\\/]node_modules[\\/]metaharness[\\/]/;
  const fileURLToPath = (url: string | URL) => {
    const path = actual.fileURLToPath(url);
    if (METAHARNESS_PEER.test(path)) throw Object.assign(new Error("Cannot find package 'metaharness'"), { code: 'ERR_MODULE_NOT_FOUND' });
    return path;
  };
  return { ...actual, fileURLToPath, default: { ...actual, fileURLToPath } };
});

vi.mock('../src/mcp-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/mcp-client.js')>();
  const schema = { type: 'object' as const, properties: { key: { type: 'string', description: 'Entry key' } }, required: ['key'] };
  return {
    ...actual,
    listMCPTools: () => [
      { name: 'memory_retrieve', description: 'Read one memory entry', inputSchema: schema, category: 'memory' },
      { name: 'memory_delete', description: 'Delete one memory entry', inputSchema: schema, category: 'memory' },
    ],
  };
});

import { doctorCommand } from '../src/commands/doctor.js';
import * as nativeAddon from '../src/commands/doctor-native-addon.js';
import { CommandParser } from '../src/parser.js';
import { output } from '../src/output.js';
import { readMemoryPackageVersion, resolveMemoryPackageFromCli } from '../src/init/memory-package-resolver.js';

const cliRoot = fileURLToPath(new URL('..', import.meta.url));
const cliPkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf-8')) as {
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};
const memoryDeclared = cliPkg.optionalDependencies?.['@claude-flow/memory'] ?? cliPkg.dependencies?.['@claude-flow/memory'];
const memoryDist = resolveMemoryPackageFromCli();
const memoryInstalled = memoryDist ? readMemoryPackageVersion(memoryDist) : null;
const realNativeAddonCheck = nativeAddon.checkNativeAddonHeaders;

const KEEP_ENV = /^(PATH|Path|TMPDIR|TEMP|TMP|SystemRoot|ComSpec|VITEST.*)$/;

describe('doctor output stays byte-identical (#4773)', () => {
  let stdout: string;
  let project: string;
  let home: string;
  let previousCwd: string;
  let previousEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'ruflo-doctor-4773-project-'));
    home = mkdtempSync(join(tmpdir(), 'ruflo-doctor-4773-home-'));
    previousCwd = process.cwd();
    previousEnv = { ...process.env };
    for (const key of Object.keys(process.env)) if (!KEEP_ENV.test(key)) delete process.env[key];
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.chdir(project);

    stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(output, 'createSpinner').mockReturnValue({ start() {}, stop() {} } as unknown as ReturnType<typeof output.createSpinner>);
    vi.spyOn(nativeAddon, 'checkNativeAddonHeaders').mockImplementation(() => realNativeAddonCheck({ nodeVersion: '22.0.0' }));
    output.setColorEnabled(false);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previousEnv);
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  async function run(args: string[]): Promise<string> {
    const parser = new CommandParser();
    parser.registerCommand(doctorCommand);
    const parsed = parser.parse(['doctor', ...args]);
    await doctorCommand.action!({ flags: parsed.flags, args: parsed.positional, cwd: project, interactive: false });
    const exact: Array<[string, string]> = [
      [realpathSync(project), '<project>'],
      [project, '<project>'],
      [realpathSync(home), '<home>'],
      [home, '<home>'],
      [`v${cliPkg.version}`, 'v<cli-version>'],
      [process.version, '<node-version>'],
      [`v${memoryInstalled}`, 'v<memory-installed>'],
      [`declared ${memoryDeclared}`, 'declared <memory-declared>'],
    ];
    return exact.reduce((text, [value, label]) => text.split(value).join(label), stdout);
  }

  it('bare doctor', async () => {
    expect(await run([])).toMatchSnapshot();
  });

  it('doctor --fix', async () => {
    expect(await run(['--fix'])).toMatchSnapshot();
  });

  // Bare `doctor --json` only prints "missing a stable JSON ID" today (the
  // auto-approve entry is a fresh arrow function in allChecks and in checkIds),
  // so the JSON case uses a grouped component that does map to IDs.
  it('doctor --json -c memory', async () => {
    expect(await run(['--json', '-c', 'memory'])).toMatchSnapshot();
  });
});
