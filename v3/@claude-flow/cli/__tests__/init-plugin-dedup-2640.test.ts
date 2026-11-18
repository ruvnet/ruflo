/**
 * #2640 — init does not copy what the installed ruflo plugins already ship.
 *
 * Every test points CLAUDE_CONFIG_DIR (or `configDir`) at a temp fixture, so
 * the plugins installed on the machine running the suite never leak in.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { detectRufloPlugins, formatPluginDedupSummary, type DedupFs } from '../src/init/plugin-dedup.js';
import { executeInit } from '../src/init/executor.js';
import { DEFAULT_INIT_OPTIONS, FULL_INIT_OPTIONS, type InitOptions } from '../src/init/types.js';

let root: string;
let configDir: string;
let project: string;
let savedConfigDir: string | undefined;

function write(path: string, text = '# x\n') {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf-8');
}

/** A Claude Code config dir with ruflo-core + ruflo-swarm installed (user scope). */
function installPlugins(opts: { core?: boolean; registry?: string } = {}) {
  const core = join(root, 'cache', 'ruflo-core', '0.2.11');
  const swarm = join(root, 'cache', 'ruflo-swarm', '0.3.0');
  write(join(core, 'agents', 'planner.md'));
  write(join(core, 'skills', 'swarm-orchestration', 'SKILL.md'));
  write(join(core, 'commands', 'README.md'));
  write(join(swarm, 'commands', 'hooks', 'pre-edit.md'));
  write(join(swarm, 'commands', 'post-edit.md'));
  write(join(swarm, 'skills', 'hooks-automation', 'SKILL.md'));
  const plugins: Record<string, unknown> = {
    'ruflo-swarm@ruflo': [{ scope: 'user', installPath: swarm }],
    'other@elsewhere': [{ scope: 'user', installPath: swarm }],
  };
  if (opts.core !== false) plugins['ruflo-core@ruflo'] = [{ scope: 'user', installPath: core }];
  write(join(configDir, 'plugins', 'installed_plugins.json'), opts.registry ?? JSON.stringify({ version: 2, plugins }));
}

function tree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(dir, p));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

function initOptions(base: InitOptions): InitOptions {
  const o = structuredClone(base);
  o.targetDir = project;
  o.skipGlobalClaudeMd = true;
  o.components = { ...o.components, helpers: false, statusline: false, settings: false, runtime: false, claudeMd: false };
  return o;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dedup-2640-'));
  configDir = join(root, 'claude-config');
  project = join(root, 'project');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(project, { recursive: true });
  savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = configDir;
});
afterEach(() => {
  if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
  rmSync(root, { recursive: true, force: true });
});

describe('detectRufloPlugins (#2640)', () => {
  it('lists what the installed *@ruflo plugins ship', () => {
    installPlugins();
    const p = detectRufloPlugins(project, { configDir })!;
    expect(p.plugins).toEqual(['ruflo-core@ruflo', 'ruflo-swarm@ruflo']);
    expect([...p.agents.keys()]).toEqual(['planner.md']);
    expect([...p.commands.keys()].sort()).toEqual(['post-edit.md', 'pre-edit.md']);
    expect([...p.skills.keys()].sort()).toEqual(['hooks-automation', 'swarm-orchestration']);
  });

  it('is null without ruflo-core, even when other ruflo plugins are installed', () => {
    installPlugins({ core: false });
    expect(detectRufloPlugins(project, { configDir })).toBeNull();
  });

  it('is null when there is no plugin registry', () => {
    expect(detectRufloPlugins(project, { configDir })).toBeNull();
  });

  it('is null (no throw) when the registry is malformed', () => {
    installPlugins({ registry: '{ not json' });
    expect(detectRufloPlugins(project, { configDir })).toBeNull();
    installPlugins({ registry: JSON.stringify({ plugins: { 'ruflo-core@ruflo': 'nope' } }) });
    expect(detectRufloPlugins(project, { configDir })).toBeNull();
  });

  it('is null when ruflo-core is switched off in enabledPlugins', () => {
    installPlugins();
    write(join(project, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'ruflo-core@ruflo': false } }));
    expect(detectRufloPlugins(project, { configDir })).toBeNull();
  });

  it('ignores a project-scoped install that belongs to another project', () => {
    const core = join(root, 'cache', 'ruflo-core', '1');
    write(join(core, 'agents', 'planner.md'));
    write(join(configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
      plugins: { 'ruflo-core@ruflo': [{ scope: 'project', projectPath: join(root, 'other'), installPath: core }] },
    }));
    expect(detectRufloPlugins(project, { configDir })).toBeNull();
  });

  it('only reads: every call goes through exists/readText/listDir and nothing changes on disk', () => {
    installPlugins();
    const before = tree(root).map((f) => [f, statSync(join(root, f)).mtimeMs]);
    const calls: string[] = [];
    const real = { exists: existsSync, readText: (p: string) => { try { return readFileSync(p, 'utf-8'); } catch { return undefined; } } };
    const spyFs: DedupFs = {
      exists: (p) => { calls.push('exists'); return real.exists(p); },
      readText: (p) => { calls.push('readText'); return real.readText(p); },
      listDir: (p) => {
        calls.push('listDir');
        try { return readdirSync(p, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })); } catch { return []; }
      },
    };
    expect(detectRufloPlugins(project, { configDir, fs: spyFs })).not.toBeNull();
    expect(new Set(calls)).toEqual(new Set(['exists', 'readText', 'listDir']));
    expect(tree(root).map((f) => [f, statSync(join(root, f)).mtimeMs])).toEqual(before);
  });
});

describe('executeInit with the plugins installed (#2640)', () => {
  it('skips what the plugins ship, drops the standalone MCP server, and reports it', async () => {
    installPlugins();
    const result = await executeInit(initOptions(DEFAULT_INIT_OPTIONS));
    expect(result.success).toBe(true);

    const files = tree(join(project, '.claude'));
    expect(files).not.toContain('skills/swarm-orchestration/SKILL.md');
    expect(files).not.toContain('commands/hooks/pre-edit.md');
    expect(files).not.toContain('commands/hooks/post-edit.md');
    expect(files).toContain('commands/hooks/pre-task.md');
    expect(files.some((f) => f.startsWith('agents/core/'))).toBe(false); // core held only planner.md
    expect(files).toContain('skills/pair-programming/SKILL.md');

    expect(existsSync(join(project, '.mcp.json'))).toBe(false);
    expect(result.pluginDedup).toEqual({
      plugins: ['ruflo-core@ruflo', 'ruflo-swarm@ruflo'],
      skipped: {
        agents: ['planner'],
        commands: expect.arrayContaining(['pre-edit', 'post-edit']),
        skills: expect.arrayContaining(['swarm-orchestration', 'hooks-automation']),
      },
      mcpServerSkipped: true,
    });

    const summary = formatPluginDedupSummary(result.pluginDedup!).join('\n');
    expect(summary).toMatch(/ruflo-core, ruflo-swarm/);
    expect(summary).toMatch(/claude-flow/);
    expect(summary).toMatch(/--full/);
  });

  it('keeps the other MCP servers a preset asks for', async () => {
    installPlugins();
    const o = initOptions(DEFAULT_INIT_OPTIONS);
    o.mcp = { ...o.mcp, ruvSwarm: true };
    await executeInit(o);
    const servers = Object.keys(JSON.parse(readFileSync(join(project, '.mcp.json'), 'utf-8')).mcpServers);
    expect(servers).toEqual(['ruv-swarm']);
  });

  it('--full copies everything, plugins or not', async () => {
    installPlugins();
    const result = await executeInit(initOptions(FULL_INIT_OPTIONS));
    const files = tree(join(project, '.claude'));
    expect(files).toContain('skills/swarm-orchestration/SKILL.md');
    expect(files).toContain('commands/hooks/pre-edit.md');
    expect(files).toContain('agents/core/planner.md');
    expect(Object.keys(JSON.parse(readFileSync(join(project, '.mcp.json'), 'utf-8')).mcpServers)).toContain('claude-flow');
    expect(result.pluginDedup).toBeUndefined();
  });
});

describe('executeInit without the plugins (#2640)', () => {
  it('writes exactly what it wrote before (same tree as with dedup turned off)', async () => {
    const a = await executeInit(initOptions(DEFAULT_INIT_OPTIONS));
    const withDedupOn = tree(project);
    rmSync(project, { recursive: true, force: true });
    mkdirSync(project, { recursive: true });
    const off = { ...initOptions(DEFAULT_INIT_OPTIONS), deferToPlugins: false };
    const b = await executeInit(off);
    expect(withDedupOn).toEqual(tree(project));
    expect(a.summary).toEqual(b.summary);
    expect(a.pluginDedup).toBeUndefined();
    expect(Object.keys(JSON.parse(readFileSync(join(project, '.mcp.json'), 'utf-8')).mcpServers)).toEqual(['claude-flow']);
  });
});
