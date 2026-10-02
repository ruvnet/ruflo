/**
 * `ruflo mods list|enable|disable` (ADR-406): the ruflo-family mods, as
 * Claude Code itself records them, for the mod manager pane and for people.
 *
 * Read-only except enable/disable, which run `claude plugin enable|disable`
 * by fixed argv (execFile, no shell) for an id that is ruflo's and listed.
 * Installed, version and install path come from `claude plugin list --json`;
 * what a mod hooks and calls from `claude plugin validate --json`; the trust
 * verdict from ruflo-mods' own gate rules (vendored, held by a parity test).
 * A fact that cannot be had is null with a reason, never a default.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { readSettingsFile, settingsFileFor } from '../mods/install.js';
import { claudeConfigDir, marketplaceState } from '../mods/plugin-resolve.js';
import { findClaudeBinary, nodeExec, type Exec } from '../mods/plugin-repair.js';
import { defaultVersionOf } from '../mods/claude-installs.js';

export const GATE_ID = 'ruflo-mods@ruflo';
export const RUFLO_MOD_ID = /^ruflo-[a-z0-9-]{1,48}@ruflo$/;
export const KNOWN_MODS = ['ruflo-mods@ruflo', 'ruflo-swarm@ruflo', 'ruflo-mods-manager@ruflo'] as const;
export const LIST_TIMEOUT_MS = 30_000;
export const VALIDATE_TIMEOUT_MS = 20_000;
export const TOGGLE_TIMEOUT_MS = 60_000;
export const TOGGLE_NOTE = 'takes effect in the next session or after /reload-plugins';

/** Vendored from plugins/ruflo-mods/hooks/trust.ts (parity-tested): calls that reach outside the session. */
export const RISKY_CALLS: Record<string, string> = {
  'process.run': 'runs host commands',
  'http.fetch': 'makes network requests',
  'env.set': 'changes the environment of later hooks and tools',
  'fs.write': 'writes files (settings, hooks, helpers included)',
};

/** Vendored from plugins/ruflo-mods/hooks/trust.ts (parity-tested): hooks that decide for, or over, everything else. */
export const RISKY_EVENTS: Record<string, string> = {
  'tool.check': 'can answer tool permission verdicts',
  'tool.call': 'can rewrite or answer tool calls',
  '*': 'sees every event',
  'classic.*': 'can answer every settings hook',
  'plugin.register': 'can refuse other mods',
  'prompt.compose': 'can rewrite the system prompt',
};

export type SettingsScope = 'user' | 'project' | 'local';
export type Verdict = 'gate' | 'no-gate' | 'off' | 'allowed' | 'clean' | 'observed' | 'refused' | 'unknown';
export type TrustPolicy = 'observe' | 'refuse-risky' | 'off';
export interface Scan { events: string[]; calls: string[]; raw: string[] }

export interface ModEntry {
  id: string;
  name: string;
  version: string | null;
  enabledIn: Record<SettingsScope, boolean | null>;
  enabled: boolean;
  installed: boolean;
  installScope: SettingsScope | null;
  installPath: string | null;
  resolvable: boolean;
  source: 'installed' | 'marketplace' | 'known';
  scan: Scan | null;
  scanError: string | null;
  /** The folder the scan read: the install, or the marketplace clone when the install has no hooks module (an older version). */
  scannedFrom: string | null;
  trust: { verdict: Verdict; risk: string[] };
  lastRefusal: null;
}

export interface ModsList {
  version: 1;
  generatedAt: string;
  projectRoot: string;
  claude: { path: string; version: string | null } | null;
  gate: { enabled: boolean; modTrust: TrustPolicy; allow: string[] };
  mods: ModEntry[];
  errors: string[];
}

/** What listing reads and runs; injectable so tests never touch the real ~/.claude or a real claude. */
export interface ListDeps {
  exec: Exec;
  claude: string | null;
  claudeVersion?: string | null;
  env: NodeJS.ProcessEnv;
  configDir: string;
  exists: (path: string) => boolean;
  readText: (path: string) => string | undefined;
  listDir: (path: string) => string[];
  now?: () => Date;
}

export function defaultDeps(env: NodeJS.ProcessEnv = process.env, home = homedir()): ListDeps {
  const claude = findClaudeBinary(env, home);
  return {
    exec: nodeExec,
    claude,
    claudeVersion: claude ? defaultVersionOf(claude) : null,
    env,
    configDir: claudeConfigDir(env, home),
    exists: (p) => existsSync(p),
    readText: (p) => {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        return undefined;
      }
    },
    listDir: (p) => {
      try {
        return readdirSync(p);
      } catch {
        return [];
      }
    },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Splits on commas outside `{…}` matchers. */
function splitTop(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '{') depth++;
    if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** The `hooks:` and `calls:` notes of `claude plugin validate --json`, as events and `noun.method` calls. */
export function parseValidateNotes(report: unknown): Scan | null {
  if (!isRecord(report) || !Array.isArray(report.contents)) return null;
  const events = new Set<string>();
  const calls = new Set<string>();
  const raw: string[] = [];
  for (const content of report.contents) {
    const notes = isRecord(content) && Array.isArray(content.notes) ? content.notes : [];
    for (const note of notes) {
      if (typeof note !== 'string') continue;
      const hooks = /^\S+ hooks: (.*)$/.exec(note);
      const called = /^\S+ calls: (.*)$/.exec(note);
      if (hooks) {
        raw.push(note);
        for (const h of splitTop(hooks[1]!)) events.add(h.replace(/\{.*\}$/, '').trim());
      } else if (called) {
        raw.push(note);
        for (const c of splitTop(called[1]!)) {
          const m = /^\$\.([A-Za-z0-9_]+\.[A-Za-z0-9_]+)/.exec(c.trim());
          if (m) calls.add(m[1]!);
        }
      }
    }
  }
  return { events: [...events].filter(Boolean), calls: [...calls], raw };
}

/** ruflo-mods' riskOf over a scan: readable reasons, as the gate words them. */
export function riskOf(scan: Scan): string[] {
  return [
    ...scan.calls.filter((c) => c in RISKY_CALLS).map((c) => `${c} (${RISKY_CALLS[c]})`),
    ...scan.events.filter((e) => e in RISKY_EVENTS).map((e) => `on ${e} (${RISKY_EVENTS[e]})`),
  ];
}

export function verdictOf(id: string, scan: Scan | null, gate: ModsList['gate']): ModEntry['trust'] {
  const risk = scan ? riskOf(scan) : [];
  if (id === GATE_ID) return { verdict: 'gate', risk };
  if (!gate.enabled) return { verdict: 'no-gate', risk };
  if (gate.modTrust === 'off') return { verdict: 'off', risk };
  if (gate.allow.includes(id)) return { verdict: 'allowed', risk };
  if (!scan) return { verdict: 'unknown', risk };
  if (risk.length === 0) return { verdict: 'clean', risk };
  return { verdict: gate.modTrust === 'refuse-risky' ? 'refused' : 'observed', risk };
}

function settingsFiles(root: string, configDir: string): Record<SettingsScope, string> {
  return { user: join(configDir, 'settings.json'), project: settingsFileFor(root, 'project'), local: settingsFileFor(root, 'local') };
}

function readScope(path: string, deps: ListDeps): Record<string, unknown> | null {
  if (!deps.exists(path)) return {};
  const parsed = parseJson(deps.readText(path));
  return isRecord(parsed) ? parsed : null;
}

/** ruflo-mods' gate options from the merged settings (local over project over user). */
export function gateOf(scopes: Record<SettingsScope, Record<string, unknown> | null>): ModsList['gate'] {
  let options: Record<string, unknown> = {};
  let enabled = false;
  for (const scope of ['user', 'project', 'local'] as const) {
    const s = scopes[scope];
    if (!s) continue;
    const opt = isRecord(s.pluginConfigs) && isRecord(s.pluginConfigs[GATE_ID]) ? (s.pluginConfigs[GATE_ID] as Record<string, unknown>).options : undefined;
    if (isRecord(opt)) options = { ...options, ...opt };
    if (isRecord(s.enabledPlugins) && typeof s.enabledPlugins[GATE_ID] === 'boolean') enabled = s.enabledPlugins[GATE_ID] as boolean;
  }
  const modTrust: TrustPolicy = options.modTrust === 'refuse-risky' || options.modTrust === 'off' ? options.modTrust : 'observe';
  const allow = typeof options.modTrustAllow === 'string' ? options.modTrustAllow.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return { enabled, modTrust, allow };
}

function isModDir(dir: string, deps: ListDeps): boolean {
  const hooks = parseJson(deps.readText(join(dir, 'hooks', 'hooks.json')));
  return isRecord(hooks) && Array.isArray(hooks.modules) && hooks.modules.length > 0;
}

function versionAt(dir: string, deps: ListDeps): string | null {
  const manifest = parseJson(deps.readText(join(dir, '.claude-plugin', 'plugin.json')));
  return isRecord(manifest) && typeof manifest.version === 'string' ? manifest.version : null;
}

interface Installed { scope: SettingsScope; installPath: string; version: string | null }

async function listInstalled(root: string, deps: ListDeps, errors: string[]): Promise<Map<string, Installed>> {
  const found = new Map<string, Installed>();
  if (!deps.claude) return found;
  const r = await deps.exec(deps.claude, ['plugin', 'list', '--json'], { cwd: root, timeout: LIST_TIMEOUT_MS, env: deps.env });
  const parsed = r.code === 0 ? parseJson(r.stdout.slice(r.stdout.indexOf('['))) : undefined;
  if (!Array.isArray(parsed)) {
    errors.push(`claude plugin list --json failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().split('\n').pop() ?? ''}`);
    return found;
  }
  for (const e of parsed) {
    if (!isRecord(e) || typeof e.id !== 'string' || !e.id.endsWith('@ruflo') || typeof e.installPath !== 'string') continue;
    const scope = e.scope === 'user' || e.scope === 'project' || e.scope === 'local' ? e.scope : null;
    if (!scope) continue;
    const forHere = scope === 'user' || (typeof e.projectPath === 'string' && resolve(e.projectPath) === resolve(root));
    if (!forHere || found.has(e.id)) continue;
    found.set(e.id, { scope, installPath: e.installPath, version: typeof e.version === 'string' && e.version !== 'unknown' ? e.version : null });
  }
  return found;
}

async function scanOf(dir: string | null, root: string, deps: ListDeps): Promise<{ scan: Scan | null; scanError: string | null }> {
  if (!deps.claude) return { scan: null, scanError: 'no runnable claude on PATH' };
  if (!dir || !deps.exists(dir)) return { scan: null, scanError: 'no plugin folder on disk to validate' };
  try {
    const r = await deps.exec(deps.claude, ['plugin', 'validate', '--json', dir], { cwd: root, timeout: VALIDATE_TIMEOUT_MS, env: deps.env });
    const scan = parseValidateNotes(parseJson(r.stdout.slice(r.stdout.indexOf('{'))));
    return scan ? { scan, scanError: null } : { scan: null, scanError: `claude plugin validate gave no report (exit ${r.code})` };
  } catch (error) {
    return { scan: null, scanError: (error as Error).message };
  }
}

/** Every ruflo-family mod for this project, from Claude Code's records and the marketplace clone. */
export async function listMods(projectRoot: string, deps: ListDeps): Promise<ModsList> {
  const root = resolve(projectRoot);
  const errors: string[] = [];
  const files = settingsFiles(root, deps.configDir);
  const scopes = { user: readScope(files.user, deps), project: readScope(files.project, deps), local: readScope(files.local, deps) };
  for (const s of ['user', 'project', 'local'] as const) if (scopes[s] === null) errors.push(`${files[s]} is not readable JSON`);
  const gate = gateOf(scopes);

  const installed = await listInstalled(root, deps, errors).catch((error: Error) => {
    errors.push(`claude plugin list --json: ${error.message}`);
    return new Map<string, Installed>();
  });
  const clone = marketplaceState(deps.configDir, { exists: deps.exists, readText: deps.readText }).location;
  const candidates = new Map<string, { dir: string | null; source: ModEntry['source'] }>();
  for (const [id, inst] of installed) if (isModDir(inst.installPath, deps)) candidates.set(id, { dir: inst.installPath, source: 'installed' });
  if (clone) {
    for (const name of deps.listDir(join(clone, 'plugins'))) {
      const id = `${name}@ruflo`;
      const dir = join(clone, 'plugins', name);
      if (!candidates.has(id) && RUFLO_MOD_ID.test(id) && isModDir(dir, deps)) candidates.set(id, { dir, source: 'marketplace' });
    }
  }
  for (const id of KNOWN_MODS) if (!candidates.has(id)) candidates.set(id, { dir: null, source: 'known' });

  const mods: ModEntry[] = [];
  for (const [id, cand] of [...candidates].sort(([a], [b]) => a.localeCompare(b))) {
    const enabledIn = {} as Record<SettingsScope, boolean | null>;
    for (const s of ['user', 'project', 'local'] as const) {
      const v = scopes[s];
      enabledIn[s] = v === null ? null : isRecord(v.enabledPlugins) && v.enabledPlugins[id] === true;
    }
    const pick = (['local', 'project', 'user'] as const).find((s) => {
      const v = scopes[s];
      return v !== null && isRecord(v.enabledPlugins) && typeof v.enabledPlugins[id] === 'boolean';
    });
    const enabled = pick ? enabledIn[pick] === true : false;
    const inst = installed.get(id) ?? null;
    const { scan, scanError } = await scanOf(cand.dir, root, deps);
    mods.push({
      id,
      name: id.slice(0, id.indexOf('@')),
      version: inst?.version ?? (cand.dir ? versionAt(cand.dir, deps) : null),
      enabledIn,
      enabled,
      installed: inst !== null,
      installScope: inst?.scope ?? null,
      installPath: inst?.installPath ?? null,
      resolvable: inst !== null && deps.exists(inst.installPath),
      source: cand.source,
      scan,
      scanError,
      scannedFrom: scan ? cand.dir : null,
      trust: verdictOf(id, scan, gate),
      lastRefusal: null,
    });
  }
  return {
    version: 1,
    generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
    projectRoot: root,
    claude: deps.claude ? { path: deps.claude, version: deps.claudeVersion ?? null } : null,
    gate,
    mods,
    errors,
  };
}

export interface ToggleResult {
  version: 1;
  ok: boolean;
  action: 'enable' | 'disable';
  id: string;
  scope: string;
  argv: string[] | null;
  output: string;
  error?: string;
  manual?: string;
  note: string;
}

/** Enable or disable one listed ruflo mod through `claude plugin enable|disable`. */
export async function toggleMod(action: 'enable' | 'disable', id: string, scope: string, projectRoot: string, deps: ListDeps): Promise<ToggleResult> {
  const base = { version: 1 as const, action, id, scope, argv: null, output: '', note: TOGGLE_NOTE };
  const manual = `claude plugin ${action} ${id} --scope ${scope}`;
  if (!RUFLO_MOD_ID.test(id)) return { ...base, ok: false, error: `not a ruflo mod id (expected ruflo-<name>@ruflo): ${JSON.stringify(id).slice(0, 80)}` };
  if (scope !== 'user' && scope !== 'project' && scope !== 'local') return { ...base, ok: false, error: `--scope must be user, project or local, got ${JSON.stringify(scope).slice(0, 40)}` };
  const listed = await listMods(projectRoot, deps);
  if (!listed.mods.some((m) => m.id === id)) return { ...base, ok: false, error: `${id} is not a ruflo mod this project knows (see ruflo mods list); other plugins go through /plugin` };
  if (!deps.claude) return { ...base, ok: false, error: 'no runnable claude on PATH', manual };
  const argv = ['plugin', action, id, '--scope', scope, '--json'];
  try {
    const r = await deps.exec(deps.claude, argv, { cwd: resolve(projectRoot), timeout: TOGGLE_TIMEOUT_MS, env: deps.env });
    const out = `${r.stdout}${r.stderr}`.trim();
    return r.code === 0 ? { ...base, ok: true, argv, output: out } : { ...base, ok: false, argv, output: out, error: `claude exited ${r.code}`, manual };
  } catch (error) {
    return { ...base, ok: false, argv, error: (error as Error).message, manual };
  }
}

function projectRoot(ctx: CommandContext): string {
  return (ctx.flags.projectRoot as string | undefined) ?? (ctx.flags['project-root'] as string | undefined) ?? ctx.cwd ?? process.cwd();
}

const rootOption = { name: 'project-root', description: 'Project root (default: current directory)', type: 'string' as const };
const jsonOption = { name: 'json', description: 'Output as JSON', type: 'boolean' as const, default: false };

const mark = (v: boolean | null) => (v === null ? '?' : v ? 'y' : '-');

/** Injectable for tests; the real filesystem and claude otherwise. */
export const manageDeps = { make: (): ListDeps => defaultDeps() };

export const modsListSub: Command = {
  name: 'list',
  description: 'List ruflo-family mods: enabled, installed, resolvable, hooks and trust verdict (ADR-406)',
  options: [rootOption, jsonOption],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const list = await listMods(projectRoot(ctx), manageDeps.make());
    if (ctx.flags.json) {
      output.printJson(list);
      return { success: true, data: list };
    }
    output.writeln(`claude: ${list.claude ? `${list.claude.path} (${list.claude.version ?? 'version unknown'})` : 'not found'} · gate: ${list.gate.enabled ? list.gate.modTrust : 'ruflo-mods not enabled'}`);
    output.writeln('id                              version   enabled installed resolvable trust      events');
    for (const m of list.mods) {
      output.writeln(`${m.id.padEnd(32)}${(m.version ?? '?').padEnd(10)}${mark(m.enabled).padEnd(8)}${mark(m.installed).padEnd(10)}${mark(m.resolvable).padEnd(11)}${m.trust.verdict.padEnd(11)}${m.scan ? m.scan.events.length : `unknown: ${m.scanError}`}`);
    }
    for (const e of list.errors) output.printWarning(e);
    return { success: true, data: list };
  },
};

function toggleSub(action: 'enable' | 'disable'): Command {
  return {
    name: action,
    description: `${action === 'enable' ? 'Enable' : 'Disable'} a ruflo mod via \`claude plugin ${action}\` (ruflo-family ids only)`,
    options: [rootOption, jsonOption, { name: 'scope', description: 'user | project | local (default local)', type: 'string', default: 'local' }],
    action: async (ctx: CommandContext): Promise<CommandResult> => {
      const id = String(ctx.args[0] ?? ctx.flags.id ?? '');
      const scope = String(ctx.flags.scope ?? 'local');
      const r = await toggleMod(action, id, scope, projectRoot(ctx), manageDeps.make());
      if (ctx.flags.json) output.printJson(r);
      else if (r.ok) output.printSuccess(`${action}d ${id} (${scope}); ${TOGGLE_NOTE}`);
      else {
        output.printError(`${action} ${id}: ${r.error}`);
        if (r.manual) output.writeln(`  run: ${r.manual}`);
      }
      return r.ok ? { success: true, data: r } : { success: false, exitCode: 1, data: r };
    },
  };
}

export const modsEnableSub = toggleSub('enable');
export const modsDisableSub = toggleSub('disable');
