/**
 * Codex reads a hook's stdout as hook JSON when it starts with `{` or `[`, so
 * the hook handler's `[INFO] Routing task` / `[OK] Edit recorded` reports made
 * every UserPromptSubmit and PostToolUse fail with "invalid user prompt submit
 * JSON output". Under a Codex payload (it carries `turn_id`, #3163) stdout must
 * be one hook JSON object (additionalContext for UserPromptSubmit and
 * SessionStart) or empty; Claude Code payloads keep the plain report.
 *
 * Runs the packaged helper, the repo's dogfood copy and the generated fallback.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateHookHandler } from '../src/init/helpers-generator.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageHandler = resolve(here, '../.claude/helpers/hook-handler.cjs');
const dogfoodHandler = resolve(here, '../../../../.claude/helpers/hook-handler.cjs');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'ruflo-codex-hook-')));
  tempRoots.push(root);
  return root;
}

function generatedHandler(): string {
  const dir = join(tempDir(), '.claude', 'helpers');
  fs.mkdirSync(dir, { recursive: true });
  const file = join(dir, 'hook-handler.cjs');
  fs.writeFileSync(file, generateHookHandler());
  return file;
}

function run(handler: string, command: string, payload: Record<string, unknown>) {
  const project = tempDir();
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: project, HOME: tempDir(), RUFLO_DISABLE_HOOK_DEDUP: '1', RUFLO_FUNNEL: '0' };
  delete env.RUFLO_MODS_OWNS;
  const res = spawnSync(process.execPath, [handler, command], {
    input: JSON.stringify(payload), cwd: project, encoding: 'utf8', timeout: 20_000, env,
  });
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

const codex = (event: string) => ({
  session_id: 's', turn_id: 't-1', cwd: '/tmp', hook_event_name: event, model: 'm',
  prompt: 'fix the login bug', tool_name: 'Edit', tool_input: { file_path: '/tmp/x.ts' },
});
const claude = (event: string) => ({
  session_id: 's', cwd: '/tmp', hook_event_name: event,
  prompt: 'fix the login bug', tool_name: 'Edit', tool_input: { file_path: '/tmp/x.ts' },
});

const handlers: Array<[string, () => string]> = [
  ['packaged helper', () => packageHandler],
  ['dogfood helper', () => dogfoodHandler],
  ['generated fallback', generatedHandler],
];

describe.each(handlers)('hook-handler.cjs under Codex (%s)', (_name, handlerOf) => {
  it('UserPromptSubmit stdout is one hook JSON object carrying the routing report as context', () => {
    const { code, stdout } = run(handlerOf(), 'route', codex('UserPromptSubmit'));
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    // The generated fallback has no router beside it in a bare project, so it reports that instead.
    expect(parsed.hookSpecificOutput.additionalContext).toMatch(/Routing task: fix the login bug|Router not available/);
  });

  it('PostToolUse and Stop-like events leave stdout empty and report on stderr', () => {
    for (const [command, event] of [['post-edit', 'PostToolUse'], ['post-task', 'SubagentStop']]) {
      const { code, stdout } = run(handlerOf(), command, codex(event));
      expect(code, command).toBe(0);
      expect(stdout, command).toBe('');
    }
  });

  it('a Claude Code payload keeps the plain report on stdout', () => {
    const { code, stdout } = run(handlerOf(), 'route', claude('UserPromptSubmit'));
    expect(code).toBe(0);
    expect(stdout).toMatch(/^\[INFO\] (Routing task: fix the login bug|Router not available)/m);
  });
});
