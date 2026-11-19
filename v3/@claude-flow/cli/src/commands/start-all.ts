/**
 * `ruflo start all` (#1177): bring up everything in one command.
 *
 *   0. project init  — only when the project was never initialized (same path as `start quick`)
 *   1. memory init   — only when the memory database is missing (never overwrites)
 *   2. daemon start  — only when no daemon is running
 *   3. start         — the main `start` action
 *
 * Every step is injectable through `deps` so tests can mock each one.
 */

import type { CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

/** Steps `start all` runs, injectable so tests can replace each one. */
export interface StartAllDeps {
  isProjectInitialized: (cwd: string) => boolean | Promise<boolean>;
  initProject: (ctx: CommandContext) => Promise<CommandResult | void>;
  isMemoryInitialized: () => Promise<boolean>;
  initMemory: () => Promise<{ success: boolean; error?: string }>;
  isDaemonRunning: (cwd: string) => boolean | Promise<boolean>;
  startDaemon: (ctx: CommandContext) => Promise<CommandResult | void>;
  start: (ctx: CommandContext) => Promise<CommandResult>;
}

// Real steps, loaded lazily: plain `start` must not pull in sql.js or the daemon
// module, and start.ts imports this file (a static import back would be a cycle).
export const defaultStartAllDeps: StartAllDeps = {
  isProjectInitialized: async (cwd) => (await import('./start.js')).isInitialized(cwd),
  initProject: async (ctx) => (await import('./start.js')).runMinimalProjectInit(ctx),
  isMemoryInitialized: async () => {
    const { checkMemoryInitialization } = await import('../memory/memory-initializer.js');
    return (await checkMemoryInitialization()).initialized;
  },
  initMemory: async () => {
    const { initializeMemoryDatabase } = await import('../memory/memory-initializer.js');
    // force: false — never overwrite an existing database.
    return initializeMemoryDatabase({ force: false });
  },
  isDaemonRunning: async (cwd) => {
    const { isDaemonAlive, resolveDaemonProjectRoot } = await import('../services/daemon-autostart.js');
    return isDaemonAlive(resolveDaemonProjectRoot(cwd));
  },
  startDaemon: async (ctx) => {
    const { daemonCommand } = await import('./daemon.js');
    const daemonStart = daemonCommand.subcommands?.find((c) => c.name === 'start');
    if (!daemonStart?.action) throw new Error('daemon start command not found');
    // Only `quiet` is forwarded: start's own flags (port, topology, daemon) mean something else to `daemon start`.
    const flags: CommandContext['flags'] = { _: [] };
    if (ctx.flags.quiet !== undefined) flags.quiet = ctx.flags.quiet;
    return daemonStart.action({ ...ctx, args: [], flags });
  },
  start: async (ctx) => (await import('./start.js')).startAction(ctx),
};

function fail(step: string, error: unknown): CommandResult {
  const detail = error instanceof Error ? error.message : String(error ?? 'unknown error');
  output.printError(`start all: ${step} failed: ${detail}`);
  return { success: false, exitCode: 1, data: { failedStep: step, error: detail } };
}

/** Runs the steps in order; stops at the first failure with a non-zero result naming it. */
export async function runStartAll(
  ctx: CommandContext,
  deps: StartAllDeps = defaultStartAllDeps
): Promise<CommandResult> {
  try {
    if (await deps.isProjectInitialized(ctx.cwd)) {
      output.printInfo('Project already initialized, skipping init');
    } else {
      output.printInfo('Project not initialized, running init first...');
      const init = await deps.initProject(ctx);
      if (init && !init.success) return fail('project init', 'init returned failure');
    }
  } catch (error) {
    return fail('project init', error);
  }

  try {
    if (await deps.isMemoryInitialized()) {
      output.printInfo('Memory already initialized, skipping');
    } else {
      const init = await deps.initMemory();
      if (!init.success) return fail('memory init', init.error);
      output.printSuccess('Memory initialized');
    }
  } catch (error) {
    return fail('memory init', error);
  }

  try {
    if (await deps.isDaemonRunning(ctx.cwd)) {
      output.printInfo('Daemon already running, skipping');
    } else {
      const daemon = await deps.startDaemon(ctx);
      if (daemon && !daemon.success) return fail('daemon start', 'daemon start returned failure');
    }
  } catch (error) {
    return fail('daemon start', error);
  }

  try {
    const result = await deps.start(ctx);
    return result.success ? result : fail('start', 'start returned failure');
  } catch (error) {
    return fail('start', error);
  }
}
