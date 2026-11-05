#!/usr/bin/env node
// Runs `claude plugin test` for every plugin with tests that import `claude-code/testing`. Those tests cannot run under
// vitest, and each plugin's smoke.sh skips them when `claude` is not on PATH, so this script is their CI gate.
//
// It fails when:
//   - `claude` cannot start (a skip here would look like a pass)
//   - no plugin or no test is found
//   - a plugin crashes, times out, or reports zero passing tests
//   - a test fails and is not in scripts/ci-plugin-kit-known-failures.txt
//   - a listed known failure now passes, so the list can only shrink
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const KIT_IMPORT = /from\s+['"]claude-code\/testing['"]/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

/** Plugin names that hold at least one *.test.ts(x) importing the kit. */
export function discoverPlugins(repoRoot = REPO_ROOT) {
  const pluginsDir = join(repoRoot, 'plugins');
  const hasKitTest = (dir) => readdirSync(dir, { withFileTypes: true }).some((entry) => {
    if (entry.isDirectory()) return !SKIP_DIRS.has(entry.name) && hasKitTest(join(dir, entry.name));
    return /\.test\.tsx?$/.test(entry.name) && KIT_IMPORT.test(readFileSync(join(dir, entry.name), 'utf8'));
  });
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && hasKitTest(join(pluginsDir, entry.name)))
    .map((entry) => entry.name)
    .sort();
}

/** Reads `claude plugin test` output. Counts are null when the summary is missing, which means the run did not finish. */
export function parseResults(output) {
  const count = (label) => {
    const match = output.match(new RegExp(`^\\s*(\\d+) ${label}\\s*$`, 'm'));
    return match ? Number(match[1]) : null;
  };
  const failures = output.split(/\r?\n/)
    .filter((line) => line.startsWith('(fail) '))
    .map((line) => line.slice('(fail) '.length).replace(/\s*\[[\d.]+m?s\]\s*$/, ''));
  return { pass: count('pass'), fail: count('fail'), failures };
}

/** Parses `plugin | test name` lines. Blank lines and # comments are ignored. */
export function parseKnownFailures(text) {
  const known = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const split = line.indexOf(' | ');
    if (split < 1) throw new Error(`known-failures line needs "plugin | test name": ${line}`);
    const plugin = line.slice(0, split);
    if (!known.has(plugin)) known.set(plugin, new Set());
    known.get(plugin).add(line.slice(split + 3));
  }
  return known;
}

/** Compares one plugin's run with its known failures and returns the problems that should fail the gate. */
export function evaluatePlugin(plugin, run, known = new Set()) {
  if (run.timedOut) return [`${plugin}: timed out`];
  const { pass, fail, failures } = parseResults(run.output);
  if (pass === null || fail === null) return [`${plugin}: no test summary (exit ${run.code})`];
  if (pass + fail === 0) return [`${plugin}: found no tests`];
  if (fail !== failures.length) return [`${plugin}: reported ${fail} failures but named ${failures.length}`];
  const problems = failures.filter((name) => !known.has(name)).map((name) => `${plugin}: new failure: ${name}`);
  for (const name of known) {
    if (!failures.includes(name)) problems.push(`${plugin}: passes now, remove it from the known failures: ${name}`);
  }
  if (fail === 0 && run.code !== 0) problems.push(`${plugin}: exit ${run.code} with no failed test`);
  if (pass === 0 && problems.length === 0 && known.size === 0) problems.push(`${plugin}: no passing tests`);
  return problems;
}

function runPlugin(claude, plugin, repoRoot, timeoutMs) {
  return new Promise((done) => {
    const dir = relative(repoRoot, join(repoRoot, 'plugins', plugin)).split(sep).join('/');
    const child = spawn(claude, ['plugin', 'test', dir], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => { clearTimeout(timer); done({ code: 1, output: String(error), timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code, output, timedOut }); });
  });
}

export async function main({
  repoRoot = REPO_ROOT,
  claude = process.env.RUFLO_KIT_CLAUDE || 'claude',
  // One at a time by default: ruflo-console and ruflo-mods have timing-sensitive tests that failed under parallel load.
  concurrency = Number(process.env.RUFLO_KIT_CONCURRENCY) || 1,
  timeoutMs = Number(process.env.RUFLO_KIT_TIMEOUT_MS) || 600_000,
  log = console.log,
} = {}) {
  const version = spawnSync(claude, ['--version'], { encoding: 'utf8' });
  if (version.status !== 0) {
    log(`::error::\`${claude} --version\` failed, so the plugin kit tests cannot run`);
    return 3;
  }
  const plugins = discoverPlugins(repoRoot);
  if (plugins.length === 0) {
    log('::error::found no plugin kit tests, so this gate checked nothing');
    return 3;
  }
  const knownPath = join(repoRoot, 'scripts', 'ci-plugin-kit-known-failures.txt');
  const known = existsSync(knownPath) ? parseKnownFailures(readFileSync(knownPath, 'utf8')) : new Map();
  const problems = [];
  for (const plugin of known.keys()) {
    if (!plugins.includes(plugin)) problems.push(`${plugin}: listed in the known failures but has no kit tests`);
  }

  log(`Claude Code ${version.stdout.trim()}: running kit tests for ${plugins.length} plugins`);
  let totalPass = 0;
  let totalFail = 0;
  const queue = [...plugins];
  const worker = async () => {
    while (queue.length > 0) {
      const plugin = queue.shift();
      const run = await runPlugin(claude, plugin, repoRoot, timeoutMs);
      const { pass, fail } = parseResults(run.output);
      totalPass += pass ?? 0;
      totalFail += fail ?? 0;
      const found = evaluatePlugin(plugin, run, known.get(plugin));
      log(`${found.length === 0 ? 'ok  ' : 'FAIL'} ${plugin}: ${pass ?? '?'} pass, ${fail ?? '?'} fail`);
      if (found.length > 0 && parseResults(run.output).pass === null) log(run.output.slice(-2000));
      problems.push(...found);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, plugins.length) }, worker));

  log(`\n${plugins.length} plugins: ${totalPass} passed, ${totalFail} failed`);
  for (const problem of problems) log(`::error::${problem}`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
