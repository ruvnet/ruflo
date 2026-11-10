/**
 * Project-root anchor for durable state (#2633, generalising #2877).
 *
 * Under an agent the Bash tool cwd is sticky, and MCP servers and hooks inherit
 * it, so raw process.cwd() is often a subdirectory of the project. State keyed
 * to it (`.claude-flow/`, `.swarm/`) was written there and never read again.
 *
 * This is a copy of `isRufloProject` / `resolveProjectRoot` in
 * @claude-flow/cli-core (src/mcp-tools/types.ts). The CLI pins a published
 * cli-core that predates those exports, so it cannot import them yet;
 * __tests__/project-root-anchor-2633.test.ts pins the two copies together.
 * Once the pin moves past the release that exports them, replace this file's
 * bodies with a re-export.
 *
 * Every function here only reads the filesystem; none creates directories.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Return true only when the directory contains a durable Ruflo project marker.
 *
 * A bare `.claude/` is owned by Claude Code, and a bare `.claude-flow/` is not
 * sufficient either: startup-time policy/champion migration can create it
 * before this function runs. Treating that mutation as authorization caused a
 * read-only command in any Claude project to spawn a detached daemon (#2852).
 */
export function isRufloProject(projectRoot: string): boolean {
  const root = path.resolve(projectRoot);
  const directMarkers = [
    path.join(root, '.claude-flow', 'config.yaml'),
    path.join(root, '.claude-flow', 'config.yml'),
    path.join(root, '.claude-flow', 'config.json'),
    path.join(root, 'claude-flow.config.json'),
    path.join(root, '.swarm', 'memory.db'),
  ];
  if (directMarkers.some((marker) => fs.existsSync(marker))) return true;

  try {
    const settings = JSON.parse(
      fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf-8'),
    );
    if (settings && typeof settings === 'object' && 'claudeFlow' in settings) {
      return true;
    }
  } catch { /* absent/malformed/non-Ruflo settings */ }

  try {
    const mcp = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf-8'));
    const servers = mcp?.mcpServers;
    if (servers && typeof servers === 'object'
      && ('ruflo' in servers || 'claude-flow' in servers)) {
      return true;
    }
  } catch { /* absent/malformed/non-Ruflo MCP config */ }

  return false;
}

/**
 * Walk up from `startDir` and return the NEAREST enclosing directory carrying
 * a Ruflo marker. Nearest-wins keeps a monorepo's independently-initialized
 * sub-project on its own state.
 *
 * A `.git` entry is a hard stop — the repository boundary. Without it the walk
 * could escape into an unrelated ancestor (a Ruflo project living at `$HOME`,
 * say) and hand every repo below it the same state.
 *
 * Returns the resolved `startDir` unchanged when no marker is found, which
 * preserves the previous cwd-relative behaviour outside a Ruflo project.
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

function comparablePath(p: string): string {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/**
 * True when `dir` is a filesystem root or the user's home directory. Same
 * check as cli-core's isNonProjectDir; kept local so this module does not
 * depend on the MCP types module (several suites mock it).
 */
function isHomeOrFsRoot(dir: string): boolean {
  const target = comparablePath(dir);
  if (target === comparablePath(path.parse(target).root)) return true;
  for (const home of [os.homedir(), process.env.HOME, process.env.USERPROFILE]) {
    if (home && comparablePath(home) === target) return true;
  }
  return false;
}

/**
 * Anchor `dir` to its project root for durable state. Like resolveProjectRoot,
 * but a walk that lands on home or a filesystem root is rejected and `dir` is
 * returned instead — `~/.claude/settings.json` carrying a `claudeFlow` key
 * must not turn $HOME into every non-git directory's project. Mirrors the
 * guard cli-core's getProjectCwd() applies, so CLI commands and MCP tools
 * agree on the root.
 */
export function anchorToProjectRoot(dir: string): string {
  const start = path.resolve(dir);
  const root = resolveProjectRoot(start);
  return isHomeOrFsRoot(root) ? start : root;
}

/**
 * The project root for the current process: anchorToProjectRoot(process.cwd()).
 * Not cached — the walk is a handful of stat calls, and tests spy on cwd.
 */
export function getProjectRoot(): string {
  return anchorToProjectRoot(process.cwd());
}
