import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const layer = vi.hoisted(() => ({
  storeEntry: vi.fn(async (_options: { key: string; value: string }): Promise<{ success: boolean; id: string }> => ({ success: true, id: 'stored' })),
}));

vi.mock('../src/memory/memory-initializer.js', () => ({
  storeEntry: layer.storeEntry,
  searchEntries: vi.fn(),
  listEntries: vi.fn(),
  getEntry: vi.fn(),
  deleteEntry: vi.fn(),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true })),
  initializeMemoryDatabase: vi.fn(async () => ({ success: true })),
  generateEmbedding: vi.fn(async () => ({ backend: 'mock' })),
}));

vi.mock('../src/mcp-tools/validate-input.js', () => ({
  validateIdentifier: () => ({ valid: true }),
}));

const { memoryTools } = await import('../src/mcp-tools/memory-tools.js');
const importer = memoryTools.find((tool) => tool.name === 'memory_import_claude')!;

let home: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'ruflo-claude-import-crlf-'));
  process.env.HOME = home;
  layer.storeEntry.mockClear();
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

function writeMemory(contents: string): void {
  const memoryDir = join(home, '.claude', 'projects', '-test-project', 'memory');
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(join(memoryDir, 'MEMORY.md'), contents);
}

describe('#5101 memory_import_claude handles CRLF frontmatter', () => {
  it.each([
    {
      name: 'free text without level-two headings',
      source: '---\r\nname: deploy-notes\r\n---\r\nDeploy the service after the health check passes.\r\nKeep the previous release available.',
      expected: [
        {
          key: 'claude:-test-project:deploy-notes:deploy-notes',
          value: 'Deploy the service after the health check passes.\r\nKeep the previous release available.',
        },
      ],
    },
    {
      name: 'two level-two sections',
      source: '---\r\nname: deploy-notes\r\n---\r\n## Preparation\r\nVerify the release artifact before deployment.\r\n## Rollback\r\nRestore the previous release if health checks fail.',
      expected: [
        {
          key: 'claude:-test-project:deploy-notes:Preparation',
          value: 'Verify the release artifact before deployment.',
        },
        {
          key: 'claude:-test-project:deploy-notes:Rollback',
          value: 'Restore the previous release if health checks fail.',
        },
      ],
    },
  ])('imports $name without frontmatter or carriage returns in keys', async ({ source, expected }) => {
    writeMemory(source);

    const result = await importer.handler({ projectPath: '/test/project' }) as { success: boolean; imported: number };

    expect(result).toMatchObject({ success: true, imported: expected.length });
    expect(layer.storeEntry.mock.calls.map(([options]) => ({ key: options.key, value: options.value }))).toEqual(expected);
  });
});
