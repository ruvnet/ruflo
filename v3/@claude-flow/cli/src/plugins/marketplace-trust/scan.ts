/**
 * Static scan of a Claude Code plugin before it is installed (ADR-509 §2.2).
 *
 * Reads what the plugin will make Claude Code run: `.mcp.json` servers,
 * `hooks/hooks.json` command hooks, and its hook modules (function hooks).
 * Rules: the settings-risk-scanner command rules for anything that becomes a
 * shell command, and the ruflo-mods trust classifier's capability names for
 * hook modules (`$.process.*`, `$.http.*`, `$.mcp.*`, `$.tool.call`, ...).
 *
 * `high` stops an install (override per plugin with --accept-risk); `medium`
 * is printed and the install continues. Static by design: a hook that fetches
 * code at run time is caught only by the network/process rules (ADR-509 §3).
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { scanCommandStringForRisk } from '../../init/settings-risk-scanner.js';

export type ScanSeverity = 'high' | 'medium';
export interface ScanFinding {
  plugin: string;
  severity: ScanSeverity;
  file: string; // relative to the plugin root
  rule: string;
  detail: string;
}

/** Hook-module capabilities, named as the ruflo-mods trust classifier (hooks/trust.ts RISKY_CALLS) names them. */
const MODULE_CAPABILITIES: Array<{ re: RegExp; rule: string; detail: string }> = [
  { re: /\$\s*\.\s*process\s*\.\s*(run|spawn)\b/, rule: 'module-process', detail: 'runs host commands ($.process)' },
  { re: /\$\s*\.\s*http\s*\.\s*fetch\b/, rule: 'module-network', detail: 'makes network requests ($.http.fetch)' },
  { re: /\$\s*\.\s*mcp\s*\.\s*(call|connect)\b/, rule: 'module-mcp', detail: 'calls or connects MCP servers ($.mcp)' },
  { re: /\$\s*\.\s*tool\s*\.\s*call\b/, rule: 'module-tool-call', detail: 'runs any tool, Bash included ($.tool.call)' },
  { re: /\$\s*\.\s*config\s*\.\s*set\b/, rule: 'module-config', detail: 'changes Claude Code settings ($.config.set)' },
];
/** Node escape hatches a hook module should never need: they bypass the host's `$` entirely. */
const MODULE_ESCAPES: Array<{ re: RegExp; rule: string; detail: string }> = [
  { re: /(?:\brequire\s*\(\s*|\bimport\s*\(\s*|\bfrom\s+|\bimport\s+)['"](?:node:)?child_process['"]/, rule: 'module-child-process', detail: 'imports child_process (runs commands outside the host)' },
  { re: /\beval\s*\(|\bnew\s+Function\s*\(/, rule: 'module-dynamic-code', detail: 'evaluates code built at run time (eval / new Function)' },
];
const MODULE_EXT = /\.(ts|mts|cts|js|mjs|cjs)$/;
const MAX_FILE_BYTES = 1024 * 1024;

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return undefined;
  }
}

function scanMcp(plugin: string, root: string, out: ScanFinding[]): void {
  const file = '.mcp.json';
  if (!existsSync(join(root, file))) return;
  const parsed = readJson(join(root, file));
  const servers = record(parsed) && record(parsed.mcpServers) ? parsed.mcpServers : record(parsed) ? parsed : {};
  for (const [name, raw] of Object.entries(servers)) {
    if (!record(raw)) continue;
    const command = typeof raw.command === 'string' ? raw.command : '';
    const args = Array.isArray(raw.args) ? raw.args.filter((a): a is string => typeof a === 'string') : [];
    const line = [command, ...args].join(' ').trim();
    if (line) {
      for (const reason of scanCommandStringForRisk(line)) out.push({ plugin, severity: 'high', file, rule: 'mcp-command', detail: `server "${name}" ${reason}` });
      // `npx -y pkg` / `npx pkg@latest` runs whatever the registry serves at start time.
      if (/(^|\s)(npx|bunx|pnpx)(\s|$)/.test(line) && (/(^|\s)-y(\s|$)|--yes\b/.test(line) || /@latest\b/.test(line))) {
        out.push({ plugin, severity: 'medium', file, rule: 'mcp-unpinned-package', detail: `server "${name}" runs an unpinned package at start (${line.slice(0, 80)})` });
      }
    }
    if (typeof raw.url === 'string' && /^http:\/\//i.test(raw.url) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(raw.url)) {
      out.push({ plugin, severity: 'medium', file, rule: 'mcp-plain-http', detail: `server "${name}" connects over plain http to a remote host` });
    }
  }
}

function scanHooksJson(plugin: string, root: string, out: ScanFinding[]): void {
  const file = 'hooks/hooks.json';
  if (!existsSync(join(root, file))) return;
  const parsed = readJson(join(root, file));
  const hooks = record(parsed) && record(parsed.hooks) ? parsed.hooks : {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const list = record(group) && Array.isArray(group.hooks) ? group.hooks : [];
      for (const h of list) {
        if (!record(h) || typeof h.command !== 'string') continue;
        for (const reason of scanCommandStringForRisk(h.command)) out.push({ plugin, severity: 'high', file, rule: 'hook-command', detail: `${event}: ${reason}` });
      }
    }
  }
}

function moduleFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string, depth: number) => {
    if (depth > 6) return;
    let names: string[];
    try {
      names = readdirSync(join(root, rel));
    } catch {
      return;
    }
    for (const name of names.sort()) {
      if (name === 'node_modules' || name === '.git' || name === 'tests' || name === '__tests__') continue;
      const childRel = `${rel}/${name}`;
      const st = lstatSync(join(root, childRel));
      if (st.isDirectory()) walk(childRel, depth + 1);
      else if (st.isFile() && MODULE_EXT.test(name) && !/\.(test|spec)\.[a-z]+$/.test(name) && st.size <= MAX_FILE_BYTES) out.push(childRel);
    }
  };
  if (existsSync(join(root, 'hooks'))) walk('hooks', 0);
  return out;
}

function scanModules(plugin: string, root: string, out: ScanFinding[]): void {
  for (const file of moduleFiles(root)) {
    const text = readFileSync(join(root, file), 'utf-8');
    for (const r of MODULE_ESCAPES) if (r.re.test(text)) out.push({ plugin, severity: 'high', file, rule: r.rule, detail: r.detail });
    for (const r of MODULE_CAPABILITIES) if (r.re.test(text)) out.push({ plugin, severity: 'medium', file, rule: r.rule, detail: r.detail });
  }
}

/** Every finding for one plugin directory; empty when the plugin runs nothing on install. */
export function scanPluginDir(plugin: string, root: string): ScanFinding[] {
  const out: ScanFinding[] = [];
  if (!existsSync(root)) return out;
  scanMcp(plugin, root, out);
  scanHooksJson(plugin, root, out);
  scanModules(plugin, root, out);
  return out;
}

export const formatScanFinding = (f: ScanFinding) => `[${f.severity}] ${f.plugin}: ${f.file} (${f.rule}) ${f.detail}`;

export interface ScanGate {
  /** Plugins with a high finding that were not accepted: their install must not run. */
  blocked: string[];
  /** Plugins with a high finding that --accept-risk let through. */
  accepted: string[];
  findings: ScanFinding[];
}

/** Applies §2.2: a high finding blocks, unless the plugin is named in acceptRisk. */
export function gateScan(findings: readonly ScanFinding[], acceptRisk: ReadonlySet<string>): ScanGate {
  const high = new Set(findings.filter((f) => f.severity === 'high').map((f) => f.plugin));
  const accepted = [...high].filter((p) => acceptRisk.has(p));
  return { blocked: [...high].filter((p) => !acceptRisk.has(p)), accepted, findings: [...findings] };
}

/** `--accept-risk a,b` or repeated: plugin names (or ids) to install past a high scan finding (ADR-509 §2.2). */
export function acceptRiskFrom(flags: Record<string, unknown>): string[] {
  const raw = flags.acceptRisk ?? flags['accept-risk'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list.flatMap((v) => String(v).split(',')).map((v) => v.trim()).filter((v) => /^[A-Za-z0-9._-]{1,100}(@[A-Za-z0-9._-]{1,100})?$/.test(v));
}
