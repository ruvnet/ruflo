/**
 * ADR-507 — plugin footprint: the measure script, the 300-character
 * description ceiling, and the "user-invoked skills are listed in the README"
 * rule enforced by scripts/audit-skill-frontmatter.mjs.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

  // Run the real CLI against a fixture tree, so the gate's wiring (not just
  // the helpers) is under test: disabling any check in auditSkill/auditCommands
  // fails one of these.
  function fixture(readmeRow: boolean) {
    const dir = mkdtempSync(join(tmpdir(), 'adr507-audit-'));
    const put = (rel: string, body: string) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    };
    const longFolded = ('word '.repeat(61)).trim(); // 304 chars once unfolded
    put('p/skills/long/SKILL.md', `---\nname: long\ndescription: >\n  ${longFolded.slice(0, 149)}\n  ${longFolded.slice(150)}\nallowed-tools: Bash\n---\n`);
    put('p/skills/hidden/SKILL.md', skill('hidden', 'A report. Use when asked.', 'disable-model-invocation: true\n'));
    put('p/skills/ok/SKILL.md', skill('ok', 'Fine. Use when fine.'));
    put('p/commands/big.md', `---\nname: big\ndescription: |\n  ${'z'.repeat(200)}\n  ${'z'.repeat(110)}\n---\n`);
    put('p/README.md', readmeRow ? '# P\n\n## User-invoked skills\n\n- `hidden`\n' : '# P\n\n## Skills\n\n- hidden\n');
    return dir;
  }
  const audit = (dir: string, script = 'scripts/audit-skill-frontmatter.mjs') =>
    spawnSync(process.execPath, [script, '--format', 'json', '--plugins-dir', dir], { cwd: REPO, encoding: 'utf8' });

  it('the CLI fails a fixture with a long folded description, an unlisted user-invoked skill and a long command', () => {
    const dir = fixture(false);
    try {
      const out = audit(dir);
      expect(out.status).toBe(1);
      const report = JSON.parse(out.stdout);
      expect(report.skillsScanned).toBe(3);
      const checks = (name: string) =>
        report.findings.find((f: { skill: string }) => f.skill === name)?.violations.map((v: { check: string }) => v.check) ?? [];
      expect(checks('long')).toContain('description length');
      expect(checks('hidden')).toContain('user-invoked skill listed in README');
      expect(checks('commands/big.md')).toContain('description length');
      expect(checks('ok')).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('control: the README row clears the user-invoked finding, the length findings stay', () => {
    const dir = fixture(true);
    try {
      const report = JSON.parse(audit(dir).stdout);
      const flat = report.findings.flatMap((f: { skill: string; violations: { check: string }[] }) => f.violations.map((v) => `${f.skill}:${v.check}`));
      expect(flat.sort()).toEqual(['commands/big.md:description length', 'long:description length']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('still runs the gate when invoked through a symlinked path', () => {
    const dir = fixture(false);
    const link = join(tmpdir(), `adr507-link-${process.pid}-${Date.now()}`);
    try {
      symlinkSync(REPO, link);
      for (const script of ['scripts/audit-skill-frontmatter.mjs', 'scripts/measure-plugin-footprint.mjs']) {
        const args = script.includes('audit') ? ['--format', 'json', '--plugins-dir', dir] : ['--format', 'json'];
        const out = spawnSync(process.execPath, [join(link, script), ...args], { encoding: 'utf8' });
        expect(out.stdout.trim().length, script).toBeGreaterThan(0); // main() ran
        if (script.includes('audit')) expect(out.status).toBe(1);
        else expect(JSON.parse(out.stdout).totals.skills).toBeGreaterThan(0);
      }
    } finally {
      rmSync(link, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes on the repository: no long descriptions, every user-invoked skill documented', async () => {
    const out = spawnSync(process.execPath, ['scripts/audit-skill-frontmatter.mjs', '--format', 'json'], { cwd: REPO, encoding: 'utf8' });
    const report = JSON.parse(out.stdout);
    expect(report.skillsScanned).toBeGreaterThan(100); // zero checks must not read as zero violations
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
