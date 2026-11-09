/**
 * #2854 — `ruflo plugins host ...` command surface. The manager is wired to a
 * fake execFile/fs, so no real host CLI is ever run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hostCommand, hostCommandRuntime } from '../src/commands/plugins-host.js';
import { pluginsCommand } from '../src/commands/plugins.js';
import { output } from '../src/output.js';
import { HostPluginManager, type HostSystemDeps } from '../src/services/host-plugin-manager.js';
import type { CommandContext } from '../src/types.js';

let lines: string[];
let execCalls: Array<{ file: string; args: string[] }>;

function deps(failCodexAdd = false): HostSystemDeps {
  return {
    platform: 'linux',
    env: { PATH: '/bin' },
    execPath: '/bin/node',
    access: async (p) => { if (p !== '/bin/claude' && p !== '/bin/codex') throw new Error('ENOENT'); },
    readFile: async () => { throw new Error('ENOENT'); },
    execFile: async (file, args) => {
      execCalls.push({ file, args: [...args] });
      const a = args.join(' ');
      const claude = file === '/bin/claude';
      if (a === 'plugin list --json') return { stdout: claude ? '[]' : '{"installed":[]}', stderr: '' };
      if (a === 'plugin marketplace list --json') {
        return claude
          ? { stdout: '[{"name":"ruflo","source":"github","repo":"ruvnet/ruflo"}]', stderr: '' }
          : { stdout: '{"marketplaces":[{"name":"ruflo","marketplaceSource":{"source":"https://github.com/ruvnet/ruflo.git"}}]}', stderr: '' };
      }
      if (failCodexAdd && !claude && args[1] === 'add') throw Object.assign(new Error('exit 1'), { stderr: 'boom' });
      return { stdout: '', stderr: '' };
    },
  };
}

function sub(name: string) {
  return hostCommand.subcommands!.find((c) => c.name === name)!;
}

function run(name: string, args: string[], flags: Record<string, unknown> = {}) {
  const ctx = { args, flags: { _: [], ...flags }, cwd: '/tmp', interactive: false } as CommandContext;
  return sub(name).action!(ctx);
}

beforeEach(() => {
  lines = [];
  execCalls = [];
  vi.spyOn(output, 'writeln').mockImplementation((line = '') => { lines.push(String(line)); });
  vi.spyOn(output, 'printError').mockImplementation((line: string) => { lines.push(`ERROR ${line}`); });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('plugins host command', () => {
  it('is registered under `plugins` with every action', () => {
    expect(pluginsCommand.subcommands!.some((c) => c.name === 'host')).toBe(true);
    expect(hostCommand.subcommands!.map((c) => c.name)).toEqual(['install', 'update', 'uninstall', 'enable', 'disable', 'sync', 'status']);
  });

  it('--dry-run prints the exact argv per host and runs no mutation', async () => {
    vi.spyOn(hostCommandRuntime, 'createManager').mockReturnValue(new HostPluginManager(deps()));
    const res = await run('install', ['ruflo-swarm'], { 'dry-run': true });
    expect(res.success).toBe(true);
    const text = lines.join('\n');
    expect(text).toContain('$ claude plugin install ruflo-swarm@ruflo --scope user');
    expect(text).toContain('$ codex plugin add ruflo-swarm@ruflo --json');
    expect(execCalls.every((c) => c.args.at(-1) === '--json' && c.args.includes('list'))).toBe(true);
  });

  it('exits non-zero on a partial failure and reports both hosts', async () => {
    vi.spyOn(hostCommandRuntime, 'createManager').mockReturnValue(new HostPluginManager(deps(true)));
    const res = await run('install', ['ruflo-swarm'], { json: true });
    expect(res).toMatchObject({ success: false, exitCode: 1 });
    const report = JSON.parse(lines[0]!);
    expect(report.results.map((r: { host: string; outcome: string }) => [r.host, r.outcome])).toEqual([['claude', 'ok'], ['codex', 'failed']]);
  });

  it('rejects an invalid --host or plugin name before touching any host', async () => {
    vi.spyOn(hostCommandRuntime, 'createManager').mockReturnValue(new HostPluginManager(deps()));
    expect(await run('install', ['ruflo-swarm'], { host: 'all; rm' })).toMatchObject({ success: false, exitCode: 1 });
    expect(await run('install', ['$(reboot)'])).toMatchObject({ success: false, exitCode: 1 });
    expect(execCalls).toHaveLength(0);
  });

  it('reads the camelCased dryRun flag the parser produces', async () => {
    vi.spyOn(hostCommandRuntime, 'createManager').mockReturnValue(new HostPluginManager(deps()));
    await run('uninstall', ['ruflo-swarm'], { dryRun: true });
    expect(execCalls.filter((c) => !c.args.includes('list'))).toHaveLength(0);
  });
});
