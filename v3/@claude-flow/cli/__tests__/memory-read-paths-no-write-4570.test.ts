/**
 * #4570: on the sql.js fallback, memory_search / memory_list /
 * memory_search_unified must not rewrite memory.db. A rewrite goes through a
 * temp file + rename, so a reader replaced the file (new inode) and a process
 * holding the old inode lost its writes; read-only deployments were impossible.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getProjectCwd: () => state.cwd,
}));

import {
  _resetMemoryRootCache, initializeMemoryDatabase, storeEntry, searchEntries, listEntries, resolveDbPath,
} from '../src/memory/memory-initializer.js';
import { memoryTools } from '../src/mcp-tools/memory-tools.js';

const tool = (name: string, input: Record<string, unknown>): Promise<any> =>
  memoryTools.find(t => t.name === name)!.handler(input) as Promise<any>;

const fingerprint = (p: string) => {
  const s = statSync(p);
  return { ino: s.ino, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, size: s.size };
};

let dbPath = '';

beforeEach(async () => {
  state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-4570-'));
  const memDir = join(state.cwd, '.swarm');
  mkdirSync(memDir, { recursive: true });
  vi.stubEnv('CLAUDE_FLOW_MEMORY_PATH', memDir);
  vi.stubEnv('CLAUDE_FLOW_DB_PATH', '');
  vi.stubEnv('CLAUDE_FLOW_DISABLE_BRIDGE', '1');
  vi.stubEnv('CLAUDE_FLOW_ENCRYPT_AT_REST', '0');
  _resetMemoryRootCache();
  dbPath = resolveDbPath();
  await initializeMemoryDatabase({ dbPath, force: true, verbose: false } as never);
  const stored = await storeEntry({ key: 'probe', value: 'read paths must not write', namespace: 'default', dbPath });
  expect(stored.success).toBe(true);
  // Let the clock tick so a rewrite would be visible in mtime as well as inode.
  await new Promise(r => setTimeout(r, 30));
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetMemoryRootCache();
  rmSync(state.cwd, { recursive: true, force: true });
});

describe('#4570 sql.js read paths leave memory.db untouched', () => {
  it('searchEntries and listEntries do not rewrite the file', async () => {
    const before = fingerprint(dbPath);
    const search = await searchEntries({ query: 'read paths', limit: 5, dbPath });
    expect(search.success).toBe(true);
    const list = await listEntries({ limit: 5, dbPath });
    expect(list.success).toBe(true);
    expect(list.entries.map(e => e.key)).toContain('probe');
    expect(fingerprint(dbPath)).toEqual(before);
  });

  it('memory_search, memory_list and memory_search_unified do not rewrite the file', async () => {
    const before = fingerprint(dbPath);
    await tool('memory_search', { query: 'read paths', limit: 5 });
    const listed = await tool('memory_list', { limit: 5 });
    expect(JSON.stringify(listed)).toContain('probe');
    await tool('memory_search_unified', { query: 'read paths', limit: 5 });
    expect(fingerprint(dbPath)).toEqual(before);
  });

  it('a write still changes the file (positive control)', async () => {
    const before = fingerprint(dbPath);
    await storeEntry({ key: 'probe-2', value: 'second row', namespace: 'default', dbPath });
    expect(fingerprint(dbPath)).not.toEqual(before);
  });
});
