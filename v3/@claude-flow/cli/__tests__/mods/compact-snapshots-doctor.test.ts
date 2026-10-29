/**
 * ADR-505 — `ruflo doctor` warns when ruflo-mods compaction snapshots exist and git does not ignore them.
 * Real git, real temp directories: the check shells `git check-ignore`, so a fake would prove nothing.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { COMPACTIONS_DIR, compactSnapshotHealth } from '../../src/mods/compact-snapshots.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(opts: { git: boolean; snapshot: boolean; nestedIgnore?: boolean; rootIgnore?: string }) {
  const root = mkdtempSync(join(tmpdir(), 'adr505-'));
  dirs.push(root);
  if (opts.git) execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, '.claude-flow'), { recursive: true });
  if (opts.nestedIgnore) writeFileSync(join(root, '.claude-flow', '.gitignore'), 'data/\nsessions/\n');
  if (opts.rootIgnore !== undefined) writeFileSync(join(root, '.gitignore'), opts.rootIgnore);
  if (opts.snapshot) {
    mkdirSync(join(root, COMPACTIONS_DIR), { recursive: true });
    writeFileSync(join(root, COMPACTIONS_DIR, 'snapshot-0.jsonl'), '{"v":1}\n');
  }
  return root;
}

describe('compaction snapshot doctor check (ADR-505)', () => {
  it('passes with no snapshots, even when nothing is ignored', () => {
    expect(compactSnapshotHealth(project({ git: true, snapshot: false })).status).toBe('pass');
  });

  it('warns when snapshots exist and git would commit them', () => {
    const health = compactSnapshotHealth(project({ git: true, snapshot: true }));
    expect(health.status).toBe('warn');
    expect(health.message).toContain('1 compaction snapshot(s)');
    expect(health.fix).toContain('.gitignore');
  });

  it('passes when ruflo init’s nested .claude-flow/.gitignore covers sessions/ (no root entry needed)', () => {
    expect(compactSnapshotHealth(project({ git: true, snapshot: true, nestedIgnore: true }))).toMatchObject({ status: 'pass', message: expect.stringContaining('ignored by git') });
  });

  it('passes when the root .gitignore names .claude-flow/', () => {
    expect(compactSnapshotHealth(project({ git: true, snapshot: true, rootIgnore: '.claude-flow/\n' })).status).toBe('pass');
  });

  it('passes outside a git work tree', () => {
    expect(compactSnapshotHealth(project({ git: false, snapshot: true }), () => 'no-git')).toMatchObject({ status: 'pass', message: expect.stringContaining('not in a git work tree') });
  });
});
