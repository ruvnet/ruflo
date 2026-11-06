/**
 * Add-ons: heavy optional capabilities installed on demand (ADR-525).
 *
 * The default install carries what init, memory, swarm, hooks and MCP need.
 * A capability that needs a heavy runtime is installed once with
 * `ruflo add <name>` into a user-level add-on root (`~/.ruflo/addons`), so it
 * survives `npx ruflo`, whose own node_modules is a throwaway npx cache.
 *
 * Call sites import through `importAddon()`: normal module resolution first,
 * then the add-on root. Nothing here installs anything; resolution only reads
 * package.json files and never executes package code.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type AddonName = 'learning';

export interface AddonSpec {
  /** npm package installed by `ruflo add <name>`. */
  pkg: string;
  /** Version range the CLI was tested with; `ruflo add` installs exactly this range. */
  range: string;
  /** What the add-on enables, for `ruflo add --list` and doctor. */
  provides: string;
  /** The feature named in the one-line hint when the add-on is missing. */
  feature: string;
  /** Approximate install footprint, shown before installing (no network needed). */
  approxSize: string;
}

export const ADDONS: Readonly<Record<AddonName, AddonSpec>> = Object.freeze({
  learning: Object.freeze({
    pkg: 'agentic-flow',
    range: '^3.0.0',
    provides: 'autopilot learning, ReasoningBank memory retrieval, agentic-flow embeddings',
    feature: 'autopilot learning',
    approxSize: '~1.8 GB in its own add-on root, ~30 s on a fast network (measured 2026-11-06)',
  }),
});

export function isAddonName(name: unknown): name is AddonName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(ADDONS, name);
}

/** The user-level add-on root: `RUFLO_ADDONS_DIR`, else `~/.ruflo/addons`. */
export function addonRoot(): string {
  const override = process.env.RUFLO_ADDONS_DIR?.trim();
  if (override) return resolve(override);
  return join(homedir(), '.ruflo', 'addons');
}

/** One line telling the user how to get a missing capability. */
export function addonHint(name: AddonName, feature?: string): string {
  const spec = ADDONS[name];
  return `${feature ?? spec.feature} needs ${spec.pkg}: run \`ruflo add ${name}\``;
}

// ── Specifier parsing ─────────────────────────────────────────

const PKG_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;

interface ParsedSpecifier {
  pkg: string;
  /** '.' for the package root, otherwise './sub/path'. */
  subpath: string;
}

/** Split a bare specifier into package name and subpath; null if it is not a safe bare specifier. */
export function parseSpecifier(specifier: string): ParsedSpecifier | null {
  if (typeof specifier !== 'string' || specifier.length === 0 || specifier.length > 256) return null;
  const parts = specifier.split('/');
  const nameParts = specifier.startsWith('@') ? 2 : 1;
  if (parts.length < nameParts) return null;
  const pkg = parts.slice(0, nameParts).join('/');
  if (!PKG_NAME.test(pkg)) return null;
  const rest = parts.slice(nameParts);
  if (rest.some((s) => s === '' || s === '.' || s === '..' || s.includes('\\') || s.includes('\0'))) return null;
  return { pkg, subpath: rest.length === 0 ? '.' : `./${rest.join('/')}` };
}

// ── Package location ──────────────────────────────────────────

export interface AddonPackageRoot {
  dir: string;
  /** 'local': found by normal resolution from the CLI. 'addon': found in the add-on root. */
  source: 'local' | 'addon';
}

function localPackageDir(pkg: string): string | null {
  let paths: string[] | null = null;
  try {
    paths = createRequire(import.meta.url).resolve.paths(pkg);
  } catch {
    return null;
  }
  for (const base of paths ?? []) {
    const dir = join(base, pkg);
    if (existsSync(join(dir, 'package.json'))) return dir;
  }
  return null;
}

function addonPackageDir(pkg: string): string | null {
  const dir = join(addonRoot(), 'node_modules', pkg);
  return existsSync(join(dir, 'package.json')) ? dir : null;
}

/**
 * Find an installed package's root directory: normal resolution from the CLI
 * first, then the add-on root. Returns null when it is installed in neither.
 */
export function resolveAddonPackageRoot(pkg: string): AddonPackageRoot | null {
  if (!PKG_NAME.test(pkg)) return null;
  const local = localPackageDir(pkg);
  if (local) return { dir: local, source: 'local' };
  const addon = addonPackageDir(pkg);
  if (addon) return { dir: addon, source: 'addon' };
  return null;
}

/** The installed version of a package root, or null when package.json is unreadable. */
export function readPackageVersion(dir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

// ── package.json "exports" resolution ─────────────────────────

/** Conditions active for an ESM import under Node, matched in the object's own key order. */
const IMPORT_CONDITIONS = new Set(['import', 'node', 'default']);

function pickTarget(target: unknown, conditions: Set<string>): string | null {
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) {
    for (const t of target) {
      const picked = pickTarget(t, conditions);
      if (picked) return picked;
    }
    return null;
  }
  if (target && typeof target === 'object') {
    for (const [key, value] of Object.entries(target as Record<string, unknown>)) {
      if (!conditions.has(key)) continue;
      const picked = pickTarget(value, conditions);
      if (picked) return picked;
    }
  }
  return null;
}

function pickWithFallback(target: unknown): string | null {
  return pickTarget(target, IMPORT_CONDITIONS) ?? pickTarget(target, new Set(['require']));
}

/**
 * Resolve a subpath against a package.json `exports` field. Handles a string,
 * an array, a top-level condition object, a subpath map with condition
 * objects as values, and single `*` subpath patterns.
 */
export function resolveExportsTarget(exportsField: unknown, subpath: string): string | null {
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) {
    return subpath === '.' ? pickWithFallback(exportsField) : null;
  }
  if (!exportsField || typeof exportsField !== 'object') return null;
  const map = exportsField as Record<string, unknown>;
  const keys = Object.keys(map);
  if (!keys.some((k) => k.startsWith('.'))) {
    return subpath === '.' ? pickWithFallback(map) : null;
  }
  if (Object.prototype.hasOwnProperty.call(map, subpath)) return pickWithFallback(map[subpath]);
  for (const key of keys) {
    const star = key.indexOf('*');
    if (star < 0 || key.indexOf('*', star + 1) >= 0) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (subpath.length < prefix.length + suffix.length || !subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const match = subpath.slice(prefix.length, subpath.length - suffix.length);
    const target = pickWithFallback(map[key]);
    return target ? target.split('*').join(match) : null;
  }
  return null;
}

function isInside(dir: string, file: string): boolean {
  const rel = relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** Map a subpath to a file inside `dir`, honouring `exports` when present. */
function resolveInPackage(dir: string, subpath: string): string | null {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
  } catch {
    return null;
  }
  let target: string | null;
  if (pkg.exports !== undefined) {
    target = resolveExportsTarget(pkg.exports, subpath);
    if (!target || !target.startsWith('./')) return null;
  } else if (subpath === '.') {
    target = typeof pkg.main === 'string' ? pkg.main : 'index.js';
  } else {
    target = subpath;
  }
  const file = resolve(dir, target);
  if (!isInside(dir, file) || !existsSync(file)) return null;
  return pathToFileURL(file).href;
}

/**
 * Resolve a bare specifier (e.g. `agentic-flow/reasoningbank`) to a file URL:
 * a normally resolvable install first, then `<addonRoot>/node_modules/<pkg>`.
 * Reads package.json only; never executes code. Null when not installed.
 */
export function resolveAddonModule(specifier: string): string | null {
  const parsed = parseSpecifier(specifier);
  if (!parsed) return null;
  for (const dir of [localPackageDir(parsed.pkg), addonPackageDir(parsed.pkg)]) {
    if (!dir) continue;
    const url = resolveInPackage(dir, parsed.subpath);
    if (url) return url;
  }
  return null;
}

function isModuleNotFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /Cannot find (?:package|module)|Failed to (?:load|resolve)/i.test(message);
}

/**
 * Import an add-on module, or return null. Never throws.
 *
 * Normal resolution runs first, so an install next to the CLI (or a test
 * mock) wins. Only when that reports "not found" is the add-on root tried, by
 * file URL, so the add-on's own dependencies resolve from the add-on root.
 * A module that is found but throws while loading is reported as missing,
 * not silently replaced with another copy.
 */
export async function importAddon<T = Record<string, unknown>>(specifier: string): Promise<T | null> {
  const parsed = parseSpecifier(specifier);
  if (!parsed) return null;
  try {
    return (await import(/* @vite-ignore */ specifier)) as T;
  } catch (error) {
    if (!isModuleNotFound(error)) return null;
  }
  const dir = addonPackageDir(parsed.pkg);
  const url = dir ? resolveInPackage(dir, parsed.subpath) : null;
  if (!url) return null;
  try {
    return (await import(/* @vite-ignore */ url)) as T;
  } catch {
    return null;
  }
}
