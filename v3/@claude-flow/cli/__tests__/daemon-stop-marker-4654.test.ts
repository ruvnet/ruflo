/**
 * #4654 — after `daemon stop`, the daemon respawned from plugin hooks.
 *
 * Every ruflo-core hook runs the CLI, and the CLI auto-starts a daemon when
 * none is alive (`ensureDaemonRunning`). `daemon stop` now records a stop
 * marker in `.claude-flow/`; auto-start honours it until an explicit
 * `daemon start` clears it. Spawning is always injected — nothing real starts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AUTOSTART_ENV,
  DAEMON_STOP_MARKER,
  ensureDaemonRunning,
  isDaemonStopMarked,
  writeDaemonStopMarker,
} from '../src/services/daemon-autostart.js';
import { daemonCommand } from '../src/commands/daemon.js';
import type { CommandContext } from '../src/types.js';

const roots: string[] = [];
function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'daemon-stop-4654-'));
  mkdirSync(join(cwd, '.claude-flow'), { recursive: true });
  writeFileSync(join(cwd, '.claude-flow', 'config.yaml'), 'version: 3\n');
  roots.push(cwd);
  return cwd;
}

function sub(name: string) {
  const c = daemonCommand.subcommands?.find((s) => s.name === name);
  if (!c?.action) throw new Error(`no daemon ${name} subcommand`);
  return c.action;
}

function ctx(cwd: string, flags: Record<string, unknown>): CommandContext {
  return { args: [], flags: { quiet: true, ...flags }, cwd, interactive: false } as unknown as CommandContext;
}

/** Auto-start with an injected spawn; returns how many daemons it tried to spawn. */
function autostart(cwd: string): { spawned: number; reason?: string } {
  let spawned = 0;
  const r = ensureDaemonRunning(cwd, { isAlive: () => false, spawnFn: () => { spawned++; } });
  return { spawned, reason: r.reason };
}

describe('#4654 daemon stop marker', () => {
  const savedEnv = { auto: process.env.RUFLO_DAEMON_AUTOSTART, spawned: process.env[AUTOSTART_ENV] };

  beforeEach(() => {
    delete process.env.RUFLO_DAEMON_AUTOSTART;
    delete process.env[AUTOSTART_ENV];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedEnv.auto === undefined) delete process.env.RUFLO_DAEMON_AUTOSTART;
    else process.env.RUFLO_DAEMON_AUTOSTART = savedEnv.auto;
    if (savedEnv.spawned === undefined) delete process.env[AUTOSTART_ENV];
    else process.env[AUTOSTART_ENV] = savedEnv.spawned;
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  it('auto-start without a marker still spawns', () => {
    const cwd = project();
    expect(isDaemonStopMarked(cwd)).toBe(false);
    expect(autostart(cwd).spawned).toBe(1);
  });

  it('`daemon stop` writes the marker, and auto-start then spawns nothing', async () => {
    const cwd = project();
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);

    const res = await sub('stop')(ctx(cwd, {}));
    expect(res?.success).toBe(true);
    expect(existsSync(join(cwd, '.claude-flow', DAEMON_STOP_MARKER))).toBe(true);

    const r = autostart(cwd);
    expect(r.spawned).toBe(0);
    expect(r.reason).toMatch(/stopped by user/);
  });

  it('the marker holds for a hook invoked from a subdirectory of the project', () => {
    const cwd = project();
    writeDaemonStopMarker(cwd);
    const nested = join(cwd, 'packages', 'app');
    mkdirSync(nested, { recursive: true });
    expect(autostart(nested).spawned).toBe(0);
  });

  it('an explicit `daemon start` clears the marker so auto-start works again', async () => {
    const cwd = project();
    writeDaemonStopMarker(cwd);
    expect(autostart(cwd).spawned).toBe(0);

    // An invalid --workers list makes start return before it takes the lock or
    // forks anything; the marker is cleared before that point.
    const res = await sub('start')(ctx(cwd, { workspace: cwd, workers: 'NOT A WORKER LIST!' }));
    expect(res?.success).toBe(false);
    expect(isDaemonStopMarked(cwd)).toBe(false);
    expect(autostart(cwd).spawned).toBe(1);
  });

  it('a start spawned by auto-start honours a stop that landed after the hook checked', async () => {
    const cwd = project();
    writeDaemonStopMarker(cwd);
    process.env[AUTOSTART_ENV] = '1';
    const res = await sub('start')(ctx(cwd, { workspace: cwd }));
    expect(res?.success).toBe(true);
    expect(isDaemonStopMarked(cwd)).toBe(true);
    expect(existsSync(join(cwd, '.claude-flow', 'daemon.pid'))).toBe(false);
    expect(existsSync(join(cwd, '.claude-flow', 'daemon.lock'))).toBe(false);
  });

  it('`daemon stop` in a non-ruflo directory does not create .claude-flow/', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'daemon-stop-4654-plain-'));
    roots.push(cwd);
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    await sub('stop')(ctx(cwd, {}));
    expect(existsSync(join(cwd, '.claude-flow'))).toBe(false);
  });
});
