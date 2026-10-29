/**
 * ADR-507 — plugin footprint: the measure script, the 300-character
 * description ceiling, and the "user-invoked skills are listed in the README"
 * rule enforced by scripts/audit-skill-frontmatter.mjs.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const load = (rel: string) => import(pathToFileURL(resolve(REPO, rel)).href);

function source(files: Record<string, string>) {
  return { files: Object.keys(files), read: (rel: string) => files[rel] };
}

const skill = (name: string, description: string, extra = '') =>
  `---\nname: ${name}\ndescription: ${description}\nallowed-tools: Bash\n${extra}---\n\n# ${name}\n`;

describe('ADR-507 measure-plugin-footprint', () => {
  it('parses folded, quoted and plain multi-line descriptions unfolded', async () => {
    const { parseFrontmatter } = await load('scripts/measure-plugin-footprint.mjs');
    expect(parseFrontmatter('---\nname: a\ndescription: >\n  one two\n  three\nallowed-tools: Bash\n---\n').description).toBe('one two three');
    expect(parseFrontmatter('---\ndescription: "say: hi"\n---\n').description).toBe('say: hi');
    expect(parseFrontmatter("---\ndescription: it''s\n---\n").description).toBe("it''s");
    expect(parseFrontmatter("---\ndescription: 'it''s'\n---\n").description).toBe("it's");
    expect(parseFrontmatter('---\ndescription: first\n  second\n---\n').description).toBe('first second');
    expect(parseFrontmatter('no frontmatter')).toBeNull();
  });

  it('drops a user-invoked skill from the listing but still counts it', async () => {
    const { measure } = await load('scripts/measure-plugin-footprint.mjs');
    const desc = 'Make a report. Use when asked for one.';
    const visible = measure(source({ 'plugins/p/skills/rep/SKILL.md': skill('rep', desc) }));
    const hidden = measure(source({ 'plugins/p/skills/rep/SKILL.md': skill('rep', desc, 'disable-model-invocation: true\n') }));
    expect(visible.totals.listingChars).toBe('rep'.length + desc.length);
    expect(hidden.totals.listingChars).toBe(0); // negative control: the flag is what removes it
    expect(hidden.totals.skills).toBe(1);
    expect(hidden.totals.userInvokedSkills).toBe(1);
    expect(hidden.userInvoked.map((u: { name: string }) => u.name)).toEqual(['rep']);
    expect(visible.totals.estTokens).toBe(Math.round(visible.totals.listingChars / 4));
  });

  it('flags descriptions over 300 characters and not at 300', async () => {
    const { measure, DESCRIPTION_CEILING } = await load('scripts/measure-plugin-footprint.mjs');
    expect(DESCRIPTION_CEILING).toBe(300);
    const r = measure(source({
      'plugins/p/skills/at/SKILL.md': skill('at', 'x'.repeat(300)),
      'plugins/p/skills/over/SKILL.md': skill('over', 'x'.repeat(301)),
      'plugins/p/commands/c.md': `---\nname: c\ndescription: ${'y'.repeat(301)}\n---\n`,
    }));
    expect(r.overCeiling.map((o: { name: string }) => o.name).sort()).toEqual(['c', 'over']);
  });

  it('counts agents and commands, and ignores files Claude Code does not load as skills', async () => {
    const { measure } = await load('scripts/measure-plugin-footprint.mjs');
    const r = measure(source({
      'plugins/p/agents/helper.md': '---\nname: helper\ndescription: helps\n---\n',
      'plugins/p/commands/go.md': '---\nname: go\ndescription: goes\n---\n',
      'plugins/p/commands/README.md': '# readme',
      'plugins/p/directory/skills/copy/SKILL.md': skill('copy', 'a submission copy'),
      'plugins/p/skills/real/notes.md': 'not a skill',
    }));
    expect(r.totals).toMatchObject({ skills: 0, commands: 1, agents: 1 });
    expect(r.totals.listingChars).toBe('helper'.length + 'helps'.length + 'go'.length + 'goes'.length);
  });
});

describe('ADR-507 audit-skill-frontmatter rules', () => {
  it('accepts a user-invoked skill only when a "User-invoked" section names it', async () => {
    const { isListedAsUserInvoked } = await load('scripts/audit-skill-frontmatter.mjs');
    const readme = '# P\n\n## Skills\n\n- cost-report\n\n## User-invoked skills (ADR-507)\n\n| cost-anomaly | `/p:cost-anomaly` |\n\n## Commands\n\n- cost-burn\n';
    expect(isListedAsUserInvoked(readme, 'cost-anomaly')).toBe(true);
    expect(isListedAsUserInvoked(readme, 'cost-report')).toBe(false); // named, but not in the section
    expect(isListedAsUserInvoked(readme, 'cost-burn')).toBe(false); // after the section ended
    expect(isListedAsUserInvoked(readme, 'cost')).toBe(false); // no partial-name match
    expect(isListedAsUserInvoked('', 'cost-anomaly')).toBe(false);
  });

  it('applies the 300-character ceiling', async () => {
    const { descriptionTooLong } = await load('scripts/audit-skill-frontmatter.mjs');
    expect(descriptionTooLong('x'.repeat(300))).toBe(false);
    expect(descriptionTooLong('x'.repeat(301))).toBe(true);
    expect(descriptionTooLong(undefined)).toBe(false);
  });

  it('passes on the repository: no long descriptions, every user-invoked skill documented', async () => {
    const out = spawnSync(process.execPath, ['scripts/audit-skill-frontmatter.mjs', '--format', 'json'], { cwd: REPO, encoding: 'utf8' });
    const report = JSON.parse(out.stdout);
    expect(report.findings).toEqual([]);
    expect(out.status).toBe(0);
    const { measure } = await load('scripts/measure-plugin-footprint.mjs');
    const tree = spawnSync('git', ['ls-files', 'plugins'], { cwd: REPO, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
    const { readFileSync } = await import('node:fs');
    const r = measure({ files: tree, read: (rel: string) => readFileSync(resolve(REPO, rel), 'utf8') });
    expect(r.overCeiling).toEqual([]);
    expect(r.totals.userInvokedSkills).toBeGreaterThan(0);
  });
});
