/**
 * metaharness_redblue / metaharness_bench forward caller-named files to plugin
 * scripts that read them back (or write them). Over MCP those paths must stay
 * inside the project directory; the subprocess must not even start otherwise.
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  // Pretend the plugin scripts are installed, so the handler reaches spawn.
  return { ...fs, existsSync: vi.fn((p: string) => /ruflo-metaharness[\\/]scripts/.test(String(p)) || fs.existsSync(p)) };
});
vi.mock('../src/metaharness/darwin-lib.js', () => ({
  benchVerify: vi.fn(async () => null),
  gepaOp: vi.fn(async () => null),
}));
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}));

import { metaharnessTools } from '../src/mcp-tools/metaharness-tools.js';
import { localCliContext } from '../src/mcp-tools/path-containment.js';

const mockSpawn = vi.mocked(spawn);
const realCwd = process.cwd();
let project: string;
let outside: string;

function stubChild() {
  mockSpawn.mockImplementation(() => {
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdout, stderr: new PassThrough() });
    queueMicrotask(() => { stdout.end('{"ok":true}'); child.emit('close', 0); });
    return child as ReturnType<typeof spawn>;
  });
}

function call(name: string, input: Record<string, unknown>, context?: unknown) {
  const tool = metaharnessTools.find(t => t.name === name)!;
  return tool.handler(input, context as never) as Promise<Record<string, unknown>>;
}

function spawnedArgs(): string[] {
  expect(mockSpawn).toHaveBeenCalledTimes(1);
  return mockSpawn.mock.calls[0][1] as string[];
}

beforeEach(() => {
  project = realpathSync(mkdtempSync(join(tmpdir(), 'mh-contain-project-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'mh-contain-outside-')));
  mkdirSync(join(project, 'reports'));
  writeFileSync(join(project, 'package.json'), '{"name":"p"}');
  writeFileSync(join(project, 'redblue.yaml'), 'target: mock\n');
  writeFileSync(join(outside, 'credentials.json'), '{"token":"canary"}');
  writeFileSync(join(outside, 'redblue.yaml'), 'target: mock\n');
  process.chdir(project);
  mockSpawn.mockReset();
  stubChild();
});

afterEach(() => {
  process.chdir(realCwd);
  rmSync(project, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('metaharness_redblue file arguments', () => {
  it.each([
    ['out', { subcommand: 'run', out: () => join(outside, 'credentials.json') }],
    ['out (relative escape)', { subcommand: 'run', out: () => '../' + outside.split(/[\\/]/).pop() + '/credentials.json' }],
    ['config', { subcommand: 'run', config: () => join(outside, 'redblue.yaml') }],
    ['in', { subcommand: 'report', in: () => join(outside, 'credentials.json') }],
    ['init out', { subcommand: 'init', out: () => join(outside, 'x.yaml') }],
  ])('refuses %s outside the project without spawning', async (_label, spec) => {
    const input = Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, typeof v === 'function' ? v() : v]));
    const r = await call('metaharness_redblue', input);
    expect(r.success).toBe(false);
    expect(String(r.error)).toMatch(/inside the project/);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('forwards resolved in-project paths', async () => {
    const r = await call('metaharness_redblue', { subcommand: 'run', config: 'redblue.yaml', out: 'reports/out.json', mockJudge: true });
    expect(r.success).toBe(true);
    const args = spawnedArgs();
    expect(args[args.indexOf('--config') + 1]).toBe(join(project, 'redblue.yaml'));
    expect(args[args.indexOf('--out') + 1]).toBe(join(project, 'reports', 'out.json'));
  });

  it('keeps operator paths for the local CLI', async () => {
    const out = join(outside, 'report.json');
    await call('metaharness_redblue', { subcommand: 'run', out }, localCliContext());
    const args = spawnedArgs();
    expect(args[args.indexOf('--out') + 1]).toBe(out);
  });
});

describe('metaharness_bench file arguments', () => {
  it('refuses an out path outside the project without spawning', async () => {
    const r = await call('metaharness_bench', { op: 'create', repo: '.', out: join(outside, 'suite.json') });
    expect(r.success).toBe(false);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('refuses a suite path outside the project without spawning', async () => {
    const r = await call('metaharness_bench', { op: 'verify', suite: join(outside, 'credentials.json') });
    expect(r.success).toBe(false);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('forwards an in-project out path', async () => {
    await call('metaharness_bench', { op: 'create', repo: '.', out: 'reports/suite.json' });
    const args = spawnedArgs();
    expect(args[args.indexOf('--out') + 1]).toBe(join(project, 'reports', 'suite.json'));
  });
});

describe('metaharness read-only file arguments', () => {
  const secret = () => join(outside, 'credentials.json');
  it.each([
    ['metaharness_similarity', 'aFile', () => ({ aFile: secret(), bFile: 'package.json' })],
    ['metaharness_similarity', 'bFile', () => ({ aFile: 'package.json', bFile: secret() })],
    ['metaharness_audit_trend', 'baselineFile', () => ({ baselineFile: secret(), currentFile: 'package.json' })],
    ['metaharness_audit_trend', 'currentFile', () => ({ baselineFile: 'package.json', currentFile: secret() })],
    ['metaharness_drift_from_history', 'baselineFile', () => ({ baselineFile: secret() })],
    ['metaharness_gepa', 'path', () => ({ op: 'render', path: secret() })],
    ['metaharness_gepa', 'transcript', () => ({ op: 'analyze', transcript: secret() })],
  ])('%s refuses %s outside the project without reading it', async (name, _arg, input) => {
    const { gepaOp } = await import('../src/metaharness/darwin-lib.js');
    vi.mocked(gepaOp).mockClear();
    const r = await call(name, input());
    expect(r.success).toBe(false);
    expect(String(r.error)).toMatch(/inside the project/);
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(gepaOp).not.toHaveBeenCalled();
  });

  it('forwards in-project files as resolved paths', async () => {
    await call('metaharness_audit_trend', { baselineFile: 'package.json', currentFile: 'redblue.yaml' });
    const args = spawnedArgs();
    expect(args[args.indexOf('--baseline') + 1]).toBe(join(project, 'package.json'));
    expect(args[args.indexOf('--current') + 1]).toBe(join(project, 'redblue.yaml'));
  });
});
