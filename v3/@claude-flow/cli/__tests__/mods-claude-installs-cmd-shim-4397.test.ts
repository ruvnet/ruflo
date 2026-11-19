// #4397 part 3: an npm-global claude.cmd shim must be probed through cmd.exe,
// not execFile'd directly (Node rejects that with EINVAL on Windows).
import { afterEach, describe, it, expect, vi } from 'vitest';
import { openSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { findClaudeInstalls, judgeInstalls, versionProbe } from '../src/mods/claude-installs.js';

describe('versionProbe (#4397)', () => {
  const shim = 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd';
  it('routes a .cmd shim on win32 through cmd.exe with a quoted path', () => {
    const p = versionProbe(shim, 'win32', 'cmd.exe');
    expect(p).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', `""${shim}" --version"`],
      windowsVerbatimArguments: true,
    });
  });
  it('matches .bat and is case-insensitive', () => {
    expect(versionProbe('C:\\x\\CLAUDE.CMD', 'win32', 'cmd.exe')?.command).toBe('cmd.exe');
    expect(versionProbe('C:\\x\\c.bat', 'win32', 'cmd.exe')?.command).toBe('cmd.exe');
  });
  it('does not probe a shim path containing cmd metacharacters', () => {
    for (const bad of ['C:\\a&calc\\claude.cmd', 'C:\\a%PATH%\\claude.cmd', 'C:\\a^b\\claude.cmd', 'C:\\a|b\\claude.cmd']) {
      expect(versionProbe(bad, 'win32', 'cmd.exe')).toBeNull();
    }
  });
  it('execs .exe and non-Windows binaries directly', () => {
    expect(versionProbe('C:\\x\\claude.exe', 'win32')).toEqual({ command: 'C:\\x\\claude.exe', args: ['--version'] });
    expect(versionProbe('/usr/bin/claude', 'linux')).toEqual({ command: '/usr/bin/claude', args: ['--version'] });
    expect(versionProbe('/opt/claude.cmd', 'linux')?.command).toBe('/opt/claude.cmd');
  });
});

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, openSync: vi.fn(fs.openSync) };
});

// npm/cmd-shim generates both launchers for one entrypoint. These synthetic
// fixtures model its legacy basedir and modern basedir_win forms; never run them.

const { openSync: realOpenSync } = await vi.importActual<typeof import('node:fs')>('node:fs');

const target = 'node_modules/@anthropic-ai/claude-code/cli.js';
const cmdShim = (entry = target, modern = false) => [
  '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start',
  'SETLOCAL', 'CALL :find_dp0', '', 'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"',
  ...(!modern ? ['  SET PATHEXT=%PATHEXT:;.JS;=;%'] : []), ')', '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & '
    + (modern ? 'set PATHEXT=%PATHEXT:;.JS;=;% & ' : '')
    + `"%_prog%"  "%dp0%\\${entry.replaceAll('/', '\\')}" %*`, '',
].join('\r\n');
const shShim = (entry = target, modern = false) => [
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

const directCmdShim = (entry: string) => [
  '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start',
  'SETLOCAL', 'CALL :find_dp0', `"%dp0%\\${entry.replaceAll('/', '\\')}"   %*`, '',
].join('\r\n');
const directShShim = (entry: string, modern = false) => {
  const node = shShim(entry, modern);
  return node.slice(0, node.indexOf(modern ? 'PROG_EXE=' : 'if [ -x')) + `exec "$basedir/${entry}"   "$@"\n`;
};

describe('npm companion launchers (#4397)', () => {
  let scratch: string | undefined;
  afterEach(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); scratch = undefined; });
  const setup = () => {
    scratch = mkdtempSync(join(tmpdir(), 'claude-shim-'));
    const a = join(scratch, 'native'); const b = join(scratch, 'npm');
    mkdirSync(a); mkdirSync(b);
    return { a, b, home: join(scratch, 'home') };
  };
  const file = (dir: string, name: string, body = '') => {
    const path = join(dir, name); mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body); return path;
  };
  const pair = (dir: string, modern = false, entry = target) => {
    file(dir, entry); file(dir, 'claude.cmd', cmdShim(entry, modern)); file(dir, 'claude', shShim(entry, modern));
  };
  // Restrict the platform override to this synchronous call, restoring even on error.
  const find = (dirs: string[], home: string, versions: Record<string, string>, platform = 'win32') => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
    try { return findClaudeInstalls({ PATH: dirs.join(delimiter) }, home, path => versions[path] ?? null); }
    finally { Object.defineProperty(process, 'platform', descriptor); }
  };
  for (const modern of [false, true]) {
    it(`recognizes the ${modern ? 'modern' : 'legacy'} pair without a stale warning`, () => {
      const { b, home } = setup(); pair(b, modern);
      const installs = find([b], home, { [join(b, 'claude.cmd')]: '2.1.287' });
      expect(installs).toEqual([
        { path: join(b, 'claude.cmd'), version: '2.1.287' },
        { path: join(b, 'claude'), version: '2.1.287' },
      ]);
      expect(judgeInstalls(installs, false)).toEqual({ status: 'pass', message: `claude resolves to ${join(b, 'claude.cmd')} (2.1.287): mods on by default` });
    });
  }
  it('keeps both paths in removal advice for an old npm pair behind a current native install', () => {
    const { a, b, home } = setup(); file(a, 'claude.exe'); pair(b);
    const installs = find([a, b], home, { [join(a, 'claude.exe')]: '2.1.287', [join(b, 'claude.cmd')]: '2.1.107' });
    expect(installs.map(i => i.version)).toEqual(['2.1.287', '2.1.107', '2.1.107']);
    expect(judgeInstalls(installs, false)).toEqual({
      status: 'warn',
      message: `claude resolves to ${join(a, 'claude.exe')} (2.1.287): mods on by default; also installed: ${join(b, 'claude.cmd')} (2.1.107), ${join(b, 'claude')} (2.1.107). The first on PATH runs; a stale one can shadow a current one.`,
      fix: `put the claude you want first on PATH, or remove: ${join(b, 'claude.cmd')} ${join(b, 'claude')}`,
    });
  });
  for (const modern of [false, true]) {
    it(`recognizes the ${modern ? 'modern' : 'legacy'} native-executable pair`, () => {
      const { b, home } = setup(); const entry = 'node_modules/@anthropic-ai/claude-code/bin/claude.exe';
      file(b, entry, 'synthetic native binary'); file(b, 'claude.cmd', directCmdShim(entry)); file(b, 'claude', directShShim(entry, modern));
      const installs = find([b], home, { [join(b, 'claude.cmd')]: '2.1.310' });
      expect(installs.map(i => i.version)).toEqual(['2.1.310', '2.1.310']);
      expect(judgeInstalls(installs, false)).toEqual({ status: 'pass', message: `claude resolves to ${join(b, 'claude.cmd')} (2.1.310): mods on by default` });
    });
  }
  it('keeps both stale native npm launcher paths in removal advice', () => {
    const { a, b, home } = setup(); const entry = 'bin/claude.exe';
    file(a, 'claude.exe'); file(b, entry); file(b, 'claude.cmd', directCmdShim(entry)); file(b, 'claude', directShShim(entry));
    const installs = find([a, b], home, { [join(a, 'claude.exe')]: '2.1.310', [join(b, 'claude.cmd')]: '2.1.107' });
    expect(installs.map(i => i.version)).toEqual(['2.1.310', '2.1.107', '2.1.107']);
    expect(judgeInstalls(installs, false).fix).toBe(`put the claude you want first on PATH, or remove: ${join(b, 'claude.cmd')} ${join(b, 'claude')}`);
  });
  for (const directCmd of [false, true]) {
    it(`does not equate Node and direct execution (${directCmd ? 'native cmd' : 'node cmd'})`, () => {
      const { b, home } = setup(); file(b, target);
      file(b, 'claude.cmd', directCmd ? directCmdShim(target) : cmdShim(target));
      file(b, 'claude', directCmd ? shShim(target) : directShShim(target));
      expect(find([b], home, { [join(b, 'claude.cmd')]: '2.1.310' })[1].version).toBeNull();
    });
  }
  it('does not equate different native executable targets', () => {
    const { b, home } = setup(); file(b, 'a.exe'); file(b, 'b.exe');
    file(b, 'claude.cmd', directCmdShim('a.exe')); file(b, 'claude', directShShim('b.exe'));
    expect(find([b], home, { [join(b, 'claude.cmd')]: '2.1.310' })[1].version).toBeNull();
  });
  it('preserves a standalone unknown Git Bash launcher', () => {
    const { b, home } = setup(); file(b, 'claude', shShim()); file(b, target);
    const installs = find([b], home, {});
    expect(installs).toEqual([{ path: join(b, 'claude'), version: null }]);
    expect(judgeInstalls(installs, false).message).toBe(`claude resolves to ${join(b, 'claude')} (version unknown)`);
  });
  it('does not infer an extensionless version from a native executable', () => {
    const { b, home } = setup(); file(b, 'claude.exe'); file(b, 'claude', shShim()); file(b, target);
    expect(find([b], home, { [join(b, 'claude.exe')]: '2.1.287' })[1].version).toBeNull();
  });
  it('still warns about a stale .cmd in another directory', () => {
    const { a, b, home } = setup(); file(a, 'claude.exe'); file(b, 'claude.cmd', cmdShim());
    const result = judgeInstalls(find([a, b], home, { [join(a, 'claude.exe')]: '2.1.287', [join(b, 'claude.cmd')]: '2.1.107' }), false);
    expect(result.status).toBe('warn');
    expect(result.fix).toBe(`put the claude you want first on PATH, or remove: ${join(b, 'claude.cmd')}`);
  });
  for (const kind of ['different', 'missing', 'oversized', 'unreadable', 'unrecognized', 'comment-only', 'dynamic', 'disagreeing', 'cmd-comment-only', 'cmd-unrecognized', 'cmd-dynamic']) {
    it.skipIf(kind === 'unreadable' && process.platform === 'win32')(`does not propagate for ${kind} targets or launcher text`, () => {
      const { b, home } = setup(); pair(b); let sh = shShim(); let cmd = cmdShim();
      if (kind === 'different') { file(b, 'other.js'); sh = shShim('other.js'); }
      if (kind === 'missing') { sh = shShim('missing.js'); cmd = cmdShim('missing.js'); }
      if (kind === 'oversized') sh += '#'.repeat(65537);
      if (kind === 'unrecognized') sh = 'arbitrary launcher';
      if (kind === 'comment-only') sh = '#!/bin/sh\n# exec node  "$basedir/' + target + '" "$@"\n';
      if (kind === 'dynamic') sh = shShim('$(other)/cli.js');
      if (kind === 'disagreeing') sh = sh.replace(`exec node  "$basedir/${target}"`, 'exec node  "$basedir/other.js"');
      if (kind === 'cmd-comment-only') cmd = '@ECHO off\r\nREM "%_prog%"  "%dp0%\\' + target.replaceAll('/', '\\') + '" %*\r\n';
      if (kind === 'cmd-unrecognized') cmd += 'echo extra command\r\n';
      if (kind === 'cmd-dynamic') cmd = cmdShim('%OTHER%/cli.js');
      file(b, 'claude', sh); file(b, 'claude.cmd', cmd);
      if (kind === 'unreadable') vi.mocked(openSync).mockImplementationOnce(() => { throw Object.assign(new Error('synthetic read error'), { code: 'EACCES' }); });
      try {
        const installs = find([b], home, { [join(b, 'claude.cmd')]: '2.1.287' });
        expect(installs[1].version).toBeNull(); expect(judgeInstalls(installs, false).status).toBe('warn');
      } finally { if (kind === 'unreadable') vi.mocked(openSync).mockReset().mockImplementation(realOpenSync); }
    });
  }
  it.skipIf(process.platform === 'win32')('uses canonical entrypoint identity, including a symlinked entrypoint', () => {
    const { b, home } = setup(); pair(b); symlinkSync(join(b, target), join(b, 'linked.js'));
    file(b, 'claude', shShim('linked.js'));
    expect(find([b], home, { [join(b, 'claude.cmd')]: '2.1.287' })[1].version).toBe('2.1.287');
  });
  it.skipIf(process.platform === 'win32')('does not infer from a .cmd deduplicated through an earlier directory', () => {
    const { a, b, home } = setup(); pair(a); pair(b);
    // Both aliases resolve to one .cmd file, but their relative entrypoints differ.
    // Replace only the synthetic fixture link, never an installed launcher.
    rmSync(join(b, 'claude.cmd')); symlinkSync(join(a, 'claude.cmd'), join(b, 'claude.cmd'));
    const installs = find([a, b], home, { [join(a, 'claude.cmd')]: '2.1.287' });
    expect(installs.find(i => i.path === join(b, 'claude'))?.version).toBeNull();
  });
  it('does not borrow a version across directories even when entrypoints match', () => {
    const { a, b, home } = setup(); pair(a); file(b, 'claude', shShim('../native/' + target));
    expect(find([a, b], home, { [join(a, 'claude.cmd')]: '2.1.287' }).at(-1)?.version).toBeNull();
  });
  it('does not borrow an unknown .cmd version', () => {
    const { b, home } = setup(); pair(b);
    expect(find([b], home, {}).map(i => i.version)).toEqual([null, null]);
  });
  it('keeps a successful independent probe result', () => {
    const { b, home } = setup(); pair(b);
    expect(find([b], home, { [join(b, 'claude.cmd')]: '2.1.287', [join(b, 'claude')]: '2.1.107' })[1].version).toBe('2.1.107');
  });
  it('preserves Linux enumeration and probing', () => {
    const { b, home } = setup(); pair(b);
    expect(find([b], home, { [join(b, 'claude.cmd')]: '2.1.287' }, 'linux')).toEqual([{ path: join(b, 'claude'), version: null }]);
  });
});
