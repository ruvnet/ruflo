/** Regression coverage for issue #4743: pre-bash blocks when it cannot read
 * a command (late stdin, unparsable input, a thrown error), while the other
 * hooks keep exiting 0 on the same input. */
import { afterAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HELPER = path.resolve(__dirname, '../.claude/helpers/hook-handler.cjs');
const project = mkdtempSync(path.join(tmpdir(), 'ruflo-4743-'));
const env = { ...process.env, CLAUDE_PROJECT_DIR: project, RUFLO_MODS_OWNS: '', PROMPT: '', TOOL_INPUT_command: '' };

afterAll(() => rmSync(project, { recursive: true, force: true }));

function run(hook: string, input: string) {
  return spawnSync(process.execPath, [HELPER, hook], { input, encoding: 'utf8', cwd: project, env, timeout: 10_000 });
}

describe('pre-bash fails closed — issue #4743', () => {
  it.each([
    ['empty payload', '{}'],
    ['null command', JSON.stringify({ tool_input: { command: null } })],
    ['object command', JSON.stringify({ tool_input: { command: {} } })],
    ['blank command', JSON.stringify({ tool_input: { command: '   ' } })],
    ['unparsable input', '{"tool_input":{"command":"rm -rf /"'],
    ['input that throws in main', 'null'],
  ])('blocks on %s', (_name, input) => {
    const r = run('pre-bash', input);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('[BLOCKED]');
    expect(r.stdout).not.toContain('[OK]');
  });

  it('blocks when the input arrives after the stdin window', async () => {
    const child = spawn(process.execPath, [HELPER, 'pre-bash'], { cwd: project, env });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const status = await new Promise<number | null>((resolve) => {
      child.on('close', resolve);
      setTimeout(() => {
        if (child.stdin.writable) child.stdin.end(JSON.stringify({ tool_input: { command: 'rm -rf /' } }));
      }, 900);
    });
    expect(status).toBe(2);
    expect(stderr).toContain('[BLOCKED]');
  });

  function runLate(command: string, delayMs: number) {
    const child = spawn(process.execPath, [HELPER, 'pre-bash'], { cwd: project, env });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    return new Promise<{ status: number | null; stderr: string }>((resolve) => {
      child.on('close', (status) => resolve({ status, stderr }));
      setTimeout(() => {
        if (child.stdin.writable) child.stdin.end(JSON.stringify({ tool_input: { command } }));
      }, delayMs);
    });
  }

  it('still validates a safe command that arrives within the pre-bash window', async () => {
    expect((await runLate('ls -la', 900)).status).toBe(0);
  });

  it('blocks when no input arrives within the pre-bash window', async () => {
    const r = await runLate('ls -la', 3600);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('[BLOCKED]');
  }, 15_000);

  it('still validates a safe command and blocks a dangerous one', () => {
    expect(run('pre-bash', JSON.stringify({ tool_input: { command: 'ls -la' } })).status).toBe(0);
    expect(run('pre-bash', JSON.stringify({ tool_input: { command: 'rm -rf /' } })).status).toBe(2);
  });

  it.each([
    ['route', 'null'],
    ['post-edit', '{"tool_input":'],
  ])('%s stays non-blocking on bad input', (hook, input) => {
    const r = run(hook, input);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('[BLOCKED]');
  });
});
