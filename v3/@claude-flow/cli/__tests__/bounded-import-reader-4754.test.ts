import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fstatSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const state = vi.hoisted(() => ({ reportedSize: undefined as number | undefined, fd: -1 }));
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, fstatSync: (fd: number) => {
    state.fd = fd;
    const stat = actual.fstatSync(fd);
    if (state.reportedSize !== undefined) stat.size = state.reportedSize;
    return stat;
  } };
});
import { MAX_IMPORT_BYTES, readImportFile } from '../src/mcp-tools/import-limits.js';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'ruflo-reader-'));
  state.reportedSize = undefined;
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

it('accepts the exact byte limit and rejects one byte more, closing both descriptors', () => {
  const file = join(directory, 'input');
  writeFileSync(file, '');
  truncateSync(file, MAX_IMPORT_BYTES);
  expect(readImportFile(file)).toHaveLength(MAX_IMPORT_BYTES);
  expect(() => fstatSync(state.fd)).toThrow();
  truncateSync(file, MAX_IMPORT_BYTES + 1);
  expect(() => readImportFile(file)).toThrow(/limit/);
  expect(() => fstatSync(state.fd)).toThrow();
});

it('rejects a file that grows past the size observed on the descriptor', () => {
  const file = join(directory, 'growing');
  writeFileSync(file, 'grown');
  state.reportedSize = 1;
  expect(() => readImportFile(file)).toThrow(/changed size/);
  expect(() => fstatSync(state.fd)).toThrow();
});

it.skipIf(process.platform === 'win32')('rejects FIFO input without waiting for a writer', () => {
  const fifo = join(directory, 'fifo');
  execFileSync('mkfifo', [fifo]);
  const reader = new URL('../src/mcp-tools/import-limits.ts', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e',
    `import { readImportFile } from ${JSON.stringify(reader)}; readImportFile(${JSON.stringify(fifo)});`],
    // Resolve tsx from this package: the root vitest runs from v3/, where it is not hoisted.
    { encoding: 'utf8', timeout: 2000, cwd: fileURLToPath(new URL('..', import.meta.url)) });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/regular file/);
});
