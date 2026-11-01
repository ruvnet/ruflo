#!/usr/bin/env node
/**
 * ADR-522 live A/B: the real `claude` binary with ruflo-mods' automatic context delegation off vs enforce, on the
 * session's own credentials (no API key). Each case copies one real repository file into a fresh project and asks an
 * analysis question with a known answer. Records main-loop tokens, cost and time from `--output-format json`, the mod's
 * metrics file, and whether the answer contains the expected fact. A handful of samples, not a statistical result.
 *
 *   node mod-live.mjs [--model haiku] [--out results-mod-live.json]
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const model = arg('--model', 'haiku');
const out = resolve(arg('--out', join(here, 'results-mod-live.json')));
const plugin = join(root, 'plugins/ruflo-mods');
// The worker's $.model.complete usage is NOT in claude -p's total_cost_usd / modelUsage (checked: main-loop tokens only),
// so it is priced here from the mod's own token counts at an assumed list price (USD per million tokens).
const WORKER_PRICE = { input: Number(arg('--worker-input-usd-per-m', 1)), output: Number(arg('--worker-output-usd-per-m', 5)) };
const workerCost = r => ((r.delegation?.inputTokens ?? 0) * WORKER_PRICE.input + (r.delegation?.outputTokens ?? 0) * WORKER_PRICE.output) / 1e6;

const CASES = [
  { file: 'v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts', q: 'Explore this file and find the largest k (number of episodes) that agentdb_episode-recall will return.', expect: /\b50\b/ },
  { file: 'v3/@claude-flow/cli/src/mcp-tools/agent-tools.ts', q: 'Explore this file and find what agent_spawn does when the active swarm already has maxAgents live agents.', expect: /refus|reject|error|fail|deny|limit/i },
  { file: 'v3/@claude-flow/swarm/src/consensus/raft.ts', q: 'Review this file and find how the vote quorum for a proposal is computed.', expect: /floor\(.*\/\s*2\)\s*\+\s*1|majority/i },
  { file: 'v3/@claude-flow/cli/src/mcp-tools/config-tools.ts', q: 'Review this file and find which scope names the config tools refuse.', expect: /__proto__/ },
  { file: 'v3/@claude-flow/cli/src/services/global-ai-budget.ts', q: 'Explore this file and find what happens to a permit whose id starts with bypass_.', expect: /bypass/i },
  { file: 'v3/@claude-flow/cli/src/mcp-tools/swarm-tools.ts', q: 'Explore this file and find the default topology swarm_init uses when none is given.', expect: /hierarchical|mesh|star|ring|adaptive/i },
];

function once(c, mode) {
  const project = mkdtempSync(join(tmpdir(), 'ruflo-ctx-live-'));
  mkdirSync(join(project, '.claude-flow'), { recursive: true });
  const name = basename(c.file);
  cpSync(join(root, c.file), join(project, name));
  const settings = JSON.stringify({ pluginConfigs: { 'ruflo-mods': { options: { contextDelegation: mode } }, 'ruflo-mods@inline': { options: { contextDelegation: mode } } } });
  const prompt = `${c.q} The file is ./${name}. Read it, then answer in two sentences.`;
  const t0 = Date.now();
  const r = spawnSync('claude', ['-p', prompt, '--model', model, '--output-format', 'json', '--plugin-dir', plugin, '--settings', settings,
    '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--allowedTools', 'Read', '--no-session-persistence'],
  { cwd: project, encoding: 'utf8', timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
  const wallMs = Date.now() - t0;
  let json = {};
  try { json = JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop() ?? '{}'); } catch {}
  const metricsPath = join(project, '.claude-flow/metrics/context-delegation.json');
  const metrics = existsSync(metricsPath) ? JSON.parse(readFileSync(metricsPath, 'utf8')) : null;
  rmSync(project, { recursive: true, force: true });
  const answer = String(json.result ?? '');
  const u = json.usage ?? {};
  return {
    file: c.file, mode, exit: r.status, wallMs, durationMs: json.duration_ms, costUsd: json.total_cost_usd,
    mainInputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    mainOutputTokens: u.output_tokens ?? 0, modelUsage: json.modelUsage, correct: c.expect.test(answer), answer: answer.slice(0, 400),
    delegation: metrics ? { ...metrics.totals, recent: metrics.recent.map(e => ({ ...e, path: basename(e.path) })) } : null,
  };
}

const summarize = rows => {
  const sum = (mode, k) => rows.filter(r => r.mode === mode).reduce((n, r) => n + (Number(r[k]) || 0), 0);
  return Object.fromEntries(['off', 'enforce'].map(m => {
    const mine = rows.filter(r => r.mode === m);
    const main = sum(m, 'costUsd'), worker = mine.reduce((n, r) => n + workerCost(r), 0);
    return [m, { runs: mine.length, correct: mine.filter(r => r.correct).length, delegated: mine.reduce((n, r) => n + (r.delegation?.delegated ?? 0), 0),
      mainCostUsd: +main.toFixed(4), workerCostUsd: +worker.toFixed(4), totalCostUsd: +(main + worker).toFixed(4), mainInputTokens: sum(m, 'mainInputTokens'), wallMs: sum(m, 'wallMs') }];
  }));
};

if (process.argv.includes('--resummarize')) {
  const prior = JSON.parse(readFileSync(out, 'utf8'));
  prior.summary = summarize(prior.rows); prior.workerPriceUsdPerM = WORKER_PRICE;
  writeFileSync(out, JSON.stringify(prior, null, 2) + '\n');
  console.log(JSON.stringify(prior.summary, null, 2));
  process.exit(0);
}

const rows = [];
for (const c of CASES) for (const mode of ['off', 'enforce']) {
  const row = once(c, mode);
  rows.push(row);
  console.error(`${mode.padEnd(7)} ${basename(c.file).padEnd(22)} exit=${row.exit} correct=${row.correct} in=${row.mainInputTokens} $=${row.costUsd?.toFixed?.(4)} ${row.wallMs}ms delegated=${row.delegation?.delegated ?? 0} fallbacks=${JSON.stringify(row.delegation?.fallbacks ?? {})}`);
}
const summary = summarize(rows);
writeFileSync(out, JSON.stringify({ schema: 'ruflo.context-delegation.mod-live/v1', model, claude: spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim(), at: new Date().toISOString(), summary, workerPriceUsdPerM: WORKER_PRICE, rows }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
