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
 *     [--test-index k]        which test this is in the gate's sequence (default 1; each later run uses the next k)
 *     [--ablate]              ADR-511: a third arm with the same lessons minus their edited files
 *     [--concurrency n]       claude -p runs at a time within a split or arm (1..8, default 4)
 *     [--lessons <file>]      skip training and use this learned-lessons.json
 *     [--save-lessons <file>] keep the trained lessons for a later --lessons run
 *     [--eval-sample n]       a pilot on n eval tasks spread over the split; its verdict counts for nothing
 *     [--calibrate n]         the baseline alone on n train tasks, to size a corpus before a real run
 *     [--max-turns n]         cap the eval arms and calibration (training is never capped); for sizing only:
 *                             a cap near the model's natural finish makes pass/fail noisy (ADR-511 §5)
 *
 * A corpus: node scripts/eval-learning-loop-corpus.mjs --out <dir> (ADR-511 §5).
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
 * scripts/eval-learning-loop-corpus.mjs writes one such tasks file (15 train, 30 eval); any other works too.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
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
  const out = { run: false, model: 'haiku', budget: '0.50', timeoutSec: 600, tasks: null, out: null, keep: false, testIndex: 1, ablate: false, concurrency: 4, maxTurns: null, calibrate: 0, lessons: null, saveLessons: null, evalSample: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') out.run = true;
    else if (a === '--tasks') out.tasks = argv[++i];
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--budget-usd') out.budget = argv[++i];
    else if (a === '--timeout-sec') out.timeoutSec = Number(argv[++i]);
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--keep') out.keep = true;
    else if (a === '--test-index') out.testIndex = Number(argv[++i]);
    else if (a === '--ablate') out.ablate = true;
    else if (a === '--concurrency') out.concurrency = Number(argv[++i]);
    else if (a === '--max-turns') out.maxTurns = Number(argv[++i]);
    else if (a === '--calibrate') out.calibrate = Number(argv[++i]);
    else if (a === '--lessons') out.lessons = argv[++i];
    else if (a === '--save-lessons') out.saveLessons = argv[++i];
    else if (a === '--eval-sample') out.evalSample = Number(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!Number.isInteger(out.testIndex) || out.testIndex < 1) throw new Error('--test-index must be a whole number >= 1');
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 8) throw new Error('--concurrency must be 1..8');
  if (out.maxTurns !== null && (!Number.isInteger(out.maxTurns) || out.maxTurns < 1)) throw new Error('--max-turns must be a whole number >= 1');
  if (!Number.isInteger(out.calibrate) || out.calibrate < 0) throw new Error('--calibrate must be a whole number');
  if (!Number.isInteger(out.evalSample) || out.evalSample < 0) throw new Error('--eval-sample must be a whole number');
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

/** `opts.maxTurns` limits the evaluation arms and calibration only; training always runs unlimited. */
function claude(dir, prompt, settings, opts, maxTurns = opts.maxTurns) {
  const argv = ['-p', prompt, '--output-format', 'json', '--model', opts.model, '--plugin-dir', PLUGIN, '--settings', settings,
    '--setting-sources', 'local', '--max-budget-usd', opts.budget, '--allowedTools', 'Read,Edit,Write,Bash,Grep,Glob',
    ...(maxTurns ? ['--max-turns', String(maxTurns)] : [])];
  return new Promise(done => {
    const child = spawn('claude', argv, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' } });
    let stdout = '';
    child.stdout.on('data', d => (stdout += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutSec * 1000);
    child.on('close', status => {
      clearTimeout(timer);
      writeFileSync(`${dir}.result.json`, stdout);
      let cost = 0;
      let turns = null;
      try {
        const j = JSON.parse(stdout);
        cost = Number(j.total_cost_usd) || 0;
        turns = Number.isFinite(j.num_turns) ? j.num_turns : null;
      } catch {
        // no JSON result (timeout, crash): the cost is unknown, counted as 0 and flagged
      }
      done({ cost, turns, ok: status === 0 });
    });
  });
}

/** Runs `work` over `items`, at most `n` at a time, results in input order. */
async function pool(items, n, work) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i], i);
    }
  }));
  return out;
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

async function arm(name, tasks, root, settings, opts, lessonsText) {
  const rows = await pool(tasks, opts.concurrency, async task => {
    const dir = workdir(root, task, name);
    if (lessonsText) writeFileSync(join(dir, LESSONS), lessonsText);
    const run = await claude(dir, task.prompt, settings, opts);
    const passed = check(dir, task, opts.timeoutSec);
    process.stderr.write(`[${name}] ${task.id}: ${passed ? 'pass' : 'fail'} $${run.cost.toFixed(4)}${run.turns === null ? '' : ` ${run.turns} turns`}\n`);
    return { id: task.id, passed, cost: run.cost, turns: run.turns, claudeOk: run.ok };
  });
  const passed = rows.filter(r => r.passed).length;
  const cost = rows.reduce((a, r) => a + r.cost, 0);
  return { arm: name, tasks: rows.length, verifiedSuccessRate: rows.length ? passed / rows.length : 0, costUsd: cost, costPerVerifiedSuccess: passed ? cost / passed : null, unpricedRuns: rows.filter(r => r.cost === 0).length, stoppedEarly: rows.filter(r => !r.claudeOk).length, rows };
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

function printArm(a) {
  console.log(`${a.arm.padEnd(10)} verified ${(a.verifiedSuccessRate * 100).toFixed(1)}%  cost $${a.costUsd.toFixed(4)}  per verified success ${a.costPerVerifiedSuccess === null ? 'n/a' : '$' + a.costPerVerifiedSuccess.toFixed(4)}${a.lessonHitRate !== undefined ? `  lesson hit ${(a.lessonHitRate * 100).toFixed(1)}% (approx.)` : ''}${a.unpricedRuns ? `  ${a.unpricedRuns} run(s) without a cost` : ''}`);
}

/** ADR-511 ablation: the same lessons with the edited files removed, so the arm differs from "on" in that alone. */
function withoutFiles(lessonsText) {
  const j = JSON.parse(lessonsText);
  for (const l of j.lessons ?? []) delete l.files;
  return JSON.stringify(j, null, 2);
}

async function main() {
  const opts = args(process.argv.slice(2));
  if (opts.help || !opts.tasks) {
    const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
    console.log(lines.slice(2, lines.indexOf(' */')).join('\n').replace(/^ \*\/?/gm, ''));
    process.exit(opts.help ? 0 : 2);
  }
  const tasks = loadTasks(opts.tasks);
  const spread = (list, n) => Array.from({ length: Math.min(n, list.length) }, (_, i) => list[Math.floor((i * list.length) / Math.min(n, list.length))]);
  if (opts.evalSample > 0) tasks.eval = spread(tasks.eval, opts.evalSample);
  if (opts.lessons) tasks.train = [];
  if (opts.calibrate > 0) {
    // $: the baseline alone on the first N train tasks, to measure how often it fails before sizing a real run.
    // Evenly spread over the split, so every feature of a corpus ordered by feature is sampled.
    const sample = spread(tasks.train, opts.calibrate);
    console.log(`calibrate: loop off on ${sample.length} train task(s), cap $${(sample.length * Number(opts.budget)).toFixed(2)}`);
    if (!opts.run) return console.log('plan only: pass --run to spend');
    const root = mkdtempSync(join(tmpdir(), 'ruflo-eval-cal-'));
    try {
      const a = await arm('off', sample, root, settingsFile(root, false), opts, null);
      printArm(a);
      if (opts.out) writeFileSync(opts.out, JSON.stringify({ generatedAt: new Date().toISOString(), model: opts.model, maxTurns: opts.maxTurns, calibrate: a }, null, 2));
    } finally {
      if (opts.keep) console.log(`kept: ${root}`);
      else rmSync(root, { recursive: true, force: true });
    }
    return;
  }
  const arms = opts.ablate ? 3 : 2;
  const runs = tasks.train.length + arms * tasks.eval.length;
  console.log(`train ${tasks.train.length}, eval ${tasks.eval.length} (ADR-503 asks for 30), arms ${arms}, claude -p runs: ${runs}, cap $${(runs * Number(opts.budget)).toFixed(2)} at --budget-usd ${opts.budget}`);
  if (tasks.eval.length !== 30) console.log('warning: the eval split is not 30 tasks; the result is not the ADR-503 §3 measurement');
  const gate = await loadGate();
  const minPairs = gate.minInformativePairsToClear(opts.testIndex);
  console.log(`gate: test ${opts.testIndex} in the sequence; the loop must pass at least ${minPairs} eval tasks the baseline fails, with none the other way round, at family-wise alpha ${gate.DEFAULT_ALPHA_TOTAL}`);
  if (opts.ablate) console.log(`ablation (files vs no files) is test ${opts.testIndex + 1}: at least ${gate.minInformativePairsToClear(opts.testIndex + 1)} informative pairs`);
  if (opts.evalSample > 0) console.log(`pilot: ${tasks.eval.length} eval task(s) sampled; this run sizes a real one and its verdict counts for nothing`);
  else if (tasks.eval.length < minPairs) {
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
    const pooled = join(root, 'train-pool');
    mkdirSync(join(pooled, '.claude-flow', 'data'), { recursive: true });
    const trained = await pool(tasks.train, opts.concurrency, async task => {
      const dir = workdir(root, task, 'train');
      const run = await claude(dir, task.prompt, on, opts, null);
      const passed = check(dir, task, opts.timeoutSec);
      process.stderr.write(`[train] ${task.id}: ${passed ? 'pass' : 'fail'} $${run.cost.toFixed(4)}\n`);
      return { id: task.id, dir, passed, cost: run.cost };
    });
    for (const t of trained) if (existsSync(join(t.dir, TRAJ))) appendFileSync(join(pooled, TRAJ), readFileSync(join(t.dir, TRAJ), 'utf8'));
    if (existsSync(join(pooled, TRAJ))) execFileSync(process.execPath, [CLI, 'hooks', 'verified-ingest', '--force'], { cwd: pooled, stdio: 'inherit' });
    const lessonsText = opts.lessons ? readFileSync(opts.lessons, 'utf8') : existsSync(join(pooled, LESSONS)) ? readFileSync(join(pooled, LESSONS), 'utf8') : JSON.stringify({ version: 1, gate: 0.6, generatedAt: Date.now(), lessons: [], belowGate: 0, held: [] });
    const lessons = JSON.parse(lessonsText).lessons ?? [];
    if (opts.saveLessons) writeFileSync(opts.saveLessons, lessonsText);

    // 2. Evaluation split: the arms run one after another, each task within an arm concurrently.
    const baseline = await arm('off', tasks.eval, root, off, opts, null);
    const loop = await arm('on', tasks.eval, root, on, opts, lessonsText);
    const nofiles = opts.ablate ? await arm('on-nofiles', tasks.eval, root, on, opts, withoutFiles(lessonsText)) : null;
    for (const a of [loop, nofiles].filter(Boolean)) a.lessonHitRate = tasks.eval.length ? tasks.eval.filter(t => lessonHit(lessons, t.prompt)).length / tasks.eval.length : 0;
    loop.lessonsTrained = lessons.filter(l => l.kind === 'lesson').length;

    const pass = r => (r.passed ? 1 : 0);
    const pairedOutcomes = paired(baseline, loop, pass);
    const successVerdict = gate.sequentialEvidenceVerdict(pairedOutcomes, opts.testIndex);
    const costVerdict = gate.sequentialEvidenceVerdict(paired(baseline, loop, r => -r.cost), opts.testIndex);
    const ablation = nofiles ? { pairedOutcomes: paired(nofiles, loop, pass), verdict: gate.sequentialEvidenceVerdict(paired(nofiles, loop, pass), opts.testIndex + 1) } : null;
    const report = {
      generatedAt: new Date().toISOString(), model: opts.model, maxTurns: opts.maxTurns, lessonsFrom: opts.lessons ?? 'trained in this run', pilot: opts.evalSample > 0, train: tasks.train.length, eval: tasks.eval.length,
      training: { passed: trained.filter(t => t.passed).length, costUsd: trained.reduce((a, t) => a + t.cost, 0) },
      lessons, arms: [baseline, loop, nofiles].filter(Boolean), pairedOutcomes,
      gate: { testIndex: opts.testIndex, success: successVerdict, cost: costVerdict, minInformativePairs: minPairs, ablation },
    };
    console.log(`training: ${report.training.passed}/${trained.length} passed, $${report.training.costUsd.toFixed(4)}; ${loop.lessonsTrained} lesson(s)`);
    for (const a of report.arms) printArm(a);
    console.log(verdictLine('success, off vs on (the decision)', successVerdict));
    console.log(verdictLine('cost, off vs on (secondary sign check)', costVerdict));
    if (ablation) console.log(verdictLine('success, on-nofiles vs on (ADR-511 ablation)', ablation.verdict));
    if (opts.out) writeFileSync(opts.out, JSON.stringify(report, null, 2));
  } finally {
    if (opts.keep) console.log(`kept: ${root}`);
    else rmSync(root, { recursive: true, force: true });
  }
}

await main();
