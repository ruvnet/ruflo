/**
 * #2640 — init defers to the installed ruflo Claude Code plugins.
 *
 * When `ruflo-core@ruflo` is installed for this project (and not switched off
 * in `enabledPlugins`), the agents, commands and skills that the installed
 * `*@ruflo` plugins ship are not copied into `.claude/` again, and the
 * standalone `claude-flow` MCP server is not registered (the plugin provides
 * one). `init --full` keeps copying everything.
 *
 * Read-only: only reads Claude Code's own records
 * (`<config>/plugins/installed_plugins.json`, settings files) and the plugin
 * install directories they point to. A missing or malformed record means
 * "no plugin", i.e. today's behaviour.
 */

import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { claudeConfigDir, installedState, nodeReadFs, type ReadFs } from '../mods/plugin-resolve.js';

export const RUFLO_CORE_PLUGIN = 'ruflo-core@ruflo';
const MARKETPLACE_SUFFIX = '@ruflo';
const MAX_DEPTH = 6;

export interface DirEntry { name: string; isDirectory: boolean }

/** Filesystem reads detection needs; injectable for tests. */
export interface DedupFs extends ReadFs {
  listDir(path: string): DirEntry[];
}

export const nodeDedupFs: DedupFs = {
  ...nodeReadFs,
  listDir: (p) => {
    try {
      return readdirSync(p, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
    } catch {
      return [];
    }
  },
};

/** What the installed plugins already provide, by the name Claude Code loads it under. */
export interface PluginProvided {
  /** Installed `*@ruflo` plugin ids that contributed. */
  plugins: string[];
  /** agent / command basename (with `.md`) → plugin id */
  agents: Map<string, string>;
  commands: Map<string, string>;
  /** skill directory name → plugin id */
  skills: Map<string, string>;
}

export interface DetectOptions {
  configDir?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  fs?: DedupFs;
}

function readJson(fs: ReadFs, path: string): unknown {
  const text = fs.readText(path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** `enabledPlugins[id]` from the most specific settings file that sets it (local > project > user). */
function enabledSetting(projectRoot: string, configDir: string, id: string, fs: ReadFs): unknown {
  const files = [
    join(projectRoot, '.claude', 'settings.local.json'),
    join(projectRoot, '.claude', 'settings.json'),
    join(configDir, 'settings.json'),
  ];
  for (const file of files) {
    const settings = readJson(fs, file);
    if (isRecord(settings) && isRecord(settings.enabledPlugins) && id in settings.enabledPlugins) {
      return settings.enabledPlugins[id];
    }
  }
  return undefined;
}

function collectMd(fs: DedupFs, dir: string, into: Map<string, string>, id: string, depth = 0): void {
  if (depth > MAX_DEPTH) return;
  for (const entry of fs.listDir(dir)) {
    if (entry.isDirectory) collectMd(fs, join(dir, entry.name), into, id, depth + 1);
    else if (entry.name.endsWith('.md') && entry.name !== 'README.md' && !into.has(entry.name)) into.set(entry.name, id);
  }
}

function collectSkills(fs: DedupFs, dir: string, into: Map<string, string>, id: string): void {
  for (const entry of fs.listDir(dir)) {
    if (entry.isDirectory && fs.exists(join(dir, entry.name, 'SKILL.md')) && !into.has(entry.name)) into.set(entry.name, id);
  }
}

/**
 * The agents, commands and skills the installed ruflo plugins provide for
 * this project, or `null` when `ruflo-core@ruflo` is not installed and
 * enabled here (then init behaves exactly as before).
 */
export function detectRufloPlugins(projectRoot: string, opts: DetectOptions = {}): PluginProvided | null {
  const fs = opts.fs ?? nodeDedupFs;
  const configDir = opts.configDir ?? claudeConfigDir(opts.env ?? process.env, opts.home ?? homedir());
  const active = (id: string) =>
    installedState(projectRoot, configDir, id, fs).installed && enabledSetting(projectRoot, configDir, id, fs) !== false;

  if (!active(RUFLO_CORE_PLUGIN)) return null;

  const registry = readJson(fs, join(configDir, 'plugins', 'installed_plugins.json'));
  const ids = isRecord(registry) && isRecord(registry.plugins)
    ? Object.keys(registry.plugins).filter((id) => id.endsWith(MARKETPLACE_SUFFIX)).sort()
    : [];

  const provided: PluginProvided = { plugins: [], agents: new Map(), commands: new Map(), skills: new Map() };
  for (const id of ids) {
    if (!active(id)) continue;
    const { installPath } = installedState(projectRoot, configDir, id, fs);
    if (!installPath) continue;
    provided.plugins.push(id);
    collectMd(fs, join(installPath, 'agents'), provided.agents, id);
    collectMd(fs, join(installPath, 'commands'), provided.commands, id);
    collectSkills(fs, join(installPath, 'skills'), provided.skills, id);
  }
  return provided;
}

/** Init's record of what it left to the plugins. */
export interface PluginDedupReport {
  plugins: string[];
  skipped: { agents: string[]; commands: string[]; skills: string[] };
  mcpServerSkipped: boolean;
}

export function emptyDedupReport(provided: PluginProvided): PluginDedupReport {
  return { plugins: [...provided.plugins], skipped: { agents: [], commands: [], skills: [] }, mcpServerSkipped: false };
}

const shortName = (id: string) => id.replace(MARKETPLACE_SUFFIX, '');

/** Lines for the summary `ruflo init` prints. Empty when nothing was skipped. */
export function formatPluginDedupSummary(report: PluginDedupReport): string[] {
  const { agents, commands, skills } = report.skipped;
  if (!agents.length && !commands.length && !skills.length && !report.mcpServerSkipped) return [];
  const names = report.plugins.map(shortName);
  const shown = names.length > 4 ? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more` : names.join(', ');
  const lines = [`Installed ruflo plugins already provide these, so init did not copy them (${shown}):`];
  if (skills.length) lines.push(`  Skills:   ${skills.length} (${skills.slice(0, 6).join(', ')}${skills.length > 6 ? ', …' : ''})`);
  if (commands.length) lines.push(`  Commands: ${commands.length}`);
  if (agents.length) lines.push(`  Agents:   ${agents.length}`);
  if (report.mcpServerSkipped) lines.push('  MCP:      standalone `claude-flow` server not registered (ruflo-core provides the MCP server)');
  lines.push('Run `ruflo init --full` to copy everything anyway.');
  return lines;
}
