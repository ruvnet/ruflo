import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

const state = vi.hoisted(() => ({
  root: '',
  storeEntry: vi.fn(async () => ({ success: true, id: 'stored' })),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true })),
}));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.root }));
vi.mock('os', async (original) => ({ ...await original<typeof import('os')>(), homedir: () => state.root }));
vi.mock('../src/memory/memory-initializer.js', () => ({
  storeEntry: state.storeEntry,
  checkMemoryInitialization: state.checkMemoryInitialization,
  initializeMemoryDatabase: vi.fn(),
  searchEntries: vi.fn(),
  listEntries: vi.fn(),
  getEntry: vi.fn(),
  deleteEntry: vi.fn(),
}));

import { memoryTools } from '../src/mcp-tools/memory-tools.js';
import { performanceTools } from '../src/mcp-tools/performance-tools.js';

const importer = memoryTools.find(tool => tool.name === 'memory_import_claude')!;
const benchmark = performanceTools.find(tool => tool.name === 'performance_benchmark')!;

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'ruflo-work-bounds-'));
  state.storeEntry.mockClear();
  state.checkMemoryInitialization.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(state.root, { recursive: true, force: true });
});

describe('memory import exclusion bounds (#4753)', () => {
  it.each([
    ['too many patterns', Array.from({ length: 65 }, () => '*.md')],
    ['an oversized pattern', ['x'.repeat(1025)]],
    ['too many wildcard operators', ['*x'.repeat(33)]],
    ['a non-string pattern', [null]],
    ['a non-array pattern list', '*.md'],
  ])('rejects %s before initializing or importing', async (_name, excludeFilePatterns) => {
    const result = await importer.handler({ allProjects: true, excludeFilePatterns });

    expect(result).toMatchObject({ success: false, imported: 0, error: expect.any(String) });
    expect(state.checkMemoryInitialization).not.toHaveBeenCalled();
    expect(state.storeEntry).not.toHaveBeenCalled();
  });

  it.each([
    ['**/voice-*.md', 'voice-main.md', true],
    ['**/voice-?.md', 'voice-a.md', true],
    ['**/voice-?.md', 'voice-ab.md', false],
    ['*.md', 'MEMORY.md', false],
    ['**/note[1].md', 'note1.md', false],
    ['**/note[1].md', 'note[1].md', true],
  ])('preserves exclusion %s for %s', async (pattern, file, excluded) => {
    const directory = join(state.root, '.claude', 'projects', 'test-project', 'memory');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, file), 'A project memory entry long enough to import.');

    const result = await importer.handler({ allProjects: true, excludeFilePatterns: [pattern.replaceAll('/', sep)] });

    expect(result).toMatchObject({ success: true, imported: excluded ? 0 : 1 });
    expect(state.storeEntry).toHaveBeenCalledTimes(excluded ? 0 : 1);
  });
});

describe('performance benchmark work bounds (#4753)', () => {
  it.each([0, -1, 1.5, NaN, Infinity, -Infinity, '100', null])('rejects invalid iterations %s', async (iterations) => {
    const parse = JSON.parse;
    let workloads = 0;
    vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
      if (typeof text === 'string' && text.startsWith('{"agents":') && ++workloads > 100) {
        throw new Error('Invalid benchmark input reached an unbounded workload');
      }
      return parse(text, reviver);
    });
    expect(await benchmark.handler({ suite: 'io', iterations, warmup: false })).toMatchObject({
      success: false,
      error: expect.any(String),
    });
    expect(existsSync(join(state.root, '.claude-flow'))).toBe(false);
  });

  it('caps a large request in both execution and the persisted result', async () => {
    const parse = JSON.parse;
    let workloads = 0;
    vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
      if (typeof text === 'string' && text.startsWith('{"agents":')) {
        workloads++;
        if (workloads > 10_000) throw new Error('Benchmark exceeded its work budget');
      }
      return parse(text, reviver);
    });

    expect(await benchmark.handler({ suite: 'io', iterations: 1e9, warmup: false })).toMatchObject({
      iterations: 10_000,
    });
    expect(workloads).toBe(10_000);
    const stored = parse(readFileSync(join(state.root, '.claude-flow', 'performance', 'metrics.json'), 'utf8'));
    expect(Object.values(stored.benchmarks)).toEqual([
      expect.objectContaining({ results: expect.objectContaining({ iterations: 10_000 }) }),
    ]);
  });

  it.each([undefined, 1, 3, 10_000])('keeps a valid request %s', async (iterations) => {
    expect(await benchmark.handler({ suite: 'io', iterations, warmup: false })).toMatchObject({
      iterations: iterations ?? 100,
    });
  });
});
