import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';

// Store and validator mocks modeled on memory-import-claude-reimport-4197.test.ts, without its
// duplicate-key check, which single imports do not need.
const layer = vi.hoisted(() => ({ rows: new Map<string, string>() }));
vi.mock('../src/memory/memory-initializer.js', () => ({
  storeEntry: vi.fn(async (o: { key: string; value: string; namespace: string }) => {
    const id = `${o.namespace}/${o.key}`;
    layer.rows.set(id, o.value);
    return { success: true, id };
  }),
  searchEntries: vi.fn(), listEntries: vi.fn(), getEntry: vi.fn(), deleteEntry: vi.fn(),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true })),
  initializeMemoryDatabase: vi.fn(async () => ({ success: true })),
  generateEmbedding: vi.fn(async () => ({ backend: 'mock' })),
}));
vi.mock('../src/mcp-tools/validate-input.js', () => ({ validateIdentifier: () => ({ valid: true }) }));

const { memoryTools } = await import('../src/mcp-tools/memory-tools.js');
const importer = memoryTools.find(t => t.name === 'memory_import_claude')!;

// Claude Code names ~/.claude/projects/<slug> by replacing every character other
// than [A-Za-z0-9] with '-' (plugins/ruflo-cost-tracker/scripts/_encode-project-path.mjs).
const claudeCodeSlug = (projectPath: string) => projectPath.replace(/[^a-zA-Z0-9]/g, '-');

let home: string;
const savedEnv = new Map<string, string | undefined>();
const writeMemory = (slug: string) => {
  const memoryDir = join(home, '.claude', 'projects', slug, 'memory');
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(join(memoryDir, 'MEMORY.md'), `## Notes\n${'memory Claude Code keeps for this project '.repeat(5)}`);
};
const storedKeys = () => [...layer.rows.keys()];

beforeEach(() => {
  for (const key of ['HOME', 'USERPROFILE', 'CLAUDE_FLOW_CWD']) savedEnv.set(key, process.env[key]);
  delete process.env.CLAUDE_FLOW_CWD;
  home = mkdtempSync(join(tmpdir(), 'ruflo-claude-slug-'));
  // os.homedir() reads HOME on Linux and macOS, and USERPROFILE on Windows.
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  layer.rows.clear();
});
afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(home, { recursive: true, force: true });
});

describe('memory_import_claude finds the folder Claude Code names for the project', () => {
  it.each([
    ['a POSIX path with "_" and "."', '/work/my_app.v2', '-work-my-app-v2'],
    ['a Windows path with "." in the user name', win32.normalize('C:/Users/john.doe/repo'), 'C--Users-john-doe-repo'],
    ['a WSL path to a Windows project with "_"', '/mnt/c/Users/x/my_proj', 'C--Users-x-my-proj'],
  ])('imports %s', async (_name, projectPath, slug) => {
    writeMemory(slug);
    expect(await importer.handler({ projectPath })).toMatchObject({ success: true, imported: 1 });
    expect(storedKeys()[0]).toContain(`claude:${slug}:`);
  });

  it('imports the current project (CLAUDE_FLOW_CWD) when its folder name has "_" and "."', async () => {
    const project = join(home, 'my_app.v2');
    mkdirSync(project);
    writeMemory(claudeCodeSlug(project));
    process.env.CLAUDE_FLOW_CWD = project;
    expect(await importer.handler({})).toMatchObject({ success: true, imported: 1 });
    expect(storedKeys()[0]).toContain(`claude:${claudeCodeSlug(project)}:`);
  });

  it('still imports a path the existing slugs matched, and nothing for another project', async () => {
    writeMemory('-work-plain-app');
    expect(await importer.handler({ projectPath: '/work/plain-app' })).toMatchObject({ success: true, imported: 1 });
    layer.rows.clear();
    expect(await importer.handler({ projectPath: '/work/other_app' })).toMatchObject({ success: true, imported: 0 });
    expect(layer.rows.size).toBe(0);
  });
});
