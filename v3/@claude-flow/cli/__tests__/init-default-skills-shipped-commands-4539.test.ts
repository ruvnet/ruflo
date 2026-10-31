import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_INIT_OPTIONS, type InitOptions } from '../src/init/types.js';
import { executeInit } from '../src/init/executor.js';
import { extractInvocations, loadCommandTree, resolveCommand } from '../../../../scripts/audit-skill-cli-commands.mjs';

const SKILLS_ROOT = join(fileURLToPath(new URL('..', import.meta.url)), '.claude', 'skills');

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function skillsOnly(base: InitOptions): InitOptions {
  const targetDir = mkdtempSync(join(tmpdir(), 'ruflo-init-default-skills-'));
  tempDirs.push(targetDir);
  return {
    ...base,
    targetDir,
    force: true,
    skipGlobalClaudeMd: true,
    components: {
      ...base.components,
      settings: false, skills: true, commands: false, agents: false, helpers: false,
      statusline: false, mcp: false, runtime: false, claudeMd: false,
    },
  };
}

function installedSkills(targetDir: string): string[] {
  const dir = join(targetDir, '.claude', 'skills');
  return existsSync(dir) ? readdirSync(dir) : [];
}

/**
 * The verb a skill invokes most often is what the skill is built around: its
 * quick start and most of its examples run it. If that verb is missing from the
 * CLI, `ruflo init` ships instructions whose primary command fails with
 * `Unknown command`, and the agent following the skill gets nothing done.
 */
function dominantCommand(skill: string): string | null {
  const file = join(SKILLS_ROOT, skill, 'SKILL.md');
  if (!existsSync(file)) return null;
  const counts = new Map<string, number>();
  for (const invocation of extractInvocations(readFileSync(file, 'utf8'))) {
    counts.set(invocation.command, (counts.get(invocation.command) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked.length > 0 ? ranked[0][0] : null;
}

describe('default init only installs skills whose commands v3 ships (#4539)', () => {
  it('keeps the skills that depend on unshipped commands out of the default set', () => {
    // stream-chain and sparc-methodology are now opt-in, like skills.v3 after #4140.
    expect(DEFAULT_INIT_OPTIONS.skills.legacy).toBe(false);
    // The GitHub skills still invoke `ruflo github` / `ruflo skill`, which v3 does not ship.
    expect(DEFAULT_INIT_OPTIONS.skills.github).toBe(false);
  });

  it('default init does not install stream-chain, sparc-methodology or the GitHub skills', async () => {
    const options = skillsOnly(DEFAULT_INIT_OPTIONS);
    const result = await executeInit(options);
    expect(result.success).toBe(true);

    const installed = installedSkills(options.targetDir!);
    expect(installed.length).toBeGreaterThan(0);
    expect(installed).not.toContain('stream-chain');
    expect(installed).not.toContain('sparc-methodology');
    expect(installed).not.toContain('github-release-management');
    expect(installed).not.toContain('github-workflow-automation');
    expect(installed).not.toContain('github-multi-repo');
  });

  it('every default-installed skill is built around a command the CLI ships', async () => {
    const options = skillsOnly(DEFAULT_INIT_OPTIONS);
    const result = await executeInit(options);
    expect(result.success).toBe(true);

    const tree = await loadCommandTree();
    const missing: string[] = [];
    for (const skill of installedSkills(options.targetDir!)) {
      const command = dominantCommand(skill);
      if (command && !resolveCommand(tree, command)) missing.push(`${skill} -> ${command}`);
    }
    expect(missing).toEqual([]);
  }, 120_000);

  it('skills.legacy still installs stream-chain and sparc-methodology when asked', async () => {
    const options = skillsOnly({
      ...DEFAULT_INIT_OPTIONS,
      skills: { ...DEFAULT_INIT_OPTIONS.skills, legacy: true },
    });
    const result = await executeInit(options);
    expect(result.success).toBe(true);

    expect(installedSkills(options.targetDir!)).toEqual(
      expect.arrayContaining(['stream-chain', 'sparc-methodology']),
    );
  });
});
