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
 */

import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { ENABLE_ENV } from './install.js';
import { resolvePluginPaths, type ResolveOptions, type PluginPaths } from './plugin-paths.js';

export const DEFAULT_WORKER_PLUGINS: readonly string[] = ['ruflo-mods'];
export const PROFILE_ENV = 'RUFLO_HEADLESS_PLUGINS';

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

export function withHeadlessPlugins<E extends Record<string, string | undefined>>(
  argv: readonly string[],
  env: E,
  opts: HeadlessPluginOptions = {},
): HeadlessPluginResult<E> {
  const profile = workerProfile(opts.env ?? (env as NodeJS.ProcessEnv), opts.profile);
  const outArgv = [...argv];
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
