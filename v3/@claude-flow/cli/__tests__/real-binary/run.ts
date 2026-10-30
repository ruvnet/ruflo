/**
 * Runner for the real-binary test tier (ADR-504 §2.2).
 *
 * Launches the real `claude` binary headless against the scripted mock model, with ruflo-mods loaded through
 * `--plugin-dir`, in a throwaway project with its own HOME, CLAUDE_CONFIG_DIR and temp dir. The child gets a minimal
 * environment built here, never this process's: no real API key, no user settings, no user plugins or MCP servers can
 * reach it.
 *
 * It returns the exit code, the stream-json events, the mock's request log and a reader for the project's files.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error: plain ESM helper without a declaration file
import { startMockModel } from './mock-model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../../../../..');
/** The plugin under test; RUFLO_REAL_BINARY_PLUGIN_DIR points the tier at another copy (a packed or fresh checkout). */
export const RUFLO_MODS_DIR = process.env.RUFLO_REAL_BINARY_PLUGIN_DIR || join(REPO_ROOT, 'plugins/ruflo-mods');
/** The binary under test. CI installs a pinned version; locally it is whatever `claude` resolves to. */
export const CLAUDE_BIN = process.env.RUFLO_REAL_BINARY_CLAUDE || 'claude';
/** Any model id works: the mock answers for every one. A haiku id keeps engine-side cost estimates tiny. */
const MODEL = 'claude-haiku-4-5';

export type Block = { type: 'text'; text: string } | { type: 'tool_use'; name: string; input: Record<string, unknown>; id?: string };
export interface Turn {
  content: Block[];
}
export interface MockRequest {
  at: number;
  method: string;
  path: string;
  body: any;
  scripted: boolean;
  turn: number;
}

export interface RunOptions {
  /** The prompt passed to `claude -p`. */
  prompt: string;
  /** Assistant turns the mock replays, in order, to the main loop's requests; a function gets the project path. */
  script?: Turn[] | ((project: string) => Turn[]);
  /** ruflo-mods options, set through `--settings` `pluginConfigs` the way a user would. */
  options?: Record<string, unknown>;
  /** The plugin directory to load; defaults to the repository's ruflo-mods. Pass `null` to load no plugin. */
  pluginDir?: string | null;
  /** Files to create in the project before the run, relative path → content. `.claude-flow/` always exists. */
  files?: Record<string, string>;
  /** Tools the run may use without a permission prompt. */
  allowedTools?: string[];
  /** Kill the run after this long. */
  timeoutMs?: number;
  /** Commands shadowed on PATH by a recorder that writes `<name>` to `<tmp>/shadowed.log` and exits 0. */
  shadow?: string[];
}

export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  events: any[];
  stdout: string;
  stderr: string;
  /** Every request the mock received. */
  requests: MockRequest[];
  /** Only the requests that consumed a scripted turn (the main loop's). */
  scripted: MockRequest[];
  /** The throwaway project directory (the run's cwd). */
  project: string;
  /** The private temp root holding project, home and tmp. */
  root: string;
  /** Read a project file, relative to the project; undefined when absent. */
  file(rel: string): string | undefined;
  /** Commands the PATH shadows recorded, one per line. */
  shadowed(): string[];
  /** Remove the temp root (kept when RUFLO_REAL_BINARY_KEEP=1). */
  cleanup(): void;
}

/** True when the binary can be started; the tier's CI job fails instead of skipping (ADR-504 §2.4). */
export function claudeVersion(): string | undefined {
  const r = spawnSync(CLAUDE_BIN, ['--version'], { encoding: 'utf8', timeout: 30_000 });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

/** Every boolean option ruflo-mods declares, set to `value`; read from the manifest so a new option is covered. */
export function allBooleanOptions(value = true, pluginDir = RUFLO_MODS_DIR): Record<string, boolean> {
  const manifest = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin/plugin.json'), 'utf8'));
  const spec = manifest.userConfig as Record<string, { type?: string }>;
  return Object.fromEntries(Object.entries(spec).filter(([, s]) => s.type === 'boolean').map(([key]) => [key, value]));
}

/** Text of the last user message of a request: what that request added to the conversation. */
export function lastUserText(body: any): string {
  const messages: any[] = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === 'user') return textOf(messages[i].content);
  return '';
}

/** All text of a request: system prompt and every message, including tool results and system reminders. */
export function requestText(body: any): string {
  return [textOf(body?.system), ...(Array.isArray(body?.messages) ? body.messages.map((m: any) => textOf(m?.content)) : [])].join('\n');
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join('\n');
  if (value && typeof value === 'object') {
    const v = value as { text?: unknown; content?: unknown };
    return [typeof v.text === 'string' ? v.text : '', v.content !== undefined ? textOf(v.content) : ''].filter(Boolean).join('\n');
  }
  return '';
}

export async function runClaude(opts: RunOptions): Promise<RunResult> {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-real-binary-'));
  const project = join(root, 'project');
  const home = join(root, 'home');
  const tmp = join(root, 'tmp');
  const bin = join(root, 'bin');
  for (const dir of [project, join(project, '.claude-flow'), home, tmp, bin]) mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(opts.files ?? {})) {
    const path = join(project, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const shadowLog = join(tmp, 'shadowed.log');
  for (const name of opts.shadow ?? []) {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> '${shadowLog}'\nexit 0\n`);
    chmodSync(path, 0o755);
  }

  const settings = join(root, 'settings.json');
  const pluginOptions = opts.options ? { options: opts.options } : undefined;
  // `--plugin-dir` loads the plugin as `<name>@inline`; the bare name is kept for older engines.
  writeFileSync(settings, JSON.stringify(pluginOptions ? { pluginConfigs: { 'ruflo-mods@inline': pluginOptions, 'ruflo-mods': pluginOptions } } : {}));

  const mock = await startMockModel(typeof opts.script === 'function' ? opts.script(project) : (opts.script ?? []));
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    HOME: home,
    USER: process.env.USER ?? 'runner',
    LANG: 'C.UTF-8',
    SHELL: '/bin/bash',
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    CLAUDE_CODE_TMPDIR: tmp,
    TMPDIR: tmp,
    ANTHROPIC_BASE_URL: mock.url,
    ANTHROPIC_API_KEY: 'sk-ant-real-binary-tier-not-a-key',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1',
  };
  const args = ['-p', opts.prompt, '--output-format', 'stream-json', '--verbose', '--model', MODEL, '--settings', settings, '--strict-mcp-config'];
  const pluginDir = opts.pluginDir === undefined ? RUFLO_MODS_DIR : opts.pluginDir;
  if (pluginDir) args.push('--plugin-dir', pluginDir);
  if (opts.allowedTools?.length) args.push('--allowedTools', opts.allowedTools.join(','));

  const child = spawn(CLAUDE_BIN, args, { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, opts.timeoutMs ?? 90_000);
  const [exitCode, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((done, fail) => {
    child.on('error', fail);
    child.on('close', (code, sig) => done([code, sig]));
  }).finally(() => clearTimeout(timer));
  await mock.close();

  const events = stdout
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });

  return {
    exitCode,
    signal,
    timedOut,
    events,
    stdout,
    stderr,
    requests: mock.requests,
    scripted: mock.scripted(),
    project,
    root,
    file: (rel) => (existsSync(join(project, rel)) ? readFileSync(join(project, rel), 'utf8') : undefined),
    shadowed: () => (existsSync(shadowLog) ? readFileSync(shadowLog, 'utf8').split('\n').filter(Boolean) : []),
    cleanup: () => {
      if (process.env.RUFLO_REAL_BINARY_KEEP !== '1') rmSync(root, { recursive: true, force: true });
    },
  };
}

/** The final `result` event of a run, if it reached one. */
export function resultEvent(run: RunResult): any {
  return run.events.find((e) => e.type === 'result');
}

/** A diagnostic string for a failing assertion: exit, result, stderr tail. */
export function describeRun(run: RunResult): string {
  const result = resultEvent(run);
  return `exit=${run.exitCode} signal=${run.signal} timedOut=${run.timedOut} result=${JSON.stringify(result?.result ?? result?.subtype)}\nstderr: ${run.stderr.slice(-2000)}\nroot: ${run.root}`;
}
