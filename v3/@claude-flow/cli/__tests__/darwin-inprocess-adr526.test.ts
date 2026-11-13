/**
 * ADR-526: @metaharness/darwin runs in-process for `metaharness_bench --op verify`
 * and every `metaharness_gepa` op. The in-process result must match what the
 * plugin script (the subprocess fallback) prints: same exit code, same payload
 * apart from timing fields.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { benchVerify, gepaOp, loadDarwin } from '../src/metaharness/darwin-lib.js';

const SCRIPTS = resolve(__dirname, '../../../../plugins/ruflo-metaharness/scripts');
/** The nearest installed darwin CLI: the package's own node_modules locally, the hoisted root copy under CI's root npm install. */
function findDarwinCli(): string {
  for (let d = resolve(__dirname, '..'); ; d = dirname(d)) {
    const p = join(d, 'node_modules/@metaharness/darwin/dist/cli.js');
    if (existsSync(p)) return p;
    if (dirname(d) === d) throw new Error('@metaharness/darwin is not installed');
  }
}
const DARWIN_CLI = findDarwinCli();

interface ScriptRun { exitCode: number; json: unknown; stdout: string; stderr: string; signal: string | null }

function runScript(name: string, args: string[]): ScriptRun {
  const r = spawnSync(process.execPath, [join(SCRIPTS, name), ...args, '--format', 'json'], { encoding: 'utf8', timeout: 60_000 });
  const stdout = r.stdout ?? '';
  const m = /\{[\s\S]*\}/.exec(stdout);
  let json: unknown = null;
  if (m) { try { json = JSON.parse(m[0]); } catch { /* null */ } }
  return { exitCode: r.status ?? -1, json, stdout, stderr: r.stderr ?? '', signal: r.signal };
}

/**
 * #4930 — failure message for a subprocess exit-code mismatch: which darwin
 * the script resolved (`darwinSource`: library | cli-local | cli-cache | none),
 * whether it reported itself degraded, and the stdout/stderr tails.
 */
function describeRun(label: string, r: ScriptRun): string {
  const j = (r.json ?? {}) as { darwinSource?: unknown; degraded?: unknown; reason?: unknown };
  return [
    `${label}: exit ${r.exitCode}${r.signal ? ` (signal ${r.signal})` : ''}`,
    `darwinSource=${String(j.darwinSource ?? 'unreported')} degraded=${String(j.degraded ?? false)}${j.reason ? ` reason=${String(j.reason)}` : ''}`,
    `--- stdout tail ---\n${r.stdout.slice(-1500)}`,
    `--- stderr tail ---\n${r.stderr.slice(-1500)}`,
  ].join('\n');
}

/**
 * Drop the fields that legitimately differ between two runs. `source` keeps
 * only its file name: the script and the CLI can resolve the same darwin
 * version from different node_modules copies.
 */
function normalize(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v ?? null, (k, val) => {
    if (k === 'durationMs' || k === 'generatedAt') return undefined;
    if (k === 'source' && typeof val === 'string') return val.split('/').pop();
    return val;
  }));
}

describe('ADR-526 darwin in-process parity', () => {
  let dir: string;
  let suite: string;

  beforeAll(async () => {
    expect(await loadDarwin()).not.toBeNull(); // darwin is a regular dependency now
    dir = mkdtempSync(join(tmpdir(), 'adr526-'));
    suite = join(dir, 'suite.json');
    const r = spawnSync(process.execPath, [DARWIN_CLI, 'bench', 'create', dir, '--out', suite], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    writeFileSync(join(dir, 'transcript.json'), JSON.stringify([{ role: 'assistant', content: 'done' }]));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  for (const op of ['genome', 'validate', 'render'] as const) {
    it(`gepa --op ${op} matches the plugin script`, async () => {
      const inProc = await gepaOp({ op });
      const sub = runScript('gepa.mjs', ['--op', op]);
      expect(inProc).not.toBeNull();
      expect(inProc!.exitCode).toBe(sub.exitCode);
      expect(normalize(inProc!.json)).toEqual(normalize(sub.json));
    });
  }

  it('gepa --op analyze matches the plugin script', async () => {
    const t = join(dir, 'transcript.json');
    const inProc = await gepaOp({ op: 'analyze', transcript: t });
    const sub = runScript('gepa.mjs', ['--op', 'analyze', '--transcript', t]);
    expect(inProc!.exitCode).toBe(sub.exitCode);
    expect(normalize(inProc!.json)).toEqual(normalize(sub.json));
  });

  it('gepa input errors exit 2 with no payload, like the script', async () => {
    for (const input of [{ op: 'nope' }, { op: 'render', path: join(dir, 'missing.json') }, { op: 'analyze' }]) {
      const inProc = await gepaOp(input);
      expect(inProc).toEqual({ exitCode: 2, json: null });
    }
  });

  it('bench verify on a good suite matches the script and adds structured fields', async () => {
    const inProc = await benchVerify(suite);
    const sub = runScript('bench.mjs', ['--op', 'verify', '--suite', suite]);
    expect(inProc!.exitCode).toBe(0);
    expect(sub.exitCode, describeRun('bench.mjs --op verify (good suite)', sub)).toBe(0);
    const p = inProc!.json as { success: boolean; data: Record<string, unknown> };
    const s = sub.json as { success: boolean; data: Record<string, unknown> };
    expect(p.success).toBe(s.success);
    expect(p.data.op).toBe('verify');
    expect(p.data.stdoutTail).toBe(s.data.stdoutTail);
    expect(p.data.hashOk).toBe(true);
    expect(p.data.tasks).toBe(1);
  });

  it('bench verify on a missing suite exits 2 with no payload', async () => {
    expect(await benchVerify(join(dir, 'nope.json'))).toEqual({ exitCode: 2, json: null });
  });

  it('bench verify on a tampered suite fails like the script', async () => {
    const tampered = join(dir, 'tampered.json');
    const j = JSON.parse(readFileSync(suite, 'utf8'));
    j.tasks[0].prompt = 'changed after hashing';
    writeFileSync(tampered, JSON.stringify(j));
    const inProc = await benchVerify(tampered);
    const sub = runScript('bench.mjs', ['--op', 'verify', '--suite', tampered]);
    expect(inProc!.exitCode).toBe(1);
    expect(sub.exitCode, describeRun('bench.mjs --op verify (tampered suite)', sub)).toBe(1);
    expect((inProc!.json as { success: boolean }).success).toBe(false);
  });
});

/**
 * #4930 — the root cause of the flake. Where the plugin script cannot import
 * darwin (CI's v3-only pnpm install), bench.mjs runs the darwin CLI, which
 * prints both sha256 digests of a tampered suite to stderr. The degraded
 * classifier matched any "404", so a digest containing it turned exit 1 into
 * degraded exit 0.
 */
describe('#4930 degraded classification ignores "404" inside hex digests', () => {
  type Classify = (stderr: string, exitCode: number | null, prefix: string) => { degraded: boolean; reason?: string };
  let classifyDegraded: Classify;

  beforeAll(async () => {
    ({ classifyDegraded } = (await import(join(SCRIPTS, '_invoke.mjs'))) as { classifyDegraded: Classify });
  });

  it('a tampered-suite error whose digests contain 404 is a real failure', () => {
    const stderr = 'Error: benchmark suite tampered: taskHash 89e4265664cd17b0c2a1f404e8d1 != recomputed 404a1b2c3d4e5f60718293a4b5c6d7e8f9\n    at loadSuite (file:///x/suite.js:50:15)\n';
    expect(classifyDegraded(stderr, 1, 'metaharness-darwin')).toEqual({ degraded: false });
  });

  it('still treats npm 404s as unavailable', () => {
    for (const stderr of [
      'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@metaharness%2fdarwin',
      'npm error code E404',
      '404 Not Found',
    ]) {
      expect(classifyDegraded(stderr, 1, 'metaharness-darwin')).toEqual({ degraded: true, reason: 'metaharness-darwin-not-available' });
    }
  });
});
