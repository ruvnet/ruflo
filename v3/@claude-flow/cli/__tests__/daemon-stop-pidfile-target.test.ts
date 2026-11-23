/**
 * `daemon stop` signals the PID recorded in `.claude-flow/daemon.pid`. That
 * file is part of the working tree, so a cloned repository can supply it. A
 * negative or zero PID, or one naming some unrelated process, must never be
 * signalled.
 *
 * process.kill is stubbed in every test: nothing is actually signalled.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { daemonCommand, pidFileSignalTarget } from '../src/commands/daemon.js';
import type { CommandContext } from '../src/types.js';

const roots: string[] = [];
const children: ChildProcess[] = [];

function projectWithPidFile(contents: string): string {
  const cwd = mkdtempSync(join(tmpdir(), 'daemon-pidfile-'));
  mkdirSync(join(cwd, '.claude-flow'), { recursive: true });
  writeFileSync(join(cwd, '.claude-flow', 'daemon.pid'), contents);
  roots.push(cwd);
  return cwd;
}

async function daemonStop(cwd: string) {
  const stop = daemonCommand.subcommands?.find((s) => s.name === 'stop')?.action;
  if (!stop) throw new Error('no daemon stop subcommand');
  vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  return stop({ args: [], flags: { quiet: true }, cwd, interactive: false } as unknown as CommandContext);
}

/** Every [pid, signal] that daemon stop tried to deliver (signal 0 probes excluded). */
function stubKill() {
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
  return () => kill.mock.calls.filter(([, sig]) => sig !== 0 && sig !== undefined).map(([pid, sig]) => [pid, sig]);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const c of children.splice(0)) c.kill('SIGKILL');
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('daemon stop and a repository-supplied daemon.pid', () => {
  it.each(['-1', '0', '-4242', '1'])('does not signal pid %s', async (contents) => {
    const signalled = stubKill();
    await daemonStop(projectWithPidFile(contents));
    expect(signalled().filter(([pid]) => pid === Number(contents))).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('does not signal a live process that is not ruflo', async () => {
    const victim = spawn('sleep', ['30'], { stdio: 'ignore' });
    children.push(victim);
    await new Promise((r) => setTimeout(r, 50));
    const signalled = stubKill();
    await daemonStop(projectWithPidFile(String(victim.pid)));
    expect(signalled().filter(([pid]) => pid === victim.pid)).toEqual([]);
  });
});

describe('pidFileSignalTarget', () => {
  const ruflo = () => 'node /usr/lib/node_modules/@claude-flow/cli/bin/cli.js daemon start --foreground';

  it('accepts a ruflo process', () => {
    expect(pidFileSignalTarget('4242\n', ruflo)).toBe(4242);
  });

  it.each(['-1', '0', '1', '12abc', '0x10', '', ' ', '99999999999'])('rejects %j', (raw) => {
    expect(pidFileSignalTarget(raw, ruflo)).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('rejects a process whose command line is not ruflo, or is unknown', () => {
    expect(pidFileSignalTarget('4242', () => '/usr/bin/ssh-agent')).toBeNull();
    expect(pidFileSignalTarget('4242', () => null)).toBeNull();
  });
});
