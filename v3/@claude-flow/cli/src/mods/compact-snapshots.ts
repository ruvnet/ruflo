/**
 * ADR-505: `ruflo doctor` check for ruflo-mods compaction snapshots.
 *
 * The `compactSnapshot` option (default on) writes conversation text to
 * `.claude-flow/sessions/compactions/`. `ruflo init` gitignores it through
 * `.claude-flow/.gitignore` (`sessions/`); a project whose ignore rules lost
 * that would commit transcripts. Warn-only: when snapshots exist and git does
 * not ignore them. No snapshots, or not a git work tree, is a pass.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const COMPACTIONS_DIR = '.claude-flow/sessions/compactions';

export type SnapshotHealth = { status: 'pass' | 'warn'; message: string; fix?: string };

/** `ignored`: git ignores the path; `not-ignored`: it would be committed; `no-git`: not a work tree or git missing. */
export type IgnoreState = 'ignored' | 'not-ignored' | 'no-git';

/** `git check-ignore -q`: exit 0 ignored, 1 not ignored, anything else (128: not a repo; ENOENT: no git) no answer. */
export function gitIgnoreState(root: string, relPath: string): IgnoreState {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', relPath], { cwd: root, stdio: 'ignore', timeout: 5000 });
    return 'ignored';
  } catch (error) {
    return (error as { status?: unknown }).status === 1 ? 'not-ignored' : 'no-git';
  }
}

export function compactSnapshotHealth(root: string, ignoreState: (root: string, relPath: string) => IgnoreState = gitIgnoreState): SnapshotHealth {
  let files: string[];
  try {
    files = readdirSync(join(root, COMPACTIONS_DIR)).filter((name) => name.endsWith('.jsonl'));
  } catch {
    files = [];
  }
  if (files.length === 0) return { status: 'pass', message: 'no compaction snapshots in this project' };
  const sample = `${COMPACTIONS_DIR}/${files.sort()[0]}`;
  const state = ignoreState(root, sample);
  if (state === 'not-ignored') {
    return {
      status: 'warn',
      message: `${files.length} compaction snapshot(s) in ${COMPACTIONS_DIR}/ hold conversation text and git does not ignore them`,
      fix: 'add .claude-flow/ (or .claude-flow/sessions/) to .gitignore, or set the ruflo-mods compactSnapshot option to false',
    };
  }
  return { status: 'pass', message: `${files.length} compaction snapshot(s), ${state === 'ignored' ? 'ignored by git' : 'not in a git work tree'}` };
}
