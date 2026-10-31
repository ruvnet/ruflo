/**
 * The MCP worker-dispatch queue (#1845) starts workers, so a cloned repository
 * must not be able to fill it, and an entry must not do more than a scheduled
 * fire could:
 *   - the queue lives in the user's state dir, keyed by project; entries a
 *     repository ships under `.claude-flow/daemon-queue` are never read;
 *   - an entry runs under the repository-supervisor gate, never as a manual
 *     trigger, and never for a worker the user has disabled;
 *   - overlapping polls do not run one entry twice.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkerDaemon } from '../src/services/worker-daemon.js';
import { dispatchQueueDir } from '../src/services/dispatch-queue.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { isAbsolute, join } from 'path';
import { tmpdir } from 'os';

describe('MCP dispatch queue', () => {
  let tempDir: string;
  let stateDir: string;
  const savedStateDir = process.env.RUFLO_AI_BUDGET_DIR;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'daemon-queue-gate-'));
    stateDir = mkdtempSync(join(tmpdir(), 'daemon-queue-state-'));
    mkdirSync(join(tempDir, '.claude-flow', 'logs'), { recursive: true });
    process.env.RUFLO_AI_BUDGET_DIR = stateDir;
    delete process.env.RUFLO_DAEMON_AI_WORKERS;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
    if (savedStateDir === undefined) delete process.env.RUFLO_AI_BUDGET_DIR;
    else process.env.RUFLO_AI_BUDGET_DIR = savedStateDir;
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGHUP');
  });

  /**
   * A consenting daemon with a stub headless executor; `supervisor` sets the gate.
   * Waits for the constructor's own `claude --version` probe first, so its result
   * (false where Claude Code is not installed, e.g. CI) cannot overwrite the stub.
   */
  async function consentingDaemon(supervisor: boolean, executeMs = 0) {
    const daemon = new WorkerDaemon(tempDir, { aiWorkersEnabled: true });
    await (daemon as unknown as { headlessInitPromise: Promise<void> }).headlessInitPromise;
    const execute = vi.fn(async () => {
      if (executeMs) await new Promise((r) => setTimeout(r, executeMs));
      return { success: true, output: {}, durationMs: 1 };
    });
    const d = daemon as unknown as Record<string, unknown>;
    d.headlessAvailable = true;
    d.headlessExecutor = { execute, getActiveChildPids: () => [], on: () => undefined };
    d.running = true;
    d.isRepositorySupervisor = () => supervisor;
    const poll = () => (d.processDispatchQueue as () => Promise<void>).call(d);
    return { daemon, execute, poll };
  }

  function enqueue(dir: string, name: string, trigger: string) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.json`), JSON.stringify({ trigger, workerId: name }));
  }

  it('never reads a queue a repository ships under .claude-flow/daemon-queue', async () => {
    const { execute, poll } = await consentingDaemon(true);
    const repoQueue = join(tempDir, '.claude-flow', 'daemon-queue');
    enqueue(repoQueue, 'seed', 'audit');

    await poll();

    expect(execute).not.toHaveBeenCalled();
    expect(existsSync(join(repoQueue, 'seed.json'))).toBe(true);
  });

  it('runs an entry from the user queue on the supervisor', async () => {
    const { execute, poll } = await consentingDaemon(true);
    const queue = dispatchQueueDir(tempDir);
    enqueue(queue, 'mine', 'audit');

    await poll();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(existsSync(join(queue, '.processed', 'mine.json'))).toBe(true);
  });

  it('runs an entry under the supervisor gate, not as a manual trigger', async () => {
    const { execute, poll } = await consentingDaemon(false);
    const queue = dispatchQueueDir(tempDir);
    enqueue(queue, 'mine', 'audit');

    await poll();

    expect(execute).not.toHaveBeenCalled();
    expect(existsSync(join(queue, '.processed', 'mine.json'))).toBe(true);
  });

  it('positive control: an explicit trigger on a non-supervisor does reach the executor', async () => {
    const { daemon, execute } = await consentingDaemon(false);
    await daemon.triggerWorker('audit').catch(() => undefined);
    expect(execute).toHaveBeenCalled();
  });

  it('skips an entry for a disabled worker', async () => {
    const { daemon, execute, poll } = await consentingDaemon(true);
    const audit = (daemon as unknown as { config: { workers: Array<{ type: string; enabled: boolean }> } })
      .config.workers.find((w) => w.type === 'audit')!;
    audit.enabled = false;
    const queue = dispatchQueueDir(tempDir);
    enqueue(queue, 'off', 'audit');

    await poll();

    expect(execute).not.toHaveBeenCalled();
    expect(existsSync(join(queue, '.processed', 'disabled-off.json'))).toBe(true);
  });

  it('does not run one entry twice when polls overlap', async () => {
    const { execute, poll } = await consentingDaemon(true, 200);
    enqueue(dispatchQueueDir(tempDir), 'slow', 'audit');

    const first = poll();
    await new Promise((r) => setTimeout(r, 50));
    await Promise.all([first, poll()]);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('stops draining when the daemon stops', async () => {
    const { daemon, execute, poll } = await consentingDaemon(true, 100);
    const queue = dispatchQueueDir(tempDir);
    for (const name of ['a', 'b', 'c']) enqueue(queue, name, 'audit');

    const draining = poll();
    await new Promise((r) => setTimeout(r, 30));
    (daemon as unknown as { running: boolean }).running = false;
    await draining;

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'relative/dir'])('ignores a non-absolute state dir override (%j)', (value) => {
    process.env.RUFLO_AI_BUDGET_DIR = value;
    const dir = dispatchQueueDir(tempDir);
    expect(isAbsolute(dir)).toBe(true);
    expect(dir.startsWith(tempDir)).toBe(false);
  });

  it('keys the queue by project inside the user state dir', () => {
    const other = mkdtempSync(join(tmpdir(), 'daemon-queue-other-'));
    try {
      expect(dispatchQueueDir(tempDir).startsWith(join(stateDir, 'daemon-queue'))).toBe(true);
      expect(dispatchQueueDir(tempDir)).toBe(dispatchQueueDir(join(tempDir, '.')));
      expect(dispatchQueueDir(tempDir)).not.toBe(dispatchQueueDir(other));
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
