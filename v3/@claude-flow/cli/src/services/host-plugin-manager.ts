/**
 * Dual-host marketplace plugin manager (#2854).
 *
 * Claude Code and Codex keep separate plugin registries. This service drives
 * each host's own plugin CLI (never its caches) with a literal argv, so one
 * `ruflo plugins host ...` call can apply the same state to both.
 *
 * Results are reported per host and per plugin. A failure on one host never
 * hides the other's outcome, and `ok` is false if any requested host failed.
 *
 * `sync` policy (documented choice): the target enabled set is the UNION of
 * the plugins enabled in either host. It is additive: a plugin missing from a
 * host is installed there; nothing is ever removed; a plugin a host has
 * installed but explicitly disabled is left disabled and reported.
 */

import {
  HOST_IDS,
  defaultHostSystemDeps,
  formatArgv,
  resolveHostExecutable,
  runHostArgv,
  type HostId,
  type HostInvocation,
  type HostSystemDeps,
} from './host-executable.js';

export * from './host-executable.js';

export type HostAction = 'install' | 'update' | 'uninstall' | 'enable' | 'disable';
export type HostScope = 'user' | 'project' | 'local';

export const DEFAULT_MARKETPLACE_SOURCE = 'ruvnet/ruflo';
export const DEFAULT_MARKETPLACE_NAME = 'ruflo';

/** Lowercase kebab-case, as the Ruflo marketplace names its plugins. No leading `-`, no shell bytes. */
const PLUGIN_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MARKETPLACE_NAME_RE = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const MARKETPLACE_SOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

export class HostPluginInputError extends Error {}

/** Validate a plugin name (or `name@<marketplace>`) before it can reach an argv. */
export function validatePluginName(raw: string, marketplaceName = DEFAULT_MARKETPLACE_NAME): string {
  const at = raw.indexOf('@');
  const name = at === -1 ? raw : raw.slice(0, at);
  if (at !== -1 && raw.slice(at + 1) !== marketplaceName) {
    throw new HostPluginInputError(`plugin "${raw}" is not from the ${marketplaceName} marketplace`);
  }
  if (!PLUGIN_NAME_RE.test(name) || name.includes('--')) {
    throw new HostPluginInputError(`invalid plugin name ${JSON.stringify(raw)}: expected lowercase letters, digits and single hyphens`);
  }
  return name;
}

export function validateMarketplace(source: string, name: string): void {
  if (!MARKETPLACE_SOURCE_RE.test(source) || source.includes('..')) {
    throw new HostPluginInputError(`invalid marketplace ${JSON.stringify(source)}: expected owner/repo`);
  }
  if (!MARKETPLACE_NAME_RE.test(name)) {
    throw new HostPluginInputError(`invalid marketplace name ${JSON.stringify(name)}`);
  }
}

export interface MarketplaceRef { source: string; name: string }

/** One argv to run against one host. */
export interface HostStep { argv: string[]; purpose: string }

export type HostArgvPlan =
  | { supported: true; steps: HostStep[] }
  | { supported: false; reason: string; manual: string };

/** Pure argv builder for a plugin action on one host. */
export function buildActionArgv(host: HostId, action: HostAction, plugin: string, scope: HostScope, mp: MarketplaceRef): HostArgvPlan {
  const id = `${plugin}@${mp.name}`;
  if (host === 'claude') {
    const steps: HostStep[] = [];
    if (action === 'update') steps.push({ argv: ['plugin', 'marketplace', 'update', mp.name], purpose: 'refresh marketplace' });
    steps.push({ argv: ['plugin', action, id, '--scope', scope], purpose: `${action} ${id}` });
    return { supported: true, steps };
  }
  if (scope !== 'user') {
    return {
      supported: false,
      reason: `Codex plugins are user-global; scope "${scope}" cannot be represented (refusing to widen it)`,
      manual: `codex plugin add ${id}   # only if you want it user-global`,
    };
  }
  switch (action) {
    case 'install':
      return { supported: true, steps: [{ argv: ['plugin', 'add', id, '--json'], purpose: `install ${id}` }] };
    case 'uninstall':
      return { supported: true, steps: [{ argv: ['plugin', 'remove', id, '--json'], purpose: `uninstall ${id}` }] };
    case 'update':
      // Codex has no `plugin update`: refresh the marketplace snapshot, then re-add.
      return {
        supported: true,
        steps: [
          { argv: ['plugin', 'marketplace', 'upgrade', mp.name], purpose: 'refresh marketplace' },
          { argv: ['plugin', 'add', id, '--json'], purpose: `reinstall ${id} from refreshed snapshot` },
        ],
      };
    default:
      // Verified against codex-cli 0.165.0: `codex plugin` has only add|list|marketplace|remove.
      return {
        supported: false,
        reason: `codex plugin has no ${action} command`,
        manual: `set \`enabled = ${action === 'enable'}\` under [plugins."${id}"] in ~/.codex/config.toml`,
      };
  }
}

export function buildMarketplaceArgv(host: HostId, op: 'add' | 'update', mp: MarketplaceRef): string[] {
  if (op === 'add') return ['plugin', 'marketplace', 'add', mp.source];
  return host === 'claude'
    ? ['plugin', 'marketplace', 'update', mp.name]
    : ['plugin', 'marketplace', 'upgrade', mp.name];
}

export function buildListArgv(kind: 'plugins' | 'marketplaces'): string[] {
  return kind === 'plugins' ? ['plugin', 'list', '--json'] : ['plugin', 'marketplace', 'list', '--json'];
}

// ── host state ────────────────────────────────────────────────────────────────

export interface HostPluginState { version: string; enabled: boolean }

export interface HostState {
  plugins: Map<string, HostPluginState>;
  /** null: no marketplace with our name. Otherwise its normalized source. */
  marketplaceSource: string | null;
}

/** github repo / git URL / local path → comparable form (`owner/repo` or `dir:<path>`). */
export function normalizeMarketplaceSource(raw: string): string {
  const m = /^(?:https?:\/\/|git@)github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(raw.trim());
  if (m) return `${m[1]}/${m[2]}`.toLowerCase();
  if (MARKETPLACE_SOURCE_RE.test(raw)) return raw.toLowerCase();
  return `dir:${raw}`;
}

type Json = Record<string, unknown>;

/** Parse `<host> plugin list --json` + `<host> plugin marketplace list --json`. */
export function parseHostState(host: HostId, pluginsJson: string, marketplacesJson: string, mp: MarketplaceRef, scope: HostScope, cwd: string): HostState {
  const plugins = new Map<string, HostPluginState>();
  const suffix = `@${mp.name}`;
  let marketplaceSource: string | null = null;

  if (host === 'claude') {
    const rows = JSON.parse(pluginsJson) as Json[];
    for (const r of Array.isArray(rows) ? rows : []) {
      const id = String(r.id ?? '');
      if (!id.endsWith(suffix) || r.scope !== scope) continue;
      if (scope !== 'user' && typeof r.projectPath === 'string' && r.projectPath !== cwd) continue;
      plugins.set(id.slice(0, -suffix.length), { version: String(r.version ?? 'unknown'), enabled: r.enabled !== false });
    }
    const mps = JSON.parse(marketplacesJson) as Json[];
    const own = (Array.isArray(mps) ? mps : []).find((m) => m.name === mp.name);
    if (own) marketplaceSource = normalizeMarketplaceSource(String(own.repo ?? own.url ?? own.path ?? ''));
  } else {
    const doc = JSON.parse(pluginsJson) as { installed?: Json[] };
    for (const r of doc.installed ?? []) {
      if (r.marketplaceName !== mp.name || r.installed === false) continue;
      plugins.set(String(r.name), { version: String(r.version ?? 'unknown'), enabled: r.enabled !== false });
    }
    const mdoc = JSON.parse(marketplacesJson) as { marketplaces?: Json[] };
    const own = (mdoc.marketplaces ?? []).find((m) => m.name === mp.name);
    if (own) {
      const src = own.marketplaceSource as Json | undefined;
      marketplaceSource = normalizeMarketplaceSource(String(src?.source ?? own.root ?? ''));
    }
  }
  return { plugins, marketplaceSource };
}

// ── results ───────────────────────────────────────────────────────────────────

export type HostOutcome = 'ok' | 'unchanged' | 'planned' | 'failed' | 'unsupported' | 'refused' | 'not-detected';

export interface HostStepResult { argv: string[]; display: string; purpose: string; ok?: boolean; stderr?: string; error?: string }

export interface HostTargetResult {
  host: HostId;
  /** Plugin name, or `(marketplace)` for a marketplace step. */
  target: string;
  outcome: HostOutcome;
  steps: HostStepResult[];
  message?: string;
  manual?: string;
}

export interface HostOperationReport {
  action: HostAction | 'sync';
  dryRun: boolean;
  ok: boolean;
  results: HostTargetResult[];
}

const FAILING: ReadonlySet<HostOutcome> = new Set(['failed', 'unsupported', 'refused']);

/** `not-detected` counts as a failure only when that host was explicitly requested. */
function summarize(action: HostOperationReport['action'], dryRun: boolean, results: HostTargetResult[], required: ReadonlySet<HostId>): HostOperationReport {
  const ok = results.every((r) => !FAILING.has(r.outcome) && !(r.outcome === 'not-detected' && required.has(r.host)));
  return { action, dryRun, ok, results };
}

// ── manager ───────────────────────────────────────────────────────────────────

export type HostSelection = 'claude' | 'codex' | 'both' | 'auto';

export interface HostOperationOptions {
  hosts?: HostSelection;
  scope?: HostScope;
  marketplace?: Partial<MarketplaceRef>;
  dryRun?: boolean;
  cwd?: string;
}

export interface SyncPlanEntry { host: HostId; target: string; argv: string[] | null; note: string }

/**
 * Pure sync planner. Marketplace first (add when absent, refresh when it is
 * the canonical source, refuse a foreign source), then union-of-enabled installs.
 */
export function planSync(states: Record<HostId, HostState>, mp: MarketplaceRef): SyncPlanEntry[] {
  const plan: SyncPlanEntry[] = [];
  const canonical = normalizeMarketplaceSource(mp.source);
  for (const host of HOST_IDS) {
    const src = states[host].marketplaceSource;
    if (src === null) plan.push({ host, target: '(marketplace)', argv: buildMarketplaceArgv(host, 'add', mp), note: 'add marketplace' });
    else if (src === canonical) plan.push({ host, target: '(marketplace)', argv: buildMarketplaceArgv(host, 'update', mp), note: 'refresh marketplace' });
    else plan.push({ host, target: '(marketplace)', argv: null, note: `refused: "${mp.name}" is registered from ${src}, not ${canonical}` });
  }
  const union = new Set<string>();
  for (const host of HOST_IDS) for (const [name, s] of states[host].plugins) if (s.enabled) union.add(name);
  for (const name of [...union].sort()) {
    for (const host of HOST_IDS) {
      const have = states[host].plugins.get(name);
      if (!have) {
        const built = buildActionArgv(host, 'install', name, 'user', mp);
        plan.push({ host, target: name, argv: built.supported ? built.steps[0]!.argv : null, note: 'install (enabled in the other host)' });
      } else if (!have.enabled) {
        plan.push({ host, target: name, argv: null, note: 'kept disabled (explicitly disabled in this host)' });
      }
    }
  }
  return plan;
}

export interface StatusRow {
  plugin: string;
  claude: HostPluginState | null;
  codex: HostPluginState | null;
  drift: string[];
}

export function computeStatus(states: Partial<Record<HostId, HostState>>): StatusRow[] {
  const names = new Set<string>();
  for (const s of Object.values(states)) for (const n of s!.plugins.keys()) names.add(n);
  return [...names].sort().map((plugin) => {
    const c = states.claude?.plugins.get(plugin) ?? null;
    const x = states.codex?.plugins.get(plugin) ?? null;
    const drift: string[] = [];
    if (states.claude && states.codex) {
      if (!c) drift.push('missing in claude');
      if (!x) drift.push('missing in codex');
      if (c && x && c.version !== x.version) drift.push(`version ${c.version} ≠ ${x.version}`);
      if (c && x && c.enabled !== x.enabled) drift.push('enabled state differs');
    }
    return { plugin, claude: c, codex: x, drift };
  });
}

export class HostPluginManager {
  constructor(private readonly deps: HostSystemDeps = defaultHostSystemDeps()) {}

  private marketplace(opts: HostOperationOptions): MarketplaceRef {
    const mp = { source: opts.marketplace?.source ?? DEFAULT_MARKETPLACE_SOURCE, name: opts.marketplace?.name ?? DEFAULT_MARKETPLACE_NAME };
    validateMarketplace(mp.source, mp.name);
    return mp;
  }

  /** Resolve every requested host before anything mutates. */
  async resolveHosts(selection: HostSelection = 'auto'): Promise<{ present: HostInvocation[]; missing: HostTargetResult[]; required: Set<HostId> }> {
    const wanted: HostId[] = selection === 'both' || selection === 'auto' ? [...HOST_IDS] : [selection];
    const required = new Set<HostId>(selection === 'auto' ? [] : wanted);
    const present: HostInvocation[] = [];
    const missing: HostTargetResult[] = [];
    for (const host of wanted) {
      const r = await resolveHostExecutable(host, this.deps);
      if (r.ok) present.push(r.invocation);
      else missing.push({ host, target: '*', outcome: 'not-detected', steps: [], message: r.reason });
    }
    if (selection === 'auto' && present.length === 0) for (const m of missing) required.add(m.host);
    return { present, missing, required };
  }

  private async readState(inv: HostInvocation, mp: MarketplaceRef, scope: HostScope, cwd: string): Promise<HostState | string> {
    const p = await runHostArgv(inv, buildListArgv('plugins'), this.deps);
    const m = await runHostArgv(inv, buildListArgv('marketplaces'), this.deps);
    if (!p.ok || !m.ok) return `could not read ${inv.host} plugin state: ${(p.ok ? m : p).error ?? 'unknown error'}`;
    try {
      return parseHostState(inv.host, p.stdout, m.stdout, mp, scope, cwd);
    } catch (e) {
      return `unparseable ${inv.host} plugin list output: ${(e as Error).message}`;
    }
  }

  private async execSteps(inv: HostInvocation, steps: HostStep[], dryRun: boolean): Promise<{ ok: boolean; results: HostStepResult[] }> {
    const results: HostStepResult[] = [];
    for (const step of steps) {
      const r: HostStepResult = { argv: step.argv, display: formatArgv(inv.host, step.argv), purpose: step.purpose };
      results.push(r);
      if (dryRun) continue;
      const run = await runHostArgv(inv, step.argv, this.deps);
      r.ok = run.ok;
      if (!run.ok) {
        r.stderr = run.stderr.trim().slice(0, 2000);
        r.error = run.error;
        return { ok: false, results };
      }
    }
    return { ok: true, results };
  }

  /** install | update | uninstall | enable | disable on every selected host. */
  async apply(action: HostAction, rawPlugins: string[], opts: HostOperationOptions = {}): Promise<HostOperationReport> {
    const mp = this.marketplace(opts);
    if (rawPlugins.length === 0) throw new HostPluginInputError(`${action} needs at least one plugin name`);
    const plugins = rawPlugins.map((p) => validatePluginName(p, mp.name));
    const scope = opts.scope ?? 'user';
    const dryRun = opts.dryRun === true;
    const { present, missing, required } = await this.resolveHosts(opts.hosts);
    const results: HostTargetResult[] = [...missing];

    for (const inv of present) {
      const state = await this.readState(inv, mp, scope, opts.cwd ?? process.cwd());
      if (typeof state !== 'string' && state.marketplaceSource === null && action === 'install') {
        const steps = [{ argv: buildMarketplaceArgv(inv.host, 'add', mp), purpose: 'add marketplace' }];
        const run = await this.execSteps(inv, steps, dryRun);
        results.push({ host: inv.host, target: '(marketplace)', outcome: dryRun ? 'planned' : run.ok ? 'ok' : 'failed', steps: run.results });
        if (!run.ok) {
          for (const p of plugins) results.push({ host: inv.host, target: p, outcome: 'failed', steps: [], message: 'marketplace add failed' });
          continue;
        }
      }
      for (const plugin of plugins) {
        const built = buildActionArgv(inv.host, action, plugin, scope, mp);
        if (!built.supported) {
          results.push({ host: inv.host, target: plugin, outcome: 'unsupported', steps: [], message: built.reason, manual: built.manual });
          continue;
        }
        const have = typeof state === 'string' ? undefined : state.plugins.get(plugin);
        const known = typeof state !== 'string';
        const noop = known && (
          (action === 'install' && have !== undefined)
          || (action === 'uninstall' && have === undefined)
          || (action === 'enable' && have?.enabled === true)
          || (action === 'disable' && have?.enabled === false));
        if (noop) {
          results.push({ host: inv.host, target: plugin, outcome: 'unchanged', steps: [], message: 'already in the requested state' });
          continue;
        }
        const run = await this.execSteps(inv, built.steps, dryRun);
        results.push({
          host: inv.host, target: plugin, steps: run.results,
          outcome: dryRun ? 'planned' : run.ok ? 'ok' : 'failed',
          message: typeof state === 'string' ? state : undefined,
        });
      }
    }
    return summarize(action, dryRun, results, required);
  }

  /** Make both hosts match: same marketplace, union of enabled plugins (additive). */
  async sync(opts: HostOperationOptions = {}): Promise<HostOperationReport & { plan: SyncPlanEntry[] }> {
    const mp = this.marketplace(opts);
    const dryRun = opts.dryRun === true;
    const scope = opts.scope ?? 'user';
    if (scope !== 'user') throw new HostPluginInputError('sync only supports --scope user: Codex plugins are user-global');
    const { present, missing } = await this.resolveHosts('both');
    const required = new Set<HostId>(HOST_IDS);
    if (missing.length > 0) return { ...summarize('sync', dryRun, missing, required), plan: [] };

    const states = {} as Record<HostId, HostState>;
    const results: HostTargetResult[] = [];
    for (const inv of present) {
      const s = await this.readState(inv, mp, scope, opts.cwd ?? process.cwd());
      if (typeof s === 'string') results.push({ host: inv.host, target: '*', outcome: 'failed', steps: [], message: s });
      else states[inv.host] = s;
    }
    if (results.length > 0) return { ...summarize('sync', dryRun, results, required), plan: [] };

    const plan = planSync(states, mp);
    const byHost = new Map(present.map((inv) => [inv.host, inv]));
    const marketFailed = new Set<HostId>();
    for (const entry of plan) {
      const inv = byHost.get(entry.host)!;
      if (entry.argv === null) {
        const refused = entry.note.startsWith('refused');
        if (refused) marketFailed.add(entry.host);
        results.push({ host: entry.host, target: entry.target, outcome: refused ? 'refused' : 'unchanged', steps: [], message: entry.note });
        continue;
      }
      if (entry.target !== '(marketplace)' && marketFailed.has(entry.host) && states[entry.host].marketplaceSource === null) {
        results.push({ host: entry.host, target: entry.target, outcome: 'failed', steps: [], message: 'skipped: marketplace unavailable' });
        continue;
      }
      const run = await this.execSteps(inv, [{ argv: entry.argv, purpose: entry.note }], dryRun);
      if (!run.ok && entry.target === '(marketplace)') marketFailed.add(entry.host);
      results.push({ host: entry.host, target: entry.target, steps: run.results, outcome: dryRun ? 'planned' : run.ok ? 'ok' : 'failed', message: entry.note });
    }
    return { ...summarize('sync', dryRun, results, required), plan };
  }

  /** Installed version per plugin per host, with drift flags. Read-only. */
  async status(opts: HostOperationOptions = {}): Promise<{ ok: boolean; rows: StatusRow[]; hosts: HostTargetResult[]; marketplaces: Partial<Record<HostId, string | null>> }> {
    const mp = this.marketplace(opts);
    const { present, missing, required } = await this.resolveHosts(opts.hosts);
    const states: Partial<Record<HostId, HostState>> = {};
    const hosts: HostTargetResult[] = [...missing];
    const marketplaces: Partial<Record<HostId, string | null>> = {};
    for (const inv of present) {
      const s = await this.readState(inv, mp, opts.scope ?? 'user', opts.cwd ?? process.cwd());
      if (typeof s === 'string') hosts.push({ host: inv.host, target: '*', outcome: 'failed', steps: [], message: s });
      else { states[inv.host] = s; marketplaces[inv.host] = s.marketplaceSource; hosts.push({ host: inv.host, target: '*', outcome: 'ok', steps: [], message: inv.resolvedFrom }); }
    }
    return { ok: summarize('install', false, hosts, required).ok, rows: computeStatus(states), hosts, marketplaces };
  }
}
