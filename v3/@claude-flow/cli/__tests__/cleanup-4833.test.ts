import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/output.js', () => ({ output: new Proxy({}, {
  get: (_target, name) => name === 'writeln' ? () => {} : (value: unknown) => value,
}) }));
import { cleanupCommand } from '../src/commands/cleanup.js';
import { CommandParser } from '../src/parser.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cleanup-4833-'));
  mkdirSync(join(root, '.claude-flow'), { recursive: true });
  writeFileSync(join(root, '.claude-flow', 'config.json'), '{}\n');
  mkdirSync(join(root, '.claude'), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function cleanup(): Promise<void> {
  const parser = new CommandParser();
  parser.registerCommand(cleanupCommand);
  const { flags } = parser.parse(['cleanup', '--force']);
  const result = await cleanupCommand.action!({ args: [], flags, cwd: root, interactive: false });
  expect(result?.success).toBe(true);
  // The unambiguously ruflo-owned directory always goes.
  expect(existsSync(join(root, '.claude-flow'))).toBe(false);
}

const settingsPath = () => join(root, '.claude', 'settings.json');
const settings = () => JSON.parse(readFileSync(settingsPath(), 'utf-8'));

describe('cleanup --force keeps what the project owns (issue #4833)', () => {
  it('leaves a project\'s own data/ and memory/ folders alone', async () => {
    mkdirSync(join(root, 'data', 'reports'), { recursive: true });
    writeFileSync(join(root, 'data', 'reports', 'sales.csv'), 'mine\n');
    mkdirSync(join(root, 'memory', 'notes'), { recursive: true });
    writeFileSync(join(root, 'memory', 'notes', 'todo.md'), 'mine\n');

    await cleanup();

    expect(existsSync(join(root, 'data', 'reports', 'sales.csv'))).toBe(true);
    expect(existsSync(join(root, 'memory', 'notes', 'todo.md'))).toBe(true);
  });

  it('still removes a data/ or memory/ folder that holds ruflo\'s own store', async () => {
    mkdirSync(join(root, 'data', 'memory'), { recursive: true });
    writeFileSync(join(root, 'data', 'memory', 'memory.db'), 'ruflo\n');
    mkdirSync(join(root, 'memory'), { recursive: true });
    writeFileSync(join(root, 'memory', 'memory.db'), 'ruflo\n');

    await cleanup();

    expect(existsSync(join(root, 'data'))).toBe(false);
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('removes ruflo\'s hook entries and keeps every hook the user wrote', async () => {
    writeFileSync(settingsPath(), JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo user-stop' }] }],
        PreToolUse: [{
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/helpers/hook-handler.cjs" pre-bash' },
            { type: 'command', command: 'echo user-pre' },
          ],
        }],
        PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'npx claude-flow@alpha hooks post-edit' }] }],
      },
      claudeFlow: { enabled: true },
      env: { KEEP: '1' },
    }, null, 2));

    await cleanup();

    expect(settings()).toEqual({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo user-stop' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-pre' }] }],
      },
      env: { KEEP: '1' },
    });
  });

  it('drops the hooks key when every entry in it was ruflo\'s', async () => {
    writeFileSync(settingsPath(), JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node .claude/helpers/auto-memory-hook.mjs import' }] }] },
      claudeFlow: { enabled: true },
    }, null, 2));

    await cleanup();

    expect(settings()).toEqual({});
  });
});
