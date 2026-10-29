/**
 * ADR-510 §2.4 — `ruflo doctor --component headless-plugins`: do ruflo mods
 * actually run under `claude -p` on this machine?
 *
 * Runs `claude -p --plugin-dir <ruflo-mods> --output-format stream-json
 * --verbose "reply ok"` in a throwaway project that has a `.claude-flow/`
 * directory, then reports:
 *   - whether the init event lists ruflo-mods from that folder;
 *   - whether `plugin_errors` is empty (Claude Code omits the key when none);
 *   - whether the mod's session heartbeat (`.claude-flow/mods/session.json`)
 *     was written — the proof that its function hooks ran.
 *
 * The runner is injectable so tests never spawn `claude` or need a key.
 * Without any model credential the check is skipped (warn), never spawned.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { ENABLE_ENV } from './install.js';
import { claudeConfigDir } from './plugin-resolve.js';
import { resolvePluginPaths, type PluginPaths } from './plugin-paths.js';

export const HEADLESS_TIMEOUT_MS = 60_000;
export const HEARTBEAT = join('.claude-flow', 'mods', 'session.json');
const PLUGIN = 'ruflo-mods';

export interface HeadlessRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export type HeadlessRunner = (argv: string[], env: NodeJS.ProcessEnv, cwd: string, timeoutMs: number) => Promise<HeadlessRun>;

export interface HeadlessCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

export interface HeadlessCheckDeps {
  runner?: HeadlessRunner;
  resolve?: () => PluginPaths;
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Throwaway project dir factory (must be removable afterwards). */
  makeProject?: () => string;
  exists?: (path: string) => boolean;
  timeoutMs?: number;
  model?: string;
}

const NAME = 'Headless plugins (ADR-510)';

export const spawnHeadless: HeadlessRunner = (argv, env, cwd, timeoutMs) =>
  new Promise((done) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn('claude', argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      done({ exitCode: null, stdout: '', stderr: e instanceof Error ? e.message : String(e) });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (e: Error) => { clearTimeout(timer); done({ exitCode: null, stdout, stderr: e.message, timedOut }); });
    child.on('close', (code: number | null) => { clearTimeout(timer); done({ exitCode: code, stdout, stderr, timedOut }); });
  });

/** A model credential Claude Code could use; without one the check would only fail on auth. */
export function hasModelCredential(env: NodeJS.ProcessEnv, configDir: string, exists: (p: string) => boolean = existsSync): boolean {
  const keys = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'];
  if (keys.some((k) => !!env[k])) return true;
  // macOS keeps the login in the keychain, which we cannot see from here.
  if (process.platform === 'darwin') return true;
  return exists(join(configDir, '.credentials.json'));
}

interface InitEvent {
  plugins?: Array<{ name?: string; path?: string; source?: string }>;
  plugin_errors?: unknown[];
}

/** The `system/init` event of a stream-json run, if any. */
export function findInitEvent(stdout: string): InitEvent | null {
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const ev = JSON.parse(t) as { type?: string; subtype?: string };
      if (ev.type === 'system' && ev.subtype === 'init') return ev as InitEvent;
    } catch {
      // not a JSON line
    }
  }
  return null;
}

const canonical = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

export async function checkHeadlessPlugins(deps: HeadlessCheckDeps = {}): Promise<HeadlessCheck> {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const paths = (deps.resolve ?? (() => resolvePluginPaths([PLUGIN], { env, home: deps.home })))();
  const mods = paths.resolved.find((p) => p.name === PLUGIN);
  if (!mods) {
    const why = paths.missing.find((m) => m.name === PLUGIN)?.reason ?? 'not found';
    return { name: NAME, status: 'warn', message: `${PLUGIN} not found (${why}); headless workers run without it`, fix: 'ruflo mods install' };
  }
  const configDir = claudeConfigDir(env, deps.home ?? homedir());
  if (!deps.runner && !hasModelCredential(env, configDir, exists)) {
    return { name: NAME, status: 'warn', message: `skipped: no model credential for claude -p (${PLUGIN} resolves to ${mods.path})`, fix: 'set ANTHROPIC_API_KEY or run `claude login`, then re-run' };
  }

  const project = (deps.makeProject ?? (() => mkdtempSync(join(tmpdir(), 'ruflo-headless-'))))();
  try {
    mkdirSync(join(project, '.claude-flow'), { recursive: true });
    const argv = ['-p', 'reply ok', '--plugin-dir', mods.path, '--output-format', 'stream-json', '--verbose', '--model', deps.model ?? 'haiku'];
    const runEnv: NodeJS.ProcessEnv = { ...env, CLAUDE_ENTRYPOINT: 'worker' };
    if (runEnv[ENABLE_ENV] === undefined) runEnv[ENABLE_ENV] = '1';
    delete runEnv.CLAUDE_SESSION_ID;
    delete runEnv.CLAUDE_PARENT_SESSION_ID;
    const run = await (deps.runner ?? spawnHeadless)(argv, runEnv, project, deps.timeoutMs ?? HEADLESS_TIMEOUT_MS);
    if (run.timedOut) {
      return { name: NAME, status: 'fail', message: `claude -p did not finish in ${(deps.timeoutMs ?? HEADLESS_TIMEOUT_MS) / 1000}s` };
    }
    const init = findInitEvent(run.stdout);
    if (!init) {
      const tail = (run.stderr || run.stdout).trim().split('\n').slice(-1)[0] ?? '';
      return { name: NAME, status: 'fail', message: `no init event from claude -p (exit ${run.exitCode})${tail ? `: ${tail.slice(0, 200)}` : ''}`, fix: 'ruflo doctor -c claude' };
    }
    const want = canonical(mods.path);
    const listed = (init.plugins ?? []).some((p) => p.name === PLUGIN && typeof p.path === 'string' && canonical(p.path) === want);
    const errors = Array.isArray(init.plugin_errors) ? init.plugin_errors : [];
    const heartbeat = exists(join(project, HEARTBEAT));
    const facts = `init lists ${PLUGIN}: ${listed ? 'yes' : 'no'}; plugin_errors: ${errors.length === 0 ? 'none' : JSON.stringify(errors).slice(0, 200)}; heartbeat: ${heartbeat ? 'written' : 'absent'}`;
    if (!listed || errors.length > 0) {
      return { name: NAME, status: 'fail', message: `${facts} (${mods.path})`, fix: `claude -p --plugin-dir ${JSON.stringify(mods.path)} --output-format stream-json --verbose "reply ok"` };
    }
    if (!heartbeat) {
      return { name: NAME, status: 'warn', message: `${facts}: the plugin loads but its function hooks did not run (Claude Code too old, or ${ENABLE_ENV}=0)` };
    }
    return { name: NAME, status: 'pass', message: `${facts} (${mods.source}: ${mods.path})` };
  } finally {
    try { rmSync(project, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
