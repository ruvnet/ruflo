#!/usr/bin/env node
/**
 * Regression guard for ruvnet/ruflo#5121: a Fable session must be priced at the
 * `fable` rates in data/prices.json, not recorded as tier `unknown` at $0, by
 * both track.mjs (the Stop-hook record) and session.mjs (per-message drill-down).
 *
 * Hermetic: a fake HOME holds one session jsonl; track.mjs runs with
 * TRACK_DRY_RUN=1 so no CLI is spawned.
 *
 * Usage: node plugins/ruflo-cost-tracker/scripts/test-fable-pricing-5121.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeProjectPath } from './_encode-project-path.mjs';
import { loadBook } from './_pricebook.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

let failed = 0;
const assert = (cond, label, detail = '') => {
  if (cond) console.log(`ok: ${label}`);
  else { failed++; console.error(`FAIL: ${label}${detail ? `\n     ${detail}` : ''}`); }
};

const MODEL = 'claude-fable-5-2';
const USAGE = { input_tokens: 1000, output_tokens: 2000, cache_creation_input_tokens: 4000, cache_read_input_tokens: 100000 };
const rate = loadBook().models.find((m) => m.match === 'fable');
const EXPECTED = (USAGE.input_tokens * rate.input + USAGE.output_tokens * rate.output
  + USAGE.cache_creation_input_tokens * rate.cache_write_5m + USAGE.cache_read_input_tokens * rate.cache_read) / 1e6;
const close = (a, b) => Math.abs(a - b) < 1e-9;

const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-cost-tracker-fable-')));
const home = join(TMP, 'home');
const project = join(TMP, 'project');
mkdirSync(project, { recursive: true });
const dir = join(home, '.claude', 'projects', encodeProjectPath(project));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 's.jsonl'), [
  { sessionId: 's', cwd: project, timestamp: '2026-11-25T00:00:00.000Z', type: 'user' },
  { sessionId: 's', cwd: project, timestamp: '2026-11-25T00:00:05.000Z', type: 'assistant', requestId: 'r1',
    message: { id: 'm1', model: MODEL, usage: USAGE } },
].map((l) => JSON.stringify(l)).join('\n') + '\n');

const env = { ...process.env, HOME: home, USERPROFILE: home };
for (const k of ['TRACK_SESSION', 'TRACK_CWD', 'COST_PRICES', 'SESSION_QUIET', 'NODE_OPTIONS']) delete env[k];

const out = join(TMP, 'track.json');
const t = spawnSync(process.execPath, [join(HERE, 'track.mjs')], {
  cwd: project, encoding: 'utf-8', timeout: 15_000,
  env: { ...env, TRACK_CWD: project, TRACK_DRY_RUN: '1', TRACK_QUIET: '1', TRACK_OUT: out },
});
assert(t.status === 0, 'track.mjs exits 0', `status ${t.status}: ${t.stderr}`);
if (t.status === 0) {
  const rec = JSON.parse(readFileSync(out, 'utf-8'));
  assert(rec.byModel[MODEL]?.tier === 'fable', 'track.mjs records the model under tier fable', JSON.stringify(rec.byModel[MODEL]));
  assert(close(rec.total_cost_usd, EXPECTED), 'track.mjs total_cost_usd uses the fable rates', `got ${rec.total_cost_usd}, wanted ${EXPECTED}`);
  assert(close(rec.byTier.fable, EXPECTED), 'track.mjs byTier.fable holds the cost', JSON.stringify(rec.byTier));
  assert(rec.byTier.unknown === 0, 'track.mjs leaves byTier.unknown at 0', JSON.stringify(rec.byTier));
}

const s = spawnSync(process.execPath, [join(HERE, 'session.mjs'), '--format', 'json'], {
  cwd: project, encoding: 'utf-8', timeout: 15_000, env,
});
assert(s.status === 0, 'session.mjs exits 0', `status ${s.status}: ${s.stderr}`);
if (s.status === 0) {
  const rep = JSON.parse(s.stdout);
  assert(rep.topByMessage[0]?.tier === 'fable', 'session.mjs reports tier fable', JSON.stringify(rep.topByMessage[0]));
  assert(close(rep.total_cost_usd, Math.round(EXPECTED * 1e6) / 1e6), 'session.mjs total_cost_usd uses the fable rates', `got ${rep.total_cost_usd}, wanted ${EXPECTED}`);
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
