/**
 * #4554: performance_metrics returned fixed latency/throughput literals
 * (current 45ms, p95 150ms, 1250 ops/s) and, for the default metric 'all',
 * labelled the response _real: true even with no samples recorded.
 * They now come from the samples performance_report stores (ADR-093 F8),
 * or are reported as unavailable.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalProjectCwd = process.env.CLAUDE_FLOW_CWD;
let scratch: string;

async function tool(name: string) {
  const { performanceTools } = await import('../src/mcp-tools/performance-tools.js');
  const t = performanceTools.find((c) => c.name === name)!;
  return (input: Record<string, unknown> = {}) => t.handler(input) as Promise<Record<string, any>>;
}

function seedSamples(latencies: number[], operations: number[]) {
  const dir = join(scratch, '.claude-flow', 'performance');
  mkdirSync(dir, { recursive: true });
  const metrics = latencies.map((avg, i) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    cpu: { usage: 10, cores: 4 },
    memory: { used: 100, total: 1000, heap: 10 },
    latency: { avg, p50: avg, p95: avg, p99: avg },
    throughput: { requests: i + 1, operations: operations[i] },
    errors: { count: 0, rate: 0 },
  }));
  writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ metrics, benchmarks: {}, version: '3.0.0' }));
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'ruflo-4554-'));
  process.env.CLAUDE_FLOW_CWD = scratch;
});
afterEach(() => {
  if (originalProjectCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalProjectCwd;
});

describe('performance_metrics latency/throughput (#4554)', () => {
  it('reports latency and throughput as unavailable when no samples exist, and all is not _real', async () => {
    const r = await (await tool('performance_metrics'))();
    // Baseline: _real true with latency { current: 45, p95: 150, ... } and throughput current 1250.
    expect(r._real).toBe(false);
    expect(r.metrics.latency).toMatchObject({ available: false, samples: 0, _real: false, unit: 'ms' });
    expect(r.metrics.latency.current).toBeUndefined();
    expect(r.metrics.throughput).toMatchObject({ available: false, samples: 0, _real: false, unit: 'ops/s' });
    expect(r.metrics.cpu._real).toBe(true);
  });

  it('returns a null value, not a fixed figure, for a single unavailable metric', async () => {
    const r = await (await tool('performance_metrics'))({ metric: 'latency', aggregation: 'p95' });
    expect(r).toMatchObject({ _real: false, metric: 'latency', value: null, unit: 'ms' });
  });

  it('aggregates the recorded samples', async () => {
    seedSamples([10, 20, 30], [2, 4, 6]);
    const t = await tool('performance_metrics');
    const all = await t();
    expect(all._real).toBe(true);
    expect(all.metrics.latency).toMatchObject({ current: 30, avg: 20, min: 10, max: 30, samples: 3, _real: true, unit: 'ms' });
    expect(all.metrics.throughput).toMatchObject({ current: 6, avg: 4, min: 2, max: 6, samples: 3, _real: true });
    const maxLatency = await t({ metric: 'latency', aggregation: 'max' });
    expect(maxLatency).toMatchObject({ _real: true, value: 30 });
  });

  it('does not claim _real for all when only some figures were measured', async () => {
    // Samples with latency but no throughput reading (e.g. an older store shape).
    seedSamples([10, 20], [Number.NaN, Number.NaN]);
    const all = await (await tool('performance_metrics'))();
    expect(all.metrics.latency).toMatchObject({ samples: 2, _real: true });
    expect(all.metrics.throughput).toMatchObject({ available: false, samples: 0, _real: false });
    expect(all._real).toBe(false);
  });

  it('picks up the sample performance_report records', async () => {
    await (await tool('performance_report'))();
    const r = await (await tool('performance_metrics'))();
    expect(r.metrics.latency).toMatchObject({ samples: 1, _real: true });
    expect(Number.isFinite(r.metrics.latency.current)).toBe(true);
    expect(r.metrics.latency.current).not.toBe(45);
  });
});
