/**
 * #4728 — `||` treated a confidence of 0 as missing, same class as #4611.
 * `pattern-store {confidence:0}` stored 0.8, and `minConfidence:0` became
 * 0.3 / 0.5 / 0.7 depending on the tool. Nullish coalescing keeps 0 and
 * still applies the default when the field is omitted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const bridgeStorePattern = vi.fn(async () => ({ success: true, patternId: 'pattern-test', controller: 'mock' }));
const bridgeSearchPatterns = vi.fn(async () => null);
const searchEntries = vi.fn(async () => ({ success: true, results: [], searchTime: 0 }));

vi.mock('../src/memory/memory-bridge.js', () => ({
  bridgeStorePattern,
  bridgeSearchPatterns,
}));

vi.mock('../src/memory/memory-initializer.js', () => ({
  searchEntries,
  storeEntry: vi.fn(async () => ({ success: true, id: 'stored' })),
}));

const { hooksPatternStore, hooksPatternSearch, hooksTransfer, hooksWorkerDetect } = await import('../src/mcp-tools/hooks-tools.js');

const realMin = Math.min;

function forceDetectionConfidence(confidence: number): void {
  Math.min = ((...args: number[]) => {
    if (args.length === 2 && args[0] === 1 && args[1] > 0 && args[1] <= 1) return confidence;
    return realMin(...args);
  }) as Math['min'];
}

describe('#4728 confidence 0 is honoured', () => {
  let originalCwd: string;
  let originalFlowCwd: string | undefined;
  let root: string;
  let source: string;

  beforeEach(() => {
    bridgeStorePattern.mockClear();
    bridgeSearchPatterns.mockClear();
    searchEntries.mockClear();
    Math.min = realMin;

    originalCwd = process.cwd();
    originalFlowCwd = process.env.CLAUDE_FLOW_CWD;
    root = mkdtempSync(join(tmpdir(), 'ruflo-hooks-4728-'));
    source = join(root, 'source');
    const dest = join(root, 'dest');
    mkdirSync(join(source, '.claude-flow', 'memory'), { recursive: true });
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(source, '.claude-flow', 'memory', 'store.json'), JSON.stringify({
      version: '3.0.0',
      entries: {
        'routing-zero': {
          key: 'routing-zero',
          value: 'zero',
          metadata: { type: 'routing', confidence: 0 },
          storedAt: '2026-11-05T00:00:00.000Z',
          accessCount: 0,
          lastAccessed: '2026-11-05T00:00:00.000Z',
        },
        'routing-high': {
          key: 'routing-high',
          value: 'high',
          metadata: { type: 'routing', confidence: 0.9 },
          storedAt: '2026-11-05T00:00:00.000Z',
          accessCount: 0,
          lastAccessed: '2026-11-05T00:00:00.000Z',
        },
      },
    }));
    process.chdir(dest);
    process.env.CLAUDE_FLOW_CWD = dest;
  });

  afterEach(() => {
    Math.min = realMin;
    process.chdir(originalCwd);
    if (originalFlowCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = originalFlowCwd;
    rmSync(root, { recursive: true, force: true });
  });

  it('pattern-store persists an explicit confidence of 0', async () => {
    const result = await hooksPatternStore.handler({ pattern: 'zero confidence pattern', confidence: 0 }) as { confidence: number };

    expect(result.confidence).toBe(0);
    expect(bridgeStorePattern).toHaveBeenCalledWith(expect.objectContaining({ confidence: 0 }));
  });

  it('pattern-store still defaults confidence to 0.8 when it is omitted', async () => {
    const result = await hooksPatternStore.handler({ pattern: 'default confidence pattern' }) as { confidence: number };

    expect(result.confidence).toBe(0.8);
    expect(bridgeStorePattern).toHaveBeenCalledWith(expect.objectContaining({ confidence: 0.8 }));
  });

  it('pattern-search passes minConfidence 0 through to search', async () => {
    await hooksPatternSearch.handler({ query: 'release notes', minConfidence: 0 });

    expect(bridgeSearchPatterns).toHaveBeenCalledWith(expect.objectContaining({ minConfidence: 0 }));
    expect(searchEntries).toHaveBeenCalledWith(expect.objectContaining({ threshold: 0 }));
  });

  it('pattern-search still defaults minConfidence to 0.3 when it is omitted', async () => {
    await hooksPatternSearch.handler({ query: 'release notes' });

    expect(bridgeSearchPatterns).toHaveBeenCalledWith(expect.objectContaining({ minConfidence: 0.3 }));
    expect(searchEntries).toHaveBeenCalledWith(expect.objectContaining({ threshold: 0.3 }));
  });

  it('transfer keeps a confidence-0 pattern when minConfidence is 0', async () => {
    const result = await hooksTransfer.handler({ sourcePath: source, minConfidence: 0 }) as {
      transferred: { total: number };
      skipped: { lowConfidence: number };
    };

    expect(result.transferred.total).toBe(2);
    expect(result.skipped.lowConfidence).toBe(0);
    const stored = JSON.parse(readFileSync(join(process.cwd(), '.claude-flow', 'memory', 'store.json'), 'utf8'));
    expect(stored.entries['routing-zero'].metadata.confidence).toBe(0);
    expect(stored.entries['routing-high'].metadata.confidence).toBe(0.9);
  });

  it('transfer still skips confidence 0 when minConfidence is omitted (default 0.7)', async () => {
    const result = await hooksTransfer.handler({ sourcePath: source }) as {
      transferred: { total: number };
      skipped: { lowConfidence: number };
    };

    expect(result.transferred.total).toBe(1);
    expect(result.skipped.lowConfidence).toBe(1);
    const stored = JSON.parse(readFileSync(join(process.cwd(), '.claude-flow', 'memory', 'store.json'), 'utf8'));
    expect(stored.entries['routing-zero']).toBeUndefined();
    expect(stored.entries['routing-high'].metadata.confidence).toBe(0.9);
  });

  it('worker-detect treats minConfidence 0 as a real threshold', async () => {
    forceDetectionConfidence(0.1);

    const allowed = await hooksWorkerDetect.handler({ prompt: 'optimize', minConfidence: 0 }) as { triggerDetails?: unknown[] };
    expect(allowed.triggerDetails?.map((detail) => (detail as { trigger: string }).trigger)).toEqual(['optimize']);

    const blocked = await hooksWorkerDetect.handler({ prompt: 'optimize', minConfidence: 0.2 }) as { triggerDetails?: unknown[] };
    expect(blocked.triggerDetails).toBeUndefined();
  });

  it('worker-detect still defaults minConfidence to 0.5 when it is omitted', async () => {
    forceDetectionConfidence(0.1);
    const belowDefault = await hooksWorkerDetect.handler({ prompt: 'optimize' }) as { triggerDetails?: unknown[] };
    expect(belowDefault.triggerDetails).toBeUndefined();

    Math.min = realMin;
    const atDefault = await hooksWorkerDetect.handler({ prompt: 'optimize' }) as {
      detection: { confidence: number };
      triggerDetails?: unknown[];
    };
    expect(atDefault.detection.confidence).toBe(0.5);
    expect(atDefault.triggerDetails).toHaveLength(1);
  });
});
