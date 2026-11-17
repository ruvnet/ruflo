#!/usr/bin/env node
/**
 * ADR-526 benchmark: @metaharness/darwin in-process vs the plugin-script
 * subprocess the MCP tools used before.
 *
 * Per operation it times N calls of each path from one long-lived process
 * (the MCP server's situation):
 *   - subprocess: `node plugins/ruflo-metaharness/scripts/<script>.mjs …` (the
 *     old metaharness_bench / metaharness_gepa path; for bench this spawns a
 *     second node for the darwin CLI)
 *   - in-process cold: the first call, which pays the darwin import
 *   - in-process warm: later calls on the cached module
 *
 * Usage: node scripts/benchmark-darwin-inprocess.mjs [--runs 20] [--no-write]
 * Needs a built CLI (v3/@claude-flow/cli/dist) with darwin installed.
 * Writes docs/benchmarks/runs/darwin-inprocess-<ISO>.json and -latest.json.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'v3/@claude-flow/cli');
const SCRIPTS = join(ROOT, 'plugins/ruflo-metaharness/scripts');
const argv = process.argv.slice(2);
const RUNS = Number(argv[argv.indexOf('--runs') + 1]) > 0 && argv.includes('--runs') ? Number(argv[argv.indexOf('--runs') + 1]) : 20;
const WRITE = !argv.includes('--no-write');

const lib = await import(pathToFileURL(join(CLI, 'dist/src/metaharness/darwin-lib.js')).href);
const darwinCli = join(CLI, 'node_modules/@metaharness/darwin/dist/cli.js');

const dir = mkdtempSync(join(tmpdir(), 'adr526-bench-'));
const suite = join(dir, 'suite.json');
const made = spawnSync(process.execPath, [darwinCli, 'bench', 'create', dir, '--out', suite], { encoding: 'utf8' });
if (made.status !== 0) { console.error('bench create failed:', made.stderr); process.exit(2); }

const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, median: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), min: +s[0].toFixed(2), max: +s[s.length - 1].toFixed(2) };
};

const OPS = [
  { name: 'gepa validate', script: 'gepa.mjs', args: ['--op', 'validate'], inProc: () => lib.gepaOp({ op: 'validate' }) },
  { name: 'gepa render', script: 'gepa.mjs', args: ['--op', 'render'], inProc: () => lib.gepaOp({ op: 'render' }) },
  { name: 'bench verify', script: 'bench.mjs', args: ['--op', 'verify', '--suite', suite], inProc: () => lib.benchVerify(suite) },
];

const results = [];
for (const op of OPS) {
  const sub = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(process.execPath, [join(SCRIPTS, op.script), ...op.args, '--format', 'json'], { encoding: 'utf8' });
    sub.push(ms(t0));
    if (r.status !== 0) { console.error(`${op.name}: subprocess exit ${r.status}`); process.exit(2); }
  }
  lib.resetDarwinCache();
  const t0 = process.hrtime.bigint();
  const first = await op.inProc();
  const cold = ms(t0);
  if (!first || first.exitCode !== 0) { console.error(`${op.name}: in-process failed`, first); process.exit(2); }
  const warm = [];
  for (let i = 0; i < RUNS; i++) {
    const t1 = process.hrtime.bigint();
    await op.inProc();
    warm.push(ms(t1));
  }
  const s = stats(sub), w = stats(warm);
  results.push({ op: op.name, subprocessMs: s, inProcessColdMs: +cold.toFixed(2), inProcessWarmMs: w, warmSpeedupMedian: +(s.median / w.median).toFixed(1) });
}
rmSync(dir, { recursive: true, force: true });

const report = {
  runAt: new Date().toISOString(),
  benchmark: 'darwin-inprocess',
  adr: 'ADR-526',
  darwinVersion: JSON.parse((await import('node:fs')).readFileSync(join(CLI, 'node_modules/@metaharness/darwin/package.json'), 'utf8')).version,
  node: process.version,
  cpu: cpus()[0]?.model ?? 'unknown',
  runs: RUNS,
  method: 'one long-lived node process; subprocess = spawnSync of the plugin script (the pre-ADR-526 MCP path); in-process = darwin-lib.js, cold = first call after cache reset, warm = cached module',
  results,
};

for (const r of results) {
  console.log(`${r.op.padEnd(14)} subprocess median ${r.subprocessMs.median} ms | in-process cold ${r.inProcessColdMs} ms, warm median ${r.inProcessWarmMs.median} ms | ${r.warmSpeedupMedian}x`);
}
if (WRITE) {
  const out = join(ROOT, 'docs/benchmarks/runs');
  mkdirSync(out, { recursive: true });
  const body = JSON.stringify(report, null, 2) + '\n';
  writeFileSync(join(out, `darwin-inprocess-${report.runAt.replace(/[:.]/g, '-')}.json`), body);
  writeFileSync(join(out, 'darwin-inprocess-latest.json'), body);
}
