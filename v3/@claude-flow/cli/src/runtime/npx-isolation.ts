/**
 * `npx` resolves a package from the nearest project: its `node_modules/.bin`,
 * its dependency tree and its `.npmrc`. MCP tools spawn `npx <pkg>` from the
 * server's working directory, which is the repository the user opened.
 * `--prefix <dir>` makes npm use a ruflo-owned, empty directory as the project
 * instead. The child process still runs in the original working directory.
 *
 * npm derives its global config path from the prefix, so `--globalconfig` is
 * passed explicitly to keep the user's global npmrc (registry, proxy, CA).
 * The user config (`~/.npmrc`) and the npx cache are unaffected.
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function npxPrefixDir(home: string = homedir()): string {
  return join(home, '.claude-flow', 'npx-prefix');
}

/** npm's global config file when no prefix is forced: `<global prefix>/etc/npmrc`. */
export function npmGlobalConfigPath(env: NodeJS.ProcessEnv = process.env, execPath: string = process.execPath): string {
  const explicit = env.npm_config_globalconfig || env.NPM_CONFIG_GLOBALCONFIG;
  if (explicit) return explicit;
  const prefix = env.npm_config_global_prefix || env.npm_config_prefix || env.NPM_CONFIG_PREFIX || env.PREFIX
    || (process.platform === 'win32' ? dirname(execPath) : dirname(dirname(execPath)));
  return join(prefix, 'etc', 'npmrc');
}

/** Args to place before the package spec in every tool-time `npx` call. */
export function npxIsolationArgs(home: string = homedir()): string[] {
  const dir = npxPrefixDir(home);
  try { mkdirSync(dir, { recursive: true }); } catch { /* npx reports a missing prefix itself */ }
  return ['--prefix', dir, '--globalconfig', npmGlobalConfigPath()];
}
