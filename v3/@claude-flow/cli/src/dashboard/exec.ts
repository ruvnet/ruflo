/** Safe subprocess access to the local ruflo CLI: fixed argv arrays, no shell, hard timeout, output cap, scrubbed env. */
import { spawn } from 'node:child_process';

export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
const ENV_ALLOW = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL', 'SYSTEMROOT', 'USERPROFILE', 'APPDATA', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'];

/** Minimal environment: nothing from the parent beyond the allowlist (no tokens, no API keys, no NODE_OPTIONS). */
export function scrubEnv(src: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NO_COLOR: '1', FORCE_COLOR: '0' };
  for (const k of ENV_ALLOW) if (src[k] !== undefined) env[k] = src[k];
  return env;
}

export interface RunResult { code: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }
export interface RunOpts { cwd: string; timeoutMs?: number; maxBytes?: number; env?: NodeJS.ProcessEnv }

/** argv[0] is the program, the rest are literal arguments. Never interpreted by a shell. */
export function runArgv(argv: readonly string[], o: RunOpts): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (argv.length === 0 || argv.some(a => typeof a !== 'string' || a.includes('\0'))) return reject(new Error('invalid argv'));
    const max = o.maxBytes ?? MAX_OUTPUT_BYTES;
    const child = spawn(argv[0]!, argv.slice(1), { cwd: o.cwd, env: o.env ?? scrubEnv(), shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '', bytes = 0, truncated = false, timedOut = false, done = false;
    const kill = () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const take = (which: 'o' | 'e') => (b: Buffer) => {
      if (truncated) return;
      bytes += b.length;
      if (bytes > max) { truncated = true; kill(); return; }
      if (which === 'o') out += b.toString('utf8'); else err += b.toString('utf8');
    };
    child.stdout.on('data', take('o')); child.stderr.on('data', take('e'));
    child.on('error', e => { if (done) return; done = true; clearTimeout(timer); reject(e); });
    child.on('close', code => { if (done) return; done = true; clearTimeout(timer); resolve({ code, stdout: out, stderr: err, timedOut, truncated }); });
  });
}

export class RufloError extends Error { constructor(public code: string, message: string) { super(message); this.name = 'RufloError'; } }

/** Narrow interface the collectors/executors depend on, so tests can stub ruflo entirely. */
export interface Ruflo { mcp(tool: string, params?: Record<string, unknown>): Promise<unknown> }

/** `ruflo mcp exec` prints log lines, then `Result:` and a JSON document. Returns the parsed document. */
export function parseMcpOutput(stdout: string): unknown {
  if (/^\[ERROR\]/m.test(stdout) && !/^Result:/m.test(stdout)) throw new RufloError('tool_error', stdout.split('\n').find(l => l.startsWith('[ERROR]'))?.slice(0, 200) ?? 'tool error');
  const i = stdout.search(/^Result:\s*$/m);
  if (i < 0) throw new RufloError('no_result', 'ruflo printed no Result block');
  const rest = stdout.slice(i).replace(/^Result:\s*/, '').trim();
  try { return JSON.parse(rest); } catch { throw new RufloError('bad_json', 'ruflo result is not valid JSON'); }
}

/** The launcher is this very ruflo process (same node, same CLI entry) unless config overrides it - no PATH or npx lookup. */
export function resolveRufloCommand(configured?: string[]): string[] {
  if (configured && configured.length > 0) return configured;
  return [process.execPath, process.argv[1] ?? 'ruflo'];
}

export class RufloClient implements Ruflo {
  constructor(private base: string[], private cwd: string, private timeoutMs = DEFAULT_TIMEOUT_MS) {}
  argvFor(tool: string, params: Record<string, unknown> = {}): string[] {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(tool)) throw new RufloError('bad_tool', 'invalid tool name');
    return [...this.base, 'mcp', 'exec', '-t', tool, '-p', JSON.stringify(params)];
  }
  async mcp(tool: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const argv = this.argvFor(tool, params);
    let r: RunResult;
    try { r = await runArgv(argv, { cwd: this.cwd, timeoutMs: this.timeoutMs }); } catch (e) { throw new RufloError('spawn_failed', `cannot run ruflo: ${(e as Error).message}`.slice(0, 200)); }
    if (r.timedOut) throw new RufloError('timeout', `${tool} timed out`);
    if (r.truncated) throw new RufloError('output_too_large', `${tool} output exceeded cap`);
    if (r.code !== 0 && !/^Result:/m.test(r.stdout)) throw new RufloError('exit_nonzero', `${tool} exited ${r.code}`);
    return parseMcpOutput(r.stdout);
  }
}
