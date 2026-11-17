import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
const neural = embeddingsTools.find(tool => tool.name === 'embeddings_neural')!;

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

describe('embeddings_neural init', () => {
  it('honours an explicit 0 for decayRate and driftThreshold', async () => {
    const result = await neural.handler({ action: 'init', decayRate: 0, driftThreshold: 0 }) as any;
    expect(result.success).toBe(true);
    expect(result.neural.decayRate).toBe(0);
    expect(result.neural.driftThreshold).toBe(0);
  });

  it('persists the 0 values to the embeddings config', async () => {
    await neural.handler({ action: 'init', decayRate: 0, driftThreshold: 0 });
    const saved = JSON.parse(readFileSync(join(workdir, '.claude-flow', 'embeddings.json'), 'utf-8'));
    expect(saved.neural.decayRate).toBe(0);
    expect(saved.neural.driftThreshold).toBe(0);
  });

  it('still defaults to 0.3 and 0.01 when the values are omitted', async () => {
    const result = await neural.handler({ action: 'init' }) as any;
    expect(result.neural.driftThreshold).toBe(0.3);
    expect(result.neural.decayRate).toBe(0.01);
  });

  it('keeps non-zero values as given', async () => {
    const result = await neural.handler({ action: 'init', decayRate: 0.05, driftThreshold: 0.7 }) as any;
    expect(result.neural.decayRate).toBe(0.05);
    expect(result.neural.driftThreshold).toBe(0.7);
  });
});
