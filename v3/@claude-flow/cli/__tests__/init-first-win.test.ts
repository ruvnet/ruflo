/**
 * Adoption plan item 1: `init` ends with a snapshot of the user's own repo and
 * one prompt to paste into Claude Code. The snapshot is local-only and must
 * never fail init, so the null paths matter as much as the happy path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { snapshotProject, snapshotLines, firstPrompt } from '../src/init/first-win.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' });

describe('init first win', () => {
  let repo: string;
  let plain: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'firstwin-'));
    plain = mkdtempSync(join(tmpdir(), 'firstwin-plain-'));
    git(repo, 'init', '-q');
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    writeFileSync(join(repo, 'src', 'b.ts'), 'export const b = 1;\n');
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(repo, 'src', 'hot.ts'), `export const v = ${i};\n`);
      writeFileSync(join(repo, 'README.md'), `# r${i}\n`); // churns too, but is not code
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', `c${i}`);
    }
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(plain, { recursive: true, force: true });
  });

  it('summarises a git repo and points the prompt at the most-changed code file', () => {
    const s = snapshotProject(repo);
    expect(s).not.toBeNull();
    expect(s!.files).toBe(4);
    expect(s!.languages[0]).toBe('TypeScript');
    expect(s!.hotFile).toEqual({ path: 'src/hot.ts', changes: 3 });
    expect(s!.testCommand).toBe('npm test');
    expect(firstPrompt(s)).toContain('src/hot.ts');
    expect(firstPrompt(s)).toContain('`npm test`');
    expect(snapshotLines(s).join('\n')).toContain('Most-changed file (90 days): src/hot.ts (3 commits)');
  });

  it('returns null outside a git repo, and the prompt still reads well', () => {
    const s = snapshotProject(plain);
    expect(s).toBeNull();
    expect(snapshotLines(s)).toEqual([]);
    expect(firstPrompt(s)).toMatch(/review this repo/);
  });

  it('ignores the npm placeholder test script', () => {
    writeFileSync(join(plain, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
    git(plain, 'init', '-q');
    git(plain, 'add', '-A');
    git(plain, 'commit', '-q', '-m', 'c');
    const s = snapshotProject(plain);
    expect(s?.testCommand).toBeUndefined();
    expect(s?.hotFile).toBeUndefined();
  });
});
