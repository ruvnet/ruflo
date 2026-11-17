/**
 * #4558: hooks_build-agents
 *   - resolved outputDir against the process cwd instead of the project
 *     (getProjectCwd), so a default call overwrote ./agents wherever it ran;
 *   - never validated outputDir (a `..` path was accepted and written to);
 *   - reported patternsApplied = agents * 3 although no pretrain data is read.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalCwd = process.cwd();
const originalProjectCwd = process.env.CLAUDE_FLOW_CWD;
let project: string;
let elsewhere: string;

async function build(input: Record<string, unknown> = {}) {
  const { hooksTools } = await import('../src/mcp-tools/hooks-tools.js');
  return hooksTools.find((t) => t.name === 'hooks_build-agents')!.handler(input) as Promise<Record<string, any>>;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'ruflo-4558-project-'));
  elsewhere = mkdtempSync(join(tmpdir(), 'ruflo-4558-cwd-'));
  process.env.CLAUDE_FLOW_CWD = project;
  // Never let a default call write into this package's tracked agents/ directory.
  process.chdir(elsewhere);
});
afterEach(() => {
  process.chdir(originalCwd);
  if (originalProjectCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalProjectCwd;
});

describe('hooks_build-agents (#4558)', () => {
  it('writes the default ./agents under the project, not the process cwd', async () => {
    const r = await build();
    // Baseline: outputDir is <process cwd>/agents and the YAML files land there.
    expect(r.outputDir).toBe(join(project, 'agents'));
    expect(readdirSync(join(project, 'agents')).sort()).toEqual(['architect.yaml', 'coder.yaml', 'reviewer.yaml', 'security-architect.yaml', 'tester.yaml']);
    expect(existsSync(join(elsewhere, 'agents'))).toBe(false);
  });

  it('rejects a traversal outputDir without writing anything', async () => {
    const target = `${project}/out/../escaped`; // raw string: path.join would normalise the .. away
    const r = await build({ outputDir: target });
    expect(r).toMatchObject({ success: false, error: expect.stringMatching(/traversal/) });
    expect(existsSync(join(project, 'escaped'))).toBe(false);
  });

  it('does not claim pretrain patterns it never read', async () => {
    const r = await build({ persist: false });
    expect(r.stats).toMatchObject({ configsGenerated: 5, patternsApplied: 0 });
    expect(r._note).toMatch(/templates/);
  });

  it('rejects an absolute outputDir outside the project without writing', async () => {
    const r = await build({ outputDir: join(elsewhere, 'out') });
    expect(r).toMatchObject({ success: false, error: expect.stringMatching(/inside the project/) });
    expect(existsSync(join(elsewhere, 'out'))).toBe(false);
  });

  it('rejects an outputDir that escapes the project through a symlink', async () => {
    symlinkSync(elsewhere, join(project, 'link'));
    const r = await build({ outputDir: 'link/out' });
    expect(r).toMatchObject({ success: false, error: expect.stringMatching(/inside the project/) });
    expect(existsSync(join(elsewhere, 'out'))).toBe(false);
  });

  it('rejects a format other than yaml/json (it is spliced into file names)', async () => {
    const r = await build({ format: 'json/../../x' });
    expect(r).toMatchObject({ success: false, error: expect.stringMatching(/format/) });
    expect(existsSync(join(project, 'agents'))).toBe(false);
  });

  it('still honours an explicit absolute outputDir (control)', async () => {
    const out = join(project, 'custom');
    const r = await build({ outputDir: out, format: 'json', focus: 'security' });
    expect(r.outputDir).toBe(out);
    expect(readdirSync(out).sort()).toEqual(['reviewer.json', 'security-architect.json']);
  });
});
