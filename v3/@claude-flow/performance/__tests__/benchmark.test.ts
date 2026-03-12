import { describe, expect, it } from 'vitest';

import { BenchmarkRunner } from '../src/framework/benchmark';

describe('BenchmarkRunner', () => {
  it('collects environment info without CommonJS require', async () => {
    const runner = new BenchmarkRunner('esm-benchmark-suite');

    const suite = await runner.runAll([
      {
        name: 'noop',
        fn: () => {},
        options: {
          iterations: 1,
          warmup: 0,
          minRuns: 1,
          targetTime: 1,
        },
      },
    ]);

    expect(suite.environment).toMatchObject({
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    });
    expect(suite.environment.cpus).toBeGreaterThan(0);
    expect(suite.environment.memory).toBeGreaterThan(0);
  });
});
