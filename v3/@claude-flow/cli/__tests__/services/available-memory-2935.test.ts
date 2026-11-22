/**
 * #2935 — available-memory measurement used by the daemon's memory gate.
 * Every dependency is injected, so nothing here depends on the host.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseVmStat,
  vmStatAvailableBytes,
  createAvailableMemoryReader,
  AVAILABLE_MEMORY_CACHE_TTL_MS,
  VM_STAT_PATH,
  type AvailableMemoryDeps,
} from '../../src/services/available-memory.js';
import { WorkerDaemon } from '../../src/services/worker-daemon.js';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Captured on Apple Silicon (16 KiB pages).
const VM_STAT_16K = [
  'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
  'Pages free:                                   132582.',
  'Pages active:                                 668441.',
  'Pages inactive:                               657222.',
  'Pages speculative:                             37467.',
  'Pages throttled:                                   0.',
  'Pages wired down:                             347909.',
  'Pages purgeable:                               46532.',
  '"Translation faults":                     123456789.',
  '',
].join('\n');

// Intel layout (4 KiB pages), same field set.
const VM_STAT_4K = [
  'Mach Virtual Memory Statistics: (page size of 4096 bytes)',
  'Pages free:                                    50000.',
  'Pages active:                                 900000.',
  'Pages inactive:                               800000.',
  'Pages speculative:                             10000.',
  'Pages wired down:                             300000.',
  'Pages purgeable:                              120000.',
  '',
].join('\n');

const TOTAL_16K = 51_539_607_552;
const AVAIL_16K = (132_582 + 37_467 + 657_222) * 16_384; // 13,554,008,064

type Cb = (error: Error | null, stdout: string, stderr: string) => void;

function deps(overrides: Partial<{
  platform: string | undefined;
  stdout: string;
  error: Error & { code?: string; killed?: boolean };
  freemem: number;
  totalmem: number;
  now: () => number;
}> = {}) {
  const calls: Array<{ file: string; opts: any }> = [];
  const d: AvailableMemoryDeps = {
    platform: async () => ('platform' in overrides ? overrides.platform : 'darwin'),
    execFile: async () => (file: string, _args: readonly string[], opts: any, cb: Cb) => {
      calls.push({ file, opts });
      setImmediate(() =>
        overrides.error ? cb(overrides.error, '', '') : cb(null, overrides.stdout ?? VM_STAT_16K, ''),
      );
      return {};
    },
    freemem: async () => overrides.freemem ?? 2_769_993_728,
    totalmem: async () => overrides.totalmem ?? TOTAL_16K,
    now: overrides.now ?? (() => 0),
  };
  return { d, calls };
}

describe('parseVmStat', () => {
  it('parses the 16 KiB Apple Silicon layout', () => {
    expect(parseVmStat(VM_STAT_16K)).toEqual({
      pageSize: 16384, free: 132582, inactive: 657222, speculative: 37467, purgeable: 46532,
    });
  });

  it('parses the 4 KiB Intel layout from its own header', () => {
    expect(parseVmStat(VM_STAT_4K)?.pageSize).toBe(4096);
  });

  it('accepts CRLF line endings', () => {
    expect(parseVmStat(VM_STAT_16K.replace(/\n/g, '\r\n'))).toEqual(parseVmStat(VM_STAT_16K));
  });

  it('accepts counters without a trailing period', () => {
    expect(parseVmStat(VM_STAT_16K.replace(/(\d)\.$/gm, '$1'))?.inactive).toBe(657222);
  });

  it('treats purgeable as optional', () => {
    const text = VM_STAT_16K.split('\n').filter((l) => !l.startsWith('Pages purgeable')).join('\n');
    const parsed = parseVmStat(text);
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty('purgeable');
  });

  it.each([
    ['missing header', VM_STAT_16K.split('\n').slice(1).join('\n')],
    ['header not on the first line', `\n${VM_STAT_16K}`],
    ['zero page size', VM_STAT_16K.replace('16384 bytes', '0 bytes')],
    ['missing inactive', VM_STAT_16K.replace(/^Pages inactive.*$/m, '')],
    ['missing free', VM_STAT_16K.replace(/^Pages free.*$/m, '')],
    ['missing speculative', VM_STAT_16K.replace(/^Pages speculative.*$/m, '')],
    ['negative counter', VM_STAT_16K.replace('657222.', '-657222.')],
    ['non-numeric counter', VM_STAT_16K.replace('657222.', 'lots.')],
    ['unsafe-integer counter', VM_STAT_16K.replace('657222.', '9007199254740993.')],
    ['empty output', ''],
  ])('returns null for %s', (_name, text) => {
    expect(parseVmStat(text)).toBeNull();
  });
});

describe('vmStatAvailableBytes', () => {
  it('is (free + speculative + inactive) × pageSize and excludes purgeable', () => {
    const sample = parseVmStat(VM_STAT_16K)!;
    expect(vmStatAvailableBytes(sample)).toBe(AVAIL_16K);
    expect(vmStatAvailableBytes({ ...sample, purgeable: 10 ** 9 })).toBe(AVAIL_16K);
  });

  it('returns null when the byte product is not a safe integer', () => {
    expect(vmStatAvailableBytes({ pageSize: 2 ** 40, free: 2 ** 20, inactive: 0, speculative: 0 })).toBeNull();
  });
});

describe('createAvailableMemoryReader', () => {
  it('measures Darwin from vm_stat without a shell, with a timeout', async () => {
    const { d, calls } = deps();
    const m = await createAvailableMemoryReader(d).read();
    expect(m).toEqual({ availableBytes: AVAIL_16K, totalBytes: TOTAL_16K, percent: (AVAIL_16K / TOTAL_16K) * 100, source: 'vm_stat' });
    expect(m.percent.toFixed(1)).toBe('26.3');
    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe(VM_STAT_PATH);
    expect(calls[0].opts).toMatchObject({ timeout: 1000 });
    expect(calls[0].opts.shell).toBeUndefined();
  });

  it('measures the 4 KiB layout with its own page size', async () => {
    const total = 16 * 1024 ** 3;
    const { d } = deps({ stdout: VM_STAT_4K, totalmem: total });
    const m = await createAvailableMemoryReader(d).read();
    expect(m.availableBytes).toBe((50_000 + 10_000 + 800_000) * 4096);
    expect(m.source).toBe('vm_stat');
  });

  it('clamps available memory to totalmem', async () => {
    const { d } = deps({ totalmem: 1024 ** 3 });
    const m = await createAvailableMemoryReader(d).read();
    expect(m.availableBytes).toBe(1024 ** 3);
    expect(m.percent).toBe(100);
  });

  it.each(['linux', 'win32', undefined])('keeps os.freemem() on %s and never spawns', async (platform) => {
    const { d, calls } = deps({ platform, freemem: 4e9, totalmem: 16e9 });
    const m = await createAvailableMemoryReader(d).read();
    expect(m).toEqual({ availableBytes: 4e9, totalBytes: 16e9, percent: 25, source: 'os.freemem' });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['ENOENT', Object.assign(new Error('spawn /usr/bin/vm_stat ENOENT'), { code: 'ENOENT' }), /ENOENT/],
    ['timeout', Object.assign(new Error('killed'), { killed: true }), /timed out/],
    ['non-zero exit', Object.assign(new Error('Command failed'), { code: 1 as unknown as string }), /failed \(1\)/],
  ])('falls back to os.freemem() on %s', async (_name, error, reason) => {
    const { d } = deps({ error, freemem: 4e9, totalmem: 16e9 });
    const m = await createAvailableMemoryReader(d).read();
    expect(m.source).toBe('os.freemem-fallback');
    expect(m.availableBytes).toBe(4e9);
    expect(m.percent).toBe(25);
    expect(m.fallbackReason).toMatch(reason);
    expect(m.diagnostic).toBeUndefined();
  });

  it('falls back to os.freemem() on unparsable output', async () => {
    const { d } = deps({ stdout: 'vm_stat: something else entirely' });
    const m = await createAvailableMemoryReader(d).read();
    expect(m.source).toBe('os.freemem-fallback');
    expect(m.fallbackReason).toMatch(/could not be parsed/);
  });

  it('falls back when execFile itself throws synchronously', async () => {
    const d: AvailableMemoryDeps = {
      ...deps().d,
      execFile: async () => () => { throw Object.assign(new Error('EAGAIN'), { code: 'EAGAIN' }); },
    };
    const m = await createAvailableMemoryReader(d).read();
    expect(m.source).toBe('os.freemem-fallback');
    expect(m.fallbackReason).toMatch(/EAGAIN/);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'reports invalid totalmem %s as a diagnostic, not a fallback, and does not gate on it',
    async (totalmem) => {
      for (const platform of ['darwin', 'linux']) {
        const { d } = deps({ platform, totalmem });
        const m = await createAvailableMemoryReader(d).read();
        expect(m.percent).toBe(100);
        expect(m.diagnostic).toMatch(/invalid totalmem/);
        expect(m.fallbackReason).toBeUndefined();
        expect(m.source).toBe(platform === 'darwin' ? 'vm_stat' : 'os.freemem');
      }
    },
  );

  it('caches a result for the TTL and measures again after it', async () => {
    let now = 0;
    const { d, calls } = deps({ now: () => now });
    const reader = createAvailableMemoryReader(d);
    await reader.read();
    now = AVAILABLE_MEMORY_CACHE_TTL_MS - 1;
    await reader.read();
    expect(calls).toHaveLength(1);
    now = AVAILABLE_MEMORY_CACHE_TTL_MS + 1;
    await reader.read();
    expect(calls).toHaveLength(2);
  });

  it('coalesces concurrent reads into one vm_stat process', async () => {
    const { d, calls } = deps();
    const reader = createAvailableMemoryReader(d);
    const results = await Promise.all(Array.from({ length: 10 }, () => reader.read()));
    expect(calls).toHaveLength(1);
    expect(new Set(results).size).toBe(1);
  });

  it('measures again after a failed in-flight read settles', async () => {
    let fail = true;
    const base = deps().d;
    const d: AvailableMemoryDeps = {
      ...base,
      now: (() => { let t = 0; return () => (t += AVAILABLE_MEMORY_CACHE_TTL_MS + 1); })(),
      execFile: async () => (_f: string, _a: readonly string[], _o: unknown, cb: Cb) => {
        setImmediate(() => (fail ? cb(Object.assign(new Error('x'), { code: 'EIO' }), '', '') : cb(null, VM_STAT_16K, '')));
        return {};
      },
    };
    const reader = createAvailableMemoryReader(d);
    expect((await reader.read()).source).toBe('os.freemem-fallback');
    fail = false;
    expect((await reader.read()).source).toBe('vm_stat');
  });
});

describe('WorkerDaemon memory gate logging', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'available-memory-2935-'));
    mkdirSync(join(tempDir, '.claude-flow', 'logs'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGHUP');
  });

  function daemonWith(reading: Record<string, unknown>, minFreeMemoryPercent: number) {
    const daemon = new WorkerDaemon(tempDir, {
      resourceThresholds: { maxCpuLoad: 1e9, minFreeMemoryPercent },
    });
    (daemon as any).memoryReader = { read: async () => reading };
    const warnings: string[] = [];
    daemon.on('log', (e: { level: string; message: string }) => {
      if (e.level === 'warn') warnings.push(e.message);
    });
    return { daemon, warnings };
  }

  it('logs a fallback once per daemon, whether or not the gate allows', async () => {
    const reading = { availableBytes: 8e9, totalBytes: 16e9, percent: 50, source: 'os.freemem-fallback', fallbackReason: 'vm_stat failed (ENOENT)' };
    const { daemon, warnings } = daemonWith(reading, 10);
    for (let i = 0; i < 3; i++) expect((await (daemon as any).canRunWorker()).allowed).toBe(true);
    expect(warnings).toEqual(['Memory gate falling back to os.freemem(): vm_stat failed (ENOENT)']);

    const denied = daemonWith({ ...reading, percent: 5 }, 10);
    expect((await (denied.daemon as any).canRunWorker()).reason).toBe('Memory too low: 5.0% available (os.freemem-fallback)');
    expect(denied.warnings).toHaveLength(1);
  });

  it('logs an invalid-totalmem diagnostic once, without claiming a fallback, and allows', async () => {
    const reading = { availableBytes: 1, totalBytes: 0, percent: 100, source: 'vm_stat', diagnostic: 'invalid totalmem: 0' };
    const { daemon, warnings } = daemonWith(reading, 10);
    expect(await (daemon as any).canRunWorker()).toEqual({ allowed: true });
    expect(await (daemon as any).canRunWorker()).toEqual({ allowed: true });
    expect(warnings).toEqual(['Memory gate measurement unavailable (invalid totalmem: 0); memory check not enforced']);
    expect(warnings.some((w) => w.includes('falling back'))).toBe(false);
  });

  it('keeps the at-threshold boundary: equal percent is allowed', async () => {
    const { daemon } = daemonWith({ availableBytes: 20, totalBytes: 100, percent: 20, source: 'vm_stat' }, 20);
    expect((await (daemon as any).canRunWorker()).allowed).toBe(true);
  });
});
