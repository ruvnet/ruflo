import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTargetCommand } from '../src/command-resolution.js';
import { guidanceCommand } from '../src/commands/guidance.js';
import { output } from '../src/output.js';
import { CommandParser } from '../src/parser.js';
import type { ParsedFlags } from '../src/types.js';

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  readFile: vi.fn(async (path: string) => `Contents of ${path}`),
  retrieve: vi.fn(async () => ({ shards: [] })),
  optimizeForSize: vi.fn(() => ({
    benchmark: { after: { compositeScore: 45 }, delta: 5 },
    appliedSteps: [],
  })),
  abBenchmark: vi.fn(async () => ({
    configA: { metrics: {}, taskResults: [] },
    configB: { metrics: {}, taskResults: [] },
  })),
  readModGuidanceSources: vi.fn(async () => ({
    rootContent: 'Verified guidance',
    sourceRevision: 'test-revision',
    sources: {},
  })),
  writeModProjection: vi.fn(async () => 'projection.json'),
  collectModCandidates: vi.fn(async () => ({ candidates: [] })),
}));

vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(),
  existsSync: mocks.existsSync,
}));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  readFile: mocks.readFile,
}));

vi.mock('@claude-flow/guidance/compiler', () => ({
  GuidanceCompiler: class {
    compile() { return {}; }
  },
}));

vi.mock('@claude-flow/guidance/retriever', () => ({
  HashEmbeddingProvider: class {},
  ShardRetriever: class {
    loadBundle() {}
    retrieve = mocks.retrieve;
  },
}));

vi.mock('@claude-flow/guidance/analyzer', () => ({
  analyze: () => ({ compositeScore: 40 }),
  formatReport: () => '',
  formatBenchmark: () => '',
  optimizeForSize: mocks.optimizeForSize,
  abBenchmark: mocks.abBenchmark,
  getDefaultABTasks: () => [],
}));

vi.mock('../src/guidance/mod-sources.js', () => ({
  readModGuidanceSources: mocks.readModGuidanceSources,
}));

vi.mock('../src/guidance/mod-projection.js', () => ({
  buildModProjection: () => ({}),
  MOD_GUIDANCE_DIR: 'mod-guidance',
  writeModProjection: mocks.writeModProjection,
  collectModCandidates: mocks.collectModCandidates,
}));

async function runGuidance(...argv: string[]) {
  const parser = new CommandParser({ allowUnknownFlags: true });
  parser.registerCommand(guidanceCommand);
  const { command, flags, positional } = parser.parse(['guidance', ...argv]);
  const { target, args } = resolveTargetCommand(guidanceCommand, command, positional);
  expect(target.name).toBe(argv[0]);
  expect(parser.validateFlags(flags, target)).toEqual([]);
  const result = await target.action!({ args, flags, cwd: process.cwd(), interactive: false });
  expect(result).toMatchObject({ success: true });
}

function runDirect(name: string, flags: Omit<ParsedFlags, '_'>) {
  const target = guidanceCommand.subcommands!.find((command) => command.name === name)!;
  return target.action!({ args: [], flags: { ...flags, _: [] }, cwd: process.cwd(), interactive: false });
}

describe('guidance CLI flags (#4719)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(output, 'writeln').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    { flags: ['--max-shards', '2'], maxShards: 2 },
    { flags: ['-n', '0'], maxShards: 0 },
    { flags: [], maxShards: 5 },
  ])('passes maxShards=$maxShards to the retriever', async ({ flags, maxShards }) => {
    await runGuidance('retrieve', '--task', 'Add tests', '--json', ...flags);

    expect(mocks.retrieve).toHaveBeenCalledWith(expect.objectContaining({ maxShards }));
  });

  it('passes the requested context, score, and iteration limit to the optimizer', async () => {
    await runGuidance('optimize', '--context-size', 'compact', '--target-score', '50', '--max-iterations', '0');

    expect(mocks.optimizeForSize).toHaveBeenCalledWith('Contents of ./CLAUDE.md', expect.objectContaining({
      contextSize: 'compact',
      targetScore: 50,
      maxIterations: 0,
    }));
  });

  it('uses the default optimizer options when flags are omitted', async () => {
    await runGuidance('optimize');

    expect(mocks.optimizeForSize).toHaveBeenCalledWith('Contents of ./CLAUDE.md', expect.objectContaining({
      contextSize: 'standard',
      targetScore: 90,
      maxIterations: 5,
    }));
  });

  it('validates and labels the baseline, reads the candidate, and forwards the working directory', async () => {
    await runGuidance('ab-test', '--config-a', 'baseline.md', '--config-b', 'candidate.md', '--work-dir', 'benchmark dir', '--json');

    expect.soft(mocks.existsSync).toHaveBeenCalledWith('baseline.md');
    expect.soft(output.writeln).toHaveBeenCalledWith(expect.stringContaining('"label": "baseline.md"'));
    expect.soft(mocks.readFile).toHaveBeenCalledWith('candidate.md', 'utf-8');
    expect(mocks.abBenchmark).toHaveBeenCalledWith('Contents of candidate.md', expect.objectContaining({
      workDir: 'benchmark dir',
    }));
  });

  it('exports the mod projection when requested', async () => {
    await runGuidance('compile', '--mod-projection', '--revision', 'test-revision', '--json');

    expect(mocks.readModGuidanceSources).toHaveBeenCalledWith(expect.objectContaining({ revision: 'test-revision' }));
    expect(mocks.writeModProjection).toHaveBeenCalledWith('mod-guidance', expect.any(Object));
  });

  it.each([
    { description: 'omitted', flags: [] },
    { description: 'false', flags: ['--mod-projection=false'] },
  ])('skips mod projection when the flag is $description', async ({ flags }) => {
    await runGuidance('compile', '--json', ...flags);

    expect(mocks.readModGuidanceSources).not.toHaveBeenCalled();
    expect(mocks.writeModProjection).not.toHaveBeenCalled();
  });

  it('passes the bundle ID to candidate collection', async () => {
    await runGuidance('mod-candidates', '--directory', 'observations', '--bundle-id', '001');

    expect(mocks.collectModCandidates).toHaveBeenCalledWith('observations', '001');
  });

  it.each<{ flags: Record<string, boolean>; shouldExport: boolean }>([
    { flags: { 'mod-projection': true }, shouldExport: true },
    { flags: { 'mod-projection': true, modProjection: false }, shouldExport: false },
  ])('honors legacy projection flags with camelCase precedence (exports: $shouldExport)', async ({ flags, shouldExport }) => {
    const result = await runDirect('compile', { ...flags, revision: 'test-revision', json: true });

    expect(result).toMatchObject({ success: true });
    expect(mocks.writeModProjection).toHaveBeenCalledTimes(shouldExport ? 1 : 0);
  });

  it('accepts a legacy bundle ID in a direct handler call', async () => {
    const result = await runDirect('mod-candidates', { directory: 'observations', 'bundle-id': '001' });

    expect(result).toMatchObject({ success: true });
    expect(mocks.collectModCandidates).toHaveBeenCalledWith('observations', '001');
  });

  it('prefers an explicit zero to a conflicting legacy shard limit', async () => {
    const result = await runDirect('retrieve', { task: 'Add tests', json: true, maxShards: 0, 'max-shards': 2 });

    expect(result).toMatchObject({ success: true });
    expect(mocks.retrieve).toHaveBeenCalledWith(expect.objectContaining({ maxShards: 0 }));
  });
});
