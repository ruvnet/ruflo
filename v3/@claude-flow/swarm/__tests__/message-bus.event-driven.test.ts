import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageBus, createMessageBus } from '../src/message-bus.js';

// Dream Cycle 2026-09-30 (performance): MessageBus.processQueues() used to be
// driven purely by a fixed setInterval(processingIntervalMs) poll, so both
// delivery latency and retry redelivery were bounded by whatever interval a
// caller configured — both production callers (UnifiedSwarmCoordinator,
// SwarmHub) configure 10ms, meaning 100 wakeups/sec per active swarm even
// with zero traffic. Dispatch is now event-driven (triggered from
// enqueue()/retry re-queuing via scheduleProcessing()); the configured
// interval is floored to a >=250ms backstop that should rarely, if ever,
// actually fire under normal traffic. These tests use a deliberately slow
// configured interval (5000ms) to prove delivery/retry no longer depend on
// it, and a production-matching interval (10ms) to prove wakeup count drops.

describe('MessageBus - event-driven dispatch (dream-cycle 2026-09-30)', () => {
  let bus: MessageBus;

  afterEach(async () => {
    await bus.shutdown();
  });

  it('delivers a healthy subscriber near-instantly even with a slow configured backstop interval', async () => {
    bus = createMessageBus({
      processingIntervalMs: 5000,
      ackTimeoutMs: 1000,
    });
    await bus.initialize();

    let deliveredEvents = 0;
    bus.on('message.delivered', () => {
      deliveredEvents++;
    });

    bus.subscribe('agent-good', () => {});

    await bus.send({
      type: 'direct',
      from: 'agent-sender',
      to: 'agent-good',
      payload: { hello: 'world' },
      priority: 'normal',
      requiresAck: false,
      ttlMs: 60000,
    });

    // With a 5000ms configured interval, a poll-only baseline would still be
    // waiting for the first tick here — event-driven dispatch should not be.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(deliveredEvents).toBe(1);
  });

  it('retries a failing subscriber promptly, independent of a slow configured backstop interval', async () => {
    bus = createMessageBus({
      processingIntervalMs: 5000,
      retryAttempts: 3,
      ackTimeoutMs: 1000,
    });
    await bus.initialize();

    let callbackInvocations = 0;
    let failedEvents = 0;
    let retryEvents = 0;

    bus.on('message.failed', () => {
      failedEvents++;
    });
    bus.on('message.retry', () => {
      retryEvents++;
    });

    bus.subscribe('agent-bad', () => {
      callbackInvocations++;
      throw new Error('simulated handler crash');
    });

    await bus.send({
      type: 'direct',
      from: 'agent-good',
      to: 'agent-bad',
      payload: { hello: 'world' },
      priority: 'normal',
      requiresAck: false,
      ttlMs: 60000,
    });

    // Baseline (interval-only dispatch) would deliver nothing at all within
    // this window since the configured interval (5000ms) hasn't ticked yet.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(callbackInvocations).toBe(3);
    expect(retryEvents).toBe(2);
    expect(failedEvents).toBe(1);
  });

  it('floors an aggressive configured interval to a low-frequency idle backstop instead of busy-polling', async () => {
    bus = createMessageBus({
      // Matches both production callers (UnifiedSwarmCoordinator,
      // SwarmHub), which explicitly configure 10ms today.
      processingIntervalMs: 10,
    });

    const processQueuesSpy = vi.spyOn(bus as unknown as { processQueues: () => void }, 'processQueues');

    await bus.initialize();

    // No messages sent — this is the idle-window case the hypothesis
    // targets. A pure 10ms poll would fire ~26 times in 260ms; a >=250ms
    // backstop fires at most once or twice.
    await new Promise((resolve) => setTimeout(resolve, 260));

    expect(processQueuesSpy.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('delivers a message that was enqueued before its subscriber arrived, promptly, not just at the next backstop tick', async () => {
    // Adversarial-critic finding (2026-09-30): a coordinator can send() to an
    // agentId it just spawned before that agent's subscribe() call lands.
    // processQueues() skips any queue with no matching subscription, so
    // without subscribe() itself triggering a pass, that message would only
    // surface at the next backstop tick.
    bus = createMessageBus({
      processingIntervalMs: 5000,
      ackTimeoutMs: 1000,
    });
    await bus.initialize();

    let deliveredEvents = 0;
    bus.on('message.delivered', () => {
      deliveredEvents++;
    });

    await bus.send({
      type: 'direct',
      from: 'agent-sender',
      to: 'agent-late',
      payload: { hello: 'world' },
      priority: 'normal',
      requiresAck: false,
      ttlMs: 60000,
    });

    // Simulate a realistic gap between send() and the target agent's own
    // subscribe() call (e.g. spawn latency) — long enough that any
    // in-flight scheduleProcessing() pass from send() itself has already
    // run and found no subscriber.
    await new Promise((resolve) => setTimeout(resolve, 20));

    bus.subscribe('agent-late', () => {});

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(deliveredEvents).toBe(1);
  });
});
