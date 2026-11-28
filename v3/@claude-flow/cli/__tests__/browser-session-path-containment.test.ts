/**
 * SECURITY: browser_session_record/end/replay passed caller-named rvf_dir and
 * rvf_path values straight to `ruvector rvf create|compact|derive|status|segments`,
 * which create, rewrite or list files at those paths. They are now contained
 * to existing .rvf files (or an existing directory) inside the project.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = vi.hoisted(() => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, r: unknown) => void) =>
    cb(null, { stdout: '', stderr: '' })),
}));
vi.mock('node:child_process', () => ({ execFile: exec.execFile }));
vi.mock('child_process', () => ({ execFile: exec.execFile }));

import { browserSessionTools } from '../src/mcp-tools/browser-session-tools.js';

type Result = { isError?: boolean; content: Array<{ text: string }> };
const call = (name: string, input: Record<string, unknown>) =>
  browserSessionTools.find(t => t.name === name)!.handler(input) as Promise<Result>;
const body = (r: Result) => JSON.parse(r.content[0].text) as Record<string, unknown>;
/** Every argv passed to a spawned process. */
const argvs = () => exec.execFile.mock.calls.map(c => c[1] as string[]);
const rvfCalls = () => argvs().filter(a => a.includes('rvf'));

describe('browser session rvf paths', () => {
  let root: string;
  let outside: string;
  const previous = process.cwd();

  beforeEach(() => {
    exec.execFile.mockClear();
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-rvf-project-')));
    outside = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-rvf-outside-')));
    process.chdir(root);
  });
  afterEach(() => {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('browser_session_end refuses an rvf_path outside the project or not .rvf', async () => {
    writeFileSync(join(outside, 'a.rvf'), 'x');
    writeFileSync(join(root, 'notes.txt'), 'keep');
    symlinkSync(join(outside, 'a.rvf'), join(root, 'link.rvf'));
    for (const p of [join(outside, 'a.rvf'), '../a.rvf', 'notes.txt', 'link.rvf', '--help', 'missing.rvf']) {
      const r = await call('browser_session_end', { session: 's1', rvf_path: p, verdict: 'pass' });
      expect(r.isError, p).toBe(true);
      expect(body(r).error).toMatch(/inside the project/);
    }
    expect(rvfCalls()).toHaveLength(0);
  });

  it('browser_session_replay refuses an rvf_path outside the project', async () => {
    writeFileSync(join(outside, 'a.rvf'), 'x');
    const r = await call('browser_session_replay', { session: 's1', rvf_path: join(outside, 'a.rvf') });
    expect(r.isError).toBe(true);
    expect(rvfCalls()).toHaveLength(0);
  });

  it('browser_session_record refuses an rvf_dir outside the project', async () => {
    for (const d of [outside, '..', join(root, 'no-such-dir')]) {
      const r = await call('browser_session_record', { url: 'https://example.com', task: 't', rvf_dir: d });
      expect(r.isError, d).toBe(true);
      expect(body(r).error).toMatch(/rvf_dir/);
    }
    expect(rvfCalls()).toHaveLength(0);
  });

  it('still works for containers inside the project', async () => {
    mkdirSync(join(root, 'sessions'));
    writeFileSync(join(root, 'sessions', 'a.rvf'), 'x');
    const end = await call('browser_session_end', { session: 's1', rvf_path: 'sessions/a.rvf', verdict: 'pass' });
    expect(end.isError).toBeFalsy();
    expect(rvfCalls().some(a => a.includes('compact') && a.includes(join(root, 'sessions', 'a.rvf')))).toBe(true);

    const replay = await call('browser_session_replay', { session: 's1', rvf_path: 'sessions/a.rvf' });
    expect(replay.isError).toBeFalsy();
    expect(String(body(replay).replayRvfPath).startsWith(join(root, 'sessions'))).toBe(true);

    const rec = await call('browser_session_record', { url: 'https://example.com', task: 't', session: 's2', rvf_dir: 'sessions' });
    expect(rec.isError).toBeFalsy();
    expect(body(rec).rvfPath).toBe(join(root, 'sessions', 's2.rvf'));
  });
});
