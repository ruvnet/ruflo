/**
 * Contract 6 of the real-binary tier (ADR-512): the learning loop on classic hooks alone, no mod loaded. The project
 * carries what `ruflo init` installs (hook-handler.cjs, router.cjs, learning-loop.cjs and the UserPromptSubmit /
 * SessionEnd hooks); the real `claude -p` runs them against the scripted mock model.
 *
 * 6a. A scripted fix turn is recorded from the transcript as one verified-success naming the edited file.
 * 6b. A learned lesson reaches the model through the classic `route` hook.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { claudeVersion, describeRun, REPO_ROOT, requestText, runClaude, type RunResult, type Turn } from './run';

const runs: RunResult[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.cleanup();
});
async function run(options: Parameters<typeof runClaude>[0]): Promise<RunResult> {
  const r = await runClaude(options);
  runs.push(r);
  return r;
}

const say = (text: string): Turn => ({ content: [{ type: 'text', text }] });
const bash = (command: string): Turn => ({ content: [{ type: 'tool_use', name: 'Bash', input: { command, description: 'run' } }] });

beforeAll(() => {
  expect(claudeVersion(), 'the claude binary could not be started').toBeTruthy();
});

const HELPERS = join(REPO_ROOT, 'v3', '@claude-flow', 'cli', '.claude', 'helpers');
const hook = (sub: string) => ({ type: 'command', command: `node "$CLAUDE_PROJECT_DIR/.claude/helpers/hook-handler.cjs" ${sub}`, timeout: 10 });

/** The classic install: helpers and the two hooks the loop uses, as `ruflo init` writes them. */
const CLASSIC = {
  '.claude/helpers/hook-handler.cjs': readFileSync(join(HELPERS, 'hook-handler.cjs'), 'utf8'),
  '.claude/helpers/router.cjs': readFileSync(join(HELPERS, 'router.cjs'), 'utf8'),
  '.claude/helpers/learning-loop.cjs': readFileSync(join(HELPERS, 'learning-loop.cjs'), 'utf8'),
  '.claude/settings.json': JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [hook('route')] }], SessionEnd: [{ hooks: [hook('session-end')] }] } }),
  // A fresh spawn stamp, so session-end does not start a real CLI ingest from the test.
  '.claude-flow/data/verified-ingest.spawned': '0',
};

const NODE_PROJECT = {
  'package.json': JSON.stringify({ name: 'real-binary-fixture', version: '1.0.0', private: true, scripts: { test: 'node --test' } }, null, 2),
  'src/add.js': 'exports.add = (a, b) => a - b\n',
  'test/add.test.js': "const test = require('node:test')\nconst assert = require('node:assert')\nconst { add } = require('../src/add.js')\ntest('add', () => assert.strictEqual(add(2, 3), 5))\n",
};

describe('real binary: classic hooks run the learning loop without the mod (contract 6)', () => {
  it('a fix turn ending in a passing npm test is recorded once as a verified-success naming src/add.js', async () => {
    const r = await run({
      prompt: 'Run npm test, then fix the bug in src/add.js, then run npm test again.',
      pluginDir: null,
      files: { ...NODE_PROJECT, ...CLASSIC },
      allowedTools: ['Bash', 'Read', 'Edit'],
      script: (project) => {
        const file = join(project, 'src/add.js');
        return [
          bash('npm test'),
          { content: [{ type: 'tool_use', name: 'Read', input: { file_path: file } }] },
          { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file, old_string: 'a - b', new_string: 'a + b' } }] },
          bash('npm test'),
          say('Fixed: add now returns a + b and npm test passes.'),
        ];
      },
    });
    expect(r.exitCode, describeRun(r)).toBe(0);
    expect(r.file('src/add.js')).toContain('a + b');
    const lines = (r.file('.claude-flow/data/verified-trajectories.jsonl') ?? '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(lines, describeRun(r)).toHaveLength(1);
    expect(lines[0]).toMatchObject({ outcome: 'verified-success', verifier: { kind: 'test', command: 'npm test', passed: true }, files: ['src/add.js'], edits: 1, taint: [] });
    expect(lines[0].id).toMatch(/^vt-c/);
  });

  it('a learned lesson reaches the model through the classic route hook', async () => {
    const lessons = JSON.stringify({ version: 1, gate: 0.6, belowGate: 0, lessons: [{ id: 'L-0123456789', kind: 'lesson', agent: 'coder', keywords: ['add', 'bug', 'fix'], confidence: 0.67, successes: 4, failures: 0, evidence: 'npm test', files: ['src/add.js'] }] });
    const r = await run({ prompt: 'fix the add bug please', pluginDir: null, files: { ...CLASSIC, '.claude-flow/data/learned-lessons.json': lessons }, script: [say('noted')] });
    expect(r.exitCode, describeRun(r)).toBe(0);
    const text = requestText(r.scripted[0]!.body);
    expect(text).toContain('[RUFLO_LESSONS]');
    expect(text).toContain('`src/add.js`');
  });
});
