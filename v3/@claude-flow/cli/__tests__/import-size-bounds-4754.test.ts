import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const limit = 16 * 1024 * 1024;
const state = vi.hoisted(() => ({
  root: '',
  check: vi.fn(async () => ({ initialized: true })),
  store: vi.fn(async () => ({ success: true, id: 'saved' })),
}));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.root }));
vi.mock('../src/memory/memory-initializer.js', () => ({
  checkMemoryInitialization: state.check, storeEntry: state.store,
  initializeMemoryDatabase: vi.fn(), searchEntries: vi.fn(), listEntries: vi.fn(),
  getEntry: vi.fn(), deleteEntry: vi.fn(),
}));
import { sessionTools } from '../src/mcp-tools/session-tools.js';
import { memoryTools } from '../src/mcp-tools/memory-tools.js';
const sessions = sessionTools.find(tool => tool.name === 'session_import')!;
const memories = memoryTools.find(tool => tool.name === 'memory_import')!;

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'ruflo-import-limit-'));
  state.store.mockClear();
  state.check.mockClear();
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));

describe('file import bounds (#4754)', () => {
  it.each(['session', 'memory'])('rejects an oversized %s file before registration', async (kind) => {
    const inputPath = join(state.root, 'oversized.json');
    writeFileSync(inputPath, '{}');
    truncateSync(inputPath, limit + 1);

    const result = await (kind === 'session' ? sessions : memories).handler({ inputPath });

    expect(result).toMatchObject({ error: expect.stringMatching(/import.*limit|exceeds.*limit/i) });
    expect(existsSync(join(state.root, '.claude-flow', 'sessions'))).toBe(false);
    expect(state.store).not.toHaveBeenCalled();
    if (kind === 'memory') expect(state.check).not.toHaveBeenCalled();
  });

  it('bounds gzip output before parsing or saving a session', async () => {
    const inputPath = join(state.root, 'large.json.gz');
    writeFileSync(inputPath, gzipSync(JSON.stringify({ name: 'large', description: 'x'.repeat(limit) })));

    const result = await sessions.handler({ inputPath });

    expect(result).toMatchObject({ error: expect.stringMatching(/larger than|limit|size/i) });
    expect(existsSync(join(state.root, '.claude-flow', 'sessions'))).toBe(false);
  });

  it.each([false, true])('keeps valid session imports (gzip: %s)', async (gzip) => {
    const inputPath = join(state.root, gzip ? 'session.gz' : 'session.json');
    const payload = JSON.stringify({ name: 'valid', data: { tasks: { tasks: {} } } });
    writeFileSync(inputPath, gzip ? gzipSync(payload) : payload);

    expect(await sessions.handler({ inputPath })).toMatchObject({ name: 'valid', activated: false });
  });

  it('keeps valid memory imports', async () => {
    const inputPath = join(state.root, 'memory.json');
    writeFileSync(inputPath, JSON.stringify({ entries: [{ key: 'safe', value: 'retained' }] }));

    expect(await memories.handler({ inputPath })).toMatchObject({ success: true, imported: { entries: 1 } });
    expect(state.store).toHaveBeenCalledWith(expect.objectContaining({ key: 'safe', value: 'retained' }));
  });
});
