import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  list: vi.fn(),
  listEntries: vi.fn(),
}));

vi.mock('../src/mcp-client.js', () => ({
  callMCPTool: mocks.call,
  MCPClientError: class extends Error {},
}));
vi.mock('../src/output.js', () => ({
  output: new Proxy({}, {
    get: (_target, prop) => {
      if (prop === 'printSuccess') return mocks.success;
      if (prop === 'printError') return mocks.error;
      if (prop === 'printWarning') return mocks.warning;
      if (prop === 'printList') return mocks.list;
      return (value: unknown) => value;
    },
  }),
}));
vi.mock('../src/commands/memory-distill.js', () => ({ distillCommand: {} }));
vi.mock('../src/commands/memory-backup.js', () => ({ backupCommand: {} }));
vi.mock('../src/memory/memory-initializer.js', () => ({
  resolveDbPath: vi.fn(() => undefined),
  listEntries: mocks.listEntries,
  storeEntry: vi.fn(),
  searchEntries: vi.fn(),
  getEntry: vi.fn(),
  deleteEntry: vi.fn(),
  initializeMemoryDatabase: vi.fn(),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true })),
}));

import { memoryCommand } from '../src/commands/memory.js';
import { memoryTools } from '../src/mcp-tools/memory-tools.js';

const exportCommand = memoryCommand.subcommands!.find(command => command.name === 'export')!;
const exportTool = memoryTools.find(tool => tool.name === 'memory_export')!;
const runCli = (flags: Record<string, unknown> = {}) => exportCommand.action!({
  args: [],
  flags: { output: 'out.json', ...flags },
} as any);

let tempDir: string;
let previousCwd: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ruflo-export-5158-'));
  previousCwd = process.env.CLAUDE_FLOW_CWD;
  process.env.CLAUDE_FLOW_CWD = tempDir;
  vi.clearAllMocks();
  mocks.listEntries.mockResolvedValue({
    success: true,
    total: 1,
    entries: [{
      id: 'row-1',
      key: 'alpha',
      namespace: 'notes',
      content: 'value',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      accessCount: 0,
      hasEmbedding: true,
      size: 5,
    }],
  });
});

afterEach(() => {
  if (previousCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = previousCwd;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('memory export format disclosure (#5158)', () => {
  it('prints a CSV fallback note returned by the tool', async () => {
    mocks.call.mockResolvedValue({
      outputPath: '/tmp/out.csv',
      format: 'csv',
      exported: { entries: 2, vectors: 1, patterns: 0 },
      fileSize: '100B',
      note: 'CSV not implemented yet — wrote JSON',
    });

    expect(await runCli({ format: 'csv' })).toMatchObject({ success: true });
    expect(mocks.warning).toHaveBeenCalledWith('CSV not implemented yet — wrote JSON');
  });

  it('prints every warning returned by the tool', async () => {
    const warnings = [
      'Could not read the CLI store /tmp/memory.db (key missing); the export covers the AgentDB store only.',
      'Second export warning',
    ];
    mocks.call.mockResolvedValue({
      outputPath: '/tmp/out.json',
      format: 'json',
      exported: { entries: 1, vectors: 0, patterns: 0 },
      fileSize: '50B',
      warnings,
    });

    await runCli();
    expect(mocks.warning.mock.calls.map(([message]) => message)).toEqual(warnings);
  });

  it('describes embedding counts without claiming vectors were exported', async () => {
    mocks.call.mockResolvedValue({
      outputPath: '/tmp/out.json',
      format: 'json',
      exported: { entries: 2, vectors: 1, patterns: 0 },
      fileSize: '100B',
    });

    await runCli();
    const summary = mocks.list.mock.calls[0][0] as string[];
    expect(summary.some(line => line.startsWith('Vectors:'))).toBe(false);
    expect(summary).toContain('Entries with embeddings: 1 (vectors are not written to the file yet)');
  });

  it('prints no warning for an ordinary JSON export', async () => {
    mocks.call.mockResolvedValue({
      outputPath: '/tmp/out.json',
      format: 'json',
      exported: { entries: 1, vectors: 0, patterns: 0 },
      fileSize: '50B',
    });

    await runCli();
    expect(mocks.warning).not.toHaveBeenCalled();
  });

  it('keeps include-vectors advisory without a displayed default', () => {
    const option = exportCommand.options!.find(candidate => candidate.name === 'include-vectors')!;
    expect(option.default).toBeUndefined();
    expect(option.description).toMatch(/advisory/i);
    expect(option.description).toMatch(/not exported yet/i);
  });

  it.each([
    ['binary', 'BINARY not implemented yet — wrote JSON'],
    ['csv', 'CSV not implemented yet — wrote JSON'],
    ['JSON', undefined],
    ['json', undefined],
  ])('writes parseable JSON and reports the %s format accurately', async (format, note) => {
    const outputPath = join(tempDir, `${format}.json`);
    const result = await exportTool.handler({ outputPath, format }) as Record<string, any>;

    expect(result.error).toBeUndefined();
    expect(result.note).toBe(note);
    expect(existsSync(outputPath), `expected export file at ${outputPath}`).toBe(true);
    expect(() => JSON.parse(readFileSync(outputPath, 'utf8'))).not.toThrow();
  });

  it('defaults a non-string format without failing after writing the file', async () => {
    const outputPath = join(tempDir, 'non-string.json');
    const result = await exportTool.handler({ outputPath, format: true }) as Record<string, any>;

    expect(result.error).toBeUndefined();
    expect(result.format).toBe('json');
    expect(result.note).toBeUndefined();
    expect(existsSync(outputPath), `expected export file at ${outputPath}`).toBe(true);
  });

  it('advertises binary as a supported format value', () => {
    const format = (exportTool.inputSchema as any).properties.format;
    expect(format.enum).toContain('binary');
  });
});
