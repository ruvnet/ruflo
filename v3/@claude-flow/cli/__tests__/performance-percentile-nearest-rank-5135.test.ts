/**
 * #5135: performance percentile aggregation uses nearest-rank indexing.
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

function seedSamples(latencies: number[], cpuUsages: number[] = latencies) {
  const dir = join(scratch, '.claude-flow', 'performance');
  mkdirSync(dir, { recursive: true });
  const metrics = latencies.map((avg, i) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    cpu: { usage: cpuUsages[i], cores: 4 },
    memory: { used: 100, total: 1000, heap: 10 },
    latency: { avg, p50: avg, p95: avg, p99: avg },
    throughput: { requests: i + 1, operations: i + 1 },
    errors: { count: 0, rate: 0 },
  }));
  writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ metrics, benchmarks: {}, version: '3.0.0' }));
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'ruflo-5135-'));
  process.env.CLAUDE_FLOW_CWD = scratch;
});
afterEach(() => {
  if (originalProjectCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalProjectCwd;
});

describe('performance percentile nearest-rank aggregation (#5135)', () => {
  it('uses nearest rank for latency p50 while retaining high-percentile maxima', async () => {
    seedSamples([10, 20, 30, 40]);
    const t = await tool('performance_metrics');
    expect(await t({ metric: 'latency', aggregation: 'p50' })).toMatchObject({ value: 20 });
    expect(await t({ metric: 'latency', aggregation: 'p95' })).toMatchObject({ value: 40 });
    expect(await t({ metric: 'latency', aggregation: 'p99' })).toMatchObject({ value: 40 });
  });

  it('uses the lower sample for p50 with two latency samples', async () => {
    seedSamples([10, 40]);
    expect(await (await tool('performance_metrics'))({ metric: 'latency', aggregation: 'p50' }))
      .toMatchObject({ value: 10 });
  });

  it('selects rank 19 for p95 across twenty latency samples', async () => {
    seedSamples(Array.from({ length: 20 }, (_, i) => i + 1));
    const t = await tool('performance_metrics');
    expect(await t({ metric: 'latency', aggregation: 'p95' })).toMatchObject({ value: 19 });
    expect(await t({ metric: 'latency', aggregation: 'p99' })).toMatchObject({ value: 20 });
  });

  it('sorts one hundred latency samples before selecting nearest ranks', async () => {
    seedSamples(Array.from({ length: 100 }, (_, i) => (i * 37) % 100 + 1));
    const t = await tool('performance_metrics');
    expect(await t({ metric: 'latency', aggregation: 'p99' })).toMatchObject({ value: 99 });
    expect(await t({ metric: 'latency', aggregation: 'p50' })).toMatchObject({ value: 50 });
  });

  it('uses nearest rank for cpu statistics from the shared calculator', async () => {
    seedSamples([1, 1, 1, 1], [10, 20, 30, 40]);
    expect(await (await tool('performance_metrics'))({ metric: 'cpu', aggregation: 'p50' }))
      .toMatchObject({ value: 20 });
  });

  it('uses nearest rank for performance report latency percentiles', async () => {
    seedSamples([1000, 2000, 3000]);
    const report = await (await tool('performance_report'))({ format: 'json' });
    expect(report.current.latency.p50).toBe(1000);
    expect(report.current.latency.p99).toBe(3000);
  });
});
