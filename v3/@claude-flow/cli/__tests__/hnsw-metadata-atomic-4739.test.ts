/** #4739: metadata writes must publish a complete image and report failures. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const state = vi.hoisted(() => ({
  failure: undefined as unknown,
  swaps: [] as Array<{ previous: string; next: string }>,
}));

// Only the vector engine is stubbed; persistence uses the real atomic helper
// and filesystem, with a failure injected at the final publication boundary.
// The package config (cli/vitest.config.ts) externalizes @ruvector/*, and Vite
// exposes those dynamic imports under /@id/; the workspace config (v3/
// vitest.config.ts, used by CI's "Test V3 Packages") does not, so the import
// resolves as the bare specifier. Register the same stub under both IDs.
const ruvectorCoreStub = vi.hoisted(() => () => ({
  default: {
    VectorDb: class {
      async len() { return 0; }
      async insert() {}
    },
  },
}));
vi.mock('/@id/@ruvector/core', ruvectorCoreStub);
vi.mock('@ruvector/core', ruvectorCoreStub);

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: vi.fn((from: string, to: string) => {
      if (basename(to) === 'hnsw.metadata.json') {
        state.swaps.push({
          previous: actual.readFileSync(to, 'utf8'),
          next: actual.readFileSync(from, 'utf8'),
        });
        if (state.failure !== undefined) throw state.failure;
      }
      actual.renameSync(from, to);
    }),
  };
});

import * as memory from '../src/memory/memory-initializer.js';

describe('HNSW metadata persistence (#4739)', () => {
  let root: string;
  let metadataPath: string;
  const entry = { id: 'vector-1', key: 'policy', namespace: 'patterns', content: 'memory 世界 🌱' };
  const previous = '[]\n' + ' '.repeat(64);

  beforeEach(() => {
    root = fs.mkdtempSync(join(tmpdir(), 'ruflo-hnsw-4739-'));
    metadataPath = join(root, 'hnsw.metadata.json');
    fs.writeFileSync(metadataPath, previous);
    vi.stubEnv('CLAUDE_FLOW_MEMORY_PATH', root);
    vi.stubEnv('CLAUDE_FLOW_DISABLE_BRIDGE', '1');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    memory.clearHNSWIndex();
    memory._resetMemoryRootCache();
    state.failure = undefined;
    state.swaps = [];
  });

  afterEach(() => {
    memory.clearHNSWIndex();
    memory._resetMemoryRootCache();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('atomically replaces the old image with complete UTF-8 metadata that reloads', async () => {
    expect(await memory.addToHNSWIndex(entry.id, [1, 0, 0], entry)).toBe(true);

    const serialized = JSON.stringify([[entry.id, entry]]);
    expect(fs.readFileSync(metadataPath, 'utf8')).toBe(serialized);
    // Before rename, readers still see the old complete image while the new
    // complete image is in a separate sibling file.
    expect(state.swaps).toEqual([{ previous, next: serialized }]);
    expect(fs.readdirSync(root)).toEqual(['hnsw.metadata.json']);
    if (process.platform !== 'win32') {
      expect(fs.statSync(metadataPath).mode & 0o777).toBe(0o600);
    }
    expect(console.warn).not.toHaveBeenCalled();

    memory.clearHNSWIndex();
    const reloaded = await memory.getHNSWIndex({ dimensions: 3 });
    expect(reloaded?.entries.get(entry.id)).toEqual(entry);
  });

  it.each([
    new Error('ENOSPC: no space left on device'),
    'EACCES: permission denied',
  ])('reports a failed atomic swap and preserves the previous image (%s)', async (failure) => {
    state.failure = failure;

    // Metadata is best-effort: the vector insertion still succeeds in memory.
    expect(await memory.addToHNSWIndex(entry.id, [1, 0, 0], entry)).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      '[memory] Failed to save hnsw.metadata.json:',
      failure instanceof Error ? failure.message : String(failure),
    );
    expect(state.swaps).toHaveLength(1);
    expect(fs.readFileSync(metadataPath, 'utf8')).toBe(previous);
    expect(fs.readdirSync(root)).toEqual(['hnsw.metadata.json']);
    expect((await memory.getHNSWIndex())?.entries.get(entry.id)).toEqual(entry);
  });

  it('reports a missing parent directory without throwing or recreating it', async () => {
    expect(await memory.getHNSWIndex({ dimensions: 3 })).not.toBeNull();
    fs.rmSync(root, { recursive: true });

    expect(await memory.addToHNSWIndex(entry.id, [1, 0, 0], entry)).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      '[memory] Failed to save hnsw.metadata.json:',
      expect.stringContaining('ENOENT'),
    );
    expect(fs.existsSync(root)).toBe(false);
  });
});
