import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const searchEntries = vi.fn(async () => ({ results: [] }));

vi.mock('../src/memory/memory-initializer.js', () => ({
  generateEmbedding: vi.fn(async (text: string) => ({
    embedding: Array.from({ length: 8 }, (_, i) => Math.sin(text.length + i)),
    dimensions: 8,
    model: 'hash-fallback',
    backend: 'mock',
  })),
  searchEntries,
}));

const { embeddingsTools } = await import('../src/mcp-tools/embeddings-tools.js');
const init = embeddingsTools.find(tool => tool.name === 'embeddings_init')!;
const search = embeddingsTools.find(tool => tool.name === 'embeddings_search')!;

let originalCwd: string;
let workdir: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  workdir = mkdtempSync(join(tmpdir(), 'ruflo-embeddings-threshold-'));
  process.chdir(workdir);
  await init.handler({ force: true });
  searchEntries.mockClear();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workdir, { recursive: true, force: true });
});

describe('embeddings_search threshold', () => {
  it('passes an explicit threshold of 0 through instead of the 0.5 default', async () => {
    const result = await search.handler({ query: 'release notes', threshold: 0 }) as any;
    expect(searchEntries).toHaveBeenCalledWith(expect.objectContaining({ threshold: 0 }));
    expect(result.metadata.threshold).toBe(0);
  });

  it('still defaults to 0.5 when no threshold is given', async () => {
    const result = await search.handler({ query: 'release notes' }) as any;
    expect(searchEntries).toHaveBeenCalledWith(expect.objectContaining({ threshold: 0.5 }));
    expect(result.metadata.threshold).toBe(0.5);
  });
});
