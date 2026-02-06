import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import type { Mock } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

import { HeadlessWorkerExecutor } from '../../src/services/headless-worker-executor.js';

interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: Mock;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
}

function createMockChildProcess(
  onKill?: (signal: NodeJS.Signals, proc: MockChildProcess) => void
): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.exitCode = null;
  proc.signalCode = null;
  proc.kill = vi.fn((signal: NodeJS.Signals) => {
    onKill?.(signal, proc);
    return true;
  }) as Mock;
  return proc;
}

describe('HeadlessWorkerExecutor process cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should escalate to SIGKILL after timeout grace period', async () => {
    const child = createMockChildProcess((signal, proc) => {
      if (signal === 'SIGKILL') {
        proc.signalCode = 'SIGKILL';
        setImmediate(() => proc.emit('close', null));
      }
    });
    (spawn as Mock).mockReturnValue(child);

    const executor = new HeadlessWorkerExecutor(process.cwd(), { killGraceMs: 10 });

    const result = await (executor as any).executeClaudeCode('timeout-test', {
      sandbox: 'strict',
      model: 'sonnet',
      timeoutMs: 20,
      executionId: 'exec-timeout',
      workerType: 'audit',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Execution timed out');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(executor.getActiveCount()).toBe(0);
  });

  it('should keep cancelled execution tracked until process closes', async () => {
    const child = createMockChildProcess((signal, proc) => {
      if (signal === 'SIGTERM') {
        setTimeout(() => {
          proc.signalCode = 'SIGTERM';
          proc.emit('close', null);
        }, 5);
      }
    });
    (spawn as Mock).mockReturnValue(child);

    const executor = new HeadlessWorkerExecutor(process.cwd(), { killGraceMs: 10 });

    const resultPromise = (executor as any).executeClaudeCode('cancel-test', {
      sandbox: 'strict',
      model: 'sonnet',
      timeoutMs: 1000,
      executionId: 'exec-cancel',
      workerType: 'audit',
    });

    expect(executor.getActiveCount()).toBe(1);
    expect(executor.cancel('exec-cancel')).toBe(true);
    expect(executor.getActiveCount()).toBe(1);

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe('Execution cancelled');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(executor.getActiveCount()).toBe(0);
  });
});
