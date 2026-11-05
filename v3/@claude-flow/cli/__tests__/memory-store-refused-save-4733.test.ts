/**
 * ruvnet/ruflo#4733 — `memory store` must not report success for a write the
 * sql.js fallback could not save.
 *
 * Runs real CLI processes in parallel against one project directory. Each
 * process must either exit 0 with its row retrievable, or exit non-zero with a
 * message saying the write was not saved.
 */
import { describe, it, expect } from 'vitest';
import { execFile } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
const PARALLEL_STORES = 8;

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], projectDir: string): Promise<CliRun> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd: projectDir, env: { ...process.env, CLAUDE_FLOW_CWD: projectDir }, timeout: 120_000 },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

describe('memory store with a refused sql.js save (#4733)', () => {
  it(`never reports success for a row that did not persist (${PARALLEL_STORES} parallel stores)`, async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'ruflo-4733-'));
    const namespace = 'refused-save';
    try {
      const keys = Array.from({ length: PARALLEL_STORES }, (_, i) => `k${i}`);
      const stores = await Promise.all(
        keys.map((key) =>
          runCli(['memory', 'store', '--key', key, '--value', `v-${key}`, '--namespace', namespace], projectDir),
        ),
      );

      for (const [i, run] of stores.entries()) {
        const key = keys[i];
        if (run.code === 0) {
          const retrieved = await runCli(['memory', 'retrieve', '--key', key, '--namespace', namespace], projectDir);
          expect(retrieved.stdout, `exit 0 for ${key} but the row is not retrievable`).toContain(`v-${key}`);
        } else {
          expect(run.code).toBe(1);
          expect(run.stderr, `non-zero exit for ${key} must explain the lost write`).toMatch(/not saved/i);
        }
      }
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  }, 300_000);
});
