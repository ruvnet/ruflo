/**
 * #2638 — `init --dual`: AGENTS.md is the single source for the shared
 * sections; CLAUDE.md is `@AGENTS.md` plus Claude-only sections.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandContext } from '../src/types.js';

// The Codex package that writes AGENTS.md: its workspace source, not the
// registry copy the CLI pins.
import { generateDualAgentsMd } from '../../codex/src/generators/dual-instructions.js';

const codexMock = vi.hoisted(() => ({ initialize: vi.fn() }));
vi.mock('@claude-flow/codex', () => ({
  CodexInitializer: class {
    initialize = codexMock.initialize;
  },
}));

import { initCommand } from '../src/commands/init.js';
import { AGENTS_MD_CLI, generateClaudeMd, generateDualClaudeMd, sharedSectionsForImport } from '../src/init/claudemd-generator.js';
import { finalizeDualInstructions, writeDualClaudeMd } from '../src/init/dual-instructions.js';
import { executeInit } from '../src/init/executor.js';
import { DEFAULT_INIT_OPTIONS, MINIMAL_INIT_OPTIONS, type ClaudeMdTemplate, type InitOptions, type InitResult } from '../src/init/types.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEMPLATES: ClaudeMdTemplate[] = ['minimal', 'standard', 'full', 'security', 'performance', 'solo'];
const h2 = (md: string) => md.split('\n').filter((l) => /^## /.test(l));
const importLine = (md: string) => md.split('\n').some((l) => l.trim() === '@AGENTS.md');

function emptyResult(): InitResult {
  return {
    success: true,
    platform: {} as InitResult['platform'],
    created: { directories: [], files: [] },
    skipped: [],
    errors: [],
    summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
  };
}

describe('shared sections have one source (#2638)', () => {
  it('the CLI mirror is byte-identical to the codex module', () => {
    const canonical = readFileSync(join(here, '../../codex/src/generators/shared-instructions.ts'), 'utf-8');
    const mirror = readFileSync(join(here, '../src/init/shared-instructions.ts'), 'utf-8');
    expect(mirror).toBe(canonical);
  });

  it('the single-host CLAUDE.md contains every shared section verbatim (no drift)', () => {
    const md = generateClaudeMd(DEFAULT_INIT_OPTIONS, 'standard');
    // Rules and Swarm are split around Claude-only lines, so check their shared lines.
    for (const section of sharedSectionsForImport().slice(2)) expect(md).toContain(section);
  });
});

describe('generateDualClaudeMd (#2638)', () => {
  const agents = generateDualAgentsMd({ projectName: 'demo' });

  it('the dual AGENTS.md carries the shared sections in the form finalize checks for', () => {
    for (const section of sharedSectionsForImport(AGENTS_MD_CLI)) expect(agents).toContain(section);
  });

  for (const template of TEMPLATES) {
    it(`${template}: imports AGENTS.md, repeats no shared section, loses no line`, () => {
      const dual = generateDualClaudeMd(DEFAULT_INIT_OPTIONS, template);
      expect(importLine(dual)).toBe(true);
      for (const section of sharedSectionsForImport()) expect(dual).not.toContain(section);
      expect(h2(dual).filter((h) => h2(agents).includes(h))).toEqual([]);

      // Lossless: every line of the single-host file is in CLAUDE.md or AGENTS.md
      // (AGENTS.md invokes the CLI in the codex generators' form).
      const single = generateClaudeMd(DEFAULT_INIT_OPTIONS, template);
      const asAgents = (l: string) => l.split('npx @claude-flow/cli@latest').join(AGENTS_MD_CLI);
      const missing = single.split('\n')
        .filter((l) => l.trim() && !/^#{1,3} /.test(l))
        .filter((l) => !dual.includes(l) && !agents.includes(asAgents(l)));
      expect(missing).toEqual([]);
    });
  }
});

describe('writeDualClaudeMd + finalizeDualInstructions (#2638)', () => {
  let dir: string;
  const options = (): InitOptions => ({ ...structuredClone(DEFAULT_INIT_OPTIONS), targetDir: dir });
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dual-2638-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('writes the import form when CLAUDE.md does not exist', () => {
    const result = emptyResult();
    writeDualClaudeMd(join(dir, 'CLAUDE.md'), options(), result);
    expect(importLine(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8'))).toBe(true);
    expect(result.dualInstructions).toBeDefined();
  });

  it('keeps a user-modified CLAUDE.md and says how to migrate', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), '# mine\n', 'utf-8');
    const result = emptyResult();
    writeDualClaudeMd(join(dir, 'CLAUDE.md'), options(), result);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe('# mine\n');
    expect(result.skipped.join('\n')).toMatch(/move your custom sections into AGENTS\.md.*@AGENTS\.md/);
    expect(result.dualInstructions).toBeUndefined();
  });

  it('converts a CLAUDE.md that init generated and nobody edited', () => {
    const opts = options();
    writeFileSync(join(dir, 'CLAUDE.md'), generateClaudeMd(opts), 'utf-8');
    const result = emptyResult();
    writeDualClaudeMd(join(dir, 'CLAUDE.md'), opts, result);
    expect(importLine(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8'))).toBe(true);
    expect(existsSync(join(dir, 'CLAUDE.md.pre-ruflo'))).toBe(false);
  });

  it('--force replaces a user CLAUDE.md after backing it up', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), '# mine\n', 'utf-8');
    const result = emptyResult();
    writeDualClaudeMd(join(dir, 'CLAUDE.md'), { ...options(), force: true }, result);
    expect(readFileSync(join(dir, 'CLAUDE.md.pre-ruflo'), 'utf-8')).toBe('# mine\n');
    expect(importLine(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8'))).toBe(true);
  });

  it('keeps the import when AGENTS.md carries the shared sections', () => {
    const result = emptyResult();
    writeDualClaudeMd(join(dir, 'CLAUDE.md'), options(), result);
    writeFileSync(join(dir, 'AGENTS.md'), generateDualAgentsMd({ projectName: 'demo' }), 'utf-8');
    expect(finalizeDualInstructions(dir, result).action).toBe('import');
    expect(importLine(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8'))).toBe(true);
  });

  it('restores the full CLAUDE.md when AGENTS.md lacks the shared sections (old codex / failed pass)', () => {
    const result = emptyResult();
    writeDualClaudeMd(join(dir, 'CLAUDE.md'), options(), result);
    writeFileSync(join(dir, 'AGENTS.md'), '# Native Codex Instructions\n', 'utf-8');
    expect(finalizeDualInstructions(dir, result).action).toBe('restored');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe(result.dualInstructions!.fullForm);
  });

  it('never touches a CLAUDE.md changed after the Claude pass', () => {
    const result = emptyResult();
    writeDualClaudeMd(join(dir, 'CLAUDE.md'), options(), result);
    writeFileSync(join(dir, 'CLAUDE.md'), '# edited\n', 'utf-8');
    expect(finalizeDualInstructions(dir, result).action).toBe('none');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe('# edited\n');
  });

  it('single-host executeInit still writes the full CLAUDE.md', async () => {
    const opts = { ...structuredClone(MINIMAL_INIT_OPTIONS), targetDir: dir, skipGlobalClaudeMd: true };
    await executeInit(opts);
    expect(importLine(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8'))).toBe(false);
  });
});

describe('ruflo init --dual end to end (#2638)', () => {
  let dir: string;
  let configDir: string;
  let saved: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dual-e2e-2638-'));
    configDir = mkdtempSync(join(tmpdir(), 'dual-e2e-cfg-'));
    saved = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    codexMock.initialize.mockImplementation(async (o: Record<string, unknown>) => {
      const target = String(o.projectPath);
      // Stand-in for the codex initializer: dual → the real dual AGENTS.md.
      writeFileSync(join(target, 'AGENTS.md'), o.dual ? generateDualAgentsMd({ projectName: 'demo' }) : '# single\n', 'utf8');
      return { success: true, filesCreated: ['AGENTS.md'], skillsGenerated: [], warnings: [] };
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
  });

  it('CLAUDE.md imports AGENTS.md and no section is in both files', async () => {
    const ctx: CommandContext = {
      args: [],
      flags: { _: [], dual: true, minimal: true, global: false, 'no-signup': true, 'no-skills-sh': true },
      cwd: dir,
      interactive: false,
    };
    const result = await initCommand.action!(ctx);
    expect(result?.success).toBe(true);
    expect(codexMock.initialize).toHaveBeenCalledWith(expect.objectContaining({ dual: true }));

    const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
    expect(importLine(claude)).toBe(true);
    expect(h2(claude).filter((h) => h2(agents).includes(h))).toEqual([]);
  });
});
