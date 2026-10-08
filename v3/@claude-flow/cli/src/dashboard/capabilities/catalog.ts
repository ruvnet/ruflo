/**
 * Local capability catalog, built from the plugin files Claude Code installed (never fetched). Same walk as the console's plugin catalog: plain names only,
 * confined paths, no links, 120 KB per file. Hashes are computed here from the bytes on disk; no digest a plugin ships is trusted.
 */
import { realpathSync, lstatSync } from 'node:fs';
import { join, sep } from 'node:path';
import { sha256Hex } from './hash.js';
import { listDir, readRegular } from '../read.js';
import { classifyUnbound, DEFAULT_BINDINGS, type BindingTable } from './bindings.js';
import { classifyOption } from './options.js';
import type { Catalog, CatalogCap, CatalogPlugin, CapKind } from './types.js';

export const MAX_DOC_BYTES = 120_000;
const NAME = /^[A-Za-z0-9._-]{1,80}$/;
const PLUGIN = /^([a-z0-9][a-z0-9-]{0,63})@([a-z0-9][a-z0-9-]{0,63})$/;
const VERSION = /^\d+\.\d+\.\d+[-.\w]*$/;
const OPTION_KEY = /^[A-Za-z][A-Za-z0-9]{0,47}$/;
export const TRUSTED_MARKETPLACE = 'ruflo';
const MAX_PLUGINS = 120;
const MAX_CAPS = 400;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
export const sha12 = (text: string): string => sha256Hex(text).slice(0, 12);

/** The file's text and hash if it is a regular file (no link on the path) of at most MAX_DOC_BYTES; null otherwise. */
export function readPinned(dir: string, rel: string): { text: string; sha12: string } | null {
  const f = readRegular(dir, rel, MAX_DOC_BYTES);
  return f && f.size <= MAX_DOC_BYTES ? { text: f.text, sha12: sha12(f.text) } : null;
}
function parseJson(text: string | undefined): Obj | null { try { const v = text ? (JSON.parse(text) as unknown) : null; return isObj(v) ? v : null; } catch { return null; } }

/** Where Claude Code keeps plugins for this user. Only paths inside this cache are ever read. */
export interface Roots { configDir: string; cacheDir: string }
/** A home directory (`<home>/.claude`), or explicit roots (CLAUDE_CONFIG_DIR and a relocated plugin cache). */
export function rootsFor(h: string | Roots): Roots { if (typeof h !== 'string') return h; const configDir = join(h, '.claude'); return { configDir, cacheDir: join(configDir, 'plugins', 'cache') }; }
export function pluginCacheRoot(h: string | Roots): string | null { try { return realpathSync(rootsFor(h).cacheDir); } catch { return null; } }

function installedDirs(home: string | Roots): Array<{ id: string; dir: string; entryVersion: string }> {
  const root = pluginCacheRoot(home); if (!root) return [];
  const rec = readRegular(rootsFor(home).configDir, 'plugins/installed_plugins.json', 512 * 1024);
  const plugins = parseJson(rec?.text)?.plugins; if (!isObj(plugins)) return [];
  const out: Array<{ id: string; dir: string; entryVersion: string }> = [];
  for (const [id, list] of Object.entries(plugins).slice(0, MAX_PLUGINS)) {
    if (!PLUGIN.test(id) || !Array.isArray(list)) continue;
    const e = list.find((x): x is Obj => isObj(x) && x.scope === 'user') ?? list.find(isObj);
    if (!e || typeof e.installPath !== 'string') continue;
    try {
      const real = realpathSync(e.installPath);
      if (!real.startsWith(root + sep) || !lstatSync(real).isDirectory()) continue; // an install path outside the cache is never read
      out.push({ id, dir: real, entryVersion: typeof e.version === 'string' ? e.version : '' });
    } catch { /* gone */ }
  }
  return out;
}
function enabledSet(home: string | Roots): Set<string> {
  const s = parseJson(readRegular(rootsFor(home).configDir, 'settings.json', 512 * 1024)?.text)?.enabledPlugins;
  return new Set(isObj(s) ? Object.entries(s).filter(([, v]) => v === true).map(([k]) => k) : []);
}

function buildPlugin(id: string, dir: string, entryVersion: string, enabled: boolean, table: BindingTable): CatalogPlugin | null {
  const [, name = '', marketplace = ''] = PLUGIN.exec(id) ?? [];
  const man = readPinned(dir, '.claude-plugin/plugin.json'); if (!man) return null;
  const manifest = parseJson(man.text); if (!manifest) return null;
  const version = typeof manifest.version === 'string' && VERSION.test(manifest.version) ? manifest.version : VERSION.test(entryVersion) ? entryVersion : '';
  const foreign = marketplace !== TRUSTED_MARKETPLACE;
  const cmdNames = listDir(dir, 'commands').filter(e => !e.isDir && e.name.endsWith('.md') && NAME.test(e.name.slice(0, -3))).map(e => e.name.slice(0, -3)).sort().slice(0, 200);
  const skillNames = listDir(dir, 'skills').filter(e => e.isDir && NAME.test(e.name)).map(e => e.name).sort().slice(0, 200);
  const agentCount = listDir(dir, 'agents').filter(e => !e.isDir && e.name.endsWith('.md')).length;
  const mcp = parseJson(readRegular(dir, '.mcp.json', MAX_DOC_BYTES)?.text);
  const mcpCount = mcp ? Object.keys(isObj(mcp.mcpServers) ? mcp.mcpServers : mcp).length : 0;
  const uc = isObj(manifest.userConfig) ? manifest.userConfig : {};
  const optionKeys = Object.keys(uc).filter(k => OPTION_KEY.test(k)).slice(0, 60);
  const caps: CatalogCap[] = [];
  const add = (kind: CapKind, capName: string, file: string): void => {
    if (!version || caps.length >= MAX_CAPS) return;
    const pin = readPinned(dir, file); if (!pin) return;
    const cid = `${name}/${kind}/${capName}@${version}+${pin.sha12}`;
    const b = foreign ? undefined : table.find(name, kind, capName);
    if (b) {
      caps.push({ cid, kind, name: capName, risk: b.risk, level: b.level, mode: kind === 'view' ? 'view' : 'run', binding: b, fileSha12: pin.sha12,
        ...(b.args.length ? { args: b.args.map(a => ({ name: a.name, type: a.type, ...(a.max !== undefined ? { max: a.max } : {}), ...(a.min !== undefined ? { min: a.min } : {}), ...(a.enum ? { enum: [...a.enum] } : {}) })) } : {}) });
      return;
    }
    const why = foreign ? 'foreign-marketplace' as const : classifyUnbound(name, capName);
    const risk = why === 'risk-network' ? 'network' : why === 'risk-install' ? 'install' : why === 'risk-spend' ? 'spend' : why === 'risk-delete' ? 'delete' : 'write';
    caps.push({ cid, kind, name: capName, risk, level: null, mode: 'refused', why, fileSha12: pin.sha12 });
  };
  for (const c of cmdNames) add('command', c, `commands/${c}.md`);
  for (const s of skillNames) add('skill', s, `skills/${s}/SKILL.md`);
  for (const b of table.list) if (b.plugin === name && b.kind === 'view') add('view', b.name, b.pinFile);
  const options = optionKeys.map(k => classifyOption(k, isObj(uc[k]) ? (uc[k] as Obj) : {}));
  return {
    id, name, marketplace, version: version || 'unknown', manifestSha: man.sha12, enabled, foreign,
    mod: (() => { try { return lstatSync(join(dir, 'hooks', 'register.ts')).isFile(); } catch { return false; } })(),
    counts: { commands: cmdNames.length, skills: skillNames.length, agents: agentCount, options: optionKeys.length, mcp: mcpCount }, caps, options, dir,
  };
}

/** Build the whole catalog, or only plugin `only` (used to re-verify a pin at run time). */
export function buildCatalog(home: string | Roots, only?: string, table: BindingTable = DEFAULT_BINDINGS): Catalog {
  const enabled = enabledSet(home);
  const plugins: CatalogPlugin[] = [];
  for (const i of installedDirs(home)) {
    if (only && i.id !== only) continue;
    const p = buildPlugin(i.id, i.dir, i.entryVersion, enabled.has(i.id), table);
    if (p) plugins.push(p);
  }
  plugins.sort((a, b) => a.id.localeCompare(b.id));
  const treeSha = sha256Hex(plugins.map(p => `${p.id}:${p.manifestSha}:${p.caps.map(c => c.cid).join(',')}`).join('\n')).slice(0, 12);
  return { plugins, treeSha };
}

/** The `capabilities` section body. */
export function catalogBody(cat: Catalog): Record<string, unknown> {
  const byCode: Record<string, number> = {}; let total = 0;
  for (const p of cat.plugins) for (const c of p.caps) if (c.mode === 'refused') { total++; byCode[c.why ?? 'no-binding'] = (byCode[c.why ?? 'no-binding'] ?? 0) + 1; }
  return {
    v: 1, generated: { treeSha: cat.treeSha, plugins: cat.plugins.length },
    plugins: cat.plugins.map(p => ({
      id: p.id, version: p.version, manifestSha: p.manifestSha, enabled: p.enabled, mod: p.mod, counts: p.counts,
      caps: p.caps.map(c => ({ cid: c.cid, kind: c.kind, name: c.name, risk: c.risk, level: c.level, mode: c.mode, ...(c.why ? { why: c.why } : {}), ...(c.args ? { args: c.args } : {}) })),
      options: p.options.map(o => ({ key: o.key, type: o.type, ...(o.default !== undefined ? { default: o.default } : {}), ...(o.choices ? { choices: o.choices } : {}), settable: o.settable, ...(o.why ? { why: o.why } : {}) })),
    })),
    refused: { total, byCode },
  };
}
export function pluginsBody(cat: Catalog): Record<string, unknown> {
  return { plugins: cat.plugins.map(p => ({ id: p.id, name: p.name, marketplace: p.marketplace, version: p.version, enabled: p.enabled, mod: p.mod, foreign: p.foreign, manifestSha: p.manifestSha })) };
}
