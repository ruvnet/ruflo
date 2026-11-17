/**
 * SECURITY: memory_export wrote to any outputPath and memory_import read any
 * inputPath (echoing parser errors that quote the file), so an MCP caller could
 * overwrite or probe files anywhere the server can reach. MCP callers are now
 * contained to the project; the local CLI keeps operator-chosen paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const layer = vi.hoisted(() => ({ storeEntry: vi.fn(), listEntries: vi.fn() }));
vi.mock('../src/memory/memory-initializer.js', () => ({
  storeEntry: layer.storeEntry,
  listEntries: layer.listEntries,
  searchEntries: vi.fn(), getEntry: vi.fn(), deleteEntry: vi.fn(),
  initializeMemoryDatabase: vi.fn(),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true })),
}));
const { memoryTools } = await import('../src/mcp-tools/memory-tools.js');
const { localCliContext, dbPathError, containedWritePath } = await import('../src/mcp-tools/path-containment.js');
const tool = (name: string) => memoryTools.find(t => t.name === name)!;

const originalCwd = process.env.CLAUDE_FLOW_CWD;
let project: string;
let outside: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'ruflo-mem-contain-'));
  outside = mkdtempSync(join(tmpdir(), 'ruflo-mem-outside-'));
  process.env.CLAUDE_FLOW_CWD = project;
  layer.storeEntry.mockReset().mockResolvedValue({ success: true, id: 'saved' });
  layer.listEntries.mockReset().mockResolvedValue({ success: true, entries: [{ key: 'k', namespace: 'default', content: 'v', tags: [] }], total: 1 });
});
afterEach(() => {
  if (originalCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalCwd;
  rmSync(project, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const exportTo = (outputPath: string, context?: Record<string, unknown>) =>
  tool('memory_export').handler({ outputPath }, context) as Promise<Record<string, any>>;

describe('memory_export outputPath', () => {
  it('writes a .json file inside the project', async () => {
    const r = await exportTo('backup.json');
    expect(r.error).toBeUndefined();
    expect(JSON.parse(readFileSync(join(project, 'backup.json'), 'utf8')).schema).toMatch(/ruflo-memory-export/);
  });

  it('refuses paths outside the project, non-.json targets, symlinks, .git and executables', async () => {
    const victim = join(outside, 'victim.json');
    writeFileSync(victim, 'original');
    symlinkSync(victim, join(project, 'link.json'));
    mkdirSync(join(project, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(project, 'run.json'), '#!/bin/sh\n');
    chmodSync(join(project, 'run.json'), 0o755);
    for (const p of [victim, '../escape.json', 'link.json', 'notes.sh', '.git/hooks/pre-commit.json', 'run.json']) {
      const r = await exportTo(p);
      expect(r.error, p).toMatch(/inside the project/);
    }
    expect(readFileSync(victim, 'utf8')).toBe('original');
    expect(readFileSync(join(project, 'run.json'), 'utf8')).toBe('#!/bin/sh\n');
  });

  it('refuses everything when the project root is the home directory', () => {
    process.env.CLAUDE_FLOW_CWD = '/';
    vi.spyOn(process, 'cwd').mockReturnValue(process.env.HOME ?? '/');
    try {
      expect(containedWritePath('backup.json', ['.json'])).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('lets the local CLI write where the operator asked', async () => {
    const target = join(outside, 'cli-backup.json');
    const r = await exportTo(target, localCliContext());
    expect(r.error).toBeUndefined();
    expect(existsSync(target)).toBe(true);
  });
});

describe('memory_import inputPath', () => {
  it('refuses a file outside the project and does not echo its contents', async () => {
    const secret = join(outside, 'secret.txt');
    writeFileSync(secret, 'root:x:0:0:topsecret');
    const r = await tool('memory_import').handler({ inputPath: secret }) as Record<string, any>;
    expect(r.error).toMatch(/inside the project/);
    expect(JSON.stringify(r)).not.toContain('topsecret');
  });

  it('returns a generic error for a non-JSON file inside the project', async () => {
    writeFileSync(join(project, 'notes.txt'), 'topsecret line');
    const r = await tool('memory_import').handler({ inputPath: 'notes.txt' }) as Record<string, any>;
    expect(r.error).toMatch(/not a valid memory export/);
    expect(JSON.stringify(r)).not.toContain('topsecret');
    expect(layer.storeEntry).not.toHaveBeenCalled();
  });

  it('imports a file inside the project, and the CLI may import from elsewhere', async () => {
    const doc = JSON.stringify({ entries: [{ key: 'a', namespace: 'notes', value: 'x' }] });
    writeFileSync(join(project, 'in.json'), doc);
    expect((await tool('memory_import').handler({ inputPath: 'in.json' }) as any).error).toBeUndefined();
    writeFileSync(join(outside, 'in.json'), doc);
    expect((await tool('memory_import').handler({ inputPath: join(outside, 'in.json') }, localCliContext()) as any).error).toBeUndefined();
  });
});

describe('dbPath', () => {
  it('accepts a new or existing SQLite file and refuses anything else', () => {
    expect(dbPathError(join(outside, 'new.db'))).toBeNull();
    writeFileSync(join(outside, 'real.db'), Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(84)]));
    expect(dbPathError(join(outside, 'real.db'))).toBeNull();
    writeFileSync(join(outside, 'fake.db'), 'export PATH=evil');
    expect(dbPathError(join(outside, 'fake.db'))).toMatch(/not a SQLite database/);
    expect(dbPathError(join(outside, '.bashrc'))).toMatch(/must end in/);
    symlinkSync(join(outside, 'real.db'), join(outside, 'link.db'));
    expect(dbPathError(join(outside, 'link.db'))).toMatch(/symlink/);
  });

  it('is enforced on the MCP memory tools', async () => {
    writeFileSync(join(outside, 'fake.db'), 'not a database');
    await expect(tool('memory_store').handler({ key: 'k', value: 'v', dbPath: join(outside, 'fake.db') })).rejects.toThrow(/not a SQLite database/);
    expect(readFileSync(join(outside, 'fake.db'), 'utf8')).toBe('not a database');
  });
});

describe('dbPath with encryption at rest', () => {
  it('accepts an RFE1-encrypted database file', () => {
    writeFileSync(join(outside, 'enc.db'), Buffer.concat([Buffer.from('RFE1'), Buffer.alloc(64)]));
    expect(dbPathError(join(outside, 'enc.db'))).toBeNull();
  });
});
