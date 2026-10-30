#!/usr/bin/env node
/**
 * ADR-503 §3 / ADR-502 §6: does the verified-outcome learning loop help?
 *
 * MANUAL ONLY. It spends money (two `claude -p` runs per eval task plus one per
 * training task) and is never part of CI. Without --run it prints the plan and
 * spends nothing.
 *
 *   node scripts/eval-learning-loop.mjs --tasks <tasks.json>            # plan only, $0
 *   node scripts/eval-learning-loop.mjs --tasks <tasks.json> --run      # spend
 *     [--model haiku] [--budget-usd 0.50 per run] [--timeout-sec 600] [--out <report.json>] [--keep]
 *
 * tasks.json (paths relative to the file):
 *   { "version": 1,
 *     "train": [ { "id": "t1", "prompt": "...", "fixture": "fixtures/t1", "check": ["npm", "test"] } ],
 *     "eval":  [ ... 30 tasks, same shape, disjoint from train ... ] }
 *
 * Procedure:
 *  1. Training split: each train task runs once with `learningLoop` on in a fresh
 *     copy of its fixture; every recorded turn is pooled into one workspace, and
 *     `ruflo hooks verified-ingest` there writes the lessons (SONA + ADR-503 gates).
 *  2. Evaluation split, two arms: `learningLoop` off, then on with the pre-trained
 *     lessons copied in. Each task runs in a fresh copy of its fixture.
 *  3. A task's outcome is its own fixed `check` argv run afterwards in that copy
 *     (no shell, exit 0 = verified success), the same for both arms, so the
 *     measure does not depend on the loop being on.
 *
 * Reported per arm: verified success rate, total and per-verified-success cost
 * (from `--output-format json` total_cost_usd), and for the "on" arm the lesson
 * hit rate. The hit rate is approximated outside Claude Code: the share of eval
 * prompts that share a keyword with a lesson in the trained learned-lessons.json
 * (the mod's own pick() rule, re-implemented here); the mod's in-session counter
 * is not readable from outside.
 *
 * Decision rule: ruflo's flywheel sequential-evidence gate (an anytime-valid
 * McNemar e-process, flywheel-sequential-evidence.ts). Each eval task is a
 * paired outcome, baseline = loop off, candidate = loop on, score = 1 for a
 * verified success. Only discordant tasks (one arm passes) carry evidence, so
 * before spending, the plan prints the minimum the corpus must produce and
 * --run refuses an eval split too small to ever reach it. The report carries
 * the pairedOutcomes and the verdict; a cost verdict on the same tasks is
 * printed as a secondary sign check and never stands in for success.
 *
 * --keep leaves the work directories (fixture copies, .claude-flow/ records and
 * each run's claude -p JSON result) in place and prints where they are.
 *
 * The 30-task corpus is not shipped with this script; pass your own tasks file.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(REPO, 'plugins', 'ruflo-mods');
const CLI = join(REPO, 'v3', '@claude-flow', 'cli', 'bin', 'cli.js');
const TRAJ = join('.claude-flow', 'data', 'verified-trajectories.jsonl');
const LESSONS = join('.claude-flow', 'data', 'learned-lessons.json');
const GATE = join(REPO, 'v3', '@claude-flow', 'cli', 'dist', 'src', 'services', 'flywheel-sequential-evidence.js');
const ID = /^[A-Za-z0-9_.-]{1,64}$/;

function args(argv) {
  const out = { run: false, model: 'haiku', budget: '0.50', timeoutSec: 600, tasks: null, out: null, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') out.run = true;
    else if (a === '--tasks') out.tasks = argv[++i];
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--budget-usd') out.budget = argv[++i];
    else if (a === '--timeout-sec') out.timeoutSec = Number(argv[++i]);
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--keep') out.keep = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

/** The tasks file, validated: ids unique, splits disjoint, fixtures inside the file's directory, check a plain argv. */
function loadTasks(path) {
  const base = dirname(resolve(path));
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (raw?.version !== 1 || !Array.isArray(raw.train) || !Array.isArray(raw.eval)) throw new Error('tasks file: need { version: 1, train: [], eval: [] }');
  const seen = new Set();
  const task = (t, split) => {
    if (!t || typeof t.id !== 'string' || !ID.test(t.id) || seen.has(t.id)) throw new Error(`${split}: bad or duplicate id ${t?.id}`);
    seen.add(t.id);
    if (typeof t.prompt !== 'string' || !t.prompt.trim()) throw new Error(`${t.id}: prompt required`);
    const fixture = resolve(base, String(t.fixture ?? ''));
    if (!fixture.startsWith(base + '/') || !existsSync(fixture)) throw new Error(`${t.id}: fixture must be an existing directory under ${base}`);
    if (!Array.isArray(t.check) || t.check.length === 0 || !t.check.every(s => typeof s === 'string' && s.length > 0)) throw new Error(`${t.id}: check must be a non-empty argv array`);
    return { id: t.id, prompt: t.prompt, fixture, check: t.check };
  };
  return { train: raw.train.map(t => task(t, 'train')), eval: raw.eval.map(t => task(t, 'eval')) };
}

function settingsFile(dir, learningLoop) {
  const o = { options: { learningLoop } };
  const f = join(dir, `settings-${learningLoop ? 'on' : 'off'}.json`);
  writeFileSync(f, JSON.stringify({ pluginConfigs: { 'ruflo-mods@inline': o, 'ruflo-mods': o } }));
  return f;
}

/** A fresh copy of a fixture with `.claude-flow/` (the loop records only in a ruflo project). */
function workdir(root, task, arm) {
  const dir = join(root, `${arm}-${task.id}`);
  cpSync(task.fixture, dir, { recursive: true });
  mkdirSync(join(dir, '.claude-flow', 'data'), { recursive: true });
  return dir;
}

function claude(dir, prompt, settings, opts) {
  const r = spawnSync('claude', ['-p', prompt, '--output-format', 'json', '--model', opts.model, '--plugin-dir', PLUGIN, '--settings', settings,
    '--setting-sources', 'local', '--max-budget-usd', opts.budget, '--allowedTools', 'Read,Edit,Write,Bash,Grep,Glob'], {
    cwd: dir, encoding: 'utf8', timeout: opts.timeoutSec * 1000, input: '', env: { ...process.env, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' },
  });
  writeFileSync(`${dir}.result.json`, r.stdout ?? '');
  let cost = 0;
  try {
    cost = Number(JSON.parse(r.stdout).total_cost_usd) || 0;
  } catch {
    // no JSON result (timeout, crash): the cost is unknown, counted as 0 and flagged
  }
  return { cost, ok: r.status === 0 };
}

/** The task's own check, run with no shell; exit 0 is a verified success. */
function check(dir, task, timeoutSec) {
  const r = spawnSync(task.check[0], task.check.slice(1), { cwd: dir, stdio: 'ignore', timeout: timeoutSec * 1000, env: { ...process.env, CI: '1' } });
  return r.status === 0;
}

const words = text => new Set(text.toLowerCase().split(/[\s\-_.,;:!?'"()[\]{}]+/).filter(Boolean));
/** The mod's pick() match rule: a keyword said as a word, or as a phrase when it has a space or slash. */
function lessonHit(lessons, prompt) {
  const said = words(prompt);
  const lower = prompt.toLowerCase();
  return lessons.some(l => l.kind === 'lesson' && (l.keywords ?? []).some(k => said.has(k) || (/[ /]/.test(k) && lower.includes(k))));
}

function arm(name, tasks, root, settings, opts, lessonsText) {
  const rows = [];
  for (const task of tasks) {
    const dir = workdir(root, task, name);
    if (lessonsText) writeFileSync(join(dir, LESSONS), lessonsText);
    const run = claude(dir, task.prompt, settings, opts);
    const passed = check(dir, task, opts.timeoutSec);
    rows.push({ id: task.id, passed, cost: run.cost, claudeOk: run.ok });
    process.stderr.write(`[${name}] ${task.id}: ${passed ? 'pass' : 'fail'} $${run.cost.toFixed(4)}\n`);
  }
  const passed = rows.filter(r => r.passed).length;
  const cost = rows.reduce((a, r) => a + r.cost, 0);
  return { arm: name, tasks: rows.length, verifiedSuccessRate: rows.length ? passed / rows.length : 0, costUsd: cost, costPerVerifiedSuccess: passed ? cost / passed : null, unpricedRuns: rows.filter(r => !r.claudeOk).length, rows };
}

/** The flywheel sequential-evidence gate from the built CLI (`npm run build` in v3/@claude-flow/cli). */
async function loadGate() {
  if (!existsSync(GATE)) throw new Error(`build the CLI first: ${GATE} is missing`);
  return import(pathToFileURL(GATE).href);
}

/** Task-by-task paired outcomes, baseline = off, candidate = on. */
function paired(baseline, loop, score) {
  return baseline.rows.map((b, i) => ({ taskId: b.id, baselineScore: score(b), candidateScore: score(loop.rows[i]) }));
}

function verdictLine(label, v) {
  return `${label}: e-value ${v.eValue.toFixed(2)} against ${v.threshold.toFixed(1)} (alpha ${v.alphaAllocated.toFixed(4)}), ${v.informativePairs}/${v.totalPairs} informative pairs: ${v.significant ? 'significant' : 'not significant'}`;
}

async function main() {
  const opts = args(process.argv.slice(2));
  if (opts.help || !opts.tasks) {
    const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
    console.log(lines.slice(2, lines.indexOf(' */')).join('\n').replace(/^ \*\/?/gm, ''));
    process.exit(opts.help ? 0 : 2);
  }
  const tasks = loadTasks(opts.tasks);
  const runs = tasks.train.length + 2 * tasks.eval.length;
  console.log(`train ${tasks.train.length}, eval ${tasks.eval.length} (ADR-503 asks for 30), claude -p runs: ${runs}, cap $${(runs * Number(opts.budget)).toFixed(2)} at --budget-usd ${opts.budget}`);
  if (tasks.eval.length !== 30) console.log('warning: the eval split is not 30 tasks; the result is not the ADR-503 §3 measurement');
  const gate = await loadGate();
  const minPairs = gate.minInformativePairsToClear(1);
  console.log(`gate: the loop must pass at least ${minPairs} eval tasks the baseline fails, with none the other way round, to clear a first test at family-wise alpha ${gate.DEFAULT_ALPHA_TOTAL}`);
  if (tasks.eval.length < minPairs) {
    console.log(`refused: ${tasks.eval.length} eval tasks can never produce ${minPairs} informative pairs`);
    process.exit(2);
  }
  if (!opts.run) {
    console.log('plan only: pass --run to spend');
    return;
  }

  const root = mkdtempSync(join(tmpdir(), 'ruflo-eval-loop-'));
  try {
    // 1. Training split: record with the loop on, pool the records, ingest once.
    const on = settingsFile(root, true);
    const off = settingsFile(root, false);
    const pool = join(root, 'train-pool');
    mkdirSync(join(pool, '.claude-flow', 'data'), { recursive: true });
    for (const task of tasks.train) {
      const dir = workdir(root, task, 'train');
      claude(dir, task.prompt, on, opts);
      if (existsSync(join(dir, TRAJ))) appendFileSync(join(pool, TRAJ), readFileSync(join(dir, TRAJ), 'utf8'));
    }
    if (existsSync(join(pool, TRAJ))) execFileSync(process.execPath, [CLI, 'hooks', 'verified-ingest', '--force'], { cwd: pool, stdio: 'inherit' });
    const lessonsText = existsSync(join(pool, LESSONS)) ? readFileSync(join(pool, LESSONS), 'utf8') : JSON.stringify({ version: 1, gate: 0.6, generatedAt: Date.now(), lessons: [], belowGate: 0, held: [] });
    const lessons = JSON.parse(lessonsText).lessons ?? [];

    // 2. Evaluation split, both arms.
    const baseline = arm('off', tasks.eval, root, off, opts, null);
    const loop = arm('on', tasks.eval, root, on, opts, lessonsText);
    loop.lessonHitRate = tasks.eval.length ? tasks.eval.filter(t => lessonHit(lessons, t.prompt)).length / tasks.eval.length : 0;
    loop.lessonsTrained = lessons.filter(l => l.kind === 'lesson').length;

    const pairedOutcomes = paired(baseline, loop, r => (r.passed ? 1 : 0));
    const successVerdict = gate.sequentialEvidenceVerdict(pairedOutcomes, 1);
    const costVerdict = gate.sequentialEvidenceVerdict(paired(baseline, loop, r => -r.cost), 1);
    const report = { generatedAt: new Date().toISOString(), model: opts.model, train: tasks.train.length, eval: tasks.eval.length, arms: [baseline, loop], pairedOutcomes, gate: { success: successVerdict, cost: costVerdict, minInformativePairs: minPairs } };
    for (const a of report.arms) {
      console.log(`${a.arm.padEnd(4)} verified ${(a.verifiedSuccessRate * 100).toFixed(1)}%  cost $${a.costUsd.toFixed(4)}  per verified success ${a.costPerVerifiedSuccess === null ? 'n/a' : '$' + a.costPerVerifiedSuccess.toFixed(4)}${a.lessonHitRate !== undefined ? `  lesson hit ${(a.lessonHitRate * 100).toFixed(1)}% (approx.)` : ''}${a.unpricedRuns ? `  ${a.unpricedRuns} run(s) without a cost` : ''}`);
    }
    console.log(verdictLine('success (the decision)', successVerdict));
    console.log(verdictLine('cost (secondary sign check)', costVerdict));
    if (opts.out) writeFileSync(opts.out, JSON.stringify(report, null, 2));
  } finally {
    if (opts.keep) console.log(`kept: ${root}`);
    else rmSync(root, { recursive: true, force: true });
  }
}

await main();
