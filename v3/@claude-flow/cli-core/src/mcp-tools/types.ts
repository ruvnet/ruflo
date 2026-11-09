/**
 * MCP Tool Types for CLI
 *
 * Local type definitions to avoid external imports outside package boundary.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface MCPToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

function comparablePath(p: string): string {
  // resolve() normalises separators and drops trailing slashes (except on a root).
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/**
 * True when `dir` cannot be a project root: a filesystem root ('/', 'C:\')
 * or the user's home directory. Home is checked via os.homedir() as well as
 * $HOME/$USERPROFILE — $HOME is normally unset on Windows, so a $HOME-only
 * comparison never matched there.
 */
export function isNonProjectDir(dir: string): boolean {
  const target = comparablePath(dir);
  if (target === comparablePath(path.parse(target).root)) return true;
  for (const home of [os.homedir(), process.env.HOME, process.env.USERPROFILE]) {
    if (home && comparablePath(home) === target) return true;
  }
  return false;
}

/**
 * True when `dir` carries a durable Ruflo project marker. Reads only.
 *
 * Kept identical to `isRufloProject` in @claude-flow/cli
 * (src/services/project-root.ts); a parity test pins the two copies.
 */
export function isRufloProject(dir: string): boolean {
  const root = path.resolve(dir);
  const directMarkers = [
    path.join(root, '.claude-flow', 'config.yaml'),
    path.join(root, '.claude-flow', 'config.yml'),
    path.join(root, '.claude-flow', 'config.json'),
    path.join(root, 'claude-flow.config.json'),
    path.join(root, '.swarm', 'memory.db'),
  ];
  if (directMarkers.some((marker) => fs.existsSync(marker))) return true;

  try {
    const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf-8'));
    if (settings && typeof settings === 'object' && 'claudeFlow' in settings) return true;
  } catch { /* absent/malformed/non-Ruflo settings */ }

  try {
    const mcp = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf-8'));
    const servers = mcp?.mcpServers;
    if (servers && typeof servers === 'object' && ('ruflo' in servers || 'claude-flow' in servers)) {
      return true;
    }
  } catch { /* absent/malformed/non-Ruflo MCP config */ }

  return false;
}

/**
 * #2633: Resolve the Ruflo project root that owns `startDir`.
 *
 * Walks up and returns the NEAREST directory carrying a Ruflo marker. A `.git`
 * entry (directory or worktree file) is a hard stop, so the walk never escapes
 * into an unrelated ancestor. Returns the resolved `startDir` unchanged when no
 * marker is found. Never creates anything.
 */
export function resolveProjectRoot(startDir: string): string {
  const start = path.resolve(startDir);
  let dir = start;
  for (;;) {
    if (isRufloProject(dir)) return dir;
    if (fs.existsSync(path.join(dir, '.git'))) return start;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/**
 * Returns the effective project working directory.
 * Prefers CLAUDE_FLOW_CWD (set by the MCP launcher / install script for
 * global and MCP installs where process.cwd() may not be the project) over
 * the real process.cwd(), unless it names a root or home directory.
 *
 * #2633: otherwise walks up from process.cwd() to the Ruflo project root, so
 * an agent whose shell drifted into a subdirectory still reads and writes the
 * project's state. Falls back to process.cwd() when no marker is found, or
 * when the walk lands on home / a filesystem root (e.g. ~/.claude/settings.json
 * carrying a claudeFlow key must not make $HOME the project).
 */
export function getProjectCwd(): string {
  const envCwd = process.env.CLAUDE_FLOW_CWD;
  if (envCwd && !isNonProjectDir(envCwd)) {
    return envCwd;
  }
  const cwd = process.cwd();
  const root = resolveProjectRoot(cwd);
  return isNonProjectDir(root) ? cwd : root;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: MCPToolInputSchema;
  category?: string;
  tags?: string[];
  version?: string;
  cacheable?: boolean;
  cacheTTL?: number;
  handler: (input: Record<string, unknown>, context?: Record<string, unknown>) => Promise<MCPToolResult | unknown>;
}
