/** Regression coverage for issue #5166.
 *
 * 1. pre-bash read the command from `prompt`, which falls back to
 *    process.env.PROMPT. cmd.exe always sets PROMPT=$P$G, so with a cmd
 *    environment an empty or command-less payload validated "$p$g" and exited
 *    0, defeating the #4743 fail-closed gate. (issue-4743's own test blanks
 *    PROMPT, which is why it never showed.)
 * 2. Wiping or formatting a whole Windows drive was not detected.
 *
 * Only hook helpers run; every command string below is inert stdin JSON data. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateHookHandler } from '../src/init/helpers-generator';
import { dangerousCommandVerdict } from '../../../../plugins/ruflo-mods/hooks/guard/dangerous-command';

const SHIPPED = [
  path.resolve(__dirname, '../.claude/helpers/hook-handler.cjs'),
  path.resolve(__dirname, '../../../../.claude/helpers/hook-handler.cjs'),
];
let project: string;
let fallback: string;

beforeAll(() => {
  project = mkdtempSync(path.join(tmpdir(), 'ruflo-5166-'));
  fallback = path.join(project, 'hook-handler.cjs');
  writeFileSync(fallback, generateHookHandler());
});
afterAll(() => rmSync(project, { recursive: true, force: true }));

function preBash(helper: string, input: string, extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [helper, 'pre-bash'], {
    input, cwd: project, encoding: 'utf8', timeout: 10_000,
    env: { PATH: process.env.PATH, HOME: project, CI: '1', CLAUDE_PROJECT_DIR: project, RUFLO_MODS_OWNS: '', ...extraEnv },
  });
}
const bash = (command: string) => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });

describe('pre-bash ignores the PROMPT / TOOL_INPUT_command environment — issue #5166', () => {
  const cmdEnv = { PROMPT: '$P$G' };
  it.each(SHIPPED.map((h) => [path.relative(path.resolve(__dirname, '../../../..'), h), h]))(
    '%s still fails closed under a cmd.exe environment', (_name, helper) => {
      for (const input of ['', '{}', JSON.stringify({ tool_input: {} }), JSON.stringify({ tool_input: { command: '   ' } })]) {
        const r = preBash(helper, input, cmdEnv);
        expect(r.status, `${JSON.stringify(input)}: ${r.stderr}`).toBe(2);
        expect(r.stderr).toContain('[BLOCKED]');
        expect(r.stdout).not.toContain('[OK]');
      }
      expect(preBash(helper, '{}', { TOOL_INPUT_command: 'ls' }).status).toBe(2);
      expect(preBash(helper, bash('ls -la'), cmdEnv).status).toBe(0);
    });

  it('the inline fallback does not validate PROMPT instead of the payload', () => {
    const r = preBash(fallback, '{}', { PROMPT: 'format c:' });
    expect(r.stderr).not.toContain('[BLOCKED]');
    expect(r.status).toBe(0);
  });
});

describe('Windows drive wipe — mod, shipped helpers and fallback agree (#5166)', () => {
  const cases: Array<[string, boolean]> = [
    // drive roots: blocked
    ['Remove-Item -Recurse -Force C:\\', true],
    ['Remove-Item C:\\ -Recurse', true],
    ['Remove-Item -Path "D:\\" -Recurse -Force', true],
    ["Remove-Item -LiteralPath 'e:/' -Recurse", true],
    ['ri -r -fo C:\\*', true],
    ['rm -r c:/', true],
    ['Get-Date; Remove-Item -Recurse C:/', true],
    ['(Remove-Item -Rec C:)', true],
    ['rd /s /q c:\\', true],
    ['rd c:\\ /s /q', true],
    ['rmdir /s /q C:\\', true],
    ['RMDIR /Q /S D:', true],
    ['format d:', true],
    ['format.com C: /q', true],
    ['echo x && format e: /fs:ntfs', true],
    // below the root, or not a wipe: allowed
    ['Remove-Item -Recurse -Force .\\build', false],
    ['Remove-Item -Recurse C:\\temp\\cache', false],
    ['Remove-Item -Recurse "C:\\Users\\me\\AppData\\Local\\Temp\\x"', false],
    ['Remove-Item C:\\file.txt', false],
    ['Remove-Item -Force D:\\', false],
    ['rd /s /q C:\\projects\\old', false],
    ['rd C:\\empty', false],
    ['rmdir /s /q node_modules', false],
    ['Get-Process | Format-Table -AutoSize', false],
    ['Get-ChildItem C:\\ | Format-List', false],
    ['git log --format=%H -3', false],
    ['dir C:\\', false],
    ['Remove-Item -Recurse $env:TEMP\\ruflo', false],
  ];
  it.each(cases)('%j: denied=%s', (command, denied) => {
    expect(dangerousCommandVerdict('Bash', { command })?.decision === 'deny').toBe(denied);
    for (const helper of [...SHIPPED, fallback]) {
      const r = preBash(helper, bash(command));
      expect(r.error, helper).toBeUndefined();
      expect(r.status, `${helper}: ${r.stderr}`).toBe(denied ? 2 : 0);
      expect(denied ? r.stderr : r.stdout).toContain(denied ? '[BLOCKED]' : '[OK] Command validated');
    }
  });
});
