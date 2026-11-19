/**
 * #4458 swarm scan: ByzantineConsensus.awaitConsensus() and
 * GossipConsensus.awaitConsensus() polled this.proposals with setInterval
 * every 10/50 ms even though both already emit 'consensus.achieved'.
 *
 * These tests resolve a pending proposal through the event, and exercise the
 * timeout path, while asserting no polling interval is created. The timeout
 * tests also guard against leaving a consensus.achieved listener behind.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  createByzantineConsensus,
  type ByzantineConsensus,
} from '../src/consensus/byzantine.js';
import {
  createGossipConsensus,
  type GossipConsensus,
} from '../src/consensus/gossip.js';
import type { ConsensusVote } from '../src/types.js';

function vote(voterId: string, approve = true): ConsensusVote {
  return {
    voterId,
    approve,
    confidence: 1.0,
    timestamp: new Date(),
  };
}

describe('Byzantine/Gossip awaitConsensus() event-driven resolution (#4458)', () => {
  let bft: ByzantineConsensus | undefined;
  let gossip: GossipConsensus | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (bft) {
      await bft.shutdown();
      bft = undefined;
    }
    if (gossip) {
      await gossip.shutdown();
      gossip = undefined;
    }
  });

  it('Byzantine resolves a pending proposal from consensus.achieved, without polling', async () => {
    bft = createByzantineConsensus('bft-primary', {
      maxFaultyNodes: 1,
      timeoutMs: 1000,
    });
    await bft.initialize();
    bft.electPrimary();
    bft.addNode('bft-1');
    bft.addNode('bft-2');
    bft.addNode('bft-3');

    const proposal = await bft.propose({ action: 'commit' });
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const resultPromise = bft.awaitConsensus(proposal.id);
    await bft.vote(proposal.id, vote('bft-1'));
    await bft.vote(proposal.id, vote('bft-2'));
    await bft.vote(proposal.id, vote('bft-3'));

    const result = await resultPromise;
    expect(result.proposalId).toBe(proposal.id);
    expect(result.approved).toBe(true);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(bft.listenerCount('consensus.achieved')).toBe(0);
  });

  it('Gossip resolves a pending proposal from consensus.achieved, without polling', async () => {
    gossip = createGossipConsensus('gossip-1', {
      timeoutMs: 1000,
      convergenceThreshold: 1.0,
      gossipIntervalMs: 50,
    });
    await gossip.initialize();
    gossip.addNode('gossip-2');
    gossip.addNode('gossip-3');
    gossip.addNode('gossip-4');

    const proposal = await gossip.propose({ action: 'commit' });
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const resultPromise = gossip.awaitConsensus(proposal.id);
    await gossip.vote(proposal.id, vote('gossip-2'));
    await gossip.vote(proposal.id, vote('gossip-3'));
    await gossip.vote(proposal.id, vote('gossip-4'));

    const result = await resultPromise;
    expect(result.proposalId).toBe(proposal.id);
    expect(result.approved).toBe(true);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(gossip.listenerCount('consensus.achieved')).toBe(0);
  });

  it('Byzantine expires a pending proposal with one timer and no listener leak', async () => {
    bft = createByzantineConsensus('bft-timeout', {
      maxFaultyNodes: 1,
      timeoutMs: 40,
    });
    await bft.initialize();
    bft.electPrimary();
    bft.addNode('bft-1');
    bft.addNode('bft-2');
    bft.addNode('bft-3');
    const proposal = await bft.propose({ action: 'never-voted' });

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const result = await bft.awaitConsensus(proposal.id);

    expect(result.proposalId).toBe(proposal.id);
    expect(result.approved).toBe(false);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(bft.listenerCount('consensus.achieved')).toBe(0);
  });

  it('Gossip expires a pending proposal with one timer and no listener leak', async () => {
    gossip = createGossipConsensus('gossip-timeout', {
      timeoutMs: 40,
      convergenceThreshold: 1.0,
      gossipIntervalMs: 50,
    });
    await gossip.initialize();
    gossip.addNode('gossip-2');
    gossip.addNode('gossip-3');
    const proposal = await gossip.propose({ action: 'never-voted' });

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const result = await gossip.awaitConsensus(proposal.id);

    expect(result.proposalId).toBe(proposal.id);
    expect(result.approved).toBe(false);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(gossip.listenerCount('consensus.achieved')).toBe(0);
  });
});
