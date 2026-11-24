/**
 * agenticow MCP verbs create/overwrite `<path>` and `<path>.agenticow.json`.
 * A path named in MCP tool input must stay inside the project directory;
 * only the local CLI (operator) may name an arbitrary path.
 *
 * The agenticow package itself is mocked (London school): the fake records
 * which files the handler opened and saved, so the test runs without the
 * optional dependency installed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const touched: string[] = [];
const fakeMem = {
  ingest: vi.fn(async (r: unknown[]) => ({ accepted: r.length })),
  save: vi.fn(async (p: string) => { touched.push(p); }),
  fork: vi.fn(async (_l: string, p: string) => { touched.push(p); return fakeMem; }),
  close: vi.fn(async () => {}),
};
const fakeApi = {
  open: vi.fn(async (p: string) => { touched.push(p); return fakeMem; }),
  AgenticMemory: { load: vi.fn(async () => fakeMem) },
};

vi.mock('../src/mcp-tools/agenticow-loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/mcp-tools/agenticow-loader.js')>();
  return { ...actual, loadAgenticow: async () => fakeApi };
});

const { agenticowTools } = await import('../src/mcp-tools/agenticow-tools.js');
const { resolveToolMemoryPath } = await import('../src/mcp-tools/agenticow-loader.js');
const { localCliContext } = await import('../src/mcp-tools/path-containment.js');

const tool = (name: string) => {
  const t = agenticowTools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
};
const rec = [{ id: 1, vector: [0.1, 0.2] }];

describe('agenticow tools — memory path containment', () => {
  let project: string;
  let outside: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    touched.length = 0;
    project = realpathSync(mkdtempSync(join(tmpdir(), 'acow-contain-proj-')));
    outside = realpathSync(mkdtempSync(join(tmpdir(), 'acow-contain-out-')));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = project;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(project, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('accepts a relative path inside the project', async () => {
    const r: any = await tool('agenticow_ingest').handler({ path: 'mem/base.rvf', records: rec }, {})
      .catch((e: Error) => e);
    // parent dir does not exist yet → refused; create it and retry
    expect(r).toBeInstanceOf(Error);
    mkdirSync(join(project, 'mem'));
    const ok: any = await tool('agenticow_ingest').handler({ path: 'mem/base.rvf', records: rec }, {});
    expect(ok.success).toBe(true);
    expect(ok.path).toBe(join(project, 'mem', 'base.rvf'));
  });

  it('refuses an absolute path outside the project (ingest)', async () => {
    await expect(tool('agenticow_ingest').handler({ path: join(outside, 'x.rvf'), records: rec }, {}))
      .rejects.toThrow(/inside the project/);
    expect(touched).toEqual([]);
  });

  it('refuses an outside branchPath (branch)', async () => {
    await expect(tool('agenticow_branch').handler({
      basePath: 'base.rvf', branchPath: join(outside, 'b.rvf'), label: 'l', dimension: 2,
    }, {})).rejects.toThrow(/inside the project/);
    expect(touched).toEqual([]);
  });

  it('refuses a path through a symlinked directory that leaves the project', async () => {
    symlinkSync(outside, join(project, 'link'));
    await expect(tool('agenticow_checkpoint').handler({ path: 'link/x.rvf', label: 'c' }, {}))
      .rejects.toThrow(/inside the project/);
  });

  it('refuses when the target or its manifest is a symlink', async () => {
    writeFileSync(join(outside, 'victim'), 'keep');
    symlinkSync(join(outside, 'victim'), join(project, 'a.rvf'));
    expect(() => resolveToolMemoryPath('a.rvf', {})).toThrow(/inside the project/);
    symlinkSync(join(outside, 'victim'), join(project, 'b.rvf.agenticow.json'));
    expect(() => resolveToolMemoryPath('b.rvf', {})).toThrow(/inside the project/);
  });

  it('refuses an outside basePath and branchPath (speculate)', async () => {
    const { agenticowSpeculateTools } = await import('../src/mcp-tools/agenticow-speculate-tools.js');
    const spec = agenticowSpeculateTools.find((t) => t.name === 'agenticow_speculate')!;
    await expect(spec.handler({
      basePath: join(outside, 'base.rvf'), scoreBy: 'count',
      candidates: [{ label: 'a', ingest: rec }],
    }, {})).rejects.toThrow(/inside the project/);
  });

  it('lets the local CLI (operator) name a path outside the project', () => {
    const p = join(outside, 'x.rvf');
    expect(resolveToolMemoryPath(p, localCliContext())).toBe(p);
  });
});
