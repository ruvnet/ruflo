/**
 * Benchmark Framework
 *
 * Utilities for running performance benchmarks.
 */

export interface BenchmarkResult {
  name: string;
  iterations: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  opsPerSecond: number;
  meetsTarget: boolean;
}

export interface BenchmarkOptions {
  iterations?: number;
  warmupIterations?: number;
  targetTime?: number;
}

export class BenchmarkRunner {
  private results: BenchmarkResult[] = [];

  async run(name: string, fn: () => void | Promise<void>, options: BenchmarkOptions = {}): Promise<BenchmarkResult> {
    const { iterations = 1000, warmupIterations = 100, targetTime } = options;

    // Warmup
    for (let i = 0; i < warmupIterations; i++) {
      await fn();
    }

    // Actual benchmark
    const times: number[] = [];
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const iterStart = performance.now();
      await fn();
      times.push(performance.now() - iterStart);
    }

    const totalTime = performance.now() - start;
    const avgTime = totalTime / iterations;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const opsPerSecond = 1000 / avgTime;

    const result: BenchmarkResult = {
      name,
      iterations,
      totalTime,
      avgTime,
      minTime,
      maxTime,
      opsPerSecond,
      meetsTarget: targetTime ? avgTime <= targetTime : true,
    };

    this.results.push(result);
    return result;
  }

  getResults(): BenchmarkResult[] {
    return [...this.results];
  }

  printSummary(): void {
    console.log('\n=== Benchmark Summary ===\n');
    for (const result of this.results) {
      const status = result.meetsTarget ? '✅' : '❌';
      console.log(`${status} ${result.name}`);
      console.log(`   Avg: ${formatTime(result.avgTime)}`);
      console.log(`   Min: ${formatTime(result.minTime)}`);
      console.log(`   Max: ${formatTime(result.maxTime)}`);
      console.log(`   Ops/sec: ${result.opsPerSecond.toFixed(2)}`);
      console.log('');
    }
  }
}

export function formatTime(ms: number): string {
  if (ms < 0.001) {
    return `${(ms * 1000000).toFixed(2)}ns`;
  } else if (ms < 1) {
    return `${(ms * 1000).toFixed(2)}μs`;
  } else if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  } else {
    return `${(ms / 1000).toFixed(2)}s`;
  }
}

export function meetsTarget(actual: number, target: number): boolean {
  return actual <= target;
}

export async function benchmark(
  name: string,
  fn: () => void | Promise<void>,
  options: BenchmarkOptions = {}
): Promise<BenchmarkResult> {
  const runner = new BenchmarkRunner();
  return runner.run(name, fn, options);
}

export function createBenchmarkSuite(name: string): BenchmarkRunner {
  console.log(`\n📊 Benchmark Suite: ${name}\n`);
  return new BenchmarkRunner();
}
