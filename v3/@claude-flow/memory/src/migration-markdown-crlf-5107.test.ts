import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryMigrator } from './migration.js';
import type { AgentDBAdapter } from './agentdb-adapter.js';
import type { MemoryEntry } from './types.js';

describe('MemoryMigrator — markdown frontmatter line endings', () => {
  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ])('migrates %s frontmatter', async (_name, newline) => {
    const dir = mkdtempSync(join(tmpdir(), 'migration-markdown-'));
    const content = [
      '---',
      "tags: ['a', 'b']",
      'priority: 2',
      '---',
      'Body text line one.',
      'Body text line two.',
    ].join(newline);
    writeFileSync(join(dir, 'entry.md'), content);

    const stored: MemoryEntry[] = [];
    const target = {
      store: async (entry: MemoryEntry) => {
        stored.push(entry);
        return entry;
      },
    } as unknown as AgentDBAdapter;
    const migrator = new MemoryMigrator(target, {
      source: 'markdown',
      sourcePath: dir,
      batchSize: 10,
    });

    try {
      await migrator.migrate();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe(`Body text line one.${newline}Body text line two.`);
    expect(stored[0].tags).toEqual(['a', 'b']);
    expect(stored[0].metadata).toMatchObject({ tags: ['a', 'b'], priority: 2 });
  });
});
