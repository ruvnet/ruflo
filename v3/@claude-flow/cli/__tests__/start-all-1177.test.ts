/**
 * #1177 — `ruflo start all`: initialize memory only when it is missing, start
 * the daemon only when it is not running, then run the main start action.
 * Every step is a mock (London school); nothing touches disk or spawns.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CommandContext } from '../src/types.js';
import { startCommand, runStartAll, type StartAllDeps } from '../src/commands/start.js';

function ctx(): CommandContext {
  return { args: [], flags: { _: [] }, cwd: '/tmp/project', interactive: false };
}

function deps(overrides: Partial<StartAllDeps> = {}) {
  return {
    isMemoryInitialized: vi.fn(async () => false),
    initMemory: vi.fn(async () => ({ success: true })),
    isDaemonRunning: vi.fn(async () => false),
    startDaemon: vi.fn(async () => ({ success: true })),
    start: vi.fn(async () => ({ success: true, data: { started: true } })),
    ...overrides,
  };
}

describe('#1177 start all', () => {
  it('is registered as a start subcommand with a help example', () => {
    const names = startCommand.subcommands?.map((c) => c.name);
    expect(names).toEqual(['stop', 'restart', 'quick', 'all']);
    expect(startCommand.examples?.some((e) => e.command.endsWith('start all'))).toBe(true);
  });

  it('fresh project: inits memory, starts the daemon, then starts — once each, in order', async () => {
    const d = deps();
    const context = ctx();

    const result = await runStartAll(context, d);

    expect(result.success).toBe(true);
    expect(d.initMemory).toHaveBeenCalledTimes(1);
    expect(d.startDaemon).toHaveBeenCalledTimes(1);
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(d.isDaemonRunning).toHaveBeenCalledWith('/tmp/project');
    expect(d.start).toHaveBeenCalledWith(context);
    const order = [d.initMemory, d.startDaemon, d.start].map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('initialized project with a running daemon: no re-init, no second daemon, still starts', async () => {
    const d = deps({
      isMemoryInitialized: vi.fn(async () => true),
      isDaemonRunning: vi.fn(async () => true),
    });

    const result = await runStartAll(ctx(), d);

    expect(result.success).toBe(true);
    expect(d.initMemory).not.toHaveBeenCalled();
    expect(d.startDaemon).not.toHaveBeenCalled();
    expect(d.start).toHaveBeenCalledTimes(1);
  });

  it('memory init failure: reported with a non-zero result, later steps not run', async () => {
    const d = deps({ initMemory: vi.fn(async () => ({ success: false, error: 'disk full' })) });

    const result = await runStartAll(ctx(), d);

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.data).toMatchObject({ failedStep: 'memory init', error: 'disk full' });
    expect(d.startDaemon).not.toHaveBeenCalled();
    expect(d.start).not.toHaveBeenCalled();
  });

  it('daemon start throwing: reported with a non-zero result, start not run', async () => {
    const d = deps({ startDaemon: vi.fn(async () => { throw new Error('spawn EACCES'); }) });

    const result = await runStartAll(ctx(), d);

    expect(result).toMatchObject({ success: false, exitCode: 1, data: { failedStep: 'daemon start', error: 'spawn EACCES' } });
    expect(d.start).not.toHaveBeenCalled();
  });

  it('start failure: reported with a non-zero result', async () => {
    const d = deps({ start: vi.fn(async () => ({ success: false, exitCode: 1 })) });

    const result = await runStartAll(ctx(), d);

    expect(result).toMatchObject({ success: false, exitCode: 1, data: { failedStep: 'start' } });
  });
});
