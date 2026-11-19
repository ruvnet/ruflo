/**
 * Regression for #3163: Codex parses a Stop hook's stdout as hook JSON, so the
 * AutoMemory status prose made every Stop report "invalid stop hook JSON
 * output". Under a Codex payload (it carries `turn_id`) stdout must be empty
 * and the status must go to stderr; Claude Code payloads, terminal runs and
 * unparseable stdin keep the old stdout feedback.
 *
 * Runs the packaged helper, the repo's dogfood copy and the generated
 * fallback, each in a disposable project dir.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAutoMemoryHook } from '../src/init/helpers-generator.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageHook = resolve(here, '../.claude/helpers/auto-memory-hook.mjs');
const dogfoodHook = resolve(here, '../../../../.claude/helpers/auto-memory-hook.mjs');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'ruflo-3163-')));
  tempRoots.push(root);
  return root;
}

function fallbackHook(): string {
  const dir = join(tempDir(), '.claude', 'helpers');
  fs.mkdirSync(dir, { recursive: true });
  const file = join(dir, 'auto-memory-hook.mjs');
  fs.writeFileSync(file, generateAutoMemoryHook());
  return file;
}

function run(hook: string, command: string, input: string | null) {
  const project = tempDir();
  const res = spawnSync(process.execPath, [hook, command], {
    input: input ?? undefined,
    stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: project, HOME: tempDir() },
  });
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

const codexStop = (cwd = '/tmp') => JSON.stringify({
  session_id: 's', turn_id: 't-1', transcript_path: '/nonexistent', cwd,
  hook_event_name: 'Stop', model: 'm', permission_mode: 'default',
  stop_hook_active: false, last_assistant_message: 'hi',
});
const claudeStop = JSON.stringify({
  session_id: 's', transcript_path: '/nonexistent', cwd: '/tmp',
  hook_event_name: 'Stop', permission_mode: 'default', stop_hook_active: false,
});

const hooks: Array<[string, () => string]> = [
  ['packaged helper', () => packageHook],
  ['dogfood helper', () => dogfoodHook],
  ['generated fallback', fallbackHook],
];

describe.each(hooks)('#3163 %s', (_name, hookPath) => {
  it('keeps stdout empty under a Codex Stop payload and reports on stderr', () => {
    const r = run(hookPath(), 'sync', codexStop());
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr.trim()).not.toBe('');
  });

  it('keeps stdout empty for import under a Codex payload too', () => {
    const r = run(hookPath(), 'import', codexStop());
    expect(r.stdout).toBe('');
  });

  it('keeps Claude Code feedback on stdout', () => {
    const r = run(hookPath(), 'sync', claudeStop);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).not.toBe('');
  });

  it('keeps stdout feedback with no stdin or with unparseable stdin', () => {
    expect(run(hookPath(), 'sync', null).stdout.trim()).not.toBe('');
    expect(run(hookPath(), 'sync', 'not json').stdout.trim()).not.toBe('');
  });
});

it('#3163 the packaged and dogfood helpers stay byte-identical', () => {
  expect(fs.readFileSync(packageHook, 'utf8')).toBe(fs.readFileSync(dogfoodHook, 'utf8'));
});
