/**
 * #4880: LocalReasoningBank.flushToDisk() caught write errors (e.g. ENOSPC),
 * logged them and left the bank dirty, but returned void — so callers such as
 * recordTrajectory() reported success for patterns that never reached disk.
 * flushToDisk() now returns false on failure, records the error, and exposes
 * it through getPersistenceStatus(); recordTrajectory() surfaces the failure.
 */
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Switchable fault: when on, writes of the patterns temp file fail with ENOSPC.
// Every other fs call (lock dir, stats file, reads) uses the real module.
const fault = vi.hoisted(() => ({ enospc: false }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const writeFileSync = ((file: unknown, ...rest: unknown[]) => {
    if (fault.enospc && typeof file === 'string' && /patterns\.json\..*\.tmp$/.test(file)) {
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    }
    return (actual.writeFileSync as (...a: unknown[]) => void)(file, ...rest);
  }) as typeof actual.writeFileSync;
  return { ...actual, default: { ...actual, writeFileSync }, writeFileSync };
});

// Keep any embedding the module generates deterministic (no model cache needed).
vi.mock('../src/memory/memory-bridge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/memory/memory-bridge.js')>();
  return { ...actual, bridgeGenerateEmbedding: vi.fn(async () => null) };
});
vi.mock('../src/memory/memory-initializer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/memory/memory-initializer.js')>();
  return {
    ...actual,
    generateEmbedding: vi.fn(async () => ({
      embedding: [1, 0, 0], dimensions: 3, model: 'mock-deterministic', backend: 'mock' as const,
    })),
  };
});

const SCRATCH = mkdtempSync(join(tmpdir(), 'intel-flush-4880-'));
const patternsPath = join(SCRATCH, '.claude-flow', 'neural', 'patterns.json');
let originalCwd: string;

function pattern(id: string, content: string) {
  return { id, type: 'test', embedding: [0.1, 0.2, 0.3], content, confidence: 0.8 };
}

beforeAll(() => {
  originalCwd = process.cwd();
  process.chdir(SCRATCH);
  mkdirSync(join(SCRATCH, '.claude-flow'), { recursive: true });
});

afterAll(() => {
  try { process.chdir(originalCwd); } catch { /* best-effort */ }
  rmSync(SCRATCH, { recursive: true, force: true });
});

beforeEach(async () => {
  fault.enospc = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const intel = await import('../src/memory/intelligence.js');
  intel.clearIntelligence();
  rmSync(join(SCRATCH, '.claude-flow', 'neural'), { recursive: true, force: true });
  await intel.initializeIntelligence();
});

afterEach(() => {
  fault.enospc = false;
  vi.restoreAllMocks();
});

describe('LocalReasoningBank flush failure reporting (#4880)', () => {
  it('returns false, stays dirty and records the error when the write fails', async () => {
    const intel = await import('../src/memory/intelligence.js');
    const bank = intel.getReasoningBank()!;

    bank.store(pattern('p-1', 'pattern one'));
    fault.enospc = true;

    expect(bank.flushToDisk()).toBe(false);

    const state = bank.getFlushState();
    expect(state.dirty).toBe(true);
    expect(state.lastFlushError).toMatch(/ENOSPC/);
    expect(typeof state.lastFlushAt).toBe('number');

    const status = intel.getPersistenceStatus();
    expect(status.dirty).toBe(true);
    expect(status.lastFlushError).toMatch(/ENOSPC/);
    expect(status.lastFlushAt).toBe(state.lastFlushAt);

    // Nothing reached disk, and the failure did not throw out of the timer path.
    expect(() => readFileSync(patternsPath, 'utf-8')).toThrow();
  });

  it('recordTrajectory surfaces the failed flush instead of reporting success', async () => {
    const intel = await import('../src/memory/intelligence.js');
    fault.enospc = true;

    const recorded = await intel.recordTrajectory(
      [{ type: 'action', content: 'write a regression test', embedding: [1, 0, 0], timestamp: Date.now() }],
      'success',
    );

    expect(recorded).toBe(false);
    expect(intel.getPersistenceStatus().lastFlushError).toMatch(/ENOSPC/);
    expect(intel.flushPatterns()).toBe(false);
  });

  it('a later successful flush persists the patterns and clears the error', async () => {
    const intel = await import('../src/memory/intelligence.js');
    const bank = intel.getReasoningBank()!;

    bank.store(pattern('p-1', 'pattern one'));
    fault.enospc = true;
    expect(bank.flushToDisk()).toBe(false);

    fault.enospc = false;
    expect(bank.flushToDisk()).toBe(true);

    const status = intel.getPersistenceStatus();
    expect(status.dirty).toBe(false);
    expect(status.lastFlushError).toBeNull();
    expect(typeof status.lastFlushAt).toBe('number');

    const ids = JSON.parse(readFileSync(patternsPath, 'utf-8')).map((p: { id: string }) => p.id);
    expect(ids).toContain('p-1');
  });

  it('reports success on the happy path, and when there is nothing to write', async () => {
    const intel = await import('../src/memory/intelligence.js');
    const bank = intel.getReasoningBank()!;

    expect(bank.flushToDisk()).toBe(true); // clean bank: nothing to write

    const recorded = await intel.recordTrajectory(
      [{ type: 'action', content: 'happy path step', embedding: [1, 0, 0], timestamp: Date.now() }],
      'success',
    );
    expect(recorded).toBe(true);

    const status = intel.getPersistenceStatus();
    expect(status.dirty).toBe(false);
    expect(status.lastFlushError).toBeNull();
  });
});
