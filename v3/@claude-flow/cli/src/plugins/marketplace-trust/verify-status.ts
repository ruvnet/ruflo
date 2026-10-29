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
  /** Plugin name → its clone's result. Only the result is kept: the mod needs nothing more. */
  plugins: Record<string, VerifyResult>;
}
export interface VerifyStatusFile {
  version: 1;
  byConfigDir: Record<string, VerifyStatusEntry>;
}

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

export function writeVerifyStatus(configDir: string, clone: string, results: readonly PluginVerification[], home: string = homedir()): string {
  const file = readVerifyStatus(home);
  file.byConfigDir[configDir] = {
    writtenAt: new Date().toISOString(),
    clone,
    plugins: Object.fromEntries(results.map((r) => [r.plugin, r.result])),
  };
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
