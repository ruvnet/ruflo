#!/usr/bin/env node
// Runtime test for the multi-provider ledger: builds throwaway Claude and Codex
// logs and asserts every counting rule that trackers commonly get wrong.
//   node plugins/ruflo-cost-tracker/scripts/test-ledger.mjs

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'ledger-'));
process.env.CLAUDE_CONFIG_DIR = join(tmp, 'claude');
process.env.CODEX_HOME = join(tmp, 'codex');
mkdirSync(join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'p'), { recursive: true });
mkdirSync(join(process.env.CODEX_HOME, 'sessions', '2026', '10', '03'), { recursive: true });
mkdirSync(join(process.env.CODEX_HOME, 'archived_sessions'), { recursive: true });

const { collect } = await import('./_ledger.mjs');
const { priceUsage, lookup } = await import('./_pricebook.mjs');
const { summarise } = await import('./ledger.mjs');
const { advise } = await import('./advise.mjs');
const { localCost, breakEvenBusy } = await import('./local-cost.mjs');

const jsonl = (path, items) => writeFileSync(path, items.map(item => JSON.stringify(item)).join('\n') + '\n');
const T = i => `2026-10-03T00:00:${String(i).padStart(2, '0')}.000Z`;
let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (error) { failed += 1; console.log(`FAIL ${name}\n     ${error.message}`); } };

// ── Claude: one message logged three times (content blocks) counts once; TTL split is priced.
const message = (id, extra = {}) => ({ type: 'assistant', sessionId: 's1', cwd: '/x', requestId: `r-${id}`, timestamp: T(1), message: { id, role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 10000, cache_creation_input_tokens: 2000, cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 1500 } } }, ...extra });
jsonl(join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'p', 's1.jsonl'), [message('m1'), message('m1'), message('m1'), message('m2', { isSidechain: true }), { type: 'user', message: { role: 'user' } }, { type: 'assistant', timestamp: T(2), message: { id: 'syn', role: 'assistant', model: '<synthetic>', usage: { input_tokens: 9 } } }]);

// ── Codex: running totals → deltas, cached ⊂ input, a reset, a replayed (forked) event, model from turn_context.
const total = (input, cached, output) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output });
const event = (i, usage) => ({ timestamp: T(i), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage } } });
const rollout = [
  { type: 'session_meta', payload: { id: 'cx1', cwd: '/y' } },
  { type: 'turn_context', payload: { model: 'gpt-5.3-codex', effort: 'high' } },
  event(10, total(1000, 800, 100)),
  event(10, total(1000, 800, 100)), // identical running total: no new usage
  event(11, total(3000, 2600, 300)),
  event(12, total(500, 400, 50)), // total went DOWN: compaction/reset, a fresh base
];
jsonl(join(process.env.CODEX_HOME, 'sessions', '2026', '10', '03', 'rollout-a.jsonl'), rollout);
jsonl(join(process.env.CODEX_HOME, 'archived_sessions', 'rollout-a.jsonl'), rollout); // same rollout archived: active copy wins
jsonl(join(process.env.CODEX_HOME, 'sessions', '2026', '10', '03', 'rollout-fork.jsonl'), [{ type: 'turn_context', payload: { model: 'gpt-5.3-codex' } }, event(10, total(1000, 800, 100)), event(11, total(3000, 2600, 300))]); // replayed parent history

const rows = collect();
const claude = rows.filter(row => row.provider === 'claude');
const codex = rows.filter(row => row.provider === 'codex');

test('claude: duplicate message ids count once; <synthetic> and non-assistant lines are skipped', () => assert.equal(claude.length, 2));
test('claude: 5m and 1h cache writes are priced separately', () => {
  const r = claude[0];
  assert.equal(r.cache_write_5m, 500); assert.equal(r.cache_write_1h, 1500);
  const p = priceUsage(r.model, r, 'claude');
  const expected = (1000 * 4 + 500 * 20 + 10000 * 0.2 + 500 * 5 + 1500 * 8) / 1e6;
  assert.ok(Math.abs(p.cost - expected) < 1e-9, `${p.cost} vs ${expected}`);
});
test('claude: sidechain flag is kept', () => assert.equal(claude.filter(row => row.sidechain).length, 1));
test('codex: deltas of the running total, replay and archived copies de-duplicated', () => {
  assert.equal(codex.length, 3);
  assert.deepEqual(codex.map(row => row.input + row.cache_read), [1000, 2000, 500]);
});
test('codex: cached input is a subset (uncached = input - cached)', () => assert.deepEqual([codex[0].input, codex[0].cache_read], [200, 800]));
test('codex: model comes from turn_context', () => assert.equal(codex[0].model, 'gpt-5.3-codex'));
test('price: an unknown model is UNPRICED, not $0', () => assert.equal(priceUsage('mystery-9', { input: 1e6 }, 'codex').priced, false));
test('price: gpt-5.6-sol is not mistaken for gpt-5', () => assert.equal(lookup('gpt-5.6-sol', 'codex'), null));
test('price: family fallback is flagged approximate', () => assert.equal(priceUsage('claude-sonnet-3-5', { input: 1e6 }, 'claude').approx, true));
test('price: credits and usd never merge', () => {
  const s = summarise([{ ...claude[0] }, { provider: 'codex', model: 'gpt-6-sol', ts: 1, session: 'z', input: 1e6, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, output: 0, reasoning: 0 }]);
  assert.ok(s.totals.usd > 0 && s.totals.credits === 50);
});
test('advise: sub-agent on a top tier reports a what-if saving; unpriced model is surfaced', () => {
  const big = { ...claude[1], input: 5e6, output: 5e6 };
  const f = advise([big, { ...big, model: 'mystery-9' }]);
  assert.ok(f.some(x => x.id.startsWith('subagents-') && x.saving > 1));
  assert.ok(f.some(x => x.id === 'unpriced'));
});
test('local: break-even busy fraction matches the cost curve', () => {
  const config = { wattsIdle: 80, wattsActive: 350, kwh: 0.15, hwPrice: 3000, lifeYears: 3, resale: 0.2, tokPerS: 80 };
  const b = breakEvenBusy(config, 2);
  assert.ok(Math.abs(localCost(config, b).perMtok - 2) < 1e-6);
  assert.equal(breakEvenBusy({ ...config, tokPerS: 0.1 }, 2), null);
});
test('openrouter: without --yes nothing is sent and no key is needed', () => {
  const r = spawnSync(process.execPath, [join(HERE, 'openrouter.mjs'), 'key'], { encoding: 'utf-8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0); assert.match(r.stdout, /Nothing was sent/);
});
test('openrouter: a key in the environment is never echoed', () => {
  const r = spawnSync(process.execPath, [join(HERE, 'openrouter.mjs'), 'key'], { encoding: 'utf-8', env: { PATH: process.env.PATH, OPENROUTER_API_KEY: 'sk-or-SECRET123' } });
  assert.ok(!(r.stdout + r.stderr).includes('SECRET123'));
});

if (failed > 0) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
