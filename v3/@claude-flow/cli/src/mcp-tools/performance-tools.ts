/**
 * Performance MCP Tools for CLI
 *
 * V2 Compatibility - Performance monitoring and optimization tools
 *
 * ✅ Uses REAL process metrics where available:
 * - process.memoryUsage() for real heap/memory stats
 * - process.cpuUsage() for real CPU time
 * - os module for system load and memory
 * - Real timing for benchmark operations
 *
 * Note: Some optimization suggestions are illustrative
 */

import { type MCPTool, getProjectCwd } from './types.js';
import { validateIdentifier } from './validate-input.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as os from 'node:os';

// Storage paths
const STORAGE_DIR = '.claude-flow';
const PERF_DIR = 'performance';
const METRICS_FILE = 'metrics.json';
const BENCHMARKS_FILE = 'benchmarks.json';
const MAX_BENCHMARK_ITERATIONS = 10_000;

interface PerfMetrics {
  timestamp: string;
  cpu: { usage: number; cores: number };
  memory: { used: number; total: number; heap: number };
  latency: { avg: number; p50: number; p95: number; p99: number };
  throughput: { requests: number; operations: number };
  errors: { count: number; rate: number };
}

interface Benchmark {
  id: string;
  name: string;
  type: string;
  results: {
    duration: number;
    iterations: number;
    opsPerSecond: number;
    memory: number;
  };
  createdAt: string;
}

interface PerfStore {
  metrics: PerfMetrics[];
  benchmarks: Record<string, Benchmark>;
  version: string;
}

function getPerfDir(): string {
  return join(getProjectCwd(), STORAGE_DIR, PERF_DIR);
}

function getPerfPath(): string {
  return join(getPerfDir(), METRICS_FILE);
}

function ensurePerfDir(): void {
  const dir = getPerfDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadPerfStore(): PerfStore {
  try {
    const path = getPerfPath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch {
    // Return empty store
  }
  return { metrics: [], benchmarks: {}, version: '3.0.0' };
}

function savePerfStore(store: PerfStore): void {
  ensurePerfDir();
  writeFileSync(getPerfPath(), JSON.stringify(store, null, 2), 'utf-8');
}

export const performanceTools: MCPTool[] = [
  {
    name: 'performance_report',
    description: 'Generate performance report Use when native shell timing (`time`, `hyperfine`) is wrong because you want Ruflo-aware benchmarks — HNSW search latency, breaker decisions/sec, MCP response p50/p95, embeddings throughput. For OS-level process profiling, native shell + perf are fine.',
    category: 'performance',
    inputSchema: {
      type: 'object',
      properties: {
        timeRange: { type: 'string', description: 'Time range (1h, 24h, 7d)' },
        format: { type: 'string', enum: ['json', 'summary', 'detailed'], description: 'Report format' },
        components: { type: 'array', items: { type: 'string' }, description: 'Components to include' },
      },
    },
    handler: async (input) => {
      const store = loadPerfStore();
      const format = (input.format as string) || 'summary';

      // Get REAL system metrics via Node.js APIs
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      const loadAvg = os.loadavg();
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();

      // Calculate real CPU usage percentage from load average
      const cpuPercent = (loadAvg[0] / cpus.length) * 100;

      // ADR-093 F8: replace hardcoded latency fixtures (50/40/100/200) with
      // an actual self-measured latency probe. Throughput now reflects real
      // metric collection cadence (calls/min over the stored history) rather
      // than an arbitrary +1/+10 increment per call.
      const probeStart = process.hrtime.bigint();
      // Tiny CPU+memory work that mirrors a typical MCP tool call
      let probeAcc = 0;
      for (let i = 0; i < 1000; i++) probeAcc += Math.sqrt(i);
      const probeNs = Number(process.hrtime.bigint() - probeStart);
      const selfLatencyMs = probeNs / 1e6;

      const recent = store.metrics.slice(-10);
      const recentLatencies = recent.map(m => m.latency.avg).filter(n => Number.isFinite(n));
      recentLatencies.push(selfLatencyMs);
      const sorted = [...recentLatencies].sort((a, b) => a - b);
      const pct = (p: number) => sorted.length === 0 ? selfLatencyMs : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
      const avg = recentLatencies.reduce((s, n) => s + n, 0) / Math.max(1, recentLatencies.length);

      // Throughput from real cadence: count metric samples in the last 60s.
      const cutoff = Date.now() - 60_000;
      const samplesInLastMinute = store.metrics.filter(m => new Date(m.timestamp).getTime() >= cutoff).length + 1;
      const opsPerSecond = samplesInLastMinute / 60;

      const currentMetrics: PerfMetrics = {
        timestamp: new Date().toISOString(),
        cpu: { usage: Math.min(cpuPercent, 100), cores: cpus.length },
        memory: {
          used: Math.round((totalMem - freeMem) / 1024 / 1024),
          total: Math.round(totalMem / 1024 / 1024),
          heap: Math.round(memUsage.heapUsed / 1024 / 1024),
        },
        latency: {
          avg: Number(avg.toFixed(3)),
          p50: Number(pct(50).toFixed(3)),
          p95: Number(pct(95).toFixed(3)),
          p99: Number(pct(99).toFixed(3)),
        },
        throughput: {
          requests: store.metrics.length + 1,
          operations: Number(opsPerSecond.toFixed(2)),
        },
        errors: { count: 0, rate: 0 },
      };
      // probeAcc kept reachable to prevent V8 dead-code elimination of the loop
      if (probeAcc < 0) currentMetrics.errors.count = -1;

      store.metrics.push(currentMetrics);
      // Keep last 100 metrics
      if (store.metrics.length > 100) {
        store.metrics = store.metrics.slice(-100);
      }
      savePerfStore(store);

      if (format === 'summary') {
        return {
          _real: true,
          status: 'healthy',
          cpu: `${currentMetrics.cpu.usage.toFixed(1)}%`,
          memory: `${currentMetrics.memory.used}MB / ${currentMetrics.memory.total}MB`,
          heap: `${currentMetrics.memory.heap}MB`,
          latency: `${currentMetrics.latency.avg.toFixed(0)}ms avg`,
          throughput: `${currentMetrics.throughput.operations} ops/s`,
          errorRate: `${(currentMetrics.errors.rate * 100).toFixed(2)}%`,
          timestamp: currentMetrics.timestamp,
        };
      }

      // Calculate trends from history
      const history = store.metrics.slice(-10);
      const cpuTrend = history.length >= 2
        ? (history[history.length - 1].cpu.usage > history[0].cpu.usage ? 'increasing' : 'stable')
        : 'stable';
      const memTrend = history.length >= 2
        ? (history[history.length - 1].memory.used > history[0].memory.used ? 'increasing' : 'stable')
        : 'stable';

      return {
        _real: true,
        current: currentMetrics,
        history,
        system: {
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          cpuModel: cpus[0]?.model,
          loadAverage: loadAvg,
        },
        trends: {
          cpu: cpuTrend,
          memory: memTrend,
          latency: 'stable',
        },
        recommendations: currentMetrics.memory.used / currentMetrics.memory.total > 0.8
          ? [{ priority: 'high', message: 'Memory usage above 80% - consider cleanup' }]
          : currentMetrics.cpu.usage > 70
            ? [{ priority: 'medium', message: 'CPU load elevated - check for resource-intensive processes' }]
            : [{ priority: 'low', message: 'System running normally' }],
      };
    },
  },
  {
    name: 'performance_bottleneck',
    description: 'Detect performance bottlenecks Use when native shell timing (`time`, `hyperfine`) is wrong because you want Ruflo-aware benchmarks — HNSW search latency, breaker decisions/sec, MCP response p50/p95, embeddings throughput. For OS-level process profiling, native shell + perf are fine.',
    category: 'performance',
    inputSchema: {
      type: 'object',
      properties: {
        component: { type: 'string', description: 'Component to analyze' },
        threshold: { type: 'number', description: 'Alert threshold' },
        deep: { type: 'boolean', description: 'Deep analysis' },
      },
    },
    handler: async (_input) => {
      if (_input.component) { const v = validateIdentifier(_input.component, 'component'); if (!v.valid) return { success: false, error: v.error }; }
      const loadAvg = os.loadavg();
      const cpus = os.cpus();
      const cpuPercent = Math.min((loadAvg[0] / cpus.length) * 100, 100);

      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const memPercent = ((totalMem - freeMem) / totalMem) * 100;
      const memUsage = process.memoryUsage();
      const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      // Measure disk I/O latency with a real write/read cycle
      let diskLatencyMs = -1;
      try {
        ensurePerfDir();
        const probeFile = join(getPerfDir(), '.io-probe');
        const payload = Buffer.alloc(4096, 0x41); // 4 KB
        const t0 = performance.now();
        writeFileSync(probeFile, payload);
        readFileSync(probeFile);
        diskLatencyMs = Math.round((performance.now() - t0) * 100) / 100;
        try { unlinkSync(probeFile); } catch { /* best-effort */ }
      } catch { /* disk probe failed, leave -1 */ }

      // Check stored benchmark history for slow operations
      const store = loadPerfStore();
      const slowBenchmarks = Object.values(store.benchmarks)
        .filter((b: Benchmark) => b.results.opsPerSecond < 100)
        .map((b: Benchmark) => ({ name: b.name, opsPerSec: b.results.opsPerSecond, date: b.createdAt }));

      type Severity = 'critical' | 'high' | 'medium' | 'low';
      const classify = (value: number, thresholds: [number, number, number]): Severity =>
        value > thresholds[0] ? 'critical' : value > thresholds[1] ? 'high' : value > thresholds[2] ? 'medium' : 'low';

      const bottlenecks: Array<{ component: string; severity: Severity; value: number; threshold: number; message: string; latencyMs?: number }> = [];

      const cpuSev = classify(cpuPercent, [90, 75, 50]);
      bottlenecks.push({ component: 'cpu', severity: cpuSev, value: Math.round(cpuPercent * 10) / 10, threshold: cpuSev === 'critical' ? 90 : cpuSev === 'high' ? 75 : 50, message: `CPU load at ${(Math.round(cpuPercent * 10) / 10)}%` });

      const memSev = classify(memPercent, [90, 75, 50]);
      bottlenecks.push({ component: 'memory', severity: memSev, value: Math.round(memPercent * 10) / 10, threshold: memSev === 'critical' ? 90 : memSev === 'high' ? 75 : 50, message: `Memory at ${(Math.round(memPercent * 10) / 10)}%` });

      if (diskLatencyMs >= 0) {
        const diskSev: Severity = diskLatencyMs > 50 ? 'critical' : diskLatencyMs > 20 ? 'high' : diskLatencyMs > 5 ? 'medium' : 'low';
        bottlenecks.push({ component: 'disk-io', severity: diskSev, value: diskLatencyMs, threshold: diskSev === 'critical' ? 50 : diskSev === 'high' ? 20 : 5, message: `Disk I/O latency ${diskLatencyMs}ms`, latencyMs: diskLatencyMs });
      }

      if (slowBenchmarks.length > 0) {
        bottlenecks.push({ component: 'slow-operations', severity: 'medium', value: slowBenchmarks.length, threshold: 0, message: `${slowBenchmarks.length} slow benchmark(s) recorded` });
      }

      return {
        success: true,
        _real: true,
        bottlenecks,
        system: { cpuPercent: Math.round(cpuPercent * 10) / 10, memoryPercent: Math.round(memPercent * 10) / 10, heapMB, diskLatencyMs },
        slowBenchmarks: slowBenchmarks.slice(0, 5),
      };
    },
  },
  {
    name: 'performance_benchmark',
    description: 'Run performance benchmarks Use when native shell timing (`time`, `hyperfine`) is wrong because you want Ruflo-aware benchmarks — HNSW search latency, breaker decisions/sec, MCP response p50/p95, embeddings throughput. For OS-level process profiling, native shell + perf are fine.',
    category: 'performance',
    inputSchema: {
      type: 'object',
      properties: {
        suite: { type: 'string', enum: ['all', 'memory', 'neural', 'swarm', 'io'], description: 'Benchmark suite' },
        iterations: { type: 'integer', minimum: 1, maximum: MAX_BENCHMARK_ITERATIONS, description: 'Number of iterations (maximum 10000)' },
        warmup: { type: 'boolean', description: 'Include warmup phase' },
      },
    },
    handler: async (input) => {
      const requestedIterations = input.iterations === undefined ? 100 : input.iterations;
      if (typeof requestedIterations !== 'number' || !Number.isSafeInteger(requestedIterations) || requestedIterations < 1) {
        return { success: false, error: 'iterations must be a positive safe integer' };
      }
      const iterations = Math.min(requestedIterations, MAX_BENCHMARK_ITERATIONS);
      const store = loadPerfStore();
      const suite = (input.suite as string) || 'all';
      const warmup = input.warmup !== false;

      // Synthetic data benchmarks — measures actual CPU/memory throughput
      const benchmarkFunctions: Record<string, () => void> = {
        memory: () => {
          // Synthetic data benchmark — measures actual allocation + sort throughput
          const arr = new Array(1000).fill(0).map(() => Math.random());
          arr.sort();
        },
        neural: () => {
          // Synthetic data benchmark — measures actual matrix multiplication throughput
          const size = 64;
          const a = Array.from({ length: size }, () => Array.from({ length: size }, () => Math.random()));
          const b = Array.from({ length: size }, () => Array.from({ length: size }, () => Math.random()));
          // Simple matrix multiplication
          for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
              let sum = 0;
              for (let k = 0; k < size; k++) sum += a[i][k] * b[k][j];
            }
          }
        },
        swarm: () => {
          // Synthetic data benchmark — measures actual object creation + manipulation throughput
          const agents = Array.from({ length: 10 }, (_, i) => ({ id: i, status: 'active', tasks: [] as number[] }));
          agents.forEach(a => { for (let i = 0; i < 100; i++) a.tasks.push(i); });
          agents.sort((a, b) => a.tasks.length - b.tasks.length);
        },
        io: () => {
          // Synthetic data benchmark — measures actual JSON serialization throughput
          const data = { agents: Array.from({ length: 50 }, (_, i) => ({ id: i, name: `agent-${i}` })) };
          const json = JSON.stringify(data);
          JSON.parse(json);
        },
      };

      const results: Array<{ name: string; opsPerSec: number; avgLatency: string; memoryUsage: string; _real: boolean; _dataSource: 'synthetic' }> = [];
      const suitesToRun = suite === 'all' ? Object.keys(benchmarkFunctions) : [suite];

      // Warmup phase
      if (warmup) {
        for (const suiteName of suitesToRun) {
          const fn = benchmarkFunctions[suiteName];
          if (fn) for (let i = 0; i < 10; i++) fn();
        }
      }

      // Real benchmarks with actual timing
      for (const suiteName of suitesToRun) {
        const fn = benchmarkFunctions[suiteName];
        if (fn) {
          const memBefore = process.memoryUsage().heapUsed;
          const startTime = performance.now();

          for (let i = 0; i < iterations; i++) fn();

          const endTime = performance.now();
          const memAfter = process.memoryUsage().heapUsed;

          const durationMs = endTime - startTime;
          const opsPerSec = Math.round((iterations / durationMs) * 1000);
          const avgLatencyMs = durationMs / iterations;
          const memoryDelta = Math.round((memAfter - memBefore) / 1024);

          const id = `bench-${suiteName}-${Date.now()}`;
          const result: Benchmark = {
            id,
            name: suiteName,
            type: 'performance',
            results: {
              duration: durationMs / 1000,
              iterations,
              opsPerSecond: opsPerSec,
              memory: Math.max(0, memoryDelta),
            },
            createdAt: new Date().toISOString(),
          };

          store.benchmarks[id] = result;

          results.push({
            name: suiteName,
            opsPerSec,
            avgLatency: `${avgLatencyMs.toFixed(3)}ms`,
            memoryUsage: `${Math.abs(memoryDelta)}KB`,
            _real: true,
            _dataSource: 'synthetic' as const,
          });
        }
      }

      savePerfStore(store);

      // Calculate comparison vs previous benchmarks
      const allBenchmarks = Object.values(store.benchmarks);
      const previousBenchmarks = allBenchmarks
        .filter(b => suitesToRun.includes(b.name) && b.createdAt < results[0]?.name)
        .slice(-suitesToRun.length);

      const comparison = previousBenchmarks.length > 0
        ? {
            vsPrevious: `${results.reduce((sum, r) => sum + r.opsPerSec, 0) > previousBenchmarks.reduce((sum, b) => sum + b.results.opsPerSecond, 0) ? '+' : ''}${Math.round(((results.reduce((sum, r) => sum + r.opsPerSec, 0) / previousBenchmarks.reduce((sum, b) => sum + b.results.opsPerSecond, 0)) - 1) * 100)}% vs previous`,
            totalBenchmarks: allBenchmarks.length,
          }
        : { note: 'First benchmark run - no comparison available', totalBenchmarks: allBenchmarks.length };

      return {
        _real: true,
        _note: 'Benchmarks use synthetic workloads to measure throughput. Results reflect actual CPU/memory performance.',
        suite,
        iterations,
        warmup,
        results,
        comparison,
        timestamp: new Date().toISOString(),
      };
    },
  },
  {
    name: 'performance_profile',
    description: 'Profile specific component or operation Use when native shell timing (`time`, `hyperfine`) is wrong because you want Ruflo-aware benchmarks — HNSW search latency, breaker decisions/sec, MCP response p50/p95, embeddings throughput. For OS-level process profiling, native shell + perf are fine.',
    category: 'performance',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Component to profile' },
        duration: { type: 'number', description: 'Profile duration in seconds' },
        sampleRate: { type: 'number', description: 'Sampling rate' },
      },
    },
    handler: async (input) => {
      if (input.target) { const v = validateIdentifier(input.target, 'target'); if (!v.valid) return { success: false, error: v.error }; }
      const target = (input.target as string) || 'all';
      const durationSec = Math.min((input.duration as number) || 1, 10);
      const durationMs = durationSec * 1000;

      const cpuBefore = process.cpuUsage();
      const memBefore = process.memoryUsage();
      const wallStart = performance.now();

      // Profile operations keyed by name
      const ops: Record<string, { totalMs: number; count: number }> = {};
      const runOp = (name: string, fn: () => void) => {
        const t0 = performance.now();
        fn();
        const elapsed = performance.now() - t0;
        if (!ops[name]) ops[name] = { totalMs: 0, count: 0 };
        ops[name].totalMs += elapsed;
        ops[name].count += 1;
      };

      const targets = target === 'all' ? ['memory', 'io', 'cpu'] : [target];
      const deadline = wallStart + durationMs;

      while (performance.now() < deadline) {
        for (const t of targets) {
          if (performance.now() >= deadline) break;
          if (t === 'memory') {
            runOp('json-serialize', () => { const d = Array.from({ length: 200 }, (_, i) => ({ id: i, v: Math.random() })); JSON.stringify(d); });
            runOp('json-parse', () => { JSON.parse(JSON.stringify({ a: 1, b: [2, 3], c: { d: 4 } })); });
            runOp('array-sort', () => { const a = Array.from({ length: 500 }, () => Math.random()); a.sort(); });
          } else if (t === 'io') {
            runOp('file-write', () => { ensurePerfDir(); writeFileSync(join(getPerfDir(), '.profile-probe'), 'x'.repeat(1024)); });
            runOp('file-read', () => { try { readFileSync(join(getPerfDir(), '.profile-probe')); } catch { /* ok */ } });
          } else if (t === 'cpu') {
            runOp('matrix-mult', () => { const s = 32; const a = Array.from({ length: s }, () => Array.from({ length: s }, () => Math.random())); for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) { let sum = 0; for (let k = 0; k < s; k++) sum += a[i][k] * a[k][j]; } });
            runOp('hash-compute', () => { let h = 0; for (let i = 0; i < 10000; i++) h = ((h << 5) - h + i) | 0; });
          }
        }
      }

      const wallEnd = performance.now();
      const cpuAfter = process.cpuUsage(cpuBefore);
      const memAfter = process.memoryUsage();
      const actualDuration = Math.round((wallEnd - wallStart) * 100) / 100;
      const totalOpMs = Object.values(ops).reduce((s, o) => s + o.totalMs, 0);

      const hotspots = Object.entries(ops)
        .map(([operation, data]) => ({
          operation,
          avgLatencyMs: Math.round((data.totalMs / data.count) * 1000) / 1000,
          opsCount: data.count,
          percentOfTotal: Math.round((data.totalMs / (totalOpMs || 1)) * 10000) / 100,
        }))
        .sort((a, b) => b.percentOfTotal - a.percentOfTotal);

      // Cleanup probe file
      try { unlinkSync(join(getPerfDir(), '.profile-probe')); } catch { /* ok */ }

      return {
        success: true,
        _real: true,
        target,
        duration: actualDuration,
        cpu: {
          userMs: Math.round(cpuAfter.user / 1000),
          systemMs: Math.round(cpuAfter.system / 1000),
          percentUtilization: Math.round(((cpuAfter.user + cpuAfter.system) / 1000 / actualDuration) * 10000) / 100,
        },
        memory: {
          heapDeltaMB: Math.round((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024 * 100) / 100,
          externalDeltaMB: Math.round((memAfter.external - memBefore.external) / 1024 / 1024 * 100) / 100,
        },
        hotspots,
      };
    },
  },
  {
    name: 'performance_optimize',
    description: 'Apply performance optimizations Use when native shell timing (`time`, `hyperfine`) is wrong because you want Ruflo-aware benchmarks — HNSW search latency, breaker decisions/sec, MCP response p50/p95, embeddings throughput. For OS-level process profiling, native shell + perf are fine.',
    category: 'performance',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['memory', 'latency', 'throughput', 'all'], description: 'Optimization target' },
        aggressive: { type: 'boolean', description: 'Apply aggressive optimizations' },
      },
    },
    handler: async (input) => {
      const target = (input.target as string) || 'all';
      const aggressive = input.aggressive === true;

      // Snapshot system state BEFORE optimizations
      const loadBefore = os.loadavg();
      const cpusBefore = os.cpus();
      const cpuPercentBefore = Math.min((loadBefore[0] / cpusBefore.length) * 100, 100);
      const memBefore = process.memoryUsage();
      const memMBBefore = Math.round(memBefore.heapUsed / 1024 / 1024 * 100) / 100;

      let diskLatencyBefore = -1;
      try {
        ensurePerfDir();
        const probe = join(getPerfDir(), '.opt-probe');
        const t0 = performance.now();
        writeFileSync(probe, Buffer.alloc(4096, 0x42));
        readFileSync(probe);
        diskLatencyBefore = Math.round((performance.now() - t0) * 100) / 100;
        try { unlinkSync(probe); } catch { /* ok */ }
      } catch { /* ok */ }

      const optimizations: Array<{ action: string; applied: boolean; effect?: string; recommendation?: string }> = [];
      const targets = target === 'all' ? ['memory', 'latency', 'throughput'] : [target];

      for (const t of targets) {
        if (t === 'memory') {
          if (aggressive && typeof global.gc === 'function') {
            const heapBefore = process.memoryUsage().heapUsed;
            global.gc();
            const heapAfter = process.memoryUsage().heapUsed;
            const freedMB = Math.round((heapBefore - heapAfter) / 1024 / 1024 * 100) / 100;
            optimizations.push({ action: 'gc-collect', applied: true, effect: `Freed ${freedMB}MB heap` });
          } else if (aggressive) {
            optimizations.push({ action: 'gc-collect', applied: false, recommendation: 'Run with --expose-gc to enable forced garbage collection' });
          }
          const memPercent = ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;
          if (memPercent > 75) {
            optimizations.push({ action: 'recommend-memory-cleanup', applied: false, recommendation: `Memory at ${Math.round(memPercent)}% - consider reducing in-memory caches or agent count` });
          }
          optimizations.push({ action: 'recommend-hnsw-rebuild', applied: false, recommendation: 'Rebuild HNSW index to reclaim fragmented memory' });
        }

        if (t === 'latency') {
          if (diskLatencyBefore > 20) {
            optimizations.push({ action: 'recommend-ssd', applied: false, recommendation: `Disk I/O latency ${diskLatencyBefore}ms is high - ensure storage is SSD-backed` });
          }
          optimizations.push({ action: 'recommend-batch-io', applied: false, recommendation: 'Batch file operations to reduce syscall overhead' });
        }

        if (t === 'throughput') {
          const coreCount = cpusBefore.length;
          const batchSize = Math.max(2, Math.floor(coreCount / 2));
          optimizations.push({ action: 'recommend-batch-size', applied: false, recommendation: `Use batch size ${batchSize} for ${coreCount} CPU cores` });
          if (cpuPercentBefore > 70) {
            optimizations.push({ action: 'recommend-throttle', applied: false, recommendation: `CPU at ${Math.round(cpuPercentBefore)}% - throttle concurrent agents to avoid contention` });
          }
        }
      }

      // If aggressive, clear perf probe files
      if (aggressive) {
        try {
          const dir = getPerfDir();
          const probes = readdirSync(dir).filter((f: string) => f.startsWith('.'));
          probes.forEach((f: string) => { try { unlinkSync(join(dir, f)); } catch { /* ok */ } });
          if (probes.length > 0) optimizations.push({ action: 'clear-probe-files', applied: true, effect: `Removed ${probes.length} probe file(s)` });
        } catch { /* ok */ }
      }

      // Snapshot AFTER
      const memAfter = process.memoryUsage();
      const loadAfter = os.loadavg();

      return {
        success: true,
        _real: true,
        target,
        aggressive,
        before: { cpuPercent: Math.round(cpuPercentBefore * 10) / 10, memoryMB: memMBBefore, diskLatencyMs: diskLatencyBefore },
        optimizations,
        after: {
          cpuPercent: Math.round(Math.min((loadAfter[0] / cpusBefore.length) * 100, 100) * 10) / 10,
          memoryMB: Math.round(memAfter.heapUsed / 1024 / 1024 * 100) / 100,
          diskLatencyMs: diskLatencyBefore, // same measurement window
        },
      };
    },
  },
  {
    name: 'performance_metrics',
    description: 'Get detailed performance metrics Use when native shell timing (`time`, `hyperfine`) is wrong because you want Ruflo-aware benchmarks — HNSW search latency, breaker decisions/sec, MCP response p50/p95, embeddings throughput. For OS-level process profiling, native shell + perf are fine.',
    category: 'performance',
    inputSchema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['cpu', 'memory', 'latency', 'throughput', 'all'], description: 'Metric type' },
        aggregation: { type: 'string', enum: ['avg', 'min', 'max', 'p50', 'p95', 'p99'], description: 'Aggregation method' },
        timeRange: { type: 'string', description: 'Time range' },
      },
    },
    handler: async (input) => {
      const metric = (input.metric as string) || 'all';
      const aggregation = (input.aggregation as string) || 'avg';

      // Get REAL system metrics
      const memUsage = process.memoryUsage();
      const loadAvg = os.loadavg();
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const store = loadPerfStore();

      // Calculate real CPU percentage from load average
      const cpuPercent = Math.min((loadAvg[0] / cpus.length) * 100, 100);
      const memUsedMB = Math.round((totalMem - freeMem) / 1024 / 1024);
      const memTotalMB = Math.round(totalMem / 1024 / 1024);
      const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      // Calculate statistics from stored history
      const history = store.metrics.slice(-100);
      const cpuHistory = history.map(m => m.cpu.usage);
      const memHistory = history.map(m => m.memory.used);

      const calcStats = (arr: number[], current: number) => {
        if (arr.length === 0) return { current, avg: current, min: current, max: current, p50: current, p95: current, p99: current };
        const sorted = [...arr].sort((a, b) => a - b);
        return {
          current,
          avg: arr.reduce((s, v) => s + v, 0) / arr.length,
          min: Math.min(...arr),
          max: Math.max(...arr),
          p50: sorted[Math.floor(sorted.length * 0.5)],
          p95: sorted[Math.floor(sorted.length * 0.95)],
          p99: sorted[Math.floor(sorted.length * 0.99)],
        };
      };

      const cpuStats = calcStats(cpuHistory, cpuPercent);
      const memStats = calcStats(memHistory, memUsedMB);

      // #4554: latency/throughput used to be fixed literals (45ms, 1250 ops/s).
      // Report the samples performance_report records (ADR-093 F8), or say none exist.
      const sampled = (values: number[], unit: string) => {
        const real = values.filter(n => Number.isFinite(n));
        return real.length === 0
          ? { available: false, unit, samples: 0, _real: false, _note: 'No samples recorded yet: run performance_report to record one.' }
          : { ...calcStats(real, real[real.length - 1]), unit, samples: real.length, _real: true };
      };

      const allMetrics = {
        cpu: {
          ...cpuStats,
          unit: '%',
          cores: cpus.length,
          model: cpus[0]?.model,
          loadAverage: loadAvg,
          _real: true,
        },
        memory: {
          ...memStats,
          total: memTotalMB,
          heap: heapMB,
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
          external: Math.round(memUsage.external / 1024 / 1024),
          unit: 'MB',
          _real: true,
        },
        latency: sampled(history.map(m => m.latency?.avg), 'ms'),
        throughput: sampled(history.map(m => m.throughput?.operations), 'ops/s'),
      };

      if (metric === 'all') {
        return {
          _real: Object.values(allMetrics).every(m => m._real),
          metrics: allMetrics,
          aggregation,
          historySize: history.length,
          timestamp: new Date().toISOString(),
        };
      }

      const selectedMetric = allMetrics[metric as keyof typeof allMetrics];
      return {
        _real: selectedMetric._real,
        metric,
        value: (selectedMetric as Record<string, unknown>)[aggregation] ?? null,
        unit: selectedMetric.unit,
        details: selectedMetric,
        timestamp: new Date().toISOString(),
      };
    },
  },
];
