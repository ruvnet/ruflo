/**
 * ADR-545 — `ruflo init repin`: move an existing project's refs to ruflo's own
 * packages (`@claude-flow/cli`, `claude-flow`, `ruflo`) off floating tags and
 * onto the running CLI's exact version (or back to `@latest` with
 * `--channel latest`).
 *
 * Scope is deliberately narrow: `.claude/settings.json`, `.mcp.json`,
 * `CLAUDE.md` and the files directly in `.claude/helpers/`. Only the
 * specifier inside a matching ref changes; every other byte of every file is
 * preserved. Re-running is a no-op.
 *
 * Not rewritten, and reported as skipped:
 *  - the signed critical helpers (their hashes are in helpers.manifest.json;
 *    a rewritten copy would be flagged as tampered and re-copied on the next
 *    CLI start, undoing the pin);
 *  - JSON lines where a ref is an object KEY (e.g. a stale `claude-flow@alpha`
 *    MCP server name — that is a name, not a version, and init's own
 *    stale-key cleanup looks for it);
 *  - settings.json hook commands in the runaway `npx … hooks <sub>` form
 *    (#2448). Pinning would hide them from the migration that replaces them
 *    with the local helper, so the report points at `init upgrade --settings`.
 */
import * as fs from 'fs';
import * as path from 'path';

import { CRITICAL_HELPERS, HELPERS_STAMP_FILE } from './helper-refresh.js';
import { HELPERS_MANIFEST_FILE } from './helper-signing.js';
import { isExactVersion, pinnedVersion, rewriteOurRefs, type RefChange, type ReleaseChannel } from './pinning.js';

export type RepinFileStatus = 'changed' | 'unchanged' | 'skipped' | 'missing';

export interface RepinSkippedLine {
  line: number;
  text: string;
  reason: string;
}

export interface RepinFileReport {
  /** Project-relative path, forward slashes. */
  file: string;
  status: RepinFileStatus;
  reason?: string;
  changes: RefChange[];
  skippedLines: RepinSkippedLine[];
}

export interface RepinReport {
  /** Exact version, or `latest`. */
  target: string;
  dryRun: boolean;
  files: RepinFileReport[];
  changedLines: number;
  changedFiles: number;
}

export interface RepinOptions {
  channel?: ReleaseChannel;
  /** Defaults to the running CLI's version. */
  version?: string | null;
  dryRun?: boolean;
}

/** Larger files in .claude/helpers are not ours; never read them whole. */
const MAX_HELPER_BYTES = 1024 * 1024;

/** A ref used as a JSON object key: `"claude-flow@alpha": {`. */
const JSON_KEY_REF_RE = /"[^"]*(?:@claude-flow\/cli|claude-flow|ruflo)@[^"]*"\s*:/;

/** #2448 runaway forms, matched with any specifier (the migration's own regexes only accept @latest). */
const RUNAWAY_HOOK_RE = /npx\s+(?:--?\S+\s+){0,10}@?claude-flow(?:\/cli)?@\S+\s+hooks\s+\S+/;

/** Whether `file` (a basename in .claude/helpers) is covered by the signed manifest. */
export function isSignedHelper(file: string): boolean {
  return (CRITICAL_HELPERS as readonly string[]).includes(file)
    || file === HELPERS_MANIFEST_FILE
    || file === HELPERS_STAMP_FILE;
}

export function resolveRepinTarget(options: RepinOptions = {}): string {
  if (options.channel === 'latest') return 'latest';
  const version = options.version === undefined ? pinnedVersion() : options.version;
  if (!isExactVersion(version)) {
    throw new Error('Cannot determine the running CLI version to pin to; pass --channel latest or run a published ruflo');
  }
  return version;
}

export function repinProject(targetDir: string, options: RepinOptions = {}): RepinReport {
  const target = resolveRepinTarget(options);
  const dryRun = options.dryRun === true;
  const files: RepinFileReport[] = [
    repinFile(targetDir, '.claude/settings.json', target, dryRun, 'settings'),
    repinFile(targetDir, '.mcp.json', target, dryRun, 'json'),
    repinFile(targetDir, 'CLAUDE.md', target, dryRun, 'text'),
    ...repinHelpers(targetDir, target, dryRun),
  ];
  const changed = files.filter((f) => f.status === 'changed');
  return {
    target,
    dryRun,
    files,
    changedFiles: changed.length,
    changedLines: changed.reduce((n, f) => n + f.changes.length, 0),
  };
}

type FileKind = 'settings' | 'json' | 'text';

function repinFile(targetDir: string, rel: string, target: string, dryRun: boolean, kind: FileKind): RepinFileReport {
  const report: RepinFileReport = { file: rel, status: 'unchanged', changes: [], skippedLines: [] };
  const abs = path.join(targetDir, rel);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(abs);
  } catch {
    return { ...report, status: 'missing' };
  }
  // Never follow a symlink out of the project.
  if (!stat.isFile()) return { ...report, status: 'skipped', reason: 'not a regular file' };
  if (stat.size > MAX_HELPER_BYTES) return { ...report, status: 'skipped', reason: 'larger than 1 MiB' };
  const raw = fs.readFileSync(abs);
  if (raw.includes(0)) return { ...report, status: 'skipped', reason: 'binary file' };
  const original = raw.toString('utf-8');

  const filter = (line: string, index: number): boolean => {
    if (kind === 'text') return true;
    let reason: string | null = null;
    if (JSON_KEY_REF_RE.test(line)) reason = 'ref is a JSON key (a server name, not a version)';
    else if (kind === 'settings' && RUNAWAY_HOOK_RE.test(line)) {
      reason = 'runaway `npx … hooks` command (#2448): run `ruflo init upgrade --settings` to replace it with the local helper';
    }
    if (reason && rewriteOurRefs(line, target).changes.length > 0) {
      report.skippedLines.push({ line: index + 1, text: line, reason });
    }
    return reason === null;
  };

  // A user's CLAUDE.md may mention old releases in prose; bump exact pins only on invocation lines there.
  // Helper scripts execute their npx lines, so untagged runs float too; pin them there.
  const isHelper = rel.startsWith('.claude/helpers/');
  const { text, changes } = rewriteOurRefs(original, target, filter, kind === 'text' && rel === 'CLAUDE.md' ? 'npx-lines' : 'all', isHelper);
  report.changes = changes;
  if (changes.length === 0) return report;
  if (kind !== 'text') {
    // The rewrite only touches a version inside a string, but prove the file is still valid JSON.
    try { JSON.parse(text); } catch { return { ...report, changes: [], status: 'skipped', reason: 'result would not parse as JSON' }; }
  }
  if (!dryRun) fs.writeFileSync(abs, text, 'utf-8');
  return { ...report, status: 'changed' };
}

function repinHelpers(targetDir: string, target: string, dryRun: boolean): RepinFileReport[] {
  const dir = path.join(targetDir, '.claude', 'helpers');
  let names: string[];
  try {
    if (!fs.lstatSync(dir).isDirectory()) return [];
    names = fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
  const out: RepinFileReport[] = [];
  for (const name of names) {
    const rel = `.claude/helpers/${name}`;
    if (isSignedHelper(name)) {
      const probe = safeRead(path.join(dir, name));
      // Report only when the signed file actually carries a floating ref, so the user knows why it stays.
      if (probe !== null && rewriteOurRefs(probe, target).changes.length > 0) {
        out.push({ file: rel, status: 'skipped', reason: 'signed helper (helpers.manifest.json); refreshed from the package, never edited in place', changes: [], skippedLines: [] });
      }
      continue;
    }
    const report = repinFile(targetDir, rel, target, dryRun, 'text');
    if (report.status !== 'missing' && (report.status !== 'skipped' || report.reason !== 'not a regular file')) out.push(report);
  }
  return out;
}

function safeRead(abs: string): string | null {
  try {
    const stat = fs.lstatSync(abs);
    if (!stat.isFile() || stat.size > MAX_HELPER_BYTES) return null;
    return fs.readFileSync(abs, 'utf-8');
  } catch {
    return null;
  }
}

/** Human-readable report lines (one per changed or skipped line). */
export function formatRepinReport(report: RepinReport): string[] {
  const lines: string[] = [];
  const verb = report.dryRun ? 'would change' : 'changed';
  for (const f of report.files) {
    if (f.status === 'changed') {
      lines.push(`${f.file}: ${verb} ${f.changes.length} line(s)`);
      for (const c of f.changes) {
        lines.push(`  ${f.file}:${c.line}`);
        lines.push(`    - ${c.before.trim()}`);
        lines.push(`    + ${c.after.trim()}`);
      }
    } else if (f.status === 'skipped' && f.reason) {
      lines.push(`${f.file}: skipped (${f.reason})`);
    }
    for (const s of f.skippedLines) {
      lines.push(`  ${f.file}:${s.line} left as is: ${s.reason}`);
    }
  }
  return lines;
}
