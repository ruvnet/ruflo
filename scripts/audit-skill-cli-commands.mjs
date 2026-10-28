#!/usr/bin/env node
/**
 * Skill ↔ CLI command reference audit. Sibling of scripts/audit-skill-mcp-tools.mjs (#4141).
 *
 * Skills tell agents to run ruflo CLI commands, for example
 * `npx @claude-flow/cli@latest hooks pre-edit --file x` or `npx ruflo@latest analyze diff`.
 * A top-level command the CLI does not have fails with `Unknown command: <name>`, and an
 * unknown subcommand prints help instead of doing the work, so an agent that follows the
 * skill silently gets nothing done.
 *
 * This guard scans every SKILL.md that ships to users:
 *   - v3/@claude-flow/cli/.claude/skills/**  (npm package, installed by init)
 *   - plugins/**                             (marketplace plugins)
 * and checks each invocation against the command tree registered by
 * v3/@claude-flow/cli/src/commands/index.ts (top-level names and aliases, and each
 * command's subcommand names and aliases).
 *
 * What counts as an invocation:
 *   - `npx [-y] @claude-flow/cli|claude-flow|ruflo[@tag] <command> [<subcommand>]` anywhere;
 *   - a line inside a fenced code block that starts with `ruflo <command>` or
 *     `claude-flow <command>` (optionally after `$ `). Bare mentions in prose are ignored.
 * Only bare lowercase words count as command or subcommand names; flags and quoted
 * arguments end the match.
 *
 * The command tree is read from the TypeScript sources, so run this with a TS loader
 * after `npm ci`:
 *   node --import tsx scripts/audit-skill-cli-commands.mjs                    # exit 1 on a NEW unknown command
 *   node --import tsx scripts/audit-skill-cli-commands.mjs --json             # machine-readable report
 *   node --import tsx scripts/audit-skill-cli-commands.mjs --update-baseline  # after fixing some
 * The vitest wrapper in scripts/__tests__/ loads the same sources natively and runs in
 * ci.yml's test ratchet on every PR.
 *
 * Known unknown commands are carried in verification/skill-cli-command-baseline.json as
 * `<skill path>::<command>` or `<skill path>::<command> <subcommand>` entries. Like
 * audit-skill-mcp-tools.mjs the baseline is identity-based: an entry that is not in it
 * fails, even if the total count is unchanged. Fixed entries never fail; they print a
 * reminder to lower the floor.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Skill trees that ship to users, relative to the repo root. */
export const SKILL_ROOTS = ['v3/@claude-flow/cli/.claude/skills', 'plugins'];

const NPX_RE = /npx\s+(?:-y\s+)?(?:@claude-flow\/cli|claude-flow|ruflo)(?:@[\w.-]+)?[ \t]+([a-z][a-z0-9-]*)(?:[ \t]+([a-z][a-z0-9-]*))?(?![\w-])/g;
const BARE_RE = /^\s*(?:\$\s+)?(?:ruflo|claude-flow)[ \t]+([a-z][a-z0-9-]*)(?:[ \t]+([a-z][a-z0-9-]*))?(?![\w-])/;

function toPosix(path) {
  return path.split(sep).join('/');
}

function commandsDir(repoRoot) {
  return join(repoRoot, 'v3', '@claude-flow', 'cli', 'src', 'commands');
}

/**
 * Top-level command names and the source file each one lives in, read from
 * commands/index.ts: the lazy `commandLoaders` map plus the eager imports.
 */
export function topLevelCommandFiles(repoRoot = DEFAULT_REPO_ROOT) {
  const index = readFileSync(join(commandsDir(repoRoot), 'index.ts'), 'utf8');
  const files = new Map();
  for (const m of index.matchAll(/'?([a-z][a-z0-9-]*)'?:\s*\(\)\s*=>\s*import\('\.\/([^']+)\.js'\)/g)) {
    files.set(m[1], m[2]);
  }
  for (const m of index.matchAll(/^import \{ (\w+)Command \} from '\.\/([^']+)\.js';/gm)) {
    if (![...files.values()].includes(m[2])) files.set(m[2], m[2]);
  }
  return files;
}

/**
 * Load the command tree from the TypeScript sources. Needs a TS-aware loader
 * (vitest, or `node --import tsx`). A module that fails to import is kept as a
 * known command with `subcommands: null` and a `loadError`, so only its name is
 * checked. A loader key whose module has no command of that name (for example
 * `appliance-advanced`, which only exports subcommands) falls back to the
 * module's default export, or to name-only checking.
 */
export async function loadCommandTree(repoRoot = DEFAULT_REPO_ROOT, importer = (url) => import(url)) {
  const tree = new Map();
  for (const [name, file] of topLevelCommandFiles(repoRoot)) {
    let entry = { aliases: [], subcommands: null, loadError: null };
    try {
      const mod = await importer(pathToFileURL(join(commandsDir(repoRoot), `${file}.ts`)).href);
      const isCommand = (v) => v && typeof v === 'object' && typeof v.name === 'string';
      const command = Object.values(mod).find((v) => isCommand(v) && v.name === name)
        ?? (isCommand(mod.default) && Array.isArray(mod.default.subcommands) ? mod.default : null);
      if (command) {
        const subcommands = new Map();
        for (const sub of command.subcommands ?? []) subcommands.set(sub.name, sub.aliases ?? []);
        entry = { aliases: command.aliases ?? [], subcommands, loadError: null };
      }
    } catch (error) {
      entry.loadError = String(error && error.message ? error.message : error).split('\n')[0];
    }
    tree.set(name, entry);
  }
  return tree;
}

/** CLI invocations in one SKILL.md body: [{ command, subcommand, line }]. */
export function extractInvocations(text) {
  const found = [];
  let inFence = false;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    for (const m of line.matchAll(NPX_RE)) found.push({ command: m[1], subcommand: m[2] ?? null, line: i + 1 });
    if (inFence && !/npx\s/.test(line)) {
      const m = line.match(BARE_RE);
      if (m) found.push({ command: m[1], subcommand: m[2] ?? null, line: i + 1 });
    }
  }
  return found;
}

/** Resolve a command name or alias to its canonical top-level name, or null. */
export function resolveCommand(tree, name) {
  if (tree.has(name)) return name;
  for (const [canonical, entry] of tree) if ((entry.aliases ?? []).includes(name)) return canonical;
  return null;
}

/** Unknown commands/subcommands for one file's invocations: [{ file, line, ref, key }]. */
export function findUnknown(tree, file, invocations) {
  const unknown = [];
  for (const inv of invocations) {
    const canonical = resolveCommand(tree, inv.command);
    if (!canonical) {
      unknown.push({ file, line: inv.line, ref: inv.command, key: `${file}::${inv.command}` });
      continue;
    }
    const subs = tree.get(canonical).subcommands;
    if (!inv.subcommand || !subs || subs.size === 0) continue;
    const known = subs.has(inv.subcommand) || [...subs.values()].some((aliases) => aliases.includes(inv.subcommand));
    if (!known) {
      const ref = `${canonical} ${inv.subcommand}`;
      unknown.push({ file, line: inv.line, ref, key: `${file}::${ref}` });
    }
  }
  return unknown;
}

function walkSkillFiles(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkSkillFiles(full, out);
    else if (entry.isFile() && entry.name === 'SKILL.md') out.push(full);
  }
  return out;
}

/** Every shipped SKILL.md, as repo-relative POSIX paths, sorted. */
export function shippedSkillFiles(repoRoot = DEFAULT_REPO_ROOT) {
  const files = [];
  for (const root of SKILL_ROOTS) walkSkillFiles(join(repoRoot, root), files);
  return files.map((f) => toPosix(relative(repoRoot, f))).sort();
}

/** Unknown CLI references across shipped skills. */
export function findUnknownRefs(tree, repoRoot = DEFAULT_REPO_ROOT) {
  const unknown = [];
  for (const file of shippedSkillFiles(repoRoot)) {
    unknown.push(...findUnknown(tree, file, extractInvocations(readFileSync(join(repoRoot, file), 'utf8'))));
  }
  return unknown;
}

/** Same contract as audit-skill-mcp-tools.mjs: ok is false only for entries missing from the baseline. */
export function evaluateAgainstBaseline(unknown, baselineEntries) {
  const known = new Set(baselineEntries);
  const current = [...new Set(unknown.map((u) => u.key))].sort();
  const currentSet = new Set(current);
  const unexpected = current.filter((key) => !known.has(key));
  const fixed = [...known].filter((key) => !currentSet.has(key)).sort();
  return { ok: unexpected.length === 0, current, unexpected, fixed };
}

export function baselinePath(repoRoot = DEFAULT_REPO_ROOT) {
  return join(repoRoot, 'verification', 'skill-cli-command-baseline.json');
}

export function readBaseline(repoRoot = DEFAULT_REPO_ROOT) {
  const file = baselinePath(repoRoot);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed.knownUnknown) ? parsed.knownUnknown : [];
}

async function main(argv) {
  const repoRoot = DEFAULT_REPO_ROOT;
  let tree;
  try {
    tree = await loadCommandTree(repoRoot);
  } catch (error) {
    console.error(`Could not load the CLI command tree: ${error.message}`);
    return 1;
  }
  const failed = [...tree.values()].filter((e) => e.loadError).length;
  if (failed * 2 > tree.size) {
    // Plain Node cannot resolve the sources' `./x.js` specifiers to `.ts`, so most
    // imports fail; partial results would be misleading.
    console.error(`${failed} of ${tree.size} CLI command modules failed to import. Run with a TS loader after npm ci: node --import tsx scripts/audit-skill-cli-commands.mjs`);
    return 1;
  }
  const unknown = findUnknownRefs(tree, repoRoot);

  if (argv.includes('--update-baseline')) {
    const knownUnknown = [...new Set(unknown.map((u) => u.key))].sort();
    writeFileSync(baselinePath(repoRoot), JSON.stringify({
      _comment: 'Monotone-decreasing baseline of shipped SKILL.md files that tell agents to run a ruflo CLI command or subcommand the CLI does not register (entries are <skill path>::<command> or <skill path>::<command> <subcommand>). Fix one, then re-run with --update-baseline to lower the floor. NEVER add entries to hide a new reference.',
      unknownCount: knownUnknown.length,
      knownUnknown,
      updatedAt: new Date().toISOString(),
    }, null, 2) + '\n', 'utf8');
    console.log(`baseline updated → ${knownUnknown.length} unknown CLI reference(s)`);
    return 0;
  }

  const result = evaluateAgainstBaseline(unknown, readBaseline(repoRoot));
  const unloadable = [...tree].filter(([, e]) => e.loadError).map(([name, e]) => `${name}: ${e.loadError}`);
  if (argv.includes('--json')) {
    console.log(JSON.stringify({
      commandCount: tree.size,
      unloadable,
      skillFilesScanned: shippedSkillFiles(repoRoot).length,
      unknownCount: result.current.length,
      unexpected: result.unexpected,
      fixed: result.fixed,
      unknown: unknown.map((u) => ({ ref: u.ref, where: `${u.file}:${u.line}` })),
    }, null, 2));
    return result.ok ? 0 : 1;
  }

  console.log(`Skill ↔ CLI command references: ${tree.size} top-level commands, ${shippedSkillFiles(repoRoot).length} shipped SKILL.md files, ${result.current.length} unknown reference(s) (baseline ${result.current.length - result.unexpected.length + result.fixed.length})`);
  if (unloadable.length) {
    const sample = unloadable.slice(0, 3).join('; ');
    console.log(`  note: subcommands not checked for ${unloadable.length} command(s) that failed to import: ${sample}${unloadable.length > 3 ? '; ...' : ''}`);
  }
  if (result.ok) {
    console.log('  ✓ no NEW unknown commands (known ones are listed in verification/skill-cli-command-baseline.json)');
  } else {
    console.log('  ✗ NEW unknown command(s). Use a command registered in v3/@claude-flow/cli/src/commands/:');
    for (const key of result.unexpected) {
      for (const u of unknown.filter((x) => x.key === key)) console.log(`      '${u.ref}'  ${u.file}:${u.line}`);
    }
  }
  if (result.fixed.length > 0) {
    console.log(`  Progress: ${result.fixed.length} baseline entr${result.fixed.length === 1 ? 'y is' : 'ies are'} fixed. Run: node --import tsx scripts/audit-skill-cli-commands.mjs --update-baseline`);
  }
  return result.ok ? 0 : 1;
}

// Real paths, as in audit-skill-mcp-tools.mjs: argv can keep a symlinked path
// (macOS /var -> /private/var) that would never equal the canonical module URL.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
