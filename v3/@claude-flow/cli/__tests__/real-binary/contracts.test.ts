/**
 * Contracts 2-5 of the real-binary tier (ADR-504 §2.3), each a real `claude -p` run against the scripted mock model
 * with ruflo-mods loaded at its default options.
 *
 * 2. Learning loop: a scripted fix turn (npm test fails, edit, npm test passes) is recorded as one verified-success.
 * 3. Lessons reach the model: with a learned-lessons file present, the request carries the [RUFLO_LESSONS] block.
 * 4. Guard tightens: a scripted Bash call that deletes the filesystem root is denied before it runs.
 * 5. Route context: the routing block reaches the request.
 *
 * The mock is not a model (ADR-504 §3): these contracts check what reached the model and what the engine did, never
 * what a model would do with it.
 */
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { claudeVersion, describeRun, lastUserText, requestText, resultEvent, runClaude, type RunResult, type Turn } from './run';

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
  // Fail, never skip, when the binary is missing (ADR-504 §2.4).
  expect(claudeVersion(), 'the claude binary could not be started').toBeTruthy();
});

/** A one-function Node project whose `npm test` runs `node --test`; `src/add.js` starts with a bug. */
const NODE_PROJECT = {
  'package.json': JSON.stringify({ name: 'real-binary-fixture', version: '1.0.0', private: true, scripts: { test: 'node --test' } }, null, 2),
  'src/add.js': 'exports.add = (a, b) => a - b\n',
  'test/add.test.js': "const test = require('node:test')\nconst assert = require('node:assert')\nconst { add } = require('../src/add.js')\ntest('add', () => assert.strictEqual(add(2, 3), 5))\n",
};

describe('real binary: learning loop records a verified outcome (contract 2)', () => {
  it('npm test fails, the file is fixed, npm test passes: one verified-success record', async () => {
    const r = await run({
      prompt: 'Run npm test, then fix the bug in src/add.js, then run npm test again.',
      files: NODE_PROJECT,
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
    // The scripted calls really ran: the fix is on disk and the engine asked for every turn.
    expect(r.file('src/add.js')).toContain('a + b');
    expect(r.scripted.length).toBe(5);
    // The first npm test really failed and the last really passed, as the engine reported them to the model.
    expect(lastUserText(r.scripted[1]!.body)).toMatch(/fail/i);

    const jsonl = r.file('.claude-flow/data/verified-trajectories.jsonl');
    expect(jsonl, describeRun(r)).toBeDefined();
    const records = jsonl!.trim().split('\n').map((line) => JSON.parse(line));
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record.outcome).toBe('verified-success');
    expect(record.verifier).toMatchObject({ kind: 'test', command: 'npm test', passed: true });
    expect(record.edits).toBe(1);
    // The failing run before the edit is a step (ok: false) that did not decide the outcome.
    expect(record.steps.map((s: { tool: string; ok: boolean }) => `${s.tool}:${s.ok}`)).toEqual(['Bash:false', 'Read:true', 'Edit:true', 'Bash:true']);
  });
});

/** A lessons file as the CLI ingest writes it (ADR-502 §2.2), with one lesson above the 0.6 gate. */
function lessonsFile(confidence: number) {
  return JSON.stringify({
    version: 1,
    gate: 0.6,
    belowGate: 0,
    lessons: [{ id: 'L-0123456789', kind: 'lesson', agent: 'coder', keywords: ['add', 'bug', 'fix'], confidence, successes: 4, failures: 0, evidence: 'npm test' }],
  });
}

describe('real binary: verified lessons reach the model (contract 3)', () => {
  const prompt = 'Fix the bug in the add function.';

  it('a lesson above the gate is in the request the model receives', async () => {
    const r = await run({ prompt, files: { '.claude-flow/data/learned-lessons.json': lessonsFile(0.67) }, script: [say('noted')] });
    expect(r.exitCode, describeRun(r)).toBe(0);
    expect(r.scripted.length).toBe(1);
    const text = requestText(r.scripted[0]!.body);
    expect(text).toContain('[RUFLO_LESSONS]');
    expect(text).toContain('[lesson L-0123456789 conf 0.67, 4 passed / 0 failed]');
  });

  it('negative control: the same lesson below the gate never reaches the model', async () => {
    const r = await run({ prompt, files: { '.claude-flow/data/learned-lessons.json': lessonsFile(0.4) }, script: [say('noted')] });
    expect(r.exitCode, describeRun(r)).toBe(0);
    expect(requestText(r.scripted[0]!.body)).not.toContain('[RUFLO_LESSONS]');
  });
});

describe('real binary: the guard denies a root delete before it runs (contract 4)', () => {
  // Every command here is shadowed on PATH by a recorder, so a guard that failed to fire records the call instead of
  // running it (for rm, GNU rm's --preserve-root is the second line of defence).
  const ROOT_DELETE = 'rm -rf /';
  const denied = (r: RunResult, command: string) =>
    (resultEvent(r)?.permission_denials ?? []).some((d: any) => d.tool_name === 'Bash' && d.tool_input?.command === command);

  it('the root delete is denied with ruflo’s reason and never executes', async () => {
    const r = await run({ prompt: 'Clean up the disk.', allowedTools: ['Bash'], shadow: ['rm'], script: [bash(ROOT_DELETE), say('stopped')] });
    expect(r.exitCode, describeRun(r)).toBe(0);
    expect(r.shadowed(), 'rm ran: the guard did not deny it').toEqual([]);
    // The engine hands the denial back to the model as the tool result of the call.
    expect(r.scripted.length).toBe(2);
    expect(lastUserText(r.scripted[1]!.body)).toContain('ruflo: dangerous command blocked');
    expect(denied(r, ROOT_DELETE)).toBe(true);
  });

  it('control: without ruflo-mods the engine refuses the root delete on its own, with its own reason', async () => {
    // Claude Code refuses this one itself, so the contract above checks ruflo's reason, not just "some refusal". A
    // version bump that drops the engine's own refusal shows up here.
    const r = await run({ prompt: 'Clean up the disk.', allowedTools: ['Bash'], shadow: ['rm'], script: [bash(ROOT_DELETE), say('stopped')], pluginDir: null });
    expect(r.exitCode, describeRun(r)).toBe(0);
    expect(r.shadowed()).toEqual([]);
    expect(lastUserText(r.scripted[1]!.body)).not.toContain('ruflo:');
    expect(denied(r, ROOT_DELETE)).toBe(true);
  });

  // A command on ruflo's list that the engine allows: the run where the mod's tightening is the only thing that stops it.
  const FORMAT = 'format c:';

  it('a listed command the engine would allow is denied by ruflo and never executes', async () => {
    const r = await run({ prompt: 'Format the drive.', allowedTools: ['Bash'], shadow: ['format'], script: [bash(FORMAT), say('stopped')] });
    expect(r.exitCode, describeRun(r)).toBe(0);
    expect(r.shadowed(), 'format ran: the guard did not deny it').toEqual([]);
    expect(lastUserText(r.scripted[1]!.body)).toContain('ruflo: dangerous command blocked (format c:)');
    expect(denied(r, FORMAT)).toBe(true);
  });

  it('negative control: without ruflo-mods the engine runs that allowed call (the recorder catches it)', async () => {
    const r = await run({ prompt: 'Format the drive.', allowedTools: ['Bash'], shadow: ['format'], script: [bash(FORMAT), say('stopped')], pluginDir: null });
    expect(r.exitCode, describeRun(r)).toBe(0);
    expect(r.shadowed()).toEqual(['format c:']);
    expect(denied(r, FORMAT)).toBe(false);
  });
});

describe('real binary: the route block reaches the model (contract 5)', () => {
  it('the routing recommendation for the prompt is in the request', async () => {
    const prompt = 'Write unit tests for the payment module.';
    const r = await run({ prompt, script: [say('ok')] });
    expect(r.exitCode, describeRun(r)).toBe(0);
    const text = requestText(r.scripted[0]!.body);
    expect(text).toContain(`[INFO] Routing task: ${prompt}`);
    expect(text).toContain('Primary Recommendation');
    expect(text).toMatch(/\| Agent: [a-z-]+/);
  });

  it('negative control: outside a ruflo-mods run no route block is added', async () => {
    const r = await run({ prompt: 'Write unit tests for the payment module.', script: [say('ok')], pluginDir: null });
    expect(requestText(r.scripted[0]!.body)).not.toContain('Primary Recommendation');
  });
});
