/**
 * #4549 automation scan: hooks_worker-detect's autoDispatch created a worker
 * record and marked it completed after a hardcoded 1.5 s timer without running
 * anything, unlike the sibling hooks_worker-dispatch path that reports
 * 'synthetic-completed' honestly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hooksWorkerDetect, hooksWorkerStatus } from '../src/mcp-tools/hooks-tools.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('hooks_worker-detect synthetic dispatch disclosure (#4549)', () => {
  it('marks auto-dispatched records and responses as synthetic', async () => {
    vi.useFakeTimers();

    const result = await hooksWorkerDetect.handler({
      prompt: 'run a security audit for vulnerabilities',
      autoDispatch: true,
      minConfidence: 0,
    }) as {
      autoDispatched: boolean;
      autoDispatchStatus: string;
      note: string;
      workerIds: string[];
    };

    expect(result.autoDispatched).toBe(true);
    expect(result.autoDispatchStatus).toBe('synthetic-completed');
    expect(result.note).toMatch(/no executor ran/i);
    expect(result.workerIds.length).toBeGreaterThan(0);

    const before = await hooksWorkerStatus.handler({ workerId: result.workerIds[0] }) as {
      worker: { status: string; synthetic?: boolean; note?: string };
    };
    expect(before.worker.status).toBe('running');
    expect(before.worker.synthetic).toBe(true);
    expect(before.worker.note).toMatch(/no executor ran/i);

    await vi.advanceTimersByTimeAsync(1500);

    const after = await hooksWorkerStatus.handler({ workerId: result.workerIds[0] }) as {
      worker: { status: string; phase: string; synthetic?: boolean };
    };
    expect(after.worker.status).toBe('completed');
    expect(after.worker.phase).toBe('synthetic-completed');
    expect(after.worker.synthetic).toBe(true);
  });
});
