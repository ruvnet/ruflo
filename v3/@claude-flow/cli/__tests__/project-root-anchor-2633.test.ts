/**
 * ruvnet/ruflo#2633 — durable state must be anchored to the project root, not
 * to raw process.cwd().
 *
 * Under an agent the Bash tool cwd is sticky: after `cd src/deep` every later
 * CLI invocation, MCP spawn and hook inherits that subdirectory. State keyed to
 * process.cwd() was then written to `src/deep/.claude-flow` / `src/deep/.swarm`
 * and never read again — autopilot iteration counts, neural checkpoints,
 * metrics and the memory DB silently started over.
 *
 * Every fixture root carries an empty `.git/` so the walk stops at the fixture
 * boundary and the result never depends on markers elsewhere on this machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetMemoryRootCache, getMemoryRoot } from '../src/memory/memory-initializer.js';
import { loadState, saveState, getDefaultState } from '../src/autopilot-state.js';
import { getProjectCwd } from '../src/mcp-tools/types.js';
import { resolveDaemonProjectRoot } from '../src/services/daemon-autostart.js';

const SAVED_ENV = { ...process.env };

function makeFixture(): { base: string; proj: string; deep: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-2633-')));
  const proj = join(base, 'proj');
  const deep = join(proj, 'src', 'deep');
  mkdirSync(deep, { recursive: true });
  mkdirSync(join(proj, '.git'));
  return { base, proj, deep };
}

function initRuflo(dir: string): void {
  mkdirSync(join(dir, '.claude-flow'), { recursive: true });
  writeFileSync(join(dir, '.claude-flow', 'config.yaml'), 'version: 3\n');
}

describe('#2633 — durable state anchors to the project root', () => {
  let fx: ReturnType<typeof makeFixture>;

  beforeEach(() => {
    fx = makeFixture();
    delete process.env.CLAUDE_FLOW_CWD;
    delete process.env.CLAUDE_FLOW_MEMORY_PATH;
    _resetMemoryRootCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...SAVED_ENV };
    _resetMemoryRootCache();
    rmSync(fx.base, { recursive: true, force: true });
  });

  describe('initialized project, cwd drifted to proj/src/deep', () => {
    beforeEach(() => {
      initRuflo(fx.proj);
      vi.spyOn(process, 'cwd').mockReturnValue(fx.deep);
    });

    it('getMemoryRoot() resolves to <proj>/.swarm', () => {
      expect(getMemoryRoot()).toBe(join(fx.proj, '.swarm'));
    });

    it('memory config is read from the project root, not the drifted cwd', () => {
      writeFileSync(
        join(fx.proj, 'claude-flow.config.json'),
        JSON.stringify({ memory: { persistPath: 'custom-mem' } }),
      );
      expect(getMemoryRoot()).toBe(join(fx.proj, 'custom-mem'));
    });

    it('autopilot saveState() writes under <proj>/.claude-flow/data and loadState() reads it back', () => {
      const state = { ...getDefaultState(), iterations: 7 };
      saveState(state);
      expect(existsSync(join(fx.proj, '.claude-flow', 'data', 'autopilot-state.json'))).toBe(true);
      expect(existsSync(join(fx.deep, '.claude-flow'))).toBe(false);
      expect(loadState().iterations).toBe(7);
    });

    it('getProjectCwd() resolves to the project root', () => {
      expect(getProjectCwd()).toBe(fx.proj);
    });

    it('CLAUDE_FLOW_CWD still wins over the walk', () => {
      const other = join(fx.base, 'other');
      mkdirSync(other);
      process.env.CLAUDE_FLOW_CWD = other;
      expect(getProjectCwd()).toBe(other);
    });

    it('the walk never creates state directories', () => {
      getMemoryRoot();
      getProjectCwd();
      loadState();
      expect(existsSync(join(fx.deep, '.swarm'))).toBe(false);
      expect(existsSync(join(fx.deep, '.claude-flow'))).toBe(false);
      expect(existsSync(join(fx.proj, '.swarm'))).toBe(false);
      expect(existsSync(join(fx.proj, '.claude-flow', 'data'))).toBe(false);
    });
  });

  describe('no Ruflo marker anywhere (inside a git repo)', () => {
    beforeEach(() => {
      vi.spyOn(process, 'cwd').mockReturnValue(fx.deep);
    });

    it('getMemoryRoot() keeps today\'s cwd-relative default', () => {
      expect(getMemoryRoot()).toBe(join(fx.deep, '.swarm'));
    });

    it('getProjectCwd() falls back to process.cwd()', () => {
      expect(getProjectCwd()).toBe(fx.deep);
    });

    it('autopilot state stays cwd-relative', () => {
      saveState({ ...getDefaultState(), iterations: 3 });
      expect(existsSync(join(fx.deep, '.claude-flow', 'data', 'autopilot-state.json'))).toBe(true);
    });
  });

  it('nearest marker wins for an independently-initialized sub-project', () => {
    initRuflo(fx.proj);
    const sub = join(fx.proj, 'src');
    initRuflo(sub);
    vi.spyOn(process, 'cwd').mockReturnValue(fx.deep);
    expect(getMemoryRoot()).toBe(join(sub, '.swarm'));
    expect(getProjectCwd()).toBe(sub);
  });

  it('a marker in $HOME (e.g. ~/.claude/settings.json) never becomes the project root', () => {
    // No `.git` on this path, so the walk reaches `base` and finds the marker;
    // the home guard must then reject it and keep the cwd-relative default.
    const sub = join(fx.base, 'sub');
    mkdirSync(sub);
    mkdirSync(join(fx.base, '.claude'));
    writeFileSync(join(fx.base, '.claude', 'settings.json'), JSON.stringify({ claudeFlow: {} }));
    process.env.HOME = fx.base;
    vi.spyOn(process, 'cwd').mockReturnValue(sub);
    expect(getMemoryRoot()).toBe(join(sub, '.swarm'));
    expect(getProjectCwd()).toBe(sub);
    saveState({ ...getDefaultState(), iterations: 1 });
    expect(existsSync(join(sub, '.claude-flow', 'data', 'autopilot-state.json'))).toBe(true);
    expect(existsSync(join(fx.base, '.claude-flow'))).toBe(false);
  });

  it('daemon root resolution is unchanged (#2877)', () => {
    initRuflo(fx.proj);
    expect(resolveDaemonProjectRoot(fx.deep)).toBe(fx.proj);
    expect(resolveDaemonProjectRoot(join(fx.base))).toBe(fx.base);
  });
});

describe('#2633 — CLI and cli-core resolveProjectRoot copies agree', () => {
  let fx: ReturnType<typeof makeFixture>;

  beforeEach(() => {
    fx = makeFixture();
  });

  afterEach(() => {
    rmSync(fx.base, { recursive: true, force: true });
  });

  it('return identical roots across marker kinds and layouts', async () => {
    const cli = await import('../src/services/project-root.js');
    // Source path, not the package export: the CLI pins a published cli-core
    // that predates this helper, so compare against the workspace source.
    const core = await import('../../cli-core/src/mcp-tools/types.js');

    const nested = join(fx.proj, 'packages', 'pkg', 'lib');
    mkdirSync(nested, { recursive: true });
    const cases: Array<() => void> = [
      () => { /* no marker: both return start */ },
      () => initRuflo(fx.proj),
      () => writeFileSync(join(fx.proj, 'claude-flow.config.json'), '{}'),
      () => {
        mkdirSync(join(fx.proj, '.swarm'), { recursive: true });
        writeFileSync(join(fx.proj, '.swarm', 'memory.db'), '');
      },
      () => {
        mkdirSync(join(fx.proj, '.claude'), { recursive: true });
        writeFileSync(join(fx.proj, '.claude', 'settings.json'), JSON.stringify({ claudeFlow: {} }));
      },
      () => writeFileSync(join(fx.proj, '.mcp.json'), JSON.stringify({ mcpServers: { ruflo: {} } })),
      () => initRuflo(join(fx.proj, 'packages', 'pkg')),
    ];
    for (const setup of cases) {
      setup();
      for (const start of [fx.deep, nested, fx.proj, fx.base]) {
        expect(cli.resolveProjectRoot(start)).toBe(core.resolveProjectRoot(start));
        expect(cli.isRufloProject(start)).toBe(core.isRufloProject(start));
      }
    }
    expect(cli.resolveProjectRoot(nested)).toBe(join(fx.proj, 'packages', 'pkg'));
  });
});
