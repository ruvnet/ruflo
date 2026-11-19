/**
 * Dream Cycle 2026-11-10 (hive-mind SCAN override of performance DEEP) —
 * RaftConsensus's no-transport "legacy in-process" requestVote() path
 * (the production-reachable path: UnifiedSwarmCoordinator's single
 * ConsensusEngine never wires a real ConsensusTransport, confirmed by
 * direct inspection of unified-coordinator.ts and consensus/index.ts)
 * granted or denied votes using a bare `currentTerm > peer.currentTerm`
 * comparison, instead of the vote-once-per-term + log-up-to-date receiver
 * rules (§5.2/§5.4) that the transport RPC path and
 * handleInboundRaftMessage() already apply correctly a few lines above it.
 *
 * This had two distinct, opposite-direction failure modes, both exercised
 * below: a candidate whose term is higher only because of repeated failed
 * elections (not log progress) could win a vote it should lose (unsafe
 * grant — a real Leader Completeness violation); and a candidate at the
 * *current* term with an up-to-date log and an unvoted peer could be
 * wrongly refused a vote it should win (spurious rejection), because the
 * old code required currentTerm to be strictly greater than peer.currentTerm
 * even when they were already equal and nothing had been granted yet.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { createRaftConsensus, RaftConsensus, RaftLogEntry } from '../src/consensus/raft.js';

const instances: RaftConsensus[] = [];
afterEach(async () => {
  for (const r of instances.splice(0)) await r.shutdown();
});

/** Election timeouts long enough that the real timer never fires mid-test. */
function create(): RaftConsensus {
  const r = createRaftConsensus('candidate', {
    electionTimeoutMinMs: 60_000,
    electionTimeoutMaxMs: 60_000,
    heartbeatIntervalMs: 60_000,
  });
  instances.push(r);
  return r;
}

function entry(term: number, index: number): RaftLogEntry {
  return { term, index, command: 'x', timestamp: new Date() };
}

describe('RaftConsensus legacy (no-transport) requestVote() safety', () => {
  it('rejects a candidate whose log is behind the peer, even at a strictly higher term', async () => {
    const raft = create();
    await raft.initialize();
    raft.addPeer('peer-1');
    const internal = raft as unknown as { peers: Map<string, any>; node: any; requestVote(id: string): Promise<boolean> };
    // Peer's locally-tracked log is more advanced than the candidate's own (empty).
    internal.peers.get('peer-1').log = [entry(3, 5)];
    internal.peers.get('peer-1').currentTerm = 1;
    // Candidate's term is higher only because of repeated failed elections, not log progress.
    internal.node.currentTerm = 2;

    const granted = await internal.requestVote('peer-1');
    expect(granted).toBe(false);
  });

  it('grants a vote to a candidate with an equally empty log and a higher term (control)', async () => {
    const raft = create();
    await raft.initialize();
    raft.addPeer('peer-1');
    const internal = raft as unknown as { peers: Map<string, any>; node: any; requestVote(id: string): Promise<boolean> };
    internal.peers.get('peer-1').currentTerm = 1; // peer's log is also empty (default [])
    internal.node.currentTerm = 2;

    const granted = await internal.requestVote('peer-1');
    expect(granted).toBe(true);
  });

  it('grants a vote at an equal term when the peer has not voted yet and the candidate log is at least as fresh', async () => {
    const raft = create();
    await raft.initialize();
    raft.addPeer('peer-1');
    const internal = raft as unknown as { peers: Map<string, any>; node: any; requestVote(id: string): Promise<boolean> };
    internal.peers.get('peer-1').currentTerm = 2; // same term as the candidate
    internal.peers.get('peer-1').votedFor = undefined;
    internal.node.currentTerm = 2;
    internal.node.log.push(entry(1, 1)); // candidate's log is ahead of the peer's empty log

    const granted = await internal.requestVote('peer-1');
    expect(granted).toBe(true);
  });

  it('still rejects a vote at an equal term when the peer already voted for a different candidate (control)', async () => {
    const raft = create();
    await raft.initialize();
    raft.addPeer('peer-1');
    const internal = raft as unknown as { peers: Map<string, any>; node: any; requestVote(id: string): Promise<boolean> };
    internal.peers.get('peer-1').currentTerm = 2;
    internal.peers.get('peer-1').votedFor = 'other-candidate';
    internal.node.currentTerm = 2;

    const granted = await internal.requestVote('peer-1');
    expect(granted).toBe(false);
  });
});
