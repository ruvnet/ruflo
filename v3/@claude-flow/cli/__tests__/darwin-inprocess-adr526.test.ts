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

function runScript(name: string, args: string[]): { exitCode: number; json: unknown } {
  const r = spawnSync(process.execPath, [join(SCRIPTS, name), ...args, '--format', 'json'], { encoding: 'utf8', timeout: 60_000 });
  const m = /\{[\s\S]*\}/.exec(r.stdout ?? '');
  let json: unknown = null;
  if (m) { try { json = JSON.parse(m[0]); } catch { /* null */ } }
  return { exitCode: r.status ?? -1, json };
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
    expect(sub.exitCode).toBe(0);
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
    expect(sub.exitCode).toBe(1);
    expect((inProc!.json as { success: boolean }).success).toBe(false);
  });
});
