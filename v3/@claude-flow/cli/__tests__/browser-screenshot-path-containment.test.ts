/**
 * SECURITY: browser_screenshot wrote its image to any caller-named path,
 * replacing what was there. Screenshot paths are now contained to the project.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = vi.hoisted(() => ({
  execFileSync: vi.fn(() => '{"success":true,"data":{}}'),
}));
vi.mock('child_process', () => ({ execFileSync: exec.execFileSync }));
vi.mock('node:child_process', () => ({ execFileSync: exec.execFileSync }));

import { browserTools } from '../src/mcp-tools/browser-tools.js';

type Result = { isError?: boolean; content: Array<{ text: string }> };
const call = (name: string, input: Record<string, unknown>) =>
  browserTools.find(t => t.name === name)!.handler(input) as Promise<Result>;
const errorOf = (r: Result) => JSON.parse(r.content[0].text).error as string;
/** The argv agent-browser was spawned with (after the launcher prefix). */
const spawnedArgs = () => exec.execFileSync.mock.calls.map(c => (c as unknown as [string, string[]])[1]);

beforeEach(() => { exec.execFileSync.mockClear(); });

describe('browser_screenshot path', () => {
  let root: string;
  let outside: string;
  const previous = process.cwd();

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-shot-project-')));
    outside = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-shot-outside-')));
    process.chdir(root);
  });
  afterEach(() => {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('refuses a path outside the project', async () => {
    for (const p of [join(outside, 'x.png'), '../x.png', join(outside, 'authorized_keys')]) {
      const r = await call('browser_screenshot', { path: p });
      expect(r.isError, p).toBe(true);
      expect(errorOf(r)).toMatch(/inside the project/);
    }
    expect(exec.execFileSync).not.toHaveBeenCalled();
  });

  it('refuses a non-image extension and a symlink out of the project', async () => {
    writeFileSync(join(root, 'notes.txt'), 'keep me');
    expect((await call('browser_screenshot', { path: 'notes.txt' })).isError).toBe(true);
    symlinkSync(join(outside, 'target.png'), join(root, 'link.png'));
    expect((await call('browser_screenshot', { path: 'link.png' })).isError).toBe(true);
    expect(exec.execFileSync).not.toHaveBeenCalled();
  });

  it('writes a screenshot inside the project to its resolved path', async () => {
    const r = await call('browser_screenshot', { path: 'shots/../page.png' });
    expect(r.isError).toBeFalsy();
    expect(spawnedArgs().some(a => a.includes('screenshot') && a.includes(join(root, 'page.png')))).toBe(true);
  });

  it('still returns base64 when no path is given', async () => {
    const r = await call('browser_screenshot', {});
    expect(r.isError).toBeFalsy();
    expect(exec.execFileSync).toHaveBeenCalled();
  });
});
