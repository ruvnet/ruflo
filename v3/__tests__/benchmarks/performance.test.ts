/**
 * Performance Benchmark Tests
 *
 * Measures actual performance of critical paths.
 * These tests produce real numbers — no marketing claims.
 *
 * Run with: npx vitest run __tests__/benchmarks/
 */

import { describe, it, expect } from 'vitest';

// =============================================================================
// Helpers
// =============================================================================

function measureMs(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

async function measureMsAsync(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// =============================================================================
// MCP Server Benchmarks
// =============================================================================

describe('MCP Server Performance', () => {
  it('should create server in <50ms', async () => {
    const { createMCPServer, createStructuredLogger } = await import(
      '../../@claude-flow/integrations/src/mcp/index.js'
    );
    const logger = createStructuredLogger({ level: 'error' });

    const durations: number[] = [];
    for (let i = 0; i < 10; i++) {
      const ms = measureMs(() => {
        createMCPServer({ name: 'bench', transport: 'stdio' }, logger);
      });
      durations.push(ms);
    }

    durations.sort((a, b) => a - b);
    const p50 = percentile(durations, 50);
    const p99 = percentile(durations, 99);

    console.log(`MCP Server creation: p50=${p50.toFixed(2)}ms, p99=${p99.toFixed(2)}ms`);
    expect(p50).toBeLessThan(50);
  });

  it('should register 100 tools in <100ms', async () => {
    const { createMCPServer, createStructuredLogger } = await import(
      '../../@claude-flow/integrations/src/mcp/index.js'
    );
    const logger = createStructuredLogger({ level: 'error' });
    const server = createMCPServer({ name: 'bench', transport: 'stdio' }, logger);

    const tools = Array.from({ length: 100 }, (_, i) => ({
      name: `tool-${i}`,
      description: `Benchmark tool ${i}`,
      inputSchema: { type: 'object' as const, properties: {} },
      handler: async () => ({ result: i }),
    }));

    const ms = measureMs(() => {
      server.registerTools(tools);
    });

    console.log(`Tool registration (100 tools): ${ms.toFixed(2)}ms`);
    expect(ms).toBeLessThan(100);
  });
});

// =============================================================================
// Voting Engine Benchmarks
// =============================================================================

describe('Voting Engine Performance', () => {
  it('should initialize Raft engine in <20ms', async () => {
    const { createVotingEngine } = await import(
      '../../@claude-flow/agents/src/swarm/voting/index.js'
    );

    const durations: number[] = [];
    for (let i = 0; i < 10; i++) {
      const engine = createVotingEngine(`node-${i}`, 'raft');
      const ms = await measureMsAsync(async () => {
        await engine.initialize();
      });
      durations.push(ms);
      await engine.shutdown();
    }

    durations.sort((a, b) => a - b);
    const p50 = percentile(durations, 50);

    console.log(`Raft initialization: p50=${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(20);
  });

  it('should create proposal in <5ms', async () => {
    const { createVotingEngine } = await import(
      '../../@claude-flow/agents/src/swarm/voting/index.js'
    );

    const engine = createVotingEngine('bench-node', 'raft');
    await engine.initialize();

    const durations: number[] = [];
    for (let i = 0; i < 50; i++) {
      const ms = await measureMsAsync(async () => {
        await engine.propose({ action: `test-${i}` });
      });
      durations.push(ms);
    }

    await engine.shutdown();

    durations.sort((a, b) => a - b);
    const p50 = percentile(durations, 50);
    const p99 = percentile(durations, 99);

    console.log(`Proposal creation: p50=${p50.toFixed(2)}ms, p99=${p99.toFixed(2)}ms`);
    expect(p50).toBeLessThan(5);
  });
});

// =============================================================================
// Structured Logger Benchmarks
// =============================================================================

describe('Structured Logger Performance', () => {
  it('should log 10,000 entries in <500ms', async () => {
    const { createStructuredLogger } = await import(
      '../../@claude-flow/integrations/src/mcp/structured-logger.js'
    );

    // Discard output to measure pure logging overhead
    const logger = createStructuredLogger({
      level: 'debug',
      output: () => {},
    });

    const ms = measureMs(() => {
      for (let i = 0; i < 10_000; i++) {
        logger.info('benchmark entry', { i, data: 'test-payload' });
      }
    });

    const opsPerSec = Math.round(10_000 / (ms / 1000));
    console.log(`Structured logging: 10k entries in ${ms.toFixed(2)}ms (${opsPerSec} ops/sec)`);
    expect(ms).toBeLessThan(500);
  });

  it('should create child loggers in <0.1ms each', async () => {
    const { createStructuredLogger } = await import(
      '../../@claude-flow/integrations/src/mcp/structured-logger.js'
    );

    const logger = createStructuredLogger({ level: 'error', output: () => {} });

    const durations: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const ms = measureMs(() => {
        logger.child(`correlation-${i}`);
      });
      durations.push(ms);
    }

    durations.sort((a, b) => a - b);
    const p50 = percentile(durations, 50);

    console.log(`Child logger creation: p50=${p50.toFixed(4)}ms`);
    expect(p50).toBeLessThan(0.1);
  });
});
