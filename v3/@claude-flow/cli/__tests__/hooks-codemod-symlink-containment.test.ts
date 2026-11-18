/**
 * Regression test (#4346, CWE-59): `hooks_codemod`'s project-root containment
 * compared lexically resolved paths only, so a symlink inside the project that
 * points outside it passed the check and the codemod read-and-wrote the file
 * outside the root. Covers the single-file, files[] and glob branches.
 *
 * Real filesystem I/O (temp dirs + symlinks), no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'fs';
import * as nodeFs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { hooksCodemod } from '../src/mcp-tools/hooks-tools.js';

const ORIGINAL = "console.log('secret');\n";
const hasGlobSync = typeof (nodeFs as { globSync?: unknown }).globSync === 'function';

describe('hooks_codemod symlink containment (#4346)', () => {
  let root: string;
  let projectDir: string;
  let outsideDir: string;
  let outsideFile: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'codemod-symlink-'));
    projectDir = join(root, 'project');
    outsideDir = join(root, 'outside');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    outsideFile = join(outsideDir, 'secret.ts');
    writeFileSync(outsideFile, ORIGINAL);
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = projectDir;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(root, { recursive: true, force: true });
  });

  const run = async (params: Record<string, unknown>) =>
    (await hooksCodemod.handler({ intent: 'remove-console', ...params })) as Record<string, unknown>;

  it('refuses a file symlink inside the project that points outside it', async () => {
    symlinkSync(outsideFile, join(projectDir, 'link.ts'));

    const result = await run({ file: 'link.ts' });

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/escapes project root/);
    expect(readFileSync(outsideFile, 'utf-8')).toBe(ORIGINAL);
  });

  it('refuses a path under a directory symlink that points outside (files[] form)', async () => {
    symlinkSync(outsideDir, join(projectDir, 'dirlink'), 'dir');

    const result = await run({ files: [join(projectDir, 'dirlink', 'secret.ts')] });

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/escapes project root/);
    expect(readFileSync(outsideFile, 'utf-8')).toBe(ORIGINAL);
  });

  it.skipIf(!hasGlobSync)('skips glob matches that resolve outside the project through a symlink', async () => {
    symlinkSync(outsideFile, join(projectDir, 'link.ts'));
    writeFileSync(join(projectDir, 'inside.ts'), "console.log('inside');\n");

    const result = await run({ glob: '*.ts' });

    const files = (result.results as Array<Record<string, unknown>>).map(r => r.file);
    expect(files).toEqual(['inside.ts']);
    expect(readFileSync(outsideFile, 'utf-8')).toBe(ORIGINAL);
  });

  it('still allows a symlink that stays inside the project (control)', async () => {
    mkdirSync(join(projectDir, 'src'));
    const real = join(projectDir, 'src', 'real.ts');
    writeFileSync(real, "console.log('inside');\n");
    symlinkSync(real, join(projectDir, 'alias.ts'));

    const result = await run({ file: 'alias.ts' });

    expect(result.success).toBe(true);
    expect(readFileSync(real, 'utf-8')).not.toMatch(/console\.log/);
  });

  it('still works when the project root itself is reached through a symlink (control)', async () => {
    const rootLink = join(root, 'project-link');
    symlinkSync(projectDir, rootLink, 'dir');
    process.env.CLAUDE_FLOW_CWD = rootLink;
    writeFileSync(join(projectDir, 'ok.ts'), "console.log('inside');\n");

    const result = await run({ file: 'ok.ts' });

    expect(result.success).toBe(true);
    expect(readFileSync(join(projectDir, 'ok.ts'), 'utf-8')).not.toMatch(/console\.log/);
  });
});
