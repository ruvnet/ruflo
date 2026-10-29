/**
 * ADR-510 — where a ruflo plugin lives on disk, for a headless `claude -p`
 * worker (`--plugin-dir <path>`) or an Agent SDK session
 * (`plugins: [{ type: "local", path }]`).
 *
 * `claude -p` on a fresh config loads no marketplace plugins: the marketplace
 * is cloned only by an interactive, trusted start. So a worker has to be told
 * where each plugin is. Sources, in order:
 *
 *   1. a `--source local` directory marketplace (a ruflo checkout), declared in
 *      the project's settings (`extraKnownMarketplaces.ruflo`) or known to
 *      Claude Code (`known_marketplaces.json`);
 *   2. the marketplace clone (`<config>/plugins/marketplaces/ruflo/...`);
 *   3. the install cache (`<config>/plugins/cache/ruflo/<name>/<version>`).
 *
 * A folder without `.claude-plugin/plugin.json` is never returned: the plugin
 * is reported missing instead. Read-only; the filesystem is injectable.
 */

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { MARKETPLACE_NAME, settingsFileFor } from './install.js';
import { claudeConfigDir, marketplaceState, nodeReadFs, pluginManifestIn, type ReadFs } from './plugin-resolve.js';

export type PluginSource = 'local' | 'clone' | 'cache';

export interface ResolvedPlugin {
  name: string;
  /** Absolute plugin folder (the one holding `.claude-plugin/plugin.json`). */
  path: string;
  source: PluginSource;
}

export interface MissingPlugin {
  name: string;
  reason: string;
}

export interface PluginPaths {
  resolved: ResolvedPlugin[];
  missing: MissingPlugin[];
}

/** ReadFs plus a directory listing (for the install cache's version folders). */
export interface PluginFs extends ReadFs {
  list(path: string): string[];
}

export const nodePluginFs: PluginFs = {
  ...nodeReadFs,
  list: (p) => {
    try {
      return existsSync(p) ? readdirSync(p) : [];
    } catch {
      return [];
    }
  },
};

export interface ResolveOptions {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  fs?: PluginFs;
}

const MANIFEST = join('.claude-plugin', 'plugin.json');

function readJson(fs: ReadFs, path: string): unknown {
  const text = fs.readText(path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The directory a `--source local` install declared for the ruflo marketplace, if any. */
function localMarketplaceDir(projectRoot: string, configDir: string, fs: ReadFs): string | null {
  for (const file of [settingsFileFor(projectRoot, 'local'), settingsFileFor(projectRoot, 'project')]) {
    const settings = readJson(fs, file);
    const entry = isRecord(settings) && isRecord(settings.extraKnownMarketplaces) ? settings.extraKnownMarketplaces[MARKETPLACE_NAME] : undefined;
    const source = isRecord(entry) && isRecord(entry.source) ? entry.source : undefined;
    if (source?.source === 'directory' && typeof source.path === 'string') {
      return isAbsolute(source.path) ? source.path : resolve(projectRoot, source.path);
    }
  }
  const market = marketplaceState(configDir, fs);
  if (market.source?.source === 'directory') {
    return market.location ?? (typeof market.source.path === 'string' ? market.source.path : null);
  }
  return null;
}

/** Numeric-aware version compare ("0.10.0" > "0.9.3"); non-numeric parts compare as text. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    const d = !Number.isNaN(nx) && !Number.isNaN(ny) ? nx - ny : x.localeCompare(y);
    if (d !== 0) return d;
  }
  return 0;
}

/** The cached install: installed_plugins.json's path first, else the highest version folder. */
function cachedPluginDir(configDir: string, name: string, fs: PluginFs): string | null {
  const record = readJson(fs, join(configDir, 'plugins', 'installed_plugins.json'));
  const plugins = isRecord(record) && isRecord(record.plugins) ? record.plugins : undefined;
  const entries = plugins && Array.isArray(plugins[`${name}@${MARKETPLACE_NAME}`]) ? (plugins[`${name}@${MARKETPLACE_NAME}`] as unknown[]) : [];
  for (const e of entries) {
    if (isRecord(e) && typeof e.installPath === 'string' && fs.exists(join(e.installPath, MANIFEST))) return e.installPath;
  }
  const base = join(configDir, 'plugins', 'cache', MARKETPLACE_NAME, name);
  const versions = fs.list(base).filter((v) => fs.exists(join(base, v, MANIFEST))).sort(compareVersions);
  return versions.length > 0 ? join(base, versions[versions.length - 1]!) : null;
}

/** Plugin folder from a marketplace root (its marketplace.json `source`, else plugins/<name>). */
function pluginDirIn(root: string, name: string, fs: ReadFs): string | null {
  const manifest = pluginManifestIn(root, `${name}@${MARKETPLACE_NAME}`, fs);
  return fs.exists(manifest) ? dirname(dirname(manifest)) : null;
}

/** Resolve each plugin name (e.g. `ruflo-mods`) to an absolute folder, or report it missing. */
export function resolvePluginPaths(names: readonly string[], opts: ResolveOptions = {}): PluginPaths {
  const env = opts.env ?? process.env;
  const fs = opts.fs ?? nodePluginFs;
  const projectRoot = resolve(opts.projectRoot ?? process.cwd());
  const configDir = claudeConfigDir(env, opts.home ?? homedir());
  const local = localMarketplaceDir(projectRoot, configDir, fs);
  const market = marketplaceState(configDir, fs);
  const clone = market.source?.source === 'directory' ? null : market.location;

  const out: PluginPaths = { resolved: [], missing: [] };
  for (const raw of names) {
    const name = raw.split('@')[0]!.trim();
    if (!name) continue;
    const fromLocal = local ? pluginDirIn(local, name, fs) : null;
    const fromClone = !fromLocal && clone ? pluginDirIn(clone, name, fs) : null;
    const fromCache = !fromLocal && !fromClone ? cachedPluginDir(configDir, name, fs) : null;
    const hit: [string | null, PluginSource][] = [[fromLocal, 'local'], [fromClone, 'clone'], [fromCache, 'cache']];
    const found = hit.find(([p]) => p !== null);
    if (found) {
      out.resolved.push({ name, path: resolve(found[0]!), source: found[1] });
    } else {
      const looked = [local && `local marketplace ${local}`, clone && `clone ${clone}`, `cache ${join(configDir, 'plugins', 'cache', MARKETPLACE_NAME, name)}`].filter(Boolean);
      out.missing.push({ name, reason: `no ${MANIFEST} in ${looked.join(', ')}` });
    }
  }
  return out;
}
