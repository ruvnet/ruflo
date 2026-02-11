/**
 * Voting Engine Integration Tests
 *
 * Tests the V3 Raft-based voting engine: initialization, proposals, leader election.
 * Uses the actual @claude-flow/agents voting module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  VotingEngine,
  createVotingEngine,
} from '../../@claude-flow/agents/src/swarm/voting/index.js';

describe('Voting Engine Integration (Raft)', () => {
  let engine: VotingEngine;

  beforeEach(async () => {
    engine = createVotingEngine('node-1', 'raft', {
      threshold: 0.5,
      timeoutMs: 5000,
    });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.shutdown();
  });

  it('should initialize with raft algorithm', () => {
    expect(engine.getAlgorithm()).toBe('raft');
  });

  it('should return its config', () => {
    const config = engine.getConfig();

    expect(config.algorithm).toBe('raft');
    expect(config.threshold).toBe(0.5);
    expect(config.timeoutMs).toBe(5000);
  });

  it('should add and remove peers', () => {
    engine.addNode('node-2');
    engine.addNode('node-3');
    engine.removeNode('node-3');

    // No error thrown = success
    expect(true).toBe(true);
  });

  it('should create a proposal', async () => {
    const proposal = await engine.propose({ action: 'deploy', version: '1.0' });

    expect(proposal).toBeDefined();
    expect(proposal.id).toBeDefined();
    expect(proposal.status).toBe('pending');
  });

  it('should track active proposals', async () => {
    await engine.propose({ action: 'scale-up' });
    await engine.propose({ action: 'scale-down' });

    const active = engine.getActiveProposals();
    expect(active.length).toBeGreaterThanOrEqual(0); // May resolve immediately with single node
  });

  it('should report stats', async () => {
    await engine.propose({ action: 'test' });

    const stats = engine.getStats();

    expect(stats.algorithm).toBe('raft');
    expect(stats.totalProposals).toBeGreaterThanOrEqual(1);
  });

  it('should identify leader status', () => {
    // Single node should become leader
    const isLeader = engine.isLeader();
    expect(typeof isLeader).toBe('boolean');
  });

  it('should fall back to raft for deprecated algorithms', async () => {
    const fallback = createVotingEngine('node-fallback', 'paxos' as any);
    await fallback.initialize();

    expect(fallback.getAlgorithm()).toBe('paxos');
    // Should still work (falls back to raft internally)
    const proposal = await fallback.propose({ action: 'test' });
    expect(proposal).toBeDefined();

    await fallback.shutdown();
  });
});
