/**
 * #2638 — dual projects get one instruction source: AGENTS.md carries the
 * shared sections once, CLAUDE.md imports it with `@AGENTS.md`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexInitializer } from '../src/initializer.js';
import { generateDualAgentsMd } from '../src/generators/dual-instructions.js';
import { generateSharedInstructions, importsAgentsMd } from '../src/generators/shared-instructions.js';

const headings = (md: string) => md.split('\n').filter((l) => /^#{2,3} /.test(l));
const h2 = (md: string) => md.split('\n').filter((l) => /^## /.test(l));

describe('generateDualAgentsMd', () => {
  const md = generateDualAgentsMd({ projectName: 'demo' });

  it('carries every shared section verbatim', () => {
    for (const section of generateSharedInstructions()) expect(md).toContain(section);
  });

  it('repeats no section heading', () => {
    const hs = h2(md);
    expect(new Set(hs).size).toBe(hs.length);
  });

  it('keeps the Codex-only sections', () => {
    for (const h of ['## Quick Start', '## Codex Execution Model', '## Ruflo + Codex Automated Workflow', '## Commit Messages', '## Path Security', '## Links']) {
      expect(md).toContain(h);
    }
    expect(md).toContain('$swarm-orchestration');
  });
});

describe('CodexInitializer --dual', () => {
  let dir: string;
  let originalPath: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dual-2638-'));
    originalPath = process.env.PATH;
    process.env.PATH = '';
  });
  afterEach(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes AGENTS.md as the single source and CLAUDE.md as the @AGENTS.md import', async () => {
    const result = await new CodexInitializer().initialize({ projectPath: dir, template: 'default', dual: true });
    expect(result.success).toBe(true);

    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
    const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
    for (const section of generateSharedInstructions()) expect(agents).toContain(section);
    expect(importsAgentsMd(claude)).toBe(true);

    // No section appears in both files.
    const shared = headings(claude).filter((h) => headings(agents).includes(h));
    expect(shared).toEqual([]);
    for (const section of generateSharedInstructions()) expect(claude).not.toContain(section);
  });

  it('never overwrites a user CLAUDE.md without --force, and says how to migrate', async () => {
    writeFileSync(join(dir, 'CLAUDE.md'), '# My rules\n\n- keep me\n', 'utf-8');
    const result = await new CodexInitializer().initialize({ projectPath: dir, template: 'minimal', dual: true });
    expect(result.success).toBe(true);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe('# My rules\n\n- keep me\n');
    expect(result.filesCreated).not.toContain('CLAUDE.md');
    expect(result.warnings.join('\n')).toMatch(/@AGENTS\.md/);
  });

  it('leaves a CLAUDE.md that already imports AGENTS.md alone, even with --force', async () => {
    const mine = '# Ruflo — Claude Code Configuration\n\n@AGENTS.md\n\n## Claude Code Rules\n\n- custom\n';
    writeFileSync(join(dir, 'CLAUDE.md'), mine, 'utf-8');
    const result = await new CodexInitializer().initialize({ projectPath: dir, template: 'minimal', dual: true, force: true });
    expect(result.success).toBe(true);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe(mine);
  });

  it('does not write CLAUDE.md without --dual', async () => {
    await new CodexInitializer().initialize({ projectPath: dir, template: 'minimal' });
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);
  });
});
