/**
 * ADR-510 §2.2 — two of the places ruflo builds a `claude -p` command line
 * (HeadlessWorkerExecutor, `hive-mind work`; `hive-mind spawn -p` is in
 * mods-hive-mind-spawn-plugins.test.ts) pass the resolved ruflo-mods
 * folder as --plugin-dir and set CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1; a
 * missing plugin does not stop the run and is recorded on its result.
 *
 * spawn is mocked (no claude runs); the plugin is resolved from a temp
 * CLAUDE_CONFIG_DIR holding a real marketplace-clone layout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fake = vi.hoisted(() => ({ calls: [] as Array<{ cmd: string; argv: string[]; opts: any }> }));
vi.mock('child_process', async (orig) => {
  const actual = await orig<typeof import('child_process')>();
  return {
    ...actual,
    spawn: vi.fn((cmd: string, argv: string[], opts: any) => {
      fake.calls.push({ cmd, argv, opts });
      const child: any = new EventEmitter();
      child.pid = 4242;
      child.exitCode = null;
      child.signalCode = null;
      child.stdin = { end() { setTimeout(() => { child.exitCode = 0; child.stdout.emit('data', Buffer.from('{"result":"ok","is_error":false}')); child.emit('exit', 0); child.emit('close', 0); }, 0); } };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      return child;
    }),
  };
});
vi.mock('../../src/runtime/claude-command.js', () => ({ resolveClaudeLaunchCommand: () => ({ command: 'claude', argsPrefix: [] }) }));

import { HeadlessWorkerExecutor } from '../../src/services/headless-worker-executor.js';
import { runWithClaude } from '../../src/commands/hive-mind-worker.js';
import { resetHeadlessPluginWarnings } from '../../src/mods/headless-plugins.js';

let cfg: string;
let project: string;
let saved: Record<string, string | undefined>;
const MODS = () => join(cfg, 'plugins', 'marketplaces', 'ruflo', 'plugins', 'ruflo-mods');

beforeEach(() => {
  fake.calls = [];
  resetHeadlessPluginWarnings();
  cfg = mkdtempSync(join(tmpdir(), 'adr510-cfg-'));
  project = mkdtempSync(join(tmpdir(), 'adr510-proj-'));
  saved = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, F: process.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS, P: process.env.RUFLO_HEADLESS_PLUGINS };
  process.env.CLAUDE_CONFIG_DIR = cfg;
  delete process.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS;
  delete process.env.RUFLO_HEADLESS_PLUGINS;
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  for (const [k, env] of [['CLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIR'], ['F', 'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS'], ['P', 'RUFLO_HEADLESS_PLUGINS']] as const) {
    if (saved[k] === undefined) delete process.env[env];
    else process.env[env] = saved[k];
  }
  vi.restoreAllMocks();
  rmSync(cfg, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

function installClone() {
  mkdirSync(join(MODS(), '.claude-plugin'), { recursive: true });
  writeFileSync(join(MODS(), '.claude-plugin', 'plugin.json'), '{"name":"ruflo-mods"}');
}

const runExecutor = () =>
  (new HeadlessWorkerExecutor(project) as any).executeClaudeCode('p', { sandbox: 'strict', model: 'haiku', timeoutMs: 10_000, executionId: 'e1', workerType: 'audit' });

describe('ADR-510 HeadlessWorkerExecutor', () => {
  it('passes --plugin-dir <ruflo-mods> and CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1', async () => {
    installClone();
    const r = await runExecutor();
    expect(r.success).toBe(true);
    const call = fake.calls.find((c) => c.cmd === 'claude')!;
    expect(call.argv).toEqual(['--print', '--output-format', 'json', '--plugin-dir', MODS()]);
    expect(call.opts.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS).toBe('1');
    expect(r.missingPlugins).toBeUndefined();
  });

  it('runs without the plugin when it is missing, and records it', async () => {
    const r = await runExecutor();
    expect(r.success).toBe(true);
    const call = fake.calls.find((c) => c.cmd === 'claude')!;
    expect(call.argv).toEqual(['--print', '--output-format', 'json']);
    expect(r.missingPlugins).toEqual(['ruflo-mods']);
  });
});

describe('ADR-510 hive-mind work (runWithClaude)', () => {
  it('passes --plugin-dir after the caller args, with function hooks on', async () => {
    installClone();
    const r = await runWithClaude('task', { mcpConfig: '/tmp/m.json', timeoutMs: 10_000, cwd: project });
    expect(r.ok).toBe(true);
    const call = fake.calls.find((c) => c.cmd === 'claude')!;
    expect(call.argv).toEqual(['-p', '--output-format', 'json', '--mcp-config=/tmp/m.json', '--plugin-dir', MODS()]);
    expect(call.opts.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS).toBe('1');
  });

  it('reports a missing plugin on the outcome', async () => {
    const r = await runWithClaude('task', { mcpConfig: '/tmp/m.json', timeoutMs: 10_000, cwd: project });
    expect(r.missingPlugins).toEqual(['ruflo-mods']);
  });
});
