/**
 * Cross-platform command resolution utility.
 *
 * On Windows, globally-installed npm packages are exposed as `.cmd` batch
 * wrappers. Node.js `spawn` (without `shell: true`) cannot find `.cmd`
 * files via PATH because it bypasses the shell's command resolution.
 *
 * Rather than enabling `shell: true` (which introduces cmd.exe escaping
 * vulnerabilities and process-orphaning issues), this utility resolves a
 * command name to its absolute path so `spawn` can invoke it directly.
 *
 * Fixes: https://github.com/ruvnet/claude-flow/issues/615
 */

import { existsSync } from 'fs';
import { join, resolve } from 'path';

/** Extensions to try when resolving commands on Windows. */
const WIN_EXTENSIONS = ['.cmd', '.bat', '.exe', '.ps1', ''];

/**
 * Resolve a command name to its absolute filesystem path.
 *
 * On non-Windows platforms this is a no-op and returns the command as-is,
 * because Unix `spawn` can resolve bare names from PATH without a shell.
 *
 * On Windows it scans every directory in PATH for the command with each
 * known executable extension, returning the first match.
 *
 * @param cmd - The bare command name (e.g. `"claude"`, `"npm"`)
 * @returns The absolute path on Windows, or the original name on Unix.
 */
export function resolveCommand(cmd: string): string {
  if (process.platform !== 'win32') {
    return cmd;
  }

  // If the command is already an absolute path, return it as-is.
  if (cmd.includes('\\') || cmd.includes('/')) {
    return cmd;
  }

  const pathDirs = (process.env.PATH || '').split(';').filter(Boolean);

  for (const dir of pathDirs) {
    for (const ext of WIN_EXTENSIONS) {
      const candidate = resolve(dir, cmd + ext);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  // Fallback: return the original name and let spawn fail with a clear error.
  return cmd;
}

/**
 * Check whether a command is available on the system.
 *
 * Uses `resolveCommand` on Windows and falls back to `which`/`where` via
 * execSync for a definitive answer.
 *
 * @param cmd - The bare command name (e.g. `"claude"`)
 * @returns `true` if the command can be found.
 */
export function isCommandAvailable(cmd: string): boolean {
  if (process.platform === 'win32') {
    return resolveCommand(cmd) !== cmd;
  }

  // On Unix, try to resolve via which
  try {
    const { execSync } = require('child_process');
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
