import { describe, it, expect, vi } from 'vitest';
import { MessageBus, createMessageBus } from '../src/message-bus.js';

// Dream Cycle 2026-09-30 (performance) real wall-clock evidence for the
// MessageBus event-driven dispatch fix. These are sanity/regression bounds,
// not the baseline-vs-candidate discriminator (that's
// message-bus.event-driven.test.ts, run stash-isolated against baseline).
// Numbers are logged so they can be copied into the dream-cycle gist/issue.

describe('MessageBus - performance evidence (dream-cycle 2026-09-30)', () => {
  it('idle-window processQueues() wakeups stay near the backstop floor at a production-matching interval', async () => {
    const bus = createMessageBus({ processingIntervalMs: 10 }); // matches UnifiedSwarmCoordinator/SwarmHub
    const spy = vi.spyOn(bus as unknown as { processQueues: () => void }, 'processQueues');
    await bus.initialize();

    const windowMs = 2000;
    await new Promise((resolve) => setTimeout(resolve, windowMs));
    await bus.shutdown();

    const calls = spy.mock.calls.length;
    const naiveBaselineCalls = Math.floor(windowMs / 10); // what the old 10ms poll would produce
    const reduction = 1 - calls / naiveBaselineCalls;

    console.log(
      `[perf] idle-window (${windowMs}ms, processingIntervalMs=10): candidate=${calls} calls, ` +
        `pre-fix-poll-equivalent=${naiveBaselineCalls} calls, reduction=${(reduction * 100).toFixed(1)}%`
    );

    expect(calls).toBeLessThanOrEqual(Math.ceil(windowMs / 250) + 1);
    expect(reduction).toBeGreaterThan(0.9);
  });

  it('single-message delivery latency is near-instant (event-driven) at a production-matching interval', async () => {
    const bus = createMessageBus({ processingIntervalMs: 10 });
    await bus.initialize();
    bus.subscribe('agent-good', () => {});

    const samples: number[] = [];
    const N = 20;
    for (let i = 0; i < N; i++) {
      const start = performance.now();
      await new Promise<void>((resolve) => {
        bus.once('message.delivered', () => resolve());
        void bus.send({
          type: 'direct',
          from: 'agent-sender',
          to: 'agent-good',
          payload: { i },
          priority: 'normal',
          requiresAck: false,
          ttlMs: 60000,
        });
      });
      samples.push(performance.now() - start);
    }
    await bus.shutdown();

    const mean = samples.reduce((a, b) => a + b, 0) / N;
    const max = Math.max(...samples);
    console.log(
      `[perf] single-message delivery latency (N=${N}, processingIntervalMs=10): mean=${mean.toFixed(3)}ms max=${max.toFixed(3)}ms`
    );

    // Old interval-driven dispatch averaged ~half the 10ms tick (~5ms) with
    // worst case near 10ms; event-driven dispatch should land well under that.
    expect(mean).toBeLessThan(5);
  });

  it('saturated-load throughput does not regress vs. the pre-fix batched-poll baseline', async () => {
    const bus = createMessageBus({ processingIntervalMs: 10 });
    await bus.initialize();

    let delivered = 0;
    bus.subscribe('agent-good', () => {
      delivered++;
    });

    const TOTAL = 2000;
    const start = performance.now();
    const sendPromises: Promise<string>[] = [];
    for (let i = 0; i < TOTAL; i++) {
      sendPromises.push(
        bus.send({
          type: 'direct',
          from: 'agent-sender',
          to: 'agent-good',
          payload: { i },
          priority: 'normal',
          requiresAck: false,
          ttlMs: 60000,
        })
      );
    }
    await Promise.all(sendPromises);

    // Drain: wait for delivery to catch up (event loop needs to process the
    // setImmediate-scheduled processQueues()/deliverMessage() chain).
    const deadline = performance.now() + 10000;
    while (delivered < TOTAL && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const elapsed = performance.now() - start;
    await bus.shutdown();

    const throughput = TOTAL / (elapsed / 1000);
    console.log(
      `[perf] saturated throughput (N=${TOTAL}, processingIntervalMs=10): delivered=${delivered}/${TOTAL} ` +
        `elapsed=${elapsed.toFixed(1)}ms throughput=${throughput.toFixed(0)} msg/s`
    );

    expect(delivered).toBe(TOTAL);
    // Module header targets 1000+ msgs/sec; regression threshold from the
    // frozen hypothesis (<=5% vs baseline) is checked via the stash-isolated
    // comparison recorded in the PR/issue — this is the standalone sanity floor.
    expect(throughput).toBeGreaterThan(1000);
  });
});
