/**
 * #2935 — the daemon's memory gate on Darwin.
 *
 * os.freemem() on macOS counts only free (+ speculative) pages, so an idle Mac
 * with gigabytes of reclaimable inactive memory reads as a few percent "free"
 * and the gate defers almost every worker. These tests drive the existing
 * canRunWorker() through mocked `os` and `child_process` modules only, using
 * one real vm_stat capture and the matching os.freemem()/os.totalmem() values
 * from the same Apple Silicon machine (16 KiB pages).
 *
 * Captured numbers: os.freemem() = 2,769,993,728 B of 51,539,607,552 B (5.37%);
 * vm_stat (free 132,582 + speculative 37,467 + inactive 657,222) × 16,384 B
 * = 13,554,008,064 B (26.30%).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkerDaemon } from '../../src/services/worker-daemon.js';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TOTAL_BYTES = 51_539_607_552;
const FREEMEM_BYTES = 2_769_993_728;

const VM_STAT_APPLE_SILICON = [
  'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
  'Pages free:                                   132582.',
  'Pages active:                                 668441.',
  'Pages inactive:                               657222.',
  'Pages speculative:                             37467.',
  'Pages throttled:                                   0.',
  'Pages wired down:                             347909.',
  'Pages purgeable:                               46532.',
  '',
].join('\n');

function mockOs(platform: string) {
  const os = {
    loadavg: () => [0.1, 0.1, 0.1],
    totalmem: () => TOTAL_BYTES,
    freemem: () => FREEMEM_BYTES,
    platform: () => platform,
  };
  vi.doMock('os', () => ({ default: os, ...os }));
}

function mockVmStat(output: string) {
  const calls: string[] = [];
  const execFile = (file: string, _args: unknown, _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    calls.push(file);
    setImmediate(() => cb(null, output, ''));
    return {};
  };
  for (const id of ['node:child_process', 'child_process']) {
    vi.doMock(id, async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), execFile }));
  }
  return calls;
}

describe('#2935 Darwin memory gate (canRunWorker)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'worker-daemon-2935-'));
    mkdirSync(join(tempDir, '.claude-flow', 'logs'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('os');
    vi.doUnmock('node:child_process');
    vi.doUnmock('child_process');
    rmSync(tempDir, { recursive: true, force: true });
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGHUP');
  });

  it('allows workers when reclaimable inactive memory is above the threshold (A1)', async () => {
    mockOs('darwin');
    const calls = mockVmStat(VM_STAT_APPLE_SILICON);
    const daemon = new WorkerDaemon(tempDir, {
      resourceThresholds: { maxCpuLoad: 1000, minFreeMemoryPercent: 10 },
    });

    const result = await (daemon as any).canRunWorker();

    expect(result).toEqual({ allowed: true });
    expect(calls).toEqual(['/usr/bin/vm_stat']);
  });

  it('still defers workers when available memory is below the threshold (A2)', async () => {
    mockOs('darwin');
    mockVmStat(VM_STAT_APPLE_SILICON);
    const daemon = new WorkerDaemon(tempDir, {
      resourceThresholds: { maxCpuLoad: 1000, minFreeMemoryPercent: 30 },
    });

    const result = await (daemon as any).canRunWorker();

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Memory too low: 26\.3% available \(vm_stat\)/);
  });

  it('keeps os.freemem() and never runs vm_stat off Darwin (A3)', async () => {
    mockOs('linux');
    const calls = mockVmStat(VM_STAT_APPLE_SILICON);
    const daemon = new WorkerDaemon(tempDir, {
      resourceThresholds: { maxCpuLoad: 1000, minFreeMemoryPercent: 10 },
    });

    const result = await (daemon as any).canRunWorker();

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('5.4%');
    expect(calls).toEqual([]);
  });
});
