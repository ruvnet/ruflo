/**
 * ADR-510 §2.2 — give a headless `claude -p` worker its ruflo plugins.
 *
 * Every place ruflo builds a `claude -p` command line passes its argv and env
 * through `withHeadlessPlugins`. It appends `--plugin-dir <path>` per plugin
 * in the worker profile (default: ruflo-mods) and sets
 * `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` unless the caller set it (a caller's
 * `0` stays `0`). A caller's own `--plugin-dir` for the same plugin is never
 * duplicated.
 *
 * A plugin that cannot be resolved does not stop the worker: it is logged once
 * per process ("plugin <name> not found; worker runs without it") and returned
 * in `missing` for the worker's status.
 *
 * Profile override: `RUFLO_HEADLESS_PLUGINS` is a comma list of plugin names;
 * `none` (or an empty value) turns plugin loading off.
 *
 * Permission mode: Claude Code 2.1.302 starts a `claude -p` with no
 * permission mode in `manual` mode on third-party providers, with telemetry
 * off, or on a fresh install. A headless worker has nobody to answer a prompt,
 * so a print-mode argv without its own `--permission-mode` or
 * `--dangerously-skip-permissions` gets `--permission-mode auto` — the mode
 * first-party installs already started in. `RUFLO_HEADLESS_PERMISSION_MODE`
 * picks another mode; `none` (or an empty value) passes no flag.
 */

import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { ENABLE_ENV } from './install.js';
import { resolvePluginPaths, type ResolveOptions, type PluginPaths } from './plugin-paths.js';

export const DEFAULT_WORKER_PLUGINS: readonly string[] = ['ruflo-mods'];
export const PROFILE_ENV = 'RUFLO_HEADLESS_PLUGINS';
export const PERMISSION_MODE_ENV = 'RUFLO_HEADLESS_PERMISSION_MODE';
export const DEFAULT_HEADLESS_PERMISSION_MODE = 'auto';
const PERMISSION_MODES = new Set(['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'default', 'dontAsk', 'plan']);

export interface HeadlessPluginOptions extends ResolveOptions {
  /** Plugin names to load; defaults to the env profile, else DEFAULT_WORKER_PLUGINS. */
  profile?: readonly string[];
  /** Where the once-per-process warning goes (default: stderr). */
  warn?: (line: string) => void;
  /** Injectable resolver, for tests. */
  resolver?: (names: readonly string[], opts: ResolveOptions) => PluginPaths;
}

export interface HeadlessPluginResult<E> {
  argv: string[];
  env: E;
  /** Plugins loaded via --plugin-dir by this call (not the caller's own). */
  added: string[];
  /** Plugins in the profile that could not be resolved. */
  missing: string[];
}

const warned = new Set<string>();

/** For tests: forget which missing plugins were already logged. */
export function resetHeadlessPluginWarnings(): void {
  warned.clear();
}

/** The worker profile: explicit, else RUFLO_HEADLESS_PLUGINS, else ruflo-mods. */
export function workerProfile(env: NodeJS.ProcessEnv = process.env, explicit?: readonly string[]): string[] {
  if (explicit) return [...explicit];
  const raw = env[PROFILE_ENV];
  if (raw === undefined) return [...DEFAULT_WORKER_PLUGINS];
  const names = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return names.length === 1 && names[0]!.toLowerCase() === 'none' ? [] : names;
}

function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** Every `--plugin-dir` value already in argv (both `--plugin-dir x` and `--plugin-dir=x`). */
export function existingPluginDirs(argv: readonly string[]): string[] {
  const dirs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--plugin-dir' && i + 1 < argv.length) dirs.push(argv[++i]!);
    else if (a.startsWith('--plugin-dir=')) dirs.push(a.slice('--plugin-dir='.length));
  }
  return dirs;
}

/**
 * The `--permission-mode` args to append to a headless argv: none when the
 * argv is not print mode or already sets a mode, else the env choice
 * (default `auto`). An unknown mode is ignored with the default used instead.
 */
export function headlessPermissionArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): string[] {
  const isPrint = argv.some((a) => a === '-p' || a === '--print');
  if (!isPrint) return [];
  const hasMode = argv.some(
    (a) => a === '--permission-mode' || a.startsWith('--permission-mode=') || a === '--dangerously-skip-permissions',
  );
  if (hasMode) return [];
  const raw = env[PERMISSION_MODE_ENV];
  if (raw !== undefined && (raw.trim() === '' || raw.trim().toLowerCase() === 'none')) return [];
  const mode = raw !== undefined && PERMISSION_MODES.has(raw.trim()) ? raw.trim() : DEFAULT_HEADLESS_PERMISSION_MODE;
  return ['--permission-mode', mode];
}

export function withHeadlessPlugins<E extends Record<string, string | undefined>>(
  argv: readonly string[],
  env: E,
  opts: HeadlessPluginOptions = {},
): HeadlessPluginResult<E> {
  const profile = workerProfile(opts.env ?? (env as NodeJS.ProcessEnv), opts.profile);
  const outArgv = [...argv, ...headlessPermissionArgs(argv, opts.env ?? (env as NodeJS.ProcessEnv))];
  const outEnv = { ...env } as E;
  if (profile.length === 0) return { argv: outArgv, env: outEnv, added: [], missing: [] };

  const resolver = opts.resolver ?? resolvePluginPaths;
  const { resolved, missing } = resolver(profile, { ...opts, env: opts.env ?? (env as NodeJS.ProcessEnv) });
  const own = existingPluginDirs(argv);
  const ownPaths = new Set(own.map(canonical));
  const ownNames = new Set(own.map((d) => basename(resolve(d))));
  const added: string[] = [];
  for (const plugin of resolved) {
    // The caller already passes this plugin (same folder, or its own copy of it).
    if (ownPaths.has(canonical(plugin.path)) || ownNames.has(plugin.name)) continue;
    outArgv.push('--plugin-dir', plugin.path);
    added.push(plugin.name);
  }
  // A caller-supplied copy of a "missing" plugin is not missing.
  const stillMissing = missing.filter((m) => !ownNames.has(m.name)).map((m) => m.name);

  if ((added.length > 0 || own.length > 0) && outEnv[ENABLE_ENV] === undefined) {
    (outEnv as Record<string, string | undefined>)[ENABLE_ENV] = '1';
  }

  const warn = opts.warn ?? ((line: string) => process.stderr.write(`${line}\n`));
  for (const name of stillMissing) {
    if (warned.has(name)) continue;
    warned.add(name);
    warn(`plugin ${name} not found; worker runs without it`);
  }
  return { argv: outArgv, env: outEnv, added, missing: stillMissing };
}
