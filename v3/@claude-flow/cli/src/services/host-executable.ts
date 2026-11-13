/**
 * Host executable resolution + literal-argv runner (#2854).
 *
 * Finds the `claude` / `codex` CLI without a shell: no `which`, no
 * `execSync` strings. PATH is scanned with fs.access(X_OK); on Windows each
 * PATHEXT extension is tried. A resolved `.exe`/`.com` is spawned directly.
 * An npm `.cmd`/`.bat` shim is never handed to cmd.exe: it is accepted only
 * when the owning npm package sits next to it and declares the expected
 * `bin`, and then the package's JavaScript entry is run with Node.
 *
 * Exported so `@claude-flow/codex`'s initializer can adopt the same
 * resolver instead of `execSync('which codex')` (follow-up, not done here).
 */

import { execFile as execFileCb } from 'node:child_process';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import * as nodePath from 'node:path';
import { promisify } from 'node:util';

export type HostId = 'claude' | 'codex';
export const HOST_IDS: readonly HostId[] = ['claude', 'codex'];

/** npm package that owns each host's launcher, and the bin name it declares. */
export const HOST_PACKAGES: Readonly<Record<HostId, { pkg: string; bin: string }>> = {
  claude: { pkg: '@anthropic-ai/claude-code', bin: 'claude' },
  codex: { pkg: '@openai/codex', bin: 'codex' },
};

/** Absolute-path override, for layouts PATH does not cover. */
export const HOST_OVERRIDE_ENV: Readonly<Record<HostId, string>> = {
  claude: 'RUFLO_CLAUDE_BIN',
  codex: 'RUFLO_CODEX_BIN',
};

export interface ExecFileResult { stdout: string; stderr: string }

/** Injectable process + fs boundary. Tests replace every member. */
export interface HostSystemDeps {
  execFile(file: string, args: readonly string[], options: { env: NodeJS.ProcessEnv; timeout: number }): Promise<ExecFileResult>;
  access(path: string, mode: number): Promise<void>;
  readFile(path: string): Promise<string>;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  execPath: string;
}

/** The exact invocation carried through an operation: `file ...prefixArgs ...argv`. */
export interface HostInvocation {
  host: HostId;
  file: string;
  prefixArgs: string[];
  /** The launcher found on disk (the shim, for a validated npm .cmd). */
  resolvedFrom: string;
}

export type HostResolution =
  | { ok: true; invocation: HostInvocation }
  | { ok: false; host: HostId; reason: string };

const execFileAsync = promisify(execFileCb);

export function defaultHostSystemDeps(): HostSystemDeps {
  return {
    async execFile(file, args, options) {
      const { stdout, stderr } = await execFileAsync(file, [...args], {
        env: options.env,
        timeout: options.timeout,
        shell: false,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        encoding: 'utf8',
      });
      return { stdout: String(stdout), stderr: String(stderr) };
    },
    access: (p, mode) => fsp.access(p, mode),
    readFile: (p) => fsp.readFile(p, 'utf8'),
    env: process.env,
    platform: process.platform,
    execPath: process.execPath,
  };
}

function pathApi(platform: NodeJS.Platform): typeof nodePath.posix {
  return platform === 'win32' ? nodePath.win32 : nodePath.posix;
}

function envValue(env: NodeJS.ProcessEnv, key: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return env[key];
  // Windows env keys are case-insensitive (Path vs PATH).
  const hit = Object.keys(env).find((k) => k.toUpperCase() === key.toUpperCase());
  return hit ? env[hit] : undefined;
}

async function isExecutable(deps: HostSystemDeps, p: string): Promise<boolean> {
  try {
    await deps.access(p, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prove an npm `.cmd`/`.bat` shim belongs to the expected package and map it
 * to `node <bin.js>`. Returns null for an unprovable or forged wrapper.
 */
async function resolveNpmShim(host: HostId, shimPath: string, deps: HostSystemDeps): Promise<HostInvocation | null> {
  const p = pathApi(deps.platform);
  const { pkg, bin } = HOST_PACKAGES[host];
  const pkgDir = p.join(p.dirname(shimPath), 'node_modules', ...pkg.split('/'));
  let manifest: { name?: unknown; bin?: unknown };
  try {
    manifest = JSON.parse(await deps.readFile(p.join(pkgDir, 'package.json')));
  } catch {
    return null;
  }
  if (manifest.name !== pkg) return null;
  const binField = manifest.bin;
  const rel = typeof binField === 'string' ? binField
    : binField && typeof binField === 'object' ? (binField as Record<string, unknown>)[bin] : undefined;
  if (typeof rel !== 'string' || rel.length === 0) return null;
  const entry = p.resolve(pkgDir, rel);
  const relToPkg = p.relative(pkgDir, entry);
  if (relToPkg.startsWith('..') || p.isAbsolute(relToPkg)) return null; // bin escapes its package
  if (!/\.(c|m)?js$/i.test(entry)) return null; // only a JS entry can run under Node
  try {
    await deps.access(entry, fsConstants.R_OK);
  } catch {
    return null;
  }
  return { host, file: deps.execPath, prefixArgs: [entry], resolvedFrom: shimPath };
}

async function invocationFor(host: HostId, candidate: string, deps: HostSystemDeps): Promise<HostInvocation | null> {
  if (deps.platform === 'win32' && /\.(cmd|bat)$/i.test(candidate)) {
    return resolveNpmShim(host, candidate, deps);
  }
  return { host, file: candidate, prefixArgs: [], resolvedFrom: candidate };
}

/** Resolve a host CLI once, before any mutation. Never runs a shell. */
export async function resolveHostExecutable(host: HostId, deps: HostSystemDeps = defaultHostSystemDeps()): Promise<HostResolution> {
  const p = pathApi(deps.platform);
  const rejected: string[] = [];

  const override = envValue(deps.env, HOST_OVERRIDE_ENV[host], deps.platform);
  if (override) {
    if (!p.isAbsolute(override)) {
      return { ok: false, host, reason: `${HOST_OVERRIDE_ENV[host]} must be an absolute path` };
    }
    if (!(await isExecutable(deps, override))) {
      return { ok: false, host, reason: `${HOST_OVERRIDE_ENV[host]}=${override} is not executable` };
    }
    const inv = await invocationFor(host, override, deps);
    return inv ? { ok: true, invocation: inv }
      : { ok: false, host, reason: `${override} is not a verifiable ${HOST_PACKAGES[host].pkg} launcher` };
  }

  const dirs = (envValue(deps.env, 'PATH', deps.platform) ?? '')
    .split(p.delimiter)
    .map((d) => d.replace(/^"(.*)"$/, '$1'))
    .filter((d) => d.length > 0 && p.isAbsolute(d)); // a relative PATH entry resolves against cwd: skip it

  const exts = deps.platform === 'win32'
    ? (envValue(deps.env, 'PATHEXT', deps.platform) ?? '.COM;.EXE;.BAT;.CMD')
      .split(';').map((e) => e.trim().toLowerCase()).filter((e) => /^\.[a-z0-9]+$/.test(e))
    : [''];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = p.join(dir, host + ext);
      if (!(await isExecutable(deps, candidate))) continue;
      const inv = await invocationFor(host, candidate, deps);
      if (inv) return { ok: true, invocation: inv };
      rejected.push(candidate);
    }
  }
  const why = rejected.length > 0
    ? `rejected unverifiable launcher(s): ${rejected.join(', ')}`
    : `\`${host}\` not found on PATH`;
  return { ok: false, host, reason: `${why} (set ${HOST_OVERRIDE_ENV[host]} to an absolute path to override)` };
}

export interface HostRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

/** Run `invocation` with a literal argv. No shell, no string concatenation. */
export async function runHostArgv(
  invocation: HostInvocation,
  argv: readonly string[],
  deps: HostSystemDeps = defaultHostSystemDeps(),
  timeoutMs = 180_000,
): Promise<HostRunResult> {
  try {
    const { stdout, stderr } = await deps.execFile(invocation.file, [...invocation.prefixArgs, ...argv], {
      env: deps.env,
      timeout: timeoutMs,
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { message?: string; stdout?: unknown; stderr?: unknown; code?: unknown };
    return {
      ok: false,
      stdout: typeof e.stdout === 'string' ? e.stdout : '',
      stderr: typeof e.stderr === 'string' ? e.stderr : '',
      error: e.message ?? String(err),
    };
  }
}

/** Human-readable form of an argv for dry-run output (display only, never executed). */
export function formatArgv(host: HostId, argv: readonly string[]): string {
  const q = (a: string) => (/^[A-Za-z0-9@%+=:,./_-]+$/.test(a) ? a : JSON.stringify(a));
  return [host, ...argv].map(q).join(' ');
}
