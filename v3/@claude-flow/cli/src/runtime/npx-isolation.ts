/**
 * `npx` resolves a package from the nearest project: its `node_modules/.bin`,
 * its dependency tree and its `.npmrc` (registry, scopes). When an MCP tool
 * spawns `npx <pkg>` from the server's working directory, that project is
 * whatever repository the user opened, so the repository decides which code
 * runs. `--prefix <dir>` makes npm treat `<dir>` as the project instead, which
 * keeps the user's own config (`~/.npmrc`, global config) and the npx cache but
 * ignores the opened repository. The directory is owned by ruflo and empty.
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function npxPrefixDir(home: string = homedir()): string {
  return join(home, '.claude-flow', 'npx-prefix');
}

/** `['--prefix', <ruflo-owned dir>]`, to place before the package spec in every tool-time `npx` call. */
export function npxIsolationArgs(home: string = homedir()): string[] {
  const dir = npxPrefixDir(home);
  try { mkdirSync(dir, { recursive: true }); } catch { /* npx reports a missing prefix itself */ }
  return ['--prefix', dir];
}
