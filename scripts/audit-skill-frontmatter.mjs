#!/usr/bin/env node
// audit-skill-frontmatter — fleet-wide check that every plugins/*/skills/*/SKILL.md
// has the required frontmatter fields with valid values.
//
// Each plugin's own smoke catches missing fields in ITS skills. This audit
// catches violations that escape per-plugin coverage:
//   - A new plugin authored without a smoke contract.
//   - A skill added to an existing plugin that updated its smoke's count
//     in step 2 but forgot to add a frontmatter check.
//   - Edits that delete a required field after smoke was authored.
//
// USAGE
//   node scripts/audit-skill-frontmatter.mjs                  # all skills
//   node scripts/audit-skill-frontmatter.mjs --format json    # machine-readable
//   node scripts/audit-skill-frontmatter.mjs --only ruflo-cost-tracker
//   node scripts/audit-skill-frontmatter.mjs --plugins-dir <dir>  # audit another tree (tests)
//
// CHECKS per SKILL.md
//   1. File has a `---` frontmatter block at the top.
//   2. `name:` field present and non-empty.
//   3. `description:` field present and non-empty.
//   4. `allowed-tools:` field present (security — no implicit "all tools").
//   5. `allowed-tools:` is NOT a wildcard (`*`).
//   6. `name:` value matches the directory name (drift guard).
//   7. `description:` is at most 300 characters (ADR-507 §2.3). Also checked
//      for every plugins/*/commands/*.md, since commands share the per-turn
//      listing. Multi-line (`>`, `|`) descriptions are measured unfolded.
//   8. A skill with `disable-model-invocation: true` is named in a
//      "User-invoked" section of its plugin README (ADR-507 §3), so a person
//      can find the `/<skill>` the model no longer discovers on its own.
//
// EXIT CODES
//   0  no violations
//   1  at least one violation found
//   2  scan error (no plugins dir)

import { readdirSync, statSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter as parseFullFrontmatter, isUserInvokedOnly, DESCRIPTION_CEILING } from './measure-plugin-footprint.mjs';

// ADR-507 §3: the text of the README section(s) whose heading says "user-invoked".
export function userInvokedSection(readme) {
  const lines = String(readme || '').split(/\r?\n/);
  const out = [];
  let level = 0;
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      if (/user[- ]invoked/i.test(h[2])) { level = h[1].length; continue; }
      if (level && h[1].length <= level) level = 0;
    }
    if (level) out.push(line);
  }
  return out.join('\n');
}

export function isListedAsUserInvoked(readme, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w-])${esc}($|[^\\w-])`).test(userInvokedSection(readme));
}

export function descriptionTooLong(description) {
  return typeof description === 'string' && description.length > DESCRIPTION_CEILING;
}

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPTS_DIR);

const ARGS = (() => {
  const a = { format: 'table', only: null, pluginsDir: join(REPO_ROOT, 'plugins') };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--format') a.format = process.argv[++i];
    else if (v === '--only') {
      a.only = new Set((process.argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean));
    } else if (v === '--plugins-dir') {
      const d = process.argv[++i];
      if (!d) { console.error('audit-skill-frontmatter: --plugins-dir needs a directory'); process.exit(2); }
      a.pluginsDir = resolve(d);
    }
  }
  return a;
})();
const PLUGINS_DIR = ARGS.pluginsDir;

function discoverSkills() {
  const out = [];
  let plugins;
  try { plugins = readdirSync(PLUGINS_DIR); } catch { return out; }
  for (const plugin of plugins) {
    if (ARGS.only && !ARGS.only.has(plugin)) continue;
    const skillsDir = join(PLUGINS_DIR, plugin, 'skills');
    let stat;
    try { stat = statSync(skillsDir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    let entries;
    try { entries = readdirSync(skillsDir); } catch { continue; }
    for (const skillDir of entries) {
      const skillPath = join(skillsDir, skillDir);
      let s;
      try { s = statSync(skillPath); } catch { continue; }
      if (!s.isDirectory()) continue;
      const md = join(skillPath, 'SKILL.md');
      out.push({ plugin, skillDir, md, exists: existsSync(md) });
    }
  }
  return out.sort((a, b) => (a.plugin + a.skillDir).localeCompare(b.plugin + b.skillDir));
}

function existsSync(p) {
  try { statSync(p); return true; } catch { return false; }
}

function parseFrontmatter(src) {
  // First non-empty content must be `---`. Everything until the next `---`
  // is YAML-ish key:value pairs (we only need flat keys).
  const lines = src.split(/\r?\n/);
  if (lines[0].trim() !== '---') return null;
  const fields = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return fields;
    const m = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
    if (m) fields[m[1]] = m[2].trim();
  }
  return null; // never closed
}

function auditSkill(skill) {
  const violations = [];
  if (!skill.exists) {
    violations.push({ check: 'SKILL.md exists', detail: `no SKILL.md in skills/${skill.skillDir}/` });
    return violations;
  }
  let src;
  try { src = readFileSync(skill.md, 'utf-8'); } catch (e) {
    violations.push({ check: 'readable', detail: e.message });
    return violations;
  }
  const fm = parseFrontmatter(src);
  if (!fm) {
    violations.push({ check: 'frontmatter block', detail: 'missing or unclosed `---` block' });
    return violations;
  }
  if (!fm.name) violations.push({ check: 'name field', detail: 'missing or empty' });
  if (!fm.description) violations.push({ check: 'description field', detail: 'missing or empty' });
  if (fm['allowed-tools'] === undefined) {
    violations.push({ check: 'allowed-tools field', detail: 'missing (security — no implicit "all tools")' });
  } else if (fm['allowed-tools'].trim() === '*') {
    violations.push({ check: 'allowed-tools wildcard', detail: 'value is `*` — explicit list required' });
  }
  if (fm.name && fm.name !== skill.skillDir) {
    violations.push({
      check: 'name matches directory',
      detail: `frontmatter name="${fm.name}" but directory is "${skill.skillDir}"`,
    });
  }
  // ADR-507: measure the unfolded description and the user-invoked flag with
  // the full parser — the flat one above reads a `>` block as the literal `>`.
  const full = parseFullFrontmatter(src) || {};
  if (descriptionTooLong(full.description)) {
    violations.push({
      check: 'description length',
      detail: `${full.description.length} chars > ${DESCRIPTION_CEILING} (ADR-507: one sentence of what it does and when to use it)`,
    });
  }
  if (isUserInvokedOnly(full)) {
    const name = fm.name || skill.skillDir;
    let readme = '';
    try { readme = readFileSync(join(PLUGINS_DIR, skill.plugin, 'README.md'), 'utf-8'); } catch {}
    if (!isListedAsUserInvoked(readme, name)) {
      violations.push({
        check: 'user-invoked skill listed in README',
        detail: `disable-model-invocation: true but "${name}" is not named under a "User-invoked" heading in plugins/${skill.plugin}/README.md`,
      });
    }
  }
  return violations;
}

// ADR-507 §2.3: commands share the per-turn listing, so their descriptions get the same ceiling.
function auditCommands() {
  const out = [];
  let plugins;
  try { plugins = readdirSync(PLUGINS_DIR); } catch { return out; }
  for (const plugin of plugins) {
    if (ARGS.only && !ARGS.only.has(plugin)) continue;
    const dir = join(PLUGINS_DIR, plugin, 'commands');
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const e of entries) {
      if (!e.endsWith('.md')) continue;
      let src;
      try { src = readFileSync(join(dir, e), 'utf-8'); } catch { continue; }
      const fm = parseFullFrontmatter(src);
      if (fm && descriptionTooLong(fm.description)) {
        out.push({
          plugin,
          skill: `commands/${e}`,
          file: join(dir, e).replace(REPO_ROOT + '/', ''),
          violations: [{ check: 'description length', detail: `${fm.description.length} chars > ${DESCRIPTION_CEILING} (ADR-507)` }],
        });
      }
    }
  }
  return out;
}

function main() {
  const skills = discoverSkills();
  if (skills.length === 0) {
    console.error('audit-skill-frontmatter: no plugins/*/skills/*/SKILL.md found');
    process.exit(2);
  }
  const findings = [];
  for (const s of skills) {
    const v = auditSkill(s);
    if (v.length > 0) {
      findings.push({
        plugin: s.plugin,
        skill: s.skillDir,
        file: s.md.replace(REPO_ROOT + '/', ''),
        violations: v,
      });
    }
  }
  findings.push(...auditCommands());

  if (ARGS.format === 'json') {
    console.log(JSON.stringify({
      skillsScanned: skills.length,
      pluginCount: new Set(skills.map((s) => s.plugin)).size,
      filesWithViolations: findings.length,
      findings,
      generatedAt: new Date().toISOString(),
    }, null, 2));
  } else {
    console.log('# audit-skill-frontmatter');
    console.log('');
    const pc = new Set(skills.map((s) => s.plugin)).size;
    console.log(`Scanned **${skills.length}** SKILL.md files across **${pc}** plugins.`);
    console.log('');
    if (findings.length === 0) {
      console.log('✓ Every SKILL.md has valid frontmatter:');
      console.log('  - name / description / allowed-tools all present and non-empty');
      console.log('  - no wildcard allowed-tools');
      console.log('  - name matches enclosing directory');
      console.log(`  - skill and command descriptions within ${DESCRIPTION_CEILING} chars`);
      console.log('  - every user-invoked (disable-model-invocation) skill named in its plugin README');
    } else {
      console.log(`⚠ Found ${findings.length} skill(s) with frontmatter violations:`);
      console.log('');
      for (const f of findings) {
        console.log(`## ${f.file}`);
        for (const v of f.violations) {
          console.log(`  - ${v.check}: ${v.detail}`);
        }
        console.log('');
      }
    }
    console.log('');
  }
  process.exit(findings.length > 0 ? 1 : 0);
}

// Run main() only when executed, not when imported. Node realpaths
// import.meta.url for the entry module but leaves argv[1] as typed, so compare
// realpaths: a symlinked invocation path must still run the gate.
export function isEntryPoint(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try { return realpathSync(argv1) === realpathSync(fileURLToPath(metaUrl)); } catch { return false; }
}

if (isEntryPoint(import.meta.url)) main();
