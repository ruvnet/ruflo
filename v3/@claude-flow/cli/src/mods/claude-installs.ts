/**
 * Which Claude Code binaries a shell would find, and whether the one it runs
 * can load mods (ADR-404). Mods are on by default from Claude Code 2.1.287;
 * from 2.1.277 they load with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1; older
 * builds predate them. A server-side rollout switch can still hold them off
 * on any version (reported separately). A stale install earlier on PATH
 * (a 2.1.107 npm-global beside a current native one, say) silently decides.
 */

import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';

export const MODS_DEFAULT_ON = '2.1.287';
export const MODS_FIRST = '2.1.277';

export interface ClaudeInstall {
  path: string;
  version: string | null;
}

export type VersionOf = (path: string) => string | null;

const parse = (v: string) => v.split('.').map((n) => Number(n));
/** a < b for dotted numeric versions. */
export function versionLess(a: string, b: string): boolean {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  }
  return false;
}

export interface VersionProbe { command: string; args: string[]; windowsVerbatimArguments?: boolean }

/**
 * #4397: Node refuses to execFile a .cmd/.bat shim on Windows (EINVAL), so the
 * npm-global `claude.cmd` read as "version unknown". Shims go through cmd.exe
 * with the path quoted; a path holding cmd metacharacters is not probed at
 * all (null) rather than risk interpreting it.
 */
export function versionProbe(path: string, platform: NodeJS.Platform = process.platform, comspec = process.env.ComSpec || 'cmd.exe'): VersionProbe | null {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(path)) {
    if (/["&|<>^%\r\n]/.test(path)) return null;
    return { command: comspec, args: ['/d', '/s', '/c', `""${path}" --version"`], windowsVerbatimArguments: true };
  }
  return { command: path, args: ['--version'] };
}

/** `claude --version` of one binary, bounded; null when it cannot say. */
export const defaultVersionOf: VersionOf = (path) => {
  const probe = versionProbe(path);
  if (!probe) return null;
  try {
    const out = execFileSync(probe.command, probe.args, {
      encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
      ...(probe.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
    return out.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
  } catch {
    return null;
  }
};

/** Known npm/cmd-shim Node launcher forms (legacy basedir and basedir_win).
 * Match the whole template, not comments or arbitrary shell code. Unknown npm
 * versions/formats simply keep the independent probe result. Never execute it.
 */
const npmCmdShim = (entry: string, modern: boolean) => [
  '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start',
  'SETLOCAL', 'CALL :find_dp0', '', 'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"',
  ...(!modern ? ['  SET PATHEXT=%PATHEXT:;.JS;=;%'] : []), ')', '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & '
    + (modern ? 'set PATHEXT=%PATHEXT:;.JS;=;% & ' : '')
    + `"%_prog%"  "%dp0%\\${entry.replaceAll('/', '\\')}" %*`, '',
].join('\r\n');
const npmPosixShim = (entry: string, modern: boolean) => [
  '#!/bin/sh', 'basedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")',
  ...(modern ? ['basedir_win="$basedir"'] : []), '',
  modern ? 'case `uname -a` in' : 'case `uname` in',
  ...(modern ? [
    '  *CYGWIN*|*MINGW*|*MSYS*)', '    if command -v cygpath > /dev/null 2>&1; then',
    '      basedir_win=`cygpath -w "$basedir"`', '    fi', '  ;;', '  *WSL2*)',
    '    if command -v wslpath > /dev/null 2>&1; then',
    '      basedir_win="$(wslpath -w "$basedir" 2> /dev/null)"',
    '      if [ $? -ne 0 ] || [ -z "$basedir_win" ]; then',
    '        echo "Error: wslpath failed to convert path. WSL environment may be misconfigured." >&2',
    '        exit 1', '      fi', '    fi', '  ;;',
  ] : [
    '    *CYGWIN*|*MINGW*|*MSYS*)', '        if command -v cygpath > /dev/null 2>&1; then',
    '            basedir=`cygpath -w "$basedir"`', '        fi', '    ;;',
  ]), 'esac', '',
  ...(modern ? [
    'PROG_EXE="$basedir/node.exe"', 'if ! [ -x "$PROG_EXE" ]; then',
    '  PROG_EXE="$basedir/node"', '  if ! [ -x "$PROG_EXE" ]; then',
    '    PROG_EXE=node', '    if ! [ -x "$PROG_EXE" ]; then', '      PROG_EXE=node.exe',
    '    fi', '  fi', 'fi', '', `exec "$PROG_EXE"  "$basedir_win/${entry}" "$@"`,
  ] : [
    'if [ -x "$basedir/node" ]; then', `  exec "$basedir/node"  "$basedir/${entry}" "$@"`,
    'else ', `  exec node  "$basedir/${entry}" "$@"`, 'fi',
  ]), '',
].join('\n');

// A no-shebang/native bin uses npm's direct-exec forms, not a Node wrapper.
const npmDirectCmdShim = (entry: string) => [
  '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start',
  'SETLOCAL', 'CALL :find_dp0', `"%dp0%\\${entry.replaceAll('/', '\\')}"   %*`, '',
].join('\r\n');
const npmDirectPosixShim = (entry: string, modern: boolean) => {
  const nodeShim = npmPosixShim(entry, modern);
  const preamble = nodeShim.slice(0, nodeShim.indexOf(modern ? 'PROG_EXE=' : 'if [ -x'));
  return preamble + `exec "$basedir/${entry}"   "$@"\n`;
};

function npmShimTarget(path: string, cmd: boolean): { path: string; mode: 'node' | 'direct' } | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 64 * 1024) return null;
    // Also cap the actual read if a file grows after stat.
    const bytes = Buffer.alloc(64 * 1024 + 1);
    let size = 0;
    while (size < bytes.length) {
      const n = readSync(fd, bytes, size, bytes.length - size, null);
      if (!n) break;
      size += n;
    }
    if (size > 64 * 1024) return null;
    const text = bytes.subarray(0, size).toString('utf8').replace(/\r\n/g, '\n').trimEnd();
    const targets = cmd
      ? [...text.matchAll(/"%dp0%\\([^"\r\n]+)" +%\*$/gm)].map(m => m[1].replaceAll('\\', '/'))
      : [...text.matchAll(/^\s*exec (?:[^\r\n]* )?"\$basedir(?:_win)?\/([^"\r\n]+)" +"\$@"$/gm)].map(m => m[1]);
    const entry = targets[0];
    if (!entry || targets.some(t => t !== entry) || !/^[a-zA-Z0-9@._ /-]+$/.test(entry) || entry.startsWith('/')) return null;
    const template = cmd ? npmCmdShim : npmPosixShim;
    const normalize = (value: string) => value.replace(/\r\n/g, '\n').trimEnd();
    const node = [false, true].some(modern => normalize(template(entry, modern)) === text);
    const direct = cmd ? normalize(npmDirectCmdShim(entry)) === text
      : [false, true].some(modern => normalize(npmDirectPosixShim(entry, modern)) === text);
    if (!node && !direct) return null;
    const target = realpathSync(resolve(dirname(path), entry));
    return statSync(target).isFile() ? { path: target, mode: node ? 'node' : 'direct' } : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Every `claude` on PATH, in PATH order (the first is what runs), plus ~/.local/bin. */
export function findClaudeInstalls(env: NodeJS.ProcessEnv, home: string, versionOf: VersionOf = defaultVersionOf): ClaudeInstall[] {
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];
  const dirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), join(home, '.local', 'bin')];
  const seen = new Set<string>();
  const installs: ClaudeInstall[] = [];
  for (const dir of dirs) {
    let cmd: ClaudeInstall | undefined;
    for (const name of names) {
      const path = join(dir, name);
      let real: string;
      try {
        if (!existsSync(path) || !statSync(path).isFile()) continue;
        real = realpathSync(path);
      } catch {
        continue;
      }
      if (seen.has(real)) continue;
      seen.add(real);
      let version = versionOf(path);
      if (process.platform === 'win32' && name === 'claude' && version === null && cmd?.version) {
        const target = npmShimTarget(path, false);
        const cmdTarget = npmShimTarget(cmd.path, true);
        if (target && cmdTarget && target.path === cmdTarget.path && target.mode === cmdTarget.mode) version = cmd.version;
      }
      const install = { path, version };
      installs.push(install);
      // Only a .cmd actually probed in this directory can supply a version.
      // A realpath-deduplicated alias in another directory proves nothing here.
      if (name === 'claude.cmd') cmd = install;
    }
  }
  return installs;
}

export interface InstallsFinding {
  status: 'pass' | 'warn';
  message: string;
  fix?: string;
}

/** The doctor's reading of what `claude` resolves to and what else is installed. */
export function judgeInstalls(installs: readonly ClaudeInstall[], enableEnvSet: boolean): InstallsFinding {
  if (installs.length === 0) return { status: 'warn', message: 'no claude binary on PATH', fix: 'install Claude Code >= 2.1.287' };
  const [first] = installs;
  const others = installs.slice(1).filter((i) => i.version !== first!.version);
  const mixed = others.length
    ? `; also installed: ${others.map((i) => `${i.path} (${i.version ?? 'unknown'})`).join(', ')}. The first on PATH runs; a stale one can shadow a current one.`
    : '';
  const runs = `${first!.path} (${first!.version ?? 'version unknown'})`;
  if (!first!.version) return { status: 'warn', message: `claude resolves to ${runs}${mixed}`, fix: `run \`${first!.path} --version\` and reinstall Claude Code if it prints nothing` };
  if (!versionLess(first!.version, MODS_DEFAULT_ON)) {
    return others.length
      ? { status: 'warn', message: `claude resolves to ${runs}: mods on by default${mixed}`, fix: `put the claude you want first on PATH, or remove: ${others.map((i) => i.path).join(' ')}` }
      : { status: 'pass', message: `claude resolves to ${runs}: mods on by default` };
  }
  if (!versionLess(first!.version, MODS_FIRST)) {
    return enableEnvSet
      ? (others.length
        ? { status: 'warn' as const, message: `claude resolves to ${runs}: mods load with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 (set)${mixed}`, fix: `put the claude you want first on PATH, or remove: ${others.map((i) => i.path).join(' ')}` }
        : { status: 'pass' as const, message: `claude resolves to ${runs}: mods load with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 (set)` })
      : { status: 'warn', message: `claude resolves to ${runs}: below ${MODS_DEFAULT_ON}, mods need CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 (not set)${mixed}`, fix: `upgrade to >= ${MODS_DEFAULT_ON}, or export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` };
  }
  return { status: 'warn', message: `claude resolves to ${runs}: predates mods (< ${MODS_FIRST}); classic hooks handle every event${mixed}`, fix: `upgrade to >= ${MODS_DEFAULT_ON} and remove the stale install from PATH` };
}
