/** Regression coverage for issue #4745: the statusline never passes the
 * checkout path through a shell, and never prints control characters taken
 * from directory or git names. */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateStatuslineScript } from '../src/init/statusline-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';

const SCRIPT = generateStatuslineScript(DEFAULT_INIT_OPTIONS);

function findSqlite3(): string | null {
  if (process.platform === 'win32') return null;
  try {
    return execFileSync('sh', ['-c', 'command -v sqlite3'], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

const SQLITE3 = findSqlite3();

function withProject(dirName: string, fn: (cwd: string, script: string, home: string) => void): void {
  const parent = mkdtempSync(path.join(tmpdir(), 'ruflo-4745-'));
  const cwd = path.join(parent, dirName);
  const script = path.join(parent, 'statusline.cjs');
  mkdirSync(cwd);
  writeFileSync(script, SCRIPT, 'utf8');
  try {
    fn(cwd, script, parent);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

describe('statusline untrusted names — issue #4745', () => {
  it.skipIf(!SQLITE3)('reads memory.db through sqlite3 without a shell when the path has quotes', () => {
    withProject("a'$(touch pwned)'b", (cwd, script, home) => {
      const dbDir = path.join(cwd, '.swarm');
      mkdirSync(dbDir);
      execFileSync(SQLITE3!, [
        path.join(dbDir, 'memory.db'),
        "CREATE TABLE memory_entries (embedding BLOB); INSERT INTO memory_entries VALUES (x'00'), (x'01'), (NULL);",
      ]);
      const output = execFileSync(process.execPath, [script, '--json'], {
        cwd,
        input: '{}',
        encoding: 'utf8',
        env: { PATH: path.dirname(SQLITE3!), HOME: home },
        timeout: 30_000,
      });
      expect(existsSync(path.join(cwd, 'pwned'))).toBe(false);
      expect(JSON.parse(output).agentdb.vectorCount).toBe(2);
    });
  });

  it.skipIf(process.platform === 'win32')('strips control and bidi characters from the project name', () => {
    withProject('proj‮\u001b]0;pwn\u0007x', (cwd, script, home) => {
      const output = execFileSync(process.execPath, [script], {
        cwd,
        input: JSON.stringify({ model: { display_name: 'Codex' } }),
        encoding: 'utf8',
        env: { PATH: '/nonexistent', HOME: home },
        timeout: 15_000,
      });
      expect(output).toContain('proj]0;pwnx');
      expect(output).not.toContain('\u0007');
      expect(output).not.toContain('‮');
      expect(output).not.toContain('\u001b]0;');
    });
  });
});
