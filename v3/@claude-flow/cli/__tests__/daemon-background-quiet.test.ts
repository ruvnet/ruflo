import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daemonCommand } from '../src/commands/daemon.js';
import { spawn } from 'child_process';
import * as fs from 'fs';
import type { CommandContext } from '../src/types.js';

vi.mock('../src/services/worker-daemon.js', () => ({
  WorkerDaemon: class WorkerDaemon {},
  getDaemon: vi.fn(),
  startDaemon: vi.fn(),
  stopDaemon: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 4321,
    unref: vi.fn(),
  })),
  execFile: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  unlinkSync: vi.fn(),
  openSync: vi.fn(() => 1),
}));

vi.mock('../src/output.js', () => ({
  output: {
    writeln: vi.fn(),
    printInfo: vi.fn(),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    printWarning: vi.fn(),
    printTable: vi.fn(),
    printJson: vi.fn(),
    printList: vi.fn(),
    printBox: vi.fn(),
    createSpinner: vi.fn(() => ({
      start: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn(),
    })),
    highlight: (str: string) => str,
    bold: (str: string) => str,
    dim: (str: string) => str,
    success: (str: string) => str,
    error: (str: string) => str,
    warning: (str: string) => str,
    info: (str: string) => str,
    progressBar: () => '[=====>    ]',
    setColorEnabled: vi.fn(),
  },
}));

describe('daemon background start quiet propagation', () => {
  const mockedSpawn = vi.mocked(spawn);
  const mockedFs = vi.mocked(fs);
  const originalDaemonEnv = process.env.CLAUDE_FLOW_DAEMON;

  beforeEach(() => {
    mockedSpawn.mockClear();
    mockedFs.existsSync.mockImplementation(() => true);
    process.env.CLAUDE_FLOW_DAEMON = '1'; // Skip already-running background PID check path
  });

  afterEach(() => {
    if (originalDaemonEnv === undefined) {
      delete process.env.CLAUDE_FLOW_DAEMON;
    } else {
      process.env.CLAUDE_FLOW_DAEMON = originalDaemonEnv;
    }
  });

  it('does not force --quiet when quiet flag is false', async () => {
    const start = daemonCommand.subcommands?.find(cmd => cmd.name === 'start');
    expect(start).toBeDefined();

    const ctx: CommandContext = {
      args: [],
      flags: { _: [], quiet: false, foreground: false },
      cwd: process.cwd(),
      interactive: false,
    };

    const result = await start!.action!(ctx);
    expect(result.success).toBe(true);

    const spawnArgs = mockedSpawn.mock.calls[0]?.[1] as string[];
    expect(spawnArgs).toContain('daemon');
    expect(spawnArgs).toContain('start');
    expect(spawnArgs).toContain('--foreground');
    expect(spawnArgs).not.toContain('--quiet');
  });

  it('passes --quiet when quiet flag is true', async () => {
    const start = daemonCommand.subcommands?.find(cmd => cmd.name === 'start');
    expect(start).toBeDefined();

    const ctx: CommandContext = {
      args: [],
      flags: { _: [], quiet: true, foreground: false },
      cwd: process.cwd(),
      interactive: false,
    };

    const result = await start!.action!(ctx);
    expect(result.success).toBe(true);

    const spawnArgs = mockedSpawn.mock.calls[0]?.[1] as string[];
    expect(spawnArgs).toContain('--quiet');
  });
});
