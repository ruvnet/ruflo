/**
 * #1177 — `ruflo start all`: run project init when the project was never
 * initialized (the `start quick` path), initialize memory only when it is
 * missing, start the daemon only when it is not running, then run the main
 * start action. Every step is a mock (London school); nothing touches disk
 * or spawns.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CommandContext } from '../src/types.js';
import { startCommand } from '../src/commands/start.js';
import { defaultStartAllDeps, runStartAll, type StartAllDeps } from '../src/commands/start-all.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function ctx(): CommandContext {
  return { args: [], flags: { _: [] }, cwd: '/tmp/project', interactive: false };
}

function deps(overrides: Partial<StartAllDeps> = {}) {
  return {
    isProjectInitialized: vi.fn(async () => false),
    initProject: vi.fn(async () => ({ success: true })),
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

  it('never-initialized project: project init, memory, daemon, start — once each, in order', async () => {
    const d = deps();
    const context = ctx();

    const result = await runStartAll(context, d);

    expect(result.success).toBe(true);
    const steps = [d.initProject, d.initMemory, d.startDaemon, d.start];
    for (const step of steps) expect(step).toHaveBeenCalledTimes(1);
    expect(d.isProjectInitialized).toHaveBeenCalledWith('/tmp/project');
    expect(d.initProject).toHaveBeenCalledWith(context);
    expect(d.isDaemonRunning).toHaveBeenCalledWith('/tmp/project');
    expect(d.start).toHaveBeenCalledWith(context);
    const order = steps.map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('initialized project with memory and a running daemon: no init of any kind, no second daemon, still starts', async () => {
    const d = deps({
      isProjectInitialized: vi.fn(async () => true),
      isMemoryInitialized: vi.fn(async () => true),
      isDaemonRunning: vi.fn(async () => true),
    });

    const result = await runStartAll(ctx(), d);

    expect(result.success).toBe(true);
    expect(d.initProject).not.toHaveBeenCalled();
    expect(d.initMemory).not.toHaveBeenCalled();
    expect(d.startDaemon).not.toHaveBeenCalled();
    expect(d.start).toHaveBeenCalledTimes(1);
  });

  it('initialized project skips project init but still inits missing memory', async () => {
    const d = deps({ isProjectInitialized: vi.fn(async () => true) });

    const result = await runStartAll(ctx(), d);

    expect(result.success).toBe(true);
    expect(d.initProject).not.toHaveBeenCalled();
    expect(d.initMemory).toHaveBeenCalledTimes(1);
  });

  it('project init failure: reported with a non-zero result, later steps not run', async () => {
    const d = deps({ initProject: vi.fn(async () => ({ success: false, exitCode: 1 })) });

    const result = await runStartAll(ctx(), d);

    expect(result).toMatchObject({ success: false, exitCode: 1, data: { failedStep: 'project init' } });
    expect(d.isMemoryInitialized).not.toHaveBeenCalled();
    expect(d.initMemory).not.toHaveBeenCalled();
    expect(d.startDaemon).not.toHaveBeenCalled();
    expect(d.start).not.toHaveBeenCalled();
  });

  it('project init throwing: reported with a non-zero result naming the step', async () => {
    const d = deps({ initProject: vi.fn(async () => { throw new Error('EACCES .claude-flow'); }) });

    const result = await runStartAll(ctx(), d);

    expect(result).toMatchObject({ success: false, exitCode: 1, data: { failedStep: 'project init', error: 'EACCES .claude-flow' } });
    expect(d.start).not.toHaveBeenCalled();
  });

  it('memory init failure: reported with a non-zero result, later steps not run', async () => {
    const d = deps({ initMemory: vi.fn(async () => ({ success: false, error: 'disk full' })) });

    const result = await runStartAll(ctx(), d);

    expect(result).toMatchObject({ success: false, exitCode: 1, data: { failedStep: 'memory init', error: 'disk full' } });
    expect(d.startDaemon).not.toHaveBeenCalled();
    expect(d.start).not.toHaveBeenCalled();
  });

  it('daemon start throwing: reported with a non-zero result, start not run', async () => {
    const d = deps({ startDaemon: vi.fn(async () => { throw new Error('spawn EACCES'); }) });

    const result = await runStartAll(ctx(), d);

    expect(result).toMatchObject({ success: false, exitCode: 1, data: { failedStep: 'daemon start', error: 'spawn EACCES' } });
    expect(d.start).not.toHaveBeenCalled();
  });

  it('default project check is the same .claude-flow/config.yaml check `start quick` uses', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-all-1177-'));
    try {
      expect(await defaultStartAllDeps.isProjectInitialized(dir)).toBe(false);
      fs.mkdirSync(path.join(dir, '.claude-flow'));
      fs.writeFileSync(path.join(dir, '.claude-flow', 'config.yaml'), 'swarm:\n');
      expect(await defaultStartAllDeps.isProjectInitialized(dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('start failure: reported with a non-zero result', async () => {
    const d = deps({ start: vi.fn(async () => ({ success: false, exitCode: 1 })) });

    const result = await runStartAll(ctx(), d);

    expect(result).toMatchObject({ success: false, exitCode: 1, data: { failedStep: 'start' } });
  });
});
