/**
 * ADR-406 — `ruflo mods list|enable|disable`: what Claude Code records about
 * the ruflo-family mods, read through an injected exec and an in-memory
 * filesystem. Nothing here reads the real ~/.claude or runs a real claude.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  gateOf,
  listMods,
  parseValidateNotes,
  RISKY_CALLS,
  RISKY_EVENTS,
  riskOf,
  toggleMod,
  verdictOf,
  type ListDeps,
} from '../../src/commands/mods-manage.js';
import type { Exec } from '../../src/mods/plugin-repair.js';

/** Captured from `claude plugin validate --json plugins/ruflo-swarm` and `plugins/ruflo-mods`, Claude Code 2.1.287, 2026-10-01. */
const VALIDATE_SWARM = {
  success: true,
  contents: [{
    file: '/x/plugins/ruflo-swarm/hooks/hooks.json',
    type: 'hooks',
    errors: [],
    warnings: [],
    notes: [
      './register.ts hooks: session.start, ui.render{component=PromptHint}, ui.render{component=Pane}, ui.close, command.run{command=ruflo-swarm-pane}, command.run{command=ruflo-swarm:watch}, command.run{command=ruflo-swarm-status}, command.run{command=ruflo-swarm-topology}, command.run{command=ruflo-swarm-claims}, command.run{command=ruflo-swarm-consensus}, turn.start, turn.complete, agent.spawn, tool.call, *',
      './register.ts calls: $.agent.list (via hostOf), $.clock.after (via hostOf), $.clock.every (via hostOf), $.clock.now (via hostOf), $.command.register (via hostOf), $.fs.read (via hostOf), $.fs.stat (via hostOf), $.process.run (via hostOf), $.prompt.fill (via hostOf), $.session.usage (via hostOf), $.store.get (via hostOf), $.store.set (via hostOf), $.ui.close (via hostOf), $.ui.invalidate (via hostOf), $.ui.log (via hostOf), $.ui.open (via hostOf), $.ui.resolve, $.ui.toast (via hostOf)',
    ],
  }],
};
const VALIDATE_MODS = {
  success: true,
  manifest: { notes: ['types ./types/index.d.ts declares on $: $.ruflo'] },
  contents: [{
    type: 'hooks',
    notes: [
      './register.ts hooks: plugin.register, engine.create, session.start, command.run{command=ruflo-mods}, prompt.submit, tool.check, tool.call, turn.complete, session.end, session.measure, agent.spawn',
      './register.ts calls: $.command.register, $.env.get (via helperHonours), $.env.set, $.fs.exists (via helperHonours), $.fs.read, $.fs.stat, $.fs.write, $.session.root, $.settings.read, $.ui.log, $.ui.status, $.ui.toast',
      './register.ts env writes: RUFLO_MODS_OWNS',
      './register.ts env reads: HOME',
    ],
  }],
};

const CFG = '/cfg';
const ROOT = '/work/proj';
const CLONE = join(CFG, 'plugins', 'marketplaces', 'ruflo');
const CACHE = (name: string) => join(CFG, 'plugins', 'cache', 'ruflo', name, '0.1.0');

interface World { files: Record<string, unknown>; dirs: string[]; calls: string[][]; list?: unknown[]; failValidate?: boolean; toggleCode?: number }

function depsOf(w: World, claude: string | null = '/bin/claude'): ListDeps {
  const text = (p: string) => (p in w.files ? (typeof w.files[p] === 'string' ? (w.files[p] as string) : JSON.stringify(w.files[p])) : undefined);
  const exec: Exec = async (_file, args) => {
    w.calls.push([...args]);
    if (args[1] === 'list') return { code: 0, stdout: JSON.stringify(w.list ?? []), stderr: '' };
    if (args[1] === 'validate') {
      if (w.failValidate) return { code: 1, stdout: '', stderr: 'boom' };
      return { code: 0, stdout: JSON.stringify(String(args[3]).includes('ruflo-swarm') ? VALIDATE_SWARM : VALIDATE_MODS), stderr: '' };
    }
    return { code: w.toggleCode ?? 0, stdout: '{"ok":true}', stderr: '' };
  };
  return {
    exec,
    claude,
    claudeVersion: '2.1.287',
    env: {},
    configDir: CFG,
    exists: (p) => p in w.files || w.dirs.includes(p),
    readText: text,
    listDir: (p) => (p === join(CLONE, 'plugins') ? ['ruflo-mods', 'ruflo-swarm', 'ruflo-core'] : []),
    now: () => new Date('2026-10-01T00:00:00Z'),
  };
}

const modDir = (dir: string, version = '0.1.0') => ({
  [join(dir, 'hooks', 'hooks.json')]: { modules: ['./register.ts'] },
  [join(dir, '.claude-plugin', 'plugin.json')]: { name: 'x', version },
});

function world(extra: Partial<World> = {}): World {
  return {
    files: {
      [join(CFG, 'plugins', 'known_marketplaces.json')]: { ruflo: { installLocation: CLONE } },
      ...modDir(join(CLONE, 'plugins', 'ruflo-mods')),
      ...modDir(join(CLONE, 'plugins', 'ruflo-swarm'), '0.3.0'),
      [join(CLONE, 'plugins', 'ruflo-core', '.claude-plugin', 'plugin.json')]: { name: 'ruflo-core' }, // not a mod: no modules
      ...modDir(CACHE('ruflo-mods')),
      [join(ROOT, '.claude', 'settings.local.json')]: { enabledPlugins: { 'ruflo-mods@ruflo': true, 'ruflo-swarm@ruflo': false } },
      [join(CFG, 'settings.json')]: { enabledPlugins: { 'ruflo-swarm@ruflo': true } },
    },
    dirs: [CLONE, CACHE('ruflo-mods'), join(CLONE, 'plugins', 'ruflo-mods'), join(CLONE, 'plugins', 'ruflo-swarm')],
    calls: [],
    list: [
      { id: 'ruflo-mods@ruflo', version: '0.1.0', scope: 'local', enabled: true, installPath: CACHE('ruflo-mods'), projectPath: ROOT },
      { id: 'ruflo-swarm@ruflo', version: '0.3.0', scope: 'local', enabled: true, installPath: '/gone', projectPath: '/other/project' },
      { id: 'frontend-design@claude-plugins-official', version: '1', scope: 'user', installPath: '/p' },
    ],
    ...extra,
  };
}

describe('ADR-406 validate notes', () => {
  it('parses hooks (matchers stripped, raw kept) and calls (noun.method, via stripped)', () => {
    const scan = parseValidateNotes(VALIDATE_SWARM)!;
    expect(scan.events).toEqual(['session.start', 'ui.render', 'ui.close', 'command.run', 'turn.start', 'turn.complete', 'agent.spawn', 'tool.call', '*']);
    expect(scan.calls).toContain('process.run');
    expect(scan.calls).toContain('ui.resolve');
    expect(scan.calls.every((c) => /^[a-z]+\.[a-z]+$/i.test(c))).toBe(true);
    expect(scan.raw).toHaveLength(2);
    expect(parseValidateNotes(VALIDATE_MODS)!.calls).toEqual(expect.arrayContaining(['env.set', 'fs.write', 'settings.read']));
  });

  it('a non-mod plugin has an empty scan; garbage is null', () => {
    expect(parseValidateNotes({ contents: [] })).toEqual({ events: [], calls: [], raw: [] });
    expect(parseValidateNotes('nope')).toBeNull();
    expect(parseValidateNotes({ contents: [{ notes: ['./a.ts hooks: x{a=1,b=2}, y'] }] })!.events).toEqual(['x', 'y']);
  });
});

describe('ADR-406 trust verdicts (ruflo-mods gate rules)', () => {
  const swarm = parseValidateNotes(VALIDATE_SWARM)!;
  const gate = (modTrust: 'observe' | 'refuse-risky' | 'off', allow: string[] = [], enabled = true) => ({ enabled, modTrust, allow });

  it('vendored risk lists match plugins/ruflo-mods/hooks/trust.ts exactly (parity)', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../../../plugins/ruflo-mods/hooks/trust.ts', import.meta.url)), 'utf8');
    const block = (name: string) => {
      const body = new RegExp(`const ${name}: Record<string, string> = \\{([\\s\\S]*?)\\n\\}`).exec(src)![1]!;
      return Object.fromEntries([...body.matchAll(/'([^']+)': '([^']+)'/g)].map((m) => [m[1], m[2]]));
    };
    expect(block('RISKY_CALLS')).toEqual(RISKY_CALLS);
    expect(block('RISKY_EVENTS')).toEqual(RISKY_EVENTS);
  });

  it('words risk as the gate does', () => {
    expect(riskOf(swarm)).toEqual(['process.run (runs host commands)', 'on tool.call (can rewrite or answer tool calls)', 'on * (sees every event)']);
  });

  it('each verdict', () => {
    expect(verdictOf('ruflo-mods@ruflo', swarm, gate('refuse-risky')).verdict).toBe('gate');
    expect(verdictOf('ruflo-swarm@ruflo', swarm, gate('refuse-risky', [], false)).verdict).toBe('no-gate');
    expect(verdictOf('ruflo-swarm@ruflo', swarm, gate('off')).verdict).toBe('off');
    expect(verdictOf('ruflo-swarm@ruflo', swarm, gate('refuse-risky', ['ruflo-swarm@ruflo'])).verdict).toBe('allowed');
    expect(verdictOf('ruflo-swarm@ruflo', null, gate('observe')).verdict).toBe('unknown');
    expect(verdictOf('ruflo-x@ruflo', { events: ['session.start'], calls: ['ui.log'], raw: [] }, gate('refuse-risky')).verdict).toBe('clean');
    expect(verdictOf('ruflo-swarm@ruflo', swarm, gate('refuse-risky')).verdict).toBe('refused');
    expect(verdictOf('ruflo-swarm@ruflo', swarm, gate('observe')).verdict).toBe('observed');
  });

  it('gate options merge local over project over user; allow is a comma list', () => {
    const g = gateOf({
      user: { pluginConfigs: { 'ruflo-mods@ruflo': { options: { modTrust: 'off' } } }, enabledPlugins: { 'ruflo-mods@ruflo': true } },
      project: null,
      local: { pluginConfigs: { 'ruflo-mods@ruflo': { options: { modTrust: 'refuse-risky', modTrustAllow: ' ruflo-mods-manager@ruflo, x@y ' } } } },
    });
    expect(g).toEqual({ enabled: true, modTrust: 'refuse-risky', allow: ['ruflo-mods-manager@ruflo', 'x@y'] });
    expect(gateOf({ user: {}, project: {}, local: {} })).toEqual({ enabled: false, modTrust: 'observe', allow: [] });
  });
});

describe('ADR-406 mods list', () => {
  it('lists ruflo mods only, sorted, with the documented shape', async () => {
    const w = world();
    const list = await listMods(ROOT, depsOf(w));
    expect(Object.keys(list)).toEqual(['version', 'generatedAt', 'projectRoot', 'claude', 'gate', 'mods', 'errors']);
    expect(list.mods.map((m) => m.id)).toEqual(['ruflo-mods-manager@ruflo', 'ruflo-mods@ruflo', 'ruflo-swarm@ruflo']);
    expect(list.claude).toEqual({ path: '/bin/claude', version: '2.1.287' });
    expect(list.errors).toEqual([]);
    const mods = list.mods.find((m) => m.id === 'ruflo-mods@ruflo')!;
    expect(mods).toMatchObject({ name: 'ruflo-mods', version: '0.1.0', enabled: true, installed: true, installScope: 'local', resolvable: true, source: 'installed', scanError: null, lastRefusal: null, trust: { verdict: 'gate' } });
    expect(Object.keys(mods)).toEqual(['id', 'name', 'version', 'enabledIn', 'enabled', 'installed', 'installScope', 'installPath', 'resolvable', 'source', 'scan', 'scanError', 'scannedFrom', 'trust', 'lastRefusal']);
  });

  it('local settings win over user; another project install does not count; a known mod is listed without a scan', async () => {
    const list = await listMods(ROOT, depsOf(world()));
    const swarm = list.mods.find((m) => m.id === 'ruflo-swarm@ruflo')!;
    expect(swarm.enabledIn).toEqual({ user: true, project: false, local: false });
    expect(swarm.enabled).toBe(false);
    expect(swarm).toMatchObject({ installed: false, resolvable: false, source: 'marketplace', version: '0.3.0', trust: { verdict: 'observed' } });
    const manager = list.mods.find((m) => m.id === 'ruflo-mods-manager@ruflo')!;
    expect(manager).toMatchObject({ source: 'known', scan: null, scanError: 'no plugin folder on disk to validate', trust: { verdict: 'unknown' } });
  });

  it('no claude: nothing installed, scans null with the reason, never guessed', async () => {
    const list = await listMods(ROOT, depsOf(world(), null));
    expect(list.claude).toBeNull();
    for (const m of list.mods) expect(m).toMatchObject({ installed: false, scan: null, scanError: 'no runnable claude on PATH' });
  });

  it('a failing validate is reported per mod; an unreadable settings file is an error, its scope null', async () => {
    const w = world({ failValidate: true });
    w.files[join(ROOT, '.claude', 'settings.json')] = '{ broken';
    const list = await listMods(ROOT, depsOf(w));
    expect(list.mods.find((m) => m.id === 'ruflo-mods@ruflo')!.scanError).toMatch(/no report \(exit 1\)/);
    expect(list.mods[0]!.enabledIn.project).toBeNull();
    expect(list.errors[0]).toMatch(/settings\.json is not readable JSON/);
  });
});

describe('ADR-406 mods enable|disable', () => {
  it('runs claude plugin enable|disable with fixed argv for a listed ruflo mod', async () => {
    const w = world();
    const r = await toggleMod('disable', 'ruflo-swarm@ruflo', 'project', ROOT, depsOf(w));
    expect(r).toMatchObject({ version: 1, ok: true, action: 'disable', id: 'ruflo-swarm@ruflo', scope: 'project', note: expect.stringContaining('/reload-plugins') });
    expect(w.calls.at(-1)).toEqual(['plugin', 'disable', 'ruflo-swarm@ruflo', '--scope', 'project', '--json']);
  });

  it('refuses a non-ruflo id, an injection-shaped id, an unlisted id and a bad scope, running nothing', async () => {
    for (const [id, scope, msg] of [
      ['frontend-design@claude-plugins-official', 'local', /not a ruflo mod id/],
      ['ruflo-x@ruflo; rm -rf /', 'local', /not a ruflo mod id/],
      ['ruflo-unknown@ruflo', 'local', /not a ruflo mod this project knows/],
      ['ruflo-swarm@ruflo', 'global', /--scope must be/],
    ] as const) {
      const w = world();
      const r = await toggleMod('enable', id, scope, ROOT, depsOf(w));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(msg);
      expect(w.calls.filter((c) => c[1] === 'enable')).toEqual([]);
    }
  });

  it('no claude: exit-1 shape with the manual command; a failing claude keeps its output', async () => {
    expect(await toggleMod('enable', 'ruflo-swarm@ruflo', 'local', ROOT, depsOf(world(), null))).toMatchObject({ ok: false, manual: 'claude plugin enable ruflo-swarm@ruflo --scope local', argv: null });
    const r = await toggleMod('enable', 'ruflo-swarm@ruflo', 'local', ROOT, depsOf(world({ toggleCode: 2 })));
    expect(r).toMatchObject({ ok: false, error: 'claude exited 2', output: '{"ok":true}' });
  });
});
