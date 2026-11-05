import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  discoverPlugins,
  evaluatePlugin,
  main,
  parseKnownFailures,
  parseResults,
} from '../scripts/run-plugin-kit-tests.mjs';

const summary = (pass, fail, extra = '') => `${extra}\n ${pass} pass\n ${fail} fail\nRan ${pass + fail} tests across 1 file.\n`;

function fixture(script) {
  const root = mkdtempSync(join(tmpdir(), 'kit-tests-'));
  const tests = join(root, 'plugins', 'demo', 'tests');
  mkdirSync(tests, { recursive: true });
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(tests, 'a.test.ts'), "import { test } from 'claude-code/testing'\n");
  const claude = join(root, 'fake-claude');
  writeFileSync(claude, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 2.1.318; exit 0; fi\n${script}\n`);
  chmodSync(claude, 0o755);
  return { root, claude, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('discovery finds only plugins whose tests import the kit', () => {
  const { root, done } = fixture('');
  try {
    mkdirSync(join(root, 'plugins', 'plain', 'tests'), { recursive: true });
    writeFileSync(join(root, 'plugins', 'plain', 'tests', 'b.test.ts'), "import { test } from 'vitest'\n");
    assert.deepEqual(discoverPlugins(root), ['demo']);
  } finally { done(); }
});

test('results keep failure names without their durations', () => {
  const parsed = parseResults(summary(1, 1, '(pass) ok [1.5ms]\n(fail) group > it breaks [5010.01ms]'));
  assert.deepEqual(parsed, { pass: 1, fail: 1, failures: ['group > it breaks'] });
});

test('a known failure passes the gate and a new one does not', () => {
  const output = summary(1, 1, '(fail) broken [2ms]');
  assert.deepEqual(evaluatePlugin('demo', { code: 1, output }, new Set(['broken'])), []);
  assert.match(evaluatePlugin('demo', { code: 1, output })[0], /new failure: broken/);
});

test('a known failure that passes must be removed, so the list only shrinks', () => {
  const problems = evaluatePlugin('demo', { code: 0, output: summary(2, 0) }, new Set(['fixed']));
  assert.match(problems[0], /remove it from the known failures: fixed/);
});

test('crashes, timeouts and empty runs fail rather than pass', () => {
  assert.match(evaluatePlugin('demo', { code: 1, output: 'crashed' })[0], /no test summary/);
  assert.match(evaluatePlugin('demo', { code: null, output: '', timedOut: true })[0], /timed out/);
  assert.match(evaluatePlugin('demo', { code: 0, output: summary(0, 0) })[0], /found no tests/);
  assert.match(evaluatePlugin('demo', { code: 2, output: summary(1, 0) })[0], /exit 2/);
});

test('known-failure lines need a plugin and a test name', () => {
  const known = parseKnownFailures('# why\n\ndemo | a > b | c\n');
  assert.deepEqual([...known.get('demo')], ['a > b | c']);
  assert.throws(() => parseKnownFailures('no separator'), /needs "plugin \| test name"/);
});

test('a missing claude binary fails instead of skipping', async () => {
  const lines = [];
  const code = await main({ claude: '/nonexistent/claude', log: (line) => lines.push(line) });
  assert.equal(code, 3);
  assert.match(lines[0], /cannot run/);
});

test('the gate exits by the real run: pass, then fail', async () => {
  const passing = fixture(`printf '(pass) ok [1ms]\\n 1 pass\\n 0 fail\\n'; exit 0`);
  const failing = fixture(`printf '(fail) broken [1ms]\\n 0 pass\\n 1 fail\\n'; exit 1`);
  try {
    assert.equal(await main({ repoRoot: passing.root, claude: passing.claude, log: () => {} }), 0);
    assert.equal(await main({ repoRoot: failing.root, claude: failing.claude, log: () => {} }), 1);
  } finally { passing.done(); failing.done(); }
});

test('CI runs this gate with Claude Code installed', () => {
  const workflow = readFileSync(new URL('../.github/workflows/mod-guidance.yml', import.meta.url), 'utf8');
  const job = workflow.slice(workflow.indexOf('  mods-kit-tests:'));
  assert.match(job, /@anthropic-ai\/claude-code@\$\{CLAUDE_CODE_VERSION\}/);
  assert.match(job, /node --test tests\/run-plugin-kit-tests\.test\.mjs/);
  assert.match(job, /node scripts\/run-plugin-kit-tests\.mjs/);
  assert.doesNotMatch(job, /continue-on-error|\|\| true/);
});
