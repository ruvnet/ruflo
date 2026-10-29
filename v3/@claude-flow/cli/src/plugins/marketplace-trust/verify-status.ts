/**
 * Where the ruflo marketplace verification lands (ADR-509 §2.1): `ruflo mods
 * install`, `ruflo mods doctor` and `ruflo plugins verify` check the clone
 * Claude Code loads from (and the install cache) and write the result to a
 * status file that the ruflo-mods `plugin.register` gate reads under
 * `modTrust: refuse-risky`.
 *
 * The file lives under the user's home (~/.claude-flow/mods/plugin-verify.json),
 * not in a project: the clone is per Claude Code config dir, and a repository
 * must not be able to ship a file that says its own tampered clone verified.
 * It is keyed by config dir, so two config dirs never overwrite each other.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { listMarketplacePlugins, verifyPluginDir, type PluginVerification, type VerifyResult } from './signature.js';

export const VERIFY_STATUS_RELATIVE = join('.claude-flow', 'mods', 'plugin-verify.json');

export interface VerifyStatusEntry {
  writtenAt: string;
  clone: string;
  /**
   * Plugin name → the WORST result across its clone copy and every install-cache
   * copy: Claude Code loads an installed plugin from the cache, so a clean clone
   * next to a tampered cache must not read as verified.
   */
  plugins: Record<string, VerifyResult>;
  /** Plugin directory (normalized, see normalizeTrustPath) → that copy's own result: the mod looks up the dir it is loading. */
  paths?: Record<string, VerifyResult>;
}
export interface VerifyStatusFile {
  version: 1;
  byConfigDir: Record<string, VerifyStatusEntry>;
}

/**
 * The one spelling of a path both sides key on (the CLI writing, the mod
 * reading): forward slashes, no repeated or trailing slash, and a Windows
 * drive path lower-cased (Windows paths are case-insensitive, and HOME /
 * USERPROFILE / os.homedir() disagree on separators). Kept byte-identical to
 * plugins/ruflo-mods/hooks/trust.ts normalizeTrustPath.
 */
export function normalizeTrustPath(p: string): string {
  let out = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (out.length > 1) out = out.replace(/\/+$/, '');
  return /^[A-Za-z]:(\/|$)/.test(out) ? out.toLowerCase() : out;
}

const RANK: Record<VerifyResult, number> = { verified: 0, unsigned: 1, modified: 2, 'bad-signature': 3 };

/** The worse of two results (bad-signature > modified > unsigned > verified). */
export const worseResult = (a: VerifyResult | undefined, b: VerifyResult): VerifyResult => (a === undefined || RANK[b] > RANK[a] ? b : a);

export const verifyStatusPath = (home: string = homedir()) => join(home, VERIFY_STATUS_RELATIVE);

export function readVerifyStatus(home: string = homedir()): VerifyStatusFile {
  try {
    const parsed = JSON.parse(readFileSync(verifyStatusPath(home), 'utf-8')) as VerifyStatusFile;
    if (parsed && parsed.version === 1 && parsed.byConfigDir && typeof parsed.byConfigDir === 'object') return parsed;
  } catch {
    // absent or unreadable: nothing verified yet
  }
  return { version: 1, byConfigDir: {} };
}

/**
 * Record the clone's results and the install-cache copies' (`cache`): per plugin
 * the worst of all its copies, and per copy its own result keyed by directory.
 */
export function writeVerifyStatus(
  configDir: string,
  clone: string,
  results: readonly PluginVerification[],
  home: string = homedir(),
  cache: readonly PluginVerification[] = [],
): string {
  const file = readVerifyStatus(home);
  const plugins: Record<string, VerifyResult> = {};
  const paths: Record<string, VerifyResult> = {};
  for (const r of [...results, ...cache]) {
    plugins[r.plugin] = worseResult(plugins[r.plugin], r.result);
    const key = normalizeTrustPath(r.dir);
    paths[key] = worseResult(paths[key], r.result);
  }
  const key = normalizeTrustPath(configDir);
  // An entry an older writer keyed with another spelling of the same dir is replaced, not left beside it.
  for (const k of Object.keys(file.byConfigDir)) if (k !== key && normalizeTrustPath(k) === key) delete file.byConfigDir[k];
  file.byConfigDir[key] = { writtenAt: new Date().toISOString(), clone, plugins, paths };
  const path = verifyStatusPath(home);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n', 'utf-8');
  renameSync(tmp, path);
  return path;
}

/** Verify every plugin a clone lists (or only `names`). A plugin not in the clone is skipped. */
export function verifyClone(clone: string, names?: readonly string[]): PluginVerification[] {
  const want = names && names.length ? new Set(names) : null;
  return listMarketplacePlugins(clone)
    .filter((p) => !want || want.has(p.name))
    .filter((p) => existsSync(join(p.dir, '.claude-plugin', 'plugin.json')))
    .map((p) => verifyPluginDir(p.dir, p.name));
}

/** Install-cache copies of ruflo plugins (installed_plugins.json), each verified as its own row. */
export function verifyInstallCache(configDir: string, marketplace: string, names?: readonly string[]): PluginVerification[] {
  let installed: unknown;
  try {
    installed = JSON.parse(readFileSync(join(configDir, 'plugins', 'installed_plugins.json'), 'utf-8'));
  } catch {
    return [];
  }
  const plugins = (installed as { plugins?: Record<string, unknown> } | null)?.plugins;
  if (!plugins || typeof plugins !== 'object') return [];
  const out: PluginVerification[] = [];
  for (const [id, entries] of Object.entries(plugins)) {
    const at = id.lastIndexOf('@');
    if (at <= 0 || id.slice(at + 1) !== marketplace) continue;
    const name = id.slice(0, at);
    if (names && names.length && !names.includes(name)) continue;
    for (const e of Array.isArray(entries) ? entries : []) {
      const path = (e as { installPath?: unknown })?.installPath;
      if (typeof path === 'string' && existsSync(join(path, '.claude-plugin', 'plugin.json'))) out.push(verifyPluginDir(path, name));
    }
  }
  return out;
}

/** The results that §2.1 makes enforceable under refuse-risky. */
export const isUntrusted = (r: VerifyResult) => r === 'modified' || r === 'bad-signature';
