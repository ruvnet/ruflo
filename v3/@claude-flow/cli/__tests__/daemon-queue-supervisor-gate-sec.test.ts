import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkerDaemon } from '../src/services/worker-daemon.js';
import { dispatchQueueDir } from '../src/services/dispatch-queue.js';

const dirs: string[] = [];
const savedStateDir = process.env.RUFLO_AI_BUDGET_DIR;
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  if (savedStateDir === undefined) delete process.env.RUFLO_AI_BUDGET_DIR;
  else process.env.RUFLO_AI_BUDGET_DIR = savedStateDir;
});

/** A project dir, with the user state dir (and so the dispatch queue) in its own temp dir. */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ruflo-queue-')); dirs.push(dir);
  const state = mkdtempSync(join(tmpdir(), 'ruflo-queue-state-')); dirs.push(state);
  process.env.RUFLO_AI_BUDGET_DIR = state;
  return dir;
}

describe('daemon-queue entries stay behind the supervisor gate', () => {
  it('a committed queue file in the project is never read', async () => {
    const dir = project();
    mkdirSync(join(dir, '.claude-flow', 'daemon-queue'), { recursive: true });
    writeFileSync(join(dir, '.claude-flow', 'daemon-queue', 'planted.json'), JSON.stringify({ trigger: 'audit', workerId: 'x' }));
    const daemon = new WorkerDaemon(dir, { aiWorkersEnabled: false });
    const execute = vi.spyOn(daemon as never, 'executeWorker' as never).mockResolvedValue({} as never);
    (daemon as unknown as { running: boolean }).running = true;
    await (daemon as unknown as { processDispatchQueue(): Promise<void> }).processDispatchQueue();
    expect(execute).not.toHaveBeenCalled();
  });

  it('a queue entry runs the worker as a scheduled run, never a manual trigger', async () => {
    const dir = project();
    mkdirSync(dispatchQueueDir(dir), { recursive: true });
    writeFileSync(join(dispatchQueueDir(dir), 'queued.json'), JSON.stringify({ trigger: 'audit', workerId: 'x' }));
    const daemon = new WorkerDaemon(dir, { aiWorkersEnabled: false });
    const execute = vi.spyOn(daemon as never, 'executeWorker' as never).mockResolvedValue({} as never);
    (daemon as unknown as { running: boolean }).running = true;
    await (daemon as unknown as { processDispatchQueue(): Promise<void> }).processDispatchQueue();
    expect(execute).toHaveBeenCalledOnce();
    expect((execute.mock.calls[0] as unknown[])[1]).toEqual({ manualTrigger: false });
  });

  it('an operator\'s own triggerWorker call is still manual', async () => {
    const dir = project();
    const daemon = new WorkerDaemon(dir, { aiWorkersEnabled: false });
    const execute = vi.spyOn(daemon as never, 'executeWorker' as never).mockResolvedValue({} as never);
    await daemon.triggerWorker('audit');
    expect((execute.mock.calls[0] as unknown[])[1]).toEqual({ manualTrigger: true });
  });
});
