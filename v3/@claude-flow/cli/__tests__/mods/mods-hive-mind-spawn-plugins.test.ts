/**
 * ADR-510 §2.2 — `hive-mind spawn --claude --non-interactive` builds a
 * `claude -p` command line, so it is a headless worker too: it gets the
 * worker profile's plugins as --plugin-dir (before the prompt) and
 * CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1. The interactive launch is unchanged.
 *
 * spawn, the MCP call and the prompt-file writes are mocked; the plugin is
 * resolved from a temp CLAUDE_CONFIG_DIR holding a marketplace-clone layout.
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
      child.killed = false;
      child.kill = vi.fn();
      setTimeout(() => child.emit('exit', 0), 0);
      return child;
    }),
  };
});
vi.mock('fs/promises', async (orig) => ({ ...(await orig<typeof import('fs/promises')>()), mkdir: vi.fn(async () => undefined), writeFile: vi.fn(async () => undefined) }));
vi.mock('../../src/runtime/claude-command.js', () => ({ resolveClaudeLaunchCommand: () => ({ command: 'claude', argsPrefix: [] }) }));
vi.mock('../../src/mcp-client.js', () => ({
  MCPClientError: class extends Error {},
  callMCPTool: vi.fn(async (name: string) =>
    name === 'hive-mind_spawn'
      ? { success: true, spawned: 1, workers: [{ agentId: 'w1', role: 'worker', joinedAt: new Date(0).toISOString() }], totalWorkers: 1, hiveStatus: 'active', hiveId: 'h1', message: 'ok' }
      : { hiveId: 'h1' }),
}));

import { hiveMindCommand } from '../../src/commands/hive-mind.js';
import { resetHeadlessPluginWarnings } from '../../src/mods/headless-plugins.js';

let cfg: string;
let saved: Record<string, string | undefined>;
const ENVS = ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS', 'RUFLO_HEADLESS_PLUGINS'] as const;
const MODS = () => join(cfg, 'plugins', 'marketplaces', 'ruflo', 'plugins', 'ruflo-mods');
const spawnCmd = hiveMindCommand.subcommands!.find((c) => c.name === 'spawn')!;
const run = (flags: Record<string, unknown>) =>
  spawnCmd.action!({ args: [], flags: { claude: true, objective: 'do x', mcpConfig: '/tmp/m.json', ...flags }, interactive: false, cwd: cfg } as any);

beforeEach(() => {
  fake.calls = [];
  resetHeadlessPluginWarnings();
  cfg = mkdtempSync(join(tmpdir(), 'adr510-hive-'));
  saved = Object.fromEntries(ENVS.map((k) => [k, process.env[k]]));
  process.env.CLAUDE_CONFIG_DIR = cfg;
  delete process.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS;
  delete process.env.RUFLO_HEADLESS_PLUGINS;
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  for (const k of ENVS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
  rmSync(cfg, { recursive: true, force: true });
});

function installClone() {
  mkdirSync(join(MODS(), '.claude-plugin'), { recursive: true });
  writeFileSync(join(MODS(), '.claude-plugin', 'plugin.json'), '{"name":"ruflo-mods"}');
}

describe('ADR-510 hive-mind spawn --claude --non-interactive', () => {
  it('passes --plugin-dir <ruflo-mods> before the prompt, with function hooks on', async () => {
    installClone();
    const r = await run({ nonInteractive: true });
    expect(r.success).toBe(true);
    const call = fake.calls.find((c) => c.cmd === 'claude')!;
    const i = call.argv.indexOf('--plugin-dir');
    expect(i).toBeGreaterThan(call.argv.indexOf('-p'));
    expect(call.argv[i + 1]).toBe(MODS());
    expect(i + 2).toBe(call.argv.length - 1); // the prompt stays the last argument
    expect(call.opts.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS).toBe('1');
    expect((r.data as any).claude.missingPlugins).toBeUndefined();
  });

  it('runs without the plugin when it is missing, and records it on the result', async () => {
    const r = await run({ nonInteractive: true });
    expect(r.success).toBe(true);
    const call = fake.calls.find((c) => c.cmd === 'claude')!;
    expect(call.argv).not.toContain('--plugin-dir');
    expect((r.data as any).claude.missingPlugins).toEqual(['ruflo-mods']);
  });

  it('the interactive launch is unchanged: no --plugin-dir, env inherited', async () => {
    installClone();
    await run({});
    const call = fake.calls.find((c) => c.cmd === 'claude')!;
    expect(call.argv).not.toContain('--plugin-dir');
    expect(call.opts.env).toBeUndefined();
  });
});
