/**
 * #4404: session_save keyed its memory snapshot by `namespace + '::' + key`, so
 * (`team::alice`, `profile`) and (`team`, `alice::profile`) collided: one row
 * was dropped on save, and a distinct sibling-store row was skipped as a mirror.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));

import { memorySnapshotId, sessionTools } from '../src/mcp-tools/session-tools.js';
import {
  _resetMemoryRootCache, initializeMemoryDatabase, storeEntry, listEntries, purgeNamespace,
} from '../src/memory/memory-initializer.js';

const tool = (name: string, input: Record<string, unknown>): Promise<any> =>
  sessionTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const primary = () => join(state.cwd, '.swarm', 'memory.db');
const mirror = () => join(state.cwd, '.swarm', 'agentdb-memory.db');
const all = async (dbPath: string) =>
  (await listEntries({ dbPath, limit: 100, includeContent: true })).entries
    .map(e => `${e.namespace}|${e.key}=${e.content}`).sort();
const put = (dbPath: string, namespace: string, key: string, value: string) =>
  storeEntry({ dbPath, namespace, key, value, generateEmbeddingFlag: false });

beforeEach(async () => {
  state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-session-4404-'));
  const memDir = join(state.cwd, '.swarm');
  mkdirSync(memDir, { recursive: true });
  vi.stubEnv('CLAUDE_FLOW_MEMORY_PATH', memDir);
  vi.stubEnv('CLAUDE_FLOW_DB_PATH', '');
  vi.stubEnv('CLAUDE_FLOW_DISABLE_BRIDGE', '1');
  vi.stubEnv('CLAUDE_FLOW_ENCRYPT_AT_REST', '0');
  _resetMemoryRootCache();
  expect((await initializeMemoryDatabase({ dbPath: primary(), force: true, migrate: false })).success).toBe(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetMemoryRootCache();
  rmSync(state.cwd, { recursive: true, force: true });
});

describe('#4404 memorySnapshotId', () => {
  it('leaves ordinary IDs unchanged', () => {
    expect(memorySnapshotId('mcp', 'agent-note')).toBe('mcp::agent-note');
  });

  it('distinguishes tuples that a bare "::" join would merge', () => {
    expect(memorySnapshotId('team::alice', 'profile')).not.toBe(memorySnapshotId('team', 'alice::profile'));
    expect(memorySnapshotId('a:', ':b')).not.toBe(memorySnapshotId('a', '::b'));
    // An escaped-looking literal must not alias a real colon.
    expect(memorySnapshotId('a%3A', 'b')).not.toBe(memorySnapshotId('a:', 'b'));
  });
});

describe('#4404 session save/restore keeps tuples containing "::"', () => {
  it('saves and restores both colliding rows from the primary store', async () => {
    expect((await put(primary(), 'team::alice', 'profile', 'A')).success).toBe(true);
    expect((await put(primary(), 'team', 'alice::profile', 'B')).success).toBe(true);
    const before = await all(primary());
    expect(before).toHaveLength(2);

    const saved = await tool('session_save', { name: 'colons', includeMemory: true });
    expect(saved.memoryCapture).toMatchObject({ entries: 2, sources: { memoryDb: 2 } });
    const entries = JSON.parse(readFileSync(saved.path, 'utf-8')).data.memory.entries;
    expect(Object.values(entries).map((e: any) => `${e.namespace}|${e.key}=${e.value}`).sort()).toEqual(before);

    for (const ns of ['team::alice', 'team']) await purgeNamespace({ dbPath: primary(), namespace: ns });
    expect(await all(primary())).toHaveLength(0);

    const restored = await tool('session_restore', { sessionId: saved.sessionId });
    expect(restored.memoryRestore).toMatchObject({ restored: 2, failed: 0 });
    expect(await all(primary())).toEqual(before);
  });

  it('keeps a distinct sibling-store row instead of treating it as a mirror, and still dedups true mirrors', async () => {
    await put(primary(), 'team::alice', 'profile', 'A');
    expect((await initializeMemoryDatabase({ dbPath: mirror(), force: true, migrate: false })).success).toBe(true);
    await put(mirror(), 'team::alice', 'profile', 'A'); // real mirror of the primary row
    await put(mirror(), 'team', 'alice::profile', 'B'); // distinct tuple, sibling only

    const saved = await tool('session_save', { name: 'colons-sibling', includeMemory: true });
    expect(saved.memoryCapture).toMatchObject({ entries: 2, sources: { memoryDb: 1, agentdb: 1 } });
    const entries = Object.values(JSON.parse(readFileSync(saved.path, 'utf-8')).data.memory.entries) as any[];
    expect(entries.map(e => `${e.namespace}|${e.key}=${e.value}|${e.source}`).sort()).toEqual([
      'team::alice|profile=A|memory-db',
      'team|alice::profile=B|agentdb',
    ]);
  });
});
