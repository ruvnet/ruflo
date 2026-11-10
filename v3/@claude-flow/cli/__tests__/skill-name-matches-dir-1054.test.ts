/**
 * Regression test for issue #1054.
 *
 * Every bundled skill's SKILL.md frontmatter `name:` field must match its
 * directory name exactly. Claude Code resolves a skill invocation (e.g.
 * `/pair-programming`) by directory name but surfaces the `name:` field in
 * autocomplete; when they differ, selecting the skill fails with
 * "skill not found".
 *
 * This scans the skills directory that `init` actually copies into user
 * projects (the package's own `.claude/skills`, see
 * `findSourceDir()`/`copySkills()` in `src/init/executor.ts`), not a
 * secondary mirror of the same content.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const skillsDir = path.join(__dirname, '..', '.claude', 'skills');

function readFrontmatterName(skillMdPath: string): string | null {
  const content = fs.readFileSync(skillMdPath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const frontmatter = match[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+?)\s*$/m);
  if (!nameMatch) return null;
  let value = nameMatch[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

const skillDirs = fs
  .readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(path.join(skillsDir, name, 'SKILL.md')))
  .sort();

describe('bundled skill name matches directory name (#1054)', () => {
  it('found at least one skill directory to check', () => {
    expect(skillDirs.length).toBeGreaterThan(0);
  });

  it.each(skillDirs)('%s/SKILL.md name: matches its directory', (dir) => {
    const skillMdPath = path.join(skillsDir, dir, 'SKILL.md');
    const name = readFrontmatterName(skillMdPath);
    expect(name).not.toBeNull();
    expect(name).toBe(dir);
  });
});
