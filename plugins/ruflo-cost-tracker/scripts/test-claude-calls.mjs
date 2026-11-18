#!/usr/bin/env node
// Runtime test for _claude-calls.mjs: a Claude Code response logged once per
// content block must be counted once by track.mjs and session.mjs.
//   node plugins/ruflo-cost-tracker/scripts/test-claude-calls.mjs

import assert from 'node:assert/strict';
import { mergeCall } from './_claude-calls.mjs';

let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (error) { failed += 1; console.log(`FAIL ${name}\n     ${error.message}`); } };

let seq = 0;
const line = (id, requestId, usage, extra = {}) => ({
  type: 'assistant', requestId, timestamp: '2026-11-03T00:00:00.000Z', uuid: `u-${(seq += 1)}`,
  message: { id, role: 'assistant', model: 'claude-sonnet-5', usage }, ...extra,
});
const U = { input_tokens: 10, output_tokens: 200, cache_creation_input_tokens: 3000, cache_read_input_tokens: 40000 };

test('three lines of one response count once', () => {
  const calls = new Map();
  for (let i = 0; i < 3; i++) mergeCall(calls, line('m1', 'r1', U));
  assert.equal(calls.size, 1);
  assert.deepEqual(calls.get('m1|r1').usage, U);
});

test('two responses count twice', () => {
  const calls = new Map();
  mergeCall(calls, line('m1', 'r1', U));
  mergeCall(calls, line('m2', 'r2', U));
  assert.equal(calls.size, 2);
});

test('the same message id under another request counts separately', () => {
  const calls = new Map();
  mergeCall(calls, line('m1', 'r1', U));
  mergeCall(calls, line('m1', 'r2', U));
  assert.equal(calls.size, 2);
});

test('each field keeps its largest value across a response', () => {
  const calls = new Map();
  mergeCall(calls, line('m1', 'r1', { ...U, output_tokens: 5 }));
  mergeCall(calls, line('m1', 'r1', U));
  assert.equal(calls.get('m1|r1').usage.output_tokens, 200);
  assert.equal(calls.get('m1|r1').usage.cache_read_input_tokens, 40000);
});

test('a line without message.id falls back to its uuid', () => {
  const calls = new Map();
  const a = line(undefined, 'r1', U, { uuid: 'u-a' });
  const b = line(undefined, 'r1', U, { uuid: 'u-b' });
  mergeCall(calls, a); mergeCall(calls, b);
  assert.equal(calls.size, 2);
});

test('missing usage fields count as 0', () => {
  const calls = new Map();
  mergeCall(calls, line('m1', 'r1', { output_tokens: 7 }));
  assert.deepEqual(calls.get('m1|r1').usage, { input_tokens: 0, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
