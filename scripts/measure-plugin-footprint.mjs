#!/usr/bin/env node
// measure-plugin-footprint — ADR-507 §2.1. How much of every turn's context the
// ruflo plugin suite costs before the model does anything.
//
// Claude Code keeps the name and description of every skill, command and agent
// the model can invoke in context on every turn. This script reports, per
// plugin under plugins/:
//   - skills, commands and agents (and how many are user-invoked only, i.e.
//     carry `disable-model-invocation: true` and so leave the model's listing);
//   - the characters each contributes to the per-turn listing (name plus
//     description, model-visible entries only);
//   - an estimated token count (characters / 4).
// It also lists every skill or command description longer than the ADR-507
// ceiling (300 characters).
//
// USAGE
//   node scripts/measure-plugin-footprint.mjs                 # table to stdout
//   node scripts/measure-plugin-footprint.mjs --format json   # machine-readable
//   node scripts/measure-plugin-footprint.mjs --write [--label before|after]
//        writes v3/docs/validation/plugin-footprint-<date>[-<label>].md
//   node scripts/measure-plugin-footprint.mjs --ref <git-ref>  # measure a commit instead of the tree
//
// The token figure is an estimate, not a tokenizer count; it is meant for
// before/after comparison on the same estimator.
//
// EXIT CODES
//   0  measured
//   2  scan error (no plugins dir, bad args)

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const DESCRIPTION_CEILING = 300;

function parseArgs(argv) {
  const a = { format: 'table', write: false, label: '', ref: null };
  for (let i = 2; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--format') a.format = argv[++i];
    else if (v === '--write') a.write = true;
    else if (v === '--label') a.label = String(argv[++i] || '').replace(/[^\w-]/g, '');
    else if (v === '--ref') a.ref = argv[++i];
    else if (v === '--help' || v === '-h') { a.help = true; }
    else { console.error(`measure-plugin-footprint: unknown argument ${v}`); process.exit(2); }
  }
  if (a.ref !== null && !/^[\w./~^-]+$/.test(a.ref)) { console.error('measure-plugin-footprint: bad --ref'); process.exit(2); }
  return a;
}

// ── frontmatter ──────────────────────────────────────────────────────────────
// Flat YAML subset: `key: value`, quoted values, block scalars (`>`, `|`, with
// chomping indicators) and plain multi-line continuations. Enough for SKILL.md,
// command and agent frontmatter; nested maps are skipped.
export function parseFrontmatter(src) {
  const lines = src.split(/\r?\n/);
  if ((lines[0] || '').trim() !== '---') return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') { end = i; break; }
  if (end < 0) return null;
  const body = lines.slice(1, end);
  const out = {};
  for (let i = 0; i < body.length; i++) {
    const m = /^([\w-]+):[ \t]*(.*)$/.exec(body[i]);
    if (!m) continue;
    const key = m[1];
    let raw = m[2];
    const cont = [];
    let j = i + 1;
    while (j < body.length && (/^[ \t]+\S/.test(body[j]) || body[j].trim() === '')) { cont.push(body[j]); j++; }
    while (cont.length && cont[cont.length - 1].trim() === '') cont.pop();
    if (/^[>|][+-]?$/.test(raw.trim())) {
      const folded = raw.trim()[0] === '>';
      const parts = cont.map((l) => l.trim());
      raw = folded ? parts.join(' ').replace(/\s+/g, ' ') : parts.join('\n');
    } else if (cont.length) {
      raw = [raw, ...cont.map((l) => l.trim())].join(' ');
    }
    raw = raw.trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      const q = raw[0];
      raw = raw.slice(1, -1);
      raw = q === '"' ? raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : raw.replace(/''/g, "'");
    }
    out[key] = raw;
    i = j - 1;
  }
  return out;
}

export function isUserInvokedOnly(fm) {
  return !!fm && String(fm['disable-model-invocation'] || '').trim().toLowerCase() === 'true';
}

// ── sources: the working tree or a git ref ──────────────────────────────────
function treeSource() {
  const pluginsDir = join(REPO_ROOT, 'plugins');
  const files = [];
  const walk = (rel) => {
    let entries;
    try { entries = readdirSync(join(REPO_ROOT, rel)); } catch { return; }
    for (const e of entries) {
      const r = `${rel}/${e}`;
      let s;
      try { s = statSync(join(REPO_ROOT, r)); } catch { continue; }
      if (s.isDirectory()) { if (e !== 'node_modules' && !e.startsWith('.')) walk(r); }
      else files.push(r);
    }
  };
  try { statSync(pluginsDir); } catch { return null; }
  for (const p of readdirSync(pluginsDir)) {
    for (const sub of ['skills', 'commands', 'agents']) walk(`plugins/${p}/${sub}`);
  }
  return { files, read: (rel) => readFileSync(join(REPO_ROOT, rel), 'utf-8') };
}

function refSource(ref) {
  const git = (args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf-8', maxBuffer: 64 << 20 });
  const files = git(['ls-tree', '-r', '--name-only', ref, '--', 'plugins']).split('\n').filter(Boolean);
  return { files, read: (rel) => git(['show', `${ref}:${rel}`]) };
}

// skills/<name>/SKILL.md, commands/**/*.md, agents/**/*.md — what Claude Code loads.
function classify(rel) {
  const m = /^plugins\/([^/]+)\/(skills|commands|agents)\/(.+)$/.exec(rel);
  if (!m) return null;
  const [, plugin, kind, rest] = m;
  if (kind === 'skills') {
    const s = /^([^/]+)\/SKILL\.md$/.exec(rest);
    return s ? { plugin, kind: 'skill', fallbackName: s[1] } : null;
  }
  if (!rest.endsWith('.md') || /(^|\/)README\.md$/i.test(rest)) return null;
  const base = rest.replace(/\.md$/, '').split('/').pop();
  return { plugin, kind: kind === 'commands' ? 'command' : 'agent', fallbackName: base };
}

export function measure(source) {
  const plugins = new Map();
  const over = [];
  const userInvoked = [];
  const get = (p) => {
    if (!plugins.has(p)) {
      plugins.set(p, {
        plugin: p, skills: 0, commands: 0, agents: 0, userInvokedSkills: 0, userInvokedCommands: 0,
        listingChars: 0, skillChars: 0, commandChars: 0, agentChars: 0,
      });
    }
    return plugins.get(p);
  };
  for (const rel of source.files) {
    const c = classify(rel);
    if (!c) continue;
    let fm;
    try { fm = parseFrontmatter(source.read(rel)); } catch { fm = null; }
    const name = (fm && fm.name) || c.fallbackName;
    const description = (fm && fm.description) || '';
    const row = get(c.plugin);
    const hidden = c.kind !== 'agent' && isUserInvokedOnly(fm);
    if (c.kind === 'skill') { row.skills++; if (hidden) row.userInvokedSkills++; }
    else if (c.kind === 'command') { row.commands++; if (hidden) row.userInvokedCommands++; }
    else row.agents++;
    if (hidden) userInvoked.push({ plugin: c.plugin, kind: c.kind, name, file: rel });
    if (c.kind !== 'agent' && description.length > DESCRIPTION_CEILING) {
      over.push({ plugin: c.plugin, kind: c.kind, name, chars: description.length, file: rel });
    }
    if (hidden) continue;
    const chars = name.length + description.length;
    row.listingChars += chars;
    row[`${c.kind}Chars`] += chars;
  }
  const rows = [...plugins.values()].sort((a, b) => b.listingChars - a.listingChars || a.plugin.localeCompare(b.plugin));
  const totals = rows.reduce((t, r) => {
    for (const k of Object.keys(t)) t[k] += r[k];
    return t;
  }, { skills: 0, commands: 0, agents: 0, userInvokedSkills: 0, userInvokedCommands: 0, listingChars: 0, skillChars: 0, commandChars: 0, agentChars: 0 });
  const tokens = (n) => Math.round(n / 4);
  return {
    rows: rows.map((r) => ({ ...r, estTokens: tokens(r.listingChars) })),
    totals: { ...totals, estTokens: tokens(totals.listingChars) },
    overCeiling: over.sort((a, b) => b.chars - a.chars),
    userInvoked: userInvoked.sort((a, b) => (a.plugin + a.name).localeCompare(b.plugin + b.name)),
  };
}

function head(ref) {
  try { return execFileSync('git', ['rev-parse', '--short', ref || 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf-8' }).trim(); } catch { return 'unknown'; }
}

export function renderMarkdown(r, { date, label, commit, dirty }) {
  const t = r.totals;
  const L = [];
  L.push(`# Plugin footprint${label ? ` (${label})` : ''}, ${date}`, '');
  L.push(`Measured by \`node scripts/measure-plugin-footprint.mjs\` (ADR-507 §2.1) at \`${commit}\`${dirty ? ' plus uncommitted changes' : ''}.`, '');
  L.push('The listing is what Claude Code keeps in context on every turn: the name and description of each skill, command and agent the model can invoke. A skill or command with `disable-model-invocation: true` stays runnable as `/<name>` but leaves that listing, so it is not counted. Tokens are estimated as characters ÷ 4.', '');
  L.push('## Totals', '');
  L.push('| | Count |', '|---|---:|');
  L.push(`| Skills | ${t.skills} (${t.userInvokedSkills} user-invoked only) |`);
  L.push(`| Commands | ${t.commands} (${t.userInvokedCommands} user-invoked only) |`);
  L.push(`| Agents | ${t.agents} |`);
  L.push(`| Listing characters | ${t.listingChars.toLocaleString('en-US')} (skills ${t.skillChars.toLocaleString('en-US')}, commands ${t.commandChars.toLocaleString('en-US')}, agents ${t.agentChars.toLocaleString('en-US')}) |`);
  L.push(`| Estimated tokens per turn | ${t.estTokens.toLocaleString('en-US')} |`);
  L.push(`| Skill/command descriptions over ${DESCRIPTION_CEILING} characters | ${r.overCeiling.length} |`, '');
  L.push('These totals assume every ruflo plugin is enabled at once; a session pays only for the plugins it enables.', '');
  L.push('## Per plugin', '');
  L.push('| Plugin | Skills (user-invoked) | Commands (user-invoked) | Agents | Listing chars | Est. tokens |', '|---|---:|---:|---:|---:|---:|');
  for (const row of r.rows) {
    L.push(`| ${row.plugin} | ${row.skills} (${row.userInvokedSkills}) | ${row.commands} (${row.userInvokedCommands}) | ${row.agents} | ${row.listingChars.toLocaleString('en-US')} | ${row.estTokens.toLocaleString('en-US')} |`);
  }
  L.push('');
  L.push(`## Descriptions over ${DESCRIPTION_CEILING} characters`, '');
  if (!r.overCeiling.length) L.push('None.', '');
  else {
    L.push('| Plugin | Kind | Name | Characters |', '|---|---|---|---:|');
    for (const o of r.overCeiling) L.push(`| ${o.plugin} | ${o.kind} | ${o.name} | ${o.chars} |`);
    L.push('');
  }
  L.push('## User-invoked only (`disable-model-invocation: true`)', '');
  if (!r.userInvoked.length) L.push('None.', '');
  else {
    L.push('| Plugin | Kind | Name |', '|---|---|---|');
    for (const u of r.userInvoked) L.push(`| ${u.plugin} | ${u.kind} | ${u.name} |`);
    L.push('');
  }
  return L.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf-8').split('\n').slice(1, 30).join('\n')); return; }
  const source = args.ref ? refSource(args.ref) : treeSource();
  if (!source || !source.files.length) { console.error('measure-plugin-footprint: no plugins found'); process.exit(2); }
  const r = measure(source);
  if (args.format === 'json') { console.log(JSON.stringify(r, null, 2)); }
  else {
    const t = r.totals;
    console.log(`skills ${t.skills} (${t.userInvokedSkills} user-invoked) · commands ${t.commands} (${t.userInvokedCommands} user-invoked) · agents ${t.agents}`);
    console.log(`listing ${t.listingChars} chars ≈ ${t.estTokens} tokens/turn · ${r.overCeiling.length} description(s) over ${DESCRIPTION_CEILING} chars`);
    for (const row of r.rows.slice(0, 15)) {
      console.log(`  ${row.plugin.padEnd(28)} ${String(row.listingChars).padStart(6)} chars  ≈${String(row.estTokens).padStart(5)} tok  skills ${row.skills}/${row.userInvokedSkills}u  cmds ${row.commands}/${row.userInvokedCommands}u  agents ${row.agents}`);
    }
  }
  if (args.write) {
    const date = new Date().toISOString().slice(0, 10);
    const dirty = !args.ref && (() => { try { return execFileSync('git', ['status', '--porcelain', '--untracked-files=no', '--', 'plugins'], { cwd: REPO_ROOT, encoding: 'utf-8' }).trim() !== ''; } catch { return false; } })();
    const md = renderMarkdown(r, { date, label: args.label, commit: head(args.ref), dirty });
    const dir = join(REPO_ROOT, 'v3/docs/validation');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `plugin-footprint-${date}${args.label ? `-${args.label}` : ''}.md`);
    writeFileSync(file, md + '\n');
    console.error(`wrote ${file.replace(REPO_ROOT + '/', '')}`);
  }
}

// Compare realpaths: Node realpaths import.meta.url for the entry module but
// not argv[1], so a symlinked invocation path would otherwise skip main().
const isEntry = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isEntry) main();
