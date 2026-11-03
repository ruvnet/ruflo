/**
 * #1870: `hive-mind spawn --claude --model <m>` passes --model to the Claude
 * Code worker; without it the argv is unchanged. Bad values are refused before
 * anything is spawned. Harness taken from mods/mods-hive-mind-spawn-plugins.test.ts.
 *
 * Contributed by Michael Valderrama (https://bucketbranch.ai)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
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
      child.killed = false;
      child.kill = vi.fn();
      setTimeout(() => child.emit('exit', 0), 0);
      return child;
    }),
  };
});
vi.mock('fs/promises', async (orig) => ({ ...(await orig<typeof import('fs/promises')>()), mkdir: vi.fn(async () => undefined), writeFile: vi.fn(async () => undefined) }));
vi.mock('../src/runtime/claude-command.js', () => ({ resolveClaudeLaunchCommand: () => ({ command: 'claude', argsPrefix: [] }) }));
vi.mock('../src/mcp-client.js', () => ({
  MCPClientError: class extends Error {},
  callMCPTool: vi.fn(async (name: string) =>
    name === 'hive-mind_spawn'
      ? { success: true, spawned: 1, workers: [{ agentId: 'w1', role: 'worker', joinedAt: new Date(0).toISOString() }], totalWorkers: 1, hiveStatus: 'active', hiveId: 'h1', message: 'ok' }
      : { hiveId: 'h1' }),
}));

import { hiveMindCommand } from '../src/commands/hive-mind.js';
import { resolveWorkerModel } from '../src/commands/hive-mind-worker.js';
import { callMCPTool } from '../src/mcp-client.js';

let cfg: string;
let savedConfigDir: string | undefined;
let written: string;
const spawnCmd = hiveMindCommand.subcommands!.find((c) => c.name === 'spawn')!;
const run = (flags: Record<string, unknown>) =>
  spawnCmd.action!({ args: [], flags: { claude: true, objective: 'do x', mcpConfig: '/tmp/m.json', ...flags }, interactive: false, cwd: cfg } as any);
const claudeCall = () => fake.calls.find((c) => c.cmd === 'claude');

beforeEach(() => {
  fake.calls = [];
  written = '';
  vi.mocked(callMCPTool).mockClear();
  cfg = mkdtempSync(join(tmpdir(), 'hive-model-'));
  savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  const capture = (chunk: unknown) => {
    written += String(chunk);
    return true;
  };
  vi.spyOn(process.stderr, 'write').mockImplementation(capture as any);
  vi.spyOn(process.stdout, 'write').mockImplementation(capture as any);
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { written += a.join(' ') + '\n'; });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { written += a.join(' ') + '\n'; });
});
afterEach(() => {
  if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
  vi.restoreAllMocks();
  rmSync(cfg, { recursive: true, force: true });
});

describe('#1870 resolveWorkerModel', () => {
  it('accepts model names and ids', () => {
    for (const m of ['sonnet', 'opus', 'haiku', 'claude-sonnet-5', 'us.anthropic.claude-sonnet-5-v1:0', 'claude-sonnet-4-5@20250929']) {
      expect(resolveWorkerModel({ model: m })).toEqual({ model: m });
    }
    expect(resolveWorkerModel({ model: '  sonnet  ' })).toEqual({ model: 'sonnet' });
  });

  it('refuses flags, blanks and values with spaces', () => {
    for (const m of ['-x', '--dangerously-skip-permissions', 'sonnet opus', '', '   ', true]) {
      expect(resolveWorkerModel({ model: m }).error).toBeDefined();
    }
  });

  it('returns nothing when --model is absent', () => {
    expect(resolveWorkerModel({})).toEqual({});
  });
});

describe('#1870 hive-mind spawn --model', () => {
  it('declares -m, --model on spawn, and no other spawn option takes -m', () => {
    const model = spawnCmd.options!.find((o) => o.name === 'model');
    expect(model).toBeDefined();
    expect(model!.short).toBe('m');
    expect(model!.type).toBe('string');
    expect(spawnCmd.options!.filter((o) => o.short === 'm')).toHaveLength(1);
  });

  it('non-interactive: passes --model <m> to Claude Code, and the prompt stays last', async () => {
    const r = await run({ nonInteractive: true, model: 'sonnet' });
    expect(r.success).toBe(true);
    const argv = claudeCall()!.argv;
    const i = argv.indexOf('--model');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(argv[i + 1]).toBe('sonnet');
    expect(i + 1).toBeLessThan(argv.length - 1);
    expect(argv.filter((a) => a === '--model')).toHaveLength(1);
  });

  it('interactive: passes --model <m>, and the environment is still inherited', async () => {
    await run({ model: 'claude-sonnet-5' });
    const call = claudeCall()!;
    const i = call.argv.indexOf('--model');
    expect(call.argv[i + 1]).toBe('claude-sonnet-5');
    expect(call.opts.env).toBeUndefined();
  });

  it('accepts a provider-qualified model id', async () => {
    await run({ nonInteractive: true, model: 'us.anthropic.claude-sonnet-5-v1:0' });
    const argv = claudeCall()!.argv;
    expect(argv[argv.indexOf('--model') + 1]).toBe('us.anthropic.claude-sonnet-5-v1:0');
  });

  it('negative control: without --model the argument list carries no --model', async () => {
    await run({ nonInteractive: true });
    expect(claudeCall()!.argv).not.toContain('--model');
    await run({});
    expect(fake.calls.filter((c) => c.cmd === 'claude').every((c) => !c.argv.includes('--model'))).toBe(true);
  });

  it('refuses a value that starts with "-" before spawning workers or Claude Code', async () => {
    const r = await run({ nonInteractive: true, model: '--dangerously-skip-permissions' });
    expect(r.success).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(claudeCall()).toBeUndefined();
    expect(vi.mocked(callMCPTool)).not.toHaveBeenCalled();
    expect(written).toContain('--model');
  });

  it('refuses an empty or blank value, and a bare --model with no value', async () => {
    for (const model of ['', '   ', true]) {
      fake.calls = [];
      vi.mocked(callMCPTool).mockClear();
      const r = await run({ nonInteractive: true, model });
      expect(r.success).toBe(false);
      expect(claudeCall()).toBeUndefined();
      expect(vi.mocked(callMCPTool)).not.toHaveBeenCalled();
    }
  });

  it('without --claude, --model is reported as ignored instead of silently dropped', async () => {
    const r = await run({ claude: false, model: 'sonnet' });
    expect(r.success).toBe(true);
    expect(claudeCall()).toBeUndefined();
    expect(written).toMatch(/--model only applies with --claude/);
  });
});
