/**
 * The concrete result `ruflo init` ends with (adoption plan item 1): a quick,
 * local snapshot of the user's own project, plus one prompt to paste into
 * Claude Code. Replaces a list of commands with something about *their* repo.
 *
 * Local only: `git` with argument arrays (no shell), a hard timeout per call,
 * no network. Any failure returns null and init prints nothing extra.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

export interface ProjectSnapshot {
  files: number;
  languages: string[];
  hotFile?: { path: string; changes: number };
  testCommand?: string;
}

const LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin', '.rb': 'Ruby', '.php': 'PHP',
  '.cs': 'C#', '.cpp': 'C++', '.cc': 'C++', '.c': 'C', '.h': 'C', '.swift': 'Swift', '.scala': 'Scala',
  '.vue': 'Vue', '.svelte': 'Svelte', '.dart': 'Dart', '.ex': 'Elixir', '.exs': 'Elixir', '.lua': 'Lua',
};

// Files a "riskiest module" suggestion should never point at.
const NOT_CODE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|CHANGELOG[^/]*|README[^/]*|\.github\/|\.claude\/|\.claude-flow\/|dist\/|build\/|node_modules\/)/i;

function git(cwd: string, args: string[], timeoutMs: number): string | null {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 && typeof r.stdout === 'string' ? r.stdout : null;
}

function testCommandFor(cwd: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    const t = pkg.scripts?.test;
    if (t && !/no test specified/i.test(t)) return 'npm test';
  } catch { /* not a node project */ }
  if (existsSync(join(cwd, 'Cargo.toml'))) return 'cargo test';
  if (existsSync(join(cwd, 'go.mod'))) return 'go test ./...';
  if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'pytest.ini'))) return 'pytest';
  return undefined;
}

/** Snapshot of the project at `cwd`, or null when it is not a git repo with code. */
export function snapshotProject(cwd: string, timeoutMs = 2000): ProjectSnapshot | null {
  try {
    const listed = git(cwd, ['ls-files', '-z'], timeoutMs);
    if (!listed) return null;
    const files = listed.split('\0').filter(Boolean);
    if (files.length === 0) return null;

    const counts = new Map<string, number>();
    for (const f of files) {
      const lang = LANGUAGE[extname(f).toLowerCase()];
      if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
    }
    const languages = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => l);

    // Most-changed code file in the last 90 days (bounded to 500 commits).
    let hotFile: ProjectSnapshot['hotFile'];
    const log = git(cwd, ['log', '--since=90.days', '--max-count=500', '--name-only', '--pretty=format:'], timeoutMs);
    if (log) {
      const tracked = new Set(files);
      const churn = new Map<string, number>();
      for (const line of log.split('\n')) {
        const p = line.trim();
        if (!p || NOT_CODE.test(p) || !tracked.has(p) || !LANGUAGE[extname(p).toLowerCase()]) continue;
        churn.set(p, (churn.get(p) ?? 0) + 1);
      }
      const top = [...churn.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] >= 2) hotFile = { path: top[0], changes: top[1] };
    }

    return { files: files.length, languages, hotFile, testCommand: testCommandFor(cwd) };
  } catch {
    return null;
  }
}

/** The one prompt to paste into Claude Code, specific to this project. */
export function firstPrompt(s: ProjectSnapshot | null): string {
  if (s?.hotFile) {
    const verify = s.testCommand ? ` and run \`${s.testCommand}\` to prove it` : '';
    return `Use a ruflo swarm to review ${s.hotFile.path} (the most-changed file here): find the riskiest logic, add tests for it${verify}, and summarise what you changed.`;
  }
  return 'Use a ruflo swarm to review this repo: find the riskiest module, write tests for it, and summarise what you changed.';
}

/** Lines for init's closing summary. Empty when there is nothing useful to say. */
export function snapshotLines(s: ProjectSnapshot | null): string[] {
  if (!s) return [];
  const lines = [`${s.files.toLocaleString('en-US')} tracked file${s.files === 1 ? '' : 's'}${s.languages.length ? ` · ${s.languages.join(', ')}` : ''}`];
  if (s.hotFile) lines.push(`Most-changed file (90 days): ${s.hotFile.path} (${s.hotFile.changes} commits)`);
  if (s.testCommand) lines.push(`Tests: ${s.testCommand}`);
  return lines;
}
